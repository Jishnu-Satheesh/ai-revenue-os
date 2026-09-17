import { describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";
import { proposalFailure, createProposalRepository, type ProposalPersistence } from "@/modules/campaigns/infrastructure/proposal-repository";

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN = "77777777-7777-4777-8777-777777777777";
const SNAPSHOT = "88888888-8888-4888-8888-888888888888";
const MANIFEST = "55555555-5555-4555-8555-555555555555";

describe("reading a database refusal", () => {
  it("maps each named refusal to the outcome a caller can act on", () => {
    expect(proposalFailure({ message: "campaign_proposal_stale_version" })).toEqual({
      kind: "stale_version",
    });
    expect(proposalFailure({ message: "campaign_proposal_idempotency_conflict" })).toEqual({
      kind: "conflict",
    });
    expect(proposalFailure({ message: "campaign_proposal_forbidden" })).toEqual({
      kind: "forbidden",
    });
    expect(proposalFailure({ message: "campaign_proposal_not_found" })).toEqual({
      kind: "not_found",
    });
  });

  it("falls back to the SQLSTATE when the message says nothing recognisable", () => {
    expect(proposalFailure({ code: "42501", message: "boom" })).toEqual({ kind: "forbidden" });
    expect(proposalFailure({ code: "23505", message: "boom" })).toEqual({ kind: "conflict" });
  });

  it("reports an unrecognised refusal as unavailable rather than guessing", () => {
    expect(proposalFailure({ code: "XX000", message: "something new" })).toEqual({
      kind: "unavailable",
    });
  });
});

describe("the decide call", () => {
  it("never sends an actor identity, so a forged one has nowhere to land", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { decision_id: "d", outcome: "saved", linked_campaign_id: null },
      error: null,
    });
    const repository = createProposalRepository({
      rpc,
      from: vi.fn(),
    } as unknown as ProposalPersistence);

    await repository.decide({
      organizationId: ORGANIZATION,
      proposalId: "p",
      proposalVersionId: "v",
      proposalDigest: "a".repeat(64),
      decision: "approved_for_preparation",
      reason: null,
      instructions: null,
      snoozedUntil: null,
      idempotencyKey: "owner-approves-11",
    });

    const sent = JSON.stringify(rpc.mock.calls[0]?.[1]);
    expect(sent).not.toContain("actor");
    expect(sent).not.toContain("auth");
  });

  it("throws the mapped failure rather than returning a half-result", async () => {
    const repository = createProposalRepository({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "22023", message: "campaign_proposal_stale_version" },
      }),
      from: vi.fn(),
    } as unknown as ProposalPersistence);

    await expect(
      repository.decide({
        organizationId: ORGANIZATION,
        proposalId: "p",
        proposalVersionId: "v",
        proposalDigest: "a".repeat(64),
        decision: "approved_for_preparation",
        reason: null,
        instructions: null,
        snoozedUntil: null,
        idempotencyKey: "stale-11",
      }),
    ).rejects.toEqual({ kind: "stale_version" });
  });
});

describe("the approval-time snapshot pin", () => {
  it("pins through the repair function under the caller's own session", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { source_snapshot_id: SNAPSHOT, refreshed: true },
      error: null,
    });
    const repository = createProposalRepository({
      rpc,
      from: vi.fn(),
    } as unknown as ProposalPersistence);

    const result = await repository.pinApprovalSnapshot({
      organizationId: ORGANIZATION,
      campaignId: CAMPAIGN,
    });

    expect(rpc).toHaveBeenCalledWith("refresh_campaign_source_snapshot", {
      target_organization_id: ORGANIZATION,
      target_campaign_id: CAMPAIGN,
    });
    expect(result).toEqual({ sourceSnapshotId: SNAPSHOT, refreshed: true });
  });

  it("reports an identical-facts pin as unrefreshed rather than a new write", async () => {
    const repository = createProposalRepository({
      rpc: vi.fn().mockResolvedValue({
        data: { source_snapshot_id: SNAPSHOT, refreshed: false },
        error: null,
      }),
      from: vi.fn(),
    } as unknown as ProposalPersistence);

    const result = await repository.pinApprovalSnapshot({
      organizationId: ORGANIZATION,
      campaignId: CAMPAIGN,
    });

    expect(result).toEqual({ sourceSnapshotId: SNAPSHOT, refreshed: false });
  });

  it("reports a refused pin as unpinned and logs it, never throwing past a committed approval", async () => {
    const repository = createProposalRepository({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "42501", message: "campaign_snapshot_forbidden" },
      }),
      from: vi.fn(),
    } as unknown as ProposalPersistence);

    const result = await repository.pinApprovalSnapshot({
      organizationId: ORGANIZATION,
      campaignId: CAMPAIGN,
    });

    expect(result).toEqual({ sourceSnapshotId: null, refreshed: false });
    expect(logger.warn).toHaveBeenCalledWith(
      "campaign.proposal_snapshot_not_pinned",
      expect.objectContaining({ organizationId: ORGANIZATION, campaignId: CAMPAIGN }),
    );
  });

  it("reports an unreadable pin result the same degraded way", async () => {
    const repository = createProposalRepository({
      rpc: vi.fn().mockResolvedValue({ data: { unexpected: true }, error: null }),
      from: vi.fn(),
    } as unknown as ProposalPersistence);

    const result = await repository.pinApprovalSnapshot({
      organizationId: ORGANIZATION,
      campaignId: CAMPAIGN,
    });

    expect(result).toEqual({ sourceSnapshotId: null, refreshed: false });
    expect(logger.warn).toHaveBeenCalledWith(
      "campaign.proposal_snapshot_not_pinned",
      expect.objectContaining({ organizationId: ORGANIZATION, campaignId: CAMPAIGN }),
    );
  });

  it("reports a thrown pin transport the same degraded way, never past a committed approval", async () => {
    const repository = createProposalRepository({
      rpc: vi.fn().mockRejectedValue(new Error("boom")),
      from: vi.fn(),
    } as unknown as ProposalPersistence);

    const result = await repository.pinApprovalSnapshot({
      organizationId: ORGANIZATION,
      campaignId: CAMPAIGN,
    });

    expect(result).toEqual({ sourceSnapshotId: null, refreshed: false });
    expect(logger.warn).toHaveBeenCalledWith(
      "campaign.proposal_snapshot_not_pinned",
      expect.objectContaining({ organizationId: ORGANIZATION, campaignId: CAMPAIGN }),
    );
  });
});

describe("the context manifest ownership read", () => {
  function repositoryWithManifest(result: {
    data: unknown;
    error: { message?: string } | null;
  }) {
    const maybeSingle = vi.fn().mockResolvedValue(result);
    const secondEq = vi.fn().mockReturnValue({ maybeSingle });
    const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: firstEq }) });
    const repository = createProposalRepository({
      rpc: vi.fn(),
      from,
    } as unknown as ProposalPersistence);
    return { repository, from, firstEq, secondEq };
  }

  it("reads the manifest under this tenant's own session", async () => {
    const { repository, from, firstEq, secondEq } = repositoryWithManifest({
      data: { id: MANIFEST },
      error: null,
    });

    const result = await repository.readContextManifest({
      organizationId: ORGANIZATION,
      manifestId: MANIFEST,
    });

    expect(from).toHaveBeenCalledWith("memory_context_manifests");
    expect(firstEq).toHaveBeenCalledWith("organization_id", ORGANIZATION);
    expect(secondEq).toHaveBeenCalledWith("id", MANIFEST);
    expect(result).toEqual({ id: MANIFEST });
  });

  it("answers a foreign manifest as absent, never as a refusal with detail", async () => {
    const { repository } = repositoryWithManifest({ data: null, error: null });

    const result = await repository.readContextManifest({
      organizationId: ORGANIZATION,
      manifestId: MANIFEST,
    });

    expect(result).toBeNull();
  });

  it("answers an unreadable manifest the same absent way", async () => {
    const { repository } = repositoryWithManifest({
      data: null,
      error: { message: "boom" },
    });

    const result = await repository.readContextManifest({
      organizationId: ORGANIZATION,
      manifestId: MANIFEST,
    });

    expect(result).toBeNull();
  });
});
