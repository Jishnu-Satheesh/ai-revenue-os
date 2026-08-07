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

Examples:

- Orders.
- Revenue.
- Contribution margin.
- Average order value.
- Conversion rate.
- Repeat rate.
- Refund and cancellation rate.
- Preparation time.
- Stockout rate.
- Rating and review velocity.
- Offline footfall proxy.
