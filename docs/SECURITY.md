# Security model (Gate 1)

## Read path
All tables are private. Clients read only through per-caller views
(`my_incidents`, `my_memberships`, `incident_members`, `incident_messages`,
`incident_activity`, `visible_profiles`). Each view filters on `ctx.sender`'s ACTIVE
membership, so revoking membership removes rows from the view.

## Write path
Every reducer: derives identity from `ctx.sender`, looks up membership server-side,
checks role (default deny), validates lengths/enums, and logs an activity event.
Nonexistent incidents and non-membership return the same "Access denied".

## Roles (a person may hold several)
| Operation | admin | commander | analyst | reviewer |
|---|---|---|---|---|
| Read incident, chat | yes | yes | yes | yes |
| Admit / revoke / set roles / assign commander | yes | no | no | no |
| Update incident status/severity/summary | no | yes | no | no |
| Create incident | platform admin only (the publisher) | | | |
Admin does NOT imply commander. The last active admin cannot be revoked or demoted.

## Bootstrap
`init` runs once at first publish; the publishing identity becomes the platform admin.
There is no first-visitor-becomes-admin path.

## Known limits / not yet implemented
- Verified only in the SDK's in-process test harness, NOT on a running SpacetimeDB host.
  Live-subscription revocation of an already-open client must still be tested (Gate 1 item).
- Authentication is whatever the SpacetimeDB host/identity provider supplies; independent
  responder sign-in (SpacetimeAuth or other) is not configured yet.
- Admitting someone requires their identity hex, conveyed out of band.
- No rate limiting. Activity log is application-controlled, not tamper-proof.
- No recovery path if every admin identity is lost.
- Scope, evidence, claims, decisions, tasks, briefings, and the AI service are later gates.
