/**
 * Three tiers that stack: a higher tier can do everything a lower one can.
 * Tier 1 triages (gathers data, defines problems and breaches), Tier 2 contains and
 * mitigates, Tier 3 hunts hidden attackers, does forensics and manages the team.
 */
export type Role = 'tier1' | 'tier2' | 'tier3';
export const ROLE_LABELS: Record<Role, string> = { tier1: 'Tier 1 · Triage', tier2: 'Tier 2 · Containment', tier3: 'Tier 3 · Forensics' };
export const roleLabel = (role: string) => ROLE_LABELS[role as Role] ?? role;
/** The highest tier in a role list (0 if none). */
export const tierOf = (roles: readonly string[]) => Math.max(0, ...roles.map(r => ['tier1', 'tier2', 'tier3'].indexOf(r) + 1));
export type Standing = 'reported' | 'corroborated' | 'disputed' | 'unknown' | 'withdrawn';
export type Trust = 'established' | 'under_review';
export type DecisionState = 'draft' | 'approved' | 'needs_review' | 'superseded' | 'closed';
export interface RecordBase { id: string; incidentId: string; version: number }
export interface Source extends RecordBase { label: string; trust: Trust; reason: string }
export interface Evidence extends RecordBase { title: string; sourceId: string; text: string; standing: Standing; eventTime: string; recordedAt: string }
export interface Decision extends RecordBase {
  title: string; rationale: string; assumption: string; evidenceIds: string[];
  owner: string; state: DecisionState; approvedAt?: string;
}
export interface Briefing extends RecordBase { title: string; text: string; decisionIds: string[]; state: 'draft' | 'reviewed' | 'outdated' }
export interface Dismissal { reviewer: string; at: string; feedback: string }
export type ReassessmentState = 'requested' | 'revised' | 'no_further_review' | 'failed';
export interface Reassessment {
  state: ReassessmentState; requestId: string; attempt: number; requestedAt: string;
  completedAt?: string; revisionId?: string; note?: string; error?: string;
}
export interface Proposal extends RecordBase {
  sourceId: string; sourceVersion: number; evidenceId: string; evidenceVersion: number;
  decisionVersions: Record<string, number>; briefingVersions: Record<string, number>;
  excerpt: string; explanation: string; verification: string;
  origin: 'synthetic' | 'human' | 'nemotron'; state: 'pending' | 'accepted' | 'dismissed' | 'stale';
  /** Set once when a reviewer dismisses; never rewritten afterwards. */
  dismissal?: Dismissal;
  /** Present only when the dismissal carried feedback for Nemotron. */
  reassessment?: Reassessment;
  /** Id of the dismissed suggestion this one revises. */
  revisionOf?: string;
  /** Nora flagged it as urgent: acting on the decision now could cause harm. */
  urgent?: boolean;
}
export interface Task extends RecordBase {
  /** '' when the task was assigned by hand rather than from a suggestion. */
  proposalId: string; decisionId: string; title: string; owner: string;
  /** The assignee's member id (identity in live mode). */
  ownerId?: string;
  state: 'open' | 'accepted' | 'resolved';
}
export interface Activity extends RecordBase { text: string; actor: string; at: string }
export interface Message extends RecordBase { evidenceId: string; recipientId: string; author: string; text: string; at: string }
export interface ScopeItem extends RecordBase { system: string; data: string; extent: string; encryption: 'unknown' | 'suspected' | 'confirmed' | 'not_observed'; exfiltration: 'unknown' | 'suspected' | 'confirmed' | 'not_observed'; owner: string }
export interface Member extends RecordBase { name: string; roles: Role[]; active: boolean }
/** An affected employee or service account at the client company (not a responder). Never carries secrets. */
export interface Account extends RecordBase {
  name: string; department: string; jobTitle: string; privileged: boolean;
  mfa: string; inCredentialLeak: boolean; usedByAttacker: boolean; status: string; lastLogin: string;
}
/** One of Nora's findings about a sign-in. `clues` never holds secrets (see spacetimedb/src/rules.ts). */
export type FindingState = 'open' | 'approved' | 'dismissed' | 'auto_fixed' | 'undone';
export interface Finding extends RecordBase {
  accountRef: string; severity: 'low' | 'medium' | 'high' | 'critical'; queue: 'needs_human' | 'low_severity';
  title: string; reason: string; clues: Record<string, string | number | boolean>;
  attackTechnique: string; proposedFix: string; proposedAction: 'disable_account' | 'force_password_reset' | 'monitor_only';
  ruleId?: string; state: FindingState; decidedBy?: string; decidedAt?: string; dismissalFeedback: string;
  model: string; createdAt: string;
  /** "Phone / iOS / Safari from 203.0.113.66, password only" */
  signIn?: string;
}
/** One hash-chained audit event, as the monitor panel shows it. */
export interface AuditEntry {
  seq: number; at: string; actor: string; actorKind: 'user' | 'service' | 'system';
  action: string; entityType: string; entityId: string; detail: string; hash: string; prevHash: string;
}
/** Nora (Nemotron)'s review of one piece of evidence. */
export interface EvidenceReview {
  evidenceId: string; outcome: 'no_impact' | 'conflict' | 'urgent' | 'failed';
  decisionId?: string; proposalId?: string; summary: string; at: string;
}
export interface AuditLog {
  entries: AuditEntry[];
  /** null: not checked (fixture mode); true: every hash and link verified in this browser. */
  verified: boolean | null;
  firstBreakSeq?: number;
  headHash?: string;
}
export interface Snapshot {
  incident: { id: string; title: string; summary: string; status: string; severity: string; commander: string };
  sources: Source[]; evidence: Evidence[]; decisions: Decision[]; briefings: Briefing[];
  proposals: Proposal[]; tasks: Task[]; activity: Activity[]; messages: Message[]; scope: ScopeItem[]; members: Member[];
  /** Optional so existing producers (the server module) keep compiling until live accounts exist. */
  accounts?: Account[];
  /** Nora's findings (live mode, or samples in fixture mode). */
  findings?: Finding[];
  audit?: AuditLog;
  /** Nora (Nemotron)'s evidence reviews (live mode). */
  evidenceReviews?: EvidenceReview[];
}
export interface Impact { decisionIds: string[]; briefingIds: string[] }
export type DataState = 'loading' | 'ready' | 'denied' | 'revoked' | 'disconnected' | 'error';
