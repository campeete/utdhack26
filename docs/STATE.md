# Build state

## Done (Gate 1 module, checked in-process)
- Module: 6 private tables, 6 per-user views, 9 reducers + init (spacetimedb/src/index.ts)
- `npm run typecheck` clean; `npm test` 19/19 (access-control.test.ts)
- Mutation check: removing the `active` filter from views fails the revocation test

## Not verified
- Not run on a live SpacetimeDB instance (no CLI available when this was built)
- Client bindings not generated; no UI; no auth provider configured; no AI service

## Next
1. Install the Spacetime CLI, publish locally, generate bindings, confirm view-based
   subscriptions update/clear for an already-open revoked client.
2. Configure independent sign-in. 3. Gate 2: scope items (separate encryption/exfiltration
   states), evidence, activity UI.
