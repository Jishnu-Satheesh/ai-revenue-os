import { describe, expect, it, vi } from "vitest";

import { sweepResearchLeases } from "@/modules/campaigns/application/research-lease-sweep";

const ORGANIZATION_A = "fb440000-0000-4000-8000-000000000101";
const ORGANIZATION_B = "fb440000-0000-4000-8000-000000000102";

function store(
  overrides: {
    listLeaseExpiries?: () => Promise<readonly string[]>;
    reclaimLeases?: (input: {
      organizationId: string;
    }) => Promise<{ reclaimed: number; abandoned: number }>;
  } = {},
) {
  return {
    listLeaseExpiries:
      overrides.listLeaseExpiries ?? (async () => [ORGANIZATION_A, ORGANIZATION_B]),
    reclaimLeases:
      overrides.reclaimLeases ?? (async () => ({ reclaimed: 1, abandoned: 0 })),
  };
}

describe("research lease sweep", () => {
  it("reclaims every tenant holding a lapsed claim", async () => {
    const reclaimLeases = vi.fn<
      (input: { organizationId: string }) => Promise<{ reclaimed: number; abandoned: number }>
    >(async () => ({ reclaimed: 2, abandoned: 1 }));

    const result = await sweepResearchLeases({ store: store({ reclaimLeases }) });

    expect(reclaimLeases).toHaveBeenCalledTimes(2);
    expect(reclaimLeases).toHaveBeenCalledWith({ organizationId: ORGANIZATION_A });
    expect(reclaimLeases).toHaveBeenCalledWith({ organizationId: ORGANIZATION_B });
    expect(result).toEqual({
      organizationsSwept: 2,
      reclaimed: 4,
      abandoned: 2,
      failed: [],
    });
  });

  it("does nothing at all when no lease has lapsed", async () => {
    const reclaimLeases = vi.fn<
      (input: { organizationId: string }) => Promise<{ reclaimed: number; abandoned: number }>
    >(async () => ({ reclaimed: 0, abandoned: 0 }));

    const result = await sweepResearchLeases({
      store: store({ listLeaseExpiries: async () => [], reclaimLeases }),
    });

    // The common case by far. A sweep that called the writer for every
    // organization on every tick would put steady write load on the database
    // to discover, almost always, that there was nothing to do.
    expect(reclaimLeases).not.toHaveBeenCalled();
    expect(result).toEqual({
      organizationsSwept: 0,
      reclaimed: 0,
      abandoned: 0,
      failed: [],
    });
  });

  it("keeps sweeping the other tenants when one of them fails", async () => {
    const result = await sweepResearchLeases({
      store: store({
        reclaimLeases: async ({ organizationId }) => {
          if (organizationId === ORGANIZATION_A) throw new Error("reclaim refused");
          return { reclaimed: 3, abandoned: 0 };
        },
      }),
    });

    // One tenant's database fault must not strand every other tenant's dead
    // runs until the next tick.
    expect(result).toEqual({
      organizationsSwept: 2,
      reclaimed: 3,
      abandoned: 0,
      failed: [ORGANIZATION_A],
    });
  });

  it("reports the tenants it could not sweep rather than reporting a clean run", async () => {
    const result = await sweepResearchLeases({
      store: store({
        reclaimLeases: async () => {
          throw new Error("reclaim refused");
        },
      }),
    });

    expect(result.failed).toEqual([ORGANIZATION_A, ORGANIZATION_B]);
    expect(result.reclaimed).toBe(0);
  });

  it("lets a failure to list tenants surface instead of reporting nothing to do", async () => {
    // An empty list and an unreadable list look identical downstream, so the
    // read is deliberately not caught: a sweep that cannot see its work must
    // fail loudly to its own alerting, not log a quiet success.
    await expect(
      sweepResearchLeases({
        store: store({
          listLeaseExpiries: async () => {
            throw new Error("expiry read unavailable");
          },
        }),
      }),
    ).rejects.toThrow("expiry read unavailable");
  });

  it("sweeps each tenant once even when the reader repeats one", async () => {
    const reclaimLeases = vi.fn<
      (input: { organizationId: string }) => Promise<{ reclaimed: number; abandoned: number }>
    >(async () => ({ reclaimed: 1, abandoned: 0 }));

    const result = await sweepResearchLeases({
      store: store({
        listLeaseExpiries: async () => [ORGANIZATION_A, ORGANIZATION_A, ORGANIZATION_B],
        reclaimLeases,
      }),
    });

    expect(reclaimLeases).toHaveBeenCalledTimes(2);
    expect(result.organizationsSwept).toBe(2);
  });
});
