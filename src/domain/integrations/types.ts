import type {
  CapabilityDirection,
  CapabilityEffect,
  CapabilityPrerequisite,
  ConnectionMaturity,
  ConnectionStatus,
  IntegrationCharacter,
  IntegrationRecordEnvelope,
  ProviderAdapterKind,
} from "@/domain/integrations/schemas";

export type ProviderCapabilityDefinition = {
  key: string;
  character: IntegrationCharacter;
  direction: CapabilityDirection;
  effect: CapabilityEffect;
  maturity: ConnectionMaturity;
  requiredScopes: readonly string[];
  restrictionCodes: readonly string[];
  adapterKind: ProviderAdapterKind;
  prerequisites: readonly CapabilityPrerequisite[];
  requiredWebhookEventKeys: readonly string[];
};

export type ProviderDefinition = {
  key: string;
  displayName: string;
  adapterVersion: string;
  contractVersion: string;
  rolloutState: "fixture" | "available" | "disabled";
  characters: readonly IntegrationCharacter[];
  capabilities: readonly ProviderCapabilityDefinition[];
  syncIntervalMinutes: number;
  staleAfterMinutes: number;
  /** Exact operator copy; presentation never invents provider readiness. */
  operatorCopy?: string;
};

export type CredentialHandle = { readonly reference: string };

export type AdapterContext = {
  organizationId: string;
  connectionId: string;
  adapterVersion: string;
  correlationId: string;
  credentialHandle?: CredentialHandle;
};

export type AdapterSyncContext = AdapterContext & {
  ingestionRunId: string;
  idempotencyKey: string;
};

export type ConnectionTestResult = {
  outcome: "passed" | "warning" | "failed";
  retryable?: boolean;
  safeDetail?: string;
};

export type ExternalResource = { id: string; label: string; type: string };

export type CapabilityAdapter<TKind extends ProviderAdapterKind = ProviderAdapterKind> = {
  providerKey: string;
  adapterVersion: string;
  adapterKind: TKind;
  supportedCapabilityKeys: readonly string[];
};

export type ReadProviderAdapter = CapabilityAdapter<"read"> & {
  testConnection(input: AdapterContext): Promise<ConnectionTestResult>;
  listExternalResources(input: AdapterContext): Promise<ExternalResource[]>;
  sync(input: AdapterSyncContext): Promise<IntegrationRecordEnvelope[]>;
};

/** Existing ingestion workers use the read adapter contract. */
export type ProviderAdapter = ReadProviderAdapter;

export type ProviderAdapterMaps = {
  readonly read?: readonly ReadProviderAdapter[];
  readonly publish?: readonly CapabilityAdapter<"publish">[];
  readonly advertise?: readonly CapabilityAdapter<"advertise">[];
  readonly webhook?: readonly CapabilityAdapter<"webhook">[];
  readonly operator_review?: readonly CapabilityAdapter<"operator_review">[];
};

export type IngestionSink = {
  accept(input: {
    organizationId: string;
    ingestionRunId: string;
    idempotencyKey: string;
    records: IntegrationRecordEnvelope[];
  }): Promise<{
    accepted: number;
    rejected: number;
    rejectionReasons: readonly string[];
  }>;
};

export type CapabilityDefinitionSnapshot = {
  character: IntegrationCharacter;
  effect: CapabilityEffect;
  maturity: ConnectionMaturity;
  requiredScopes: readonly string[];
};

export type CapabilityGrant = {
  capabilityKey: string;
  definition: CapabilityDefinitionSnapshot | null;
  availability: "available" | "blocked" | "disabled";
  reasonCodes: readonly string[];
  restrictionCodes: readonly string[];
  derivedFromContractVersion: string;
};

export type CapabilityEvidence = {
  evidence: {
    reference: string;
    checkedAt: string;
    validUntil: string;
  } | null;
  capabilityHealth: "usable" | "degraded" | "unusable";
  organizationEntitlement: "entitled" | "not_entitled" | "unknown";
  accountEligibility: "eligible" | "ineligible" | "unknown";
  accountMapping: "mapped" | "unmapped" | "ignored";
  credentialStatus: "not_required" | "current" | "missing" | "expired" | "revoked";
  controlledAccountEvidence: "verified" | "missing";
  tracking: "ready" | "missing";
  linkedOperator: "verified" | "missing" | "revoked";
  webhookConfiguration: "verified" | "missing" | "revoked";
  verifiedProviderPrerequisiteKeys: readonly string[];
};

export type VerifiedContractActionProjection = {
  key: string;
  effect: CapabilityEffect;
  requiredScopes: readonly string[];
  controlledAccountEvidenceVerified: boolean;
  requiredPrerequisiteKeys: readonly string[];
  placementVerification: "verified" | "unverified" | "not_required";
  reconciliationVerification: "verified" | "unverified" | "not_required";
};

export type ProviderContractProjection =
  | {
      verification: "fixture";
      providerKey: string;
      version: string;
      expiresAt: null;
    }
  | {
      verification: "verified_live";
      providerKey: string;
      version: string;
      expiresAt: string | null;
      actions: readonly VerifiedContractActionProjection[];
      webhook: {
        capabilityKey: string;
        eventKeys: readonly string[];
        signatureVerification: "verified" | "unverified";
        replayProtection: "verified" | "unverified";
      } | null;
    };

export type CapabilityDerivationInput = {
  definition: ProviderDefinition;
  connection: { status: ConnectionStatus; grantedScopes: readonly string[] };
  capabilityEvidence: Readonly<Record<string, CapabilityEvidence>>;
  providerContract: ProviderContractProjection;
  installedAdapterKinds: readonly ProviderAdapterKind[];
  platformPolicy: {
    permittedEffects: readonly CapabilityEffect[];
    publicWriteMode: "disabled" | "approval_required" | "bounded_autonomous";
    spendMode: "disabled" | "approval_required" | "bounded_autonomous";
  };
  requestedCapabilities?: readonly string[];
  now?: Date;
};
