import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAuthenticatedReportPackageRepository } from "@/modules/reports/infrastructure/repository";

const rpc = vi.fn();

const uploadBody = {
  channelId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
  reportType: "Performance",
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
  currency: "AED",
  fileKind: "xlsx" as const,
  originalFilename: "report.xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  contentLength: 123,
  idempotencyKey: "report-intent:test",
};

beforeEach(() => {
  rpc.mockReset();
});

describe("report package repository", () => {
  it("explains how to fix a channel and branch applicability failure", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23514",
        message: "channel is not applicable to this branch for the declared period",
      },
    });

    const repository = createAuthenticatedReportPackageRepository({ rpc } as never);

    await expect(
      repository.startUpload({
        organizationId: "33333333-3333-4333-8333-333333333333",
        actorId: "44444444-4444-4444-8444-444444444444",
        correlationId: "55555555-5555-4555-8555-555555555555",
        body: uploadBody,
      }),
    ).rejects.toThrow(
      "This channel is not mapped to the selected branch for the declared period. Map the channel to this branch in Channels, or choose a mapped branch, then try again.",
    );
  });

  it("explains how to fix a proposal that uses an unprofiled source header", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23514",
        message: "report contract source header was not profiled",
      },
    });

    const repository = createAuthenticatedReportPackageRepository({ rpc } as never);

    await expect(
      repository.proposeContract({
        organizationId: "33333333-3333-4333-8333-333333333333",
        actorId: "44444444-4444-4444-8444-444444444444",
        packageId: "66666666-6666-4666-8666-666666666666",
        mappingDocument: {},
        proposalSource: "human",
        providerDefinitionKey: null,
        idempotencyKey: "report-contract-proposal-test",
        correlationId: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toThrow(
      "A source header in the proposal was not found in the profiled report. Use the normalized headers shown in the package profile, then try again.",
    );
  });

  it("explains how to fix a projection source identity mismatch", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23514",
        message: "report projection does not match approved required contract field",
      },
    });

    const repository = createAuthenticatedReportPackageRepository({ rpc } as never);

    await expect(
      repository.proposeProjection({
        organizationId: "33333333-3333-4333-8333-333333333333",
        actorId: "44444444-4444-4444-8444-444444444444",
        contractVersionId: "66666666-6666-4666-8666-666666666666",
        projectionDocument: {},
        proposalSource: "human",
        providerDefinitionKey: null,
        idempotencyKey: "report-projection-proposal-test",
        correlationId: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toThrow(
      "A projection source does not match the approved contract. Use the exact normalized sheet identity and a required field with the matching money or count type.",
    );
  });

  it("calls the declare RPC with the refused version, output, and label", async () => {
    rpc.mockResolvedValue({ data: { id: "new-version" }, error: null });

    const repository = createAuthenticatedReportPackageRepository({ rpc } as never);

    await expect(
      repository.proposeProjectionWithDeclaredValue({
        organizationId: "33333333-3333-4333-8333-333333333333",
        actorId: "44444444-4444-4444-8444-444444444444",
        projectionVersionId: "66666666-6666-4666-8666-666666666666",
        outputKey: "cancel_reason",
        value: "CLOSED",
        idempotencyKey: "report-projection-declare-test",
        correlationId: "55555555-5555-4555-8555-555555555555",
      }),
    ).resolves.toEqual({ id: "new-version" });
    expect(rpc).toHaveBeenCalledWith("propose_governed_report_projection_with_declared_value", {
      p_organization_id: "33333333-3333-4333-8333-333333333333",
      p_actor_id: "44444444-4444-4444-8444-444444444444",
      p_report_projection_version_id: "66666666-6666-4666-8666-666666666666",
      p_output_key: "cancel_reason",
      p_value: "CLOSED",
      p_idempotency_key: "report-projection-declare-test",
      p_correlation_id: "55555555-5555-4555-8555-555555555555",
    });
  });

  it("explains that an already-declared label changes nothing", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23514",
        message: "report projection categorical value is already declared",
      },
    });

    const repository = createAuthenticatedReportPackageRepository({ rpc } as never);

    await expect(
      repository.proposeProjectionWithDeclaredValue({
        organizationId: "33333333-3333-4333-8333-333333333333",
        actorId: "44444444-4444-4444-8444-444444444444",
        projectionVersionId: "66666666-6666-4666-8666-666666666666",
        outputKey: "cancel_reason",
        value: "ITEM_UNAVAILABLE",
        idempotencyKey: "report-projection-declare-test",
        correlationId: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toThrow(
      "That label is already declared. Approve the figures that carry it, or retry the projection.",
    );
  });

  it("explains that only an owner or admin can resolve an ambiguous overlap", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "report overlap resolution is not authorized" },
    });

    const repository = createAuthenticatedReportPackageRepository({ rpc } as never);

    await expect(
      repository.resolveProjectionOverlap({
        organizationId: "33333333-3333-4333-8333-333333333333",
        actorId: "44444444-4444-4444-8444-444444444444",
        reconciliationId: "66666666-6666-4666-8666-666666666666",
        resolution: "accept_correction",
        idempotencyKey: "report-overlap-resolution-test",
        correlationId: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toThrow("You do not have permission to resolve this overlap. Ask an organization owner or admin to review it.");
  });

  it("sends one owner decision to the atomic overlap-group RPC", async () => {
    rpc.mockResolvedValue({
      data: { outcome: "resolved", resolvedCount: 20 },
      error: null,
    });

    const repository = createAuthenticatedReportPackageRepository({ rpc } as never);

    await expect(
      repository.resolveProjectionOverlapGroup({
        organizationId: "33333333-3333-4333-8333-333333333333",
        actorId: "44444444-4444-4444-8444-444444444444",
        reconciliationId: "66666666-6666-4666-8666-666666666666",
        resolution: "accept_correction",
        idempotencyKey: "report-overlap-group-resolution-test",
        correlationId: "55555555-5555-4555-8555-555555555555",
      }),
    ).resolves.toEqual({ outcome: "resolved", resolvedCount: 20 });

    expect(rpc).toHaveBeenCalledWith("resolve_governed_report_projection_overlap_group", {
      p_organization_id: "33333333-3333-4333-8333-333333333333",
      p_actor_id: "44444444-4444-4444-8444-444444444444",
      p_reconciliation_id: "66666666-6666-4666-8666-666666666666",
      p_resolution: "accept_correction",
      p_idempotency_key: "report-overlap-group-resolution-test",
      p_correlation_id: "55555555-5555-4555-8555-555555555555",
    });
  });
});
