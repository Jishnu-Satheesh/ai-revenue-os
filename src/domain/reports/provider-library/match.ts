import { createHash } from "node:crypto";

import { PROVIDER_REPORT_DEFINITIONS } from "@/domain/reports/provider-library";
import type { ProviderReportDefinition } from "@/domain/reports/provider-library/types";
import { selectContractSheet } from "@/domain/reports/sheet-locator";

/**
 * Recognising an uploaded file as a report family the platform already knows.
 *
 * The test is deliberately the same one the database applies when a contract is
 * proposed: `private.assert_report_contract_matches_package`. Recognition and
 * admission ask the same question — would this contract be accepted for this
 * package? — so anything offered to an operator here is something the database
 * will take, and nothing is offered that would be refused a moment later.
 *
 * That mirroring is a liability if the two drift apart, so it is checked from
 * both ends: this module is proved against real profiled files, and the pgTAP
 * suite proves the database accepts a library-shaped contract.
 *
 * Nothing here reads a workbook value. The evidence is the profile: sheet
 * names, positions, and digests of the headers. A digest cannot be turned back
 * into a customer's name.
 */

/** One profiled sheet, as the manifest records it. */
export type ProfiledSheet = {
  normalizedSheetName: string;
  sheetPosition: number;
  hasFormula: boolean;
  hasMergedCells: boolean;
  headerCandidateDigests: readonly {
    rowPosition: number;
    normalizedHeaderDigests: readonly string[];
  }[];
};

export type DefinitionMismatch =
  | { reason: "currency_differs" }
  | { reason: "more_sheets_declared_than_profiled" }
  | { reason: "unmapped_sheets_present" }
  | { reason: "sheet_missing"; normalizedSheetName: string }
  | { reason: "formula_not_allowed"; normalizedSheetName: string }
  | { reason: "merged_cells_not_allowed"; normalizedSheetName: string }
  | { reason: "header_row_not_profiled"; normalizedSheetName: string; headerRow: number }
  | { reason: "column_missing"; normalizedSheetName: string; sourceHeader: string };

export type DefinitionMatch =
  | { outcome: "matched"; definition: ProviderReportDefinition }
  | { outcome: "no_match"; definition: ProviderReportDefinition; mismatch: DefinitionMismatch };

function headerDigest(sourceHeader: string): string {
  return createHash("sha256").update(sourceHeader).digest("hex");
}

export function matchProviderDefinition(input: {
  definition: ProviderReportDefinition;
  declaredCurrency: string;
  sheets: readonly ProfiledSheet[];
}): DefinitionMatch {
  const { definition } = input;
  const { contract } = definition;
  const no = (mismatch: DefinitionMismatch): DefinitionMatch => ({
    outcome: "no_match",
    definition,
    mismatch,
  });

  if (contract.currency !== input.declaredCurrency) return no({ reason: "currency_differs" });
  if (contract.sheets.length > input.sheets.length) {
    return no({ reason: "more_sheets_declared_than_profiled" });
  }
  if (
    contract.unmappedSheetDisposition !== "reviewed_ignore" &&
    contract.sheets.length !== input.sheets.length
  ) {
    return no({ reason: "unmapped_sheets_present" });
  }

  for (const rule of contract.sheets) {
    const name = rule.normalizedSheetName;
    // Position and name are resolved by the same function the projector uses,
    // so a definition cannot be recognised against one sheet and read from
    // another.
    const locator = rule.sheetLocator;
    const sheet =
      locator?.kind === "position"
        ? input.sheets.find((candidate) => candidate.sheetPosition === locator.position)
        : selectContractSheet(rule, input.sheets);
    if (!sheet) return no({ reason: "sheet_missing", normalizedSheetName: name });
    if (sheet.hasFormula && !rule.allowFormula) {
      return no({ reason: "formula_not_allowed", normalizedSheetName: name });
    }
    if (sheet.hasMergedCells && !rule.allowMergedCells) {
      return no({ reason: "merged_cells_not_allowed", normalizedSheetName: name });
    }

    const candidate = sheet.headerCandidateDigests.find(
      (row) => row.rowPosition === rule.headerRow,
    );
    if (!candidate) {
      return no({ reason: "header_row_not_profiled", normalizedSheetName: name, headerRow: rule.headerRow });
    }
    const present = new Set(candidate.normalizedHeaderDigests);
    for (const field of rule.fields) {
      if (present.has(headerDigest(field.sourceHeader))) continue;
      return no({ reason: "column_missing", normalizedSheetName: name, sourceHeader: field.sourceHeader });
    }
  }

  return { outcome: "matched", definition };
}

/**
 * Every known family this upload could be, best-known first.
 *
 * Several may match — Keeta's data exports all use a sheet named `0` and differ
 * only in their columns — so this returns all of them rather than picking. The
 * operator confirms which report they uploaded; the platform never decides that
 * on their behalf, because a wrong guess accepted silently is worse than a
 * question asked once.
 */
export function matchProviderDefinitions(input: {
  declaredCurrency: string;
  sheets: readonly ProfiledSheet[];
  definitions?: readonly ProviderReportDefinition[];
}): ProviderReportDefinition[] {
  return (input.definitions ?? PROVIDER_REPORT_DEFINITIONS)
    .map((definition) => matchProviderDefinition({ ...input, definition }))
    .filter((result): result is Extract<DefinitionMatch, { outcome: "matched" }> => result.outcome === "matched")
    .map((result) => result.definition);
}
