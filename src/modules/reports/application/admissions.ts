import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DomainError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";
import type { ReportStructureAdmissionRow } from "@/modules/reports/application/ports";

type AuthenticatedClient = SupabaseClient<Database>;

/**
 * A standing admission, as far as anything outside this module needs to know
 * about one. Snake-case row fields stay behind this boundary the same way
 * every other report row is translated at its service edge.
 */
export type ReportStructureAdmission = {
  id: string;
  channelId: string;
  structureFingerprint: string;
  reportType: string;
  reportFamilyKey: string | null;
  contractVersionId: string;
  projectionVersionId: string;
  grantedBy: string;
  grantedAt: string;
};

export type AdmissionService = {
  findActiveAdmission(input: {
    organizationId: string;
    channelId: string;
    structureFingerprint: string;
    declaredCurrency: string;
  }): Promise<ReportStructureAdmission | null>;
  /**
   * The admission a package already recorded, deliberately *not* filtered by
   * `active`. Revoking an admission governs future uploads (ADR 0046), not one
   * that already went through it, so a package still carrying
   * `admitted_under_admission_id` must keep resolving to the admission that
   * admitted it -- the same rule
   * `advance_governed_report_package_on_admission`'s replay branch follows.
   */
  findAdmissionById(input: {
    organizationId: string;
    admissionId: string;
  }): Promise<ReportStructureAdmission | null>;
  grantAdmission(input: {
    organizationId: string;
    actorId: string;
    packageId: string;
    contractVersionId: string;
    projectionVersionId: string;
    reportFamilyKey: string | null;
    correlationId: string;
  }): Promise<ReportStructureAdmission>;
};

/**
 * A package the grant RPC refused because profiling never recorded a
 * structure fingerprint for it -- ADR 0046's admission key does not exist
 * yet for this upload. Distinguished from every other grant failure so the
 * route can answer with something an operator can act on (retry profiling)
 * rather than the generic 422 every other rejection gets.
 */
export class UnprofiledReportPackageError extends DomainError {
  constructor(cause?: unknown) {
    super(
      "VALIDATION_ERROR",
      "This upload has not been profiled yet, so it has no structure to grant an admission for. Wait for profiling to finish and try again.",
      cause,
    );
    this.name = "UnprofiledReportPackageError";
  }
}

/**
 * The five RPCs a grant walks through are unrelated write operations, not one
 * transaction, so a double-click must not be able to mint a second contract
 * version, a second projection version, or a second admission. Every key
 * below is a pure function of the package id: the same click, repeated,
 * always produces the same five keys, and each RPC's own idempotency ledger
 * does the rest.
 */
export function admissionIdempotencyKeys(packageId: string) {
  const prefix = `report-structure-admission:${packageId}`;
  return {
    contractPropose: `${prefix}:contract-propose`,
    contractDecide: `${prefix}:contract-decide`,
    projectionPropose: `${prefix}:projection-propose`,
    projectionDecide: `${prefix}:projection-decide`,
    grant: `${prefix}:grant`,
  };
}

function toAdmission(row: ReportStructureAdmissionRow): ReportStructureAdmission {
  return {
    id: row.id,
    channelId: row.channel_id,
    structureFingerprint: row.structure_fingerprint,
    reportType: row.report_type,
    reportFamilyKey: row.report_family_key,
    contractVersionId: row.report_contract_version_id,
    projectionVersionId: row.report_projection_version_id,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
  };
}

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

function grantFailureMessage(cause: unknown): string {
  const message = messageFromCause(cause);
  switch (message) {
    case "report structure admission grant is not authorized":
      return "You do not have permission to grant a standing admission for this report structure. Ask an organization owner or admin for access.";
    case "report package was not found":
      return "That upload is not available to grant.";
    case "report contract version is not an approved proposal for this package":
      return "The contract version is not an approved proposal for this exact upload.";
    case "report projection version is not an approved proposal for this contract version":
      return "The projection version is not an approved proposal for that contract version.";
    case "report contract currency does not match the package currency":
      return "The approved contract's currency does not match this upload's declared currency.";
    case "idempotency key conflicts with another admission grant":
      return "This grant request was already used with different details. Start a new grant and try again.";
    default:
      return "The standing admission could not be granted. Check the approved contract and projection, then try again.";
  }
}

/**
 * `grant_governed_report_structure_admission` is live on staging (see
 * .superpowers/sdd/2026-09-02-governed-report-reuse-phase-1/live-rpcs-task8.md)
 * but is not yet one of the named functions in database.types.ts, and that
 * file is out of scope for this task -- it is hand-maintained and, right now,
 * mid-edit by another agent's unrelated uncommitted work. Widening the
 * client's `rpc` for this one call keeps every argument checked by the
 * compiler without touching that file; get the names right regardless,
 * because nothing else here catches a mismatch before staging does.
 */
type GrantAdmissionRpcArgs = {
  p_organization_id: string;
  p_actor_id: string;
  p_report_package_id: string;
  p_report_contract_version_id: string;
  p_report_projection_version_id: string;
  p_report_family_key: string | null;
  p_idempotency_key: string;
  p_correlation_id: string;
};
type GrantAdmissionRpcResult = {
  data: ReportStructureAdmissionRow | null;
  error: { message?: string; code?: string } | null;
};

export function createAdmissionService(client: AuthenticatedClient): AdmissionService {
  return {
    async findActiveAdmission({ organizationId, channelId, structureFingerprint, declaredCurrency }) {
      const { data, error } = await client
        .from("report_structure_admissions")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("channel_id", channelId)
        .eq("structure_fingerprint", structureFingerprint)
        .eq("declared_currency", declaredCurrency)
        .eq("active", true)
        .maybeSingle();
      if (error) persistenceFailure("The structure admission could not be checked.", error);
      // RLS and the filters above already scope this to the caller's
      // organization. Checking it again here means a future change that
      // drops one of those two safeguards still fails in this function
      // rather than quietly trusting the other -- see AGENTS.md's rule
      // against relying on RLS alone in a service that also reads directly.
      if (!data || data.organization_id !== organizationId) return null;
      return toAdmission(data);
    },

    async findAdmissionById({ organizationId, admissionId }) {
      const { data, error } = await client
        .from("report_structure_admissions")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", admissionId)
        .maybeSingle();
      if (error) persistenceFailure("The structure admission could not be read.", error);
      // Belt and braces alongside RLS, for the reason `findActiveAdmission`
      // gives above.
      if (!data || data.organization_id !== organizationId) return null;
      return toAdmission(data);
    },

    async grantAdmission({
      organizationId,
      actorId,
      packageId,
      contractVersionId,
      projectionVersionId,
      reportFamilyKey,
      correlationId,
    }) {
      const idempotencyKey = admissionIdempotencyKeys(packageId).grant;
      const rpc = client.rpc.bind(client) as unknown as (
        fn: "grant_governed_report_structure_admission",
        args: GrantAdmissionRpcArgs,
      ) => PromiseLike<GrantAdmissionRpcResult>;
      const { data, error } = await rpc("grant_governed_report_structure_admission", {
        p_organization_id: organizationId,
        p_actor_id: actorId,
        p_report_package_id: packageId,
        p_report_contract_version_id: contractVersionId,
        p_report_projection_version_id: projectionVersionId,
        p_report_family_key: reportFamilyKey,
        p_idempotency_key: idempotencyKey,
        p_correlation_id: correlationId,
      });
      if (error?.code === "23514" && error.message === "report package has no recorded structure fingerprint") {
        throw new UnprofiledReportPackageError(error);
      }
      if (error || !data) persistenceFailure(grantFailureMessage(error), error);
      return toAdmission(data);
    },
  };
}
