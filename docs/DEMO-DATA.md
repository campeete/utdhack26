# Demo data: how the Northstar dataset reaches the UI

Owner: Cameron. All data is synthetic.

## Flow

| Step | File | Who edits it |
| --- | --- | --- |
| 1. Source dataset (40 employees and service accounts, incl. fake leaked passwords and secrets) | `demo-data/people.json` | Cameron, via `demo-data/generate_people.py` |
| 2. Allow-list export (drops passwords, hashes, salts, TOTP secrets, usernames, emails) | `tools/export_people_fixture.py` | Cameron |
| 3. Generated, secret-free accounts | `src/data/northstar-accounts.ts` | Nobody; regenerate it |
| 4. Contract type | `Account` + optional `Snapshot.accounts` in `shared/contracts.ts` | Integration owner |
| 5. Fixture wiring | `src/data/fixtures.ts`: `accounts`, scope `S-4`, evidence `E-007`, source `source-credentials`, activity `A-4` | Integration owner |

Regenerate after changing the dataset:

```bash
npm run data:accounts
npm test   # shared/accounts.test.ts fails if any secret field or value reaches the frontend
```

## What shows in the UI today

- **Workspace → What changed:** `E-007` "Backup service account used by attacker". The suspected attacker login on the backup service account (Sun 2026-11-01 03:12 UTC) happened before the Monday backup, which is why the recovery source is under review.
- **Scope:** "Employee and service accounts": 11 of 40 credentials in the attacker dump, 2 used by the attacker.
- **Not yet shown:** the full account list. `Snapshot.accounts` is ready for an Accounts view (frontend lane).

## Moving to live mode

`Snapshot.accounts` is optional so the server module keeps compiling. When accounts go live, the backend adds an incident-bound accounts table plus reducers that call `appendEvent()`, and the live adapter fills `accounts` from subscriptions. Same shape, so the UI does not change.
