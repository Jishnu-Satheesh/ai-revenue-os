import type { EventPublisher } from "@/domain/events/types";
import type {
  MarketProfileDocument,
  MarketProfileDocumentV1,
  MarketProfileDocumentV2,
} from "@/domain/growth-intelligence/types";

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
  document: MarketProfileDocument;
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

/**
 * Every Market Profile read names its scope explicitly. A null branch is the
 * legacy organization scope; a set branch is that branch's independent
 * profile. Organization-only reads are forbidden: the first branch row in an
 * organization would otherwise make a singleton read throw.
 */
export type MarketProfileScope = {
  organizationId: string;
  branchId: string | null;
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
  read(scope: MarketProfileScope): Promise<MarketProfileView>;
  readProposalContext(scope: MarketProfileScope): Promise<MarketProfileProposalContext>;
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
  startBranchResearch(
    input: StartBranchResearchInput & {
      profileDigest: string;
    },
  ): Promise<StartBranchResearchResult>;
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

export type StartBranchResearchInput = {
  organizationId: string;
  actorId: string;
  branchId: string;
  document: MarketProfileDocumentV2;
  expectedCurrentVersionId: string | null;
  idempotencyKey: string;
  correlationId: string;
};

export type StartBranchResearchResult = {
  outcome: "started" | "existing_active" | "replayed";
  profileVersionId: string;
  pipelineId: string;
  researchRequestId: string;
};

/**
 * The atomic research-to-synthesis handoff. The worker computes evidence
 * outside any transaction; these fenced operations own the crash window
 * between saved research, analysis scheduling and terminal output.
 */
export type ResearchPipelineCompletionResult = {
  outcome: string;
  resultDigest: string;
  sourceAttemptCount: number;
  sourceSuccessCount: number;
  adapterCostMicrosUsd: number;
  adapterLatencyMs: number;
};

export type ResearchPipelineCoverageEntry = {
  slotKey: string;
  kind: "local_market" | "topic" | "competitor";
  outcome:
    | "not_started"
    | "searched_no_usable_evidence"
    | "supported"
    | "failed"
    | "skipped_budget"
    | "skipped_policy";
  attemptIds?: string[];
  acceptedClaimIds?: string[];
};

export type ResearchPipelineHandoff = {
  runId: string;
  pipelineStage: string;
  synthesisRequestId: string | null;
  eligibleClaimCount: number;
  replayed: boolean;
};

export type SynthesisPipelineFinalization = {
  runId: string;
  itemCount: number;
  supersededItemIds: string[];
  pipelineStage: string;
  replayed: boolean;
};

export type ResearchPipelineRepository = {
  completeResearch(input: {
    organizationId: string;
    pipelineId: string;
    requestId: string;
    claimToken: string;
    runId: string;
    result: ResearchPipelineCompletionResult;
    coverage: readonly ResearchPipelineCoverageEntry[];
  }): Promise<ResearchPipelineHandoff>;
  finalizeSynthesis(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    runId: string;
    result: {
      outcome: "completed";
      resultDigest: string;
      items: readonly unknown[];
    };
  }): Promise<SynthesisPipelineFinalization>;
  failSynthesis(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    runId: string;
    failureCode: string;
  }): Promise<{ runId: string; pipelineStage: string; replayed: boolean }>;
  retrySynthesis(input: {
    organizationId: string;
    pipelineId: string;
    actorId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<{ requestId: string; status: string; replayed: boolean }>;
};
