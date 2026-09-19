import { NextResponse } from "next/server";
import { z } from "zod";

import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { isCampaignsEnabled } from "@/modules/campaigns/application/feature-access";
import { hasGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import {
  assertOverviewGrowthProgressEnabled,
} from "@/modules/organizations/application/growth-progress-access";
import { dispatchGrowthBuildNow } from "@/modules/organizations/infrastructure/growth-publication-dispatch";
import { revenueDayInZone } from "@/modules/organizations/infrastructure/revenue-source";

/**
 * Immediate run of tonight's revenue/projection build (POST only).
 *
 * Owner/admin only, allow-listed organizations only, blank states only (the
 * button never renders otherwise — but the route re-checks nothing about
 * the view: it dispatches the same idempotent worker task the hourly
 * dispatcher uses, so a duplicate request collapses instead of doubling).
 *
 * The body carries an idempotency key the client generates for its own retry
 * safety; it is accepted and never persisted. The worker answers
 * asynchronously: success here means "accepted", never "published". A stale
 * baseline still refuses inside the worker with its honest reason, and the
 * result appears on the next page load — never in this response.
 */

const triggerBodySchema = z
  .strictObject({ idempotencyKey: z.string().trim().min(16).max(200) })
  .strict();

function apiErrorResponse(error: unknown, correlationId: string) {
  const publicError = toPublicError(error);
  const status =
    publicError.code === "AUTHENTICATION_ERROR"
      ? 401
      : publicError.code === "AUTHORIZATION_ERROR" ||
          publicError.code === "FEATURE_NOT_AVAILABLE"
        ? 403
        : publicError.code === "VALIDATION_ERROR"
          ? 400
          : publicError.code === "WORKFLOW_ERROR"
            ? 503
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

    // Owner/admin only: this spends a worker run outside its schedule.
    // Operators and viewers keep the honest empty state with no control.
    if (role !== "owner" && role !== "admin") {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "Only an owner or admin can run tonight's check early for this organization.",
      );
    }

    assertOverviewGrowthProgressEnabled(organizationId);
    triggerBodySchema.parse(await request.json().catch(() => ({})));

    const { data: orgRow, error: orgError } = await context.supabase
      .from("organizations")
      .select("default_timezone")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgError || !orgRow) {
      throw new DomainError("TENANT_SCOPE_ERROR", "The organization was not found.");
    }
    const timeZone = String(
      (orgRow as { default_timezone: unknown }).default_timezone ?? "UTC",
    );
    const nowIso = new Date().toISOString();

    // Same gates the hourly dispatcher computes, so the on-demand run is
    // the scheduled run moved earlier — never a wider one.
    const accepted = await dispatchGrowthBuildNow({
      organizationId,
      snapshotDate: revenueDayInZone(timeZone, nowIso),
      timeZone,
      gates: {
        growth: hasGrowthIntelligenceAccess(organizationId, "market"),
        campaigns: isCampaignsEnabled(organizationId),
      },
    });
    if (!accepted) {
      throw new DomainError(
        "WORKFLOW_ERROR",
        "The worker could not be reached just now — tonight's scheduled run is unaffected.",
      );
    }

    logger.info("growth.build_triggered", { organizationId, correlationId });
    const response = NextResponse.json({ triggered: true }, { status: 202 });
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    logger.warn("growth.build_trigger_failed", {
      organizationId: organizationId ?? "unknown",
      correlationId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return apiErrorResponse(error, correlationId);
  }
}
