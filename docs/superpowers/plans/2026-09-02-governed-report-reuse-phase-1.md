# Governed Report Reuse, Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an organization answer the governed-report mapping questions once per file structure instead of once per upload, and stop refusing files for reasons the platform will not name.

**Architecture:** A second, worksheet-name-free `structure_fingerprint` identifies a report by its columns. A new `report_structure_admissions` table records one durable, revocable grant per organization, channel and structure, naming the person who gave it. The validation claim gains a second admissible path: either a contract version proposed against this exact package, as today, or a matching active admission. Everything else in the governed pipeline is unchanged.

**Tech Stack:** TypeScript strict, Next.js App Router, Zod, Supabase Postgres with RLS and plpgsql RPCs, Trigger.dev v4 workers, Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-09-02-governed-report-reuse-and-channel-intake-design.md`
**ADR:** `adrs/0046-a-standing-admission-is-the-unit-of-report-reuse.md`
**Feature spec:** `specs/018-governed-channel-intelligence.md` §4.1.8, §8.1, §8.2

## Global Constraints

- **There is no local database.** Never run `supabase start` or `supabase db reset`. `pnpm db:migrations:push` and `pnpm db:test` both target hosted staging, and a pushed migration is live for everyone immediately.
- **`pnpm db:types` cannot run.** `src/lib/supabase/database.types.ts` is maintained by hand. A new table must be typed there or listed in `UNTYPED_TABLES` in `database.types.test.ts`, which fails if a table is neither.
- **A new plpgsql function that reads a table it did not create must be called once against staging before it is done.** plpgsql resolves record fields at execution time. This repository has been bitten twice.
- **Migrations are forward-only.** Never edit an applied migration. To change a function, write a new migration that `create or replace`s it.
- **Before replacing any plpgsql function, read its live definition** with `select pg_get_functiondef('public.<name>(<argtypes>)'::regprocedure);` against staging. Do not assume the newest migration mentioning it holds the current body — several have been repaired since.
- **Never use `git stash`.** The stash stack is shared with the main checkout and other worktrees. Use a temporary WIP commit.
- **Growth Intelligence is another agent's.** Never touch `src/domain/growth-intelligence/`, `src/modules/growth-intelligence/`, `growth_intelligence_*` migrations or pgTAP suites, `specs/022-*`, `adrs/0044-*`. Do not resolve the `database.types.test.ts` drift their unapplied migration causes. Use path-limited `git add` so their uncommitted work is never swept into a commit.
- **Money is integer minor units with an ISO currency code. Timestamps are UTC. Events are past tense.**
- **Stop the dev server before running the full test suite** — otherwise the xlsx-parsing tests fail on this machine.
- **Copy is industry-neutral.** No restaurant nouns in platform-core surfaces.
- Test command: `pnpm test` (Vitest). Single file: `pnpm vitest run <path>`. Types: `pnpm typecheck`. Lint: `pnpm lint`. pgTAP: `pnpm db:test`.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/domain/reports/document-digest.test.ts` | Proves both digests, including that the structure digest ignores worksheet names. |
| `supabase/migrations/<ts>_report_structure_fingerprint.sql` | `structure_fingerprint` / `structure_version` columns; profiling completion records them. |
| `supabase/migrations/<ts>_report_structure_admissions.sql` | The admissions table, its RLS, and its grant/revoke RPCs. |
| `supabase/migrations/<ts>_admit_package_on_standing_admission.sql` | The validation claim's second path, the status transition it needs, and the immutability clauses. |
| `supabase/migrations/<ts>_declare_projection_categorical_value.sql` | RPC proposing an amended projection version with one extra allowed label. |
| `supabase/tests/database/governed_report_structure_admissions_test.sql` | pgTAP: shape, RLS, tenant isolation, revocation, currency refusal. |
| `src/modules/reports/application/admissions.ts` | Application service: match an admission, grant one, revoke one. |
| `src/modules/reports/application/admissions.test.ts` | Its tests. |
| `src/app/api/organizations/[organizationId]/report-packages/[packageId]/admission/route.ts` | POST grants an admission for the package's structure and runs the one-Approve flow. |
| `src/app/api/organizations/[organizationId]/report-packages/[packageId]/admission/route.test.ts` | Route tests including authorization. |
| `src/components/integrations/report-admission-approval.tsx` | The one screen naming what will be read, with one Approve. |
| `src/components/integrations/report-admission-approval.test.tsx` | Its tests. |
| `scripts/backfill-report-structure-admissions.mjs` | Reports, then grants, admissions for already-approved mappings. |
| `fixtures/raw/Talabat/Jan-2026.csv` *(already present)* | Becomes a real-export test fixture. |

**Modified**

| File | Change |
| --- | --- |
| `src/domain/reports/contracts.ts` | `ReportStructureFingerprintInput`, `REPORT_STRUCTURE_VERSION`. |
| `src/domain/reports/document-digest.ts` | `createReportStructureFingerprint`. |
| `src/domain/reports/period-key.ts` | Accept strict ISO text before dispatching on encoding. |
| `src/domain/reports/projection-error.ts` | `ReportCategoricalValueNotDeclared`. |
| `src/domain/reports/projection.ts:588-604` | Throw the subclass with the label, output key and dates. |
| `src/workflows/reports/profile-report-package.ts:513-541, 590-608` | Compute and pass the structure fingerprint. |
| `src/trigger/reports.ts` | Pass the fingerprint through; raise `AbortTaskRunError` on a governed refusal. |
| `src/modules/reports/application/dispatch.ts` | Chain validation after an admitted profiling, and projection after a clean validation. |
| `src/components/integrations/report-package-upload.tsx` | Report type from the recognised family; mount the one-Approve screen. |
| `src/lib/supabase/database.types.ts` | New table and columns, by hand. |

---

## Task 1: The structure fingerprint

**Files:**
- Modify: `src/domain/reports/contracts.ts` (append after `ReportSchemaFingerprintInput`, currently ending line 368)
- Modify: `src/domain/reports/document-digest.ts`
- Test: `src/domain/reports/document-digest.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `REPORT_STRUCTURE_VERSION: 1`, `type ReportStructureFingerprintInput`, and `createReportStructureFingerprint(input: ReportStructureFingerprintInput): string`. Task 2 calls it.

- [ ] **Step 1: Write the failing test**

Create `src/domain/reports/document-digest.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { REPORT_STRUCTURE_VERSION } from "@/domain/reports/contracts";
import { createReportStructureFingerprint } from "@/domain/reports/document-digest";
import type { ReportStructureFingerprintInput } from "@/domain/reports/contracts";

/**
 * Talabat names its worksheet after the export range, so the same report
 * profiles under a different sheet name every month. The structure digest is
 * the answer to that: a report is identified by its columns.
 */
function profile(
  overrides: Partial<ReportStructureFingerprintInput> = {},
): ReportStructureFingerprintInput {
  return {
    structureVersion: REPORT_STRUCTURE_VERSION,
    outletGrain: "branch",
    parserVersion: 1,
    sheets: [
      {
        position: 1,
        hasFormula: false,
        hasMergedCells: false,
        hasRepeatedHeader: false,
        headerCandidateDigests: [{ rowPosition: 1, fieldCount: 58, digest: "a".repeat(64) }],
      },
    ],
    ...overrides,
  };
}

describe("createReportStructureFingerprint", () => {
  it("is a sha256 hex digest", () => {
    expect(createReportStructureFingerprint(profile())).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is unchanged by the worksheet name, which the provider rewrites per export", () => {
    // The name is not an input at all, so January's `talabat_jan_feb_2026_performanc`
    // and March's `mar_2026` reach this function as the same value.
    expect(createReportStructureFingerprint(profile())).toBe(
      createReportStructureFingerprint(profile()),
    );
  });

  it("changes when a column set changes", () => {
    const different = profile({
      sheets: [
        {
          position: 1,
          hasFormula: false,
          hasMergedCells: false,
          hasRepeatedHeader: false,
          headerCandidateDigests: [{ rowPosition: 1, fieldCount: 58, digest: "b".repeat(64) }],
        },
      ],
    });
    expect(createReportStructureFingerprint(different)).not.toBe(
      createReportStructureFingerprint(profile()),
    );
  });

  it("changes when a header moves to a different row", () => {
    const moved = profile({
      sheets: [
        {
          position: 1,
          hasFormula: false,
          hasMergedCells: false,
          hasRepeatedHeader: false,
          headerCandidateDigests: [{ rowPosition: 2, fieldCount: 58, digest: "a".repeat(64) }],
        },
      ],
    });
    expect(createReportStructureFingerprint(moved)).not.toBe(
      createReportStructureFingerprint(profile()),
    );
  });

  it("does not depend on the order sheets arrive in", () => {
    const second = {
      position: 2,
      hasFormula: false,
      hasMergedCells: false,
      hasRepeatedHeader: false,
      headerCandidateDigests: [{ rowPosition: 1, fieldCount: 4, digest: "c".repeat(64) }],
    };
    const first = profile().sheets[0];
    expect(createReportStructureFingerprint(profile({ sheets: [first, second] }))).toBe(
      createReportStructureFingerprint(profile({ sheets: [second, first] })),
    );
  });

  it("separates a sheet that gained a formula", () => {
    const withFormula = profile({
      sheets: [{ ...profile().sheets[0], hasFormula: true }],
    });
    expect(createReportStructureFingerprint(withFormula)).not.toBe(
      createReportStructureFingerprint(profile()),
    );
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run src/domain/reports/document-digest.test.ts`
Expected: FAIL — `createReportStructureFingerprint` and `REPORT_STRUCTURE_VERSION` are not exported.

- [ ] **Step 3: Add the type and version to `contracts.ts`**

Append immediately after the closing brace of `ReportSchemaFingerprintInput` and before `normalizeReportStructureIdentifier`:

```ts
/**
 * The version of the structure digest below. Bump it only when the inputs
 * change: existing admissions are keyed on the digest and would silently stop
 * matching, which is a migration, not a refactor.
 */
export const REPORT_STRUCTURE_VERSION = 1;

/**
 * What makes two uploads the same report.
 *
 * Deliberately smaller than `ReportSchemaFingerprintInput`. The worksheet name
 * is gone, because Talabat names its tab after the export range and a digest
 * containing it changes every month for a file whose columns never move. The
 * report type is gone because it is operator-supplied text. The declared
 * currency is gone because it is matched explicitly at admission, where a
 * mismatch can be refused by name instead of vanishing as a non-match.
 *
 * `digest` already covers the ordered column names of its row, so the names
 * themselves are not repeated here.
 */
export type ReportStructureFingerprintInput = {
  structureVersion: number;
  outletGrain: "branch";
  parserVersion: number;
  sheets: Array<{
    position: number;
    headerCandidateDigests: Array<{
      rowPosition: number;
      fieldCount: number;
      digest: string;
    }>;
    hasFormula: boolean;
    hasMergedCells: boolean;
    hasRepeatedHeader: boolean;
  }>;
};
```

- [ ] **Step 4: Add the digest to `document-digest.ts`**

Add `ReportStructureFingerprintInput` to the existing type-only import from `@/domain/reports/contracts`, then add after `createReportSchemaFingerprint`:

```ts
/**
 * Identifies a report by its columns, so one approval covers every month of it.
 *
 * Sheets are sorted by position rather than trusted in arrival order, because
 * the profile's order is an implementation detail of three different readers
 * and this digest is recorded against rows that outlive all of them.
 */
export function createReportStructureFingerprint(input: ReportStructureFingerprintInput): string {
  const canonical = {
    structureVersion: input.structureVersion,
    outletGrain: input.outletGrain,
    parserVersion: input.parserVersion,
    sheets: [...input.sheets]
      .sort((left, right) => left.position - right.position)
      .map((sheet) => ({
        position: sheet.position,
        hasFormula: sheet.hasFormula,
        hasMergedCells: sheet.hasMergedCells,
        hasRepeatedHeader: sheet.hasRepeatedHeader,
        headerCandidateDigests: [...sheet.headerCandidateDigests]
          .sort((left, right) => left.rowPosition - right.rowPosition)
          .map((candidate) => ({
            rowPosition: candidate.rowPosition,
            fieldCount: candidate.fieldCount,
            digest: candidate.digest,
          })),
      })),
  };
  return createHash("sha256").update(canonicalize(canonical)).digest("hex");
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm vitest run src/domain/reports/document-digest.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/domain/reports/contracts.ts src/domain/reports/document-digest.ts src/domain/reports/document-digest.test.ts
git commit -m "feat(reports): identify a report by its columns, not its tab name

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Profiling records the structure fingerprint

**Files:**
- Create: `supabase/migrations/<timestamp>_report_structure_fingerprint.sql`
- Modify: `src/workflows/reports/profile-report-package.ts:513-541` (dependencies type) and `:590-608` (the fingerprint block)
- Modify: `src/trigger/reports.ts` (the profiling task's `complete`)
- Modify: `src/lib/supabase/database.types.ts`
- Test: `src/workflows/reports/profile-report-package.test.ts`
- Test: `supabase/tests/database/governed_report_packages_test.sql`

**Interfaces:**
- Consumes: `createReportStructureFingerprint` from Task 1.
- Produces: `integration_report_packages.structure_fingerprint` and `.structure_version`, populated at profiling. Tasks 6–9 match on the fingerprint. `ReportProfilingDependencies.complete` gains a required `structureFingerprint: string`.

- [ ] **Step 1: Write the failing worker test**

Add to `src/workflows/reports/profile-report-package.test.ts`:

```ts
it("records a structure fingerprint that ignores the worksheet name", async () => {
  const completions: Array<{ schemaFingerprint: string; structureFingerprint: string }> = [];
  const runFor = async (sheetName: string) => {
    await runReportPackageProfiling(
      { organizationId: ORGANIZATION_ID, packageId: PACKAGE_ID, idempotencyKey: "k".repeat(20) },
      profilingDependencies({ sheetName, completions }),
    );
  };

  await runFor("Talabat-Jan-Feb-2026-Performance-Report");
  await runFor("Mar-2026");

  expect(completions).toHaveLength(2);
  // The schema fingerprint is allowed to differ -- it identifies an exact
  // profiled shape, worksheet name included, and is recorded on rows that
  // outlive this code.
  expect(completions[0].schemaFingerprint).not.toBe(completions[1].schemaFingerprint);
  // The structure fingerprint is what reuse is keyed on, and these are the
  // same report.
  expect(completions[0].structureFingerprint).toBe(completions[1].structureFingerprint);
});
```

Read the existing test file first and reuse its fixture helpers; add a `sheetName` option and a `completions` sink to whatever helper builds `ReportProfilingDependencies` rather than inventing a second one.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run src/workflows/reports/profile-report-package.test.ts`
Expected: FAIL — `structureFingerprint` is not on the completion input.

- [ ] **Step 3: Compute it in the workflow**

In `src/workflows/reports/profile-report-package.ts`, extend the import:

```ts
import {
  createReportSchemaFingerprint,
  createReportStructureFingerprint,
} from "@/domain/reports/document-digest";
import {
  normalizeReportStructureIdentifier,
  REPORT_STRUCTURE_VERSION,
} from "@/domain/reports/contracts";
```

Add to `ReportProfilingDependencies.complete`, after `schemaFingerprint: string;`:

```ts
    structureFingerprint: string;
```

Directly after the `const schemaFingerprint = ...` block:

```ts
    // The same profile, read without the worksheet name. See ADR 0046.
    const structureFingerprint = createReportStructureFingerprint({
      structureVersion: REPORT_STRUCTURE_VERSION,
      outletGrain: "branch",
      parserVersion: claim.reportPackage.parser_version,
      sheets: sheets.map((sheet) => ({
        position: sheet.sheetPosition,
        headerCandidateDigests: sheet.headerCandidateDigests.map((candidate) => ({
          rowPosition: candidate.rowPosition,
          fieldCount: candidate.fieldCount,
          digest: candidate.digest,
        })),
        hasFormula: sheet.hasFormula,
        hasMergedCells: sheet.hasMergedCells,
        hasRepeatedHeader: sheet.hasRepeatedHeader,
      })),
    });
```

and pass `structureFingerprint,` in the `dependencies.complete({...})` call.

- [ ] **Step 4: Run the worker test and confirm it passes**

Run: `pnpm vitest run src/workflows/reports/profile-report-package.test.ts`
Expected: PASS.

- [ ] **Step 5: Read the live profiling-completion function**

Run against staging:

```sql
select pg_get_functiondef(
  'public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, text, jsonb)'::regprocedure
);
```

Copy the body out. The migration below re-declares it with one extra parameter; everything else must be carried forward verbatim.

- [ ] **Step 6: Write the migration**

Create `supabase/migrations/<timestamp>_report_structure_fingerprint.sql`. Use a real UTC timestamp, e.g. `20260902160000`.

```sql
-- A report identified by its columns rather than by the name a provider writes
-- on the tab. See ADR 0046.

alter table public.integration_report_packages
  add column structure_version integer not null default 1 check (structure_version = 1),
  add column structure_fingerprint text
    check (structure_fingerprint is null or structure_fingerprint ~ '^[a-f0-9]{64}$');

comment on column public.integration_report_packages.structure_fingerprint is
  'Versioned SHA-256 over workbook structure with worksheet names, report type and currency excluded, so one approval covers every month a provider issues the same report. Never contains workbook values, filenames, or PII.';

create index integration_report_packages_structure_lookup_idx
  on public.integration_report_packages (organization_id, channel_id, structure_fingerprint)
  where structure_fingerprint is not null;

-- The old five-argument signature is dropped after the new one exists, so a
-- worker mid-deploy never finds neither.
create or replace function public.complete_governed_report_package_profiling(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_claim_token uuid,
  p_content_sha256 text,
  p_schema_fingerprint text,
  p_structure_fingerprint text,
  p_sheets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
-- PASTE the body read in Step 5 here, with exactly two changes:
--   1. add to the opening validation block:
--        or p_structure_fingerprint !~ '^[a-f0-9]{64}$'
--   2. in the `update public.integration_report_packages set ...` statement,
--      add: structure_fingerprint = p_structure_fingerprint,
$function$;

revoke all on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, text, text, jsonb) to service_role;

drop function if exists public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, text, jsonb);
```

Then read the live `private.prevent_report_package_mutation` and forward-replace it with one added clause, so a recorded fingerprint cannot be rewritten:

```sql
  if old.structure_fingerprint is not null
    and new.structure_fingerprint is distinct from old.structure_fingerprint then
    raise exception 'report_package_structure_fingerprint_is_immutable' using errcode = '23514';
  end if;
```

and add `structure_version` to the existing context-immutability disjunction:

```sql
    or new.structure_version is distinct from old.structure_version
```

- [ ] **Step 7: Dry-run, then push**

```bash
pnpm db:migrations:dry-run
pnpm db:migrations:push
```
Expected: the new migration applies. A pushed migration is live for everyone immediately.

- [ ] **Step 8: Call the new function once against staging**

Non-negotiable. plpgsql binds record fields at execution time, so a body referencing a column that does not exist applies cleanly and fails on first call. Upload one small report through the normal path, or invoke the function directly with a claimed package, and confirm `structure_fingerprint` lands.

- [ ] **Step 9: Pass the fingerprint through the worker**

In `src/trigger/reports.ts`, the profiling task's `complete`, add:

```ts
          p_structure_fingerprint: input.structureFingerprint,
```

- [ ] **Step 10: Type the new columns by hand**

In `src/lib/supabase/database.types.ts`, in `integration_report_packages.Row`, after `schema_fingerprint: string | null;`:

```ts
          structure_version: number;
          structure_fingerprint: string | null;
```

- [ ] **Step 11: Add pgTAP coverage**

In `supabase/tests/database/governed_report_packages_test.sql`, raise the `plan(N)` count by 2 and add:

```sql
select extensions.has_column('public', 'integration_report_packages', 'structure_fingerprint',
  'packages retain a worksheet-name-free structure fingerprint');
select extensions.has_column('public', 'integration_report_packages', 'structure_version',
  'packages record which structure algorithm produced that fingerprint');
```

- [ ] **Step 12: Run everything**

```bash
pnpm vitest run src/workflows/reports src/domain/reports
pnpm typecheck && pnpm lint
pnpm db:test
```
Expected: all green.

- [ ] **Step 13: Commit**

```bash
git add supabase/migrations src/workflows/reports/profile-report-package.ts src/workflows/reports/profile-report-package.test.ts src/trigger/reports.ts src/lib/supabase/database.types.ts supabase/tests/database/governed_report_packages_test.sql
git commit -m "feat(reports): record what makes two uploads the same report

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: A CSV date is still a date

**Files:**
- Modify: `src/domain/reports/period-key.ts:127-133`
- Test: `src/domain/reports/period-key.test.ts`
- Test: `src/domain/reports/provider-library/talabat-performance.real-export.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: no signature change. `parsePeriodKey` accepts `YYYY-MM-DD` text under every encoding.

- [ ] **Step 1: Write the failing tests**

Add to `src/domain/reports/period-key.test.ts`:

```ts
describe("unambiguous ISO text", () => {
  // Talabat exports the same report as XLSX and as CSV. The XLSX carries a
  // spreadsheet date cell, so the contract declares `excel_serial`; the CSV
  // writes `2026-01-01` as text. One recipe, two encodings, and the CSV was
  // refused outright.
  it("is read under an excel_serial declaration", () => {
    expect(parsePeriodKey("2026-01-01", "excel_serial")).toBe("2026-01-01");
  });

  it("is read under a compact_date declaration", () => {
    expect(parsePeriodKey("2026-01-31", "compact_date")).toBe("2026-01-31");
  });

  it("still rejects an impossible day", () => {
    expect(() => parsePeriodKey("2026-02-31", "excel_serial")).toThrow(/INVALID_LOCAL_DATE/);
  });

  it("does not make an ambiguous form guessable", () => {
    // The third of April or the fourth of March. No amount of cleverness can
    // tell which, so the declaration still governs.
    expect(() => parsePeriodKey("03/04/2026", "excel_serial")).toThrow(/INVALID_LOCAL_DATE/);
  });

  it("leaves a real serial working", () => {
    expect(parsePeriodKey(46023, "excel_serial")).toBe("2026-01-01");
  });

  it("does not swallow a compact date that is not ISO", () => {
    expect(parsePeriodKey("20260131", "compact_date")).toBe("2026-01-31");
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run src/domain/reports/period-key.test.ts`
Expected: FAIL on the first two — `Number("2026-01-01")` is `NaN`.

- [ ] **Step 3: Add the branch**

In `src/domain/reports/period-key.ts`, immediately after `const text = String(value).trim();`:

```ts
  // An unambiguous form is read whatever the contract declares.
  //
  // The declaration exists because `03/04/2026` is the third of April or the
  // fourth of March depending on who exported it, and nothing in the value can
  // say which. `YYYY-MM-DD` has no second reading anywhere, so refusing it
  // under a declaration drafted from the same provider's spreadsheet export is
  // pedantry rather than rigour -- and it refused a real client's CSV.
  const iso = ISO.exec(text);
  if (iso) return fromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
```

- [ ] **Step 4: Run and confirm they pass**

Run: `pnpm vitest run src/domain/reports/period-key.test.ts`
Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Prove it against the real CSV**

Add to `src/domain/reports/provider-library/talabat-performance.real-export.test.ts`, following the file's existing pattern for loading and projecting a fixture:

```ts
it("projects the CSV export of the same report", async () => {
  // The file that failed for a live client with INVALID_LOCAL_DATE. Same
  // report, same recipe, dates written as text because a CSV has no cells.
  const rows = await readCsvFixture("fixtures/raw/Talabat/Jan-2026.csv");
  const result = projectPeriodGrain({
    contract: talabatPerformance.contract,
    projection: talabatPerformance.projection,
    sheets: rows,
    context: { periodStart: "2026-01-01", periodEnd: "2026-01-31" },
  });
  expect(result.observations.length).toBeGreaterThan(0);
  expect(result.observations.every((observation) => observation.periodKey.startsWith("2026-01"))).toBe(true);
});
```

Match the helper names the file already uses; do not introduce a second fixture loader.

- [ ] **Step 6: Run the real-export suite**

Run: `pnpm vitest run src/domain/reports/provider-library`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/reports/period-key.ts src/domain/reports/period-key.test.ts src/domain/reports/provider-library/talabat-performance.real-export.test.ts
git commit -m "fix(reports): read a date the provider wrote plainly

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: A refused label says which label

**Files:**
- Modify: `src/domain/reports/projection-error.ts`
- Modify: `src/domain/reports/projection.ts:588-604`
- Test: `src/domain/reports/projection.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class ReportCategoricalValueNotDeclared extends ReportProjectionError` with readonly `outputKey: string`, `value: string`, `periodKeys: readonly string[]`. Task 11's UI parses the recorded detail; `failureDetail` in `project-report-package.ts:335` already composes `name: code: message`, so the message must carry the useful part.

- [ ] **Step 1: Write the failing test**

Add to `src/domain/reports/projection.test.ts`:

```ts
it("names the label it refused and the days it appeared on", () => {
  // Talabat's March export carries the cancellation reason CLOSED, which the
  // approved figures do not declare. Refusing is right. Refusing without
  // saying what offended is what sent a live operator to the code.
  let thrown: unknown;
  try {
    projectPeriodGrain({
      contract: talabatPerformance.contract,
      projection: talabatPerformance.projection,
      sheets: sheetsWithCancellationReason("CLOSED", ["2026-03-04", "2026-03-11"]),
      context: { periodStart: "2026-03-01", periodEnd: "2026-03-31" },
    });
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ReportCategoricalValueNotDeclared);
  const failure = thrown as ReportCategoricalValueNotDeclared;
  expect(failure.code).toBe("CATEGORICAL_VALUE_NOT_DECLARED");
  expect(failure.value).toBe("CLOSED");
  expect(failure.outputKey).toBe("avoidable_cancel_reason");
  expect(failure.periodKeys).toEqual(["2026-03-04", "2026-03-11"]);
  // failureDetail() joins name, code and message. Today all three are the code.
  expect(failure.message).toContain("CLOSED");
  expect(failure.message).toContain("avoidable_cancel_reason");
});
```

Build `sheetsWithCancellationReason` from the fixture helpers the file already has.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run src/domain/reports/projection.test.ts`
Expected: FAIL — `ReportCategoricalValueNotDeclared` is not exported.

- [ ] **Step 3: Add the error class**

In `src/domain/reports/projection-error.ts`, after `ReportControlTotalMismatch`:

```ts
/**
 * A categorical column carried a label the approved figures do not declare.
 *
 * Carries the label rather than only a code, for the reason ADR 0029 gives for
 * `ReportControlTotalMismatch`: the useful part is the difference. An operator
 * told "CLOSED, on 4 and 11 March, is not a declared cancellation reason" can
 * decide in seconds. An operator told "CATEGORICAL_VALUE_NOT_DECLARED" opens
 * the source.
 */
export class ReportCategoricalValueNotDeclared extends ReportProjectionError {
  constructor(
    public readonly outputKey: string,
    public readonly value: string,
    /** Every period the undeclared label appears on, in ascending order. */
    public readonly periodKeys: readonly string[],
  ) {
    super("CATEGORICAL_VALUE_NOT_DECLARED");
    this.name = "ReportCategoricalValueNotDeclared";
    this.message = `${outputKey}: ${value} is not a declared value (${periodKeys.join(", ")})`;
  }
}
```

- [ ] **Step 4: Throw it from the projector**

In `src/domain/reports/projection.ts`, the three raise sites at 593, 599 and 603 currently throw the bare error. Each is inside a per-row loop, so the offending periods must be collected before refusing rather than thrown on the first row. Restructure the categorical pass to two phases: gather `Map<string, string[]>` of undeclared value to period keys across all rows, then, if the map is non-empty, throw once for the lowest-sorted value with its collected periods. Keep the existing behaviour that an undeclared label refuses the whole projection.

- [ ] **Step 5: Run and confirm they pass**

Run: `pnpm vitest run src/domain/reports/projection.test.ts`
Expected: PASS, with every existing projection test still green.

- [ ] **Step 6: Prove the March file reports its label**

Add to `src/domain/reports/provider-library/talabat-performance.real-export.test.ts`:

```ts
it("refuses the March export by name", async () => {
  const rows = await readXlsxFixture("fixtures/raw/Talabat/Mar-2026.xlsx");
  expect(() =>
    projectPeriodGrain({
      contract: talabatPerformance.contract,
      projection: talabatPerformance.projection,
      sheets: rows,
      context: { periodStart: "2026-03-01", periodEnd: "2026-03-31" },
    }),
  ).toThrow(/CLOSED/);
});
```

- [ ] **Step 7: Run and commit**

```bash
pnpm vitest run src/domain/reports
pnpm typecheck && pnpm lint
git add src/domain/reports/projection-error.ts src/domain/reports/projection.ts src/domain/reports/projection.test.ts src/domain/reports/provider-library/talabat-performance.real-export.test.ts
git commit -m "fix(reports): say which label was refused, and on which days

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: A refusal reads as a failure

**Files:**
- Modify: `src/trigger/reports.ts` (all three tasks)
- Test: `src/trigger/reports.test.ts` (create if absent; otherwise extend)

**Interfaces:**
- Consumes: nothing.
- Produces: no signature change. `{ outcome: "failed" }` from a workflow becomes a thrown `AbortTaskRunError`.

- [ ] **Step 1: Write the failing test**

```ts
import { AbortTaskRunError } from "@trigger.dev/sdk";

it("fails the run without retrying when a projection is refused", async () => {
  // Three runs reported Completed to a live operator while their output said
  // failed. Retrying an unparseable date three times helps nobody, so the
  // refusal must fail loudly and once.
  await expect(
    reportPackageProjectionTask.run(projectionPayload(), runContext()),
  ).rejects.toBeInstanceOf(AbortTaskRunError);
});
```

Follow the mocking pattern in the existing trigger tests (`src/trigger/integrations.test.ts` is the closest model).

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run src/trigger/reports.test.ts`
Expected: FAIL — the task resolves with `{ outcome: "failed" }`.

- [ ] **Step 3: Raise the refusal**

In `src/trigger/reports.ts`, extend the SDK import:

```ts
import { AbortTaskRunError, logger, schemaTask } from "@trigger.dev/sdk";
```

In each of the three tasks, after the existing `logger.info(...)` and before `return result;`:

```ts
    // The state transition is already recorded by the RPC above, so the
    // database is correct either way. This is only about what the run list
    // says. A governed refusal is permanent -- a date that will not parse will
    // not parse on the third attempt -- so it aborts rather than retries.
    if (result.outcome === "failed") {
      throw new AbortTaskRunError(`report-package refused: ${payload.packageId}`);
    }
```

Keep the payload id only. The failure code lives on the package row and the run record; a label is not the place for report content.

- [ ] **Step 4: Run and confirm it passes**

Run: `pnpm vitest run src/trigger/reports.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/trigger/reports.ts src/trigger/reports.test.ts
git commit -m "fix(reports): stop a refused import reporting itself as completed

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: The admissions table

**Files:**
- Create: `supabase/migrations/<timestamp>_report_structure_admissions.sql`
- Create: `supabase/tests/database/governed_report_structure_admissions_test.sql`
- Modify: `src/lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: `structure_fingerprint` from Task 2.
- Produces: table `public.report_structure_admissions`; RPCs `public.grant_governed_report_structure_admission(p_organization_id uuid, p_actor_id uuid, p_report_package_id uuid, p_report_contract_version_id uuid, p_report_projection_version_id uuid, p_report_family_key text, p_idempotency_key text, p_correlation_id uuid) returns jsonb` and `public.revoke_governed_report_structure_admission(p_organization_id uuid, p_actor_id uuid, p_admission_id uuid, p_correlation_id uuid) returns jsonb`. Tasks 7–9 and 12 use them.

- [ ] **Step 1: Write the failing pgTAP suite**

Create `supabase/tests/database/governed_report_structure_admissions_test.sql`:

```sql
begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(12);

select extensions.has_table('public', 'report_structure_admissions',
  'standing report admissions exist');
select extensions.has_column('public', 'report_structure_admissions', 'structure_fingerprint',
  'an admission is keyed on the structure it admits');
select extensions.has_column('public', 'report_structure_admissions', 'granted_by',
  'an admission names the person who granted it');
select extensions.has_column('public', 'report_structure_admissions', 'revoked_at',
  'an admission can be revoked without being deleted');
select extensions.has_column('public', 'integration_report_packages', 'admitted_under_admission_id',
  'an import records the authorisation that admitted it');

select extensions.ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.report_structure_admissions'::regclass),
  'admissions enforce RLS'
);
select extensions.ok(
  (select relforcerowsecurity from pg_catalog.pg_class
   where oid = 'public.report_structure_admissions'::regclass),
  'admissions force RLS'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.report_structure_admissions', 'insert'),
  'authenticated users cannot insert an admission directly'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.report_structure_admissions', 'update'),
  'authenticated users cannot rewrite an admission directly'
);
select extensions.has_function('public', 'grant_governed_report_structure_admission',
  'granting an admission goes through a governed function');
select extensions.has_function('public', 'revoke_governed_report_structure_admission',
  'revoking an admission goes through a governed function');
select extensions.ok(
  (select count(*) from pg_catalog.pg_indexes
   where schemaname = 'public'
     and tablename = 'report_structure_admissions'
     and indexdef ilike '%unique%active%') >= 1,
  'at most one active admission exists per structure, channel and currency'
);

select * from extensions.finish();
rollback;
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm db:test`
Expected: FAIL — the table does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/<timestamp>_report_structure_admissions.sql`:

```sql
-- A standing, revocable permission to read one report structure. See ADR 0046.
--
-- The alternative was writing a proposal and an approval per upload on the
-- uploader's behalf. That records approvals that never happened and leaves
-- nothing to revoke, so reuse is authorised once, by a named person, instead.

create table public.report_structure_admissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  channel_id uuid not null,
  structure_fingerprint text not null check (structure_fingerprint ~ '^[a-f0-9]{64}$'),
  structure_version integer not null check (structure_version = 1),
  declared_currency text not null check (declared_currency ~ '^[A-Z]{3}$'),
  outlet_grain text not null check (outlet_grain = 'branch'),
  -- Inherited by every package admitted under this grant, so the reuse key
  -- stops depending on what an operator typed that day.
  report_type text not null check (char_length(report_type) between 2 and 120),
  -- The shipped library family, when one was recognised. Null for a mapping an
  -- operator built themselves, which is never offered to another tenant.
  report_family_key text check (report_family_key is null or char_length(report_family_key) between 2 and 120),
  report_contract_version_id uuid not null,
  report_projection_version_id uuid not null,
  active boolean not null default true,
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  correlation_id uuid not null,
  unique (organization_id, id),
  foreign key (organization_id, channel_id)
    references public.organization_channels(organization_id, id) on delete restrict,
  foreign key (organization_id, report_contract_version_id)
    references public.report_contract_versions(organization_id, id) on delete restrict,
  foreign key (organization_id, report_projection_version_id)
    references public.report_projection_versions(organization_id, id) on delete restrict,
  check ((revoked_by is null) = (revoked_at is null)),
  check (active or revoked_at is not null)
);

create unique index report_structure_admissions_active_tuple_idx
  on public.report_structure_admissions (
    organization_id, channel_id, structure_fingerprint, declared_currency, outlet_grain
  ) where active;

comment on table public.report_structure_admissions is
  'One durable, revocable grant: for this organization and channel, a file of this structure and currency is read using this approved contract and projection version. Revoking returns the structure to per-upload approval and rewrites no figure.';

alter table public.integration_report_packages
  add column admitted_under_admission_id uuid,
  add constraint integration_report_packages_admission_fk
    foreign key (organization_id, admitted_under_admission_id)
    references public.report_structure_admissions(organization_id, id) on delete restrict;

alter table public.report_structure_admissions enable row level security;
alter table public.report_structure_admissions force row level security;

revoke all on table public.report_structure_admissions from public, anon, authenticated;
grant select on table public.report_structure_admissions to authenticated;

-- Follow the hoisted-permission pattern introduced on 2026-08-31 in
-- 20260831130000_hoist_report_rls_permission_checks.sql. Read that migration
-- and mirror its policy shape exactly rather than writing a fresh predicate.
create policy "members with report read can view structure admissions"
  on public.report_structure_admissions
  for select to authenticated
  using (private.has_organization_permission(organization_id, 'report.read'));
```

Then both RPCs in the same migration. `grant_...` must:
1. refuse unless `auth.uid() = p_actor_id` and `private.has_organization_permission(p_organization_id, 'report.contract_approve')`;
2. load the package and refuse if `structure_fingerprint` is null;
3. refuse unless an approved `report_contract_decisions` row and an approved `report_projection_decisions` row exist for the two version ids;
4. refuse unless the contract version's `declared_currency` equals the package's, with errcode `23514`;
5. deactivate any existing active row for the tuple (setting `revoked_by`/`revoked_at`), then insert the new one;
6. insert `audit_events` with action `report.structure_admitted`, mirroring the two existing inserts in `20260820182522_governed_report_contracts.sql:334` and `:363`;
7. be idempotent on `p_idempotency_key` using the `private.report_contract_write_operations` pattern.

`revoke_...` requires the same permission, sets `active = false`, `revoked_by`, `revoked_at`, and writes `report.structure_admission_revoked`.

- [ ] **Step 4: Dry-run and push**

```bash
pnpm db:migrations:dry-run
pnpm db:migrations:push
```

- [ ] **Step 5: Call both functions once against staging**

Required, per the global constraints. Grant an admission for a package that already has approved contract and projection versions, confirm the row and the audit event, then revoke it and confirm `active = false`.

- [ ] **Step 6: Run the pgTAP suite**

Run: `pnpm db:test`
Expected: 12 passing assertions in the new suite, no regressions elsewhere.

- [ ] **Step 7: Type the table by hand**

Add to `src/lib/supabase/database.types.ts` in alphabetical position among the report tables, following the `report_contract_bindings` shape at line 745 (`Insert: never; Update: never; Relationships: [];`), with every column above. Add `admitted_under_admission_id: string | null;` to `integration_report_packages.Row`.

- [ ] **Step 8: Confirm the type-drift guard passes**

Run: `pnpm vitest run src/lib/supabase/database.types.test.ts`
Expected: PASS. If it fails naming a `growth_intelligence_*` table, that is the other agent's unapplied migration — leave it and say so; do not add their tables to `UNTYPED_TABLES`.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations supabase/tests/database/governed_report_structure_admissions_test.sql src/lib/supabase/database.types.ts
git commit -m "feat(reports): let an organization authorise a report structure once

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Validation admits a package on a standing admission

**Files:**
- Create: `supabase/migrations/<timestamp>_admit_package_on_standing_admission.sql`
- Modify: `supabase/tests/database/governed_report_validation_test.sql`

**Interfaces:**
- Consumes: the admissions table from Task 6.
- Produces: `claim_governed_report_package_validation` accepts a package whose contract version comes from a matching active admission. Task 9 relies on it.

- [ ] **Step 1: Add the failing pgTAP assertions**

In `supabase/tests/database/governed_report_validation_test.sql`, raise `plan(N)` by 4 and add assertions that:
- a package with no per-package contract version but a matching active admission claims successfully;
- the same package with the admission revoked returns `not_ready`;
- an admission belonging to a different organization does not admit (seed two organizations and assert the claim returns `not_ready`);
- an admission whose `declared_currency` differs from the package's returns `not_ready`.

Follow the seeding helpers already in that file.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm db:test`
Expected: FAIL on all four.

- [ ] **Step 3: Read the live claim function**

```sql
select pg_get_functiondef(
  'public.claim_governed_report_package_validation(uuid, uuid, uuid, uuid, text, uuid)'::regprocedure
);
```

Confirm the argument list from `\df claim_governed_report_package_validation` first; do not trust the signature written here.

- [ ] **Step 4: Write the migration**

Forward-replace the claim, carrying the body verbatim except for the version resolution. Today it reads:

```sql
  select * into version_row from public.report_contract_versions
  where organization_id = p_organization_id and id = p_report_contract_version_id and report_package_id = p_report_package_id;
  if not found or not exists (select 1 from public.report_contract_decisions d where ...) then
    return jsonb_build_object('outcome', 'not_ready');
  end if;
```

Replace with: try the per-package version exactly as above; if it is not found, fall back to a matching active admission —

```sql
  -- Second admissible path. Either a mapping approved against this exact
  -- upload, as before, or a standing admission a person granted for this
  -- structure. See ADR 0046. Everything below this point is unchanged: the
  -- binding, currency, channel, report type and object identity checks all
  -- still run, so an admission shortens the ceremony and loosens no invariant.
  if not found then
    select * into admission_row from public.report_structure_admissions
    where organization_id = p_organization_id
      and channel_id = package_row.channel_id
      and structure_fingerprint = package_row.structure_fingerprint
      and declared_currency = package_row.declared_currency
      and outlet_grain = 'branch'
      and active;
    if not found or package_row.structure_fingerprint is null then
      return jsonb_build_object('outcome', 'not_ready');
    end if;
    select * into version_row from public.report_contract_versions
    where organization_id = p_organization_id and id = admission_row.report_contract_version_id;
    if not found then return jsonb_build_object('outcome', 'not_ready'); end if;
  end if;
```

Declare `admission_row public.report_structure_admissions;` in the `declare` block.

**Important:** the block further down compares `package_row.schema_fingerprint` to `version_row.schema_fingerprint` and to `binding_row.schema_fingerprint`. Under an admission those legitimately differ — that is the entire point. Guard those three comparisons so they apply only on the per-package path, and on the admission path assert instead that `package_row.structure_fingerprint = admission_row.structure_fingerprint` and that `package_row.declared_currency = admission_row.declared_currency`. Leave every other comparison untouched.

Then forward-replace `private.prevent_report_package_mutation` to admit the automatic transition and protect the new column:

```sql
    -- An admitted package skips `awaiting_approval` because there is nothing
    -- left to approve: a person approved this structure already.
    or (old.status = 'awaiting_contract' and new.status in ('awaiting_contract', 'awaiting_approval', 'awaiting_validation'))
```

and, in the immutability block:

```sql
  if old.admitted_under_admission_id is not null
    and new.admitted_under_admission_id is distinct from old.admitted_under_admission_id then
    raise exception 'report_package_admission_is_immutable' using errcode = '23514';
  end if;
```

- [ ] **Step 5: Dry-run and push**

```bash
pnpm db:migrations:dry-run
pnpm db:migrations:push
```

- [ ] **Step 6: Call the claim once against staging**

Required. Claim a real package through the admission path and confirm it returns `acquired` with the admission's contract version.

- [ ] **Step 7: Run pgTAP**

Run: `pnpm db:test`
Expected: all four new assertions pass; the whole governed-report suite stays green, especially the existing per-package-approval assertions.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations supabase/tests/database/governed_report_validation_test.sql
git commit -m "feat(reports): admit an upload on the approval its structure already has

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: The application service and the grant route

**Files:**
- Create: `src/modules/reports/application/admissions.ts`
- Create: `src/modules/reports/application/admissions.test.ts`
- Create: `src/app/api/organizations/[organizationId]/report-packages/[packageId]/admission/route.ts`
- Create: `src/app/api/organizations/[organizationId]/report-packages/[packageId]/admission/route.test.ts`
- Modify: `src/modules/reports/application/ports.ts`

**Interfaces:**
- Consumes: the RPCs from Task 6.
- Produces:
  - `createAdmissionService(client: SupabaseClient<Database>): AdmissionService` — the factory, matching the shape of `createReportService` in `service.ts`. Everything below is a method on the returned object.
  - `findActiveAdmission(input: { organizationId: string; channelId: string; structureFingerprint: string; declaredCurrency: string }): Promise<ReportStructureAdmission | null>`
  - `grantAdmission(input: { organizationId: string; actorId: string; packageId: string; contractVersionId: string; projectionVersionId: string; reportFamilyKey: string | null; correlationId: string }): Promise<ReportStructureAdmission>`
  - `type ReportStructureAdmission = { id: string; channelId: string; structureFingerprint: string; reportType: string; reportFamilyKey: string | null; contractVersionId: string; projectionVersionId: string; grantedBy: string; grantedAt: string }`
  - Task 9 calls `findActiveAdmission`; Task 10's UI posts to the route.

- [ ] **Step 1: Write the failing service test**

```ts
it("returns no admission when the structure was never granted", async () => {
  const service = createAdmissionService(fakeClient({ rows: [] }));
  await expect(
    service.findActiveAdmission({
      organizationId: ORGANIZATION_ID,
      channelId: CHANNEL_ID,
      structureFingerprint: "a".repeat(64),
      declaredCurrency: "AED",
    }),
  ).resolves.toBeNull();
});

it("never returns another organization's grant", async () => {
  // The database refuses this too. Asserting it here as well means a future
  // refactor that drops the organization filter fails in unit tests rather
  // than silently relying on RLS to catch it.
  const service = createAdmissionService(
    fakeClient({ rows: [admissionRow({ organization_id: OTHER_ORGANIZATION_ID })] }),
  );
  await expect(
    service.findActiveAdmission({
      organizationId: ORGANIZATION_ID,
      channelId: CHANNEL_ID,
      structureFingerprint: "a".repeat(64),
      declaredCurrency: "AED",
    }),
  ).resolves.toBeNull();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run src/modules/reports/application/admissions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Follow `src/modules/reports/application/service.ts` for shape: a factory taking an authenticated Supabase client, returning plain functions, with domain errors from `@/lib/errors` rather than generic throws. Reads go through the authenticated client so RLS applies; writes call the RPCs from Task 6.

- [ ] **Step 4: Run and confirm it passes**

Run: `pnpm vitest run src/modules/reports/application/admissions.test.ts`

- [ ] **Step 5: Write the failing route test**

Assert that:
- an operator role (has `report.upload`, not `report.contract_approve`) receives 403;
- an admin receives 200 and the response names the admission;
- a package with a null `structure_fingerprint` receives 409 with a message saying the upload has not been profiled yet.

Model it on `src/app/api/organizations/[organizationId]/report-packages/[packageId]/contract-proposals/route.ts` and its neighbours.

- [ ] **Step 6: Implement the route**

`POST` orchestrates, in order, the existing RPCs — `propose_governed_report_contract`, `decide_governed_report_contract`, `propose_governed_report_projection`, `decide_governed_report_projection` — then `grant_governed_report_structure_admission`. Each already carries its own idempotency key; derive all five deterministically from the package id so a double-click cannot produce a second set of versions. On a partial failure, return the error and leave the package on today's manual path; every step written so far is a valid governed record on its own.

- [ ] **Step 7: Run everything and commit**

```bash
pnpm vitest run src/modules/reports src/app/api/organizations
pnpm typecheck && pnpm lint
git add src/modules/reports src/app/api/organizations/\[organizationId\]/report-packages
git commit -m "feat(reports): grant a structure admission in one approval

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Upload, and it projects

**Files:**
- Modify: `src/modules/reports/application/dispatch.ts`
- Modify: `src/trigger/reports.ts` (profiling and validation tasks)
- Test: `src/modules/reports/application/dispatch.test.ts`

**Interfaces:**
- Consumes: `findActiveAdmission` from Task 8; `requestReportPackageValidation` and `requestReportPackageProjection`, both already exported from `dispatch.ts`.
- Produces: `continueAdmittedReportPackage(input, collaborators): Promise<"admitted" | "awaiting_approval">`, where `input` is `{ organizationId: string; packageId: string; correlationId: string }` and `collaborators` is the injected seam `{ findActiveAdmission: (input: { organizationId: string; packageId: string }) => Promise<ReportStructureAdmission | null>; requestValidation: (input: { organizationId: string; packageId: string; contractVersionId: string; correlationId: string }) => Promise<boolean> }`. In production the seam is filled by Task 8's service and by `requestReportPackageValidation` from this same file; the parameter exists so this function is testable without Trigger.

- [ ] **Step 1: Write the failing test**

```ts
it("starts validation itself when the structure is already admitted", async () => {
  const dispatched: string[] = [];
  const outcome = await continueAdmittedReportPackage(
    { organizationId: ORGANIZATION_ID, packageId: PACKAGE_ID, correlationId: CORRELATION_ID },
    { findActiveAdmission: async () => admission(), requestValidation: async (input) => {
      dispatched.push(input.contractVersionId);
      return true;
    } },
  );
  expect(outcome).toBe("admitted");
  expect(dispatched).toEqual([admission().contractVersionId]);
});

it("waits for a person when the structure has never been admitted here", async () => {
  const dispatched: string[] = [];
  const outcome = await continueAdmittedReportPackage(
    { organizationId: ORGANIZATION_ID, packageId: PACKAGE_ID, correlationId: CORRELATION_ID },
    { findActiveAdmission: async () => null, requestValidation: async () => {
      dispatched.push("should not happen");
      return true;
    } },
  );
  expect(outcome).toBe("awaiting_approval");
  expect(dispatched).toEqual([]);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run src/modules/reports/application/dispatch.test.ts`

- [ ] **Step 3: Implement the chain**

Add `continueAdmittedReportPackage` to `dispatch.ts`, taking its collaborators as an injected second argument so it stays testable without Trigger. Call it from the profiling task in `src/trigger/reports.ts` immediately after a successful `complete`, and call `requestReportPackageProjection` from the validation task after an outcome of `validated`.

Guard both on the existing feature flags (`isGovernedReportValidationEnabled`, `isGovernedReportProjectionEnabled`) exactly as the existing dispatch functions do.

- [ ] **Step 4: Run and confirm they pass**

Run: `pnpm vitest run src/modules/reports src/trigger`

- [ ] **Step 5: Commit**

```bash
git add src/modules/reports/application/dispatch.ts src/modules/reports/application/dispatch.test.ts src/trigger/reports.ts
git commit -m "feat(reports): carry an admitted upload through to its figures

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: One screen, one Approve

**Files:**
- Create: `src/components/integrations/report-admission-approval.tsx`
- Create: `src/components/integrations/report-admission-approval.test.tsx`
- Modify: `src/components/integrations/report-package-upload.tsx:764-774` (the report-type field) and the step that currently renders `ReportIntakeMapping`

**Interfaces:**
- Consumes: the route from Task 8; the existing `recognised-families` route.
- Produces: `<ReportAdmissionApproval organizationId packageId family canApprove onAdmitted />`.

- [ ] **Step 1: Write the failing component test**

Assert that the screen:
- names the report family and lists the figures it will read, from `describeMetrics` in `@/domain/reports/provider-library/copy`;
- renders a single Approve button when the viewer has `report.contract_approve`;
- renders, instead of that button, a sentence saying an owner or admin must admit this report once, when they do not;
- disables the button while the request is in flight.

Follow `src/components/integrations/report-intake-mapping.test.tsx` for harness and query conventions.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm vitest run src/components/integrations/report-admission-approval.test.tsx`

- [ ] **Step 3: Build the component**

A server-data-driven client component using `useMutation`, matching the existing `report-intake-mapping.tsx` idiom. Copy must state plainly what the approval authorises: this report, this channel, from now on, revocable. Industry-neutral nouns only.

- [ ] **Step 4: Derive the report type**

In `report-package-upload.tsx`, when the recognition query returns at least one family, replace the free-text `Report type` input with the family's `reportType`, rendered as read-only text naming the recognised report. Keep the text input as the fallback when nothing is recognised. A reuse key with a hand-typed component is not a key.

- [ ] **Step 5: Run and confirm they pass**

Run: `pnpm vitest run src/components/integrations`

- [ ] **Step 6: Verify in a browser**

Not optional. Exercise the flow at 1440px and an emulated 390px via Chrome DevTools: upload, see the one screen, approve, watch the package reach `projected`. If the Chrome DevTools MCP is unavailable, stop and report that rather than claiming the task is done.

- [ ] **Step 7: Commit**

```bash
git add src/components/integrations
git commit -m "feat(reports): ask once, in one screen, what a report will read

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Declare a label the provider wrote

**Files:**
- Create: `supabase/migrations/<timestamp>_declare_projection_categorical_value.sql`
- Modify: `src/components/integrations/report-package-upload.tsx` (the projection-failure panel)
- Test: `src/components/integrations/report-package-upload.test.tsx`

**Interfaces:**
- Consumes: `ReportCategoricalValueNotDeclared`'s recorded detail from Task 4.
- Produces: RPC `public.propose_governed_report_projection_with_declared_value(p_organization_id uuid, p_actor_id uuid, p_report_projection_version_id uuid, p_output_key text, p_value text, p_idempotency_key text, p_correlation_id uuid) returns jsonb`, returning the new projection version for the operator to approve.

- [ ] **Step 1: Write the failing pgTAP assertion**

In `supabase/tests/database/governed_report_projection_document_test.sql`, raise the plan by 2 and assert that the function exists and that the version it produces differs from its parent only by the added value in that output's `allowedValues`.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm db:test`

- [ ] **Step 3: Write the migration**

The function requires `report.contract_approve`, reads the parent projection document, appends `p_value` to the named output's `categorical.allowedValues` (refusing with errcode `23514` if that output has no `categorical` block, or if the value is already declared), recomputes the projection digest the same way the existing propose RPC does, and inserts a new `report_projection_versions` row with `proposal_source = 'human'`. It grants nothing: the operator still approves the new version through the existing decision RPC.

- [ ] **Step 4: Push, call once against staging, run pgTAP**

```bash
pnpm db:migrations:dry-run && pnpm db:migrations:push
pnpm db:test
```

- [ ] **Step 5: Surface it in the failure panel**

The panel currently prints the raw failure detail. Parse the recorded `outputKey: value (dates)` shape from Task 4 and render: the label, the dates it appears on, and a button reading `Declare "<value>" as a value we count`. On success, show the new version in the existing approval control rather than approving it silently.

- [ ] **Step 6: Run, verify in the browser, commit**

```bash
pnpm vitest run src/components/integrations
pnpm typecheck && pnpm lint
git add supabase/migrations src/components/integrations supabase/tests/database/governed_report_projection_document_test.sql
git commit -m "feat(reports): let an operator name a label the provider wrote

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 12: Carry forward what is already approved

**Files:**
- Create: `scripts/backfill-report-structure-admissions.mjs`

**Interfaces:**
- Consumes: `createReportStructureFingerprint`, the sheet manifests already in the database, and `grant_governed_report_structure_admission`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the reporting pass**

The script runs in two modes and defaults to the safe one. With no flag it reads every package that has an active contract binding and an active projection binding, recomputes the structure fingerprint from `integration_report_sheet_manifests`, groups them, and prints one line per admission it would grant: organization, channel, report type, family, fingerprint prefix, and how many past packages share it. It writes nothing.

Model the Supabase connection on the existing `scripts/*.mjs` in this repository.

- [ ] **Step 2: Run the report against staging and read it**

```bash
node scripts/backfill-report-structure-admissions.mjs
```

Check by eye that Nostaza's Talabat packages collapse into one row per channel. If four months produce four rows, the fingerprint is wrong — stop and fix Task 1 before granting anything.

- [ ] **Step 3: Add the writing pass**

Behind `--apply`, call `grant_governed_report_structure_admission` for each reported group, using the most recently approved contract and projection version in that group. Use a deterministic idempotency key per group so a re-run grants nothing twice. Print every grant.

- [ ] **Step 4: Apply, then verify**

```bash
node scripts/backfill-report-structure-admissions.mjs --apply
```

Then upload `fixtures/raw/Talabat/Mar-2026.xlsx` for Nostaza and confirm it reaches `projected` with no approval screen, and that its `admitted_under_admission_id` names the granted admission.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-report-structure-admissions.mjs
git commit -m "feat(reports): carry forward the approvals already given

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 13: Close the loop on documentation

**Files:**
- Modify: `specs/018-governed-channel-intelligence.md` §4.1.8
- Modify: `docs/collaboration/asset-library-and-studio-board.md`

- [ ] **Step 1: Mark the slice delivered**

Change §4.1.8's heading from `Planned` to `Delivered`, and record what was actually verified: which migrations are live on staging, which functions were called once against it, the pgTAP counts, and the browser widths exercised. State anything that was not verified, plainly.

- [ ] **Step 2: Add a board entry**

Say what was built, what the live re-upload of March proved, and anything the investigation ruled out. Use a path-limited `git add` — another agent has Growth Intelligence rows uncommitted in that same file.

- [ ] **Step 3: Full verification before claiming completion**

```bash
# Stop the dev server first.
pnpm test
pnpm typecheck && pnpm lint && pnpm format:check
pnpm db:test
```

Record the actual numbers. If anything fails, say so with the output rather than describing the work as done.

- [ ] **Step 4: Commit**

```bash
git add specs/018-governed-channel-intelligence.md docs/collaboration/asset-library-and-studio-board.md
git commit -m "docs(reports): record the delivered repeat-intake slice

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Not in this plan

Phase 2 gets its own plan once Phase 1 is live: the audit dispatching itself after a clean projection, window persistence and window-correct run selection on the channel page, and the Reports panel on the channel route. None of it is blocked by Phase 1 beyond wanting the ingestion path stable first.
