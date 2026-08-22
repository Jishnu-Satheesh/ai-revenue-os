import type { ReportContractDocument } from "@/domain/reports/contracts";

type ContractSheet = Pick<ReportContractDocument["sheets"][number], "normalizedSheetName" | "sheetLocator">;

/**
 * Find the sheet in an uploaded file that a contract sheet describes.
 *
 * By name, normally. By position when the provider puts something volatile in
 * the name: Talabat names the worksheet after the export range, so January's
 * download is `Talabat-Jan-Feb-2026-Performanc` and March's is something else.
 * A contract keyed on that name would stop recognising the provider's own
 * report the month after it was approved.
 *
 * Position is only safe because it is declared. A contract that says "the first
 * sheet" was approved by someone who looked at the file; a rule that guessed
 * the first sheet whenever the name missed would quietly read the wrong tab.
 */
export function selectContractSheet<T extends { normalizedSheetName: string }>(
  rule: ContractSheet,
  sheets: readonly T[],
): T | undefined {
  if (rule.sheetLocator?.kind === "position") return sheets[rule.sheetLocator.position - 1];
  return sheets.find((sheet) => sheet.normalizedSheetName === rule.normalizedSheetName);
}
