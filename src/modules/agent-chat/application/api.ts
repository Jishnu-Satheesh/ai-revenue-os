import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type { ContextPackReaders } from "@/modules/agent-chat/application/context-pack";
import { createAuthenticatedMarketProfileRepository } from "@/modules/growth-intelligence/infrastructure/profile-repository";

/**
 * Agent chat composition root (spec section 9).
 *
 * This file is the module's wiring point: like `api-schemas.ts`, it is
 * exempt from the application-layer adapter ban, so it may construct the
 * infrastructure readers the context-pack lanes need. Every other file in
 * this layer stays behind the `ContextPackReaders` port. Reads run on the
 * caller's session client — RLS plus the per-query `organization_id` pin
 * own tenant isolation, exactly as the thread repository does. No service
 * role in user-facing paths.
 *
 * Bound lanes (verified against the live schema in this tree):
 *
 * - branch timezone: `branches.timezone`, falling back to
 *   `organizations.default_timezone`. Absent → null, and the pack renders
 *   UTC with its failure limitation (the Task 6 timezone-flag fix keeps a
 *   throwing reader honest too).
 * - Market Profile: current approved version + digest through the
 *   authenticated profile repository (legacy organization scope — the pack
 *   seam carries no branch, so branch-scoped profiles read as missing with
 *   an honest limitation rather than a guessed row).
 * - business identity: the organization's own row (name, industry,
 *   country) as unverified source-aware facts. Verified-first sorting is
 *   unaffected: these arrive `verified: false` because nobody confirmed
 *   them as facts.
 *
 * Honestly gapped lanes (the pack reports gaps, never zeros — each names
 * its follow-up):
 *
 * - goals/constraints/policies: no owning read path found in this tree.
 * - governed evidence: the growth-progress windowed reads need
 *   branch-timezone amount mapping that is not verified here; mapping money
 *   wrong is worse than gapping.
 * - memory hits: retrieval needs actor/ceiling policy wiring per call.
 * - economics readiness: needs its repository implementation.
 * - timeline: pipeline history is branch-scoped and the pack seam carries
 *   no branch id.
 */

type SessionClient = SupabaseClient<Database>;

async function readBranchTimezone(
  supabase: SessionClient,
  organizationId: string,
  branchId?: string,
): Promise<string | null> {
  if (branchId) {
    const { data, error } = await supabase
      .from("branches")
      .select("timezone")
      .eq("organization_id", organizationId)
      .eq("id", branchId)
      .maybeSingle();
    if (!error && data && typeof data.timezone === "string" && data.timezone.length > 0) {
      return data.timezone;
    }
  }
  const { data, error } = await supabase
    .from("organizations")
    .select("default_timezone")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data || typeof data.default_timezone !== "string") return null;
  return data.default_timezone.length > 0 ? data.default_timezone : null;
}

async function readIdentityFacts(
  supabase: SessionClient,
  organizationId: string,
): Promise<unknown> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id,name,industry,country_code")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  const facts: { id: string; statement: string; verified: boolean; source: string }[] = [];
  if (typeof data.name === "string" && data.name.trim().length > 0) {
    facts.push({
      id: `org:${data.id}:name`,
      statement: data.name.trim().slice(0, 2000),
      verified: false,
      source: "organization",
    });
  }
  if (typeof data.industry === "string" && data.industry.trim().length > 0) {
    facts.push({
      id: `org:${data.id}:industry`,
      statement: `Industry: ${data.industry.trim()}`.slice(0, 2000),
      verified: false,
      source: "organization",
    });
  }
  if (typeof data.country_code === "string" && data.country_code.trim().length > 0) {
    facts.push({
      id: `org:${data.id}:country`,
      statement: `Country: ${data.country_code.trim()}`.slice(0, 2000),
      verified: false,
      source: "organization",
    });
  }
  return facts;
}

async function readMarketProfilePointer(
  supabase: SessionClient,
  organizationId: string,
): Promise<unknown> {
  const repository = createAuthenticatedMarketProfileRepository(supabase);
  const view = await repository.read({ organizationId, branchId: null });
  if (!view.profile || !view.profile.currentVersionId || !view.profile.enabled) {
    return { status: "missing" };
  }
  const current = view.versions.find((version) => version.id === view.profile?.currentVersionId);
  if (!current) return { status: "missing" };
  const niches = (current.document as { nicheDescriptors?: unknown }).nicheDescriptors;
  const niche = Array.isArray(niches) && typeof niches[0] === "string" ? niches[0] : undefined;
  return {
    status: "current",
    versionId: current.id,
    digest: current.digest,
    ...(niche ? { niche: niche.slice(0, 280) } : {}),
  };
}

/**
 * Binds the verified readers for one pack build. Every lane call carries
 * the server-owned organization id; nothing infers tenant scope from user
 * input. A throwing lane is left to throw — the pack turns it into an
 * honest gap plus a limitation, never a crash.
 */
export function createAgentContextReaders(supabase: SessionClient): ContextPackReaders {
  return {
    resolveBranchTimezone: async (scope) =>
      readBranchTimezone(supabase, scope.organizationId, scope.branchId),
    getIdentityFacts: async (scope) => readIdentityFacts(supabase, scope.organizationId),
    getMarketProfile: async (scope) => readMarketProfilePointer(supabase, scope.organizationId),
  };
}
