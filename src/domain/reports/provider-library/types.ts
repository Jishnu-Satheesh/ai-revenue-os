import type { ReportContractDocument } from "@/domain/reports/contracts";
import type { ReportProjectionDocument } from "@/domain/reports/projection";

/**
 * A report family the platform already knows how to read.
 *
 * These are the shapes the pilot client's providers actually export, written
 * out once so an operator uploading a recognised file does not have to describe
 * it again. A definition is inert data: it becomes a real contract only when an
 * owner or admin approves it for their organization, exactly as a hand-written
 * mapping would. Checking one in is not approving it.
 *
 * Every definition is drafted against a real download and proved against it by
 * `provider-library.integration.test.ts`, which runs the actual validator and
 * projector over the file when it is present.
 */
export type ProviderReportDefinition = {
  /** Stable identifier for this family. Never reused for a different shape. */
  key: string;
  /** The marketplace, in the operator's words. */
  provider: string;
  /**
   * The report type recorded on the package. Free text in the database, so the
   * vocabulary is defined here and kept short and literal.
   */
  reportType: string;
  /** What an operator would recognise this file as, in one line. */
  summary: string;
  /** The download this was drafted against, for whoever revises it next. */
  draftedFrom: string;
  contract: ReportContractDocument;
  projection: ReportProjectionDocument;
};
