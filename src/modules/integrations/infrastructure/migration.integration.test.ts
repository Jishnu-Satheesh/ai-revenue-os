import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const integrationPgTapPath = resolve(
  process.cwd(),
  "supabase/tests/database/integration_hub_rls_test.sql",
);
const integrationMigrationNames = readdirSync(migrationsDirectory)
  .filter((name) => /^\d{14}_integration_hub\.sql$/.test(name))
  .sort();

function readIntegrationMigration() {
  expect(
    integrationMigrationNames,
    "preserve the CLI-generated Integration Hub migration filename",
  ).toEqual(["20260807230118_integration_hub.sql"]);

  return readFileSync(resolve(migrationsDirectory, integrationMigrationNames[0]!), "utf8");
}

function readIntegrationPgTap() {
  return readFileSync(integrationPgTapPath, "utf8");
}

function functionDefinition(sql: string, qualifiedName: string) {
  const start = sql.indexOf(`create or replace function ${qualifiedName}`);
  expect(start, `${qualifiedName} function exists`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("\n$$;", start);
  expect(end, `${qualifiedName} function body terminates`).toBeGreaterThan(start);
  return sql.slice(start, end + 4);
}

function statements(sql: string) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function statementContaining(sql: string, snippet: string) {
  const matches = statements(sql).filter((statement) => statement.includes(snippet));
  expect(matches, `one SQL statement containing ${snippet}`).toHaveLength(1);
  return matches[0]!;
}

function grantColumns(sql: string, operation: "insert" | "select" | "update", table: string) {
  const matches = statements(sql).filter(
    (statement) =>
      statement.toLowerCase().startsWith(`grant ${operation} (`) &&
      statement.includes(`on table public.${table} to authenticated`),
  );
  expect(matches, `${operation} column grant for ${table}`).toHaveLength(1);
  const statement = matches[0]!;
  const match = statement.match(
    new RegExp(`^grant ${operation} \\(([\\s\\S]*?)\\) on table public\\.${table}`),
  );
  expect(match, `${operation} column grant for ${table}`).not.toBeNull();
  return match![1]!
    .split(",")
    .map((column) => column.trim())
    .sort();
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
  it("defines organization ownership and composite identity on each tenant table", () => {
    const sql = readIntegrationMigration();

    for (const table of tenantTables) {
      const definition = statementContaining(sql, `create table public.${table}`);
      expect(definition).toContain("organization_id uuid not null");
      expect(definition).toContain("unique (organization_id, id)");
    }
  });

  it("enforces table-local uniqueness, source XOR, counters, and tenant foreign keys", () => {
    const sql = readIntegrationMigration();
    const connections = statementContaining(sql, "create table public.integration_connections");
    const grants = statementContaining(sql, "create table public.integration_capability_grants");
    const mappings = statementContaining(sql, "create table public.integration_account_mappings");
    const sources = statementContaining(sql, "create table public.integration_data_sources");
    const runs = statementContaining(sql, "create table public.integration_ingestion_runs");
    const health = statementContaining(sql, "create table public.integration_health_checks");

    expect(connections).toContain("unique (organization_id, provider_key, external_account_id)");
    expect(grants).toContain("unique (organization_id, connection_id, capability_key)");
    expect(grants).toContain(
      "foreign key (organization_id, connection_id) references public.integration_connections(organization_id, id)",
    );
    expect(mappings).toContain("unique (organization_id, connection_id, external_resource_id)");
    expect(mappings).toContain(
      "foreign key (organization_id, branch_id) references public.branches(organization_id, id)",
    );
    expect(sources).toContain(
      "foreign key (organization_id, branch_id) references public.branches(organization_id, id)",
    );
    expect(runs).toContain("unique (organization_id, idempotency_key)");
    expect(runs).toContain("check ((connection_id is not null) <> (data_source_id is not null))");
    expect(runs).toContain(
      "records_received integer not null default 0 check (records_received >= 0)",
    );
    expect(runs).toContain(
      "records_accepted integer not null default 0 check (records_accepted >= 0)",
    );
    expect(runs).toContain(
      "records_rejected integer not null default 0 check (records_rejected >= 0)",
    );
    expect(health).toContain("latency_ms integer check (latency_ms is null or latency_ms >= 0)");
    expect(health).toContain(
      "foreign key (organization_id, ingestion_run_id) references public.integration_ingestion_runs(organization_id, id)",
    );
  });

  it("keeps capability availability V1-safe and disables grants for inactive connections", () => {
    const sql = readIntegrationMigration();
    const grants = statementContaining(sql, "create table public.integration_capability_grants");

    expect(grants).toContain(
      "check (availability <> 'available' or maturity in ('manual', 'imported', 'read-only'))",
    );
    expect(sql).toContain("private.validate_integration_capability_grant()");
    expect(sql).toContain("private.disable_integration_grants_for_inactive_connection()");
    expect(statementContaining(sql, "integration_connections_disable_inactive_grants")).toContain(
      "private.disable_integration_grants_for_inactive_connection()",
    );
  });

  it("serializes available-grant validation with connection status transitions", () => {
    const validator = functionDefinition(
      readIntegrationMigration(),
      "private.validate_integration_capability_grant()",
    );

    expect(validator).toContain("for update");
    expect(validator).not.toContain("for key share");
  });

  it("keeps capability denial probes wrapped and checks uniqueness before revocation", () => {
    const sql = readIntegrationPgTap();
    const topLevelCapabilityUpdates = sql.match(
      /^update public\.integration_capability_grants\b/gm,
    );
    const duplicateProbe = sql.indexOf(
      "'capability grants are unique by tenant connection and capability'",
    );
    const tenantOneRevocation = sql.indexOf(
      "update public.integration_connections\nset status = 'revoked'\nwhere id = '43000000-0000-4000-8000-000000000001'",
    );

    expect(sql).toContain("select extensions.plan(81)");
    expect(topLevelCapabilityUpdates).toBeNull();
    expect(duplicateProbe).toBeGreaterThanOrEqual(0);
    expect(tenantOneRevocation).toBeGreaterThan(duplicateProbe);
  });

  it("binds stored CSV paths to immutable source identity", () => {
    const sql = readIntegrationMigration();
    const sources = statementContaining(sql, "create table public.integration_data_sources");

    expect(sources).toContain("cardinality(string_to_array(storage_path, '/')) = 4");
    expect(sources).toContain("(string_to_array(storage_path, '/'))[1] = organization_id::text");
    expect(sources).toContain("(string_to_array(storage_path, '/'))[2] = id::text");
    expect(sources).toContain("(string_to_array(storage_path, '/'))[3] ~*");
    expect(sources).toContain("(string_to_array(storage_path, '/'))[4] <> ''");
  });

  it("guards immutable tenant and provenance identity on every mutable integration table", () => {
    const sql = readIntegrationMigration();

    expect(sql).toContain("private.prevent_integration_identity_change()");
    for (const table of [
      "integration_connections",
      "integration_capability_grants",
      "integration_account_mappings",
      "integration_data_sources",
      "integration_ingestion_runs",
    ]) {
      const trigger = statementContaining(sql, `${table}_prevent_identity_change`);
      expect(trigger).toContain(`before update on public.${table}`);
      expect(trigger).toContain("private.prevent_integration_identity_change()");
    }
  });

  it("adds each query-shaped and foreign-key index in its own statement", () => {
    const sql = readIntegrationMigration();

    for (const [indexName, indexDefinition] of [
      [
        "integration_connections_organization_status_updated_idx",
        "on public.integration_connections(organization_id, status, updated_at desc)",
      ],
      ["integration_connections_created_by_idx", "on public.integration_connections(created_by)"],
      [
        "integration_capability_grants_organization_connection_idx",
        "on public.integration_capability_grants(organization_id, connection_id)",
      ],
      [
        "integration_account_mappings_organization_connection_idx",
        "on public.integration_account_mappings(organization_id, connection_id)",
      ],
      [
        "integration_account_mappings_organization_branch_idx",
        "on public.integration_account_mappings(organization_id, branch_id)",
      ],
      [
        "integration_account_mappings_created_by_idx",
        "on public.integration_account_mappings(created_by)",
      ],
      [
        "integration_data_sources_organization_branch_idx",
        "on public.integration_data_sources(organization_id, branch_id)",
      ],
      ["integration_data_sources_created_by_idx", "on public.integration_data_sources(created_by)"],
      [
        "integration_ingestion_runs_organization_connection_idx",
        "on public.integration_ingestion_runs(organization_id, connection_id)",
      ],
      [
        "integration_ingestion_runs_organization_data_source_idx",
        "on public.integration_ingestion_runs(organization_id, data_source_id)",
      ],
      [
        "integration_ingestion_runs_organization_status_created_idx",
        "on public.integration_ingestion_runs(organization_id, status, created_at desc)",
      ],
      [
        "integration_ingestion_runs_organization_created_idx",
        "on public.integration_ingestion_runs(organization_id, created_at desc)",
      ],
      [
        "integration_health_checks_organization_connection_checked_idx",
        "on public.integration_health_checks(organization_id, connection_id, checked_at desc)",
      ],
      [
        "integration_health_checks_organization_ingestion_run_idx",
        "on public.integration_health_checks(organization_id, ingestion_run_id)",
      ],
    ] as const) {
      expect(statementContaining(sql, indexName)).toContain(indexDefinition);
    }

    expect(statementContaining(sql, "integration_connections_active_idx")).toContain(
      "where status = 'active'",
    );
    expect(statementContaining(sql, "integration_ingestion_runs_pending_idx")).toContain(
      "where status in ('queued', 'running')",
    );
  });

  it("defines table-local forced RLS and tenant-preserving update policies", () => {
    const sql = readIntegrationMigration();

    for (const table of tenantTables) {
      expect(
        statementContaining(sql, `alter table public.${table} enable row level security`),
      ).toBe(`alter table public.${table} enable row level security`);
      expect(statementContaining(sql, `alter table public.${table} force row level security`)).toBe(
        `alter table public.${table} force row level security`,
      );
      const selectPolicy = statementContaining(
        sql,
        `on public.${table} for select to authenticated`,
      );
      expect(selectPolicy).toContain("private.is_organization_member(organization_id)");
    }

    for (const table of [
      "integration_connections",
      "integration_account_mappings",
      "integration_data_sources",
      "integration_ingestion_runs",
    ]) {
      const updatePolicy = statementContaining(
        sql,
        `on public.${table} for update to authenticated`,
      );
      expect(updatePolicy).toContain("using (");
      expect(updatePolicy).toContain("with check (");
      expect(updatePolicy.match(/private\.has_organization_role/g)).toHaveLength(2);
    }
    expect(sql).not.toContain(
      "on public.integration_capability_grants for update to authenticated",
    );
    expect(sql).not.toContain("on public.integration_health_checks for update to authenticated");
  });

  it("grants only mutable columns and keeps capability grants server-managed", () => {
    const sql = readIntegrationMigration();

    for (const table of tenantTables) {
      expect(
        statementContaining(
          sql,
          `revoke all privileges on table public.${table} from anon, authenticated`,
        ),
      ).toContain(`public.${table}`);
    }

    expect(grantColumns(sql, "update", "integration_account_mappings")).toEqual([
      "branch_id",
      "external_resource_label",
      "status",
    ]);
    expect(grantColumns(sql, "update", "integration_data_sources")).toEqual(
      [
        "branch_id",
        "column_mapping",
        "last_successful_import_at",
        "media_type",
        "name",
        "original_filename",
        "schema_version",
        "size_bytes",
        "status",
        "storage_path",
      ].sort(),
    );
    expect(grantColumns(sql, "update", "integration_ingestion_runs")).toEqual(
      [
        "completed_at",
        "normalized_error_code",
        "records_accepted",
        "records_received",
        "records_rejected",
        "safe_error_summary",
        "started_at",
        "status",
        "trigger_run_id",
      ].sort(),
    );

    for (const operation of ["insert", "update"] as const) {
      expect(
        statements(sql).some(
          (statement) =>
            statement.toLowerCase().startsWith(`grant ${operation}`) &&
            statement.includes("public.integration_capability_grants"),
        ),
      ).toBe(false);
    }
    expect(grantColumns(sql, "select", "integration_connections")).not.toContain(
      "credential_reference",
    );
    expect(grantColumns(sql, "insert", "integration_connections")).not.toContain(
      "credential_reference",
    );
  });

  it("attaches the safe audit helper in the same trigger statement", () => {
    const sql = readIntegrationMigration();

    for (const table of [
      "integration_connections",
      "integration_capability_grants",
      "integration_account_mappings",
      "integration_data_sources",
      "integration_ingestion_runs",
    ]) {
      const trigger = statementContaining(sql, `create trigger ${table}_audit`);
      expect(trigger).toContain(`on public.${table}`);
      expect(trigger).toContain("private.audit_organization_change()");
    }
    expect(sql).not.toContain("create trigger integration_health_checks_audit");
  });

  it("uses exact four-segment tenant/source paths in every import-object policy", () => {
    const sql = readIntegrationMigration();
    const bucket = statementContaining(sql, "insert into storage.buckets");
    expect(bucket).toContain("'integration-imports'");
    expect(bucket).toContain("10485760");
    expect(bucket).toContain("array['text/csv']::text[]");

    for (const policyName of [
      "members can read integration imports",
      "operators can upload integration imports",
      "operators can update integration imports",
      "operators can delete integration imports",
    ]) {
      const policy = statementContaining(sql, `create policy \"${policyName}\"`);
      expect(policy).toContain("bucket_id = 'integration-imports'");
      expect(policy).toContain("cardinality(storage.foldername(name)) = 3");
      expect(policy).toContain("(storage.foldername(name))[1]");
      expect(policy).toContain("(storage.foldername(name))[2]");
      expect(policy).toContain("(storage.foldername(name))[3]");
      expect(policy).toContain("source.source_type = 'csv_import'");
    }
  });
});
