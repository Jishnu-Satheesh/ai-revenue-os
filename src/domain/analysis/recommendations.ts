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
 *
 * 5: pilot channel context plus curated playbook and web-evidence slots for
 * the cancellations and availability chapters. The model still has no tools;
 * the worker widens the fenced folder with stored channel context and
 * curated guidance, and portal steps are framed as checks rather than claims
 * about a portal's structure. See the pilot ADR.
 *
 * 6: curated playbooks and the pre-fetched web slot are gone (Amendment A).
 * The worker threads stored channel context only; the narrator grounds
 * itself with Google Search at generation time, preferring the channel's own
 * docs, forums, and merchant discussions. It emits no URLs, findings remain
 * the only cited evidence, portal how-to steps are allowed as grounded
 * advice, and every action stays human-supervised.
 *
 * 7: global rollout plus plain English (Amendment B). Stored channel context
 * and grounding apply to every run with findings, not just the three pilot
 * detectors, and a global plain-language block requires short common words,
 * one idea per sentence, and no idioms. All v6 rules keep their intent.
 *
 * 8: coverage plus a higher cap (Amendment C). Every chapter holding
 * observation findings gets at least one citing item, and the per-run cap
 * rises to 8 so coverage never competes with honest needs_data notes.
 * See ADR 0053.
 *
 * 9: gap-fill headroom. A March run filed five items with four finding
 * groups still uncovered, the model filed one item per group, and the fence
 * refused 5+4>8 on every attempt (prod run run_06g8l0bf99rpqlavml9alnpj01).
 * Gap-fill rounds now carry the filed count, and when the uncovered groups
 * outnumber the free slots the prompt binds the exact item budget and
 * requires multi-group items instead of letting coverage and the cap
 * disagree.
 */
export const RECOMMENDATION_PROMPT_VERSION = 9;

/**
 * Bumped only when the judge prompt's instructions change.
 *
 * 2: portal how-to steps are grounding-backed operational advice and allowed;
 * invented numbers, causes, savings, benchmarks, attribution, and confidence
 * are still flagged.
 *
 * 3: the narrator must write plain English (prompt v7), so the judge names
 * heavy jargon, unexplained technical terms, and longwinded prose in issues
 * and reflects them in score. The verdict shape is unchanged: issues and
 * score already carry it, so no schema or migration was needed.
 */
export const JUDGE_PROMPT_VERSION = 3;

/**
 * The completion RPC re-checks citations against the findings of the same run,
 * so the narrator may never file more than this many per run. Eight is six
 * detector chapters plus two spare slots for needs_data notes (Amendment C,
 * ADR 0053): coverage must never force a trade-off between a chapter with
 * data and an honest data gap.
 */
export const MAX_RECOMMENDATIONS_PER_RUN = 8;

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
