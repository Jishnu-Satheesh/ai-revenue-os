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

/** The most period keys `ReportCategoricalValueNotDeclared` names in its message. */
const MAX_NAMED_PERIODS = 8;

/**
 * The longest `value` this error will carry verbatim.
 *
 * Not an arbitrary guess: a declared label is bounded by the same rule the
 * document schema already enforces on `allowedValues`
 * (`^[A-Z][A-Z0-9_]{0,63}$`), so 64 characters is the most a legitimate
 * category could ever need. An *undeclared* value has no such guarantee --
 * it is whatever text sat at that cell, and if a ragged row's shift is ever
 * mis-detected, that could be an unrelated cell read at the wrong offset
 * rather than a category at all. Bounding it here, at the one place this
 * text becomes a persisted, operator-visible record, is cheaper than trusting
 * every caller upstream to have bounded it first.
 */
const MAX_VALUE_LENGTH = 64;
const TRUNCATION_MARKER = "…";

function boundedCategoryValue(value: string): string {
  return value.length > MAX_VALUE_LENGTH
    ? `${value.slice(0, MAX_VALUE_LENGTH)}${TRUNCATION_MARKER}`
    : value;
}

/**
 * A categorical column carried a label the approved figures do not declare.
 *
 * Carries the label rather than only a code, for the reason ADR 0029 gives for
 * `ReportControlTotalMismatch`: the useful part is the difference. An operator
 * told "CLOSED, on 4 and 11 March, is not a declared cancellation reason" can
 * decide in seconds. An operator told "CATEGORICAL_VALUE_NOT_DECLARED" opens
 * the source.
 *
 * `value` is bounded to `MAX_VALUE_LENGTH`, with a trailing marker when it was
 * cut, so a truncated value is visibly a truncated value rather than a short
 * one. Without this, an oversized value could itself consume the room
 * `periodKeys` and the phrase "is not a declared value" need before
 * `failureDetail`'s 300-character cut ever applies.
 *
 * `periodKeys` holds every offending day, but the message names at most the
 * first eight of them -- `failureDetail` truncates to 300 characters, and a
 * month of dates would push the label and output key, the part an operator
 * acts on, past the cut. The label and output key are written first so
 * truncation can only ever eat days, never them.
 */
export class ReportCategoricalValueNotDeclared extends ReportProjectionError {
  public readonly value: string;

  constructor(
    public readonly outputKey: string,
    value: string,
    /** Every period the undeclared label appears on, in ascending order. */
    public readonly periodKeys: readonly string[],
  ) {
    super("CATEGORICAL_VALUE_NOT_DECLARED");
    this.name = "ReportCategoricalValueNotDeclared";
    this.value = boundedCategoryValue(value);
    const shown = periodKeys.slice(0, MAX_NAMED_PERIODS);
    const remaining = periodKeys.length - shown.length;
    const days = remaining > 0 ? `${shown.join(", ")}, +${remaining} more` : shown.join(", ");
    this.message = `${outputKey}: ${this.value} is not a declared value (${days})`;
  }
}
