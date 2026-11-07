# Design and visual QA

Audience: stressed incident commanders, analysts, and reviewers. Primary task: understand a decision's reasoning, inspect source trust, and confirm a bounded human review without losing approval history.

Chosen thesis: quiet editorial response room. One direction was developed, per the user request to avoid lengthy exploration. The built-in image generator produced `design-concept.png`: dark teal rail, neutral surface, serif decision headings, sans-serif body, three-column decision/evidence/review layout, amber source concerns. No bitmap is used as application UI. Generated prompt requested Clean Room, all four screen labels, Northstar incident, selected restoration decision, backup excerpt, synthetic proposal and impact button, with no decorative imagery.

Tokens: surface #f5f6f5, white content, ink #1c3031, teal #24645b, dark rail #103333, muted #617173, amber semantic #83551b on #fcf1df; 4–7px corners, thin dividing rules, Georgia headings and Aptos/Segoe UI/system body. Main evidence/rationale body is 14px; proposal text 13px; utilities 10–12px. No decorative motion. Reduced motion disables transitions. Lucide outline icons use consistent sizes/currentColor. No raster asset overlays or gradients.

Loading: explicit opening message. Empty: no linked evidence or pending review. Error: inline failure with retry/action message. Submitting: disabled action and recording label. Success: live-region fixture notice and updated dependency states. Denied/revoked/live reconnect/analysis states await integration; they are not simulated as working security or AI.

## Fidelity ledger

Compared native 1536×1024 concept with browser at 1536×1024, plus full-page captures and 390×844 mobile, using `view_image` on concept and renders.

| Point | Concept / rendered evidence | Resolution |
| --- | --- | --- |
| Composition | Dark rail, neutral work surface, list/detail/review columns | Preserved. Unified bordered workspace replaces separate floating panels to reduce visual noise. |
| Typography | Serif section/decision titles with sans body | Preserved. Increased rationale to 14px and proposal text to 13px after initial inspection; brand wrapping fixed with measured single-line treatment. |
| Palette | Teal navigation/action, amber trust concern, pale neutral background | Preserved semantic palette. Flat surfaces replace generated texture/lighting. |
| Copy | Four nav labels, Northstar Retail, decision titles, backup quote, Preview impact | Preserved core copy; deliberate additions: commander/persona, UTC, source reason, explicit no-AI label, evidence register and fixture footer to satisfy brief and truthful status. |
| Density | Three decisions, one receipt and one proposal | Preserved records; added owner/version/provisional history fields. Longer rationale and evidence register extend below first viewport. Intentional readable scroll rather than shrinking content. |
| Icons/assets | Outline nav and trust glyphs; illustrated C mark in concept | Consistent Lucide outline family; Layers2 brand mark is a deliberate code-native substitution. No stock or generated imagery shipped in product UI. |
| Controls | Concept includes New decision and dropdown-like header | Omitted unsupported creation control and removed inert incident chevron. All remaining actions have implemented behavior. |
| Mobile | Concept desktop-only | Rail becomes wrapping navigation, list/detail/review stack, scope table scrolls within its container. All four views have no document overflow; preview and confirmation work. |

Above-fold copy diff is accounted for by the explicit additions/omissions above. The implementation was visually verified against the selected direction, with these intentional adaptations; it is not a pixel-identical copy of generated art. No observed clipped content, overlapping controls, or outstanding accidental wrapping remains. Browser interaction and fidelity checks are separate; both passed for the tested fixture flow.

## Connected workspace redesign — 2026-11-07

This section supersedes the sidebar/page composition above. User requested an implemented connected workspace with progressive disclosure, prominent semantic states, preserved selection, and a complete review journey.

Considered three compositions briefly: a chronological incident ledger (strong chronology, weaker dependency focus), horizontal workflow swimlanes (clear sequence, too much panning on narrow screens), and a selected-change workspace (chosen: one context from evidence to next action). Built-in Image Gen reference: `docs/workspace-redesign-concept.png`. No generated imagery is shipped as interactive UI. Existing code-native Lucide brand/icon family is retained.

Design thesis: a calm, change-led room. Pine typography and a neutral green-white surface anchor one primary contextual panel. A compact sticky header retains incident, investigation/severity, no-live-connection state, fixture persona, and access to Administration. Three top navigation controls: Workspace, Scope, Communications. A short change stream is content selection, not a permanent navigation sidebar. Selected change/decision, disclosures, chat draft, and per-view scroll position survive view switches in memory.

Reading order: What changed → Why it matters → What to do next. Evidence, assumption, and decision are linked visually by directional connectors. A cited excerpt remains next to the dependency; original text, source context, event/recorded times, rationale, original approval, briefing, and history expand on demand. Preview and confirmation expand inline. Confirmation reveals the open verification task and owner without leaving the workspace. Dismissal records a reason and preserves approval/briefing state. No task-resolution or membership control is simulated.

Tokens: canvas #f5f7f4, white panel/header, ink #183c35, accent #285c4a, rule #dce3db. Georgia display headings, existing Aptos/Segoe UI/system sans body. Main summary/body 14–15px; evidence quote 18px; semantic tags 12px with 7px/10px padding, urgent focus tag 14px with 10px/13px padding and accent border. Metadata remains quiet. Needs review amber, Disputed muted red, Corroborated green, Unknown slate, Outdated purple. All five label/background contrast ratios measured 5.94–6.39:1. Status spans have labels and icons; outlined filters use pressed-state buttons, separate grouping, and counts.

Motion: 180ms small contextual reveal and 160ms control/chevron transitions. Focus follows selected context, full report, preview, cancel, confirmation, and return-to-changes. Administration dialog wraps Tab/Shift+Tab, closes on Escape, and restores its trigger. Reduced-motion media query disables animations/transitions; programmatic scrolling uses auto instead of smooth. Header stays visible while scrolling; view restoration runs after the target DOM is committed.

Loading/error/retry retained. Empty change filter and unsupported draft have honest states. Submitting disables mutation controls; errors remain adjacent to the action. Source review never changes evidence standing. Live authentication/sync/AI remain explicitly unconnected; backend read gate is unchanged.

### Final visual comparison

Compared selected concept with latest desktop/mobile screenshots using `view_image`, including native 1536×1024 browser viewport and 390×844 mobile. Further responsive interaction checks: 1280, 1024, 768, 600, and 320px widths.

| Comparison | Implementation / intentional adaptation |
| --- | --- |
| Navigation | Compact top incident header, three views and quiet Administration match chosen direction; added sticky behavior to preserve incident/access context. |
| Layout | Change stream and one contextual surface; directional evidence/assumption/decision chain retained. Routine changes use open rows instead of equal-weight cards. |
| Typography | Serif focal headings/sans body preserved; restrained metadata; readable report/excerpt scale. No accidental desktop brand wrapping. |
| Palette/status | Neutral green-white canvas and pine action retained; expanded accessible semantic palette differentiates all requested states. Reported is neutral rather than implying validation. |
| Copy/evidence | Above-fold title generalized to “See what changed. Know what to do.” for unrelated changes. Generated image invented a backup-cleanliness claim; implementation preserves the actual original fixture quote and standing. These are explicit copy corrections, not incident findings. |
| Disclosure | Added original-report disclosure and an expandable decision register to preserve every existing decision/evidence item. Briefing status is shown once beside its summary. |
| Responsive | Changes become a bounded horizontal content strip; relationship chain becomes vertical, with all actions in the same context. Scope table scrolls inside a keyboard-focusable region. No document overflow at tested widths. |
| Motion/focus | Subtle transitions preserve orientation; reduced motion fully disables them. Fixed reverse-tab dialog edge case, accessible icon-only Administration name, and offscreen skip-link screenshot artifact. |

No outstanding observed clipping, overlap, or unintended wrapping in the tested screenshots. The implementation was verified against the selected visual direction with the explicit adaptations above, rather than claiming a pixel-identical copy of generated artwork.
