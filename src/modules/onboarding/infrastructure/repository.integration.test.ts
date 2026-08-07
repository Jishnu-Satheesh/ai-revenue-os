import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260807193344_guided_onboarding.sql",
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
