export type Role = 'admin' | 'commander' | 'analyst' | 'reviewer';
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
}
export interface Task extends RecordBase { proposalId: string; decisionId: string; title: string; owner: string; state: 'open' | 'resolved' }
export interface Activity extends RecordBase { text: string; actor: string; at: string }
export interface Message extends RecordBase { evidenceId: string; author: string; text: string; at: string }
export interface ScopeItem extends RecordBase { system: string; data: string; extent: string; encryption: 'unknown' | 'suspected' | 'confirmed' | 'not_observed'; exfiltration: 'unknown' | 'suspected' | 'confirmed' | 'not_observed'; owner: string }
export interface Member extends RecordBase { name: string; roles: Role[]; active: boolean }
export interface Snapshot {
  incident: { id: string; title: string; summary: string; status: string; severity: string; commander: string };
  sources: Source[]; evidence: Evidence[]; decisions: Decision[]; briefings: Briefing[];
  proposals: Proposal[]; tasks: Task[]; activity: Activity[]; messages: Message[]; scope: ScopeItem[]; members: Member[];
}
export interface Impact { decisionIds: string[]; briefingIds: string[] }
export type DataState = 'loading' | 'ready' | 'denied' | 'revoked' | 'disconnected' | 'error';
