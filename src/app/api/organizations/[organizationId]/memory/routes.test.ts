import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { MemoryError } from "@/domain/memory/errors";

vi.mock("server-only", () => ({}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const itemId = "22222222-2222-4222-8222-222222222222";
const otherItemId = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  createMemoryWorkspaceApi: vi.fn(),
  service: {
    getSnapshot: vi.fn(),
    createItem: vi.fn(),
    updateItem: vi.fn(),
    supersedeItem: vi.fn(),
    confirmProposal: vi.fn(),
    rejectProposal: vi.fn(),
    listTimeline: vi.fn(),
    listLessons: vi.fn(),
    getItemDetail: vi.fn(),
  },
  retrieval: { retrieve: vi.fn() },
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));

vi.mock("@/modules/memory/infrastructure/embedding-provider", () => ({
  createEmbeddingProvider: () => null,
}));

vi.mock("@/modules/memory/application/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/memory/application/api")>();
  return { ...actual, createMemoryWorkspaceApi: mocks.createMemoryWorkspaceApi };
});

import { GET as getSnapshot } from "@/app/api/organizations/[organizationId]/memory/route";
import { POST as search } from "@/app/api/organizations/[organizationId]/memory/search/route";
import { GET as getTimeline } from "@/app/api/organizations/[organizationId]/memory/timeline/route";
import { GET as getLessons } from "@/app/api/organizations/[organizationId]/memory/lessons/route";
import { POST as createItem } from "@/app/api/organizations/[organizationId]/memory/items/route";
import {
  GET as getItem,
  PATCH as updateItem,
} from "@/app/api/organizations/[organizationId]/memory/items/[itemId]/route";
import { POST as supersedeItem } from "@/app/api/organizations/[organizationId]/memory/items/[itemId]/supersede/route";
import { POST as confirmProposal } from "@/app/api/organizations/[organizationId]/memory/proposals/[itemId]/confirm/route";
import { POST as rejectProposal } from "@/app/api/organizations/[organizationId]/memory/proposals/[itemId]/reject/route";

function organizationParams() {
  return { params: Promise.resolve({ organizationId }) };
}

function itemParams() {
  return { params: Promise.resolve({ organizationId, itemId }) };
}

function jsonRequest(method: string, path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function withCorrelation(request: Request, correlationId = "44444444-4444-4444-8444-444444444444") {
  request.headers.set("x-correlation-id", correlationId);
  return request;
}

const validNote = {
  memoryType: "note",
  title: "Kitchen staffing",
  sensitivity: "internal",
  idempotencyKey: "create-1",
};

const validUpdate = { action: "verify", idempotencyKey: "update-1" };

const item = {
  id: itemId,
  memoryType: "note",
  title: "Kitchen staffing",
  origin: "user_verified",
  sourceTier: 1,
  verificationState: "verified",
  sensitivity: "internal",
  trustRank: 0,
  freshness: "fresh",
  embeddingStatus: "pending",
  createdAt: "2026-08-09T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: "user-1" },
    membership: { role: "operator" },
    supabase: {},
  });
  mocks.createMemoryWorkspaceApi.mockReturnValue({
    service: mocks.service,
    retrieval: mocks.retrieval,
  });
  mocks.service.getSnapshot.mockResolvedValue({
    counts: {},
    recent: [],
    reviewQueue: [],
    ceiling: "internal",
    serverTime: "2026-08-09T00:00:00.000Z",
  });
  mocks.retrieval.retrieve.mockResolvedValue({
    results: [],
    retrievalMode: "lexical",
    degradedReason: "EMBEDDING_NOT_CONFIGURED",
    serverTime: "2026-08-09T00:00:00.000Z",
    builtAt: "must-not-reach-the-client",
  });
  mocks.service.createItem.mockResolvedValue(item);
  mocks.service.updateItem.mockResolvedValue(item);
  mocks.service.supersedeItem.mockResolvedValue({
    replacementId: otherItemId,
    supersededId: itemId,
  });
  mocks.service.confirmProposal.mockResolvedValue({
    itemId,
    factId: null,
    promoted: false,
    memoryType: "note",
    origin: "ai_proposed",
    sensitivity: "internal",
    verificationState: "verified",
    replayed: false,
  });
  mocks.service.rejectProposal.mockResolvedValue({
    itemId,
    memoryType: "note",
    origin: "ai_proposed",
    sensitivity: "internal",
    verificationState: "rejected",
    replayed: false,
  });
  mocks.service.listTimeline.mockResolvedValue({ items: [item], nextCursor: undefined });
  mocks.service.listLessons.mockResolvedValue({
    items: [item],
    evidence: { [itemId]: [otherItemId] },
  });
  mocks.service.getItemDetail.mockResolvedValue({ item, chain: [], links: [] });
});

describe("Business Memory API routes", () => {
  it("rejects a non-member before constructing the memory workspace API", async () => {
    mocks.getOrganizationContext.mockRejectedValueOnce(
      new DomainError("AUTHORIZATION_ERROR", "You do not have access to this organization."),
    );

    const response = await getSnapshot(new Request("http://localhost"), organizationParams());

    expect(response.status).toBe(403);
    expect(mocks.createMemoryWorkspaceApi).not.toHaveBeenCalled();
  });

  it("keeps search cache-free and binds allowance to the authenticated role", async () => {
    const response = await search(
      jsonRequest("POST", "/memory/search", { query: "opening hours" }),
      organizationParams(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      servedFromCache: false,
      retrievalMode: "lexical",
    });
    expect(mocks.retrieval.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ sensitivityAllowance: "internal", purpose: "operator_search" }),
    );
  });

  it("refuses a viewer mutation and a mismatched item route before a service write", async () => {
    mocks.getOrganizationContext.mockResolvedValueOnce({
      organizationId,
      user: { id: "viewer-1" },
      membership: { role: "viewer" },
      supabase: {},
    });
    const viewerResponse = await createItem(
      jsonRequest("POST", "/memory/items", validNote),
      organizationParams(),
    );
    const mismatchResponse = await updateItem(
      jsonRequest("PATCH", `/memory/items/${itemId}`, { ...validUpdate, itemId: otherItemId }),
      itemParams(),
    );

    expect(viewerResponse.status).toBe(403);
    expect(mismatchResponse.status).toBe(400);
    expect(mocks.service.createItem).not.toHaveBeenCalled();
    expect(mocks.service.updateItem).not.toHaveBeenCalled();
  });

  it("returns a safe 404 without exposing whether a cross-tenant item exists", async () => {
    mocks.service.getItemDetail.mockRejectedValueOnce(
      new MemoryError("NOT_FOUND", "internal detail"),
    );

    const response = await getItem(new Request("http://localhost"), itemParams());

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("internal detail");
  });

  it("rejects malformed JSON and every missing mutation idempotency key before a write", async () => {
    const malformed = await createItem(
      new Request("http://localhost/memory/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      organizationParams(),
    );
    const createWithoutKey = await createItem(
      jsonRequest("POST", "/memory/items", { ...validNote, idempotencyKey: undefined }),
      organizationParams(),
    );
    const updateWithoutKey = await updateItem(
      jsonRequest("PATCH", `/memory/items/${itemId}`, {
        ...validUpdate,
        idempotencyKey: undefined,
      }),
      itemParams(),
    );
    const supersedeWithoutKey = await supersedeItem(
      jsonRequest("POST", `/memory/items/${itemId}/supersede`, {
        title: "Correction",
        sensitivity: "internal",
        reason: "Source was stale.",
      }),
      itemParams(),
    );
    const confirmWithoutKey = await confirmProposal(
      jsonRequest("POST", `/memory/proposals/${itemId}/confirm`, {}),
      itemParams(),
    );
    const rejectWithoutKey = await rejectProposal(
      jsonRequest("POST", `/memory/proposals/${itemId}/reject`, { reason: "Unsupported." }),
      itemParams(),
    );

    for (const response of [
      malformed,
      createWithoutKey,
      updateWithoutKey,
      supersedeWithoutKey,
      confirmWithoutKey,
      rejectWithoutKey,
    ]) {
      expect(response.status).toBe(400);
    }
    expect(mocks.service.createItem).not.toHaveBeenCalled();
    expect(mocks.service.updateItem).not.toHaveBeenCalled();
    expect(mocks.service.supersedeItem).not.toHaveBeenCalled();
    expect(mocks.service.confirmProposal).not.toHaveBeenCalled();
    expect(mocks.service.rejectProposal).not.toHaveBeenCalled();
  });

  it("rejects a search idempotency key and never returns a withheld result body", async () => {
    mocks.retrieval.retrieve.mockResolvedValueOnce({
      results: [
        {
          itemId,
          memoryType: "note",
          title: "Customer feedback",
          provenance: {
            origin: "provider_imported",
            sourceTier: 2,
            verificationState: "unverified",
          },
          trustRank: 2,
          freshness: "fresh",
          sensitivity: "internal",
          scores: { lexical: 1, semantic: 0, blended: 0.5 },
        },
      ],
      retrievalMode: "lexical",
      serverTime: "2026-08-09T00:00:00.000Z",
    });

    const rejected = await search(
      jsonRequest("POST", "/memory/search", { query: "feedback", idempotencyKey: "no-write" }),
      organizationParams(),
    );
    const successful = await search(
      jsonRequest("POST", "/memory/search", { query: "feedback" }),
      organizationParams(),
    );
    const body = (await successful.json()) as { results: Array<Record<string, unknown>> };

    expect(rejected.status).toBe(400);
    expect(mocks.retrieval.retrieve).toHaveBeenCalledTimes(1);
    expect(body.results[0]).not.toHaveProperty("body");
    expect(body).not.toHaveProperty("builtAt");
  });

  it("passes bounded timeline filtering and exposes only declared read-model response shapes", async () => {
    const timeline = await getTimeline(
      new Request(
        `http://localhost/memory/timeline?limit=2&sourceSystem=google_business_profile&sourceSystem=manual`,
      ),
      organizationParams(),
    );
    const lessons = await getLessons(
      new Request("http://localhost/memory/lessons?limit=2"),
      organizationParams(),
    );

    expect(timeline.status).toBe(200);
    expect(lessons.status).toBe(200);
    expect(mocks.service.listTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ sourceSystems: ["google_business_profile", "manual"], limit: 2 }),
    );
    await expect(timeline.json()).resolves.toEqual({ items: [item] });
    await expect(lessons.json()).resolves.toEqual({
      items: [item],
      evidence: { [itemId]: [otherItemId] },
    });
  });

  it("round-trips a generated timeline cursor with a PostgreSQL +00:00 offset", async () => {
    const cursor = {
      observedAt: "2026-08-09T00:00:00+00:00",
      createdAt: "2026-08-09T00:00:01+00:00",
      id: itemId,
    };
    mocks.service.listTimeline.mockResolvedValueOnce({ items: [item], nextCursor: cursor });
    const first = await getTimeline(
      new Request("http://localhost/memory/timeline"),
      organizationParams(),
    );
    const firstBody = (await first.json()) as { nextCursor: string };
    await getTimeline(
      new Request(
        `http://localhost/memory/timeline?cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      ),
      organizationParams(),
    );

    expect(firstBody.nextCursor).toBe(JSON.stringify(cursor));
    expect(mocks.service.listTimeline).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor }),
    );
  });

  it("preserves the request correlation ID through every mutation service call", async () => {
    const correlationId = "44444444-4444-4444-8444-444444444444";
    await createItem(
      withCorrelation(jsonRequest("POST", "/memory/items", validNote), correlationId),
      organizationParams(),
    );
    await updateItem(
      withCorrelation(jsonRequest("PATCH", `/memory/items/${itemId}`, validUpdate), correlationId),
      itemParams(),
    );
    await supersedeItem(
      withCorrelation(
        jsonRequest("POST", `/memory/items/${itemId}/supersede`, {
          title: "Correction",
          sensitivity: "internal",
          reason: "The source was stale.",
          idempotencyKey: "supersede-correlation-key",
        }),
        correlationId,
      ),
      itemParams(),
    );
    await confirmProposal(
      withCorrelation(
        jsonRequest("POST", `/memory/proposals/${itemId}/confirm`, {
          idempotencyKey: "confirm-correlation-key",
        }),
        correlationId,
      ),
      itemParams(),
    );
    await rejectProposal(
      withCorrelation(
        jsonRequest("POST", `/memory/proposals/${itemId}/reject`, {
          reason: "Unsupported.",
          idempotencyKey: "reject-correlation-key",
        }),
        correlationId,
      ),
      itemParams(),
    );

    for (const call of [
      mocks.service.createItem,
      mocks.service.updateItem,
      mocks.service.supersedeItem,
      mocks.service.confirmProposal,
      mocks.service.rejectProposal,
    ]) {
      expect(call).toHaveBeenCalledWith(expect.objectContaining({ correlationId }));
    }
  });

  it("returns a safe conflict when the governed PATCH rejects a fact proposal", async () => {
    mocks.service.updateItem.mockRejectedValueOnce(
      new MemoryError("CONFLICT", "internal fact proposal transition detail"),
    );

    const response = await updateItem(
      jsonRequest("PATCH", `/memory/items/${itemId}`, validUpdate),
      itemParams(),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "CONFLICT",
        message: "This item changed while you were working on it. Reload and try again.",
        retryable: false,
      },
    });
  });
});
