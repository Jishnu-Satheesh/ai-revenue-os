import { accountingProfitAndLoss } from "@/domain/reports/provider-library/accounting-profit-and-loss";
import { eatEasilyBranchSales } from "@/domain/reports/provider-library/eateasily-branch-sales";
import { keetaBillingSummary } from "@/domain/reports/provider-library/keeta-billing-summary";
import { keetaOrders } from "@/domain/reports/provider-library/keeta-orders";
import { keetaRestaurantDaily } from "@/domain/reports/provider-library/keeta-restaurant-daily";
import { noonSalesSummary } from "@/domain/reports/provider-library/noon-sales-summary";
import { talabatPerformance } from "@/domain/reports/provider-library/talabat-performance";
import type { ProviderReportDefinition } from "@/domain/reports/provider-library/types";

export type { ProviderReportDefinition };

/**
 * Every report family the platform already knows how to read.
 *
 * Six definitions. EatEasily and Smile are one platform under two names and
 * share a definition. The last is not a marketplace export at all: the
 * company's own profit and loss, which is where food and packaging cost are
 * stated and nowhere else.
 *
 * A definition is inert. It describes a shape; it grants nothing. An owner or
 * admin still approves it for their organization before a single figure is read
 * through it, exactly as they would a mapping written by hand.
 */
export const PROVIDER_REPORT_DEFINITIONS: readonly ProviderReportDefinition[] = [
  talabatPerformance,
  keetaBillingSummary,
  keetaOrders,
  keetaRestaurantDaily,
  noonSalesSummary,
  eatEasilyBranchSales,
  accountingProfitAndLoss,
];

export function findProviderReportDefinition(key: string): ProviderReportDefinition | undefined {
  return PROVIDER_REPORT_DEFINITIONS.find((definition) => definition.key === key);
}
