import { NextResponse } from "next/server";
import { z } from "zod";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  marketProfileApiErrorResponse,
  marketProfileCorrelationState,
  marketProfileRouteParamsSchema,
} from "@/modules/growth-intelligence/application/api-schemas";
import { assertGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import {
  buildLivePreviewQueries,
  livePreviewResultItemSchema,
  parseLivePreviewResponse,
  type LivePreviewResultItem,
} from "@/modules/growth-intelligence/application/live-preview";
import { buildBraveSearchRequestUrl } from "@/modules/growth-intelligence/infrastructure/research/brave-search-adapter";
import { createBraveSearchTransport } from "@/modules/growth-intelligence/infrastructure/research/brave-search-transport";

/**
 * Request body: the Task 1 live-preview input plus an idempotency key the
 * client generates for its own retry safety. The key is accepted and never
 * persisted: this route stores nothing.
 *
 * The shape mirrors livePreviewInputSchema field-for-field on purpose. The
 * service re-validates the narrowed input authoritatively inside
 * buildLivePreviewQueries, so this boundary can never widen what the planner
 * accepts.
 */
const livePreviewBodySchema = z
  .object({
    branchId: z.string().uuid(),
    topics: z.array(z.string().trim().min(1).max(160)).max(3).optional().default([]),
    competitors: z.array(z.string().trim().min(1).max(160)).max(2).optional().default([]),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.topics.length + input.competitors.length < 1) {
      context.addIssue({
        code: "custom",
        path: ["topics"],
        message: "Provide at least one topic or competitor.",
      });
    }
  });

const livePreviewResponseSchema = z
  .object({
    results: z.array(livePreviewResultItemSchema).max(15),
    queryCount: z.number().int().min(1).max(3),
    resultCount: z.number().int().min(0).max(15),
    retrievedAt: z.string().datetime({ offset: true }),
    correlationId: z.string().uuid(),
    liveOnly: z.literal(true),
    disclaimer: z.string().trim().min(1),
  })
  .strict();

const LIVE_PREVIEW_DISCLAIMER =
  "Live preview — not saved. Unverified leads, not evidence. Cannot create Insights or Recommendations from this view.";

const LIVE_PREVIEW_QUERY_TIMEOUT_MS = 10_000;
const LIVE_PREVIEW_MAX_RESPONSE_BYTES = 256 * 1024;
const LIVE_PREVIEW_RESULTS_PER_QUERY = 5;
const LIVE_PREVIEW_MAX_ITEMS = 15;

const LIVE_PREVIEW_NOT_CONFIGURED_MESSAGE = "Live preview is not configured.";
const LIVE_PREVIEW_UNAVAILABLE_MESSAGE = "Live preview is temporarily unavailable. Try again.";
const LIVE_PREVIEW_BRANCH_NOT_FOUND_MESSAGE = "The requested branch was not found.";

/**
 * Ephemeral Brave preview. Reads fresh results, returns them, stores
 * nothing: no DB write, no RPC, no event, no cache. POST only.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const correlation = marketProfileCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const rawParams = await params;
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: rawParams.organizationId }),
    );
    organizationId = context.organizationId;

    assertGrowthIntelligenceAccess(organizationId, "market");
    if (
      !hasOrganizationPermission(
        context.membership.role as OrganizationRole,
        "growth_intelligence.manage",
      )
    ) {
      throw new DomainError(
        "AUTHORIZATION_ERROR",
        "You do not have permission to preview Market Research for this organization.",
      );
    }
    correlationId = correlation.parseAfterAuthorization();

    marketProfileRouteParamsSchema.parse(rawParams);
    const body = livePreviewBodySchema.parse(await request.json().catch(() => ({})));

    // Tenant scope stays server-owned: the branch must belong to the
    // organization the session proved, and any miss is a 404.
    const { data: branchRow, error: branchError } = await context.supabase
      .from("branches")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", body.branchId)
      .maybeSingle();
    if (branchError || !branchRow) {
      throw new DomainError("TENANT_SCOPE_ERROR", LIVE_PREVIEW_BRANCH_NOT_FOUND_MESSAGE);
    }

    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey || apiKey.length === 0) {
      throw new DomainError("FEATURE_NOT_AVAILABLE", LIVE_PREVIEW_NOT_CONFIGURED_MESSAGE);
    }

    const queries = buildLivePreviewQueries({
      branchId: body.branchId,
      topics: body.topics,
      competitors: body.competitors,
    });
    const retrievedAt = new Date().toISOString();
    const transport = createBraveSearchTransport({ apiKey });

    // One query may fail (timeout, over-budget body, bad status, unreadable
    // payload) without failing the others. Only provider text stays out: the
    // failure below carries a fixed safe message.
    const merged: LivePreviewResultItem[] = [];
    let failedQueries = 0;
    for (const query of queries) {
      const url = buildBraveSearchRequestUrl(query, LIVE_PREVIEW_RESULTS_PER_QUERY);
      let payload: unknown;
      try {
        const response = await transport.search({
          url,
          timeoutMs: LIVE_PREVIEW_QUERY_TIMEOUT_MS,
          maxResponseBytes: LIVE_PREVIEW_MAX_RESPONSE_BYTES,
          abortSignal: AbortSignal.timeout(LIVE_PREVIEW_QUERY_TIMEOUT_MS),
        });
        if (response.status !== 200) {
          failedQueries += 1;
          continue;
        }
        if (response.body.byteLength > LIVE_PREVIEW_MAX_RESPONSE_BYTES) {
          failedQueries += 1;
          continue;
        }
        payload = JSON.parse(new TextDecoder().decode(response.body));
      } catch {
        failedQueries += 1;
        continue;
      }
      try {
        merged.push(...parseLivePreviewResponse(payload, retrievedAt));
      } catch {
        failedQueries += 1;
      }
    }

    const results = merged.slice(0, LIVE_PREVIEW_MAX_ITEMS);
    if (results.length === 0 && failedQueries > 0) {
      throw new DomainError("INTEGRATION_ERROR", LIVE_PREVIEW_UNAVAILABLE_MESSAGE);
    }

    const responseBody = livePreviewResponseSchema.parse({
      results,
      queryCount: queries.length,
      resultCount: results.length,
      retrievedAt,
      correlationId,
      liveOnly: true as const,
      disclaimer: LIVE_PREVIEW_DISCLAIMER,
    });
    const response = NextResponse.json(responseBody);
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    // Counts only by construction: the logger allowlist carries identifiers
    // and codes, never provider text, titles, URLs, or keys.
    logger.warn("growth_intelligence.market_research_live_preview_api_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return marketProfileApiErrorResponse(error, correlationId);
  }
}
