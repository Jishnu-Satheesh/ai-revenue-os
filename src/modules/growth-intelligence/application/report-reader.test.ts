import { describe, expect, it } from "vitest";

import { briefRevisionSchema } from "@/domain/growth-intelligence/brief";
import { DomainError } from "@/lib/errors";
import {
  assembleReportReader,
  extractReaderText,
  formatSpeculativeRange,
  loadAssembledReportView,
  reportDownloadFilename,
  reportDownloadPath,
  reportReaderPath,
  type BriefRevisionRowInput,
  type ReaderProjectInput,
  type ReportReaderPersistence,
  type ReportVersionRowInput,
} from "@/modules/growth-intelligence/application/report-reader";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const PROJECT = "50000000-0000-4000-8000-000000000005";
const BRANCH = "20000000-0000-4000-8000-000000000002";
const REVISION_1 = "61000000-0000-4000-8000-000000000061";
const REVISION_2 = "62000000-0000-4000-8000-000000000062";
const REPORT_VERSION = "63000000-0000-4000-8000-000000000063";
const REPORT_ROW = "64000000-0000-4000-8000-000000000064";
const CLAIM = "90000000-0000-4000-8000-000000000009";

const QUESTION_V1 = "How should we prepare for National Day?";
const QUESTION_V2 = "How should we prepare for National Day with a bigger budget?";

function reportContent(overrides: Record<string, unknown> = {}) {
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
      reasoning: "Reviews and visible offers do not establish volume; this is a scenario, not a measurement.",
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
    sources: [
      { sourceRef: "S1", url: "https://rival.example/menu", retrievedAtUtc: "2026-09-11T10:00:00.000Z" },
    ],
    ...overrides,
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
    competitors: [
      {
        name: "Rival Kitchen",
        website: "https://rival.example/menu",
        source: "operator_lead",
      },
    ],
    investigationAreas: ["demand", "presence", "offers", "reviews", "observable_performance"],
    evidencePeriods: [{ label: "Channel reports · 1–31 Aug 2026" }],
    businessContextSnapshotId: "00000000-0000-0000-0000-000000000000",
    frequency: "once",
    pinnedToUpdateId: "65000000-0000-4000-8000-000000000065",
    createdAtUtc: "2026-09-10T11:00:00.000Z",
  });
}

function reportRow(overrides: Partial<ReportVersionRowInput> = {}): ReportVersionRowInput {
  return {
    reportId: REPORT_ROW,
    reportVersionId: REPORT_VERSION,
    organizationId: ORGANIZATION,
    projectId: PROJECT,
    branchId: BRANCH,
    briefRevisionId: REVISION_1,
    evidenceDigest: "digest-pinned-1",
    content: reportContent(),
    reviewState: "pending_review",
    createdAt: "2026-09-12T10:00:00.000Z",
    ...overrides,
  };
}

function briefRow(revisionId: string, revisionNumber: number, question: string): BriefRevisionRowInput {
  return {
    revisionId,
    organizationId: ORGANIZATION,
    projectId: PROJECT,
    revisionNumber,
    document: briefDocument(revisionId, revisionNumber, question),
    createdAt: "2026-09-10T11:00:00.000Z",
  };
}

function project(): ReaderProjectInput {
  return {
    projectId: PROJECT,
    organizationId: ORGANIZATION,
    branchId: BRANCH,
    title: "Prepare for National Day",
    question: QUESTION_V1,
  };
}

function viewFixture() {
  return assembleReportReader({
    organizationId: ORGANIZATION,
    reportRow: reportRow(),
    briefRow: briefRow(REVISION_1, 1, QUESTION_V1),
    project: project(),
    branchName: "Downtown",
  });
}

/** Minimal in-memory persistence behind the loader's structural port. */
function persistenceFake(tables: {
  reports: Record<string, unknown>[];
  revisions: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  branches: Record<string, unknown>[];
}): ReportReaderPersistence {
  const source: Record<string, Record<string, unknown>[]> = {
    growth_intelligence_reports: tables.reports,
    growth_intelligence_brief_revisions: tables.revisions,
    growth_intelligence_research_projects: tables.projects,
    branches: tables.branches,
  };
  return {
    from(table: string) {
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
          const rows = (source[table] ?? []).filter((row) =>
            filters.every((filter) => row[filter.column] === filter.value),
          );
          return { data: rows[0] ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

function dbFixture() {
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
        id: REVISION_2,
        organization_id: ORGANIZATION,
        project_id: PROJECT,
        revision_number: 2,
        document: briefDocument(REVISION_2, 2, QUESTION_V2),
        created_at: "2026-09-13T10:00:00.000Z",
      },
      {
        id: REVISION_1,
        organization_id: ORGANIZATION,
        project_id: PROJECT,
        revision_number: 1,
        document: briefDocument(REVISION_1, 1, QUESTION_V1),
        created_at: "2026-09-10T11:00:00.000Z",
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
    branches: [{ id: BRANCH, name: "Downtown" }],
  };
}

describe("assembleReportReader", () => {
  it("assembles one version-bound view with identity, brief and evidence pins", () => {
    const view = viewFixture();

    expect(view.identity).toMatchObject({
      reportVersionId: REPORT_VERSION,
      projectId: PROJECT,
      locationId: BRANCH,
      locationName: "Downtown",
      briefRevisionId: REVISION_1,
      briefRevisionNumber: 1,
      evidenceDigest: "digest-pinned-1",
      reportDateUtcLabel: "12 Sep 2026",
      reviewState: "pending_review",
      plainLanguageRequired: true,
    });
    expect(view.brief.question).toBe(QUESTION_V1);
    expect(view.brief.competitors).toEqual([
      expect.objectContaining({ name: "Rival Kitchen", sourceLabel: "Verified lead" }),
    ]);
    expect(view.summary).toContain("delivery capacity");
    expect(view.findings).toEqual([
      expect.objectContaining({ key: "finding-1", citations: ["S1"] }),
    ]);
  });

  it("carries the full estimate honesty block on one surface", () => {
    const view = viewFixture();

    expect(view.speculativeEstimate).toMatchObject({
      label: "Rival Kitchen · Monthly sales scenario",
      rangeText: "AED 45,000–70,000",
    });
    expect(view.speculativeEstimate!.assumptions).toHaveLength(1);
    expect(view.speculativeEstimate!.reasoning).toContain("scenario, not a measurement");
  });

  it("refuses a partial estimate block instead of rendering half honesty", () => {
    const content = reportContent({
      speculativeEstimate: {
        label: "Rival Kitchen · Monthly sales scenario",
        range: { lowMinorUnits: 4_500_000, highMinorUnits: 7_000_000, currency: "AED" },
      },
    });
    expect(() =>
      assembleReportReader({
        organizationId: ORGANIZATION,
        reportRow: reportRow({ content }),
        briefRow: briefRow(REVISION_1, 1, QUESTION_V1),
        project: project(),
        branchName: "Downtown",
      }),
    ).toThrow(DomainError);
  });

  it("derives draft-advice destinations from the item type", () => {
    const view = viewFixture();
    expect(view.draftAdvice).toEqual([
      expect.objectContaining({ itemKey: "bundle", destinationLabel: "Recommendations" }),
    ]);
  });

  it("keeps citations verbatim in slot order so unknown refs render inert", () => {
    const content = reportContent({
      findings: [
        {
          key: "finding-1",
          statement: "Family bundles appear across competitors.",
          citationSlots: [
            { claimId: CLAIM, sourceRef: "S1" },
            { claimId: CLAIM, sourceRef: "S1" },
            { claimId: CLAIM, sourceRef: "S9" },
            { claimId: CLAIM },
          ],
        },
      ],
    });
    const view = assembleReportReader({
      organizationId: ORGANIZATION,
      reportRow: reportRow({ content }),
      briefRow: briefRow(REVISION_1, 1, QUESTION_V1),
      project: project(),
      branchName: "Downtown",
    });
    expect(view.findings[0]!.citations).toEqual(["S1", "S9"]);
  });

  it("marks sources without a location as unavailable while retaining their ids", () => {
    const content = reportContent({
      sources: [{ sourceRef: "S1" }],
    });
    const view = assembleReportReader({
      organizationId: ORGANIZATION,
      reportRow: reportRow({ content }),
      briefRow: briefRow(REVISION_1, 1, QUESTION_V1),
      project: project(),
      branchName: "Downtown",
    });
    expect(view.sources).toEqual([
      expect.objectContaining({ sourceRef: "S1", url: null, available: false }),
    ]);
  });

  it("refuses a report row pinned to another brief revision", () => {
    expect(() =>
      assembleReportReader({
        organizationId: ORGANIZATION,
        reportRow: reportRow({ briefRevisionId: REVISION_2 }),
        briefRow: briefRow(REVISION_1, 1, QUESTION_V1),
        project: project(),
        branchName: "Downtown",
      }),
    ).toThrow(/pinned to another project/);
  });

  it("refuses cross-organization content without leaking it", () => {
    const foreign = reportContent({ organizationId: "11000000-0000-4000-8000-000000000011" });
    const error = (() => {
      try {
        assembleReportReader({
          organizationId: ORGANIZATION,
          reportRow: reportRow({ content: foreign }),
          briefRow: briefRow(REVISION_1, 1, QUESTION_V1),
          project: project(),
          branchName: "Downtown",
        });
        return null;
      } catch (unknown) {
        return unknown as DomainError;
      }
    })();
    expect(error).toBeInstanceOf(DomainError);
    expect(error!.code).toBe("TENANT_SCOPE_ERROR");
  });
});

describe("loadAssembledReportView", () => {
  it("resolves the exact pinned revision even after later brief edits", async () => {
    const view = await loadAssembledReportView(persistenceFake(dbFixture()), {
      organizationId: ORGANIZATION,
      reportVersionId: REPORT_VERSION,
    });

    expect(view.identity.briefRevisionId).toBe(REVISION_1);
    expect(view.identity.briefRevisionNumber).toBe(1);
    expect(view.brief.question).toBe(QUESTION_V1);
    expect(view.brief.question).not.toBe(QUESTION_V2);
  });

  it("reads a foreign report as not-found", async () => {
    await expect(
      loadAssembledReportView(persistenceFake(dbFixture()), {
        organizationId: "11000000-0000-4000-8000-000000000011",
        reportVersionId: REPORT_VERSION,
      }),
    ).rejects.toMatchObject({ code: "TENANT_SCOPE_ERROR" });
  });

  it("refuses a report opened under the wrong location", async () => {
    await expect(
      loadAssembledReportView(persistenceFake(dbFixture()), {
        organizationId: ORGANIZATION,
        reportVersionId: REPORT_VERSION,
        branchId: "21000000-0000-4000-8000-000000000021",
      }),
    ).rejects.toMatchObject({ code: "TENANT_SCOPE_ERROR" });
  });

  it("degrades a missing branch name to the branch id", async () => {
    const db = dbFixture();
    db.branches = [];
    const view = await loadAssembledReportView(persistenceFake(db), {
      organizationId: ORGANIZATION,
      reportVersionId: REPORT_VERSION,
    });
    expect(view.identity.locationName).toBe(BRANCH);
  });
});

describe("report reader helpers", () => {
  it("formats a minor-unit range without inventing precision", () => {
    expect(
      formatSpeculativeRange({ lowMinorUnits: 4_500_000, highMinorUnits: 7_000_000, currency: "AED" }),
    ).toBe("AED 45,000–70,000");
  });

  it("slugs the download filename from the project title", () => {
    expect(reportDownloadFilename("Prepare for National Day")).toBe("Prepare-for-National-Day.pdf");
    expect(reportDownloadFilename("  ")).toBe("research-report.pdf");
  });

  it("builds stable reader and download paths", () => {
    expect(reportReaderPath(ORGANIZATION, REPORT_VERSION)).toBe(
      `/api/organizations/${ORGANIZATION}/growth-intelligence/monitoring/reports/${REPORT_VERSION}`,
    );
    expect(reportDownloadPath(ORGANIZATION, REPORT_VERSION)).toBe(
      `/api/organizations/${ORGANIZATION}/growth-intelligence/monitoring/reports/${REPORT_VERSION}/download`,
    );
  });

  it("exposes identity, findings, assumptions, advice and sources as canonical text", () => {
    const text = extractReaderText(viewFixture());
    for (const expected of [
      "Prepare for National Day",
      "Brief 1",
      "digest-pinned-1",
      "Family bundles appear across competitors.",
      "S1",
      "Rival Kitchen · Monthly sales scenario",
      "AED 45,000–70,000",
      "40–60 orders per day",
      "scenario, not a measurement",
      "Draft one clear family bundle",
      "https://rival.example/menu",
    ]) {
      expect(text).toContain(expected);
    }
  });
});
