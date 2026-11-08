// Client bindings for the demo setup script, which runs as the platform admin (the
// identity that published the module). Hand-written like ../nora/bindings.ts and
// checked against the module by spacetimedb/test/nora-bindings.test.ts.

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
import { DecisionRow, IncidentRow, LowSeverityRuleRow } from '../../shared/module-rows.ts';

// Struct argument types: field order must match the module's t.object(...) exactly.
export const SeedAccountType = __t.object('SeedAccount', {
  account_ref: __t.string(),
  name: __t.string(),
  department: __t.string(),
  job_title: __t.string(),
  privileged: __t.bool(),
  mfa: __t.string(),
  in_credential_leak: __t.bool(),
  used_by_attacker: __t.bool(),
  status: __t.string(),
  usual_devices: __t.array(__t.string()),
  usual_networks: __t.array(__t.string()),
});

export const SeedLoginType = __t.object('SeedLogin', {
  account_ref: __t.string(),
  occurred_at: __t.timestamp(),
  method: __t.string(),
  outcome: __t.string(),
  ip: __t.string(),
  device_type: __t.string(),
  os: __t.string(),
  browser: __t.string(),
  password_breached: __t.option(__t.bool()),
});

export const DEMO_VIEWS = { my_incidents: 'incident', low_severity_rules: 'low_severity_rule', incident_decisions: 'decision' } as const;

export const DEMO_REDUCERS = {
  create_incident: { title: __t.string(), summary: __t.string(), severity: __t.string() },
  set_service_account: { identity: __t.identity(), kind: __t.string(), enabled: __t.bool() },
  save_low_severity_rule: { rule_id: __t.option(__t.u64()), situation: __t.string(), allowed_action: __t.string(), enabled: __t.bool() },
  load_demo_scenario: { incident_id: __t.u64(), accounts: __t.array(SeedAccountType), logins: __t.array(SeedLoginType) },
  admit_member: { incident_id: __t.u64(), user: __t.identity(), roles: __t.array(__t.string()) },
  set_display_name: { display_name: __t.string() },
  draft_decision: { incident_id: __t.u64(), title: __t.string(), assumption: __t.string(), evidence_ids: __t.array(__t.u64()) },
  approve_decision: { decision_id: __t.u64(), expected_version: __t.u32() },
} as const;

const view = (name: string) => ({ name, indexes: [], constraints: [] });
const tablesSchema = __schema({
  myIncidents: __table(view('my_incidents'), IncidentRow),
  lowSeverityRules: __table(view('low_severity_rules'), LowSeverityRuleRow),
  incidentDecisions: __table(view('incident_decisions'), DecisionRow),
});
const reducersSchema = __reducers(
  __reducerSchema('create_incident', DEMO_REDUCERS.create_incident),
  __reducerSchema('set_service_account', DEMO_REDUCERS.set_service_account),
  __reducerSchema('save_low_severity_rule', DEMO_REDUCERS.save_low_severity_rule),
  __reducerSchema('load_demo_scenario', DEMO_REDUCERS.load_demo_scenario),
  __reducerSchema('admit_member', DEMO_REDUCERS.admit_member),
  __reducerSchema('set_display_name', DEMO_REDUCERS.set_display_name),
  __reducerSchema('draft_decision', DEMO_REDUCERS.draft_decision),
  __reducerSchema('approve_decision', DEMO_REDUCERS.approve_decision),
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
