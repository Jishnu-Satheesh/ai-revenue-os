# Channels and Channel Economics Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the `Channels` and `Channel economics` destinations into one page named **Channels**, whose roll-up derives from analysis runs rather than the economics ledger, and give each channel its own page carrying Analysis and Setup tabs.

**Architecture:** Read-side and navigational only. One shared pure function computes the earned/lost/potential split for both the existing channel workspace and the new roll-up, so there is exactly one implementation of that arithmetic. Two read-port changes feed a new pure read-model builder, which the merged page renders. The economics module, its Trigger task and the Overview's economics card are untouched.

**Tech Stack:** Next.js App Router (server components), TypeScript strict, Zod, Supabase JS through the caller's session (RLS), Vitest + Testing Library, Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-28-channels-and-economics-merge-design.md`

## Global Constraints

- **No migration.** No table, column, RLS policy, RPC or `src/lib/supabase/database.types.ts` change in any task. If a task appears to need one, stop and escalate.
- **No service-role client** in any path this plan touches. All reads go through `context.supabase` (the caller's session) so RLS decides visibility.
- **TypeScript strict mode** is mandatory. No `any`, no non-null assertions added to satisfy the compiler.
- **Money is integer minor units with an ISO currency code.** Never a float, never a formatted string in a domain type.
- **Never state a realized business result** without baseline, attribution method and measurement window. The roll-up states reported gross and the provider's own recorded loss, both cited. It introduces no costing or margin claim.
- **A partial sum must state its coverage.** Any roll-up figure covering fewer than all channels names the count and the excluded channels.
- **Absence renders as an em-dash with its reason**, never as `0`. A zero reads as a measured result.
- **The destination is named `Channels`,** never `Marketplace`. Route stays `/organizations/[organizationId]/channels`.
- **Feature flag** `isGovernedChannelAnalysisEnabled(organizationId)` is enforced in the page read, never in navigation.
- Commit after every task. Run `pnpm typecheck` and the touched suites before each commit.

---

### Task 1: Extract the earned/lost/potential split into one shared function

The split currently lives inline inside `verdictInputs` in the analysis read model. The roll-up needs the identical arithmetic. Extracting it first means later tasks call one implementation rather than copying it.

**Files:**
- Create: `src/domain/analysis/money-split.ts`
- Create: `src/domain/analysis/money-split.test.ts`
- Modify: `src/modules/analysis/application/read-model.ts` (the `earnedLostPotential` block inside `verdictInputs`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export type AnalysisMoney = { minorUnits: number; currency: string }`
  - `export type EarnedLostPotential = { potential: AnalysisMoney | null; lost: AnalysisMoney | null; earned: AnalysisMoney | null }`
  - `export function splitEarnedLostPotential(input: { potential: AnalysisMoney | null; lost: AnalysisMoney | null }): EarnedLostPotential`

- [ ] **Step 1: Write the failing test**

Create `src/domain/analysis/money-split.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { splitEarnedLostPotential } from "@/domain/analysis/money-split";

const aed = (minorUnits: number) => ({ minorUnits, currency: "AED" });

describe("splitEarnedLostPotential", () => {
  it("subtracts the recorded loss from the reported gross", () => {
    expect(splitEarnedLostPotential({ potential: aed(55300), lost: aed(35700) })).toEqual({
      potential: aed(55300),
      lost: aed(35700),
      earned: aed(19600),
    });
  });

  it("refuses when the two figures are in different currencies", () => {
    expect(
      splitEarnedLostPotential({ potential: aed(55300), lost: { minorUnits: 100, currency: "USD" } }),
    ).toEqual({ potential: null, lost: null, earned: null });
  });

  it("refuses when the loss exceeds the gross, rather than stating a negative earned", () => {
    expect(splitEarnedLostPotential({ potential: aed(100), lost: aed(101) })).toEqual({
      potential: null,
      lost: null,
      earned: null,
    });
  });

  it("refuses when either half is absent", () => {
    expect(splitEarnedLostPotential({ potential: aed(100), lost: null })).toEqual({
      potential: null,
      lost: null,
      earned: null,
    });
    expect(splitEarnedLostPotential({ potential: null, lost: aed(100) })).toEqual({
      potential: null,
      lost: null,
      earned: null,
    });
  });

  it("states a zero earned when the loss exactly equals the gross", () => {
    // Boundary: potential >= lost admits equality, and a measured zero here is
    // a real result rather than an absence.
    expect(splitEarnedLostPotential({ potential: aed(100), lost: aed(100) })).toEqual({
      potential: aed(100),
      lost: aed(100),
      earned: aed(0),
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/domain/analysis/money-split.test.ts`
Expected: FAIL — `Failed to resolve import "@/domain/analysis/money-split"`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/analysis/money-split.ts`:

```ts
/**
 * The earned / lost / potential split, in one place.
 *
 * `potential` is the channel's reported gross revenue, `lost` is the provider's
 * own recorded rejection loss, and `earned` is potential minus lost. It is a
 * stated relationship between two already-cited figures, never a new
 * measurement, which is why it refuses rather than guesses whenever the two
 * figures cannot honestly be subtracted.
 *
 * The channel workspace and the organization-wide roll-up both call this. One
 * implementation is the point: two would drift, and the page would then show a
 * channel one number and its own total another.
 */

export type AnalysisMoney = { minorUnits: number; currency: string };

export type EarnedLostPotential = {
  potential: AnalysisMoney | null;
  lost: AnalysisMoney | null;
  earned: AnalysisMoney | null;
};

const REFUSED: EarnedLostPotential = { potential: null, lost: null, earned: null };

export function splitEarnedLostPotential(input: {
  potential: AnalysisMoney | null;
  lost: AnalysisMoney | null;
}): EarnedLostPotential {
  const { potential, lost } = input;
  // All three refusals state the same thing: these two figures cannot be
  // subtracted honestly, so no part of the split is offered. Returning a
  // partial split would let a caller render `potential` beside a blank
  // `earned` and imply the subtraction simply came to nothing.
  if (potential === null || lost === null) return REFUSED;
  if (potential.currency !== lost.currency) return REFUSED;
  if (potential.minorUnits < lost.minorUnits) return REFUSED;
  return {
    potential,
    lost,
    earned: { minorUnits: potential.minorUnits - lost.minorUnits, currency: potential.currency },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/domain/analysis/money-split.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Call the shared function from the read model**

In `src/modules/analysis/application/read-model.ts`, add to the imports:

```ts
import { splitEarnedLostPotential } from "@/domain/analysis/money-split";
```

Then, inside `verdictInputs`, replace the whole `const earnedLostPotential = ...` expression (the conditional building `{ potential, lost, earned }` and its `{ potential: null, lost: null, earned: null }` branch) with:

```ts
  const earnedLostPotential = splitEarnedLostPotential({ potential: grossMoney, lost });
```

Leave `const potential = grossMoney;` removed if it becomes unused, and leave every other part of `verdictInputs` untouched.

- [ ] **Step 6: Run the analysis suites to prove behaviour is unchanged**

Run: `npx vitest run src/modules/analysis/ src/components/analysis/`
Expected: PASS with no change in count. The extraction must not alter a single existing assertion — if one fails, the extraction changed behaviour and must be corrected rather than the test.

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: no output (success).

- [ ] **Step 8: Commit**

```bash
git add src/domain/analysis/money-split.ts src/domain/analysis/money-split.test.ts src/modules/analysis/application/read-model.ts
git commit -m "refactor(analysis): extract the earned/lost/potential split

The channel roll-up needs the identical arithmetic. One implementation
means a channel's own figure and the organization total can never drift.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Let evidence windows be read across all channels

The list page needs the declared windows across every channel. `loadEvidenceWindows` already returns `channelId` on each window and is channel-agnostic apart from one filter, so this widens the existing method rather than duplicating ~100 lines.

**Files:**
- Modify: `src/modules/analysis/application/ports.ts` (the `loadEvidenceWindows` signature)
- Modify: `src/modules/analysis/infrastructure/read-repository.ts` (around line 200-216)
- Modify: `src/modules/analysis/infrastructure/read-repository.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `loadEvidenceWindows(input: { organizationId: string; channelId: string | null; limit: number }): Promise<ChannelEvidenceWindow[]>` — `null` means every channel in the organization.

- [ ] **Step 1: Write the failing test**

Add to `src/modules/analysis/infrastructure/read-repository.test.ts`, inside the existing top-level `describe` for the repository:

```ts
  it("reads evidence windows across every channel when no channel is named", async () => {
    // The merged Channels page offers one window control over the whole
    // organization, so the channel filter has to be optional rather than
    // fanned out into one query per channel.
    const supabase = supabaseStub();
    const repository = createAuthenticatedChannelAnalysisRepository(supabase);

    await repository.loadEvidenceWindows({
      organizationId: ORGANIZATION,
      channelId: null,
      limit: 24,
    });

    const packagesQuery = supabase.queries.find(
      (query) => query.table === "integration_report_packages",
    );
    expect(packagesQuery).toBeDefined();
    expect(packagesQuery?.filters).toContainEqual(["organization_id", ORGANIZATION]);
    expect(packagesQuery?.filters.some(([column]) => column === "channel_id")).toBe(false);
  });
```

If the existing test file's stub does not already record filters in a `queries` array with `{ table, filters }` entries, extend the stub to do so before writing this test, following whatever shape the file already uses for its other assertions. Read the file first and match its existing conventions — do not introduce a second stub style.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/analysis/infrastructure/read-repository.test.ts`
Expected: FAIL — either a type error on `channelId: null`, or the assertion that no `channel_id` filter was applied.

- [ ] **Step 3: Widen the port type**

In `src/modules/analysis/application/ports.ts`, change the `loadEvidenceWindows` declaration to:

```ts
  /**
   * Every window this organization has governed evidence for, newest first.
   *
   * Derived from what the organization actually imported rather than counted
   * back from today: evidence arrives as uploaded reports covering past
   * periods, so a window measured from now reaches it only by coincidence.
   *
   * `channelId` is `null` for the organization-wide read the merged Channels
   * page makes; each returned window still names the channel it belongs to.
   */
  loadEvidenceWindows(input: {
    organizationId: string;
    channelId: string | null;
    limit: number;
  }): Promise<ChannelEvidenceWindow[]>;
```

- [ ] **Step 4: Make the filter conditional**

In `src/modules/analysis/infrastructure/read-repository.ts`, replace the chained package query so the channel filter is applied only when a channel is named. Change:

```ts
        .eq("organization_id", organizationId)
        .eq("channel_id", channelId)
        .eq("status", "projected")
```

to build the query in two steps instead:

```ts
      const packagesBase = supabase
        .from("integration_report_packages")
        .select(
          "id, channel_id, branch_id, declared_period_start, declared_period_end, period_timezone, original_filename, uploaded_at",
        )
        .eq("organization_id", organizationId)
        .eq("status", "projected")
        .not("declared_period_start", "is", null)
        .not("declared_period_end", "is", null);

      const { data: packages, error: packageError } = await (
        channelId === null ? packagesBase : packagesBase.eq("channel_id", channelId)
      )
        .order("declared_period_end", { ascending: false })
        .limit(Math.min(limit, MAX_EVIDENCE_WINDOWS));
```

Everything after this point in the method is already channel-agnostic and stays exactly as it is.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/modules/analysis/infrastructure/read-repository.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 6: Fix the one existing caller**

`src/app/(platform)/organizations/[organizationId]/economics/channels/[channelId]/page.tsx` already passes a `channelId` string, which still satisfies `string | null`. Confirm with:

Run: `pnpm typecheck`
Expected: no output. If a caller fails, pass its existing channel id through unchanged — do not pass `null` anywhere in this task.

- [ ] **Step 7: Commit**

```bash
git add src/modules/analysis/application/ports.ts src/modules/analysis/infrastructure/read-repository.ts src/modules/analysis/infrastructure/read-repository.test.ts
git commit -m "feat(analysis): read evidence windows across every channel

The merged Channels page offers one window control for the organization.
Widening the existing read keeps one implementation rather than fanning
out a query per channel.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Read each channel's money band for one window

**Files:**
- Modify: `src/modules/analysis/application/ports.ts` (add a type and a method)
- Modify: `src/modules/analysis/infrastructure/read-repository.ts`
- Modify: `src/modules/analysis/infrastructure/read-repository.test.ts`

**Interfaces:**
- Consumes: `ChannelAnalysisRunRecord` and `ChannelFindingRecord` from `ports.ts` (already exist).
- Produces:
  - `export type ChannelBandRecord = { channelId: string; analysisRunId: string; findings: readonly ChannelFindingRecord[] }`
  - `export type AnalysedWindowKey = { windowStart: string; windowEnd: string; grain: AnalysisGrain }`
  - `loadChannelBandsForWindow(input: { organizationId: string; windowStart: string; windowEnd: string; grain: AnalysisGrain }): Promise<ChannelBandRecord[]>`
  - `loadAnalysedWindowKeys(input: { organizationId: string }): Promise<AnalysedWindowKey[]>`

`loadAnalysedWindowKeys` exists so the page can open on a window that can actually say something without loading every window's bands to find out. It reads three columns from completed runs and nothing else.

- [ ] **Step 1: Write the failing test**

Add to `src/modules/analysis/infrastructure/read-repository.test.ts`:

```ts
  it("reads the latest completed run per channel for one declared window", async () => {
    const supabase = supabaseStub();
    const repository = createAuthenticatedChannelAnalysisRepository(supabase);

    await repository.loadChannelBandsForWindow({
      organizationId: ORGANIZATION,
      windowStart: "2026-01-01",
      windowEnd: "2026-02-28",
      grain: "day",
    });

    const runsQuery = supabase.queries.find((query) => query.table === "channel_analysis_runs");
    expect(runsQuery).toBeDefined();
    // Scoped to the tenant, to the exact declared window, and to runs that
    // actually finished. A running or failed run has no figures to band.
    expect(runsQuery?.filters).toContainEqual(["organization_id", ORGANIZATION]);
    expect(runsQuery?.filters).toContainEqual(["window_start", "2026-01-01"]);
    expect(runsQuery?.filters).toContainEqual(["window_end", "2026-02-28"]);
    expect(runsQuery?.filters).toContainEqual(["period_grain", "day"]);
    expect(runsQuery?.filters).toContainEqual(["status", "completed"]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/analysis/infrastructure/read-repository.test.ts`
Expected: FAIL — `repository.loadChannelBandsForWindow is not a function`.

- [ ] **Step 3: Add the port type and method declaration**

In `src/modules/analysis/application/ports.ts`, add above `ChannelAnalysisReadPort`:

```ts
/**
 * One channel's contribution to the organization roll-up.
 *
 * Carries only the findings the money band reads, because the roll-up states
 * two figures and has no business loading a whole run's findings to do it.
 */
export type ChannelBandRecord = {
  channelId: string;
  analysisRunId: string;
  findings: readonly ChannelFindingRecord[];
};
```

and add to the `ChannelAnalysisReadPort` type:

```ts
  /**
   * The latest completed run per channel for exactly one declared window.
   *
   * Scoped to a window rather than to "the latest run per channel" for the
   * reason `loadFindingsForRun` is scoped to a run: two channels analysed over
   * different windows are two answers to different questions, and summing them
   * under one window's header states a total nobody computed.
   */
  loadChannelBandsForWindow(input: {
    organizationId: string;
    windowStart: string;
    windowEnd: string;
    grain: AnalysisGrain;
  }): Promise<ChannelBandRecord[]>;
```

- [ ] **Step 4: Implement the method**

In `src/modules/analysis/infrastructure/read-repository.ts`, add near the top with the other module constants:

```ts
/** The two codes the money band reads, and nothing else. */
const BAND_CODES = ["WINDOW_GROSS_REVENUE", "ORDER_CANCELLATION_LOSS"] as const;
```

and add this method to the returned repository object, alongside `loadEvidenceWindows`:

```ts
    async loadChannelBandsForWindow({ organizationId, windowStart, windowEnd, grain }) {
      const { data: runs, error: runError } = await supabase
        .from("channel_analysis_runs")
        .select("id, channel_id, completed_at")
        .eq("organization_id", organizationId)
        .eq("window_start", windowStart)
        .eq("window_end", windowEnd)
        .eq("period_grain", grain)
        .eq("status", "completed")
        .not("channel_id", "is", null)
        .order("completed_at", { ascending: false });
      if (runError) throw new ChannelAnalysisReadError(runError.code ?? "unknown");

      // Newest first, so the first run seen for a channel is the one that
      // stands. A channel re-analysed over the same window has two completed
      // runs, and the later answer is the current one.
      const latestByChannel = new Map<string, string>();
      for (const row of runs ?? []) {
        const channelId = row.channel_id as string;
        if (!latestByChannel.has(channelId)) latestByChannel.set(channelId, row.id);
      }
      if (latestByChannel.size === 0) return [];

      const { data: findings, error: findingError } = await supabase
        .from("channel_findings")
        .select(CHANNEL_FINDING_COLUMNS)
        .eq("organization_id", organizationId)
        .in("analysis_run_id", [...latestByChannel.values()])
        .in("code", [...BAND_CODES]);
      if (findingError) throw new ChannelAnalysisReadError(findingError.code ?? "unknown");

      const byRun = new Map<string, ChannelFindingRecord[]>();
      for (const row of findings ?? []) {
        const mapped = toFindingRecord(row);
        const group = byRun.get(mapped.analysisRunId) ?? [];
        group.push(mapped);
        byRun.set(mapped.analysisRunId, group);
      }

      return [...latestByChannel.entries()].map(([channelId, analysisRunId]) => ({
        channelId,
        analysisRunId,
        findings: byRun.get(analysisRunId) ?? [],
      }));
    },
```

`CHANNEL_FINDING_COLUMNS` and `toFindingRecord` are the existing select-string constant and row mapper this file already uses for `loadFindingsForRun`. Read that method first and reuse its exact names; if they are inlined there rather than named, extract them to module scope in this task and have `loadFindingsForRun` use them too, so both methods map a finding row identically.

Then add the window-key read beside it:

```ts
    async loadAnalysedWindowKeys({ organizationId }) {
      const { data, error } = await supabase
        .from("channel_analysis_runs")
        .select("window_start, window_end, period_grain")
        .eq("organization_id", organizationId)
        .eq("status", "completed")
        .not("channel_id", "is", null)
        .order("window_end", { ascending: false })
        .limit(MAX_ANALYSED_WINDOW_ROWS);
      if (error) throw new ChannelAnalysisReadError(error.code ?? "unknown");

      const seen = new Set<string>();
      const keys: AnalysedWindowKey[] = [];
      for (const row of data ?? []) {
        const grain = row.period_grain;
        if (grain !== "day" && grain !== "week" && grain !== "month") continue;
        const key = `${row.window_start}|${row.window_end}|${grain}`;
        if (seen.has(key)) continue;
        seen.add(key);
        keys.push({ windowStart: row.window_start, windowEnd: row.window_end, grain });
      }
      return keys;
    },
```

Add `const MAX_ANALYSED_WINDOW_ROWS = 500;` beside the other module constants. The read is bounded like every other read in this file: an organization with a very long analysis history must not be able to make this query unbounded.

Add the declaration to `ChannelAnalysisReadPort` too:

```ts
  /**
   * The distinct windows this organization has a completed analysis for,
   * newest first.
   *
   * Three columns, so the merged page can open on a window that can say
   * something without loading every window's findings to discover which can.
   */
  loadAnalysedWindowKeys(input: { organizationId: string }): Promise<AnalysedWindowKey[]>;
```

and the type, above `ChannelAnalysisReadPort`:

```ts
/** A window some channel has a completed analysis for. */
export type AnalysedWindowKey = {
  windowStart: string;
  windowEnd: string;
  grain: AnalysisGrain;
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/modules/analysis/infrastructure/read-repository.test.ts`
Expected: PASS, including every pre-existing test.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm typecheck`
Expected: no output.

```bash
git add src/modules/analysis/application/ports.ts src/modules/analysis/infrastructure/read-repository.ts src/modules/analysis/infrastructure/read-repository.test.ts
git commit -m "feat(analysis): read each channel's money band for one window

Scoped to a declared window rather than to the latest run per channel:
two channels analysed over different windows are answers to different
questions, and summing them states a total nobody computed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Build the channels overview read model

This is where every honesty rule in the design becomes a unit test. Pure function, no I/O.

**Files:**
- Create: `src/modules/analysis/application/channels-overview.ts`
- Create: `src/modules/analysis/application/channels-overview.test.ts`

**Interfaces:**
- Consumes: `splitEarnedLostPotential`, `AnalysisMoney` (Task 1); `ChannelBandRecord`, `ChannelEvidenceWindow`, `ChannelFindingRecord`, `AnalysedWindowKey` (Tasks 2-3).
- Produces:
  - `export type ChannelsOverviewWindow = { windowStart: string; windowEnd: string; grain: AnalysisGrain; label: string; value: string }` — `value` is `start..end..grain`, the one string the window control emits and the page parses
  - `export function resolveDefaultWindow(input: { windows: readonly ChannelsOverviewWindow[]; analysed: readonly AnalysedWindowKey[] }): ChannelsOverviewWindow | null`
  - `export type ChannelsOverviewRow = { channelId: string; displayName: string; status: string; band: EarnedLostPotential; assessed: boolean }`
  - `export type ChannelsOverviewView = { windows: readonly ChannelsOverviewWindow[]; selectedWindow: ChannelsOverviewWindow | null; total: EarnedLostPotential; coverage: { assessedCount: number; channelCount: number; unassessedNames: readonly string[] }; refusalReason: string | null; rows: readonly ChannelsOverviewRow[] }`
  - `export function buildChannelsOverviewView(input: { channels: readonly { id: string; display_name: string; status: string }[]; bands: readonly ChannelBandRecord[]; evidenceWindows: readonly ChannelEvidenceWindow[]; selected: { windowStart: string; windowEnd: string; grain: AnalysisGrain } | null }): ChannelsOverviewView`

- [ ] **Step 1: Write the failing test**

Create `src/modules/analysis/application/channels-overview.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildChannelsOverviewView,
  resolveDefaultWindow,
} from "@/modules/analysis/application/channels-overview";
import type {
  ChannelBandRecord,
  ChannelEvidenceWindow,
} from "@/modules/analysis/application/ports";

const CHANNELS = [
  { id: "ch-talabat", display_name: "talabat", status: "active" },
  { id: "ch-noon", display_name: "noon", status: "active" },
  { id: "ch-deliveroo", display_name: "deliveroo", status: "active" },
  { id: "ch-keeta", display_name: "Keeta", status: "active" },
];

function window_(overrides: Partial<ChannelEvidenceWindow> = {}): ChannelEvidenceWindow {
  return {
    packageId: "pkg-1",
    channelId: "ch-talabat",
    branchId: "br-1",
    windowStart: "2026-01-01",
    windowEnd: "2026-02-28",
    timeZone: "Asia/Dubai",
    grain: "day",
    governedRowCount: 20,
    sourceFilename: "Talabat-Jan-Feb.xlsx",
    ...overrides,
  };
}

function band(input: {
  channelId: string;
  grossMinorUnits?: number;
  lostMinorUnits?: number;
  currency?: string;
}): ChannelBandRecord {
  const currency = input.currency ?? "AED";
  const findings = [];
  if (input.grossMinorUnits !== undefined) {
    findings.push({
      id: `f-gross-${input.channelId}`,
      analysisRunId: `run-${input.channelId}`,
      channelId: input.channelId,
      branchId: null,
      detectorKey: "revenue.window_gross",
      detectorVersion: 1,
      kind: "observation" as const,
      code: "WINDOW_GROSS_REVENUE",
      severity: null,
      priority: null,
      metricKey: "revenue.gross",
      periodStart: "2026-01-01",
      periodEnd: "2026-02-28",
      valueKind: "money" as const,
      valueNumerator: input.grossMinorUnits,
      valueDenominator: null,
      currency,
      monetaryImpactMinorUnits: null,
      expectedPeriodCount: 59,
      observedPeriodCount: 20,
      absentPeriodCount: 39,
      qualityState: "complete" as const,
      needsDataReason: null,
      limitations: [],
      calculationDigest: "a".repeat(64),
      createdAt: "2026-02-28T00:00:00Z",
    });
  }
  if (input.lostMinorUnits !== undefined) {
    findings.push({
      ...findings[0],
      id: `f-loss-${input.channelId}`,
      detectorKey: "orders.cancellation_loss",
      code: "ORDER_CANCELLATION_LOSS",
      metricKey: "order.avoidable_cancellation_count",
      valueKind: "count" as const,
      valueNumerator: 10,
      monetaryImpactMinorUnits: input.lostMinorUnits,
      currency,
    });
  }
  return {
    channelId: input.channelId,
    analysisRunId: `run-${input.channelId}`,
    findings: findings as ChannelBandRecord["findings"],
  };
}

const SELECTED = { windowStart: "2026-01-01", windowEnd: "2026-02-28", grain: "day" as const };

describe("buildChannelsOverviewView", () => {
  it("sums the assessed channels and states how many it covered", () => {
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [band({ channelId: "ch-talabat", grossMinorUnits: 55300, lostMinorUnits: 35700 })],
      evidenceWindows: [window_()],
      selected: SELECTED,
    });

    expect(view.total.earned).toEqual({ minorUnits: 19600, currency: "AED" });
    expect(view.coverage.assessedCount).toBe(1);
    expect(view.coverage.channelCount).toBe(4);
    expect(view.coverage.unassessedNames).toEqual(["noon", "deliveroo", "Keeta"]);
    expect(view.refusalReason).toBeNull();
  });

  it("adds two assessed channels sharing a currency", () => {
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [
        band({ channelId: "ch-talabat", grossMinorUnits: 55300, lostMinorUnits: 35700 }),
        band({ channelId: "ch-noon", grossMinorUnits: 10000, lostMinorUnits: 2500 }),
      ],
      evidenceWindows: [window_()],
      selected: SELECTED,
    });

    expect(view.total).toEqual({
      potential: { minorUnits: 65300, currency: "AED" },
      lost: { minorUnits: 38200, currency: "AED" },
      earned: { minorUnits: 27100, currency: "AED" },
    });
    expect(view.coverage.assessedCount).toBe(2);
  });

  it("refuses to add across currencies rather than summing them", () => {
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [
        band({ channelId: "ch-talabat", grossMinorUnits: 55300, lostMinorUnits: 35700 }),
        band({
          channelId: "ch-noon",
          grossMinorUnits: 10000,
          lostMinorUnits: 2500,
          currency: "USD",
        }),
      ],
      evidenceWindows: [window_()],
      selected: SELECTED,
    });

    expect(view.total).toEqual({ potential: null, lost: null, earned: null });
    expect(view.refusalReason).toBe(
      "These channels reported in more than one currency, so no single total can be stated.",
    );
    // The per-channel rows still state their own figures; only the sum refuses.
    expect(view.rows.find((row) => row.channelId === "ch-noon")?.band.earned).toEqual({
      minorUnits: 7500,
      currency: "USD",
    });
  });

  it("states a reason rather than a zero when no channel was analysed", () => {
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [],
      evidenceWindows: [window_()],
      selected: SELECTED,
    });

    expect(view.total).toEqual({ potential: null, lost: null, earned: null });
    expect(view.coverage.assessedCount).toBe(0);
    expect(view.refusalReason).toBe(
      "No channel has a completed analysis for this window, so nothing has been measured.",
    );
  });

  it("excludes a channel whose band refused, and does not count it as assessed", () => {
    // Gross without a recorded loss cannot be split, so the channel states no
    // band. It must not silently enter the sum as its gross alone.
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [band({ channelId: "ch-talabat", grossMinorUnits: 55300 })],
      evidenceWindows: [window_()],
      selected: SELECTED,
    });

    expect(view.coverage.assessedCount).toBe(0);
    expect(view.coverage.unassessedNames).toContain("talabat");
    expect(view.total.earned).toBeNull();
  });

  it("offers each declared window once, newest first", () => {
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [],
      evidenceWindows: [
        window_({ channelId: "ch-talabat" }),
        // The same window from a second channel's package is one choice, not two.
        window_({ channelId: "ch-noon", packageId: "pkg-2" }),
        window_({ packageId: "pkg-3", windowStart: "2026-03-01", windowEnd: "2026-03-31" }),
      ],
      selected: SELECTED,
    });

    expect(view.windows.map((entry) => `${entry.windowStart}..${entry.windowEnd}`)).toEqual([
      "2026-03-01..2026-03-31",
      "2026-01-01..2026-02-28",
    ]);
  });

  it("states no window at all when the organization has imported nothing", () => {
    const view = buildChannelsOverviewView({
      channels: CHANNELS,
      bands: [],
      evidenceWindows: [],
      selected: null,
    });

    expect(view.windows).toEqual([]);
    expect(view.selectedWindow).toBeNull();
    expect(view.rows).toHaveLength(4);
  });
});

describe("resolveDefaultWindow", () => {
  const march = {
    windowStart: "2026-03-01",
    windowEnd: "2026-03-31",
    grain: "day" as const,
    label: "2026-03-01 to 2026-03-31",
    value: "2026-03-01..2026-03-31..day",
  };
  const janFeb = {
    windowStart: "2026-01-01",
    windowEnd: "2026-02-28",
    grain: "day" as const,
    label: "2026-01-01 to 2026-02-28",
    value: "2026-01-01..2026-02-28..day",
  };

  it("prefers the newest window that has a completed analysis", () => {
    // March is newer but nothing has been analysed over it. Opening there
    // would show an empty page while a window that can speak sits below.
    expect(
      resolveDefaultWindow({
        windows: [march, janFeb],
        analysed: [{ windowStart: "2026-01-01", windowEnd: "2026-02-28", grain: "day" }],
      }),
    ).toEqual(janFeb);
  });

  it("falls back to the newest declared window when nothing has been analysed", () => {
    expect(resolveDefaultWindow({ windows: [march, janFeb], analysed: [] })).toEqual(march);
  });

  it("states no window when none has been declared", () => {
    expect(resolveDefaultWindow({ windows: [], analysed: [] })).toBeNull();
  });

  it("matches on grain as well as dates", () => {
    // The same dates at a different grain are a different window, and an
    // analysis over one says nothing about the other.
    expect(
      resolveDefaultWindow({
        windows: [march, janFeb],
        analysed: [{ windowStart: "2026-01-01", windowEnd: "2026-02-28", grain: "month" }],
      }),
    ).toEqual(march);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/analysis/application/channels-overview.test.ts`
Expected: FAIL — `Failed to resolve import "@/modules/analysis/application/channels-overview"`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/analysis/application/channels-overview.ts`:

```ts
import {
  splitEarnedLostPotential,
  type AnalysisMoney,
  type EarnedLostPotential,
} from "@/domain/analysis/money-split";
import type { AnalysisGrain } from "@/domain/analysis/types";
import type {
  ChannelBandRecord,
  ChannelEvidenceWindow,
  ChannelFindingRecord,
} from "@/modules/analysis/application/ports";

/**
 * The merged Channels page's read model.
 *
 * One clock governs the page. The roll-up is the sum of the same per-channel
 * bands the channel workspace shows -- computed by the one shared function in
 * `@/domain/analysis/money-split`, never recomputed here -- over exactly one
 * declared evidence window.
 *
 * The rule that keeps it honest is that coverage is always stated. A sum over
 * one of four channels is not a total, and this module never returns one
 * without the count and the names of what it left out.
 */

export type ChannelsOverviewWindow = {
  windowStart: string;
  windowEnd: string;
  grain: AnalysisGrain;
  /** What the operator picks from; the dates they declared, never a month name. */
  label: string;
  /** `start..end..grain`. The one string the control emits and the page parses. */
  value: string;
};

export type ChannelsOverviewRow = {
  channelId: string;
  displayName: string;
  status: string;
  band: EarnedLostPotential;
  /** True only when this channel contributed a complete band to the sum. */
  assessed: boolean;
};

export type ChannelsOverviewView = {
  windows: readonly ChannelsOverviewWindow[];
  selectedWindow: ChannelsOverviewWindow | null;
  total: EarnedLostPotential;
  coverage: {
    assessedCount: number;
    channelCount: number;
    unassessedNames: readonly string[];
  };
  /** Why no total is stated. Null whenever `total.earned` is present. */
  refusalReason: string | null;
  rows: readonly ChannelsOverviewRow[];
};

const MIXED_CURRENCY_REASON =
  "These channels reported in more than one currency, so no single total can be stated.";
const NOTHING_ANALYSED_REASON =
  "No channel has a completed analysis for this window, so nothing has been measured.";

const REFUSED: EarnedLostPotential = { potential: null, lost: null, earned: null };

/** The money a finding states, or nothing. Never a rounded or coerced value. */
function moneyOf(finding: ChannelFindingRecord | undefined, from: "value" | "impact"): AnalysisMoney | null {
  if (!finding || finding.currency === null) return null;
  const minorUnits =
    from === "value"
      ? finding.valueKind === "money"
        ? finding.valueNumerator
        : null
      : finding.monetaryImpactMinorUnits;
  return minorUnits === null ? null : { minorUnits, currency: finding.currency };
}

function bandOf(record: ChannelBandRecord | undefined): EarnedLostPotential {
  if (!record) return REFUSED;
  const gross = record.findings.find((finding) => finding.code === "WINDOW_GROSS_REVENUE");
  const loss = record.findings.find((finding) => finding.code === "ORDER_CANCELLATION_LOSS");
  return splitEarnedLostPotential({
    potential: moneyOf(gross, "value"),
    lost: moneyOf(loss, "impact"),
  });
}

/** Declared windows, deduplicated by what an operator can actually tell apart. */
function distinctWindows(
  evidenceWindows: readonly ChannelEvidenceWindow[],
): ChannelsOverviewWindow[] {
  const byKey = new Map<string, ChannelsOverviewWindow>();
  for (const entry of evidenceWindows) {
    const key = `${entry.windowStart}|${entry.windowEnd}|${entry.grain}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      windowStart: entry.windowStart,
      windowEnd: entry.windowEnd,
      grain: entry.grain,
      label: `${entry.windowStart} to ${entry.windowEnd}`,
      value: `${entry.windowStart}..${entry.windowEnd}..${entry.grain}`,
    });
  }
  // Newest first, by the end date the package declared.
  return [...byKey.values()].sort((left, right) =>
    left.windowEnd < right.windowEnd ? 1 : left.windowEnd > right.windowEnd ? -1 : 0,
  );
}

/**
 * Which window an unselected page opens on.
 *
 * The newest declared window is the obvious choice and the wrong one: a report
 * uploaded yesterday that nothing has analysed yet would open the page on an
 * empty band while an older window sits below it with figures. So the newest
 * window carrying a completed analysis wins, and the newest declared window is
 * only the fallback when none has been analysed at all.
 */
export function resolveDefaultWindow(input: {
  windows: readonly ChannelsOverviewWindow[];
  analysed: readonly AnalysedWindowKey[];
}): ChannelsOverviewWindow | null {
  const analysedKeys = new Set(
    input.analysed.map((key) => `${key.windowStart}|${key.windowEnd}|${key.grain}`),
  );
  // `windows` is already newest-first, so the first match is the newest match.
  const analysedWindow = input.windows.find((entry) =>
    analysedKeys.has(`${entry.windowStart}|${entry.windowEnd}|${entry.grain}`),
  );
  return analysedWindow ?? input.windows[0] ?? null;
}

export function buildChannelsOverviewView(input: {
  channels: readonly { id: string; display_name: string; status: string }[];
  bands: readonly ChannelBandRecord[];
  evidenceWindows: readonly ChannelEvidenceWindow[];
  selected: { windowStart: string; windowEnd: string; grain: AnalysisGrain } | null;
}): ChannelsOverviewView {
  const windows = distinctWindows(input.evidenceWindows);
  const bandByChannel = new Map(input.bands.map((record) => [record.channelId, record]));

  const rows: ChannelsOverviewRow[] = input.channels.map((channel) => {
    const band = bandOf(bandByChannel.get(channel.id));
    return {
      channelId: channel.id,
      displayName: channel.display_name,
      status: channel.status,
      band,
      // A refused band is not an assessment. Counting it would let a channel
      // that stated nothing inflate the coverage the total claims.
      assessed: band.earned !== null,
    };
  });

  // The page resolves which window to read bands for and passes it in, so this
  // only has to recognise it among the declared windows. Inferring it from the
  // bands is not possible and not wanted: the bands were read for exactly one
  // window and carry no window of their own.
  const selected = input.selected;
  const selectedWindow =
    (selected
      ? (windows.find(
          (entry) =>
            entry.windowStart === selected.windowStart &&
            entry.windowEnd === selected.windowEnd &&
            entry.grain === selected.grain,
        ) ?? null)
      : null) ?? null;

  const assessedRows = rows.filter((row) => row.assessed);
  const currencies = new Set(
    assessedRows.map((row) => row.band.earned?.currency).filter((code): code is string => !!code),
  );

  let total: EarnedLostPotential = REFUSED;
  let refusalReason: string | null = null;
  if (assessedRows.length === 0) {
    refusalReason = NOTHING_ANALYSED_REASON;
  } else if (currencies.size > 1) {
    refusalReason = MIXED_CURRENCY_REASON;
  } else {
    const currency = [...currencies][0]!;
    const sum = (pick: (band: EarnedLostPotential) => AnalysisMoney | null) =>
      assessedRows.reduce((running, row) => running + (pick(row.band)?.minorUnits ?? 0), 0);
    total = {
      potential: { minorUnits: sum((band) => band.potential), currency },
      lost: { minorUnits: sum((band) => band.lost), currency },
      earned: { minorUnits: sum((band) => band.earned), currency },
    };
  }

  return {
    windows,
    selectedWindow,
    total,
    coverage: {
      assessedCount: assessedRows.length,
      channelCount: rows.length,
      unassessedNames: rows.filter((row) => !row.assessed).map((row) => row.displayName),
    },
    refusalReason,
    rows,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/modules/analysis/application/channels-overview.test.ts`
Expected: PASS, 10 tests (6 for `buildChannelsOverviewView`, 4 for `resolveDefaultWindow`).

Also add `import type { AnalysedWindowKey } from "@/modules/analysis/application/ports";` to the implementation's imports, alongside the other port types.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck`
Expected: no output.

```bash
git add src/modules/analysis/application/channels-overview.ts src/modules/analysis/application/channels-overview.test.ts
git commit -m "feat(analysis): build the channels overview read model

Sums the same per-channel bands the workspace shows, over one declared
window, and always states its coverage. A sum over one of four channels
is not a total, and this never returns one without saying so.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Render the roll-up

**Files:**
- Create: `src/components/channels/channels-rollup.tsx`
- Create: `src/components/channels/channels-rollup.test.tsx`

**Interfaces:**
- Consumes: `ChannelsOverviewView` (Task 4); `formatMoney`, `formatWindow` from `@/components/analysis/format`.
- Produces: `export function ChannelsRollup(props: { view: ChannelsOverviewView; organizationId: string }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `src/components/channels/channels-rollup.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChannelsRollup } from "@/components/channels/channels-rollup";
import type { ChannelsOverviewView } from "@/modules/analysis/application/channels-overview";

const WINDOW = {
  windowStart: "2026-01-01",
  windowEnd: "2026-02-28",
  grain: "day" as const,
  label: "2026-01-01 to 2026-02-28",
  value: "2026-01-01..2026-02-28..day",
};

function view(overrides: Partial<ChannelsOverviewView> = {}): ChannelsOverviewView {
  return {
    windows: [WINDOW],
    selectedWindow: WINDOW,
    total: {
      potential: { minorUnits: 55300, currency: "AED" },
      lost: { minorUnits: 35700, currency: "AED" },
      earned: { minorUnits: 19600, currency: "AED" },
    },
    coverage: { assessedCount: 1, channelCount: 4, unassessedNames: ["noon", "deliveroo"] },
    refusalReason: null,
    rows: [],
    ...overrides,
  };
}

afterEach(cleanup);

describe("ChannelsRollup", () => {
  it("states the earned figure and the window it answers for", () => {
    render(<ChannelsRollup view={view()} organizationId="org-1" />);

    expect(screen.getByText("AED 196.00")).toBeTruthy();
    expect(screen.getByText(/2026-01-01 to 2026-02-28/)).toBeTruthy();
  });

  it("names how many channels it covered and which it did not", () => {
    render(<ChannelsRollup view={view()} organizationId="org-1" />);

    const coverage = screen.getByText(/Across 1 of 4 channels/);
    expect(coverage.textContent).toContain("noon");
    expect(coverage.textContent).toContain("deliveroo");
  });

  it("shows the refusal reason instead of a zero when nothing was measured", () => {
    render(
      <ChannelsRollup
        view={view({
          total: { potential: null, lost: null, earned: null },
          coverage: { assessedCount: 0, channelCount: 4, unassessedNames: [] },
          refusalReason: "No channel has a completed analysis for this window, so nothing has been measured.",
        })}
        organizationId="org-1"
      />,
    );

    expect(screen.getByText(/nothing has been measured/)).toBeTruthy();
    // A zero would read as "you earned nothing", which is a different claim.
    expect(screen.queryByText("AED 0.00")).toBeNull();
  });

  it("renders nothing measurable when the organization has imported no windows", () => {
    render(
      <ChannelsRollup
        view={view({
          windows: [],
          selectedWindow: null,
          total: { potential: null, lost: null, earned: null },
          coverage: { assessedCount: 0, channelCount: 4, unassessedNames: [] },
          refusalReason: "No channel has a completed analysis for this window, so nothing has been measured.",
        })}
        organizationId="org-1"
      />,
    );

    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/channels/channels-rollup.test.tsx`
Expected: FAIL — cannot resolve `@/components/channels/channels-rollup`.

- [ ] **Step 3: Write the component**

Create `src/components/channels/channels-rollup.tsx`. Before writing it, read `src/components/analysis/channel-workspace.tsx`'s verdict band and its `PotentialLostEarnedScale` and copy their visual conventions — the em-dash-with-reason absence style, the `formatMoney` helper, the `Kicker` label style. Do not invent a second house style.

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { formatMoney } from "@/components/analysis/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChannelsOverviewView } from "@/modules/analysis/application/channels-overview";

/**
 * The organization's money band, over one declared evidence window.
 *
 * Every figure here is a sum of per-channel bands the channel pages show
 * individually. The coverage line is not decoration: a sum over one of four
 * channels is not a total, and stating which channels are missing turns the
 * gap into the next thing to do.
 */
export function ChannelsRollup({
  view,
  organizationId,
}: {
  view: ChannelsOverviewView;
  organizationId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const onWindowChange = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("window", value);
    router.push(`/organizations/${organizationId}/channels?${params.toString()}`);
  };

  const { earned } = view.total;

  return (
    <section aria-label="Channel roll-up" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          {earned ? (
            <p className="font-mono text-4xl font-bold tracking-tight">
              {formatMoney(earned.minorUnits, earned.currency)}
            </p>
          ) : (
            <p className="font-mono text-4xl font-bold tracking-tight text-muted-foreground">—</p>
          )}
          {view.selectedWindow ? (
            <p className="text-sm text-muted-foreground">{view.selectedWindow.label}</p>
          ) : null}
        </div>

        {view.windows.length > 0 ? (
          <Select value={view.selectedWindow?.value ?? undefined} onValueChange={onWindowChange}>
            <SelectTrigger aria-label="Window to report on" className="w-auto">
              <SelectValue placeholder="Choose a window" />
            </SelectTrigger>
            <SelectContent>
              {view.windows.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {view.refusalReason ? (
        <p className="text-[15px] leading-relaxed text-muted-foreground">{view.refusalReason}</p>
      ) : (
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          {`Across ${view.coverage.assessedCount} of ${view.coverage.channelCount} channels.`}
          {view.coverage.unassessedNames.length > 0
            ? ` ${view.coverage.unassessedNames.join(", ")} ${
                view.coverage.unassessedNames.length === 1 ? "has" : "have"
              } no analysis for this window.`
            : ""}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/components/channels/channels-rollup.test.tsx`
Expected: PASS, 4 tests.

`ChannelsOverviewWindow.value` is the single source of the `start..end..grain` string: the `Select` value, each `SelectItem` value, and the query-string parameter Task 6 parses are all that one field. Nothing formats it a second time.

- [ ] **Step 5: Typecheck, format and commit**

```bash
pnpm typecheck
npx prettier --write src/components/channels/channels-rollup.tsx src/components/channels/channels-rollup.test.tsx
git add src/components/channels/channels-rollup.tsx src/components/channels/channels-rollup.test.tsx
git commit -m "feat(channels): render the analysis-derived roll-up

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Turn /channels into the merged page

**Files:**
- Modify: `src/app/(platform)/organizations/[organizationId]/channels/page.tsx`
- Create: `src/app/(platform)/organizations/[organizationId]/channels/page.test.tsx`

**Interfaces:**
- Consumes: `buildChannelsOverviewView` (Task 4), `ChannelsRollup` (Task 5), `loadEvidenceWindows` with `channelId: null` (Task 2), `loadChannelBandsForWindow` (Task 3).
- Produces: the merged `/channels` route.

- [ ] **Step 1: Write the failing test**

Create `src/app/(platform)/organizations/[organizationId]/channels/page.test.tsx`. Read the sibling `src/app/(platform)/organizations/[organizationId]/economics/page.test.tsx` first; if its `vi.mock` factory shapes for `getOrganizationContext` and `getOrganization` differ from those below, use its shapes — one mocking style per codebase.

```tsx
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadEvidenceWindows = vi.fn(async () => []);
const loadChannelBandsForWindow = vi.fn(async () => []);
const loadAnalysedWindowKeys = vi.fn(async () => []);
const isGovernedChannelAnalysisEnabled = vi.fn(() => true);

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: async () => ({
    organizationId: "org-1",
    user: { id: "user-1" },
    membership: { role: "owner" },
    supabase: {},
  }),
}));

vi.mock("@/domain/organizations/repository", () => ({
  getOrganization: async () => ({ id: "org-1", name: "Al Noor Kitchen", default_timezone: "Asia/Dubai" }),
}));

vi.mock("@/modules/channels/infrastructure/repository", () => ({
  createAuthenticatedChannelRepository: () => ({}),
}));

vi.mock("@/modules/channels/application/service", () => ({
  createChannelService: () => ({
    listManagementSnapshot: async () => ({
      channels: [{ id: "ch-1", display_name: "talabat", status: "active", key: "talabat", category: "marketplace", template_key: null }],
      branches: [],
      branchMappings: [],
      aliases: [],
    }),
  }),
}));

vi.mock("@/modules/analysis/infrastructure/read-repository", () => ({
  createAuthenticatedChannelAnalysisRepository: () => ({
    loadEvidenceWindows,
    loadChannelBandsForWindow,
    loadAnalysedWindowKeys,
  }),
}));

vi.mock("@/modules/integrations/application/feature-access", () => ({
  isGovernedChannelAnalysisEnabled: () => isGovernedChannelAnalysisEnabled(),
}));

// Rendering the register is not what these tests are about; stubbing it keeps
// the assertions on the page's reads rather than on 776 lines of unrelated UI.
vi.mock("@/components/channels/channels-management", () => ({
  ChannelsManagement: () => null,
}));
vi.mock("@/components/channels/channels-rollup", () => ({ ChannelsRollup: () => null }));

import ChannelsPage from "@/app/(platform)/organizations/[organizationId]/channels/page";

beforeEach(() => {
  loadEvidenceWindows.mockClear();
  loadChannelBandsForWindow.mockClear();
  loadAnalysedWindowKeys.mockClear();
  isGovernedChannelAnalysisEnabled.mockReturnValue(true);
});

describe("ChannelsPage", () => {
  it("does not read analysis at all when the slice is off for the organization", async () => {
    // The flag is enforced in the read, not in navigation, so a flag-off
    // organization pays for nothing and has nothing to leak through a
    // hand-typed URL.
    isGovernedChannelAnalysisEnabled.mockReturnValue(false);

    await ChannelsPage({
      params: Promise.resolve({ organizationId: "org-1" }),
      searchParams: Promise.resolve({}),
    });

    expect(loadEvidenceWindows).not.toHaveBeenCalled();
    expect(loadChannelBandsForWindow).not.toHaveBeenCalled();
    expect(loadAnalysedWindowKeys).not.toHaveBeenCalled();
  });

  it("reads bands for exactly the window named in the query string", async () => {
    loadEvidenceWindows.mockResolvedValueOnce([
      {
        packageId: "pkg-1",
        channelId: "ch-1",
        branchId: null,
        windowStart: "2026-01-01",
        windowEnd: "2026-02-28",
        timeZone: "Asia/Dubai",
        grain: "day",
        governedRowCount: 20,
        sourceFilename: "Talabat.xlsx",
      },
    ]);

    await ChannelsPage({
      params: Promise.resolve({ organizationId: "org-1" }),
      searchParams: Promise.resolve({ window: "2026-01-01..2026-02-28..day" }),
    });

    expect(loadChannelBandsForWindow).toHaveBeenCalledWith({
      organizationId: "org-1",
      windowStart: "2026-01-01",
      windowEnd: "2026-02-28",
      grain: "day",
    });
  });

  it("reads windows across every channel, not one channel", async () => {
    await ChannelsPage({
      params: Promise.resolve({ organizationId: "org-1" }),
      searchParams: Promise.resolve({}),
    });

    expect(loadEvidenceWindows).toHaveBeenCalledWith({
      organizationId: "org-1",
      channelId: null,
      limit: 24,
    });
  });

  it("ignores a malformed window parameter rather than reading a nonsense window", async () => {
    loadEvidenceWindows.mockResolvedValueOnce([]);

    await ChannelsPage({
      params: Promise.resolve({ organizationId: "org-1" }),
      searchParams: Promise.resolve({ window: "not-a-window" }),
    });

    // No declared windows and an unparseable parameter means there is nothing
    // to band, so no band read is made at all.
    expect(loadChannelBandsForWindow).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "src/app/(platform)/organizations/[organizationId]/channels/page.test.tsx"`
Expected: FAIL — the page does not yet call the new reads.

- [ ] **Step 3: Rewrite the page**

Replace `src/app/(platform)/organizations/[organizationId]/channels/page.tsx` with:

```tsx
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { ChannelsManagement } from "@/components/channels/channels-management";
import { ChannelsRollup } from "@/components/channels/channels-rollup";
import type { AnalysisGrain } from "@/domain/analysis/types";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import {
  buildChannelsOverviewView,
  resolveDefaultWindow,
} from "@/modules/analysis/application/channels-overview";
import { createAuthenticatedChannelAnalysisRepository } from "@/modules/analysis/infrastructure/read-repository";
import { createChannelService } from "@/modules/channels/application/service";
import { createAuthenticatedChannelRepository } from "@/modules/channels/infrastructure/repository";
import { isGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";

const GRAINS = new Set<AnalysisGrain>(["day", "week", "month"]);

/** `start..end..grain`, the one shape the window control emits. */
function parseWindow(
  value: string | undefined,
): { windowStart: string; windowEnd: string; grain: AnalysisGrain } | null {
  if (!value) return null;
  const [windowStart, windowEnd, grain] = value.split("..");
  if (!windowStart || !windowEnd || !grain) return null;
  if (!GRAINS.has(grain as AnalysisGrain)) return null;
  return { windowStart, windowEnd, grain: grain as AnalysisGrain };
}

export default async function ChannelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ window?: string }>;
}) {
  const context = await getOrganizationContext(params);
  const organization = await getOrganization(context.supabase, context.organizationId);
  const snapshot = await createChannelService(
    createAuthenticatedChannelRepository(context.supabase),
  ).listManagementSnapshot({
    organizationId: context.organizationId,
    actorId: context.user.id,
    role: context.membership.role,
  });

  // The flag is enforced here rather than in navigation. An organization it is
  // off for does not reach the analysis reads at all, so the page degrades to
  // the register and there is nothing to pay for or to leak.
  const workspaceEnabled = isGovernedChannelAnalysisEnabled(context.organizationId);

  let overview = null;
  if (workspaceEnabled) {
    const analysis = createAuthenticatedChannelAnalysisRepository(context.supabase);
    const [evidenceWindows, analysedKeys] = await Promise.all([
      analysis.loadEvidenceWindows({
        organizationId: context.organizationId,
        channelId: null,
        limit: 24,
      }),
      analysis.loadAnalysedWindowKeys({ organizationId: context.organizationId }),
    ]);

    // The page resolves which window to answer for before reading any band,
    // because a band read is scoped to one window and the read model cannot
    // infer which one it was given afterwards.
    const requested = parseWindow((await searchParams).window);
    const declared = buildChannelsOverviewView({
      channels: snapshot.channels,
      bands: [],
      evidenceWindows,
      selected: null,
    }).windows;
    const selected =
      requested ?? resolveDefaultWindow({ windows: declared, analysed: analysedKeys });

    const bands = selected
      ? await analysis.loadChannelBandsForWindow({
          organizationId: context.organizationId,
          windowStart: selected.windowStart,
          windowEnd: selected.windowEnd,
          grain: selected.grain,
        })
      : [];

    overview = buildChannelsOverviewView({
      channels: snapshot.channels,
      bands,
      evidenceWindows,
      selected,
    });
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      {overview ? (
        <ChannelsRollup view={overview} organizationId={context.organizationId} />
      ) : null}
      <ChannelsManagement
        organizationId={context.organizationId}
        organizationName={organization.name}
        channels={snapshot.channels}
        branches={snapshot.branches}
        branchMappings={snapshot.branchMappings}
        aliases={snapshot.aliases}
        canManage={hasOrganizationPermission(context.membership.role, "channel.manage")}
        canMapBranches={hasOrganizationPermission(context.membership.role, "channel.map_branch")}
        workspaceEnabled={workspaceEnabled}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run "src/app/(platform)/organizations/[organizationId]/channels/" src/components/channels/`
Expected: PASS.

- [ ] **Step 5: Typecheck, format and commit**

```bash
pnpm typecheck
npx prettier --write "src/app/(platform)/organizations/[organizationId]/channels/page.tsx" "src/app/(platform)/organizations/[organizationId]/channels/page.test.tsx"
git add "src/app/(platform)/organizations/[organizationId]/channels/"
git commit -m "feat(channels): put the analysis roll-up above the register

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Give each channel its own page with Analysis and Setup tabs

**Files:**
- Create: `src/app/(platform)/organizations/[organizationId]/channels/[channelId]/page.tsx`
- Create: `src/components/channels/channel-detail.tsx`
- Create: `src/components/channels/channel-detail.test.tsx`
- Modify: `src/components/channels/channels-management.tsx` (extract the per-channel setup sections)

**Interfaces:**
- Consumes: `ChannelWorkspace` from `@/components/analysis/channel-workspace` (unchanged), the existing `ChannelMappingsDialog` internals, `listManagementSnapshot` from the channel service.
- Produces:
  - `export function ChannelDetail(props: { channelName: string; workspace: React.ReactNode | null; setup: React.ReactNode; defaultTab: "analysis" | "setup" }): JSX.Element`
  - `export function ChannelSetupPanel(props: { organizationId: string; channel: ChannelRecord; branches: ...; branchMappings: ...; aliases: ...; canManage: boolean; canMapBranches: boolean }): JSX.Element` — the prop types are exactly those `ChannelsManagement` already receives for the same data; copy them rather than redeclaring.

- [ ] **Step 1: Write the failing test**

Create `src/components/channels/channel-detail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChannelDetail } from "@/components/channels/channel-detail";

afterEach(cleanup);

describe("ChannelDetail", () => {
  it("opens on Analysis when an analysis is available", () => {
    render(
      <ChannelDetail
        channelName="talabat"
        workspace={<p>Workspace here</p>}
        setup={<p>Setup here</p>}
        defaultTab="analysis"
      />,
    );

    expect(screen.getByRole("tab", { name: "Analysis" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "talabat" })).toBeTruthy();
  });

  it("offers no Analysis tab when the slice is off for the organization", () => {
    render(
      <ChannelDetail channelName="talabat" workspace={null} setup={<p>Setup here</p>} defaultTab="setup" />,
    );

    expect(screen.queryByRole("tab", { name: "Analysis" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Setup" }).getAttribute("aria-selected")).toBe("true");
  });

  it("shows Setup even when asked to default to an analysis that does not exist", () => {
    // An archived channel resolves to no workspace. Defaulting to a tab that
    // was never drawn would render an empty panel.
    render(
      <ChannelDetail channelName="talabat" workspace={null} setup={<p>Setup here</p>} defaultTab="analysis" />,
    );

    expect(screen.getByText("Setup here")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/channels/channel-detail.test.tsx`
Expected: FAIL — cannot resolve `@/components/channels/channel-detail`.

- [ ] **Step 3: Write `ChannelDetail`**

Create `src/components/channels/channel-detail.tsx`:

```tsx
"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * One channel, one destination.
 *
 * The analysis and the setup that produces it are two views of the same thing,
 * so they are tabs rather than two pages. `workspace` is null when the governed
 * analysis slice is off for the organization, or when the channel is archived:
 * in both cases there is no analysis to offer and no tab is drawn for one.
 */
export function ChannelDetail({
  channelName,
  workspace,
  setup,
  defaultTab,
}: {
  channelName: string;
  workspace: React.ReactNode | null;
  setup: React.ReactNode;
  defaultTab: "analysis" | "setup";
}) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">{channelName}</h1>
      <Tabs defaultValue={workspace ? defaultTab : "setup"} className="flex flex-1 flex-col gap-6">
        <TabsList>
          {workspace ? <TabsTrigger value="analysis">Analysis</TabsTrigger> : null}
          <TabsTrigger value="setup">Setup</TabsTrigger>
        </TabsList>
        {workspace ? (
          <TabsContent value="analysis" className="flex-1">
            {workspace}
          </TabsContent>
        ) : null}
        <TabsContent value="setup" className="flex-1">
          {setup}
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

`src/components/ui/tabs.tsx` already exists in this repo — use it as-is and do not add a second tabs primitive.

- [ ] **Step 4: Extract the setup sections**

From `src/components/channels/channels-management.tsx`, move the per-channel branch-mappings section (around line 395) and source-labels section (around line 488) into a new exported `ChannelSetupPanel` in the same file or a new `src/components/channels/channel-setup-panel.tsx`, taking the props they already close over. They become sections rather than dialog bodies. `channels-management.tsx` keeps the register, the cards, and `Add channel`.

Keep the existing permission props exactly: `canManage` gates identity edits and archive, `canMapBranches` gates mappings. Without them the panel renders read-only, not hidden.

- [ ] **Step 5: Write the route**

Create `src/app/(platform)/organizations/[organizationId]/channels/[channelId]/page.tsx`. Copy the data loading from `economics/channels/[channelId]/page.tsx` **verbatim** — `loadRuns`, the `displayedRun` selection, `loadFindingsForRun`, `loadEvidence`, `loadRecommendationsForRun` and `buildChannelWorkspaceView` are unchanged and must stay unchanged — then wrap the result:

```tsx
  // Two differences from the route this replaces. The analysis flag no longer
  // 404s the page, because Setup is worth reaching without it; and an archived
  // channel opens on Setup, matching today, where the workspace link is hidden
  // for archived channels.
  const analysisAvailable =
    isGovernedChannelAnalysisEnabled(context.organizationId) && channel.status === "active";

  const workspace = analysisAvailable ? (
    <ChannelWorkspace
      organizationId={context.organizationId}
      channel={channel}
      view={view}
      evidenceWindows={evidenceWindows}
      canRunAnalysis={hasOrganizationPermission(role, "channel.manage")}
      channelsHref={`/organizations/${context.organizationId}/channels`}
      economicsHref={`/organizations/${context.organizationId}/channels`}
    />
  ) : null;

  return (
    <>
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <RegisterRouteLabel segment={channelId} label={channel.display_name} />
      <ChannelDetail
        channelName={channel.display_name}
        workspace={workspace}
        defaultTab={analysisAvailable ? "analysis" : "setup"}
        setup={
          <ChannelSetupPanel
            organizationId={context.organizationId}
            channel={channel}
            branches={snapshot.branches}
            branchMappings={snapshot.branchMappings}
            aliases={snapshot.aliases}
            canManage={hasOrganizationPermission(role, "channel.manage")}
            canMapBranches={hasOrganizationPermission(role, "channel.map_branch")}
          />
        }
      />
    </>
  );
```

The setup panel needs the branch and alias data the register page loads, so this route calls `listManagementSnapshot` where the old one called `listChannels`, and takes `channel` from `snapshot.channels`. Keep the existing `notFound()` when the channel id does not resolve in this tenant.

Both `economicsHref` and `channelsHref` now point at `/channels`, since that is the one place a reader goes back to. If `ChannelWorkspace` renders two visibly different "back" affordances from those props, collapse them to one in a follow-up rather than in this task — note it on the board instead of widening scope here.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/components/channels/ "src/app/(platform)/organizations/[organizationId]/channels/"`
Expected: PASS.

- [ ] **Step 7: Typecheck, format and commit**

```bash
pnpm typecheck
npx prettier --write src/components/channels/ "src/app/(platform)/organizations/[organizationId]/channels/"
git add src/components/channels/ "src/app/(platform)/organizations/[organizationId]/channels/"
git commit -m "feat(channels): one channel, one page, with Analysis and Setup tabs

Mappings and labels stop being modals. They were modals because a card in
a grid had nowhere to put them; a channel with its own page has sections.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Retire the economics route and update navigation

**Files:**
- Delete: `src/app/(platform)/organizations/[organizationId]/economics/page.tsx`, its test
- Create: `src/app/(platform)/organizations/[organizationId]/economics/page.tsx` (redirect)
- Create: `src/app/(platform)/organizations/[organizationId]/economics/channels/[channelId]/page.tsx` (redirect, replacing the workspace route)
- Modify: `src/components/layout/sidebar.tsx`, `src/components/layout/sidebar.test.tsx`

**Interfaces:**
- Consumes: the routes from Tasks 6 and 7.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing sidebar test change**

In `src/components/layout/sidebar.test.tsx`, remove `"Channel economics"` from the expected label list (around line 47) and delete the assertion block that checks its href (around line 70). Update the entry-count expectation to nine if the file asserts one.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/layout/sidebar.test.tsx`
Expected: FAIL — the rendered sidebar still contains `Channel economics`.

- [ ] **Step 3: Remove the sidebar entry**

In `src/components/layout/sidebar.tsx`, delete the line:

```ts
  { label: "Channel economics", icon: Coins, path: (id) => `/organizations/${id}/economics` },
```

and remove the now-unused `Coins` import if nothing else in the file uses it.

- [ ] **Step 4: Replace both economics routes with redirects**

Replace `src/app/(platform)/organizations/[organizationId]/economics/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

/**
 * Channel economics merged into Channels on 2026-08-28.
 *
 * A redirect rather than a removal: links and bookmarks point here, and the
 * money this page showed now lives on the merged page under one clock. See
 * `docs/superpowers/specs/2026-08-28-channels-and-economics-merge-design.md`.
 */
export default async function ChannelEconomicsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  redirect(`/organizations/${organizationId}/channels`);
}
```

Replace `src/app/(platform)/organizations/[organizationId]/economics/channels/[channelId]/page.tsx` with the equivalent redirecting to `/organizations/${organizationId}/channels/${channelId}`.

Delete `src/app/(platform)/organizations/[organizationId]/economics/page.test.tsx`, whose subject no longer exists.

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`
Expected: PASS. Any test that imported the deleted economics page test helpers must be updated, not deleted, unless its subject is gone.

The economics module, `src/trigger/economics.ts`, `src/workflows/economics/`, and the Overview's `ChannelEconomicsOverview` card stay untouched. If a test failure suggests deleting any of them, stop — that is the parked decision, explicitly out of scope.

- [ ] **Step 6: Typecheck, lint, format and commit**

```bash
pnpm typecheck
pnpm lint
npx prettier --write "src/app/(platform)/organizations/[organizationId]/economics/" src/components/layout/sidebar.tsx src/components/layout/sidebar.test.tsx
git add -A "src/app/(platform)/organizations/[organizationId]/economics/" src/components/layout/
git commit -m "feat(channels): retire the Channel economics destination

Both old routes redirect rather than 404. The economics module, its
Trigger task and the Overview's economics card are untouched -- that is
a separate decision.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Full gates and browser verification

**Files:** none created; this task is verification.

**Interfaces:**
- Consumes: everything from Tasks 1-8.
- Produces: a truthful completion report.

- [ ] **Step 1: Run every gate**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
```

Expected: typecheck silent; lint 0 errors (16 pre-existing warnings in campaign files are not yours); tests all pass; format clean. Fix anything attributable to this plan. Do not "fix" the pre-existing campaign warnings.

- [ ] **Step 2: Exercise the pages in a real browser**

Start the app and visit, at both a desktop width and a mobile width (approximately 1440px and 390px):

- `/organizations/<id>/channels` — roll-up states a figure and its coverage sentence; the window control lists declared windows; switching a window updates the figure and the query string.
- `/organizations/<id>/channels/<channelId>` — opens on Analysis; Setup tab shows mappings and labels as sections.
- `/organizations/<id>/economics` — redirects to `/channels`.
- `/organizations/<id>/economics/channels/<channelId>` — redirects to `/channels/<channelId>`.
- `/organizations/<id>/overview` — the economics card still renders, unchanged.

Confirm no horizontal scroll at the narrow width and that the roll-up figure and coverage sentence stay legible.

- [ ] **Step 3: Report honestly**

If the Chrome DevTools MCP is unavailable, say so plainly and report the browser gate as **outstanding**, listing exactly which checks from Step 2 were not performed. Do not describe the pages as verified, and do not substitute a screenshot-free assertion that they "should" work.

- [ ] **Step 4: Update the coordination board**

Add a log entry to `docs/collaboration/asset-library-and-studio-board.md` recording: the merge shipped, both redirects, the one-clock decision and the non-overlap evidence that forced it, and that the economics subsystem's fate remains an open parked decision.

- [ ] **Step 5: Commit**

```bash
git add docs/collaboration/asset-library-and-studio-board.md
git commit -m "docs(channels): record the merge on the coordination board

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
