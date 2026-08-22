import { z } from "zod";

import {
  reportFileKindFromFilename,
  type ReportPackageUploadIntent,
} from "@/domain/reports/schemas";
import { findProviderReportDefinition } from "@/domain/reports/provider-library";
import type {
  proposeReportContractSchema,
  proposeReportProjectionSchema,
} from "@/domain/reports/schemas";
import { hasReportPermission } from "@/domain/reports/permissions";
import { DomainError } from "@/lib/errors";
import type { OrganizationRole } from "@/domain/organizations/types";
import type { ReportPackageRepository } from "@/modules/reports/application/ports";

export type ReportContractProposal = z.output<typeof proposeReportContractSchema>;
export type ReportProjectionProposal = z.output<typeof proposeReportProjectionSchema>;

/**
 * The checked-in definition a proposal named, or a refusal.
 *
 * A key nobody recognises is the caller's mistake, not a reason to fall back to
 * something similar. Adopting the wrong known mapping would be silent and
 * wrong, where a refusal is neither.
 */
function requireDefinition(key: string) {
  const definition = findProviderReportDefinition(key);
  if (!definition) {
    throw new DomainError("VALIDATION_ERROR", "That report family is not one this platform knows.");
  }
  return definition;
}

export type AuthenticatedReportContext = {
  organizationId: string;
  actorId: string;
  role: OrganizationRole;
  correlationId: string;
};

const packageIdSchema = z.string().uuid();

function assertPermission(
  context: AuthenticatedReportContext,
  permission: "report.read" | "report.upload" | "report.retry" | "report.contract_approve",
) {
  if (!hasReportPermission(context.role, permission)) {
    throw new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have permission for this report action.",
    );
  }
}

export function createReportPackageService(repository: ReportPackageRepository) {
  return {
    async listSnapshot(context: AuthenticatedReportContext) {
      assertPermission(context, "report.read");
      return repository.listSnapshot({ organizationId: context.organizationId });
    },

    async findContractVersion(context: AuthenticatedReportContext, contractVersionId: string) {
      assertPermission(context, "report.contract_approve");
      return repository.findContractVersion({
        organizationId: context.organizationId,
        contractVersionId: packageIdSchema.parse(contractVersionId),
      });
    },

    async beginUpload(context: AuthenticatedReportContext, body: ReportPackageUploadIntent) {
      assertPermission(context, "report.upload");
      const packageRow = await repository.startUpload({
        organizationId: context.organizationId,
        actorId: context.actorId,
        correlationId: context.correlationId,
        body: { ...body, fileKind: reportFileKindFromFilename(body.originalFilename) },
      });
      const upload = await repository.createSignedResumableUpload({
        storagePath: packageRow.storage_path,
      });
      return { package: packageRow, upload };
    },

    async completeUpload(
      context: AuthenticatedReportContext,
      packageId: string,
      idempotencyKey: string,
    ) {
      assertPermission(context, "report.upload");
      return repository.completeUpload({
        organizationId: context.organizationId,
        actorId: context.actorId,
        packageId: packageIdSchema.parse(packageId),
        idempotencyKey,
        correlationId: context.correlationId,
      });
    },

    async retryProfiling(
      context: AuthenticatedReportContext,
      packageId: string,
      idempotencyKey: string,
    ) {
      assertPermission(context, "report.retry");
      return repository.retryProfiling({
        organizationId: context.organizationId,
        actorId: context.actorId,
        packageId: packageIdSchema.parse(packageId),
        idempotencyKey,
        correlationId: context.correlationId,
      });
    },

    async retryValidation(
      context: AuthenticatedReportContext,
      packageId: string,
      idempotencyKey: string,
    ) {
      assertPermission(context, "report.retry");
      return repository.retryValidation({
        organizationId: context.organizationId,
        actorId: context.actorId,
        packageId: packageIdSchema.parse(packageId),
        idempotencyKey,
        correlationId: context.correlationId,
      });
    },

    async proposeContract(
      context: AuthenticatedReportContext,
      packageId: string,
      proposal: ReportContractProposal,
      idempotencyKey: string,
    ) {
      assertPermission(context, "report.contract_approve");
      // A library proposal carries a key, never a document. The document is
      // read from the checked-in definition here, so what gets recorded as
      // library-sourced is what the library actually says.
      const resolved =
        proposal.source === "library"
          ? {
              mappingDocument: requireDefinition(proposal.providerDefinitionKey).contract,
              providerDefinitionKey: proposal.providerDefinitionKey,
            }
          : { mappingDocument: proposal.mappingDocument, providerDefinitionKey: null };
      return repository.proposeContract({
        organizationId: context.organizationId,
        actorId: context.actorId,
        packageId: packageIdSchema.parse(packageId),
        mappingDocument: resolved.mappingDocument,
        proposalSource: proposal.source,
        providerDefinitionKey: resolved.providerDefinitionKey,
        idempotencyKey,
        correlationId: context.correlationId,
      });
    },

    async decideContract(
      context: AuthenticatedReportContext,
      contractVersionId: string,
      decision: "approved" | "rejected",
      reason: string | undefined,
      idempotencyKey: string,
    ) {
      assertPermission(context, "report.contract_approve");
      return repository.decideContract({
        organizationId: context.organizationId,
        actorId: context.actorId,
        contractVersionId: packageIdSchema.parse(contractVersionId),
        decision,
        reason,
        idempotencyKey,
        correlationId: context.correlationId,
      });
    },

    async proposeProjection(
      context: AuthenticatedReportContext,
      contractVersionId: string,
      proposal: ReportProjectionProposal,
      idempotencyKey: string,
    ) {
      assertPermission(context, "report.contract_approve");
      const resolved =
        proposal.source === "library"
          ? {
              projectionDocument: requireDefinition(proposal.providerDefinitionKey).projection,
              providerDefinitionKey: proposal.providerDefinitionKey,
            }
          : { projectionDocument: proposal.projectionDocument, providerDefinitionKey: null };
      return repository.proposeProjection({
        organizationId: context.organizationId,
        actorId: context.actorId,
        contractVersionId: packageIdSchema.parse(contractVersionId),
        projectionDocument: resolved.projectionDocument,
        proposalSource: proposal.source,
        providerDefinitionKey: resolved.providerDefinitionKey,
        idempotencyKey,
        correlationId: context.correlationId,
      });
    },

    async decideProjection(context: AuthenticatedReportContext, projectionVersionId: string, decision: "approved" | "rejected", reason: string | undefined, idempotencyKey: string) {
      assertPermission(context, "report.contract_approve");
      return repository.decideProjection({ organizationId: context.organizationId, actorId: context.actorId, projectionVersionId: packageIdSchema.parse(projectionVersionId), decision, reason, idempotencyKey, correlationId: context.correlationId });
    },

    async requestProjection(context: AuthenticatedReportContext, packageId: string, idempotencyKey: string) {
      assertPermission(context, "report.retry");
      return repository.requestProjection({ organizationId: context.organizationId, actorId: context.actorId, packageId: packageIdSchema.parse(packageId), idempotencyKey, correlationId: context.correlationId });
    },

    async resolveProjectionOverlap(
      context: AuthenticatedReportContext,
      reconciliationId: string,
      resolution: "accept_correction" | "keep_existing",
      idempotencyKey: string,
    ) {
      assertPermission(context, "report.contract_approve");
      return repository.resolveProjectionOverlap({
        organizationId: context.organizationId,
        actorId: context.actorId,
        reconciliationId: packageIdSchema.parse(reconciliationId),
        resolution,
        idempotencyKey,
        correlationId: context.correlationId,
      });
    },
  };
}
