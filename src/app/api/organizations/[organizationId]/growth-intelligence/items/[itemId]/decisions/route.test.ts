import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextResponse } from "next/server";

import { POST } from "@/app/api/organizations/[organizationId]/growth-intelligence/items/[itemId]/decisions/route";
import { DomainError, toPublicError } from "@/lib/errors";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const ITEM = "70000000-0000-4000-8000-000000000007";
const FINGERPRINT = "a".repeat(64);

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
  decideItem: vi.fn(),
  setPreference: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
  // Same contract as the real apiErrorResponse; the mapping itself is covered
  // by the organization's own context tests.
  apiErrorResponse: (error: unknown) => {
    const code = toPublicError(error).code;
    const status =
      code === "AUTHENTICATION_ERROR"
        ? 401
        : code === "AUTHORIZATION_ERROR"
          ? 403
          : code === "VALIDATION_ERROR"
            ? 400
            : 422;
    return NextResponse.json({ error: toPublicError(error) }, { status });
  },
}));

vi.mock("@/modules/growth-intelligence/application/feature-access", () => ({
  assertGrowthIntelligenceAccess: mocks.assertAccess,
}));

vi.mock("@/domain/access/permissions", () => ({
  hasOrganizationPermission: mocks.hasPermission,
}));

vi.mock("@/modules/growth-intelligence/application/triage-service", () => ({
  createGrowthIntelligenceTriageService: () => ({
    decideItem: mocks.decideItem,
    setPreference: mocks.setPreference,
  }),
}));

vi.mock("@/modules/growth-intelligence/infrastructure/synthesis-repository", () => ({
  createSynthesisRepository: vi.fn(() => ({})),
}));

vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: vi.fn(() => ({})),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: mocks.warn, error: vi.fn(), debug: vi.fn() },
}));

const params = Promise.resolve({ organizationId: ORGANIZATION, itemId: ITEM });

function request(body: unknown) {
  return new Request(`https://example.test/api/x`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    supabase: {},
    user: { id: "user-1" },
    organizationId: ORGANIZATION,
    membership: { role: "operator" },
  });
  mocks.assertAccess.mockReturnValue(undefined);
  mocks.hasPermission.mockReturnValue(true);
  mocks.decideItem.mockResolvedValue({
    decisionId: "80000000-0000-4000-8000-000000000008",
    decision: "planned",
  });
});

describe("POST item decisions", () => {
  it("records the operator's answer and returns its id", async () => {
    const response = await POST(request({ decision: "planned", itemFingerprint: FINGERPRINT }), {
      params,
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      itemId: ITEM,
      decisionId: "80000000-0000-4000-8000-000000000008",
      decision: "planned",
    });
    expect(mocks.decideItem).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION,
        actorId: "user-1",
        itemId: ITEM,
        decision: "planned",
        itemFingerprint: FINGERPRINT,
      }),
    );
  });

  it("refuses a viewer before touching the triage path", async () => {
    mocks.hasPermission.mockReturnValue(false);

    const response = await POST(
      request({ decision: "acknowledged", itemFingerprint: FINGERPRINT }),
      { params },
    );

    expect(response.status).toBe(403);
    expect(mocks.decideItem).not.toHaveBeenCalled();
  });

  it("rejects unknown answers, stray fields, and bad fingerprints without work", async () => {
    for (const body of [
      { decision: "maybe", itemFingerprint: FINGERPRINT },
      { decision: "acknowledged", itemFingerprint: FINGERPRINT, startWorkflow: true },
      { decision: "acknowledged", itemFingerprint: "xyz" },
      { decision: "snoozed", itemFingerprint: FINGERPRINT },
    ]) {
      const response = await POST(request(body), { params });
      expect(response.status).toBe(400);
    }
    expect(mocks.decideItem).not.toHaveBeenCalled();
  });

  it("blocks a past snooze horizon on this side of the database", async () => {
    const response = await POST(
      request({
        decision: "snoozed",
        snoozedUntil: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        itemFingerprint: FINGERPRINT,
      }),
      { params },
    );

    expect(response.status).toBe(400);
    expect(mocks.decideItem).not.toHaveBeenCalled();
  });

  it("reports a superseded reading as a refreshable conflict", async () => {
    mocks.decideItem.mockRejectedValue(
      new DomainError("DOMAIN_ERROR", "The item changed since you read it."),
    );

    const response = await POST(
      request({ decision: "acknowledged", itemFingerprint: FINGERPRINT }),
      { params },
    );

    expect(response.status).toBe(422);
  });

  it("logs ids and the decision kind only, never the reason text", async () => {
    await POST(
      request({
        decision: "dismissed",
        reason: "Already handled offline.",
        itemFingerprint: FINGERPRINT,
      }),
      { params },
    );

    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.info.mock.calls[0])).not.toContain("Already handled offline.");
    expect(mocks.info).toHaveBeenCalledWith(
      "growth_intelligence.item_decided",
      expect.objectContaining({
        organizationId: ORGANIZATION,
        itemId: ITEM,
        decisionKind: "dismissed",
        correlationId: expect.any(String),
      }),
    );
  });
});
