import { z } from "zod";

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";

/**
 * Brief revision contracts.
 *
 * A brief revision is the client's research ask. Once a revision is pinned
 * to a background update it becomes immutable: later edits create a new
 * revision for future runs only, and history entries keep opening the exact
 * revision they ran against. Competitor names and questions are stored as
 * literal text — markup and injected instructions are never interpreted.
 */

export const BRIEF_COMPETITOR_SOURCES = ["suggestion", "operator_lead"] as const;

export type BriefCompetitorSource = (typeof BRIEF_COMPETITOR_SOURCES)[number];

export const BRIEF_INVESTIGATION_AREAS = [
  "demand",
  "presence",
  "offers",
  "reviews",
  "observable_performance",
] as const;

export type BriefInvestigationArea = (typeof BRIEF_INVESTIGATION_AREAS)[number];

export const BRIEF_FREQUENCIES = ["once", "daily", "weekly", "monthly"] as const;

export type BriefFrequency = (typeof BRIEF_FREQUENCIES)[number];

/**
 * Duplicate detection folds case and whitespace only. It never strips
 * diacritics or non-Latin scripts, so distinct names such as two different
 * Arabic or Chinese names keep distinct keys.
 */
export function normalizeCompetitorName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

const publicHttpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .transform((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({ code: "custom", message: "A competitor website must be a valid URL." });
      return z.NEVER;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        message: "A competitor website must be a public HTTP or HTTPS URL.",
      });
      return z.NEVER;
    }
    if (url.username || url.password) {
      context.addIssue({
        code: "custom",
        message: "A competitor website cannot contain credentials.",
      });
      return z.NEVER;
    }
    url.hash = "";
    return url.toString();
  });

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Event date must be a real calendar date (YYYY-MM-DD).");

export const briefCompetitorSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    website: publicHttpUrlSchema.optional(),
    locationHint: z.string().trim().min(1).max(240).optional(),
    source: z.enum(BRIEF_COMPETITOR_SOURCES),
  })
  .strict();

export type BriefCompetitor = z.infer<typeof briefCompetitorSchema>;

const briefEvidencePeriodSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    startDate: calendarDateSchema.optional(),
    endDate: calendarDateSchema.optional(),
  })
  .strict()
  .superRefine((period, context) => {
    if (period.startDate && period.endDate && period.startDate > period.endDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "An evidence period cannot end before it starts.",
      });
    }
  });

export const briefRevisionSchema = z
  .object({
    revisionId: z.string().uuid(),
    projectId: z.string().uuid(),
    organizationId: z.string().uuid(),
    revisionNumber: z.number().int().min(1),
    question: z.string().trim().min(1).max(2_000),
    title: z.string().trim().min(1).max(200).optional(),
    eventDate: calendarDateSchema.optional(),
    locationId: z.string().uuid(),
    researchArea: z.string().trim().min(1).max(160),
    competitors: z.array(briefCompetitorSchema).max(20),
    investigationAreas: z.array(z.enum(BRIEF_INVESTIGATION_AREAS)).min(1).max(5),
    evidencePeriods: z.array(briefEvidencePeriodSchema).max(12),
    businessContextSnapshotId: z.string().uuid(),
    frequency: z.enum(BRIEF_FREQUENCIES),
    pinnedToUpdateId: z.string().uuid().nullable(),
    createdAtUtc: z.string().datetime(),
  })
  .strict()
  .superRefine((revision, context) => {
    const normalized = revision.competitors.map((competitor) =>
      normalizeCompetitorName(competitor.name),
    );
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: "custom",
        path: ["competitors"],
        message: "Competitor names must be unique after case and whitespace normalization.",
      });
    }
    if (new Set(revision.investigationAreas).size !== revision.investigationAreas.length) {
      context.addIssue({
        code: "custom",
        path: ["investigationAreas"],
        message: "Investigation areas must be unique.",
      });
    }
    const periodLabels = revision.evidencePeriods.map((period) => period.label.toLowerCase());
    if (new Set(periodLabels).size !== periodLabels.length) {
      context.addIssue({
        code: "custom",
        path: ["evidencePeriods"],
        message: "Evidence period labels must be unique.",
      });
    }
  });

export type BriefRevision = z.infer<typeof briefRevisionSchema>;

export function isBriefRevisionPinned(revision: unknown): boolean {
  const parsed = briefRevisionSchema.safeParse(revision);
  return parsed.success && parsed.data.pinnedToUpdateId !== null;
}

/**
 * Pins a revision to the update it runs against and freezes it, so later
 * code cannot mutate what history entries must keep opening exactly.
 * Re-pinning to the same update is a replay-safe no-op; pinning an
 * already-pinned revision to a different update is a conflict.
 */
export function pinBriefRevisionToUpdate(
  revision: BriefRevision,
  updateId: string,
): BriefRevision {
  const parsed = briefRevisionSchema.parse(revision);
  const pinnedUpdateId = z.string().uuid().parse(updateId);
  if (parsed.pinnedToUpdateId !== null && parsed.pinnedToUpdateId !== pinnedUpdateId) {
    throw new GrowthIntelligenceError(
      "BRIEF_REVISION_PIN_CONFLICT",
      "A pinned brief revision cannot move to another update; create a new revision instead.",
    );
  }
  return Object.freeze({ ...parsed, pinnedToUpdateId: pinnedUpdateId });
}

export type BriefRevisionChanges = Partial<
  Pick<
    BriefRevision,
    | "question"
    | "title"
    | "eventDate"
    | "locationId"
    | "researchArea"
    | "competitors"
    | "investigationAreas"
    | "evidencePeriods"
    | "businessContextSnapshotId"
    | "frequency"
  >
>;

/**
 * Later edits yield a new revision: the source keeps its number, identity,
 * and pin, while the new revision starts unpinned for future runs only.
 */
export function createNextBriefRevision(
  source: BriefRevision,
  changes: BriefRevisionChanges,
  init: { revisionId: string; createdAtUtc: string },
): BriefRevision {
  const parsed = briefRevisionSchema.parse(source);
  return briefRevisionSchema.parse({
    ...parsed,
    ...changes,
    revisionId: z.string().uuid().parse(init.revisionId),
    revisionNumber: parsed.revisionNumber + 1,
    pinnedToUpdateId: null,
    createdAtUtc: z.string().datetime().parse(init.createdAtUtc),
  });
}

/** Tenant and linkage fence: org or project drift is refused at the boundary. */
export function assertBriefRevisionContext(
  revision: BriefRevision,
  context: { organizationId: string; projectId?: string },
): void {
  const parsed = briefRevisionSchema.parse(revision);
  if (parsed.organizationId !== context.organizationId) {
    throw new GrowthIntelligenceError(
      "RESEARCH_TENANT_MISMATCH",
      "This brief revision belongs to another organization.",
    );
  }
  if (context.projectId !== undefined && parsed.projectId !== context.projectId) {
    throw new GrowthIntelligenceError(
      "RESEARCH_CONTEXT_MISMATCH",
      "This brief revision belongs to another research project.",
    );
  }
}
