import type { ReadinessCostCoverage, ReadinessObservation } from "@/domain/economics/readiness";

/**
 * The boundaries evidence readiness reads through. There is no write side, and
 * there is no place to add one: the read model is derived at request time and
 * stored nowhere.
 */

/** The names a tuple is shown under. Labels only, no configuration. */
export type ReadinessChannelLabel = { id: string; displayName: string };
export type ReadinessBranchLabel = { id: string; name: string };

export type ReadinessEvidence = {
  /**
   * Exact-range observations with every value field already dropped.
   *
   * The repository maps rows onto `ReadinessObservation`, whose type has no
   * numerator, denominator, or amount, so a workbook figure cannot reach the
   * classifier, the response, or a log even by mistake.
   */
  observations: readonly ReadinessObservation[];
  channels: readonly ReadinessChannelLabel[];
  branches: readonly ReadinessBranchLabel[];
};

export type EvidenceReadinessRepository = {
  loadEvidence(input: { organizationId: string }): Promise<ReadinessEvidence>;

  /**
   * Availability and quality tier per registered cost component.
   *
   * Read through the governed coverage function rather than the rate table, so
   * an operator without admin rights still learns what is priced without ever
   * learning what it costs. A failed or empty read returns `unchecked`, which
   * the classifier treats as a gap rather than an all-clear.
   */
  loadCostCoverage(input: { organizationId: string }): Promise<ReadinessCostCoverage>;
};
