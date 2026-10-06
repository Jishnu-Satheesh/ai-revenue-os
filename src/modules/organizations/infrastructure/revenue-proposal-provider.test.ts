import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: mocks.generateText,
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => () => ({})),
}));
const testEnv = vi.hoisted(() => ({
  GOOGLE_GENERATIVE_AI_API_KEY: "test-key" as string | undefined,
  AI_DEFAULT_MODEL: "test-model" as string | undefined,
}));
vi.mock("@/lib/env", () => ({ env: testEnv }));

import { DomainError } from "@/lib/errors";
import {
  createFailClosedRevenueProposalProvider,
  createGoogleRevenueProposalProvider,
  createRevenueProposalProvider,
  revenueProposalRequestSchema,
} from "@/modules/organizations/infrastructure/revenue-proposal-provider";

const FINDING_A = "22222222-2222-4222-8222-222222222221";

function validRequest() {
  return {
    currency: "AED",
    losses: [{ findingId: FINDING_A, minorUnits: 200_00 }],
    actions: [
      {
        actionId: "rec-1",
        title: "Recover avoidable cancellations",
        kind: "recommendation" as const,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  testEnv.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
  testEnv.AI_DEFAULT_MODEL = "test-model";
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("revenue proposal provider", () => {
  it("rejects requests without a cited input or with too many actions", () => {
    expect(revenueProposalRequestSchema.safeParse({ ...validRequest(), losses: [] }).success).toBe(
      false,
    );
    expect(
      revenueProposalRequestSchema.safeParse({
        ...validRequest(),
        actions: Array.from({ length: 11 }, (_, index) => ({
          actionId: `rec-${index}`,
          title: `Action ${index}`,
          kind: "recommendation" as const,
        })),
      }).success,
    ).toBe(false);
  });

  it("stays fail-closed without credentials", () => {
    testEnv.GOOGLE_GENERATIVE_AI_API_KEY = undefined;
    const provider = createRevenueProposalProvider();
    expect(provider.modelProvider).toBe("fail-closed");
    return expect(
      provider.propose({ request: validRequest(), correlationId: "corr" }),
    ).rejects.toMatchObject({ code: "INTEGRATION_ERROR" });
  });

  it("the explicit fail-closed provider never calls the SDK", async () => {
    const provider = createFailClosedRevenueProposalProvider();
    await expect(
      provider.propose({ request: validRequest(), correlationId: "corr" }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("parses a strict JSON array into validated ranges", async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify([
        {
          actionId: "rec-1",
          citedFindingId: FINDING_A,
          citedBasisMinorUnits: 200_00,
          currency: "AED",
          low: 0.1,
          high: 0.3,
        },
      ]),
    });
    const provider = createGoogleRevenueProposalProvider();

    const ranges = await provider.propose({ request: validRequest(), correlationId: "corr" });

    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ actionId: "rec-1", low: 0.1, high: 0.3 });
    const call = mocks.generateText.mock.calls[0]?.[0] as { temperature: number };
    expect(call.temperature).toBe(0.1);
  });

  it("treats prose or schema-invalid output as unavailable, never as figures", async () => {
    const provider = createGoogleRevenueProposalProvider();
    mocks.generateText.mockResolvedValue({ text: "Based on my analysis, expect 25% growth." });

    await expect(
      provider.propose({ request: validRequest(), correlationId: "corr" }),
    ).rejects.toMatchObject({ code: "INTEGRATION_ERROR" });

    mocks.generateText.mockResolvedValue({
      text: JSON.stringify([
        {
          actionId: "rec-1",
          citedFindingId: FINDING_A,
          citedBasisMinorUnits: 200_00,
          currency: "AED",
          low: 0.9,
          high: 0.2,
        },
      ]),
    });
    await expect(
      provider.propose({ request: validRequest(), correlationId: "corr" }),
    ).rejects.toMatchObject({ code: "INTEGRATION_ERROR" });
  });
});
