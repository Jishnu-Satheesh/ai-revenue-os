import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260807193344_guided_onboarding.sql",
);
const hardeningMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260807204220_harden_tenant_access.sql",
);
const databaseSecurityMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260808000000_database_security_and_indexes.sql",
);

describe("guided onboarding migration contract", () => {
  it("defines tenant-scoped control-plane tables and RLS", () => {
    const sql = readFileSync(migrationPath, "utf8");

    for (const table of [
      "onboarding_sessions",
      "onboarding_section_states",
      "onboarding_requests",
      "onboarding_uploads",
      "onboarding_extractions",
      "onboarding_extraction_candidates",
      "ai_readiness_assessments",
      "onboarding_idempotency_records",
    ]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`private.is_organization_member(organization_id)`);
    }
  });

  it("protects storage paths and uses a tenant-scoped idempotency key", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("onboarding-files");
    expect(sql).toContain("storage.foldername(name)");
    expect(sql).toContain("unique (organization_id, operation, idempotency_key)");
    expect(sql).toContain("to authenticated");
  });
});

describe("tenant access hardening migration", () => {
  it("uses the same privileged role check before and after tenant-owned updates", () => {
    const sql = readFileSync(hardeningMigrationPath, "utf8");

    for (const policy of [
      "authorized members can update organizations",
      "admins can update branches",
      "operators can update business profiles",
      "operators can update business facts",
      "admins can update goals",
      "admins can update constraints",
      "admins can update policies",
      "operators can update onboarding sessions",
      "operators can update onboarding section states",
      "operators can update onboarding requests",
      "operators can update onboarding uploads",
      "operators can update onboarding extractions",
      "operators can update onboarding candidates",
      "operators can update onboarding files",
    ]) {
      expect(sql).toContain(`drop policy if exists "${policy}"`);
    }
    expect(sql.match(/with check \(private\.has_organization_role/g)).toHaveLength(13);
    expect(sql).toMatch(/not exists\s*\(\s*select 1 from public\.organization_memberships/);
    expect(sql).toContain("with check (\n  bucket_id = 'onboarding-files'");
  });

  it("explicitly exposes only the required tables to authenticated clients", () => {
    const sql = readFileSync(hardeningMigrationPath, "utf8");

    expect(sql).toContain("grant usage on schema public to authenticated");
    expect(sql).not.toMatch(/grant .* to anon/);
    for (const table of [
      "profiles",
      "organizations",
      "organization_memberships",
      "branches",
      "business_profiles",
      "business_facts",
      "goals",
      "constraints",
      "policies",
      "audit_events",
      "onboarding_sessions",
      "onboarding_section_states",
      "onboarding_requests",
      "onboarding_uploads",
      "onboarding_extractions",
      "onboarding_extraction_candidates",
      "ai_readiness_assessments",
      "onboarding_idempotency_records",
    ]) {
      expect(sql).toContain(`public.${table}`);
    }
  });
});

describe("database security and index migration", () => {
  it("removes anonymous table privileges and fixes the timestamp trigger search path", () => {
    const sql = readFileSync(databaseSecurityMigrationPath, "utf8");

    expect(sql).toContain(
      "alter default privileges in schema public revoke all privileges on tables from anon",
    );
    expect(sql).toMatch(/revoke all privileges on table[\s\S]+from anon/);
    expect(sql).toContain("create or replace function public.set_updated_at()");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("pg_catalog.now()");
  });

  it("adds the composite indexes required by tenant-scoped foreign keys", () => {
    const sql = readFileSync(databaseSecurityMigrationPath, "utf8");

    expect(sql).toContain("on public.ai_readiness_assessments(organization_id, session_id)");
    expect(sql).toContain("on public.onboarding_requests(organization_id, session_id)");
    expect(sql).toContain("on public.onboarding_section_states(organization_id, session_id)");
    expect(sql).toContain("on public.onboarding_uploads(organization_id, session_id)");
    expect(sql).toContain("on public.goals(organization_id, scope_branch_id)");
  });
});
