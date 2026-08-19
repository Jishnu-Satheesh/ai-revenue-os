import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `supabase gen types` needs Docker for both `--local` and `--db-url`, and this
 * project has no local database — only the hosted staging project. Nobody on
 * the team can regenerate `database.types.ts`, so CI cannot meaningfully demand
 * that the committed file equals generator output.
 *
 * These checks are the replacement. They run anywhere, need no database, and
 * catch the drift that actually costs: a migration adds a column to a table the
 * application already types, the type is not updated, and every query silently
 * loses the field.
 */

const MIGRATIONS_DIRECTORY = resolve(process.cwd(), "supabase/migrations");
const TYPES_FILE = resolve(process.cwd(), "src/lib/supabase/database.types.ts");

/**
 * Tables the application deliberately does not type. The Memory and Integration
 * modules predate the last regeneration and reach these through narrowed
 * repository helpers instead. Listing them makes the debt explicit: a new table
 * that is neither typed nor listed here fails the last check in this file, so
 * leaving one untyped becomes a decision rather than an oversight.
 */
const UNTYPED_TABLES = new Set([
  // Campaign results are written only by the collection worker through
  // record_campaign_metric_observation, which writes the value and the
  // observation in one transaction. A direct insert could leave a figure with
  // nothing pointing at it, or a gap recorded as a zero.
  "campaign_metric_observations",
  // Paid provider objects are written only by the ads adapter through
  // record_campaign_ads_object as each id is returned. Members read them; a
  // direct insert would defeat the resume-rather-than-duplicate guarantee.
  "campaign_ads_objects",
  // Exposures are written only by the dispatch worker through
  // record_campaign_exposure, which refuses any run the gateway has not
  // confirmed. Members read them through RLS; nothing writes one from a session.
  "campaign_exposures",
  // Inbound webhook deliveries are written only by the webhook route under the
  // service role, and read through the narrow contract in webhook-receipts.ts.
  // No session reaches them: a quarantined row has no tenant to scope it to.
  "provider_webhook_receipts",
  // Creative variants are written only through `append_campaign_creative_variant`,
  // which assigns the slot numbers under a lock, and read through the narrow
  // contract in `variant-repository.ts`. A generated row type would invite a
  // direct insert that skips the RPC and therefore skips the cap.
  "campaign_creative_variants",
  // The allocation loop's ledger, resumes, and pause-run substrate are written
  // only by security-definer RPCs (the loop, and the operator resume route), and
  // read through the narrow contract in `allocation-repository.ts` or the
  // read-only allocation route. A generated row type would imply a direct write
  // path that deliberately does not exist.
  "campaign_allocation_events",
  "campaign_variant_resumes",
  "campaign_pause_runs",
  // The evidence loop's verdict record is written only by the settlement
  // worker through settle_campaign_outcome, which enforces preregistration and
  // the settlement delay, and read through the read-only outcome route. A
  // generated row type would imply a direct write path that does not exist.
  "campaign_outcomes",
  // Decision persistence uses a deliberately narrow repository contract. The
  // browser can read only the opportunity feed projection, while the remaining
  // ledger tables are worker-only and reached through constrained RPCs.
  "artifact_promotions",
  "artifact_versions",
  "candidate_suppressions",
  "decision_candidates",
  "decision_cycles",
  "decision_feedback",
  "decision_records",
  "opportunities",
  "playbook_definitions",
  "playbook_versions",
  "integration_account_mappings",
  "integration_capability_grants",
  "integration_connections",
  "integration_data_source_operations",
  "integration_fixture_connect_operations",
  "integration_health_checks",
  "integration_ingestion_handoffs",
  "integration_ingestion_runs",
  "integration_mapping_operations",
  // Reached only through the security-definer start/consume RPCs. No browser
  // role holds a grant on it, so a generated row type would imply access that
  // deliberately does not exist.
  "integration_oauth_sessions",
  "integration_worker_execution_leases",
  "memory_embedding_batch_claims",
  "memory_embedding_leases",
  "memory_items",
  "memory_links",
  "memory_promotion_operations",
  "memory_proposal_rejection_operations",
  "memory_retrieval_log",
  "memory_write_operations",
  // Campaign persistence follows the same narrow-contract rule as decisions.
  // Members read safe projections through the repository; every write that
  // creates a version, records an attestation, or grants an approval goes
  // through a security-definer RPC, so a generated row type would imply a
  // direct write path that deliberately does not exist.
  "campaign_approvals",
  "campaign_assets",
  "campaign_briefs",
  "campaign_bundle_versions",
  "campaign_channel_actions",
  "campaign_creative_directions",
  "campaign_measurement_plans",
  "campaign_source_snapshots",
  "campaign_visual_attestations",
  "campaigns",
  "organization_brand_asset_versions",
  "organization_brand_assets",
  // The generation run ledger. Members read a safe projection through the
  // repository; every lifecycle write is worker-only through a security-definer
  // RPC, so a generated row type would imply a write path that does not exist.
  "campaign_generation_runs",
  // The execution ledger. Members read safe projections through the repository;
  // every claim, invocation, receipt, and reservation is written only by a
  // worker through a security-definer RPC, so a generated row type would imply
  // a direct write path that deliberately does not exist.
  "campaign_action_runs",
  "campaign_budget_reservations",
  "provider_receipts",
  "tool_invocations",
]);

/**
 * Private tables are deliberately absent from generated public Supabase row
 * types. Workers reach these ledgers only through security-definer RPCs; adding
 * one to the public type surface would falsely imply direct table access.
 */
const PRIVATE_RPC_ONLY_TABLES = new Set([
  "decision_cycle_operations",
  "integration_credentials",
  "tool_gateway_operations",
]);

const TABLE_LEVEL_KEYWORDS = new Set([
  "check",
  "constraint",
  "exclude",
  "foreign",
  "like",
  "partition",
  "primary",
  "unique",
]);

function readMigrationSchema(): Map<string, Set<string>> {
  const columnsByTable = new Map<string, Set<string>>();
  const files = readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIRECTORY, file), "utf8");

    const createStatements = sql.matchAll(
      /create table (?:if not exists )?public\.([a-z_]+)\s*\(([\s\S]*?)\n\);/g,
    );
    for (const [, table, body] of createStatements) {
      const columns = columnsByTable.get(table) ?? new Set<string>();
      for (const line of body.split("\n")) {
        const column = line.match(/^ {2}([a-z_][a-z0-9_]*)\s+\S/);
        if (column && !TABLE_LEVEL_KEYWORDS.has(column[1])) columns.add(column[1]);
      }
      columnsByTable.set(table, columns);
    }

    const alterStatements = sql.matchAll(/alter table (?:only )?public\.([a-z_]+)([\s\S]*?);/g);
    for (const [, table, body] of alterStatements) {
      const columns = columnsByTable.get(table);
      if (!columns) continue;
      for (const [, added] of body.matchAll(/add column (?:if not exists )?([a-z_][a-z0-9_]*)/g))
        columns.add(added);
      for (const [, dropped] of body.matchAll(/drop column (?:if exists )?([a-z_][a-z0-9_]*)/g))
        columns.delete(dropped);
    }
  }

  return columnsByTable;
}

function readTypedSchema(): Map<string, Set<string>> {
  const types = readFileSync(TYPES_FILE, "utf8");
  const tablesBlock = types.slice(types.indexOf("    Tables: {"), types.indexOf("    Views:"));

  const typedTables = new Map<string, Set<string>>();
  const entries = tablesBlock.matchAll(
    /^ {6}([a-z_]+): \{\n(?: {8}\/\*\*[\s\S]*?\*\/\n)? {8}Row: \{\n([\s\S]*?)\n {8}\};/gm,
  );
  for (const [, table, rowBody] of entries) {
    const fields = new Set<string>();
    for (const [, field] of rowBody.matchAll(/^ {10}([a-z_][a-z0-9_]*)[?]?:/gm)) fields.add(field);
    typedTables.set(table, fields);
  }

  return typedTables;
}

function readPrivateTables(): Set<string> {
  const tables = new Set<string>();
  for (const file of readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIRECTORY, file), "utf8");
    for (const [, table] of sql.matchAll(/create table private\.([a-z_]+)\s*\(/g)) {
      tables.add(table);
    }
  }
  return tables;
}

const migrationSchema = readMigrationSchema();
const typedSchema = readTypedSchema();
const privateTables = readPrivateTables();

describe("database.types.ts reflects the migrations", () => {
  it("parses both sides, so a silent parser failure cannot pass the suite", () => {
    expect(migrationSchema.size).toBeGreaterThan(20);
    expect(typedSchema.size).toBeGreaterThan(10);
    expect(migrationSchema.get("goals")).toContain("metric_key");
    expect(typedSchema.get("goals")).toContain("metric_key");
  });

  it("types every table it declares against a table that exists", () => {
    const unknown = [...typedSchema.keys()].filter((table) => !migrationSchema.has(table));
    expect(unknown).toEqual([]);
  });

  it.each([...typedSchema.keys()].sort())("types every column of %s", (table) => {
    const actual = migrationSchema.get(table);
    if (!actual) throw new Error(`${table} is typed but no migration creates it`);

    const missing = [...actual].filter((column) => !typedSchema.get(table)?.has(column)).sort();
    const surplus = [...(typedSchema.get(table) ?? [])]
      .filter((column) => !actual.has(column))
      .sort();

    expect({ missing, surplus }).toEqual({ missing: [], surplus: [] });
  });

  it("accounts for every table as either typed or explicitly untyped", () => {
    const unaccounted = [...migrationSchema.keys()]
      .filter((table) => !typedSchema.has(table) && !UNTYPED_TABLES.has(table))
      .sort();

    expect(unaccounted).toEqual([]);
  });

  it("keeps the untyped list honest by dropping entries that no longer exist", () => {
    const stale = [...UNTYPED_TABLES].filter((table) => !migrationSchema.has(table)).sort();
    expect(stale).toEqual([]);
  });

  it("records every private table as an RPC-only surface", () => {
    expect([...privateTables].sort()).toEqual([...PRIVATE_RPC_ONLY_TABLES].sort());
    expect(typedSchema.has("decision_cycle_operations")).toBe(false);
  });
});
