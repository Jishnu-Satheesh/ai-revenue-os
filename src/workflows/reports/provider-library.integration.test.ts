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
import { matchProviderDefinitions, type ProfiledSheet } from "@/domain/reports/provider-library/match";
import { selectContractSheet } from "@/domain/reports/sheet-locator";
import { profileXlsxBuffer } from "@/workflows/reports/profile-report-package";
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

/**
 * Files the client exports that no definition claims, and none should.
 *
 * Three of Keeta's data exports carry order-level and item-level detail with no
 * aggregate to project. EatEasily's customer-wise report carries names and
 * phone numbers. Its day-orders report heads the value column with the branch
 * name, so a second branch would change every heading.
 */
const UNCLAIMED = [
  "Keeta/Keeta-Jan-Feb-2026-Item-Data.xlsx",
  "Keeta/Keeta-Jan-Feb-2026-Orders-Data.xlsx",
  "Keeta/Keeta-Jan-Feb-2026-Promotions-Data.xlsx",
  "EatEasily-Smile/Jan_feb_2026_Customer_wise_EatEasily.xlsx",
  "EatEasily-Smile/Jan_feb_2026_day_orders_EatEasily.xlsx",
];

async function profileOf(path: string): Promise<ProfiledSheet[]> {
  return (await profileXlsxBuffer(readFileSync(path))).map((manifest) => ({
    normalizedSheetName: manifest.normalizedSheetName,
    sheetPosition: manifest.sheetPosition,
    hasFormula: manifest.hasFormula,
    hasMergedCells: manifest.hasMergedCells,
    headerCandidateDigests: manifest.headerCandidateDigests,
  }));
}

describe("recognising one report family from another", () => {
  it("claims each real download for its own definition and no other", async () => {
    // Two of Keeta's exports use a worksheet named `0`, and every EatEasily
    // report opens a sheet called `Sales Report`. Only the columns tell them
    // apart, so this is the assertion that matters: offering an operator the
    // wrong known mapping would be worse than offering none.
    for (const definition of PROVIDER_REPORT_DEFINITIONS) {
      const path = fixturePath(definition);
      if (!existsSync(path)) continue;
      const matched = matchProviderDefinitions({
        declaredCurrency: definition.contract.currency,
        sheets: await profileOf(path),
      }).map((match) => match.key);

      expect(matched, definition.draftedFrom).toEqual([definition.key]);
    }
  });

  it("claims nothing for the exports no definition covers", async () => {
    for (const relative of UNCLAIMED) {
      const path = resolve(RAW, relative);
      if (!existsSync(path)) continue;
      const matched = matchProviderDefinitions({
        declaredCurrency: "AED",
        sheets: await profileOf(path),
      });

      expect(matched.map((match) => match.key), relative).toEqual([]);
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

    it("is recognised from its profile alone, with no workbook value read", async () => {
      // The profile is sheet names, positions and digests of the headers. What
      // an operator gets offered is decided from that and nothing else, which
      // is why recognition can happen before anyone has approved reading the
      // file's contents.
      const matched = matchProviderDefinitions({
        declaredCurrency: definition.contract.currency,
        sheets: await profileOf(path),
      }).map((match) => match.key);

      expect(matched, definition.key).toContain(definition.key);
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
