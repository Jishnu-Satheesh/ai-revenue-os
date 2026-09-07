import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveValidationContractVersion } from "@/modules/reports/application/validation-contract-version";

const PACKAGE_ID = "ae99b309-ad74-4654-83d4-db40d2f87965";
const OTHER_PACKAGE_ID = "e3d1a04c-bebf-40a9-a741-a2e857385472";
const ADMISSION_ID = "99d434ab-205a-4692-a03d-654b33e33906";
const ADMITTED_VERSION_ID = "91a9dfca-c8ad-4a7f-9631-2a28128e7cd1";
const RUN_VERSION_ID = "f6518c2a-8504-47c9-975c-9d38c0f29ecb";

const noAdmission = vi.fn(async () => null);

function input(overrides: Partial<Parameters<typeof resolveValidationContractVersion>[0]> = {}) {
  return {
    packageId: PACKAGE_ID,
    admittedUnderAdmissionId: null,
    validationRuns: [],
    contractVersions: [],
    contractDecisions: [],
    ...overrides,
  };
}

describe("resolveValidationContractVersion", () => {
  it("uses the latest validation run for a package that already has one", async () => {
    const result = await resolveValidationContractVersion(
      input({
        validationRuns: [
          { report_package_id: PACKAGE_ID, report_contract_version_id: RUN_VERSION_ID },
        ],
      }),
      noAdmission,
    );

    expect(result).toEqual({ source: "validation_run", contractVersionId: RUN_VERSION_ID });
    expect(noAdmission).not.toHaveBeenCalled();
  });

  /**
   * The defect this function exists to fix. ADR 0046 approves a structure
   * once, so a later upload of that same structure is admitted without any
   * contract version of its own. Resolving only through
   * `report_package_id === packageId` finds nothing for such a package, and
   * the operator's "Start validation" press dispatched nothing at all.
   */
  it("falls back to the admission a package was admitted under", async () => {
    const lookup = vi.fn(async (admissionId: string) =>
      admissionId === ADMISSION_ID ? { contractVersionId: ADMITTED_VERSION_ID } : null,
    );

    const result = await resolveValidationContractVersion(
      input({
        admittedUnderAdmissionId: ADMISSION_ID,
        // The approved version belongs to the earlier upload the structure
        // was approved on, exactly as staging records it.
        contractVersions: [{ id: ADMITTED_VERSION_ID, report_package_id: OTHER_PACKAGE_ID }],
        contractDecisions: [
          { report_contract_version_id: ADMITTED_VERSION_ID, decision: "approved" },
        ],
      }),
      lookup,
    );

    expect(result).toEqual({ source: "admission", contractVersionId: ADMITTED_VERSION_ID });
    expect(lookup).toHaveBeenCalledWith(ADMISSION_ID);
  });

  it("uses an approved contract version proposed from this exact package", async () => {
    const result = await resolveValidationContractVersion(
      input({
        contractVersions: [{ id: ADMITTED_VERSION_ID, report_package_id: PACKAGE_ID }],
        contractDecisions: [
          { report_contract_version_id: ADMITTED_VERSION_ID, decision: "approved" },
        ],
      }),
      noAdmission,
    );

    expect(result).toEqual({ source: "package_contract", contractVersionId: ADMITTED_VERSION_ID });
  });

  it("ignores a contract version this package never had approved", async () => {
    const result = await resolveValidationContractVersion(
      input({
        contractVersions: [{ id: ADMITTED_VERSION_ID, report_package_id: PACKAGE_ID }],
        contractDecisions: [
          { report_contract_version_id: ADMITTED_VERSION_ID, decision: "rejected" },
        ],
      }),
      noAdmission,
    );

    expect(result).toEqual({ source: "unresolved" });
  });

  it("stays unresolved when a recorded admission cannot be read", async () => {
    const result = await resolveValidationContractVersion(
      input({ admittedUnderAdmissionId: ADMISSION_ID }),
      async () => null,
    );

    expect(result).toEqual({ source: "unresolved" });
  });

  it("never borrows another package's validation run", async () => {
    const result = await resolveValidationContractVersion(
      input({
        validationRuns: [
          { report_package_id: OTHER_PACKAGE_ID, report_contract_version_id: RUN_VERSION_ID },
        ],
      }),
      noAdmission,
    );

    expect(result).toEqual({ source: "unresolved" });
  });
});
