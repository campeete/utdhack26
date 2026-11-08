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
  type RemoteModule as __RemoteModule,
} from 'spacetimedb';
import {
  DecisionRow, EvidenceReviewRow, EvidenceRow, FindingRow, IncidentRow, LoginEventRow, LowSeverityRuleRow, MembershipRow,
  MessageRow, NoraMemoryRow, NorthstarAccountRow, ReassessmentRequestRow, SourceRow, SuggestionRow, TaskRow, TeamUpdateRow,
} from '../../shared/module-rows.ts';
export type {
  Decision, Evidence, Finding, LoginEvent, LowSeverityRule, NoraMemory, NorthstarAccount,
  ReassessmentRequestRecord, Source, Suggestion, TeamUpdate, EvidenceReview, IncidentRecord, Membership,
  MessageRecord, TaskRecord,
} from '../../shared/module-rows.ts';

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

export const RecordEvidenceReviewArgs = {
  evidenceId: __t.u64(),
  outcome: __t.string(),
  summary: __t.string(),
  model: __t.string(),
};

export const NoraFlagDecisionArgs = {
  evidenceId: __t.u64(),
  decisionId: __t.u64(),
  excerpt: __t.string(),
  explanation: __t.string(),
  verification: __t.string(),
  urgent: __t.bool(),
  model: __t.string(),
};

export const NoraPostArgs = {
  incidentId: __t.u64(),
  text: __t.string(),
  recipient: __t.option(__t.identity()),
  evidenceId: __t.option(__t.u64()),
};

/** View name -> the module table its rows come from. Exported for the schema test. */
export const NORA_VIEWS = {
  incident_logins: 'login_event',
  incident_accounts: 'northstar_account',
  incident_findings: 'finding',
  low_severity_rules: 'low_severity_rule',
  nora_memory_feed: 'nora_memory',
  nora_reassessment_queue: 'reassessment_request',
  incident_suggestions: 'suggestion',
  incident_evidence: 'evidence',
  incident_sources: 'source',
  incident_decisions: 'decision',
  incident_team_updates: 'team_update',
  my_incidents: 'incident',
  incident_members: 'membership',
  incident_messages: 'message',
  incident_tasks: 'task',
  incident_evidence_reviews: 'evidence_review',
} as const;

/** Reducer name -> arguments. Exported for the schema test. */
export const NORA_REDUCERS = {
  create_finding: CreateFindingArgs,
  complete_reassessment: CompleteReassessmentArgs,
  record_evidence_review: RecordEvidenceReviewArgs,
  nora_flag_decision: NoraFlagDecisionArgs,
  nora_post: NoraPostArgs,
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
  myIncidents: __table(view('my_incidents'), IncidentRow),
  incidentMembers: __table(view('incident_members'), MembershipRow),
  incidentMessages: __table(view('incident_messages'), MessageRow),
  incidentTasks: __table(view('incident_tasks'), TaskRow),
  incidentEvidenceReviews: __table(view('incident_evidence_reviews'), EvidenceReviewRow),
});

const reducersSchema = __reducers(
  __reducerSchema('create_finding', CreateFindingArgs),
  __reducerSchema('complete_reassessment', CompleteReassessmentArgs),
  __reducerSchema('record_evidence_review', RecordEvidenceReviewArgs),
  __reducerSchema('nora_flag_decision', NoraFlagDecisionArgs),
  __reducerSchema('nora_post', NoraPostArgs),
);

const proceduresSchema = __procedures();

const REMOTE_MODULE = {
  versionInfo: { cliVersion: '2.14.1' as const },
  tables: tablesSchema.schemaType.tables,
  reducers: reducersSchema.reducersType.reducers,
  ...proceduresSchema,
} satisfies __RemoteModule<typeof tablesSchema.schemaType, typeof reducersSchema.reducersType, typeof proceduresSchema>;

export const reducers = __convertToAccessorMap(reducersSchema.reducersType.reducers);


export class SubscriptionBuilder extends __SubscriptionBuilderImpl<typeof REMOTE_MODULE> {}
export class DbConnectionBuilder extends __DbConnectionBuilder<DbConnection> {}

export class DbConnection extends __DbConnectionImpl<typeof REMOTE_MODULE> {
  static builder = (): DbConnectionBuilder =>
    new DbConnectionBuilder(REMOTE_MODULE, (config: __DbConnectionConfig<typeof REMOTE_MODULE>) => new DbConnection(config));

  override subscriptionBuilder = (): SubscriptionBuilder => new SubscriptionBuilder(this);
}
