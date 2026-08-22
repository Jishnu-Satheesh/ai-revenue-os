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
