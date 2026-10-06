import { createHash } from "node:crypto";

import {
  marketProfileDocumentV1Schema,
  marketProfileDocumentV2Schema,
} from "@/domain/growth-intelligence/schemas";
import { createMarketProfileDigest } from "@/domain/growth-intelligence/profile-digest";
import type {
  MarketProfileDocumentV1,
  MarketProfileDocumentV2,
} from "@/domain/growth-intelligence/types";
import { DomainError } from "@/lib/errors";
import type {
  MarketProfileProposalContext,
  MarketProfileScope,
  MarketProfileServiceDependencies,
  StartBranchResearchInput,
} from "@/modules/growth-intelligence/application/ports";

type ProposeInput = {
  organizationId: string;
  actorId: string;
  idempotencyKey: string;
  correlationId: string;
} & (
  | { source: "ai" }
  | {
      source: "operator";
      document: MarketProfileDocumentV1;
    }
);

type DecideInput = {
  organizationId: string;
  actorId: string;
  profileVersionId: string;
  profileDigest: string;
  decision: "confirmed" | "rejected" | "disabled";
  reason: string | null;
  idempotencyKey: string;
  correlationId: string;
};

function digestProposalContext(context: MarketProfileProposalContext): string {
  return createHash("sha256").update(JSON.stringify(context), "utf8").digest("hex");
}

function safeValidationIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues
    .slice(0, 12)
    .map((issue) => `${issue.path.map(String).join(".") || "profile"}: ${issue.message}`)
    .map((issue) => issue.slice(0, 240));
}

function candidateScopeIssues(
  document: MarketProfileDocumentV1,
  context: MarketProfileProposalContext,
): string[] {
  const issues: string[] = [];
  const approvedUrls = new Set(context.publicIdentity.publicUrls);
  const approvedDomains = new Set(
    context.publicIdentity.publicUrls.map((value) => new URL(value).hostname.toLowerCase()),
  );
  const branchIds = new Set(
    context.locations.flatMap((location) => (location.branchId ? [location.branchId] : [])),
  );
  const timeZones = new Set([
    context.market.timeZone,
    ...context.locations.map((location) => location.timeZone),
  ]);

  if (document.publicIdentity.approvedName !== context.publicIdentity.approvedName) {
    issues.push("publicIdentity.approvedName: The approved name must be copied exactly.");
  }
  if (document.publicIdentity.publicUrls.some((value) => !approvedUrls.has(value))) {
    issues.push("publicIdentity.publicUrls: Public URLs must come from confirmed context.");
  }
  if (document.publicIdentity.domains.some((value) => !approvedDomains.has(value))) {
    issues.push("publicIdentity.domains: Domains must be derived from confirmed public URLs.");
  }
  if (document.competitors.length > 0) {
    issues.push(
      "competitors: Competitors require bounded public discovery evidence and cannot be invented by the model.",
    );
  }
  if (
    document.geographies.some(
      (geography) => geography.layer === "trade_area" && !branchIds.has(geography.branchId),
    )
  ) {
    issues.push("geographies: Trade areas must use a confirmed branch identifier.");
  }
  if (
    document.geographies.some(
      (geography) =>
        geography.layer !== "trade_area" && geography.countryCode !== context.market.countryCode,
    )
  ) {
    issues.push("geographies: Country codes must match the confirmed organization market.");
  }
  if (!timeZones.has(document.cadence.timeZone)) {
    issues.push("cadence.timeZone: The cadence must use a confirmed organization timezone.");
  }
  return issues;
}

export function createMarketProfileService(dependencies: MarketProfileServiceDependencies) {
  const now = dependencies.now ?? (() => new Date());

  async function publish(input: {
    organizationId: string;
    actorId: string;
    correlationId: string;
    eventName: string;
    payload: Record<string, string | null>;
  }) {
    await dependencies.events.publish({
      eventId: crypto.randomUUID(),
      eventName: input.eventName,
      occurredAt: now().toISOString(),
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.actorId,
      correlationId: input.correlationId,
      schemaVersion: 1,
      payload: input.payload,
    });
  }

  return {
    read(scope: MarketProfileScope) {
      return dependencies.repository.read(scope);
    },

    async propose(input: ProposeInput) {
      let document: MarketProfileDocumentV1;
      let proposalContext:
        | { source: "operator" }
        | {
            source: "ai";
            modelProvider: string;
            modelName: string;
            modelVersion: string;
            modelInputDigest: string;
          };

      if (input.source === "operator") {
        document = marketProfileDocumentV1Schema.parse(input.document);
        proposalContext = { source: "operator" };
      } else {
        const provider = dependencies.proposalProvider;
        if (!provider) {
          throw new DomainError("INTEGRATION_ERROR", "Market Profile discovery is not configured.");
        }
        const context = await dependencies.repository.readProposalContext({
          organizationId: input.organizationId,
          // Legacy AI proposals stay on the explicit null-branch organization
          // scope. Branch research starts through startBranchResearch instead.
          branchId: null,
        });
        proposalContext = {
          source: "ai",
          modelProvider: provider.modelProvider,
          modelName: provider.modelName,
          modelVersion: provider.modelVersion,
          modelInputDigest: digestProposalContext(context),
        };
        const replay = await dependencies.repository.findProposalReplay({
          organizationId: input.organizationId,
          actorId: input.actorId,
          proposalContext,
          idempotencyKey: input.idempotencyKey,
        });
        if (replay) return replay;

        let repairIssues: string[] | null = null;
        let accepted: MarketProfileDocumentV1 | null = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const candidate = await provider.generate({
            context,
            repairIssues,
            correlationId: input.correlationId,
          });
          const parsed = marketProfileDocumentV1Schema.safeParse(candidate);
          if (!parsed.success) {
            repairIssues = safeValidationIssues(parsed.error);
            continue;
          }
          const scopeIssues = candidateScopeIssues(parsed.data, context);
          if (scopeIssues.length > 0) {
            repairIssues = scopeIssues;
            continue;
          }
          accepted = parsed.data;
          break;
        }
        if (!accepted) {
          throw new DomainError(
            "INTEGRATION_ERROR",
            "A valid Market Profile proposal could not be prepared.",
          );
        }
        document = accepted;
      }

      const outcome = await dependencies.repository.propose({
        organizationId: input.organizationId,
        actorId: input.actorId,
        document,
        profileDigest: createMarketProfileDigest(document),
        proposalContext,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
      });

      if (!outcome.replayed) {
        await publish({
          organizationId: input.organizationId,
          actorId: input.actorId,
          correlationId: input.correlationId,
          eventName: outcome.isRevision
            ? "market_profile.revision_proposed"
            : "market_profile.proposed",
          payload: {
            profileId: outcome.profileId,
            profileVersionId: outcome.profileVersionId,
          },
        });
      }

      return outcome;
    },

    async decide(input: DecideInput) {
      const outcome = await dependencies.repository.decide(input);
      if (!outcome.replayed && outcome.decision !== "rejected") {
        await publish({
          organizationId: input.organizationId,
          actorId: input.actorId,
          correlationId: input.correlationId,
          eventName:
            outcome.decision === "confirmed"
              ? "market_profile.confirmed"
              : "market_profile.disabled",
          payload: {
            decisionId: outcome.decisionId,
            profileVersionId: outcome.profileVersionId,
            ...(outcome.requestId ? { requestId: outcome.requestId } : {}),
          },
        });
      }
      return outcome;
    },

    async startBranchResearch(input: StartBranchResearchInput) {
      const document: MarketProfileDocumentV2 = marketProfileDocumentV2Schema.parse(input.document);
      if (document.branchId !== input.branchId) {
        throw new DomainError(
          "DOMAIN_ERROR",
          "The reviewed scope does not match the selected branch.",
        );
      }
      const outcome = await dependencies.repository.startBranchResearch({
        ...input,
        document,
        profileDigest: createMarketProfileDigest(document),
      });
      if (outcome.outcome === "started") {
        await publish({
          organizationId: input.organizationId,
          actorId: input.actorId,
          correlationId: input.correlationId,
          eventName: "growth_intelligence.research_started",
          payload: {
            profileVersionId: outcome.profileVersionId,
            pipelineId: outcome.pipelineId,
            researchRequestId: outcome.researchRequestId,
          },
        });
      }
      return outcome;
    },
  };
}

export type MarketProfileService = ReturnType<typeof createMarketProfileService>;
