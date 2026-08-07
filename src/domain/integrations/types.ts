import type {
  ConnectionMaturity,
  ConnectionStatus,
  IntegrationRecordEnvelope,
} from "@/domain/integrations/schemas";

export type ProviderDefinition = {
  key: string;
  displayName: string;
  adapterVersion: string;
  rolloutState: "fixture" | "available" | "disabled";
  supportedCapabilities: readonly string[];
  requiredScopes: readonly string[];
  syncIntervalMinutes: number;
  staleAfterMinutes: number;
  supportsWebhooks: boolean;
  supportsWrites: boolean;
};

export type CredentialHandle = {
  readonly reference: string;
};

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

export type ExternalResource = {
  id: string;
  label: string;
  type: string;
};

export type ProviderAdapter = {
  providerKey: string;
  adapterVersion: string;
  testConnection(input: AdapterContext): Promise<ConnectionTestResult>;
  listExternalResources(input: AdapterContext): Promise<ExternalResource[]>;
  sync(input: AdapterSyncContext): Promise<IntegrationRecordEnvelope[]>;
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

export type CapabilityGrant = {
  capabilityKey: string;
  maturity: ConnectionMaturity;
  availability: "available" | "blocked" | "disabled";
  reasonCodes: readonly string[];
};

export type CapabilityDerivationInput = {
  definition: ProviderDefinition;
  connection: { status: ConnectionStatus; grantedScopes: readonly string[] };
  accountMapping: { status: "unmapped" | "mapped" | "ignored" };
  platformPolicy: { allowsIntegrationReads: boolean };
  requestedCapabilities?: readonly string[];
};
