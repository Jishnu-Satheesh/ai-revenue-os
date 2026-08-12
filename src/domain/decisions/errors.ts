/**
 * Decision Engine errors.
 *
 * These signal a broken contract, never an absence of data. A missing input is
 * an ordinary outcome that produces a `needs_data` decision; a candidate whose
 * money components span currencies, or whose parameters cannot be canonicalised,
 * is a defect that must not be papered over with a conversion or a guess.
 */
export type DecisionErrorCode =
  | "DECISION_PARAMETER_NOT_CANONICAL"
  | "DECISION_CURRENCY_MISMATCH"
  | "DECISION_IMPACT_RANGE_INVALID"
  | "DECISION_CONFIDENCE_OUT_OF_RANGE"
  | "DECISION_POLICY_VERSION_MISSING";

export class DecisionError extends Error {
  readonly name = "DecisionError";

  constructor(
    public readonly code: DecisionErrorCode,
    message: string,
  ) {
    super(message);
  }
}
