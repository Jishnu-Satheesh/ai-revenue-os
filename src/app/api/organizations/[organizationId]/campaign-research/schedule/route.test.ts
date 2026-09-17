import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: {} }));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";

const getOrganizationContext = vi.fn();
const rpc = vi.fn();

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: (...args: unknown[]) => getOrganizationContext(...args),
  apiErrorResponse: (error: unknown) => {
    const message = error instanceof Error ? error.message : "error";
    const status = message.includes("not configure") ? 403 : 400;
    return Response.json({ error: { message } }, { status });
  },
}));

import {
  GET as scheduleGet,
  PUT as schedulePut,
} from "@/app/api/organizations/[organizationId]/campaign-research/schedule/route";

function params() {
  return Promise.resolve({ organizationId: ORGANIZATION_ID });
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/campaign-research/schedule", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function scheduleBody() {
  return {
    enabled: true,
    intervalDays: 7,
    qualifyingChangeKinds: ["memory_revision"],
  };
}

beforeEach(() => {
  getOrganizationContext.mockReset();
  rpc.mockReset();
  getOrganizationContext.mockResolvedValue({
    organizationId: ORGANIZATION_ID,
    supabase: { rpc },
  });
});

describe("reading the research cadence", () => {
  it("returns no schedule as null rather than a default rhythm", async () => {
    rpc.mockResolvedValue({ data: { schedule: null }, error: null });

    const response = await scheduleGet(new Request("http://localhost/x"), {
      params: params(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schedule: null });
  });

  it("returns the stored cadence with its watermark", async () => {
    rpc.mockResolvedValue({
      data: {
        schedule: {
          organizationId: ORGANIZATION_ID,
          enabled: true,
          intervalDays: 7,
          qualifyingChangeKinds: ["memory_revision"],
          lastEvaluatedAt: null,
        },
      },
      error: null,
    });

    const response = await scheduleGet(new Request("http://localhost/x"), {
      params: params(),
    });

    expect(await response.json()).toEqual({
      schedule: {
        organizationId: ORGANIZATION_ID,
        enabled: true,
        intervalDays: 7,
        qualifyingChangeKinds: ["memory_revision"],
        lastEvaluatedAt: null,
      },
    });
  });
});

describe("saving the research cadence", () => {
  it("writes the cadence in the writer's vocabulary", async () => {
    rpc.mockResolvedValue({
      data: { organization_id: ORGANIZATION_ID, enabled: true },
      error: null,
    });

    const response = await schedulePut(jsonRequest(scheduleBody()), {
      params: params(),
    });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("save_campaign_research_schedule", {
      target_organization_id: ORGANIZATION_ID,
      input_schedule: {
        enabled: true,
        interval_days: 7,
        qualifying_change_kinds: ["memory_revision"],
      },
    });
  });

  it("refuses an enabled schedule that names nothing before reaching the database", async () => {
    const response = await schedulePut(
      jsonRequest({ enabled: true, intervalDays: 7, qualifyingChangeKinds: [] }),
      { params: params() },
    );

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers a denied cross-tenant write as forbidden", async () => {
    // Org B's owner writing org A's cadence through a guessed id: the writer
    // refuses by permission, and the route reports forbidden rather than a
    // guess about the organization's state.
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "campaign_research_forbidden" },
    });

    const response = await schedulePut(jsonRequest(scheduleBody()), {
      params: params(),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { message: "You may not configure campaign research." },
    });
  });
});
