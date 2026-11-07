import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { confirmReview } from '../../shared/review';
import type { Snapshot, Role } from '../../shared/contracts';

// One aggregate per incident gives the first review transaction a single version
// boundary. Normalize entities behind the transport adapter as access patterns grow.
const incident = table({ public: false }, { id: t.string().primaryKey(), payload: t.string(), version: t.u32(), updatedAt: t.timestamp() });
const membership = table({ public: false }, {
  id: t.string().primaryKey(), incidentId: t.string().index(), identity: t.identity().index(),
  roles: t.array(t.string()), active: t.bool(), admittedBy: t.identity(), updatedAt: t.timestamp(),
});
const configuration = table({ public: false }, {
  id: t.string().primaryKey(), operator: t.identity(), issuer: t.string(), audience: t.string(),
  // Read gate intentionally closed until live OIDC/read/revocation tests pass.
  readsEnabled: t.bool(),
});
const audit = table({ public: false }, {
  id: t.u64().primaryKey().autoInc(), incidentId: t.string().index(), actor: t.identity(), action: t.string(), at: t.timestamp(),
});
const spacetimedb = schema({ incident, membership, configuration, audit });
export default spacetimedb;
type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
const roles: Role[] = ['admin', 'commander', 'analyst', 'reviewer'];
function config(ctx: Ctx) {
  const row = ctx.db.configuration.id.find('auth');
  if (!row) throw new SenderError('Authentication is not configured.');
  return row;
}
function operator(ctx: Ctx) {
  if (!config(ctx).operator.equals(ctx.sender)) throw new SenderError('Database operator required.');
}
function authenticate(ctx: Ctx) {
  const cfg = config(ctx); const jwt = ctx.senderAuth.jwt;
  if (!cfg.issuer || !cfg.audience || !jwt || jwt.issuer !== cfg.issuer || !jwt.audience.includes(cfg.audience)) throw new SenderError('Independent sign-in with the configured issuer and audience is required.');
}
function authorize(ctx: Ctx, incidentId: string, permitted?: Role[]) {
  authenticate(ctx);
  const member = [...ctx.db.membership.identity.filter(ctx.sender)].find(m => m.incidentId === incidentId && m.active);
  if (!member || (permitted && !member.roles.some(role => permitted.includes(role as Role)))) throw new SenderError('Active incident membership with the required role is needed.');
  return member;
}
function log(ctx: Ctx, incidentId: string, action: string) {
  ctx.db.audit.insert({ id: 0n, incidentId, actor: ctx.sender, action, at: ctx.timestamp });
}
function load(ctx: Ctx, id: string, expectedVersion: number) {
  const row = ctx.db.incident.id.find(id);
  if (!row || row.version !== expectedVersion) throw new SenderError('Incident changed. Refresh before applying this operation.');
  return { row, data: JSON.parse(row.payload) as Snapshot };
}

export const init = spacetimedb.init(ctx => {
  // Operator comes from the publishing identity; no first-client bootstrap.
  ctx.db.configuration.insert({ id: 'auth', operator: ctx.sender, issuer: '', audience: '', readsEnabled: false });
});
export const configureIdentity = spacetimedb.reducer({ issuer: t.string(), audience: t.string() }, (ctx, args) => {
  operator(ctx);
  if (!args.issuer.startsWith('https://') || args.issuer.length > 300 || !args.audience.trim() || args.audience.length > 200) throw new SenderError('A verified HTTPS issuer and client audience are required.');
  ctx.db.configuration.id.update({ ...config(ctx), ...args, readsEnabled: false });
  log(ctx, 'operator', 'OIDC configuration changed; read gate remains closed.');
});
export const onConnect = spacetimedb.clientConnected(ctx => { authenticate(ctx); });

// Controlled operator admission of the first verified identity. This reducer does
// not accept client-selected roles and cannot be invoked by ordinary responders.
export const bootstrapIncident = spacetimedb.reducer({ incidentId: t.string(), adminIdentity: t.identity(), title: t.string() }, (ctx, { incidentId, adminIdentity, title }) => {
  operator(ctx);
  if (!/^[a-z0-9-]{1,64}$/.test(incidentId) || !title.trim() || title.length > 160) throw new SenderError('Invalid incident fields.');
  if (ctx.db.incident.id.find(incidentId)) throw new SenderError('Incident already exists.');
  const data: Snapshot = { incident: { id: incidentId, title, summary: '', severity: 'Unknown', status: 'Investigating', commander: 'Unassigned' }, sources: [], evidence: [], decisions: [], briefings: [], proposals: [], tasks: [], activity: [], messages: [], scope: [], members: [] };
  ctx.db.incident.insert({ id: incidentId, payload: JSON.stringify(data), version: 1, updatedAt: ctx.timestamp });
  ctx.db.membership.insert({ id: `${incidentId}:${adminIdentity.toHexString()}`, incidentId, identity: adminIdentity, roles: ['admin'], active: true, admittedBy: ctx.sender, updatedAt: ctx.timestamp });
  log(ctx, incidentId, 'Incident created and independently verified administrator admitted.');
});
export const setMembership = spacetimedb.reducer({ incidentId: t.string(), identity: t.identity(), assignedRoles: t.array(t.string()), active: t.bool() }, (ctx, args) => {
  authorize(ctx, args.incidentId, ['admin']);
  if (!args.assignedRoles.length || args.assignedRoles.length > 4 || args.assignedRoles.some(r => !roles.includes(r as Role))) throw new SenderError('Invalid role assignment.');
  const id = `${args.incidentId}:${args.identity.toHexString()}`;
  const existing = ctx.db.membership.id.find(id);
  if (existing?.active && existing.roles.includes('admin') && (!args.active || !args.assignedRoles.includes('admin'))) {
    const admins = [...ctx.db.membership.incidentId.filter(args.incidentId)].filter(m => m.active && m.roles.includes('admin'));
    if (admins.length <= 1) throw new SenderError('Cannot remove the last active administrator.');
  }
  const next = { id, incidentId: args.incidentId, identity: args.identity, roles: args.assignedRoles, active: args.active, admittedBy: existing?.admittedBy ?? ctx.sender, updatedAt: ctx.timestamp };
  if (existing) ctx.db.membership.id.update(next); else ctx.db.membership.insert(next);
  log(ctx, args.incidentId, args.active ? 'Membership admitted/updated.' : 'Membership revoked.');
});
export const acceptReview = spacetimedb.reducer({ incidentId: t.string(), proposalId: t.string(), expectedVersion: t.u32(), reason: t.string() }, (ctx, args) => {
  authorize(ctx, args.incidentId, ['analyst', 'commander']);
  const { row, data } = load(ctx, args.incidentId, args.expectedVersion);
  const next = confirmReview(data, args.proposalId, args.reason, ctx.sender.toHexString(), ctx.timestamp.toDate().toISOString());
  if (next === data) return;
  ctx.db.incident.id.update({ ...row, payload: JSON.stringify(next), version: row.version + 1, updatedAt: ctx.timestamp });
  log(ctx, args.incidentId, `Review accepted: ${args.proposalId}`);
});
export const sendMessage = spacetimedb.reducer({ incidentId: t.string(), expectedVersion: t.u32(), requestId: t.string(), text: t.string() }, (ctx, args) => {
  authorize(ctx, args.incidentId);
  if (!args.text.trim() || args.text.length > 2000 || !/^[a-zA-Z0-9-]{8,80}$/.test(args.requestId)) throw new SenderError('Invalid message or request identifier.');
  const { row, data } = load(ctx, args.incidentId, args.expectedVersion);
  const id = `${ctx.sender.toHexString()}:${args.requestId}`;
  if (data.messages.some(m => m.id === id)) return;
  data.messages.push({ id, incidentId: args.incidentId, version: 1, author: ctx.sender.toHexString(), text: args.text.trim(), at: ctx.timestamp.toDate().toISOString() });
  ctx.db.incident.id.update({ ...row, payload: JSON.stringify(data), version: row.version + 1, updatedAt: ctx.timestamp });
  log(ctx, args.incidentId, 'Message recorded.');
});

export const myIncidents = spacetimedb.view({ public: true }, t.array(incident.rowType), ctx => {
  const cfg = ctx.db.configuration.id.find('auth');
  if (!cfg?.readsEnabled) return [];
  // Index reads keep membership changes in the view dependency graph.
  return [...ctx.db.membership.identity.filter(ctx.sender)].filter(m => m.active).flatMap(m => {
    const row = ctx.db.incident.id.find(m.incidentId); return row ? [row] : [];
  });
});
