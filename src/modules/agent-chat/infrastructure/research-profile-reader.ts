import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createMarketProfileDigest } from "@/domain/growth-intelligence/profile-digest";
import { marketProfileDocumentSchema } from "@/domain/growth-intelligence/schemas";
import type { MarketProfileDocument } from "@/domain/growth-intelligence/types";
import type { Database } from "@/lib/supabase/database.types";

const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const scopeSchema = z
  .object({
    organizationId: uuid,
    versionId: uuid,
    branchId: uuid.nullable().optional(),
  })
  .strict();
const versionSchema = z.object({
  id: uuid,
  market_profile_id: uuid,
  profile_digest: digest,
  source_policy_digest: digest,
  profile_document: marketProfileDocumentSchema,
});
const profileSchema = z.object({
  id: uuid,
  branch_id: uuid.nullable(),
  current_version_id: uuid.nullable(),
  enabled: z.boolean(),
});
const decisionSchema = z.object({
  decision: z.enum(["confirmed", "rejected", "disabled", "superseded"]),
  profile_digest: digest,
});

export type AgentResearchProfile = {
  versionId: string;
  digest: string;
  document: MarketProfileDocument;
  enabled: true;
  sourcePolicyDigest: string;
};
export type AgentResearchProfileRead =
  | { kind: "ready"; profile: AgentResearchProfile }
  | {
      kind: "blocked";
      reasonCode:
        | "PROFILE_UNAVAILABLE"
        | "PROFILE_NOT_CURRENT"
        | "PROFILE_NOT_CONFIRMED"
        | "PROFILE_SCOPE_MISMATCH"
        | "PROFILE_INVALID";
    };

/** Read-only worker guard. An enabled pointer never substitutes for confirmation. */
export async function readAgentResearchProfileVersion(
  supabase: SupabaseClient<Database>,
  input: z.input<typeof scopeSchema>,
): Promise<AgentResearchProfileRead> {
  const scope = scopeSchema.safeParse(input);
  if (!scope.success) return { kind: "blocked", reasonCode: "PROFILE_SCOPE_MISMATCH" };
  const { organizationId, versionId } = scope.data;
  const branchId = scope.data.branchId ?? null;
  const blocked = (
    reasonCode: Extract<AgentResearchProfileRead, { kind: "blocked" }>["reasonCode"],
  ): AgentResearchProfileRead => ({ kind: "blocked", reasonCode });
  try {
    const versionRead = await supabase
      .from("organization_market_profile_versions")
      .select("id,market_profile_id,profile_digest,source_policy_digest,profile_document")
      .eq("organization_id", organizationId)
      .eq("id", versionId)
      .maybeSingle();
    if (versionRead.error || !versionRead.data) return blocked("PROFILE_UNAVAILABLE");
    const parsedVersion = versionSchema.safeParse(versionRead.data);
    if (!parsedVersion.success) return blocked("PROFILE_INVALID");
    const version = parsedVersion.data;
    const declaredBranch =
      version.profile_document.schemaVersion === 2 ? version.profile_document.branchId : null;
    if (declaredBranch !== branchId) return blocked("PROFILE_SCOPE_MISMATCH");
    if (createMarketProfileDigest(version.profile_document) !== version.profile_digest)
      return blocked("PROFILE_INVALID");

    let profileQuery = supabase
      .from("organization_market_profiles")
      .select("id,branch_id,current_version_id,enabled")
      .eq("organization_id", organizationId)
      .eq("id", version.market_profile_id);
    profileQuery =
      branchId === null
        ? profileQuery.is("branch_id", null)
        : profileQuery.eq("branch_id", branchId);
    const profileRead = await profileQuery.maybeSingle();
    if (profileRead.error || !profileRead.data) return blocked("PROFILE_UNAVAILABLE");
    const parsedProfile = profileSchema.safeParse(profileRead.data);
    if (!parsedProfile.success) return blocked("PROFILE_INVALID");
    if (!parsedProfile.data.enabled || parsedProfile.data.current_version_id !== versionId)
      return blocked("PROFILE_NOT_CURRENT");

    const decisionRead = await supabase
      .from("organization_market_profile_decisions")
      .select("decision,profile_digest")
      .eq("organization_id", organizationId)
      .eq("market_profile_id", version.market_profile_id)
      .eq("market_profile_version_id", versionId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (decisionRead.error) return blocked("PROFILE_UNAVAILABLE");
    const decision = decisionSchema.safeParse(decisionRead.data);
    if (
      !decision.success ||
      decision.data.decision !== "confirmed" ||
      decision.data.profile_digest !== version.profile_digest
    )
      return blocked("PROFILE_NOT_CONFIRMED");
    return {
      kind: "ready",
      profile: {
        versionId: version.id,
        digest: version.profile_digest,
        document: version.profile_document,
        enabled: true,
        sourcePolicyDigest: version.source_policy_digest,
      },
    };
  } catch {
    return blocked("PROFILE_UNAVAILABLE");
  }
}
