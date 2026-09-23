# Handoff: Governed report page revamp (Proposal A — triage queue + drawer)

Date: 2026-09-22. Author: muse-spark. Status: design + execution plan APPROVED by the user. No implementation code written yet. This document is the complete build brief for a different AI coding agent.

Rev 2 (2026-09-22, review fixes): 8 corrections patched — dual render path, red baseline, 9th mutation, created_at note, boundary-test rule, sheet width API, §1 header variants, moving HEAD. Target files unchanged since baseline 1455215; re-confirm at build start (see section 2).

## 1. What was decided

- The "Data source → Governed report" page is one very long scroll (upload form, then every package fully expanded, then full column-mapping tables, approvals, explainer). Goal: upload-led triage — the first screen answers "I uploaded, now what needs me?"
- Approved direction: **Proposal A** — compact "Needs review" queue on top, full detail per package/decision inside a side drawer, settled packages in a collapsed strip, static explainer in a popover. Alternatives B (tabs) and C (accordion) were presented and rejected.
- Strict rule from the user: **don't break any existing workflow.** Every section, button, approval gate, permission check, mutation payload, and sentence of copy survives — re-housed, never removed or reordered in meaning.

## 2. Where the work happens

- Worktree: `/home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence`, branch `staging`. Baseline at time of writing: `1455215` (on top of `b51c167`).
- Baseline `1455215` is an ancestor of staging HEAD, but HEAD keeps moving — a concurrent party lands report-reader commits (growth-intelligence/* only). At build start re-run `git log --oneline -5` and `git log --oneline 1455215..HEAD -- <target files>`; if a target file moved, re-verify every section 3 line number before building.
- Do NOT build on the main checkout (`/home/spy/Documents/ai-revenue-os`, branch `main`): its upload form is an older version without the report-type toggle flow. The screenshot the user approved against matches staging only.
- Another party is active in this worktree in unrelated files (`growth-intelligence/*`, competitors API routes, `database.types.ts`). Touch only the files listed in section 6.
- Two render paths, ONE revamp (verified by grep — the "only usage" check resolves FALSE, by design): (a) the channel page, `page.tsx:284`, with `fixedChannelId`; (b) the Integrations page via `src/components/integrations/data-sources-tab.tsx:184` (no fixed channel), reached through `integration-hub-client` from `src/app/(platform)/organizations/[organizationId]/integrations/page.tsx`. Both mount the same component, so the queue/drawer lands on both pages. URL drawer state is per-route, so `?package=` works on each page independently. The page comment ("the same governed-reports flow as the Integrations view") confirms this is intentional.
- Read `docs/collaboration/asset-library-and-studio-board.md` before starting, and append a claim entry as you go (section 11).

## 3. Current-state map (ground truth, verified 2026-09-22)

- Page: `src/app/(platform)/organizations/[organizationId]/channels/[channelId]/page.tsx` line 284 renders `<ReportPackageUpload …>` (verify with grep that this is the only usage before restructuring).
- Component: `src/components/integrations/report-package-upload.tsx`, 2033 lines, `"use client"`. Tests: `src/components/integrations/report-package-upload.test.tsx`, 33 tests, all passing.
- Page inventory inside that one component:
  - Upload card, approx. lines 1193–1449: six-column form (Business channel, Branch/outlet, Report type with known-type toggle, Declared currency, Start & end date pickers, full-width dropzone, Upload button). **Do not touch.**
  - §1 "Recent uploads", lines 1451–1697: one expanded `rounded-lg border p-3` block per package containing: title (`report_type · start to end`), meta line (kind, currency, retained-until), status `Badge` via existing `stateVariant`/`stateLabel`, action buttons (Retry / Start-or-Retry validation / Project safely-or-Retry projection — each gated by `canRetry` and status), `ReconciliationAction` rows, validation summary + per-sheet boxes + error/warning Alerts with contract-derived field names, projection counts line, projection failure detail + `CategoricalRefusalDeclaration`.
  - §1 header text is conditional: `fixedChannelId ? "1 · This channel's uploads" : "1 · Recent uploads"`. The queue title must pick the matching variant per mode.
  - §2 "Approve what the columns mean", lines 1699–1848: one block per visible contract version (Mapping vN badge, Approved/Rejected/Awaiting badge, fingerprint/digest line, "What this contract checks" sheet tables with required fields), Approve/Reject buttons + rejection-reason input gated by `canApproveContract && !decision`, then the dashed "Which upload are you mapping?" selector (`proposalPackageId` state) + `ReportContractStep` for the chosen awaiting-contract package.
  - §3 "Approve what gets recorded", lines 1849–2004: one block per projection version (Figures vN, badge, entries list, checked-against/gaps notes, digest), Approve/Reject gated by `canApproveContract && !decision`, then the dashed propose-figures box (approved-mapping selector `projectionContractVersionId`, `alreadyProposed` guard, `proposeProjection` mutation).
  - Explainer "What happens to your file", lines 2007–2029: four static bullets (Lock, ScanLine, UserCheck, Calculator icons). Copy must be preserved verbatim.
- Package statuses (`src/domain/reports/types.ts` lines 6–24): `awaiting_upload, uploaded, profiling, awaiting_contract, awaiting_approval, awaiting_validation, validating, validated, partially_validated, validation_failed, awaiting_projection, projecting, projected, partially_projected, reconciliation_required, projection_failed, failed`.
- Mutations used on this page (keep payloads identical): `upload, retry, retryValidation, requestProjection, decideContract, decideProjection, proposeProjection, resolveOverlapGroup`, PLUS a 9th: `declareLabel` inside `CategoricalRefusalDeclaration` (line 604, POST `…/report-projections/<id>/declarations` with `{outputKey, value}`). It moves with its subcomponent verbatim. Permission flags: `canUpload, canRetry, canApproveContract` (confirm exact derivation from `role` via `hasReportPermission` in-file; do not alter).
- Subcomponents and helpers to reuse verbatim (confirm exact names in-file): `ReconciliationAction, CategoricalRefusalDeclaration, ReportContractStep, stateVariant, stateLabel, safeValidationCodes, summarizeReportContract, optionalContractFieldLabelsBySheet, validationCodeContextDetail, explainReportValidationCode, summarizeReportProjection, parserLabel, contractVersionVisible, projectionVersionVisible`.
- UI primitives available with no new install: `Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose` from `@/components/ui/sheet` (SheetTitle is mandatory for accessibility); `Popover` from `@/components/ui/popover`; `Calendar` from `@/components/ui/calendar`; `ScrollArea` from `@/components/ui/scroll-area`. Icons: `lucide-react` only, with `data-icon="inline-start"` inside buttons and no sizing classes on icons in composed components.

## 4. Target design (all three sections user-approved)

- Section 1, the queue: upload card unchanged on top; below it a "Needs review" queue of compact rows (badge, `report_type · start to end`, one-line blocking reason, age, one primary button); decision rows for undecided contract/projection versions; settled packages in a collapsed one-line strip; in-progress packages as non-action rows with a spinner at the queue foot.
- Section 2, the drawer: row click opens a right-side `Sheet` with that package's full §1 detail plus its related §2/§3 version blocks; decision rows preselect mapping (`proposalPackageId`) and focus the mapping/figures block; queue stays visible behind; open state mirrored in `?package=<uuid>&focus=mapping|figures|validation`.
- Section 3, the rest: explainer bullets move verbatim into a "How it works" popover by the card title; no new queries/backend/RLS/copy changes; existing tests updated to new selectors with identical expectations plus new queue/drawer/deep-link tests; rollback is a UI-only revert.

## 5. Queue derivation rules (exact)

Queue membership is role-independent; buttons stay gated exactly as today (`canRetry`, `canApproveContract`, status checks). Tiers, top to bottom; oldest `created_at` first within a tier:

- Tier 1, failures. `failed` → reason "Upload or profiling failed", action Retry (only when `storage_object_id` present, same condition as today). `validation_failed` → "Validation failed: N error(s)" (count from `safeValidationCodes`), action Retry validation. `projection_failed` → "Projection failed", action Retry projection (detail stays in drawer).
- Tier 2, decisions. Each contract version with no entry in `contractDecisions` → "Mapping vN awaiting approval", action Review (drawer, focus mapping). Each projection version with no decision → "Figures vN awaiting approval", action Review (drawer, focus figures).
- Tier 3, mapping. `awaiting_contract` → "Needs column mapping", action Map columns (drawer, mapping preselected).
- Tier 4, next steps. `awaiting_validation` → "Contract approved — start validation", action Start validation. `validated`/`partially_validated` with `canRequestProjection` → "Validated — project the figures", action Project safely. `reconciliation_required` → "N records need review" (sum `affected_record_count`), action Review (drawer). `awaiting_approval` → reason from `stateLabel`, no primary button unless a mutation applies (read the code; do not invent one). `awaiting_projection` → "Projection starts when the rollout is enabled", no button.
- In-progress strip (not "needs review", no buttons): `awaiting_upload, uploaded, profiling, validating, projecting` → one slim row each with `Spinner` and the `stateLabel`.
- Settled strip (collapsed, one line each: title + badge + period): packages in `projected`/`partially_projected`/`validated` with zero affected records, no failure, no undecided version, and no available action for the current role. Everything else settled-looking but terminal (approved/rejected versions) is reachable inside the drawer, not on the page.
- `created_at` exists on package rows and in test fixtures, but the component never reads it today — no backend change needed for the "oldest first" sort or the age display. Fixtures reuse identical timestamps, so tier-sorting tests must set distinct `created_at` values explicitly.

## 6. Files and slices

New files (feature-folder style, explicit props, no god component):

- `src/components/integrations/report-review-queue.tsx` — props: the already-loaded snapshot view (same `view` object the page uses), permission flags, mutation callbacks, `onOpen(packageId, focus)`. Renders queue rows, in-progress strip, settled strip. No data fetching inside.
- `src/components/integrations/report-package-drawer.tsx` — props: `packageId | null`, `focus`, snapshot view, flags, callbacks, `onClose`. Renders the `Sheet` with the relocated §1 detail + related §2/§3 blocks. Filters: contract versions by `version.report_package_id === packageId`; projection versions via `contractVersions.find(v => v.id === version.report_contract_version_id)?.report_package_id === packageId`.

Changed files:

- `report-package-upload.tsx`: upload card verbatim; §1 list replaced by `<ReportReviewQueue>`; §2/§3 page sections removed (blocks move into the drawer); proposal/projection selectors become drawer-driven (`proposalPackageId` set on drawer open for mapping rows; the approved-mapping selector filters to the drawer package's approved versions); explainer block replaced by the title popover; owns the URL-param state (below).
- `report-package-upload.test.tsx` + one new test file per new component: update relocated assertions (same expectations, new selectors); add sorting/tier tests, drawer open/close/deep-link tests, settled-exclusion tests, focus-target tests.
- `report-package-upload.client-boundary.test.ts`: asserts on the component's SOURCE STRINGS (`"Retry projection"`, `latestProjection?.status === "failed"`, `failure_detail`, `"Why it stopped"`). When §1 detail moves into the drawer file, update this test to scan BOTH files (same expectations, wider source set) — do not delete assertions.
- `docs/collaboration/asset-library-and-studio-board.md`: claim entry.
- Blast radius (read-only awareness, do NOT edit): `secondary-tabs.test.tsx` and `integration-hub-client.test.tsx` mount the component via `DataSourcesTab`. They assert no governed-report copy today, but the full-directory suite catches regressions — slices must add no new failures there.

Build in three shippable slices, each ending green (typecheck + target tests + lint), one commit per slice, path-limited to the files above:

- Slice 1: drawer shell + package detail moved; queue renders package rows only (decision rows come in slice 2); drawer opens via local state (URL wiring in slice 3).
- Slice 2: decision rows + §2/§3 blocks relocated into the drawer (package-scoped filters, preselect, focus anchors with stable ids e.g. `drawer-mapping`, `drawer-figures`, `drawer-validation`); page-level §2/§3 removed.
- Slice 3: settled strip, in-progress strip, explainer popover, `?package=` deep-linking, full test updates, board entry.

## 7. Drawer and URL contract

- `SheetContent side="right"`, wide enough for mapping tables (`sm:max-w-2xl` or wider). The sheet piece has NO size variants — side variants only — so pass the width via `className`, which `SheetContent` merges with `cn()`. Do not hand-roll a drawer.
- `SheetTitle` = `report_type · start to end`; `SheetDescription` = kind/currency/retained line. Never render a Sheet without both.
- Open: queue click calls `router.push` with `?package=<id>&focus=<target>` (history entry, so the browser back button closes the drawer naturally). Close via X, overlay, or Escape clears params with `router.replace`. Unknown/malformed id ⇒ params ignored, drawer stays closed, page renders normally — never crash on a bad param.
- `useSearchParams` from `next/navigation` has NO precedent in `src/app` — verify the route's rendering mode first; if static prerendering complains, wrap the param-reading component in `<Suspense>` (this is a framework requirement, not an invention). If that proves thorny, fallback is local drawer state plus `#package=<id>` hash mirroring for shareability — ask the user before switching, do not silently downgrade.
- Mutations inside the drawer reuse the existing `invalidate()` refresh; keep the drawer OPEN on success so the operator sees the result (same as today's in-place update). Keep the single shared `rejectionReason` state (only one drawer exists at a time).
- Focus target: after open with `focus=mapping|figures|validation`, `scrollIntoView` the matching anchor block. If the anchor is absent (e.g. no mapping block for that package), open at top — never throw.

## 8. What must NOT change

- Upload form markup, validation, payload (`channelId, branchId, reportType, periodStart, periodEnd, currency, originalFilename, contentType, contentLength, idempotencyKey`), tus flow, progress UI.
- Every mutation payload and every permission gate (`canUpload, canRetry, canApproveContract` usages stay attached to the same buttons).
- Every sentence of user-facing copy (queue reasons are the only new strings; keep each under ~6 words, plain language, no jargon).
- No new dependencies, no new tables/migrations/events/exports, no RLS or API changes, no restaurant-specific concepts in core, no secrets/PII in logs.
- TypeScript strict, no `any`; shadcn pieces only (no hand-rolled drawer/popover/calendar); `cn()` for conditional classes; `gap-*` not `space-*`; semantic color tokens; domain error types, not generic exceptions, where new error paths appear (bad URL param is swallowed silently by design, section 7).

## 9. Test plan

- Update in place (same expectations, new selectors): fixed-channel box, report-type derivation + toggle, operator-reached flows, validation warnings incl. contract field names, governed form (dropzone, date pickers, currency default, drag-drop).
- New: tier sorting with a multi-status fixture; each Tier-4 action button fires its existing mutation with the package id; drawer opens with package detail on row click; `?package=` (+focus) opens the drawer on load and scrolls to the anchor; X/back/Escape close it; settled packages never appear in the queue; in-progress rows show no buttons; unknown package id renders the page normally.
- Tenant isolation: the existing role-gated tests (operator vs owner/admin button visibility) must pass UNCHANGED — that is the isolation proof, since no data-layer code moves.
- Commands (run in the staging worktree): `pnpm typecheck`, `pnpm vitest run src/components/integrations/`, `pnpm eslint` on touched files. No `supabase`/docker commands exist here; `pnpm db:test` is unrelated (no schema change — do not run it).
- Green-gate scope: gate each slice on the TARGET files (component + new files + their tests) plus typecheck plus eslint. The full-directory suite has 1 PRE-EXISTING, unrelated failure at baseline (`secondary-tabs.test.tsx` "requires at least one mapped column before uploading a CSV", fails 2/2, CSV-mapping area) — record it, do NOT fix it (out of scope, another party's area); slices must add no NEW failures to the full-directory run.
- Manual QA before handoff-back: open/close via row, X, overlay, Escape, back button; deep-link paste in a fresh tab; mapping preselect lands on the right upload; approve + reject once each on staging (reversible test data only); viewer role sees reasons without buttons.

## 10. Risks and rollback

- Test churn from relocated selectors (mitigated: same-expectation updates, run the full integrations suite per slice).
- Radix Sheet/Popover-in-Sheet focus behavior in jsdom (mitigated: the file already proves popover-in-portal testing with the calendar; follow the same `document.querySelector` patterns).
- `useSearchParams`/prerender friction (mitigated: section 7 fallback ladder, user consulted before downgrading).
- Rollback: revert the slice commits in reverse order; no migration to unwind, no data to repair.

## 11. Definition of done

- First screen after upload shows only the upload card, the needs-review queue, the in-progress strip, and the collapsed settled strip — no page-level mapping tables, approval lists, or explainer.
- Every pre-existing workflow (map, approve/reject contract, propose/approve/reject figures, retry ×3, start validation, resolve overlaps, categorical refusal declaration) reachable and byte-identical in payload and gating.
- Target suites green (36 baseline + new tests), typecheck clean, lint clean on touched files, no NEW failures in the full-directory suite (1 pre-existing unrelated failure recorded in section 9), board entry written, path-limited commits on `staging`, no push (push is the user's step).
