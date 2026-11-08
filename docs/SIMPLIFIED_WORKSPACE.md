# Simplified incident workspace — 2026-11-07

This iteration starts from upstream main `75116f5` (UI Changed). It keeps that dark interface and its identity contract. The earlier discarded frontend remains in the existing Git stash and was not restored.

## Design and ownership

Used creative-frontend. Considered a linear response feed, a full-screen review wizard, and a situation overview with contextual review. Selected the overview/context approach: a wizard hides incident context, while a feed mixes suggestions with confirmed findings. No new application or dependencies.

Design reference: `simplified-workspace-concept.png`. Design inventory: Current situation → Needs attention → Recent changes; Add evidence; contextual five-step review; collapsible Team chat. Slate background #0b1115, surface #111a20, border #293943, teal #45c5ad, amber suggested reviews, existing sans typography, 12–15px operational text, 28–36px primary heading, 16–28px grouping gaps. Lucide outline icons identify actions/status. No raster assets are shipped in the interface. Motion is limited to contextual transitions and disabled for reduced motion.

Frontend changes stay in App, components, features, and styles. Backend, shared contracts/rules, data adapter, authentication identity contract, generated bindings, audit code, entrypoint, package manifests/lockfiles, README and LICENSE are unchanged. No schema or security changes. No deployment.

## Working now

- Three-section incident overview derived from existing Snapshot records. Confirmed encryption and unknown exfiltration are distinct. Affected systems remain visible; data details expand.
- Prioritized suggested-review rows and assigned open actions. Contextual review preserves the selected decision/evidence while switching views.
- Source excerpts beside trust and evidence standing. Full reports, rationale/approval, briefing text, metadata, and history expand on demand. Source trust under review never declares evidence false.
- Impact preview followed by a reasoned **Flag decision for review** or **Dismiss suggestion**. Existing adapter and deterministic shared rules update local fixture decisions, briefing status, and assigned verification actions. These are human-review requests, not operational approvals.
- Persistent collapsible human chat uses the existing sendMessage adapter, retains drafts on failure, and leaves review selection intact. Desktop expanded chat reserves workspace space. No Nemotron messages are inserted into human conversation.
- Add evidence saves a clearly marked local draft, separate from Snapshot and authoritative evidence. Drafts survive panel closure and disappear on reload. Analyze evidence checks availability and reports **Analysis failed** because no authorized service exists; it sends no model request and fabricates no results. The existing pre-authored synthetic suggestion is unrelated to newly added drafts.

## Analysis integration boundary (requires team coordination)

IncidentData currently supports only load/confirm/dismiss/sendMessage. There is no evidence-save or analysis operation. Frontend-local AnalysisState names are Not analyzed / Analyzing / Suggested review / No related conflict / Analysis failed. Only Not analyzed and Analysis failed occur for local drafts today. Analyzing and the two result states must be driven by real service receipts; they are not simulated.

Required next work, coordinated through OWNERSHIP.md:

1. Backend/integration owner: authorized incident-scoped evidence/source save, immutable IDs/version/timestamps, validation and audit; return authoritative evidence before offering real analysis.
2. AI/backend owner: explicit analyze operation with authenticated job status, cancellation/error semantics, source/evidence/dependency versions, quoted source references, model provenance, and incident authorization. Persist suggestions separately from confirmed findings. A no-conflict result requires a successful job; an empty result or transport error is not no-conflict.
3. Integration owner: extend the agreed adapter contract with save/analyze/status subscription and capability/access/connection state. Clear records on revocation, prevent mutations when disconnected, and propagate server rejections. Frontend must not infer privileges from display roles.
4. Backend/auth owner: real sign-in, admission, role enforcement, session expiry/revocation, live read/subscription verification. Existing fixture identity stays marked Demo/Not authenticated; no fake login or role selector was added.
5. Backend/audit owners: task completion, live chat delivery/unread receipts, source references in structured messages, audit receipts/hashes, two-client sync. Audit hashes are explicitly unavailable in this fixture view.

## Run and checks

From `utdhack26`, use a compatible Node (installed local runtime 24.22.2):

```sh
export PATH="/Users/hnnong/HackUTD2026/hackathon-setup/tools/node-runtime/node_modules/node/bin:$PATH"
npm run dev
npm run build
npm run typecheck
npm run check:server
npm test
npm run verify:demo
node /tmp/clean-room-simplify-check.cjs
```

Existing dev server: http://127.0.0.1:5173/. Playwright uses preinstalled Playwright and local Chrome; Browser plugin/runtime is unavailable. Runner/screenshots are temporary QA artifacts outside source. Browser-injected delayed/rejected adapter responses test UI behavior only, not live backend security.

Build, frontend/audit/server typechecking, 35 existing tests, and demo-chain verification passed. Demo verification retains the expected synthetic clock-skew warning. `git diff --check` and protected-file diff checks passed.

## Visual comparison

Reference and rendered desktop/mobile screenshots inspected with view_image. Comparison points: three-section order; dark slate/teal/amber palette; compact sans type hierarchy; one amber review focal point; open timeline rows rather than metrics cards; contextual source/impact sequence; responsive navigation and reduced-motion behavior. Fixed mobile header height, 320px navigation overflow, and focus restoration after cancel/close. Source quotes intentionally retain existing report typography. Actual system names, activity times, and summaries replace illustrative concept text. Communications/Administration remain accessible; system/data details are disclosed rather than bright chips. These are intentional deviations for existing contracts and accurate fixture content. Above-fold copy uses the requested section/action labels and actual fixture values; no illustrative generated facts were implemented.

Screenshots: `/tmp/clean-room-simplify-{desktop,mobile,mobile-review,impact,confirmed,chat}.png`. Full-page captures taken during scrolling can place sticky chrome mid-image; viewport captures are used to assess actual header/chat positioning.

Final browser checks passed: draft save → explicit unavailable-analysis failure; existing synthetic suggestion → source → impact → flag → assigned next action; separate dismissal; retained reported evidence and outdated briefing; chat send and preserved selection; Tab/Enter-only review, dialog containment/Escape/focus restoration; reduced motion. Widths 320, 390, 600, 768, 1024, 1200, 1280 and 1440 were checked across overview/review/chat with no document overflow. Controlled test-only adapter delay/load failure/retry, pending/failed chat delivery and retry, and pending/rejected review and retry all passed while preserving entered text. No uncaught page errors. Native concept viewport 1487×1058 captured as `/tmp/clean-room-simplify-native.png` and inspected alongside the concept. Palette, type hierarchy, section order, focal action, spacing/container treatment, and responsive behavior were verified against the reference with the documented intentional deviations; no unresolved clipping or overflow was observed.

## Follow-up: restore selection list, simplify the information box

User clarified that the earlier left-hand selectable list was useful; the crowded information box was the problem. Restored the existing evidence/update list and default selection, rather than replacing the workspace with an overview. Right-hand information now follows only three visible sections: What changed → Why it matters → Next action. Source text remains adjacent to standing/trust; the linked decision, assumption, owner and impact are grouped together. Full reports, rationale/approval and briefings expand on demand. Incident overview (including recent changes/history and decision register) remains accessible from the list and selected-item header. Chat, local evidence intake and existing review rules remain intact.

The existing contract supplies one incident room (Northstar Retail), with three selectable updates. These are accurately called Incident updates; no extra incident rooms or cross-incident data were fabricated. Actual multi-room selection requires the team's incident-list/adapter contract. An optional clarification was presented about room versus update terminology; implementation restores the actual earlier list.

Only Decisions.tsx and styles.css changed in this follow-up. Build/typecheck, diff checks and protected-file comparisons passed. Playwright fallback passed selecting all three items, no-linked-decision case, filtering while retaining the selected context, view-switch persistence, source disclosure, confirmation/task creation, dismissal, overview, local draft/unavailable analysis, chat, keyboard activation, reduced motion and widths320/390/600/768/1024/1200/1440 without document overflow or page/console errors. Updated runner `node /tmp/clean-room-simplify-check.cjs`; previous runner saved `/tmp/clean-room-simplify-check.previous.cjs`. Desktop/mobile/chat screenshots `/tmp/clean-room-item-{desktop,mobile,chat}.png` inspected with view_image. Compared to the earlier selected-item layout: left selection restored; dark tokens/type/status treatment retained; five detail sections merged into three; action visible in the desktop viewport; mobile selection uses a horizontal scrollable list. This requested layout supersedes the overview-first design reference. No new raster design or application assets were needed for this existing-component layout correction.

## Follow-up: compact, demo-ready right-hand incident story

The left selector is unchanged in this follow-up. The right side now uses a compact story surface rather than three long stacked text sections. Dedicated `IncidentStory.tsx` owns presentation; existing evidence report and review confirmation moved intact into `ReviewDetails.tsx`. No schema, data, authorization, or business-rule changes.

Chosen design: concise signal banner → source and dependency visual → suggested response. Considered a timeline-first panel, a step-by-step wizard, and an evidence/impact split; selected the split because the source and decision can be understood together without hiding context. Reference `incident-story-concept.png` (1429×1101) is documentation only. Existing dark tokens, Lucide outline icons, consistent sans typography, restrained amber uncertainty/teal action, and reduced motion remain. Inventory: report title/source/time; compact trust summary; linked-decision/briefing counts; Source signal; Decision impact; an accessible two-node reliance/decision map; separate Nemotron review/Suggested response; expandable reports/briefings/reasoning/history. No raster UI, telemetry charts, confidence scores, risk percentages or fabricated findings.

Numbers come from explicit proposal/decision/briefing links in Snapshot. The map displays the recorded assumption and decision with its real status/owner; source trust and evidence standing remain separate. Unlinked reports display zero linked records, not an AI no-conflict result. The Nemotron region shows its synthetic provenance and disconnected state, exposes source/version references, and switches to assigned human verification after flagging. Full report, original approval, briefing text, suggestion reasoning and activity stay available on demand. The primary action is within the initial 1440×900 desktop viewport; impact/reason entry expands only on request.

Visual ledger: inspected reference plus `/tmp/clean-room-story-{desktop,mobile,chat,panel}.png` using view_image. Compared hierarchy/headings, slate/amber/teal palette, type scale, two-column source/impact composition, dependency connectors, action/provenance placement, and disclosure density. Intentional deviations: source wording remains actual fixture copy; singular status counts are compact metrics rather than repeated cards; smaller operational type and tighter grouping fit the main action without scrolling; fixed labels explicitly explain synthetic/not-connected state; left list/header retained per user. Reference is a standalone right panel; the actual panel responds to the app's max-width and chat, so reference width1429 is not the production panel width. Screenshots cover application1440 desktop and390 mobile, plus widths320/600/768/1024/1200. No unresolved clipping/overflow observed. Above-fold copy changes are the requested concise headers and actual record values; illustrative reference claims are not added to fixtures.

Checks this follow-up: build, frontend/audit typechecking, all5 existing shared review tests, protected-file diff and git diff --check passed. Updated `node /tmp/clean-room-simplify-check.cjs` verifies counts/map nodes and primary action above900px, selection and source details, confirmation→assigned task→outdated briefing, dismissal, overview, local intake/unavailable analysis, chat, keyboard activation, reduced motion and seven responsive widths. Injected browser-only delayed/rejected review verifies pending state, retained reason and successful retry. Zero page or console errors. Browser plugin unavailable; used preinstalled Playwright/Chrome. Earlier 35-test audit regression remains recorded above; audit code has not changed. Working tree remains uncommitted/unpushed; no deployment.

## Follow-up: make the decision and review request understandable

User requested less model branding, clearer briefing/decision meaning, and a more intuitive replacement for Preview impact. Targeted refinement of the existing visual system; left list and backend remain unchanged.

The panel now leads with the decision title and a short explanation of why it is being shown. What needs checking shows the source concern (including uncertainty wording from the actual source record) beside its excerpt. What we decided shows current status, owner, supporting assumption and original reasoning on demand. Briefings are presented as team updates: written incident summaries that use the decision. A separate Read team update disclosure and short explanation describe why a flagged decision makes that summary need checking.

Prominent Nemotron headings/icon/provenance repetition removed. Recommended next step is the action surface; model/human/synthetic provenance remains under Why this was suggested. The current browser still uses a synthetic pre-authored adapter, so this change does not assert that a separate running model service is disconnected or modify it. The browser fixture provenance remains accurate. Footer uses generic analysis integration wording.

Request decision review replaces Preview impact. It opens Confirm review request with explicit consequences: flag the named decision Needs review; mark the named team update Outdated; assign independent verification to the decision owner. Nothing changes until the final Flag decision for review submission. The form asks Why should this decision be checked?, keeps the reason on rejection, explains that no operational action is approved/reversed and no evidence truth is confirmed. Confirmation scrolls into view with reduced-motion support; Escape/cancel restores action-heading focus after rendering. Redundant outer action heading is hidden while the confirmation is open.

Checks: build, frontend/audit typecheck, all5 shared review tests, protected-file comparison and diff whitespace pass. Playwright passes current decision titles/counts, plain-language headings, team-update readout/outdated state, request/confirm/cancel focus, reason retention after server rejection and retry, dismissal, chat, selection, disclosures, local intake/unavailable analysis, seven responsive widths, reduced motion and zero page/console errors. `node /tmp/clean-room-simplify-check.cjs`; `--confirmation` captures the form on desktop/mobile. Screenshots `/tmp/clean-room-plain-{desktop,mobile,chat,panel,confirmation,confirmation-mobile}.png` inspected. Labels/provenance intentionally supersede the prior model-branded reference, retaining its dark palette, compact typography, counts, connected map and disclosure layout. No new imagery/dependencies. Working changes remain local/uncommitted.

## Data-Driver-inspired organization — current right-hand layout

User supplied https://github.com/Jeanpascal-Gauthier/Data-Driver.git as frontend inspiration. Inspected its source in `/tmp/clean-room-data-driver-reference`, commit `1bcc091`: WorkOrderDetails.jsx, Timeline.jsx, SplitLayout.jsx, LogsDrawer.jsx, HomePage.jsx, and design tokens. The useful pattern is a selected work item's compact header, one dominant procedure timeline, contextual actions, and supporting logs opened separately. Reference frontend/backend were not run, no third-party code/assets copied, and no reference dependencies or backend architecture adopted.

This replaces the earlier collection of source/decision/briefing/assistant sections with **one Review workflow**:

1. Read the update: actual source concern, excerpt, evidence standing/trust and one Continue action.
2. Review the decision: recorded decision and assumption, linked team update, suggested verification, request/dismiss action.
3. Independent verification: authoritative assigned task/owner/status, or an explicit no-task state.

Exactly one step is expanded. Clicking steps or Continue changes presentation only, never evidence standing, analysis state, verification completion or authorization. Numbers indicate the viewed position, not a completion percentage. No completed check appears for an open verification task. Selection and viewed step persist across view switches. Left selection list unchanged.

Supporting records (Evidence / Decision / Team update / Activity) open in a nonmodal drawer with its own scrolling region, Escape/close/focus restoration, and current-record navigation. Chat remains available while records are open. Model provenance/explanation is in the decision record. Full report/approval history and team-update text are not stacked in the main workflow. Request decision review now opens a native confirmation dialog using existing impact validation and mutations. No main-page expansion. Modal title receives focus; close/Escape is blocked while submitting; errors preserve the reason and allow retry. Confirmation automatically reveals the assigned verification step; dismissal stays on the decision review.

Files this pass: IncidentStory.tsx rewritten; new SupportingRecords.tsx; ReviewDetails.tsx adds optional dialog presentation and busy notification; components/ui.tsx adds modal title focus and pending-close protection; styles.css replaces obsolete right-panel styles with workflow/drawer styles. Shared rules, schema/auth/data adapter/bindings, audit, entrypoint, manifests/lockfiles, README/LICENSE untouched. Existing real/mocked integration boundaries unchanged.

Design reference `incident-workflow-concept.png` (1475×1067) is docs only. Chosen procedure composition over tabs or the previous all-visible split because the current action and reading order stay unambiguous. Typography, dark tokens, semantic tags and native controls remain. Inspected generated reference and desktop/mobile/source/decision/assigned/drawer/dialog screenshots with view_image. Compared header hierarchy, connected numbered timeline, exactly one active highlight, active-step copy, teal action, restrained uncertainty, supporting-record placement, density and responsive layout. Intentional differences: actual fixture text and status semantics preserved; production app has existing left/header/chat; no decorative glow/gradients; compact operational typography; procedural markers never imply unperformed verification. A standalone1475px-wide reference is wider than the right panel under the existing app max-width. Production screenshots are1440×1000 and390×844, with width tests320/600/768/1024/1200. No unresolved document overflow/clipping observed; confirmation scrolls internally on short viewports.

Exact checks passed (compatible local Node24.22.2 PATH): npm run build; npm run typecheck; npm run test:review (5); git diff --check; protected-file diff. Browser command `node /tmp/clean-room-simplify-check.cjs` passed one-open-step invariant, all3 selection cases, source full report, decision/team-update records, chat while drawer open, confirmation/dismissal and assigned owner/outdated summary, modal containment/Escape/restoration, step preservation across views, keyboard activation, seven widths, reduced motion, no page/console errors. Browser-only delayed/rejected fixture adapter tests pending close protection, retained reason, retry. Intake draft/analysis-unavailable check still passes with updated dialog focus. Browser plugin unavailable: preinstalled Playwright/Chrome fallback. Screenshots `/tmp/clean-room-workflow-{desktop,decision,records,confirmation,assigned,mobile,modal-mobile}.png`. Prior runner backed up `/tmp/clean-room-plain-check.previous.cjs`. Dev URL http://127.0.0.1:5173/. No deployment/push; changes remain uncommitted on main.

## Follow-up: incorporate the header information into the workflow

Removed the incident/decision kicker, metadata strip, duplicated Review workflow heading, and Step x of3 counter above the procedure. The right panel now has one compact selected-item title and Overview action. Report ID/time live beside the evidence tags in step1. Decision state is beside the step2 title (including when collapsed, so Needs review stays visible); owner is inside that decision's content. Verification ownership stays in step3. No information was moved into a new competing panel.

App chrome is also shorter: reduced header height/spacing/type, icon-only Administration with accessible name/tooltip, short synthetic/connection/sign-in strip. Current incident/severity/status, user's display name/role, demo and connection state remain visible. No privileges or connection statuses are inferred differently. Left list content and backend behavior unchanged.

Checks: npm run build, npm run typecheck, git diff --check and protected-file diff pass. Current Playwright walkthrough passes all prior workflow/drawer/chat/confirmation/dismissal/task/error/retry cases plus assertions that owner/status/time are absent from the workbench header and report ID is in step1; compact desktop persistent header <=105px. Step2 selection/status and view preservation, seven responsive widths, reduced motion, zero page/console errors passed. Screenshots `/tmp/clean-room-compact-{desktop,decision,records,confirmation,assigned,mobile,modal-mobile}.png` inspected. Targeted existing-system refinement; generated procedure reference retains the same workflow but its redundant upper chrome is intentionally superseded. Runner remains `node /tmp/clean-room-simplify-check.cjs`; prior runner `/tmp/clean-room-workflow-check.previous.cjs`. Dev5173 retained; local uncommitted work, no deployment/push.

## Clarification: remove the Records / Evidence / Decision / Team update / Activity row

User meant the supporting-records toolbar, not the upper header. Removed that navigation row. Evidence remains Open full report in step1; decision/suggestion record and linked team update are accessible inside step2. Activity is one quiet History control in the bottom note, with the synthetic-data disclosure. Supporting-record drawer remains available through those contextual actions. No data or feature removed.

Build and protected-file/whitespace checks pass. Updated Playwright walkthrough explicitly asserts the toolbar navigation is absent, opens History, and tests reports/team updates through their workflow steps. All prior confirmation/dismissal/task/chat/focus/error/retry/intake/responsive/reduced-motion checks pass with zero page/console errors. Screenshot `/tmp/clean-room-context-desktop.png` inspected. Additional screenshots use the same `clean-room-context-` prefix. Changes local/uncommitted; backend untouched.
