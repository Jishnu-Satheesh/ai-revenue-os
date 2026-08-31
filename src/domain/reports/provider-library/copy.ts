/**
 * What a known report family reads, in the words an operator uses.
 *
 * A metric key is a stable identifier and a poor sentence. `revenue.gross`
 * tells an engineer exactly what is meant and tells a restaurant owner nothing,
 * and this screen is where someone decides whether to trust a mapping. They can
 * only decide that if it is written in their language.
 */
const METRIC_LABELS: Readonly<Record<string, string>> = {
  "revenue.gross": "sales",
  "transactions.count": "orders",
  "units.count": "items sold",
  "promotion.funding": "promotion spend",
  // What the marketplace funded, kept separate from what the restaurant funded.
  // Adding them would overstate the spend and hide the contribution.
  "promotion.provider_subsidy": "promotion funded by the marketplace",
  "cost.commission": "commission charged",
  // Keeta's own words for its bank charge: a transaction fee covering payment
  // processor and bank fees. A cost of being paid, not a cost of selling.
  "cost.payment_processing": "payment processing charged",
  "cost.equipment_fee": "POS and equipment fees",
  "listing.impressions": "times your listing was seen",
  "listing.menu_views": "menu views",
  "listing.cart_additions": "add-to-cart events",
  "listing.placed_orders": "orders placed from the listing",
  "operations.scheduled_minutes": "scheduled open minutes",
  "operations.closed_minutes": "unavailable minutes",
  "operations.preparation_minutes": "preparation minutes",
  "operations.closed_days": "days unavailable",
  "order.total_count": "orders placed",
  "order.cancelled_count": "orders cancelled",
  "order.avoidable_cancellation_count": "avoidable cancellations",
  "order.avoidable_cancellation_reason": "avoidable cancellations by reason",
  "customer.new_order_count": "orders from new customers",
  "customer.returning_order_count": "orders from returning customers",
  "revenue.online_sales": "online sales",
  "revenue.cash_sales": "cash sales",
  "revenue.delivery_sales": "delivery sales",
  "revenue.pickup_sales": "pickup sales",
  "revenue.rejection_loss": "revenue lost to rejected orders",
  "delivery.spend": "delivery spend",
  "margin.contribution": "reported margin",
};

export function describeMetric(metricKey: string): string {
  return METRIC_LABELS[metricKey] ?? metricKey;
}

/** "sales and orders", "sales, orders and promotion spend". */
export function describeMetrics(metricKeys: readonly string[]): string {
  const labels = metricKeys.map(describeMetric);
  if (labels.length <= 1) return labels[0] ?? "nothing";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
