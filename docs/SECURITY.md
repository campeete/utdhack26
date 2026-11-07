# Security integration status

This is an implementation foundation, not a secure shared-incident milestone. The browser uses synthetic, volatile fixtures. It does not connect, authenticate, deliver messages, run AI, or establish independent infrastructure.

Spacetime 2.14.1 module: all storage tables are private. Mutations use server identity, issuer/audience checks, active membership, role checks, server timestamps, bounded text, incident version checks, and a transactional review transition. Admin is separate from analyst/commander. Operator bootstrap is limited to the publishing identity; no self-enrollment. Last-admin removal is rejected. No network/model calls occur in reducers.

The first implementation stores each incident as a private versioned aggregate, plus native membership/configuration/audit tables. This simplifies atomic review propagation at prototype scale. It serializes writes per incident; normalize records before scaling or introducing role-specific field access. The shared typed snapshot is its transport payload. There is no public arbitrary-snapshot write reducer.

`myIncidents` reads through indexed memberships, intended to retract dependent incident rows on revocation. **Its read gate defaults closed and has no enable reducer.** This is deliberate until the identity/read/revocation matrix passes. The SDK ViewCtx contains sender identity but no JWT claims, so do not assume the connection's issuer/audience check protects every HTTP SQL read path. Resolve token/audience enforcement for direct SQL and subscriptions with official platform support or a verified admission/session design before enabling the view. Private data must remain closed until that is settled.

Pending: independent SpacetimeAuth project and callback/client configuration; administrator identity verified out of band; successful sign-in; authorized vs outsider reads/writes; cross-incident denial; read access over HTTP SQL with alternative audience; existing subscription revocation; reconnect after revocation; last-admin test; role transition and malformed input tests; aggregate growth bounds; rate limits and request deduplication retention; structured entity reducers and proposal intake; live UI adapter. No production identity configuration, tokens, or paid resources created.

AI: no service or credentials configured. Proposal is explicitly pre-authored synthetic content. Future service owns only bounded Nemotron analysis and proposal persistence; it cannot approve decisions. Evidence must remain untrusted tool input.

Official references checked 2026-11-07:
- https://spacetimedb.com/templates/react-ts
- https://spacetimedb.com/docs/core-concepts/authentication/usage/
- https://spacetimedb.com/docs/functions/views/
- https://spacetimedb.com/docs/tables/access-permissions/

Sponsor questions remain: acceptable independent identity/hosting model; booth access; permitted track combinations; approved Nemotron endpoint/model/credits. These do not block local fixture work.
