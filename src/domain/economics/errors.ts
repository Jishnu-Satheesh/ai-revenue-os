/**
 * Channel economics errors.
 *
 * These signal a broken contract, never an absence of data. An unpriced
 * component is an ordinary outcome and grades the margin `indicative`; two
 * currencies in one period, or a money figure with no currency at all, is a
 * number nobody can defend and throws instead.
 */
export type EconomicsErrorCode =
  | "ECONOMICS_CURRENCY_MISSING"
  | "ECONOMICS_CURRENCY_MISMATCH"
  | "ECONOMICS_DEFINITION_UNKNOWN"
  | "ECONOMICS_CATALOG_UNAVAILABLE"
  | "ECONOMICS_REVENUE_ROLE_UNBOUND"
  | "ECONOMICS_WRITE_FAILED";

export class EconomicsError extends Error {
  readonly name = "EconomicsError";

  constructor(
    public readonly code: EconomicsErrorCode,
    message: string,
    public readonly metadata: Readonly<Record<string, string | number | boolean>> = {},
  ) {
    super(message);
  }

  toJSON(): {
    code: EconomicsErrorCode;
    message: string;
    metadata: Readonly<Record<string, string | number | boolean>>;
  } {
    return { code: this.code, message: this.message, metadata: this.metadata };
  }
}

const safeEconomicsErrorCopy: Readonly<Record<EconomicsErrorCode, string>> = {
  ECONOMICS_CURRENCY_MISSING: "A revenue figure arrived without a currency and cannot be priced.",
  ECONOMICS_CURRENCY_MISMATCH: "This period mixes currencies, which the ledger never converts.",
  ECONOMICS_DEFINITION_UNKNOWN: "A cost component was priced against an unregistered definition.",
  ECONOMICS_CATALOG_UNAVAILABLE: "The cost component catalog could not be read.",
  ECONOMICS_REVENUE_ROLE_UNBOUND:
    "No registered metric supplies gross revenue, so there is nothing to price.",
  ECONOMICS_WRITE_FAILED: "These economics entries could not be recorded.",
};

export function economicsError(
  code: EconomicsErrorCode,
  metadata?: Readonly<Record<string, string | number | boolean>>,
): EconomicsError {
  return new EconomicsError(code, safeEconomicsErrorCopy[code], metadata ?? {});
}
