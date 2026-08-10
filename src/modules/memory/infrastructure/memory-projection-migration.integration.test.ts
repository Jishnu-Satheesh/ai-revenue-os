import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const databaseTestsDirectory = resolve(process.cwd(), "supabase/tests/database");

function projectionMigration(): string {
  const matches = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{14}_memory_projection\.sql$/.test(name))
    .sort();
  expect(matches).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]!), "utf8");
}

function projectionPgtapTest(): string {
  return readFileSync(
    resolve(databaseTestsDirectory, "business_memory_projection_test.sql"),
    "utf8",
  );
}

function runtimeRepairMigration(): string {
  const matches = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{14}_fix_memory_plpgsql_alias_conflicts\.sql$/.test(name))
    .sort();
  expect(matches).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]!), "utf8");
}

describe("Business Memory projection migration contract", () => {
  it("uses a service-role-only atomic tenant-scoped projection RPC", () => {
    const sql = projectionMigration();

    expect(sql).toContain("create unique index memory_items_open_fact_proposal_idx");
    expect(sql).toContain("nulls not distinct");
    expect(sql).toContain(
      "create or replace function public.project_google_business_profile_record",
    );
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("from public.integration_ingestion_runs");
    expect(sql).toContain("and run.connection_id = p_source_connection_id");
    expect(sql).toContain("on conflict (organization_id, source_system, source_record_id)");
    expect(sql).toContain("on conflict (organization_id, proposed_branch_id, proposed_fact_key)");
    expect(sql).toContain("revoke all on function public.project_google_business_profile_record");
    expect(sql).toContain(
      "grant execute on function public.project_google_business_profile_record",
    );
    expect(sql).toContain("to service_role");
  });

  it("collapses pre-existing duplicate open proposals before creating their unique index", () => {
    const sql = projectionMigration();

    // Ingestion predating this guard left several identical open proposals per
    // fact key, which made the index uncreatable. The backfill must stay ahead
    // of the index and in the same migration, or the push fails again on any
    // database that still holds duplicates.
    const backfillAt = sql.indexOf("update public.memory_items item");
    const indexAt = sql.indexOf("create unique index memory_items_open_fact_proposal_idx");
    expect(backfillAt).toBeGreaterThan(-1);
    expect(backfillAt).toBeLessThan(indexAt);

    expect(sql).toContain(
      "partition by organization_id, proposed_branch_id, proposed_fact_key",
    );
    expect(sql).toContain("order by created_at desc, id desc");
    // The correction is auditable: losing rows are rejected, never deleted.
    expect(sql).toContain("verification_state = 'rejected'");
    expect(sql).toContain("rejection_reason = 'Deduplicated:");
    expect(sql).not.toMatch(/delete\s+from\s+public\.memory_items/i);
  });

  it("counts its pgTAP assertions and resets human review only when provider content changes", () => {
    const sql = projectionMigration();

    const pgtap = projectionPgtapTest();
    expect(pgtap).toContain("select extensions.plan(12);");
    expect(pgtap.match(/extensions\.(?:lives_ok|is|throws_ok)\(/g)).toHaveLength(12);
    expect(pgtap).toContain("organization_id in (");
    expect(pgtap).toContain("'27000000-0000-4000-8000-000000000001'::uuid");
    expect(sql).toContain("verification_state = case");
    expect(sql).toContain("verified_by = case");
    expect(sql).toContain("verified_at = case");
    expect(sql).toContain("rejection_reason = case");
    expect(sql).toContain(
      "memory_items.structured_value is not distinct from excluded.structured_value",
    );
    expect(sql).toContain("then memory_items.verification_state else 'unverified' end");
  });

  it("sets a function-local column-precedence policy for the runtime projection alias collision", () => {
    const sql = runtimeRepairMigration();

    expect(sql).toContain("public.project_google_business_profile_record(uuid, uuid, uuid");
    expect(sql).toContain("pg_catalog.pg_get_functiondef(function_identifier)");
    expect(sql).toContain("#variable_conflict use_column");
    expect(sql).toContain("pg_catalog.chr(10)");
  });
});
