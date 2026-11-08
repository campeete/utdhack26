# Merge handoff: preserve Huy's right-hand information workflow

Source branch: `Huy-Information-Workflow-UI` in https://github.com/campeete/utdhack26

This branch preserves the current frontend snapshot. During integration, the right-hand information workflow is the required contribution; its other layout choices can be reconciled with the teammate's design. No merge to main is authorized by this handoff.

## Paste this prompt into the integration session

```text
We are combining two UI branches into a THIRD integration branch in campeete/utdhack26.

Workflow source: origin/Huy-Information-Workflow-UI
Teammate UI source: origin/<TEAMMATE_UI_BRANCH>
Integration target: <INTEGRATION_BRANCH>

Inspect AGENTS.md, docs/OWNERSHIP.md, Git status and both branches before editing. Preserve everyone's uncommitted work. Fetch the named branches, then work only on the third integration branch. Do not merge into main, force-push, delete branches or replace the repository wholesale.

Preserve Huy's RIGHT-HAND INFORMATION WORKFLOW while integrating the teammate's agreed navigation, incident list and overall shell:

- One connected, numbered workflow: Read the update → Review the decision → Independent verification. Exactly one step expands at a time. Numbers are navigation, not a claim of completed verification.
- Step1: actual source concern/excerpt, evidence standing, source trust, report ID/time, Open full report and Continue to decision.
- Step2: recorded decision/status/owner, its supporting assumption, linked team update, suggested next verification, Request decision review and Dismiss suggestion. Suggested/model output stays distinct from human decisions.
- Request opens a confirmation dialog describing exactly which decision becomes Needs review, which team update becomes Outdated, and who receives verification. Apply changes only after reasoned confirmation through the existing adapter/server contract. Preserve validation, pending/error/retry states and entered reasons. Block closing during submission.
- On confirmation show the real assigned task/owner/status in Step3. Dismissal preserves the original decision and team update. Neither action declares evidence true/false or approves/reverses operational actions.
- Full evidence, decision reasoning/approval, suggestion provenance, team update and activity open in the supporting-records drawer, with focus restoration and keyboard scrolling. Chat remains available without losing selection.
- Keep record links contextual: evidence in Step1; decision and team update in Step2; one quiet History control. DO NOT restore the separate “Records / Evidence / Decision / Team update / Activity” toolbar or the old stack of equally prominent sections.
- Keep only the selected title above the workflow. Status/owner/report metadata belong in the relevant steps. Preserve accessible status labels, narrow-screen behavior and reduced motion. Do not prominently repeat Nemotron branding; keep provenance/source references inspectable.

Core implementation: src/features/IncidentStory.tsx, SupportingRecords.tsx and ReviewDetails.tsx. Its host/selection contract is in Decisions.tsx. Preserve needed Status/focusContext/Modal behavior in src/components/ui.tsx and the workflow, procedure, supporting-drawer, workbench-bottom and modal/status CSS in src/styles.css.

Integrate these components into the teammate's shell; do not blindly take all of Huy's App.tsx, Decisions.tsx or global CSS. Adapt callbacks/selection at the frontend boundary. If the teammate has working live data, auth or analysis, preserve it. This source branch uses synthetic/local fixtures; do not overwrite a working integration with those fixtures or claim they are live.

Do not independently edit backend schema, generated bindings, auth contracts, audit implementation or shared/data contracts. Coordinate any required changes with the documented owners.

Run build/typechecks and relevant tests. Use Playwright to verify report → decision → confirm or dismiss → assigned next action; record drawer and chat; selection/view persistence; pending/rejected request and retry; keyboard focus, mobile overflow and reduced motion. Inspect desktop/mobile screenshots. Summarize what was kept from each branch, exact checks and remaining integrations. Commit/push only the third integration branch, leaving main unchanged.
```

## Component and ownership map

| File | Preserve/integrate |
| --- | --- |
| `src/features/IncidentStory.tsx` | Right workflow state, contextual record links, confirmation and task transition. Props: `data`, `adapter`, `onUpdate`, `selection`, `headingRef`, `onOverview`. |
| `src/features/SupportingRecords.tsx` | Nonmodal evidence/decision/team-update/activity drawer; original reports, source references, provenance and focus restoration. |
| `src/features/ReviewDetails.tsx` | EvidenceReport and ReviewComposer. Shared preview validation; reason bounds; busy/error handling; optional dialog presentation and busy callback. |
| `src/components/ui.tsx` | Status semantics; focus helper; native Modal focus containment/restoration and `closeDisabled` protection. Merge alongside teammate's compatible primitives. |
| `src/features/Decisions.tsx` | Current host passes evidence/decision selection and adapter callbacks. Its left list/overview are optional shell contributions, not required to replace teammate's design. |
| `src/styles.css` | Current workflow/procedure/drawer/bottom-note styles plus required generic UI primitives. Reconcile shell/header/global styles rather than selecting the whole file wholesale. |
| `src/App.tsx`, `IncidentPages.tsx` | Current persistent chat, identity labels and shell; retain equivalent working teammate integrations. |
| `src/features/EvidenceIntake.tsx` | Clearly local draft/unavailable-analysis fallback. Prefer actual agreed evidence integration if teammate's branch has it. |

Unchanged protected boundaries: `shared/`, `spacetimedb/`, `src/data/`, `src/module_bindings/`, `src/main.tsx`, audit/tests/tools, manifests/lockfiles, README and LICENSE. Read current ownership before resolving integration conflicts.

## Verified local commands

From the repository root with a compatible Node on PATH:

```sh
npm run dev
npm run build
npm run typecheck
npm run check:server
npm test
npm run verify:demo
```

The local environment uses Node24.22.2 from the parent setup runtime. Browser QA used preinstalled Playwright/Chrome and a temporary machine-local runner (`node /tmp/clean-room-simplify-check.cjs`); that temporary runner is not part of this repository, so the integration session must use its own available browser tooling. Detailed historical checks and synthetic/live boundaries: `docs/SIMPLIFIED_WORKSPACE.md`. Documentation images are design references, not executable UI or an instruction to restore older iterations.
