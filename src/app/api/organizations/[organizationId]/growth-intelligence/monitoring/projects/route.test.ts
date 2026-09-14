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
  POST,
} from "@/app/api/organizations/[organizationId]/growth-intelligence/monitoring/projects/route";
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

type Db = { branches: unknown[]; reports: unknown[]; revisions: unknown[] };

function supabaseFake(db: Db) {
  const tables: Record<string, keyof Db> = {
    branches: "branches",
    growth_intelligence_reports: "reports",
    growth_intelligence_brief_revisions: "revisions",
  };
  return {
    from(table: string) {
      const key = tables[table] ?? "branches";
      const filters: { column: string; value: unknown }[] = [];
      const inclusions: { column: string; values: readonly unknown[] }[] = [];
      const orderings: { column: string; ascending: boolean }[] = [];
      let limit: number | null = null;
      const builder = {
        select() {
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
        then(resolve: (value: { data: unknown[]; error: null }) => void) {
          let rows = [...(db[key] as Record<string, unknown>[])];
          for (const filter of filters) {
            rows = rows.filter((row) => row[filter.column] === filter.value);
          }
          for (const inclusion of inclusions) {
            rows = rows.filter((row) => inclusion.values.includes(row[inclusion.column]));
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
