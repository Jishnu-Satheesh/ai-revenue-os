-- Who cancelled the order, as the marketplace itself recorded it.
--
-- Keeta's order export carries a "Cancellation type" column naming the party
-- that cancelled: the merchant, Keeta's customer service, or Keeta itself. The
-- platform has counted this channel's cancellations since the restaurant export
-- landed, with no fault attached to any of them, because the column is written
-- in sentences and the projection language could not read them. It can now.
--
-- A separate key from `order.avoidable_cancellation_reason`, deliberately.
-- Talabat names *why* an order was cancelled (ITEM_UNAVAILABLE); Keeta names
-- *who* cancelled it. Folding both into one metric would make a breakdown that
-- mixes reasons and parties read as if it compared like with like.
--
-- Pack-scoped for the same reason as the vocabulary it sits beside: no single
-- client invented "cancelled by merchant", and registering it tenant-scoped
-- would collide the moment a second client uploaded the same provider's export.
--
-- Counts orders the provider attributed to a party. That is not the same as
-- the channel's cancelled-order count and is not expected to equal it: a
-- partially refunded order carries an attribution while the provider still
-- counts it as fulfilled. The detector that reads this says so.
--
-- Idempotent, like the pack seed it follows.

insert into public.metric_definitions (
  key, label, owner_scope, pack_slug, value_kind, unit, aggregation,
  percentile_p, rating_min, rating_max
)
values
  ('order.cancellation_attribution_count', 'Cancellations by responsible party', 'pack', 'restaurant', 'count', null, 'sum', null, null, null)
on conflict do nothing;
