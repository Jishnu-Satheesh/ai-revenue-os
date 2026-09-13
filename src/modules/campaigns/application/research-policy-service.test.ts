import { describe, expect, it, vi } from "vitest";

import { createResearchPolicyService } from "@/modules/campaigns/application/research-policy-service";
import type { ResearchPolicyRepository } from "@/modules/campaigns/infrastructure/research-policy-repository";
import type { ResearchPolicy } from "@/domain/campaigns/research-policy";

const ORGANIZATION_ID = "fb430000-0000-4000-8000-000000000201";
const RUN_ID = "fb430000-0000-4000-8000-000000000202";
const NOW = new Date("2026-09-13T12:00:00.000Z");

function policy(): ResearchPolicy {
  return {
    schemaVersion: 1,
    organizationId: ORGANIZATION_ID,
    version: 3,
    enabled: true,
    timezone: "Asia/Dubai",
    evidenceQualificationRuleVersion: "evidence-qualification@2",
    evidenceMaxAgeDays: 30,
    cooldownSeconds: 0,
    maxPendingProposals: 5,
    perRunAllowance: { amountMinor: 5000, currency: "AED" },
    windowAllowance: { amountMinor: 20000, currency: "AED" },
    windowDays: 30,
  };
}

function repository(overrides: Partial<ResearchPolicyRepository> = {}): ResearchPolicyRepository {
  return {
    readLedger: async () => ({
      policy: policy(),
      pendingCount: 0,
      windowSpentMinor: 0,
      lastAdmittedAt: null,
    }),
    requestRun: async () => ({ runId: RUN_ID, outcome: "saved" as const }),
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    triggerKind: "manual_request" as const,
    requestedBudget: { amountMinor: 1000, currency: "AED" },
    requestDigest: "a".repeat(64),
    idempotencyKey: "staged-weekday-lunch",
    ...overrides,
  };
}

describe("research policy service", () => {
  it("admits a request inside every limit and returns the writer's run", async () => {
    const service = createResearchPolicyService({ repository: repository(), now: () => NOW });
    await expect(
      service.admit({ organizationId: ORGANIZATION_ID, request: request() }),
    ).resolves.toEqual({
      status: "admitted",
      runId: RUN_ID,
      policyVersion: 3,
      reservedBudget: { amountMinor: 1000, currency: "AED" },
    });
  });

  it("reports a replay as a replay, never as a second admission", async () => {
    const service = createResearchPolicyService({
      repository: repository({ requestRun: async () => ({ runId: RUN_ID, outcome: "replayed" }) }),
      now: () => NOW,
    });
    await expect(
      service.admit({ organizationId: ORGANIZATION_ID, request: request() }),
    ).resolves.toMatchObject({ status: "replayed", runId: RUN_ID });
  });

  it("refuses without calling the writer when the pre-check fails", async () => {
    const requestRun = vi.fn();
    const service = createResearchPolicyService({
      repository: repository({
        readLedger: async () => ({
          policy: null,
          pendingCount: 0,
          windowSpentMinor: 0,
          lastAdmittedAt: null,
        }),
        requestRun,
      }),
      now: () => NOW,
    });
    await expect(
      service.admit({ organizationId: ORGANIZATION_ID, request: request() }),
    ).resolves.toEqual({ status: "refused", reasonCode: "needs_setup" });
    expect(requestRun).not.toHaveBeenCalled();
  });

  it("lets the writer's refusal win when the world moved under the preview", async () => {
    const service = createResearchPolicyService({
      repository: repository({
        requestRun: async () => {
          throw { kind: "refused", reasonCode: "pending_limit_reached" };
        },
      }),
      now: () => NOW,
    });
    await expect(
      service.admit({ organizationId: ORGANIZATION_ID, request: request() }),
    ).resolves.toEqual({ status: "refused", reasonCode: "pending_limit_reached" });
  });

  it("maps a forbidden ledger read to forbidden", async () => {
    const service = createResearchPolicyService({
      repository: repository({
        readLedger: async () => {
          throw { kind: "forbidden" };
        },
      }),
      now: () => NOW,
    });
    await expect(
      service.admit({ organizationId: ORGANIZATION_ID, request: request() }),
    ).resolves.toEqual({ status: "forbidden" });
  });

  it("maps an unknown writer fault to unavailable rather than guessing", async () => {
    const service = createResearchPolicyService({
      repository: repository({
        requestRun: async () => {
          throw new Error("connection reset");
        },
      }),
      now: () => NOW,
    });
    await expect(
      service.admit({ organizationId: ORGANIZATION_ID, request: request() }),
    ).resolves.toEqual({ status: "unavailable" });
  });
});
