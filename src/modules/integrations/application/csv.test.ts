import { describe, expect, it } from "vitest";

import {
  buildDataSourceStoragePath,
  parseAndValidateCsv,
  validateColumnMapping,
  validateDataSourceStoragePath,
} from "@/modules/integrations/application/csv";

const organizationId = "11111111-1111-4111-8111-111111111111";
const dataSourceId = "22222222-2222-4222-8222-222222222222";
const uploadId = "33333333-3333-4333-8333-333333333333";

describe("governed CSV validation", () => {
  it("normalizes a UTF-8 BOM and returns safe header metadata", () => {
    const result = parseAndValidateCsv({
      bytes: new TextEncoder().encode("\uFEFFdate,revenue\n2026-08-01,120"),
      filename: "august.csv",
      mediaType: "text/csv",
    });

    expect(result.headers).toEqual(["date", "revenue"]);
    expect(result.rowCount).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("rejects invalid UTF-8, empty or duplicate headers, and oversized metadata", () => {
    expect(() =>
      parseAndValidateCsv({
        bytes: Uint8Array.from([0xc3, 0x28]),
        filename: "bad.csv",
        mediaType: "text/csv",
      }),
    ).toThrow(/UTF-8/i);
    expect(() =>
      parseAndValidateCsv({
        bytes: new TextEncoder().encode(",revenue\n,2"),
        filename: "bad.csv",
        mediaType: "text/csv",
      }),
    ).toThrow();
    expect(() =>
      parseAndValidateCsv({
        bytes: new TextEncoder().encode("date,date\n2026-08-01,2"),
        filename: "bad.csv",
        mediaType: "text/csv",
      }),
    ).toThrow();
    expect(() =>
      parseAndValidateCsv({
        bytes: new Uint8Array(10 * 1024 * 1024 + 1),
        filename: "too-large.csv",
        mediaType: "text/csv",
      }),
    ).toThrow(/10 MiB/i);
  });

  it("only accepts CSV names and MIME and validates mappings without cell values", () => {
    expect(() =>
      parseAndValidateCsv({
        bytes: new TextEncoder().encode("date,revenue\n2026-08-01,2"),
        filename: "data.txt",
        mediaType: "text/plain",
      }),
    ).toThrow();
    expect(validateColumnMapping({ date: "date" }, ["date", "revenue"])).toEqual({
      date: "date",
    });
    expect(() => validateColumnMapping({ amount: "missing" }, ["date"])).toThrow();
    expect(() => validateColumnMapping({ amount: "date", extra: "date" }, ["date"])).toThrow();
    expect(() => validateColumnMapping({ amount: "date", token: "secret" }, ["date"])).toThrow();
    const malformed = parseAndValidateCsv({
      bytes: new TextEncoder().encode("date,revenue\n2026-08-01"),
      filename: "rows.csv",
      mediaType: "text/csv",
    });
    expect(malformed.errors).toEqual([{ row: 2, code: "COLUMN_COUNT_MISMATCH" }]);
    expect(JSON.stringify(malformed)).not.toContain("2026-08-01");
  });

  it("builds and validates a tenant-prefixed path while rejecting traversal", () => {
    const path = buildDataSourceStoragePath(organizationId, dataSourceId, uploadId, "sales Q3.csv");
    expect(path).toBe(`${organizationId}/${dataSourceId}/${uploadId}/sales-Q3.csv`);
    expect(validateDataSourceStoragePath(path, organizationId, dataSourceId)).toBe(true);
    expect(() =>
      validateDataSourceStoragePath(
        `${organizationId}/../${dataSourceId}/x/sales.csv`,
        organizationId,
        dataSourceId,
      ),
    ).toThrow();
    expect(() =>
      buildDataSourceStoragePath(organizationId, dataSourceId, uploadId, "../secrets.csv"),
    ).toThrow();
  });
});
