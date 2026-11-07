# Clean Room implementation handoff

2026-11-07. One React/Vite/TypeScript/Tailwind application in this repository. README and LICENSE are unchanged. No deployment, remote writes, purchases, or AI requests occurred.

## Run now

From `/Users/hnnong/HackUTD2026`:

```sh
export PATH="$PWD/hackathon-setup/tools/node-runtime/node_modules/node/bin:$PATH"
cd utdhack26
node --version
npm ci
npm run dev
```

Node must satisfy `^22.23.4 || ^24.22.1 || >=26.12.1`, as required by Spacetime SDK 2.14.1. Workspace runtime is 24.22.2. The original system Node 24.11.0 is insufficient for that SDK contract. Initial dependency installs emitted engine warnings under system Node; all build/test checks subsequently used 24.22.2. On another machine install a compatible Node normally; the workspace-local runtime is environment tooling, not an application dependency.

URL: http://127.0.0.1:5173/. Vite is bound to loopback. The current development server was left running for review.

The application starts in **local synthetic fixture mode**. Changes are volatile and disappear on reload. There is no authenticated user, live synchronization, message delivery to other clients, or AI invocation. The selected analyst is a fixture persona. Production build retains these labels.

## Verification commands

With compatible Node on PATH, inside `utdhack26`:

```sh
npm run build
npm test
npm run check:server
```

Official CLI installed in the parent environment (2.14.1, commit a0bf6be10a146b03acbe3f4f9ad7fe20f114988d): from `/Users/hnnong/HackUTD2026`:

```sh
hackathon-setup/tools/spacetime/spacetime --root-dir=/Users/hnnong/HackUTD2026/hackathon-setup/tools/spacetime build --module-path utdhack26/spacetimedb
hackathon-setup/tools/spacetime/spacetime --root-dir=/Users/hnnong/HackUTD2026/hackathon-setup/tools/spacetime generate --lang typescript --out-dir utdhack26/src/module_bindings --module-path utdhack26/spacetimedb
```

Use `--root-dir=...` with equals: the installed launcher mishandled the space-separated form. macOS sandbox blocked CLI system configuration access; the CLI ran with approved escalation. Neither command publishes a database.

Starter provenance: https://spacetimedb.com/templates/react-ts and its linked official Clockwork Labs repository. Actual CLI command:

```sh
hackathon-setup/tools/spacetime/spacetime --root-dir=/Users/hnnong/HackUTD2026/hackathon-setup/tools/spacetime init --template react-ts --project-path /tmp/clean-room-official-starter --local --non-interactive clean-room
```

The generated template was inspected in temporary storage, then application/configuration files were selectively copied into the existing Git root. Its README/LICENSE, public person-table sample, sample bindings, cloud publish script, and broad agent boilerplate were not copied. The temporary directory is scaffold provenance, not another maintained app. Root `src/` layout matches the actual installed template (the website also illustrates a `client/` layout). Vite 7.3.7, TypeScript 5.6.3, React 18.3.1, Tailwind 4.1.18, SDK 2.14.1; manifests pin actual versions and retain both lockfiles. npm audits reported zero vulnerabilities.

## Completed checks

- Production build and frontend TypeScript passed, including generated bindings.
- Server TypeScript and official module build passed.
- Official binding generation passed, reporting all four storage tables skipped as private.
- Five domain tests passed: linked-only propagation and history preservation; duplicate confirmation; stale versions; invalid/cross-incident references and invalid transitions; unrelated evidence control.
- Browser plugin unavailable; used preinstalled Playwright 1.65.0 and installed Chrome, with approval after the sandbox blocked browser launch.
- Actual browser command: `node /tmp/clean-room-browser-check.cjs` (temporary runner, intentionally outside source).
- Desktop 1536×1024 and mobile 390×844: correct title/content, no framework overlay, zero page/console errors, no document overflow across all four screens.
- Exercised evidence excerpt and UTC metadata; preview; cancel; confirmation with reason; retained Reported standing; decision needs review; outdated briefing; one verification task; dismissal leaving approval intact; local chat; script-like text rendered safely; keyboard focus and Escape dismissal; mobile confirmation. These are fixture interaction checks, **not** live authorization or two-client tests.
- Screenshots `/tmp/clean-room-desktop.png`, `/tmp/clean-room-mobile.png`; concept `docs/design-concept.png`. Inspected all three with `view_image` in the final visual QA pass.

## Integration boundaries / next work

1. Backend/auth lane: configure independently administered identity, verify issuer/audience on every supported read path, test outsider/cross-incident/revoked access and live subscription retraction. `myIncidents` remains gated closed; see SECURITY.md.
2. Backend/auth lane: implement structured evidence/source/decision/proposal intake reducers with server validation and audit, source-trust versioning, safe proposal refresh, dismissal and resolution. Current review reducer is authoritative but the browser has not been connected to it.
3. Integration owner: implement `IncidentData` live adapter using generated bindings, map identities/timestamps, expose denied/revoked/disconnected/submitting states, prevent mutations on lost access, and run two-browser tests. Never silently substitute fixtures for live errors.
4. AI lane: after sponsor-approved access is known, implement authenticated bounded Nemotron tool workflow; validate excerpts/IDs/versions and persist pending proposals only. No AI credentials should enter the browser.
5. Frontend lane: connect admin admission/revocation and task resolution only after authorized operations exist. Avoid role-selector simulations or optimistic security claims.

The secure shared-incident milestone is **not passed**. No frontend realism should be used as evidence that isolation/authentication/authorization works. Human lanes and contract boundaries are in OWNERSHIP.md.

## Redesign handoff — 2026-11-07

The sidebar is replaced by a compact persistent incident header and a connected workspace. Workspace → Scope → Communications preserve selection, disclosures, drafts, and per-view scroll. Administration opens a contextual access dialog. Review path: select change → excerpt/full report → assumption/decision chain → inline impact preview → reasoned confirmation or dismissal → verification task/owner. Original approval and evidence standing remain intact.

Changed application files only: `src/App.tsx`, `src/components/ui.tsx`, `src/features/Decisions.tsx`, `src/features/IncidentPages.tsx`, `src/styles.css`. Design concept and these handoff notes are additional docs changes. SHA-256 comparison against the start-of-redesign baseline verified 25 protected files unchanged, covering shared business contracts/rules/tests, backend source/config, adapters/fixtures, generated bindings, package manifests/lockfiles, main entrypoint, README, and LICENSE. Existing integration limitations in SECURITY.md still apply. No dependency install, schema migration, or deployment.

Exact checks (compatible Node 24.22.2 on PATH): `npm run build`, `npm test` (five passed), `npm run check:server`. Playwright command: `node /tmp/clean-room-redesign-check.cjs`, using preinstalled Playwright 1.65.0/Chrome because Browser plugin is unavailable. Temporary runner/artifacts stay outside source.

Browser QA passed: correct title/meaningful screen, no framework overlay, zero page/console errors; select source update/unrelated evidence/draft; original evidence and UTC times; source/assumption/decision chain; preview/cancel; required reason/confirm; retained Reported standing; Needs review decision; Outdated briefing; one open verification task and owner; reasoned dismissal preserving approval; filter empty state; safe chat text; selected item and chat draft across views; sticky header and scroll return; dialog Tab/Shift+Tab/Escape/trigger restoration; focused preview/cancel/success/return-to-changes; reduced-motion animation/transition suppression and mobile confirmation. Responsive no-document-overflow checks at 1536, 1280, 1024, 768, 600, 390, and 320px.

Sticky navigation scroll-return testing uses direct Playwright pointer clicks at control coordinates: locator `.click()` first auto-scrolls sticky controls to their original document position, changing scroll before the app receives the click. Direct pointer verification restored 200px → other view at 0px → workspace at 200px. Restoration now runs in a layout effect after panel visibility commits.

Screenshots: `/tmp/clean-room-redesign-{desktop,mobile,impact,confirmed}.png`. Compared concept and desktop/mobile screenshots with `view_image`; detailed fidelity/copy ledger in DESIGN.md. Run URL remains http://127.0.0.1:5173/. No extra dev server retained.

Next integration tasks remain unchanged: verified independent identity and SQL/subscription access/revocation matrix; structured intake/source/proposal reducers; live IncidentData adapter and two-client tests; authorized bounded Nemotron service. UI redesign does not establish those features are working.

## GitHub integration — huy-UI-Barebone

Integrated the frontend with upstream `main` at `4fbbb13` (audit-log PR #2). Audit source/tests/tools/demo data/reference module, README and LICENSE were preserved. Four add/add conflicts were reconciled: `.gitignore`, root package manifest/lock, and TypeScript configuration.

The repository now uses npm workspaces (`spacetimedb`) and one canonical root lockfile. Run `npm ci` from the repository root for both packages; the redundant module lockfile was removed. The shared Spacetime SDK stays pinned to 2.14.1 to avoid nominal type conflicts from separate SDK installations. The root retains upstream TypeScript 7.0.2; the module retains starter compiler 5.6.3 locally so the official CLI can find it. Module lib is ES2022 because the audit library uses Array.at. The module package is named `clean-room-module` to distinguish it from the app workspace.

Existing audit scripts are retained. `npm run typecheck` checks frontend plus audit/reference code through separate configs; `npm run typecheck:audit` isolates upstream coverage. `npm test` runs `test:review` (5) and `test:audit` (30). `demo:chain` and `verify:demo` remain available. Integration checks passed: typecheck, frontend build, all 35 tests, demo Python verification (expected synthetic clock-skew warning), module typecheck, official module build, and full Playwright redesign regression. The audit tsx runner requires a local IPC socket; its sandbox denial was resolved by approved escalation.

Audit hash chains remain an independently tested library/reference integration. The fixture UI is not a live audit export or witness-anchor client; the module's initial application history does not yet call the hash-chain helper. This boundary is unchanged by bringing both implementations into one repository; numeric audit incident IDs versus current string transport IDs must be reconciled by the backend/integration owners before wiring live events. Existing identity/read-gate/live-sync/AI limitations still apply.
