-- What it costs to make the food, which no marketplace export states.
--
-- The money chapter has been saying the same thing since it was written: what
-- remains after a marketplace's deductions is not profit, because food,
-- packaging, labour and rent are not in any approved report here. The client's
-- own profit and loss states the first two, monthly, and the platform can now
-- read it.
--
-- `revenue.company_gross` is deliberately not `revenue.gross`, and the
-- distinction is load-bearing. The statement books Keeta, Talabat and Zomato
-- commission under cost of goods sold, and under accrual accounting a
-- commission cost only lands in the period whose sales it was charged on -- so
-- those marketplaces' sales are already inside the income line. `revenue.gross`
-- is what the cross-channel share is computed from, and a channel whose revenue
-- already contained every other channel's would make each marketplace look like
-- a fraction of itself while the finding reported itself as complete.
--
-- Like adding a row called "everything" to a pie chart. The chart still draws.
--
-- `cost.food` and `cost.packaging` are pack-scoped for the same reason
-- `cost.commission` is: a chain did not invent the cost of ingredients, and
-- registering them per tenant would collide the moment a second client uploaded
-- their own books.
--
-- Marketplace commission from the statement reuses `cost.commission` rather
-- than earning a key of its own. It is the same quantity measured by a second
-- source, and it lands on a different channel from the marketplaces' own
-- exports, so nothing overlaps. Whether the two sources agree is a question
-- worth asking and is not asked yet -- on the client's own four months the
-- bookkeeper posted commission in a single month rather than monthly, so the
-- comparison needs a period the books actually spread before it means anything.

insert into public.metric_definitions (
  key, label, owner_scope, pack_slug, value_kind, unit, aggregation,
  percentile_p, rating_min, rating_max
)
values
  ('revenue.company_gross', 'Company gross revenue', 'pack', 'restaurant', 'money', null, 'sum', null, null, null),
  ('cost.food', 'Food cost', 'pack', 'restaurant', 'money', null, 'sum', null, null, null),
  ('cost.packaging', 'Packaging cost', 'pack', 'restaurant', 'money', null, 'sum', null, null, null)
on conflict do nothing;
