// Client bindings for the dashboard: the member views and the reducers a responder
// uses. Rows come from shared/module-rows.ts; spacetimedb/test/nora-bindings.test.ts
// checks rows, view names and reducer arguments against the module.

/* eslint-disable */
import {
  DbConnectionBuilder as __DbConnectionBuilder,
  DbConnectionImpl as __DbConnectionImpl,
  SubscriptionBuilderImpl as __SubscriptionBuilderImpl,
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
  ActivityEventRow, AuditEventRow, AuditHeadRow, DecisionRow, EvidenceRow, FindingRow, IncidentRow, LoginEventRow,
  MembershipRow, MessageRow, NorthstarAccountRow, ScopeItemRow, SourceRow, SuggestionRow, TaskRow, TeamUpdateRow,
  UserProfileRow,
} from '../../shared/module-rows';

/** View name -> the module table its rows come from. */
export const DASHBOARD_VIEWS = {
  my_incidents: 'incident',
  my_memberships: 'membership',
  incident_members: 'membership',
  visible_profiles: 'user_profile',
  incident_messages: 'message',
  incident_activity: 'activity_event',
  incident_scope: 'scope_item',
  incident_evidence: 'evidence',
  incident_sources: 'source',
  incident_decisions: 'decision',
  incident_team_updates: 'team_update',
  incident_suggestions: 'suggestion',
  incident_tasks: 'task',
  incident_accounts: 'northstar_account',
  incident_logins: 'login_event',
  incident_findings: 'finding',
  incident_audit: 'audit_event',
  incident_audit_heads: 'audit_head',
} as const;

export const DASHBOARD_REDUCERS = {
  set_display_name: { display_name: __t.string() },
  add_message: { incident_id: __t.u64(), text: __t.string(), client_request_id: __t.option(__t.string()), recipient: __t.option(__t.identity()), evidence_id: __t.option(__t.u64()) },
  confirm_suggestion: { suggestion_id: __t.u64(), reason: __t.string() },
  dismiss_suggestion: { suggestion_id: __t.u64(), feedback: __t.string() },
  retry_reassessment: { suggestion_id: __t.u64() },
  approve_finding: { finding_id: __t.u64(), expected_version: __t.u32() },
  dismiss_finding: { finding_id: __t.u64(), feedback: __t.string() },
  undo_auto_fix: { finding_id: __t.u64() },
} as const;

const view = (name: string) => ({ name, indexes: [], constraints: [] });
const tablesSchema = __schema({
  myIncidents: __table(view('my_incidents'), IncidentRow),
  myMemberships: __table(view('my_memberships'), MembershipRow),
  incidentMembers: __table(view('incident_members'), MembershipRow),
  visibleProfiles: __table(view('visible_profiles'), UserProfileRow),
  incidentMessages: __table(view('incident_messages'), MessageRow),
  incidentActivity: __table(view('incident_activity'), ActivityEventRow),
  incidentScope: __table(view('incident_scope'), ScopeItemRow),
  incidentEvidence: __table(view('incident_evidence'), EvidenceRow),
  incidentSources: __table(view('incident_sources'), SourceRow),
  incidentDecisions: __table(view('incident_decisions'), DecisionRow),
  incidentTeamUpdates: __table(view('incident_team_updates'), TeamUpdateRow),
  incidentSuggestions: __table(view('incident_suggestions'), SuggestionRow),
  incidentTasks: __table(view('incident_tasks'), TaskRow),
  incidentAccounts: __table(view('incident_accounts'), NorthstarAccountRow),
  incidentLogins: __table(view('incident_logins'), LoginEventRow),
  incidentFindings: __table(view('incident_findings'), FindingRow),
  incidentAudit: __table(view('incident_audit'), AuditEventRow),
  incidentAuditHeads: __table(view('incident_audit_heads'), AuditHeadRow),
});

const reducersSchema = __reducers(
  __reducerSchema('set_display_name', DASHBOARD_REDUCERS.set_display_name),
  __reducerSchema('add_message', DASHBOARD_REDUCERS.add_message),
  __reducerSchema('confirm_suggestion', DASHBOARD_REDUCERS.confirm_suggestion),
  __reducerSchema('dismiss_suggestion', DASHBOARD_REDUCERS.dismiss_suggestion),
  __reducerSchema('retry_reassessment', DASHBOARD_REDUCERS.retry_reassessment),
  __reducerSchema('approve_finding', DASHBOARD_REDUCERS.approve_finding),
  __reducerSchema('dismiss_finding', DASHBOARD_REDUCERS.dismiss_finding),
  __reducerSchema('undo_auto_fix', DASHBOARD_REDUCERS.undo_auto_fix),
);
const proceduresSchema = __procedures();

const REMOTE_MODULE = {
  versionInfo: { cliVersion: '2.14.1' as const },
  tables: tablesSchema.schemaType.tables,
  reducers: reducersSchema.reducersType.reducers,
  ...proceduresSchema,
} satisfies __RemoteModule<typeof tablesSchema.schemaType, typeof reducersSchema.reducersType, typeof proceduresSchema>;

export class SubscriptionBuilder extends __SubscriptionBuilderImpl<typeof REMOTE_MODULE> {}
export class DbConnectionBuilder extends __DbConnectionBuilder<DbConnection> {}
export class DbConnection extends __DbConnectionImpl<typeof REMOTE_MODULE> {
  static builder = (): DbConnectionBuilder =>
    new DbConnectionBuilder(REMOTE_MODULE, (config: __DbConnectionConfig<typeof REMOTE_MODULE>) => new DbConnection(config));
  override subscriptionBuilder = (): SubscriptionBuilder => new SubscriptionBuilder(this);
}
