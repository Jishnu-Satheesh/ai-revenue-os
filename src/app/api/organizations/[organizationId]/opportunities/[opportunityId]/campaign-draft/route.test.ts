import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/organizations/[organizationId]/opportunities/[opportunityId]/campaign-draft/route";
import { DomainError } from "@/lib/errors";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const OPPORTUNITY = "30000000-0000-4000-8000-000000000003";
const REQUEST = "40000000-0000-4000-8000-000000000004";

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  hasPermission: vi.fn(),
  requestDraft: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
  apiErrorResponse: (error: unknown) => {
    const record = (typeof error === "object" && error !== null ? error : {}) as {
      code?: unknown;
    };
    const status =
      record.code === "AUTHENTICATION_ERROR"
        ? 401
        : record.code === "AUTHORIZATION_ERROR"
          ? 403
          : record.code === "VALIDATION_ERROR" || "issues" in record
            ? 400
            : 422;
    return Response.json({ error: { code: record.code ?? "UNEXPECTED_ERROR" } }, { status });
  },
}));

vi.mock("@/domain/access/permissions", () => ({
  hasOrganizationPermission: mocks.hasPermission,
}));

vi.mock("@/modules/decisions/application/campaign-draft-service", () => ({
  createCampaignDraftService: () => ({ requestDraft: mocks.requestDraft }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: mocks.warn, error: vi.fn(), debug: vi.fn() },
}));

function context() {
  return {
    params: Promise.resolve({ organizationId: ORGANIZATION, opportunityId: OPPORTUNITY }),
  };
}

function request(body: unknown) {
  return new Request(`https://example.test/api/x`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function body() {
  return {
    opportunityVersion: 2,
    objective: "Lift September gross profit from the Friday dinner rush",
    audience: "Nearby residents ordering weekend delivery",
    assertions: [{ key: "budget_available", expectedOutcome: "pass" }],
    idempotencyKey: "draft-request-operator-0001",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    supabase: { rpc: vi.fn() },
    user: { id: "user-1" },
    organizationId: ORGANIZATION,
    membership: { role: "operator" },
  });
  mocks.hasPermission.mockReturnValue(true);
  mocks.requestDraft.mockResolvedValue({
    outcome: "created",
    requestId: REQUEST,
    draftRequestStatus: "pending",
  });
});

describe("POST campaign draft", () => {
  it("admits the exact opportunity version and waits for the authoritative outcome", async () => {
    const response = await POST(request(body()), context());
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ outcome: "created", requestId: REQUEST });
    expect(mocks.requestDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION,
        actorId: "user-1",
        opportunityId: OPPORTUNITY,
        opportunityVersion: 2,
        actionKey: "campaign.governed_draft_v1",
      }),
    );
  });

  it("replays the linked retryable request without recording twice", async () => {
    mocks.requestDraft.mockResolvedValue({
      outcome: "replayed",
      requestId: REQUEST,
      draftRequestStatus: "pending",
    });

    const response = await POST(request(body()), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "replayed", requestId: REQUEST });
  });

  it("refuses viewers, stale versions, and cross-tenant names", async () => {
    mocks.hasPermission.mockReturnValue(false);
    const viewer = await POST(request(body()), context());
    expect(viewer.status).toBe(403);
    mocks.hasPermission.mockReturnValue(true);

    mocks.requestDraft.mockRejectedValue(
      new DomainError("VALIDATION_ERROR", "Changed under review."),
    );
    const stale = await POST(request(body()), context());
    expect(stale.status).toBe(400);

    mocks.requestDraft.mockRejectedValue(
      new DomainError("TENANT_SCOPE_ERROR", "The named record was not found."),
    );
    const missing = await POST(request(body()), context());
    expect(missing.status).toBe(422);
  });
});
