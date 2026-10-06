import { z } from "zod";

import type { BriefRevision } from "@/domain/growth-intelligence/brief";
import {
  BRIEF_INVESTIGATION_AREAS,
  type BriefInvestigationArea,
} from "@/domain/growth-intelligence/brief";
import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import { RESEARCH_BUDGET_LIMITS } from "@/domain/growth-intelligence/research-pipeline";
import { DomainError } from "@/lib/errors";
import {
  assertExternalRequestHasOnlyPublicBytes,
  buildResearchBrief,
  type ResearchBriefSlot,
} from "@/modules/growth-intelligence/application/research-brief";

/**
 * Scoped context assembly for Market Monitoring model phases (G23/G24).
 *
 * The research brief builder and the synthesis context builder below carry
 * business context by reference only: snapshot id, content digest and short
 * ref strings. Raw customer payloads never enter these structures, and the
 * Trigger factories decide when each builder runs (see
 * `src/trigger/growth-intelligence.ts`).
 *
 * Snapshot storage does not exist yet, so the production loader resolves to
 * no snapshot: research runs evidence-only and the synthesis builder stays
 * unwired until snapshot infrastructure lands. Tests inject fixture loaders.
 */

export const monitoringSnapshotSchema = z
  .object({
    snapshotId: z.string().uuid(),
    organizationId: z.string().uuid(),
    branchId: z.string().uuid().nullable(),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    status: z.enum(["ready", "empty", "partial", "unavailable", "disabled"]),
    refs: z.array(z.string().trim().min(1).max(60)).max(24),
    degradedReasons: z
      .array(z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/))
      .max(12),
  })
  .strict();

export type MonitoringSnapshot = z.infer<typeof monitoringSnapshotSchema>;

export type MonitoringSnapshotLoader = (input: {
  organizationId: string;
  branchId: string | null;
}) => Promise<MonitoringSnapshot | null>;

/**
 * Tenant fence for assembled context. An organization-wide snapshot (null
 * branch) serves legacy organization requests only; a branch snapshot serves
 * its own branch only. Anything else is refused before any model input is
 * built.
 */
export function assertMonitoringSnapshotScope(
  snapshot: MonitoringSnapshot,
  scope: { organizationId: string; branchId: string | null },
): void {
  const parsed = monitoringSnapshotSchema.parse(snapshot);
  if (parsed.organizationId !== scope.organizationId) {
    throw new GrowthIntelligenceError(
      "RESEARCH_TENANT_MISMATCH",
      "This business context belongs to another organization.",
    );
  }
  if (parsed.branchId !== scope.branchId) {
    throw new GrowthIntelligenceError(
      "RESEARCH_CONTEXT_MISMATCH",
      "This business context belongs to another location.",
    );
  }
}

export type MonitoringProfileScope = {
  profileVersionId: string;
  sourcePolicyDigest: string;
  scope: {
    publicBusinessName: string;
    approvedDomains: string[];
    niches: string[];
    city: string;
    countryCode: string;
    topics: string[];
    competitors: Array<{ name: string; publicUrl?: string; locationHint?: string }>;
  };
};

export type MonitoringProfileReader = (input: {
  organizationId: string;
  branchId: string | null;
}) => Promise<MonitoringProfileScope | null>;

export type MonitoringResearchBrief = {
  manifestId: string | null;
  contextDigest: string | null;
  status: "ready" | "empty" | "partial" | "unavailable" | "disabled";
  contextRefs: readonly string[];
  evidenceOnly: boolean;
  briefFingerprint: string;
};

/**
 * Research brief builder for the research dependency factory.
 *
 * The builder re-reads the approved profile under the request's exact branch
 * scope, derives the full-coverage slot plan from approved public fields, and
 * attaches the business snapshot by reference. Without provider qualification
 * the brief stays evidence-only: extraction receives no refs. Callers prove
 * byte-absence of private material with
 * `assertExternalRequestHasOnlyPublicBytes` against the built queries.
 */
export function createMonitoringResearchBriefBuilder(input: {
  readProfile: MonitoringProfileReader;
  loadSnapshot: MonitoringSnapshotLoader;
  qualified: boolean;
  /**
   * Full-coverage slot planner over the approved scope, injected from the
   * composition root: application code never imports the infrastructure
   * query planner directly.
   */
  planSlots: (scope: MonitoringProfileScope["scope"]) => ResearchBriefSlot[];
}): (request: {
  organizationId: string;
  requestId: string;
  branchId: string | null;
  profileVersionId: string;
  sourcePolicyDigest: string;
  attemptKey: string;
  correlationId: string;
}) => Promise<MonitoringResearchBrief> {
  return async (request) => {
    const profile = await input.readProfile({
      organizationId: request.organizationId,
      branchId: request.branchId,
    });
    if (!profile) {
      throw new GrowthIntelligenceError(
        "RESEARCH_CONTEXT_MISMATCH",
        "The approved research scope is no longer available.",
      );
    }
    if (
      profile.profileVersionId !== request.profileVersionId ||
      profile.sourcePolicyDigest !== request.sourcePolicyDigest
    ) {
      throw new GrowthIntelligenceError(
        "RESEARCH_CONTEXT_MISMATCH",
        "The approved research scope changed under this request.",
      );
    }
    const snapshot = await input.loadSnapshot({
      organizationId: request.organizationId,
      branchId: request.branchId,
    });
    if (snapshot) {
      assertMonitoringSnapshotScope(snapshot, {
        organizationId: request.organizationId,
        branchId: request.branchId,
      });
    }
    const slots = input.planSlots({
      ...profile.scope,
      competitors: profile.scope.competitors.map((competitor) => ({
        name: competitor.name,
        ...(competitor.publicUrl ? { publicUrl: competitor.publicUrl } : {}),
        ...(competitor.locationHint ? { locationHint: competitor.locationHint } : {}),
      })),
    });
    const brief = buildResearchBrief({
      organizationId: request.organizationId,
      requestId: request.requestId,
      branchId: request.branchId,
      profileVersionId: profile.profileVersionId,
      sourcePolicyDigest: profile.sourcePolicyDigest,
      attemptKey: request.attemptKey,
      correlationId: request.correlationId,
      slots,
      manifest: snapshot
        ? {
            manifestId: snapshot.snapshotId,
            contextDigest: snapshot.digest,
            status: snapshot.status,
            contextRefs: [...snapshot.refs],
            degradedReasons: [...snapshot.degradedReasons],
          }
        : null,
      qualified: input.qualified,
    });
    return {
      manifestId: brief.manifestId,
      contextDigest: brief.contextDigest,
      status: brief.status,
      contextRefs: [...brief.contextRefs],
      evidenceOnly: brief.evidenceOnly,
      briefFingerprint: brief.briefFingerprint,
    };
  };
}

export type MonitoringSynthesisPack = {
  manifestId: string;
  contextDigest: string;
  status: "ready" | "empty" | "partial" | "unavailable" | "disabled";
  contextRefs: readonly string[];
  parentBriefManifestId: string | null;
};

/**
 * Pure synthesis pack assembly. A missing snapshot yields no pack (null):
 * the synthesis context schema has no null representation for manifest and
 * digest, so inventing either would fabricate lineage. The factory only wires
 * the throwing builder below when snapshot loading is configured; otherwise
 * synthesis keeps its legacy pack-less behavior.
 */
export function buildMonitoringSynthesisPack(input: {
  snapshot: MonitoringSnapshot | null;
  scope: { organizationId: string; branchId: string | null };
  parentBriefManifestId: string | null;
}): MonitoringSynthesisPack | null {
  if (!input.snapshot) return null;
  assertMonitoringSnapshotScope(input.snapshot, input.scope);
  const snapshot = monitoringSnapshotSchema.parse(input.snapshot);
  return {
    manifestId: snapshot.snapshotId,
    contextDigest: snapshot.digest,
    status: snapshot.status,
    contextRefs: [...snapshot.refs],
    parentBriefManifestId: input.parentBriefManifestId,
  };
}

/**
 * Synthesis context builder for the synthesis dependency factory.
 * Configured-but-missing context fails closed with a safe code (the runner
 * maps it to SYNTHESIS_CONTEXT_UNAVAILABLE) instead of running the final
 * strategist blind.
 */
export function createMonitoringSynthesisContextBuilder(input: {
  loadSnapshot: MonitoringSnapshotLoader;
}): (request: {
  organizationId: string;
  requestId: string;
  branchId: string | null;
  channelId: string | null;
  parentBriefManifestId: string | null;
  correlationId: string;
}) => Promise<MonitoringSynthesisPack> {
  return async (request) => {
    const snapshot = await input.loadSnapshot({
      organizationId: request.organizationId,
      branchId: request.branchId,
    });
    const pack = buildMonitoringSynthesisPack({
      snapshot,
      scope: { organizationId: request.organizationId, branchId: request.branchId },
      parentBriefManifestId: request.parentBriefManifestId,
    });
    if (!pack) {
      throw new DomainError(
        "DOMAIN_ERROR",
        "Business context is not available for this location.",
      );
    }
    return pack;
  };
}

export type MonitoringResearchQueryKind = "investigation_area" | "competitor";

export type MonitoringResearchQuery = {
  slotKey: string;
  kind: MonitoringResearchQueryKind;
  text: string;
  maxResults: number;
};

export function monitoringAreaSlotKey(area: BriefInvestigationArea): string {
  return `area:${area}`;
}

function slotKeySegment(value: string): string {
  const segment = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[^\p{L}\p{N}\s&'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
  return segment.length > 0 ? segment : "input";
}

export function monitoringCompetitorSlotKey(name: string): string {
  return `competitor:${slotKeySegment(name)}`;
}

function safePhrase(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\b(?:ignore|disregard|forget|override)\b[\s\S]{0,80}\b(?:instruction|instructions|previous|system)\b/gi, " ")
    .replace(/\b(?:site|inurl|filetype|cache|related|link)\s*:/gi, " ")
    .replace(/[^\p{L}\p{N}\s&'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function quote(value: string): string {
  return `"${safePhrase(value).replace(/"/g, "")}"`;
}

/**
 * Longest query text the monitoring researcher accepts. The executor schema
 * reuses this same symbol, so the plan below can never emit a text the
 * researcher refuses: bounding each component is not enough, because the
 * joined competitor text (name + area + hint) can still exceed the cap.
 */
export const MONITORING_RESEARCH_QUERY_TEXT_MAX_LENGTH = 160;

function boundedQueryText(parts: readonly string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .join(" ")
    .slice(0, MONITORING_RESEARCH_QUERY_TEXT_MAX_LENGTH);
}

/**
 * Project-scope query plan from the pinned brief revision.
 *
 * Queries are a deterministic function of approved public brief fields only
 * (research area, investigation-area labels, competitor names with their
 * public location hints). The research question guides report composition,
 * not retrieval, and the business-context snapshot never enters this
 * function: absence of private bytes is structural, and the canary test
 * proves it.
 */
export function buildMonitoringQueryPlan(brief: BriefRevision): MonitoringResearchQuery[] {
  const areas = z.array(z.enum(BRIEF_INVESTIGATION_AREAS)).min(1).max(5).parse(brief.investigationAreas);
  const areaLabels: Record<BriefInvestigationArea, string> = {
    demand: "demand",
    presence: "presence",
    offers: "offers",
    reviews: "reviews",
    observable_performance: "observable performance",
  };
  const queries: MonitoringResearchQuery[] = areas.map((area) => ({
    slotKey: monitoringAreaSlotKey(area),
    kind: "investigation_area",
    text: boundedQueryText([quote(brief.researchArea), quote(areaLabels[area])]),
    maxResults: RESEARCH_BUDGET_LIMITS.maxResultsPerQuery,
  }));
  for (const competitor of brief.competitors) {
    const hint = competitor.locationHint ? safePhrase(competitor.locationHint) : "";
    queries.push({
      slotKey: monitoringCompetitorSlotKey(competitor.name),
      kind: "competitor",
      text: boundedQueryText([quote(competitor.name), quote(brief.researchArea), hint]),
      maxResults: RESEARCH_BUDGET_LIMITS.maxResultsPerQuery,
    });
  }
  if (queries.length > RESEARCH_BUDGET_LIMITS.maxPrimarySearches) {
    throw new DomainError(
      "DOMAIN_ERROR",
      "The monitoring query plan exceeds the primary search ceiling.",
    );
  }
  const keys = queries.map((query) => query.slotKey);
  if (new Set(keys).size !== keys.length) {
    throw new DomainError("DOMAIN_ERROR", "The monitoring query plan must key every slot uniquely.");
  }
  return queries;
}

export { assertExternalRequestHasOnlyPublicBytes };
