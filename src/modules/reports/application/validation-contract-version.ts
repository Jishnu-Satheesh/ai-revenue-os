import "server-only";

/**
 * Which approved contract version governs a package that is about to be
 * validated, and where that answer came from.
 *
 * The provenance is carried, not just the id, because the caller has to tell
 * an operator something true when there is no answer -- "this upload has no
 * approved structure" is a different problem from "the feature is off", and
 * the two used to reach the screen as the same sentence.
 */
export type ValidationContractVersionResolution =
  | { source: "validation_run" | "admission" | "package_contract"; contractVersionId: string }
  | { source: "unresolved" };

type ValidationRunLike = { report_package_id: string; report_contract_version_id: string };
type ContractVersionLike = { id: string; report_package_id: string };
type ContractDecisionLike = { report_contract_version_id: string; decision: string };

/**
 * Resolve the contract version to dispatch validation with.
 *
 * Three sources, in the order of how directly each one describes *this*
 * upload:
 *
 * 1. A validation run this package already has. The claim RPC wrote that id
 *    itself when it last acquired the package, so it is the most accurate
 *    record of what was actually validated, on both the per-package and the
 *    admission path. Retries after a failure land here.
 * 2. The standing admission the package was admitted under. ADR 0046 approves
 *    a *structure* once, so a later upload of that same structure has no
 *    contract version of its own -- the approved version belongs to whichever
 *    earlier upload a person reviewed. Looked up by the id the package
 *    already recorded rather than by re-matching an active admission, for the
 *    same reason `advance_governed_report_package_on_admission`'s replay
 *    branch does: revoking an admission governs future uploads, not one that
 *    already went through.
 * 3. An approved contract version proposed from this exact package -- the
 *    ordinary per-upload human approval path.
 *
 * Nothing here grants anything. Every id this returns is one a person already
 * approved, and `claim_governed_report_package_validation` re-checks the
 * approval, the binding, the currency, the channel and the object identity
 * before a single row is read. This function only decides which already
 * approved id to name in the dispatch.
 */
export async function resolveValidationContractVersion(
  input: {
    packageId: string;
    admittedUnderAdmissionId: string | null;
    validationRuns: readonly ValidationRunLike[];
    contractVersions: readonly ContractVersionLike[];
    contractDecisions: readonly ContractDecisionLike[];
  },
  findAdmissionById: (admissionId: string) => Promise<{ contractVersionId: string } | null>,
): Promise<ValidationContractVersionResolution> {
  const latestRun = input.validationRuns.find((run) => run.report_package_id === input.packageId);
  if (latestRun) {
    return { source: "validation_run", contractVersionId: latestRun.report_contract_version_id };
  }

  if (input.admittedUnderAdmissionId) {
    const admission = await findAdmissionById(input.admittedUnderAdmissionId);
    if (admission) {
      return { source: "admission", contractVersionId: admission.contractVersionId };
    }
    // An admitted package has no per-package contract version to fall back
    // to, so a failed lookup is genuinely unresolved rather than a reason to
    // keep searching.
    return { source: "unresolved" };
  }

  const approved = input.contractVersions.find(
    (version) =>
      version.report_package_id === input.packageId &&
      input.contractDecisions.some(
        (decision) =>
          decision.report_contract_version_id === version.id && decision.decision === "approved",
      ),
  );
  return approved
    ? { source: "package_contract", contractVersionId: approved.id }
    : { source: "unresolved" };
}
