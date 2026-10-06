import {
  addLocalMonths,
  applyProposedRanges,
  type RevenueScenarioInput,
} from "@/domain/organizations/revenue-scenario";
import type { HomeRevenueSource } from "@/modules/organizations/application/home-types";
import type { PublishDueGrowthProjectionsResult } from "@/modules/organizations/application/growth-projection-publisher";
import type {
  ReadRevenueSourceInput,
  RevenueSourceReads,
} from "@/modules/organizations/infrastructure/revenue-source";
import type { RevenueProposalRequest } from "@/modules/organizations/infrastructure/revenue-proposal-provider";

/**
 * Nightly snapshot build behind the home growth outlook (ADR 0060).
 *
 * The worker rebuilds the verified union input through the same read path as
 * the home loader, attaches validated proposal ranges where the model offers
 * any, and stores the result for the page to read all day. Per-viewer
 * permission narrowing happens at render, never here: the snapshot keeps
 * every action kind the rollout gates allowed.
 *
 * Failure is quiet by contract: a failed read or an unavailable model leaves
 * yesterday's row in place and reports stored:false, so the page keeps
 * serving the last good answer (or its live fallback) instead of a hole.
 */

export const REVENUE_SNAPSHOT_KEEP_MONTHS = 13;

export type RevenueSnapshotRunnerDependencies = {
  reads: RevenueSourceReads;
  readSource: (input: ReadRevenueSourceInput) => Promise<HomeRevenueSource>;
  /** Cap on actions per proposal request; the composition root owns the value. */
  maxProposalActions: number;
  proposeRanges: (input: {
    request: RevenueProposalRequest;
    correlationId: string;
  }) => Promise<readonly unknown[]>;
  writeSnapshot: (snapshot: {
    organizationId: string;
    snapshotDate: string;
    input: RevenueScenarioInput;
    aiNote: string | null;
  }) => Promise<unknown>;
  trimSnapshots: (organizationId: string, keepSinceDate: string) => Promise<unknown>;
  onFailure: (info: { organizationId: string; correlationId: string }) => void;
};

/**
 * Validated union input (with the run's already-proposed ranges applied)
 * handed to the growth-publication phase. The publication phase reuses this
 * material as-is and never proposes a second time; a failed snapshot hands
 * over null so the phase skips with a typed code instead of guessing.
 */
export type RevenueSnapshotCandidateMaterial = {
  input: RevenueScenarioInput;
};

export type RevenueSnapshotResult =
  | {
      stored: true;
      acceptedCount: number;
      rejectedCount: number;
      trimmed: boolean;
      candidateMaterial: RevenueSnapshotCandidateMaterial;
    }
  | { stored: false; reason: string; candidateMaterial: null };

/**
 * Trigger run output: the snapshot outcome plus the publication summary,
 * with the validated union input stripped out. Trigger persists run outputs
 * outside the database, so full financial inputs (history amounts, actions,
 * assumptions) must never ride along — the publication phase already
 * received its copy in memory.
 */
export type RevenueSnapshotBuildOutput =
  | {
      stored: true;
      acceptedCount: number;
      rejectedCount: number;
      trimmed: boolean;
      growthPublication: PublishDueGrowthProjectionsResult;
    }
  | { stored: false; reason: string; growthPublication: PublishDueGrowthProjectionsResult };

export function toSnapshotBuildOutput(
  result: RevenueSnapshotResult,
  growthPublication: PublishDueGrowthProjectionsResult,
): RevenueSnapshotBuildOutput {
  if (result.stored) {
    const { acceptedCount, rejectedCount, trimmed } = result;
    return { stored: true, acceptedCount, rejectedCount, trimmed, growthPublication };
  }
  return { stored: false, reason: result.reason, growthPublication };
}

/**
 * Fail-red gate for the nightly run: a run whose primary job failed, or that
 * errored on any due horizon, throws instead of completing green-with-skips,
 * so the dashboard shows the failure and Trigger's bounded retries apply.
 * Honest skips (NOT_DUE, BASELINE_INCOMPLETE, DISABLED, CANDIDATE_UNAVAILABLE)
 * stay silent — a skipped horizon is reported, never hidden, but it is not a
 * failure. Only fixed reason strings and the organization id reach the error.
 */
export function throwIfSnapshotBuildFailed(
  output: RevenueSnapshotBuildOutput,
  organizationId: string,
): void {
  if (!output.stored) {
    throw new Error(`Revenue snapshot not stored for ${organizationId}: ${output.reason}.`);
  }
  if (output.growthPublication.results.some((entry) => entry.status === "failed")) {
    throw new Error(`Growth projection publication errored for ${organizationId}.`);
  }
}

/** True while the organization's own clock reads the first hour of the day. */
export function isOrgLocalMidnightHour(timeZone: string, now: Date): boolean {
  try {
    const hour = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).format(now);
    return hour === "0" || hour === "00" || hour === "24";
  } catch {
    return false;
  }
}

function localDateInZone(timeZone: string, now: Date): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  } catch {
    return null;
  }
}

/**
 * Merges the legacy bounded organization scan with explicitly allowlisted
 * growth-publication organizations. The scan keeps its order and cap; extras
 * outside it join the same nightly run exactly once each. Pure: the dispatch
 * task fetches both lists, this only dedupes. Identity comparison is
 * case-insensitive on both sides — the allowlist parser already lowercases,
 * and dispatch rows are plain strings — so one organization never books two
 * runs over letter casing.
 */
export function mergeSnapshotDispatchCandidates(
  scanned: readonly { organizationId: string; timeZone: string }[],
  allowlisted: readonly { organizationId: string; timeZone: string }[],
): { organizationId: string; timeZone: string }[] {
  const merged = [...scanned];
  const seen = new Set(scanned.map((org) => org.organizationId.toLowerCase()));
  for (const org of allowlisted) {
    const key = org.organizationId.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ organizationId: org.organizationId, timeZone: org.timeZone });
  }
  return merged;
}

/**
 * Organizations due for tonight's snapshot: local clock inside the first
 * hour, one entry each with the local date the row will carry. Invalid time
 * zones never match — they stay out loudly via the returned skip count
 * instead of silently joining another zone's midnight.
 */
export function selectDueSnapshotOrgs(
  organizations: readonly { organizationId: string; timeZone: string }[],
  now: Date,
): { due: { organizationId: string; snapshotDate: string; timeZone: string }[]; skipped: number } {
  const due: { organizationId: string; snapshotDate: string; timeZone: string }[] = [];
  let skipped = 0;
  for (const org of organizations) {
    if (!isOrgLocalMidnightHour(org.timeZone, now)) continue;
    const snapshotDate = localDateInZone(org.timeZone, now);
    if (snapshotDate === null) {
      skipped += 1;
      continue;
    }
    due.push({ organizationId: org.organizationId, snapshotDate, timeZone: org.timeZone });
  }
  return { due, skipped };
}

export async function runRevenueSnapshotBuild(
  input: {
    organizationId: string;
    snapshotDate: string;
    timeZone: string;
    nowIso: string;
    gates: { growth: boolean; campaigns: boolean };
    correlationId: string;
  },
  dependencies: RevenueSnapshotRunnerDependencies,
): Promise<RevenueSnapshotResult> {
  const { organizationId, snapshotDate, correlationId } = input;
  const fail = (reason: string): RevenueSnapshotResult => {
    dependencies.onFailure({ organizationId, correlationId });
    return { stored: false, reason, candidateMaterial: null };
  };

  let source;
  try {
    source = await dependencies.readSource({
      reads: dependencies.reads,
      organizationId,
      actorId: "",
      timeZone: input.timeZone,
      now: input.nowIso,
      canBands: true,
      canActions: input.gates.growth,
      canProposals: input.gates.campaigns,
      onFailure: () => {},
    });
  } catch {
    return fail("reads failed");
  }
  if (source.status !== "ready") return fail("reads not ready");

  const candidates = source.input.actions
    .filter((action) => action.assumptionLow === null || action.assumptionHigh === null)
    .slice(0, dependencies.maxProposalActions);

  let actions = source.input.actions;
  let acceptedCount = 0;
  let rejectedCount = 0;
  let aiNote: string | null =
    "Held at the current course: no unquantified action cites a listed input yet.";
  if (candidates.length > 0 && source.input.losses.length > 0) {
    const currencies = new Set([
      ...source.input.history.map((point) => point.currency),
      ...source.input.losses.map((loss) => loss.currency),
    ]);
    if (currencies.size === 1) {
      const [currency] = currencies;
      try {
        const ranges = await dependencies.proposeRanges({
          request: {
            currency: currency ?? "AED",
            losses: source.input.losses.map((loss) => ({
              findingId: loss.findingId,
              minorUnits: loss.minorUnits,
            })),
            actions: candidates.map((action) => ({
              actionId: action.id,
              title: action.title,
              kind: action.kind,
            })),
          },
          correlationId,
        });
        const applied = applyProposedRanges(
          source.input.actions,
          ranges,
          new Set(source.input.losses.map((loss) => loss.findingId)),
        );
        actions = applied.actions;
        rejectedCount = applied.rejected.length;
        acceptedCount = Math.max(0, candidates.length - rejectedCount);
        aiNote =
          rejectedCount === 0
            ? "Nightly model-proposed ranges applied as explicit assumptions."
            : `${acceptedCount} nightly range(s) applied; ${rejectedCount} rejected as uncited.`;
      } catch {
        aiNote = "Nightly proposals unavailable — held at the current course.";
      }
    } else {
      aiNote = "Mixed source currencies — held at the current course.";
    }
  }

  try {
    await dependencies.writeSnapshot({
      organizationId,
      snapshotDate,
      input: { ...source.input, actions },
      aiNote,
    });
    await dependencies.trimSnapshots(
      organizationId,
      addLocalMonths(`${snapshotDate.slice(0, 7)}-01`, -REVENUE_SNAPSHOT_KEEP_MONTHS),
    );
  } catch {
    return fail("store failed");
  }
  return {
    stored: true,
    acceptedCount,
    rejectedCount,
    trimmed: true,
    candidateMaterial: { input: { ...source.input, actions } },
  };
}
