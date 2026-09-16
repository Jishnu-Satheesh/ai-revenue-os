import type { AnalysisGrain } from "@/domain/analysis/types";
import type {
  AnalysedWindowKey,
  ChannelAnalysisReadPort,
  ChannelBandRecord,
} from "@/modules/analysis/application/ports";
import { toProposalCards } from "@/modules/campaigns/application/proposal-read-model";
import type { CampaignProposalReader } from "@/modules/campaigns/infrastructure/proposal-read-repository";
import type { GrowthIntelligenceWorkspaceRepository } from "@/modules/growth-intelligence/application/read-service";
import type { HomeRevenueSource } from "@/modules/organizations/application/home-types";
import {
  mapRevenueInputs,
  selectRevenueWindows,
} from "@/modules/organizations/infrastructure/revenue-inputs";

/**
 * The one read path behind the revenue scenario, shared by the home loader
 * and the rough-estimate proposal route so both reason over the same inputs.
 *
 * Round one settles the analysed-window keys plus the §14(a) action set;
 * round two reads one bounded money band per selected window. A gated source
 * contributes nothing, while a failed permitted read fails the section —
 * the caller logs once. Nothing here calls a model, writes storage, or
 * dispatches work; it only reads existing tenant-scoped state.
 */

const MAX_REVENUE_RECOMMENDATIONS = 30;
const MAX_REVENUE_INSIGHTS = 20;
const MAX_REVENUE_PROPOSALS = 10;

export type RevenueSourceReads = {
  analysis: Pick<ChannelAnalysisReadPort, "loadAnalysedWindowKeys" | "loadChannelBandsForWindow">;
  growthReads: Pick<
    GrowthIntelligenceWorkspaceRepository,
    "listChannelRecommendationRecords" | "listWorkspaceItems"
  >;
  proposalReader: Pick<CampaignProposalReader, "listProposals">;
};

export type ReadRevenueSourceInput = {
  reads: RevenueSourceReads;
  organizationId: string;
  actorId: string;
  timeZone: string;
  now: string;
  canBands: boolean;
  canActions: boolean;
  canProposals: boolean;
  onFailure: () => void;
};

type RevenueTaskKind = "keys" | "recs" | "items" | "proposals";

/** Today on the organization's own calendar: `YYYY-MM-DD`, never UTC. */
export function revenueDayInZone(timeZone: string, now: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(now));
}

export async function readRevenueSource(input: ReadRevenueSourceInput): Promise<HomeRevenueSource> {
  const { reads, organizationId, actorId, timeZone, now } = input;
  if (!input.canBands) return { status: "disabled" };

  const today = revenueDayInZone(timeZone, now);
  const tasks: { kind: RevenueTaskKind; run: Promise<unknown> }[] = [
    { kind: "keys", run: reads.analysis.loadAnalysedWindowKeys({ organizationId }) },
  ];
  if (input.canActions && actorId.trim().length > 0) {
    tasks.push({
      kind: "recs",
      run: reads.growthReads.listChannelRecommendationRecords({
        organizationId,
        actorId,
        limit: MAX_REVENUE_RECOMMENDATIONS,
      }),
    });
    tasks.push({
      kind: "items",
      run: reads.growthReads.listWorkspaceItems({
        organizationId,
        actorId,
        throughMonth: today.slice(0, 7),
        limit: MAX_REVENUE_INSIGHTS,
      }),
    });
  }
  if (input.canProposals) {
    tasks.push({
      kind: "proposals",
      run: reads.proposalReader.listProposals({
        organizationId,
        limit: MAX_REVENUE_PROPOSALS,
      }),
    });
  }

  const settled = await Promise.allSettled(tasks.map((task) => task.run));
  let keys: AnalysedWindowKey[] | null = null;
  let recommendations: {
    id: string;
    headline: string;
    decision: { decision: string } | null;
    citationFindingIds?: readonly string[];
  }[] = [];
  let insights: { id: string; narrative: string; decision: string | null }[] = [];
  let proposals: {
    proposalId: string;
    title: string;
    state: string;
    lastDecision: { decision: string } | null;
  }[] = [];
  let ok = true;
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index] as { kind: RevenueTaskKind; run: Promise<unknown> };
    const outcome = settled[index] as PromiseSettledResult<unknown>;
    if (outcome.status === "rejected") {
      ok = false;
      input.onFailure();
      continue;
    }
    if (task.kind === "keys") {
      keys = [...(outcome.value as readonly AnalysedWindowKey[])];
    } else if (task.kind === "recs") {
      recommendations = (
        outcome.value as readonly {
          id: string;
          headline: string;
          decision: { decision: string } | null;
          citationFindingIds?: readonly string[];
        }[]
      ).map((row) => ({
        id: row.id,
        headline: row.headline,
        decision: row.decision,
        citationFindingIds: row.citationFindingIds ?? [],
      }));
    } else if (task.kind === "items") {
      insights = (
        outcome.value as readonly {
          id: string;
          kind: string;
          narrative: string;
          decision: string | null;
        }[]
      )
        .filter((row) => row.kind === "insight")
        .map((row) => ({
          id: row.id,
          narrative: row.narrative,
          decision: row.decision === "unpinned" ? null : row.decision,
        }));
    } else {
      proposals = toProposalCards(outcome.value as Parameters<typeof toProposalCards>[0]).map(
        (card) => ({
          proposalId: card.proposalId,
          title:
            card.content.kind === "document"
              ? card.content.document.title
              : "A campaign proposal is being worked out",
          state: card.state,
          lastDecision: card.lastDecision ? { decision: card.lastDecision.decision } : null,
        }),
      );
    }
  }
  if (!ok || keys === null) return { status: "failed" };

  const windows = selectRevenueWindows(keys);
  const bandSettled = await Promise.allSettled(
    windows.map((window) =>
      reads.analysis.loadChannelBandsForWindow({
        organizationId,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        grain: window.grain as AnalysisGrain,
      }),
    ),
  );
  const bands: (readonly ChannelBandRecord[] | null)[] = [];
  for (const outcome of bandSettled) {
    if (outcome.status === "fulfilled") {
      bands.push(outcome.value as readonly ChannelBandRecord[]);
    } else {
      bands.push(null);
      input.onFailure();
    }
  }
  if (bands.some((entry) => entry === null)) return { status: "failed" };

  const mapped = mapRevenueInputs({
    organizationId,
    windows,
    bands,
    recommendations,
    insights,
    proposals,
    today,
  });
  return mapped.status === "ready"
    ? { status: "ready", input: mapped.input, fetchedAt: now }
    : { status: "failed" };
}
