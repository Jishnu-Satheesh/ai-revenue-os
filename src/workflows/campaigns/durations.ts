/**
 * How long campaign generation may run, and how long its claim stays held.
 *
 * These two numbers are a pair, and getting the relationship wrong is what
 * broke the first real generation run. The lease is what stops a second worker
 * picking up work already in progress; the task duration is how long the first
 * worker is allowed to take. If the lease is the shorter of the two, a healthy
 * run loses its claim while still working, and the next dispatch reclaims it —
 * two workers, two provider bills, two versions racing to publish.
 *
 * So the rule is simply: **the lease always outlives the task.** `durations.test.ts`
 * asserts it for every task here, so the pair cannot drift apart again.
 *
 * The absolute numbers are deliberately generous. Image generation is the slow
 * step and its latency depends on a provider nobody here controls; a ceiling
 * that merely looks sufficient is a ceiling that fails on a bad afternoon.
 */

/** Image generation dominates. Forty minutes is headroom, not an estimate. */
export const GENERATE_BUNDLE_MAX_DURATION_SECONDS = 2_400;

/** Five minutes of slack past the task ceiling, so a slow finish still fences. */
export const GENERATE_BUNDLE_LEASE_SECONDS = 2_700;

/** A revision patches an existing bundle and redraws fewer images. */
export const REVISE_BUNDLE_MAX_DURATION_SECONDS = 1_200;

export const REVISE_BUNDLE_LEASE_SECONDS = 1_500;

/**
 * A variant run draws one image per variant, so its ceiling scales with the
 * cap rather than being a fixed guess. Four per direction across three
 * directions is twelve images, and the first real bundle run measured roughly
 * two and a half minutes an image — so forty-five minutes is the honest
 * envelope for a full fleet, not a round number.
 */
export const GENERATE_VARIANTS_MAX_DURATION_SECONDS = 2_700;

export const GENERATE_VARIANTS_LEASE_SECONDS = 3_000;

/**
 * Every task ceiling paired with the lease that must outlast it. Exported so
 * the invariant is testable rather than a comment nobody re-reads.
 */
export const CAMPAIGN_DURATION_PAIRS = [
  {
    taskId: "campaign.generate-bundle",
    maxDurationSeconds: GENERATE_BUNDLE_MAX_DURATION_SECONDS,
    leaseSeconds: GENERATE_BUNDLE_LEASE_SECONDS,
  },
  {
    taskId: "campaign.generate-variants",
    maxDurationSeconds: GENERATE_VARIANTS_MAX_DURATION_SECONDS,
    leaseSeconds: GENERATE_VARIANTS_LEASE_SECONDS,
  },
  {
    taskId: "campaign.revise-bundle",
    maxDurationSeconds: REVISE_BUNDLE_MAX_DURATION_SECONDS,
    leaseSeconds: REVISE_BUNDLE_LEASE_SECONDS,
  },
] as const;

/**
 * A render is CPU only: no model, no provider, no network beyond one object
 * read and one object write. The measured composite is a few hundred
 * milliseconds, so five minutes is generous rather than tight.
 *
 * It has no lease and so no entry in `CAMPAIGN_DURATION_PAIRS`. Nothing to
 * fence: there is no run row to claim, and idempotency comes from the render
 * digest, which is content-addressed. A duplicate delivery recomputes the same
 * digest and the database replays the row it already has.
 */
export const RENDER_POSTER_MAX_DURATION_SECONDS = 300;

/**
 * An edit calls an image model once and composites the answer, so unlike a
 * render it waits on a provider. The planner's own timeout is two minutes; this
 * ceiling has to sit above it with room for the object reads, the composite and
 * the successor version write, or the task dies while the model is still
 * answering and the operator sees a failure that was really a deadline.
 *
 * Like a render it holds no lease and has no entry in `CAMPAIGN_DURATION_PAIRS`.
 * There is no run row to claim: the database enforces one edit per idempotency
 * key per organization, and a duplicate delivery replays that row.
 */
export const EDIT_PLATE_MAX_DURATION_SECONDS = 600;

/**
 * The execution loop's ceilings.
 *
 * None of these hold a lease, so none appear in `CAMPAIGN_DURATION_PAIRS`.
 * Their idempotency comes from the rows they work on: an action run is claimed
 * by the Tool Gateway, a metric observation is content-compared by its RPC, an
 * outcome is keyed on its plan digest, and a learning proposal replays on the
 * campaign it belongs to. A duplicate delivery finds work already done rather
 * than a claim it has to respect.
 */

/** A sweep of up to 500 actions, each a provider round trip. */
export const DISPATCH_DUE_ACTIONS_MAX_DURATION_SECONDS = 1_800;

/** Provider insight reads, one window per published subject. */
export const COLLECT_METRICS_MAX_DURATION_SECONDS = 1_800;

/** Reads and arithmetic over one organization's live campaigns. No provider. */
export const ALLOCATION_CYCLE_MAX_DURATION_SECONDS = 600;

/** Reads and arithmetic over one organization's finished campaigns. No provider. */
export const SETTLE_OUTCOME_MAX_DURATION_SECONDS = 600;

/** Up to two model drafts per settled campaign, so it waits on a provider. */
export const PROPOSE_LEARNING_MAX_DURATION_SECONDS = 1_200;
