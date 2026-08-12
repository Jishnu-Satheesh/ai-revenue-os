import "server-only";

import { z } from "zod";

import { IntegrationError, normalizeProviderError } from "@/domain/integrations/errors";
import { integrationRecordEnvelopeSchema } from "@/domain/integrations/schemas";
import type {
  AdapterContext,
  AdapterSyncContext,
  ConnectionTestResult,
  ProviderAdapter,
} from "@/domain/integrations/types";
import { googleBusinessProfileDefinition } from "@/modules/integrations/providers/google-business-profile/definition";
import {
  listGoogleBusinessProfileFixtureRecords,
  listGoogleBusinessProfileFixtureResources,
} from "@/modules/integrations/providers/google-business-profile/fixture-data";

const adapterContextSchema = z.object({
  organizationId: z.string().trim().min(1).max(200),
  connectionId: z.string().trim().min(1).max(200),
  adapterVersion: z.literal(googleBusinessProfileDefinition.adapterVersion),
  correlationId: z.string().trim().min(1).max(200),
  credentialHandle: z.object({ reference: z.string().trim().min(1) }).optional(),
});

const adapterSyncContextSchema = adapterContextSchema.extend({
  ingestionRunId: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export const googleBusinessProfileFixtureScenarios = [
  "authentication_failed",
  "missing_scope",
  "rate_limited",
  "unavailable",
  "malformed_response",
  "missing_resource",
  "partial_ingestion",
] as const;

export type GoogleBusinessProfileFixtureScenario =
  (typeof googleBusinessProfileFixtureScenarios)[number];

type FixtureAdapterDependencies = {
  /** Test-only dependency injection. This is never derived from browser input. */
  scenario?: GoogleBusinessProfileFixtureScenario;
  now?: () => Date;
};

const scenarioErrors: Record<
  Exclude<GoogleBusinessProfileFixtureScenario, "partial_ingestion">,
  { code: string; retryable: boolean }
> = {
  authentication_failed: { code: "AUTHENTICATION_FAILED", retryable: false },
  missing_scope: { code: "AUTHORIZATION_SCOPE_MISSING", retryable: false },
  rate_limited: { code: "RATE_LIMITED", retryable: true },
  unavailable: { code: "PROVIDER_UNAVAILABLE", retryable: true },
  malformed_response: { code: "INVALID_PROVIDER_RESPONSE", retryable: false },
  missing_resource: { code: "RESOURCE_NOT_FOUND", retryable: false },
};

function parseContext(input: AdapterContext): z.infer<typeof adapterContextSchema> {
  const parsed = adapterContextSchema.safeParse(input);
  if (!parsed.success) {
    throw new IntegrationError("VALIDATION_ERROR", "The adapter context is invalid.", false);
  }
  return parsed.data;
}

function parseSyncContext(input: AdapterSyncContext): z.infer<typeof adapterSyncContextSchema> {
  const parsed = adapterSyncContextSchema.safeParse(input);
  if (!parsed.success) {
    throw new IntegrationError("VALIDATION_ERROR", "The adapter sync context is invalid.", false);
  }
  return parsed.data;
}

function errorForScenario(scenario: GoogleBusinessProfileFixtureScenario | undefined): void {
  if (!scenario || scenario === "partial_ingestion") return;
  const error = scenarioErrors[scenario];
  throw normalizeProviderError({
    code: error.code,
    retryable: error.retryable,
    message: `Injected fixture scenario: ${scenario}`,
  });
}

export function createGoogleBusinessProfileFixtureAdapter(
  dependencies: FixtureAdapterDependencies = {},
): ProviderAdapter {
  const now = dependencies.now ?? (() => new Date());

  return {
    providerKey: googleBusinessProfileDefinition.key,
    adapterVersion: googleBusinessProfileDefinition.adapterVersion,
    adapterKind: "read",
    supportedCapabilityKeys: googleBusinessProfileDefinition.capabilities.map(({ key }) => key),

    async testConnection(input): Promise<ConnectionTestResult> {
      parseContext(input);
      errorForScenario(dependencies.scenario);
      if (dependencies.scenario === "partial_ingestion") {
        return {
          outcome: "warning",
          retryable: true,
          safeDetail: "Fixture sync will return a partial deterministic record set.",
        };
      }
      return { outcome: "passed", safeDetail: GOOGLE_BUSINESS_PROFILE_FIXTURE_SAFE_DETAIL };
    },

    async listExternalResources(input) {
      parseContext(input);
      errorForScenario(dependencies.scenario);
      return listGoogleBusinessProfileFixtureResources();
    },

    async sync(input) {
      const context = parseSyncContext(input);
      errorForScenario(dependencies.scenario);
      const fetchedAt = now().toISOString();
      return listGoogleBusinessProfileFixtureRecords({
        partial: dependencies.scenario === "partial_ingestion",
      }).map((record) =>
        integrationRecordEnvelopeSchema.parse({
          schemaVersion: 1,
          organizationId: context.organizationId,
          source: { kind: "connection", id: context.connectionId },
          externalRecordId: record.externalRecordId,
          recordType: record.recordType,
          observedAt: record.observedAt,
          fetchedAt,
          payload: {
            fixture: true,
            correlationId: context.correlationId,
            data: record.payload,
          },
        }),
      );
    },
  };
}

const GOOGLE_BUSINESS_PROFILE_FIXTURE_SAFE_DETAIL =
  "Fixture mode is active; no Google API request was made.";
