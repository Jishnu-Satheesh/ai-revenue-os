-- Two categories on one day are two facts, not one recorded twice.
--
-- ADR 0034 makes a category a dimension value on an ordinary numeric row, and
-- says plainly that uniqueness and replay identity include the dimensions.
-- `normalized_metrics` honours that -- every prior lookup, overlap count and
-- supersession in the period-grain completion matches on `m.dimensions = dims`.
-- The reconciliation index was the one place that forgot.
--
-- Keyed on `(organization, run, output key, period start, prior)`, it treats
-- every observation an output emits for one day as the same row. That is right
-- for a numeric output, which emits exactly one figure per period. It is wrong
-- for a categorical one, which emits a count per label, and it fails at the
-- second label rather than at the first:
--
--   duplicate key value violates unique constraint
--   "report_projection_reconciliations_period_grain_idx"
--
-- Nothing caught it because the only categorical outputs shipped so far write
-- at most one label a day. Talabat's closed-day reasons do so deliberately --
-- `collectInjectedValues` is false precisely so a second cause does not double
-- a day across two labels. Keeta's order export names the party that cancelled
-- each order, three of them, and several days carry two. The first governed
-- report to write two categories for one day found this on its first run.
--
-- The digest is the identity that was already correct: it is computed per
-- observation from the package, the validation, the declaration, the output
-- key, the period, the timezone and the dimensions, and it is not null. Adding
-- it to the key lets two categories of one day coexist while still refusing the
-- same evidence recorded twice, which is what the index is for.

drop index if exists public.report_projection_reconciliations_period_grain_idx;

create unique index report_projection_reconciliations_period_grain_idx
  on public.report_projection_reconciliations (
    organization_id,
    projection_run_id,
    projection_output_key,
    period_start,
    reconciliation_digest,
    coalesce(prior_observation_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(prior_normalized_metric_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where projection_target = 'period_grain';
