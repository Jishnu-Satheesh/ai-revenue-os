# Multi-channel Report Ingestion and Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended only when the user explicitly authorizes delegation) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualify Keeta, Noon, EatEasily/Smile, and Offline through the existing governed report pipeline and expose only shape-compatible, cited analysis beside Talabat.

**Architecture:** Preserve the existing tenant-approved contract, deterministic projection, reconciliation, and detector spine. Add exact-range points to analysis without turning them into a series, group multi-file provider evidence in governed report sets, extend the declaration language with bounded observed-shape capabilities, and turn the offline text-layer P&L matrix into ordinary monthly metrics only after explicit channel-scope attestation.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict mode, Zod, Supabase Postgres/Auth/Storage/RLS, Trigger.dev, ExcelJS, pdfjs text-layer extraction, TanStack Query, shadcn/ui, Vitest, Testing Library, pgTAP, and Playwright.

**Spec:** `docs/superpowers/specs/2026-08-29-multi-channel-report-ingestion-and-analysis-design.md`

## Global Constraints

- This is a Tier 3 program. Do not write production code or apply a migration until the user approves this spec and plan.
- Before each task, read `docs/collaboration/asset-library-and-studio-board.md`, claim every file to be edited, and wait for any existing claim to be released. In particular, do not overlap active ownership of `specs/018-governed-channel-intelligence.md`, `src/modules/analysis`, `src/components/analysis`, `src/workflows/analysis`, or migrations.
- Use Node 22 through `PATH=/home/spy/.local/node/bin:$PATH` and pnpm only.
- There is no local database. Never run `supabase start`, `supabase db reset`, Docker, or `pnpm db:types`.
- Create migration files only with `supabase migration new <descriptive-name>` after claiming the migration task. Do not pre-invent or edit an already-applied migration filename.
- Every migration is additive and forward-only, is reviewed before `pnpm db:migrations:push`, and is applied to the shared hosted staging database only by the migration owner.
- Call every new or replaced PL/pgSQL function against hosted staging at least once after apply.
- Request paths use the signed-in Supabase session. Service role is confined to fenced workers and never substitutes for member authorization.
- Every new public table enables and forces RLS, uses tenant-composite foreign keys, has indexes for RLS/FK/read predicates, and receives explicit least-privilege grants.
- Security-definer functions use `set search_path = ''`, recheck tenant/actor or worker authority, revoke `PUBLIC`, `anon`, and unauthorized role execution, and expose only the exact required grant.
- Postgres owns eligibility, claims, leases, retries, idempotency, transitions, reconciliation, current-state, and audit authority. Trigger.dev carries identifiers and calls controlled RPCs.
- Keep report contract/projection v1 immutable. New shape capabilities use a versioned discriminated document and must widen TypeScript, database allowlists, canonical digests, approval copy, validators, projectors, and completion fences together.
- Models may propose structure and narrate stored findings. They may not read/write source values, approve mappings or authority, compute money, infer offline revenue, expose PII, or execute an action.
- Do not persist or log workbook/PDF rows, cells, formulas, customer names, phone numbers, order IDs, item names, prompts, private paths, signed URLs, or business values in tests/snapshots.
- Money remains integer minor units with ISO currency. Ratios retain numerator/denominator. Absence is never zero.
- Exact-range evidence may produce an exact report-window summary only. It must not produce a trend, daily coverage claim, proration, or month split.
- Do not calculate or display contribution margin from measured report costs until the draft authority in `specs/012-channel-economics-ledger.md` is explicitly approved in a separate gate.
- Treat EatEasily and Smile as source aliases for one pilot channel unless an operator explicitly models two independent channels.
- Treat the Offline P&L as unproven channel scope. A filename is not an attestation; a negative/unknown scope decision produces `SOURCE_SCOPE_NOT_CHANNEL_SPECIFIC` and asks for POS evidence.
- Preserve unrelated dirty-worktree changes. Never use `git stash`, destructive reset/checkout, or broad formatting.
- `git push` is always the user's step.

---

## File Structure

### Governing documents

- Modify `specs/018-governed-channel-intelligence.md` after its current claim is released; merge the accepted provider matrix, shape rules, report sets, offline scope gate, and release slices.
- Create `adrs/0044-report-shapes-source-authority-and-matrix-projection.md`; record why exact totals are summaries, report sets do not override reconciliation, and matrix projection is bounded/declarative.
- Modify `specs/012-channel-economics-ledger.md` and `specs/015-metric-registry-and-normalized-metrics.md` only in the separately approved measured-cost task.
- Modify the README/context/Restaurant Pack documents named in Task 14 after behavior is implemented.

### Provider qualification and report domain

- Create `src/domain/reports/provider-library/support-manifest.ts` and its test; give every real fixture one non-value disposition.
- Modify `src/domain/reports/provider-library/types.ts`, `index.ts`, `copy.ts`, and tests for support stage, evidence shape, and report-set role metadata.
- Create `src/domain/reports/provider-library/keeta-orders-daily.ts` and `keeta-promotions-daily.ts` only after their semantics gates pass; extend the existing Noon definition for its second sheet so one workbook still matches one family.
- Create `src/domain/reports/provider-library/offline-profit-and-loss.ts` after matrix projection and scope attestation exist.
- Modify `src/domain/reports/contracts.ts`, `projection.ts`, sheet/header selection helpers, validation, projection workers, and their focused tests for v2 declarations.
- Create `src/domain/reports/report-set.ts` and `report-set.test.ts` for pure report-set contexts, roles, and transitions.

### Report application, API, and UI

- Modify `src/modules/reports/application/ports.ts`, `service.ts`, `api.ts`, and their tests for report sets, v2 proposals, and source-scope decisions.
- Modify `src/modules/reports/infrastructure/repository.ts` and tests for session-bound report-set reads/mutations and safe package snapshots.
- Create organization-scoped report-set API routes and route tests under `src/app/api/organizations/[organizationId]/report-sets/`.
- Modify `src/components/integrations/report-intake-mapping.tsx`, `report-package-upload.tsx`, and tests; create `report-set-builder.tsx` and its test.
- Modify `src/domain/access/permissions.drift.test.ts` only if the database permission catalogue changes; the preferred design reuses `report.upload` and `report.contract_approve`.

### Analysis domain, worker, and UI

- Modify `src/domain/analysis/types.ts`, `evidence.ts`, `registry.ts`, digest/copy modules, and tests for exact-range points and input/output metric declarations.
- Create `src/domain/analysis/detectors/average-transaction-value.ts` and its test.
- Modify `src/domain/analysis/detectors/revenue-window-gross.ts` and its test for the new exact-range-compatible calculation version.
- Modify every existing detector declaration mechanically from `requiredMetricKeys`/`optionalMetricKeys` to explicit input/output vocabulary without changing its arithmetic.
- Modify `src/modules/analysis/infrastructure/evidence-repository.ts`, `read-repository.ts`, application ports/read model, and tests.
- Modify `src/workflows/analysis/run-channel-analysis.ts`, `src/trigger/analysis.ts`, and tests for the expanded evidence payload and registry version.
- Modify `src/components/analysis/channel-workspace.tsx`, `operations-visuals.tsx`, formatting/copy, and tests only after their active claims are released.

### Database and verification

- Create forward migrations with `supabase migration new` for analysis registry admission, report sets/RLS/RPCs, v2 document validation/completion, and approved finance metrics.
- Create/modify focused pgTAP files under `supabase/tests/database/` for each migration slice.
- Maintain `src/lib/supabase/database.types.ts` by hand in one narrowly claimed task for every new table/RPC, and update `database.types.test.ts` when required.
- Modify `e2e/integration-hub.spec.ts` and create/extend a channel-analysis E2E file only after the server-side slices pass.

---

### Task 1: Reconcile the canonical spec and lock the fixture support manifest

**Files:**

- Modify: `specs/018-governed-channel-intelligence.md`
- Create: `adrs/0044-report-shapes-source-authority-and-matrix-projection.md`
- Create: `src/domain/reports/provider-library/support-manifest.ts`
- Create: `src/domain/reports/provider-library/support-manifest.test.ts`
- Modify: `src/domain/reports/provider-library/types.ts`
- Modify: `src/domain/reports/provider-library/index.ts`
- Modify: `src/workflows/reports/provider-library.integration.test.ts`

**Interfaces:**

- Consumes: the approved companion spec, `ProviderReportDefinition`, `PROVIDER_REPORT_DEFINITIONS`, and the private `fixtures/raw` directory.
- Produces: `PROVIDER_FIXTURE_SUPPORT`, `ProviderFixtureDisposition`, `assertProviderFixtureSupportComplete()`, and one accepted ADR extending ADRs 0027–0031 and 0036.

- [ ] **Step 1: Confirm ownership and canonical numbering**

Run: `rg -n "specs/018|adrs/0044|multi-channel" docs/collaboration/asset-library-and-studio-board.md && ls adrs | sort | tail -n 8`

Expected: the prior spec-018 claim is released or explicitly handed over, and ADR 0044 is unused. If either condition is false, stop and record the conflict on the board; do not rename or overwrite another agent's artifact silently.

- [ ] **Step 2: Write the support-manifest tests first**

Add tests with this exhaustive contract:

```ts
export type ProviderFixtureDisposition =
  | "recognized_source"
  | "guided_source"
  | "control_only"
  | "profile_only"
  | "pii_refused"
  | "empty_needs_data";

export type ProviderFixtureSupport = {
  relativePath: string;
  channelFamily: "talabat" | "keeta" | "noon" | "eateasily_smile" | "offline";
  disposition: ProviderFixtureDisposition;
  providerDefinitionKey?: string;
  reasonCode: string;
};
```

Assert every regular file under `fixtures/raw` except `README.md` appears exactly once; every `recognized_source` names one existing provider definition; `pii_refused` and `empty_needs_data` name no definition; no test serializes file values.

- [ ] **Step 3: Run the failing manifest tests**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/domain/reports/provider-library/support-manifest.test.ts src/workflows/reports/provider-library.integration.test.ts`

Expected: FAIL because `support-manifest.ts` and the exhaustive dispositions do not exist.

- [ ] **Step 4: Implement the value-free manifest and provider metadata**

Add the manifest as checked-in structural metadata. Extend `ProviderReportDefinition` with:

```ts
export type ProviderEvidenceShape =
  | "period_series"
  | "exact_range_summary"
  | "matrix_period_series";
export type ProviderQualificationStage = "provisional" | "staging_proven" | "needs_review";
export type ReportSetMemberRole = "source" | "control" | "supplementary";

export type ProviderReportDefinition = {
  key: string;
  provider: string;
  reportType: string;
  summary: string;
  draftedFrom: string;
  shape: ProviderEvidenceShape;
  qualificationStage: ProviderQualificationStage;
  defaultReportSetRole: ReportSetMemberRole;
  contract: ReportContractDocument;
  projection: ReportProjectionDocument;
};
```

Set current checked-in definitions to `provisional`; later staging tasks may advance global fixture qualification to `staging_proven`, while tenant approval remains derived only from database decisions.

- [ ] **Step 5: Reconcile the accepted design into spec 018 and write ADR 0044**

The spec amendment must remove stale statements that the provider library or operator-usable intake is merely planned, include the complete support matrix, and link ADR 0044. The ADR must explicitly state: exact totals do not become series; report-set roles do not bypass overlap reconciliation; v1 documents remain immutable; v2 matrix arithmetic is bounded add/subtract only; models have no value/authority role.

- [ ] **Step 6: Re-run focused tests and documentation checks**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/domain/reports/provider-library/support-manifest.test.ts src/workflows/reports/provider-library.integration.test.ts src/domain/reports/provider-library`

Expected: all tests pass or private-fixture cases skip only when the files are genuinely absent.

Run: `rg -n "T[D]B|T[O]DO|implement l[a]ter|all provider files are supported" specs/018-governed-channel-intelligence.md adrs/0044-report-shapes-source-authority-and-matrix-projection.md src/domain/reports/provider-library/support-manifest.ts`

Expected: no incomplete marker or over-broad support claim.

- [ ] **Step 7: Commit the design/manifest boundary**

Run: `git add specs/018-governed-channel-intelligence.md adrs/0044-report-shapes-source-authority-and-matrix-projection.md src/domain/reports/provider-library/support-manifest.ts src/domain/reports/provider-library/support-manifest.test.ts src/domain/reports/provider-library/types.ts src/domain/reports/provider-library/index.ts src/workflows/reports/provider-library.integration.test.ts && git commit -m "docs(reports): lock multi-channel support boundaries"`

Expected: one narrow commit; no source values or unrelated dirty files staged.

---

### Task 2: Make detector contracts evidence-shape aware and add AOV

**Files:**

- Modify: `src/domain/analysis/types.ts`
- Modify: `src/domain/analysis/evidence.ts`
- Modify: `src/domain/analysis/registry.ts`
- Modify: `src/domain/analysis/registry.test.ts`
- Modify: every file under `src/domain/analysis/detectors/*.ts` and its focused test only for declaration-field migration
- Create: `src/domain/analysis/detectors/average-transaction-value.ts`
- Create: `src/domain/analysis/detectors/average-transaction-value.test.ts`
- Modify: `src/domain/analysis/detectors/revenue-window-gross.ts`
- Modify: `src/domain/analysis/detectors/revenue-window-gross.test.ts`
- Modify: `src/domain/analysis/digest.ts`
- Modify: `src/domain/analysis/copy.ts`

**Interfaces:**

- Consumes: current `AnalysisSeriesPoint`, `DetectorDeclaration`, current-only reconciliation rules, `revenue.gross`, `transactions.count`, and `order.average_value` definitions.
- Produces: `AnalysisExactRangePoint`, `EvidenceShape`, detector input/output metric declarations, `commerce.average_transaction_value@1`, and `revenue.window_gross@2`.

- [ ] **Step 1: Add failing type/registry tests for the new contract**

Lock this domain shape in tests:

```ts
export type EvidenceShape = "period_grain" | "exact_range";

export type AnalysisExactRangePoint = {
  exactRangeMetricObservationId: string;
  channelId: string;
  branchId: string | null;
  metricKey: string;
  periodStart: string;
  periodEnd: string;
  periodTimezone: string;
  valueKind: "money" | "count";
  numerator: number;
  currency: string | null;
  qualityState: "complete" | "partial";
  completenessState: "complete" | "partial";
  projectionRunId: string | null;
};

export type AnalysisEvidence = {
  window: AnalysisWindow;
  points: readonly AnalysisSeriesPoint[];
  exactRangePoints: readonly AnalysisExactRangePoint[];
  incomparablePointCount: number;
  projectionRuns: readonly AnalysisProjectionRun[];
  heldEvidence: readonly AnalysisHeldEvidence[];
};
```

Change detector declarations to `acceptedEvidenceShapes`, `acceptedExactRangeQualityStates`, `inputMetricKeys`, and `outputMetricKeys`. Add `detectorEvidenceMetricKeys(detectors)` for the loader and `detectorBoundMetricKeys(detectors)` for the claim fence. Assert input keys drive evidence loading while the deduplicated union of input/output keys is bound into the analysis run.

- [ ] **Step 2: Write AOV and gross-revenue behavior tests before implementation**

Cover two period-grain inputs with identical period sets, unequal period-grain sets, two exact-range inputs with identical inclusive bounds, zero orders, missing input, mixed currency, mismatched branch, mismatched exact periods, partial evidence, held evidence, and simultaneous current series/exact evidence. Unequal series coverage and the simultaneous-shape case must refuse rather than choose or trim evidence.

Expected result shape:

```ts
{
  kind: "observation",
  code: "AVERAGE_TRANSACTION_VALUE",
  metricKey: "order.average_value",
  measurement: {
    valueKind: "ratio",
    numerator: 125_00,
    denominator: 5,
    currency: "AED"
  },
  evidence: [
    { kind: "exact_range_metric_observation", role: "component", id: "revenue-row" },
    { kind: "exact_range_metric_observation", role: "denominator", id: "orders-row" }
  ]
}
```

- [ ] **Step 3: Run the failing domain suites**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/domain/analysis/registry.test.ts src/domain/analysis/detectors/average-transaction-value.test.ts src/domain/analysis/detectors/revenue-window-gross.test.ts`

Expected: FAIL for absent exact-range types, declaration fields, detector, and gross calculation version.

- [ ] **Step 4: Implement the smallest pure evidence selectors**

Add helpers that select current comparable series or exact-range points without database knowledge. Exact-range selection must require exact inclusive-window equality and one channel/branch/timezone; no overlap or containment shortcut.

- [ ] **Step 5: Implement AOV and `revenue.window_gross@2`**

`commerce.average_transaction_value@1` reads two inputs and emits `order.average_value`; `revenue.window_gross@2` accepts either compatible period-grain revenue or one exact matching range, never both. Keep period movement/coverage detectors `period_grain` only. Migrate existing declarations mechanically and do not change their calculations.

- [ ] **Step 6: Update calculation digests and copy**

Include evidence shape, exact-range identity, input/output metric tuples, and exact quality/completeness states in canonical ordering. Add plain copy stating `Reported for the uploaded period; no daily trend is available` for exact summaries.

- [ ] **Step 7: Re-run all pure analysis tests**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/domain/analysis`

Expected: all pure detector/registry/digest/copy tests pass with unchanged expectations for existing period-grain detectors.

- [ ] **Step 8: Commit the pure analysis contract**

Run: `git add src/domain/analysis && git commit -m "feat(analysis): admit exact report summaries without trends"`

Expected: domain-only commit; no database, worker, or UI file staged.

---

### Task 3: Load exact-range evidence and carry it through the analysis worker

**Files:**

- Modify: `src/modules/analysis/infrastructure/evidence-repository.ts`
- Modify: `src/modules/analysis/infrastructure/evidence-repository.test.ts`
- Modify: `src/modules/analysis/application/ports.ts`
- Modify: `src/workflows/analysis/run-channel-analysis.ts`
- Modify: `src/workflows/analysis/run-channel-analysis.test.ts`
- Modify: `src/trigger/analysis.ts`
- Create: `src/trigger/analysis.test.ts`

**Interfaces:**

- Consumes: Task 2 `AnalysisExactRangePoint`, current `exact_range_metric_observations`, metric definitions, projection lineage, and the existing evidence row caps/batching.
- Produces: `ChannelAnalysisEvidenceLoad.exactRangePoints` and a worker payload/digest that preserves exact values as numeric strings only at the completion boundary.

- [ ] **Step 1: Write repository tests for a bounded current exact-range read**

Mock a query with these mandatory predicates: organization, requested metric-definition IDs, `reconciliation_state = current`, `superseded_by_id is null`, `period_start <= windowEnd`, `period_end >= windowStart`, optional channel, and optional branch. Assert a second organization's row and a blocked/superseded row are absent.

- [ ] **Step 2: Add tests for value and lineage mapping**

Assert money/count shape, ISO currency/null, exact inclusive dates, quality/completeness, metric key, projection run ID, and `exactRangeMetricObservationId`. Reject non-finite/unsafe integer money or counts and over-limit result sets with `ChannelAnalysisEvidenceError`; never truncate.

- [ ] **Step 3: Run the failing repository test**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/modules/analysis/infrastructure/evidence-repository.test.ts`

Expected: FAIL because only held exact-range evidence is currently loaded.

- [ ] **Step 4: Implement `loadCurrentExactRangePoints` with tenant-leading filters**

Use the existing batched metric-definition resolution rather than one query per key. Keep the exact-range row cap explicit and fail closed at the cap. Do not share the held-evidence query, because held rows and current facts have different authority.

- [ ] **Step 5: Add failing worker/Trigger tests**

Assert the worker passes `exactRangePoints` into every detector, calls `loadEvidence` with `detectorEvidenceMetricKeys`, calls `claim` with `detectorBoundMetricKeys`, emits exact-range citations unchanged, and records `needs_data` when an exact window mismatches. Assert a narration task is still dispatched only after deterministic completion.

- [ ] **Step 6: Implement the expanded worker port**

Change the load contract to:

```ts
export type ChannelAnalysisEvidenceLoad = {
  points: readonly AnalysisSeriesPoint[];
  exactRangePoints: readonly AnalysisExactRangePoint[];
  incomparablePointCount: number;
  projectionRuns: readonly AnalysisProjectionRun[];
  heldEvidence: readonly AnalysisHeldEvidence[];
};
```

Keep JSON completion fields as strings and preserve existing exact-number guards.

- [ ] **Step 7: Run repository, worker, and Trigger tests**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/modules/analysis/infrastructure/evidence-repository.test.ts src/workflows/analysis/run-channel-analysis.test.ts src/trigger/analysis.test.ts src/trigger/recommendations.test.ts`

Expected: all selected suites pass.

- [ ] **Step 8: Commit the evidence/worker slice**

Run: `git add src/modules/analysis/infrastructure/evidence-repository.ts src/modules/analysis/infrastructure/evidence-repository.test.ts src/modules/analysis/application/ports.ts src/workflows/analysis/run-channel-analysis.ts src/workflows/analysis/run-channel-analysis.test.ts src/trigger/analysis.ts src/trigger/analysis.test.ts && git commit -m "feat(analysis): load current exact-range evidence"`

Expected: the new Trigger contract test is included in the commit.

---

### Task 4: Admit the new detector registry and exact-summary completion on Postgres

**Files:**

- Create: one migration emitted by `supabase migration new admit_shape_aware_channel_analysis`
- Modify: `supabase/tests/database/governed_channel_analysis_test.sql`
- Modify: `src/lib/supabase/database.types.ts` only if the replaced RPC signature changes
- Modify: `src/domain/analysis/registry.ts`
- Modify: `src/domain/analysis/registry.test.ts`

**Interfaces:**

- Consumes: combined input/output metric keys, registry version 4, current exact-range citation support already present in `complete_channel_analysis`, and the existing lease/idempotency functions.
- Produces: `claim_channel_analysis` admission for registry version 4 and `commerce.average_transaction_value@1` / `revenue.window_gross@2` result vocabulary without weakening current-citation checks.

- [ ] **Step 1: Write failing pgTAP assertions before migration SQL**

Add assertions that registry version 4 can claim a run only when all input/output metric definitions resolve; version 3 historical runs remain readable; a money/ratio finding must cite a current ledger row; an exact-range citation from another tenant, a blocked row, or a superseded row is refused; identical replay is idempotent and a conflicting window returns `conflict`.

- [ ] **Step 2: Create the migration through the CLI**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec supabase migration new admit_shape_aware_channel_analysis`

Expected: exactly one new timestamped migration file. Claim that exact generated path on the board before editing it.

- [ ] **Step 3: Replace the fenced claim function narrowly**

Keep the existing signature if possible. Pass the union of input/output metric keys in `p_metric_keys`; change only the admitted registry version and any bounded detector-version validation required. Do not weaken channel/branch/window/timezone, current evidence, lease, safe integer, citation, or same-run fences.

- [ ] **Step 4: Review the migration before apply**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm db:migrations:list`

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm db:migrations:dry-run`

Expected: the new migration is the only pending file owned by this task, and dry-run reports no destructive operation. Obtain the board-designated migration review before apply.

- [ ] **Step 5: Apply to hosted staging and invoke replaced functions**

Run only after review: `PATH=/home/spy/.local/node/bin:$PATH pnpm db:migrations:push`

Then run focused pgTAP: `PATH=/home/spy/.local/node/bin:$PATH pnpm db:test supabase/tests/database/governed_channel_analysis_test.sql`

Expected: all assertions pass against hosted staging. Invoke `claim_channel_analysis`, `complete_channel_analysis`, and `fail_channel_analysis` once through the controlled test/reproduction path and record safe outcomes on the board.

- [ ] **Step 6: Run advisors and TypeScript agreement tests**

Run the repository's supported database-advisor command or Supabase MCP advisor through the agent that owns staging inspection. Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/domain/analysis/registry.test.ts src/lib/supabase/database.types.test.ts`

Expected: no new security/performance advisory attributable to the migration; type agreement passes.

- [ ] **Step 7: Commit the database admission slice**

Stage the exact generated migration path, pgTAP file, registry files, and types file only if changed. Commit: `git commit -m "feat(analysis): admit shape-aware detector registry"`.

Expected: applied migration is committed unchanged; no later edit to the applied file.

---

### Task 5: Present exact report summaries without trend semantics

**Files:**

- Modify: `src/modules/analysis/application/ports.ts`
- Modify: `src/modules/analysis/application/read-model.ts`
- Modify: `src/modules/analysis/application/read-model.test.ts`
- Modify: `src/modules/analysis/infrastructure/read-repository.ts`
- Modify: `src/modules/analysis/infrastructure/read-repository.test.ts`
- Modify: `src/components/analysis/channel-workspace.tsx`
- Modify: `src/components/analysis/channel-workspace.test.tsx`
- Modify: `src/components/analysis/format.ts`
- Modify: `src/domain/analysis/copy.ts`
- Modify: `src/domain/analysis/copy.test.ts`
- Modify: `src/app/(platform)/organizations/[organizationId]/channels/[channelId]/page.tsx`
- Create: `src/app/(platform)/organizations/[organizationId]/channels/[channelId]/page.test.tsx`

**Interfaces:**

- Consumes: completed findings for `WINDOW_GROSS_REVENUE` and `AVERAGE_TRANSACTION_VALUE`, exact-range citations, evidence shape, source inclusive dates, and existing channel route authorization.
- Produces: `ChannelReportSummaryView`, shape-specific workspace presentation, and no-trend/needs-data copy.

- [ ] **Step 1: Add failing read-model tests for summary presentation**

Lock this presentation union:

```ts
export type ChannelReportSummaryView =
  | { state: "not_available"; reason: string }
  | { state: "held_for_review"; reason: string; reconciliationCount: number }
  | {
      state: "reported" | "partial";
      shape: "period_grain" | "exact_range";
      periodStart: string;
      periodEnd: string;
      revenue: MoneyView | null;
      transactions: CountView | null;
      averageTransactionValue: RatioMoneyView | null;
      evidenceCount: number;
      limitations: readonly string[];
    };
```

Assert an exact-range summary carries exact dates, no trend points, no expected-day count, and copy stating it is an uploaded-period total. Assert a period-grain result retains current trend/coverage behavior.

- [ ] **Step 2: Add failing repository tests for evidence-shape reads**

Assert finding evidence maps `normalized_metric` to `period_grain` and `exact_range_metric_observation` to `exact_range`, rejects a mixed-shape summary, batches evidence IDs at the existing bound, and preserves organization/current-run filters.

- [ ] **Step 3: Run the failing read suites**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/modules/analysis/application/read-model.test.ts src/modules/analysis/infrastructure/read-repository.test.ts`

Expected: FAIL for the absent summary union and evidence-shape mapping.

- [ ] **Step 4: Implement the read model and safe formatters**

Derive only presentation state from stored findings/evidence. Format AOV by dividing the stored numerator/denominator at render time with an explicit two-minor-unit currency rule; retain the raw pair in the view for accessible method copy. Do not persist a quotient.

- [ ] **Step 5: Write failing component/page tests**

Cover:

- exact summary shows Revenue, Orders, AOV, inclusive dates, `Report summary`, and `No daily trend is available`;
- no chart/sparkline/movement language renders for exact range;
- period-grain Keeta/Talabat still renders trend-compatible chapters;
- mixed currency, mismatched dates, zero orders, no analysis, and held overlap have distinct copy;
- the route passes only data authorized through `getOrganizationContext`; and
- a context refusal starts no analysis/evidence read.

- [ ] **Step 6: Run failing UI tests**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/components/analysis/channel-workspace.test.tsx 'src/app/(platform)/organizations/[organizationId]/channels/[channelId]/page.test.tsx'`

Expected: FAIL before summary rendering and route contract exist.

- [ ] **Step 7: Implement the smallest workspace changes**

Reuse installed shadcn/ui primitives. Keep the VerdictBand/chapter rail for period-grain analysis. Render exact summary as a calm, dated evidence section with an Inspect evidence action; do not fabricate empty visualizations to match Talabat.

- [ ] **Step 8: Re-run focused analysis/UI tests**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/modules/analysis/application/read-model.test.ts src/modules/analysis/infrastructure/read-repository.test.ts src/components/analysis/channel-workspace.test.tsx 'src/app/(platform)/organizations/[organizationId]/channels/[channelId]/page.test.tsx'`

Expected: all selected tests pass.

- [ ] **Step 9: Commit the exact-summary UI slice**

Run: `git add src/modules/analysis src/components/analysis src/domain/analysis/copy.ts src/domain/analysis/copy.test.ts 'src/app/(platform)/organizations/[organizationId]/channels/[channelId]/page.tsx' 'src/app/(platform)/organizations/[organizationId]/channels/[channelId]/page.test.tsx' && git commit -m "feat(channels): show governed report-window summaries"`

Expected: no unrelated in-progress analysis redesign is staged; inspect the shared diff before commit.

---

### Task 6: Qualify the two-file Keeta core vertical slice

**Files:**

- Modify: `src/domain/reports/provider-library/keeta-billing-summary.ts`
- Modify: `src/domain/reports/provider-library/keeta-restaurant-daily.ts`
- Modify: `src/domain/reports/provider-library/copy.ts`
- Modify: `src/domain/reports/provider-library/copy.test.ts`
- Modify: `src/workflows/reports/provider-library.integration.test.ts`
- Modify: `src/domain/analysis/detectors/average-transaction-value.test.ts`
- Modify: `src/components/analysis/channel-workspace.test.tsx`
- Modify: `src/components/integrations/report-intake-mapping.test.tsx`

**Interfaces:**

- Consumes: existing `keeta.billing.summary.daily` and `keeta.restaurant.daily` definitions, period-grain projection, Task 2 AOV detector, and real private Keeta XLSX fixtures.
- Produces: staging-proven daily revenue/orders/impressions/promotion funding and a cited Keeta channel summary for a compatible branch/window.

- [ ] **Step 1: Lock combined-source behavior with synthetic detector tests**

Build a synthetic January window where billing supplies `revenue.gross` and restaurant supplies `transactions.count`. Assert AOV combines them only for identical channel/branch/day set/timezone/currency. Add a missing-day mismatch case that returns `needs_data` with `PERIOD_COVERAGE_MISMATCH` rather than dropping days, intersecting series, or reporting a partial quotient.

- [ ] **Step 2: Extend value-free real-fixture qualification assertions**

Assert each definition matches only its own real file, validates, projects every declared output, uses no exact-range output, preserves dash-as-absence, and exposes no source value in the test. The billing definition remains authoritative for revenue; the restaurant definition remains authoritative for valid orders/impressions/promotion funding.

- [ ] **Step 3: Run the focused Keeta tests**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/workflows/reports/provider-library.integration.test.ts src/domain/analysis/detectors/average-transaction-value.test.ts src/domain/reports/provider-library/copy.test.ts src/components/integrations/report-intake-mapping.test.tsx src/components/analysis/channel-workspace.test.tsx`

Expected: tests pass before staging work; any private fixture absence is reported as a skip, not as proof.

- [ ] **Step 4: Exercise the authenticated owner/admin approval path on hosted staging**

Upload the real billing and restaurant files through the existing direct-to-private-Storage flow for the same Keeta channel, branch, declared context, and their actual periods. Confirm the recognized family in the UI, inspect the plain-language mapping, and approve through the signed-in owner/admin path. Do not call an approval RPC with service role.

Expected: immutable tenant contract/projection versions bind each exact fingerprint and package moves through validation/projection without a manual JSON textarea.

- [ ] **Step 5: Verify worker and ledger evidence**

Inspect package, validation run, projection run, reconciliation state, metric counts, absent counts, and lineage using safe identifiers/counts only. Retry one completed operation with the same idempotency key and prove no duplicate current observation is created.

- [ ] **Step 6: Run a Keeta channel analysis for a compatible window**

Expected: deterministic findings include governed revenue, transaction evidence, AOV when inputs align, and existing shape-compatible observations/needs-data. Recommendation narration may succeed or fail independently; deterministic results remain visible.

- [ ] **Step 7: Perform tenant and role checks**

Use owner/admin, operator, viewer, and a second organization. Operator can upload/retry but not approve; viewer cannot mutate; the second tenant sees neither package metadata nor findings nor Storage object.

- [ ] **Step 8: Record staging proof and advance only the qualified family claims**

Update spec 018/provider support copy with safe run IDs, counts, states, and verification commands—never report values. Do not mark Keeta orders/items/promotions/PDFs supported from these two files.

- [ ] **Step 9: Commit the Keeta qualification evidence**

Run: `git add src/domain/reports/provider-library src/workflows/reports/provider-library.integration.test.ts src/domain/analysis/detectors/average-transaction-value.test.ts src/components/analysis/channel-workspace.test.tsx src/components/integrations/report-intake-mapping.test.tsx specs/018-governed-channel-intelligence.md && git commit -m "feat(reports): qualify Keeta daily channel evidence"`

Expected: real fixture bytes remain ignored and unstaged.

---

### Task 7: Qualify Noon and EatEasily/Smile exact-range summaries

**Files:**

- Modify: `src/domain/reports/provider-library/noon-sales-summary.ts`
- Modify: `src/domain/reports/provider-library/eateasily-branch-sales.ts`
- Modify: `src/domain/reports/provider-library/index.ts`
- Modify: `src/domain/reports/provider-library/copy.ts`
- Modify: `src/workflows/reports/provider-library.integration.test.ts`
- Modify: `src/components/integrations/report-intake-mapping.tsx`
- Modify: `src/components/integrations/report-intake-mapping.test.tsx`
- Modify: `src/components/analysis/channel-workspace.test.tsx`

**Interfaces:**

- Consumes: existing exact-range projection, Task 5 summary UI, the Noon `Sales data` and `Customer data` sheets, the EatEasily/Smile `Sales Report`, and declared upload context.
- Produces: one Noon workbook family covering its sales/customer sheets and emitting sales/orders/menu-open/add-to-cart/placed-order summaries, plus EatEasily/Smile sales/orders summaries; all remain exact-range and explicitly non-trend.

- [ ] **Step 1: Add Noon customer-sheet tests before extending the definition**

Map only provider event counts:

```ts
const noonCustomerOutputs = [
  ["menu_views", "menu_opens", "listing.menu_views"],
  ["cart_additions", "add_to_cart", "listing.cart_additions"],
  ["placed_orders", "ordered", "listing.placed_orders"],
] as const;
```

Do not map `add_to_cart_rate` or `checkout_completion_rate`; assert derived funnel outcomes use the three count observations. The provider's `ordered` definition includes cancelled/rejected orders, so it must not replace sales-sheet `successful_orders` as `transactions.count`.

- [ ] **Step 2: Add source-context approval-copy tests**

For Noon and Smile, assert mapping approval states that period, branch, timezone, and currency come from declared upload context because the workbook does not prove them. The owner/admin must confirm that context; recognition alone is insufficient.

- [ ] **Step 3: Run failing provider/UI tests**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/workflows/reports/provider-library.integration.test.ts src/domain/reports/provider-library/match.test.ts src/components/integrations/report-intake-mapping.test.tsx src/components/analysis/channel-workspace.test.tsx`

Expected: FAIL because the current Noon definition does not bind/project the customer sheet and the context-confirmation copy is absent.

- [ ] **Step 4: Extend the single Noon definition and summary copy**

Add the customer sheet to `noonSalesSummary` so structural matching still returns exactly one family for the workbook. Keep all Noon outputs `exact_range`. Keep EatEasily's totals-row control and exact range unchanged. Do not add a date column or create a daily grain from filenames/descriptive rows.

- [ ] **Step 5: Re-run focused tests**

Run the Step 3 command again.

Expected: all tests pass and every real definition still matches only its own fixture.

- [ ] **Step 6: Prove Noon on hosted staging**

Upload, confirm declared context, approve sales/customer mappings, validate/project/reconcile, run the exact declared-window analysis, and verify Revenue/Orders/AOV/Funnel summary with no trend. A narrower month selection must return `EXACT_RANGE_WINDOW_MISMATCH`, not a prorated figure.

- [ ] **Step 7: Prove EatEasily/Smile on hosted staging**

Confirm one organization channel with both source aliases, upload the branch summary, approve the exact context/totals row, validate/project/reconcile, and run the exact declared-window analysis. Verify the total row is set aside and used only as a control.

- [ ] **Step 8: Verify isolation, retry, and drift**

For each family, prove exact duplicate replay is idempotent, a changed fingerprint stops for approval, an overlapping correction enters reconciliation, and a second tenant cannot read it.

- [ ] **Step 9: Commit qualified exact-summary families**

Run: `git add src/domain/reports/provider-library src/workflows/reports/provider-library.integration.test.ts src/components/integrations/report-intake-mapping.tsx src/components/integrations/report-intake-mapping.test.tsx src/components/analysis/channel-workspace.test.tsx specs/018-governed-channel-intelligence.md && git commit -m "feat(reports): qualify Noon and Smile report summaries"`

Expected: no claim of daily trends or organization-wide provider support.

---

### Task 8: Add governed report sets and member authority

**Files:**

- Create: `src/domain/reports/report-set.ts`
- Create: `src/domain/reports/report-set.test.ts`
- Create: one migration emitted by `supabase migration new governed_report_sets`
- Create: `supabase/tests/database/governed_report_sets_test.sql`
- Modify: `src/modules/reports/application/ports.ts`
- Modify: `src/modules/reports/application/service.ts`
- Modify: `src/modules/reports/application/api.test.ts`
- Modify: `src/modules/reports/infrastructure/repository.ts`
- Modify: `src/modules/reports/infrastructure/repository.test.ts`
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `src/lib/supabase/database.types.test.ts`
- Create: `src/app/api/organizations/[organizationId]/report-sets/route.ts`
- Create: `src/app/api/organizations/[organizationId]/report-sets/route.test.ts`
- Create: `src/app/api/organizations/[organizationId]/report-sets/[reportSetId]/route.ts`
- Create: `src/app/api/organizations/[organizationId]/report-sets/[reportSetId]/route.test.ts`
- Create: `src/app/api/organizations/[organizationId]/report-sets/[reportSetId]/members/route.ts`
- Create: `src/app/api/organizations/[organizationId]/report-sets/[reportSetId]/members/route.test.ts`
- Create: `src/app/api/organizations/[organizationId]/report-sets/[reportSetId]/member-decisions/route.ts`
- Create: `src/app/api/organizations/[organizationId]/report-sets/[reportSetId]/member-decisions/route.test.ts`

**Interfaces:**

- Consumes: organization/channel/branch/package identity, `report.read`, `report.upload`, `report.contract_approve`, existing request idempotency patterns, and append-only audit events.
- Produces: `integration_report_sets`, `integration_report_set_members`, typed domain outcomes, session-bound repository methods, and organization-scoped APIs.

- [ ] **Step 1: Write pure domain tests first**

Lock these schemas:

```ts
export const reportSetMemberRoleSchema = z.enum(["source", "control", "supplementary"]);

export const reportSetContextSchema = z
  .object({
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    branchId: z.string().uuid(),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodTimezone: z.string().min(1).max(100),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();

export type ReportSetMutationOutcome =
  | { outcome: "created" | "member_added" | "role_decided"; reportSetId: string }
  | { outcome: "replayed"; reportSetId: string }
  | { outcome: "conflict" | "not_found" | "not_allowed" | "context_mismatch" };
```

Assert package/set contexts must match exactly and member role decisions are immutable; an identical answer replays and an opposite answer conflicts.

- [ ] **Step 2: Write pgTAP before migration SQL**

Cover table constraints, composite tenant FKs, FK indexes, forced RLS, explicit grants, viewer reads, operator creation/member proposal, owner/admin role decisions, viewer/operator approval refusal, service-role refusal on human decision functions, direct-RPC misuse, cross-tenant linkage refusal, idempotent replay, conflict, audit events, and no hard delete after approval.

- [ ] **Step 3: Create and draft the migration**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec supabase migration new governed_report_sets`

Create the two tables with UUID primary keys consistent with the repository and tenant-leading indexes. A member stores `proposed_role`, `decision` (`pending`, `approved`, or `rejected`), `approved_role`, `decided_by`, and `decided_at`; the fenced decision RPC permits only the one-way pending-to-terminal transition, makes identical replay safe, and returns conflict for an opposite or later choice. No third table or mutable role history is introduced.

- [ ] **Step 4: Add failing repository/API tests**

Assert every repository query begins with `organization_id`, API routes derive the effective organization from authenticated context, request bodies are Zod-strict, mutation success follows the domain outcome, and safe public errors reveal no existence across tenants.

- [ ] **Step 5: Run pure/repository/route tests**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/domain/reports/report-set.test.ts src/modules/reports/application/api.test.ts src/modules/reports/infrastructure/repository.test.ts 'src/app/api/organizations/[organizationId]/report-sets/**/*.test.ts'`

Expected: FAIL before implementation; if the shell does not expand `**`, pass the four route-test paths explicitly.

- [ ] **Step 6: Implement service, repository, and routes**

Reuse current report authorization and safe-error helpers. A control member cannot propose a projection that duplicates a source output; a supplementary member may project distinct metrics. Existing ledger reconciliation remains the final duplicate fence.

- [ ] **Step 7: Review, dry-run, apply, and test hosted staging**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm db:migrations:dry-run`

After migration review, run: `PATH=/home/spy/.local/node/bin:$PATH pnpm db:migrations:push`

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm db:test supabase/tests/database/governed_report_sets_test.sql`

Expected: all pgTAP passes. Invoke every new function once using owner/admin, operator, viewer, service role where applicable, and a second tenant.

- [ ] **Step 8: Run TypeScript and focused agreement tests**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/domain/reports/report-set.test.ts src/modules/reports/application/api.test.ts src/modules/reports/infrastructure/repository.test.ts src/lib/supabase/database.types.test.ts 'src/app/api/organizations/[organizationId]/report-sets'`

Expected: all pass; direct non-test directories must be replaced with explicit tests if Vitest rejects them.

- [ ] **Step 9: Commit the report-set control plane**

Commit only the exact generated migration, pgTAP, report-set domain/application/repository/routes, and types in: `git commit -m "feat(reports): govern multi-file report sets"`.

---

### Task 9: Build the report-set operator flow

**Files:**

- Create: `src/components/integrations/report-set-builder.tsx`
- Create: `src/components/integrations/report-set-builder.test.tsx`
- Modify: `src/components/integrations/report-package-upload.tsx`
- Modify: `src/components/integrations/report-package-upload.test.tsx`
- Modify: `src/components/integrations/report-package-upload.client-boundary.test.ts`
- Modify: `src/components/integrations/report-intake-mapping.tsx`
- Modify: `src/components/integrations/report-intake-mapping.test.tsx`
- Modify: `src/components/integrations/integration-hub-client.tsx`
- Modify: `src/components/integrations/integration-hub-client.test.tsx`

**Interfaces:**

- Consumes: Task 8 APIs, safe report package summaries, member roles, effective permissions, and current TanStack Query mutation patterns.
- Produces: a plain-language flow to create/select a set, add packages, propose source/control/supplementary roles, and show immutable approval/reconciliation receipts.

- [ ] **Step 1: Write failing component tests for the operator mental model**

Cover creating `Keeta · Jan 2026 · Branch A`, adding Billing as source, Restaurant as supplementary, Invoice as control, exact context mismatch refusal, operator awaiting-approval copy, owner/admin role decision, viewer read-only state, replay/conflict responses, and no raw identifiers/JSON presented as the primary interface.

- [ ] **Step 2: Add client-boundary tests**

Assert the browser sends IDs/context/role/idempotency only; no workbook values or signed URLs enter a mutation body. Assert a `conflict` response never shows a success toast.

- [ ] **Step 3: Run failing UI tests**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/components/integrations/report-set-builder.test.tsx src/components/integrations/report-package-upload.test.tsx src/components/integrations/report-package-upload.client-boundary.test.ts src/components/integrations/report-intake-mapping.test.tsx src/components/integrations/integration-hub-client.test.tsx`

Expected: FAIL because the set builder and flow do not exist.

- [ ] **Step 4: Implement with installed shadcn/ui and TanStack Query**

Use Card, Select, Badge, Alert, Button, Dialog/Sheet, and accessible Field compositions. Show report family, declared period, branch, currency, lifecycle, member role, and next action. Keep contract/projection IDs in an evidence receipt, not the main decision copy.

- [ ] **Step 5: Re-run focused UI tests and client boundary**

Run the Step 3 command again.

Expected: all pass; no bare interactive HTML regression and no server-only import reaches a client component.

- [ ] **Step 6: Commit the report-set experience**

Run: `git add src/components/integrations && git commit -m "feat(integrations): guide multi-file report sets"`

Expected: only Integration Hub/report-set UI files staged.

---

### Task 10: Implement report contract/projection v2 for observed row and matrix shapes

**Files:**

- Modify: `src/domain/reports/contracts.ts`
- Modify: `src/domain/reports/contracts.test.ts`
- Modify: `src/domain/reports/projection.ts`
- Modify: `src/domain/reports/projection.test.ts`
- Modify: `src/domain/reports/guided-mapping.ts`
- Modify: `src/domain/reports/guided-mapping.test.ts`
- Create: `src/domain/reports/header-selector.ts`
- Create: `src/domain/reports/header-selector.test.ts`
- Create: `src/domain/reports/row-predicate.ts`
- Create: `src/domain/reports/row-predicate.test.ts`
- Create: `src/domain/reports/matrix-projection.ts`
- Create: `src/domain/reports/matrix-projection.test.ts`
- Modify: `src/domain/reports/period-key.ts`
- Modify: `src/domain/reports/period-key.test.ts`
- Modify: `src/workflows/reports/validate-report-package.ts`
- Modify: `src/workflows/reports/validate-report-package.test.ts`
- Modify: `src/workflows/reports/project-report-package.ts`
- Modify: `src/workflows/reports/project-report-package.test.ts`
- Modify: `src/modules/reports/application/service.ts`
- Modify: `src/modules/reports/application/api.test.ts`
- Modify: `src/modules/reports/infrastructure/repository.ts`
- Modify: `src/modules/reports/infrastructure/repository.test.ts`
- Modify: `src/domain/reports/provider-library/database-agreement.test.ts`
- Create: one migration emitted by `supabase migration new governed_report_declaration_v2`
- Modify: `supabase/tests/database/governed_report_contracts_test.sql`
- Modify: `supabase/tests/database/governed_report_projection_document_test.sql`
- Modify: `supabase/tests/database/governed_report_period_grain_projection_test.sql`

**Interfaces:**

- Consumes: immutable v1 contracts/projections, current parser rows/PDF grids, exact fixed-point arithmetic, totals-row controls, and existing approval/binding digests.
- Produces: schema-version-2 row/matrix contracts, exact header occurrence, bounded row predicates, row-count outputs, `month_name_year`, bounded arithmetic controls, and ordinary exact/period-grain ledger writes.

- [ ] **Step 1: Prove v1 immutability before adding v2**

Add golden canonical-digest assertions for every current provider definition. Parse and serialize each v1 contract/projection and assert byte-identical canonical digest before and after the v2 code exists.

- [ ] **Step 2: Write failing schema tests for the exact v2 surface**

Lock these bounded types:

```ts
export type HeaderSelector = {
  normalizedHeader: string;
  occurrence: number;
};

export type ApprovedRowPredicate = {
  canonicalField: string;
  operator: "equals_any";
  values: readonly string[];
};

export type MatrixSheetRule = {
  layout: "matrix";
  normalizedSheetName: string;
  periodHeaderRow: number;
  periodStartColumn: number;
  periodEncoding: "month_name_year";
  rowLabelColumn: number;
  rows: readonly {
    canonicalField: string;
    sourceLabel: string;
    occurrence: number;
    parser: "money" | "integer" | "decimal";
    financialSign?: "positive" | "negative";
    required: boolean;
  }[];
};

export type ArithmeticControl = {
  leftOutputKey: string;
  operator: "add" | "subtract";
  rightOutputKey: string;
  expectedOutputKey: string;
  toleranceMinorUnits: number;
};

export type V2MoneyOutputSign = "preserve" | "absolute";
```

Reject occurrence below 1, empty/duplicate predicate values, unknown operators, fuzzy/regex labels, an unknown sign normalization, `absolute` on a non-money output, more than bounded rows/period columns/controls, and a control that references absent outputs.

- [ ] **Step 3: Write failing pure behavior tests**

Cover duplicate-header second occurrence, no/too-many occurrence, exact case-normalized predicate admission, unknown status refusal, row count without a numeric source field, month-name/year parsing, duplicate/missing matrix month, exact row-label occurrence, wrapped-label preservation, validated negative money normalized with `absolute`, preserved signed money, integer-string arithmetic, and one add/subtract control mismatch.

- [ ] **Step 4: Run failing domain tests**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/domain/reports/contracts.test.ts src/domain/reports/projection.test.ts src/domain/reports/guided-mapping.test.ts src/domain/reports/header-selector.test.ts src/domain/reports/row-predicate.test.ts src/domain/reports/matrix-projection.test.ts src/domain/reports/period-key.test.ts`

Expected: FAIL for missing v2 schemas/helpers/projector.

- [ ] **Step 5: Implement pure helpers and v2 discriminated unions**

Keep v1 code paths unchanged. Use exact normalized labels and one-based occurrences. Row predicates compare normalized bounded strings only. Matrix projection returns the existing `PeriodGrainObservation` shape so the writer remains provider/layout neutral.

- [ ] **Step 6: Add failing validator/worker tests**

Assert validator and projector use the same occurrence/predicate/matrix semantics; unknown v2 keys fail; a source row rejected by a predicate contributes neither a value nor lineage count; arithmetic controls execute before completion; and safe failures contain codes/counts only.

- [ ] **Step 7: Implement workflow/service proposal support**

Guided mapping may propose v2 only from operator-selected structure. The recognized provider library may supply v2 as inert data. Approval copy must name header occurrence, admitted status values, row-count semantics, matrix axes, arithmetic checks, ignored rows/pages, and source scope without showing values.

- [ ] **Step 8: Write database allowlist/pgTAP tests before SQL**

Prove database validators accept exactly the v2 documents the Zod schemas accept, reject unknown operations/keys, preserve v1, bind exact digests, enforce output metric definitions/value kinds, and refuse a matrix completion with wrong period/currency/lineage/reconciliation.

- [ ] **Step 9: Create, review, dry-run, and apply the v2 migration**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec supabase migration new governed_report_declaration_v2`

After editing/review: `PATH=/home/spy/.local/node/bin:$PATH pnpm db:migrations:dry-run`

After approval: `PATH=/home/spy/.local/node/bin:$PATH pnpm db:migrations:push`

Expected: forward-only replacement/extension of validators and completion functions, no table rewrite that changes v1 evidence.

- [ ] **Step 10: Run hosted pgTAP and first-invocation checks**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm db:test supabase/tests/database/governed_report_contracts_test.sql supabase/tests/database/governed_report_projection_document_test.sql supabase/tests/database/governed_report_period_grain_projection_test.sql`

Expected: all pass; invoke every new/replaced function once against staging with synthetic bounded documents.

- [ ] **Step 11: Run complete report-domain/workflow agreement tests**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/domain/reports src/workflows/reports/validate-report-package.test.ts src/workflows/reports/project-report-package.test.ts src/modules/reports/application/api.test.ts src/modules/reports/infrastructure/repository.test.ts`

Expected: all pass, including unchanged v1 real-fixture projections.

- [ ] **Step 12: Commit the declaration-language slice**

Commit pure domain/helpers first if review benefits, then workflow/database agreement as a second narrow commit. Suggested messages: `feat(reports): add bounded declaration v2` and `feat(reports): fence v2 projection completion`.

---

### Task 11: Qualify auxiliary Keeta, Noon, and EatEasily/Smile files safely

**Files:**

- Create: `src/domain/reports/provider-library/keeta-orders-daily.ts`
- Create: `src/domain/reports/provider-library/keeta-orders-daily.test.ts`
- Create: `src/domain/reports/provider-library/keeta-promotions-daily.ts` only after the duplicate-header semantic decision is approved
- Create: `src/domain/reports/provider-library/keeta-promotions-daily.test.ts` with the same gate
- Modify: `src/domain/reports/provider-library/index.ts`
- Modify: `src/domain/reports/provider-library/support-manifest.ts`
- Modify: `src/domain/reports/provider-library/support-manifest.test.ts`
- Modify: `src/workflows/reports/provider-library.integration.test.ts`
- Modify: `src/components/integrations/report-intake-mapping.tsx`
- Modify: `src/components/integrations/report-intake-mapping.test.tsx`
- Modify: `src/domain/analysis/registry.ts` and tests only for newly evidence-backed cancellation/promotion detectors

**Interfaces:**

- Consumes: Task 10 v2 header/predicate/row-count support, Task 8 report sets, the real auxiliary fixtures, and existing restaurant metric definitions.
- Produces: aggregate-only Keeta order/cancellation evidence, approved promotion evidence if semantics are resolved, tenant-specific EatEasily daily orders, and explicit refusal/profile states for every remaining file.

- [ ] **Step 1: Lock the authoritative source roles**

In report-set tests, Billing remains `source` for revenue, Restaurant remains `supplementary` for valid orders/impressions/promotion funding, Orders remains `supplementary` for total/cancelled detail, Promotions remains `supplementary`, and Keeta PDF invoices remain `control`. Assert neither Orders nor Customer-sheet placed orders replace `transactions.count` from the authoritative source.

- [ ] **Step 2: Write Keeta orders definition tests first**

Bind the exact date and status headers. Emit:

- `order.total_count` as admitted-row count over all data rows; and
- `order.cancelled_count` from the exact approved `Cancelled` status predicate.

Do not decide whether `Partial refund` is a successful transaction; it remains represented only in total rows unless a separate semantic decision is approved. Do not persist order IDs, review text, item detail, times, or cancellation prose.

- [ ] **Step 3: Run the failing orders tests**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/domain/reports/provider-library/keeta-orders-daily.test.ts src/workflows/reports/provider-library.integration.test.ts`

Expected: FAIL before the definition exists.

- [ ] **Step 4: Implement and prove Keeta orders**

Add the definition, keep it period-grain/day, run the real validator/projector, add it as a supplementary report-set member, and prove retry/reconciliation/analysis on staging with counts and IDs only.

- [ ] **Step 5: Stop for the Keeta promotions semantic approval**

The real promotion file contains two columns with the same normalized `valid_orders` header. Present the structural ambiguity and the two one-based occurrences to an owner/admin using non-value copy. Do not create/enable the definition until the business meaning of the chosen occurrence is confirmed. Once confirmed, encode the exact occurrence and add a regression test that swapping it changes the digest and requires new approval.

- [ ] **Step 6: Qualify EatEasily daily orders through guided mapping**

Use `date` with the approved `day_month` encoding and the organization-specific numeric branch heading as `transactions.count`. Save this only as an organization-scoped approved contract; do not add the private branch heading to a global provider definition or source alias. Prove daily projection and exact channel/branch scope on staging.

- [ ] **Step 7: Preserve explicit dispositions for files that do not project**

Assert:

- Keeta item detail remains `profile_only` until menu-subject matching exists;
- EatEasily customer-wise remains `pii_refused` and produces no model/projection dispatch;
- EatEasily compensation remains `empty_needs_data` with no zero evidence; and
- EatEasily agent-handled remains `profile_only` until its subset semantics and target metric are approved.

- [ ] **Step 8: Run the complete provider qualification suite**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/domain/reports/provider-library src/workflows/reports/provider-library.integration.test.ts src/components/integrations/report-intake-mapping.test.tsx`

Expected: all enabled definitions pass; unresolved promotions remains `needs_review`, not a failing or falsely supported definition.

- [ ] **Step 9: Commit auxiliary qualification in independently reviewable commits**

Commit Keeta orders, EatEasily guided mapping, and any later approved promotions definition separately so one semantic rejection does not block or blur the others.

---

### Task 12: Add measured cost and finance metrics behind a separate economics approval gate

**Files:**

- Modify: `specs/012-channel-economics-ledger.md`
- Modify: `specs/015-metric-registry-and-normalized-metrics.md`
- Modify: `industry-packs/restaurant/domain-model.md`
- Create: one migration emitted by `supabase migration new measured_report_cost_metrics`
- Modify: `supabase/tests/database/metric_registry_test.sql`
- Modify: `supabase/tests/database/channel_economics_test.sql` only if the separately approved economics precedence changes
- Modify: `src/domain/reports/provider-library/keeta-billing-summary.ts`
- Modify: `src/domain/reports/provider-library/eateasily-branch-sales.ts`
- Modify: `src/domain/reports/provider-library/copy.ts`
- Modify: `src/workflows/reports/provider-library.integration.test.ts`
- Create: `src/domain/analysis/detectors/reported-channel-costs.ts`
- Create: `src/domain/analysis/detectors/reported-channel-costs.test.ts`
- Modify: `src/domain/analysis/registry.ts`
- Modify: `src/components/analysis/channel-workspace.tsx`
- Modify: `src/components/analysis/channel-workspace.test.tsx`

**Interfaces:**

- Consumes: approved source sign/tax semantics, current money projection, and the explicit rule that reported costs are evidence but not contribution margin.
- Produces: measured cost metric definitions, cited cost observations, and a Money/Finance chapter that does not claim margin.

- [ ] **Step 1: Pause for explicit spec-012 approval**

Present the exact proposed metric catalogue and sign rule:

```ts
const measuredCostMetrics = [
  { key: "cost.marketplace_commission", valueKind: "money", aggregation: "sum" },
  { key: "cost.payment_processing_fee", valueKind: "money", aggregation: "sum" },
  { key: "cost.delivery_fee", valueKind: "money", aggregation: "sum" },
  { key: "cost.food", valueKind: "money", aggregation: "sum" },
  { key: "cost.packaging", valueKind: "money", aggregation: "sum" },
] as const;

const financeStatementMetrics = [
  { key: "finance.cost_of_goods_sold", valueKind: "money", aggregation: "sum" },
  { key: "finance.gross_profit", valueKind: "money", aggregation: "sum" },
  { key: "finance.operating_expenses", valueKind: "money", aggregation: "sum" },
  { key: "finance.operating_profit", valueKind: "money", aggregation: "sum" },
  { key: "finance.net_profit", valueKind: "money", aggregation: "sum" },
] as const;
```

Canonical cost metrics store non-negative expense magnitude. A v2 output may use only `signNormalization: "preserve" | "absolute"`; the contract still validates the source's positive/negative sign first. Update the companion spec/ADR if this decision is accepted. If it is not accepted, stop Task 12 and keep all cost columns bound-for-validation only.

- [ ] **Step 2: Keep economics precedence out unless separately approved**

The initial approved sub-slice seeds metrics and shows reported costs only. It must not change `cost_component_definitions`, recompute `channel_economics_entries`, or display contribution margin. A later approval may define whether sourced observations override a rate and how disagreements are raised.

- [ ] **Step 3: Write metric/pgTAP tests first**

Assert active shared definitions, money/sum semantics, tenant-safe visibility, no hard-coded provider/restaurant columns, and no economics role that would make cost look like revenue or margin. If economics binding is approved later, add its tests in that later task.

- [ ] **Step 4: Write provider/detector/UI tests first**

Assert Keeta negative commission/bank-fee source cells normalize to positive cost magnitude only under approved v2 output semantics; Smile positive commission remains positive magnitude; mixed tax basis is displayed as a limitation; and cost findings cite every current row. No cost observation changes AOV/revenue or creates a margin.

- [ ] **Step 5: Create/review/apply the metric migration**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec supabase migration new measured_report_cost_metrics`

Review/dry-run/apply through the shared staging workflow, then run: `PATH=/home/spy/.local/node/bin:$PATH pnpm db:test supabase/tests/database/metric_registry_test.sql`

Expected: definitions exist with exact approved semantics; no unapproved economics writer changes.

- [ ] **Step 6: Implement projections and reported-cost detector/UI**

Add approved outputs to tenant-approved projection versions only; existing approved versions remain immutable. Register the detector at a new registry version with a forward migration/pgTAP admission if required. Render source basis, dates, currency, and limitations in Money/Finance.

- [ ] **Step 7: Prove staging and divergence states**

Run real Keeta/Smile reports through successor contract/projection approval. Verify cost amounts, sign normalization, lineage, and a deliberately mismatched tax-basis presentation that refuses combination rather than summing incomparable costs.

- [ ] **Step 8: Commit metric evidence separately from any later economics change**

Suggested commit: `feat(evidence): project measured channel costs`. Do not mix an approved future economics precedence change into this commit.

---

### Task 13: Qualify the Offline P&L matrix with source-scope attestation

**Files:**

- Create: `src/domain/reports/provider-library/offline-profit-and-loss.ts`
- Create: `src/domain/reports/provider-library/offline-profit-and-loss.test.ts`
- Modify: `src/domain/reports/provider-library/index.ts`
- Modify: `src/domain/reports/provider-library/support-manifest.ts`
- Modify: `src/workflows/reports/pdf-text-layer.integration.test.ts`
- Modify: `src/workflows/reports/provider-library.integration.test.ts`
- Modify: `src/domain/reports/contracts.ts`
- Modify: `src/domain/reports/contracts.test.ts`
- Modify: `src/modules/reports/application/service.ts`
- Modify: `src/modules/reports/application/api.test.ts`
- Modify: `src/modules/reports/infrastructure/repository.ts`
- Modify: `src/modules/reports/infrastructure/repository.test.ts`
- Modify: `src/components/integrations/report-intake-mapping.tsx`
- Modify: `src/components/integrations/report-intake-mapping.test.tsx`
- Modify: `src/components/analysis/channel-workspace.tsx`
- Modify: `src/components/analysis/channel-workspace.test.tsx`
- Create: one forward migration emitted by `supabase migration new offline_source_scope_attestation`
- Modify: focused report-contract/projection pgTAP files

**Interfaces:**

- Consumes: Task 10 matrix projection, Task 12 approved finance/cost vocabulary where available, the current PDF text-layer/grid adapter, selected Offline channel/branch, and an owner/admin scope decision.
- Produces: `offline.profit_and_loss.monthly`, monthly governed finance observations, `report.source_scope_attested`, and explicit `SOURCE_SCOPE_NOT_CHANNEL_SPECIFIC` refusal.

- [ ] **Step 1: Write source-scope tests before the provider definition**

Lock this v2 contract evidence:

```ts
export type SourceScopeAttestation = {
  version: 1;
  coverage: "selected_channel_branch_only" | "includes_other_channels" | "unknown";
  channelId: string;
  branchId: string;
};
```

Only `selected_channel_branch_only` may approve projection. The other two outcomes persist the decision/audit event and return `SOURCE_SCOPE_NOT_CHANNEL_SPECIFIC` without writing a metric.

- [ ] **Step 2: Write matrix provider tests using synthetic values**

Map required exact row labels for Sales, Total Cost of Goods Sold, and Gross Profit; map optional Packing & Consumables, Operating Expenses, Operating Profit, and Net Profit/Loss only where unambiguous. Select duplicate row labels by occurrence. Require one arithmetic control: Sales minus Cost of Goods Sold equals Gross Profit within the approved minor-unit tolerance.

Do not place real statement values in assertions. Keep the existing real PDF integration assertions structural/arithmetic only.

- [ ] **Step 3: Run failing Offline tests**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/domain/reports/provider-library/offline-profit-and-loss.test.ts src/workflows/reports/pdf-text-layer.integration.test.ts src/workflows/reports/provider-library.integration.test.ts src/domain/reports/contracts.test.ts src/components/integrations/report-intake-mapping.test.tsx`

Expected: provider-definition and scope-attestation tests fail before implementation. The known cold PDF timeout is not accepted as a pass; rerun that suite alone with a test timeout sized to deterministic extraction and record whether it is a baseline/runtime issue.

- [ ] **Step 4: Implement the provider definition and approval boundary**

Use exact first-page matrix structure for the initial family and mark other pages `reviewed_ignore` unless the contract explicitly maps them. Sales may map to `revenue.gross` only after offline-only attestation. Finance/cost rows may map only to metrics approved in Task 12; otherwise they remain bound/controlled and render as named missing capabilities.

- [ ] **Step 5: Add/extend database fences and audit**

The contract/projection approval and completion path must bind the attestation version, actor, channel, branch, period, and digest. Recheck it during projection completion. Add `report.source_scope_attested` safe audit metadata. Do not trust a client boolean passed only to the worker.

- [ ] **Step 6: Review/apply the forward source-scope migration and run hosted pgTAP**

Create the new migration through the CLI; Task 10 is already applied by this sequential plan and must never be edited. Dry-run, obtain review, apply, run focused report-contract/projection pgTAP, and invoke every changed function once.

- [ ] **Step 7: Prove both staging branches**

Branch A: approve a synthetic or owner-confirmed offline-only context and prove monthly metrics, lineage, arithmetic control, analysis, and UI. Branch B: record `includes_other_channels` or `unknown` and prove no metric write, no subtraction inference, and a visible POS/offline-sales request.

- [ ] **Step 8: Verify period incompatibility and fixed-cost separation**

Assert marketplace January/February evidence is not compared with later Offline months. Assert Operating Expenses/Operating Profit/Net Profit never enter Channel Economics variable components or the contribution-margin label.

- [ ] **Step 9: Commit the Offline vertical slice**

Suggested commit: `feat(reports): qualify attested offline P&L evidence`. Keep private PDF bytes unstaged.

---

### Task 14: Unify channel states, document the program, and run release gates

**Files:**

- Modify: `src/modules/analysis/application/channels-overview.ts`
- Modify: `src/modules/analysis/application/channels-overview.test.ts`
- Modify: `src/app/(platform)/organizations/[organizationId]/channels/page.tsx`
- Modify: `src/app/(platform)/organizations/[organizationId]/channels/page.test.tsx`
- Modify: `src/components/analysis/channel-workspace.tsx`
- Modify: `src/components/analysis/channel-workspace.test.tsx`
- Modify: `e2e/integration-hub.spec.ts`
- Create: `e2e/multi-channel-analysis.spec.ts`
- Modify: `README.md`
- Modify: `context/03-architecture.md`
- Modify: `context/04-domain-model.md`
- Modify: `context/05-module-map.md`
- Modify: `context/12-integrations.md`
- Modify: `context/13-ui-ux-context.md`
- Modify: `context/19-glossary.md`
- Modify: `industry-packs/restaurant/README.md`
- Modify: `industry-packs/restaurant/domain-model.md`
- Modify: `specs/018-governed-channel-intelligence.md`

**Interfaces:**

- Consumes: all completed provider-family slices and current channel/portfolio read models.
- Produces: consistent `supported`, `report_summary`, `needs_data`, `held_for_review`, and `not_comparable` states plus complete automated/staging/browser/documentation evidence.

- [ ] **Step 1: Write failing portfolio/state tests**

Assert Talabat/Keeta period series, Noon/Smile exact summaries, Offline monthly matrix, missing POS, PII refusal, empty compensation, held overlap, drift, mixed currency, and non-overlapping periods each map to one explicit state. Incompatible channels remain listed with reasons and are excluded from aggregate comparison arithmetic.

- [ ] **Step 2: Implement the smallest consistent state mapping**

Do not redesign the page or add unsupported charts. Reuse current channel cards/chapter rail and show evidence shape, window, trust, and next input. Keep recommendation triage human-governed and execution absent.

- [ ] **Step 3: Add authenticated E2E scenarios**

Cover:

- owner/admin recognized-family approval;
- operator upload without approval;
- viewer read-only behavior;
- second-tenant package/report-set/evidence refusal;
- Keeta daily analysis;
- Noon/Smile summary with no trend;
- Offline positive and negative scope decisions;
- drift/reconciliation recovery;
- 390-pixel layout, keyboard navigation, evidence Sheet, and 200% zoom.

Keep authenticated scenarios explicitly skipped when environment credentials are missing; unauthenticated/cross-tenant route protection must still run.

- [ ] **Step 4: Update canonical documentation**

Document the provider support matrix by report family, not provider logo. State current staging-proven families separately from provisional/profile-only/refused families. Document report sets, exact summaries, matrix projection, source-scope attestation, PII boundary, cost-versus-margin boundary, feature flags, and rollback.

- [ ] **Step 5: Run focused provider/report/analysis/UI tests**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/domain/reports/provider-library src/domain/reports src/workflows/reports src/domain/analysis src/modules/analysis src/components/integrations src/components/analysis 'src/app/api/organizations/[organizationId]/report-sets' 'src/app/(platform)/organizations/[organizationId]/channels'`

Expected: all selected tests pass. If directory arguments collect unrelated tests, record the actual file list and rerun explicit owned suites; never omit a failing owned suite.

- [ ] **Step 6: Run database release gates against hosted staging**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm db:migrations:list`

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm db:migrations:dry-run`

Expected: no unreviewed pending migration.

Run the focused pgTAP files for analysis, report contracts, projection, reconciliation, report sets, metric registry, economics readiness, permissions, and Storage policy. Then run database advisors through the supported CLI/MCP owner.

Expected: all focused assertions pass; no critical/high security or missing-index issue introduced.

- [ ] **Step 7: Run repository-wide Node quality gates**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm exec prettier --check docs/superpowers/specs/2026-08-29-multi-channel-report-ingestion-and-analysis-design.md docs/superpowers/plans/2026-08-29-multi-channel-report-ingestion-and-analysis.md specs/018-governed-channel-intelligence.md adrs/0044-report-shapes-source-authority-and-matrix-projection.md`

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm typecheck`

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm lint`

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm test --reporter=dot`

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm build`

Expected: all owned checks pass. Separate unrelated dirty-tree/baseline failures with exact file/test evidence; do not label the program complete while an owned failure remains.

- [ ] **Step 8: Run E2E/browser acceptance**

Run: `PATH=/home/spy/.local/node/bin:$PATH pnpm test:e2e -- e2e/integration-hub.spec.ts e2e/multi-channel-analysis.spec.ts`

Then perform the authenticated owner/admin/operator/viewer/cross-tenant walkthrough at desktop and 390 pixels. If the user owns browser testing, provide exact steps and report it as pending; do not simulate acceptance.

- [ ] **Step 9: Inspect privacy and diff boundaries**

Run: `rg -n "Customer Name|Contact Number|order_id|signedUrl|storage_path|rawRow|rawCell" src supabase docs --glob '!**/*.map'`

Expected: only approved schema/test vocabulary or pre-existing safe references; no fixture values/customer payloads added by this program.

Run: `git diff --check && git status --short`

Expected: no whitespace error, no private fixture staged, and every unrelated dirty file remains untouched.

- [ ] **Step 10: Commit documentation and release proof**

Run: `git add README.md context/03-architecture.md context/04-domain-model.md context/05-module-map.md context/12-integrations.md context/13-ui-ux-context.md context/19-glossary.md industry-packs/restaurant/README.md industry-packs/restaurant/domain-model.md specs/018-governed-channel-intelligence.md e2e/integration-hub.spec.ts e2e/multi-channel-analysis.spec.ts src/modules/analysis/application/channels-overview.ts src/modules/analysis/application/channels-overview.test.ts 'src/app/(platform)/organizations/[organizationId]/channels/page.tsx' 'src/app/(platform)/organizations/[organizationId]/channels/page.test.tsx' src/components/analysis/channel-workspace.tsx src/components/analysis/channel-workspace.test.tsx && git commit -m "docs(channels): record multi-channel release evidence"`

Expected: final commit contains only owned release/doc/UI-state files; `git push` remains the user's action.

---

## Approval and Stop Gates

- **Gate A — now:** approve this companion spec and implementation plan. No implementation starts before approval.
- **Gate B — Task 1:** wait for the active spec-018/analysis claims to be released and approve ADR 0044 before code.
- **Gate C — each migration:** migration owner claims the generated file; an independent review occurs before apply to shared staging.
- **Gate D — provider semantics:** owner/admin approves exact mapping, sign, context, duplicated-header occurrence, source/control role, and source-scope attestation. Structural recognition is not approval.
- **Gate E — measured costs:** explicitly approve the spec-012/015 amendment and canonical sign rule before Task 12. Without approval, cost columns remain validation-only.
- **Gate F — offline scope:** confirm whether the P&L covers only Offline. If it includes marketplaces or is unknown, release Offline as `needs_data` for POS; do not infer revenue.
- **Gate G — release:** browser acceptance, hosted staging/RLS proof, all owned automated gates, documentation, and no high-severity issue.

## Blast Radius

- **Database:** one registry-admission function replacement; two report-set tables plus append-only decisions/RPCs; v2 JSON validators/completion functions; optional metric seeds. Existing v1 contracts/evidence remain immutable.
- **RLS/permissions:** new report-set tables/RPCs reuse report permissions with explicit role ceilings. No service role in user routes. Every new relation needs two-tenant tests and tenant-leading indexes.
- **Background tasks:** report projection reads v2 documents; analysis carries exact-range points and a new registry version; recommendation narration remains a separate best-effort consumer.
- **Callers:** Integration Hub upload/mapping, report services/repositories/routes, analysis worker/repositories/read models, channel detail/portfolio, E2E, specs/context/pack catalogues.
- **Storage:** no bucket/public-policy expansion. Existing private object paths and retention apply; raw detail stays out of Postgres/logs.
- **Economics:** reported cost evidence may be added only after Gate E; contribution-margin writes/readers are unchanged by default.
- **Provider support:** enabled per exact report family and organization. No global channel/provider switch implies every export is supported.

## Risks and Rollback

- **Exact totals appear trend-like:** enforce evidence-shape declarations, exact-window equality, no trend component, and regression tests. Roll back by disabling exact-summary analysis while retaining evidence.
- **Two files double-count one metric:** report-set roles are advisory governance plus existing reconciliation remains authoritative. Disable new set mutations and keep held evidence; never delete observations.
- **V2 changes v1 meaning:** golden digests/database-agreement tests block release. Roll back recognition of v2; v1 contracts continue unchanged.
- **Detail rows leak PII:** allowlisted aggregation, no raw persistence/logging/model input, and explicit customer-file refusal. Disable affected family and purge only under existing retention policy, not as application rollback.
- **Cost signs or tax bases disagree:** keep cost evidence separate, show limitation, and refuse combination. Revert provider successor projection; prior approved versions/history remain.
- **Offline P&L includes marketplaces:** negative/unknown attestation writes no channel metrics and requests POS. No subtraction fallback exists to roll back.
- **PDF grid reads a plausible wrong value:** exact row/month selectors plus arithmetic control fail the package. Disable Offline recognition; preserve uploaded evidence/history privately.
- **Shared staging migration error:** stop, add a corrective forward migration, re-run focused pgTAP and first invocations. Never edit an applied migration or reset staging.
- **Concurrent dirty-tree conflict:** stop at the file claim, reconcile ownership, rerun focused suites after merge, and preserve the other agent's work.

## Completion Evidence to Record

- Exact commit(s), generated migration filenames, staging migration state, and feature-flag state.
- Focused and full Vitest/typecheck/lint/build results, with unrelated failures separated.
- pgTAP assertion counts for every affected suite, advisor result, and first invocation of every new/replaced function.
- Safe package/contract/projection/report-set/analysis run IDs and lifecycle counts for each qualified family; no business values.
- Role and two-tenant proof, plus private Storage access refusal.
- Authenticated browser results or an explicit user-owned walkthrough still pending.
- Provider matrix states after release: staging-proven, provisional, needs-review, profile-only, PII-refused, and empty-needs-data.
