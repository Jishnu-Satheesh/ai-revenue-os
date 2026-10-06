import { NextResponse } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createPublicLeadsServiceClient } from "@/lib/supabase/service";

import { corsHeaders, parseAllowedOrigins, resolveAllowedOrigin } from "./cors";
import { consumeLeadAllowances } from "./rate-limit";
import { LeadApiError, parseLeadRequest } from "./schemas";

/**
 * Public lead capture for the Coming Soon site.
 *
 * Anonymous by necessity — a visitor has no session — so nothing here is
 * trusted: the origin must be allowlisted, the payload must pass strict
 * validation, and two rate-limit buckets must both allow the write before a
 * service-role client is even constructed. Every failure answers JSON, never
 * an HTML error page, because the form reports any non-2xx as a generic retry.
 */

export const dynamic = "force-dynamic";

const recordResultSchema = z.object({
  outcome: z.enum(["recorded", "replayed"]),
  lead_id: z.string().uuid(),
});

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function OPTIONS(request: Request) {
  const allowed = resolveAllowedOrigin(
    request.headers.get("origin"),
    parseAllowedOrigins(env.COMING_SOON_ORIGINS),
  );
  return new NextResponse(null, { status: 204, headers: corsHeaders(allowed) });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const allowed = resolveAllowedOrigin(origin, parseAllowedOrigins(env.COMING_SOON_ORIGINS));
  const headers = corsHeaders(allowed);

  try {
    // A page in a browser cannot suppress its Origin header, so a missing one
    // means a non-browser caller — curl, a monitor — and this endpoint is
    // public anyway. A present but unlisted origin is a foreign page.
    if (origin !== null && allowed === null) {
      throw new LeadApiError("ORIGIN_NOT_ALLOWED", 403, "This origin may not submit signups.");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new LeadApiError("INVALID_REQUEST", 400, "The request body must be valid JSON.");
    }

    // Validation precedes limiting: a malformed signup must fail fast as a
    // 400 without burning abuse budget or masking itself as a 503.
    const lead = parseLeadRequest(body);

    const allowance = await consumeLeadAllowances({ ip: clientIp(request), email: lead.email });
    if (!allowance.allowed) {
      throw allowance.reason === "limited"
        ? new LeadApiError("RATE_LIMITED", 429, "Too many signups. Try again later.")
        : new LeadApiError("SERVICE_UNAVAILABLE", 503, "The signup service is unavailable.");
    }

    const supabase = createPublicLeadsServiceClient();
    const { data, error } = await supabase.rpc("record_public_lead", {
      input_lead: {
        email: lead.email,
        intent: lead.intent,
        name: lead.name ?? null,
        source: lead.source,
      },
    });

    if (error) {
      logger.error("public_leads.record_failed", { errorCode: "RPC_ERROR" });
      throw new LeadApiError("SERVICE_UNAVAILABLE", 503, "The signup could not be recorded.");
    }

    const recorded = recordResultSchema.safeParse(data);
    if (!recorded.success) {
      logger.error("public_leads.record_failed", { errorCode: "UNEXPECTED_SHAPE" });
      throw new LeadApiError("SERVICE_UNAVAILABLE", 503, "The signup could not be recorded.");
    }

    logger.info(`public_leads.${recorded.data.outcome}`, { leadId: recorded.data.lead_id });
    return NextResponse.json({ ok: true, intent: lead.intent }, { status: 200, headers });
  } catch (error) {
    if (error instanceof LeadApiError) {
      // 5xx causes already logged themselves with their own code upstream.
      if (error.status < 500) logger.warn("public_leads.refused", { refusalCode: error.code });
      return NextResponse.json({ ok: false, error: error.code }, { status: error.status, headers });
    }
    logger.error("public_leads.failed", {
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ ok: false, error: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
  }
}
