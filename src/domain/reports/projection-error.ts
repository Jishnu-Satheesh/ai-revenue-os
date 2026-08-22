/**
 * Extracted so the period-key parser and the projection engine can share it
 * without the parser importing the whole engine.
 */
export class ReportProjectionError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ReportProjectionError";
  }
}

/**
 * The projected figures did not reconcile to the total the operator recorded
 * from the provider's own statement.
 *
 * Carries the arithmetic rather than only a code, because the difference is the
 * useful part: an operator who is told "short by 12.40" can find the missing
 * day, and an operator who is told "projection failed" cannot. See ADR 0029.
 */
export class ReportControlTotalMismatch extends ReportProjectionError {
  constructor(
    public readonly outputKey: string,
    /** All three are minor units of the declared currency, as integer strings. */
    public readonly statedMinorUnits: string,
    public readonly projectedMinorUnits: string,
    public readonly differenceMinorUnits: string,
    public readonly toleranceMinorUnits: number,
  ) {
    super("CONTROL_TOTAL_MISMATCH");
    this.name = "ReportControlTotalMismatch";
  }
}
