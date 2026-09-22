import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
  createProjects: vi.fn(),
  triggerUpdate: vi.fn(),
  publish: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));
vi.mock("@/modules/growth-intelligence/application/feature-access", () => ({
  assertGrowthIntelligenceAccess: mocks.assertAccess,
}));
vi.mock("@/domain/access/permissions", () => ({
  hasOrganizationPermission: mocks.hasPermission,
}));
vi.mock("@/modules/growth-intelligence/infrastructure/research-project-repository", () => ({
  createAuthenticatedResearchProjectRepository: mocks.createProjects,
}));
vi.mock("@/trigger/growth-intelligence", () => ({
  triggerMarketMonitoringUpdate: mocks.triggerUpdate,
}));
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: mocks.publish }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn() },
}));

import {
  GET,
  PATCH,
  POST,
} from "@/app/api/organizations/[organizationId]/growth-intelligence/monitoring/projects/route";
import { DomainError } from "@/lib/errors";
import { isSameMonitoringScope } from "@/modules/growth-intelligence/application/monitoring-scope";
import { briefRevisionSchema, type BriefRevision } from "@/domain/growth-intelligence/brief";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const FOREIGN_ORGANIZATION = "11000000-0000-4000-8000-000000000011";
const BRANCH = "20000000-0000-4000-8000-000000000002";
const PROJECT = "50000000-0000-4000-8000-000000000005";
const REVISION_ROW = "61000000-0000-4000-8000-000000000061";
const UPDATE = "62000000-0000-4000-8000-000000000062";
const REPORT_VERSION = "63000000-0000-4000-8000-000000000063";
const REPORT_ROW = "64000000-0000-4000-8000-000000000064";
const CLAIM = "90000000-0000-4000-8000-000000000009";
const CORRELATION = "30000000-0000-4000-8000-000000000003";
const USER = "70000000-0000-4000-8000-000000000007";

const QUESTION = "How should we prepare for National Day?";
const TITLE = "Prepare for National Day";

function briefDocument(overrides: Record<string, unknown> = {}): BriefRevision {
  return briefRevisionSchema.parse({
    revisionId: REVISION_ROW,
    projectId: PROJECT,
    organizationId: ORGANIZATION,
    revisionNumber: 1,
    question: QUESTION,
    title: TITLE,
    locationId: BRANCH,
    researchArea: "Downtown Dubai",
    competitors: [],
    investigationAreas: ["demand", "presence", "offers", "reviews", "observable_performance"],
    evidencePeriods: [],
    businessContextSnapshotId: "00000000-0000-0000-0000-000000000000",
    frequency: "once",
    pinnedToUpdateId: UPDATE,
    createdAtUtc: "2026-09-10T11:00:00.000Z",
    ...overrides,
  });
}

function reportContent(overrides: Record<string, unknown> = {}) {
  return {
    reportId: REPORT_ROW,
    reportVersionId: REPORT_VERSION,
    organizationId: ORGANIZATION,
    projectId: PROJECT,
    locationId: BRANCH,
    briefRevisionId: REVISION_ROW,
    evidenceDigest: "digest-1",
    summary: "Compare family offers and check delivery capacity before choosing a promotion.",
    localMeaning: "Downtown families order early for National Day.",
    findings: [
      { key: "finding-1", statement: "Family bundles appear across competitors.", citationSlots: [{ claimId: CLAIM }] },
    ],
    competitorComparison: [{ competitorName: "Rival Kitchen", summary: "Promotes family bundles." }],
    sources: [{ sourceRef: "source-1", url: "https://rival.example/menu" }],
    ...overrides,
  };
}

type Db = {
  branches: unknown[];
  reports: unknown[];
  revisions: unknown[];
  updates?: unknown[];
  projects?: unknown[];
  /** When set, every read/write on the projects table resolves this error. */
  projectsError?: unknown;
};

function supabaseFake(db: Db) {
  const tables: Record<string, keyof Db> = {
    branches: "branches",
    growth_intelligence_reports: "reports",
    growth_intelligence_brief_revisions: "revisions",
    growth_intelligence_monitoring_updates: "updates",
    growth_intelligence_research_projects: "projects",
  };
  return {
    from(table: string) {
      const key = tables[table] ?? "branches";
      const filters: { column: string; value: unknown }[] = [];
      const inclusions: { column: string; values: readonly unknown[] }[] = [];
      const orderings: { column: string; ascending: boolean }[] = [];
      let limit: number | null = null;
      let pendingUpdate: Record<string, unknown> | null = null;
      const builder = {
        select() {
          return builder;
        },
        update(values: Record<string, unknown>) {
          pendingUpdate = values;
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return builder;
        },
        in(column: string, values: readonly unknown[]) {
          inclusions.push({ column, values });
          return builder;
        },
        order(column: string, options?: { ascending?: boolean }) {
          orderings.push({ column, ascending: options?.ascending ?? true });
          return builder;
        },
        limit(count: number) {
          limit = count;
          return builder;
        },
        then(resolve: (value: { data: unknown; error: unknown }) => void) {
          if (key === "projects" && db.projectsError !== undefined && db.projectsError !== null) {
            resolve({ data: null, error: db.projectsError });
            return;
          }
          let rows = [...((db[key] ?? []) as Record<string, unknown>[])];
          for (const filter of filters) {
            rows = rows.filter((row) => row[filter.column] === filter.value);
          }
          for (const inclusion of inclusions) {
            rows = rows.filter((row) => inclusion.values.includes(row[inclusion.column]));
          }
          if (pendingUpdate !== null && key === "projects") {
            const applied = pendingUpdate;
            const matchedIds = new Set(rows.map((row) => row["id"]));
            db.projects = ((db.projects ?? []) as Record<string, unknown>[]).map((row) =>
              matchedIds.has(row["id"]) ? { ...row, ...applied } : row,
            );
            rows = rows.map((row) => ({ ...row, ...applied }));
          }
          for (const ordering of orderings) {
            rows = [...rows].sort((left, right) => {
              const a = left[ordering.column];
              const b = right[ordering.column];
              if (a === b) return 0;
              if (a === null || a === undefined) return 1;
              if (b === null || b === undefined) return -1;
              const compared = String(a) < String(b) ? -1 : 1;
              return ordering.ascending ? compared : -compared;
            });
          }
          if (limit !== null) rows = rows.slice(0, limit);
          resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
  };
}

function projectSummary(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT,
    organizationId: ORGANIZATION,
    branchId: BRANCH,
    title: TITLE,
    question: QUESTION,
    mode: "one-time",
    lifecycle: "active",
    createdAt: "2026-09-10T10:00:00.000Z",
    ...overrides,
  };
}

function repositoryFake(overrides: Record<string, unknown> = {}) {
  return {
    createProject: vi.fn(async () => ({ projectId: PROJECT, lifecycle: "active", replayed: false })),
    saveBriefRevision: vi.fn(async () => ({ revisionId: REVISION_ROW, revisionNumber: 1, replayed: false })),
    listBriefRevisions: vi.fn(async () => []),
    listActiveProjects: vi.fn(async () => []),
    listProjectReports: vi.fn(async () => ({ reports: [], nextCursor: null })),
    ...overrides,
  };
}

function contextWith(db: Db, role = "owner") {
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId: ORGANIZATION,
    user: { id: USER },
    membership: { role },
    supabase: supabaseFake(db),
  });
}

function startBody(overrides: Record<string, unknown> = {}) {
  return {
    question: QUESTION,
    branchId: BRANCH,
    researchArea: "Downtown Dubai",
    competitors: [],
    mode: "one-time",
    idempotencyKey: "start-key-000000000001",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", { randomUUID: () => UPDATE });
  mocks.hasPermission.mockReturnValue(true);
  mocks.createProjects.mockImplementation(() => repositoryFake());
  mocks.triggerUpdate.mockResolvedValue(undefined);
});

describe("monitoring projects GET", () => {
  it("serves projects with branch names, takeaways and revision pins for the caller's own organization", async () => {
    const db: Db = {
      branches: [{ id: BRANCH, name: "Downtown", organization_id: ORGANIZATION }],
      reports: [
        {
          organization_id: ORGANIZATION,
          project_id: PROJECT,
          brief_revision_id: REVISION_ROW,
          report_version_id: REPORT_VERSION,
          review_state: "pending_review",
          content: reportContent(),
          created_at: "2026-09-12T10:00:00.000Z",
        },
      ],
      revisions: [
        {
          organization_id: ORGANIZATION,
          id: REVISION_ROW,
          project_id: PROJECT,
          revision_number: 1,
          document: briefDocument(),
          pinned_to_update_id: UPDATE,
          created_at: "2026-09-10T11:00:00.000Z",
        },
      ],
    };
    const repository = repositoryFake({ listActiveProjects: vi.fn(async () => [projectSummary()]) });
    mocks.createProjects.mockImplementation(() => repository);
    contextWith(db);

    const response = await GET(
      new Request("https://example.test/monitoring/projects?limit=50", {
        headers: { "x-correlation-id": CORRELATION },
      }),
      { params: Promise.resolve({ organizationId: FOREIGN_ORGANIZATION }) },
    );

    expect(response.status).toBe(200);
    // Tenant fencing: the path organization is untrusted; every read pins
    // the session organization instead.
    expect(repository.listActiveProjects).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION }),
    );
    const body = (await response.json()) as {
      projects: Record<string, unknown>[];
      reportsByProject: Record<string, Record<string, unknown>[]>;
      revisionsByProject: Record<string, Record<string, unknown>[]>;
    };
    expect(body.projects[0]).toMatchObject({ projectId: PROJECT, branchName: "Downtown" });
    expect(body.reportsByProject[PROJECT]![0]).toMatchObject({
      reportVersionId: REPORT_VERSION,
      briefRevisionId: REVISION_ROW,
      takeaway:
        "Compare family offers and check delivery capacity before choosing a promotion.",
    });
    expect(body.revisionsByProject[PROJECT]![0]).toMatchObject({
      revisionId: REVISION_ROW,
      pinnedToUpdateId: UPDATE,
    });
  });

  it("degrades an unreadable report row to a null takeaway without failing the list", async () => {
    const db: Db = {
      branches: [],
      reports: [
        {
          organization_id: ORGANIZATION,
          project_id: PROJECT,
          brief_revision_id: REVISION_ROW,
          report_version_id: REPORT_VERSION,
          review_state: "pending_review",
          content: { not: "a report" },
          created_at: "2026-09-12T10:00:00.000Z",
        },
      ],
      revisions: [],
    };
    mocks.createProjects.mockImplementation(() =>
      repositoryFake({ listActiveProjects: vi.fn(async () => [projectSummary()]) }),
    );
    contextWith(db);

    const response = await GET(new Request("https://example.test/monitoring/projects"), {
      params: Promise.resolve({ organizationId: ORGANIZATION }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      reportsByProject: Record<string, Record<string, unknown>[]>;
    };
    expect(body.reportsByProject[PROJECT]![0]).toMatchObject({
      reportVersionId: REPORT_VERSION,
      takeaway: null,
    });
  });

  it("refuses readers without the read permission before touching persistence", async () => {
    const repository = repositoryFake();
    mocks.createProjects.mockImplementation(() => repository);
    mocks.hasPermission.mockReturnValue(false);
    contextWith({ branches: [], reports: [], revisions: [] });

    const response = await GET(new Request("https://example.test/monitoring/projects"), {
      params: Promise.resolve({ organizationId: ORGANIZATION }),
    });

    expect(response.status).toBe(403);
    expect(repository.listActiveProjects).not.toHaveBeenCalled();
  });

  it("serves terminally failed updates beside the list so failed rows stop claiming progress", async () => {
    const db: Db = {
      branches: [],
      reports: [],
      revisions: [],
      updates: [
        {
          organization_id: ORGANIZATION,
          project_id: PROJECT,
          update_id: UPDATE,
          stage: "research_failed",
        },
        {
          organization_id: ORGANIZATION,
          project_id: PROJECT,
          update_id: UPDATE,
          stage: "queued",
        },
      ],
    };
    mocks.createProjects.mockImplementation(() =>
      repositoryFake({ listActiveProjects: vi.fn(async () => [projectSummary()]) }),
    );
    contextWith(db);

    const response = await GET(new Request("https://example.test/monitoring/projects"), {
      params: Promise.resolve({ organizationId: ORGANIZATION }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      failedUpdatesByProject: Record<string, Record<string, unknown>[]>;
    };
    // Only the failed stage is served; the queued row never appears.
    expect(body.failedUpdatesByProject[PROJECT]).toEqual([
      { updateId: UPDATE, stage: "research_failed" },
    ]);
  });

  it("serves the agent lane opt-in flag beside each project", async () => {
    const db: Db = {
      branches: [],
      reports: [],
      revisions: [],
      projects: [{ id: PROJECT, organization_id: ORGANIZATION, agent_lane_opt_in: true }],
    };
    mocks.createProjects.mockImplementation(() =>
      repositoryFake({ listActiveProjects: vi.fn(async () => [projectSummary()]) }),
    );
    contextWith(db);

    const response = await GET(new Request("https://example.test/monitoring/projects"), {
      params: Promise.resolve({ organizationId: ORGANIZATION }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      projects: Record<string, unknown>[];
    };
    expect(body.projects[0]).toMatchObject({ projectId: PROJECT, agentLaneOptIn: true });
  });

  it("serves the list without flags when the opt-in column is unavailable", async () => {
    const db: Db = {
      branches: [],
      reports: [],
      revisions: [],
      projects: [],
      projectsError: { message: 'column "agent_lane_opt_in" does not exist' },
    };
    mocks.createProjects.mockImplementation(() =>
      repositoryFake({ listActiveProjects: vi.fn(async () => [projectSummary()]) }),
    );
    contextWith(db);

    const response = await GET(new Request("https://example.test/monitoring/projects"), {
      params: Promise.resolve({ organizationId: ORGANIZATION }),
    });

    // The migration is dry-run only in this slice, so staging has no column
    // yet: the list must still load, with the toggle rendering unchecked.
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      projects: Record<string, unknown>[];
    };
    expect(body.projects[0]).toMatchObject({ projectId: PROJECT });
    expect("agentLaneOptIn" in body.projects[0]!).toBe(false);
  });
});

describe("monitoring projects POST", () => {
  it("starts fresh research through the orchestration with server-owned scope", async () => {
    const repository = repositoryFake();
    mocks.createProjects.mockImplementation(() => repository);
    contextWith({ branches: [], reports: [], revisions: [] });

    const response = await POST(
      new Request("https://example.test/monitoring/projects", {
        method: "POST",
        headers: { "x-correlation-id": CORRELATION },
        body: JSON.stringify(startBody()),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );

    expect(response.status).toBe(201);
    expect(repository.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION,
        branchId: BRANCH,
        question: QUESTION,
        actorId: USER,
      }),
    );
    expect(repository.saveBriefRevision).toHaveBeenCalled();
    expect(mocks.triggerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION, projectId: PROJECT }),
    );
    expect(mocks.publish).toHaveBeenCalled();
    const body = (await response.json()) as { start: Record<string, unknown> };
    expect(body.start).toMatchObject({ outcome: "started", projectId: PROJECT });
  });

  it("creates through the keyed path with the client's key and the derived scope fingerprint", async () => {
    const repository = repositoryFake();
    mocks.createProjects.mockImplementation(() => repository);
    contextWith({ branches: [], reports: [], revisions: [] });

    const response = await POST(
      new Request("https://example.test/monitoring/projects", {
        method: "POST",
        headers: { "x-correlation-id": CORRELATION },
        body: JSON.stringify(startBody()),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );

    expect(response.status).toBe(201);
    // Both the route-level twin check and the orchestration create travel
    // the keyed path: a redelivery replays instead of forking paid work.
    expect(repository.createProject).toHaveBeenCalledTimes(2);
    expect(repository.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION,
        idempotencyKey: "start-key-000000000001",
        scopeFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it("reports a reused key with different details as a conflict instead of forking paid work", async () => {
    const repository = repositoryFake({
      createProject: vi.fn(async () => {
        throw new DomainError(
          "DOMAIN_ERROR",
          "This research project was already saved with different details; reload and try again.",
        );
      }),
    });
    mocks.createProjects.mockImplementation(() => repository);
    contextWith({ branches: [], reports: [], revisions: [] });

    const response = await POST(
      new Request("https://example.test/monitoring/projects", {
        method: "POST",
        headers: { "x-correlation-id": CORRELATION },
        body: JSON.stringify(startBody()),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("DOMAIN_ERROR");
    expect(body.error.message).toMatch(/different details/);
    expect(mocks.triggerUpdate).not.toHaveBeenCalled();
  });

  it("completes the start when the keyed create converges on the kept project", async () => {
    const repository = repositoryFake({
      createProject: vi.fn(async () => ({ projectId: PROJECT, lifecycle: "active", replayed: true })),
    });
    mocks.createProjects.mockImplementation(() => repository);
    contextWith({ branches: [], reports: [], revisions: [] });

    const response = await POST(
      new Request("https://example.test/monitoring/projects", {
        method: "POST",
        headers: { "x-correlation-id": CORRELATION },
        body: JSON.stringify(startBody()),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { start: Record<string, unknown> };
    expect(body.start).toMatchObject({ outcome: "started", projectId: PROJECT });
  });

  it("joins identical active progress instead of duplicating paid work", async () => {
    const withTitle = () => startBody({ title: TITLE });
    const repository = repositoryFake({
      listActiveProjects: vi.fn(async () => [projectSummary()]),
    });
    mocks.createProjects.mockImplementation(() => repository);
    contextWith({
      branches: [],
      reports: [],
      revisions: [
        {
          organization_id: ORGANIZATION,
          id: REVISION_ROW,
          project_id: PROJECT,
          revision_number: 1,
          document: briefDocument(),
          pinned_to_update_id: UPDATE,
          created_at: "2026-09-10T11:00:00.000Z",
        },
      ],
    });

    const response = await POST(
      new Request("https://example.test/monitoring/projects", {
        method: "POST",
        headers: { "x-correlation-id": CORRELATION },
        body: JSON.stringify(withTitle()),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );

    expect(response.status).toBe(200);
    expect(repository.createProject).not.toHaveBeenCalled();
    expect(repository.saveBriefRevision).not.toHaveBeenCalled();
    expect(mocks.triggerUpdate).toHaveBeenCalledTimes(1);
    const body = (await response.json()) as { start: Record<string, unknown> };
    expect(body.start).toMatchObject({ outcome: "opened_progress", updateId: UPDATE });
  });

  it("opens a fresh update instead of joining a terminally failed pin", async () => {
    const withTitle = () => startBody({ title: TITLE });
    const repository = repositoryFake({
      listActiveProjects: vi.fn(async () => [projectSummary()]),
    });
    mocks.createProjects.mockImplementation(() => repository);
    contextWith({
      branches: [],
      reports: [],
      revisions: [
        {
          organization_id: ORGANIZATION,
          id: REVISION_ROW,
          project_id: PROJECT,
          revision_number: 1,
          document: briefDocument(),
          pinned_to_update_id: UPDATE,
          created_at: "2026-09-10T11:00:00.000Z",
        },
      ],
      updates: [
        {
          organization_id: ORGANIZATION,
          update_id: UPDATE,
          stage: "research_failed",
        },
      ],
    });

    const response = await POST(
      new Request("https://example.test/monitoring/projects", {
        method: "POST",
        headers: { "x-correlation-id": CORRELATION },
        body: JSON.stringify(withTitle()),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );

    // The dead pin is not joinable: the retry falls through to a fresh
    // update (the worker would only replay the terminal row, never rework).
    expect(response.status).toBe(201);
    const body = (await response.json()) as { start: Record<string, unknown> };
    expect(body.start).toMatchObject({ outcome: "started", projectId: PROJECT });
    expect(body.start).not.toMatchObject({ outcome: "opened_progress" });
    expect(mocks.triggerUpdate).toHaveBeenCalledTimes(1);
  });

  it("still joins a running pinned update with the same scope", async () => {
    const withTitle = () => startBody({ title: TITLE });
    const repository = repositoryFake({
      listActiveProjects: vi.fn(async () => [projectSummary()]),
    });
    mocks.createProjects.mockImplementation(() => repository);
    contextWith({
      branches: [],
      reports: [],
      revisions: [
        {
          organization_id: ORGANIZATION,
          id: REVISION_ROW,
          project_id: PROJECT,
          revision_number: 1,
          document: briefDocument(),
          pinned_to_update_id: UPDATE,
          created_at: "2026-09-10T11:00:00.000Z",
        },
      ],
      updates: [
        {
          organization_id: ORGANIZATION,
          update_id: UPDATE,
          stage: "researching",
        },
      ],
    });

    const response = await POST(
      new Request("https://example.test/monitoring/projects", {
        method: "POST",
        headers: { "x-correlation-id": CORRELATION },
        body: JSON.stringify(withTitle()),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );

    expect(response.status).toBe(200);
    expect(repository.createProject).not.toHaveBeenCalled();
    expect(repository.saveBriefRevision).not.toHaveBeenCalled();
    expect(mocks.triggerUpdate).toHaveBeenCalledTimes(1);
    const body = (await response.json()) as { start: Record<string, unknown> };
    expect(body.start).toMatchObject({ outcome: "opened_progress", updateId: UPDATE });
  });

  it("reports scope drift beside active progress without applying the new settings", async () => {
    const repository = repositoryFake({
      listActiveProjects: vi.fn(async () => [projectSummary()]),
    });
    mocks.createProjects.mockImplementation(() => repository);
    contextWith({
      branches: [],
      reports: [],
      revisions: [
        {
          organization_id: ORGANIZATION,
          id: REVISION_ROW,
          project_id: PROJECT,
          revision_number: 1,
          document: briefDocument(),
          pinned_to_update_id: UPDATE,
          created_at: "2026-09-10T11:00:00.000Z",
        },
      ],
    });

    const response = await POST(
      new Request("https://example.test/monitoring/projects", {
        method: "POST",
        headers: { "x-correlation-id": CORRELATION },
        body: JSON.stringify(startBody({ title: TITLE, researchArea: "Marina Walk" })),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );

    expect(response.status).toBe(200);
    expect(repository.saveBriefRevision).not.toHaveBeenCalled();
    const body = (await response.json()) as {
      start: Record<string, unknown>;
      notice: { code: string; message: string };
    };
    expect(body.start).toMatchObject({ outcome: "opened_progress", updateId: UPDATE });
    expect(body.notice.code).toBe("SCOPE_DRIFT_ACTIVE_PROGRESS");
    expect(body.notice.message).toMatch(/not applied, showing active progress/);
  });

  it("starts fresh once the pinned scope already has its report", async () => {
    const withTitle = () => startBody({ title: TITLE });
    const repository = repositoryFake({
      listActiveProjects: vi.fn(async () => [projectSummary()]),
    });
    mocks.createProjects.mockImplementation(() => repository);
    contextWith({
      branches: [],
      reports: [{ organization_id: ORGANIZATION, project_id: PROJECT, brief_revision_id: REVISION_ROW }],
      revisions: [
        {
          organization_id: ORGANIZATION,
          id: REVISION_ROW,
          project_id: PROJECT,
          revision_number: 1,
          document: briefDocument(),
          pinned_to_update_id: UPDATE,
          created_at: "2026-09-10T11:00:00.000Z",
        },
      ],
    });

    const response = await POST(
      new Request("https://example.test/monitoring/projects", {
        method: "POST",
        headers: { "x-correlation-id": CORRELATION },
        body: JSON.stringify(withTitle()),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { start: Record<string, unknown> };
    expect(body.start).toMatchObject({ outcome: "started" });
  });

  it("refuses viewers before touching persistence", async () => {
    const repository = repositoryFake();
    mocks.createProjects.mockImplementation(() => repository);
    mocks.hasPermission.mockImplementation((_: unknown, permission: string) =>
      permission === "growth_intelligence.read",
    );
    contextWith({ branches: [], reports: [], revisions: [] }, "viewer");

    const response = await POST(
      new Request("https://example.test/monitoring/projects", {
        method: "POST",
        body: JSON.stringify(startBody()),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );

    expect(response.status).toBe(403);
    expect(repository.createProject).not.toHaveBeenCalled();
    expect(mocks.triggerUpdate).not.toHaveBeenCalled();
  });

  it("validates the start contract without inventing defaults", async () => {
    mocks.createProjects.mockImplementation(() => repositoryFake());
    contextWith({ branches: [], reports: [], revisions: [] });

    const scheduled = await POST(
      new Request("https://example.test/monitoring/projects", {
        method: "POST",
        body: JSON.stringify(startBody({ schedule: { cadence: "weekly" } })),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );
    expect(scheduled.status).toBe(400);

    const missing = await POST(
      new Request("https://example.test/monitoring/projects", {
        method: "POST",
        body: JSON.stringify(startBody({ question: "  " })),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );
    expect(missing.status).toBe(400);
  });
});

describe("monitoring projects PATCH (agent lane opt-in)", () => {
  function projectRow(overrides: Record<string, unknown> = {}) {
    return {
      id: PROJECT,
      organization_id: ORGANIZATION,
      agent_lane_opt_in: false,
      ...overrides,
    };
  }

  function optInBody(overrides: Record<string, unknown> = {}) {
    return { project_id: PROJECT, agent_lane_opt_in: true, ...overrides };
  }

  function patchRequest(body: unknown) {
    return new Request("https://example.test/monitoring/projects", {
      method: "PATCH",
      headers: { "x-correlation-id": CORRELATION },
      body: JSON.stringify(body),
    });
  }

  function patchParams(organizationId: string = ORGANIZATION) {
    return { params: Promise.resolve({ organizationId }) };
  }

  it("turns the opt-in on and off for the caller's own project", async () => {
    const db: Db = { branches: [], reports: [], revisions: [], projects: [projectRow()] };
    contextWith(db);

    const on = await PATCH(patchRequest(optInBody({ agent_lane_opt_in: true })), patchParams());
    expect(on.status).toBe(200);
    const onBody = (await on.json()) as {
      project: { projectId: string; agentLaneOptIn: boolean };
    };
    expect(onBody.project).toEqual({ projectId: PROJECT, agentLaneOptIn: true });

    const off = await PATCH(patchRequest(optInBody({ agent_lane_opt_in: false })), patchParams());
    expect(off.status).toBe(200);
    const offBody = (await off.json()) as {
      project: { projectId: string; agentLaneOptIn: boolean };
    };
    expect(offBody.project).toEqual({ projectId: PROJECT, agentLaneOptIn: false });
    // The round-trip travels storage: the fake row converges on the write.
    expect((db.projects![0] as Record<string, unknown>)["agent_lane_opt_in"]).toBe(false);
  });

  it("returns 404 for another organization's project without leaking", async () => {
    const db: Db = {
      branches: [],
      reports: [],
      revisions: [],
      projects: [projectRow({ organization_id: FOREIGN_ORGANIZATION })],
    };
    contextWith(db);

    const response = await PATCH(patchRequest(optInBody()), patchParams());

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("TENANT_SCOPE_ERROR");
    expect(body.error.message).not.toMatch(/forbidden|permission/i);
  });

  it("returns 404 for an unknown project id", async () => {
    contextWith({ branches: [], reports: [], revisions: [], projects: [] });

    const response = await PATCH(patchRequest(optInBody()), patchParams());

    expect(response.status).toBe(404);
  });

  it("rejects invalid bodies with 400", async () => {
    contextWith({ branches: [], reports: [], revisions: [], projects: [projectRow()] });

    const empty = await PATCH(patchRequest({}), patchParams());
    expect(empty.status).toBe(400);

    const malformed = await PATCH(
      patchRequest({ project_id: "not-a-uuid", agent_lane_opt_in: "yes" }),
      patchParams(),
    );
    expect(malformed.status).toBe(400);
  });

  it("refuses viewers before touching persistence", async () => {
    const db: Db = { branches: [], reports: [], revisions: [], projects: [projectRow()] };
    mocks.hasPermission.mockImplementation((_: unknown, permission: string) =>
      permission === "growth_intelligence.read",
    );
    contextWith(db, "viewer");

    const response = await PATCH(patchRequest(optInBody()), patchParams());

    expect(response.status).toBe(403);
    expect((db.projects![0] as Record<string, unknown>)["agent_lane_opt_in"]).toBe(false);
  });

  it("fails closed without leaking when storage refuses the write", async () => {
    contextWith({
      branches: [],
      reports: [],
      revisions: [],
      projects: [projectRow()],
      projectsError: { message: "permission denied for table" },
    });

    const response = await PATCH(patchRequest(optInBody()), patchParams());

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNEXPECTED_ERROR");
  });
});

describe("isSameMonitoringScope", () => {
  const scope = {
    title: TITLE,
    question: QUESTION,
    branchId: BRANCH,
    researchArea: "Downtown Dubai",
    competitors: [],
    investigationAreas: ["demand", "presence", "offers", "reviews", "observable_performance"],
    businessContextSnapshotId: "00000000-0000-0000-0000-000000000000",
    frequency: "once",
  };

  it("joins identical scopes and drifts on any changed field", () => {
    const document = briefDocument();
    expect(isSameMonitoringScope(document, scope)).toBe(true);
    expect(isSameMonitoringScope(document, { ...scope, researchArea: "Marina Walk" })).toBe(false);
    expect(isSameMonitoringScope(document, { ...scope, question: "Another question?" })).toBe(false);
    expect(
      isSameMonitoringScope(document, {
        ...scope,
        competitors: [{ name: "Rival Kitchen", source: "operator_lead" }],
      }),
    ).toBe(false);
  });
});
