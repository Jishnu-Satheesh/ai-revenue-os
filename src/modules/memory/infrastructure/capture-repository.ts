import "server-only";

import { memoryError } from "@/domain/memory/errors";
import type {
  CaptureCompletion,
  CaptureFailure,
  CaptureSafeCode,
} from "@/domain/memory/capture";

/**
 * Service-role adapter for the capture queue. Used only by capture Trigger
 * tasks and (for retry/settings) by session routes through their own scoped
 * clients — never by browser code. Tables stay untyped RPC-only surfaces, so
 * this client is structural and every answer is parsed defensively: a shape
 * the database did not promise is a conflict, never a silent default.
 */

type RpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

function captureDatabaseError(cause: unknown): never {
  throw memoryError("CONFLICT", {}, cause);
}

function stringArray(data: unknown, field: string): string[] {
  if (typeof data !== "object" || data === null) captureDatabaseError(new Error("capture answer is invalid"));
  const value = (data as Record<string, unknown>)[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    captureDatabaseError(new Error("capture answer is invalid"));
  }
  return value as string[];
}

function answerObject(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    captureDatabaseError(new Error("capture answer is invalid"));
  }
  return data as Record<string, unknown>;
}

function requiredString(answer: Record<string, unknown>, field: string): string {
  const value = answer[field];
  if (typeof value !== "string" || value.length === 0) {
    captureDatabaseError(new Error("capture answer is invalid"));
  }
  return value;
}

export type CaptureRepository = {
  listDueOrganizations(limit: number): Promise<string[]>;
  claim(input: {
    organizationId: string;
    claimToken: string;
    limit: number;
    leaseSeconds: number;
  }): Promise<string[]>;
  load(input: {
    organizationId: string;
    captureId: string;
    claimToken: string;
  }): Promise<Record<string, unknown>>;
  complete(input: {
    organizationId: string;
    captureId: string;
    claimToken: string;
  }): Promise<CaptureCompletion>;
  fail(input: {
    organizationId: string;
    captureId: string;
    claimToken: string;
    safeCode: CaptureSafeCode;
  }): Promise<CaptureFailure>;
  retry(input: {
    organizationId: string;
    actorId: string;
    captureId: string;
    correlationId: string;
  }): Promise<{ captureId: string; status: "pending" }>;
  updateSettings(input: {
    organizationId: string;
    actorId: string;
    captureEnabled: boolean;
    channelContextEnabled: boolean;
    growthContextEnabled: boolean;
    campaignContextEnabled: boolean;
    subjectContextEnabled: boolean;
    legacyCorpusQualified: boolean;
    contextPolicyVersion: string;
    correlationId: string;
  }): Promise<Record<string, unknown>>;
};

export function createCaptureRepository(client: RpcClient): CaptureRepository {
  const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const result = await client.rpc(name, args);
    if (result.error) captureDatabaseError(result.error);
    return answerObject(result.data);
  };

  return {
    async listDueOrganizations(limit) {
      const result = await client.rpc("list_memory_capture_due_orgs", { p_limit: limit });
      if (result.error) captureDatabaseError(result.error);
      return stringArray(result.data, "organizationIds");
    },

    async claim(input) {
      const answer = await call("claim_memory_capture_events", {
        p_organization_id: input.organizationId,
        p_claim_token: input.claimToken,
        p_limit: input.limit,
        p_lease_seconds: input.leaseSeconds,
      });
      return stringArray(answer, "captureIds");
    },

    async load(input) {
      return call("load_memory_capture_event", {
        p_organization_id: input.organizationId,
        p_capture_id: input.captureId,
        p_claim_token: input.claimToken,
      });
    },

    async complete(input) {
      const answer = await call("complete_memory_capture_event", {
        p_organization_id: input.organizationId,
        p_capture_id: input.captureId,
        p_claim_token: input.claimToken,
      });
      const status = answer["status"];
      const captureId = requiredString(answer, "captureId");
      if (status === "completed" || status === "replayed") {
        return {
          status,
          captureId,
          projectedItemId: requiredString(answer, "projectedItemId"),
        };
      }
      if (status === "obsolete" || status === "quarantined") {
        return { status, captureId };
      }
      return captureDatabaseError(new Error("capture completion is invalid"));
    },

    async fail(input) {
      const answer = await call("fail_memory_capture_event", {
        p_organization_id: input.organizationId,
        p_capture_id: input.captureId,
        p_claim_token: input.claimToken,
        p_safe_code: input.safeCode,
      });
      const status = answer["status"];
      const captureId = requiredString(answer, "captureId");
      if (
        status === "pending" ||
        status === "failed" ||
        status === "obsolete" ||
        status === "quarantined"
      ) {
        return { status, captureId };
      }
      return captureDatabaseError(new Error("capture failure is invalid"));
    },

    async retry(input) {
      const answer = await call("retry_memory_capture", {
        p_organization_id: input.organizationId,
        p_actor_id: input.actorId,
        p_capture_id: input.captureId,
        p_correlation_id: input.correlationId,
      });
      if (answer["status"] !== "pending") captureDatabaseError(new Error("capture retry is invalid"));
      return { captureId: requiredString(answer, "captureId"), status: "pending" as const };
    },

    async updateSettings(input) {
      return call("update_memory_integration_settings", {
        p_organization_id: input.organizationId,
        p_actor_id: input.actorId,
        p_capture_enabled: input.captureEnabled,
        p_channel_context_enabled: input.channelContextEnabled,
        p_growth_context_enabled: input.growthContextEnabled,
        p_campaign_context_enabled: input.campaignContextEnabled,
        p_subject_context_enabled: input.subjectContextEnabled,
        p_legacy_corpus_qualified: input.legacyCorpusQualified,
        p_context_policy_version: input.contextPolicyVersion,
        p_correlation_id: input.correlationId,
      });
    },
  };
}
