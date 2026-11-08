// The dashboard's live connection to SpacetimeDB.
//
// Subscribes to the member views (the module only returns rows for incidents this
// browser's identity is an active member of), turns the rows into the same Snapshot
// the screens already use, and calls reducers for every action. Nothing here decides
// permissions: the module checks every call and every row.
//
// The browser keeps its identity token in localStorage for this site, so a reload is
// the same responder. Add ?fresh=1 to the URL to start as a new identity.

import { Identity, Timestamp } from 'spacetimedb';
import type { AuditEntry, AuditLog, Finding, Proposal, Snapshot } from '../../shared/contracts';
import type { IncidentData } from '../data/interface';
import { verifyChain, type AuditEvent } from '../../spacetimedb/src/audit/chain';
import { DASHBOARD_VIEWS, DbConnection } from './bindings';

export interface LiveConfig {
  uri: string;
  dbName: string;
  /** Open this incident; otherwise the newest one this browser can see. */
  incidentId?: string;
  freshIdentity?: boolean;
  /** Sets this browser's display name once connected (?name=Cameron). */
  displayName?: string;
  /**
   * A named session (?as=lead). Each name keeps its own saved login in this browser,
   * so two tabs can be two different people. Logins are never shared between names.
   */
  profile?: string;
}

const pad = (id: bigint) => id.toString().padStart(3, '0');
const ids = {
  evidence: (id: bigint) => `E-${pad(id)}`,
  decision: (id: bigint) => `D-${pad(id)}`,
  briefing: (id: bigint) => `B-${pad(id)}`,
  proposal: (id: bigint) => `P-${pad(id)}`,
  source: (id: bigint) => `SRC-${id}`,
  finding: (id: bigint) => `F-${id}`,
};
/** "E-007" -> 7n. Throws on anything else, so a bad id never reaches a reducer. */
function parseId(text: string, prefix: string): bigint {
  const m = new RegExp(`^${prefix}-(\\d{1,19})$`).exec(text);
  if (!m) throw new Error(`Not a valid ${prefix} id: ${text}`);
  return BigInt(m[1]);
}
const iso = (ts: { toDate(): Date } | undefined) => (ts ? ts.toDate().toISOString() : '');
const STANDING: Record<string, Snapshot['evidence'][number]['standing']> = { confirmed: 'corroborated', under_review: 'reported', disputed: 'disputed' };
const TRUST: Record<string, Snapshot['sources'][number]['trust']> = { trusted: 'established', under_review: 'under_review', untrusted: 'under_review' };
const BRIEFING: Record<string, Snapshot['briefings'][number]['state']> = { current: 'draft', reviewed: 'reviewed', outdated: 'outdated' };

/** 32 hex characters. crypto.getRandomValues works on plain http (phones on the LAN); randomUUID does not. */
function requestId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
}

function tokenKey(dbName: string, profile?: string) { return `cleanroom.token.${dbName}${profile ? `.${profile}` : ''}`; }
function loadToken(dbName: string, profile?: string): string | undefined {
  try { return localStorage.getItem(tokenKey(dbName, profile)) ?? undefined; } catch { return undefined; }
}
function saveToken(dbName: string, token: string, profile?: string) {
  try { localStorage.setItem(tokenKey(dbName, profile), token); } catch { /* private window: the identity lasts for this tab only */ }
}

export function createLiveAdapter(config: LiveConfig): IncidentData {
  let conn: DbConnection | undefined;
  let me: Identity | undefined;
  let connecting: Promise<void> | undefined;
  const listeners = new Set<(s: Snapshot) => void>();
  let pending: ReturnType<typeof setTimeout> | undefined;

  function connect(): Promise<void> {
    connecting ??= new Promise<void>((resolve, reject) => {
      DbConnection.builder()
        .withUri(config.uri)
        .withDatabaseName(config.dbName)
        .withToken(config.freshIdentity ? undefined : loadToken(config.dbName, config.profile))
        .onConnect((c, identity, token) => {
          conn = c; me = identity;
          if (token) saveToken(config.dbName, token, config.profile);
          c.subscriptionBuilder()
            .onApplied(() => {
              const name = config.displayName?.trim();
              if (name) c.reducers.setDisplayName({ display_name: name.slice(0, 64) }).catch(() => { /* shown as "Responder …" instead */ });
              resolve();
            })
            .onError(() => reject(new Error('The live subscription failed. Check that the module is published.')))
            .subscribe(Object.keys(DASHBOARD_VIEWS).map(v => `SELECT * FROM ${v}`));
          const db = c.db;
          for (const table of Object.values(db) as { onInsert?: (cb: () => void) => void; onDelete?: (cb: () => void) => void; onUpdate?: (cb: () => void) => void }[]) {
            table.onInsert?.(schedule); table.onDelete?.(schedule); table.onUpdate?.(schedule);
          }
        })
        .onConnectError((_ctx, e) => { connecting = undefined; reject(new Error(`Could not reach SpacetimeDB at ${config.uri} (${config.dbName}). Is "spacetime start" running? ${e.message}`)); })
        .onDisconnect(() => { connecting = undefined; })
        .build();
    });
    return connecting;
  }

  // Many rows change in one transaction; publish one snapshot per burst.
  function schedule() {
    if (pending) return;
    pending = setTimeout(() => {
      pending = undefined;
      try { const s = build(); listeners.forEach(l => l(s)); } catch { /* not a member yet: nothing to show */ }
    }, 60);
  }

  function db() {
    if (!conn) throw new Error('Not connected.');
    return conn.db;
  }

  function currentIncident() {
    const incidents = [...db().myIncidents.iter()];
    const wanted = config.incidentId ? incidents.find(i => i.id.toString() === config.incidentId) : incidents.sort((a, b) => (a.id < b.id ? 1 : -1))[0];
    if (!wanted) {
      const hex = me?.toHexString() ?? 'unknown';
      throw new Error(`This browser is not a member of ${config.incidentId ? `incident ${config.incidentId}` : 'any incident'} yet. Ask the platform admin to run: npm run demo:admit -- --user ${hex} --tier tier3   Then press Try again.`);
    }
    return wanted;
  }

  function build(): Snapshot {
    const d = db();
    const incident = currentIncident();
    const inc = incident.id;
    const mine = <T extends { incidentId: bigint }>(rows: Iterable<T>) => [...rows].filter(r => r.incidentId === inc);

    const profiles = new Map([...d.visibleProfiles.iter()].map(p => [p.identity.toHexString(), p.displayName]));
    const activity = mine(d.incidentActivity.iter());
    // Nora is not a member, so she has no visible profile; she is the actor of every finding.
    const nora = new Set(activity.filter(a => a.action === 'finding_created' || a.action === 'evidence_reviewed').map(a => a.actor.toHexString()));
    const urgentTargets = new Set(mine(d.incidentSuggestionTargets.iter()).filter(x => x.urgent).map(x => x.suggestionId));
    const name = (who: Identity | undefined) => {
      if (!who) return '';
      const hex = who.toHexString();
      if (nora.has(hex)) return 'Nora (Nemotron)';
      return profiles.get(hex) ?? `Responder ${hex.slice(0, 6)}`;
    };

    const members = mine(d.incidentMembers.iter());
    const evidence = mine(d.incidentEvidence.iter()).sort((a, b) => (a.id < b.id ? -1 : 1));
    const decisions = mine(d.incidentDecisions.iter()).sort((a, b) => (a.id < b.id ? -1 : 1));
    const logins = mine(d.incidentLogins.iter());
    const accounts = mine(d.incidentAccounts.iter());

    const proposals: Proposal[] = mine(d.incidentSuggestions.iter()).sort((a, b) => (a.id < b.id ? -1 : 1)).map(s => ({
      id: ids.proposal(s.id), incidentId: inc.toString(), version: s.version,
      sourceId: ids.source(s.sourceId), sourceVersion: s.sourceVersion, evidenceId: ids.evidence(s.evidenceId), evidenceVersion: s.evidenceVersion,
      decisionVersions: Object.fromEntries(s.decisionIds.map((id, i) => [ids.decision(id), s.decisionVersions[i]])),
      briefingVersions: Object.fromEntries(s.teamUpdateIds.map((id, i) => [ids.briefing(id), s.teamUpdateVersions[i]])),
      excerpt: s.excerpt, explanation: s.explanation, verification: s.verification,
      origin: s.origin === 'nora' ? 'nemotron' : (s.origin as 'synthetic' | 'human'),
      state: s.state as Proposal['state'],
      ...(s.dismissedBy ? { dismissal: { reviewer: name(s.dismissedBy), at: iso(s.dismissedAt), feedback: s.dismissalFeedback } } : {}),
      ...(s.reassessState ? { reassessment: {
        state: s.reassessState as NonNullable<Proposal['reassessment']>['state'], requestId: s.requestId, attempt: s.attempt, requestedAt: iso(s.dismissedAt),
        ...(s.revisionId !== undefined ? { revisionId: ids.proposal(s.revisionId) } : {}),
        ...(s.reassessNote ? { note: s.reassessNote } : {}), ...(s.reassessError ? { error: s.reassessError } : {}),
      } } : {}),
      ...(s.revisionOf !== undefined ? { revisionOf: ids.proposal(s.revisionOf) } : {}),
      ...(urgentTargets.has(s.id) ? { urgent: true } : {}),
    }));

    const findings: Finding[] = mine(d.incidentFindings.iter()).sort((a, b) => (a.id < b.id ? 1 : -1)).map(f => {
      const login = f.loginEventId !== undefined ? logins.find(l => l.id === f.loginEventId) : undefined;
      const account = f.accountId !== undefined ? accounts.find(a => a.id === f.accountId) : undefined;
      let clues: Finding['clues'] = {};
      try { clues = JSON.parse(f.clues); } catch { /* keep empty */ }
      return {
        id: ids.finding(f.id), incidentId: inc.toString(), version: f.version,
        accountRef: account?.accountRef ?? '', severity: f.severity as Finding['severity'], queue: f.queue as Finding['queue'],
        title: f.title, reason: f.reason, clues, attackTechnique: f.attackTechnique, proposedFix: f.proposedFix,
        proposedAction: f.proposedAction as Finding['proposedAction'], ...(f.ruleId !== undefined ? { ruleId: f.ruleId.toString() } : {}),
        state: f.state as Finding['state'], ...(f.decidedBy ? { decidedBy: name(f.decidedBy), decidedAt: iso(f.decidedAt) } : {}),
        dismissalFeedback: f.dismissalFeedback, model: f.model, createdAt: iso(f.createdAt),
        ...(login ? { signIn: `${login.deviceType} / ${login.os} / ${login.browser} from ${login.ip}, ${login.method === 'password_2fa' ? 'password + 2FA' : 'password only'}${login.outcome === 'success' ? '' : ` (${login.outcome.replace('_', ' ')})`}` } : {}),
      };
    });

    return {
      incident: { id: inc.toString(), title: incident.title, summary: incident.summary, status: incident.status, severity: incident.severity, commander: name(incident.commander) || 'Unassigned' },
      sources: mine(d.incidentSources.iter()).map(s => ({ id: ids.source(s.id), incidentId: inc.toString(), version: s.version, label: s.label, trust: TRUST[s.trust] ?? 'under_review', reason: s.reason })),
      evidence: evidence.map(e => ({ id: ids.evidence(e.id), incidentId: inc.toString(), version: e.version, title: e.title, sourceId: e.sourceId !== undefined ? ids.source(e.sourceId) : '', text: e.contentText, standing: STANDING[e.standing] ?? 'reported', eventTime: iso(e.eventTime), recordedAt: iso(e.recordedAt) })),
      decisions: decisions.map(x => ({ id: ids.decision(x.id), incidentId: inc.toString(), version: x.version, title: x.title, rationale: '', assumption: x.assumption, evidenceIds: x.evidenceIds.map(ids.evidence), owner: name(x.owner), state: x.state as Snapshot['decisions'][number]['state'], ...(x.approvedAt ? { approvedAt: iso(x.approvedAt) } : {}) })),
      briefings: mine(d.incidentTeamUpdates.iter()).map(u => ({ id: ids.briefing(u.id), incidentId: inc.toString(), version: u.version, title: u.title, text: u.body, decisionIds: u.decisionIds.map(ids.decision), state: BRIEFING[u.state] ?? 'draft' })),
      proposals,
      tasks: mine(d.incidentTasks.iter()).map(t => ({ id: `T-${t.id}`, incidentId: inc.toString(), version: t.version, proposalId: t.suggestionId === 0n ? '' : ids.proposal(t.suggestionId), decisionId: ids.decision(t.decisionId), title: t.title, owner: name(t.assignee), ownerId: t.assignee.toHexString(), state: (t.state === 'resolved' || t.state === 'accepted' ? t.state : 'open') as 'open' | 'accepted' | 'resolved' })),
      activity: activity.sort((a, b) => (a.timestamp.microsSinceUnixEpoch < b.timestamp.microsSinceUnixEpoch ? 1 : -1)).map(a => ({ id: `A-${a.id}`, incidentId: inc.toString(), version: 1, text: a.detail, actor: name(a.actor), at: iso(a.timestamp) })),
      messages: mine(d.incidentMessages.iter()).sort((a, b) => (a.id < b.id ? -1 : 1)).map(m => ({ id: `M-${m.id}`, incidentId: inc.toString(), version: 1, evidenceId: m.evidenceId !== undefined ? ids.evidence(m.evidenceId) : '', recipientId: m.recipient?.toHexString() ?? '', author: name(m.author), text: m.text, at: iso(m.recordedAt) })),
      scope: mine(d.incidentScope.iter()).map(s => ({ id: `S-${s.id}`, incidentId: inc.toString(), version: s.version, system: s.systemName, data: s.dataCategory, extent: s.affectedExtent, encryption: s.encryptionStatus as Snapshot['scope'][number]['encryption'], exfiltration: s.exfiltrationStatus as Snapshot['scope'][number]['exfiltration'], owner: name(s.owner) })),
      members: members.map(m => ({ id: m.user.toHexString(), incidentId: inc.toString(), version: 1, name: name(m.user), roles: m.roles as Snapshot['members'][number]['roles'], active: m.active })),
      accounts: accounts.map(a => {
        const last = logins.filter(l => l.accountId === a.id && l.outcome === 'success').sort((x, y) => (x.occurredAt.microsSinceUnixEpoch < y.occurredAt.microsSinceUnixEpoch ? 1 : -1))[0];
        return { id: a.accountRef, incidentId: inc.toString(), version: a.version, name: a.name, department: a.department, jobTitle: a.jobTitle, privileged: a.privileged, mfa: a.mfa, inCredentialLeak: a.inCredentialLeak, usedByAttacker: a.usedByAttacker, status: a.status, lastLogin: iso(last?.occurredAt) };
      }),
      findings,
      audit: auditLog(inc.toString(), name),
      evidenceReviews: mine(d.incidentEvidenceReviews.iter()).map(r => ({
        evidenceId: ids.evidence(r.evidenceId), outcome: r.outcome as 'no_impact' | 'conflict' | 'urgent' | 'failed',
        ...(r.decisionId !== undefined ? { decisionId: ids.decision(r.decisionId) } : {}),
        ...(r.suggestionId !== undefined ? { proposalId: ids.proposal(r.suggestionId) } : {}),
        summary: r.summary, at: iso(r.reviewedAt),
      })),
    };
  }

  /** The incident's audit chain, re-verified here in the browser on every update. */
  function auditLog(incidentId: string, name: (who: Identity) => string): AuditLog {
    const d = db();
    const rows = [...d.incidentAudit.iter()].filter(r => r.incidentId === incidentId).sort((a, b) => (a.seq < b.seq ? -1 : 1));
    const events: AuditEvent[] = rows.map(r => ({
      incidentId: r.incidentId, seq: r.seq, actor: r.actor.toHexString(), actorKind: r.actorKind as AuditEvent['actorKind'],
      serverTsMicros: r.serverTs.microsSinceUnixEpoch, clientTsMicros: r.clientTsMicros, action: r.action, entityType: r.entityType,
      entityId: r.entityId, metadata: r.metadata, clientSig: r.clientSig, prevHash: r.prevHash, hash: r.hash,
    }));
    const head = [...d.incidentAuditHeads.iter()].find(h => h.incidentId === incidentId);
    const result = verifyChain(incidentId, events, head ? { head: { seq: head.seq, hash: head.hash } } : {});
    const entries: AuditEntry[] = rows.map(r => {
      let detail = '';
      try {
        const meta = JSON.parse(r.metadata) as Record<string, unknown>;
        detail = typeof meta.detail === 'string' ? meta.detail : Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join(', ');
      } catch { /* leave empty */ }
      return {
        seq: Number(r.seq), at: iso(r.serverTs), actor: r.actorKind === 'service' ? 'Nora (Nemotron)' : name(r.actor), actorKind: r.actorKind as AuditEntry['actorKind'],
        action: r.action, entityType: r.entityType, entityId: r.entityId, detail, hash: r.hash, prevHash: r.prevHash,
      };
    }).reverse();
    return { entries, verified: result.ok, ...(result.firstBreakSeq !== null ? { firstBreakSeq: Number(result.firstBreakSeq) } : {}), ...(head ? { headHash: head.hash } : {}) };
  }

  async function act(run: () => Promise<void>): Promise<Snapshot> {
    await connect();
    await run();
    return build();
  }
  const incidentId = () => currentIncident().id;
  /** A member id is the identity's hex; reject anything else before it reaches a reducer. */
  const identityOf = (hex: string) => {
    const clean = hex.trim().replace(/^0x/, '');
    if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw new Error('Paste the 64-character ID shown in that person\'s browser.');
    return Identity.fromString(clean);
  };
  const findingRow = (id: string) => {
    const row = [...db().incidentFindings.iter()].find(f => f.id === parseId(id, 'F'));
    if (!row) throw new Error('That finding is no longer visible.');
    return row;
  };

  return {
    mode: 'live',
    get identityHex() { return me?.toHexString(); },
    get identity() {
      if (!conn || !me) return null;
      const hex = me.toHexString();
      let roles: string[] = [];
      let label = `Responder ${hex.slice(0, 6)}`;
      try {
        const inc = currentIncident().id;
        roles = [...conn.db.myMemberships.iter()].find(m => m.incidentId === inc && m.active)?.roles ?? [];
        label = [...conn.db.visibleProfiles.iter()].find(p => p.identity.toHexString() === hex)?.displayName ?? label;
      } catch { /* not a member yet */ }
      return { name: label, roles, authenticated: true };
    },
    async load() { await connect(); return build(); },
    confirm: (proposalId, reason) => act(() => conn!.reducers.confirmSuggestion({ suggestion_id: parseId(proposalId, 'P'), reason })),
    dismiss: (proposalId, feedback) => act(() => conn!.reducers.dismissSuggestion({ suggestion_id: parseId(proposalId, 'P'), feedback })),
    retryReassessment: proposalId => act(() => conn!.reducers.retryReassessment({ suggestion_id: parseId(proposalId, 'P') })),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    sendMessage: (evidenceId, recipientId, text) => act(() => conn!.reducers.addMessage({
      incident_id: incidentId(), text, client_request_id: requestId(),
      recipient: recipientId ? Identity.fromString(recipientId) : undefined,
      evidence_id: evidenceId ? parseId(evidenceId, 'E') : undefined,
    })),
    approveFinding: findingId => act(() => conn!.reducers.approveFinding({ finding_id: parseId(findingId, 'F'), expected_version: findingRow(findingId).version })),
    dismissFinding: (findingId, feedback) => act(() => conn!.reducers.dismissFinding({ finding_id: parseId(findingId, 'F'), feedback })),
    undoFinding: findingId => act(() => conn!.reducers.undoAutoFix({ finding_id: parseId(findingId, 'F') })),
    admitMember: (memberId, tier) => act(() => conn!.reducers.admitMember({ incident_id: incidentId(), user: identityOf(memberId), roles: [tier] })),
    setMemberTier: (memberId, tier) => act(() => conn!.reducers.setMemberRoles({ incident_id: incidentId(), user: identityOf(memberId), roles: [tier] })),
    revokeMember: memberId => act(() => conn!.reducers.revokeMember({ incident_id: incidentId(), user: identityOf(memberId) })),
    addEvidence: ({ title, source, text }) => act(() => conn!.reducers.addEvidence({
      incident_id: incidentId(), title, source_label: source || 'Responder report', source_type: 'report', content_text: text,
      event_time: Timestamp.fromDate(new Date()), source_id: undefined,
    })),
    recordDecision: ({ title, assumption, evidenceIds }) => act(() => conn!.reducers.draftDecision({ incident_id: incidentId(), title, assumption, evidence_ids: evidenceIds.map(e => parseId(e, 'E')) })),
    approveDecision: decisionId => act(() => {
      const row = [...db().incidentDecisions.iter()].find(d => d.id === parseId(decisionId, 'D'));
      if (!row) throw new Error('That decision is no longer visible.');
      return conn!.reducers.approveDecision({ decision_id: row.id, expected_version: row.version });
    }),
    assignTask: (decisionId, memberId, title) => act(() => conn!.reducers.assignTask({ decision_id: parseId(decisionId, 'D'), assignee: identityOf(memberId), title })),
    acceptTask: taskId => act(() => conn!.reducers.acceptTask({ task_id: parseId(taskId, 'T') })),
    resolveTask: taskId => act(() => conn!.reducers.resolveTask({ task_id: parseId(taskId, 'T') })),
    resolveDecision: decisionId => act(() => conn!.reducers.resolveDecision({ decision_id: parseId(decisionId, 'D') })),
  };
}
