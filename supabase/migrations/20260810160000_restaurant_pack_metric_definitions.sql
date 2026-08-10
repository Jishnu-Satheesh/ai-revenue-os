-- Restaurant Pack metric vocabulary.
--
-- Pack definitions are shared vocabulary, so they carry no organization: per
-- specs/015 section 5 a null `organization_id` is core or pack vocabulary
-- visible to every tenant, and only a tenant's own bespoke keys are
-- organization-scoped. Registering these against one organization would label
-- them `owner_scope = 'organization'`, which would claim a restaurant chain
-- invented "preparation time", and would collide the moment the pack seed
-- landed properly.
--
-- Two keys are deliberately absent because the core already owns them:
--
--   * `revenue.gross` is core and the pack reuses it.
--   * an order is the restaurant's word for a transaction, so orders map onto
--     the core `transactions.count` rather than getting a second key for the
--     same quantity. specs/012 section 2 fixes "transaction" as the core term
--     and makes the mapping the pack's job. Two keys counting one thing would
--     leave the economics ledger with no defensible choice between them.
--
-- Idempotent: re-running changes nothing, and a key the core later claims will
-- surface as a conflict rather than being silently shadowed.

-- Subject kinds ---------------------------------------------------------------

-- Lets a playbook screen individual items on their own metrics without the core
-- ever learning what a menu item is.
insert into public.subject_kinds (key, label, owner_scope, pack_slug)
values
  ('menu_item', 'Menu item', 'pack', 'restaurant'),
  ('marketplace_listing', 'Marketplace listing', 'pack', 'restaurant')
on conflict (key) do nothing;

-- Metric definitions ----------------------------------------------------------

insert into public.metric_definitions (
  key, label, owner_scope, pack_slug, value_kind, unit, aggregation,
  percentile_p, rating_min, rating_max
)
values
  -- Money and counts, additive.
  ('margin.contribution', 'Contribution margin', 'pack', 'restaurant', 'money', null, 'sum', null, null, null),
  ('listing.impressions', 'Listing impressions', 'pack', 'restaurant', 'count', null, 'sum', null, null, null),
  ('review.velocity', 'Reviews received', 'pack', 'restaurant', 'count', null, 'sum', null, null, null),
  ('branch.footfall_proxy', 'Footfall proxy', 'pack', 'restaurant', 'count', null, 'sum', null, null, null),

  -- Ratios. Each stores a numerator and a denominator so the rate aggregates
  -- correctly across dayparts, branches and channels; the quotient is derived
  -- on read and never stored.
  ('margin.contribution_percent', 'Contribution margin rate', 'pack', 'restaurant', 'ratio', null, 'ratio_of_sums', null, null, null),
  ('order.average_value', 'Average order value', 'pack', 'restaurant', 'ratio', null, 'ratio_of_sums', null, null, null),
  ('listing.conversion_rate', 'Listing conversion rate', 'pack', 'restaurant', 'ratio', null, 'ratio_of_sums', null, null, null),
  ('customer.repeat_rate', 'Repeat customer rate', 'pack', 'restaurant', 'ratio', null, 'ratio_of_sums', null, null, null),
  ('order.refund_rate', 'Refund rate', 'pack', 'restaurant', 'ratio', null, 'ratio_of_sums', null, null, null),
  ('order.cancellation_rate', 'Cancellation rate', 'pack', 'restaurant', 'ratio', null, 'ratio_of_sums', null, null, null),
  ('menu_item.stockout_rate', 'Stockout rate', 'pack', 'restaurant', 'ratio', null, 'ratio_of_sums', null, null, null),

  -- A median, not a mean: preparation time is long-tailed and the mean is moved
  -- by the worst few tickets rather than by the typical one.
  ('kitchen.preparation_time', 'Preparation time (median)', 'pack', 'restaurant', 'duration', 'ms', 'percentile', 0.5, null, null),

  -- Sum of stars over number of reviews, so a period's rating is weighted by
  -- how many reviews it actually carried.
  ('review.rating', 'Review rating', 'pack', 'restaurant', 'rating', null, 'weighted_mean', null, 1, 5)
on conflict do nothing;
