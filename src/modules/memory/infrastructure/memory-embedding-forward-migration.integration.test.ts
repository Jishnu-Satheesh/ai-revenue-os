import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const databaseTestsDirectory = resolve(process.cwd(), "supabase/tests/database");

function forwardMigration(): string {
  const matches = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{14}_memory_projection_embedding_reset\.sql$/.test(name))
    .sort();
  expect(matches).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]!), "utf8");
}

function embeddingLeaseMigration(): string {
  const matches = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{14}_memory_embedding_leases\.sql$/.test(name))
    .sort();
  expect(matches).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]!), "utf8");
}

function memoryItemRevisionMigration(): string {
  const matches = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{14}_memory_item_revision\.sql$/.test(name))
    .sort();
  expect(matches).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]!), "utf8");
}

describe("Business Memory forward embedding migrations", () => {
  it("resets the vector state only when a Google Business Profile episode projection changes", () => {
    const sql = forwardMigration();

    expect(sql).toContain(
      "create or replace function public.project_google_business_profile_record",
    );
    expect(sql).toContain("then memory_items.embedding else null end");
    expect(sql).toContain("then memory_items.embedding_model else null end");
    expect(sql).toContain("then memory_items.embedding_status else 'pending' end");
    expect(sql).toContain("then memory_items.embedding_updated_at else null end");
    expect(sql).toContain("then memory_items.verification_state else 'unverified' end");
  });

  it("adds runtime coverage for projection reset and rejects null RPC inputs", () => {
    const pgtap = readFileSync(
      resolve(databaseTestsDirectory, "business_memory_projection_test.sql"),
      "utf8",
    );
    const leasePgtap = readFileSync(
      resolve(databaseTestsDirectory, "business_memory_embedding_lease_test.sql"),
      "utf8",
    );

    expect(pgtap).toContain("select extensions.plan(12);");
    expect(pgtap).toContain("changed projection clears a ready embedding for reprocessing");
    expect(leasePgtap).toContain("claim rejects a null batch limit");
    expect(leasePgtap).toContain("ready completion rejects a null embedding timestamp");
    expect(leasePgtap).toContain("select extensions.plan(17);");
    expect(leasePgtap).toContain("a stale item completion returns false rather than null");
    expect(leasePgtap).toContain("a stale batch completion returns false rather than null");
    expect(leasePgtap).toContain(
      "a content update advances the claimed item revision in one transaction",
    );
    expect(leasePgtap).toContain(
      "a foreign active batch owner is distinguishable from a completed replay",
    );
  });

  it("rejects null lease RPC inputs before they can weaken bounded work or terminal writes", () => {
    const sql = embeddingLeaseMigration();

    expect(sql).toContain("p_limit is null or p_limit < 1 or p_limit > 64");
    expect(sql).toContain("p_embedding_updated_at is null");
    expect(sql).toContain("return coalesce(completed, false);");
    expect(sql).toContain("get_memory_embedding_batch_state");
  });

  it("uses a memory-items-only strictly increasing revision trigger", () => {
    const sql = memoryItemRevisionMigration();

    expect(sql).toContain("create or replace function public.set_memory_item_updated_at");
    expect(sql).toContain("new.updated_at = pg_catalog.greatest(");
    expect(sql).toContain(
      "pg_catalog.clock_timestamp(), old.updated_at + interval '1 microsecond'",
    );
    expect(sql).toContain(
      "drop trigger if exists memory_items_set_updated_at on public.memory_items",
    );
    expect(sql).toContain("create trigger memory_items_set_updated_at");
  });
});
