# Feature Specification: Restaurant Menu Intelligence

## Business outcome

Create a reliable, channel-aware profitability and conversion map that supports listing optimization, pricing, promotions, and campaign selection.

## Inputs

- Master menu.
- Branch menus.
- Marketplace listings.
- Prices and modifiers.
- Food and packaging cost or estimate.
- Item sales and conversion.
- Discounts, commissions, refunds, and availability.
- Images and descriptions.

## Core functions

- Parse and normalize menus.
- Match equivalent items across channels.
- Flag price, description, image, availability, and modifier discrepancies.
- Calculate or estimate contribution margin with confidence.
- Classify stars, workhorses, puzzles, and dogs using profitability and popularity.
- Identify test candidates.
- Produce a verification queue.

## Safety

- No automated price changes in V1.
- Estimated costs must be labeled.
- Promotion recommendations must respect minimum contribution margin.
- Operational capacity and preparation time are guardrails.

## Acceptance criteria

- Operator can review and correct item mappings.
- Every financial estimate shows source and confidence.
- Channel-specific prices and promotions remain separate.
- The system identifies at least one actionable listing or data-quality opportunity when evidence exists.
- Menu version history is retained.
