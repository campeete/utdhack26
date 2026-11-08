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
  ActivityEventRow, AuditEventRow, MessageDecisionRow, JoinCodeRow, AuditHeadRow, DecisionRow, EvidenceReviewRow, EvidenceRow, FindingRow, IncidentRow, LoginEventRow, SuggestionTargetRow,
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
  incident_evidence_reviews: 'evidence_review',
  incident_suggestion_targets: 'suggestion_target',
  incident_message_decisions: 'message_decision',
  incident_join_codes: 'join_code',
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
  admit_member: { incident_id: __t.u64(), user: __t.identity(), roles: __t.array(__t.string()) },
  set_member_roles: { incident_id: __t.u64(), user: __t.identity(), roles: __t.array(__t.string()) },
  revoke_member: { incident_id: __t.u64(), user: __t.identity() },
  add_evidence: { incident_id: __t.u64(), title: __t.string(), source_label: __t.string(), source_type: __t.string(), content_text: __t.string(), event_time: __t.timestamp(), source_id: __t.option(__t.u64()) },
  draft_decision: { incident_id: __t.u64(), title: __t.string(), assumption: __t.string(), evidence_ids: __t.array(__t.u64()) },
  approve_decision: { decision_id: __t.u64(), expected_version: __t.u32() },
  assign_task: { decision_id: __t.u64(), assignee: __t.identity(), title: __t.string() },
  accept_task: { task_id: __t.u64() },
  resolve_task: { task_id: __t.u64() },
  resolve_decision: { decision_id: __t.u64() },
  submit_findings: { task_id: __t.u64(), findings: __t.string() },
  replace_decision: { decision_id: __t.u64(), title: __t.string(), assumption: __t.string() },
  reassign_task: { task_id: __t.u64(), assignee: __t.identity() },
  set_join_code: { incident_id: __t.u64(), code: __t.string(), tier: __t.string() },
  join_with_code: { code: __t.string() },
  add_issue_message: { decision_id: __t.u64(), text: __t.string(), client_request_id: __t.option(__t.string()), recipient: __t.option(__t.identity()) },
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
  incidentEvidenceReviews: __table(view('incident_evidence_reviews'), EvidenceReviewRow),
  incidentSuggestionTargets: __table(view('incident_suggestion_targets'), SuggestionTargetRow),
  incidentMessageDecisions: __table(view('incident_message_decisions'), MessageDecisionRow),
  incidentJoinCodes: __table(view('incident_join_codes'), JoinCodeRow),
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
  __reducerSchema('admit_member', DASHBOARD_REDUCERS.admit_member),
  __reducerSchema('set_member_roles', DASHBOARD_REDUCERS.set_member_roles),
  __reducerSchema('revoke_member', DASHBOARD_REDUCERS.revoke_member),
  __reducerSchema('add_evidence', DASHBOARD_REDUCERS.add_evidence),
  __reducerSchema('draft_decision', DASHBOARD_REDUCERS.draft_decision),
  __reducerSchema('approve_decision', DASHBOARD_REDUCERS.approve_decision),
  __reducerSchema('assign_task', DASHBOARD_REDUCERS.assign_task),
  __reducerSchema('accept_task', DASHBOARD_REDUCERS.accept_task),
  __reducerSchema('resolve_task', DASHBOARD_REDUCERS.resolve_task),
  __reducerSchema('resolve_decision', DASHBOARD_REDUCERS.resolve_decision),
  __reducerSchema('submit_findings', DASHBOARD_REDUCERS.submit_findings),
  __reducerSchema('add_issue_message', DASHBOARD_REDUCERS.add_issue_message),
  __reducerSchema('replace_decision', DASHBOARD_REDUCERS.replace_decision),
  __reducerSchema('reassign_task', DASHBOARD_REDUCERS.reassign_task),
  __reducerSchema('set_join_code', DASHBOARD_REDUCERS.set_join_code),
  __reducerSchema('join_with_code', DASHBOARD_REDUCERS.join_with_code),
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
