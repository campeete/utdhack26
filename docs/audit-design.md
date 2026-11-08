# Clean Room audit log: design

Owner: Cameron (role D). Status: built and unit-tested outside a live database; the Gate 1 live check is pending (see [Open items](#open-items)).

**Claim we can defend:** the incident log is **tamper-evident**. Every change to it (editing, deleting, inserting, reordering, cutting off the end, or swapping in an event from another incident) is detected by a verifier anyone can run, with no need to trust our dashboard or database. It is **not** tamper-proof or immutable: someone with database access can still change rows. What they can't do is change them unnoticed, and a full rewrite is caught only when a witness has saved an earlier hash (see anchors below).

## Threat model

The brief assumes the attacker may control corporate systems, reach our public endpoints, and possibly take over a responder's account. For the log, the question is: **what if the attacker gets write access to the audit table itself?** They might try to:

| Attacker goal | How they'd try it | Caught by |
| --- | --- | --- |
| Hide what they did | Edit an event's details | `HASH_MISMATCH` |
| Hide it more carefully | Edit, then recompute that event's hash | `LINK_BROKEN` on the next event |
| Erase evidence | Delete an event | `SEQ_GAP` + `LINK_BROKEN` |
| Fabricate history | Insert a forged event | `SEQ_DUPLICATE` |
| Change the story's order | Swap timestamps | `TIME_REVERSED` |
| Erase the latest events | Delete the tail | `HEAD_MISMATCH` |
| Erase the tail cleanly | Delete the tail and fix the head table | `ANCHOR_MISMATCH` (needs a witness) |
| Rewrite everything | Edit, then re-hash and re-link all later events | `ANCHOR_MISMATCH` (needs a witness) |
| Mix incidents | Paste a valid event from another incident | `WRONG_INCIDENT` + `LINK_BROKEN` |

Every row is a passing test in both TypeScript and the independent Python verifier.

## How it works

1. **One chain per incident.** Each event stores `seq` (1, 2, 3…), the previous event's hash, and its own hash. Each incident starts from its own genesis value, so an event or a whole chain copied from another incident never verifies.
2. **The hash covers everything that matters:** incident, sequence, actor identity, actor kind (user / service / system), server time, client-claimed time, action, entity, metadata, device signature, and previous hash. Changing any one of them changes the hash.
3. **Server time is the trusted clock.** `server_ts` is SpacetimeDB's `ctx.timestamp`; the client's clock is stored separately and never trusted. A gap over 2 minutes is reported as a `CLOCK_SKEW` warning: not proof of tampering, but a forensic lead (wrong clock, a replayed request, a VM snapshot).
4. **Same transaction.** `appendEvent()` runs inside the reducer that made the change. SpacetimeDB reducers are atomic, so the change and its event commit together or not at all.
5. **The chain head.** A private `audit_head` row per incident records the latest `seq` and hash. Appending takes one lookup instead of a scan, and the verifier uses the head to catch a deleted tail.
6. **Witness anchors.** Anyone who has seen the log can keep a `(seq, hash)` pair: a responder's browser, a printed briefing, a message sent outside the system. If the chain is later rewritten, those saved hashes no longer match. This is the only defence against a full rewrite, so the UI should save the latest head on each client and check it again on reconnect.
7. **Canonical encoding.** Hashed fields are written as one JSON array of strings in a fixed order (`CRAUDIT-v1`). JavaScript and Python produce byte-identical text; tests cover accents, emoji, Chinese, control characters, quotes and line separators.
8. **Audit hygiene.** `appendEvent()` refuses to write anything that would damage the evidence: unknown actions, ids over 128 characters, metadata over 2 KB, malformed Unicode, and metadata keys that look like credentials (`password`, `token`, `totp`, `api_key`…). Logging a secret would hand it to every reader of the log.

Hashing uses SHA-256 from `@noble/hashes` (audited, no dependencies), because the SpacetimeDB module runtime has no built-in crypto. This is a standard primitive, not custom cryptography.

## Files

| Path | What it is |
| --- | --- |
| `spacetimedb/src/audit/chain.ts` | Pure rules: canonical encoding, hashing, verification, export. No SDK imports. |
| `spacetimedb/src/audit/append.ts` | `appendEvent()`, the helper every reducer calls |
| `spacetimedb/src/audit/tables.ts` | Private `audit_event` and `audit_head` tables |
| `spacetimedb/src/audit/actions.ts` | Allowed action names (from the brief, section 9) |
| `examples/reference-module.ts` | Reference integration for B: bootstrap, admission, chat, member-only view. Typechecked against SpacetimeDB 2.14.1 |
| `tools/verify_audit.py` | Independent verifier, Python standard library only |
| `tools/tamper_audit.py` | Attack simulator for demos (edits a JSON file only) |
| `tools/make_demo_chain.ts` | Builds the synthetic Northstar Retail chain through the real `appendEvent()` |
| `tests/audit/` | 30 tests: attacks, hygiene, speed, TypeScript-to-Python agreement |

## Demo data

The demo chain uses the same incident (`'northstar'`), people (Morgan Patel as commander, Sam Rivera as reviewer, and Nora as the service), record ids (E-002, D-001, P-001, B-001, S-1…) and times as the frontend fixture in `src/data/fixtures.ts`, so the Audit page and the Workspace tell one story. `docs/sim/clean-room-audit-simulator.html` still uses its own older sample data.

## Integration contract with B

B adds the two tables to the schema and calls `appendEvent()` at the end of every reducer that changes state:

```ts
const spacetimedb = schema({ /* B's tables */, audit_event: auditEvent, audit_head: auditHead });

export const update_scope_item = spacetimedb.reducer({ /* params */ }, (ctx, args) => {
  // 1. identity, membership, role checks (default deny)
  // 2. the change
  appendEvent(ctx, {
    incidentId: args.incident_id,
    action: 'SCOPE_ITEM_UPDATED',
    entityType: 'scope_item',
    entityId: args.id,
    metadata: { encryption: args.encryption_status, exfiltration: args.exfiltration_status },
    clientTsMicros: args.client_ts_micros, // optional: lets us flag clock skew
  });
});
```

Rules for B:

- Log **what happened and to what**, not the content. For chat, log the message id and length; the text stays in the message table.
- Incident ids are text and follow the backend's rule (1-64 of `a-z`, `0-9`, `-`), for example `'northstar'`. `appendEvent()` rejects anything else.
- Platform events (bootstrap, admin grants, identity config) use `PLATFORM_INCIDENT` (`'_platform'`). The underscore can't appear in a real incident id, so the two never collide.
- The triage agent's reducers pass `actorKind: 'service'`. Events written by the module itself are marked `system` automatically.
- **Denials roll back.** If a reducer throws, its audit event is rolled back too. To keep a record of a denied attempt by a *member* (for example, a revoked user trying to edit), log `ACCESS_DENIED` and `return` instead of throwing. Don't do this for outsiders: anyone could fill the log with junk entries.
- Clients read the log only through the member-scoped view (`my_audit_events` in the reference module). Both tables stay private.

## Verify it yourself

```bash
npm install
npm run typecheck             # module + reference integration against the real SDK
npm run test:audit            # 30 tests
npm run demo:chain            # writes demo-data/audit_demo_export.json (21 events)
python3 tools/verify_audit.py demo-data/audit_demo_export.json
```

Exit codes: `0` intact, `1` tampering detected, `2` unreadable input. An unreadable file is never reported as intact.

## Demo script (about 60 seconds)

1. "Every action in Clean Room is written to a hash-chained log in the same transaction as the action itself."
2. Run the verifier on the live export: **INTACT**, 21 events. It also flags one `CLOCK_SKEW` at seq 12: Sam Rivera's laptop clock is 9 minutes fast, on the same event where his attempt to approve D-001 was denied. "That's a lead, not proof."
3. "The attacker has database access and wants to hide their Sunday 03:12 login on the backup account (evidence E-007)." Run `tamper_audit.py … edit --seq 20`, then verify again: **TAMPERING DETECTED at seq 20**.
4. "A smarter attacker re-hashes the whole chain." Run `rewrite`: the chain looks clean, but a responder's saved anchor no longer matches: **ANCHOR_MISMATCH**.
5. "We claim tamper-evident, not tamper-proof, and we show exactly where the limit is."

## Measured

| Measure | Result | Notes |
| --- | --- | --- |
| Tests | 30 / 30 pass | `npm run test:audit` |
| TypeScript and Python agree | All attacks + Unicode cases | Cross-language test suite |
| Append cost | ≈ 50 µs per event | Node 22 on the build machine. Must be re-measured in the SpacetimeDB runtime |
| Full verify | ≈ 190 ms for 5,000 events | TypeScript verifier |

## Limits (say these out loud)

- **Not tamper-proof.** A database administrator can change rows; we detect changes, we don't prevent them.
- **Full rewrite needs a witness.** Without a saved anchor, a careful attacker who re-hashes everything produces a self-consistent chain. Tests prove both halves of this.
- **A hash proves bytes, not truth.** An authorised user can still log a false observation. The chain proves *who said what and when*, not that it was right.
- **A compromised device can still act as its user.** Device signatures (P2) prove which key signed, not that the device was clean.
- **Server time is SpacetimeDB's clock.** We trust the host for time.
- **Not legal chain of custody.** It supports one; it doesn't certify one.

## Open items

- [ ] **Gate 1 live check:** publish with `spacetime publish`; confirm `@noble/hashes` bundles into the module, `appendEvent()` commits and rolls back with its reducer, the view hides other incidents, and re-measure append cost in the real runtime.
- [ ] Export from a live module: a "Download audit export" button (frontend, A) that calls `exportChain()` on the subscribed rows.
- [ ] Anchor saving on each client plus a reconnect check (A + Cameron).
- [ ] Device signatures (P2): `client_sig` is already in the hash, so adding it later needs no schema change.
- [ ] Ask Winstead whether tamper-evident auditing counts toward the security score.
