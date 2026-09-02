import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-key",
  },
}));

import {
  normalizeReportProjectionProposalBody,
  proposeReportProjectionSchema,
} from "@/domain/reports/schemas";
import { reportRequest } from "@/modules/reports/application/api";

describe("report request validation", () => {
  const projectionDocument = {
    schemaVersion: 1 as const,
    outputKind: "exact_range" as const,
    outputs: [
      {
        key: "gross_revenue",
        normalizedSheetName: "sheet1",
        canonicalField: "net_sales",
        metricKey: "revenue.gross",
        valueKind: "money" as const,
        aggregation: "sum" as const,
      },
    ],
  };

  it("explains the projection proposal envelope when it is missing", async () => {
    await expect(
      reportRequest(
        new Request("http://localhost", {
          method: "POST",
          body: JSON.stringify({
            schemaVersion: 1,
            outputKind: "exact_range",
            outputs: [],
          }),
        }),
        proposeReportProjectionSchema,
        "Projection declarations must include projectionDocument (schemaVersion 1, outputKind exact_range, valid outputs) and an idempotencyKey at least 16 characters long.",
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message:
        "Projection declarations must include projectionDocument (schemaVersion 1, outputKind exact_range, valid outputs) and an idempotencyKey at least 16 characters long.",
    });
  });

  it("unwraps one accidental nested projection envelope", async () => {
    await expect(
      reportRequest(
        new Request("http://localhost", {
          method: "POST",
          body: JSON.stringify({
            projectionDocument: {
              projectionDocument,
              idempotencyKey: "report-projection-proposal:inner",
            },
            idempotencyKey: "report-projection-proposal:outer",
          }),
        }),
        proposeReportProjectionSchema,
        "Projection declarations must include projectionDocument (schemaVersion 1, outputKind exact_range, valid outputs) and an idempotencyKey at least 16 characters long.",
        normalizeReportProjectionProposalBody,
      ),
    ).resolves.toMatchObject({
      projectionDocument,
      idempotencyKey: "report-projection-proposal:outer",
    });
  });
});
