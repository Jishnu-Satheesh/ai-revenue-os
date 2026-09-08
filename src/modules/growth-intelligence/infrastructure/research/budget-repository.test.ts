import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import {
  createResearchBudgetRepository,
  toResearchBudgetError,
  type ResearchBudgetPersistence,
} from "@/modules/growth-intelligence/infrastructure/research/budget-repository";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const PIPELINE_ID = "20000000-0000-4000-8000-000000000002";
const REQUEST_ID = "30000000-0000-4000-8000-000000000003";
const RESERVATION_ID = "40000000-0000-4000-8000-000000000004";
const ATTEMPT_ID = "50000000-0000-4000-8000-000000000005";
const CLAIM_TOKEN = "60000000-0000-4000-8000-000000000006";

function persistenceFor(responses: Record<string, unknown>) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({
    data: responses[name],
    error: null,
    args,
  }));
  return { client: { rpc } as ResearchBudgetPersistence, rpc };
}

describe("research budget repository", () => {
  it("reserves a pipeline quote through one typed work scope", async () => {
    const { client, rpc } = persistenceFor({
      reserve_research_pipeline_budget: {
        reservationId: RESERVATION_ID,
        organizationId: ORGANIZATION_ID,
        pipelineId: PIPELINE_ID,
        allowanceDay: "2026-09-08",
        quoteMicrosUsd: 1_000_000,
        priceVersion: "brave-search-2026-09",
        replayed: false,
      },
    });

    const result = await createResearchBudgetRepository(client).reservePipelineBudget({
      organizationId: ORGANIZATION_ID,
      pipelineId: PIPELINE_ID,
      quoteMicrosUsd: 1_000_000,
      priceVersion: "brave-search-2026-09",
    });

    expect(result.reservationId).toBe(RESERVATION_ID);
    expect(result.replayed).toBe(false);
    expect(rpc).toHaveBeenCalledWith(
      "reserve_research_pipeline_budget",
      expect.objectContaining({ p_quote_micros_usd: 1_000_000 }),
    );
  });

  it("reserves a standalone request quote against the same allowance", async () => {
    const { client } = persistenceFor({
      reserve_research_request_budget: {
        reservationId: RESERVATION_ID,
        organizationId: ORGANIZATION_ID,
        requestId: REQUEST_ID,
        allowanceDay: "2026-09-08",
        quoteMicrosUsd: 500_000,
        priceVersion: "brave-search-2026-09",
        replayed: false,
      },
    });

    const result = await createResearchBudgetRepository(client).reserveRequestBudget({
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      quoteMicrosUsd: 500_000,
      priceVersion: "brave-search-2026-09",
    });

    expect(result.requestId).toBe(REQUEST_ID);
  });

  it("refuses an over-ceiling quote before any RPC", async () => {
    const { client, rpc } = persistenceFor({});

    await expect(
      createResearchBudgetRepository(client).reservePipelineBudget({
        organizationId: ORGANIZATION_ID,
        pipelineId: PIPELINE_ID,
        quoteMicrosUsd: 1_000_001,
        priceVersion: "brave-search-2026-09",
      }),
    ).rejects.toBeInstanceOf(GrowthIntelligenceError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("debits an attempt through the discriminated scope key", async () => {
    const { client, rpc } = persistenceFor({
      reserve_research_attempt: {
        attemptId: ATTEMPT_ID,
        reservationId: RESERVATION_ID,
        allowanceDay: "2026-09-08",
        maximumMicrosUsd: 100_000,
        replayed: false,
      },
    });

    const result = await createResearchBudgetRepository(client).reserveAttempt({
      organizationId: ORGANIZATION_ID,
      scope: { kind: "pipeline", pipelineId: PIPELINE_ID },
      phase: "research",
      slotKey: "local-market",
      attemptIndex: 0,
      maximumMicrosUsd: 100_000,
      claimToken: CLAIM_TOKEN,
    });

    expect(result.attemptId).toBe(ATTEMPT_ID);
    expect(rpc).toHaveBeenCalledWith(
      "reserve_research_attempt",
      expect.objectContaining({
        p_work_scope: { kind: "pipeline", id: PIPELINE_ID },
        p_claim_token: CLAIM_TOKEN,
      }),
    );
  });

  it("settles reported, estimated and unknown usage without clamping", async () => {
    const { client } = persistenceFor({
      settle_research_attempt: {
        attemptId: ATTEMPT_ID,
        settlementKind: "unknown",
        actualMicrosUsd: null,
        overrunBlocked: false,
        replayed: false,
      },
    });

    const result = await createResearchBudgetRepository(client).settleAttempt({
      organizationId: ORGANIZATION_ID,
      attemptId: ATTEMPT_ID,
      usage: { kind: "unknown" },
    });

    expect(result.settlementKind).toBe("unknown");
    expect(result.actualMicrosUsd).toBeNull();
  });

  it("releases a confirmed unused reserve", async () => {
    const { client } = persistenceFor({
      release_research_budget_reservation: {
        reservationId: RESERVATION_ID,
        released: true,
        replayed: false,
      },
    });

    const result = await createResearchBudgetRepository(client).releaseReservation({
      organizationId: ORGANIZATION_ID,
      reservationId: RESERVATION_ID,
    });

    expect(result.released).toBe(true);
  });

  it("maps refusals onto typed errors with safe copy", () => {
    expect(toResearchBudgetError({ message: "research_budget_allowance_exceeded" })).toEqual(
      expect.objectContaining({ code: "RESEARCH_BUDGET_ALLOWANCE_EXCEEDED" }),
    );
    expect(toResearchBudgetError({ message: "research_budget_overrun_blocked" })).toEqual(
      expect.objectContaining({ code: "RESEARCH_BUDGET_OVERRUN_BLOCKED" }),
    );
    expect(toResearchBudgetError({ message: "research_budget_lease_stale" })).toEqual(
      expect.objectContaining({ code: "RESEARCH_BUDGET_LEASE_STALE" }),
    );
    expect(toResearchBudgetError({ message: "research_provider_not_qualified" })).toEqual(
      expect.objectContaining({ code: "RESEARCH_PROVIDER_NOT_QUALIFIED" }),
    );
    expect(toResearchBudgetError({ message: "research_budget_reservation_conflict" })).toEqual(
      expect.objectContaining({ code: "RESEARCH_BUDGET_CONFLICT" }),
    );
    expect(toResearchBudgetError({ message: "research_budget_pipeline_closed" })).toEqual(
      expect.objectContaining({ code: "RESEARCH_BUDGET_SCOPE_CLOSED" }),
    );
    expect(toResearchBudgetError(new Error("connection reset"))).toEqual(
      expect.objectContaining({ code: "RESEARCH_BUDGET_UNAVAILABLE" }),
    );
  });

  it("never leaks payload content through error messages", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "research_budget_allowance_exceeded" },
    }));
    const client = { rpc } as ResearchBudgetPersistence;

    const error = await createResearchBudgetRepository(client)
      .reservePipelineBudget({
        organizationId: ORGANIZATION_ID,
        pipelineId: PIPELINE_ID,
        quoteMicrosUsd: 1_000_000,
        priceVersion: "brave-search-2026-09",
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GrowthIntelligenceError);
    expect((error as Error).message).not.toMatch(/token|key|secret|payload/i);
  });
});
