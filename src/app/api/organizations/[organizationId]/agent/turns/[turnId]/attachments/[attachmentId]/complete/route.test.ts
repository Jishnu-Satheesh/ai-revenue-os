import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  trigger: vi.fn(),
  getOrganizationContext: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger: mocks.trigger } }));
vi.mock("@/lib/api/organization-context", () => ({ getOrganizationContext: mocks.getOrganizationContext }));
vi.mock("@/modules/integrations/application/feature-access", () => ({ assertAgentChatEnabled: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

import { POST } from "./route";

const organizationId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";
const attachmentId = "33333333-3333-4333-8333-333333333333";
const scope = {
  channelId: "44444444-4444-4444-8444-444444444444",
  branchId: "55555555-5555-4555-8555-555555555555",
  reportType: "Talabat sales", periodStart: "2026-09-01", periodEnd: "2026-09-30", currency: "AED",
};

function request(body: unknown) {
  return new Request("http://localhost/agent/attachment/complete", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
function params() { return { params: Promise.resolve({ organizationId, turnId, attachmentId }) }; }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: { attachmentId, status: "awaiting_upload" }, error: null });
  mocks.trigger.mockResolvedValue({ id: "run-1" });
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId, user: { id: "66666666-6666-4666-8666-666666666666" },
    membership: { role: "operator" }, supabase: { rpc: mocks.rpc },
  });
});

describe("agent attachment completion", () => {
  it("declares scope as the member before queuing identifier-only work", async () => {
    const response = await POST(request({ scope }), params());
    expect(response.status).toBe(202);
    expect(mocks.rpc).toHaveBeenCalledWith("declare_agent_attachment_scope", {
      p_organization_id: organizationId,
      p_actor_id: "66666666-6666-4666-8666-666666666666",
      p_turn_id: turnId,
      p_attachment_id: attachmentId,
      p_scope: scope,
    });
    expect(mocks.trigger).toHaveBeenCalledWith("agent-chat.process-attachment", {
      organizationId, turnId, attachmentId,
    }, { idempotencyKey: `agent-attachment:${attachmentId}:initial` });
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.trigger.mock.invocationCallOrder[0]);
  });

  it("refuses viewer and malformed scope without dispatch", async () => {
    mocks.getOrganizationContext.mockResolvedValueOnce({
      organizationId, user: { id: "66666666-6666-4666-8666-666666666666" },
      membership: { role: "viewer" }, supabase: { rpc: mocks.rpc },
    });
    expect((await POST(request({ scope }), params())).status).toBe(403);
    expect((await POST(request({ scope: { ...scope, periodEnd: "2026-09-00" } }), params())).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it("leaves a retryable upload when dispatch fails after declaration", async () => {
    mocks.trigger.mockRejectedValueOnce(new Error("offline"));
    const response = await POST(request({ scope }), params());
    expect(response.status).toBe(422);
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect((await response.json()).error.message).toMatch(/retry/i);
  });
});
