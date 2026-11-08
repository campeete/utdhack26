// Client-side row types for the Clean Room module's tables, shared by Nora's worker
// (server/nora), the demo setup (server/demo) and the dashboard (src/live).
//
// Written by hand in the shape `spacetime generate` produces, because the generator
// needs the SpacetimeDB CLI. Rows are decoded by position, so
// spacetimedb/test/nora-bindings.test.ts checks every row here against the module,
// column by column.

/* eslint-disable */
import { t as __t, type Infer as __Infer } from 'spacetimedb';


export const LoginEventRow = __t.row({
  id: __t.u64().primaryKey(),
  incidentId: __t.u64().name('incident_id'),
  accountId: __t.u64().name('account_id'),
  occurredAt: __t.timestamp().name('occurred_at'),
  method: __t.string(),
  outcome: __t.string(),
  ip: __t.string(),
  deviceType: __t.string().name('device_type'),
  os: __t.string(),
  browser: __t.string(),
  passwordBreached: __t.option(__t.bool()).name('password_breached'),
  origin: __t.string(),
  recordedBy: __t.identity().name('recorded_by'),
});

export const NorthstarAccountRow = __t.row({
  id: __t.u64().primaryKey(),
  incidentId: __t.u64().name('incident_id'),
  accountRef: __t.string().name('account_ref'),
  name: __t.string(),
  department: __t.string(),
  jobTitle: __t.string().name('job_title'),
  privileged: __t.bool(),
  mfa: __t.string(),
  inCredentialLeak: __t.bool().name('in_credential_leak'),
  usedByAttacker: __t.bool().name('used_by_attacker'),
  status: __t.string(),
  usualDevices: __t.array(__t.string()).name('usual_devices'),
  usualNetworks: __t.array(__t.string()).name('usual_networks'),
  version: __t.u32(),
});

export const FindingRow = __t.row({
  id: __t.u64().primaryKey(),
  incidentId: __t.u64().name('incident_id'),
  accountId: __t.option(__t.u64()).name('account_id'),
  loginEventId: __t.option(__t.u64()).name('login_event_id'),
  severity: __t.string(),
  queue: __t.string(),
  title: __t.string(),
  reason: __t.string(),
  clues: __t.string(),
  attackTechnique: __t.string().name('attack_technique'),
  proposedFix: __t.string().name('proposed_fix'),
  proposedAction: __t.string().name('proposed_action'),
  ruleId: __t.option(__t.u64()).name('rule_id'),
  state: __t.string(),
  decidedBy: __t.option(__t.identity()).name('decided_by'),
  decidedAt: __t.option(__t.timestamp()).name('decided_at'),
  dismissalFeedback: __t.string().name('dismissal_feedback'),
  priorStatus: __t.option(__t.string()).name('prior_status'),
  model: __t.string(),
  createdAt: __t.timestamp().name('created_at'),
  version: __t.u32(),
});

export const LowSeverityRuleRow = __t.row({
  id: __t.u64().primaryKey(),
  situation: __t.string(),
  allowedAction: __t.string().name('allowed_action'),
  enabled: __t.bool(),
  createdBy: __t.identity().name('created_by'),
  updatedAt: __t.timestamp().name('updated_at'),
  version: __t.u32(),
});

export const NoraMemoryRow = __t.row({
  id: __t.u64().primaryKey(),
  incidentId: __t.u64().name('incident_id'),
  findingId: __t.u64().name('finding_id'),
  decision: __t.string(),
  feedback: __t.string(),
  recordedBy: __t.identity().name('recorded_by'),
  recordedAt: __t.timestamp().name('recorded_at'),
});

export const ReassessmentRequestRow = __t.row({
  id: __t.u64().primaryKey(),
  incidentId: __t.u64().name('incident_id'),
  suggestionId: __t.u64().name('suggestion_id'),
  requestKey: __t.string().name('request_key'),
  attempt: __t.u32(),
  state: __t.string(),
  requestedBy: __t.identity().name('requested_by'),
  requestedAt: __t.timestamp().name('requested_at'),
  completedAt: __t.option(__t.timestamp()).name('completed_at'),
  error: __t.string(),
});

export const SuggestionRow = __t.row({
  id: __t.u64().primaryKey(),
  incidentId: __t.u64().name('incident_id'),
  sourceId: __t.u64().name('source_id'),
  sourceVersion: __t.u32().name('source_version'),
  evidenceId: __t.u64().name('evidence_id'),
  evidenceVersion: __t.u32().name('evidence_version'),
  decisionIds: __t.array(__t.u64()).name('decision_ids'),
  decisionVersions: __t.array(__t.u32()).name('decision_versions'),
  teamUpdateIds: __t.array(__t.u64()).name('team_update_ids'),
  teamUpdateVersions: __t.array(__t.u32()).name('team_update_versions'),
  excerpt: __t.string(),
  explanation: __t.string(),
  verification: __t.string(),
  origin: __t.string(),
  state: __t.string(),
  revisionOf: __t.option(__t.u64()).name('revision_of'),
  createdBy: __t.identity().name('created_by'),
  createdAt: __t.timestamp().name('created_at'),
  dismissedBy: __t.option(__t.identity()).name('dismissed_by'),
  dismissedAt: __t.option(__t.timestamp()).name('dismissed_at'),
  dismissalFeedback: __t.string().name('dismissal_feedback'),
  reassessState: __t.string().name('reassess_state'),
  requestId: __t.string().name('request_id'),
  attempt: __t.u32(),
  reassessError: __t.string().name('reassess_error'),
  reassessNote: __t.string().name('reassess_note'),
  revisionId: __t.option(__t.u64()).name('revision_id'),
  version: __t.u32(),
});

export const EvidenceRow = __t.row({
  id: __t.u64().primaryKey(),
  incidentId: __t.u64().name('incident_id'),
  title: __t.string(),
  sourceLabel: __t.string().name('source_label'),
  sourceType: __t.string().name('source_type'),
  contentText: __t.string().name('content_text'),
  eventTime: __t.timestamp().name('event_time'),
  recordedAt: __t.timestamp().name('recorded_at'),
  submittedBy: __t.identity().name('submitted_by'),
  version: __t.u32(),
  sourceId: __t.option(__t.u64()).name('source_id'),
  standing: __t.string(),
});

export const SourceRow = __t.row({
  id: __t.u64().primaryKey(),
  incidentId: __t.u64().name('incident_id'),
  label: __t.string(),
  trust: __t.string(),
  reason: __t.string(),
  createdBy: __t.identity().name('created_by'),
  createdAt: __t.timestamp().name('created_at'),
  version: __t.u32(),
});

export const DecisionRow = __t.row({
  id: __t.u64().primaryKey(),
  incidentId: __t.u64().name('incident_id'),
  title: __t.string(),
  assumption: __t.string(),
  state: __t.string(),
  evidenceIds: __t.array(__t.u64()).name('evidence_ids'),
  owner: __t.identity(),
  approvedAt: __t.option(__t.timestamp()).name('approved_at'),
  version: __t.u32(),
});

export const TeamUpdateRow = __t.row({
  id: __t.u64().primaryKey(),
  incidentId: __t.u64().name('incident_id'),
  title: __t.string(),
  body: __t.string(),
  decisionIds: __t.array(__t.u64()).name('decision_ids'),
  state: __t.string(),
  updatedBy: __t.identity().name('updated_by'),
  updatedAt: __t.timestamp().name('updated_at'),
  version: __t.u32(),
});

export const IncidentRow = __t.row({
  id: __t.u64().primaryKey(),
  title: __t.string(),
  summary: __t.string(),
  status: __t.string(),
  severity: __t.string(),
  commander: __t.option(__t.identity()),
  createdBy: __t.identity().name('created_by'),
  createdAt: __t.timestamp().name('created_at'),
  updatedAt: __t.timestamp().name('updated_at'),
  version: __t.u32(),
});


export const MembershipRow = __t.row({
  id: __t.u64().primaryKey(),
  incidentId: __t.u64().name('incident_id'),
  user: __t.identity(),
  roles: __t.array(__t.string()),
  active: __t.bool(),
  admittedBy: __t.identity().name('admitted_by'),
  admittedAt: __t.timestamp().name('admitted_at'),
  revokedBy: __t.option(__t.identity()).name('revoked_by'),
  revokedAt: __t.option(__t.timestamp()).name('revoked_at'),
});

export const UserProfileRow = __t.row({
  identity: __t.identity().primaryKey(),
  displayName: __t.string().name('display_name'),
  updatedAt: __t.timestamp().name('updated_at'),
});

export const MessageRow = __t.row({
  id: __t.u64().primaryKey(),
  incidentId: __t.u64().name('incident_id'),
  author: __t.identity(),
  text: __t.string(),
  recordedAt: __t.timestamp().name('recorded_at'),
  clientRequestId: __t.option(__t.string()).name('client_request_id'),
  recipient: __t.option(__t.identity()),
  evidenceId: __t.option(__t.u64()).name('evidence_id'),
});

export const ActivityEventRow = __t.row({
  id: __t.u64().primaryKey(),
  incidentId: __t.u64().name('incident_id'),
  actor: __t.identity(),
  action: __t.string(),
  entityType: __t.string().name('entity_type'),
  entityId: __t.u64().name('entity_id'),
  detail: __t.string(),
  timestamp: __t.timestamp(),
});

export const ScopeItemRow = __t.row({
  id: __t.u64().primaryKey(),
  incidentId: __t.u64().name('incident_id'),
  systemName: __t.string().name('system_name'),
  dataCategory: __t.string().name('data_category'),
  affectedExtent: __t.string().name('affected_extent'),
  encryptionStatus: __t.string().name('encryption_status'),
  exfiltrationStatus: __t.string().name('exfiltration_status'),
  businessImpact: __t.string().name('business_impact'),
  owner: __t.identity(),
  observedAt: __t.timestamp().name('observed_at'),
  updatedAt: __t.timestamp().name('updated_at'),
  version: __t.u32(),
});

export const TaskRow = __t.row({
  id: __t.u64().primaryKey(),
  incidentId: __t.u64().name('incident_id'),
  suggestionId: __t.u64().name('suggestion_id'),
  decisionId: __t.u64().name('decision_id'),
  title: __t.string(),
  assignee: __t.identity(),
  state: __t.string(),
  createdAt: __t.timestamp().name('created_at'),
  version: __t.u32(),
});

export const AuditEventRow = __t.row({
  id: __t.u64().primaryKey(),
  incidentId: __t.string().name('incident_id'),
  seq: __t.u64(),
  actor: __t.identity(),
  actorKind: __t.string().name('actor_kind'),
  serverTs: __t.timestamp().name('server_ts'),
  clientTsMicros: __t.i64().name('client_ts_micros'),
  action: __t.string(),
  entityType: __t.string().name('entity_type'),
  entityId: __t.string().name('entity_id'),
  metadata: __t.string(),
  clientSig: __t.string().name('client_sig'),
  prevHash: __t.string().name('prev_hash'),
  hash: __t.string(),
});

export const AuditHeadRow = __t.row({
  incidentId: __t.string().primaryKey().name('incident_id'),
  seq: __t.u64(),
  hash: __t.string(),
  updatedAt: __t.timestamp().name('updated_at'),
});

export const SuggestionTargetRow = __t.row({
  suggestionId: __t.u64().primaryKey().name('suggestion_id'),
  incidentId: __t.u64().name('incident_id'),
  decisionId: __t.u64().name('decision_id'),
  decisionVersion: __t.u32().name('decision_version'),
  urgent: __t.bool(),
});

export const EvidenceReviewRow = __t.row({
  evidenceId: __t.u64().primaryKey().name('evidence_id'),
  incidentId: __t.u64().name('incident_id'),
  outcome: __t.string(),
  decisionId: __t.option(__t.u64()).name('decision_id'),
  suggestionId: __t.option(__t.u64()).name('suggestion_id'),
  summary: __t.string(),
  model: __t.string(),
  reviewedAt: __t.timestamp().name('reviewed_at'),
});

/** Module table name -> row. spacetimedb/test/nora-bindings.test.ts checks each against the module. */
export const MODULE_ROWS = {
  incident: IncidentRow,
  membership: MembershipRow,
  user_profile: UserProfileRow,
  message: MessageRow,
  activity_event: ActivityEventRow,
  scope_item: ScopeItemRow,
  evidence: EvidenceRow,
  source: SourceRow,
  decision: DecisionRow,
  team_update: TeamUpdateRow,
  suggestion: SuggestionRow,
  task: TaskRow,
  northstar_account: NorthstarAccountRow,
  login_event: LoginEventRow,
  finding: FindingRow,
  low_severity_rule: LowSeverityRuleRow,
  nora_memory: NoraMemoryRow,
  reassessment_request: ReassessmentRequestRow,
  audit_event: AuditEventRow,
  audit_head: AuditHeadRow,
  suggestion_target: SuggestionTargetRow,
  evidence_review: EvidenceReviewRow,
} as const;

export type IncidentRecord = __Infer<typeof IncidentRow>;
export type Membership = __Infer<typeof MembershipRow>;
export type UserProfile = __Infer<typeof UserProfileRow>;
export type MessageRecord = __Infer<typeof MessageRow>;
export type ActivityEvent = __Infer<typeof ActivityEventRow>;
export type ScopeItemRecord = __Infer<typeof ScopeItemRow>;
export type TaskRecord = __Infer<typeof TaskRow>;
export type AuditEventRecord = __Infer<typeof AuditEventRow>;
export type AuditHeadRecord = __Infer<typeof AuditHeadRow>;
export type LoginEvent = __Infer<typeof LoginEventRow>;
export type NorthstarAccount = __Infer<typeof NorthstarAccountRow>;
export type Finding = __Infer<typeof FindingRow>;
export type LowSeverityRule = __Infer<typeof LowSeverityRuleRow>;
export type NoraMemory = __Infer<typeof NoraMemoryRow>;
export type ReassessmentRequestRecord = __Infer<typeof ReassessmentRequestRow>;
export type Suggestion = __Infer<typeof SuggestionRow>;
export type Evidence = __Infer<typeof EvidenceRow>;
export type Source = __Infer<typeof SourceRow>;
export type Decision = __Infer<typeof DecisionRow>;
export type TeamUpdate = __Infer<typeof TeamUpdateRow>;
export type SuggestionTarget = __Infer<typeof SuggestionTargetRow>;
export type EvidenceReview = __Infer<typeof EvidenceReviewRow>;
