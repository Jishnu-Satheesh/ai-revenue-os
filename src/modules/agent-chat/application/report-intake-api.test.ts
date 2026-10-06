import { describe, expect, it } from "vitest";

import { attachmentIntentSchema, attachmentCompletionSchema } from "./report-intake-api";

const scope = {
  channelId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
  reportType: "Talabat sales",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  currency: "AED",
};

describe("agent report attachment requests", () => {
  it("accepts one bounded CSV or XLSX intent", () => {
    expect(attachmentIntentSchema.parse({
      fileName: "sales.csv", mediaType: "text/csv", byteSize: 42,
      idempotencyKey: "attachment-upload-001",
    }).fileName).toBe("sales.csv");
    expect(attachmentIntentSchema.safeParse({
      fileName: "sales.pdf", mediaType: "application/pdf", byteSize: 42,
      idempotencyKey: "attachment-upload-001",
    }).success).toBe(false);
    expect(attachmentIntentSchema.safeParse({
      fileName: "sales.xlsx", mediaType: "text/csv", byteSize: 42,
      idempotencyKey: "attachment-upload-001",
    }).success).toBe(false);
  });

  it("accepts a declared scope or leaves it pending for a server question", () => {
    expect(attachmentCompletionSchema.parse({ scope }).scope).toEqual(scope);
    expect(attachmentCompletionSchema.parse({}).scope).toBeNull();
    expect(attachmentCompletionSchema.safeParse({ scope: { ...scope, currency: "aed" } }).success)
      .toBe(false);
    expect(attachmentCompletionSchema.safeParse({ scope, challenge: { approved: true } }).success)
      .toBe(false);
  });
});
