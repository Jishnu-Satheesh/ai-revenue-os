import { NextResponse } from "next/server";
import { z } from "zod";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { applyProposedRanges, buildRevenueScenario } from "@/domain/organizations/revenue-scenario";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createAuthenticatedChannelAnalysisRepository } from "@/modules/analysis/infrastructure/read-repository";
import { isCampaignsEnabled } from "@/modules/campaigns/application/feature-access";
import { createCampaignProposalReader } from "@/modules/campaigns/infrastructure/proposal-read-repository";
import type { ProposalReadPersistence } from "@/modules/campaigns/infrastructure/proposal-read-repository";
import { hasGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import { createAuthenticatedGrowthIntelligenceReadRepository } from "@/modules/growth-intelligence/infrastructure/read-repository";
import { readRevenueSource } from "@/modules/organizations/infrastructure/revenue-source";
import {
  createRevenueProposalProvider,
  REVENUE_PROPOSAL_MAX_ACTIONS,
} from "@/modules/organizations/infrastructure/revenue-proposal-provider";

/**
 * Rough-estimate proposals for the home growth outlook (POST only).
 *
 * The body carries an idempotency key the client generates for its own retry
 * safety; it is accepted and never persisted. Nothing else is trusted: the
 * server rebuilds the verified scenario input through the same read path as
 * the home loader, the model proposes ONLY low/high fractions bound to cited
 * findings, and deterministic code attaches and computes everything.
 *
 * Failure is always the hold-current-level scenario with an explicit note —
 * never a fake number, never quiet confidence. Nothing is stored: no DB
 * write, no RPC, no event, no cache.
 */

const proposalsBodySchema = z
  .strictObject({ idempotencyKey: z.string().trim().min(16).max(200) })
  .strict();

const AI_UNAVAILABLE_NOTE =
  "Rough-estimate proposals are unavailable right now — showing the current course.";

function apiErrorResponse(error: unknown, correlationId: string) {
  const publicError = toPublicError(error);
  const status =
    publicError.code === "AUTHENTICATION_ERROR"
      ? 401
      : publicError.code === "AUTHORIZATION_ERROR"
        ? 403
        : publicError.code === "VALIDATION_ERROR"
          ? 400
          : publicError.code === "UNEXPECTED_ERROR"
            ? 500
            : 422;
  const response = NextResponse.json({ error: publicError }, { status });
  response.headers.set("x-correlation-id", correlationId);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const correlationId = crypto.randomUUID();
  let organizationId: string | undefined;
  try {
    const rawParams = await params;
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: rawParams.organizationId }),
    );
    organizationId = context.organizationId;
    const role = context.membership.role as OrganizationRole;

    if (!hasOrganizationPermission(role, "growth_intelligence.manage")) {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "You do not have permission to propose estimates for this organization.",
      );
    }

    proposalsBodySchema.parse(await request.json().catch(() => ({})));

    // The scenario's "today" runs on the organization's own calendar, like
    // the home loader — never UTC by default.
    const { data: orgRow, error: orgError } = await context.supabase
      .from("organizations")
      .select("default_timezone")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgError || !orgRow) {
      throw new DomainError("TENANT_SCOPE_ERROR", "The organization was not found.");
    }

    const source = await readRevenueSource({
      reads: {
        analysis: createAuthenticatedChannelAnalysisRepository(context.supabase),
        growthReads: createAuthenticatedGrowthIntelligenceReadRepository(context.supabase),
        proposalReader: createCampaignProposalReader(
          context.supabase as unknown as ProposalReadPersistence,
        ),
      },
      organizationId,
      actorId: context.user.id,
      timeZone: String((orgRow as { default_timezone: unknown }).default_timezone ?? "UTC"),
      now: new Date().toISOString(),
      // Same read gates as the home loader, so the route proposes over the
      // same inputs the section shows. Spending the model call is separately
      // authorized by growth_intelligence.manage above.
      canBands: hasOrganizationPermission(role, "channel.read"),
      canActions:
        hasGrowthIntelligenceAccess(organizationId, "market") &&
        hasOrganizationPermission(role, "growth_intelligence.read"),
      canProposals:
        isCampaignsEnabled(organizationId) && hasOrganizationPermission(role, "campaign.read"),
      onFailure: () => {},
    });
    if (source.status !== "ready") {
      throw new DomainError("INTEGRATION_ERROR", "The growth outlook could not be read right now.");
    }

    const holdCurrentLevel = (aiNote: string | null) =>
      NextResponse.json(
        {
          scenario: buildRevenueScenario(source.input),
          acceptedCount: 0,
          rejectedCount: 0,
          aiNote,
          correlationId,
        },
        { headers: { "x-correlation-id": correlationId, "Cache-Control": "no-store" } },
      );

    const candidates = source.input.actions
      .filter((action) => action.assumptionLow === null || action.assumptionHigh === null)
      .slice(0, REVENUE_PROPOSAL_MAX_ACTIONS);
    if (candidates.length === 0 || source.input.losses.length === 0) {
      return holdCurrentLevel(
        "Nothing left to estimate — every action is already quantified or cites no listed input.",
      );
    }

    const currencies = new Set([
      ...source.input.history.map((point) => point.currency),
      ...source.input.losses.map((loss) => loss.currency),
    ]);
    if (currencies.size !== 1) {
      return holdCurrentLevel(
        "These sources reported in more than one currency, so no single estimate can be proposed.",
      );
    }
    const [currency] = currencies;

    let ranges: readonly unknown[];
    try {
      const provider = createRevenueProposalProvider();
      ranges = await provider.propose({
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
    } catch {
      return holdCurrentLevel(AI_UNAVAILABLE_NOTE);
    }

    const knownFindingIds = new Set(source.input.losses.map((loss) => loss.findingId));
    const applied = applyProposedRanges(source.input.actions, ranges, knownFindingIds);
    const scenario = buildRevenueScenario({ ...source.input, actions: applied.actions });
    const acceptedCount = Math.max(0, candidates.length - applied.rejected.length);
    return NextResponse.json(
      {
        scenario,
        acceptedCount,
        rejectedCount: applied.rejected.length,
        aiNote:
          applied.rejected.length === 0
            ? "Model-proposed ranges applied as explicit assumptions; every figure still comes from deterministic arithmetic."
            : `${acceptedCount} proposed range(s) applied; ${applied.rejected.length} rejected as uncited.`,
        correlationId,
      },
      { headers: { "x-correlation-id": correlationId, "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.warn("organization_home.revenue_proposals_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return apiErrorResponse(error, correlationId);
  }
}
