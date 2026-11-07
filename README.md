# Clean Room - backend (Gate 1)

SpacetimeDB TypeScript module (`spacetimedb/`) for a secure, independently administered
incident command center. Spacetime is the source of truth.

## Prerequisites
Node 22+, and the SpacetimeDB CLI for publishing (install per https://spacetimedb.com/docs).
Module library pinned to `spacetimedb@2.14.1`.

## Run the checks (no server needed)
    cd spacetimedb && npm install
    npm run typecheck
    npm test

## Publish / bindings (unverified here - confirm flags with `spacetime --help`)
    spacetime start                                   # local host
    spacetime publish clean-room --module-path spacetimedb
    spacetime generate --lang typescript --out-dir client/src/module_bindings --module-path spacetimedb

The identity that publishes becomes the platform admin (see docs/SECURITY.md).

## Typical flow
1. Admin calls `create_incident` (becomes that incident's `admin`).
2. Responder connects, calls `set_display_name`, sends the admin their identity hex.
3. Admin calls `admit_member(incident_id, identity, roles)`; admin may `assign_commander`.
4. Clients subscribe ONLY to the views, never raw tables.

See docs/SECURITY.md and docs/STATE.md.
