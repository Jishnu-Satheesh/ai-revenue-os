import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

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

import { GET as downloadGet } from "@/app/api/organizations/[organizationId]/growth-intelligence/monitoring/reports/[reportVersionId]/download/route";
import { GET as readerGet } from "@/app/api/organizations/[organizationId]/growth-intelligence/monitoring/reports/[reportVersionId]/route";
import { briefRevisionSchema } from "@/domain/growth-intelligence/brief";
import type { AssembledReportView } from "@/modules/growth-intelligence/application/report-reader";
import { extractPdfTextLayer } from "@/workflows/reports/pdf-text-layer";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const FOREIGN_ORGANIZATION = "11000000-0000-4000-8000-000000000011";
const BRANCH = "20000000-0000-4000-8000-000000000002";
const PROJECT = "50000000-0000-4000-8000-000000000005";
const REVISION_1 = "61000000-0000-4000-8000-000000000061";
const REPORT_VERSION = "63000000-0000-4000-8000-000000000063";
const REPORT_ROW = "64000000-0000-4000-8000-000000000064";
const CLAIM = "90000000-0000-4000-8000-000000000009";
const USER = "70000000-0000-4000-8000-000000000007";

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
        document: briefRevisionSchema.parse({
          revisionId: REVISION_1,
          projectId: PROJECT,
          organizationId: ORGANIZATION,
          revisionNumber: 1,
          question: "How should we prepare for National Day?",
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
        }),
        created_at: "2026-09-10T11:00:00.000Z",
      },
    ],
    projects: [
      {
        id: PROJECT,
        organization_id: ORGANIZATION,
        branch_id: BRANCH,
        title: "Prepare for National Day",
        question: "How should we prepare for National Day?",
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

function contextWith(db: Db, organizationId: string) {
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: USER },
    membership: { role: "owner" },
    supabase: supabaseFake(db),
  });
}

function downloadRequest(organizationId: string) {
  return new Request(
    `https://example.test/api/organizations/${organizationId}/growth-intelligence/monitoring/reports/${REPORT_VERSION}/download`,
    { headers: {} },
  );
}

function params(organizationId: string) {
  return { params: Promise.resolve({ organizationId, reportVersionId: REPORT_VERSION }) };
}

function squash(value: string): string {
  return value.replace(/\s+/g, "");
}

describe("monitoring report download GET", () => {
  it("serves the same version as the reader with filename and PDF content type", async () => {
    mocks.hasPermission.mockReturnValue(true);
    const db = dbFixture();
    contextWith(db, ORGANIZATION);

    const readerResponse = await readerGet(
      new Request(
        `https://example.test/api/organizations/${ORGANIZATION}/growth-intelligence/monitoring/reports/${REPORT_VERSION}`,
      ),
      params(ORGANIZATION),
    );
    expect(readerResponse.status).toBe(200);
    const readerBody = (await readerResponse.json()) as { report: AssembledReportView };
    const readerPayload = readerBody.report;

    contextWith(db, ORGANIZATION);
    const response = await downloadGet(downloadRequest(ORGANIZATION), params(ORGANIZATION));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Prepare-for-National-Day.pdf"',
    );

    const extracted = await extractPdfTextLayer(Buffer.from(await response.arrayBuffer()));
    if (extracted.outcome !== "extracted") throw new Error(`pdf extraction failed: ${extracted.code}`);
    const text = squash(
      extracted.pages.flatMap((page) => page.items.map((item) => item.text)).join("\n"),
    );

    // Same-version rule: the PDF carries the reader's identity, findings,
    // assumptions, advice and sources.
    for (const expected of [
      readerPayload.identity.projectTitle,
      `Brief ${readerPayload.identity.briefRevisionNumber}`,
      readerPayload.identity.evidenceDigest,
      readerPayload.summary,
      readerPayload.findings[0]!.statement,
      readerPayload.speculativeEstimate!.label,
      readerPayload.speculativeEstimate!.rangeText,
      readerPayload.speculativeEstimate!.assumptions[0]!,
      readerPayload.speculativeEstimate!.reasoning,
      readerPayload.draftAdvice[0]!.title,
      readerPayload.draftAdvice[0]!.detail,
      readerPayload.sources[0]!.sourceRef,
      readerPayload.sources[0]!.url!,
    ]) {
      expect(text).toContain(squash(expected));
    }
  });

  it("refuses a foreign organization and readers without the read permission", async () => {
    mocks.hasPermission.mockReturnValue(true);
    contextWith(dbFixture(), FOREIGN_ORGANIZATION);
    const foreign = await downloadGet(downloadRequest(FOREIGN_ORGANIZATION), params(FOREIGN_ORGANIZATION));
    expect(foreign.status).toBe(404);

    mocks.hasPermission.mockReturnValue(false);
    contextWith(dbFixture(), ORGANIZATION);
    const refused = await downloadGet(downloadRequest(ORGANIZATION), params(ORGANIZATION));
    expect(refused.status).toBe(403);
  });
});
