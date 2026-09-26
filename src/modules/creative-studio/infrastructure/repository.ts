import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/lib/supabase/database.types";
import { DomainError } from "@/lib/errors";

type StudioClient = SupabaseClient<Database>;

function persistenceFailure(message: string, cause: unknown): never {
  throw new DomainError("DOMAIN_ERROR", message, cause);
}

function messageFromCause(cause: unknown): string | null {
  return typeof cause === "object" &&
    cause !== null &&
    "message" in cause &&
    typeof cause.message === "string"
    ? cause.message
    : null;
}

const uuidSchema = z.string().uuid();
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

const documentReceiptSchema = z.object({
  id: uuidSchema,
  revision: z.number().int().positive(),
});
export type StudioDocumentReceipt = z.infer<typeof documentReceiptSchema>;

const uploadReceiptSchema = z.object({
  uploadId: uuidSchema,
  reservedPath: z.string().min(1),
  expiresAt: z.string().min(1),
});
export type StudioUploadReceipt = z.infer<typeof uploadReceiptSchema>;

const uploadSettlementSchema = z.object({
  uploadId: uuidSchema,
  state: z.enum(["reserved", "ready", "rejected", "expired"]),
  replayed: z.boolean(),
});
export type StudioUploadSettlement = z.infer<typeof uploadSettlementSchema>;

const policyReceiptSchema = z.object({ version: z.number().int().positive() });
export type StudioPolicyReceipt = z.infer<typeof policyReceiptSchema>;

const runAdmissionSchema = z.object({
  runId: uuidSchema,
  replayed: z.boolean(),
  state: z.string().min(1),
  reservationMinor: z.number().int().nonnegative(),
  policyVersion: z.number().int().positive(),
});
export type StudioRunAdmission = z.infer<typeof runAdmissionSchema>;

const runClaimSchema = z.object({
  runId: uuidSchema,
  leaseToken: uuidSchema,
  leaseExpiresAt: z.string().min(1),
  state: z.string().min(1),
});
export type StudioRunClaim = z.infer<typeof runClaimSchema>;

const runCompletionSchema = z.object({
  runId: uuidSchema,
  state: z.string().min(1),
  versionId: uuidSchema.optional(),
  ordinal: z.number().int().positive().optional(),
  branch: z.boolean().optional(),
  linkStatus: z.string().min(1).optional(),
  suggestion: z.boolean().optional(),
  eventSequence: z.number().int().nonnegative(),
});
export type StudioRunCompletion = z.infer<typeof runCompletionSchema>;

const runSettlementSchema = z.object({
  runId: uuidSchema,
  state: z.string().min(1),
  eventSequence: z.number().int().nonnegative().optional(),
  versionId: uuidSchema.optional(),
});
export type StudioRunSettlement = z.infer<typeof runSettlementSchema>;

const runCancelSchema = z.object({
  runId: uuidSchema,
  state: z.string().min(1),
  alreadyTerminal: z.boolean().optional(),
  alreadyRequested: z.boolean().optional(),
});
export type StudioRunCancel = z.infer<typeof runCancelSchema>;

const exportAdmissionSchema = z.object({
  exportId: uuidSchema,
  replayed: z.boolean(),
  runId: uuidSchema.nullable(),
});
export type StudioExportAdmission = z.infer<typeof exportAdmissionSchema>;

const exportCompletionSchema = z.object({
  exportId: uuidSchema,
  state: z.string().min(1),
  replayed: z.boolean(),
});
export type StudioExportCompletion = z.infer<typeof exportCompletionSchema>;

const exportAcceptanceSchema = z.object({
  acceptanceId: uuidSchema,
  replayed: z.boolean(),
});
export type StudioExportAcceptance = z.infer<typeof exportAcceptanceSchema>;

function parseReceipt<T>(schema: z.ZodType<T>, data: unknown, cause: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    persistenceFailure("The studio record came back in an unexpected shape.", {
      cause,
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

function documentFailureMessage(cause: unknown): string {
  switch (messageFromCause(cause)) {
    case "studio_document_forbidden":
      return "You do not have permission to save Studio documents. Ask an organization admin for access.";
    case "studio_document_not_found":
      return "This Studio document no longer exists. Return to history and open another one.";
    case "studio_document_stale_revision":
      return "Someone changed this document while you were working. Reload and try again.";
    default:
      return "The Studio document could not be saved. Check the title and settings, then try again.";
  }
}

function uploadFailureMessage(cause: unknown): string {
  switch (messageFromCause(cause)) {
    case "studio_upload_forbidden":
      return "You do not have permission to upload Studio references. Ask an organization admin for access.";
    default:
      return "The upload could not be reserved. Use a PNG, JPEG, or WebP under 15 MB, confirm rights, then try again.";
  }
}

function policyFailureMessage(cause: unknown): string {
  switch (messageFromCause(cause)) {
    case "studio_policy_forbidden":
      return "Only an organization admin or owner can change the Studio generation policy.";
    default:
      return "The generation policy is not valid. Check the ceilings, window, and attempt limits, then try again.";
  }
}

function runFailureMessage(cause: unknown): string {
  switch (messageFromCause(cause)) {
    case "studio_run_forbidden":
      return "You do not have permission to run Studio generations. Ask an organization admin for access.";
    case "studio_run_no_policy":
      return "Studio generations are not enabled for this organization yet. Ask an admin to save a generation policy first.";
    case "studio_run_generation_disabled":
      return "Studio generations are currently disabled for this organization.";
    case "studio_run_per_run_ceiling_exceeded":
      return "This run costs more than the per-run ceiling allows. Simplify the request or ask an admin to raise the ceiling.";
    case "studio_run_window_ceiling_exceeded":
      return "The organization has spent its Studio budget for this window. Try again later.";
    case "studio_run_too_many_pending":
      return "Too many Studio runs are already waiting. Wait for one to finish, then try again.";
    case "studio_run_attempt_limit_exceeded":
      return "This request has used all of its attempts. Change the request and start a new run.";
    case "studio_run_stale_revision":
      return "The document changed while this run was being prepared. Reload and try again.";
    case "studio_run_document_busy":
      return "Another image run is already working on this document. Wait for it to finish, then try again.";
    case "studio_run_key_conflict":
      return "This request was already used with different details. Start a new run and try again.";
    case "studio_run_parent_not_found":
      return "The version to edit no longer exists in this document. Pick another starting point.";
    case "studio_run_campaign_not_found":
      return "The selected campaign no longer exists in this organization. Pick another one.";
    default:
      return "The Studio run could not be started. Check the setup and try again.";
  }
}

function workerFailureMessage(cause: unknown): string {
  // Worker paths log safe codes; the message stays generic on purpose.
  switch (messageFromCause(cause)) {
    case "studio_run_lease_held":
      return "The run is already leased to a live worker.";
    case "studio_run_lease_lost":
      return "The worker lease lapsed or never existed.";
    case "studio_run_not_claimable":
      return "The run already settled and cannot be claimed.";
    case "studio_run_illegal_transition":
      return "The run cannot take that step from its current state.";
    case "studio_run_event_forbidden_key":
      return "The event payload carries a forbidden key.";
    case "studio_run_not_reconcilable":
      return "The run is not in a state reconciliation can settle.";
    default:
      return "The Studio worker step failed.";
  }
}

function exportFailureMessage(cause: unknown): string {
  switch (messageFromCause(cause)) {
    case "studio_export_forbidden":
      return "You do not have permission to export Studio versions. Ask an organization admin for access.";
    case "studio_export_version_not_found":
      return "The version to export no longer exists. Pick another version.";
    case "studio_export_hash_mismatch":
      return "The export changed since it was reviewed. Review the current bytes before accepting.";
    default:
      return "The Studio export could not be prepared. Check the format and size, then try again.";
  }
}

export type StudioRepository = ReturnType<typeof createStudioRepository>;

/**
 * Typed mappings over the fifteen Task 3 Studio RPCs. The caller supplies an
 * authenticated client for user writers or a worker client for worker writers;
 * this repository never chooses a role and never bypasses RLS itself.
 */
export function createStudioRepository(supabase: StudioClient) {
  return {
    async saveDocument(input: {
      organizationId: string;
      document: Record<string, unknown>;
    }): Promise<StudioDocumentReceipt> {
      const { data, error } = await supabase.rpc("save_studio_document", {
        target_organization_id: input.organizationId,
        input_document: input.document,
      });
      if (error || !data) {
        persistenceFailure(documentFailureMessage(error), error);
      }
      return parseReceipt(documentReceiptSchema, data, error);
    },

    async reserveUpload(input: {
      organizationId: string;
      upload: Record<string, unknown>;
    }): Promise<StudioUploadReceipt> {
      const { data, error } = await supabase.rpc("reserve_studio_upload", {
        target_organization_id: input.organizationId,
        input_upload: input.upload,
      });
      if (error || !data) {
        persistenceFailure(uploadFailureMessage(error), error);
      }
      return parseReceipt(uploadReceiptSchema, data, error);
    },

    async completeUpload(input: {
      organizationId: string;
      uploadId: string;
      receipt: Record<string, unknown>;
    }): Promise<StudioUploadSettlement> {
      const { data, error } = await supabase.rpc("complete_studio_upload", {
        target_organization_id: input.organizationId,
        target_upload_id: input.uploadId,
        input_receipt: input.receipt,
      });
      if (error || !data) {
        persistenceFailure(workerFailureMessage(error), error);
      }
      return parseReceipt(uploadSettlementSchema, data, error);
    },

    async savePolicy(input: {
      organizationId: string;
      policy: Record<string, unknown>;
    }): Promise<StudioPolicyReceipt> {
      const { data, error } = await supabase.rpc(
        "save_studio_generation_policy",
        {
          target_organization_id: input.organizationId,
          input_policy: input.policy,
        },
      );
      if (error || !data) {
        persistenceFailure(policyFailureMessage(error), error);
      }
      return parseReceipt(policyReceiptSchema, data, error);
    },

    async admitRun(input: {
      organizationId: string;
      run: Record<string, unknown>;
    }): Promise<StudioRunAdmission> {
      const { data, error } = await supabase.rpc("admit_studio_run", {
        target_organization_id: input.organizationId,
        input_run: input.run,
      });
      if (error || !data) {
        persistenceFailure(runFailureMessage(error), error);
      }
      return parseReceipt(runAdmissionSchema, data, error);
    },

    async claimRun(input: {
      runId: string;
      workerId: string;
      leaseSeconds: number;
    }): Promise<StudioRunClaim> {
      const { data, error } = await supabase.rpc("claim_studio_run", {
        target_run_id: input.runId,
        target_worker_id: input.workerId,
        lease_seconds: input.leaseSeconds,
      });
      if (error || !data) {
        persistenceFailure(workerFailureMessage(error), error);
      }
      return parseReceipt(runClaimSchema, data, error);
    },

    async heartbeatRun(input: {
      runId: string;
      leaseToken: string;
    }): Promise<boolean> {
      const { data, error } = await supabase.rpc("heartbeat_studio_run", {
        target_run_id: input.runId,
        target_lease_token: input.leaseToken,
      });
      if (error || data !== true) {
        persistenceFailure(
          error
            ? workerFailureMessage(error)
            : "The worker lease lapsed or never existed.",
          error,
        );
      }
      return true;
    },

    async appendRunEvent(input: {
      runId: string;
      leaseToken: string;
      event: Record<string, unknown>;
    }): Promise<number> {
      const { data, error } = await supabase.rpc("append_studio_run_event", {
        target_run_id: input.runId,
        target_lease_token: input.leaseToken,
        input_event: input.event,
      });
      if (error || typeof data !== "number") {
        persistenceFailure(workerFailureMessage(error), error);
      }
      return data;
    },

    async completeRun(input: {
      runId: string;
      leaseToken: string;
      result: Record<string, unknown>;
    }): Promise<StudioRunCompletion> {
      const { data, error } = await supabase.rpc("complete_studio_run", {
        target_run_id: input.runId,
        target_lease_token: input.leaseToken,
        input_result: input.result,
      });
      if (error || !data) {
        persistenceFailure(workerFailureMessage(error), error);
      }
      return parseReceipt(runCompletionSchema, data, error);
    },

    async failRun(input: {
      runId: string;
      leaseToken: string;
      failure: Record<string, unknown>;
    }): Promise<StudioRunSettlement> {
      const { data, error } = await supabase.rpc("fail_studio_run", {
        target_run_id: input.runId,
        target_lease_token: input.leaseToken,
        input_failure: input.failure,
      });
      if (error || !data) {
        persistenceFailure(workerFailureMessage(error), error);
      }
      return parseReceipt(runSettlementSchema, data, error);
    },

    async cancelRun(input: {
      organizationId: string;
      runId: string;
    }): Promise<StudioRunCancel> {
      const { data, error } = await supabase.rpc("cancel_studio_run", {
        target_organization_id: input.organizationId,
        target_run_id: input.runId,
      });
      if (error || !data) {
        persistenceFailure(runFailureMessage(error), error);
      }
      return parseReceipt(runCancelSchema, data, error);
    },

    async reconcileRun(input: {
      runId: string;
      receipt: Record<string, unknown>;
    }): Promise<StudioRunSettlement> {
      const { data, error } = await supabase.rpc("reconcile_studio_run", {
        target_run_id: input.runId,
        input_receipt: input.receipt,
      });
      if (error || !data) {
        persistenceFailure(workerFailureMessage(error), error);
      }
      return parseReceipt(runSettlementSchema, data, error);
    },

    async createExport(input: {
      organizationId: string;
      exportRequest: Record<string, unknown>;
    }): Promise<StudioExportAdmission> {
      const { data, error } = await supabase.rpc("create_studio_export", {
        target_organization_id: input.organizationId,
        input_export: input.exportRequest,
      });
      if (error || !data) {
        persistenceFailure(exportFailureMessage(error), error);
      }
      return parseReceipt(exportAdmissionSchema, data, error);
    },

    async completeExport(input: {
      organizationId: string;
      exportId: string;
      receipt: Record<string, unknown>;
    }): Promise<StudioExportCompletion> {
      const { data, error } = await supabase.rpc("complete_studio_export", {
        target_organization_id: input.organizationId,
        target_export_id: input.exportId,
        input_receipt: input.receipt,
      });
      if (error || !data) {
        persistenceFailure(workerFailureMessage(error), error);
      }
      return parseReceipt(exportCompletionSchema, data, error);
    },

    async acceptExport(input: {
      organizationId: string;
      exportId: string;
      expectedContentHash: string;
      idempotencyKey: string;
    }): Promise<StudioExportAcceptance> {
      const parsedHash = sha256Schema.safeParse(input.expectedContentHash);
      if (!parsedHash.success) {
        persistenceFailure(exportFailureMessage(null), null);
      }
      const { data, error } = await supabase.rpc("accept_studio_export", {
        target_organization_id: input.organizationId,
        target_export_id: input.exportId,
        expected_content_hash: input.expectedContentHash,
        idempotency_key: input.idempotencyKey,
      });
      if (error || !data) {
        persistenceFailure(exportFailureMessage(error), error);
      }
      return parseReceipt(exportAcceptanceSchema, data, error);
    },
  };
}
