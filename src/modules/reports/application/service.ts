import { z } from "zod";

import {
  reportFileKindFromFilename,
  type ReportPackageUploadIntent,
} from "@/domain/reports/schemas";
import {
  buildGuidedContractDocument,
  buildGuidedProjectionDocument,
  GuidedProjectionUndecidable,
} from "@/domain/reports/guided-mapping";
import { findProviderReportDefinition } from "@/domain/reports/provider-library";
import { reportContractDocumentSchema } from "@/domain/reports/contracts";
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


/**
 * Where a proposed shape came from, and what provenance to record for it.
 *
 * The request's `source` and the recorded `proposalSource` are deliberately
 * different vocabularies. A guided mapping is recorded as hand-authored,
 * because it is: the platform assembled the JSON, but a person answered every
 * question in it. Only a shape lifted whole from a checked-in artifact is
 * `library`, and only that names a definition.
 */
type ResolvedContractProposal = {
  mappingDocument: unknown;
  proposalSource: "human" | "library";
  providerDefinitionKey: string | null;
};


async function resolveContractProposal(
  context: AuthenticatedReportContext,
  packageId: string,
  proposal: ReportContractProposal,
  repository: ReportPackageRepository,
): Promise<ResolvedContractProposal> {
  if (proposal.source === "library") {
    return {
      mappingDocument: requireDefinition(proposal.providerDefinitionKey).contract,
      proposalSource: "library",
      providerDefinitionKey: proposal.providerDefinitionKey,
    };
  }
  if (proposal.source === "guided") {
    const reportPackage = await repository.findPackage({
      organizationId: context.organizationId,
      packageId,
    });
    if (!reportPackage) {
      throw new DomainError("VALIDATION_ERROR", "That upload is not available to map.");
    }
    return {
      // The currency is the package's, never the caller's. An operator
      // answering questions about columns is not choosing what money this is.
      mappingDocument: buildGuidedContractDocument({
        answers: proposal.guided,
        declaredCurrency: reportPackage.declared_currency,
      }),
      proposalSource: "human",
      providerDefinitionKey: null,
    };
  }
  return {
    mappingDocument: proposal.mappingDocument,
    proposalSource: "human",
    providerDefinitionKey: null,
  };
}

async function resolveProjectionProposal(
  context: AuthenticatedReportContext,
  contractVersionId: string,
  proposal: ReportProjectionProposal,
  repository: ReportPackageRepository,
): Promise<{
  projectionDocument: unknown;
  proposalSource: "human" | "library";
  providerDefinitionKey: string | null;
}> {
  if (proposal.source === "library") {
    return {
      projectionDocument: requireDefinition(proposal.providerDefinitionKey).projection,
      proposalSource: "library",
      providerDefinitionKey: proposal.providerDefinitionKey,
    };
  }
  if (proposal.source === "guided") {
    const version = await repository.findContractVersion({
      organizationId: context.organizationId,
      contractVersionId,
    });
    if (!version) {
      throw new DomainError("VALIDATION_ERROR", "That approved mapping is not available.");
    }
    // Derived from the approved contract rather than from the operator's
    // answers a second time, so whatever an owner approved is exactly what
    // gets read. Answers given twice could differ; a contract cannot.
    try {
      return {
        projectionDocument: buildGuidedProjectionDocument(
          reportContractDocumentSchema.parse(version.mapping_document),
        ),
        proposalSource: "human",
        providerDefinitionKey: null,
      };
    } catch (error) {
      // The operator can act on this one: it names what is ambiguous about
      // their own mapping. Anything else is not theirs to fix.
      if (error instanceof GuidedProjectionUndecidable) {
        throw new DomainError("VALIDATION_ERROR", error.message);
      }
      throw error;
    }
  }
  return {
    projectionDocument: proposal.projectionDocument,
    proposalSource: "human",
    providerDefinitionKey: null,
  };
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
      const resolvedPackageId = packageIdSchema.parse(packageId);
      const resolved = await resolveContractProposal(context, resolvedPackageId, proposal, repository);
      return repository.proposeContract({
        organizationId: context.organizationId,
        actorId: context.actorId,
        packageId: resolvedPackageId,
        mappingDocument: resolved.mappingDocument,
        proposalSource: resolved.proposalSource,
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
      const resolvedVersionId = packageIdSchema.parse(contractVersionId);
      const resolved = await resolveProjectionProposal(context, resolvedVersionId, proposal, repository);
      return repository.proposeProjection({
        organizationId: context.organizationId,
        actorId: context.actorId,
        contractVersionId: resolvedVersionId,
        projectionDocument: resolved.projectionDocument,
        proposalSource: resolved.proposalSource,
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

    async resolveProjectionOverlapGroup(
      context: AuthenticatedReportContext,
      reconciliationId: string,
      resolution: "accept_correction" | "keep_existing",
      idempotencyKey: string,
    ) {
      assertPermission(context, "report.contract_approve");
      return repository.resolveProjectionOverlapGroup({
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
