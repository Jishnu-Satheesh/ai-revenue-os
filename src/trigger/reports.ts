import { logger, schemaTask } from "@trigger.dev/sdk";

import { reportProjectionTaskSchema, reportProfilingTaskSchema, reportValidationTaskSchema } from "@/domain/reports/schemas";
import { reportProjectionDocumentSchema } from "@/domain/reports/projection";
import { createReportWorkerServiceClient } from "@/lib/supabase/service";
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
    return result;
  },
});
