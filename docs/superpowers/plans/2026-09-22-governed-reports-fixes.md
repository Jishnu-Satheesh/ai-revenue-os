# Governed reports: CSV stall, validation copy, form redesign — implementation plan

Date: 2026-09-22. Owner: this session. Spec authority: `specs/018-governed-channel-intelligence.md`
(section 7 ingestion, 7.3 parser boundary). ADRs: 0046 (standing admission reuse key),
0028 (PDF text-only), 0008 (TanStack/shadcn policy).

## Global Constraints

- TypeScript strict. No `any`. Zod at boundaries.
- shadcn/ui primitives only for user-facing controls (`Button`, `Input`, `Select`,
  `Label`, `Badge`, `Alert`, `Card`, `Progress`, `Popover`). No bare HTML controls
  where a primitive exists. No new TanStack packages.
- Tenant isolation: every DB read filtered by `organization_id`; UI never shows
  another channel's mappings (existing `contractVersionVisible` rule stays).
- Never `git stash`. Path-limited commits only (shared tree, Growth Intelligence
  owned by this session). No `supabase start` / local DB. `pnpm db:types` cannot run;
  hand-edit `database.types.ts` only if a table changes (no table changes in this plan).
- No pushed migrations in this plan (UI + worker-pure fix only). Staging checks are
  read-only `supabase_execute_sql` SELECTs.
- Tests: `pnpm typecheck`, `pnpm lint`, task-level `vitest run <file>`.

## Verified staging facts (do not re-derive, use verbatim)

- Org: `2dda45b8-82db-4f5f-b17d-611b9bbb7846` (Al Noor Kitchen, `base_currency=AED`).
- Channel Talabat: `b4f83dd2-3035-4676-9cf3-cedc9b9e7884`.
- July XLSX `ecd4d4b5-9004-4097-ad93-eb219c429fa0` → `projected`,
  structure `606b75133c29f78d9cc3839e4099975741f995d1588a27751b59cfac58a3e599`.
- May XLSX `db939ef1-18b2-46f9-8094-ceda5d080d66` → `projected`, same structure `606b…`.
- June CSV `79f9dea7-6508-45be-8406-d653b9e41d1b` → `awaiting_contract`,
  structure `638b3200e90f0b4f07ff106f0bd364295068b99d30f43e069d7ec6fed67b9238`.
  Same 56 headers, but manifest has 5 header candidates (row 1 fieldCount 56 +
  rows 2–5 fieldCount 7 with empty `normalizedHeaders`). XLSX has 1 candidate.
- Active admission `619ddfcc-8979-4825-b392-86f37a4788b6` keys on structure `606b…`,
  channel Talabat, currency AED. June CSV cannot match by design (different fingerprint).
- Validation runs for July/May show sheet `performance` outcome `warning`,
  `warning_codes=["OPTIONAL_FIELD_MISSING"]` — no field identity stored.

## Task 1 — CSV profiler: stop data rows becoming header candidates (bug fix)

File: `src/workflows/reports/profile-report-package.ts` (`headerCandidateDigest`,
shared by CSV + XLSX). Test: `src/workflows/reports/profile-report-package.test.ts`.

- In `headerCandidateDigest`, after computing `populated`, return `null` unless every
  populated string reads as a label (reuse existing `readsAsLabels` /
  `LOOKS_NUMERIC` in same file): numeric-looking rows are data, never header candidates.
- XLSX behavior must not change (its data rows already excluded by the
  `typeof value === "string"` check — header row all-strings still passes).
- CSV with header + numeric data rows must yield exactly 1 candidate (row 1).
- Add tests: (a) CSV `"Order Date,Total Sales\n2026-08-01,89.00\n"` → 1 candidate;
  (b) full 56-col Talabat header + 2 numeric data rows → 1 candidate, fingerprint
  equals XLSX profile of same columns; (c) keep existing tests green.
- No `REPORT_STRUCTURE_VERSION` bump (XLSX digests unchanged; CSV converges to them).
- Stuck June package: no data rewrite. Operator maps it once via existing
  "Which upload are you mapping?" flow; its approval mints a second admission for
  the CSV shape and future CSVs auto-advance. Note this in the report.
- Verify: `pnpm typecheck`, `vitest run src/workflows/reports/profile-report-package.test.ts`.

## Task 2 — Validation warnings: name the field + compact warning/error box (UI only)

File: `src/components/integrations/report-package-upload.tsx` (validation display
block ~lines 1301–1366). Copy source: `src/domain/reports/validation-copy.ts`
(`explainReportValidationCode`, do not change copy). Contract source: already-loaded
`view.contractVersions` mapping documents (no new fetch).

- For each package with a `latestValidation`, resolve its contract version via
  `latestValidation.report_contract_version_id` → `view.contractVersions`.
  From `summarizeReportContract` (already imported) derive per-sheet required +
  optional field lists. Optional = fields in mapping document with `required !== true`.
- Warning/error box redesign (both `Alert`s): keep shadcn `Alert`/`AlertTitle`/
  `AlertDescription`. Warning Alert gets `className="border-warning/40 bg-warning/5"`
  + `<TriangleAlert>` icon (same pattern as existing `ReconciliationAction`).
  Error Alert keeps `variant="destructive"`.
- Each code renders as ONE compact row: `Title (CODE) — field names or sheet name —
  one-line next step`. No three stacked `<p>`s per code (this is the height fix).
  For `OPTIONAL_FIELD_MISSING` / `REQUIRED_FIELD_MISSING` /
  `REQUIRED_SOURCE_HEADER_MISSING`: append the affected sheet's optional/required
  `canonicalField (sourceHeader)` names from the contract; fallback to sheet name
  when contract unavailable. Never invent field names — only contract text.
- Sheet summary rows stay (`Sheet X · outcome`, counts).
- Tests: extend `src/components/integrations/report-package-upload.test.tsx`:
  warning Alert shows an optional field name from the mocked contract;
  box uses compact single-row layout (assert field name text present, no new snapshot).
- Verify: `pnpm typecheck`, `vitest run src/components/integrations/report-package-upload.test.tsx`.
- Deliberately no migration: validation tables store codes only by design
  (bounded evidence, never workbook content). Field identity comes from the already
  approved contract the run points at. Rationale recorded so a future Tier-3
  field-level evidence migration is a separate decision.

## Task 3 — Governed form: single-row grid + drag-drop + range picker + currency default (UI only)

File: `src/components/integrations/report-package-upload.tsx` (form ~lines 1043–1187).
Call sites: `src/app/(platform)/organizations/[organizationId]/channels/[channelId]/page.tsx`
(has `organization.base_currency`, `organization.default_timezone` via `getOrganization`);
`src/components/integrations/data-sources-tab.tsx` (add currency prop — check
`IntegrationHubSnapshot` for org currency, else accept optional prop defaulting to "AED"
with explicit fallback note).

- Layout: form grid becomes 6 columns on `lg` (`grid gap-3 lg:grid-cols-6`):
  channel, branch, report type, currency, period-range (span 2). File dropzone second
  row full width (`lg:col-span-6`). Gaps via `gap-3`, no custom CSS.
- Dropzone: `<Label htmlFor="report-file">` styled as dashed dropzone
  (`flex flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center cursor-pointer`),
  with `<UploadCloud>` icon, "Drag files here, or" + "Choose file" text, hidden
  `<Input type="file">` (accept `.csv,.xlsx,.pdf,...`, same as today). Wire
  `onDragOver` (preventDefault) + `onDrop` → `setFile`. Show selected file name +
  size. Keep 50 MiB + kind validation messages verbatim. Keep `Progress` + submit
  `Button` behavior verbatim.
- Period range: ONE field group labelled "Period" with two `Input type="date"`
  side-by-side (`grid grid-cols-2 gap-2`) bound to existing `periodStart`/`periodEnd`
  state. No new date library (no `calendar` primitive installed; `react-day-picker`
  not a dependency — adding it is out of scope for this slice). Label change
  `Period start`/`Period end` → single `Period` group with two inputs is the
  range-UX fix within installed primitives.
- Currency default: new optional prop `defaultCurrency?: string`. Channel page passes
  `organization.base_currency`. `useState` initialises from it (`useState(defaultCurrency ?? "")`
  + `useEffect` sync when prop loads). Select still allows override. Data-sources tab
  passes org currency if available else leaves manual (report why in report file).
- Fixed-channel mode (`fixedChannelId`) keeps read-only channel text; grid collapses
  gracefully (channel cell shows text, other 5 cells same row).
- Tests: extend `report-package-upload.test.tsx`: dropzone renders full-width row;
  period group has single label with two date inputs; currency select defaults to
  passed `defaultCurrency`. Keep all existing tests green.
- Verify: `pnpm typecheck`, `pnpm lint`, `vitest run src/components/integrations/report-package-upload.test.tsx`.

## Blast radius

- Task 1: future CSV fingerprints change (converge to XLSX shape); existing XLSX
  admissions unaffected. No migration. Trigger worker picks up on next deploy.
- Tasks 2–3: `report-package-upload.tsx` only + its test + two call sites (props only).
  No RLS, no RPC, no event, no worker changes.
- Tenant isolation verified by existing `contractVersionVisible` + organization-scoped
  snapshot reads; tests assert fixed-channel filtering unchanged.
