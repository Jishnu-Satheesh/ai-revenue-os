# Channel Audit Free-Range Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator ask the Channel Audit about any date range their approved reports cover — four days, a week, a fortnight — and get a real analysis run and real recommendations for exactly those dates.

**Architecture:** The month label is removed from every layer and replaced by a `from`–`to` window. The database is untouched: `claim_channel_analysis` already accepts a window and a content-addressed cache key. Admissibility is re-decided server-side twice — once at the route, once inside the worker under its lease — so browser-supplied dates never widen what can be analysed. Redis caches only immutable completed-run views and short-lived coverage, never the question "is this answer still current".

**Tech Stack:** TypeScript strict, Next.js 16 App Router, React 19, Vitest 2.1.8 + @testing-library/react, Supabase (hosted staging only), Trigger.dev v4, Upstash Redis (REST), react-day-picker via shadcn Calendar, date-fns 4.

**Spec:** `docs/superpowers/specs/2026-09-07-channel-audit-free-range-window-design.md`

## Global Constraints

- **No migration.** No table, column, RLS policy, RPC or database type changes. `src/lib/supabase/database.types.ts` is not touched.
- **There is no local database.** Never run `supabase start` or `supabase db reset`. `pnpm db:types` cannot run.
- **Never use `git stash`.** The stash stack is shared with other worktrees. Use a temporary WIP commit.
- Dates are inclusive local calendar dates, `YYYY-MM-DD`, with no timezone applied. See the module comment at the top of `src/domain/analysis/calendar.ts`.
- Maximum window is **400 days** — matches the `window_end - window_start <= 400` check on `channel_analysis_runs` and `MAX_PERIODS` in `calendar.ts`.
- Grains are `"day" | "week" | "month" | "span"` (`AnalysisGrain` in `src/domain/analysis/types.ts`). Weeks start Monday.
- Every Redis key is namespaced by `organizationId`.
- Every Redis read and the rate limiter **fail soft**: a failure is indistinguishable from a miss, and the limiter fails **open**.
- Structured logs carry identifiers and counts only. Never a figure, a cited row, an error message, or PII. Use `error.name`, never `error.message`.
- Commands: `pnpm test` (vitest run), `pnpm typecheck`, `pnpm lint`.
- **Do not run `pnpm format`.** This worktree is shared and it reflows other sessions' uncommitted files. Format only the files you touched: `pnpm prettier --write <paths>`.
- Stop the dev server before running the full suite.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/domain/analysis/window-selection.ts` | Pure date logic: coverage merging, admissibility, the default window, the grain warning. No I/O. |
| `src/lib/cache/redis.ts` | A fail-soft Upstash client. `cacheGet` / `cacheSet` never throw. |
| `src/lib/cache/rate-limit.ts` | A per-organization sliding-window limiter that fails open. |
| `src/modules/analysis/application/view-cache.ts` | Caches the viewer-independent half of a completed run's view. |
| `src/app/api/.../analysis/status/route.ts` | `{ status, hasRecommendations }` for one window, for the loader to poll. |
| `src/components/ui/calendar.tsx` | shadcn Calendar (react-day-picker). |
| `src/components/analysis/window-range-picker.tsx` | The range control: calendar, presets, grain warning, Apply. |
| `src/components/analysis/analysis-progress.tsx` | The staged loader. |
| `adrs/0047-a-free-range-window-over-a-content-addressed-cache.md` | The decision record. |

**Modified**

| File | Change |
| --- | --- |
| `src/domain/analysis/digest.ts` | `createMonthlyAnalysisCacheKey` → `createWindowAnalysisCacheKey`, resolver version bumped. |
| `src/domain/analysis/calendar.ts` | Retire the five month-label helpers. Period arithmetic untouched. |
| `src/modules/analysis/application/ports.ts` | `loadAnalysisMonthTimeline` → `loadCoverageSegments`; `resolveMonthInput` → `resolveWindowInput`. |
| `src/modules/analysis/infrastructure/read-repository.ts` | Implements both renamed ports. |
| `src/app/api/.../channels/[channelId]/analysis/route.ts` | `{from,to}` body, coverage check, rate limit, gate removed. |
| `src/workflows/analysis/run-channel-analysis.ts` | The monthly path becomes the window path. |
| `src/trigger/analysis.ts` | Passes `loadCoverageSegments`. |
| `src/modules/reports/application/auto-analysis.ts`, `src/trigger/reports.ts` | Auto-analysis onto the cached window path. |
| `src/app/(platform)/.../channels/[channelId]/page.tsx` | `?from=&to=`, coverage, run selection, `?month=` translation. |
| `src/components/analysis/channel-workspace.tsx` | Swaps the picker, posts `{from,to}`, shows the loader. |

**Untouched:** `src/components/analysis/month-year-picker.tsx` (the channels list page still uses it), `src/components/channels/channels-rollup.tsx`.

---

### Task 1: Coverage segments and admissibility

The two facts every other task leans on: which dates a channel's approved reports declare, and whether a picked range sits inside them.

**Files:**
- Create: `src/domain/analysis/window-selection.ts`
- Test: `src/domain/analysis/window-selection.test.ts`

**Interfaces:**
- Consumes: `addLocalDays`, `localDaysBetween` from `@/domain/analysis/calendar`; `AnalysisGrain` from `@/domain/analysis/types`; `ChannelAnalysisError` from `@/domain/analysis/errors`.
- Produces:
  - `type CoverageSegment = { start: string; end: string }`
  - `type CoverageWindow = { windowStart: string; windowEnd: string; grain: AnalysisGrain; governedRowCount: number }`
  - `mergeCoverageSegments(windows: readonly { windowStart: string; windowEnd: string }[]): CoverageSegment[]`
  - `isWindowCovered(from: string, to: string, segments: readonly CoverageSegment[]): boolean`
  - `const MAX_ANALYSIS_WINDOW_DAYS = 400`

- [ ] **Step 1: Write the failing test**

Create `src/domain/analysis/window-selection.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  isWindowCovered,
  mergeCoverageSegments,
  MAX_ANALYSIS_WINDOW_DAYS,
} from "@/domain/analysis/window-selection";

const w = (windowStart: string, windowEnd: string) => ({ windowStart, windowEnd });

describe("mergeCoverageSegments", () => {
  it("returns nothing for no packages", () => {
    expect(mergeCoverageSegments([])).toEqual([]);
  });

  it("keeps two genuinely separate stretches apart", () => {
    // Nostaza's real shape: Keeta covers Jan-Feb, the offline store May-Aug.
    // A gap between them is a gap, and the calendar must show it as one.
    expect(
      mergeCoverageSegments([w("2026-05-01", "2026-08-31"), w("2026-01-01", "2026-02-28")]),
    ).toEqual([
      { start: "2026-01-01", end: "2026-02-28" },
      { start: "2026-05-01", end: "2026-08-31" },
    ]);
  });

  it("merges overlapping declarations into one stretch", () => {
    expect(
      mergeCoverageSegments([w("2026-01-01", "2026-01-31"), w("2026-01-15", "2026-02-28")]),
    ).toEqual([{ start: "2026-01-01", end: "2026-02-28" }]);
  });

  it("merges stretches that merely touch, leaving no false one-day gap", () => {
    // 31 January and 1 February are adjacent, not separated. Treating them as
    // two segments would grey out a boundary the reports actually cover.
    expect(
      mergeCoverageSegments([w("2026-01-01", "2026-01-31"), w("2026-02-01", "2026-02-28")]),
    ).toEqual([{ start: "2026-01-01", end: "2026-02-28" }]);
  });

  it("swallows a declaration wholly inside another", () => {
    expect(
      mergeCoverageSegments([w("2026-01-01", "2026-02-28"), w("2026-01-10", "2026-01-12")]),
    ).toEqual([{ start: "2026-01-01", end: "2026-02-28" }]);
  });
});

describe("isWindowCovered", () => {
  const segments = mergeCoverageSegments([
    w("2026-01-01", "2026-02-28"),
    w("2026-05-01", "2026-08-31"),
  ]);

  it("accepts a range wholly inside one stretch", () => {
    expect(isWindowCovered("2026-01-01", "2026-01-04", segments)).toBe(true);
  });

  it("accepts a range equal to a whole stretch", () => {
    expect(isWindowCovered("2026-01-01", "2026-02-28", segments)).toBe(true);
  });

  it("refuses a range that leaves cover by a single day", () => {
    expect(isWindowCovered("2026-02-28", "2026-03-01", segments)).toBe(false);
  });

  it("refuses a range that spans the gap between two stretches", () => {
    // Every day of March and April is uncovered. A range bridging Jan and May
    // is not "mostly covered"; it is a question the reports cannot answer.
    expect(isWindowCovered("2026-02-01", "2026-05-31", segments)).toBe(false);
  });

  it("refuses a reversed range", () => {
    expect(isWindowCovered("2026-01-04", "2026-01-01", segments)).toBe(false);
  });

  it("refuses a range wider than the run ceiling", () => {
    const wide = mergeCoverageSegments([w("2024-01-01", "2026-12-31")]);
    expect(isWindowCovered("2024-01-01", "2025-06-01", wide)).toBe(false);
    expect(MAX_ANALYSIS_WINDOW_DAYS).toBe(400);
  });

  it("accepts a range at exactly the ceiling, and refuses one past it", () => {
    // The database's check is `window_end - window_start <= 400`, so 400 is
    // legal and 401 is not. Refusing 400 here would reject a window the
    // database would have taken, which is the opposite of this guard's job.
    const wide = mergeCoverageSegments([w("2024-01-01", "2026-12-31")]);
    expect(isWindowCovered("2026-01-01", "2027-02-05", wide)).toBe(true);
    expect(isWindowCovered("2026-01-01", "2027-02-06", wide)).toBe(false);
  });

  it("refuses anything when nothing is declared", () => {
    expect(isWindowCovered("2026-01-01", "2026-01-04", [])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm vitest run src/domain/analysis/window-selection.test.ts`
Expected: FAIL — `Failed to resolve import "@/domain/analysis/window-selection"`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/analysis/window-selection.ts`:

```ts
import { addLocalDays, localDaysBetween } from "@/domain/analysis/calendar";
import type { AnalysisGrain } from "@/domain/analysis/types";

/**
 * Which dates a channel's approved reports declare, and whether a picked range
 * sits inside them.
 *
 * Pure calendar arithmetic on local dates, for the reason `calendar.ts` gives:
 * a period boundary was already resolved in the branch's zone when the
 * projection wrote the row, and re-deriving it through a zone here would be a
 * second opinion about a settled boundary.
 *
 * Coverage is built from *declared* package periods rather than from surviving
 * evidence rows. A package whose rows were all superseded still declared the
 * period, and a gap inside a declaration must stay selectable so the coverage
 * detector can report it. `loadAnalysisMonthTimeline` documented the same rule
 * for months; this is the same rule at day resolution.
 */

/** One unbroken stretch of declared dates, both ends inclusive. */
export type CoverageSegment = { start: string; end: string };

/** The subset of a declared package this module needs. */
export type CoverageWindow = {
  windowStart: string;
  windowEnd: string;
  grain: AnalysisGrain;
  governedRowCount: number;
};

/**
 * A year of daily periods is the widest window worth one run, matching the
 * `window_end - window_start <= 400` check on `channel_analysis_runs`. A range
 * refused here would otherwise be refused by the database after the operator
 * had already waited for a dispatch.
 */
export const MAX_ANALYSIS_WINDOW_DAYS = 400;

/**
 * Declared periods reduced to ordered, non-overlapping, inclusive stretches.
 *
 * Stretches that merely touch are joined: 31 January and 1 February are
 * adjacent, and leaving them as two segments would grey out a boundary the
 * reports cover. Stretches with a real day between them stay apart, because
 * that day is genuinely unreported.
 */
export function mergeCoverageSegments(
  windows: readonly { windowStart: string; windowEnd: string }[],
): CoverageSegment[] {
  const sorted = [...windows]
    .map((window) => ({ start: window.windowStart, end: window.windowEnd }))
    .filter((segment) => localDaysBetween(segment.start, segment.end) >= 0)
    .sort((left, right) => left.start.localeCompare(right.start));

  const merged: CoverageSegment[] = [];
  for (const segment of sorted) {
    const last = merged[merged.length - 1];
    // `<= addLocalDays(last.end, 1)` rather than `<= last.end`: touching is
    // contiguous, only a whole missing day separates two stretches.
    if (last && segment.start <= addLocalDays(last.end, 1)) {
      if (segment.end > last.end) last.end = segment.end;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

/**
 * Whether every day of the range is declared by one single stretch.
 *
 * One stretch, not several: a range bridging the gap between two stretches is
 * not "mostly covered", it is a question the reports cannot answer, and every
 * day in the gap would be reported as absent by a run nobody should have
 * started.
 */
export function isWindowCovered(
  from: string,
  to: string,
  segments: readonly CoverageSegment[],
): boolean {
  const span = localDaysBetween(from, to);
  // `>` not `>=`: the database's own check is `window_end - window_start <= 400`,
  // so a span of exactly 400 is legal. Refusing it here would reject a window
  // the database would have accepted -- the opposite of what this guard is for.
  if (span < 0 || span > MAX_ANALYSIS_WINDOW_DAYS) return false;
  return segments.some((segment) => segment.start <= from && to <= segment.end);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm vitest run src/domain/analysis/window-selection.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write src/domain/analysis/window-selection.ts src/domain/analysis/window-selection.test.ts
git add src/domain/analysis/window-selection.ts src/domain/analysis/window-selection.test.ts
git commit -m "feat(analysis): say which dates a channel's reports actually declare

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The default window

What the picker opens on. The rule has to hold for a client whose reports cover January–February and May–August while today is September, and it must never open on the grain warning Task 3 builds.

**Files:**
- Modify: `src/domain/analysis/window-selection.ts`
- Test: `src/domain/analysis/window-selection.test.ts`

**Interfaces:**
- Consumes: `mergeCoverageSegments`, `isWindowCovered`, `CoverageWindow` from Task 1; `enumerateLocalPeriodStarts`, `localPeriodEnd`, `addLocalDays` from `@/domain/analysis/calendar`.
- Produces:
  - `type AnalysisWindowSelection = { from: string; to: string }`
  - `defaultAnalysisWindow(input: { today: string; windows: readonly CoverageWindow[] }): AnalysisWindowSelection | null`

- [ ] **Step 1: Write the failing test**

Append to `src/domain/analysis/window-selection.test.ts`:

```ts
import { defaultAnalysisWindow } from "@/domain/analysis/window-selection";

const daily = (windowStart: string, windowEnd: string) => ({
  windowStart,
  windowEnd,
  grain: "day" as const,
  governedRowCount: 100,
});

describe("defaultAnalysisWindow", () => {
  it("has no answer for a channel with nothing declared", () => {
    expect(defaultAnalysisWindow({ today: "2026-09-07", windows: [] })).toBeNull();
  });

  it("opens on the last seven days when a daily report covers them", () => {
    expect(
      defaultAnalysisWindow({ today: "2026-09-07", windows: [daily("2026-06-01", "2026-09-30")] }),
    ).toEqual({ from: "2026-09-01", to: "2026-09-07" });
  });

  it("falls back to the last seven covered days on a daily channel", () => {
    // Keeta's real shape. Today is September; the reports stop on 28 February.
    // Counting seven days back from today reaches nothing, so the default has
    // to walk back to where the evidence actually ends.
    expect(
      defaultAnalysisWindow({ today: "2026-09-07", windows: [daily("2026-01-01", "2026-02-28")] }),
    ).toEqual({ from: "2026-02-22", to: "2026-02-28" });
  });

  it("opens on the last whole month for a monthly channel", () => {
    // The offline store's profit and loss: one figure per month, May to August.
    // Seven days ending 31 August would contain no whole month, so the page
    // would open on the grain warning. It opens on August instead.
    expect(
      defaultAnalysisWindow({
        today: "2026-09-07",
        windows: [
          { windowStart: "2026-05-01", windowEnd: "2026-08-31", grain: "month", governedRowCount: 16 },
        ],
      }),
    ).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("opens on the whole span for a channel that files one figure", () => {
    // Noon reported a single figure for the whole of January and February.
    // Any narrower default would be a window that figure cannot fill.
    expect(
      defaultAnalysisWindow({
        today: "2026-09-07",
        windows: [
          { windowStart: "2026-01-01", windowEnd: "2026-02-28", grain: "span", governedRowCount: 2 },
        ],
      }),
    ).toEqual({ from: "2026-01-01", to: "2026-02-28" });
  });

  it("opens on the last whole week for a weekly channel", () => {
    // Weeks start Monday. 2026-02-28 is a Saturday, so the last whole week
    // inside the declaration is Monday 16 to Sunday 22 February.
    expect(
      defaultAnalysisWindow({
        today: "2026-09-07",
        windows: [
          { windowStart: "2026-01-05", windowEnd: "2026-02-28", grain: "week", governedRowCount: 40 },
        ],
      }),
    ).toEqual({ from: "2026-02-16", to: "2026-02-22" });
  });

  it("refuses to reach behind the start of a short declaration", () => {
    // A three-day report cannot yield a seven-day default.
    expect(
      defaultAnalysisWindow({ today: "2026-09-07", windows: [daily("2026-02-26", "2026-02-28")] }),
    ).toEqual({ from: "2026-02-26", to: "2026-02-28" });
  });

  it("prefers the latest declaration when a channel has several", () => {
    expect(
      defaultAnalysisWindow({
        today: "2026-09-07",
        windows: [daily("2026-01-01", "2026-02-28"), daily("2026-05-01", "2026-06-30")],
      }),
    ).toEqual({ from: "2026-06-24", to: "2026-06-30" });
  });

  it("does not open on seven days when those days are monthly-reported", () => {
    // The last seven days are covered, but by a report that files one figure a
    // month. Opening there would open on a warning, so the month wins.
    expect(
      defaultAnalysisWindow({
        today: "2026-09-07",
        windows: [
          { windowStart: "2026-01-01", windowEnd: "2026-09-30", grain: "month", governedRowCount: 9 },
        ],
      }),
    ).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm vitest run src/domain/analysis/window-selection.test.ts -t "defaultAnalysisWindow"`
Expected: FAIL — `defaultAnalysisWindow is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/domain/analysis/window-selection.ts`:

```ts
import {
  enumerateLocalPeriodStarts,
  localPeriodEnd,
} from "@/domain/analysis/calendar";

/** A picked range, both ends inclusive. */
export type AnalysisWindowSelection = { from: string; to: string };

/** The latest declaration wins; a tie breaks to the finer grain. */
const GRAIN_FINENESS: readonly AnalysisGrain[] = ["day", "week", "month", "span"];

function latestWindow(windows: readonly CoverageWindow[]): CoverageWindow | null {
  const [latest] = [...windows].sort(
    (left, right) =>
      right.windowEnd.localeCompare(left.windowEnd) ||
      GRAIN_FINENESS.indexOf(left.grain) - GRAIN_FINENESS.indexOf(right.grain),
  );
  return latest ?? null;
}

/**
 * The last whole period a declaration contains, or the whole declaration when
 * it contains none.
 *
 * A span is one figure for one range, so its "last period" is the range itself:
 * there is nothing narrower that figure can fill.
 */
function lastWholePeriod(window: CoverageWindow): AnalysisWindowSelection {
  if (window.grain === "span") return { from: window.windowStart, to: window.windowEnd };
  if (window.grain === "day") {
    // Seven days ending where the evidence ends, never reaching behind its start.
    const from = addLocalDays(window.windowEnd, -6);
    return {
      from: from < window.windowStart ? window.windowStart : from,
      to: window.windowEnd,
    };
  }
  const starts = enumerateLocalPeriodStarts(window.windowStart, window.windowEnd, window.grain);
  const last = starts[starts.length - 1];
  if (last === undefined) return { from: window.windowStart, to: window.windowEnd };
  return { from: last, to: localPeriodEnd(last, window.grain) };
}

/**
 * What the picker opens on.
 *
 * The last seven days when they are covered *by a daily report* -- the grain
 * check is not incidental. Reports arrive covering periods already past, so on
 * this platform the recent past is usually unreported, and where it is
 * reported it may be reported as one monthly figure. Opening on seven days of
 * a monthly report would open the page on the warning in
 * `describeGrainMismatch`, which is a complaint, not an answer.
 *
 * Otherwise the most recent window the channel can actually answer: seven days
 * on a daily channel, the last whole month on a monthly one, the whole span on
 * a channel that files a single figure.
 */
export function defaultAnalysisWindow(input: {
  today: string;
  windows: readonly CoverageWindow[];
}): AnalysisWindowSelection | null {
  if (input.windows.length === 0) return null;

  const dayGrained = input.windows.filter((window) => window.grain === "day");
  const recent = { from: addLocalDays(input.today, -6), to: input.today };
  if (isWindowCovered(recent.from, recent.to, mergeCoverageSegments(dayGrained))) {
    return recent;
  }

  const latest = latestWindow(input.windows);
  return latest === null ? null : lastWholePeriod(latest);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm vitest run src/domain/analysis/window-selection.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write src/domain/analysis/window-selection.ts src/domain/analysis/window-selection.test.ts
git add src/domain/analysis/window-selection.ts src/domain/analysis/window-selection.test.ts
git commit -m "feat(analysis): open the audit on a window the channel can actually answer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The grain warning

Stops an operator asking a four-day question of a report that files one figure a month — and, crucially, says so *before* the run starts and names the range that would work.

**Files:**
- Modify: `src/domain/analysis/window-selection.ts`
- Test: `src/domain/analysis/window-selection.test.ts`

**Interfaces:**
- Consumes: `CoverageWindow`, `AnalysisWindowSelection` from Tasks 1–2; `enumerateLocalPeriodStarts`, `localPeriodStart`, `localPeriodEnd` from `@/domain/analysis/calendar`.
- Produces:
  - `type GrainMismatch = { grain: AnalysisGrain; declaredStart: string; declaredEnd: string; suggested: AnalysisWindowSelection }`
  - `describeGrainMismatch(input: { from: string; to: string; windows: readonly CoverageWindow[] }): GrainMismatch | null`

- [ ] **Step 1: Write the failing test**

Append to `src/domain/analysis/window-selection.test.ts`:

```ts
import { describeGrainMismatch } from "@/domain/analysis/window-selection";

describe("describeGrainMismatch", () => {
  const monthly = {
    windowStart: "2026-05-01",
    windowEnd: "2026-08-31",
    grain: "month" as const,
    governedRowCount: 16,
  };
  const span = {
    windowStart: "2026-01-01",
    windowEnd: "2026-02-28",
    grain: "span" as const,
    governedRowCount: 2,
  };

  it("says nothing when a daily report can answer a four-day question", () => {
    expect(
      describeGrainMismatch({ from: "2026-01-01", to: "2026-01-04", windows: [daily("2026-01-01", "2026-02-28")] }),
    ).toBeNull();
  });

  it("warns when four days are asked of a monthly report, and names the month", () => {
    expect(
      describeGrainMismatch({ from: "2026-08-01", to: "2026-08-04", windows: [monthly] }),
    ).toEqual({
      grain: "month",
      declaredStart: "2026-05-01",
      declaredEnd: "2026-08-31",
      suggested: { from: "2026-08-01", to: "2026-08-31" },
    });
  });

  it("warns when part of a single-figure span is asked for, and offers the whole span", () => {
    // Noon reported one figure for 1 January to 28 February. Four days of it
    // is not a smaller answer; it is no answer.
    expect(
      describeGrainMismatch({ from: "2026-01-01", to: "2026-01-04", windows: [span] }),
    ).toEqual({
      grain: "span",
      declaredStart: "2026-01-01",
      declaredEnd: "2026-02-28",
      suggested: { from: "2026-01-01", to: "2026-02-28" },
    });
  });

  it("blames the declaration carrying the most governed rows", () => {
    // Two declarations, both too coarse to answer, different sizes. The
    // warning names the one the operator is most likely to recognise, which
    // is the one that produced the most rows -- not whichever sorted first.
    const mismatch = describeGrainMismatch({
      from: "2026-08-01",
      to: "2026-08-04",
      windows: [
        { windowStart: "2026-01-01", windowEnd: "2026-12-31", grain: "month", governedRowCount: 12 },
        { windowStart: "2026-07-01", windowEnd: "2026-09-30", grain: "month", governedRowCount: 900 },
      ],
    });

    expect(mismatch?.declaredStart).toBe("2026-07-01");
    expect(mismatch?.declaredEnd).toBe("2026-09-30");
  });

  it("breaks a tie on row count by blaming the finer declaration", () => {
    const mismatch = describeGrainMismatch({
      from: "2026-08-01",
      to: "2026-08-04",
      windows: [
        { windowStart: "2026-01-01", windowEnd: "2026-12-31", grain: "span", governedRowCount: 40 },
        { windowStart: "2026-07-01", windowEnd: "2026-09-30", grain: "month", governedRowCount: 40 },
      ],
    });

    expect(mismatch?.grain).toBe("month");
  });

  it("says nothing when the whole span is asked for", () => {
    expect(
      describeGrainMismatch({ from: "2026-01-01", to: "2026-02-28", windows: [span] }),
    ).toBeNull();
  });

  it("says nothing when a whole month is asked of a monthly report", () => {
    expect(
      describeGrainMismatch({ from: "2026-08-01", to: "2026-08-31", windows: [monthly] }),
    ).toBeNull();
  });

  it("warns on a part-month that straddles two months", () => {
    // 15 July to 15 August contains no whole month, so a monthly report has
    // nothing to put in it. The suggestion widens to both whole months.
    expect(
      describeGrainMismatch({ from: "2026-07-15", to: "2026-08-15", windows: [monthly] }),
    ).toEqual({
      grain: "month",
      declaredStart: "2026-05-01",
      declaredEnd: "2026-08-31",
      suggested: { from: "2026-07-01", to: "2026-08-31" },
    });
  });

  it("stays quiet when any one of several reports can answer", () => {
    // Keeta files three families at once. One daily report is enough to make
    // a four-day question answerable, whatever the others do.
    expect(
      describeGrainMismatch({
        from: "2026-01-01",
        to: "2026-01-04",
        windows: [monthly, span, daily("2026-01-01", "2026-02-28")],
      }),
    ).toBeNull();
  });

  it("says nothing about a range no report overlaps", () => {
    // That is a coverage problem, refused by isWindowCovered. Two complaints
    // about one mistake is one too many.
    expect(
      describeGrainMismatch({ from: "2026-03-01", to: "2026-03-04", windows: [monthly] }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm vitest run src/domain/analysis/window-selection.test.ts -t "describeGrainMismatch"`
Expected: FAIL — `describeGrainMismatch is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/domain/analysis/window-selection.ts`:

```ts
import { localPeriodStart } from "@/domain/analysis/calendar";

/** Why a picked range would come back empty, and the range that would not. */
export type GrainMismatch = {
  grain: AnalysisGrain;
  declaredStart: string;
  declaredEnd: string;
  suggested: AnalysisWindowSelection;
};

function overlaps(window: CoverageWindow, from: string, to: string): boolean {
  return window.windowStart <= to && from <= window.windowEnd;
}

/**
 * Whether this declaration can put at least one whole period inside the range.
 *
 * A period counts only when it lies entirely inside both the range and the
 * declaration, which is the same rule `enumerateLocalPeriodStarts` applies:
 * reporting a week the caller asked about four days of would claim a gap
 * nobody has.
 */
function canAnswer(window: CoverageWindow, from: string, to: string): boolean {
  if (window.grain === "span") {
    // One figure for one range. It fits only if the whole of it is asked for.
    return from <= window.windowStart && window.windowEnd <= to;
  }
  return enumerateLocalPeriodStarts(from, to, window.grain).some(
    (start) =>
      start >= window.windowStart && localPeriodEnd(start, window.grain) <= window.windowEnd,
  );
}

/** The narrowest range containing the picked one that this declaration can fill. */
function widenFor(window: CoverageWindow, from: string, to: string): AnalysisWindowSelection {
  if (window.grain === "span") return { from: window.windowStart, to: window.windowEnd };
  const start = localPeriodStart(from, window.grain);
  const end = localPeriodEnd(localPeriodStart(to, window.grain), window.grain);
  return {
    from: start < window.windowStart ? window.windowStart : start,
    to: end > window.windowEnd ? window.windowEnd : end,
  };
}

/**
 * Why a picked range would come back empty, or null when it would not.
 *
 * Silent unless *every* overlapping declaration is too coarse: a channel filing
 * three report families at once needs only one of them to be able to answer.
 * Silent too when nothing overlaps at all -- that is a coverage refusal, and
 * two complaints about one mistake is one too many.
 *
 * The declaration blamed is the one carrying the most governed rows, so the
 * warning names the report the operator is most likely to recognise.
 */
export function describeGrainMismatch(input: {
  from: string;
  to: string;
  windows: readonly CoverageWindow[];
}): GrainMismatch | null {
  const overlapping = input.windows.filter((window) => overlaps(window, input.from, input.to));
  if (overlapping.length === 0) return null;
  if (overlapping.some((window) => canAnswer(window, input.from, input.to))) return null;

  const [blamed] = [...overlapping].sort(
    (left, right) =>
      right.governedRowCount - left.governedRowCount ||
      GRAIN_FINENESS.indexOf(left.grain) - GRAIN_FINENESS.indexOf(right.grain),
  );
  return {
    grain: blamed.grain,
    declaredStart: blamed.windowStart,
    declaredEnd: blamed.windowEnd,
    suggested: widenFor(blamed, input.from, input.to),
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm vitest run src/domain/analysis/window-selection.test.ts`
Expected: PASS, 29 tests.

- [ ] **Step 5: Typecheck, then commit**

```bash
pnpm typecheck
pnpm prettier --write src/domain/analysis/window-selection.ts src/domain/analysis/window-selection.test.ts
git add src/domain/analysis/window-selection.ts src/domain/analysis/window-selection.test.ts
git commit -m "feat(analysis): warn before running a question the reports cannot answer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The window cache key

Widens the content-addressed key from a month to any window, and proves the version bump so the one-time recompute is deliberate rather than accidental.

**Files:**
- Modify: `src/domain/analysis/digest.ts:70-105`
- Test: `src/domain/analysis/digest.test.ts`

**Interfaces:**
- Consumes: `canonicalize` (module-private in `digest.ts`).
- Produces: `createWindowAnalysisCacheKey(input: { organizationId: string; channelId: string | null; branchId: string | null; windowStart: string; windowEnd: string; timeZone: string; grain: AnalysisGrain; registryVersion: number; detectorVersions: readonly { key: string; calculationVersion: number }[]; metricKeys: readonly string[]; evidenceDigest: string }): string` — note: **no `month` field**.
- Leaves `createMonthlyAnalysisCacheKey` in place and untouched. Task 9 switches its
  call site and deletes it then.

**Why add rather than rename.** `createMonthlyAnalysisCacheKey` has one caller,
`run-channel-analysis.ts:468`, and that call site belongs to Task 9. Renaming here
would leave `pnpm typecheck` failing across Tasks 5, 6, 7 and 8 — five commits that
do not build, no usable type gate during the tasks that change a port interface and
an API route, and no way to bisect if something goes wrong. Task 3 has already shown
that a broken build hides comfortably behind a green Vitest run, because Vitest strips
types rather than checking them. So the new function is added beside the old one, both
exist for five tasks, and Task 9 removes the old one in the same commit that stops
calling it. The cost is one briefly-unused export; the benefit is that every commit on
this branch compiles.

- [ ] **Step 1: Write the failing test**

Append to `src/domain/analysis/digest.test.ts`:

```ts
import { createWindowAnalysisCacheKey } from "@/domain/analysis/digest";

describe("createWindowAnalysisCacheKey", () => {
  const base = {
    organizationId: "859cf039-1cd8-41b0-bd09-66c6c52e9c52",
    channelId: "11111111-1111-4111-8111-111111111111",
    branchId: null,
    windowStart: "2026-01-01",
    windowEnd: "2026-01-04",
    timeZone: "Asia/Dubai",
    grain: "day" as const,
    registryVersion: 1,
    detectorVersions: [{ key: "revenue.window_gross", calculationVersion: 2 }],
    metricKeys: ["revenue.gross"],
    evidenceDigest: "a".repeat(64),
  };

  it("is a sha256 hex digest", () => {
    expect(createWindowAnalysisCacheKey(base)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is stable for the same question asked twice", () => {
    expect(createWindowAnalysisCacheKey(base)).toBe(createWindowAnalysisCacheKey(base));
  });

  it("changes when the window changes", () => {
    // The whole point. Four days and five days are different questions and
    // must never share a cached answer.
    expect(createWindowAnalysisCacheKey({ ...base, windowEnd: "2026-01-05" })).not.toBe(
      createWindowAnalysisCacheKey(base),
    );
  });

  it("changes when the evidence changes, so a correction is never served stale", () => {
    expect(createWindowAnalysisCacheKey({ ...base, evidenceDigest: "b".repeat(64) })).not.toBe(
      createWindowAnalysisCacheKey(base),
    );
  });

  it("ignores the order detectors and metric keys arrive in", () => {
    expect(
      createWindowAnalysisCacheKey({
        ...base,
        detectorVersions: [
          { key: "orders.cancellation_loss", calculationVersion: 1 },
          { key: "revenue.window_gross", calculationVersion: 2 },
        ],
        metricKeys: ["orders.cancelled", "revenue.gross"],
      }),
    ).toBe(
      createWindowAnalysisCacheKey({
        ...base,
        detectorVersions: [
          { key: "revenue.window_gross", calculationVersion: 2 },
          { key: "orders.cancellation_loss", calculationVersion: 1 },
        ],
        metricKeys: ["revenue.gross", "orders.cancelled"],
      }),
    );
  });

  it("does not collide with a key the monthly resolver would have produced", () => {
    // The real comparison, not a hash-shaped literal. January 2026 as a month
    // and January 2026 as a window are the same question asked two ways; the
    // two resolvers must still answer with different keys, or a run cached
    // under the retired scheme would be served for a window nobody analysed.
    const monthly = createMonthlyAnalysisCacheKey({
      ...base,
      month: "2026-01",
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
    });
    const windowed = createWindowAnalysisCacheKey({
      ...base,
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
    });

    expect(windowed).not.toBe(monthly);
  });

  it("pins the resolver version, so a deliberate invalidation stays deliberate", () => {
    // The sibling suite pins MONTHLY_ANALYSIS_RESOLVER_VERSION the same way.
    // Without this, `resolverVersion` could be dropped from the hashed object
    // entirely and every test would still pass -- and the one lever that can
    // invalidate every cached answer at once would be gone unnoticed.
    expect(ANALYSIS_RESOLVER_VERSION).toBe(2);
  });

  it("misses when the organization or channel changes", () => {
    // Tenant scope is part of the question's identity. The database also scopes
    // the lookup by organization, so this is the inner of two fences -- but a
    // key that ignored either would make the outer fence the only one.
    const key = createWindowAnalysisCacheKey(base);

    expect(
      createWindowAnalysisCacheKey({ ...base, organizationId: "22222222-2222-4222-8222-222222222222" }),
    ).not.toBe(key);
    expect(
      createWindowAnalysisCacheKey({ ...base, channelId: "33333333-3333-4333-8333-333333333333" }),
    ).not.toBe(key);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm vitest run src/domain/analysis/digest.test.ts -t "createWindowAnalysisCacheKey"`
Expected: FAIL — `createWindowAnalysisCacheKey is not a function`.

- [ ] **Step 3: Replace the monthly key**

In `src/domain/analysis/digest.ts`, replace `createMonthlyAnalysisCacheKey` (lines 70–105) and its resolver constant:

```ts
/**
 * Version 2 drops the month label. A key minted under version 1 named a
 * calendar month; this one names a window. Bumping rather than reusing means
 * every run cached under the old scheme recomputes once, which is correct --
 * a month's arithmetic must never be reused under a range's heading.
 */
export const ANALYSIS_RESOLVER_VERSION = 2;

/**
 * The identity of one analysable question: who is asking, about which channel
 * and window, in which zone, at which grain, with which arithmetic, over which
 * evidence.
 *
 * `evidenceDigest` is the ingredient that makes this a cache key rather than a
 * bookmark. A correction, a supersession, a held decision, a new projection or
 * a detector version change all move it, so a completed run stops matching the
 * moment its inputs stop being the current ones. See ADR 0043 and ADR 0047.
 */
export function createWindowAnalysisCacheKey(input: {
  organizationId: string;
  channelId: string | null;
  branchId: string | null;
  windowStart: string;
  windowEnd: string;
  timeZone: string;
  grain: "day" | "week" | "month" | "span";
  registryVersion: number;
  detectorVersions: readonly { key: string; calculationVersion: number }[];
  metricKeys: readonly string[];
  evidenceDigest: string;
}): string {
  return createHash("sha256")
    .update(
      canonicalize({
        resolverVersion: ANALYSIS_RESOLVER_VERSION,
        organizationId: input.organizationId,
        channelId: input.channelId,
        branchId: input.branchId,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        timeZone: input.timeZone,
        grain: input.grain,
        registryVersion: input.registryVersion,
        detectorVersions: [...input.detectorVersions].sort((left, right) =>
          left.key.localeCompare(right.key),
        ),
        metricKeys: [...input.metricKeys].sort(),
        evidenceDigest: input.evidenceDigest,
      }),
    )
    .digest("hex");
}
```

Delete any test in `digest.test.ts` that referenced `createMonthlyAnalysisCacheKey`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm vitest run src/domain/analysis/digest.test.ts`
Expected: PASS.

Then run `npx tsc --noEmit` and expect **zero errors**. Because this task adds
`createWindowAnalysisCacheKey` beside `createMonthlyAnalysisCacheKey` rather than
replacing it, the existing call site at `run-channel-analysis.ts:468` still resolves
and the build stays green. If typecheck reports an error here, you have removed or
renamed the old function — put it back.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write src/domain/analysis/digest.ts src/domain/analysis/digest.test.ts
git add src/domain/analysis/digest.ts src/domain/analysis/digest.test.ts
git commit -m "feat(analysis): key the analysis cache by window rather than by month

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The coverage and window-resolver ports

Renames the two month-shaped ports and reuses the existing majority-grain vote over a picked window instead of a month's bounds.

**Files:**
- Modify: `src/modules/analysis/application/ports.ts:308-323`
- Modify: `src/modules/analysis/infrastructure/read-repository.ts:546-578` and `:783-836`
- Test: `src/modules/analysis/infrastructure/read-repository.test.ts`

**Interfaces:**
- Consumes: `CoverageSegment`, `CoverageWindow`, `isWindowCovered`, `mergeCoverageSegments` from Task 1.
- Produces:
  - `loadCoverageSegments(input: { organizationId: string; channelId: string | null }): Promise<CoverageSegment[]>`
  - `resolveWindowInput(input: { organizationId: string; channelId: string; from: string; to: string }): Promise<{ windowStart: string; windowEnd: string; timeZone: string; grain: AnalysisGrain } | null>`
- Removes: `loadAnalysisMonthTimeline`, `resolveMonthInput`, and the `AnalysisMonthTimeline` type.

- [ ] **Step 1: Write the failing test**

Add to `src/modules/analysis/infrastructure/read-repository.test.ts`, following the existing Supabase stub pattern already in that file:

```ts
describe("loadCoverageSegments", () => {
  it("merges the channel's declared package periods into stretches", async () => {
    const repository = createRepositoryWithPackages([
      { declared_period_start: "2026-01-01", declared_period_end: "2026-01-31" },
      { declared_period_start: "2026-02-01", declared_period_end: "2026-02-28" },
      { declared_period_start: "2026-05-01", declared_period_end: "2026-08-31" },
    ]);

    await expect(
      repository.loadCoverageSegments({ organizationId: ORGANIZATION_ID, channelId: CHANNEL_ID }),
    ).resolves.toEqual([
      { start: "2026-01-01", end: "2026-02-28" },
      { start: "2026-05-01", end: "2026-08-31" },
    ]);
  });

  it("returns nothing for a channel with no projected packages", async () => {
    const repository = createRepositoryWithPackages([]);

    await expect(
      repository.loadCoverageSegments({ organizationId: ORGANIZATION_ID, channelId: CHANNEL_ID }),
    ).resolves.toEqual([]);
  });
});

describe("resolveWindowInput", () => {
  it("refuses a range that leaves the declared coverage", async () => {
    const repository = createRepositoryWithCoverage({
      packages: [{ declared_period_start: "2026-01-01", declared_period_end: "2026-02-28" }],
      timeZone: "Asia/Dubai",
      windows: [{ windowStart: "2026-01-01", windowEnd: "2026-02-28", grain: "day", governedRowCount: 100 }],
    });

    await expect(
      repository.resolveWindowInput({
        organizationId: ORGANIZATION_ID,
        channelId: CHANNEL_ID,
        from: "2026-02-25",
        to: "2026-03-05",
      }),
    ).resolves.toBeNull();
  });

  it("resolves a covered range to its window, zone and evidence-voted grain", async () => {
    const repository = createRepositoryWithCoverage({
      packages: [{ declared_period_start: "2026-01-01", declared_period_end: "2026-02-28" }],
      timeZone: "Asia/Dubai",
      windows: [
        { windowStart: "2026-01-01", windowEnd: "2026-02-28", grain: "day", governedRowCount: 554 },
        { windowStart: "2026-01-01", windowEnd: "2026-02-28", grain: "span", governedRowCount: 2 },
      ],
    });

    await expect(
      repository.resolveWindowInput({
        organizationId: ORGANIZATION_ID,
        channelId: CHANNEL_ID,
        from: "2026-01-01",
        to: "2026-01-04",
      }),
    ).resolves.toEqual({
      windowStart: "2026-01-01",
      windowEnd: "2026-01-04",
      timeZone: "Asia/Dubai",
      // The daily package carries 554 governed rows against the span's 2, so
      // the grain is day. The operator never chooses this.
      grain: "day",
    });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm vitest run src/modules/analysis/infrastructure/read-repository.test.ts -t "loadCoverageSegments"`
Expected: FAIL — `repository.loadCoverageSegments is not a function`.

- [ ] **Step 3: Rewrite the two ports**

In `ports.ts`, replace the `loadAnalysisMonthTimeline` and `resolveMonthInput` declarations:

```ts
  /**
   * The unbroken stretches of dates this channel's projected packages declare.
   *
   * Declared periods rather than surviving evidence, for the reason the month
   * timeline used before it: a package whose rows were all superseded still
   * declared the period, and a gap inside a declaration must stay selectable
   * so the coverage detector can report it.
   */
  loadCoverageSegments(input: {
    organizationId: string;
    channelId: string | null;
  }): Promise<CoverageSegment[]>;

  /**
   * The server-resolved window: the picked range, the organization's zone, and
   * the grain the range's own packages wrote. Null when any day of the range is
   * outside the declared coverage, or when nothing is declared at all.
   */
  resolveWindowInput(input: {
    organizationId: string;
    channelId: string;
    from: string;
    to: string;
  }): Promise<{
    windowStart: string;
    windowEnd: string;
    timeZone: string;
    grain: AnalysisGrain;
  } | null>;
```

In `read-repository.ts`, replace `loadAnalysisMonthTimeline` with `loadCoverageSegments` — same two-query shape, but selecting both declared dates and merging them:

```ts
    async loadCoverageSegments({ organizationId, channelId }) {
      const base = supabase
        .from("integration_report_packages")
        .select("declared_period_start, declared_period_end")
        .eq("organization_id", organizationId)
        .eq("status", "projected")
        .not("declared_period_start", "is", null)
        .not("declared_period_end", "is", null);
      const { data, error } = await (channelId === null ? base : base.eq("channel_id", channelId))
        .order("declared_period_start", { ascending: true })
        .limit(MAX_EVIDENCE_WINDOWS);
      if (error) throw new ChannelAnalysisReadError(error.code ?? "unknown");

      return mergeCoverageSegments(
        (data ?? []).flatMap((row) =>
          typeof row.declared_period_start === "string" &&
          typeof row.declared_period_end === "string"
            ? [{ windowStart: row.declared_period_start, windowEnd: row.declared_period_end }]
            : [],
        ),
      );
    },
```

Replace `resolveMonthInput` with `resolveWindowInput`. The organization-zone read and the majority-grain vote are **carried over verbatim** from lines 798–835; only the admissibility check at the top changes:

```ts
    async resolveWindowInput({ organizationId, channelId, from, to }) {
      const segments = await repository.loadCoverageSegments({ organizationId, channelId });
      // The first of the two independent checks. The worker repeats it under
      // its lease, so a range that became uncovered between this read and the
      // claim is still refused.
      if (!isWindowCovered(from, to, segments)) return null;
      const bounds = { windowStart: from, windowEnd: to };

      const { data: orgRows, error: orgError } = await supabase
        .from("organizations")
        .select("default_timezone")
        .eq("id", organizationId)
        .limit(1);
      if (orgError) throw new ChannelAnalysisReadError(orgError.code ?? "unknown");
      const timeZone = (orgRows ?? [])[0]?.default_timezone;
      if (typeof timeZone !== "string" || timeZone.length === 0) return null;

      // Unchanged from the monthly resolver: the grain the range's own packages
      // wrote, by current-row majority with ties breaking finer. Packages
      // outside the range still vote when nothing declares it.
      const windows = await repository.loadEvidenceWindows({
        organizationId,
        channelId,
        limit: MAX_EVIDENCE_WINDOWS,
      });
      const overlapping = windows.filter(
        (candidate) =>
          candidate.windowStart <= bounds.windowEnd && candidate.windowEnd >= bounds.windowStart,
      );
      const pool = overlapping.length > 0 ? overlapping : windows;
      if (pool.length === 0) return { ...bounds, timeZone, grain: "day" };
      const fineness: readonly AnalysisGrain[] = ["day", "week", "month", "span"];
      const counts = new Map<AnalysisGrain, number>();
      for (const candidate of pool) {
        counts.set(candidate.grain, (counts.get(candidate.grain) ?? 0) + candidate.governedRowCount);
      }
      const [grain] = [...counts.entries()].sort(
        (left, right) => right[1] - left[1] || fineness.indexOf(left[0]) - fineness.indexOf(right[0]),
      )[0];
      return { ...bounds, timeZone, grain };
    },
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm vitest run src/modules/analysis/infrastructure/read-repository.test.ts`
Expected: PASS. Delete any surviving `loadAnalysisMonthTimeline` / `resolveMonthInput` tests as you go.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write src/modules/analysis/application/ports.ts src/modules/analysis/infrastructure/read-repository.ts src/modules/analysis/infrastructure/read-repository.test.ts
git add src/modules/analysis/application/ports.ts src/modules/analysis/infrastructure/read-repository.ts src/modules/analysis/infrastructure/read-repository.test.ts
git commit -m "feat(analysis): read coverage as date stretches, and resolve a picked window

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: A fail-soft cache and a fail-open limiter

Redis must never be able to break the page. This task establishes that as a property of the client, so no later caller has to remember it.

**Files:**
- Create: `src/lib/cache/redis.ts`, `src/lib/cache/rate-limit.ts`
- Test: `src/lib/cache/redis.test.ts`, `src/lib/cache/rate-limit.test.ts`
- Modify: `package.json` (add `@upstash/redis`, `@upstash/ratelimit`)

**Interfaces:**
- Produces:
  - `cacheGet<T>(key: string): Promise<T | null>`
  - `cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void>`
  - `consumeAnalysisRunAllowance(organizationId: string): Promise<boolean>` — `true` means allowed.

- [ ] **Step 1: Install the dependencies**

```bash
pnpm add @upstash/redis @upstash/ratelimit
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/cache/redis.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    get = mocks.get;
    set = mocks.set;
  },
}));

import { cacheGet, cacheSet } from "@/lib/cache/redis";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
});

describe("a cache that cannot break the page", () => {
  it("returns what was stored", async () => {
    mocks.get.mockResolvedValue({ findings: [] });

    await expect(cacheGet("analysis:view:v1:org:run:digest")).resolves.toEqual({ findings: [] });
  });

  it("reports a miss as null", async () => {
    mocks.get.mockResolvedValue(null);

    await expect(cacheGet("k")).resolves.toBeNull();
  });

  it("reports an outage as a miss, not as an error", async () => {
    // The whole point of this module. An Upstash outage must degrade the page
    // to its ordinary database reads, never to an error screen.
    mocks.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(cacheGet("k")).resolves.toBeNull();
  });

  it("swallows a failed write", async () => {
    mocks.set.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(cacheSet("k", { a: 1 }, 60)).resolves.toBeUndefined();
  });

  it("passes the ttl through as seconds", async () => {
    mocks.set.mockResolvedValue("OK");

    await cacheSet("k", { a: 1 }, 60);

    expect(mocks.set).toHaveBeenCalledWith("k", { a: 1 }, { ex: 60 });
  });

  it("is a miss when the service is not configured at all", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");

    await expect(cacheGet("k")).resolves.toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
```

Create `src/lib/cache/rate-limit.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ limit: vi.fn() }));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow = vi.fn(() => ({}));
    limit = mocks.limit;
  },
}));
vi.mock("@upstash/redis", () => ({ Redis: class {} }));

import { consumeAnalysisRunAllowance } from "@/lib/cache/rate-limit";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
});

describe("the analysis run allowance", () => {
  it("allows a run inside the limit", async () => {
    mocks.limit.mockResolvedValue({ success: true });

    await expect(consumeAnalysisRunAllowance("org-1")).resolves.toBe(true);
  });

  it("refuses a run over the limit", async () => {
    mocks.limit.mockResolvedValue({ success: false });

    await expect(consumeAnalysisRunAllowance("org-1")).resolves.toBe(false);
  });

  it("counts each organization separately", async () => {
    mocks.limit.mockResolvedValue({ success: true });

    await consumeAnalysisRunAllowance("org-1");

    expect(mocks.limit).toHaveBeenCalledWith(expect.stringContaining("org-1"));
  });

  it("fails open when the limiter itself is unreachable", async () => {
    // An outage in the cost control must not become an outage in the product.
    // A client waiting on their numbers is a worse failure than an unmetered
    // run, and the Apply gate still bounds how fast runs can be asked for.
    mocks.limit.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(consumeAnalysisRunAllowance("org-1")).resolves.toBe(true);
  });

  it("fails open when the service is not configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");

    await expect(consumeAnalysisRunAllowance("org-1")).resolves.toBe(true);
    expect(mocks.limit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run both tests and watch them fail**

Run: `pnpm vitest run src/lib/cache`
Expected: FAIL — both modules unresolved.

- [ ] **Step 4: Write both modules**

Create `src/lib/cache/redis.ts`:

```ts
import "server-only";

import { Redis } from "@upstash/redis";

import { logger } from "@/lib/logger";

/**
 * A cache that cannot break the page.
 *
 * Every read reports a failure as a miss and every write swallows one, so a
 * caller never has to decide what an outage means: it means the database
 * answers instead, which is what it did before this module existed. That
 * property belongs here rather than at each call site, because a single caller
 * forgetting it turns a cache outage into an outage.
 *
 * Nothing sensitive is logged -- the key names an organization and a run, and
 * only `error.name` travels.
 */
function client(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = client();
  if (redis === null) return null;
  try {
    return ((await redis.get(key)) as T | null) ?? null;
  } catch (error) {
    logger.warn("analysis_cache.read_failed", {
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const redis = client();
  if (redis === null) return;
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (error) {
    logger.warn("analysis_cache.write_failed", {
      errorCode: error instanceof Error ? error.name : "unknown",
    });
  }
}
```

Create `src/lib/cache/rate-limit.ts`:

```ts
import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { logger } from "@/lib/logger";

/**
 * How many analyses one organization may start for windows that are not
 * already computed.
 *
 * Starting a run costs a detector pass and an AI narration, and the Channel
 * Audit no longer gates that on a role -- anyone who can see the channel can
 * ask. This is the control that replaces the role gate. Cached windows do not
 * count against it, so reading is always free and unlimited.
 */
const RUNS_PER_HOUR = 30;

function limiter(): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(RUNS_PER_HOUR, "1 h"),
    prefix: "analysis:runs:v1",
  });
}

/** True when the run may start. Fails open. */
export async function consumeAnalysisRunAllowance(organizationId: string): Promise<boolean> {
  const rate = limiter();
  if (rate === null) return true;
  try {
    const { success } = await rate.limit(organizationId);
    if (!success) logger.info("channel_analysis.rate_limited", { organizationId });
    return success;
  } catch (error) {
    // An outage in the cost control must not become an outage in the product.
    logger.warn("channel_analysis.rate_limit_unavailable", {
      organizationId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return true;
  }
}
```

- [ ] **Step 5: Run both tests and watch them pass**

Run: `pnpm vitest run src/lib/cache`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
pnpm prettier --write src/lib/cache package.json
git add src/lib/cache package.json pnpm-lock.yaml
git commit -m "feat(cache): add a Redis client that degrades to the database on failure

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Cache the completed run, without the viewer's decisions

The one genuinely subtle cache. A completed run is immutable, so it can be held for days — but the assembled view carries *this viewer's* accept and dismiss decisions, and those must never be shared.

**Files:**
- Create: `src/modules/analysis/application/view-cache.ts`
- Test: `src/modules/analysis/application/view-cache.test.ts`

**Interfaces:**
- Consumes: `cacheGet`, `cacheSet` from Task 6.
- Produces: `readCachedRunPayload<T>(input: { organizationId: string; analysisRunId: string; resultDigest: string; load: () => Promise<T> }): Promise<T>` and `analysisViewCacheKey(input: { organizationId: string; analysisRunId: string; resultDigest: string }): string`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/analysis/application/view-cache.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cacheGet: vi.fn(), cacheSet: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cache/redis", () => ({ cacheGet: mocks.cacheGet, cacheSet: mocks.cacheSet }));

import { analysisViewCacheKey, readCachedRunPayload } from "@/modules/analysis/application/view-cache";

const key = {
  organizationId: "859cf039-1cd8-41b0-bd09-66c6c52e9c52",
  analysisRunId: "11111111-1111-4111-8111-111111111111",
  resultDigest: "a".repeat(64),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cacheGet.mockResolvedValue(null);
  mocks.cacheSet.mockResolvedValue(undefined);
});

describe("caching a completed run", () => {
  it("names the organization in the key, so no key is reachable across tenants", () => {
    expect(analysisViewCacheKey(key)).toContain(key.organizationId);
    expect(analysisViewCacheKey(key)).toContain(key.analysisRunId);
    expect(analysisViewCacheKey(key)).toContain(key.resultDigest);
  });

  it("loads from the database on a miss and stores the result", async () => {
    const load = vi.fn().mockResolvedValue({ findings: [{ id: "f1" }] });

    await expect(readCachedRunPayload({ ...key, load })).resolves.toEqual({
      findings: [{ id: "f1" }],
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(mocks.cacheSet).toHaveBeenCalledWith(
      analysisViewCacheKey(key),
      { findings: [{ id: "f1" }] },
      expect.any(Number),
    );
  });

  it("does not touch the database on a hit", async () => {
    mocks.cacheGet.mockResolvedValue({ findings: [{ id: "cached" }] });
    const load = vi.fn();

    await expect(readCachedRunPayload({ ...key, load })).resolves.toEqual({
      findings: [{ id: "cached" }],
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("changes key when the result digest changes", () => {
    // Two runs of the same id cannot exist, but a digest in the key means a
    // stored payload can never outlive the result it describes.
    expect(analysisViewCacheKey({ ...key, resultDigest: "b".repeat(64) })).not.toBe(
      analysisViewCacheKey(key),
    );
  });

  it("still answers from the database when the cache is down", async () => {
    mocks.cacheGet.mockResolvedValue(null);
    mocks.cacheSet.mockResolvedValue(undefined);
    const load = vi.fn().mockResolvedValue({ findings: [] });

    await expect(readCachedRunPayload({ ...key, load })).resolves.toEqual({ findings: [] });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm vitest run src/modules/analysis/application/view-cache.test.ts`
Expected: FAIL — module unresolved.

- [ ] **Step 3: Write the implementation**

Create `src/modules/analysis/application/view-cache.ts`:

```ts
import "server-only";

import { cacheGet, cacheSet } from "@/lib/cache/redis";

/**
 * A completed analysis run never changes, so its findings, its evidence and
 * its recommendation text can be held for as long as memory allows. The TTL
 * below is a memory bound, not a correctness device: there is no invalidation
 * to forget, because there is nothing that can go stale.
 *
 * What is deliberately *not* in here: the viewer's own accept and dismiss
 * decisions. `loadRecommendationsForRun` filters
 * `channel_recommendation_decisions` by `actor_id`, so an assembled view
 * carries "did *you* act on this". Storing that under a run id would hand one
 * operator another's decisions. Callers read decisions fresh, per person, and
 * merge them onto what comes back from here.
 *
 * Also deliberately not cached anywhere: the question "has this range been
 * analysed?". That is one indexed query, and caching it keyed on a date range
 * is exactly how a client is served an audit the reports have since
 * contradicted. See ADR 0043 and ADR 0047.
 */
const TTL_SECONDS = 7 * 24 * 60 * 60;

export function analysisViewCacheKey(input: {
  organizationId: string;
  analysisRunId: string;
  resultDigest: string;
}): string {
  // Organization-leading, so no key is reachable across tenants.
  return `analysis:view:v1:${input.organizationId}:${input.analysisRunId}:${input.resultDigest}`;
}

export async function readCachedRunPayload<T>(input: {
  organizationId: string;
  analysisRunId: string;
  resultDigest: string;
  load: () => Promise<T>;
}): Promise<T> {
  const key = analysisViewCacheKey(input);
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;
  const loaded = await input.load();
  await cacheSet(key, loaded, TTL_SECONDS);
  return loaded;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm vitest run src/modules/analysis/application/view-cache.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write src/modules/analysis/application/view-cache.ts src/modules/analysis/application/view-cache.test.ts
git add src/modules/analysis/application/view-cache.ts src/modules/analysis/application/view-cache.test.ts
git commit -m "feat(analysis): cache a completed run, and never a viewer's own decisions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 8: The route speaks in windows

The first of the two independent admissibility checks, plus the rate limit that replaces the role gate.

**Files:**
- Modify: `src/app/api/organizations/[organizationId]/channels/[channelId]/analysis/route.ts`
- Test: `src/app/api/organizations/[organizationId]/channels/[channelId]/analysis/route.test.ts`

**Interfaces:**
- Consumes: `resolveWindowInput` (Task 5), `consumeAnalysisRunAllowance` (Task 6), `requestChannelAnalysis` from `@/modules/analysis/application/dispatch`.
- Produces: `POST` accepting `{ from: string; to: string }`, answering `202 { analysisRunId, correlationId }`.

- [ ] **Step 1: Write the failing test**

In `route.test.ts`, rename the `repositoryMocks.resolveMonthInput` hoisted mock to `resolveWindowInput` (both in the `vi.hoisted` block and in the `vi.mock` factory), add a `consumeAnalysisRunAllowance` mock, and add these tests:

```ts
const rateMocks = vi.hoisted(() => ({ consume: vi.fn() }));
vi.mock("@/lib/cache/rate-limit", () => ({
  consumeAnalysisRunAllowance: rateMocks.consume,
}));

describe("POST channel analysis, by window", () => {
  beforeEach(() => {
    rateMocks.consume.mockResolvedValue(true);
    mocks.requestChannelAnalysis.mockResolvedValue(true);
    repositoryMocks.resolveWindowInput.mockResolvedValue({
      windowStart: "2026-01-01",
      windowEnd: "2026-01-04",
      timeZone: "Asia/Dubai",
      grain: "day",
    });
  });

  it("starts a run for a covered four-day range", async () => {
    const response = await POST(request({ from: "2026-01-01", to: "2026-01-04" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    expect(response.status).toBe(202);
    expect(mocks.requestChannelAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION,
        channelId: CHANNEL,
        branchId: null,
        windowStart: "2026-01-01",
        windowEnd: "2026-01-04",
        periodGrain: "day",
        windowTimezone: "Asia/Dubai",
      }),
    );
  });

  it("refuses a range the reports do not cover", async () => {
    repositoryMocks.resolveWindowInput.mockResolvedValue(null);

    const response = await POST(request({ from: "2026-03-01", to: "2026-03-04" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    // 400, not 422: `apiErrorResponse` maps VALIDATION_ERROR to 400.
    expect(response.status).toBe(400);
    expect(mocks.requestChannelAnalysis).not.toHaveBeenCalled();
  });

  it("refuses a reversed range", async () => {
    const response = await POST(request({ from: "2026-01-04", to: "2026-01-01" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    // A Zod refusal, which this codebase answers with 400.
    expect(response.status).toBe(400);
    expect(repositoryMocks.resolveWindowInput).not.toHaveBeenCalled();
  });

  it("refuses a range wider than a run may cover", async () => {
    const response = await POST(request({ from: "2024-01-01", to: "2026-01-01" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    expect(response.status).toBe(400);
    expect(repositoryMocks.resolveWindowInput).not.toHaveBeenCalled();
  });

  it("refuses a malformed date rather than passing it to the resolver", async () => {
    const response = await POST(request({ from: "2026-02-30", to: "2026-03-01" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    expect(response.status).toBe(400);
  });

  it("refuses when the organization is over its run allowance", async () => {
    rateMocks.consume.mockResolvedValue(false);

    const response = await POST(request({ from: "2026-01-01", to: "2026-01-04" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    expect(response.status).toBe(429);
    expect(mocks.requestChannelAnalysis).not.toHaveBeenCalled();
  });

  it("checks coverage before spending the allowance", async () => {
    // An uncovered range must not consume the organization's budget. Order
    // matters: a mistyped date should cost nothing.
    repositoryMocks.resolveWindowInput.mockResolvedValue(null);

    await POST(request({ from: "2026-03-01", to: "2026-03-04" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    expect(rateMocks.consume).not.toHaveBeenCalled();
  });

  it("resolves coverage against the organization in the URL, never one supplied elsewhere", async () => {
    // Tenant isolation. The resolver is called with the route's own
    // organization id, read through the caller's RLS-scoped client, so a
    // range covered in another tenant is not covered here.
    await POST(request({ from: "2026-01-01", to: "2026-01-04" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    expect(repositoryMocks.resolveWindowInput).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      channelId: CHANNEL,
      from: "2026-01-01",
      to: "2026-01-04",
    });
  });

  it("lets a member without report.retry start a run", async () => {
    // The role gate is deliberately gone; the rate limit is the control that
    // replaces it. See ADR 0047.
    mocks.getOrganizationContext.mockResolvedValue(contextWithRole("viewer"));

    const response = await POST(request({ from: "2026-01-01", to: "2026-01-04" }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
    });

    expect(response.status).toBe(202);
  });
});
```

Add the helper the last test needs, matching the context shape the existing tests build:

```ts
function contextWithRole(role: string) {
  return {
    organizationId: ORGANIZATION,
    membership: { role },
    user: { id: "66666666-6666-4666-8666-666666666666" },
    supabase: {},
  };
}
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm vitest run "src/app/api/organizations/[organizationId]/channels/[channelId]/analysis/route.test.ts"`
Expected: FAIL — the route still parses `month`, so every new test gets 422 or calls the wrong resolver.

- [ ] **Step 3: Rewrite the route**

In `route.ts`: replace the body schema, drop the `hasOrganizationPermission` import and its check, add the rate limit, and update the module comment.

```ts
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A picked range, not a month.
 *
 * The dates are the operator's, but their admissibility is not: the resolver
 * below re-decides it against the channel's declared coverage, and the worker
 * decides it a second time under its lease. See ADR 0047.
 */
const bodySchema = z
  .object({
    from: z.string().regex(LOCAL_DATE, "Use a YYYY-MM-DD date."),
    to: z.string().regex(LOCAL_DATE, "Use a YYYY-MM-DD date."),
  })
  .strict()
  .superRefine((value, ctx) => {
    let span: number;
    try {
      // Rejects the 31st of February rather than rolling it into March.
      span = localDaysBetween(value.from, value.to);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "That is not a real date." });
      return;
    }
    if (span < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The end date is before the start." });
    }
    // `>` not `>=`, matching the database's `<= 400` check exactly. See Task 1.
    if (span > MAX_ANALYSIS_WINDOW_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "That range is wider than one analysis can cover. Pick a shorter period.",
      });
    }
  });
```

Then in the handler, replacing the permission check and the month resolution:

```ts
      const body = bodySchema.parse(await request.json().catch(() => ({})));
      // Channel-wide: the picker names no branch, so the run analyses every
      // branch this channel trades through.
      const resolved = await createAuthenticatedChannelAnalysisRepository(
        context.supabase,
      ).resolveWindowInput({
        organizationId: routeParams.organizationId,
        channelId: routeParams.channelId,
        from: body.from,
        to: body.to,
      });
      if (resolved === null) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "That range is outside this channel's reported dates. Pick a period your approved reports declare.",
        );
      }

      // After coverage, never before: a mistyped date must not cost the
      // organization part of its allowance. Starting a run costs a detector
      // pass and an AI narration, and this route no longer gates that on a
      // role, so this is the control that replaces it. Reading an
      // already-computed range never reaches here.
      if (!(await consumeAnalysisRunAllowance(routeParams.organizationId))) {
        throw new DomainError(
          "RATE_LIMITED",
          "This organization has started a lot of analyses in the last hour. Ranges you have already analysed still open instantly; try a new one again shortly.",
        );
      }
```

and pass the window to the dispatch, dropping `month`:

```ts
      const dispatched = await requestChannelAnalysis({
        organizationId: routeParams.organizationId,
        channelId: routeParams.channelId,
        branchId: null,
        windowStart: resolved.windowStart,
        windowEnd: resolved.windowEnd,
        periodGrain: resolved.grain,
        windowTimezone: resolved.timeZone,
        analysisRunId,
        correlationId,
      });
```

Update the `logger.info("channel_analysis.requested", …)` call to log `windowStart` and `windowEnd` in place of `month`.

- [ ] **Step 4: Map RATE_LIMITED to 429**

`apiErrorResponse` in `src/lib/api/organization-context.ts:42-53` is a ternary chain, not a lookup table. Extend it, leaving every existing arm as it is:

```ts
  const status =
    publicError.code === "AUTHENTICATION_ERROR"
      ? 401
      : publicError.code === "AUTHORIZATION_ERROR"
        ? 403
        : publicError.code === "VALIDATION_ERROR"
          ? 400
          : publicError.code === "RATE_LIMITED"
            ? 429
            : 422;
```

Check that `toPublicError` in `@/lib/errors` passes `RATE_LIMITED` through rather than collapsing unknown codes; if it has an allowlist, add the code there too.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm vitest run "src/app/api/organizations/[organizationId]/channels/[channelId]/analysis/route.test.ts"`
Expected: PASS. Delete the superseded month tests.

- [ ] **Step 6: Commit**

```bash
pnpm prettier --write "src/app/api/organizations/[organizationId]/channels/[channelId]/analysis/route.ts" "src/app/api/organizations/[organizationId]/channels/[channelId]/analysis/route.test.ts" src/lib/api/organization-context.ts
git add "src/app/api/organizations/[organizationId]/channels/[channelId]" src/lib/api/organization-context.ts
git commit -m "feat(analysis): accept a picked range, and meter what it costs to start

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The worker checks the range for itself

> **Failure codes are a closed set enforced in the database.**
> `fail_channel_analysis` accepts only `EVIDENCE_UNAVAILABLE`,
> `WINDOW_CONTEXT_UNAVAILABLE`, `DETECTOR_REGISTRY_MISMATCH` and
> `ANALYSIS_PROCESSING_FAILED`
> (`supabase/migrations/20260823120000_governed_channel_analysis_findings.sql:809`).
> Anything else raises `22023` at execution time — on the refusal path only, which
> every happy-path test passes straight over. This plan originally invented
> `WINDOW_NOT_DECLARED`; do not reintroduce it.

The second independent admissibility check. This is what makes browser-supplied dates safe: even a request that bypassed the route entirely cannot analyse a window the reports do not declare.

**Files:**
- Modify: `src/workflows/analysis/run-channel-analysis.ts`
- Modify: `src/trigger/analysis.ts:41-44`
- Modify: `src/domain/analysis/digest.ts` (delete `createMonthlyAnalysisCacheKey`)
- Modify: `src/domain/analysis/digest.test.ts` (delete its tests)
- Modify: `src/modules/analysis/application/dispatch.ts:20-40`
- Test: `src/workflows/analysis/run-channel-analysis.test.ts`, `src/modules/analysis/application/dispatch.test.ts`

**Interfaces:**
- Consumes: `isWindowCovered`, `mergeCoverageSegments` (Task 1), `createWindowAnalysisCacheKey` (Task 4), `loadCoverageSegments` (Task 5).
- Produces: `channelAnalysisTaskSchema` without `month`; the dependency `loadCoverageSegments(input: { organizationId: string; channelId: string | null }): Promise<CoverageSegment[]>` replacing `loadMonthHorizon`.

- [ ] **Step 1: Write the failing test**

Add to `src/workflows/analysis/run-channel-analysis.test.ts`:

```ts
describe("the worker's own coverage check", () => {
  it("refuses a window the channel's reports do not declare", async () => {
    // The route checks this too. This is the check that still holds when the
    // route is bypassed, and the one that still holds when a package was
    // withdrawn between the operator pressing Apply and the worker claiming.
    const claim = vi.fn();
    const result = await runChannelAnalysis(
      payload({ windowStart: "2026-03-01", windowEnd: "2026-03-04" }),
      dependencies({
        loadCoverageSegments: vi
          .fn()
          .mockResolvedValue([{ start: "2026-01-01", end: "2026-02-28" }]),
        claim,
      }),
    );

    expect(result.outcome).toBe("failed");
    expect(claim).not.toHaveBeenCalled();
  });

  it("claims a covered window with a key built from the window, not a month", async () => {
    const claim = vi.fn().mockResolvedValue({
      outcome: "acquired",
      windowTimezone: "Asia/Dubai",
      boundDetectors: [],
    });

    await runChannelAnalysis(
      payload({ windowStart: "2026-01-01", windowEnd: "2026-01-04" }),
      dependencies({
        loadCoverageSegments: vi
          .fn()
          .mockResolvedValue([{ start: "2026-01-01", end: "2026-02-28" }]),
        claim,
      }),
    );

    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        windowStart: "2026-01-01",
        windowEnd: "2026-01-04",
        cacheKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm vitest run src/workflows/analysis/run-channel-analysis.test.ts -t "the worker's own coverage check"`
Expected: FAIL — the dependency is still named `loadMonthHorizon`.

- [ ] **Step 3: Convert the monthly path to a window path**

In `run-channel-analysis.ts`:

- In `channelAnalysisTaskSchema` (around line 52): delete the `month` field and the `.refine` that pairs it with `windowTimezone`. Make `windowTimezone` required.
- Replace the `loadMonthHorizon?` dependency (around line 132) with a required `loadCoverageSegments`:

```ts
  /**
   * The stretches of dates this channel's projected packages declare, read by
   * the worker itself. The route checked the same thing before dispatching;
   * this is the check that still holds when the route is bypassed, and the one
   * that still holds when a package was withdrawn in between.
   */
  loadCoverageSegments(input: {
    organizationId: string;
    channelId: string | null;
  }): Promise<CoverageSegment[]>;
```

- Delete the `payload.month !== undefined` branch (around line 269) and the `MonthlyPayload` type (around line 389). Rename `runMonthlyChannelAnalysis` to `runWindowChannelAnalysis` and make it the only path.
- Inside it, replace the horizon read and `resolveAnalysisMonth` (around lines 424–441) with:

```ts
    const segments = await dependencies.loadCoverageSegments({
      organizationId: payload.organizationId,
      channelId: payload.channelId,
    });
    if (!isWindowCovered(payload.windowStart, payload.windowEnd, segments)) {
      throw new ChannelAnalysisFailure("WINDOW_CONTEXT_UNAVAILABLE");
    }
    const resolved = { windowStart: payload.windowStart, windowEnd: payload.windowEnd };
```

- Replace the `createMonthlyAnalysisCacheKey` call (around line 468) with `createWindowAnalysisCacheKey`, dropping the `month` argument and keeping every other argument as it is.

In `src/trigger/analysis.ts`, replace the `loadMonthHorizon` dependency:

```ts
      async loadCoverageSegments(input) {
        return reads.loadCoverageSegments(input);
      },
```

**And in the same commit, delete `createMonthlyAnalysisCacheKey` from
`src/domain/analysis/digest.ts`.** Task 4 added `createWindowAnalysisCacheKey` beside
it deliberately, so that every commit between then and now would compile. This is the
commit that stops calling the old one, so this is the commit that removes it. Delete
its tests too, and confirm `npx tsc --noEmit` is clean afterwards — a leftover caller
would surface here.

**And in the same commit, `src/modules/analysis/application/dispatch.ts`.** The
schema above is `.strict()`, and `requestChannelAnalysis` still forwards a
`month` field into the payload it triggers. A commit that removes `month` from
the schema while its only caller still sends it leaves a dispatch the worker
rejects, so the two change together. In `requestChannelAnalysis`: delete
`month` from both the input type and the triggered payload, and make
`windowTimezone: string` required rather than optional.

Update `dispatch.test.ts` accordingly — any test passing `month` is asserting a
payload shape that no longer exists.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm vitest run src/workflows/analysis src/trigger src/modules/analysis/application/dispatch.test.ts`
Expected: PASS. Update any existing test that passed `month` in a payload.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write src/workflows/analysis/run-channel-analysis.ts src/workflows/analysis/run-channel-analysis.test.ts src/trigger/analysis.ts src/modules/analysis/application/dispatch.ts src/modules/analysis/application/dispatch.test.ts
git add src/workflows/analysis src/trigger/analysis.ts src/modules/analysis/application/dispatch.ts src/modules/analysis/application/dispatch.test.ts
git commit -m "feat(analysis): make the worker re-decide the window under its own lease

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Auto-analysis joins the cached path

Without this, picking the exact range an auto-run already computed recomputes it from scratch — and the run that fixes the Nostaza display defect stays uncached.

**Files:**
- Modify: `src/modules/reports/application/auto-analysis.ts`
- Modify: `src/trigger/reports.ts`
- Test: `src/modules/reports/application/auto-analysis.test.ts`

**Interfaces:**
- Consumes: `requestChannelAnalysis` with `windowTimezone` now required.
- Produces: `AutoAnalysisInput` gaining `windowTimezone: string`.

- [ ] **Step 1: Write the failing test**

Add to `src/modules/reports/application/auto-analysis.test.ts`:

```ts
it("carries the package's timezone so the run joins the cached path", async () => {
  // Before this, an auto-dispatched run carried no timezone and therefore no
  // cache key, so an operator picking exactly the range it had already
  // analysed paid for the whole thing twice.
  const requestAnalysis = vi.fn().mockResolvedValue(true);

  await dispatchAnalysisForCleanProjection(
    {
      organizationId: ORGANIZATION_ID,
      correlationId: CORRELATION_ID,
      completion: {
        projectionOutcome: "projected",
        packageStatus: "projected",
        channelId: CHANNEL_ID,
        branchId: BRANCH_ID,
        windowStart: "2026-01-01",
        windowEnd: "2026-02-28",
        periodGrain: "day",
        periodTimezone: "Asia/Dubai",
      },
    },
    { requestAnalysis },
  );

  expect(requestAnalysis).toHaveBeenCalledWith(
    expect.objectContaining({
      windowStart: "2026-01-01",
      windowEnd: "2026-02-28",
      windowTimezone: "Asia/Dubai",
    }),
  );
});

it("dispatches nothing when the package declares no timezone", () => {
  // Fail closed. A run without a zone cannot be cached and cannot be
  // reproduced, so it is better not started.
  expect(
    selectAutoAnalysisInput({
      projectionOutcome: "projected",
      packageStatus: "projected",
      channelId: CHANNEL_ID,
      branchId: BRANCH_ID,
      windowStart: "2026-01-01",
      windowEnd: "2026-02-28",
      periodGrain: "day",
      periodTimezone: null,
    }),
  ).toBeNull();
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm vitest run src/modules/reports/application/auto-analysis.test.ts`
Expected: FAIL — `windowTimezone` is absent from the dispatched input.

- [ ] **Step 3: Thread the timezone through**

In `auto-analysis.ts`, add `periodTimezone: unknown` to `ProjectionCompletionSummary`, add `windowTimezone: string` to `AutoAnalysisInput`, and narrow it in `selectAutoAnalysisInput` alongside the existing string checks:

```ts
  const { channelId, branchId, windowStart, windowEnd, periodGrain, periodTimezone } = completion;
  if (
    typeof channelId !== "string" ||
    typeof branchId !== "string" ||
    typeof windowStart !== "string" ||
    typeof windowEnd !== "string" ||
    // A run with no zone cannot be cache-keyed and cannot be reproduced, so it
    // is better not started than started unreproducibly.
    typeof periodTimezone !== "string" ||
    periodTimezone.length === 0 ||
    periodGrain === null
  ) {
    return null;
  }
  return { channelId, branchId, windowStart, windowEnd, periodGrain, windowTimezone: periodTimezone };
```

`dispatch.ts` already requires `windowTimezone` and no longer carries `month` — Task 9 did that, because the payload's schema and its only caller are one interface.

In `src/trigger/reports.ts:683`, confirm the completion row passed as `completion` includes `period_timezone`; map it to `periodTimezone` if the property name differs. Check with:

```bash
grep -n "periodGrain\|period_timezone\|completion" src/trigger/reports.ts | sed -n '1,25p'
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm vitest run src/modules/reports src/modules/analysis`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write src/modules/reports/application/auto-analysis.ts src/modules/reports/application/auto-analysis.test.ts src/trigger/reports.ts
git add src/modules/reports/application/auto-analysis.ts src/modules/reports/application/auto-analysis.test.ts src/trigger/reports.ts
git commit -m "fix(analysis): let an auto-dispatched run be reused instead of recomputed

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: The status the loader polls

Four honest stages, from two real facts: whether the run row exists and has completed, and whether the narration that follows it has landed.

**Files:**
- Create: `src/app/api/organizations/[organizationId]/channels/[channelId]/analysis/status/route.ts`
- Test: `src/app/api/organizations/[organizationId]/channels/[channelId]/analysis/status/route.test.ts`

**Interfaces:**
- Consumes: `getOrganizationContext`, `createAuthenticatedChannelAnalysisRepository`.
- Produces: `GET ?from=&to=` answering `200 { stage: "queued" | "running" | "narrating" | "ready" | "failed"; analysisRunId: string | null }`.

- [ ] **Step 1: Write the failing test**

Create the test file, following the mock pattern in the sibling `analysis/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertEnabled: vi.fn(),
  loadRunForWindow: vi.fn(),
}));

vi.mock("@/modules/integrations/application/feature-access", () => ({
  assertGovernedChannelAnalysisEnabled: mocks.assertEnabled,
}));
vi.mock("@/lib/api/organization-context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/organization-context")>(
    "@/lib/api/organization-context",
  );
  return { ...actual, getOrganizationContext: mocks.getOrganizationContext };
});
vi.mock("@/modules/analysis/infrastructure/read-repository", () => ({
  createAuthenticatedChannelAnalysisRepository: vi.fn(() => ({
    loadRunForWindow: mocks.loadRunForWindow,
  })),
}));

import { GET } from "@/app/api/organizations/[organizationId]/channels/[channelId]/analysis/status/route";

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";
const CHANNEL = "55555555-5555-4555-8555-555555555555";
const RUN = "77777777-7777-4777-8777-777777777777";

const params = Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL });
const url = "https://example.test/status?from=2026-01-01&to=2026-01-04";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId: ORGANIZATION,
    membership: { role: "viewer" },
    user: { id: "66666666-6666-4666-8666-666666666666" },
    supabase: {},
  });
});

describe("GET analysis status", () => {
  it("reports queued when no run exists for the window yet", async () => {
    mocks.loadRunForWindow.mockResolvedValue(null);

    const body = await (await GET(new Request(url), { params })).json();

    expect(body).toEqual({ stage: "queued", analysisRunId: null });
  });

  it("reports running while the detectors are counting", async () => {
    mocks.loadRunForWindow.mockResolvedValue({ id: RUN, status: "running", recommendationCount: 0 });

    const body = await (await GET(new Request(url), { params })).json();

    expect(body).toEqual({ stage: "running", analysisRunId: RUN });
  });

  it("reports narrating once the run has completed but no recommendation has landed", async () => {
    // Narration is a second Trigger task that finishes after the detector run
    // (ADR 0037), so "completed" is not yet "ready" for the operator.
    mocks.loadRunForWindow.mockResolvedValue({
      id: RUN,
      status: "completed",
      recommendationCount: 0,
    });

    const body = await (await GET(new Request(url), { params })).json();

    expect(body).toEqual({ stage: "narrating", analysisRunId: RUN });
  });

  it("reports ready once recommendations exist", async () => {
    mocks.loadRunForWindow.mockResolvedValue({
      id: RUN,
      status: "completed",
      recommendationCount: 6,
    });

    const body = await (await GET(new Request(url), { params })).json();

    expect(body).toEqual({ stage: "ready", analysisRunId: RUN });
  });

  it("reports a failed run rather than polling forever", async () => {
    mocks.loadRunForWindow.mockResolvedValue({ id: RUN, status: "failed", recommendationCount: 0 });

    const body = await (await GET(new Request(url), { params })).json();

    expect(body).toEqual({ stage: "failed", analysisRunId: RUN });
  });

  it("refuses a malformed range without reaching the database", async () => {
    const response = await GET(new Request("https://example.test/status?from=nonsense"), { params });

    expect(response.status).toBe(400);
    expect(mocks.loadRunForWindow).not.toHaveBeenCalled();
  });

  it("scopes the read to the organization in the URL", async () => {
    mocks.loadRunForWindow.mockResolvedValue(null);

    await GET(new Request(url), { params });

    expect(mocks.loadRunForWindow).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      channelId: CHANNEL,
      windowStart: "2026-01-01",
      windowEnd: "2026-01-04",
    });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm vitest run "src/app/api/organizations/[organizationId]/channels/[channelId]/analysis/status/route.test.ts"`
Expected: FAIL — module unresolved.

- [ ] **Step 3: Add the port, then the route**

Add `loadRunForWindow` to `ports.ts` and implement it in `read-repository.ts`. It reads the newest run for exactly this window, joined to a count of its recommendations, using the existing `(organization_id, channel_id, window_start desc, created_at desc)` index:

```ts
  /**
   * The newest run for exactly this window, and whether its narration landed.
   *
   * Exactly this window, never one that merely covers it: two windows are two
   * questions, and showing one window's figures under another's heading is the
   * defect this whole change exists to remove.
   */
  loadRunForWindow(input: {
    organizationId: string;
    channelId: string;
    windowStart: string;
    windowEnd: string;
  }): Promise<{ id: string; status: string; recommendationCount: number } | null>;
```

Then create the route. It validates `from`/`to` with the same rules as Task 8, calls `assertGovernedChannelAnalysisEnabled`, reads through the caller's RLS-scoped client, and maps the row to a stage:

```ts
      const run = await createAuthenticatedChannelAnalysisRepository(
        context.supabase,
      ).loadRunForWindow({
        organizationId: routeParams.organizationId,
        channelId: routeParams.channelId,
        windowStart: parsed.from,
        windowEnd: parsed.to,
      });

      // Four stages from two facts. Nothing here is invented: each one is a
      // state the pipeline is genuinely in, which is why the loader can name
      // it without lying about progress.
      const stage =
        run === null
          ? "queued"
          : run.status === "failed"
            ? "failed"
            : run.status === "running"
              ? "running"
              : run.recommendationCount > 0
                ? "ready"
                : "narrating";

      return NextResponse.json({ stage, analysisRunId: run?.id ?? null });
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm vitest run "src/app/api/organizations/[organizationId]/channels/[channelId]/analysis"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write "src/app/api/organizations/[organizationId]/channels/[channelId]/analysis/status" src/modules/analysis/application/ports.ts src/modules/analysis/infrastructure/read-repository.ts
git add "src/app/api/organizations/[organizationId]/channels/[channelId]/analysis/status" src/modules/analysis/application/ports.ts src/modules/analysis/infrastructure/read-repository.ts
git commit -m "feat(analysis): report which stage a window's analysis has reached

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: The range picker

**Files:**
- Create: `src/components/ui/calendar.tsx`, `src/components/analysis/window-range-picker.tsx`
- Test: `src/components/analysis/window-range-picker.test.tsx`
- Modify: `package.json` (`react-day-picker`)

**Interfaces:**
- Consumes: `CoverageSegment`, `CoverageWindow`, `AnalysisWindowSelection`, `describeGrainMismatch`, `isWindowCovered` (Tasks 1–3).
- Produces:

```ts
export function WindowRangePicker(props: {
  segments: readonly CoverageSegment[];
  windows: readonly CoverageWindow[];
  selected: AnalysisWindowSelection;
  today: string;
  onApply: (selection: AnalysisWindowSelection) => void;
  disabled?: boolean;
}): React.ReactElement;
```

- [ ] **Step 1: Add the Calendar primitive**

```bash
pnpm dlx shadcn@latest add calendar
```

If the registry is unreachable, add `react-day-picker` with `pnpm add react-day-picker` and hand-write `src/components/ui/calendar.tsx` wrapping `DayPicker` with `mode="range"`, matching the class conventions already used in `src/components/ui/select.tsx`.

- [ ] **Step 2: Write the failing test**

Create `src/components/analysis/window-range-picker.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WindowRangePicker } from "@/components/analysis/window-range-picker";

const segments = [
  { start: "2026-01-01", end: "2026-02-28" },
  { start: "2026-05-01", end: "2026-08-31" },
];
const dailyWindow = {
  windowStart: "2026-01-01",
  windowEnd: "2026-02-28",
  grain: "day" as const,
  governedRowCount: 554,
};
const monthlyWindow = {
  windowStart: "2026-05-01",
  windowEnd: "2026-08-31",
  grain: "month" as const,
  governedRowCount: 16,
};

function setup(overrides: Partial<React.ComponentProps<typeof WindowRangePicker>> = {}) {
  const onApply = vi.fn();
  render(
    <WindowRangePicker
      segments={segments}
      windows={[dailyWindow, monthlyWindow]}
      selected={{ from: "2026-01-01", to: "2026-01-04" }}
      today="2026-09-07"
      onApply={onApply}
      {...overrides}
    />,
  );
  return { onApply, user: userEvent.setup() };
}

describe("the window range picker", () => {
  it("names the selected range on its trigger", async () => {
    setup();

    // `formatWindow` renders exact recorded dates, never a month name -- its
    // own comment says so, and every other date on this workspace reads the
    // same way. A picker with a second date language would be worse than a
    // verbose label.
    expect(
      screen.getByRole("button", { name: /2026-01-01 to 2026-01-04/ }),
    ).toBeInTheDocument();
  });

  it("offers Last 7 days disabled, and says why", async () => {
    // This client's reports cover January-February and May-August while today
    // is September, so the most natural preset is the one that cannot work.
    // Hiding it would leave an operator wondering; showing it disabled answers
    // the question before it is asked.
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /2026-01-01/ }));

    const preset = screen.getByRole("button", { name: /last 7 days/i });
    expect(preset).toBeDisabled();
    expect(preset).toHaveAccessibleDescription(/no approved report covers/i);
  });

  it("applies a preset that does fall inside coverage", async () => {
    const { onApply, user } = setup();
    await user.click(screen.getByRole("button", { name: /2026-01-01/ }));
    await user.click(screen.getByRole("button", { name: /all reported/i }));
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    // "All reported" is the stretch containing the current selection, not the
    // union across a gap: a range bridging March and April is unanswerable.
    expect(onApply).toHaveBeenCalledWith({ from: "2026-01-01", to: "2026-02-28" });
  });

  it("warns before applying a range the reports cannot resolve", async () => {
    const { user } = setup({ selected: { from: "2026-08-01", to: "2026-08-04" } });
    await user.click(screen.getByRole("button", { name: /2026-08-01/ }));

    const warning = screen.getByRole("status");
    expect(within(warning).getByText(/one figure per month/i)).toBeInTheDocument();
    expect(within(warning).getByText(/2026-05-01.*2026-08-31/)).toBeInTheDocument();
  });

  it("widens to the range that works in one click", async () => {
    const { onApply, user } = setup({ selected: { from: "2026-08-01", to: "2026-08-04" } });
    await user.click(screen.getByRole("button", { name: /2026-08-01/ }));
    await user.click(screen.getByRole("button", { name: /use 2026-08-01 to 2026-08-31/i }));
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(onApply).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("does not warn when one of several reports can answer", async () => {
    const { user } = setup({ selected: { from: "2026-01-01", to: "2026-01-04" } });
    await user.click(screen.getByRole("button", { name: /2026-01-01/ }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not apply anything while the workspace is busy", async () => {
    const { onApply, user } = setup({ disabled: true });
    await user.click(screen.getByRole("button", { name: /2026-01-01/ }));

    expect(onApply).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `pnpm vitest run src/components/analysis/window-range-picker.test.tsx`
Expected: FAIL — module unresolved.

- [ ] **Step 4: Write the component**

Create `src/components/analysis/window-range-picker.tsx`. It is a client component holding a `Popover` (from `@/components/ui/popover`) containing the `Calendar` in `mode="range"`, a preset rail, the warning, and Apply. Key requirements, each covered by a test above:

- Days outside `segments` are passed to `Calendar`'s `disabled` matcher.
- Presets are computed against `segments`; one that is not covered renders `disabled` with an `aria-describedby` note reading *"No approved report covers those dates."*
- *All reported* resolves to the **one segment containing the current selection**, never the union across a gap.
- The warning renders only when `describeGrainMismatch` returns a value, inside `role="status"`, naming the grain in plain words (`"one figure per month"`, `"one figure for the whole period"`) and the declared range.
- The widen button's label names the suggested range through `formatWindow`, so it reads "Use 2026-08-01 to 2026-08-31"; selecting it sets the draft selection without applying it.
- Apply calls `onApply` with the draft and closes the popover; it is `disabled` when `props.disabled` is set or when the draft is not covered.
- Dates render through the existing `formatWindow` helper in `@/components/analysis/format` so this control reads the same as the rest of the workspace.

- [ ] **Step 5: Run the test and watch it pass**

Run: `pnpm vitest run src/components/analysis/window-range-picker.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
pnpm prettier --write src/components/ui/calendar.tsx src/components/analysis/window-range-picker.tsx src/components/analysis/window-range-picker.test.tsx package.json
git add src/components/ui/calendar.tsx src/components/analysis/window-range-picker.tsx src/components/analysis/window-range-picker.test.tsx package.json pnpm-lock.yaml
git commit -m "feat(analysis): let an operator pick any range their reports cover

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: The staged loader

**Files:**
- Create: `src/components/analysis/analysis-progress.tsx`
- Test: `src/components/analysis/analysis-progress.test.tsx`

**Interfaces:**
- Consumes: the status route from Task 11.
- Produces:

```ts
export type AnalysisStage = "queued" | "running" | "narrating" | "ready" | "failed";

export function AnalysisProgress(props: {
  organizationId: string;
  channelId: string;
  window: { from: string; to: string };
  onReady: () => void;
  pollMs?: number;
}): React.ReactElement;
```

- [ ] **Step 1: Write the failing test**

Create `src/components/analysis/analysis-progress.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalysisProgress } from "@/components/analysis/analysis-progress";

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";
const CHANNEL = "55555555-5555-4555-8555-555555555555";

function stage(value: string) {
  return { ok: true, json: async () => ({ stage: value, analysisRunId: null }) } as Response;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(responses: Response[]) {
  const fetchMock = vi.fn();
  responses.forEach((response) => fetchMock.mockResolvedValueOnce(response));
  fetchMock.mockResolvedValue(responses[responses.length - 1]);
  vi.stubGlobal("fetch", fetchMock);
  const onReady = vi.fn();
  render(
    <AnalysisProgress
      organizationId={ORGANIZATION}
      channelId={CHANNEL}
      window={{ from: "2026-01-01", to: "2026-01-04" }}
      onReady={onReady}
      pollMs={10}
    />,
  );
  return { fetchMock, onReady };
}

describe("the analysis loader", () => {
  it("says it is reading the reports before a run exists", async () => {
    setup([stage("queued")]);

    expect(await screen.findByText(/reading approved reports/i)).toBeInTheDocument();
  });

  it("advances to the checks when the run starts", async () => {
    setup([stage("queued"), stage("running")]);

    expect(await screen.findByText(/running the checks/i)).toBeInTheDocument();
  });

  it("advances to the narration when the counting finishes", async () => {
    // Two distinct stages because they are two distinct Trigger tasks. An
    // operator watching a bar that stops moving deserves to know the second
    // one has started.
    setup([stage("running"), stage("narrating")]);

    expect(await screen.findByText(/writing recommendations/i)).toBeInTheDocument();
  });

  it("tells the page when the result is ready, and stops polling", async () => {
    const { onReady, fetchMock } = setup([stage("narrating"), stage("ready")]);

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    const callsAtReady = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock.mock.calls.length).toBe(callsAtReady);
  });

  it("says plainly when the run failed, rather than spinning forever", async () => {
    setup([stage("failed")]);

    expect(await screen.findByText(/could not be completed/i)).toBeInTheDocument();
  });

  it("keeps polling through a transient network failure", async () => {
    // The run is still going; a dropped poll is not a failed analysis.
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(stage("running"));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AnalysisProgress
        organizationId={ORGANIZATION}
        channelId={CHANNEL}
        window={{ from: "2026-01-01", to: "2026-01-04" }}
        onReady={vi.fn()}
        pollMs={10}
      />,
    );

    expect(await screen.findByText(/running the checks/i)).toBeInTheDocument();
  });

  it("polls the window it was given", async () => {
    const { fetchMock } = setup([stage("queued")]);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("from=2026-01-01&to=2026-01-04"),
        expect.anything(),
      ),
    );
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm vitest run src/components/analysis/analysis-progress.test.tsx`
Expected: FAIL — module unresolved.

- [ ] **Step 3: Write the component**

Create `src/components/analysis/analysis-progress.tsx`. A client component that polls `/api/organizations/{organizationId}/channels/{channelId}/analysis/status?from=&to=` every `pollMs` (default 1500), renders the four stages as an ordered list with the current one marked `aria-current="step"`, calls `onReady` once on `ready` and stops polling, and stops on `failed` with a plain sentence and no spinner. A rejected fetch keeps the previous stage and keeps polling. Copy, verbatim:

| Stage | Line |
| --- | --- |
| `queued` | Reading approved reports |
| `running` | Running the checks |
| `narrating` | Writing recommendations |
| `failed` | This analysis could not be completed. Nothing was changed; try again in a moment. |

Wrap the list in `role="status"` with `aria-live="polite"`, and use the existing `Spinner` from `@/components/ui/spinner` for the active stage.

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm vitest run src/components/analysis/analysis-progress.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
pnpm prettier --write src/components/analysis/analysis-progress.tsx src/components/analysis/analysis-progress.test.tsx
git add src/components/analysis/analysis-progress.tsx src/components/analysis/analysis-progress.test.tsx
git commit -m "feat(analysis): show what the analysis is actually doing while it runs

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Wire the page and the workspace

**Files:**
- Modify: `src/app/(platform)/organizations/[organizationId]/channels/[channelId]/page.tsx:29-120`
- Modify: `src/components/analysis/channel-workspace.tsx`
- Test: `src/components/analysis/channel-workspace.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–13.
- Produces: `ChannelWorkspace` props `segments`, `coverageWindows`, `selectedWindow` replacing `monthHorizon` and `selectedMonth`.

- [ ] **Step 1: Write the failing test**

Add to `src/components/analysis/channel-workspace.test.tsx`:

```tsx
it("posts the picked range, not a month", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderWorkspace({ selectedWindow: { from: "2026-01-01", to: "2026-01-04" } });

  await user.click(screen.getByRole("button", { name: /2026-01-01/ }));
  await user.click(screen.getByRole("button", { name: /^apply$/i }));

  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    from: "2026-01-01",
    to: "2026-01-04",
  });
});

it("shows the loader instead of telling the operator to refresh", async () => {
  // The message this replaces read "refresh in a moment to see the result",
  // which asked the operator to do the waiting themselves.
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  renderWorkspace({ selectedWindow: { from: "2026-01-01", to: "2026-01-04" } });

  await user.click(screen.getByRole("button", { name: /2026-01-01/ }));
  await user.click(screen.getByRole("button", { name: /^apply$/i }));

  expect(await screen.findByText(/reading approved reports/i)).toBeInTheDocument();
  expect(screen.queryByText(/refresh in a moment/i)).not.toBeInTheDocument();
});

it("says plainly when the organization is over its allowance", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: "This organization has started a lot of analyses" } }),
    }),
  );
  const user = userEvent.setup();
  renderWorkspace({ selectedWindow: { from: "2026-01-01", to: "2026-01-04" } });

  await user.click(screen.getByRole("button", { name: /2026-01-01/ }));
  await user.click(screen.getByRole("button", { name: /^apply$/i }));

  expect(await screen.findByText(/started a lot of analyses/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm vitest run src/components/analysis/channel-workspace.test.tsx`
Expected: FAIL — the workspace still renders `MonthYearPicker`.

- [ ] **Step 3: Rewrite the page's data loading**

In `page.tsx`, replace the month block (lines 58–95). Read coverage and evidence windows instead of the month timeline, resolve the selection from `?from=&to=`, and select the run by exact window:

```tsx
  searchParams?: Promise<{ from?: string; to?: string; month?: string }>;
```

```tsx
    const [runs, segments, coverageWindows] = await Promise.all([
      analysis.loadRuns({ organizationId: context.organizationId, channelId, limit: 10 }),
      analysis.loadCoverageSegments({ organizationId: context.organizationId, channelId }),
      analysis.loadEvidenceWindows({
        organizationId: context.organizationId,
        channelId,
        limit: MAX_EVIDENCE_WINDOWS,
      }),
    ]);
```

`MAX_EVIDENCE_WINDOWS` is currently module-private in `read-repository.ts:40`. Export it there — `export const MAX_EVIDENCE_WINDOWS = 24;` — rather than repeating the number in the page, so the page and the resolver cannot drift apart.

```tsx

    const query = await searchParams;
    // One release of grace for links and bookmarks minted under the month
    // picker. `?month=2026-01` means the whole of January, which is exactly
    // what it always meant.
    const requested =
      query?.from && query?.to
        ? { from: query.from, to: query.to }
        : query?.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month)
          ? { from: `${query.month}-01`, to: localPeriodEnd(`${query.month}-01`, "month") }
          : null;

    // A range the reports do not cover falls back to the default rather than
    // being analysed: a hand-typed URL cannot widen what this page will ask.
    const selectedWindow =
      requested && isWindowCovered(requested.from, requested.to, segments)
        ? requested
        : defaultAnalysisWindow({ today: todayInZone(organization.default_timezone), windows: coverageWindows });

    // Unchanged in spirit from the month version: findings are read for the
    // one run the page is about to display, so every figure on the page was
    // computed for the window the page names. A window with no completed run
    // shows the workspace in its not-analysed state, never another window's
    // run.
    const displayedRun =
      selectedWindow === null
        ? null
        : (runs.find(
            (run) =>
              run.status === "completed" &&
              run.windowStart === selectedWindow.from &&
              run.windowEnd === selectedWindow.to,
          ) ?? null);
```

**Then wire the run cache in — without it, Task 7 ships dead and spec §5.1 is
unimplemented.**

First, the cache key needs a field the read model currently drops.
`channel_analysis_runs.result_digest` exists in the database, but
`ChannelAnalysisRunRecord` (`ports.ts:12-30`) does not carry it. Add
`resultDigest: string | null` to that type and select `result_digest` in both
`loadRuns` and `loadRun` in `read-repository.ts`. It is null exactly when the
run is still `running`, which the `status = 'running'` check on the table
already guarantees — so a null digest means "not finished", and the code below
treats it as uncacheable rather than as an error.
 The findings, the evidence and the recommendation *text* for a
completed run are immutable, so they go through `readCachedRunPayload`. The
viewer's own accept and dismiss decisions do **not**: they are read outside the
cache and merged on top, because caching them under a run id would show one
operator another's choices.

```tsx
    const cached =
      displayedRun === null || displayedRun.resultDigest === null
        ? null
        : await readCachedRunPayload({
            organizationId: context.organizationId,
            analysisRunId: displayedRun.id,
            resultDigest: displayedRun.resultDigest,
            load: async () => {
              const runFindings = await analysis.loadFindingsForRun({
                organizationId: context.organizationId,
                analysisRunId: displayedRun.id,
              });
              const [runEvidence, runRecommendations] = await Promise.all([
                analysis.loadEvidence({
                  organizationId: context.organizationId,
                  findingIds: runFindings.map((finding) => finding.id),
                }),
                // `viewerId: null` asks for the recommendations without any
                // viewer's decisions attached. That is what makes this payload
                // safe to share between operators.
                analysis.loadRecommendationsForRun({
                  organizationId: context.organizationId,
                  analysisRunId: displayedRun.id,
                  viewerId: null,
                }),
              ]);
              return { findings: runFindings, evidence: runEvidence, recommendations: runRecommendations };
            },
          });
```

`loadRecommendationsForRun` currently requires a `viewerId: string`. Widen it to
`string | null` in `ports.ts` and, in `read-repository.ts:714`, skip the
`channel_recommendation_decisions` read entirely when it is null, returning
recommendations with empty decisions. Then read this viewer's decisions
separately and merge them onto `cached.recommendations` before calling
`buildChannelWorkspaceView`. Add a port for that read if none exists.

If this wiring plus the picker swap makes Task 14 too large to review as one
diff, split the cache wiring into its own commit within the task rather than
dropping it.

Pass `segments`, `coverageWindows` and `selectedWindow` to `ChannelWorkspace` in place of `monthHorizon` and `selectedMonth`.

No `todayInZone` helper exists. Add this one beside the page, matching the
idiom already at `src/domain/metrics/csv-projection.ts:277`:

```tsx
/**
 * Today, as the organization's own calendar reads it.
 *
 * `en-CA` renders `YYYY-MM-DD`, which is the shape every date on this page
 * already uses. Reading "today" in the server's zone instead would shift the
 * default window by a day for anything either side of midnight in Dubai.
 */
function todayInZone(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}
```

- [ ] **Step 4: Rewrite the workspace's control**

In `channel-workspace.tsx`:
- Replace the `MonthYearPicker` import and its render block (lines 535–547) with `WindowRangePicker`.
- Delete the `enumerateAnalysisMonths` and `formatAnalysisMonth` imports and the `months` / `selectedMonth` / `onSelectMonth` derivations.
- Replace `runAnalysis` so it posts `{ from, to }`, and on a successful `202` sets loader state instead of the "refresh in a moment" message. On `429` show the server's own message.
- Render `AnalysisProgress` over the workspace region while a run is in flight; its `onReady` calls `router.refresh()` and clears the loader.
- Drop the `canRunAnalysis` prop and its `channel.manage` gate at the call site in `page.tsx` — Apply is available to anyone who can see the page, per ADR 0047. The route is the enforcement point.
- Replace the month's explanatory paragraph with range-shaped copy: *"{range}, in {timezone}. Approved reports declare these dates. Days the provider left blank are counted as absent, not as zero. A range with no governed evidence analyses as exactly that, not as zero."*

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm vitest run src/components/analysis "src/app/(platform)/organizations/[organizationId]/channels"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm prettier --write src/components/analysis/channel-workspace.tsx src/components/analysis/channel-workspace.test.tsx "src/app/(platform)/organizations/[organizationId]/channels/[channelId]/page.tsx"
git add src/components/analysis "src/app/(platform)/organizations/[organizationId]/channels/[channelId]/page.tsx"
git commit -m "feat(analysis): ask the Channel Audit about any range the reports cover

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: The decision record, and proving it works

**Files:**
- Create: `adrs/0047-a-free-range-window-over-a-content-addressed-cache.md`
- Modify: `docs/collaboration/asset-library-and-studio-board.md`
- Delete: the five retired helpers in `src/domain/analysis/calendar.ts` and their tests

- [ ] **Step 1: Retire the month helpers**

Delete `parseAnalysisMonth`, `resolveAnalysisMonth`, `analysisMonthBounds`, `enumerateAnalysisMonths`, `formatAnalysisMonth`, the `ANALYSIS_MONTH` regex, `MONTH_NAMES`, `MAX_HORIZON_MONTHS`, and `AnalysisMonthHorizon` from `calendar.ts`, plus their tests. Leave every period-arithmetic export untouched. Confirm nothing still imports them:

```bash
grep -rn "parseAnalysisMonth\|resolveAnalysisMonth\|analysisMonthBounds\|enumerateAnalysisMonths\|formatAnalysisMonth\|AnalysisMonthHorizon" --include=*.ts --include=*.tsx src
```

Expected: no output. `src/components/analysis/month-year-picker.tsx` carries its own month names and must keep working — the channels list page still uses it.

- [ ] **Step 2: Write ADR 0047**

Create `adrs/0047-a-free-range-window-over-a-content-addressed-cache.md` with sections Status, Context, Decision, Consequences. It must record, from section 11 of the spec:

- The chain 0032 → 0033 → 0043 → 0047, and that this is the second reversal on this axis.
- That ADR 0043's objection to free range was the cost of repetition, and that the content-addressed cache ADR 0043 itself introduced is what removed that cost.
- That the requirement came from a client, in a meeting, on 2026-09-07.
- That ADR 0033's length-derived grain is **not** revived; grain stays resolved from governed evidence per ADR 0043.
- That ADR 0033's evidence-density day shading is **not** revived; selection is bounded to covered dates and the pre-run grain warning replaces it.
- That admissibility is re-decided independently at the route and in the worker, which is what makes browser-supplied dates safe.
- That the `report.retry` gate on starting an analysis is removed and a per-organization rate limit replaces it as the cost control.
- That Redis caches immutable completed runs and short-lived coverage only, and never the question of whether an answer is current.

- [ ] **Step 3: Record it on the collaboration board**

Add an entry naming the files this change touched, the ADR, the removed role gate, and the one-time cache recompute, so the next session finds it without reading the diff.

- [ ] **Step 4: Full verification**

Stop the dev server first — the xlsx-parsing tests fail on this machine while it runs.

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Expected: typecheck clean; lint no new errors beyond the 31 pre-existing warnings; the full suite green.

- [ ] **Step 5: Deploy the worker**

The `channel-analysis.run` payload shape changed, so the deployed worker must be rebuilt or it will reject every dispatch.

```bash
pnpm dlx trigger.dev@latest deploy
```

If it fails with `fetch failed (undefined undefined)`, that is the known transport flake recorded on the board — retry.

- [ ] **Step 6: Prove it in the browser**

Against Nostaza (`859cf039-1cd8-41b0-bd09-66c6c52e9c52`) via chrome-devtools, at 1440px and 390px:

1. Keeta opens on **22–28 Feb 2026**, not on the last seven days, and shows figures rather than a warning.
2. Picking **1–4 Jan 2026** on Keeta shows the loader advancing through its stages, then findings and recommendations for those four days.
3. Re-picking **1–4 Jan** returns instantly — the cache hit — with no loader.
4. Offline Store opens on **August 2026**; picking **1–4 Aug** shows the warning naming *one figure per month* and *1 May – 31 Aug*, and the widen button sets 1–31 Aug.
5. Noon opens on **1 Jan – 28 Feb 2026**, its whole span.
6. March 2026 is not selectable on any channel.
7. **The original defect:** Keeta's auto-analysis run over 1 Jan – 28 Feb is selectable and displays its findings — the run that was previously invisible.

- [ ] **Step 7: Commit**

```bash
pnpm prettier --write src/domain/analysis/calendar.ts src/domain/analysis/calendar.test.ts
git add adrs/0047-a-free-range-window-over-a-content-addressed-cache.md docs/collaboration/asset-library-and-studio-board.md src/domain/analysis/calendar.ts src/domain/analysis/calendar.test.ts
git commit -m "docs(analysis): record why the window is free-range again, and what changed

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task: §4.1–4.2 → Tasks 4, 8, 9; §4.3 → Tasks 1, 5; §4.4 → Tasks 1–5, 9, 14; §5.1 → Task 7; §5.2 → Task 5 + Task 14; §5.3 → Task 11 (the uncached lookup); §5.4 → Task 6; §5.5 → Tasks 6, 8; §6 → Tasks 11, 13; §7 → Tasks 12, 13, 14; §8 → the test steps throughout plus Task 15 step 6; §9 → Tasks 9, 10, 15; §10 → Tasks 6, 8, 14, 15; §11 → Task 15.

**Known gap, deliberately deferred.** The spec's §5.2 coverage cache is wired in Task 14 rather than getting its own task: `loadCoverageSegments` is a single read, and wrapping it in `readCachedRunPayload`'s sibling is three lines. If it grows past that during Task 14, split it out rather than inflating that task.

**Type consistency checked.** `CoverageSegment` (`{start,end}`) and `CoverageWindow` (`{windowStart,windowEnd,grain,governedRowCount}`) are distinct on purpose and used consistently: segments for admissibility and the calendar, windows for grain decisions. `AnalysisWindowSelection` (`{from,to}`) is the UI and API shape; `{windowStart,windowEnd}` is the run and worker shape; the boundary between them is `resolveWindowInput`. `createWindowAnalysisCacheKey` takes `windowStart`/`windowEnd` and no `month` in Task 4 and is called that way in Task 9.
