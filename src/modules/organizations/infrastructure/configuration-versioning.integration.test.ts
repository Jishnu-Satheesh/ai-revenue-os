import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260810120000_decision_engine_configuration_versioning.sql",
);

const sql = readFileSync(migrationPath, "utf8");

describe("decision engine configuration versioning migration", () => {
  it("enforces one active policy version per organization and type", () => {
    expect(sql).toContain("create unique index policies_one_active_version_idx");
    expect(sql).toMatch(
      /create unique index policies_one_active_version_idx\s+on public\.policies \(organization_id, policy_type\)\s+where is_active;/,
    );
  });

  it("retires pre-existing duplicate active policy versions before adding the index", () => {
    const backfillAt = sql.indexOf("update public.policies as stale");
    const indexAt = sql.indexOf("create unique index policies_one_active_version_idx");
    expect(backfillAt).toBeGreaterThan(-1);
    expect(indexAt).toBeGreaterThan(backfillAt);
  });

  it("registers core subject kinds as shared read-only vocabulary", () => {
    expect(sql).toContain("create table public.subject_kinds");
    for (const kind of ["organization", "branch", "channel"]) {
      expect(sql).toContain(`('${kind}',`);
    }
    expect(sql).toContain("alter table public.subject_kinds enable row level security");
    expect(sql).toContain("grant select on table public.subject_kinds to authenticated");
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*public\.subject_kinds/);
  });

  it("versions and effective-dates constraints against a stable key", () => {
    for (const column of [
      "add column constraint_key text",
      "add column scope_kind text not null default 'organization' references public.subject_kinds(key)",
      "add column version integer not null default 1",
      "add column effective_from date not null default current_date",
      "add column effective_to date",
      "add column superseded_by_id uuid references public.constraints(id)",
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain("alter column constraint_key set not null");
  });

  it("enforces one active constraint version per key and scope", () => {
    expect(sql).toContain("create unique index constraints_one_active_version_idx");
    expect(sql).toMatch(/constraints_one_active_version_idx[\s\S]*?where is_active;/);
    expect(sql).toContain("create unique index constraints_version_idx");
  });

  it("keeps scope references consistent with their scope kind", () => {
    expect(sql).toContain("constraints_scope_ref_matches_kind");
    expect(sql).toContain("constraints_effective_window");
    expect(sql).toContain("constraints_supersede_not_self");
  });

  it("names supersession distinctly from creation in the audit trail", () => {
    expect(sql).toContain("'constraint.superseded'");
    expect(sql).toContain("'policy.superseded'");
    expect(sql).toContain("'constraint.created'");
  });

  it("retires the incumbent before inserting a successor in both write paths", () => {
    const policyFunction = sql.slice(
      sql.indexOf("create or replace function public.save_policy_version"),
      sql.indexOf("create or replace function public.save_constraint_version"),
    );
    expect(policyFunction.indexOf("update public.policies")).toBeGreaterThan(-1);
    expect(policyFunction.indexOf("insert into public.policies")).toBeGreaterThan(
      policyFunction.indexOf("update public.policies"),
    );

    const constraintFunction = sql.slice(
      sql.indexOf("create or replace function public.save_constraint_version"),
    );
    const retireAt = constraintFunction.indexOf("set is_active = false");
    const insertAt = constraintFunction.indexOf("insert into public.constraints");
    expect(retireAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(retireAt);
  });

  it("restricts superseding an in-force constraint to admins", () => {
    expect(sql).toContain("constraint_supersede_forbidden");
    expect(sql).toContain("policy_write_forbidden");
    expect(sql).toContain("constraint_write_forbidden");
  });

  it("grants execute on both write paths to authenticated callers only", () => {
    expect(sql).toContain("revoke all on function public.save_policy_version");
    expect(sql).toContain("grant execute on function public.save_policy_version");
    expect(sql).toContain("revoke all on function public.save_constraint_version");
    expect(sql).toContain("grant execute on function public.save_constraint_version");
  });
});
