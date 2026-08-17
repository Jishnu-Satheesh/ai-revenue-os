-- Make a metric restatement possible.
--
-- 20260810130000 left the supersession path deadlocked. Retiring a revision
-- means pointing `superseded_by_id` at its successor, and "current" is defined
-- solely as `superseded_by_id is null`, so:
--
--   * inserting the successor first violates
--     `normalized_metrics_current_revision_idx`, because the incumbent is still
--     current and a partial unique index is checked per statement and cannot be
--     deferred; and
--   * retiring the incumbent first violates
--     `normalized_metrics_superseded_by_id_fkey`, because the successor does not
--     exist yet.
--
-- Deferring the foreign key to commit resolves it and keeps the single source of
-- truth. A restatement is then: update the incumbent with the successor's id,
-- insert the successor, commit. The incumbent leaves the partial index on the
-- first statement, so the insert is unobstructed.
--
-- `public.constraints` does not need this. There, retirement clears `is_active`
-- while the supersession pointer is set in a third statement after the successor
-- exists, so no constraint is ever transiently violated.

alter table public.normalized_metrics
  alter constraint normalized_metrics_superseded_by_id_fkey deferrable initially deferred;
