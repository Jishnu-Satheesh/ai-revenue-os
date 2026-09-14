import { describe, expect, it } from "vitest";

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import {
  briefFixture,
  createFakeDispatch,
  createFakeEvents,
  createFakeProjects,
  createFakeStore,
  createFixtureDb,
  FIXTURE_IDS,
  startInputFixture,
  succeededResearchFixture,
} from "@/modules/growth-intelligence/application/market-monitoring-fixtures";
import {
  buildMonitoringCoverageChecklist,
  composeMonitoringReport,
  fingerprintMonitoringScope,
  MONITORING_UPDATE_ADAPTER_TIMEOUT_MS,
  MONITORING_UPDATE_LEASE_SECONDS,
  MONITORING_UPDATE_RESEARCH_DEADLINE_MS,
  MONITORING_UPDATE_SETTLE_HEADROOM_MS,
  MONITORING_UPDATE_TASK_MAX_DURATION_MS,
  MONITORING_UPDATE_TASK_MAX_DURATION_S,
  startMonitoringUpdate,
  summarizeMonitoringCost,
} from "@/modules/growth-intelligence/application/market-monitoring-update";

const FIXED_NOW = new Date("2026-09-14T06:00:00.000Z");

describe("monitoring deadline nesting (G45)", () => {
  it("nests adapter, research envelope, task and lease without extending paid time", () => {
    expect(MONITORING_UPDATE_TASK_MAX_DURATION_S).toBe(300);
    expect(MONITORING_UPDATE_ADAPTER_TIMEOUT_MS).toBeLessThan(
      MONITORING_UPDATE_RESEARCH_DEADLINE_MS,
    );
    expect(
      MONITORING_UPDATE_RESEARCH_DEADLINE_MS + MONITORING_UPDATE_SETTLE_HEADROOM_MS,
    ).toBe(MONITORING_UPDATE_TASK_MAX_DURATION_MS);
    expect(MONITORING_UPDATE_TASK_MAX_DURATION_MS).toBeLessThan(
      MONITORING_UPDATE_LEASE_SECONDS * 1_000,
    );
    // The update research envelope sits under the branch-path eight-minute
    // adapter deadline it replaces: paid work tightens, never widens.
    expect(MONITORING_UPDATE_RESEARCH_DEADLINE_MS).toBeLessThan(8 * 60_000);
  });
});

describe("startMonitoringUpdate", () => {
  const UPDATE_IDS = [
    "90000000-0000-4000-8000-000000000001",
    "90000000-0000-4000-8000-000000000002",
    "90000000-0000-4000-8000-000000000003",
  ];
  const REVISION_IDS = [
    "70000000-0000-4000-8000-000000000001",
    "70000000-0000-4000-8000-000000000002",
    "70000000-0000-4000-8000-000000000003",
  ];

  function harness(options: { failNudges?: boolean } = {}) {
    const db = createFixtureDb();
    let updateSequence = 0;
    let revisionSequence = 0;
    const deps = {
      projects: createFakeProjects(db),
      updates: createFakeStore(db),
      dispatch: createFakeDispatch(options),
      events: createFakeEvents(),
      now: () => FIXED_NOW,
      newUpdateId: () => UPDATE_IDS[updateSequence++ % UPDATE_IDS.length]!,
      newRevisionId: () => REVISION_IDS[revisionSequence++ % REVISION_IDS.length]!,
    };
    return { db, deps };
  }

  it("starts a fresh update with project, pinned revision, event and nudge", async () => {
    const { deps } = harness();
    const result = await startMonitoringUpdate(startInputFixture(), deps);

    expect(result.outcome).toBe("started");
    if (result.outcome !== "started") throw new Error("expected started");
    expect(result.nudge).toBe("sent");
    expect(deps.projects.saveCalls).toBe(1);
    expect(deps.dispatch.nudges).toHaveLength(1);
    expect(deps.dispatch.nudges[0]).toMatchObject({
      organizationId: FIXTURE_IDS.organizationId,
      projectId: result.projectId,
      updateId: result.updateId,
      briefRevisionId: result.briefRevisionId,
      actorId: FIXTURE_IDS.actorId,
      correlationId: FIXTURE_IDS.correlationId,
    });
    const requested = deps.events.events.filter((event) => event.eventName === "market_research.requested");
    expect(requested).toHaveLength(1);
    expect(requested[0]?.payload).toMatchObject({
      projectId: result.projectId,
      updateId: result.updateId,
      briefRevisionId: result.briefRevisionId,
    });
    const record = await deps.updates.get({
      organizationId: FIXTURE_IDS.organizationId,
      updateId: result.updateId,
    });
    expect(record?.dispatched).toBe(true);
    expect(record?.briefRevisionId).toBe(result.briefRevisionId);
    expect(record?.brief?.pinnedToUpdateId).toBe(result.updateId);
  });

  it("opens progress instead of duplicating paid work on identical scope", async () => {
    const { deps } = harness();
    const first = await startMonitoringUpdate(startInputFixture(), deps);
    if (first.outcome !== "started") throw new Error("expected started");

    const second = await startMonitoringUpdate(
      startInputFixture({ idempotencyKey: "start-key-2", correlationId: "11111111-0000-4000-8000-000000000011" }),
      deps,
    );

    expect(second).toMatchObject({ outcome: "opened_progress", updateId: first.updateId });
    expect(deps.projects.saveCalls).toBe(1);
    expect(deps.dispatch.nudges).toHaveLength(1);
    expect(deps.events.events.filter((event) => event.eventName === "market_research.requested")).toHaveLength(1);
  });

  it("treats manual refresh during an active update as progress", async () => {
    const { deps } = harness();
    const first = await startMonitoringUpdate(startInputFixture(), deps);
    if (first.outcome !== "started") throw new Error("expected started");

    const refresh = await startMonitoringUpdate(
      startInputFixture({ refresh: true, idempotencyKey: "refresh-key-1" }),
      deps,
    );
    expect(refresh.outcome).toBe("opened_progress");
    if (refresh.outcome !== "opened_progress") throw new Error("expected opened_progress");
    expect(refresh.updateId).toBe(first.updateId);
    expect(deps.dispatch.nudges).toHaveLength(1);
  });

  it("keeps the start successful with a lost nudge for the sweep", async () => {
    const { db, deps } = harness({ failNudges: true });
    const result = await startMonitoringUpdate(startInputFixture(), deps);

    expect(result.outcome).toBe("started");
    if (result.outcome !== "started") throw new Error("expected started");
    expect(result.nudge).toBe("lost");
    const record = await deps.updates.get({
      organizationId: FIXTURE_IDS.organizationId,
      updateId: result.updateId,
    });
    expect(record?.dispatched).toBe(false);
    const stale = await deps.updates.listUndispatched({ limit: 25 });
    expect(stale.map((row) => row.updateId)).toContain(result.updateId);
    expect(db.updates.size).toBe(1);
  });

  it("reuses an identically-scoped live project instead of creating", async () => {
    const { db, deps } = harness();
    const first = await startMonitoringUpdate(startInputFixture(), deps);
    if (first.outcome !== "started") throw new Error("expected started");
    await deps.updates.markTerminal({
      organizationId: FIXTURE_IDS.organizationId,
      updateId: first.updateId,
      stage: "cancelled",
      nowIso: FIXED_NOW.toISOString(),
    });

    const second = await startMonitoringUpdate(
      startInputFixture({ idempotencyKey: "start-key-2" }),
      deps,
    );
    expect(second.outcome).toBe("started");
    if (second.outcome !== "started") throw new Error("expected started");
    expect(second.projectId).toBe(first.projectId);
    expect(db.projects.size).toBe(1);
  });

  it("refuses a reused retry key on different scope", async () => {
    const { deps } = harness();
    await startMonitoringUpdate(startInputFixture(), deps);
    await expect(
      startMonitoringUpdate(
        startInputFixture({ question: "A completely different research question?" }),
        deps,
      ),
    ).rejects.toBeInstanceOf(GrowthIntelligenceError);
  });

  it("recovers the save race by joining the winner", async () => {
    const { db, deps } = harness();
    const first = await startMonitoringUpdate(startInputFixture(), deps);
    if (first.outcome !== "started") throw new Error("expected started");

    // The store lost the reservation after the pinned save (crash between
    // save and bind): the retry derives the winner from revision pins and
    // joins it instead of duplicating paid work.
    db.updates.delete(first.updateId);
    const second = await startMonitoringUpdate(
      startInputFixture({ idempotencyKey: "start-key-2" }),
      deps,
    );
    expect(second).toMatchObject({ outcome: "opened_progress", updateId: first.updateId });
    expect(deps.projects.saveCalls).toBe(1);
    expect(deps.dispatch.nudges).toHaveLength(2);
    expect(deps.dispatch.nudges[1]).toMatchObject({ updateId: first.updateId });
  });
});

describe("fingerprintMonitoringScope", () => {
  it("converges identical scope and separates different asks", () => {
    const base = startInputFixture();
    const left = fingerprintMonitoringScope({ ...base, frequency: "once" });
    const right = fingerprintMonitoringScope({
      ...base,
      investigationAreas: ["reviews", "demand"],
      frequency: "once",
    });
    expect(left).toBe(right);
    const changed = fingerprintMonitoringScope({
      ...base,
      question: "Another question entirely?",
      frequency: "once",
    });
    expect(changed).not.toBe(left);
  });
});

describe("buildMonitoringCoverageChecklist", () => {
  const brief = briefFixture();

  it("reports every requested dimension with honest statuses", () => {
    const checklist = buildMonitoringCoverageChecklist({
      brief,
      retrievalCoverage: [
        { slotKey: "area:demand", kind: "local_market", outcome: "supported" },
        { slotKey: "area:reviews", kind: "topic", outcome: "searched_no_usable_evidence" },
        { slotKey: "competitor:stitch-house", kind: "competitor", outcome: "failed" },
      ],
      supportedSlotKeys: new Set(["area:demand"]),
    });
    expect(checklist).toHaveLength(3);
    expect(checklist.find((entry) => entry.dimensionKey === "area:demand")?.status).toBe("supported");
    expect(checklist.find((entry) => entry.dimensionKey === "area:reviews")?.status).toBe("not-found");
    expect(checklist.find((entry) => entry.dimensionKey === "competitor:stitch-house")?.status).toBe(
      "unavailable",
    );
  });

  it("marks searched-but-uncited slots not-found and missing slots not-researched", () => {
    const checklist = buildMonitoringCoverageChecklist({
      brief,
      retrievalCoverage: [{ slotKey: "area:demand", kind: "local_market", outcome: "supported" }],
      supportedSlotKeys: new Set(),
    });
    expect(checklist.find((entry) => entry.dimensionKey === "area:demand")?.status).toBe("not-found");
    expect(checklist.find((entry) => entry.dimensionKey === "area:reviews")?.status).toBe("not-researched");
    expect(checklist.find((entry) => entry.dimensionKey === "competitor:stitch-house")?.status).toBe(
      "not-researched",
    );
  });

  it("marks skipped-budget slots not-researched", () => {
    const checklist = buildMonitoringCoverageChecklist({
      brief,
      retrievalCoverage: [{ slotKey: "area:demand", kind: "local_market", outcome: "skipped_budget" }],
      supportedSlotKeys: new Set(),
    });
    expect(checklist.find((entry) => entry.dimensionKey === "area:demand")?.status).toBe("not-researched");
  });
});

describe("composeMonitoringReport", () => {
  const brief = briefFixture();
  const research = succeededResearchFixture();
  const briefRevisionRowId = "71000000-0000-4000-8000-000000000001";

  function checklist() {
    return buildMonitoringCoverageChecklist({
      brief,
      retrievalCoverage: research.retrievalCoverage,
      supportedSlotKeys: new Set(["area:demand", "area:reviews", "competitor:stitch-house"]),
    });
  }

  it("persists a report that answers the saved question fixture", () => {
    const { content, evidenceDigest } = composeMonitoringReport({
      brief,
      briefRevisionRowId,
      findings: research.findings,
      sources: research.sources,
      draftAdvice: research.draftAdvice,
      coverage: checklist(),
      reportIds: {
        reportId: "a0000000-0000-4000-8000-00000000000a",
        reportVersionId: "b0000000-0000-4000-8000-00000000000b",
      },
    });
    expect(content.briefRevisionId).toBe(briefRevisionRowId);
    expect(content.summary).toContain(brief.question);
    expect(content.summary).toContain("Three cited listings show tailoring shops");
    expect(content.competitorComparison).toHaveLength(1);
    expect(content.competitorComparison[0]?.competitorName).toBe("Stitch House");
    expect(content.draftAdvice).toHaveLength(2);
    expect(content.sources).toHaveLength(3);
    expect(content.gaps).toHaveLength(0);
    expect(content.evidenceDigest).toBe(evidenceDigest);
    expect(content.plainLanguageRequired).toBe(true);
    expect(content.speculativeEstimate).toBeUndefined();
  });

  it("lists unsupported dimensions as gaps instead of omitting them", () => {
    const partial = buildMonitoringCoverageChecklist({
      brief,
      retrievalCoverage: [
        { slotKey: "area:demand", kind: "local_market", outcome: "supported" },
        { slotKey: "area:reviews", kind: "topic", outcome: "failed" },
        { slotKey: "competitor:stitch-house", kind: "competitor", outcome: "supported" },
      ],
      supportedSlotKeys: new Set(["area:demand", "competitor:stitch-house"]),
    });
    const { content } = composeMonitoringReport({
      brief,
      briefRevisionRowId,
      findings: research.findings,
      sources: research.sources,
      draftAdvice: research.draftAdvice,
      coverage: partial,
      reportIds: {
        reportId: "a0000000-0000-4000-8000-00000000000a",
        reportVersionId: "b0000000-0000-4000-8000-00000000000b",
      },
    });
    expect(content.gaps.map((gap) => gap.description)).toEqual(
      expect.arrayContaining([expect.stringContaining("area:reviews")]),
    );
  });

  it("refuses empty findings, missing competitors and partial estimates", () => {
    const ids = {
      reportId: "a0000000-0000-4000-8000-00000000000a",
      reportVersionId: "b0000000-0000-4000-8000-00000000000b",
    };
    expect(() =>
      composeMonitoringReport({
        brief,
        briefRevisionRowId,
        findings: [],
        sources: research.sources,
        draftAdvice: [],
        coverage: checklist(),
        reportIds: ids,
      }),
    ).toThrow();
    expect(() =>
      composeMonitoringReport({
        brief: briefFixture({ competitors: [] }),
        briefRevisionRowId,
        findings: research.findings,
        sources: research.sources,
        draftAdvice: [],
        coverage: [],
        reportIds: ids,
      }),
    ).toThrow();
    expect(() =>
      composeMonitoringReport({
        brief,
        briefRevisionRowId,
        findings: research.findings,
        sources: research.sources,
        draftAdvice: [],
        speculativeEstimate: { label: "Guess" } as never,
        coverage: checklist(),
        reportIds: ids,
      }),
    ).toThrow();
  });

  it("accepts a fully-labelled speculative estimate block", () => {
    const { content } = composeMonitoringReport({
      brief,
      briefRevisionRowId,
      findings: research.findings,
      sources: research.sources,
      draftAdvice: [],
      speculativeEstimate: {
        label: "Speculative range, not observed revenue",
        range: { lowMinorUnits: 100000, highMinorUnits: 200000, currency: "AED" },
        assumptions: ["Assumes two evening tailors."],
        reasoning: "Priced from the cited express price list times observed footfall.",
      },
      coverage: checklist(),
      reportIds: {
        reportId: "a0000000-0000-4000-8000-00000000000a",
        reportVersionId: "b0000000-0000-4000-8000-00000000000b",
      },
    });
    expect(content.speculativeEstimate?.label).toContain("Speculative");
  });
});

describe("summarizeMonitoringCost", () => {
  it("keeps unknown cost reserved instead of zeroing it", () => {
    const summary = summarizeMonitoringCost([
      { kind: "reported", microsUsd: 1200 },
      { kind: "unknown" },
    ]);
    expect(summary).toEqual({ knownMicrosUsd: 1200, unknownCount: 1 });
  });
});
