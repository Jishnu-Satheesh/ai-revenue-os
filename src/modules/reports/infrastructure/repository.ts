import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DomainError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";
import type { ReportPackageRepository } from "@/modules/reports/application/ports";

type AuthenticatedClient = SupabaseClient<Database>;

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

function reportUploadFailureMessage(cause: unknown): string {
  const message = messageFromCause(cause);

  switch (message) {
    case "channel is not applicable to this branch for the declared period":
      return "This channel is not mapped to the selected branch for the declared period. Map the channel to this branch in Channels, or choose a mapped branch, then try again.";
    case "channel was not found":
      return "The selected channel is no longer active. Refresh the page, choose an active channel, and try again.";
    case "branch was not found":
      return "The selected branch is no longer active. Refresh the page, choose an active branch, and try again.";
    case "report upload is not authorized":
      return "You do not have permission to upload reports. Ask an organization admin to grant report upload access.";
    case "report upload context is invalid":
      return "The report details are not valid. Check the report type, dates, currency, and file size, then try again.";
    case "report upload file type is invalid":
      return "Only CSV and XLSX files are accepted. Choose one of those file types and try again.";
    case "idempotency key conflicts with another upload":
      return "This upload request was already used with different details. Start a new upload and try again.";
    default:
      return "The report upload could not be started. Check the selected channel, branch, dates, and file, then try again.";
  }
}

function reportContractProposalFailureMessage(cause: unknown): string {
  const message = messageFromCause(cause);

  switch (message) {
    case "report contract proposal is not authorized":
      return "You do not have permission to save contract proposals. Ask an organization owner or admin for access.";
    case "report contract document is invalid":
      return "The contract document is not valid. Check schemaVersion, currency, outletGrain, sheets, fields, and the unmapped-field setting, then try again.";
    case "report contract sheet rule is invalid":
      return "A sheet rule is not valid. Use the profiled sheet name, header/data rows, formula and merged-cell settings, and at least one field.";
    case "report contract field rule is invalid":
      return "A field rule is not valid. Use normalized field/header names, a supported parser, and an explicit sign for money fields.";
    case "report contract sheet rules are duplicated":
      return "Each sheet may appear only once in the proposal. Remove the duplicate sheet rule and try again.";
    case "report contract does not match its package context":
      return "The proposal currency, outlet grain, or sheet count does not match this report package. Check the package profile and try again.";
    case "report contract sheet does not match package structure":
      return "The sheet rule does not match the profiled report structure. Use the exact sheet name and profiled formula/merged-cell settings.";
    case "report contract header row was not profiled":
      return "The selected header row was not profiled. Use a header row shown in the package profile, then try again.";
    case "report contract source header was not profiled":
      return "A source header in the proposal was not found in the profiled report. Use the normalized headers shown in the package profile, then try again.";
    case "report package is not eligible for a contract proposal":
      return "This report is not ready for a contract proposal. Wait for profiling to finish, refresh the page, and try again.";
    case "idempotency key conflicts with another contract proposal":
      return "This proposal request was already used with different details. Start a new proposal and try again.";
    default:
      return "The contract proposal could not be saved. Check the package profile and mapping document, then try again.";
  }
}

function reportProjectionProposalFailureMessage(cause: unknown): string {
  const message = messageFromCause(cause);

  switch (message) {
    case "report projection proposal is not authorized":
      return "You do not have permission to save projection declarations. Ask an organization owner or admin for access.";
    case "report contract version is not approved":
      return "Choose an approved contract version before saving a projection declaration.";
    case "report projection document is invalid":
      return "The projection declaration is not valid. Use exact_range with one or more sum outputs and no extra fields.";
    case "report projection output rule is invalid":
      return "A projection output is not valid. Use the exact sheet and field names from the approved contract, a registered metric key, and valueKind money or count.";
    case "report projection outputs are duplicated":
      return "Each projection output, metric, and source field may be used only once. Remove the duplicate and try again.";
    case "report projection does not match approved required contract field":
      return "A projection source does not match the approved contract. Use the exact normalized sheet identity and a required field with the matching money or count type.";
    case "report projection metric definition is invalid":
      return "The selected metric is not an active sum metric with the same value type. Choose a registered metric such as revenue.gross for money or transactions.count for count.";
    case "idempotency key conflicts with another projection proposal":
      return "This projection proposal request was already used with different details. Start a new proposal and try again.";
    default:
      return "The projection declaration could not be saved. Check the approved sheet and required field identities, value type, and registered metric key, then try again.";
  }
}

function reportOverlapResolutionFailureMessage(cause: unknown): string {
  if (messageFromCause(cause) === "report overlap resolution is not authorized") {
    return "You do not have permission to resolve this overlap. Ask an organization owner or admin to review it.";
  }
  return "The overlap could not be resolved. Refresh the evidence and try again.";
}

export function createAuthenticatedReportPackageRepository(
  supabase: AuthenticatedClient,
): ReportPackageRepository {
  return {
    async listSnapshot({ organizationId }) {
      const [
        packages,
        sheetManifests,
        contracts,
        contractVersions,
        contractDecisions,
        contractBindings,
        validationRuns,
        validationSheetResults,
        validationControlResults,
        projectionVersions,
        projectionDecisions,
        projectionBindings,
        projectionRuns,
        reconciliations,
        reconciliationResolutions,
        exactRangeObservations,
        channels,
        branches,
      ] = await Promise.all([
        supabase
          .from("integration_report_packages")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("integration_report_sheet_manifests")
          .select(
            "id,organization_id,report_package_id,sheet_position,sheet_name,normalized_sheet_name,row_count,populated_cell_count,expanded_bytes,content_digest,header_candidate_digests,header_candidates,has_formula,has_merged_cells,has_repeated_header,created_at",
          )
          .eq("organization_id", organizationId)
          .order("sheet_position", { ascending: true }),
        supabase
          .from("report_contracts")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false }),
        supabase
          .from("report_contract_versions")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false }),
        supabase
          .from("report_contract_decisions")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false }),
        supabase
          .from("report_contract_bindings")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false }),
        supabase
          .from("integration_report_validation_runs")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("integration_report_validation_sheet_results")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("integration_report_validation_control_results")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(150),
        supabase
          .from("report_projection_versions")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false }),
        supabase
          .from("report_projection_decisions")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false }),
        supabase
          .from("report_projection_bindings")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false }),
        supabase
          .from("integration_report_projection_runs")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("report_projection_reconciliations")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("report_projection_reconciliation_resolutions")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("exact_range_metric_observations")
          .select(
            "id, report_package_id, projection_output_key, period_start, period_end, period_timezone, currency, quality_state, completeness_state, revision, reconciliation_state, reconciliation_digest, superseded_by_id, created_at",
          )
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("organization_channels")
          .select("id, display_name, key, status")
          .eq("organization_id", organizationId)
          .eq("status", "active")
          .order("display_name", { ascending: true }),
        supabase
          .from("branches")
          .select("id, name, timezone, currency, is_active")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("name", { ascending: true }),
      ]);
      const failure = [
        packages,
        sheetManifests,
        contracts,
        contractVersions,
        contractDecisions,
        contractBindings,
        validationRuns,
        validationSheetResults,
        validationControlResults,
        projectionVersions,
        projectionDecisions,
        projectionBindings,
        projectionRuns,
        reconciliations,
        reconciliationResolutions,
        exactRangeObservations,
        channels,
        branches,
      ].find((result) => result.error)?.error;
      if (failure) persistenceFailure("Report packages could not be loaded.", failure);
      return {
        packages: packages.data ?? [],
        sheetManifests: sheetManifests.data ?? [],
        contracts: contracts.data ?? [],
        contractVersions: contractVersions.data ?? [],
        contractDecisions: contractDecisions.data ?? [],
        contractBindings: contractBindings.data ?? [],
        validationRuns: validationRuns.data ?? [],
        validationSheetResults: validationSheetResults.data ?? [],
        validationControlResults: validationControlResults.data ?? [],
        projectionVersions: projectionVersions.data ?? [],
        projectionDecisions: projectionDecisions.data ?? [],
        projectionBindings: projectionBindings.data ?? [],
        projectionRuns: projectionRuns.data ?? [],
        reconciliations: reconciliations.data ?? [],
        reconciliationResolutions: reconciliationResolutions.data ?? [],
        exactRangeObservations: exactRangeObservations.data ?? [],
        channels: channels.data ?? [],
        branches: branches.data ?? [],
      };
    },

    async findPackage({ organizationId, packageId }) {
      const { data, error } = await supabase
        .from("integration_report_packages")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", packageId)
        .maybeSingle();
      if (error) persistenceFailure("Report package access could not be checked.", error);
      return data;
    },

    async findContractVersion({ organizationId, contractVersionId }) {
      const { data, error } = await supabase
        .from("report_contract_versions")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", contractVersionId)
        .maybeSingle();
      if (error) persistenceFailure("Report contract access could not be checked.", error);
      return data;
    },

    async startUpload({ organizationId, actorId, correlationId, body }) {
      const { data, error } = await supabase.rpc("start_governed_report_package_upload", {
        p_organization_id: organizationId,
        p_actor_id: actorId,
        p_channel_id: body.channelId,
        p_branch_id: body.branchId,
        p_report_type: body.reportType,
        p_period_start: body.periodStart,
        p_period_end: body.periodEnd,
        p_currency: body.currency,
        p_file_kind: body.fileKind,
        p_original_filename: body.originalFilename,
        p_content_type: body.contentType,
        p_content_length: body.contentLength,
        p_idempotency_key: body.idempotencyKey,
        p_correlation_id: correlationId,
      });
      if (error || !data) persistenceFailure(reportUploadFailureMessage(error), error);
      return data;
    },

    async createSignedResumableUpload({ storagePath }) {
      const { data, error } = await supabase.storage
        .from("governed-report-packages")
        .createSignedUploadUrl(storagePath, { upsert: false });
      if (error || !data?.token)
        persistenceFailure("A secure upload link could not be created.", error);
      return { token: data.token, signedUrl: data.signedUrl };
    },

    async completeUpload({ organizationId, actorId, packageId, idempotencyKey, correlationId }) {
      const { data, error } = await supabase.rpc("complete_governed_report_package_upload", {
        p_organization_id: organizationId,
        p_actor_id: actorId,
        p_report_package_id: packageId,
        p_idempotency_key: idempotencyKey,
        p_correlation_id: correlationId,
      });
      if (error || !data) persistenceFailure("The report upload could not be verified.", error);
      return data;
    },

    async retryProfiling({ organizationId, actorId, packageId, idempotencyKey, correlationId }) {
      const { data, error } = await supabase.rpc("retry_governed_report_package_profiling", {
        p_organization_id: organizationId,
        p_actor_id: actorId,
        p_report_package_id: packageId,
        p_idempotency_key: idempotencyKey,
        p_correlation_id: correlationId,
      });
      if (error || !data) persistenceFailure("The report package could not be retried.", error);
      return data;
    },

    async retryValidation({ organizationId, actorId, packageId, idempotencyKey, correlationId }) {
      const { data, error } = await supabase.rpc("retry_governed_report_package_validation", {
        p_organization_id: organizationId,
        p_actor_id: actorId,
        p_report_package_id: packageId,
        p_idempotency_key: idempotencyKey,
        p_correlation_id: correlationId,
      });
      if (error || !data) persistenceFailure("The report validation could not be retried.", error);
      return data;
    },

    async proposeContract({
      organizationId,
      actorId,
      packageId,
      mappingDocument,
      proposalSource,
      providerDefinitionKey,
      idempotencyKey,
      correlationId,
    }) {
      const { data, error } = await supabase.rpc("propose_governed_report_contract", {
        p_organization_id: organizationId,
        p_actor_id: actorId,
        p_report_package_id: packageId,
        p_mapping_document: mappingDocument,
        p_idempotency_key: idempotencyKey,
        p_correlation_id: correlationId,
        p_proposal_source: proposalSource,
        p_provider_definition_key: providerDefinitionKey,
      });
      if (error || !data) persistenceFailure(reportContractProposalFailureMessage(error), error);
      return data;
    },

    async decideContract({
      organizationId,
      actorId,
      contractVersionId,
      decision,
      reason,
      idempotencyKey,
      correlationId,
    }) {
      const { data, error } = await supabase.rpc("decide_governed_report_contract", {
        p_organization_id: organizationId,
        p_actor_id: actorId,
        p_report_contract_version_id: contractVersionId,
        p_decision: decision,
        p_reason: reason ?? null,
        p_idempotency_key: idempotencyKey,
        p_correlation_id: correlationId,
      });
      if (error || !data) persistenceFailure("The contract decision could not be saved.", error);
      return data;
    },

    async proposeProjection({
      organizationId,
      actorId,
      contractVersionId,
      projectionDocument,
      proposalSource,
      providerDefinitionKey,
      idempotencyKey,
      correlationId,
    }) {
      const { data, error } = await supabase.rpc("propose_governed_report_projection", {
        p_organization_id: organizationId,
        p_actor_id: actorId,
        p_report_contract_version_id: contractVersionId,
        p_projection_document: projectionDocument,
        p_idempotency_key: idempotencyKey,
        p_correlation_id: correlationId,
        p_proposal_source: proposalSource,
        p_provider_definition_key: providerDefinitionKey,
      });
      if (error || !data) persistenceFailure(reportProjectionProposalFailureMessage(error), error);
      return data;
    },

    async decideProjection({
      organizationId,
      actorId,
      projectionVersionId,
      decision,
      reason,
      idempotencyKey,
      correlationId,
    }) {
      const { data, error } = await supabase.rpc("decide_governed_report_projection", {
        p_organization_id: organizationId,
        p_actor_id: actorId,
        p_report_projection_version_id: projectionVersionId,
        p_decision: decision,
        p_reason: reason ?? null,
        p_idempotency_key: idempotencyKey,
        p_correlation_id: correlationId,
      });
      if (error || !data) persistenceFailure("The projection decision could not be saved.", error);
      return data;
    },

    async requestProjection({ organizationId, actorId, packageId, idempotencyKey, correlationId }) {
      const { data, error } = await supabase.rpc("request_governed_report_package_projection", {
        p_organization_id: organizationId,
        p_actor_id: actorId,
        p_report_package_id: packageId,
        p_idempotency_key: idempotencyKey,
        p_correlation_id: correlationId,
      });
      const payload = data as {
        reportPackage?: unknown;
        reportProjectionVersionId?: unknown;
      } | null;
      if (
        error ||
        !payload ||
        !payload.reportPackage ||
        typeof payload.reportProjectionVersionId !== "string"
      )
        persistenceFailure("The package could not be queued for projection.", error);
      const { data: projectionVersion, error: projectionError } = await supabase
        .from("report_projection_versions")
        .select("report_contract_version_id")
        .eq("organization_id", organizationId)
        .eq("id", payload.reportProjectionVersionId)
        .maybeSingle();
      if (projectionError || !projectionVersion)
        persistenceFailure("The projection binding could not be loaded.", projectionError);
      return {
        reportPackage: payload.reportPackage as never,
        projectionVersionId: payload.reportProjectionVersionId,
        contractVersionId: projectionVersion.report_contract_version_id,
      };
    },

    async resolveProjectionOverlap({
      organizationId,
      actorId,
      reconciliationId,
      resolution,
      idempotencyKey,
      correlationId,
    }) {
      const { data, error } = await supabase.rpc("resolve_governed_report_projection_overlap", {
        p_organization_id: organizationId,
        p_actor_id: actorId,
        p_reconciliation_id: reconciliationId,
        p_resolution: resolution,
        p_idempotency_key: idempotencyKey,
        p_correlation_id: correlationId,
      });
      if (error || !data) persistenceFailure(reportOverlapResolutionFailureMessage(error), error);
      return data;
    },
  };
}
