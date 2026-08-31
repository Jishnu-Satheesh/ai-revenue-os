import { z } from "zod";

/**
 * What the narration worker may say about a run's findings, and what the
 * scheduled judge may answer about what it said.
 *
 * Pure contracts: no I/O, no database types, no server-only import. The
 * narration workflow parses model output through these schemas before anything
 * downstream can see it, so an unrecognised field fails here rather than riding
 * along into storage.
 *
 * The app-side limits are deliberately stricter than the database's own
 * (`headline` 500 and `detail` 4000 there): a narration that cannot be read in
 * one pass is not worth storing, and tightening here costs nothing later, while
 * loosening after rows exist would mean a migration. See `specs/018` sections
 * 11.3 and 11.4, ADR 0037 for narration and ADR 0038 for the judge.
 */

/**
 * Bumped only when the narration prompt's instructions change.
 *
 * 4: advice became the default rather than the exception. Versions 1-3 read
 * their own prohibitions as a ban on advising anything, and filed observations
 * that repeated each figure back at the operator. ADR 0039 puts the fence on
 * claims about cause and realized result, never on the advice itself.
 */
export const RECOMMENDATION_PROMPT_VERSION = 4;

/** Bumped only when the judge prompt's instructions change. */
export const JUDGE_PROMPT_VERSION = 1;

/**
 * The completion RPC re-checks citations against the findings of the same run,
 * so the narrator may never file more than this many per run.
 */
export const MAX_RECOMMENDATIONS_PER_RUN = 6;

/** How many not-yet-judged recommendations one judge batch may receive. */
export const MAX_EVALUATION_BATCH = 200;

export const recommendationLabelSchema = z.enum(["observation", "recommendation", "needs_data"]);

export type RecommendationLabel = z.output<typeof recommendationLabelSchema>;

/**
 * Prose lists the client renders as bullets. A blank bullet is noise, so an
 * entry must survive trimming with something left.
 */
const proseListSchema = z.array(z.string().trim().min(1)).max(5);

/**
 * One narrated recommendation over cited findings.
 *
 * `strict` matters here. This is where model output first meets the platform,
 * and a field nobody declared -- a model's stray confidence score, say -- would
 * otherwise be stored as though someone had decided it belonged.
 */
export const narratedItemSchema = z.strictObject({
  label: recommendationLabelSchema,
  /** What the narrator claims it produced; an honest needs_data row is kept. */
  headline: z.string().trim().min(1).max(200),
  detail: z.string().trim().min(1).max(1000),
  supportedActions: proseListSchema,
  limitations: proseListSchema,
  /** The findings this item was built from; at least one, checked again by RPC. */
  citations: z.array(z.string().uuid()).min(1),
});

export type NarratedItem = z.output<typeof narratedItemSchema>;

/** The whole submission the narrator files for one analysis run. */
export const narrationSubmissionSchema = z.strictObject({
  items: z.array(narratedItemSchema).min(1).max(MAX_RECOMMENDATIONS_PER_RUN),
});

export type NarrationSubmission = z.output<typeof narrationSubmissionSchema>;

/**
 * One judge verdict over one recommendation.
 *
 * Advisory quality evidence for humans, per ADR 0038: it never modifies the
 * judged recommendation, so it carries no authority beyond its own fields.
 */
export const evaluationVerdictSchema = z.strictObject({
  citationFaithful: z.boolean(),
  labelAppropriate: z.boolean(),
  inventedValueDetected: z.boolean(),
  uncertaintyHonest: z.boolean(),
  score: z.number().int().min(1).max(5),
  issues: z.array(z.string().trim().min(1)),
  notes: z.string(),
});

export type EvaluationVerdict = z.output<typeof evaluationVerdictSchema>;
