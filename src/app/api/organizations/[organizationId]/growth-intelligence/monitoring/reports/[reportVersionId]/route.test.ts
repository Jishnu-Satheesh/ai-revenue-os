import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
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
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn() },
}));

import { GET } from "@/app/api/organizations/[organizationId]/growth-intelligence/monitoring/reports/[reportVersionId]/route";
import { briefRevisionSchema } from "@/domain/growth-intelligence/brief";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const FOREIGN_ORGANIZATION = "11000000-0000-4000-8000-000000000011";
const BRANCH = "20000000-0000-4000-8000-000000000002";
const OTHER_BRANCH = "21000000-0000-4000-8000-000000000021";
const PROJECT = "50000000-0000-4000-8000-000000000005";
const REVISION_1 = "61000000-0000-4000-8000-000000000061";
const REVISION_2 = "62000000-0000-4000-8000-000000000062";
const REPORT_VERSION = "63000000-0000-4000-8000-000000000063";
const REPORT_ROW = "64000000-0000-4000-8000-000000000064";
const CLAIM = "90000000-0000-4000-8000-000000000009";
const USER = "70000000-0000-4000-8000-000000000007";

const QUESTION_V1 = "How should we prepare for National Day?";
const QUESTION_V2 = "How should we prepare for National Day with a bigger budget?";

function reportContent() {
  return {
    reportId: REPORT_ROW,
    reportVersionId: REPORT_VERSION,
    organizationId: ORGANIZATION,
    projectId: PROJECT,
    locationId: BRANCH,
    briefRevisionId: REVISION_1,
    evidenceDigest: "digest-pinned-1",
    summary: "Compare family offers and check delivery capacity before choosing a promotion.",
    localMeaning: "Downtown families order early for National Day.",
    findings: [
      {
        key: "finding-1",
        statement: "Family bundles appear across competitors.",
        citationSlots: [{ claimId: CLAIM, sourceRef: "S1" }],
      },
    ],
    competitorComparison: [{ competitorName: "Rival Kitchen", summary: "Promotes family bundles." }],
    speculativeEstimate: {
      label: "Rival Kitchen · Monthly sales scenario",
      range: { lowMinorUnits: 4_500_000, highMinorUnits: 7_000_000, currency: "AED" },
      assumptions: ["Assume 40–60 orders per day at AED 38 across 30 trading days."],
      reasoning: "Reviews and visible offers do not establish volume; this is a scenario.",
    },
    gaps: [{ key: "gap-1", description: "Operating capacity is not confirmed." }],
    draftAdvice: [
      {
        itemKey: "bundle",
        kind: "action",
        title: "Draft one clear family bundle",
        detail: "Name the occasion and what the customer receives.",
      },
    ],
    sources: [{ sourceRef: "S1", url: "https://rival.example/menu" }],
  };
}

function briefDocument(revisionId: string, revisionNumber: number, question: string) {
  return briefRevisionSchema.parse({
    revisionId,
    projectId: PROJECT,
    organizationId: ORGANIZATION,
    revisionNumber,
    question,
    title: "Prepare for National Day",
    locationId: BRANCH,
    researchArea: "Downtown Dubai",
    competitors: [{ name: "Rival Kitchen", source: "operator_lead" }],
    investigationAreas: ["demand", "presence", "offers", "reviews", "observable_performance"],
    evidencePeriods: [{ label: "Channel reports · 1–31 Aug 2026" }],
    businessContextSnapshotId: "00000000-0000-0000-0000-000000000000",
    frequency: "once",
    pinnedToUpdateId: "65000000-0000-4000-8000-000000000065",
    createdAtUtc: "2026-09-10T11:00:00.000Z",
  });
}

type Db = {
  reports: Record<string, unknown>[];
  revisions: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  branches: Record<string, unknown>[];
};

function dbFixture(): Db {
  return {
    reports: [
      {
        id: REPORT_ROW,
        organization_id: ORGANIZATION,
        project_id: PROJECT,
        branch_id: BRANCH,
        brief_revision_id: REVISION_1,
        report_version_id: REPORT_VERSION,
        evidence_digest: "digest-pinned-1",
        content: reportContent(),
        review_state: "pending_review",
        created_at: "2026-09-12T10:00:00.000Z",
      },
    ],
    revisions: [
      {
        id: REVISION_1,
        organization_id: ORGANIZATION,
        project_id: PROJECT,
        revision_number: 1,
        document: briefDocument(REVISION_1, 1, QUESTION_V1),
        created_at: "2026-09-10T11:00:00.000Z",
      },
      {
        id: REVISION_2,
        organization_id: ORGANIZATION,
        project_id: PROJECT,
        revision_number: 2,
        document: briefDocument(REVISION_2, 2, QUESTION_V2),
        created_at: "2026-09-13T10:00:00.000Z",
      },
    ],
    projects: [
      {
        id: PROJECT,
        organization_id: ORGANIZATION,
        branch_id: BRANCH,
        title: "Prepare for National Day",
        question: QUESTION_V1,
      },
    ],
    branches: [{ id: BRANCH, name: "Downtown", organization_id: ORGANIZATION }],
  };
}

function supabaseFake(db: Db) {
  const tables: Record<string, keyof Db> = {
    growth_intelligence_reports: "reports",
    growth_intelligence_brief_revisions: "revisions",
    growth_intelligence_research_projects: "projects",
    branches: "branches",
  };
  return {
    from(table: string) {
      const key = tables[table] ?? "branches";
      const filters: { column: string; value: unknown }[] = [];
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return builder;
        },
        async maybeSingle() {
          const rows = db[key].filter((row) =>
            filters.every((filter) => row[filter.column] === filter.value),
          );
          return { data: rows[0] ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

function contextWith(db: Db, organizationId: string, role = "owner") {
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: USER },
    membership: { role },
    supabase: supabaseFake(db),
  });
}

function readerUrl(path = "", organizationId = ORGANIZATION) {
  return new Request(
    `https://example.test/api/organizations/${organizationId}/growth-intelligence/monitoring/reports/${REPORT_VERSION}${path}`,
    { headers: {} },
  );
}

function readerParams(organizationId: string) {
  return { params: Promise.resolve({ organizationId, reportVersionId: REPORT_VERSION }) };
}

describe("monitoring report reader GET", () => {
  it("resolves the exact pinned revision even after later brief edits", async () => {
    mocks.hasPermission.mockReturnValue(true);
    contextWith(dbFixture(), ORGANIZATION);

    const response = await GET(readerUrl(), readerParams(ORGANIZATION));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      report: {
        identity: Record<string, unknown>;
        brief: { question: string };
        summary: string;
        speculativeEstimate: { label: string; assumptions: string[]; reasoning: string } | null;
      };
    };
    expect(body.report.identity).toMatchObject({
      reportVersionId: REPORT_VERSION,
      briefRevisionId: REVISION_1,
      briefRevisionNumber: 1,
      evidenceDigest: "digest-pinned-1",
    });
    expect(body.report.brief.question).toBe(QUESTION_V1);
    expect(body.report.summary).toContain("delivery capacity");
    expect(body.report.speculativeEstimate?.label).toContain("Monthly sales scenario");
    expect(response.headers.get("x-correlation-id")).toBeTruthy();
  });

  it("lets a viewer read the pinned report", async () => {
    mocks.hasPermission.mockImplementation(
      (_role: unknown, permission: string) => permission === "growth_intelligence.read",
    );
    contextWith(dbFixture(), ORGANIZATION, "viewer");

    const response = await GET(readerUrl(), readerParams(ORGANIZATION));
    expect(response.status).toBe(200);
  });

  it("refuses a foreign organization without leaking the report", async () => {
    mocks.hasPermission.mockReturnValue(true);
    contextWith(dbFixture(), FOREIGN_ORGANIZATION);

    const response = await GET(readerUrl("", FOREIGN_ORGANIZATION), readerParams(FOREIGN_ORGANIZATION));
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("TENANT_SCOPE_ERROR");
    expect(JSON.stringify(body)).not.toContain("delivery capacity");
  });

  it("refuses a report opened under the wrong location", async () => {
    mocks.hasPermission.mockReturnValue(true);
    contextWith(dbFixture(), ORGANIZATION);

    const response = await GET(readerUrl(`?branchId=${OTHER_BRANCH}`), readerParams(ORGANIZATION));
    expect(response.status).toBe(404);
  });

  it("refuses readers without the read permission", async () => {
    mocks.hasPermission.mockReturnValue(false);
    contextWith(dbFixture(), ORGANIZATION);

    const response = await GET(readerUrl(), readerParams(ORGANIZATION));
    expect(response.status).toBe(403);
  });

  it("rejects a malformed report version id", async () => {
    mocks.hasPermission.mockReturnValue(true);
    contextWith(dbFixture(), ORGANIZATION);

    const response = await GET(
      readerUrl(),
      { params: Promise.resolve({ organizationId: ORGANIZATION, reportVersionId: "not-a-uuid" }) },
    );
    expect(response.status).toBe(400);
  });
});
