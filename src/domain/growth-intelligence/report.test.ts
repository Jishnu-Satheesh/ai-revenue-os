import { describe, expect, it } from "vitest";

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import {
  assertReportContext,
  createMarketMonitoringReport,
} from "@/domain/growth-intelligence/report";

const ORG = "10000000-0000-4000-8000-000000000001";
const OTHER_ORG = "20000000-0000-4000-8000-000000000002";
const PROJECT = "30000000-0000-4000-8000-000000000003";
const OTHER_PROJECT = "31000000-0000-4000-8000-000000000031";
const LOCATION = "40000000-0000-4000-8000-000000000004";
const REPORT = "80000000-0000-4000-8000-000000000008";
const VERSION = "81000000-0000-4000-8000-000000000081";
const BRIEF_REVISION = "50000000-0000-4000-8000-000000000005";
const CLAIM = "90000000-0000-4000-8000-000000000009";

function reportInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reportId: REPORT,
    reportVersionId: VERSION,
    organizationId: ORG,
    projectId: PROJECT,
    locationId: LOCATION,
    briefRevisionId: BRIEF_REVISION,
    evidenceDigest: "digest-sha256-9f2c4a1e",
    summary: "Marina families cluster around weekend dinner deals near the Walk.",
    localMeaning: "For this branch, Friday footfall follows family set menus, not discounts.",
    findings: [
      {
        key: "weekend-cluster",
        statement: "Recorded listings show family set menus near the Walk on Fridays.",
        citationSlots: [{ claimId: CLAIM }],
      },
    ],
    competitorComparison: [
      {
        competitorName: "Seaside Grill",
        summary: "Seaside Grill lists a Friday family menu; hours match ours.",
      },
    ],
    speculativeEstimate: {
      label: "Speculative estimate — not observed revenue",
      range: { lowMinorUnits: 120_000_00, highMinorUnits: 180_000_00, currency: "AED" },
      assumptions: ["Two busy Fridays a month", "Covers observed in listings, not counted"],
      reasoning: "Range built from listed menus and stated hours only; no till data seen.",
    },
    gaps: [{ key: "delivery-mix", description: "Delivery share near the branch is unknown." }],
    draftAdvice: [
      {
        itemKey: "friday-set-menu",
        kind: "action",
        title: "Test a Friday family set menu",
        detail: "Run a four-week Friday set menu and watch covers.",
      },
    ],
    sources: [{ sourceRef: "seaside-listing", retrievedAtUtc: "2026-09-13T10:00:00.000Z" }],
    plainLanguageRequired: true,
    ...overrides,
  };
}

function domainCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GrowthIntelligenceError);
    return (error as GrowthIntelligenceError).code;
  }
  throw new Error("Expected a domain error.");
}

describe("market monitoring report identity", () => {
  it("accepts a fully pinned report version", () => {
    const parsed = createMarketMonitoringReport(reportInput());
    expect(parsed.reportVersionId).toBe(VERSION);
    expect(parsed.briefRevisionId).toBe(BRIEF_REVISION);
  });

  it("requires every pinned identity field", () => {
    for (const field of ["projectId", "locationId", "briefRevisionId", "evidenceDigest"]) {
      const input = reportInput();
      delete input[field];
      expect(() => createMarketMonitoringReport(input)).toThrow();
    }
    expect(() => createMarketMonitoringReport(reportInput({ evidenceDigest: "  " }))).toThrow();
  });

  it("accepts a report without an estimate block", () => {
    const input = reportInput();
    delete input.speculativeEstimate;
    expect(createMarketMonitoringReport(input).speculativeEstimate).toBeUndefined();
  });
});

describe("market monitoring speculative estimates", () => {
  it("refuses an estimate block missing its label", () => {
    expect(() =>
      createMarketMonitoringReport(
        reportInput({
          speculativeEstimate: {
            range: { lowMinorUnits: 1, highMinorUnits: 2, currency: "AED" },
            assumptions: ["Listed hours only"],
            reasoning: "Built from listings.",
          },
        }),
      ),
    ).toThrow();
  });

  it("refuses an estimate block missing assumptions", () => {
    expect(() =>
      createMarketMonitoringReport(
        reportInput({
          speculativeEstimate: {
            label: "Speculative estimate — not observed revenue",
            range: { lowMinorUnits: 1, highMinorUnits: 2, currency: "AED" },
            assumptions: [],
            reasoning: "Built from listings.",
          },
        }),
      ),
    ).toThrow();
  });

  it("refuses an estimate block missing reasoning", () => {
    expect(() =>
      createMarketMonitoringReport(
        reportInput({
          speculativeEstimate: {
            label: "Speculative estimate — not observed revenue",
            range: { lowMinorUnits: 1, highMinorUnits: 2, currency: "AED" },
            assumptions: ["Listed hours only"],
          },
        }),
      ),
    ).toThrow();
  });

  it("refuses an inverted range", () => {
    expect(() =>
      createMarketMonitoringReport(
        reportInput({
          speculativeEstimate: {
            label: "Speculative estimate — not observed revenue",
            range: { lowMinorUnits: 5, highMinorUnits: 2, currency: "AED" },
            assumptions: ["Listed hours only"],
            reasoning: "Built from listings.",
          },
        }),
      ),
    ).toThrow();
  });
});

describe("market monitoring findings and guidance", () => {
  it("rejects findings without citation slots", () => {
    expect(() =>
      createMarketMonitoringReport(
        reportInput({
          findings: [
            {
              key: "invented-figures",
              statement: "Rival X earns AED 4,000,000 every month.",
              citationSlots: [],
            },
          ],
        }),
      ),
    ).toThrow();
    expect(() => createMarketMonitoringReport(reportInput({ findings: [] }))).toThrow();
  });

  it("keeps figures inside cited findings, never as standalone facts", () => {
    const parsed = createMarketMonitoringReport(
      reportInput({
        findings: [
          {
            key: "listed-price",
            statement: "The listed set menu reads AED 189 for two; the listing is cited.",
            citationSlots: [{ claimId: CLAIM }],
          },
        ],
      }),
    );
    expect(parsed.findings[0]?.citationSlots).toHaveLength(1);
  });

  it("treats plain language as a guidance flag, never a score gate", () => {
    expect(createMarketMonitoringReport(reportInput()).plainLanguageRequired).toBe(true);
    expect(
      createMarketMonitoringReport(reportInput({ plainLanguageRequired: false }))
        .plainLanguageRequired,
    ).toBe(false);
    expect(() =>
      createMarketMonitoringReport(reportInput({ readabilityScore: 92 })),
    ).toThrow();
  });

  it("rejects malformed model output instead of coercing it", () => {
    expect(() => createMarketMonitoringReport(reportInput({ findings: "many" }))).toThrow();
    expect(() =>
      createMarketMonitoringReport(reportInput({ speculativeEstimate: "high" })),
    ).toThrow();
    expect(() => createMarketMonitoringReport("a busy weekend downtown")).toThrow();
  });
});

describe("market monitoring report tenancy", () => {
  it("rejects cross-tenant and cross-context reads at the boundary", () => {
    const parsed = createMarketMonitoringReport(reportInput());
    expect(
      domainCode(() => assertReportContext(parsed, { organizationId: OTHER_ORG })),
    ).toBe("RESEARCH_TENANT_MISMATCH");
    expect(
      domainCode(() =>
        assertReportContext(parsed, { organizationId: ORG, projectId: OTHER_PROJECT }),
      ),
    ).toBe("RESEARCH_CONTEXT_MISMATCH");
    expect(
      domainCode(() =>
        assertReportContext(parsed, { organizationId: ORG, briefRevisionId: OTHER_PROJECT }),
      ),
    ).toBe("RESEARCH_CONTEXT_MISMATCH");
    expect(() =>
      assertReportContext(parsed, {
        organizationId: ORG,
        projectId: PROJECT,
        locationId: LOCATION,
        briefRevisionId: BRIEF_REVISION,
      }),
    ).not.toThrow();
  });
});
