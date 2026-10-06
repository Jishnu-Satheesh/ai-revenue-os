# Execution Plan — Market & Insights redesign, Phase 1 (frontend-only)

- Date: 2026-09-21, revised v2 per user directive: STRICTLY the prototype, one New research button, no Review market monitoring entry points. Track B (redesign). Phase 1 is Tier 2: closes documented visual/parity gaps inside the already-approved Sept-14 report-experience spec and Spec 022, whose section 6 demands zero unexplained differences from the prototype. No new spec file: the approved spec governs, and this plan stays within it.
- Phase 2 (backend-dependent: pause/stop/resume/archive, queued state, timeline stages, content-model fields, finding acceptance, report backlinks, history pagination, branch-pipeline fate) is explicitly out of scope here and needs an owner plus separate approval.

## Goal

- Bring the Insights & market tab to strict parity with the 13 approved mockups using only data the current APIs already return: one New research entry point, no legacy monitoring surfaces, no migration, no RLS change, no worker change.

## Impacted files and what changes in each

- `src/components/growth-intelligence/growth-intelligence-workspace.tsx`: page header gear Market monitoring button becomes the single emerald New research button dispatching the existing new-research event; Insights tab becomes full-width Market Watch first with Business insights plus data gaps below; BranchResearch block plus no-branch fallback card plus monitoring-dialog mount plus pipeline observer plus monitoring-event listener all removed.
- `src/components/growth-intelligence/market-watch-projects.tsx` (SHARED with Track A — post intent on the coordination board and wait for Track A ack before editing): Market Watch title plus approved intro copy, text-pill status filters with counts, featured report gains IN THIS REPORT panel and Project history entry, project rows gain icon tile plus status pill plus sub-caption plus drill-in arrow; section-level New research button removed so the header CTA stands alone (empty-state Start button kept, it is not a duplicate).
- `src/app/(platform)/organizations/[organizationId]/growth-intelligence/page.tsx`: old wall plus preview wrapper removed; live preview relocated beside the Market Watch section header (manager plus branch-selected only, explicit click, no auto-fetch — behavior unchanged); branch list fetch kept for the New research dialog with its option type moved to a neutral types home.
- `src/components/growth-intelligence/new-research-dialog.tsx`: numbered-circle step indicator, From-a-question-to-a-useful-report helper band with Try-an-event-brief shortcut, icon-tile competitor rows with pencil/X actions, lock icon on the privacy footer note.
- `src/components/growth-intelligence/report-reader.tsx`: icon section nav, footer gains Save-for-later (honest close, report stays in Ready list) plus Review-selection entry, new Review-selected-items dialog matching mockup 09 (per-item destination, Back to report, Accept selected), summary-finding checkboxes held disabled with an honest reason until Phase 2 wires finding acceptance.
- `src/components/growth-intelligence/research-project-row.tsx`: row restyle per mockup 01 as part of the W2 change set, drill-in opens the read-only project overview dialog.
- New read-only project overview dialog (new file beside market-watch-projects): title, location, mode, status, question, prior reports with dates, project history from the already-loaded list payload; Pause and Stop render as honestly-disabled with reasons until Phase 2 ships their endpoints (no fake controls).
- Deleted (unmounted everywhere, verified single-importer each): `market-watch.tsx` plus test, `market-monitoring-dialog.tsx` plus test, `research-progress.tsx` plus test, `research-outcomes.tsx` plus test; monitoring open-event helper plus listener removed from `query-options.ts` and workspace.
- `docs/superpowers/specs/2026-09-14-market-monitoring-report-experience.md`: no text change (it already approves this direction).
- `.superdesign/market-monitoring-experience/brief.md` line 3 and `README.md` status lines: stale not-approved wording updated to point at the Sept-14 approval (AGENTS.md section 9, docs-only).
- Tests beside each touched component (`.test.tsx` updates plus one new dialog test file).

## New or changed schemas, migrations, events, public exports

- No schema change, no migration, no RLS change, no new API routes, no worker change.
- One existing but unwired event gets its first caller: `growth-intelligence:open-new-research` via `requestNewResearchDialog`.
- One event removed as dead after unmount: the market-monitoring open event plus `requestMarketMonitoringDialog`.
- One new component export: the read-only project overview dialog; four component exports deleted with their files.

## Blast radius

- Callers: Insights tab composition plus page header CTA; Overview, Recommendations, Your actions tabs untouched but share the workspace file, so header edits keep every other tab's behavior identical.
- Sibling track: Track A is editing `market-watch-projects.tsx` for the opt-in toggle — W2 sequences after their ack per the board protocol; all other files are unclaimed by Track A.
- Consumers: single New research CTA for managers; viewers keep read-only paths with unchanged logic; Market Profile settings editing plus branch-request retry lose their only UI until Phase 2 resolves the branch pipeline (listed risk, not silent).
- Background tasks: none touched and none stopped — the monitoring sweep keeps running on existing settings, which is exactly why Phase 2 must decide the branch-pipeline fate.
- Shared UI primitives (`Dialog`, `Tabs`, buttons): not modified; feature-local overrides only, following the established footer-overlap precedent.

## Key decisions

- Strict prototype wins over soft landing: the legacy wall, branch-research card, monitoring dialog, and all three Review entry points are removed from the tab rather than demoted, per explicit user directive.
- Single CTA enforced: header New research button only, section duplicate removed, empty-state starter kept; the brief forbids duplicate equally prominent buttons.
- Live preview relocated, not deleted: it is a Sept-15 approved addition with unique live behavior, so it moves beside the Market Watch header instead of leaving with the wall.
- Adopt the mockup 09 Review-selected-items dialog instead of keeping the inline accept panel: the approved spec demands zero unexplained interaction-order differences from the prototype.
- Hold summary-finding checkboxes disabled with an honest reason in Phase 1: today they write selections the accept POST silently drops, and wiring them needs Phase 2 backend confirmation.
- Save-for-later means close plus an honest retained-report note: the report already persists in the Ready list, so no new saved state is implied or created.
- No Queued state in Phase 1: the backend deliberately does not distinguish queued from researching, and the UI must not invent the split.
- Pause and Stop ship as honestly-disabled in Phase 1 with their endpoints as Phase 2 dependencies: no fake controls, no invented APIs.

## Open assumptions

- Track A acks the shared-file edit window for W2, or W2 waits; no forced edit either way.
- The Sept-14 approved spec plus Spec 022 remain the governing approvals; no re-approval of the visual direction is needed.
- Phase 2 backend items (pause/stop/resume/archive endpoints, project-scoped stages, queued state, finding titles, competitor why-it-matters, advice next-step/category/citations, finding acceptance, accepted-item report backlinks, history pagination, branch-pipeline fate including any live schedules plus retry plus Market Profile re-homing) will get an owner and a separate Tier 3 plan; Phase 1 does not block on them.
- Fictional mockup content (Example Kitchen, National Day dates) is replaced by real org data; demonstration-only labels stay out of production.
- Mobile checkpoints at 390px plus 320px narrow-phone, following the spec's tester precedent.

## Test plan including tenant isolation

- Focused component tests per work unit: single header CTA dispatch with no section duplicate, tab order with legacy sections gone and preview relocated, featured panel and history entry, row drill-in, dialog step indicator and helper band, review dialog destinations and already-accepted outcomes, disabled-with-reason states for findings/pause/stop.
- Deletion verification: typecheck plus lint plus full suite catch stragglers; identifier grep confirms zero remaining imports of the four deleted components and the removed event.
- Tenant isolation: no new endpoints, so the isolation surface is unchanged; verify wrong-org project/report fetches still refuse, viewer role still sees read-only text with zero start/accept controls, and report plus PDF reads still authorize per organization, reusing the existing route-test patterns.
- Regression: full growth-intelligence component suite plus typecheck plus lint on touched files must stay green.
- Visual: 13 mockup checkpoints compared by overlay plus measurement (spec section 8 method), desktop 1440px, phone 390px, narrow 320px; browser pass via DevTools with no console errors.
- Manual: keyboard walk of dialogs (focus trap, restore, Escape with dirty draft), empty plus filtered-empty plus failed-refresh states, already-accepted replay, relocated preview click-to-fetch only.

## Risks and rollback

- Risk: existing recurring branch schedules keep running headless with no UI to pause, stop, retry, or edit until Phase 2 resolves the branch pipeline; mitigation is naming it here plus a Phase 2 fate item, never silent stranding.
- Risk: shared-file collision with Track A on `market-watch-projects.tsx`; mitigation is the board ack protocol plus sequencing W2 after their toggle lands.
- Risk: header-CTA and deletion churn ripples into other tabs; mitigation is confining edits to the header button plus Insights block plus running the full workspace test file.
- Risk: finding checkboxes or pause/stop read as broken while disabled; mitigation is explicit honest reason copy, never silent omission.
- Risk: visual drift from fictional mockup content; mitigation is checkpoint diffs against structure and geometry, with real data substituted.
- Risk: Phase 2 delay strands honestly-disabled controls; acceptable because every disabled control names its reason and nothing promises unwired behavior.
- Rollback: revert the Phase 1 commits; purely presentational over unchanged APIs with deletions restorable from history, so no data cleanup, no migration reversal, no worker redeploy.
