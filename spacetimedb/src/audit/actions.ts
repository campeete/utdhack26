/**
 * Every action the audit log accepts. An unknown action is rejected, so a typo
 * in a reducer fails loudly in testing instead of creating an event nobody
 * filters for. Names follow the brief's operations (section 9).
 */
export const AUDIT_ACTIONS = [
  // platform and access
  'MODULE_INITIALIZED', 'ADMIN_GRANTED', 'MEMBER_ADMITTED', 'MEMBER_REVOKED', 'ROLE_CHANGED',
  'INVITE_CREATED', 'INVITE_REDEEMED', 'ACCESS_DENIED',
  // incident record
  'INCIDENT_CREATED', 'INCIDENT_UPDATED', 'STATUS_CHANGED', 'SEVERITY_CHANGED',
  // scope
  'SCOPE_ITEM_ADDED', 'SCOPE_ITEM_UPDATED',
  // evidence, claims, decisions
  'EVIDENCE_ADDED', 'CLAIM_CREATED', 'DECISION_CREATED', 'DECISION_ASSUMPTION_LINKED',
  'DECISION_APPROVED', 'DECISION_NEEDS_REVIEW', 'DECISION_REVISED',
  // AI workflow (the agent can only propose)
  'ANALYSIS_REQUESTED', 'ANALYSIS_FINISHED', 'PROPOSAL_STORED', 'PROPOSAL_ACCEPTED',
  'PROPOSAL_DISMISSED', 'PROPOSAL_STALE',
  // tasks, briefings, chat
  'TASK_ASSIGNED', 'TASK_RESOLVED', 'BRIEFING_CREATED', 'BRIEFING_REVIEWED', 'BRIEFING_OUTDATED',
  'MESSAGE_SENT',
  // demo administration
  'DEMO_RESET',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
const SET: ReadonlySet<string> = new Set(AUDIT_ACTIONS);
export const isAuditAction = (a: string): a is AuditAction => SET.has(a);

/** Incident id 0 holds platform-level events (bootstrap, admin grants). */
export const PLATFORM_INCIDENT = 0n;
