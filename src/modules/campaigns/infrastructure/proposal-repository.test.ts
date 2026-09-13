import { describe, expect, it, vi } from "vitest";

import { proposalFailure, createProposalRepository, type ProposalPersistence } from "@/modules/campaigns/infrastructure/proposal-repository";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";

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
