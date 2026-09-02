-- Cancellation-reason metric vocabulary for governed report projection.
--
-- The Talabat performance export labels each avoidable cancellation with a
-- provider reason (col "Avoidable Cancellation Reason", e.g. ITEM_UNAVAILABLE).
-- This key is the shared restaurant-pack vocabulary that reason lands in, the
-- same rule as the pack seed it extends: a chain did not invent "item
-- unavailable", and registering it tenant-scoped would collide the moment a
-- second client uploaded the same provider's report.
--
-- It is categorical rather than numeric, so it rides the count value kind with
-- the provider's own reason carried as a dimension value on each observation --
-- not as one key per label, so a new provider reason is data before it is
-- schema. This mirrors `operations.closed_days`.
--
-- Idempotent, like the pack seed it follows.

insert into public.metric_definitions (
  key, label, owner_scope, pack_slug, value_kind, unit, aggregation,
  percentile_p, rating_min, rating_max
)
values
  ('order.avoidable_cancellation_reason', 'Avoidable cancellations by reason', 'pack', 'restaurant', 'count', null, 'sum', null, null, null)
on conflict do nothing;
