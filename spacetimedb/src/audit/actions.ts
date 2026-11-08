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
  // sources (trust is separate from evidence standing)
  'SOURCE_ADDED', 'SOURCE_TRUST_CHANGED',
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
  'DEMO_RESET', 'DEMO_LOADED',
  // services, Northstar's side and the phone demo
  'SERVICE_ACCOUNT_SET', 'COMMANDER_ASSIGNED', 'EVIDENCE_STANDING_CHANGED', 'TEAM_UPDATE_REVIEWED',
  'TASK_ACCEPTED', 'LOGIN_RECORDED', 'ACCOUNT_STATUS_CHANGED', 'CONTACT_ADDED', 'SMS_SENT',
  // Nora's findings, rules and memory
  'FINDING_CREATED', 'FINDING_APPROVED', 'FINDING_DISMISSED', 'FINDING_AUTO_FIXED', 'FINDING_UNDONE',
  'RULE_SAVED', 'MEMORY_DELETED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
const SET: ReadonlySet<string> = new Set(AUDIT_ACTIONS);
export const isAuditAction = (a: string): a is AuditAction => SET.has(a);

/** Incident ids match the backend module's rule: 1-64 of a-z, 0-9 and '-'. */
export const INCIDENT_ID = /^[a-z0-9-]{1,64}$/;

/** Platform-level events (bootstrap, admin grants, identity config). The leading
 *  underscore can never pass INCIDENT_ID, so no real incident can collide with it. */
export const PLATFORM_INCIDENT = '_platform';

export const isIncidentId = (id: string): boolean => id === PLATFORM_INCIDENT || INCIDENT_ID.test(id);
