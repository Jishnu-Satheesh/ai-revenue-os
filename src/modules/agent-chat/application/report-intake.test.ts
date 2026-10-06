import { describe, expect, it } from "vitest";

import { classifyReportAttachment } from "./report-intake";

const scope = {
  channelId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
  reportType: "Talabat sales",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  currency: "AED",
};

const prior = {
  id: "33333333-3333-4333-8333-333333333333",
  ...scope,
  digest: "a".repeat(64),
};

describe("report attachment classification", () => {
  it("asks for missing scope before deciding whether bytes are reusable", () => {
    expect(classifyReportAttachment({ digest: prior.digest, scope: null, priorPackages: [prior] }))
      .toEqual({ kind: "metadata_required" });
  });

  it("reuses only the same bytes in the same declared scope", () => {
    expect(classifyReportAttachment({ digest: prior.digest, scope, priorPackages: [prior] }))
      .toEqual({ kind: "exact_duplicate", packageId: prior.id });
    expect(classifyReportAttachment({
      digest: prior.digest,
      scope: { ...scope, branchId: "44444444-4444-4444-8444-444444444444" },
      priorPackages: [prior],
    })).toEqual({ kind: "new" });
  });

  it("requires a correction decision for changed bytes in an equal scope", () => {
    expect(classifyReportAttachment({ digest: "b".repeat(64), scope, priorPackages: [prior] }))
      .toEqual({ kind: "correction_required", priorPackageId: prior.id });
  });

  it("does not treat a report with an unverified digest as an exact duplicate", () => {
    expect(classifyReportAttachment({ digest: prior.digest, scope, priorPackages: [{ ...prior, digest: null }] }))
      .toEqual({ kind: "correction_required", priorPackageId: prior.id });
  });
});
