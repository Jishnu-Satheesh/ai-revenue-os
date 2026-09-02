-- Marketplace funnel and operations vocabulary for governed report projection.
--
-- The Talabat performance export reports funnel stages, closed-hours and
-- cancellation figures that had no metric definition to land in. These keys are
-- shared restaurant-pack vocabulary, so they carry no organization, per the
-- same rule as the pack seed they extend: a chain did not invent "menu views",
-- and registering them tenant-scoped would collide the moment a second client
-- uploaded the same provider's report.
--
-- Every key here is additive and sums across periods. Two shapes this file
-- deliberately does not create:
--
--   * A preparation-time figure. The export carries a daily *average*, and the
--     ledger stores sums; adding averages across days produces a number that
--     means nothing. Its window figure waits for a detector that can state a
--     method, so binding the column is validation only.
--   * Ratio keys for conversion or availability share. Per `specs/015`, a rate
--     stores its numerator and denominator separately; here both sides arrive
--     as their own summed series and the quotient is derived at read time by a
--     detector, never stored.
--
-- Idempotent, like the pack seed it follows.

insert into public.metric_definitions (
  key, label, owner_scope, pack_slug, value_kind, unit, aggregation,
  percentile_p, rating_min, rating_max
)
values
  -- Funnel stages between an impression and an order.
  ('listing.menu_views', 'Menu views', 'pack', 'restaurant', 'count', null, 'sum', null, null, null),
  ('listing.cart_additions', 'Add-to-cart events', 'pack', 'restaurant', 'count', null, 'sum', null, null, null),
  ('listing.placed_orders', 'Orders placed from listing', 'pack', 'restaurant', 'count', null, 'sum', null, null, null),

  -- Availability. Minutes are counted units of time, not money, so they ride
  -- the count value kind; the unit column says what was counted.
  ('operations.scheduled_minutes', 'Scheduled open minutes', 'pack', 'restaurant', 'count', 'min', 'sum', null, null, null),
  ('operations.closed_minutes', 'Unavailable minutes', 'pack', 'restaurant', 'count', 'min', 'sum', null, null, null),

  -- Whole days the outlet was unreachable, counted per declared reason via the
  -- reason_code dimension. The reasons themselves live as dimension values on
  -- the observations, not as one key per provider label, so a new provider
  -- reason is data before it is schema.
  ('operations.closed_days', 'Days unavailable by reason', 'pack', 'restaurant', 'count', null, 'sum', null, null, null),

  -- Orders and cancellations. The core owns transactions.count for successful
  -- orders; these describe the rest of the order's life cycle.
  ('order.total_count', 'Orders placed', 'pack', 'restaurant', 'count', null, 'sum', null, null, null),
  ('order.cancelled_count', 'Orders cancelled', 'pack', 'restaurant', 'count', null, 'sum', null, null, null),
  ('order.avoidable_cancellation_count', 'Avoidable cancellations', 'pack', 'restaurant', 'count', null, 'sum', null, null, null),
  ('customer.new_order_count', 'Orders from new customers', 'pack', 'restaurant', 'count', null, 'sum', null, null, null),
  ('customer.returning_order_count', 'Orders from returning customers', 'pack', 'restaurant', 'count', null, 'sum', null, null, null),

  -- Sales splits the provider states directly. The rejection loss is the
  -- provider's own reported figure for revenue lost to rejections -- measured,
  -- not modelled, which is what makes it defensible as a monetary impact.
  ('revenue.online_sales', 'Online sales', 'pack', 'restaurant', 'money', null, 'sum', null, null, null),
  ('revenue.cash_sales', 'Cash sales', 'pack', 'restaurant', 'money', null, 'sum', null, null, null),
  ('revenue.delivery_sales', 'Delivery sales', 'pack', 'restaurant', 'money', null, 'sum', null, null, null),
  ('revenue.pickup_sales', 'Pickup sales', 'pack', 'restaurant', 'money', null, 'sum', null, null, null),
  ('revenue.rejection_loss', 'Revenue loss from rejections', 'pack', 'restaurant', 'money', null, 'sum', null, null, null)
-- Uniqueness here is two partial indexes (global keys and organization-scoped
-- ones), so no single column target exists to name.
on conflict do nothing;
