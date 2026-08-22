import { describe, expect, it } from "vitest";

import {
  explainReportValidationCode,
  summarizeReportContract,
} from "@/domain/reports/validation-copy";

describe("report validation copy", () => {
  it("summarizes the safe structural contract review details", () => {
    expect(
      summarizeReportContract({
        schemaVersion: 1,
        currency: "AED",
        outletGrain: "branch",
        unmappedFieldDisposition: "reviewed_ignore",
        controls: [],
        sheets: [
          {
            normalizedSheetName: "sheet1",
            headerRow: 1,
            dataStartRow: 2,
            allowFormula: false,
            allowMergedCells: false,
            fields: [
              {
                canonicalField: "gross_sales",
                sourceHeader: "gross_sales",
                parser: "money",
                required: true,
                financialSign: "positive",
              },
              {
                canonicalField: "successful_orders",
                sourceHeader: "successful_orders",
                parser: "integer",
                required: true,
              },
            ],
          },
        ],
      }),
    ).toEqual({
      currency: "AED",
      outletGrain: "branch",
      unmappedFieldDisposition: "reviewed_ignore",
      sheets: [
        {
          normalizedSheetName: "sheet1",
          headerRow: 1,
          dataStartRow: 2,
          allowFormula: false,
          allowMergedCells: false,
          requiredFields: [
            {
              canonicalField: "gross_sales",
              sourceHeader: "gross_sales",
              parser: "money",
              financialSign: "positive",
            },
            {
              canonicalField: "successful_orders",
              sourceHeader: "successful_orders",
              parser: "integer",
            },
          ],
        },
      ],
    });
  });

  it("explains a missing required field without exposing workbook values", () => {
    expect(explainReportValidationCode("REQUIRED_FIELD_MISSING")).toEqual({
      title: "A required mapped field is blank",
      detail: "At least one field marked as required had no usable value in the report data rows.",
      nextStep:
        "Check the required fields listed in the approved contract, then upload a corrected report or revise the contract if the field is not supplied.",
    });
  });

  it("uses safe fallback copy for an unknown code", () => {
    expect(explainReportValidationCode("UNEXPECTED_CODE")).toEqual({
      title: "A deterministic validation rule needs attention",
      detail: "The report did not satisfy one of the approved contract rules.",
      nextStep:
        "Review the contract details and retry only after the report or contract is corrected.",
    });
  });
});
