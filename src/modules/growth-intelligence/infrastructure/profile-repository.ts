import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { parse as parsePublicSuffix } from "tldts";
import { z } from "zod";

import {
  compareCanonicalText,
  marketProfileDocumentSchema,
  marketProfileDocumentV1Schema,
} from "@/domain/growth-intelligence/schemas";
import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import { DomainError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";
import type {
  MarketProfileDecisionOutcome,
  MarketProfileDecisionView,
  MarketProfileProposalContext,
  MarketProfileProposalOutcome,
  MarketProfileRepository,
  MarketProfileVersionView,
  MarketProfileView,
  StartBranchResearchResult,
} from "@/modules/growth-intelligence/application/ports";

type QueryResult<T> = PromiseLike<{ data: T; error: unknown }>;
type QueryBuilder<T> = QueryResult<T> & {
  select(columns: string): QueryBuilder<T>;
  eq(column: string, value: unknown): QueryBuilder<T>;
  is(column: string, value: null): QueryBuilder<T>;
  in(column: string, values: readonly unknown[]): QueryBuilder<T>;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder<T>;
  limit(count: number): QueryBuilder<T>;
  maybeSingle(): PromiseLike<{ data: T; error: unknown }>;
};

export type MarketProfilePersistence = {
  from(table: string): QueryBuilder<unknown>;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

type DatabaseClient = SupabaseClient<Database> | MarketProfilePersistence;

const proposalOutcomeSchema = z
  .object({
    profileId: z.string().uuid(),
    profileVersionId: z.string().uuid(),
    version: z.number().int().positive(),
    profileDigest: z.string().regex(/^[a-f0-9]{64}$/),
    replayed: z.boolean(),
  })
  .strict();

const decisionOutcomeSchema = z
  .object({
    decisionId: z.string().uuid(),
    profileVersionId: z.string().uuid(),
    requestId: z.string().uuid().nullable(),
    decision: z.enum(["confirmed", "rejected", "disabled"]),
    replayed: z.boolean(),
  })
  .strict();

const startBranchResearchOutcomeSchema = z
  .object({
    outcome: z.enum(["started", "existing_active", "replayed"]),
    profileVersionId: z.string().uuid(),
    pipelineId: z.string().uuid(),
    researchRequestId: z.string().uuid(),
  })
  .strict();

function query<T>(persistence: MarketProfilePersistence, table: string): QueryBuilder<T> {
  return persistence.from(table) as QueryBuilder<T>;
}

function databaseFailure(message: string, cause?: unknown): never {
  throw new DomainError("DOMAIN_ERROR", message, cause);
}

function mutationFailure(operation: "propose" | "decide" | "start", error: unknown): never {
  const message =
    typeof (error as { message?: unknown } | null)?.message === "string"
      ? (error as { message: string }).message
      : "";

  if (message.includes("market_profile_version_not_found")) {
    throw new DomainError("DOMAIN_ERROR", "This Market Profile version is no longer available.");
  }
  if (message.includes("market_profile_version_conflict")) {
    throw new GrowthIntelligenceError(
      "PROFILE_VERSION_CONFLICT",
      "The reviewed settings are no longer current. Review the latest settings and try again.",
    );
  }
  if (message.includes("market_profile_start_idempotency_conflict")) {
    throw new GrowthIntelligenceError(
      "RESEARCH_IDEMPOTENCY_CONFLICT",
      "This retry key was already used for different research settings. Start again with a new retry key.",
    );
  }
  if (message.includes("market_profile_version_not_decidable")) {
    throw new DomainError("DOMAIN_ERROR", "This Market Profile version can no longer be decided.");
  }
  if (message.includes("idempotency_conflict")) {
    throw new DomainError(
      "DOMAIN_ERROR",
      "This retry key was already used for a different Market Profile change.",
    );
  }
  if (message.includes("market_profile_branch_not_found")) {
    throw new DomainError(
      "DOMAIN_ERROR",
      "The selected branch is no longer available for research.",
    );
  }
  if (message.includes("market_profile_start_forbidden")) {
    throw new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have permission to start research for this organization.",
    );
  }
  databaseFailure(
    operation === "propose"
      ? "The Market Profile proposal could not be saved."
      : operation === "start"
        ? "The branch research could not be started."
        : "The Market Profile decision could not be saved.",
    error,
  );
}

function uniqueBoundedStrings(
  values: readonly unknown[],
  maximumItems: number,
  maximumLength: number,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > maximumLength) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length === maximumItems) break;
  }
  return result;
}

function arrayField(payload: Record<string, unknown> | undefined, key: string): unknown[] {
  const value = payload?.[key];
  return Array.isArray(value) ? value : [];
}

function publicUrls(values: readonly unknown[]): string[] {
  const urls: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    try {
      const url = new URL(value.trim());
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password)
        continue;
      // Public identity links never require query credentials or fragments. Keeping
      // them out also prevents signed storage URLs from crossing the model boundary.
      if (url.search || url.hash) continue;
      if (!isPublicHostname(url.hostname)) continue;
      urls.push(url.toString());
    } catch {
      continue;
    }
  }
  return uniqueBoundedStrings(urls, 20, 2_048).sort(compareCanonicalText);
}

function isPublicHostname(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  const parsed = parsePublicSuffix(normalized, {
    allowPrivateDomains: false,
    detectSpecialUse: true,
  });
  return (
    parsed.hostname === normalized &&
    parsed.domain !== null &&
    parsed.isIcann === true &&
    parsed.isIp === false &&
    parsed.isSpecialUse === false
  );
}

const publicServiceAreaKeys = [
  "area",
  "areas",
  "city",
  "districts",
  "name",
  "regions",
  "serviceAreas",
  "zones",
] as const;

function serviceAreaStrings(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const result: unknown[] = [];
  for (const key of publicServiceAreaKeys) {
    const member = record[key];
    if (Array.isArray(member)) result.push(...member);
    else result.push(member);
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type ProfileRow = {
  id: string;
  current_version_id: string | null;
  enabled: boolean;
  next_daily_research_due_at: string | null;
  next_weekly_synthesis_due_at: string | null;
};

type VersionRow = {
  id: string;
  market_profile_id: string;
  version: number;
  profile_document: unknown;
  profile_digest: string;
  proposal_source: "operator" | "ai" | "system";
  created_at: string;
};

type DecisionRow = {
  id: string;
  market_profile_version_id: string;
  decision: "confirmed" | "rejected" | "disabled" | "superseded";
  reason: string | null;
  created_at: string;
};

export function createAuthenticatedMarketProfileRepository(
  client: DatabaseClient,
): MarketProfileRepository {
  const persistence = client as unknown as MarketProfilePersistence;

  return {
    async read(scope): Promise<MarketProfileView> {
      const { organizationId, branchId } = scope;
      let profileQuery = query<ProfileRow>(persistence, "organization_market_profiles")
        .select(
          "id,current_version_id,enabled,next_daily_research_due_at,next_weekly_synthesis_due_at",
        )
        .eq("organization_id", organizationId);
      // Exact scope only: a set branch reads its own profile, null reads the
      // legacy organization profile. Never read by organization alone — the
      // first branch row would make maybeSingle() throw.
      profileQuery =
        branchId === null
          ? profileQuery.is("branch_id", null)
          : profileQuery.eq("branch_id", branchId);
      const profileResult = await profileQuery.maybeSingle();
      if (profileResult.error)
        databaseFailure("The Market Profile could not be loaded.", profileResult.error);
      if (!profileResult.data) return { profile: null, versions: [], decisions: [] };

      const profileId = profileResult.data.id;
      const [versionsResult, decisionsResult] = await Promise.all([
        query<VersionRow[]>(persistence, "organization_market_profile_versions")
          .select(
            "id,market_profile_id,version,profile_document,profile_digest,proposal_source,created_at",
          )
          .eq("organization_id", organizationId)
          .eq("market_profile_id", profileId)
          .order("version", { ascending: false })
          .limit(50),
        query<DecisionRow[]>(persistence, "organization_market_profile_decisions")
          .select("id,market_profile_version_id,decision,reason,created_at")
          .eq("organization_id", organizationId)
          .eq("market_profile_id", profileId)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (versionsResult.error || decisionsResult.error) {
        databaseFailure(
          "The Market Profile history could not be loaded.",
          versionsResult.error ?? decisionsResult.error,
        );
      }

      let versions: MarketProfileVersionView[];
      try {
        versions = (versionsResult.data ?? []).map((row) => ({
          id: row.id,
          profileId: row.market_profile_id,
          version: row.version,
          document: marketProfileDocumentSchema.parse(row.profile_document),
          digest: row.profile_digest,
          proposalSource: row.proposal_source,
          createdAt: row.created_at,
        }));
      } catch (error) {
        databaseFailure("The Market Profile history is not usable.", error);
      }
      const decisions: MarketProfileDecisionView[] = (decisionsResult.data ?? []).map((row) => ({
        id: row.id,
        profileVersionId: row.market_profile_version_id,
        decision: row.decision,
        reason: row.reason,
        createdAt: row.created_at,
      }));

      return {
        profile: {
          id: profileResult.data.id,
          currentVersionId: profileResult.data.current_version_id,
          enabled: profileResult.data.enabled,
          nextDailyResearchDueAt: profileResult.data.next_daily_research_due_at,
          nextWeeklySynthesisDueAt: profileResult.data.next_weekly_synthesis_due_at,
        },
        versions,
        decisions,
      };
    },

    async readProposalContext(scope): Promise<MarketProfileProposalContext> {
      const { organizationId, branchId } = scope;
      type OrganizationRow = {
        name: string;
        industry: string;
        country_code: string;
        default_timezone: string;
      };
      type BusinessProfileRow = {
        business_model: string | null;
        value_proposition: string | null;
      };
      type BranchRow = {
        id: string;
        name: string;
        timezone: string;
        service_area: unknown;
      };
      type SectionRow = { section_key: string; payload: unknown };

      let branchesQuery = query<BranchRow[]>(persistence, "branches")
        .select("id,name,timezone,service_area")
        .eq("organization_id", organizationId)
        .eq("is_active", true);
      // A branch scope reads that branch only. The shared onboarding locality
      // is never copied into a branch: each branch researches its own
      // confirmed service area.
      if (branchId !== null) branchesQuery = branchesQuery.eq("id", branchId);

      const [organizationResult, businessProfileResult, branchesResult, sectionsResult] =
        await Promise.all([
          query<OrganizationRow>(persistence, "organizations")
            .select("name,industry,country_code,default_timezone")
            .eq("id", organizationId)
            .maybeSingle(),
          query<BusinessProfileRow>(persistence, "business_profiles")
            .select("business_model,value_proposition")
            .eq("organization_id", organizationId)
            .maybeSingle(),
          branchesQuery.order("created_at", { ascending: true }),
          query<SectionRow[]>(persistence, "onboarding_section_states")
            .select("section_key,payload")
            .eq("organization_id", organizationId)
            .eq("status", "complete")
            .in("section_key", [
              "business_identity",
              "branches_operations",
              "products_services",
              "channels_presence",
            ]),
        ]);

      const failure = [
        organizationResult,
        businessProfileResult,
        branchesResult,
        sectionsResult,
      ].find((result) => result.error);
      if (failure?.error)
        databaseFailure("Confirmed business context could not be loaded.", failure.error);
      const organization = organizationResult.data;
      if (!organization) databaseFailure("Confirmed business context is not available.");
      if (branchId !== null && (branchesResult.data ?? []).length === 0) {
        throw new DomainError(
          "DOMAIN_ERROR",
          "The selected branch is no longer available for research.",
        );
      }

      const sections = new Map(
        (sectionsResult.data ?? []).map((section) => [
          section.section_key,
          asRecord(section.payload),
        ]),
      );
      const products = sections.get("products_services");
      const presence = sections.get("channels_presence");
      const operations = sections.get("branches_operations");
      const sharedServiceAreas = arrayField(operations, "serviceArea");

      const nicheDescriptors = uniqueBoundedStrings(
        [
          organization.industry,
          businessProfileResult.data?.business_model,
          businessProfileResult.data?.value_proposition,
        ],
        12,
        120,
      );
      const topics = uniqueBoundedStrings(
        [...arrayField(products, "items"), ...arrayField(products, "categories")],
        30,
        160,
      );
      const locations = (branchesResult.data ?? []).slice(0, 50).map((branch) => ({
        branchId: branch.id,
        name: branch.name.slice(0, 160),
        serviceAreas: uniqueBoundedStrings(
          branchId === null
            ? [...serviceAreaStrings(branch.service_area), ...sharedServiceAreas]
            : serviceAreaStrings(branch.service_area),
          30,
          160,
        ),
        countryCode: organization.country_code.toUpperCase(),
        timeZone: branch.timezone || organization.default_timezone,
      }));

      return {
        publicIdentity: {
          approvedName: organization.name.slice(0, 200),
          publicUrls: publicUrls(arrayField(presence, "profiles")),
        },
        market: {
          countryCode: organization.country_code.toUpperCase(),
          timeZone: organization.default_timezone,
        },
        nicheDescriptors,
        locations,
        topics,
      };
    },

    async propose(input): Promise<MarketProfileProposalOutcome> {
      const result = await persistence.rpc("propose_market_profile_version", {
        p_organization_id: input.organizationId,
        p_actor_id: input.actorId,
        p_profile_document: input.document,
        p_profile_digest: input.profileDigest,
        p_proposal_context: input.proposalContext,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: input.correlationId,
      });
      if (result.error) mutationFailure("propose", result.error);
      const parsed = proposalOutcomeSchema.safeParse(result.data);
      if (!parsed.success) databaseFailure("The saved Market Profile proposal was not usable.");
      return { ...parsed.data, isRevision: parsed.data.version > 1 };
    },

    async findProposalReplay(input): Promise<MarketProfileProposalOutcome | null> {
      const result = await persistence.rpc("find_market_profile_proposal_replay", {
        p_organization_id: input.organizationId,
        p_actor_id: input.actorId,
        p_proposal_context: input.proposalContext,
        p_idempotency_key: input.idempotencyKey,
      });
      if (result.error) mutationFailure("propose", result.error);
      if (result.data === null) return null;
      const parsed = proposalOutcomeSchema.safeParse(result.data);
      if (!parsed.success) databaseFailure("The replayed Market Profile proposal was not usable.");
      return { ...parsed.data, isRevision: parsed.data.version > 1 };
    },

    async decide(input): Promise<MarketProfileDecisionOutcome> {
      const result = await persistence.rpc("decide_market_profile_version", {
        p_organization_id: input.organizationId,
        p_actor_id: input.actorId,
        p_market_profile_version_id: input.profileVersionId,
        p_profile_digest: input.profileDigest,
        p_decision: input.decision,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: input.correlationId,
      });
      if (result.error) mutationFailure("decide", result.error);
      const parsed = decisionOutcomeSchema.safeParse(result.data);
      if (!parsed.success) databaseFailure("The saved Market Profile decision was not usable.");
      return parsed.data;
    },

    async startBranchResearch(input): Promise<StartBranchResearchResult> {
      const result = await persistence.rpc("start_branch_market_research", {
        p_organization_id: input.organizationId,
        p_actor_id: input.actorId,
        p_branch_id: input.branchId,
        p_profile_document: input.document,
        p_profile_digest: input.profileDigest,
        p_expected_current_version_id: input.expectedCurrentVersionId,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: input.correlationId,
      });
      if (result.error) mutationFailure("start", result.error);
      const parsed = startBranchResearchOutcomeSchema.safeParse(result.data);
      if (!parsed.success) databaseFailure("The started branch research was not usable.");
      return parsed.data;
    },
  };
}
