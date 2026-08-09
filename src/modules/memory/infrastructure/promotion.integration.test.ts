import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const databaseTestsDirectory = resolve(process.cwd(), "supabase/tests/database");

function promotionMigration(): string {
  const matches = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{14}_memory_promotion_operations\.sql$/.test(name))
    .sort();
  expect(matches).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]!), "utf8");
}

function authenticatedWriteMigration(): string {
  const matches = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{14}_memory_authenticated_write_operations\.sql$/.test(name))
    .sort();
  expect(matches).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]!), "utf8");
}

describe("Business Memory proposal-promotion migration contract", () => {
  it("uses a locked authenticated security-definer operation with tenant-scoped idempotency", () => {
    const sql = promotionMigration();

    expect(sql).toContain("create table public.memory_promotion_operations");
    expect(sql).toContain("create table public.memory_proposal_rejection_operations");
    expect(sql).toContain("unique (organization_id, idempotency_key)");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("revoke all on table public.memory_promotion_operations");
    expect(sql).toContain("create or replace function public.confirm_memory_fact_proposal");
    expect(sql).toContain("create or replace function public.reject_memory_proposal");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("(select auth.uid()) <> p_actor_id");
    expect(sql).toContain("private.has_organization_role");
    expect(sql).toContain("proposal.sensitivity in ('confidential', 'customer_content')");
    expect(sql).toContain("for update");
    expect(sql).toContain("request_fingerprint");
    expect(sql).toContain("'replayed', true");
    expect(sql).toContain("'replayed', false");
    expect(sql).toContain("revoke all on function public.confirm_memory_fact_proposal");
    expect(sql).toContain(
      "create or replace function private.guard_authenticated_memory_item_transition",
    );
    expect(sql).toContain("current_user = 'authenticated'");
    expect(sql).toContain("to authenticated");
  });

  it("keeps fact promotion, proposal verification, and safe auditing inside one operation", () => {
    const sql = promotionMigration();

    expect(sql).toContain("from public.memory_items proposal");
    expect(sql).toContain("from public.business_facts existing_fact");
    expect(sql).toContain("override_verified");
    expect(sql).toContain("status = 'verified'::public.digital_twin_fact_status");
    expect(sql).toContain("updated_by = p_actor_id");
    expect(sql).toContain("verification_state = 'verified'");
    expect(sql).toContain("'memory.fact_promoted'");
    expect(sql).toContain("app.memory_promotion_force_failure");
  });

  it("adds pgTAP coverage for isolation, rollback, idempotency, and verified-fact overrides", () => {
    const pgtap = readFileSync(
      resolve(databaseTestsDirectory, "business_memory_write_test.sql"),
      "utf8",
    );

    expect(pgtap).toContain("confirm_memory_fact_proposal");
    expect(pgtap).toContain("promotion rolls back the fact and proposal together");
    expect(pgtap).toContain("replaying a promotion does not write a second fact");
    expect(pgtap).toContain("a viewer cannot promote a fact proposal");
    expect(pgtap).toContain("cannot promote another organization fact proposal");
    expect(pgtap).toContain("an explicit override can replace a verified fact");

    const rlsPgtap = readFileSync(
      resolve(databaseTestsDirectory, "business_memory_rls_test.sql"),
      "utf8",
    );
    expect(rlsPgtap).toContain("direct REST cannot verify a fact proposal");
    expect(rlsPgtap).toContain("direct REST cannot forge a verification actor");
    expect(rlsPgtap).toContain("direct REST cannot reject a proposal without a governed reason");
  });

  it("adds authenticated create/update RPCs without reopening direct table writes", () => {
    const sql = authenticatedWriteMigration();
    const pgtap = readFileSync(
      resolve(databaseTestsDirectory, "business_memory_write_test.sql"),
      "utf8",
    );

    expect(sql).toContain("create or replace function public.create_authenticated_memory_item");
    expect(sql).toContain("create or replace function public.update_authenticated_memory_item");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("(select auth.uid()) <> p_actor_id");
    expect(sql).toContain("private.has_organization_role");
    expect(sql).toContain("memory_write_operations");
    expect(sql).toContain("revoke insert, update on table public.memory_items from authenticated");
    expect(sql).toContain("for update");
    expect(sql).toContain("p_correlation_id");
    expect(sql).toContain("revoke all on function public.create_authenticated_memory_item");
    expect(sql).toContain("revoke all on function public.update_authenticated_memory_item");
    expect(sql).toContain("to authenticated");
    expect(pgtap).toContain("create_authenticated_memory_item");
    expect(pgtap).toContain("update_authenticated_memory_item");
    expect(pgtap).toContain("replaying an authenticated memory create does not duplicate the item");
    expect(pgtap).toContain("a reused authenticated memory write key conflicts");
    expect(pgtap).toContain("direct REST cannot create a governed memory item");
  });

  it("keeps fact proposals and existing sensitive rows behind their dedicated governance paths", () => {
    const sql = authenticatedWriteMigration();
    const pgtap = readFileSync(
      resolve(databaseTestsDirectory, "business_memory_write_test.sql"),
      "utf8",
    );

    expect(sql).toContain("updated.memory_type = 'fact_proposal'");
    expect(sql).toContain("original.sensitivity in ('confidential', 'customer_content')");
    expect(sql).toContain("updated.sensitivity in ('confidential', 'customer_content')");
    expect(pgtap).toContain("generic PATCH cannot verify a fact proposal");
    expect(pgtap).toContain("generic PATCH cannot reject a fact proposal");
    expect(pgtap).toContain("an operator cannot update a confidential item by UUID");
    expect(pgtap).toContain("an operator cannot supersede a confidential item by UUID");
  });

  it("replays legacy supersede operations without exposing their stored fingerprint", () => {
    const sql = authenticatedWriteMigration();
    const pgtap = readFileSync(
      resolve(databaseTestsDirectory, "business_memory_write_test.sql"),
      "utf8",
    );

    expect(sql).toContain("legacy_fingerprint");
    expect(sql).toContain("operation.response ? 'fingerprint'");
    expect(sql).toContain("pg_catalog.jsonb_build_object('replacementId'");
    expect(pgtap).toContain("a matching legacy supersede operation replays safely");
    expect(pgtap).toContain("a mismatched legacy supersede request conflicts");
  });
});
