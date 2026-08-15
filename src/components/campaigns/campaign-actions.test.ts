import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  attestAndApprove,
  requestRevision,
  type ActionResult,
} from "@/components/campaigns/campaign-actions";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "c1000000-0000-4000-8000-000000000001";
const VERSION_ID = "d1000000-0000-4000-8000-000000000001";
const DIGEST = "a".repeat(64);

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

function approvalInput() {
  return {
    organizationId: ORGANIZATION_ID,
    campaignId: CAMPAIGN_ID,
    bundleVersionId: VERSION_ID,
    bundleDigest: DIGEST,
    statement: "I have reviewed every asset.",
    expiresAt: "2026-08-16T10:00:00",
    actionKeys: ["b1000000-0000-4000-8000-000000000001"],
  };
}

describe("a revision names the version it was written against", () => {
  it("sends the base version and digest the operator was reading", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ runId: "r1", replayed: false }, 202));

    await requestRevision({
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
      baseVersionId: VERSION_ID,
      baseDigest: DIGEST,
      prompt: "Lead with the family table.",
      scope: { kind: "copy", directionId: "d0000000-0000-4000-8000-000000000001" },
      idempotencyKey: "key-12345678",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/organizations/${ORGANIZATION_ID}/campaigns/${CAMPAIGN_ID}/revisions`);
    expect(JSON.parse(init.body as string)).toMatchObject({
      baseVersionId: VERSION_ID,
      baseDigest: DIGEST,
      scope: { kind: "copy" },
    });
  });

  it("surfaces the server's own words when the campaign has moved on", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { message: "This proposal changed since you read it. Reload and try again." } },
        422,
      ),
    );

    const result = await requestRevision({
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
      baseVersionId: VERSION_ID,
      baseDigest: DIGEST,
      prompt: "Change the caption.",
      scope: { kind: "bundle" },
      idempotencyKey: "key-12345678",
    });

    expect(result).toEqual<ActionResult<never>>({
      ok: false,
      message: "This proposal changed since you read it. Reload and try again.",
    });
  });

  it("reports a dropped connection rather than throwing at the caller", async () => {
    fetchMock.mockRejectedValue(new TypeError("network"));

    const result = await requestRevision({
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
      baseVersionId: VERSION_ID,
      baseDigest: DIGEST,
      prompt: "Change the caption.",
      scope: { kind: "bundle" },
      idempotencyKey: "key-12345678",
    });

    expect(result.ok).toBe(false);
  });
});

describe("approval always follows an attestation", () => {
  it("attests first, then approves with the attestation it received", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ attestationId: "att-1" }, 201))
      .mockResolvedValueOnce(jsonResponse({ approvalId: "app-1" }, 201));

    const result = await attestAndApprove(approvalInput());

    expect(result).toEqual({ ok: true, data: { approvalId: "app-1" } });
    const [attestUrl] = fetchMock.mock.calls[0] as [string];
    const [approveUrl, approveInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(attestUrl).toContain("/attest");
    expect(approveUrl).toContain("/approve");
    expect(JSON.parse(approveInit.body as string)).toMatchObject({ attestationId: "att-1" });
  });

  it("never approves when the attestation was refused", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: "This proposal changed since you reviewed it." } }, 422),
    );

    const result = await attestAndApprove(approvalInput());

    expect(result).toMatchObject({ ok: false });
    // One call only: approval was never attempted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("binds both calls to the same version and digest", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ attestationId: "att-1" }, 201))
      .mockResolvedValueOnce(jsonResponse({ approvalId: "app-1" }, 201));

    await attestAndApprove(approvalInput());

    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse((call[1] as RequestInit).body as string);
      expect(body).toMatchObject({ bundleVersionId: VERSION_ID, bundleDigest: DIGEST });
    }
  });
});
