import { describe, expect, it } from "vitest";

import {
  createFakeDispatch,
  createFakeEvents,
  createFakeProjects,
  createFakeStore,
  createFixtureDb,
  FIXTURE_IDS,
} from "@/modules/growth-intelligence/application/market-monitoring-fixtures";
import { startMonitoringUpdate } from "@/modules/growth-intelligence/application/market-monitoring-update";
import {
  enqueueDueMonitoringUpdates,
  type DueMonitoringProject,
} from "@/workflows/growth-intelligence/market-monitoring-dispatch";

const FIXED_NOW = new Date("2026-09-14T06:00:00.000Z");

function briefInputs() {
  return {
    researchArea: "Deira",
    competitors: [{ name: "Stitch House", source: "suggestion" as const }],
    investigationAreas: ["demand", "reviews"] as Array<"demand" | "reviews">,
    businessContextSnapshotId: FIXTURE_IDS.snapshotId,
  };
}

function dueProject(overrides: Partial<DueMonitoringProject> = {}): DueMonitoringProject {
  return {
    organizationId: FIXTURE_IDS.organizationId,
    projectId: "81000000-0000-4000-8000-000000000001",
    branchId: FIXTURE_IDS.branchId,
    title: "Ramadan evening demand",
    question: "How does demand for late-night tailoring change during Ramadan?",
    mode: "recurring",
    schedule: { cadence: "weekly", localTime: "07:00", timeZone: "Asia/Dubai" },
    lifecycle: "active",
    briefInputs: briefInputs(),
    actorId: FIXTURE_IDS.actorId,
    ...overrides,
  };
}

function harness() {
  const db = createFixtureDb();
  return {
    db,
    projects: createFakeProjects(db),
    updates: createFakeStore(db),
    dispatch: createFakeDispatch(),
    events: createFakeEvents(),
  };
}

describe("enqueueDueMonitoringUpdates", () => {
  it("starts due recurring projects through the converging path", async () => {
    const { projects, updates, dispatch, events } = harness();
    const result = await enqueueDueMonitoringUpdates(
      { correlationId: FIXTURE_IDS.correlationId, limit: 25 },
      {
        listDue: async () => [dueProject()],
        projects,
        updates,
        dispatch,
        events,
        now: () => FIXED_NOW,
        newCorrelationId: () => "c1000000-0000-4000-8000-000000000001",
      },
    );
    expect(result).toMatchObject({ outcome: "swept", started: 1, skipped: 0 });
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({ outcome: "started" });
    expect(dispatch.nudges).toHaveLength(1);

    // A repeat sweep joins instead of duplicating paid work.
    const repeat = await enqueueDueMonitoringUpdates(
      { correlationId: FIXTURE_IDS.correlationId, limit: 25 },
      {
        listDue: async () => [dueProject()],
        projects,
        updates,
        dispatch,
        events,
        now: () => FIXED_NOW,
        newCorrelationId: () => "c1000000-0000-4000-8000-000000000002",
      },
    );
    expect(repeat).toMatchObject({ started: 0, openedProgress: 1 });
    expect(dispatch.nudges).toHaveLength(1);
  });

  it("recovers never-completed one-time projects through the converging path", async () => {
    const { projects, updates, dispatch, events } = harness();
    const candidate = dueProject({
      projectId: "81000000-0000-4000-8000-000000000009",
      mode: "one-time",
      schedule: undefined,
    });
    const result = await enqueueDueMonitoringUpdates(
      { correlationId: FIXTURE_IDS.correlationId, limit: 25 },
      {
        listDue: async () => [candidate],
        projects,
        updates,
        dispatch,
        events,
        now: () => FIXED_NOW,
        newCorrelationId: () => "c1000000-0000-4000-8000-000000000001",
      },
    );
    expect(result).toMatchObject({ outcome: "swept", started: 1, skipped: 0 });
    expect(result.projects).toMatchObject([{ outcome: "started" }]);
    expect(dispatch.nudges).toHaveLength(1);

    // A repeat sweep joins instead of duplicating paid work or re-nudging.
    const repeat = await enqueueDueMonitoringUpdates(
      { correlationId: FIXTURE_IDS.correlationId, limit: 25 },
      {
        listDue: async () => [candidate],
        projects,
        updates,
        dispatch,
        events,
        now: () => FIXED_NOW,
        newCorrelationId: () => "c1000000-0000-4000-8000-000000000002",
      },
    );
    expect(repeat).toMatchObject({ started: 0, openedProgress: 1 });
    expect(dispatch.nudges).toHaveLength(1);
  });

  it("skips paused, past-end and scope-blind candidates honestly", async () => {
    const { projects, updates, dispatch, events } = harness();
    const candidates = [
      dueProject({ projectId: "81000000-0000-4000-8000-000000000001", lifecycle: "paused" }),
      dueProject({
        projectId: "81000000-0000-4000-8000-000000000003",
        schedule: { cadence: "weekly", localTime: "07:00", timeZone: "Asia/Dubai", endDate: "2026-09-13" },
      }),
      dueProject({ projectId: "81000000-0000-4000-8000-000000000004", briefInputs: null }),
    ];
    const result = await enqueueDueMonitoringUpdates(
      { correlationId: FIXTURE_IDS.correlationId, limit: 25 },
      {
        listDue: async () => candidates,
        projects,
        updates,
        dispatch,
        events,
        now: () => FIXED_NOW,
        newCorrelationId: () => "c1000000-0000-4000-8000-000000000001",
      },
    );
    expect(result).toMatchObject({ started: 0, openedProgress: 0, skipped: 3 });
    expect(result.projects.map((row) => row.outcome)).toEqual([
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(result.projects.map((row) => (row.outcome === "skipped" ? row.reason : null))).toEqual([
      "not_due",
      "not_due",
      "scope_unavailable",
    ]);
    expect(dispatch.nudges).toHaveLength(0);
  });

  it("recovers lost dispatch by re-nudging undispatched actives", async () => {
    const { db, projects, updates, dispatch, events } = harness();
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
        idempotencyKey: "lost-nudge-1",
        correlationId: FIXTURE_IDS.correlationId,
      },
      {
        projects,
        updates,
        dispatch: createFakeDispatch({ failNudges: true }),
        events,
        now: () => FIXED_NOW,
        newUpdateId: () => "94000000-0000-4000-8000-000000000001",
        newRevisionId: () => "74000000-0000-4000-8000-000000000001",
      },
    );
    if (started.outcome !== "started" || started.nudge !== "lost") {
      throw new Error("fixture did not lose its nudge");
    }
    expect(db.updates.size).toBe(1);

    const result = await enqueueDueMonitoringUpdates(
      { correlationId: FIXTURE_IDS.correlationId, limit: 25 },
      {
        listDue: async () => [],
        projects,
        updates,
        dispatch,
        events,
        now: () => FIXED_NOW,
        newCorrelationId: () => "c1000000-0000-4000-8000-000000000001",
      },
    );
    expect(result.renudged).toBe(1);
    expect(dispatch.nudges).toHaveLength(1);
    expect(dispatch.nudges[0]).toMatchObject({ updateId: started.updateId });
    const record = await updates.get({
      organizationId: FIXTURE_IDS.organizationId,
      updateId: started.updateId,
    });
    expect(record?.dispatched).toBe(true);

    // A lost re-nudge stays queued for the next sweep without failing it.
    const failing = createFakeDispatch({ failNudges: true });
    const record2 = db.updates.get(started.updateId);
    if (record2) record2.dispatched = false;
    const retry = await enqueueDueMonitoringUpdates(
      { correlationId: FIXTURE_IDS.correlationId, limit: 25 },
      {
        listDue: async () => [],
        projects,
        updates,
        dispatch: failing,
        events,
        now: () => FIXED_NOW,
        newCorrelationId: () => "c1000000-0000-4000-8000-000000000002",
      },
    );
    expect(retry).toMatchObject({ outcome: "swept", renudged: 0 });
  });

  it("reports no invented completion figures", async () => {
    const { projects, updates, dispatch, events } = harness();
    const result = await enqueueDueMonitoringUpdates(
      { correlationId: FIXTURE_IDS.correlationId, limit: 25 },
      {
        listDue: async () => [dueProject()],
        projects,
        updates,
        dispatch,
        events,
        now: () => FIXED_NOW,
        newCorrelationId: () => "c1000000-0000-4000-8000-000000000001",
      },
    );
    const serialized = JSON.stringify(result);
    for (const invented of ["percent", "eta", "etaSeconds", "completesIn"]) {
      expect(serialized).not.toContain(invented);
    }
  });

  it("interleaves starts fairly across organizations with a per-org cap", async () => {
    const { projects, updates, dispatch, events } = harness();
    const otherOrg = FIXTURE_IDS.otherOrganizationId;
    const result = await enqueueDueMonitoringUpdates(
      { correlationId: FIXTURE_IDS.correlationId, limit: 10 },
      {
        listDue: async () => [
          dueProject({
            projectId: "81000000-0000-4000-8000-000000000001",
            title: "First org question one",
            question: "First org question one?",
          }),
          dueProject({
            projectId: "81000000-0000-4000-8000-000000000002",
            title: "First org question two",
            question: "First org question two?",
          }),
          dueProject({
            projectId: "82000000-0000-4000-8000-000000000001",
            organizationId: otherOrg,
            title: "Second org question one",
            question: "Second org question one?",
          }),
        ],
        projects,
        updates,
        dispatch,
        events,
        maxPerOrganization: 1,
        now: () => FIXED_NOW,
        newCorrelationId: () => "c1000000-0000-4000-8000-000000000001",
      },
    );

    expect(result).toMatchObject({ started: 2, skipped: 0 });
    expect(result.projects.map((row) => row.projectId)).toEqual([
      "81000000-0000-4000-8000-000000000001",
      "82000000-0000-4000-8000-000000000001",
    ]);
  });

  it("round-robins a large tenant instead of running it back to back", async () => {
    const { projects, updates, dispatch, events } = harness();
    const otherOrg = FIXTURE_IDS.otherOrganizationId;
    const result = await enqueueDueMonitoringUpdates(
      { correlationId: FIXTURE_IDS.correlationId, limit: 10 },
      {
        listDue: async () => [
          dueProject({
            projectId: "81000000-0000-4000-8000-000000000001",
            title: "First org question one",
            question: "First org question one?",
          }),
          dueProject({
            projectId: "81000000-0000-4000-8000-000000000002",
            title: "First org question two",
            question: "First org question two?",
          }),
          dueProject({
            projectId: "82000000-0000-4000-8000-000000000001",
            organizationId: otherOrg,
            title: "Second org question one",
            question: "Second org question one?",
          }),
        ],
        projects,
        updates,
        dispatch,
        events,
        maxPerOrganization: 2,
        now: () => FIXED_NOW,
        newCorrelationId: () => "c1000000-0000-4000-8000-000000000001",
      },
    );

    expect(result.projects.map((row) => row.projectId)).toEqual([
      "81000000-0000-4000-8000-000000000001",
      "82000000-0000-4000-8000-000000000001",
      "81000000-0000-4000-8000-000000000002",
    ]);
  });

  it("marks fresh starts undisputed and joined starts drifted for the notice", async () => {
    const { projects, updates, dispatch, events } = harness();
    const started = await startMonitoringUpdate(
      {
        organizationId: FIXTURE_IDS.organizationId,
        branchId: FIXTURE_IDS.branchId,
        title: "Ramadan evening demand",
        question: "How does demand for late-night tailoring change during Ramadan?",
        mode: "recurring",
        schedule: { cadence: "weekly", localTime: "07:00", timeZone: "Asia/Dubai" },
        ...briefInputs(),
        actorId: FIXTURE_IDS.actorId,
        idempotencyKey: "drift-key-1",
        correlationId: FIXTURE_IDS.correlationId,
      },
      { projects, updates, dispatch, events, now: () => FIXED_NOW },
    );
    if (started.outcome !== "started") throw new Error("fixture start failed");
    const deps = {
      projects,
      updates,
      dispatch,
      events,
      now: () => FIXED_NOW,
      newCorrelationId: () => "c1000000-0000-4000-8000-000000000001",
    };

    const fresh = await enqueueDueMonitoringUpdates(
      { correlationId: FIXTURE_IDS.correlationId, limit: 25 },
      {
        ...deps,
        listDue: async () => [
          dueProject({
            projectId: "82000000-0000-4000-8000-000000000001",
            organizationId: FIXTURE_IDS.otherOrganizationId,
            title: "Second org question one",
            question: "Second org question one?",
          }),
        ],
      },
    );
    expect(fresh.projects[0]).toMatchObject({ outcome: "started", scopeDrifted: false });

    // Same project scope identity (title/question/mode) but changed research
    // settings: the sweep joins the running update and flags the drift the
    // dialog notice must acknowledge.
    const joined = await enqueueDueMonitoringUpdates(
      { correlationId: FIXTURE_IDS.correlationId, limit: 25 },
      {
        ...deps,
        listDue: async () => [
          dueProject({
            projectId: started.projectId,
            briefInputs: { ...briefInputs(), researchArea: "Marina" },
          }),
        ],
      },
    );
    expect(joined.projects[0]).toMatchObject({
      outcome: "opened_progress",
      scopeDrifted: true,
    });
  });

});
