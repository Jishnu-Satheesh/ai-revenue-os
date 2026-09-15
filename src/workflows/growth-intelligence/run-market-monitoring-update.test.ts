import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { marketMonitoringReportSchema } from "@/domain/growth-intelligence/report";
import {
  briefFixture,
  createFakeEvents,
  createFakePersister,
  createFakeResearcher,
  createFakeStore,
  createFixtureDb,
  FIXTURE_IDS,
  succeededResearchFixture,
} from "@/modules/growth-intelligence/application/market-monitoring-fixtures";
import {
  MONITORING_UPDATE_LEASE_SECONDS,
  MONITORING_UPDATE_RESEARCH_DEADLINE_MS,
  startMonitoringUpdate,
  type MonitoringResearcher,
} from "@/modules/growth-intelligence/application/market-monitoring-update";
import { createFakeDispatch, createFakeProjects } from "@/modules/growth-intelligence/application/market-monitoring-fixtures";
import {
  compareMonitoringScope,
  createPinReadMonitoringUpdateStore,
  marketMonitoringUpdatePayloadSchema,
  runMarketMonitoringUpdate,
  type MonitoringUpdateLifecycleHooks,
} from "@/workflows/growth-intelligence/run-market-monitoring-update";

const FIXED_NOW = new Date("2026-09-14T06:00:00.000Z");

const ALLOWED_EVENT_NAMES = new Set([
  "market_research.requested",
  "market_research.completed",
  "market_research.partially_completed",
  "market_research.failed",
  "growth_intelligence.synthesized",
]);

function stableIds() {
  return {
    reportId: "a0000000-0000-4000-8000-00000000000a",
    reportVersionId: "b0000000-0000-4000-8000-00000000000b",
  };
}

async function startedUpdate() {
  const db = createFixtureDb();
  const events = createFakeEvents();
  const dispatch = createFakeDispatch();
  const projects = createFakeProjects(db);
  const updates = createFakeStore(db);
  const started = await startMonitoringUpdate(
    {
      organizationId: FIXTURE_IDS.organizationId,
      branchId: FIXTURE_IDS.branchId,
      title: "Ramadan evening demand",
      question: "How does demand for late-night tailoring change during Ramadan?",
      mode: "one-time",
      researchArea: "Deira",
      competitors: [{ name: "Stitch House", source: "suggestion" }],
      investigationAreas: ["demand", "reviews"],
      businessContextSnapshotId: FIXTURE_IDS.snapshotId,
      actorId: FIXTURE_IDS.actorId,
      idempotencyKey: "worker-start-1",
      correlationId: FIXTURE_IDS.correlationId,
    },
    {
      projects,
      updates,
      dispatch,
      events,
      now: () => FIXED_NOW,
      newUpdateId: () => "91000000-0000-4000-8000-000000000001",
      newRevisionId: () => "71000000-0000-4000-8000-000000000001",
    },
  );
  if (started.outcome !== "started") throw new Error("fixture start failed");
  const nudge = dispatch.nudges[0];
  if (!nudge) throw new Error("fixture nudge missing");
  const payload = marketMonitoringUpdatePayloadSchema.parse({
    organizationId: nudge.organizationId,
    projectId: nudge.projectId,
    updateId: nudge.updateId,
    briefRevisionId: nudge.briefRevisionId,
    brief: nudge.brief,
    actorId: nudge.actorId,
    correlationId: nudge.correlationId,
  });
  return { db, events, updates, payload };
}

describe("runMarketMonitoringUpdate", () => {
  it("persists a ready report that answers the saved question", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    const researchCalls: Array<Parameters<MonitoringResearcher>[0]> = [];
    const persister = createFakePersister(db);
    const research = createFakeResearcher(succeededResearchFixture(), { capture: researchCalls });

    const result = await runMarketMonitoringUpdate(payload, {
      updates,
      research,
      reports: persister,
      events,
      now: () => FIXED_NOW,
      newReportIds: stableIds,
    });

    expect(result).toMatchObject({ outcome: "ready", reportVersionId: stableIds().reportVersionId });
    expect(persister.persistCalls).toBe(1);
    expect(updates.settleCalls).toBe(1);
    const row = db.reports.get(stableIds().reportVersionId);
    expect(row).toBeDefined();
    const content = marketMonitoringReportSchema.parse(row?.content);
    expect(content.summary).toContain("How does demand for late-night tailoring change during Ramadan?");
    expect(content.projectId).toBe(payload.projectId);
    expect(content.briefRevisionId).toBe(payload.briefRevisionId);
    expect(row?.evidenceDigest).toBe(content.evidenceDigest);
    const record = await updates.get({
      organizationId: FIXTURE_IDS.organizationId,
      updateId: payload.updateId,
    });
    expect(record?.status).toBe("ready");
    expect(record?.reportVersionId).toBe(stableIds().reportVersionId);
    // Unknown cost stays reserved on the update, never zeroed.
    expect(record?.unknownCostCount).toBe(1);
    expect(record?.knownCostMicrosUsd).toBe(1200);
    // Research ran inside the G45 envelope with public queries only.
    expect(researchCalls[0]).toMatchObject({ deadlineMs: MONITORING_UPDATE_RESEARCH_DEADLINE_MS });
    const names = events.events.map((event) => event.eventName);
    expect(names).toContain("market_research.completed");
    expect(names).toContain("growth_intelligence.synthesized");
    for (const name of names) expect(ALLOWED_EVENT_NAMES.has(name)).toBe(true);
  });

  it("lands partial with gaps when coverage is incomplete", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    const outcome = succeededResearchFixture();
    outcome.retrievalCoverage = [
      { slotKey: "area:demand", kind: "local_market", outcome: "supported" },
      { slotKey: "area:reviews", kind: "topic", outcome: "failed" },
      { slotKey: "competitor:stitch-house", kind: "competitor", outcome: "supported" },
    ];
    const persister = createFakePersister(db);

    const result = await runMarketMonitoringUpdate(payload, {
      updates,
      research: createFakeResearcher(outcome),
      reports: persister,
      events,
      now: () => FIXED_NOW,
      newReportIds: stableIds,
    });

    expect(result.outcome).toBe("partial");
    const row = db.reports.get(stableIds().reportVersionId);
    const content = marketMonitoringReportSchema.parse(row?.content);
    expect(content.gaps.length).toBeGreaterThan(0);
    expect(events.events.map((event) => event.eventName)).toContain(
      "market_research.partially_completed",
    );
  });

  it("lands empty without persisting when research finds nothing usable", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    const outcome = succeededResearchFixture();
    outcome.findings = [];
    outcome.retrievalCoverage = [
      { slotKey: "area:demand", kind: "local_market", outcome: "searched_no_usable_evidence" },
      { slotKey: "area:reviews", kind: "topic", outcome: "searched_no_usable_evidence" },
      { slotKey: "competitor:stitch-house", kind: "competitor", outcome: "searched_no_usable_evidence" },
    ];
    const persister = createFakePersister(db);

    const result = await runMarketMonitoringUpdate(payload, {
      updates,
      research: createFakeResearcher(outcome),
      reports: persister,
      events,
      now: () => FIXED_NOW,
      newReportIds: stableIds,
    });

    expect(result).toMatchObject({ outcome: "no_findings", reportVersionId: null });
    expect(persister.persistCalls).toBe(0);
    expect(db.reports.size).toBe(0);
  });

  it("retains the prior report when research fails", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    const priorVersionId = "c0000000-0000-4000-8000-00000000000c";
    db.reports.set(priorVersionId, {
      reportVersionId: priorVersionId,
      content: { briefRevisionId: payload.briefRevisionId, marker: "prior" },
      evidenceDigest: "prior",
    });
    const persister = createFakePersister(db);

    const result = await runMarketMonitoringUpdate(payload, {
      updates,
      research: createFakeResearcher({
        status: "failed",
        code: "ADAPTER_UNAVAILABLE",
        retrievalCoverage: [],
        usages: [{ kind: "unknown" }],
      }),
      reports: persister,
      events,
      now: () => FIXED_NOW,
      newReportIds: stableIds,
    });

    expect(result).toMatchObject({ outcome: "research_failed", reportVersionId: null });
    expect(persister.persistCalls).toBe(0);
    expect(db.reports.get(priorVersionId)).toBeDefined();
    expect(db.reports.size).toBe(1);
    const record = await updates.get({
      organizationId: FIXTURE_IDS.organizationId,
      updateId: payload.updateId,
    });
    expect(record?.status).toBe("research_failed");
    expect(record?.unknownCostCount).toBe(1);
    const failed = events.events.filter((event) => event.eventName === "market_research.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.payload).toMatchObject({ phase: "research", code: "ADAPTER_UNAVAILABLE" });
  });

  it("marks synthesis_failed without persisting when composition is invalid", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    const outcome = succeededResearchFixture();
    outcome.findings = [
      {
        key: "bad-citation",
        statement: "A finding with an unusable citation.",
        slotKey: "area:demand",
        citations: [{ claimId: "not-a-uuid" }],
      },
    ];
    const persister = createFakePersister(db);

    const result = await runMarketMonitoringUpdate(payload, {
      updates,
      research: createFakeResearcher(outcome),
      reports: persister,
      events,
      now: () => FIXED_NOW,
      newReportIds: stableIds,
    });

    expect(result).toMatchObject({ outcome: "synthesis_failed", reportVersionId: null });
    expect(persister.persistCalls).toBe(0);
    const failed = events.events.filter((event) => event.eventName === "market_research.failed");
    expect(failed[0]?.payload).toMatchObject({ phase: "synthesis" });
  });

  it("never marks ready on root-research success alone: persist failure stays non-terminal", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    const persister = createFakePersister(db, { throwError: new Error("database unreachable") });

    await expect(
      runMarketMonitoringUpdate(payload, {
        updates,
        research: createFakeResearcher(succeededResearchFixture()),
        reports: persister,
        events,
        now: () => FIXED_NOW,
        newReportIds: stableIds,
      }),
    ).rejects.toThrow("database unreachable");

    const record = await updates.get({
      organizationId: FIXTURE_IDS.organizationId,
      updateId: payload.updateId,
    });
    expect(record?.status).toBe("preparing_insights");
    expect(record?.reportVersionId).toBeNull();
    expect(updates.settleCalls).toBe(1);
    expect(db.reports.size).toBe(0);
  });

  it("replays duplicate delivery without new writes", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    const persister = createFakePersister(db);
    const research = createFakeResearcher(succeededResearchFixture());
    const deps = {
      updates,
      research,
      reports: persister,
      events,
      now: () => FIXED_NOW,
      newReportIds: stableIds,
    };
    const first = await runMarketMonitoringUpdate(payload, deps);
    expect(first.outcome).toBe("ready");

    const replayed = await runMarketMonitoringUpdate(payload, deps);
    expect(replayed).toMatchObject({ outcome: "replayed", stage: "ready" });
    expect(persister.persistCalls).toBe(1);
    expect(updates.settleCalls).toBe(1);
    expect(db.reports.size).toBe(1);
  });

  it("reuses the minted report version when settling twice converges", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    const persister = createFakePersister(db);
    await runMarketMonitoringUpdate(payload, {
      updates,
      research: createFakeResearcher(succeededResearchFixture()),
      reports: persister,
      events,
      now: () => FIXED_NOW,
      newReportIds: () => ({ reportId: crypto.randomUUID(), reportVersionId: crypto.randomUUID() }),
    });
    expect(db.reports.size).toBe(1);
  });

  it("cancels on an aborted signal without persisting", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    const persister = createFakePersister(db);
    const controller = new AbortController();
    controller.abort();

    const result = await runMarketMonitoringUpdate(payload, {
      updates,
      research: createFakeResearcher(succeededResearchFixture()),
      reports: persister,
      events,
      now: () => FIXED_NOW,
      newReportIds: stableIds,
      signal: controller.signal,
    });

    expect(result.outcome).toBe("cancelled");
    expect(persister.persistCalls).toBe(0);
    const record = await updates.get({
      organizationId: FIXTURE_IDS.organizationId,
      updateId: payload.updateId,
    });
    expect(record?.status).toBe("cancelled");
  });

  it("refuses cross-org briefs, pin drift and unknown updates", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    const deps = {
      updates,
      research: createFakeResearcher(succeededResearchFixture()),
      reports: createFakePersister(db),
      events,
      now: () => FIXED_NOW,
      newReportIds: stableIds,
    };
    await expect(
      runMarketMonitoringUpdate(
        { ...payload, brief: briefFixture({ organizationId: FIXTURE_IDS.otherOrganizationId }) },
        deps,
      ),
    ).rejects.toThrow();
    await expect(
      runMarketMonitoringUpdate(
        {
          ...payload,
          brief: briefFixture({
            projectId: payload.projectId,
            pinnedToUpdateId: "92000000-0000-4000-8000-000000000002",
          }),
        },
        deps,
      ),
    ).rejects.toThrow("pinned to another update");
    const unknownUpdateId = "93000000-0000-4000-8000-000000000003";
    await expect(
      runMarketMonitoringUpdate(
        {
          ...payload,
          updateId: unknownUpdateId,
          brief: briefFixture({ projectId: payload.projectId, pinnedToUpdateId: unknownUpdateId }),
        },
        deps,
      ),
    ).rejects.toThrow("could not be found");
    expect(db.reports.size).toBe(0);
  });

  it("propagates transient research throws for Trigger redelivery", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    await expect(
      runMarketMonitoringUpdate(payload, {
        updates,
        research: createFakeResearcher(succeededResearchFixture(), {
          throwError: new Error("connection reset"),
        }),
        reports: createFakePersister(db),
        events,
        now: () => FIXED_NOW,
        newReportIds: stableIds,
      }),
    ).rejects.toThrow("connection reset");
    const record = await updates.get({
      organizationId: FIXTURE_IDS.organizationId,
      updateId: payload.updateId,
    });
    expect(record?.status).toBe("queued");
  });

  it("reports no invented completion figures", async () => {
    const { updates, payload } = await startedUpdate();
    const result = await runMarketMonitoringUpdate(payload, {
      updates,
      research: createFakeResearcher(succeededResearchFixture()),
      reports: createFakePersister(createFixtureDb()),
      events: createFakeEvents(),
      now: () => FIXED_NOW,
      newReportIds: stableIds,
    });
    const serialized = JSON.stringify(result);
    for (const invented of ["percent", "eta", "etaSeconds", "progressPercent", "completesIn"]) {
      expect(serialized).not.toContain(invented);
    }
  });

describe("createPinReadMonitoringUpdateStore", () => {
  const pinReadsFixture = () => {
    const pins = [
      {
        revisionId: "71000000-0000-4000-8000-000000000001",
        revisionNumber: 1,
        pinnedToUpdateId: "91000000-0000-4000-8000-000000000001",
      },
    ];
    const reports: Array<{ briefRevisionId: string; reportVersionId: string }> = [];
    return {
      pins,
      reports,
      reads: {
        listRevisionPins: async () => [...pins],
        listReportRevisions: async () => [...reports],
      },
    };
  };

  function openInput(overrides = {}) {
    return {
      organizationId: FIXTURE_IDS.organizationId,
      projectId: "81000000-0000-4000-8000-000000000001",
      actorId: FIXTURE_IDS.actorId,
      revisionNumber: 1,
      scopeFingerprint: "fingerprint-1",
      updateId: "91000000-0000-4000-8000-000000000001",
      idempotencyKey: "pin-key-1",
      nowIso: "2026-09-14T06:00:00.000Z",
      ...overrides,
    };
  }

  it("derives active updates from pins and buries reported ones", async () => {
    const { reads, reports } = pinReadsFixture();
    const store = createPinReadMonitoringUpdateStore(reads, () => FIXED_NOW);
    const active = await store.findActive({
      organizationId: FIXTURE_IDS.organizationId,
      projectId: "81000000-0000-4000-8000-000000000001",
    });
    expect(active?.updateId).toBe("91000000-0000-4000-8000-000000000001");
    expect(active?.brief).toBeNull();

    reports.push({
      briefRevisionId: "71000000-0000-4000-8000-000000000001",
      reportVersionId: "b0000000-0000-4000-8000-00000000000b",
    });
    await expect(
      store.findActive({
        organizationId: FIXTURE_IDS.organizationId,
        projectId: "81000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toBeNull();
  });

  it("converges concurrent opens and reopens on the retry key", async () => {
    const { reads } = pinReadsFixture();
    const store = createPinReadMonitoringUpdateStore(reads, () => FIXED_NOW);
    // A pinned revision without a local record converges the open: the
    // derived pin wins over a fresh reservation.
    const joined = await store.open(openInput());
    expect(joined.created).toBe(false);
    expect(joined.record.updateId).toBe("91000000-0000-4000-8000-000000000001");
  });

  it("converges fresh opens onto derived pins", async () => {
    const { reads } = pinReadsFixture();
    const store = createPinReadMonitoringUpdateStore(reads, () => FIXED_NOW);
    const opened = await store.open(
      openInput({
        updateId: "92000000-0000-4000-8000-000000000002",
        idempotencyKey: "pin-key-2",
        scopeFingerprint: "fingerprint-2",
      }),
    );
    // The derived pin still converges first: no duplicate paid work.
    expect(opened.created).toBe(false);
  });
});

describe("pin store reservation lifecycle", () => {
  it("creates, binds and settles a local reservation", async () => {
    const store = createPinReadMonitoringUpdateStore(
      { listRevisionPins: async () => [], listReportRevisions: async () => [] },
      () => FIXED_NOW,
    );
    const opened = await store.open({
      organizationId: FIXTURE_IDS.organizationId,
      projectId: "81000000-0000-4000-8000-000000000001",
      actorId: FIXTURE_IDS.actorId,
      revisionNumber: 1,
      scopeFingerprint: "fingerprint-1",
      updateId: "91000000-0000-4000-8000-000000000001",
      idempotencyKey: "pin-key-1",
      nowIso: "2026-09-14T06:00:00.000Z",
    });
    expect(opened.created).toBe(true);
    const bound = await store.bindRevision({
      organizationId: FIXTURE_IDS.organizationId,
      updateId: "91000000-0000-4000-8000-000000000001",
      briefRevisionId: "71000000-0000-4000-8000-000000000001",
      revisionNumber: 1,
      brief: briefFixture(),
    });
    expect(bound.briefRevisionId).toBe("71000000-0000-4000-8000-000000000001");
    const reopened = await store.open({
      organizationId: FIXTURE_IDS.organizationId,
      projectId: "81000000-0000-4000-8000-000000000001",
      actorId: FIXTURE_IDS.actorId,
      revisionNumber: 1,
      scopeFingerprint: "fingerprint-1",
      updateId: "92000000-0000-4000-8000-000000000002",
      idempotencyKey: "pin-key-1",
      nowIso: "2026-09-14T06:00:00.000Z",
    });
    expect(reopened.created).toBe(false);
    expect(reopened.record.updateId).toBe("91000000-0000-4000-8000-000000000001");
  });
});

describe("worker over pin-read store (production get-miss derivation)", () => {
  const PIN_PROJECT_ID = "81000000-0000-4000-8000-000000000001";
  const PIN_UPDATE_ID = "91000000-0000-4000-8000-000000000001";
  const PIN_REVISION_ID = "71000000-0000-4000-8000-000000000001";

  function pinPayload() {
    return marketMonitoringUpdatePayloadSchema.parse({
      organizationId: FIXTURE_IDS.organizationId,
      projectId: PIN_PROJECT_ID,
      updateId: PIN_UPDATE_ID,
      briefRevisionId: PIN_REVISION_ID,
      brief: briefFixture({
        organizationId: FIXTURE_IDS.organizationId,
        projectId: PIN_PROJECT_ID,
        pinnedToUpdateId: PIN_UPDATE_ID,
      }),
      actorId: FIXTURE_IDS.actorId,
      correlationId: FIXTURE_IDS.correlationId,
    });
  }

  function pinReadsFixture(options: {
    pins?: Array<{ revisionId: string; revisionNumber: number; pinnedToUpdateId: string | null }>;
    reports?: Array<{ briefRevisionId: string; reportVersionId: string }>;
    terminals?: Array<{ updateId: string; stage: "cancelled" }>;
    pinLookup?: { projectId: string; revisionId: string; revisionNumber: number } | null;
  }) {
    const pins = options.pins ?? [];
    const reports = options.reports ?? [];
    const terminals = options.terminals ?? [];
    const lookup = options.pinLookup;
    return {
      listRevisionPins: async () => [...pins],
      listReportRevisions: async () => [...reports],
      findPinByUpdateId: async () => (lookup === undefined ? null : lookup),
      listTerminalUpdates: async () => [...terminals],
    };
  }

  it("hit: a bound local reservation runs without pin derivation", async () => {
    const store = createPinReadMonitoringUpdateStore(
      pinReadsFixture({}),
      () => FIXED_NOW,
    );
    await store.open({
      organizationId: FIXTURE_IDS.organizationId,
      projectId: PIN_PROJECT_ID,
      actorId: FIXTURE_IDS.actorId,
      revisionNumber: 1,
      scopeFingerprint: "pin-hit-fp",
      updateId: PIN_UPDATE_ID,
      idempotencyKey: "pin-hit-key",
      nowIso: "2026-09-14T06:00:00.000Z",
    });
    await store.bindRevision({
      organizationId: FIXTURE_IDS.organizationId,
      updateId: PIN_UPDATE_ID,
      briefRevisionId: PIN_REVISION_ID,
      revisionNumber: 1,
      brief: briefFixture({
        organizationId: FIXTURE_IDS.organizationId,
        projectId: PIN_PROJECT_ID,
        pinnedToUpdateId: PIN_UPDATE_ID,
      }),
    });
    const researchCalls: Array<Parameters<MonitoringResearcher>[0]> = [];
    const result = await runMarketMonitoringUpdate(pinPayload(), {
      updates: store,
      research: createFakeResearcher(succeededResearchFixture(), { capture: researchCalls }),
      reports: createFakePersister(createFixtureDb()),
      events: createFakeEvents(),
      now: () => FIXED_NOW,
      newReportIds: stableIds,
    });
    expect(result).toMatchObject({ outcome: "ready", updateId: PIN_UPDATE_ID });
    expect(researchCalls).toHaveLength(1);
  });

  it("miss-with-pin: a fresh worker materializes the reservation from the persisted pin", async () => {
    const store = createPinReadMonitoringUpdateStore(
      pinReadsFixture({
        pins: [{ revisionId: PIN_REVISION_ID, revisionNumber: 1, pinnedToUpdateId: PIN_UPDATE_ID }],
        pinLookup: { projectId: PIN_PROJECT_ID, revisionId: PIN_REVISION_ID, revisionNumber: 1 },
      }),
      () => FIXED_NOW,
    );
    const researchCalls: Array<Parameters<MonitoringResearcher>[0]> = [];
    const result = await runMarketMonitoringUpdate(pinPayload(), {
      updates: store,
      research: createFakeResearcher(succeededResearchFixture(), { capture: researchCalls }),
      reports: createFakePersister(createFixtureDb()),
      events: createFakeEvents(),
      now: () => FIXED_NOW,
      newReportIds: stableIds,
    });
    expect(result).toMatchObject({ outcome: "ready", updateId: PIN_UPDATE_ID });
    expect(researchCalls).toHaveLength(1);
    const materialized = await store.get({
      organizationId: FIXTURE_IDS.organizationId,
      updateId: PIN_UPDATE_ID,
    });
    expect(materialized?.projectId).toBe(PIN_PROJECT_ID);
    expect(materialized?.briefRevisionId).toBe(PIN_REVISION_ID);
  });

  it("miss-without-pin: a worker with no pin keeps the not-found throw and spends nothing", async () => {
    const store = createPinReadMonitoringUpdateStore(
      pinReadsFixture({ pinLookup: null }),
      () => FIXED_NOW,
    );
    const db = createFixtureDb();
    const researchCalls: Array<Parameters<MonitoringResearcher>[0]> = [];
    await expect(
      runMarketMonitoringUpdate(pinPayload(), {
        updates: store,
        research: createFakeResearcher(succeededResearchFixture(), { capture: researchCalls }),
        reports: createFakePersister(db),
        events: createFakeEvents(),
        now: () => FIXED_NOW,
        newReportIds: stableIds,
      }),
    ).rejects.toThrow("could not be found");
    expect(researchCalls).toHaveLength(0);
    expect(db.reports.size).toBe(0);
  });

  it("cancelled-pin: a terminal pin replays cancelled and a refresh starts fresh", async () => {
    const store = createPinReadMonitoringUpdateStore(
      pinReadsFixture({
        pins: [{ revisionId: PIN_REVISION_ID, revisionNumber: 1, pinnedToUpdateId: PIN_UPDATE_ID }],
        pinLookup: { projectId: PIN_PROJECT_ID, revisionId: PIN_REVISION_ID, revisionNumber: 1 },
        terminals: [{ updateId: PIN_UPDATE_ID, stage: "cancelled" }],
      }),
      () => FIXED_NOW,
    );
    const researchCalls: Array<Parameters<MonitoringResearcher>[0]> = [];
    const result = await runMarketMonitoringUpdate(pinPayload(), {
      updates: store,
      research: createFakeResearcher(succeededResearchFixture(), { capture: researchCalls }),
      reports: createFakePersister(createFixtureDb()),
      events: createFakeEvents(),
      now: () => FIXED_NOW,
      newReportIds: stableIds,
    });
    expect(result).toMatchObject({ outcome: "replayed", stage: "cancelled" });
    expect(researchCalls).toHaveLength(0);
    await expect(
      store.findActive({
        organizationId: FIXTURE_IDS.organizationId,
        projectId: PIN_PROJECT_ID,
      }),
    ).resolves.toBeNull();
  });
});

describe("Slice 7 lifecycle durability", () => {
  function fakeLifecycle(order: string[]) {
    const opens: Array<Parameters<MonitoringUpdateLifecycleHooks["open"]>[0]> = [];
    const settles: Array<Parameters<MonitoringUpdateLifecycleHooks["settle"]>[0]> = [];
    const hooks: MonitoringUpdateLifecycleHooks = {
      open: async (input) => {
        opens.push(input);
        order.push("open");
        return { stage: "queued", attempts: 1, replayed: false };
      },
      settle: async (input) => {
        settles.push(input);
        order.push(`settle:${input.stage}`);
        return { replayed: false };
      },
    };
    return { opens, settles, hooks };
  }

  it("opens with the G45 lease before research and settles the exact terminal after", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    const order: string[] = [];
    const { opens, settles, hooks } = fakeLifecycle(order);
    const persister = createFakePersister(db);

    const result = await runMarketMonitoringUpdate(payload, {
      updates,
      research: createFakeResearcher(succeededResearchFixture(), {
        capture: [],
      }),
      reports: persister,
      events,
      lifecycle: hooks,
      now: () => FIXED_NOW,
      newReportIds: stableIds,
    });

    expect(result).toMatchObject({ outcome: "ready", scopeDrift: false });
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({
      organizationId: FIXTURE_IDS.organizationId,
      projectId: payload.projectId,
      updateId: payload.updateId,
      leaseSeconds: MONITORING_UPDATE_LEASE_SECONDS,
    });
    expect(MONITORING_UPDATE_LEASE_SECONDS).toBe(600);
    expect(settles).toHaveLength(1);
    expect(settles[0]).toMatchObject({
      stage: "ready",
      reasonCode: null,
      retryable: false,
    });
    expect(order).toEqual(["open", "settle:ready"]);
  });

  it("backfills every requested dimension as unavailable on research failure", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    const order: string[] = [];
    const { settles, hooks } = fakeLifecycle(order);

    const result = await runMarketMonitoringUpdate(payload, {
      updates,
      research: createFakeResearcher({
        status: "failed",
        code: "ADAPTER_UNAVAILABLE",
        retrievalCoverage: [],
        usages: [],
      }),
      reports: createFakePersister(db),
      events,
      lifecycle: hooks,
      now: () => FIXED_NOW,
      newReportIds: stableIds,
    });

    expect(result).toMatchObject({ outcome: "research_failed", reportVersionId: null });
    const coverage = settles[0]?.coverage ?? [];
    expect(coverage).toHaveLength(3);
    for (const entry of coverage) {
      expect(entry.status).toBe("unavailable");
    }
    expect(new Set(coverage.map((entry) => entry.dimensionKey))).toEqual(
      new Set(["area:demand", "area:reviews", "competitor:stitch-house"]),
    );
    expect(settles[0]).toMatchObject({
      reasonCode: "ADAPTER_UNAVAILABLE",
      retryable: true,
    });
    const record = await updates.get({
      organizationId: FIXTURE_IDS.organizationId,
      updateId: payload.updateId,
    });
    expect(record?.coverage).toHaveLength(3);
  });

  it("settles cancelled durably with the worker reason", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    const order: string[] = [];
    const { settles, hooks } = fakeLifecycle(order);
    const controller = new AbortController();
    controller.abort();

    const result = await runMarketMonitoringUpdate(payload, {
      updates,
      research: createFakeResearcher(succeededResearchFixture()),
      reports: createFakePersister(db),
      events,
      lifecycle: hooks,
      now: () => FIXED_NOW,
      newReportIds: stableIds,
      signal: controller.signal,
    });

    expect(result).toMatchObject({ outcome: "cancelled" });
    expect(settles).toHaveLength(1);
    expect(settles[0]).toMatchObject({
      stage: "cancelled",
      reasonCode: "WORKER_CANCELLED",
      retryable: false,
      coverage: null,
    });
  });

  it("flags scope drift when the incoming brief differs from the bound record", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    const deps = {
      updates,
      research: createFakeResearcher(succeededResearchFixture()),
      reports: createFakePersister(db),
      events,
      now: () => FIXED_NOW,
      newReportIds: stableIds,
    };

    const same = await runMarketMonitoringUpdate(payload, deps);
    expect(same).toMatchObject({ outcome: "ready", scopeDrift: false });

    const { db: db2, events: events2, updates: updates2, payload: payload2 } =
      await startedUpdate();
    const drifted = await runMarketMonitoringUpdate(
      { ...payload2, brief: { ...payload2.brief, question: "What changed for lunch?" } },
      { ...deps, updates: updates2, events: events2, reports: createFakePersister(db2) },
    );
    expect(drifted).toMatchObject({ outcome: "ready", scopeDrift: true });
  });

  it("compares scopes field by field with order-insensitive lists", () => {
    const active = {
      question: "How does demand change?",
      researchArea: "Deira",
      competitors: [{ name: "Stitch House" }],
      investigationAreas: ["reviews", "demand"],
      businessContextSnapshotId: FIXTURE_IDS.snapshotId,
      frequency: "once",
    };
    expect(compareMonitoringScope({ active: null, incoming: active })).toEqual({
      drifted: false,
      changedFields: [],
    });
    expect(compareMonitoringScope({ active, incoming: { ...active } })).toEqual({
      drifted: false,
      changedFields: [],
    });
    expect(
      compareMonitoringScope({
        active,
        incoming: { ...active, investigationAreas: ["demand", "reviews"] },
      }).drifted,
    ).toBe(false);
    const drifted = compareMonitoringScope({
      active,
      incoming: {
        ...active,
        question: "What changed?",
        competitors: [{ name: "New Rival" }],
      },
    });
    expect(drifted.drifted).toBe(true);
    expect(drifted.changedFields).toEqual(["question", "competitors"]);
  });

  it("replays the exact lifecycle stage for reported pins, replacing conservative-ready", async () => {
    const pinReads = {
      listRevisionPins: async () => [
        {
          revisionId: "71000000-0000-4000-8000-000000000001",
          revisionNumber: 1,
          pinnedToUpdateId: "91000000-0000-4000-8000-000000000001",
        },
      ],
      listReportRevisions: async () => [
        {
          briefRevisionId: "71000000-0000-4000-8000-000000000001",
          reportVersionId: stableIds().reportVersionId,
        },
      ],
      findPinByUpdateId: async () => ({
        projectId: "81000000-0000-4000-8000-000000000001",
        revisionId: "71000000-0000-4000-8000-000000000001",
        revisionNumber: 1,
      }),
      listTerminalUpdates: async () => [
        {
          updateId: "91000000-0000-4000-8000-000000000001",
          stage: "partial" as const,
        },
      ],
    };
    const store = createPinReadMonitoringUpdateStore(pinReads, () => FIXED_NOW);
    const researchCalls: Array<Parameters<MonitoringResearcher>[0]> = [];
    const result = await runMarketMonitoringUpdate(
      marketMonitoringUpdatePayloadSchema.parse({
        organizationId: FIXTURE_IDS.organizationId,
        projectId: "81000000-0000-4000-8000-000000000001",
        updateId: "91000000-0000-4000-8000-000000000001",
        briefRevisionId: "71000000-0000-4000-8000-000000000001",
        brief: briefFixture({
          organizationId: FIXTURE_IDS.organizationId,
          projectId: "81000000-0000-4000-8000-000000000001",
          pinnedToUpdateId: "91000000-0000-4000-8000-000000000001",
        }),
        actorId: FIXTURE_IDS.actorId,
        correlationId: FIXTURE_IDS.correlationId,
      }),
      {
        updates: store,
        research: createFakeResearcher(succeededResearchFixture(), { capture: researchCalls }),
        reports: createFakePersister(createFixtureDb()),
        events: createFakeEvents(),
        now: () => FIXED_NOW,
        newReportIds: stableIds,
      },
    );

    expect(result).toMatchObject({ outcome: "replayed", stage: "partial" });
    expect(researchCalls).toHaveLength(0);
  });

  it("keeps the conservative-ready replay only for reports without a lifecycle row", async () => {
    const store = createPinReadMonitoringUpdateStore(
      {
        listRevisionPins: async () => [
          {
            revisionId: "71000000-0000-4000-8000-000000000001",
            revisionNumber: 1,
            pinnedToUpdateId: "91000000-0000-4000-8000-000000000001",
          },
        ],
        listReportRevisions: async () => [
          {
            briefRevisionId: "71000000-0000-4000-8000-000000000001",
            reportVersionId: stableIds().reportVersionId,
          },
        ],
        findPinByUpdateId: async () => ({
          projectId: "81000000-0000-4000-8000-000000000001",
          revisionId: "71000000-0000-4000-8000-000000000001",
          revisionNumber: 1,
        }),
        listTerminalUpdates: async () => [],
      },
      () => FIXED_NOW,
    );
    const researchCalls: Array<Parameters<MonitoringResearcher>[0]> = [];
    const result = await runMarketMonitoringUpdate(
      marketMonitoringUpdatePayloadSchema.parse({
        organizationId: FIXTURE_IDS.organizationId,
        projectId: "81000000-0000-4000-8000-000000000001",
        updateId: "91000000-0000-4000-8000-000000000001",
        briefRevisionId: "71000000-0000-4000-8000-000000000001",
        brief: briefFixture({
          organizationId: FIXTURE_IDS.organizationId,
          projectId: "81000000-0000-4000-8000-000000000001",
          pinnedToUpdateId: "91000000-0000-4000-8000-000000000001",
        }),
        actorId: FIXTURE_IDS.actorId,
        correlationId: FIXTURE_IDS.correlationId,
      }),
      {
        updates: store,
        research: createFakeResearcher(succeededResearchFixture(), { capture: researchCalls }),
        reports: createFakePersister(createFixtureDb()),
        events: createFakeEvents(),
        now: () => FIXED_NOW,
        newReportIds: stableIds,
      },
    );

    expect(result).toMatchObject({ outcome: "replayed", stage: "ready" });
    expect(researchCalls).toHaveLength(0);
  });
});

describe("tooling guard", () => {
  it("keeps model tooling out of the update path", async () => {
    for (const file of [
      "src/workflows/growth-intelligence/run-market-monitoring-update.ts",
      "src/workflows/growth-intelligence/market-monitoring-dispatch.ts",
      "src/modules/growth-intelligence/application/market-monitoring-update.ts",
      "src/modules/growth-intelligence/application/market-monitoring-context.ts",
    ]) {
      const source = await readFile(resolve(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/tools\s*:/);
      expect(source).not.toContain("googleSearch");
    }
    const provider = await readFile(
      resolve(process.cwd(), "src/modules/growth-intelligence/infrastructure/synthesis-provider.ts"),
      "utf8",
    );
    expect(provider).not.toMatch(/tools\s*:/);
  });
});
});
