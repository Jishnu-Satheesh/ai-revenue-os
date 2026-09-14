import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { briefRevisionSchema } from "@/domain/growth-intelligence/brief";
import {
  assembleReportReader,
  extractReaderText,
  type AssembledReportView,
} from "@/modules/growth-intelligence/application/report-reader";
import { extractPdfTextLayer } from "@/workflows/reports/pdf-text-layer";
import {
  createPdfTextEncoder,
  renderMarketMonitoringReportPdf,
  reportPdfBlocks,
} from "@/workflows/reports/market-monitoring-report-pdf";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const PROJECT = "50000000-0000-4000-8000-000000000005";
const BRANCH = "20000000-0000-4000-8000-000000000002";
const REVISION = "61000000-0000-4000-8000-000000000061";
const REPORT_VERSION = "63000000-0000-4000-8000-000000000063";
const REPORT_ROW = "64000000-0000-4000-8000-000000000064";
const CLAIM = "90000000-0000-4000-8000-000000000009";

function viewFixture(overrides: Record<string, unknown> = {}): AssembledReportView {
  const content = {
    reportId: REPORT_ROW,
    reportVersionId: REPORT_VERSION,
    organizationId: ORGANIZATION,
    projectId: PROJECT,
    locationId: BRANCH,
    briefRevisionId: REVISION,
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
    ...overrides,
  };
  return assembleReportReader({
    organizationId: ORGANIZATION,
    reportRow: {
      reportId: REPORT_ROW,
      reportVersionId: REPORT_VERSION,
      organizationId: ORGANIZATION,
      projectId: PROJECT,
      branchId: BRANCH,
      briefRevisionId: REVISION,
      evidenceDigest: "digest-pinned-1",
      content,
      reviewState: "pending_review",
      createdAt: "2026-09-12T10:00:00.000Z",
    },
    briefRow: {
      revisionId: REVISION,
      organizationId: ORGANIZATION,
      projectId: PROJECT,
      revisionNumber: 1,
      document: briefRevisionSchema.parse({
        revisionId: REVISION,
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
        businessContextSnapshotId: "00000000-0000-4000-8000-000000000000",
        frequency: "once",
        pinnedToUpdateId: "65000000-0000-4000-8000-000000000065",
        createdAtUtc: "2026-09-10T11:00:00.000Z",
      }),
      createdAt: "2026-09-10T11:00:00.000Z",
    },
    project: {
      projectId: PROJECT,
      organizationId: ORGANIZATION,
      branchId: BRANCH,
      title: "Prepare for National Day",
      question: "How should we prepare for National Day?",
    },
    branchName: "Downtown",
  });
}

function squash(value: string): string {
  return value.replace(/\s+/g, "");
}

async function extractedSquashed(buffer: Buffer): Promise<string> {
  const result = await extractPdfTextLayer(buffer);
  if (result.outcome !== "extracted") throw new Error(`pdf extraction failed: ${result.code}`);
  return squash(result.pages.flatMap((page) => page.items.map((item) => item.text)).join("\n"));
}

describe("market monitoring report PDF", () => {
  it("renders deterministic bytes with the slug filename", () => {
    const first = renderMarketMonitoringReportPdf(viewFixture());
    const second = renderMarketMonitoringReportPdf(viewFixture());

    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.filename).toBe("Prepare-for-National-Day.pdf");
    expect(first.pageCount).toBeGreaterThanOrEqual(1);
    expect(first.bytes.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
  });

  it("carries the same identity, findings, assumptions, advice and sources as the reader payload", async () => {
    const view = viewFixture();
    const rendered = renderMarketMonitoringReportPdf(view);
    const text = await extractedSquashed(rendered.bytes);

    // Same-version rule: every load-bearing reader line survives in the PDF.
    for (const line of extractReaderText(view).split("\n").filter((line) => line.trim())) {
      expect(text).toContain(squash(line));
    }
    // The estimate honesty block stays together on the PDF surface.
    for (const block of reportPdfBlocks(view).filter((block) => block.style === "heading")) {
      expect(text).toContain(squash(block.text));
    }
  });

  it("keeps literal operator names byte-identical, including non-Latin scripts", async () => {
    const view = viewFixture({
      competitorComparison: [
        { competitorName: "مطبخ المنافس", summary: "Promotes family bundles." },
      ],
    });
    const text = await extractedSquashed(renderMarketMonitoringReportPdf(view).bytes);
    // pdf.js returns RTL runs in visual order, so the Arabic name reads
    // reversed here; the code points themselves survive exactly.
    const visualOrder = [...squash("مطبخ المنافس")].reverse().join("");
    expect(visualOrder).toHaveLength(squash("مطبخ المنافس").length);
    expect(text).toContain(visualOrder);
  });

  it("renders honest empty states instead of inventing content", async () => {
    const view = viewFixture({
      speculativeEstimate: undefined,
      draftAdvice: [],
      gaps: [],
      sources: [{ sourceRef: "S1" }],
    });
    const text = await extractedSquashed(renderMarketMonitoringReportPdf(view).bytes);
    expect(text).toContain(squash("No draft advice was saved with this report."));
    expect(text).not.toContain(squash("Speculative estimate"));
    expect(text).toContain(squash("Source evidence no longer available"));
    expect(text).toContain(squash("[S1]"));
  });

  it("maps exotic bytes back to their code points without folding names", () => {
    const encoder = createPdfTextEncoder(["AED 45,000–70,000 · مطبخ"]);
    expect(encoder.toUnicodeStream).toContain("<0645>");
    expect(encoder.differences).toContain("/uni");
    expect(encoder.encode("Plain")).toBe("<506C61696E>");
  });
});
