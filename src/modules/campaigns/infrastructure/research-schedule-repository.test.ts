import { describe, expect, it, vi } from "vitest";

import { createResearchScheduleRepository } from "@/modules/campaigns/infrastructure/research-schedule-repository";
import type { ResearchPersistence } from "@/modules/campaigns/infrastructure/research-policy-repository";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function client(
  data: unknown,
  error: { code?: string; message?: string } | null = null,
): ResearchPersistence & { calls: Array<{ name: string; args: Record<string, unknown> }> } {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data, error };
    }),
  };
}

describe("the research schedule settings store", () => {
  it("reads no schedule as null, not as a default cadence", async () => {
    const rpc = client({ schedule: null });

    expect(
      await createResearchScheduleRepository(rpc).readSchedule({ organizationId: ORG }),
    ).toBeNull();
  });

  it("parses the stored schedule rather than casting it", async () => {
    const rpc = client({
      schedule: {
        organizationId: ORG,
        enabled: true,
        intervalDays: 7,
        qualifyingChangeKinds: ["memory_revision"],
        lastEvaluatedAt: null,
      },
    });

    const schedule = await createResearchScheduleRepository(rpc).readSchedule({
      organizationId: ORG,
    });

    expect(schedule).toMatchObject({ enabled: true, intervalDays: 7 });
    expect(rpc.calls[0]).toMatchObject({
      name: "read_campaign_research_schedule",
      args: { target_organization_id: ORG },
    });
  });

  it("saves the cadence in the writer's vocabulary", async () => {
    const rpc = client({ organization_id: ORG, enabled: true });

    const saved = await createResearchScheduleRepository(rpc).saveSchedule({
      organizationId: ORG,
      schedule: {
        enabled: true,
        intervalDays: 7,
        qualifyingChangeKinds: ["memory_revision", "scheduled_cadence"],
      },
    });

    expect(saved).toEqual({ organizationId: ORG, enabled: true });
    expect(rpc.calls[0]?.args.input_schedule).toEqual({
      enabled: true,
      interval_days: 7,
      qualifying_change_kinds: ["memory_revision", "scheduled_cadence"],
    });
  });

  it("maps a denied cross-tenant write to forbidden", async () => {
    // Org B's owner writing org A's cadence: the writer refuses by
    // permission, and the store reports forbidden rather than a guess.
    const rpc = client(null, {
      code: "42501",
      message: "campaign_research_forbidden",
    });

    await expect(
      createResearchScheduleRepository(rpc).saveSchedule({
        organizationId: ORG,
        schedule: {
          enabled: true,
          intervalDays: 7,
          qualifyingChangeKinds: ["memory_revision"],
        },
      }),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });
});
