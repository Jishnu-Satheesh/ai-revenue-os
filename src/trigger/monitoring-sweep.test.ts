import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  createGrowthIntelligenceWorkerServiceClient: vi.fn(),
}));
vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: vi.fn(), onCancel: vi.fn() },
  schedules: { task: vi.fn() },
  schemaTask: vi.fn(),
  queue: vi.fn(() => ({ name: "growth-intelligence" })),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The trigger module pulls env-validated chains at import time, so dummy
// values go in before the dynamic import below (static imports hoist past
// any assignment). Other suites avoid the chain; this one needs the lister.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

const { listDueMonitoringProjects } = await import("@/trigger/growth-intelligence");

type Row = Record<string, unknown>;

const ORG = "21000000-0000-4000-8000-000000000001";
const BRANCH = "22000000-0000-4000-8000-000000000002";
const ACTOR = "23000000-0000-4000-8000-000000000003";

const RECURRING = "31000000-0000-4000-8000-000000000001";
const ONE_TIME_OWED = "31000000-0000-4000-8000-000000000002";
const ONE_TIME_REPORTED = "31000000-0000-4000-8000-000000000003";
const ONE_TIME_TERMINAL = "31000000-0000-4000-8000-000000000004";
const ONE_TIME_ACTORLESS = "31000000-0000-4000-8000-000000000005";

function projectRow(id: string, overrides: Row = {}): Row {
  return {
    id,
    organization_id: ORG,
    branch_id: BRANCH,
    title: `Project ${id.slice(0, 8)}`,
    question: "What are competitors doing?",
    lifecycle: "active",
    created_by: ACTOR,
    updated_at: "2026-09-15T14:00:00.000Z",
    ...overrides,
  };
}

/** Minimal thenable-chain fake: records eq/in/not filters and applies them. */
function fakeClient(tables: Record<string, Row[]>, errors: Record<string, boolean> = {}) {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value);
          return chain;
        },
        in: (column: string, values: unknown[]) => {
          filters.push((row) => (values as unknown[]).includes(row[column]));
          return chain;
        },
        not: (column: string, operator: string, value: unknown) => {
          if (operator === "is") filters.push((row) => row[column] !== value);
          return chain;
        },
        limit: () => {
          if (errors[table]) return Promise.resolve({ data: null, error: { message: "boom" } });
          return Promise.resolve({
            data: (tables[table] ?? []).filter((row) => filters.every((test) => test(row))),
            error: null,
          });
        },
      };
      return chain;
    },
  };
}

type ListerClient = Parameters<typeof listDueMonitoringProjects>[0];

function tables(): Record<string, Row[]> {
  return {
    growth_intelligence_research_projects: [
      projectRow(RECURRING, {
        mode: "recurring",
        schedule: { cadence: "weekly", localTime: "07:00", timeZone: "Asia/Dubai" },
      }),
      projectRow(ONE_TIME_OWED, { mode: "one-time", schedule: null }),
      projectRow(ONE_TIME_REPORTED, { mode: "one-time", schedule: null }),
      projectRow(ONE_TIME_TERMINAL, { mode: "one-time", schedule: null }),
      projectRow(ONE_TIME_ACTORLESS, { mode: "one-time", schedule: null, created_by: null }),
    ],
    growth_intelligence_brief_revisions: [],
    growth_intelligence_reports: [{ project_id: ONE_TIME_REPORTED, brief_revision_id: "r1" }],
    growth_intelligence_monitoring_updates: [
      { project_id: ONE_TIME_TERMINAL, update_id: "u1", stage: "research_failed" },
    ],
  };
}

describe("listDueMonitoringProjects one-time recovery", () => {
  it("lists recurring work unchanged plus still-owed one-time projects, excluding completed and actor-less ones", async () => {
    const due = await listDueMonitoringProjects(fakeClient(tables()) as unknown as ListerClient, {
      limit: 25,
    });
    const byId = new Map(due.map((row) => [row.projectId, row]));

    expect(byId.has(RECURRING)).toBe(true);
    expect(byId.get(RECURRING)).toMatchObject({ mode: "recurring" });
    expect(byId.has(ONE_TIME_OWED)).toBe(true);
    expect(byId.get(ONE_TIME_OWED)).toMatchObject({ mode: "one-time", lifecycle: "active" });
    expect(byId.has(ONE_TIME_REPORTED)).toBe(false);
    expect(byId.has(ONE_TIME_TERMINAL)).toBe(false);
    expect(byId.has(ONE_TIME_ACTORLESS)).toBe(false);
  });

  it("keeps recurring work when the one-time completion reads fail", async () => {
    const due = await listDueMonitoringProjects(
      fakeClient(tables(), { growth_intelligence_reports: true }) as unknown as ListerClient,
      { limit: 25 },
    );
    const ids = due.map((row) => row.projectId);

    expect(ids).toContain(RECURRING);
    expect(ids).not.toContain(ONE_TIME_OWED);
  });

  it("returns no one-time candidates when every one-timer is complete", async () => {
    const db = tables();
    db.growth_intelligence_research_projects = db.growth_intelligence_research_projects.filter(
      (row) => row.id === ONE_TIME_REPORTED || row.id === ONE_TIME_TERMINAL,
    );
    const due = await listDueMonitoringProjects(fakeClient(db) as unknown as ListerClient, {
      limit: 25,
    });

    expect(due).toHaveLength(0);
  });
});
