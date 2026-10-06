import { describe, expect, it, vi } from "vitest";

import {
  memoryQueryKeys,
  requestCaptureRetry,
  updateMemoryIntegrationSettings,
} from "@/components/memory/query-options";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

const organizationId = "11111111-1111-4111-8111-111111111111";
const captureId = "22222222-2222-4222-8222-222222222222";

describe("memory health query keys", () => {
  it("scopes health reads to the organization", () => {
    expect(memoryQueryKeys.health(organizationId)).toEqual([
      "organizations",
      organizationId,
      "memory",
      "health",
    ]);
    expect(memoryQueryKeys.health(organizationId)).not.toEqual(
      memoryQueryKeys.health("33333333-3333-4333-8333-333333333333"),
    );
  });
});

describe("requestCaptureRetry", () => {
  it("returns retried only for a fresh retry", async () => {
    const request = vi.fn(async () => jsonResponse({ captureId, status: "pending" }));

    await expect(requestCaptureRetry({ organizationId, captureId, request })).resolves.toEqual({
      status: "retried",
    });
    expect(request).toHaveBeenCalledWith(
      `/api/organizations/${organizationId}/memory/captures/${captureId}/retry`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns replayed without new-success semantics", async () => {
    const request = vi.fn(async () => jsonResponse({ captureId, status: "pending", replayed: true }));

    await expect(requestCaptureRetry({ organizationId, captureId, request })).resolves.toEqual({
      status: "replayed",
    });
  });

  it("returns refused for a non-retryable capture instead of throwing", async () => {
    const request = vi.fn(async () =>
      jsonResponse({ error: { code: "CONFLICT", message: "This capture is not retryable." } }, 409),
    );

    await expect(requestCaptureRetry({ organizationId, captureId, request })).resolves.toEqual({
      status: "refused",
      reason: "This capture is not retryable.",
    });
  });

  it("returns refused for a forbidden retry instead of throwing", async () => {
    const request = vi.fn(async () =>
      jsonResponse({ error: { code: "AUTHORIZATION_ERROR", message: "Owners only." } }, 403),
    );

    await expect(requestCaptureRetry({ organizationId, captureId, request })).resolves.toEqual({
      status: "refused",
      reason: "Owners only.",
    });
  });
});

describe("updateMemoryIntegrationSettings", () => {
  const settings = {
    captureEnabled: true,
    channelContextEnabled: false,
    growthContextEnabled: false,
    campaignContextEnabled: false,
    subjectContextEnabled: false,
    legacyCorpusQualified: false,
    contextPolicyVersion: "shared-context-v1",
  };

  it("sends every flag explicitly and reports updated", async () => {
    const request = vi.fn(async () => jsonResponse({ organizationId }));

    await expect(
      updateMemoryIntegrationSettings({ organizationId, settings, request }),
    ).resolves.toEqual({ status: "updated" });
    const firstCall = request.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    expect(firstCall).toBeDefined();
    const [, init] = firstCall as [string, RequestInit];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual(settings);
  });

  it("returns refused for a forbidden change instead of throwing", async () => {
    const request = vi.fn(async () =>
      jsonResponse({ error: { code: "AUTHORIZATION_ERROR", message: "Owners only." } }, 403),
    );

    await expect(
      updateMemoryIntegrationSettings({ organizationId, settings, request }),
    ).resolves.toEqual({ status: "refused", reason: "Owners only." });
  });
});
