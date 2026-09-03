import type { ReportFileKind } from "@/domain/reports/types";
import type { Database } from "@/lib/supabase/database.types";

export type ReportPackageRow = Database["public"]["Tables"]["integration_report_packages"]["Row"];
export type ReportSheetManifestRow =
  Database["public"]["Tables"]["integration_report_sheet_manifests"]["Row"];
export type ReportSheetManifestSummary = Pick<
  ReportSheetManifestRow,
  | "id"
  | "organization_id"
  | "report_package_id"
  | "sheet_position"
  | "sheet_name"
  | "normalized_sheet_name"
  | "row_count"
  | "populated_cell_count"
  | "expanded_bytes"
  | "content_digest"
  | "header_candidate_digests"
  | "header_candidates"
  | "has_formula"
  | "has_merged_cells"
  | "has_repeated_header"
  | "created_at"
>;
export type ReportContractRow = Database["public"]["Tables"]["report_contracts"]["Row"];
export type ReportContractVersionRow =
  Database["public"]["Tables"]["report_contract_versions"]["Row"];
export type ReportContractDecisionRow =
  Database["public"]["Tables"]["report_contract_decisions"]["Row"];
export type ReportContractBindingRow =
  Database["public"]["Tables"]["report_contract_bindings"]["Row"];
export type ReportValidationRunRow =
  Database["public"]["Tables"]["integration_report_validation_runs"]["Row"];
export type ReportValidationSheetResultRow =
  Database["public"]["Tables"]["integration_report_validation_sheet_results"]["Row"];
export type ReportValidationControlResultRow =
  Database["public"]["Tables"]["integration_report_validation_control_results"]["Row"];
export type ReportProjectionVersionRow =
  Database["public"]["Tables"]["report_projection_versions"]["Row"];
export type ReportProjectionDecisionRow =
  Database["public"]["Tables"]["report_projection_decisions"]["Row"];
export type ReportProjectionBindingRow =
  Database["public"]["Tables"]["report_projection_bindings"]["Row"];
export type ReportProjectionRunRow =
  Database["public"]["Tables"]["integration_report_projection_runs"]["Row"];
export type ReportStructureAdmissionRow =
  Database["public"]["Tables"]["report_structure_admissions"]["Row"];
export type ReportProjectionReconciliationGroup = {
  representative_reconciliation_id: string;
  organization_id: string;
  report_package_id: string;
  projection_run_id: string;
  projection_output_key: string;
  projection_target: "exact_range" | "period_grain";
  metric_key: string | null;
  normalized_sheet_name: string | null;
  canonical_field: string | null;
  source_header: string | null;
  affected_record_count: number;
  matching_record_count: number;
  affected_dates: string[];
  affected_dates_truncated: boolean;
  first_period: string | null;
  last_period: string | null;
  prior_upload_count: number;
  prior_report_type: string | null;
  prior_period_start: string | null;
  prior_period_end: string | null;
};
export type ReportChannelChoice = Pick<
  Database["public"]["Tables"]["organization_channels"]["Row"],
  "id" | "display_name" | "key" | "status"
>;
export type ReportBranchChoice = Pick<
  Database["public"]["Tables"]["branches"]["Row"],
  "id" | "name" | "timezone" | "currency" | "is_active"
>;

export type ReportPackageSnapshot = {
  packages: ReportPackageRow[];
  sheetManifests: ReportSheetManifestSummary[];
  contracts: ReportContractRow[];
  contractVersions: ReportContractVersionRow[];
  contractDecisions: ReportContractDecisionRow[];
  contractBindings: ReportContractBindingRow[];
  validationRuns: ReportValidationRunRow[];
  validationSheetResults: ReportValidationSheetResultRow[];
  validationControlResults: ReportValidationControlResultRow[];
  projectionVersions: ReportProjectionVersionRow[];
  projectionDecisions: ReportProjectionDecisionRow[];
  projectionBindings: ReportProjectionBindingRow[];
  projectionRuns: ReportProjectionRunRow[];
  reconciliationGroups: ReportProjectionReconciliationGroup[];
  channels: ReportChannelChoice[];
  branches: ReportBranchChoice[];
};

export type ReportPackageRepository = {
  listSnapshot(input: { organizationId: string }): Promise<ReportPackageSnapshot>;
  findPackage(input: {
    organizationId: string;
    packageId: string;
  }): Promise<ReportPackageRow | null>;
  findContractVersion(input: {
    organizationId: string;
    contractVersionId: string;
  }): Promise<ReportContractVersionRow | null>;
  startUpload(input: {
    organizationId: string;
    actorId: string;
    correlationId: string;
    body: {
      channelId: string;
      branchId: string;
      reportType: string;
      periodStart: string;
      periodEnd: string;
      currency: string;
      fileKind: ReportFileKind;
      originalFilename: string;
      contentType: string;
      contentLength: number;
      idempotencyKey: string;
    };
  }): Promise<ReportPackageRow>;
  createSignedResumableUpload(input: {
    storagePath: string;
  }): Promise<{ token: string; signedUrl: string }>;
  completeUpload(input: {
    organizationId: string;
    actorId: string;
    packageId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ReportPackageRow>;
  retryProfiling(input: {
    organizationId: string;
    actorId: string;
    packageId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ReportPackageRow>;
  retryValidation(input: {
    organizationId: string;
    actorId: string;
    packageId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ReportPackageRow>;
  proposeContract(input: {
    organizationId: string;
    actorId: string;
    packageId: string;
    mappingDocument: unknown;
    /**
     * Where the shape came from. Stated by the server, never by the caller: the
     * document behind a `library` proposal is built from the checked-in
     * definition itself, so a hand-written one cannot arrive wearing its name.
     */
    proposalSource: "human" | "library";
    providerDefinitionKey: string | null;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ReportContractVersionRow>;
  decideContract(input: {
    organizationId: string;
    actorId: string;
    contractVersionId: string;
    decision: "approved" | "rejected";
    reason?: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ReportContractDecisionRow>;
  proposeProjection(input: {
    organizationId: string;
    actorId: string;
    contractVersionId: string;
    projectionDocument: unknown;
    proposalSource: "human" | "library";
    providerDefinitionKey: string | null;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ReportProjectionVersionRow>;
  decideProjection(input: {
    organizationId: string;
    actorId: string;
    projectionVersionId: string;
    decision: "approved" | "rejected";
    reason?: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<ReportProjectionDecisionRow>;
  requestProjection(input: {
    organizationId: string;
    actorId: string;
    packageId: string;
    idempotencyKey: string;
    correlationId: string;
  }): Promise<{
    reportPackage: ReportPackageRow;
    projectionVersionId: string;
    contractVersionId: string;
  }>;
  resolveProjectionOverlap(input: {
    organizationId: string;
    actorId: string;
    reconciliationId: string;
    resolution: "accept_correction" | "keep_existing";
    idempotencyKey: string;
    correlationId: string;
  }): Promise<Record<string, unknown>>;
  resolveProjectionOverlapGroup(input: {
    organizationId: string;
    actorId: string;
    reconciliationId: string;
    resolution: "accept_correction" | "keep_existing";
    idempotencyKey: string;
    correlationId: string;
  }): Promise<Record<string, unknown>>;
};
