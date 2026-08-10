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

function runtimeRepairMigration(): string {
  const matches = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{14}_fix_memory_plpgsql_alias_conflicts\.sql$/.test(name))
    .sort();
  expect(matches).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]!), "utf8");
}

function operationLedgerRlsMigration(): string {
  const matches = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{14}_memory_operation_ledger_rls\.sql$/.test(name))
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

  it("repairs the promotion and rejection RPC alias collisions without widening grants", () => {
    const sql = runtimeRepairMigration();

    expect(sql).toContain("public.confirm_memory_fact_proposal(uuid, uuid, uuid, boolean");
    expect(sql).toContain("public.reject_memory_proposal(uuid, uuid, uuid, text");
    expect(sql).toContain("pg_catalog.pg_get_functiondef(function_identifier)");
    expect(sql).toContain("#variable_conflict use_column");
    expect(sql).not.toContain("grant execute");
  });

  it("keeps private operation ledgers RLS-enabled without forcing definer RPCs through empty policies", () => {
    const sql = operationLedgerRlsMigration();

    expect(sql).toContain("alter table public.memory_write_operations no force row level security");
    expect(sql).toContain(
      "alter table public.memory_promotion_operations no force row level security",
    );
    expect(sql).toContain(
      "alter table public.memory_proposal_rejection_operations no force row level security",
    );
    expect(sql).toContain(
      "revoke all on table public.memory_write_operations from public, anon, authenticated",
    );
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
    expect(rlsPgtap).toContain("direct REST cannot create a governed memory item");
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

  it("uses the extension-qualified digest and verifies current access before every replay response", () => {
    const sql = authenticatedWriteMigration();
    const pgtap = readFileSync(
      resolve(databaseTestsDirectory, "business_memory_write_test.sql"),
      "utf8",
    );

    expect(sql).toContain("extensions.digest");
    expect(sql).not.toContain("pg_catalog.digest");
    expect(sql).toContain("select * into created from public.memory_items");
    expect(sql).toContain("select * into updated from public.memory_items");
    expect(sql).toContain("select * into original from public.memory_items");
    expect(sql).toContain("replay is not authorized");
    expect(pgtap).toContain("legacy supersede RPC executes with extensions.digest");
    expect(pgtap).toContain("an operator cannot replay an admin confidential create");
    expect(pgtap).toContain("a same-org operator can replay an allowed known key");
    expect(pgtap).toContain("an operator cannot replay a confidential update");
    expect(pgtap).toContain("an operator cannot replay a confidential supersede");
  });

  it("checks the stored update snapshot sensitivity before returning a replay", () => {
    const sql = authenticatedWriteMigration();
    const pgtap = readFileSync(
      resolve(databaseTestsDirectory, "business_memory_write_test.sql"),
      "utf8",
    );

    expect(sql).toContain("operation.response -> 'item' ->> 'sensitivity'");
    expect(sql).toContain("memory write replay is not authorized");
    expect(pgtap).toContain(
      "an operator cannot replay a confidential update snapshot after the row is lowered without requesting sensitivity",
    );
  });

  it("fails closed when a stored update replay response does not identify the requested item", () => {
    const sql = authenticatedWriteMigration();
    const updateFunction = sql.slice(
      sql.indexOf("create or replace function public.update_authenticated_memory_item"),
      sql.indexOf("-- The previous eight-argument function remains"),
    );
    const pgtap = readFileSync(
      resolve(databaseTestsDirectory, "business_memory_write_test.sql"),
      "utf8",
    );

    expect(updateFunction).toContain("if not coalesce(");
    expect(updateFunction).toContain(
      "pg_catalog.jsonb_typeof(operation.response -> 'item') = 'object'",
    );
    expect(updateFunction).toContain("p_item_id::text");
    expect(updateFunction).toContain("p_organization_id::text");
    expect(updateFunction).toContain("'public', 'internal', 'confidential', 'customer_content'");
    expect(updateFunction).toContain("memory write replay response is invalid");
    expect(updateFunction).toContain(
      "return operation.response || pg_catalog.jsonb_build_object('replayed', true)",
    );
    expect(pgtap).toContain("an operator cannot replay an update with an absent stored item");
    expect(pgtap).toContain("an operator cannot replay an update with a null stored item");
    expect(pgtap).toContain("an operator cannot replay an update with a non-object stored item");
    expect(pgtap).toContain("an operator cannot replay an update with a mismatched stored item ID");
    expect(pgtap).toContain(
      "an operator cannot replay an update with a mismatched stored organization ID",
    );
    expect(pgtap).toContain(
      "an operator cannot replay an update with an unknown stored sensitivity",
    );
  });

  it("allows only the invocation that claims an empty operation to mutate", () => {
    const sql = authenticatedWriteMigration();
    const createFunction = sql.slice(
      sql.indexOf("create or replace function public.create_authenticated_memory_item"),
      sql.indexOf("create or replace function public.update_authenticated_memory_item"),
    );
    const updateFunction = sql.slice(
      sql.indexOf("create or replace function public.update_authenticated_memory_item"),
      sql.indexOf("-- The previous eight-argument function remains"),
    );
    const supersedeFunction = sql.slice(
      sql.indexOf("create or replace function public.supersede_memory_item"),
      sql.indexOf("revoke all on function public.create_authenticated_memory_item"),
    );
    const pgtap = readFileSync(
      resolve(databaseTestsDirectory, "business_memory_write_test.sql"),
      "utf8",
    );

    for (const operationFunction of [createFunction, updateFunction, supersedeFunction]) {
      expect(operationFunction).toContain("claimed_operation boolean := false");
      expect(operationFunction).toContain("returning true into claimed_operation");
      expect(operationFunction).toContain(
        "if operation.response = '{}'::jsonb and not coalesce(claimed_operation, false) then",
      );
    }
    expect(
      createFunction.indexOf(
        "if operation.response = '{}'::jsonb and not coalesce(claimed_operation, false) then",
      ),
    ).toBeLessThan(createFunction.indexOf("insert into public.memory_items (organization_id"));
    expect(
      updateFunction.indexOf(
        "if operation.response = '{}'::jsonb and not coalesce(claimed_operation, false) then",
      ),
    ).toBeLessThan(updateFunction.indexOf("update public.memory_items set"));
    expect(
      supersedeFunction.indexOf(
        "if operation.response = '{}'::jsonb and not coalesce(claimed_operation, false) then",
      ),
    ).toBeLessThan(supersedeFunction.indexOf("insert into public.memory_items (organization_id"));
    expect(updateFunction).toContain("memory write operation is incomplete");
    expect(updateFunction).toContain(
      "return operation.response || pg_catalog.jsonb_build_object('replayed', true)",
    );
    expect(pgtap).toContain("a matching pre-existing empty update operation fails closed");
    expect(pgtap).toContain(
      "a valid update replay returns replay metadata without exposing its ledger row",
    );
    expect(pgtap).toContain(
      "a valid update replay does not emit a duplicate verification audit action",
    );
  });
});
