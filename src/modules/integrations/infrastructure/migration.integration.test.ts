import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const integrationMigrationNames = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{14}_integration_hub\.sql$/.test(name))
  .sort();

function readIntegrationMigration() {
  expect(
    integrationMigrationNames,
    "create the Integration Hub migration with `supabase migration new integration_hub`",
  ).toHaveLength(1);

  return readFileSync(resolve(migrationsDirectory, integrationMigrationNames[0]!), "utf8");
}

const tenantTables = [
  "integration_connections",
  "integration_capability_grants",
  "integration_account_mappings",
  "integration_data_sources",
  "integration_ingestion_runs",
  "integration_health_checks",
] as const;

describe("Integration Hub migration contract", () => {
  it("is created by the Supabase CLI and defines all six tenant tables", () => {
    const sql = readIntegrationMigration();

    for (const table of tenantTables) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toMatch(
        new RegExp(
          `create table public\\.${table} \\([\\s\\S]*?organization_id uuid not null[\\s\\S]*?unique \\(organization_id, id\\)[\\s\\S]*?\\);`,
        ),
      );
    }
  });

  it("enforces bounded state, non-negative counts, source XOR, and tenant-safe relationships", () => {
    const sql = readIntegrationMigration();

    expect(sql).toContain("unique (organization_id, provider_key, external_account_id)");
    expect(sql).toContain("unique (organization_id, connection_id, capability_key)");
    expect(sql).toContain("unique (organization_id, connection_id, external_resource_id)");
    expect(sql).toContain("unique (organization_id, idempotency_key)");
    expect(sql).toContain("check ((connection_id is not null) <> (data_source_id is not null))");
    expect(sql).toMatch(
      /records_received integer not null default 0 check \(records_received >= 0\)/,
    );
    expect(sql).toMatch(
      /records_accepted integer not null default 0 check \(records_accepted >= 0\)/,
    );
    expect(sql).toMatch(
      /records_rejected integer not null default 0 check \(records_rejected >= 0\)/,
    );
    expect(sql).toMatch(/latency_ms integer check \(latency_ms is null or latency_ms >= 0\)/);
    expect(sql).toContain(
      "foreign key (organization_id, branch_id) references public.branches(organization_id, id)",
    );
    expect(sql).toContain(
      "foreign key (organization_id, connection_id) references public.integration_connections(organization_id, id)",
    );
    expect(sql).toContain(
      "foreign key (organization_id, data_source_id) references public.integration_data_sources(organization_id, id)",
    );
    expect(sql).toContain(
      "foreign key (organization_id, ingestion_run_id) references public.integration_ingestion_runs(organization_id, id)",
    );
  });

  it("adds query-shaped and foreign-key indexes", () => {
    const sql = readIntegrationMigration();

    for (const indexDefinition of [
      "on public.integration_connections(organization_id, status, updated_at desc)",
      "on public.integration_connections(created_by)",
      "on public.integration_capability_grants(organization_id, connection_id)",
      "on public.integration_account_mappings(organization_id, connection_id)",
      "on public.integration_account_mappings(organization_id, branch_id)",
      "on public.integration_account_mappings(created_by)",
      "on public.integration_data_sources(organization_id, branch_id)",
      "on public.integration_data_sources(created_by)",
      "on public.integration_ingestion_runs(organization_id, connection_id)",
      "on public.integration_ingestion_runs(organization_id, data_source_id)",
      "on public.integration_ingestion_runs(organization_id, status, created_at desc)",
      "on public.integration_ingestion_runs(organization_id, created_at desc)",
      "on public.integration_health_checks(organization_id, connection_id, checked_at desc)",
      "on public.integration_health_checks(organization_id, ingestion_run_id)",
    ]) {
      expect(sql).toContain(indexDefinition);
    }

    expect(sql).toMatch(
      /on public\.integration_connections\(organization_id, updated_at desc\)\s+where status = 'active'/,
    );
    expect(sql).toMatch(
      /on public\.integration_ingestion_runs\(organization_id, created_at desc\)\s+where status in \('queued', 'running'\)/,
    );
  });

  it("forces RLS, grants no anonymous access, and keeps health history append-only", () => {
    const sql = readIntegrationMigration();

    for (const table of tenantTables) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`alter table public.${table} force row level security`);
      expect(sql).toMatch(
        new RegExp(`revoke all privileges on table public\\.${table} from anon, authenticated`),
      );
      expect(sql).toContain(`on public.${table} for select to authenticated`);
      expect(sql).toContain("private.is_organization_member(organization_id)");
    }

    expect(sql).toContain(
      "grant select, insert on table public.integration_health_checks to authenticated",
    );
    const connectionSelectGrant = sql.match(
      /grant select \(([\s\S]*?)\) on table public\.integration_connections to authenticated/,
    );
    const connectionInsertGrant = sql.match(
      /grant insert \(([\s\S]*?)\) on table public\.integration_connections to authenticated/,
    );
    expect(connectionSelectGrant?.[1]).toContain("external_account_label");
    expect(connectionSelectGrant?.[1]).not.toContain("credential_reference");
    expect(connectionInsertGrant?.[1]).not.toContain("credential_reference");
    expect(sql).not.toMatch(
      /grant [^;]*(?:update|delete)[^;]*integration_health_checks[^;]* to authenticated/i,
    );
    expect(sql).not.toMatch(
      /on public\.integration_health_checks for (?:update|delete) to authenticated/,
    );
    expect(sql).toMatch(/for update to authenticated[\s\S]+using \([\s\S]+with check \(/);
  });

  it("audits mutable integration state without auditing append-only health details", () => {
    const sql = readIntegrationMigration();

    for (const table of [
      "integration_connections",
      "integration_capability_grants",
      "integration_account_mappings",
      "integration_data_sources",
      "integration_ingestion_runs",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `create trigger ${table}_audit after insert or update on public\\.${table}[\\s\\S]+private\\.audit_organization_change\\(\\)`,
        ),
      );
    }
    expect(sql).not.toContain("create trigger integration_health_checks_audit");
  });

  it("creates a private CSV-only import bucket with tenant-prefixed policies", () => {
    const sql = readIntegrationMigration();

    expect(sql).toContain("'integration-imports'");
    expect(sql).toContain("public = excluded.public");
    expect(sql).toContain("file_size_limit = excluded.file_size_limit");
    expect(sql).toContain("allowed_mime_types = excluded.allowed_mime_types");
    expect(sql).toContain("10485760");
    expect(sql).toContain("array['text/csv']::text[]");
    expect(sql).toContain("(storage.foldername(name))[1]");
    expect(sql).toContain("(storage.foldername(name))[2]");
    expect(sql).toContain("(storage.foldername(name))[3]");
    expect(sql).toContain("source.source_type = 'csv_import'");
    expect(sql).toContain("private.is_organization_member");
    expect(sql).toContain("private.has_organization_role");

    for (const operation of ["select", "insert", "update", "delete"]) {
      expect(sql).toMatch(
        new RegExp(
          `on storage\\.objects for ${operation} to authenticated[\\s\\S]+bucket_id = 'integration-imports'`,
        ),
      );
    }
  });
});
