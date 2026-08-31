-- The vocabulary for what a marketplace order actually costs.
--
-- Every governed report so far has written revenue and volume. Nothing has
-- written a cost, which is why the workspace's money chapter says its detectors
-- "need cost inputs that no approved report writes yet". Keeta's order export
-- carries the provider's own commission per order, so the first real cost input
-- needs somewhere to land.
--
-- These are pack-scoped, like the rest of the marketplace vocabulary: a chain
-- did not invent marketplace commission, and registering it per tenant would
-- collide the moment a second client uploaded the same provider's export.
--
-- `cost.commission` is what the provider charged, as it charged it. It is not
-- margin: margin needs food and packaging cost that no report here carries, and
-- naming a single deduction "margin" would state a result nobody measured.
--
-- `promotion.provider_subsidy` is deliberately distinct from the existing
-- `promotion.funding`. Keeta's export separates what the restaurant funded from
-- what Keeta funded, and adding them would overstate what the restaurant spent
-- while hiding what the marketplace contributed. Two facts, two keys.
--
-- `operations.preparation_minutes` is summable only because the order export
-- states minutes per order. Talabat's daily *average* preparation time is
-- deliberately still unprojected -- summing daily averages produces a number
-- that means nothing -- but summing per-order minutes gives a real daily total,
-- and with the day's order count a true mean can be derived from evidence
-- rather than copied from a provider's own rounding.
--
-- Idempotent, like the pack seed it extends.

insert into public.metric_definitions (
  key, label, owner_scope, pack_slug, value_kind, unit, aggregation,
  percentile_p, rating_min, rating_max
)
values
  ('cost.commission', 'Marketplace commission charged', 'pack', 'restaurant', 'money', null, 'sum', null, null, null),
  ('promotion.provider_subsidy', 'Promotion funded by the marketplace', 'pack', 'restaurant', 'money', null, 'sum', null, null, null),
  ('operations.preparation_minutes', 'Preparation minutes', 'pack', 'restaurant', 'count', 'min', 'sum', null, null, null)
on conflict do nothing;
