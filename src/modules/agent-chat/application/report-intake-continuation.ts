import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { ReportPackageStatus } from "@/domain/reports/types";
import type { Database } from "@/lib/supabase/database.types";
import {
  requestReportPackageProjection,
  requestReportPackageValidation,
} from "@/modules/reports/application/dispatch";
import { agentReportScopeSchema, type AgentReportScope } from "./report-intake";
import type { AgentAttachmentWorkerInput } from "./report-intake-worker";

type ContinuationInput = AgentAttachmentWorkerInput & { packageId?: string };
type SourceSnapshot = {
  packageId: string;
  scope: AgentReportScope;
  status: ReportPackageStatus;
  hasCurrentEvidence: boolean;
  partial: boolean;
};
type SourceWork = { organizationId: string; packageId: string; correlationId: string };
type ProjectionRequest =
  | { outcome: "requested"; contractVersionId: string; projectionVersionId: string }
  | { outcome: "approval_required" };

export type AgentReportContinuationPorts = {
  load: () => Promise<SourceSnapshot>;
  advanceOnAdmission: (
    input: SourceWork,
  ) => Promise<{ outcome: "admitted"; contractVersionId: string } | { outcome: "not_admitted" }>;
  queueValidation: (input: SourceWork & { contractVersionId: string }) => Promise<boolean>;
  requestProjection: (input: SourceWork) => Promise<ProjectionRequest>;
  queueProjection: (
    input: SourceWork & { contractVersionId: string; projectionVersionId: string },
  ) => Promise<boolean>;
};

type ContinuationBase = SourceSnapshot & { reportHref: string };
export type AgentReportContinuationOutcome =
  | (ContinuationBase & { kind: "processing" })
  | (ContinuationBase & {
      kind: "awaiting_approval";
      approvalKind: "report_contract" | "report_projection" | "report_correction";
      reason: string;
    })
  | (ContinuationBase & { kind: "ready" })
  | (ContinuationBase & { kind: "blocked"; reason: string });

/** An upload is finished only when source-owned projected evidence is current. */
export async function readAgentReportContinuationWithPorts(
  input: ContinuationInput,
  ports: AgentReportContinuationPorts,
): Promise<AgentReportContinuationOutcome> {
  const snapshot = await ports.load();
  const base = {
    ...snapshot,
    reportHref: `/organizations/${input.organizationId}/integrations?tab=data-sources&package=${snapshot.packageId}`,
  };
  const work = {
    organizationId: input.organizationId,
    packageId: snapshot.packageId,
    correlationId: input.turnId,
  };
  if (snapshot.status === "awaiting_contract") {
    const admitted = await ports.advanceOnAdmission(work);
    if (admitted.outcome === "admitted") {
      if (
        !(await ports.queueValidation({ ...work, contractVersionId: admitted.contractVersionId }))
      )
        throw new Error("Governed report validation could not be queued.");
      return { ...base, kind: "processing", status: "awaiting_validation" };
    }
    return {
      ...base,
      kind: "awaiting_approval",
      approvalKind: "report_contract",
      reason: "REPORT_MAPPING_APPROVAL_REQUIRED",
    };
  }
  if (snapshot.status === "awaiting_approval")
    return {
      ...base,
      kind: "awaiting_approval",
      approvalKind: "report_contract",
      reason: "REPORT_MAPPING_APPROVAL_REQUIRED",
    };
  if (snapshot.status === "validated" || snapshot.status === "partially_validated") {
    const projected = await ports.requestProjection(work);
    if (projected.outcome === "requested") {
      if (
        !(await ports.queueProjection({
          ...work,
          contractVersionId: projected.contractVersionId,
          projectionVersionId: projected.projectionVersionId,
        }))
      )
        throw new Error("Governed report projection could not be queued.");
      return { ...base, kind: "processing", status: "awaiting_projection" };
    }
    return {
      ...base,
      kind: "awaiting_approval",
      approvalKind: "report_projection",
      reason: "REPORT_PROJECTION_APPROVAL_REQUIRED",
    };
  }
  if (snapshot.status === "reconciliation_required")
    return {
      ...base,
      kind: "awaiting_approval",
      approvalKind: "report_correction",
      reason: "REPORT_CORRECTION_REVIEW_REQUIRED",
    };
  if (snapshot.status === "projected" || snapshot.status === "partially_projected") {
    return snapshot.hasCurrentEvidence
      ? { ...base, kind: "ready" }
      : { ...base, kind: "blocked", reason: "NO_CURRENT_REPORT_EVIDENCE" };
  }
  if (["failed", "validation_failed", "projection_failed"].includes(snapshot.status)) {
    return {
      ...base,
      kind: "blocked",
      reason:
        snapshot.status === "validation_failed"
          ? "REPORT_VALIDATION_FAILED"
          : snapshot.status === "projection_failed"
            ? "REPORT_PROJECTION_FAILED"
            : "REPORT_PROCESSING_FAILED",
    };
  }
  return { ...base, kind: "processing" };
}

const inputSchema = z
  .object({
    organizationId: z.string().uuid(),
    turnId: z.string().uuid(),
    attachmentId: z.string().uuid(),
    leaseToken: z.string().uuid(),
    packageId: z.string().uuid().optional(),
  })
  .strict();

function stableRunId(key: string): string {
  const bytes = createHash("sha256").update(key).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Worker-only adapter; source transition RPCs recheck the original actor. */
export async function readAgentReportContinuation(
  request: ContinuationInput & { supabase: SupabaseClient<Database> },
): Promise<AgentReportContinuationOutcome> {
  const { supabase, ...unparsed } = request;
  const input = inputSchema.parse(unparsed);
  const leaseArgs = {
    p_organization_id: input.organizationId,
    p_turn_id: input.turnId,
    p_attachment_id: input.attachmentId,
    p_lease_token: input.leaseToken,
  };
  const rpc = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await (
      supabase.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>
    )(name, args);
    if (error || data === null) throw new Error(`Agent report continuation ${name} was refused.`);
    return data;
  };
  await rpc("authorize_agent_attachment_work", leaseArgs);
  const { data: attachment, error: attachmentError } = await supabase
    .from("agent_attachments")
    .select("package_id,declared_scope,status")
    .eq("organization_id", input.organizationId)
    .eq("turn_id", input.turnId)
    .eq("id", input.attachmentId)
    .single();
  if (
    attachmentError ||
    !attachment?.package_id ||
    (input.packageId && input.packageId !== attachment.package_id)
  )
    throw new Error("The report package is not bound to this attachment.");
  const packageId = attachment.package_id;
  const attachmentScope = agentReportScopeSchema.parse(attachment.declared_scope);
  let sourcePackage: Database["public"]["Tables"]["integration_report_packages"]["Row"] | null =
    null;
  return readAgentReportContinuationWithPorts(input, {
    load: async () => {
      const { data, error } = await supabase
        .from("integration_report_packages")
        .select("*")
        .eq("organization_id", input.organizationId)
        .eq("id", packageId)
        .single();
      if (error || !data) throw new Error("The governed report package is unavailable.");
      sourcePackage = data;
      const scope = agentReportScopeSchema.parse({
        channelId: data.channel_id,
        branchId: data.branch_id,
        reportType: data.report_type,
        periodStart: data.declared_period_start,
        periodEnd: data.declared_period_end,
        currency: data.declared_currency,
      });
      if (JSON.stringify(scope) !== JSON.stringify(attachmentScope))
        throw new Error("The governed report scope does not match the attachment.");
      let hasCurrentEvidence = false;
      if (data.status === "projected" || data.status === "partially_projected") {
        const { data: run, error: runError } = await supabase
          .from("integration_report_projection_runs")
          .select("id,status,completed_at,output_count")
          .eq("organization_id", input.organizationId)
          .eq("report_package_id", packageId)
          .in("status", ["projected", "partially_projected"])
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (runError) throw new Error("Report projection evidence is unavailable.");
        if (run?.completed_at && run.output_count > 0) {
          const { data: lineage, error: lineageError } = await supabase
            .from("report_projection_lineage")
            .select("normalized_metric_id,exact_range_metric_observation_id")
            .eq("organization_id", input.organizationId)
            .eq("report_package_id", packageId)
            .eq("projection_run_id", run.id)
            .limit(10001);
          if (lineageError || !lineage || lineage.length > 10000)
            throw new Error("Report projection lineage is unavailable or exceeds its bound.");
          for (const table of ["normalized_metrics", "exact_range_metric_observations"] as const) {
            const ids = [
              ...new Set(
                lineage.flatMap((row) => {
                  const id =
                    table === "normalized_metrics"
                      ? row.normalized_metric_id
                      : row.exact_range_metric_observation_id;
                  return id ? [id] : [];
                }),
              ),
            ];
            // UUID filters must fit the gateway request-line limit.
            for (let offset = 0; offset < ids.length && !hasCurrentEvidence; offset += 100) {
              const { data: current, error: currentError } = await supabase
                .from(table)
                .select("id")
                .eq("organization_id", input.organizationId)
                .in("id", ids.slice(offset, offset + 100))
                .eq("reconciliation_state", "current")
                .is("superseded_by_id", null)
                .limit(1);
              if (currentError) throw new Error("Current report evidence could not be read.");
              hasCurrentEvidence = (current?.length ?? 0) > 0;
            }
          }
        }
      }
      return {
        packageId,
        scope,
        status: data.status,
        hasCurrentEvidence,
        partial: ["partially_validated", "partially_projected"].includes(data.status),
      };
    },
    advanceOnAdmission: async (work) => {
      const result = z
        .object({ outcome: z.string(), reportContractVersionId: z.string().uuid().optional() })
        .passthrough()
        .parse(
          await rpc("advance_governed_report_package_on_admission", {
            p_organization_id: work.organizationId,
            p_report_package_id: work.packageId,
            p_correlation_id: work.correlationId,
          }),
        );
      if (result.outcome === "admitted" && result.reportContractVersionId)
        return { outcome: "admitted", contractVersionId: result.reportContractVersionId };
      if (!["no_admission", "not_ready", "not_found"].includes(result.outcome))
        throw new Error("The report admission response is invalid.");
      return { outcome: "not_admitted" };
    },
    queueValidation: (work) =>
      requestReportPackageValidation({
        ...work,
        validationRunId: stableRunId(
          `agent-validation:${input.turnId}:${packageId}:${work.contractVersionId}`,
        ),
      }),
    requestProjection: async () => {
      if (!sourcePackage) throw new Error("The report source state is unavailable.");
      const { data: validation, error: validationError } = await supabase
        .from("integration_report_validation_runs")
        .select("report_contract_version_id")
        .eq("organization_id", input.organizationId)
        .eq("report_package_id", packageId)
        .in("status", ["validated", "partially_validated"])
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (validationError || !validation)
        throw new Error("The report validation evidence is unavailable.");
      const { data: binding, error: bindingError } = await supabase
        .from("report_projection_bindings")
        .select("id")
        .eq("organization_id", input.organizationId)
        .eq("report_contract_version_id", validation.report_contract_version_id)
        .eq("active", true)
        .eq("declared_currency", sourcePackage.declared_currency)
        .eq("schema_fingerprint", sourcePackage.schema_fingerprint!)
        .limit(1)
        .maybeSingle();
      if (bindingError) throw new Error("The approved report projection could not be read.");
      if (!binding) return { outcome: "approval_required" };
      return z
        .object({
          outcome: z.literal("requested"),
          contractVersionId: z.string().uuid(),
          projectionVersionId: z.string().uuid(),
        })
        .strict()
        .parse(await rpc("request_agent_report_package_projection", leaseArgs));
    },
    queueProjection: (work) =>
      requestReportPackageProjection({
        ...work,
        projectionRunId: stableRunId(
          `agent-projection:${input.turnId}:${packageId}:${work.projectionVersionId}`,
        ),
      }),
  });
}
