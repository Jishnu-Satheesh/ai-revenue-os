import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PROVIDER_REPORT_DEFINITIONS } from "@/domain/reports/provider-library";
import { buildGuidedContractDocument } from "@/domain/reports/guided-mapping";

/**
 * The database has to know every key a contract can carry.
 *
 * `private.assert_report_contract_document` validates by allow-list, and an
 * allow-list that has not been told about a key does not ignore it — it refuses
 * the whole document. So a key added to `reportContractDocumentSchema` and not
 * to the validator does not degrade anything: it closes the intake path for
 * every mapping that uses it, which is what happened to all five provider
 * definitions and the guided questionnaire at once.
 *
 * Nothing about that failure is visible in TypeScript. The schema parses, the
 * definitions load, the tests pass, and the refusal arrives from Postgres at
 * the moment an operator clicks approve. This test is the only place the two
 * halves are compared.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const VALIDATOR = "create or replace function private.assert_report_contract_document";

/** The live body is the newest migration that replaces the function. */
function liveValidatorSource(): string {
  const owning = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => readFileSync(join(MIGRATIONS, name), "utf8").includes(VALIDATOR))
    .sort();
  expect(owning.length).toBeGreaterThan(0);
  return readFileSync(join(MIGRATIONS, owning[owning.length - 1] as string), "utf8");
}

/**
 * Every `key not in (...)` list in the validator, as sets.
 *
 * Matched by a key only that list can contain rather than by position, so
 * reordering the checks inside the function does not silently repoint a level
 * at the wrong allow-list.
 */
function allowLists(source: string): Set<string>[] {
  return [...source.matchAll(/key not in \(([^)]*)\)/g)].map(
    (match) => new Set([...(match[1] as string).matchAll(/'([^']+)'/g)].map((k) => k[1] as string)),
  );
}

function listContaining(lists: Set<string>[], marker: string): Set<string> {
  const found = lists.filter((list) => list.has(marker));
  expect(found, `exactly one allow-list should contain ${marker}`).toHaveLength(1);
  return found[0] as Set<string>;
}

function listExactly(lists: Set<string>[], keys: string[]): Set<string> {
  const found = lists.filter(
    (list) => list.size === keys.length && keys.every((key) => list.has(key)),
  );
  expect(found, `exactly one allow-list should be ${keys.join("+")}`).toHaveLength(1);
  return found[0] as Set<string>;
}

const lists = allowLists(liveValidatorSource());
const documentKeys = listContaining(lists, "schemaVersion");
const sheetKeys = listContaining(lists, "headerRow");
const fieldKeys = listContaining(lists, "parser");
const totalsRowKeys = listExactly(lists, ["canonicalField", "label"]);
const locatorKeys = listExactly(lists, ["kind", "position"]);

function unknownKeys(document: unknown): string[] {
  const contract = document as {
    sheets: Array<{
      sheetLocator?: Record<string, unknown>;
      totalsRow?: Record<string, unknown>;
      fields: Array<Record<string, unknown>>;
    }>;
  };
  const rejected: string[] = [];
  const check = (value: Record<string, unknown>, allowed: Set<string>, level: string) => {
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) rejected.push(`${level}.${key}`);
    }
  };

  check(document as Record<string, unknown>, documentKeys, "document");
  for (const sheet of contract.sheets) {
    check(sheet as unknown as Record<string, unknown>, sheetKeys, "sheet");
    if (sheet.sheetLocator) check(sheet.sheetLocator, locatorKeys, "sheetLocator");
    if (sheet.totalsRow) check(sheet.totalsRow, totalsRowKeys, "totalsRow");
    for (const field of sheet.fields) check(field, fieldKeys, "field");
  }
  return [...new Set(rejected)];
}

/** Carries every optional key the guided path can produce. */
const guidedContract = buildGuidedContractDocument({
  answers: {
    normalizedSheetName: "sales",
    headerRow: 1,
    periodColumn: { sourceHeader: "business_date", encoding: "day_month" },
    salesColumn: "net_sales",
    ordersColumn: "orders",
    totalsRow: { sourceHeader: "branch_name", label: "Total" },
    absentMarkers: ["-"],
  },
  declaredCurrency: "AED",
});

describe("the database admits every contract the platform can propose", () => {
  it("reads an allow-list for each level of the document", () => {
    // A locator that reads by name carries only `kind`, so its own list is a
    // subset of the position one and is not matched separately.
    expect(documentKeys.has("sheets")).toBe(true);
    expect(sheetKeys.has("fields")).toBe(true);
    expect(fieldKeys.has("canonicalField")).toBe(true);
  });

  it.each(PROVIDER_REPORT_DEFINITIONS.map((definition) => [definition.key, definition] as const))(
    "%s uses no key the database would refuse",
    (_key, definition) => {
      expect(unknownKeys(definition.contract)).toEqual([]);
    },
  );

  it("a guided mapping uses no key the database would refuse", () => {
    expect(unknownKeys(guidedContract)).toEqual([]);
  });
});

/**
 * The same agreement, for the declaration that says what gets recorded.
 *
 * The guard above was written after an unknown contract key closed the intake
 * path for every mapping at once. The projection document had no equivalent,
 * so a key added to `reportProjectionOutputSchema` and not to
 * `private.assert_report_projection_document` reproduced the identical failure
 * one step later: every test green, and Postgres refusing the approval.
 */
const PROJECTION_VALIDATOR = "create or replace function private.assert_report_projection_document";

function liveProjectionValidatorSource(): string {
  const owning = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => readFileSync(join(MIGRATIONS, name), "utf8").includes(PROJECTION_VALIDATOR))
    .sort();
  expect(owning.length).toBeGreaterThan(0);
  return readFileSync(join(MIGRATIONS, owning[owning.length - 1] as string), "utf8");
}

const projectionLists = allowLists(liveProjectionValidatorSource());
// Matched on keys only these lists can hold. `metricKey` alone is ambiguous:
// the completion fence in the same migration checks an emitted observation,
// which carries `metricKey` and `canonicalField` too.
const outputKeys = listContaining(projectionLists, "aggregation");
const categoricalKeys = listContaining(projectionLists, "collectInjectedValues");

function unknownProjectionKeys(document: unknown): string[] {
  const projection = document as {
    outputs: Array<Record<string, unknown> & { categorical?: Record<string, unknown> }>;
  };
  const rejected: string[] = [];
  for (const output of projection.outputs) {
    for (const key of Object.keys(output)) {
      if (!outputKeys.has(key)) rejected.push(`output.${key}`);
    }
    if (output.categorical) {
      for (const key of Object.keys(output.categorical)) {
        if (!categoricalKeys.has(key)) rejected.push(`categorical.${key}`);
      }
    }
  }
  return [...new Set(rejected)];
}

describe("the database admits every projection the platform can propose", () => {
  it("reads an allow-list for the output and its categorical block", () => {
    expect(outputKeys.has("canonicalField")).toBe(true);
    expect(categoricalKeys.has("allowedValues")).toBe(true);
  });

  it("admits every key an output may carry, including the ones nothing uses yet", () => {
    // Checking only the shipped definitions would pass while a capability sat
    // unusable, because a definition that has not adopted a key cannot reveal
    // that the database would refuse it.
    expect(outputKeys.has("sumWith")).toBe(true);
    expect(outputKeys.has("convert")).toBe(true);
    expect(outputKeys.has("signConvention")).toBe(true);
  });

  it.each(PROVIDER_REPORT_DEFINITIONS.map((definition) => [definition.key, definition] as const))(
    "%s projects with no key the database would refuse",
    (_key, definition) => {
      expect(unknownProjectionKeys(definition.projection)).toEqual([]);
    },
  );
});
