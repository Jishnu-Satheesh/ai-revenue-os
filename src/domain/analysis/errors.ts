/**
 * A detector or the registry could not proceed on the inputs it was handed.
 *
 * Distinct from `needs_data`, which is an answer: `needs_data` means the
 * evidence contract was unsatisfied and says so in a record an operator can
 * read. This is a caller error -- a malformed window, an unknown grain -- and
 * it fails the run rather than being reported as a finding.
 */
export class ChannelAnalysisError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ChannelAnalysisError";
  }
}
