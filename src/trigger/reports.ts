import { AbortTaskRunError, logger, schemaTask } from "@trigger.dev/sdk";

import { reportProjectionTaskSchema, reportProfilingTaskSchema, reportValidationTaskSchema } from "@/domain/reports/schemas";
import { reportProjectionDocumentSchema } from "@/domain/reports/projection";
import { createReportWorkerServiceClient } from "@/lib/supabase/service";
import { createAdmissionService } from "@/modules/reports/application/admissions";
import {
  continueAdmittedReportPackage,
  requestReportPackageProjection,
  requestReportPackageValidation,
} from "@/modules/reports/application/dispatch";
import { runReportPackageProfiling } from "@/workflows/reports/profile-report-package";
import { runReportPackageValidation } from "@/workflows/reports/validate-report-package";
import { runReportPackageProjection } from "@/workflows/reports/project-report-package";

const retry = {
  maxAttempts: 3,
  minTimeoutInMs: 1_000,
  maxTimeoutInMs: 30_000,
  factor: 2,
} as const;

export const reportPackageProfilingTask = schemaTask({
  id: "report-package.profile",
  schema: reportProfilingTaskSchema,
  retry,
  maxDuration: 300,
  queue: { concurrencyLimit: 2 },
  run: async (payload) => {
    const supabase = createReportWorkerServiceClient();
    const rpc = async <T>(
      name:
        | "claim_governed_report_package_profiling"
        | "complete_governed_report_package_profiling"
        | "fail_governed_report_package_profiling",
      args: Record<string, unknown>,
    ) => {
      const { data, error } = await supabase.rpc(name, args as never);
      if (error) throw new Error(`Report profile state transition failed: ${error.code}`);
      return data as T;
    };
    const result = await runReportPackageProfiling(payload, {
      async claim(input) {
        const data = await rpc<Record<string, unknown> | null>(
          "claim_governed_report_package_profiling",
          {
            p_organization_id: input.organizationId,
            p_report_package_id: input.packageId,
            p_idempotency_key: input.idempotencyKey,
            p_claim_token: input.claimToken,
          },
        );
        const outcome = typeof data?.outcome === "string" ? data.outcome : "conflict";
        if (outcome !== "acquired")
          return {
            outcome: outcome as
              | "completed"
              | "not_found"
              | "not_ready"
              | "in_progress"
              | "conflict",
          };
        const reportPackage = data?.reportPackage;
        if (!reportPackage || typeof reportPackage !== "object") return { outcome: "conflict" };
        return { outcome: "acquired", reportPackage: reportPackage as never };
      },
      objectStore: {
        async stat({ path }) {
          const folder = path.split("/").slice(0, -1).join("/");
          const filename = path.split("/").at(-1);
          if (!filename) throw new Error("Report object path is invalid.");
          const { data, error } = await supabase.storage
            .from("governed-report-packages")
            .list(folder, {
              limit: 2,
              search: filename,
            });
          if (error) throw new Error("Report object is unavailable.");
          const object = data.find((candidate) => candidate.name === filename);
          if (!object || !object.id) throw new Error("Report object is unavailable.");
          return {
            id: object.id,
            metadata: (object.metadata ?? {}) as Record<string, unknown>,
          };
        },
        async download({ path }) {
          const { data, error } = await supabase.storage
            .from("governed-report-packages")
            .download(path);
          if (error) throw new Error("Report object is unavailable.");
          return Buffer.from(await data.arrayBuffer());
        },
      },
      async complete(input) {
        await rpc("complete_governed_report_package_profiling", {
          p_organization_id: input.organizationId,
          p_report_package_id: input.packageId,
          p_claim_token: input.claimToken,
          p_content_sha256: input.contentSha256,
          p_schema_fingerprint: input.schemaFingerprint,
          p_structure_fingerprint: input.structureFingerprint,
          p_sheets: input.sheets,
        });
      },
      async fail(input) {
        await rpc("fail_governed_report_package_profiling", {
          p_organization_id: input.organizationId,
          p_report_package_id: input.packageId,
          p_claim_token: input.claimToken,
          p_failure_code: input.code,
        });
      },
    });
    logger.info("report_package.profile_completed", {
      organizationId: payload.organizationId,
      packageId: payload.packageId,
      outcome: result.outcome,
    });
    // The state transition is already recorded by the RPC above, so the
    // database is correct either way. This is only about what the run list
    // says. A governed refusal is permanent -- a date that will not parse will
    // not parse on the third attempt -- so it aborts rather than retries.
    if (result.outcome === "failed") {
      throw new AbortTaskRunError(`report-package refused: ${payload.packageId}`);
    }
    // A profile that lands cleanly may already have an answer waiting for it:
    // if this organization admitted this exact column structure on some
    // earlier upload, ADR 0046 says the four governance questions are not
    // asked again, and validation starts here rather than waiting for
    // someone to press the button that used to be the only way there. A
    // fresh correlation id is minted because this run is the one asking --
    // the profiling payload never carried the operator's, since profiling
    // itself has no approval to correlate with.
    if (result.outcome === "profiled") {
      await continueAdmittedReportPackage(
        {
          organizationId: payload.organizationId,
          packageId: payload.packageId,
          correlationId: crypto.randomUUID(),
        },
        {
          async findAdmissionForPackage({ organizationId, packageId }) {
            const { data: reportPackage, error } = await supabase
              .from("integration_report_packages")
              .select("channel_id, structure_fingerprint, declared_currency")
              .eq("organization_id", organizationId)
              .eq("id", packageId)
              .maybeSingle();
            // No fingerprint means this profile predates Task 2, or the read
            // itself failed -- either way, there is nothing to match an
            // admission against, and the package waits for a person exactly
            // as it always has.
            if (error || !reportPackage || !reportPackage.structure_fingerprint) return null;
            return createAdmissionService(supabase).findActiveAdmission({
              organizationId,
              channelId: reportPackage.channel_id,
              structureFingerprint: reportPackage.structure_fingerprint,
              declaredCurrency: reportPackage.declared_currency,
            });
          },
          requestValidation: requestReportPackageValidation,
        },
      );
    }
    return result;
  },
});

export const reportPackageValidationTask = schemaTask({
  id: "report-package.validate",
  schema: reportValidationTaskSchema,
  retry,
  maxDuration: 300,
  queue: { concurrencyLimit: 2 },
  run: async (payload) => {
    const supabase = createReportWorkerServiceClient();
    const rpc = async <T>(
      name:
        | "claim_governed_report_package_validation"
        | "complete_governed_report_package_validation"
        | "fail_governed_report_package_validation",
      args: Record<string, unknown>,
    ) => {
      const { data, error } = await supabase.rpc(name, args as never);
      if (error) throw new Error(`Report validation state transition failed: ${error.code}`);
      return data as T;
    };
    const result = await runReportPackageValidation(payload, {
      async claim(input) {
        const data = await rpc<Record<string, unknown> | null>(
          "claim_governed_report_package_validation",
          {
            p_organization_id: input.organizationId,
            p_report_package_id: input.packageId,
            p_report_contract_version_id: input.contractVersionId,
            p_validation_run_id: input.validationRunId,
            p_idempotency_key: input.idempotencyKey,
            p_claim_token: input.claimToken,
            p_correlation_id: input.correlationId,
          },
        );
        const outcome = typeof data?.outcome === "string" ? data.outcome : "conflict";
        if (outcome !== "acquired") {
          return {
            outcome: outcome as
              | "completed"
              | "not_found"
              | "not_ready"
              | "in_progress"
              | "conflict"
              | "expired"
              | "object_mismatch",
          };
        }
        const reportPackage = data?.reportPackage;
        const contractVersion = data?.contractVersion;
        const sheetManifests = data?.sheetManifests;
        if (
          !reportPackage ||
          typeof reportPackage !== "object" ||
          !contractVersion ||
          typeof contractVersion !== "object" ||
          !Array.isArray(sheetManifests)
        ) {
          return { outcome: "conflict" };
        }
        return {
          outcome: "acquired",
          reportPackage: reportPackage as never,
          contractVersion: contractVersion as never,
          sheetManifests: sheetManifests as never,
        };
      },
      objectStore: {
        async stat({ path }) {
          const folder = path.split("/").slice(0, -1).join("/");
          const filename = path.split("/").at(-1);
          if (!filename) throw new Error("Report object path is invalid.");
          const { data, error } = await supabase.storage
            .from("governed-report-packages")
            .list(folder, { limit: 2, search: filename });
          if (error) throw new Error("Report object is unavailable.");
          const object = data.find((candidate) => candidate.name === filename);
          if (!object || !object.id) throw new Error("Report object is unavailable.");
          return { id: object.id, metadata: (object.metadata ?? {}) as Record<string, unknown> };
        },
        async download({ path }) {
          const { data, error } = await supabase.storage.from("governed-report-packages").download(path);
          if (error) throw new Error("Report object is unavailable.");
          return Buffer.from(await data.arrayBuffer());
        },
      },
      async complete(input) {
        await rpc("complete_governed_report_package_validation", {
          p_organization_id: input.organizationId,
          p_report_package_id: input.packageId,
          p_validation_run_id: input.validationRunId,
          p_claim_token: input.claimToken,
          p_result_digest: input.resultDigest,
          p_result: input.result,
        });
      },
      async fail(input) {
        await rpc("fail_governed_report_package_validation", {
          p_organization_id: input.organizationId,
          p_report_package_id: input.packageId,
          p_validation_run_id: input.validationRunId,
          p_claim_token: input.claimToken,
          p_failure_code: input.code,
          p_result_digest: input.resultDigest,
        });
      },
    });
    logger.info("report_package.validation_completed", {
      organizationId: payload.organizationId,
      packageId: payload.packageId,
      contractVersionId: payload.contractVersionId,
      validationRunId: payload.validationRunId,
      outcome: result.outcome,
    });
    // The state transition is already recorded by the RPC above, so the
    // database is correct either way. This is only about what the run list
    // says. A governed refusal is permanent -- a date that will not parse will
    // not parse on the third attempt -- so it aborts rather than retries.
    if (result.outcome === "failed") {
      throw new AbortTaskRunError(`report-package refused: ${payload.packageId}`);
    }
    // Only a clean `validated` chains into projection. `partially_validated`
    // means some sheets validated and some did not, and a projection over
    // evidence nobody fully approved would be a figure nobody approved
    // either -- that package stays exactly where the pre-existing manual
    // "Retry" flow already puts it. The projection version is the one bound
    // to the contract this run validated against; look it up rather than
    // widen the validation payload to carry a field only this branch needs.
    if (result.outcome === "validated") {
      const { data: binding, error: bindingError } = await supabase
        .from("report_projection_bindings")
        .select("report_projection_version_id")
        .eq("organization_id", payload.organizationId)
        .eq("report_contract_version_id", payload.contractVersionId)
        .eq("active", true)
        .maybeSingle();
      if (bindingError || !binding) {
        logger.warn("report_package.projection_binding_missing", {
          organizationId: payload.organizationId,
          packageId: payload.packageId,
          contractVersionId: payload.contractVersionId,
        });
      } else {
        await requestReportPackageProjection({
          organizationId: payload.organizationId,
          packageId: payload.packageId,
          contractVersionId: payload.contractVersionId,
          projectionVersionId: binding.report_projection_version_id,
          correlationId: payload.correlationId,
        });
      }
    }
    return result;
  },
});

export const reportPackageProjectionTask = schemaTask({
  id: "report-package.project",
  schema: reportProjectionTaskSchema,
  retry,
  maxDuration: 300,
  queue: { concurrencyLimit: 2 },
  run: async (payload) => {
    const supabase = createReportWorkerServiceClient();
    const rpc = async <T>(
      name:
        | "claim_governed_report_package_projection"
        | "complete_governed_report_package_projection"
        | "complete_governed_report_package_period_grain_projection"
        | "fail_governed_report_package_projection",
      args: Record<string, unknown>,
    ) => {
      const { data, error } = await supabase.rpc(name, args as never);
      // The message is kept, not only the code. Postgres raises these from
      // fixed strings in the projection guards -- "report projection
      // observation evidence is invalid" and the like -- so it names which
      // rule refused rather than only that one did, and it carries no value
      // from the workbook.
      if (error)
        throw new Error(
          `Report projection state transition failed: ${[error.code, error.message]
            .filter(Boolean)
            .join(" ")}`,
        );
      return data as T;
    };
    const result = await runReportPackageProjection(payload, {
      async claim(input) {
        const data = await rpc<Record<string, unknown> | null>("claim_governed_report_package_projection", {
          p_organization_id: input.organizationId,
          p_report_package_id: input.packageId,
          p_report_contract_version_id: input.contractVersionId,
          p_report_projection_version_id: input.projectionVersionId,
          p_projection_run_id: input.projectionRunId,
          p_idempotency_key: input.idempotencyKey,
          p_claim_token: input.claimToken,
          p_correlation_id: input.correlationId,
        });
        const outcome = typeof data?.outcome === "string" ? data.outcome : "conflict";
        if (outcome !== "acquired") return { outcome: outcome as "completed" | "not_found" | "not_ready" | "in_progress" | "conflict" | "expired" | "object_mismatch" };
        const reportPackage = data?.reportPackage;
        const contractVersion = data?.contractVersion;
        const projectionVersion = data?.projectionVersion;
        if (!reportPackage || typeof reportPackage !== "object" || !contractVersion || typeof contractVersion !== "object" || !projectionVersion || typeof projectionVersion !== "object") return { outcome: "conflict" };
        const document = reportProjectionDocumentSchema.safeParse((projectionVersion as { projection_document?: unknown }).projection_document);
        if (!document.success) return { outcome: "conflict" };
        const { data: definitions, error } = await supabase
          .from("metric_definitions")
          .select("id, key, value_kind")
          .in("key", document.data.outputs.map((output) => output.metricKey))
          .eq("is_active", true)
          .or(`organization_id.is.null,organization_id.eq.${input.organizationId}`);
        if (error || !definitions) return { outcome: "conflict" };
        return { outcome: "acquired", reportPackage: reportPackage as never, contractVersion: contractVersion as never, projectionVersion: projectionVersion as never, metricDefinitions: definitions as never };
      },
      objectStore: {
        async stat({ path }) {
          const folder = path.split("/").slice(0, -1).join("/");
          const filename = path.split("/").at(-1);
          if (!filename) throw new Error("Report object is unavailable.");
          const { data, error } = await supabase.storage.from("governed-report-packages").list(folder, { limit: 2, search: filename });
          if (error) throw new Error("Report object is unavailable.");
          const object = data.find((candidate) => candidate.name === filename);
          if (!object || !object.id) throw new Error("Report object is unavailable.");
          return { id: object.id, metadata: (object.metadata ?? {}) as Record<string, unknown> };
        },
        async download({ path }) {
          const { data, error } = await supabase.storage.from("governed-report-packages").download(path);
          if (error) throw new Error("Report object is unavailable.");
          return Buffer.from(await data.arrayBuffer());
        },
      },
      async complete(input) {
        await rpc("complete_governed_report_package_projection", {
          p_organization_id: input.organizationId, p_report_package_id: input.packageId,
          p_projection_run_id: input.projectionRunId, p_claim_token: input.claimToken,
          p_result_digest: input.resultDigest, p_result: input.result, p_outputs: input.outputs,
        });
      },
      async completePeriodGrain(input) {
        await rpc("complete_governed_report_package_period_grain_projection", {
          p_organization_id: input.organizationId, p_report_package_id: input.packageId,
          p_projection_run_id: input.projectionRunId, p_claim_token: input.claimToken,
          p_result_digest: input.resultDigest, p_result: input.result,
          p_observations: input.observations, p_absent_row_count: input.absentRowCount,
        });
      },
      async fail(input) {
        await rpc("fail_governed_report_package_projection", {
          p_organization_id: input.organizationId, p_report_package_id: input.packageId,
          p_projection_run_id: input.projectionRunId, p_claim_token: input.claimToken,
          p_failure_code: input.code, p_result_digest: input.resultDigest,
          p_failure_detail: input.detail ?? null,
        });
      },
    });
    // The gap count is evidence, not noise: a series that arrived with eleven
    // blank days is a different import from one with none, and no workbook
    // value is carried here.
    logger.info("report_package.projection_completed", { organizationId: payload.organizationId, packageId: payload.packageId, projectionVersionId: payload.projectionVersionId, projectionRunId: payload.projectionRunId, correlationId: payload.correlationId, outcome: result.outcome, absentRowCount: result.absentRowCount });
    // The state transition is already recorded by the RPC above, so the
    // database is correct either way. This is only about what the run list
    // says. A governed refusal is permanent -- a date that will not parse will
    // not parse on the third attempt -- so it aborts rather than retries.
    if (result.outcome === "failed") {
      throw new AbortTaskRunError(`report-package refused: ${payload.packageId}`);
    }
    return result;
  },
});
