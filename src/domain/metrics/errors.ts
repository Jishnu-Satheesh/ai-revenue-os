/**
 * Metric read errors.
 *
 * These signal a broken contract rather than an absence of data. "No rows for
 * this window" is an ordinary outcome and is returned as `insufficient_data`;
 * asking for a percentile across periods, or summing two currencies, is a
 * programming error and throws.
 */
export type MetricErrorCode =
  | "METRIC_AGGREGATION_UNSUPPORTED"
  | "METRIC_CURRENCY_MISMATCH"
  | "METRIC_DENOMINATOR_MISSING"
  | "METRIC_DENOMINATOR_INVALID"
  | "METRIC_PERIOD_RANGE_INVALID"
  | "METRIC_TIMEZONE_INVALID"
  | "METRIC_TIMEZONE_MIXED"
  | "METRIC_CSV_MAPPING_INVALID";

export class MetricError extends Error {
  readonly name = "MetricError";

  constructor(
    public readonly code: MetricErrorCode,
    message: string,
    public readonly metadata: Readonly<Record<string, string | number | boolean>> = {},
  ) {
    super(message);
  }

  toJSON(): {
    code: MetricErrorCode;
    message: string;
    metadata: Readonly<Record<string, string | number | boolean>>;
  } {
    return { code: this.code, message: this.message, metadata: this.metadata };
  }
}

const safeMetricErrorCopy: Readonly<Record<MetricErrorCode, string>> = {
  METRIC_AGGREGATION_UNSUPPORTED: "This metric cannot be combined across periods.",
  METRIC_CURRENCY_MISMATCH: "This series mixes currencies and cannot be combined.",
  METRIC_DENOMINATOR_MISSING: "This metric needs a denominator on every observation.",
  METRIC_DENOMINATOR_INVALID: "A denominator must be greater than zero.",
  METRIC_PERIOD_RANGE_INVALID: "The requested period range is empty or inverted.",
  METRIC_TIMEZONE_INVALID: "The requested timezone is not recognised.",
  METRIC_TIMEZONE_MIXED:
    "This series was bucketed in more than one timezone and cannot be combined.",
  METRIC_CSV_MAPPING_INVALID:
    "This import's column mapping must name a period column and at least one metric key.",
};

export function metricError(
  code: MetricErrorCode,
  metadata?: Readonly<Record<string, string | number | boolean>>,
): MetricError {
  return new MetricError(code, safeMetricErrorCopy[code], metadata ?? {});
}
