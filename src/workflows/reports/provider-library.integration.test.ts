import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  projectExactRangeMetrics,
  projectPeriodGrainMetrics,
  type ReportProjectionDocument,
} from "@/domain/reports/projection";
import {
  PROVIDER_REPORT_DEFINITIONS,
  type ProviderReportDefinition,
} from "@/domain/reports/provider-library";
import { selectContractSheet } from "@/domain/reports/sheet-locator";
import { readWorkbookRows } from "@/workflows/reports/project-report-package";
import { validateXlsxBuffer } from "@/workflows/reports/validate-report-package";

/**
 * Runs every checked-in provider definition against the download it was drafted
 * from, through the real validator and the real projector.
 *
 * This is the only thing that makes a checked-in contract trustworthy. A
 * contract is a set of claims about a file — this sheet, this header row, this
 * column, this date encoding — and every one of them is wrong until the actual
 * file agrees. Reviewing the JSON by eye catches none of it.
 *
 * The downloads are gitignored because they carry the client's real figures, so
 * a definition whose file is absent skips rather than fails. No figure from any
 * of them appears in this file or in an assertion.
 */
const RAW = resolve(process.cwd(), "fixtures/raw");
const DECLARED_PERIOD = { periodStart: "2026-01-01", periodEnd: "2026-02-28" };

function fixturePath(definition: ProviderReportDefinition): string {
  return resolve(RAW, definition.draftedFrom);
}

describe("every checked-in provider definition", () => {
  it("has a key, a report type and a drafting source of its own", () => {
    const keys = PROVIDER_REPORT_DEFINITIONS.map((definition) => definition.key);
    const sources = PROVIDER_REPORT_DEFINITIONS.map((definition) => definition.draftedFrom);

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(sources).size).toBe(sources.length);
    expect(keys.every((key) => /^[a-z][a-z0-9_.]*$/.test(key))).toBe(true);
  });

  it("projects only from fields its own contract binds", () => {
    for (const { key, contract, projection } of PROVIDER_REPORT_DEFINITIONS) {
      for (const output of projection.outputs) {
        const sheet = contract.sheets.find(
          (candidate) => candidate.normalizedSheetName === output.normalizedSheetName,
        );
        expect(sheet, `${key}: ${output.normalizedSheetName}`).toBeDefined();
        expect(
          sheet?.fields.some((field) => field.canonicalField === output.canonicalField),
          `${key}: ${output.canonicalField}`,
        ).toBe(true);
      }
    }
  });
});

for (const definition of PROVIDER_REPORT_DEFINITIONS) {
  const path = fixturePath(definition);
  const present = existsSync(path);

  (present ? describe : describe.skip)(`${definition.key} against its real download`, () => {
    async function sheets() {
      return readWorkbookRows(readFileSync(path));
    }

    it("finds the sheet its contract describes", async () => {
      for (const rule of definition.contract.sheets) {
        expect(selectContractSheet(rule, await sheets()), rule.normalizedSheetName).toBeDefined();
      }
    });

    it("finds every column its contract binds, under the header row it declares", async () => {
      const found = await sheets();
      for (const rule of definition.contract.sheets) {
        const sheet = selectContractSheet(rule, found);
        const header = (sheet?.rows[rule.headerRow - 1] ?? []).filter(
          (cell): cell is string => typeof cell === "string",
        );
        const normalized = new Set(
          header.map((cell) =>
            cell
              .normalize("NFKD")
              .replace(/[^\p{L}\p{N}]+/gu, "_")
              .replace(/^_+|_+$/g, "")
              .toLocaleLowerCase("en-US")
              .slice(0, 64),
          ),
        );
        for (const field of rule.fields) {
          expect(normalized.has(field.sourceHeader), `${definition.key}: ${field.sourceHeader}`).toBe(
            true,
          );
        }
      }
    });

    it("validates without an error", async () => {
      const result = await validateXlsxBuffer(
        readFileSync(path),
        definition.contract,
        // Controls compare against profiled counts, and this definition
        // declares none, so an empty profile set is the honest input here.
        [],
        DECLARED_PERIOD,
      );

      expect(result.errorCodes, definition.key).toEqual([]);
    });

    it("projects without throwing, and returns no value from the workbook", async () => {
      const found = await sheets();
      const projected =
        definition.projection.outputKind === "exact_range"
          ? projectExactRangeMetrics({
              contract: definition.contract,
              document: definition.projection,
              declaredCurrency: definition.contract.currency,
              sheets: found,
            })
          : projectPeriodGrainMetrics({
              contract: definition.contract,
              document: definition.projection as Extract<
                ReportProjectionDocument,
                { outputKind: "period_grain" }
              >,
              declaredCurrency: definition.contract.currency,
              declaredPeriod: DECLARED_PERIOD,
              sheets: found,
            });

      // Every declared output has to come back. A projection that quietly
      // produced nothing would pass a looser assertion while leaving the
      // channel with no evidence at all.
      const keys =
        "outputs" in projected
          ? projected.outputs.map((output) => output.key)
          : [...new Set(projected.observations.map((observation) => observation.key))];
      expect(new Set(keys), definition.key).toEqual(
        new Set(definition.projection.outputs.map((output) => output.key)),
      );
    });
  });
}
