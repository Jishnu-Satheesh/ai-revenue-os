# Restaurant Domain Model

## RestaurantProfile

- Cuisine types.
- Service modes: dine-in, takeaway, delivery, catering.
- Dietary and certification attributes.
- Seating capacity.
- Kitchen capacity and preparation constraints.
- Languages.
- Service areas.

## Menu

A versioned menu scoped to organization, branch, channel, and effective period.

## MenuCategory

Name, display order, daypart, channel visibility, and availability.

## MenuItem

- Name and multilingual names.
- Description.
- Category.
- Base price and currency.
- Estimated food and packaging cost.
- Contribution margin.
- Tax treatment.
- Availability schedule.
- Preparation time.
- Dietary and allergen attributes.
- Images and asset quality.
- Channel mappings.

## ModifierGroup and ModifierOption

Required or optional choices, limits, price delta, and availability.

## MarketplaceListing

Maps a MenuItem to a provider listing with provider price, description, image, promotion, availability, commission assumptions, and performance metrics.

## Order and OrderLine

Channel, timestamps, customer token where permitted, gross amount, discounts, commission, tax, refund, status, preparation time, and item lines.

## CustomerProfile

First-party, consented customer profile. Marketplace identities may be unavailable or restricted and must not be assumed.

## Review

Provider, rating, text, language, sentiment, topics, branch, response, and service-recovery state.

## Promotion

Channel, offer type, funding split, eligibility, start/end, budget, redemption, and margin effect.

## RestaurantMetric

These are not a loose list. Each one is registered by the pack as a metric definition in the core registry specified in `specs/015-metric-registry-and-normalized-metrics.md`, carrying a stable key, a value kind, and declared aggregation semantics. The core never learns these names.

Two quantities are **not** pack keys, because the core already owns them:

- **Revenue** is the core `revenue.gross`, reused as-is.
- **Orders** map onto the core `transactions.count`. `specs/012-channel-economics-ledger.md` section 2 fixes "transaction" as the core term for the unit and makes the mapping the pack's job. A second key counting the same thing would leave the economics ledger with no defensible choice between them.

| Key | Value kind | Aggregation | Notes |
| --- | --- | --- | --- |
| `margin.contribution` | money | sum | Projection of the economics ledger, which stays authoritative |
| `margin.contribution_percent` | ratio | ratio_of_sums | |
| `order.average_value` | ratio | ratio_of_sums | Revenue over transactions |
| `listing.impressions` | count | sum | |
| `listing.conversion_rate` | ratio | ratio_of_sums | |
| `customer.repeat_rate` | ratio | ratio_of_sums | |
| `order.refund_rate` | ratio | ratio_of_sums | |
| `order.cancellation_rate` | ratio | ratio_of_sums | |
| `menu_item.stockout_rate` | ratio | ratio_of_sums | |
| `kitchen.preparation_time` | duration | percentile (p50) | Median, not mean: the tail is long and a mean tracks the worst tickets |
| `review.rating` | rating | weighted_mean | Bounded 1–5; sum of stars over number of reviews |
| `review.velocity` | count | sum | |
| `branch.footfall_proxy` | count | sum | |

Every ratio above stores its numerator and denominator, never a quotient, so that a rate aggregates correctly across dayparts, branches, and channels. A CSV column holding a pre-computed rate therefore cannot be imported against one of these keys — the projection refuses it rather than storing the quotient.

`margin.contribution` at period grain is a projection of the channel economics ledger, not an independent computation. The ledger remains authoritative for contribution margin, and a period metric that disagrees with it is a defect.

The pack also registers `menu_item` and `marketplace_listing` as subject kinds, which is what allows a playbook to screen individual items on their own metrics without the core learning what a menu item is.

All of the above is seeded by `supabase/migrations/20260810160000_restaurant_pack_metric_definitions.sql` as shared vocabulary with no organization, per `specs/015-metric-registry-and-normalized-metrics.md` section 5.
