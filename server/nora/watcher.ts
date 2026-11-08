// Nora's watcher: reacts to new sign-ins and to queued reassessments, asks Nemotron,
// and writes the results back through the module's reducers. All database access goes
// through the NoraStore interface (spacetime.ts implements it), so this file can be
// tested without a database or a network.

import type { Identity } from 'spacetimedb';
import type {
  Decision, Evidence, EvidenceReview, Finding, IncidentRecord, LoginEvent, LowSeverityRule, Membership, MessageRecord,
  NoraMemory, NorthstarAccount, ReassessmentRequestRecord, Source, Suggestion, TaskRecord, TeamUpdate,
} from './bindings.ts';
import { discussionNote, escalationNote, investigate, supportsNote, type CaseFile } from './investigate.ts';
import type { Enricher } from './enrich.ts';
import {
  attentionReasons, computeClues, fallbackFinding, FINDING_SYSTEM_PROMPT, findingPrompt, parseFinding,
  type FindingDraft, type TriageInput,
} from './triage.ts';
import type { ReassessmentRequest } from '../../shared/reassessment.ts';

export interface CreateFindingCall {
  incidentId: bigint;
  accountRef: string | undefined;
  loginEventId: bigint | undefined;
  severity: string;
  queue: string;
  title: string;
  reason: string;
  clues: string;
  attackTechnique: string;
  proposedFix: string;
  proposedAction: string;
  ruleId: bigint | undefined;
  model: string;
}

/** What Nora can see and do. Reads are the current contents of her subscribed views. */
export interface NoraStore {
  logins(): LoginEvent[];
  accounts(): NorthstarAccount[];
  findings(): Finding[];
  rules(): LowSeverityRule[];
  memory(): NoraMemory[];
  requests(): ReassessmentRequestRecord[];
  suggestions(): Suggestion[];
  evidence(): Evidence[];
  sources(): Source[];
  decisions(): Decision[];
  teamUpdates(): TeamUpdate[];
  incidents(): IncidentRecord[];
  members(): Membership[];
  messages(): MessageRecord[];
  tasks(): TaskRecord[];
  evidenceReviews(): EvidenceReview[];
  /** Nora's own identity, so her posts are told apart from responders'. */
  readonly self: Identity;
  onLogin(cb: (row: LoginEvent) => void): void;
  onEvidence(cb: (row: Evidence) => void): void;
  onRequest(cb: (row: ReassessmentRequestRecord) => void): void;
  createFinding(call: CreateFindingCall): Promise<void>;
  completeReassessment(requestId: bigint, resultJson: string): Promise<void>;
  recordEvidenceReview(call: { evidenceId: bigint; outcome: 'no_impact' | 'supports' | 'failed'; summary: string; model: string }): Promise<void>;
  flagDecision(call: { evidenceId: bigint; decisionId: bigint; excerpt: string; explanation: string; verification: string; urgent: boolean; model: string }): Promise<void>;
  post(call: { incidentId: bigint; text: string; recipient: Identity | undefined; evidenceId: bigint | undefined }): Promise<void>;
}

export interface NoraBrain {
  model: string;
  /** Returns Nemotron's parsed JSON answer; throws on failure. */
  finding(system: string, user: string): Promise<unknown>;
  /** Returns Nemotron's raw answer, or {kind:"error"} on failure (never throws). */
  reassess(request: ReassessmentRequest): Promise<unknown>;
}

export interface WatcherDeps {
  store: NoraStore;
  brain: NoraBrain;
  enricher: Enricher;
  attackIds: ReadonlySet<string>;
  /** At startup, analyse at most this many already-recorded sign-ins that need attention. */
  backlogMax: number;
  log: (msg: string) => void;
}

const iso = (ts: { toDate(): Date } | undefined) => (ts ? ts.toDate().toISOString() : '');

/** Builds the same request shape the browser rules use, from Nora's subscribed rows. */
export function buildReassessmentRequest(store: NoraStore, req: ReassessmentRequestRecord): ReassessmentRequest {
  const s = store.suggestions().find(x => x.id === req.suggestionId);
  if (!s) throw new Error(`Suggestion ${req.suggestionId} is not visible to Nora.`);
  const evidence = store.evidence().find(e => e.id === s.evidenceId);
  const source = store.sources().find(x => x.id === s.sourceId);
  const decisions = store.decisions().filter(d => s.decisionIds.includes(d.id));
  const updates = store.teamUpdates().filter(u => s.teamUpdateIds.includes(u.id));
  return {
    requestId: req.requestKey,
    incidentId: req.incidentId.toString(),
    originalSuggestion: { id: s.id.toString(), excerpt: s.excerpt, explanation: s.explanation, verification: s.verification, origin: s.origin === 'nora' ? 'nemotron' : (s.origin as 'synthetic' | 'human') },
    // The reviewer is identified only as a role: Nemotron never needs a person's identity.
    dismissal: { feedback: s.dismissalFeedback, reviewer: 'incident reviewer', at: iso(s.dismissedAt) },
    evidence: evidence && {
      id: evidence.id.toString(), title: evidence.title, text: evidence.contentText,
      standing: evidence.standing as never, eventTime: iso(evidence.eventTime), recordedAt: iso(evidence.recordedAt),
    },
    source: source && { id: source.id.toString(), label: source.label, trust: source.trust as never, reason: source.reason },
    decisions: decisions.map(d => ({ id: d.id.toString(), title: d.title, assumption: d.assumption, state: d.state as never })),
    briefings: updates.map(u => ({ id: u.id.toString(), title: u.title, state: u.state as never })),
    instructions: '',
  };
}

export class NoraWatcher {
  private chain: Promise<void> = Promise.resolve();
  private readonly loginsSeen = new Set<bigint>();
  private readonly requestsSeen = new Set<bigint>();
  private readonly evidenceSeen = new Set<bigint>();

  constructor(private readonly deps: WatcherDeps) {}

  /** Analyses the backlog, then reacts to new rows. Returns when the backlog is queued. */
  start(): void {
    const { store, backlogMax } = this.deps;
    const pending = [...store.logins()]
      .filter(l => !this.hasFinding(l.id))
      .sort((a, b) => Number(a.occurredAt.microsSinceUnixEpoch - b.occurredAt.microsSinceUnixEpoch));
    this.enqueue(async () => {
      let analysed = 0;
      for (const login of pending) {
        if (analysed >= backlogMax) {
          this.deps.log(`Backlog limit (${backlogMax}) reached; older sign-ins left unanalysed.`);
          break;
        }
        if (await this.analyseLogin(login)) analysed++;
      }
    });
    for (const req of store.requests()) this.queueRequest(req);
    // Evidence nobody has reviewed yet, newest first, capped like the sign-in backlog.
    const reviewed = new Set(store.evidenceReviews().map(r => r.evidenceId));
    const unreviewed = store.evidence().filter(e => !reviewed.has(e.id))
      .sort((a, b) => Number(b.recordedAt.microsSinceUnixEpoch - a.recordedAt.microsSinceUnixEpoch)).slice(0, Math.max(backlogMax, 0));
    for (const ev of unreviewed) this.queueEvidence(ev);
    store.onEvidence(row => this.queueEvidence(row));
    store.onLogin(row => this.enqueue(() => this.analyseLogin(row).then(() => undefined)));
    store.onRequest(row => this.queueRequest(row));
  }

  /** Resolves when everything queued so far is done. */
  idle(): Promise<void> {
    return this.chain;
  }

  private enqueue(task: () => Promise<void>) {
    this.chain = this.chain.then(task).catch(e => this.deps.log(`Nora task failed: ${(e as Error).message}`));
  }

  private queueRequest(req: ReassessmentRequestRecord) {
    if (req.state !== 'requested' || this.requestsSeen.has(req.id)) return;
    this.requestsSeen.add(req.id);
    this.enqueue(() => this.reassess(req));
  }

  private queueEvidence(ev: Evidence) {
    if (this.evidenceSeen.has(ev.id)) return;
    this.evidenceSeen.add(ev.id);
    this.enqueue(() => this.investigateEvidence(ev));
  }

  /** Builds what Nora may look at for this evidence's incident. */
  private caseFile(ev: Evidence): CaseFile {
    const { store } = this.deps;
    const inc = ev.incidentId;
    const sourceOf = (e: Evidence) => store.sources().find(s => s.id === e.sourceId)?.label ?? e.sourceLabel;
    // Findings from submit_findings are titled "Verification of D-003: …".
    const verifies = (e: Evidence) => { const m = e.sourceType === 'verification' ? /^Verification of D-(\d+)/.exec(e.title) : null; return m ? BigInt(m[1]) : undefined; };
    const item = (e: Evidence) => ({ id: e.id, title: e.title, text: e.contentText, source: sourceOf(e), verifies: verifies(e) });
    return {
      evidence: item(ev),
      otherEvidence: store.evidence().filter(e => e.incidentId === inc && e.id !== ev.id).map(item),
      decisions: store.decisions().filter(d => d.incidentId === inc).map(d => ({ id: d.id, title: d.title, assumption: d.assumption, state: d.state, evidenceIds: d.evidenceIds })),
      updates: store.teamUpdates().filter(u => u.incidentId === inc).map(u => ({ id: u.id, title: u.title, decisionIds: u.decisionIds, state: u.state })),
      discussion: store.messages().filter(m => m.incidentId === inc && !m.recipient)
        .sort((a, b) => Number(a.recordedAt.microsSinceUnixEpoch - b.recordedAt.microsSinceUnixEpoch))
        .map(m => ({ fromNora: m.author.isEqual(store.self), text: m.text, at: m.recordedAt.toDate().toISOString() })),
      tasks: store.tasks().filter(t => t.incidentId === inc).map(t => ({ decisionId: t.decisionId, title: t.title, state: t.state })),
    };
  }

  /** Reads new evidence and acts on the verdict: quiet record, suggestion + note, or escalation. */
  private async investigateEvidence(ev: Evidence): Promise<void> {
    const { store, brain, log } = this.deps;
    if (store.evidenceReviews().some(r => r.evidenceId === ev.id)) return;
    const label = `E-${ev.id.toString().padStart(3, '0')}`;
    const file = this.caseFile(ev);
    let verdict;
    try {
      const result = await investigate(file, (system, user) => brain.finding(system, user));
      verdict = result.verdict;
      log(`Investigated ${label} in ${result.rounds} round(s)${result.toolsUsed.length ? ` using ${result.toolsUsed.join(', ')}` : ''}: ${verdict.kind}.`);
    } catch (e) {
      log(`Could not investigate ${label}: ${(e as Error).message}`);
      await store.recordEvidenceReview({ evidenceId: ev.id, outcome: 'failed', summary: (e as Error).message.slice(0, 400), model: brain.model })
        .catch(err => log(`The module refused the review record for ${label}: ${(err as Error).message}`));
      return;
    }
    try {
      if (verdict.kind === 'no_impact') {
        await store.recordEvidenceReview({ evidenceId: ev.id, outcome: 'no_impact', summary: verdict.summary, model: brain.model });
        return;
      }
      if (verdict.kind === 'supports') {
        const supported = file.decisions.find(d => d.id === verdict.decisionId)!;
        await store.recordEvidenceReview({ evidenceId: ev.id, outcome: 'supports', summary: verdict.summary, model: brain.model });
        await store.post({ incidentId: ev.incidentId, text: supportsNote(verdict, file.evidence, supported), recipient: undefined, evidenceId: ev.id });
        return;
      }
      const decision = file.decisions.find(d => d.id === verdict.decisionId)!;
      await store.flagDecision({
        evidenceId: ev.id, decisionId: decision.id, excerpt: verdict.excerpt, explanation: verdict.explanation,
        verification: verdict.verification, urgent: verdict.kind === 'urgent', model: brain.model,
      });
      await store.post({ incidentId: ev.incidentId, text: discussionNote(verdict, file.evidence, decision), recipient: undefined, evidenceId: ev.id });
      if (verdict.kind === 'urgent') {
        const incident = store.incidents().find(i => i.id === ev.incidentId);
        const lead = incident?.commander;
        const leadActive = lead && store.members().some(m => m.incidentId === ev.incidentId && m.active && m.user.isEqual(lead));
        await store.post({ incidentId: ev.incidentId, text: escalationNote(verdict, file.evidence, decision), recipient: leadActive ? lead : undefined, evidenceId: ev.id });
      }
    } catch (e) {
      log(`The module refused Nora's verdict on ${label}: ${(e as Error).message}`);
    }
  }

  private hasFinding(loginId: bigint) {
    return this.deps.store.findings().some(f => f.loginEventId === loginId);
  }

  /** Returns true if the sign-in needed attention (whether or not Nemotron answered). */
  private async analyseLogin(login: LoginEvent): Promise<boolean> {
    const { store, enricher, brain, attackIds, log } = this.deps;
    if (this.loginsSeen.has(login.id) || this.hasFinding(login.id)) return false;
    this.loginsSeen.add(login.id);
    const account = store.accounts().find(a => a.id === login.accountId);
    if (!account) {
      log(`Sign-in ${login.id} names an account Nora cannot see; skipped.`);
      return false;
    }
    const ip = await enricher.lookup(login.ip);
    const clues = computeClues(login, account, ip);
    const reasons = attentionReasons(login, account, clues);
    if (reasons.length === 0) return false;

    const memory = store.memory().filter(m => m.incidentId === login.incidentId)
      .sort((a, b) => Number(a.recordedAt.microsSinceUnixEpoch - b.recordedAt.microsSinceUnixEpoch));
    const input: TriageInput = { login, account, clues, reasons, rules: store.rules(), memory };

    let draft: FindingDraft;
    try {
      draft = parseFinding(await brain.finding(FINDING_SYSTEM_PROMPT, findingPrompt(input)), input, attackIds, brain.model);
    } catch (e) {
      log(`Nemotron could not score sign-in ${login.id} (${(e as Error).message}); writing a rules-only finding.`);
      draft = fallbackFinding(input, attackIds, (e as Error).message);
    }
    try {
      await store.createFinding({
        incidentId: login.incidentId, accountRef: account.accountRef, loginEventId: login.id,
        severity: draft.severity, queue: draft.queue, title: draft.title, reason: draft.reason,
        clues: JSON.stringify(draft.clues), attackTechnique: draft.attackTechnique,
        proposedFix: draft.proposedFix, proposedAction: draft.proposedAction, ruleId: draft.ruleId, model: draft.model,
      });
      log(`Finding for ${account.accountRef}: ${draft.severity}, ${draft.queue}, ${draft.proposedAction}${draft.ruleId !== undefined ? ` (rule ${draft.ruleId})` : ''}.`);
    } catch (e) {
      log(`The module refused Nora's finding for sign-in ${login.id}: ${(e as Error).message}`);
    }
    return true;
  }

  private async reassess(req: ReassessmentRequestRecord): Promise<void> {
    const { store, brain, log } = this.deps;
    let result: unknown;
    try {
      result = await brain.reassess(buildReassessmentRequest(store, req));
    } catch (e) {
      result = { kind: 'error', message: (e as Error).message };
    }
    try {
      await store.completeReassessment(req.id, JSON.stringify(result));
      log(`Reassessment ${req.requestKey}: ${(result as { kind?: string })?.kind ?? 'answered'}.`);
    } catch (e) {
      log(`The module refused reassessment ${req.requestKey}: ${(e as Error).message}`);
    }
  }
}
