// Client bindings for Nora's worker: only the views and reducers Nora uses.
//
// Written by hand in the same shape `spacetime generate` produces (see
// src/module_bindings/index.ts), because the generator needs the SpacetimeDB CLI.
// spacetimedb/test/nora-bindings.test.ts compares every row and argument list here
// with the module, column by column, so a schema change that isn't mirrored here
// fails the tests instead of failing at the demo.

/* eslint-disable */
import {
  DbConnectionBuilder as __DbConnectionBuilder,
  DbConnectionImpl as __DbConnectionImpl,
  SubscriptionBuilderImpl as __SubscriptionBuilderImpl,
  convertToAccessorMap as __convertToAccessorMap,
  procedures as __procedures,
  reducerSchema as __reducerSchema,
  reducers as __reducers,
  schema as __schema,
  t as __t,
  table as __table,
  type DbConnectionConfig as __DbConnectionConfig,
  type Infer as __Infer,
  type RemoteModule as __RemoteModule,
} from 'spacetimedb';

// ---------- view rows (each view returns rows of one module table) ----------

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

// ---------- reducer arguments ----------

export const CreateFindingArgs = {
  incidentId: __t.u64(),
  accountRef: __t.option(__t.string()),
  loginEventId: __t.option(__t.u64()),
  severity: __t.string(),
  queue: __t.string(),
  title: __t.string(),
  reason: __t.string(),
  clues: __t.string(),
  attackTechnique: __t.string(),
  proposedFix: __t.string(),
  proposedAction: __t.string(),
  ruleId: __t.option(__t.u64()),
  model: __t.string(),
};

export const CompleteReassessmentArgs = {
  requestId: __t.u64(),
  resultJson: __t.string(),
};

/** View name -> row, as the module names them. Exported for the schema test. */
export const NORA_VIEWS = {
  incident_logins: LoginEventRow,
  incident_accounts: NorthstarAccountRow,
  incident_findings: FindingRow,
  low_severity_rules: LowSeverityRuleRow,
  nora_memory_feed: NoraMemoryRow,
  nora_reassessment_queue: ReassessmentRequestRow,
  incident_suggestions: SuggestionRow,
  incident_evidence: EvidenceRow,
  incident_sources: SourceRow,
  incident_decisions: DecisionRow,
  incident_team_updates: TeamUpdateRow,
} as const;

/** Reducer name -> arguments. Exported for the schema test. */
export const NORA_REDUCERS = {
  create_finding: CreateFindingArgs,
  complete_reassessment: CompleteReassessmentArgs,
} as const;

const view = (name: string) => ({ name, indexes: [], constraints: [] });

const tablesSchema = __schema({
  incidentLogins: __table(view('incident_logins'), LoginEventRow),
  incidentAccounts: __table(view('incident_accounts'), NorthstarAccountRow),
  incidentFindings: __table(view('incident_findings'), FindingRow),
  lowSeverityRules: __table(view('low_severity_rules'), LowSeverityRuleRow),
  noraMemoryFeed: __table(view('nora_memory_feed'), NoraMemoryRow),
  noraReassessmentQueue: __table(view('nora_reassessment_queue'), ReassessmentRequestRow),
  incidentSuggestions: __table(view('incident_suggestions'), SuggestionRow),
  incidentEvidence: __table(view('incident_evidence'), EvidenceRow),
  incidentSources: __table(view('incident_sources'), SourceRow),
  incidentDecisions: __table(view('incident_decisions'), DecisionRow),
  incidentTeamUpdates: __table(view('incident_team_updates'), TeamUpdateRow),
});

const reducersSchema = __reducers(
  __reducerSchema('create_finding', CreateFindingArgs),
  __reducerSchema('complete_reassessment', CompleteReassessmentArgs),
);

const proceduresSchema = __procedures();

const REMOTE_MODULE = {
  versionInfo: { cliVersion: '2.14.1' as const },
  tables: tablesSchema.schemaType.tables,
  reducers: reducersSchema.reducersType.reducers,
  ...proceduresSchema,
} satisfies __RemoteModule<typeof tablesSchema.schemaType, typeof reducersSchema.reducersType, typeof proceduresSchema>;

export const reducers = __convertToAccessorMap(reducersSchema.reducersType.reducers);

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

export class SubscriptionBuilder extends __SubscriptionBuilderImpl<typeof REMOTE_MODULE> {}
export class DbConnectionBuilder extends __DbConnectionBuilder<DbConnection> {}

export class DbConnection extends __DbConnectionImpl<typeof REMOTE_MODULE> {
  static builder = (): DbConnectionBuilder =>
    new DbConnectionBuilder(REMOTE_MODULE, (config: __DbConnectionConfig<typeof REMOTE_MODULE>) => new DbConnection(config));

  override subscriptionBuilder = (): SubscriptionBuilder => new SubscriptionBuilder(this);
}
