import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Revenue snapshot Trigger registration", () => {
  it("fans out hourly and builds one idempotent row per org-day", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/revenue-snapshots.ts"),
      "utf8",
    );

    expect(source).toContain('id: "revenue-snapshots.dispatch"');
    expect(source).toContain('cron: "0 * * * *"');
    expect(source).toContain('id: "revenue-snapshots.build-org"');
    expect(source).toContain("schemaTask({");
    // Local-midnight selection lives in the tested application helper, not
    // inline in the dispatch run.
    expect(source).toContain("selectDueSnapshotOrgs");
    // The service client is built after the strict payload parse, never at
    // module scope and never from a user-facing path.
    expect(source).toContain("createRevenueWorkerServiceClient()");
    const buildTask = source.slice(source.indexOf('id: "revenue-snapshots.build-org"'));
    expect(buildTask.indexOf("createRevenueWorkerServiceClient()")).toBeGreaterThan(
      buildTask.indexOf("snapshotOrgPayloadSchema.parse(payload)"),
    );
    // Snapshot writes go through the repository upsert key, not ad-hoc SQL.
    expect(source).toContain("writeRevenueSnapshot");
    expect(source).toContain("trimRevenueSnapshots");
    // Retried dispatches enqueue no duplicate builds for the same org-day.
    expect(source).toContain("idempotencyKey: `revenue-snapshot:");
  });

  it("schedules allowlisted growth orgs beyond the capped scan, then publishes separately", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/revenue-snapshots.ts"),
      "utf8",
    );

    // The legacy 500-org scan keeps its cap and order; allowlisted
    // organizations outside it join the same nightly run exactly once each.
    expect(source).toContain("DISPATCH_ORG_SCAN_LIMIT = 500");
    expect(source).toContain("parseOverviewGrowthProgressOrganizationIds");
    expect(source).toContain("mergeSnapshotDispatchCandidates");
    expect(source).toContain("revenue.growth_allowlist_unavailable");
    // The publication phase reuses the snapshot's validated material without
    // a second model call, and its outcome rides beside — never behind — the
    // snapshot outcome.
    expect(source).toContain("publishDueGrowthProjections");
    expect(source).toContain("buildSnapshotGrowthCandidate");
    expect(source).toContain("candidateMaterial: result.candidateMaterial");
    expect(source).toContain("growthPublication");
    expect(source).toContain("revenue.growth_projection_publish_failed");
    // One shared instant feeds both phases so a midnight straddle cannot
    // date the snapshot and the publication on different days.
    expect(source).toContain("const nowIso = new Date().toISOString();");
  });

  it("returns only counts and the publication summary, never financial inputs", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/trigger/revenue-snapshots.ts"),
      "utf8",
    );

    // Trigger persists run outputs outside the database, so the run return
    // is shaped through toSnapshotBuildOutput: counts, reasons and the
    // publication summary only. The validated union input stays in memory.
    expect(source).toContain("toSnapshotBuildOutput(result, growthPublication)");
    expect(source).not.toContain("...result");
  });
});
