import { createHash } from "node:crypto";

import type { EventPublisher } from "@/domain/events/types";
import { createGrowthIntelligenceItemIdentity } from "@/domain/growth-intelligence/items";
import { classifyItemLineage } from "@/domain/growth-intelligence/lineage";
import {
  validateSynthesisCandidate,
  type EligibleSynthesisClaim,
  type SynthesisCandidate,
} from "@/domain/growth-intelligence/synthesis";
import type {
  MarketEvidenceFreshness,
  MarketEvidenceSupportGrade,
} from "@/domain/growth-intelligence/types";
import { DomainError } from "@/lib/errors";
import type {
  SynthesisItemPayload,
  SynthesisRepository,
} from "@/modules/growth-intelligence/infrastructure/synthesis-repository";
import type {
  CompactSynthesisInput,
  SynthesisOutputParse,
  SynthesisProvider,
  SynthesisProviderCandidate,
} from "@/modules/growth-intelligence/infrastructure/synthesis-provider";

/**
 * Governed synthesis service.
 *
 * Current-state reads arrive through injected loaders (business findings,
 * eligible market claims, approved goals, current items); the Trigger wiring
 * supplies the database-backed implementations. The service builds the compact
 * provider input, allows one bounded repair attempt, validates every candidate
 * with the Task 12 deterministic validator, derives every verdict the model
 * may not choose (support grade, freshness, urgency, goal alignment), and
 * persists through the fenced Task 13 repository. Events publish only from
 * committed outcomes.
 */

export type SynthesisBusinessFinding = {
  id: string;
  digest: string;
  code: string;
  severity: "critical" | "high" | "medium" | "low";
  headline: string;
  limitations: string[];
};

export type SynthesisMarketClaim = {
  id: string;
  digest: string;
  paraphrase: string;
  quotation: string | null;
  geographicLayer: "trade_area" | "city" | "country";
  geographyRef: string;
  supportGrade: "primary" | "corroborated" | "single_source" | "contextual";
  freshness: "current" | "stale";
  limitations: string[];
};

export type SynthesisApprovedGoal = { ref: string };

export type SynthesisProfileContext = {
  approvedName: string;
  niches: string[];
  geographies: Array<{ layer: "trade_area" | "city" | "country"; ref: string; name: string }>;
  topics: string[];
};

export type ExistingSynthesisItem = {
  id: string;
  kind: "insight" | "recommendation" | "data_gap";
  geographicLayer: "trade_area" | "city" | "country";
  geographyRef: string;
  itemFingerprint: string;
  evidenceFingerprint: string;
};

export type SynthesisServiceDependencies = {
  findings: {
    load(input: {
      organizationId: string;
      channelId: string | null;
    }): Promise<{ findings: SynthesisBusinessFinding[]; fresh: boolean }>;
  };
  claims: {
    load(input: {
      organizationId: string;
      profileVersionId: string;
    }): Promise<SynthesisMarketClaim[]>;
  };
  goals: {
    load(input: { organizationId: string }): Promise<SynthesisApprovedGoal[]>;
  };
  existingItems: {
    load(input: { organizationId: string }): Promise<ExistingSynthesisItem[]>;
  };
  provider: SynthesisProvider;
  synthesisVersion: string;
  buildCompactInput: (raw: unknown) => CompactSynthesisInput;
  parseOutput: (raw: unknown) => SynthesisOutputParse;
  synthesis: SynthesisRepository;
  events: EventPublisher;
  now?: () => Date;
  signal?: AbortSignal;
};

export type SynthesizeInput = {
  organizationId: string;
  requestId: string;
  claimToken: string;
  channelId: string | null;
  profileVersionId: string;
  profile: SynthesisProfileContext;
  preferences?: { pinnedRefs: string[] };
  correlationId: string;
};

export type SynthesisServiceResult =
  | {
      outcome: "completed";
      runId: string;
      itemCount: number;
      createdFingerprints: string[];
      supersededItemIds: string[];
    }
  | { outcome: "failed"; code: string; runId: string }
  | { outcome: "replayed"; runId: string };

const SAFE_FAILURE_CODES = {
  MODEL_UNAVAILABLE: "SYNTHESIS_MODEL_UNAVAILABLE",
  CANDIDATE_INVALID: "SYNTHESIS_CANDIDATE_INVALID",
  NO_VALID_CANDIDATE: "SYNTHESIS_NO_VALID_CANDIDATE",
  CANCELLED: "WORKER_CANCELLED",
} as const;

const SUPPORT_RANK: Record<MarketEvidenceSupportGrade, number> = {
  primary: 3,
  corroborated: 2,
  single_source: 1,
  contextual: 0,
  conflicted: -1,
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function activityMonthFor(now: Date): string {
  return now.toISOString().slice(0, 7);
}

function eligibleContext(
  claims: SynthesisMarketClaim[],
): Array<EligibleSynthesisClaim & { digest: string }> {
  return claims.map((claim) => ({
    id: claim.id,
    digest: claim.digest,
    supportGrade: claim.supportGrade,
    freshness: claim.freshness as MarketEvidenceFreshness,
    excluded: false,
    geographicLayer: claim.geographicLayer,
    geographyRef: claim.geographyRef,
  }));
}

function deriveSupportGrade(cited: SynthesisMarketClaim[]): MarketEvidenceSupportGrade {
  if (cited.length === 0) return "contextual";
  let worst: MarketEvidenceSupportGrade = "primary";
  for (const claim of cited) {
    if (SUPPORT_RANK[claim.supportGrade] < SUPPORT_RANK[worst]) worst = claim.supportGrade;
  }
  return worst;
}

function deriveFreshness(
  candidate: SynthesisProviderCandidate,
  cited: SynthesisMarketClaim[],
  businessFresh: boolean,
): MarketEvidenceFreshness {
  if (candidate.staleBusinessEvidence || !businessFresh) return "stale";
  if (cited.some((claim) => claim.freshness === "stale")) return "stale";
  return "current";
}

function deriveUrgency(
  candidate: SynthesisProviderCandidate,
  citedFindings: SynthesisBusinessFinding[],
): "high" | "medium" | "low" {
  if (
    citedFindings.some((finding) => finding.severity === "critical" || finding.severity === "high")
  ) {
    return "high";
  }
  if (
    candidate.kind === "data_gap" ||
    citedFindings.some((finding) => finding.severity === "medium")
  ) {
    return "medium";
  }
  return "low";
}

function matchGoals(
  narrative: string,
  goals: SynthesisApprovedGoal[],
): Array<{ ref: string; alignment: "direct" | "indirect" | "none" }> {
  const lowered = narrative.toLowerCase();
  return goals
    .filter((goal) => lowered.includes(goal.ref.toLowerCase()))
    .slice(0, 50)
    .map((goal) => ({ ref: goal.ref, alignment: "indirect" as const }));
}

export function createSynthesisService(dependencies: SynthesisServiceDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const provider = dependencies.provider;

  async function publish(input: {
    organizationId: string;
    correlationId: string;
    eventName: string;
    payload: Record<string, unknown>;
  }) {
    await dependencies.events.publish({
      eventId: crypto.randomUUID(),
      eventName: input.eventName,
      occurredAt: now().toISOString(),
      organizationId: input.organizationId,
      actorType: "system",
      correlationId: input.correlationId,
      schemaVersion: 1,
      payload: input.payload,
    });
  }

  return {
    async synthesize(input: SynthesizeInput): Promise<SynthesisServiceResult> {
      const [{ findings, fresh: businessFresh }, marketClaims, approvedGoals, existing] =
        await Promise.all([
          dependencies.findings.load({
            organizationId: input.organizationId,
            channelId: input.channelId,
          }),
          dependencies.claims.load({
            organizationId: input.organizationId,
            profileVersionId: input.profileVersionId,
          }),
          dependencies.goals.load({ organizationId: input.organizationId }),
          dependencies.existingItems.load({ organizationId: input.organizationId }),
        ]);

      const eligible = eligibleContext(marketClaims);
      const runFingerprint = sha256(
        canonicalize({
          requestId: input.requestId,
          claimToken: input.claimToken,
          profileVersionId: input.profileVersionId,
          findingDigests: findings.map((finding) => finding.digest).sort(),
          claimDigests: marketClaims.map((claim) => claim.digest).sort(),
          synthesisVersion: dependencies.synthesisVersion,
        }),
      );

      const begun = await dependencies.synthesis.begin({
        organizationId: input.organizationId,
        requestId: input.requestId,
        claimToken: input.claimToken,
        metadata: {
          provider: provider.modelProvider,
          modelVersion: provider.modelVersion,
          runFingerprint,
          correlationId: input.correlationId,
        },
      });
      if (begun.replayed) return { outcome: "replayed", runId: begun.runId };
      const runId = begun.runId;

      const failRun = async (code: string): Promise<SynthesisServiceResult> => {
        await dependencies.synthesis.fail({
          organizationId: input.organizationId,
          requestId: input.requestId,
          claimToken: input.claimToken,
          runId,
          failure: { safeFailureCode: code },
        });
        return { outcome: "failed", code, runId };
      };

      if (dependencies.signal?.aborted) return failRun(SAFE_FAILURE_CODES.CANCELLED);

      // The compact provider input is rebuilt from allowlisted loader fields
      // only: loader extras (metric values, report rows, signed URLs) have no
      // path through `toCompactSynthesisInput`'s strict schema.
      let compact: CompactSynthesisInput;
      try {
        compact = dependencies.buildCompactInput({
          findings: findings.map((finding) => ({
            id: finding.id,
            digest: finding.digest,
            code: finding.code,
            severity: finding.severity,
            headline: finding.headline,
            limitations: finding.limitations,
          })),
          claims: marketClaims.map((claim) => ({
            id: claim.id,
            digest: claim.digest,
            paraphrase: claim.paraphrase,
            quotation: claim.quotation,
            geographicLayer: claim.geographicLayer,
            geographyRef: claim.geographyRef,
            supportGrade: claim.supportGrade,
            freshness: claim.freshness,
            limitations: claim.limitations,
          })),
          goals: approvedGoals.map((goal) => ({ ref: goal.ref })),
          profile: input.profile,
          preferences: input.preferences ?? { pinnedRefs: [] },
          activityMonth: activityMonthFor(now()),
          businessEvidenceFresh: businessFresh,
        });
      } catch {
        return failRun(SAFE_FAILURE_CODES.CANDIDATE_INVALID);
      }

      let repairIssues: string[] | null = null;
      let accepted: SynthesisProviderCandidate[] | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let raw: unknown;
        try {
          raw = await provider.generate({
            context: compact,
            repairIssues,
            correlationId: input.correlationId,
          });
        } catch (error) {
          if (error instanceof DomainError) return failRun(SAFE_FAILURE_CODES.MODEL_UNAVAILABLE);
          throw error;
        }
        if (dependencies.signal?.aborted) return failRun(SAFE_FAILURE_CODES.CANCELLED);
        const parsed = dependencies.parseOutput(raw);
        if (parsed.outcome === "invalid") {
          repairIssues = parsed.issues;
          continue;
        }
        const validationIssues: string[] = [];
        const valid: SynthesisProviderCandidate[] = [];
        for (const candidate of parsed.candidates) {
          const verdict = validateSynthesisCandidate(candidate as SynthesisCandidate, {
            eligibleClaims: eligible,
            businessEvidenceFresh: businessFresh,
          });
          if (verdict.outcome === "valid") valid.push(candidate);
          else validationIssues.push(verdict.reasonCode);
        }
        if (valid.length > 0) {
          accepted = valid;
          break;
        }
        repairIssues = [...new Set(validationIssues)].slice(0, 12);
        if (repairIssues.length === 0) repairIssues = ["NO_VALID_CANDIDATE"];
      }
      if (!accepted) return failRun(SAFE_FAILURE_CODES.CANDIDATE_INVALID);

      const claimsById = new Map(marketClaims.map((claim) => [claim.id, claim]));
      const findingsById = new Map(findings.map((finding) => [finding.id, finding]));
      const activityMonth = activityMonthFor(now());
      const items: Array<{
        payload: SynthesisItemPayload;
        identity: { itemFingerprint: string; evidenceFingerprint: string };
        kind: ExistingSynthesisItem["kind"];
      }> = [];

      for (const candidate of accepted) {
        const citedClaims = candidate.claimIds.map((id) => claimsById.get(id));
        const citedFindings = candidate.businessFindingIds.map((id) => findingsById.get(id));
        if (citedClaims.some((claim) => !claim) || citedFindings.some((finding) => !finding)) {
          return failRun(SAFE_FAILURE_CODES.CANDIDATE_INVALID);
        }
        const resolvedClaims = citedClaims as SynthesisMarketClaim[];
        const resolvedFindings = citedFindings as SynthesisBusinessFinding[];
        const identity = createGrowthIntelligenceItemIdentity({
          kind: candidate.kind,
          narrative: candidate.narrative,
          claimDigests: resolvedClaims.map((claim) => claim.digest),
          businessFindingDigests: resolvedFindings.map((finding) => finding.digest),
          geographicLayer: candidate.geographicLayer,
          geographyRef: candidate.geographyRef,
          limitationCodes: candidate.limitations,
          synthesisVersion: dependencies.synthesisVersion,
        });
        const goals = matchGoals(candidate.narrative, approvedGoals);
        items.push({
          payload: {
            kind: candidate.kind,
            narrative: candidate.narrative,
            itemFingerprint: identity.itemFingerprint,
            evidenceFingerprint: identity.evidenceFingerprint,
            geographicLayer: candidate.geographicLayer,
            geographyRef: candidate.geographyRef,
            supportGrade: deriveSupportGrade(resolvedClaims),
            freshness: deriveFreshness(candidate, resolvedClaims, businessFresh),
            urgency: deriveUrgency(candidate, resolvedFindings),
            goalAlignment: goals.length > 0 ? "indirect" : "none",
            activityMonth,
            missingInput: candidate.missingInput,
            claimIds: candidate.claimIds,
            findings: resolvedFindings.map((finding) => ({
              id: finding.id,
              digest: finding.digest,
            })),
            goals,
          },
          identity,
          kind: candidate.kind,
        });
      }

      // Lineage suppression: byte-identical repeats and narration-only
      // rewrites over identical evidence stay duplicates and are not
      // re-persisted; the fenced RPC would no-op them anyway.
      const material = items.filter((item) =>
        existing.every(
          (previous) => classifyItemLineage(previous, item.identity) === "material_change",
        ),
      );
      if (material.length === 0) {
        const completed = await dependencies.synthesis.complete({
          organizationId: input.organizationId,
          requestId: input.requestId,
          claimToken: input.claimToken,
          runId,
          result: {
            outcome: "completed",
            resultDigest: sha256(canonicalize({ runFingerprint, items: [] })),
            items: [],
          },
        });
        await publish({
          organizationId: input.organizationId,
          correlationId: input.correlationId,
          eventName: "growth_intelligence.synthesized",
          payload: { requestId: input.requestId, runId, itemCount: completed.itemCount },
        });
        return {
          outcome: "completed",
          runId,
          itemCount: completed.itemCount,
          createdFingerprints: [],
          supersededItemIds: [],
        };
      }

      const completed = await dependencies.synthesis.complete({
        organizationId: input.organizationId,
        requestId: input.requestId,
        claimToken: input.claimToken,
        runId,
        result: {
          outcome: "completed",
          resultDigest: sha256(
            canonicalize({
              runFingerprint,
              items: material.map((item) => item.identity.itemFingerprint).sort(),
            }),
          ),
          items: material.map((item) => item.payload),
        },
      });

      await publish({
        organizationId: input.organizationId,
        correlationId: input.correlationId,
        eventName: "growth_intelligence.synthesized",
        payload: { requestId: input.requestId, runId, itemCount: completed.itemCount },
      });
      const createdFingerprints = material.map((item) => item.identity.itemFingerprint);
      for (const item of material) {
        await publish({
          organizationId: input.organizationId,
          correlationId: input.correlationId,
          eventName: "growth_intelligence.item_created",
          payload: {
            requestId: input.requestId,
            runId,
            itemFingerprint: item.identity.itemFingerprint,
            kind: item.kind,
          },
        });
      }
      // Committed-outcome supersession (Ruling R-A): the complete RPC flips
      // prior same-kind+geography rows to superseded and returns their ids.
      // Events publish once per committed id only — never from local lineage
      // classification, which still decides created-vs-duplicate above.
      const supersededItemIds = completed.supersededItemIds;
      for (const supersededItemId of supersededItemIds) {
        await publish({
          organizationId: input.organizationId,
          correlationId: input.correlationId,
          eventName: "growth_intelligence.item_superseded",
          payload: {
            requestId: input.requestId,
            runId,
            supersededItemId,
          },
        });
      }

      return {
        outcome: "completed",
        runId,
        itemCount: completed.itemCount,
        createdFingerprints,
        supersededItemIds,
      };
    },
  };
}

export type SynthesisService = ReturnType<typeof createSynthesisService>;
