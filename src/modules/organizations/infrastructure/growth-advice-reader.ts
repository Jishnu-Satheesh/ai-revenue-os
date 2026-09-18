import "server-only";

import { toProposalCards } from "@/modules/campaigns/application/proposal-read-model";
import type { CampaignProposalReader } from "@/modules/campaigns/infrastructure/proposal-read-repository";
import type {
  ChannelRecommendationRow,
  SynthesizedItemRow,
} from "@/modules/growth-intelligence/application/read-model";
import type { GrowthIntelligenceWorkspaceRepository } from "@/modules/growth-intelligence/application/read-service";
import {
  ADVICE_ELIGIBLE_PROPOSAL_STATES,
  isAdviceEligibleStatus,
  qualifyAdviceRelation,
  type GrowthAdviceCandidate,
  type GrowthAdviceReadInput,
  type GrowthAdviceReadResult,
} from "@/modules/organizations/application/growth-advice";

/**
 * Source-owned advice adapter behind the Overview growth section (data
 * contract D06).
 *
 * Like a concierge who only hands over cards the hotel actually printed:
 * every candidate comes from an existing module reader — channel narrations
 * and synthesized items through the Growth Intelligence workspace
 * repository, campaign proposals through the campaigns module's own reader.
 * No table of another module is queried directly, no deep link is guessed
 * (rows without one fall back to the known Growth Intelligence workspace),
 * and no title, count or reason is invented.
 *
 * Server-only: it runs on the member's session through RLS-scoped readers.
 * A lane the caller may not read is never fetched — not even to count it —
 * so permission-denied readers stay provably uncalled.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const MAX_RECOMMENDATIONS = 30;
const MAX_ITEMS = 20;
const MAX_PROPOSALS = 10;

export type GrowthAdviceReads = {
  growthReads: Pick<
    GrowthIntelligenceWorkspaceRepository,
    "listChannelRecommendationRecords" | "listWorkspaceItems"
  >;
  proposalReader: Pick<CampaignProposalReader, "listProposals">;
};

export type ReadGrowthAdviceInput = GrowthAdviceReadInput;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function cleanTitle(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0) return "Untitled advice";
  return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
}

function cleanText(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 1000 ? trimmed.slice(0, 1000) : trimmed;
}

function cleanDate(value: string | null): string | null {
  if (value === null) return null;
  const day = value.slice(0, 10);
  return DATE_PATTERN.test(day) ? day : null;
}

function workspaceHref(organizationId: string): string {
  return `/organizations/${organizationId}/growth-intelligence`;
}

function statusSuffix(status: string | null): string {
  if (status === null) return "";
  if (status === "planned") {
    return " Current status: planned — intent, not completed execution.";
  }
  return ` Current status: ${status}.`;
}

function mapRecommendation(
  row: ChannelRecommendationRow,
  input: { organizationId: string; today: string },
): GrowthAdviceCandidate | null {
  // Only narrated recommendations and observations advise; needs-data rows
  // ask for input instead. Observations arrive as context (insight), never
  // as actions.
  if (row.label !== "recommendation" && row.label !== "observation") return null;
  const status = row.decision?.decision?.trim().toLowerCase() ?? null;
  if (!isAdviceEligibleStatus(status)) return null;
  // A personal snooze hides the row for this viewer alone; an unreadable
  // horizon never hides it for everyone.
  if (
    typeof row.preferenceSnoozedUntil === "string" &&
    DATE_PATTERN.test(row.preferenceSnoozedUntil.slice(0, 10)) &&
    row.preferenceSnoozedUntil.slice(0, 10) > input.today
  ) {
    return null;
  }
  const channelIds = isUuid(row.channelId) ? [row.channelId.toLowerCase()] : [];
  const branchIds =
    row.branchId !== null && isUuid(row.branchId) ? [row.branchId.toLowerCase()] : [];
  return {
    id: `rec:${row.id}`,
    kind: row.label === "recommendation" ? "recommendation" : "insight",
    title: cleanTitle(row.headline),
    supportingText: cleanText(`${row.detail}${statusSuffix(status)}`),
    href: workspaceHref(input.organizationId),
    key: null,
    sourceRevision: null,
    sourceWindowStart: cleanDate(row.windowStart),
    sourceWindowEnd: cleanDate(row.windowEnd),
    channelIds,
    branchIds,
    sourceStatus: status,
    evidenceRefs: [...(row.citationFindingIds ?? [])]
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .slice(0, 100),
    relation: qualifyAdviceRelation(null),
    permission: "growth_intelligence.read",
  };
}

function mapItem(
  row: SynthesizedItemRow,
  input: { organizationId: string },
): GrowthAdviceCandidate | null {
  if (row.kind !== "recommendation" && row.kind !== "insight") return null;
  const status =
    row.decision === null || row.decision === "pinned" || row.decision === "unpinned"
      ? null
      : row.decision.trim().toLowerCase();
  if (!isAdviceEligibleStatus(status)) return null;
  const windowNote =
    row.evidenceWindowStart !== null || row.evidenceWindowEnd !== null
      ? `Evidence window: ${row.evidenceWindowStart ?? "unknown"}–${row.evidenceWindowEnd ?? "unknown"}.`
      : "Useful context from Growth Intelligence.";
  return {
    id: `item:${row.id}`,
    kind: row.kind,
    title: cleanTitle(row.narrative),
    supportingText: cleanText(`${windowNote}${statusSuffix(status)}`),
    href: workspaceHref(input.organizationId),
    key: null,
    sourceRevision: null,
    sourceWindowStart: cleanDate(row.evidenceWindowStart),
    sourceWindowEnd: cleanDate(row.evidenceWindowEnd),
    channelIds: [],
    branchIds: [],
    sourceStatus: status,
    evidenceRefs: [],
    relation: qualifyAdviceRelation(null),
    permission: "growth_intelligence.read",
  };
}

function proposalStateNote(state: string): string {
  return state === "changes_requested"
    ? "This proposal requested changes and is back for review."
    : "This proposal is ready for review.";
}

function mapProposalBundle(
  bundle: {
    proposal: { id: string; state: string; sourceKind: string };
    card: { title: string; hasDocument: boolean; lastDecision: { decision: string } | null } | null;
  },
  input: { organizationId: string },
): GrowthAdviceCandidate | null {
  if (bundle.card === null || !bundle.card.hasDocument) return null;
  if (!ADVICE_ELIGIBLE_PROPOSAL_STATES.has(bundle.proposal.state)) return null;
  const decision = bundle.card.lastDecision?.decision?.trim().toLowerCase() ?? null;
  if (!isAdviceEligibleStatus(decision)) return null;
  return {
    id: `proposal:${bundle.proposal.id}`,
    kind: "proposal",
    title: cleanTitle(bundle.card.title),
    supportingText: cleanText(
      `${proposalStateNote(bundle.proposal.state)}${statusSuffix(decision)}`,
    ),
    href: `/organizations/${input.organizationId}/campaign-proposals/${bundle.proposal.id}`,
    key: bundle.proposal.sourceKind,
    sourceRevision: null,
    sourceWindowStart: null,
    sourceWindowEnd: null,
    channelIds: [],
    branchIds: [],
    sourceStatus: decision,
    evidenceRefs: [],
    relation: qualifyAdviceRelation(bundle.proposal.sourceKind),
    permission: "campaign.read",
  };
}

export function createGrowthAdviceReader(reads: GrowthAdviceReads) {
  return {
    async readCandidates(input: ReadGrowthAdviceInput): Promise<GrowthAdviceReadResult> {
      const today = input.nowIso.slice(0, 10);
      const laneErrors: Record<string, string> = {};
      const tasks: { lane: string; run: Promise<unknown> }[] = [];
      if (input.allow.recommendations) {
        tasks.push({
          lane: "recommendations",
          run: reads.growthReads.listChannelRecommendationRecords({
            organizationId: input.organizationId,
            actorId: input.actorId,
            limit: MAX_RECOMMENDATIONS,
          }),
        });
      }
      if (input.allow.items) {
        tasks.push({
          lane: "items",
          run: reads.growthReads.listWorkspaceItems({
            organizationId: input.organizationId,
            actorId: input.actorId,
            throughMonth: today.slice(0, 7),
            limit: MAX_ITEMS,
          }),
        });
      }
      if (input.allow.proposals) {
        tasks.push({
          lane: "proposals",
          run: reads.proposalReader.listProposals({
            organizationId: input.organizationId,
            limit: MAX_PROPOSALS,
          }),
        });
      }

      const settled = await Promise.allSettled(tasks.map((task) => task.run));
      const candidates: GrowthAdviceCandidate[] = [];
      for (let index = 0; index < tasks.length; index += 1) {
        const task = tasks[index] as { lane: string; run: Promise<unknown> };
        const outcome = settled[index] as PromiseSettledResult<unknown>;
        if (outcome.status === "rejected") {
          laneErrors[task.lane] = "SOURCE_READ_FAILED";
          continue;
        }
        try {
          if (task.lane === "recommendations") {
            for (const row of outcome.value as readonly ChannelRecommendationRow[]) {
              const mapped = mapRecommendation(row, {
                organizationId: input.organizationId,
                today,
              });
              if (mapped) candidates.push(mapped);
            }
          } else if (task.lane === "items") {
            for (const row of outcome.value as readonly SynthesizedItemRow[]) {
              const mapped = mapItem(row, { organizationId: input.organizationId });
              if (mapped) candidates.push(mapped);
            }
          } else {
            const cards = toProposalCards(outcome.value as Parameters<typeof toProposalCards>[0]);
            const byId = new Map(cards.map((card) => [card.proposalId, card]));
            for (const bundle of outcome.value as readonly {
              proposal: { id: string; state: string; sourceKind: string };
            }[]) {
              const card = byId.get(bundle.proposal.id);
              // Advice needs something reviewable behind the link: a
              // researching or unreadable proposal stays out rather than
              // spending one of two rail rows on a page with no next step.
              const mapped = mapProposalBundle(
                {
                  proposal: bundle.proposal,
                  card: card
                    ? {
                        title:
                          card.content.kind === "document"
                            ? card.content.document.title
                            : "A campaign proposal is being worked out",
                        hasDocument: card.content.kind === "document",
                        lastDecision: card.lastDecision
                          ? { decision: card.lastDecision.decision }
                          : null,
                      }
                    : null,
                },
                { organizationId: input.organizationId },
              );
              if (mapped) candidates.push(mapped);
            }
          }
        } catch {
          laneErrors[task.lane] = "SOURCE_READ_FAILED";
        }
      }
      return { candidates, laneErrors };
    },
  };
}

export type GrowthAdviceReader = ReturnType<typeof createGrowthAdviceReader>;
