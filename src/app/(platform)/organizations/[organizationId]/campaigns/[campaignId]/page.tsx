import { notFound } from "next/navigation";
import Link from "next/link";
import { Megaphone, Palette } from "lucide-react";

import { type AllocationLedgerEvent } from "@/components/campaigns/allocation-ledger";
import { type OutcomeProofData } from "@/components/campaigns/outcome-proof";
import { type LearningProposalData } from "@/components/campaigns/learning-review";
import { CampaignDetailWorkspace } from "@/components/campaigns/campaign-detail-workspace";
import type { ReviewableDeliverable } from "@/components/campaigns/campaign-creative-review";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { campaignPhase, type DeliverableTally } from "@/domain/campaigns/phase";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import { createDeliverableRepository } from "@/modules/campaigns/infrastructure/deliverable-repository";
import type { DeliverablePersistence } from "@/modules/campaigns/infrastructure/deliverable-repository";
import { createDeliverableService } from "@/modules/campaigns/application/deliverable-service";
import {
  readLaunchAuthorized,
  type LaunchAuthorityReader,
} from "@/modules/campaigns/infrastructure/launch-repository";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { toGeneration } from "@/modules/campaigns/application/studio-view";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";
import { readStudioView } from "@/modules/campaigns/infrastructure/studio-reader";
import { createCampaignVariantStore } from "@/modules/campaigns/infrastructure/variant-repository";
import type { CampaignVariantPersistence } from "@/modules/campaigns/infrastructure/variant-repository";
import { remainingCapacity } from "@/modules/campaigns/application/variant-service";
import type { VariantCard } from "@/components/campaigns/variant-grid";

type PageProps = {
  params: Promise<{ organizationId: string; campaignId: string }>;
  searchParams: Promise<{ version?: string }>;
};

export default async function CampaignDetailPage({ params, searchParams }: PageProps) {
  const resolved = await params;
  const context = await getOrganizationContext(Promise.resolve(resolved));
  const organization = await getOrganization(context.supabase, context.organizationId);
  const { version } = await searchParams;

  const read = createCampaignReadRepository(context.supabase as unknown as CampaignPersistence);

  const view = await readStudioView(read, context.organizationId, resolved.campaignId, {
    versionId: version,
    // Signed against the caller's own session, so the private bucket is
    // reached with the member's permissions rather than around them.
    previews: {
      database: context.supabase as never,
      storage: context.supabase as never,
    },
    // Also the caller's session. The readiness function runs as the invoker,
    // so the member's own row level security decides what it can see.
    readiness: context.supabase as never,
  });

  if (!view) {
    // "Not found" and "not yours" must stay indistinguishable, or the answer
    // would confirm another tenant's campaign exists. "Mine, but not generated
    // yet" is a different question: the caller already proved membership to get
    // here, and RLS is what makes this read safe to trust.
    const campaign = await read.getCampaign(context.organizationId, resolved.campaignId);
    if (!campaign) notFound();

    const run = await read.latestGenerationRun(context.organizationId, resolved.campaignId);
    const generation = toGeneration(run, false, new Date().toISOString());

    return (
      <div className="flex min-h-0 flex-col gap-6">
        <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
        <RegisterRouteLabel segment={resolved.campaignId} label={campaign.title} />

        <div className="flex shrink-0 items-start gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Megaphone />
          </span>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{campaign.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              No proposal has been generated yet · {organization.name}
            </p>
          </div>
        </div>

        <Alert>
          <AlertTitle>
            {generation.status === "generating"
              ? "This campaign is still being built"
              : "This campaign has no proposal to review"}
          </AlertTitle>
          <AlertDescription>
            {generation.detail} Nothing has been approved, scheduled, or published, so no creative
            exists to review yet.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Read unconditionally. These were previously gated on a LIVE approval, which
  // meant a campaign that ran under an approval that has since expired showed an
  // empty fleet and an empty ledger — its own history erased by the clock. C09
  // requires the opposite: rollback stops new admissions and leaves history
  // readable. Whether anything new may be authorized is a separate question,
  // asked at the point of mutation, not at the point of reading.
  const fleet = await readFleet(context, view);
  const allocationEvents = await readAllocationEvents(context, resolved.campaignId);

  // The settled result is independent of whether an approval is still live: a
  // campaign that ran and settled keeps its proof after the approval lapses.
  const outcome = await readOutcome(context, resolved.campaignId);

  // The learning proposal is read through the caller's own session, so row
  // level security decides what is visible. A viewer can read it but cannot
  // decide it, which the component enforces through `canDecideLearning`.
  const learningProposal = await readLearningProposal(context, resolved.campaignId);
  const canDecideLearning = context.membership.role !== "viewer";

  // Read through the caller's own session, so RLS decides what is visible. A
  // failure here is reported as a failure, never as an empty list: "no outputs"
  // and "we could not look" would otherwise be indistinguishable, and only one
  // of them means it is safe to conclude nothing is waiting for review.
  const deliverables = await readDeliverables(context, resolved.campaignId);

  // Asked, not assumed. Passing a flat `false` here would have claimed every
  // campaign lacks publication authority; passing a permanent `null` would have
  // shown a "could not be read" warning on every campaign forever, which is how
  // a warning that means something real gets trained out of people.
  const launchAuthorized = await readLaunchAuthorized(
    context.supabase as unknown as LaunchAuthorityReader,
    { organizationId: context.organizationId, campaignId: resolved.campaignId },
  );

  // Capability checks, not role checks. Reviewing an output and authorizing a
  // publication are separate rights, and collapsing them into "not a viewer"
  // would hand an operator the publish button C04 keeps above their line.
  const canReviewOutputs = hasOrganizationPermission(context.membership.role, "campaign.approve");
  const canPublish = hasOrganizationPermission(context.membership.role, "campaign.publish");

  // Rendered here, in the organization's timezone, so the client component
  // never reads the clock during render.
  const lastUpdatedLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: organization.default_timezone,
  }).format(new Date(view.versions.find((entry) => entry.isCurrent)?.createdAt ?? Date.now()));

  const phase = campaignPhase({
    state: view.state,
    hasVersion: true,
    approvalStatus: view.approval.status,
    deliverables: deliverables === null ? null : tallyOf(deliverables),
    launchAuthorized,
    settledAt: outcome?.settledAt ?? null,
  });

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <RegisterRouteLabel segment={resolved.campaignId} label={view.title} />

      <CampaignDetailWorkspace
        view={view}
        phase={phase}
        organizationId={context.organizationId}
        organizationName={organization.name}
        timeZone={organization.default_timezone}
        currency={organization.base_currency}
        variants={fleet.variants}
        variantsRemaining={fleet.remaining}
        deliverables={deliverables ?? []}
        deliverablesReadFailed={deliverables === null}
        launchAuthorized={launchAuthorized}
        lastUpdatedLabel={lastUpdatedLabel}
        allocationEvents={allocationEvents}
        outcome={outcome}
        learningProposal={learningProposal}
        canReviewOutputs={canReviewOutputs}
        canPublish={canPublish}
        canDecideLearning={canDecideLearning}
      />
    </div>
  );
}

/**
 * The fast loop's decisions for this campaign, newest first.
 *
 * Read through the caller's own session client, so row level security decides
 * what is visible exactly as it does for the rest of the studio. The mapping is
 * the same shape the allocation API returns, so the component consumes the same
 * contract whether the data came from a page render or a fetch.
 */
async function readAllocationEvents(
  context: { supabase: unknown; organizationId: string },
  campaignId: string,
): Promise<readonly AllocationLedgerEvent[]> {
  const client = context.supabase as unknown as {
    from(table: "campaign_allocation_events"): {
      select(columns: string): {
        eq(
          column: string,
          value: string,
        ): {
          eq(
            column: string,
            value: string,
          ): {
            order(
              column: string,
              opts: { ascending: boolean },
            ): PromiseLike<{
              data: AllocationRow[] | null;
              error: unknown;
            }>;
          };
        };
      };
    };
  };

  const { data, error } = await client
    .from("campaign_allocation_events")
    .select(
      "id, variant_id, rule_key, rule_version, observed_value, threshold, resolved_margin_minor, resolved_margin_grade, action, reason_code, actor, occurred_at",
    )
    .eq("organization_id", context.organizationId)
    .eq("campaign_id", campaignId)
    .order("occurred_at", { ascending: false });

  if (error) throw new Error("Allocation decisions could not be read.");

  return (data ?? []).map((row) => ({
    id: row.id,
    variantId: row.variant_id,
    ruleKey: row.rule_key,
    ruleVersion: row.rule_version,
    observedValue: toNumber(row.observed_value),
    threshold: toNumber(row.threshold),
    resolvedMarginMinor: toNumber(row.resolved_margin_minor),
    resolvedMarginGrade: row.resolved_margin_grade,
    action: row.action,
    reasonCode: row.reason_code,
    actor: row.actor,
    occurredAt: row.occurred_at,
  }));
}

type AllocationRow = {
  id: string;
  variant_id: string;
  rule_key: string;
  rule_version: string;
  observed_value: number | string | null;
  threshold: number | string | null;
  resolved_margin_minor: number | string | null;
  resolved_margin_grade: AllocationLedgerEvent["resolvedMarginGrade"];
  action: AllocationLedgerEvent["action"];
  reason_code: string;
  actor: string;
  occurred_at: string;
};

function toNumber(value: number | string | null): number | null {
  if (value === null || value === "") return null;
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The settled result, if one exists. Read through the caller's own session
 * client so row level security decides what is visible, exactly as it does for
 * the rest of the studio. The mapping matches the outcome API, so the component
 * consumes the same contract whether the data came from a page render or a
 * fetch.
 */
async function readOutcome(
  context: { supabase: unknown; organizationId: string },
  campaignId: string,
): Promise<OutcomeProofData | null> {
  const client = context.supabase as unknown as {
    from(table: "campaign_outcomes"): {
      select(columns: string): {
        eq(
          column: string,
          value: string,
        ): {
          eq(
            column: string,
            value: string,
          ): {
            order(
              column: string,
              opts: { ascending: boolean },
            ): PromiseLike<{
              data: OutcomeRow[] | null;
              error: unknown;
            }>;
          };
        };
      };
    };
  };

  const { data, error } = await client
    .from("campaign_outcomes")
    .select(
      "id, verdict, attribution_method, primary_metric_key, outcome_window_days, settlement_delay_days, baseline_source, baseline_lookback_days, planned_exposure_count, realized_exposure_count, guardrail_state, realized_spend_minor, spend_ceiling_minor, spend_currency, estimate_minor, estimate_low_minor, estimate_high_minor, estimate_currency, evidence_tier, truncation_causes, limitations, settled_at",
    )
    .eq("organization_id", context.organizationId)
    .eq("campaign_id", campaignId)
    .order("settled_at", { ascending: false });

  if (error) throw new Error("The campaign outcome could not be read.");

  const row = data?.[0];
  if (!row) return null;

  return {
    id: row.id,
    verdict: row.verdict,
    attributionMethod: row.attribution_method,
    primaryMetricKey: row.primary_metric_key,
    outcomeWindowDays: row.outcome_window_days,
    settlementDelayDays: row.settlement_delay_days,
    baselineSource: row.baseline_source,
    baselineLookbackDays: row.baseline_lookback_days,
    plannedExposureCount: toNumber(row.planned_exposure_count),
    realizedExposureCount: toNumber(row.realized_exposure_count),
    guardrailState: row.guardrail_state,
    realizedSpendMinor: toNumber(row.realized_spend_minor),
    spendCeilingMinor: toNumber(row.spend_ceiling_minor),
    spendCurrency: row.spend_currency,
    estimateMinor: toNumber(row.estimate_minor),
    estimateLowMinor: toNumber(row.estimate_low_minor),
    estimateHighMinor: toNumber(row.estimate_high_minor),
    estimateCurrency: row.estimate_currency,
    evidenceTier: row.evidence_tier,
    truncationCauses: row.truncation_causes,
    limitations: row.limitations,
    settledAt: row.settled_at,
  };
}

type OutcomeRow = {
  id: string;
  verdict: OutcomeProofData["verdict"];
  attribution_method: OutcomeProofData["attributionMethod"];
  primary_metric_key: string;
  outcome_window_days: number;
  settlement_delay_days: number;
  baseline_source: string;
  baseline_lookback_days: number;
  planned_exposure_count: number | string;
  realized_exposure_count: number | string;
  guardrail_state: OutcomeProofData["guardrailState"];
  realized_spend_minor: number | string | null;
  spend_ceiling_minor: number | string | null;
  spend_currency: string | null;
  estimate_minor: number | string | null;
  estimate_low_minor: number | string | null;
  estimate_high_minor: number | string | null;
  estimate_currency: string | null;
  evidence_tier: OutcomeProofData["evidenceTier"];
  truncation_causes: unknown;
  limitations: unknown;
  settled_at: string;
};

/**
 * The learning proposal the evidence loop drafted from the settled outcome, if
 * one exists. Read through the caller's own session so row level security
 * decides what is visible, exactly as it does for the rest of the studio.
 */
async function readLearningProposal(
  context: { supabase: unknown; organizationId: string },
  campaignId: string,
): Promise<LearningProposalData | null> {
  const client = context.supabase as unknown as {
    from(table: "campaign_learning_proposals"): {
      select(columns: string): {
        eq(
          column: string,
          value: string,
        ): {
          eq(
            column: string,
            value: string,
          ): {
            order(
              column: string,
              opts: { ascending: boolean },
            ): PromiseLike<{
              data: LearningProposalRow[] | null;
              error: unknown;
            }>;
          };
        };
      };
    };
  };

  const { data, error } = await client
    .from("campaign_learning_proposals")
    .select(
      "id, verdict, evidence_tier, planned_exposure_count, realized_exposure_count, hypothesis, observation, proposed_lesson, limitations, suggested_next_test, evidence_links, status, target_artifact_type, decided_by, decided_at, created_at",
    )
    .eq("organization_id", context.organizationId)
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });

  if (error) throw new Error("The campaign learning proposal could not be read.");

  const row = data?.[0];
  if (!row) return null;

  return {
    id: row.id,
    campaignId,
    verdict: row.verdict,
    evidenceTier: row.evidence_tier,
    plannedExposureCount: toNumber(row.planned_exposure_count),
    realizedExposureCount: toNumber(row.realized_exposure_count),
    hypothesis: row.hypothesis,
    observation: row.observation,
    proposedLesson: row.proposed_lesson,
    limitations: row.limitations,
    suggestedNextTest: row.suggested_next_test,
    evidenceLinks: row.evidence_links,
    status: row.status,
    targetArtifactType: row.target_artifact_type,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

type LearningProposalRow = {
  id: string;
  verdict: LearningProposalData["verdict"];
  evidence_tier: LearningProposalData["evidenceTier"];
  planned_exposure_count: number | string;
  realized_exposure_count: number | string;
  hypothesis: string;
  observation: string;
  proposed_lesson: string;
  limitations: unknown;
  suggested_next_test: string;
  evidence_links: unknown;
  status: LearningProposalData["status"];
  target_artifact_type: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

/**
 * The creative produced under this approval, joined to the directions it varies.
 *
 * The direction's name and kind live in the approved manifest rather than on the
 * variant row, so the join happens here: duplicating them onto every variant
 * would let a renamed direction disagree with itself across a fleet.
 */
async function readFleet(
  context: { supabase: unknown; organizationId: string },
  view: Awaited<ReturnType<typeof readStudioView>>,
): Promise<{ variants: VariantCard[]; remaining: Record<string, number> }> {
  if (!view) return { variants: [], remaining: {} };

  const store = createCampaignVariantStore(
    context.supabase as unknown as CampaignVariantPersistence,
  );
  const [stored, capacity] = await Promise.all([
    store.listForVersion(context.organizationId, view.versionId),
    store.readCapacity(context.organizationId, view.versionId),
  ]);

  const byDirection = new Map(view.directions.map((direction) => [direction.id, direction]));

  return {
    variants: stored.flatMap((variant) => {
      const direction = byDirection.get(variant.directionId);
      if (!direction) return [];
      return [
        {
          id: variant.id,
          directionId: variant.directionId,
          directionName: direction.name,
          directionKind: direction.kind,
          ordinal: variant.ordinal,
          state: variant.state,
          hook: variant.hook,
          caption: variant.caption,
          callToAction: variant.callToAction,
          hashtags: variant.hashtags,
          channel: variant.channel,
          placement: variant.placement,
          // Signed previews are issued per bundle asset; a variant's own image
          // gets its link in the same pass once that path exists. Null renders
          // as "preview unavailable" rather than a broken image.
          previewUrl: null,
        },
      ];
    }),
    remaining: Object.fromEntries(
      view.directions.map((direction) => [
        direction.id,
        remainingCapacity({ generationPolicy: view.generationPolicy } as never, {
          usedInDirection: capacity.usedByDirection[direction.id] ?? 0,
          usedInTotal: capacity.usedInTotal,
        }),
      ]),
    ),
  };
}

/**
 * Every finished output for this campaign, with its publication verdict.
 *
 * Returns `null` when the read failed, which the page reports as a failure
 * rather than as an empty list. An empty list is a claim — "nothing is waiting
 * for you" — and it must not be made on the strength of a query that did not
 * come back.
 */
async function readDeliverables(
  context: { supabase: unknown; organizationId: string },
  campaignId: string,
): Promise<readonly ReviewableDeliverable[] | null> {
  const service = createDeliverableService({
    store: createDeliverableRepository(context.supabase as unknown as DeliverablePersistence),
  });

  try {
    const listed = await service.listForCampaign({
      organizationId: context.organizationId,
      campaignId,
    });
    return listed.map((entry) => ({ ...entry }));
  } catch {
    return null;
  }
}

/** Counts of things that exist. Never an estimate, never a tidied-up number. */
function tallyOf(deliverables: readonly ReviewableDeliverable[]): DeliverableTally {
  const produced = deliverables.filter((entry) => entry.currentVersion !== null);
  return {
    planned: deliverables.length,
    produced: produced.length,
    approved: produced.filter((entry) => entry.eligibility.publishable).length,
    rejected: produced.filter((entry) => entry.eligibility.reasonCode === "rejected").length,
  };
}

