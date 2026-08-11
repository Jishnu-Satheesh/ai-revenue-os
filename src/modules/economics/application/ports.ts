import type { StoredCostRate } from "@/domain/economics/rates";
import type {
  CompletenessGrade,
  CostComponentDefinition,
  EconomicsQualityTier,
  MarginSource,
} from "@/domain/economics/types";

/**
 * The boundaries the channel economics ledger reads and writes through.
 *
 * The catalog is read as a whole rather than definition by definition. Pricing
 * a period needs every applicable definition, including the ones with no rate —
 * those are exactly the components that grade a margin `indicative`, and a
 * lazy per-key lookup would never ask for them.
 */

/** A registered definition, carrying the id the ledger records against. */
export type RegisteredCostComponent = {
  id: string;
  definition: CostComponentDefinition;
};

export type EconomicsCatalog = {
  components: readonly RegisteredCostComponent[];
  rates: readonly StoredCostRate[];
};

export type EconomicsCatalogPort = {
  /** Shared vocabulary plus this organization's custom keys, with its own rates. */
  loadCatalog(organizationId: string): Promise<EconomicsCatalog>;
};

export type EconomicsComponentWrite = {
  definitionId: string;
  /**
   * The rate that produced the amount, or null where none did. A `missing`
   * component always carries null: the database rejects any other combination,
   * because a component attributed to a rate that did not price it is a false
   * audit trail.
   */
  rateId: string | null;
  amountMinor: number;
  qualityTier: EconomicsQualityTier;
};

export type EconomicsEntryWrite = {
  branchId: string | null;
  grain: "transaction" | "period";
  channel: string | null;
  periodStart: Date;
  periodEnd: Date;
  periodTimezone: string;
  grossRevenueMinor: number;
  transactionCount: number;
  unitCount: number | null;
  currency: string;
  marginSource: MarginSource;
  completenessGrade: CompletenessGrade;
  /** Null exactly when the grade is indicative; the ceiling below is set instead. */
  contributionMarginMinor: number | null;
  atMostMinor: number | null;
  reportedQualityTier: Exclude<EconomicsQualityTier, "missing"> | null;
  sourceReference: string | null;
  components: readonly EconomicsComponentWrite[];
};

export type EconomicsLedgerStore = {
  /**
   * Records entries and their components together, replacing any that already
   * cover the same period. Recomputation is the normal case rather than the
   * exception: a rate corrected today has to reprice every period it was in
   * force for, and a period that regrades has to lose the figure it used to
   * state.
   */
  recordEntries(
    organizationId: string,
    entries: readonly EconomicsEntryWrite[],
  ): Promise<{ written: number }>;
};
