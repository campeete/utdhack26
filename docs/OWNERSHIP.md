# Integration contract and file ownership

Established before parallel human edits, 2026-11-07. No parallel editors started by this agent.

| Lane | Exclusive files | Deliverable |
| --- | --- | --- |
| Frontend builder | `src/components/`, `src/features/`, `src/App.tsx`, `src/styles.css` | Four screens and accessible review journey |
| Backend/auth builder | `spacetimedb/` | Private records, OIDC checks, admission/revocation, reducers, authorized views |
| Integration owner (main agent until handoff) | `shared/`, `src/data/`, `src/main.tsx`, root configuration, lockfiles | Versioned contracts, fixture/live adapter boundary, generated bindings, integration checks |
| Audit log (Cameron) | `spacetimedb/src/audit/`, `tools/`, `tests/audit/`, `demo-data/`, `docs/audit-design.md` | Hash-chained `appendEvent()`, independent verifier, attack tests, demo chain. Backend reducers call `appendEvent()`; changes to the audit tables go through Cameron |
| Future AI builder | reserved `analysis-service/` (not scaffolded) | Authenticated bounded Nemotron workflow; proposals only. The agent acts only through reducers, and every reducer calls `appendEvent()` (`actorKind: 'service'`), so all agent activity is logged and it can never approve its own proposals |
| Reviewer | read only | Browser/security findings with reproduction evidence |

Humans claim one lane before editing. Changes to `shared/` require integration-owner coordination; never hand-edit `src/module_bindings/`. Generated bindings belong to the integration owner. Do not create another frontend/backend scaffold. README and LICENSE are preserved.

`shared/contracts.ts` is the conceptual transport contract, with strings for IDs/ISO UTC timestamps and numeric versions. Spacetime stores native identities/timestamps; the future adapter maps those to transport values. All records are incident-bound. No transport identity or role is proof of authorization.

`IncidentData` in `src/data/interface.ts` is replaceable. Fixture mutations are volatile, single-tab demonstrations. The live implementation must call Spacetime reducers, await subscribed state, clear data on denied/revoked access, and disable mutations while disconnected. Never silently fall back from live errors to synthetic data.

Source trust (`established`, `under_review`) is separate from evidence standing. Accepting a trust review marks linked approved decisions for review, linked briefings outdated, and creates one verification task. It preserves evidence content/standing, rationale, approval history, and operational actions. Impact is calculated from explicit links, with versions checked at confirmation. Unrelated decisions and briefings remain unchanged.
