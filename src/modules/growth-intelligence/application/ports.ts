import type { EventPublisher } from "@/domain/events/types";
import type { MarketProfileDocumentV1 } from "@/domain/growth-intelligence/types";

export type MarketProfileProposalContext = {
  publicIdentity: {
    approvedName: string;
    publicUrls: string[];
  };
  market: {
    countryCode: string;
    timeZone: string;
  };
  nicheDescriptors: string[];
  locations: Array<{
    branchId: string | null;
    name: string;
    serviceAreas: string[];
    countryCode: string;
    timeZone: string;
  }>;
  topics: string[];
};

export type MarketProfileVersionView = {
  id: string;
  profileId: string;
  version: number;
  document: MarketProfileDocumentV1;
  digest: string;
  proposalSource: "operator" | "ai" | "system";
  createdAt: string;
};

export type MarketProfileDecisionView = {
  id: string;
  profileVersionId: string;
  decision: "confirmed" | "rejected" | "disabled" | "superseded";
  reason: string | null;
  createdAt: string;
};

export type MarketProfileView = {
  profile: {
    id: string;
    currentVersionId: string | null;
    enabled: boolean;
    nextDailyResearchDueAt: string | null;
    nextWeeklySynthesisDueAt: string | null;
  } | null;
  versions: MarketProfileVersionView[];
  decisions: MarketProfileDecisionView[];
};

export type MarketProfileProposalOutcome = {
  profileId: string;
  profileVersionId: string;
  version: number;
  profileDigest: string;
  replayed: boolean;
  isRevision: boolean;
};

export type MarketProfileDecisionOutcome = {
  decisionId: string;
  profileVersionId: string;
  requestId: string | null;
  decision: "confirmed" | "rejected" | "disabled";
  replayed: boolean;
};

export type MarketProfileRepository = {
  read(organizationId: string): Promise<MarketProfileView>;
  readProposalContext(organizationId: string): Promise<MarketProfileProposalContext>;
  findProposalReplay(input: {
    organizationId: string;
    actorId: string;
    proposalContext: {
      source: "ai";
      modelProvider: string;
      modelName: string;
      modelVersion: string;
      modelInputDigest: string;
    };
    idempotencyKey: string;
  }): Promise<MarketProfileProposalOutcome | null>;
  propose(input: {
    organizationId: string;
    actorId: string;
    document: MarketProfileDocumentV1;
    profileDigest: string;
    proposalContext:
      | { source: "operator" }
      | {
          source: "ai";
          modelProvider: string;
          modelName: string;
          modelVersion: string;
          modelInputDigest: string;
        };
    idempotencyKey: string;
    correlationId: string;
  }): Promise<MarketProfileProposalOutcome>;
  decide(input: {
    organizationId: string;
    actorId: string;
    profileVersionId: string;
    profileDigest: string;
    decision: "confirmed" | "rejected" | "disabled";
    reason: string | null;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<MarketProfileDecisionOutcome>;
};

export type MarketProfileProposalProvider = {
  readonly modelProvider: string;
  readonly modelName: string;
  readonly modelVersion: string;
  generate(input: {
    context: MarketProfileProposalContext;
    repairIssues: string[] | null;
    correlationId: string;
  }): Promise<unknown>;
};

export type MarketProfileServiceDependencies = {
  repository: MarketProfileRepository;
  proposalProvider?: MarketProfileProposalProvider;
  events: EventPublisher;
  now?: () => Date;
};
