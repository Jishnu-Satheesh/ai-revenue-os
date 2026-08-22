import { createHash } from "node:crypto";

export type ExactRangeReconciliationContext = {
  organizationId: string;
  channelId: string;
  branchId: string;
  metricDefinitionId: string;
  projectionOutputKey: string;
  periodStart: string;
  periodEnd: string;
  periodTimezone: string;
  currency: string | null;
  contentSha256: string;
  validationResultDigest: string;
  contractMappingDigest: string;
  projectionDigest: string;
  calculationVersion: number;
  sourceDigest: string;
};

export type ExactRangeActiveObservation = {
  id: string;
  periodStart: string;
  periodEnd: string;
  reconciliationDigest: string;
};

export type ExactRangeOverlapClassification =
  | { kind: "exact_duplicate"; observationIds: string[] }
  | { kind: "non_overlapping"; observationIds: [] }
  | { kind: "ambiguous_overlap"; observationIds: string[] };

function canonicalize(value: ExactRangeReconciliationContext): string {
  return [
    value.organizationId,
    value.channelId,
    value.branchId,
    value.metricDefinitionId,
    value.projectionOutputKey,
    value.periodStart,
    value.periodEnd,
    value.periodTimezone,
    value.currency ?? "",
    value.contentSha256,
    value.validationResultDigest,
    value.contractMappingDigest,
    value.projectionDigest,
    value.calculationVersion,
    value.sourceDigest,
  ].join("|");
}

/** A safe equivalence key. Package, run, values, rows, and workbook names are excluded. */
export function createReportReconciliationDigest(input: ExactRangeReconciliationContext): string {
  return createHash("sha256").update(canonicalize(input)).digest("hex");
}

export function classifyExactRangeOverlap(input: {
  candidate: Pick<ExactRangeReconciliationContext, "periodStart" | "periodEnd"> & {
    reconciliationDigest: string;
  };
  active: readonly ExactRangeActiveObservation[];
}): ExactRangeOverlapClassification {
  const exactDuplicates = input.active.filter(
    (observation) =>
      observation.periodStart === input.candidate.periodStart &&
      observation.periodEnd === input.candidate.periodEnd &&
      observation.reconciliationDigest === input.candidate.reconciliationDigest,
  );
  if (exactDuplicates.length) {
    return {
      kind: "exact_duplicate",
      observationIds: exactDuplicates.map((observation) => observation.id),
    };
  }

  const overlaps = input.active.filter(
    (observation) =>
      observation.periodStart <= input.candidate.periodEnd &&
      observation.periodEnd >= input.candidate.periodStart,
  );
  return overlaps.length
    ? { kind: "ambiguous_overlap", observationIds: overlaps.map((observation) => observation.id) }
    : { kind: "non_overlapping", observationIds: [] };
}
