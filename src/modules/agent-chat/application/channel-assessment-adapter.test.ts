import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/modules/integrations/application/feature-access", () => ({
  isGovernedChannelAnalysisEnabled: () => true,
}));
vi.mock("./api", () => ({ channelAssessmentReads: vi.fn(() => ({})) }));
vi.mock("./channel-assessment", () => ({
  assessChannelForAgent: vi.fn(async () => ({ status: "not_available", reason: "no_evidence" })),
}));
import { assessChannelForAgentWithSession } from "./channel-assessment-adapter";
import { channelAssessmentReads } from "./api";
const input = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  turnId: "20000000-0000-4000-8000-000000000002",
  actorId: "30000000-0000-4000-8000-000000000003",
  leaseToken: "40000000-0000-4000-8000-000000000004",
  question: "How is Talabat doing?",
  correlationId: "agent-adapter-test",
};
describe("channel worker authorization adapter", () => {
  it("keeps the Supabase client receiver when checking the fenced actor", async () => {
    const client = {
      marker: "authorized-client",
      rpc: vi.fn(function (this: { marker: string }) {
        expect(this.marker).toBe("authorized-client");
        return Promise.resolve({
          data: { turnId: input.turnId, actorId: input.actorId, role: "owner" },
          error: null,
        });
      }),
    };
    expect(
      await assessChannelForAgentWithSession({ ...input, supabase: client as never }),
    ).toMatchObject({ status: "not_available" });
    expect(client.rpc).toHaveBeenCalledWith(
      "get_agent_turn_actor_role",
      expect.objectContaining({ p_turn_id: input.turnId, p_lease_token: input.leaseToken }),
    );
  });
  it("refuses a different actor before constructing source readers", async () => {
    vi.mocked(channelAssessmentReads).mockClear();
    await expect(
      assessChannelForAgentWithSession({
        ...input,
        supabase: {
          rpc: async () => ({
            data: { turnId: input.turnId, actorId: input.organizationId, role: "owner" },
            error: null,
          }),
        } as never,
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    expect(channelAssessmentReads).not.toHaveBeenCalled();
  });
});
