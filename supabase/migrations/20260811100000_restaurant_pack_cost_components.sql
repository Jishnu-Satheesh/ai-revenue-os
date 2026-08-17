-- Restaurant Pack cost component vocabulary.
--
-- Definitions only. What an organization actually pays is a rate, which is
-- tenant data and never ships in a migration: a commission percentage is a fact
-- about one business, and inventing one here would put a number nobody
-- confirmed behind a margin.
--
-- Shared vocabulary, so no organization: a null organization_id is core or pack
-- vocabulary visible to every tenant, matching public.metric_definitions and
-- public.subject_kinds.
--
-- `applies_to_channels` is left null on every row, meaning each component is in
-- principle applicable everywhere. A channel that genuinely does not incur a
-- cost is expressed as a measured zero rate — dine-in commission really is
-- zero, and saying so is more accurate than declaring the component
-- inapplicable. It also keeps marketplace names out of the pack, which would
-- otherwise have to guess whether a tenant sells through Talabat, Careem or
-- something that does not exist yet.

insert into public.cost_component_definitions (
  key, label, owner_scope, pack_slug, computation_kind, default_quality_tier
)
values
  -- A share of revenue, recalculated on the discounted price wherever a
  -- promotion applies. Getting that base wrong is the most common way a
  -- promotion looks profitable and is not; see specs/013 section 4.4.
  ('commission', 'Marketplace commission', 'pack', 'restaurant', 'rate_of_revenue', 'assumed'),

  -- Contribution margin excludes fixed cost by design, so this is the cost of
  -- goods only. Item-level costing refines it later; a blended share of revenue
  -- is what most operators can actually state today.
  ('food_cost', 'Food cost', 'pack', 'restaurant', 'rate_of_revenue', 'assumed'),

  -- Per item rather than per order. A three-item basket uses three containers,
  -- and charging it per order understates every multi-item order.
  ('packaging', 'Packaging', 'pack', 'restaurant', 'per_unit', 'assumed'),

  -- The operator's share of a marketplace-funded discount. It varies per
  -- promotion and per campaign, so it is sourced from the provider report
  -- rather than computed from a standing rate.
  ('promotion_funding', 'Promotion funding share', 'pack', 'restaurant', 'sourced', 'assumed'),

  -- Charged per order where the operator delivers or subsidises delivery. Often
  -- already inside commission on a marketplace, in which case the rate is a
  -- measured zero rather than a missing value.
  ('delivery_cost', 'Delivery cost', 'pack', 'restaurant', 'fixed_amount', 'assumed'),

  ('payment_fees', 'Payment processing fees', 'pack', 'restaurant', 'rate_of_revenue', 'assumed')
on conflict do nothing;
