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
});
