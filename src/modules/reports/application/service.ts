import { z } from "zod";

import {
  reportFileKindFromFilename,
  type ReportPackageUploadIntent,
} from "@/domain/reports/schemas";
import type { ReportContractDocument } from "@/domain/reports/contracts";
import type { ReportProjectionDocument } from "@/domain/reports/projection";
import { hasReportPermission } from "@/domain/reports/permissions";
import { DomainError } from "@/lib/errors";
import type { OrganizationRole } from "@/domain/organizations/types";
import type { ReportPackageRepository } from "@/modules/reports/application/ports";

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
      mappingDocument: ReportContractDocument,
      idempotencyKey: string,
    ) {
      assertPermission(context, "report.contract_approve");
      return repository.proposeContract({
        organizationId: context.organizationId,
        actorId: context.actorId,
        packageId: packageIdSchema.parse(packageId),
        mappingDocument,
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

    async proposeProjection(context: AuthenticatedReportContext, contractVersionId: string, projectionDocument: ReportProjectionDocument, idempotencyKey: string) {
      assertPermission(context, "report.contract_approve");
      return repository.proposeProjection({ organizationId: context.organizationId, actorId: context.actorId, contractVersionId: packageIdSchema.parse(contractVersionId), projectionDocument, idempotencyKey, correlationId: context.correlationId });
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
