import { z } from "zod";

import { draftItemKindSchema } from "@/domain/growth-intelligence/acceptance";
import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";

/**
 * Market monitoring report contracts.
 *
 * A report is the saved readable answer of one background update. It pins
 * the exact project, location, brief revision, and evidence identity, so a
 * history entry keeps opening that exact version even after later brief
 * edits. Findings carry citation slots into the evidence they rest on.
 * Speculative competitor ranges are allowed only inside a labelled estimate
 * block with assumptions and reasoning — never as observed revenue or
 * profit. Plain language is a guidance flag on the report, not a
 * readability-score gate: no score field exists on this contract.
 */

const currencySchema = z.string().regex(/^[A-Z]{3}$/);

const citationSlotSchema = z
  .object({
    claimId: z.string().uuid(),
    sourceRef: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

const reportFindingSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    statement: z.string().trim().min(1).max(2_000),
    citationSlots: z.array(citationSlotSchema).min(1).max(50),
  })
  .strict();

const reportCompetitorEntrySchema = z
  .object({
    competitorName: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(2_000),
    citationSlots: z.array(citationSlotSchema).max(50).optional().default([]),
  })
  .strict();

const speculativeRangeSchema = z
  .object({
    lowMinorUnits: z.number().int().min(0),
    highMinorUnits: z.number().int().min(0),
    currency: currencySchema,
  })
  .strict()
  .superRefine((range, context) => {
    if (range.lowMinorUnits > range.highMinorUnits) {
      context.addIssue({
        code: "custom",
        path: ["highMinorUnits"],
        message: "A speculative range must run from low to high.",
      });
    }
  });

/**
 * A speculative estimate is refused unless it carries all three honesty
 * parts: the visible speculation label, its assumptions, and its reasoning.
 * An absent block is fine; a partial block is not.
 */
export const speculativeEstimateSchema = z
  .object({
    label: z.string().trim().min(1).max(240),
    range: speculativeRangeSchema,
    assumptions: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    reasoning: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type SpeculativeEstimate = z.infer<typeof speculativeEstimateSchema>;

const reportGapSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(1_000),
  })
  .strict();

const reportDraftAdviceSchema = z
  .object({
    itemKey: z.string().trim().min(1).max(160),
    kind: draftItemKindSchema,
    title: z.string().trim().min(1).max(240),
    detail: z.string().trim().min(1).max(2_000),
  })
  .strict();

const reportSourceSchema = z
  .object({
    sourceRef: z.string().trim().min(1).max(240),
    url: z.string().trim().min(1).max(2_048).optional(),
    retrievedAtUtc: z.string().datetime().optional(),
  })
  .strict();

export const marketMonitoringReportSchema = z
  .object({
    reportId: z.string().uuid(),
    reportVersionId: z.string().uuid(),
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    locationId: z.string().uuid(),
    briefRevisionId: z.string().uuid(),
    evidenceDigest: z.string().trim().min(1).max(512),
    summary: z.string().trim().min(1).max(5_000),
    localMeaning: z.string().trim().min(1).max(5_000),
    findings: z.array(reportFindingSchema).min(1).max(100),
    competitorComparison: z.array(reportCompetitorEntrySchema).min(1).max(50),
    speculativeEstimate: speculativeEstimateSchema.optional(),
    gaps: z.array(reportGapSchema).max(50).optional().default([]),
    draftAdvice: z.array(reportDraftAdviceSchema).max(100).optional().default([]),
    sources: z.array(reportSourceSchema).min(1).max(200),
    plainLanguageRequired: z.boolean().optional().default(true),
  })
  .strict()
  .superRefine((report, context) => {
    const findingKeys = report.findings.map((finding) => finding.key);
    if (new Set(findingKeys).size !== findingKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["findings"],
        message: "Finding keys must be unique within a report version.",
      });
    }
    const draftKeys = report.draftAdvice.map((advice) => advice.itemKey);
    if (new Set(draftKeys).size !== draftKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["draftAdvice"],
        message: "Draft advice keys must be unique within a report version.",
      });
    }
    const sourceRefs = report.sources.map((source) => source.sourceRef.toLowerCase());
    if (new Set(sourceRefs).size !== sourceRefs.length) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Source references must be unique within a report version.",
      });
    }
  });

export type MarketMonitoringReport = z.infer<typeof marketMonitoringReportSchema>;

/** Builds a pinned report version; partial estimate blocks are refused. */
export function createMarketMonitoringReport(input: unknown): MarketMonitoringReport {
  return marketMonitoringReportSchema.parse(input);
}

/** Tenant and linkage fence: pinned identity must match the reading context. */
export function assertReportContext(
  report: MarketMonitoringReport,
  context: {
    organizationId: string;
    projectId?: string;
    locationId?: string;
    briefRevisionId?: string;
  },
): void {
  const parsed = marketMonitoringReportSchema.parse(report);
  if (parsed.organizationId !== context.organizationId) {
    throw new GrowthIntelligenceError(
      "RESEARCH_TENANT_MISMATCH",
      "This report belongs to another organization.",
    );
  }
  if (
    (context.projectId !== undefined && parsed.projectId !== context.projectId) ||
    (context.locationId !== undefined && parsed.locationId !== context.locationId) ||
    (context.briefRevisionId !== undefined &&
      parsed.briefRevisionId !== context.briefRevisionId)
  ) {
    throw new GrowthIntelligenceError(
      "RESEARCH_CONTEXT_MISMATCH",
      "This report was pinned to another project, location, or brief revision.",
    );
  }
}
