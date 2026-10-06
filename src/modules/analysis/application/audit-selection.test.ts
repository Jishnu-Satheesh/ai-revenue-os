import { describe, expect, it, vi } from "vitest";

import { resolveAuditSelection } from "@/modules/analysis/application/audit-selection";
import type { ChannelAnalysisRunRecord } from "@/modules/analysis/application/ports";

const ORG = "10000000-0000-4000-8000-000000000001";
const CHANNEL = "20000000-0000-4000-8000-000000000002";
const OLD = "30000000-0000-4000-8000-000000000003";
const NEW = "30000000-0000-4000-8000-000000000004";

function run(id: string, month: string): ChannelAnalysisRunRecord {
  return {
    id, channelId: CHANNEL, branchId: null,
    windowStart: `${month}-01`, windowEnd: month === "2026-08" ? "2026-08-31" : "2026-09-30",
    periodGrain: "month", windowTimezone: "Asia/Dubai", registryVersion: 1,
    detectorVersions: [], resultDigest: "f".repeat(64), status: "completed",
    findingCount: 1, observationCount: 1, needsDataCount: 0, safeFailureCode: null,
    startedAt: `${month}-02T00:00:00.000Z`, completedAt: `${month}-02T00:01:00.000Z`,
  };
}

describe("channel audit run selection", () => {
  it("loads a named completed run beyond the latest-ten page and selects its own window", async () => {
    const latest = run(NEW, "2026-09");
    const older = run(OLD, "2026-08");
    const loadRun = vi.fn(async () => older);
    const selected = await resolveAuditSelection({
      organizationId: ORG, channelId: CHANNEL, requestedRunId: OLD,
      runs: [latest], defaultWindow: { from: "2026-09-01", to: "2026-09-30" }, loadRun,
    });

    expect(selected.window).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(selected.displayedRun?.id).toBe(OLD);
    expect(selected.runs.map((item) => item.id)).toEqual([NEW, OLD]);
    expect(loadRun).toHaveBeenCalledWith({ organizationId: ORG, channelId: CHANNEL, analysisRunId: OLD });
  });

  it("does not expose a run missing from the scoped reader", async () => {
    const latest = run(NEW, "2026-09");
    const selected = await resolveAuditSelection({
      organizationId: ORG, channelId: CHANNEL, requestedRunId: OLD,
      runs: [latest], defaultWindow: { from: "2026-09-01", to: "2026-09-30" },
      loadRun: async () => null,
    });
    expect(selected.displayedRun?.id).toBe(NEW);
    expect(selected.runs).toEqual([latest]);
  });

  it("does not query a malformed run identifier", async () => {
    const loadRun = vi.fn(async () => run(OLD, "2026-08"));
    const selected = await resolveAuditSelection({
      organizationId: ORG, channelId: CHANNEL, requestedRunId: "not-a-run",
      runs: [], defaultWindow: null, loadRun,
    });
    expect(selected.displayedRun).toBeNull();
    expect(loadRun).not.toHaveBeenCalled();
  });
});
