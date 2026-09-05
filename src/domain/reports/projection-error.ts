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
 * The exact shape the declare route, its Zod boundary, and the database
 * guard all require of a label (`^[A-Z][A-Z0-9_]{0,63}$`). Exported so the
 * panel can decide, before ever building the Declare button, whether this
 * refusal's own value could survive that boundary -- a raw provider label
 * like `Closed by store` or `closed` never can, and offering the button
 * anyway only replaces a nameless refusal with a named dead end.
 */
export const CATEGORY_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Whether `value` is already shaped as a label the declare path can accept
 * as written, with no translation.
 *
 * A truncated value already fails this on length alone -- see
 * `isTruncatedCategoricalValue`, which exists as its own check only because
 * the panel needs to say *why* the button is missing, not merely that it is.
 */
export function isDeclarableCategoricalValue(value: string): boolean {
  return CATEGORY_CODE_PATTERN.test(value);
}

/**
 * Whether `value` was cut short by `boundedCategoryValue` rather than being
 * the provider's own text end to end.
 *
 * The addendum required this distinction explicitly: a value ending in the
 * truncation marker may not be the provider's real label at all, so the
 * panel must say it was cut rather than silently offering (or silently
 * refusing) a label the provider may never have written.
 */
export function isTruncatedCategoricalValue(value: string): boolean {
  return value.endsWith(TRUNCATION_MARKER);
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

export type ParsedCategoricalRefusal = {
  outputKey: string;
  value: string;
  /** The dates as recorded, in the order the run wrote them. */
  dates: string[];
};

/**
 * What a recorded categorical refusal was about, recovered from the run's
 * own words.
 *
 * The worker stores `name: code: message`, so a refusal arrives shaped like
 * `ReportProjectionError: CATEGORICAL_VALUE_NOT_DECLARED: cancel_reason:
 * CLOSED is not a declared value (2026-03-04, 2026-03-11)`. The output key
 * is matched strictly and the value greedily from the right, because a raw
 * provider label may itself contain the words being matched on. Anything
 * that does not parse returns null, and the panel falls back to the raw
 * detail with no button rather than a wrong one.
 */
const CATEGORICAL_VALUE_NOT_DECLARED_CODE = "CATEGORICAL_VALUE_NOT_DECLARED";

export function parseCategoricalRefusalDetail(detail: string): ParsedCategoricalRefusal | null {
  const marker = `${CATEGORICAL_VALUE_NOT_DECLARED_CODE}: `;
  const markerIndex = detail.indexOf(marker);
  if (markerIndex < 0) return null;
  const remainder = detail.slice(markerIndex + marker.length);
  const match = /^([a-z][a-z0-9_]{0,63}): (.*) is not a declared value \((.*)\)$/.exec(remainder);
  if (!match) return null;
  const [, outputKey, value, dates] = match;
  if (value.length === 0) return null;
  return {
    outputKey,
    value,
    dates: dates.length === 0 ? [] : dates.split(",").map((day) => day.trim()),
  };
}

/**
 * Whether `detail` is the pre-Task-4 recording of this same refusal: `name:
 * code`, composed by `failureDetail` before `ReportCategoricalValueNotDeclared`
 * existed to name a label and its dates, so nothing follows the code at all.
 *
 * `parseCategoricalRefusalDetail` also returns null for this shape, but it
 * returns null for a second, unrelated shape too: a detail that carries the
 * marker yet fails to parse (malformed text after it). Those two nulls need
 * different panel copy -- this one is a package refused before the platform
 * could say which label, fixable by retrying the projection; the other is a
 * shape nothing here can respond to usefully. Checking for the exact bare
 * form, rather than merely "did not parse," is what tells them apart.
 */
export function isBareCategoricalValueNotDeclared(detail: string): boolean {
  return (
    detail === CATEGORICAL_VALUE_NOT_DECLARED_CODE ||
    detail.endsWith(`: ${CATEGORICAL_VALUE_NOT_DECLARED_CODE}`)
  );
}
