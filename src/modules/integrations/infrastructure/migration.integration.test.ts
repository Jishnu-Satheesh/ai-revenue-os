import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const integrationPgTapPath = resolve(
  process.cwd(),
  "supabase/tests/database/integration_hub_rls_test.sql",
);
const workerTransitionsMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260808012410_integration_worker_run_transitions.sql",
);
const storagePolicyFixMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260810150000_fix_integration_import_storage_policies.sql",
);
/**
 * Migrations that still contain the captured subquery they were corrected for.
 *
 * A migration is history and is never edited, so the broken form stays on disk
 * after its fix ships. Each entry here is paired with the migration that
 * replaced its policy, and nothing is added without that replacement.
 */
const supersededStoragePolicyMigrations = new Set([
  // Fixed by 20260810150000_fix_integration_import_storage_policies.sql.
  "20260807230118_integration_hub.sql",
  // Fixed by 20260822090000_qualify_governed_report_storage_policy.sql.
  "20260820150246_governed_report_package_intake.sql",
]);
const authenticatedOperationsMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260808025602_integration_authenticated_operations.sql",
);
const dataSourceOperationsMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260808033746_integration_data_source_operations.sql",
);
const actionCapabilitiesMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260812100000_integration_action_capabilities.sql",
);
const actionCapabilitiesRepairMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260812103000_integration_action_capabilities_repair.sql",
);
const fixtureGrantValidationRepairMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260812104500_integration_fixture_grant_validation_repair.sql",
);
const fixtureMappingHardeningMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260812105000_integration_fixture_mapping_hardening.sql",
);
const actionCapabilitiesPgTapPath = resolve(
  process.cwd(),
  "supabase/tests/database/integration_action_capabilities_test.sql",
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

function readWorkerTransitionsMigration() {
  return readFileSync(workerTransitionsMigrationPath, "utf8");
}

function readAuthenticatedOperationsMigration() {
  return readFileSync(authenticatedOperationsMigrationPath, "utf8");
}

function readDataSourceOperationsMigration() {
  return readFileSync(dataSourceOperationsMigrationPath, "utf8");
}

function readActionCapabilitiesMigration() {
  return readFileSync(actionCapabilitiesMigrationPath, "utf8");
}

function readActionCapabilitiesRepairMigration() {
  return readFileSync(actionCapabilitiesRepairMigrationPath, "utf8");
}

function readFixtureGrantValidationRepairMigration() {
  return readFileSync(fixtureGrantValidationRepairMigrationPath, "utf8");
}

function readFixtureMappingHardeningMigration() {
  return readFileSync(fixtureMappingHardeningMigrationPath, "utf8");
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
  it("adds governed capability evidence while preserving strict fixture admission", () => {
    const sql = readActionCapabilitiesMigration();
    const connect = functionDefinition(sql, "public.connect_fixture_integration_with_grants");
    const mappings = functionDefinition(sql, "public.replace_integration_mappings_with_grants");
    const identity = functionDefinition(sql, "private.prevent_integration_identity_change");
    const monotonic = functionDefinition(sql, "private.enforce_integration_grant_version");
    const disable = functionDefinition(
      sql,
      "private.disable_integration_grants_for_inactive_connection",
    );
    const fixtureValidator = functionDefinition(sql, "private.assert_google_fixture_grants");

    expect(sql).toContain("add column restriction_codes text[]");
    expect(sql).toContain("add column derived_from_contract_version text");
    expect(sql).toContain("add column grant_version bigint");
    expect(sql).toContain("alter column restriction_codes set not null");
    expect(sql).toContain("alter column derived_from_contract_version set not null");
    expect(sql).toContain("alter column grant_version set not null");
    expect(sql).toContain("check (grant_version > 0)");
    expect(sql).toContain(
      "alter table public.integration_capability_grants enable row level security",
    );
    expect(sql).toContain(
      "alter table public.integration_capability_grants force row level security",
    );
    expect(sql).toContain(
      "grant select on table public.integration_capability_grants to authenticated",
    );
    expect(sql).toContain(
      "revoke all on table public.integration_capability_grants from public, anon, authenticated",
    );
    expect(identity).not.toContain("'derived_from_contract_version'");
    expect(identity).not.toContain("'grant_version'");
    expect(monotonic).toContain("old.grant_version + 1");
    expect(disable).toContain("connection_revoked");
    expect(disable).toContain("connection_disconnected");
    expect(disable).not.toContain("grant_version =");

    expect(connect).toContain("p_provider_key <> 'google_business_profile'");
    expect(mappings).toContain("locked_connection.provider_key <> 'google_business_profile'");
    expect(fixtureValidator).toContain("jsonb_array_length(p_grants) <> 2");
    expect(fixtureValidator).toContain("jsonb_object_length(grant_payload) <> 7");
    expect(fixtureValidator).toContain("read_google_business_profile");
    expect(fixtureValidator).toContain("read_reviews");
    expect(fixtureValidator).toContain("derived_from_contract_version");
    expect(fixtureValidator).toContain("restriction_codes");
    for (const operation of [connect, mappings]) {
      expect(operation).toContain("assert_google_fixture_grants");
      expect(operation).toContain("on conflict (organization_id, connection_id, capability_key)");
      expect(operation).not.toContain("delete from public.integration_capability_grants");
    }

    const pgTap = readFileSync(actionCapabilitiesPgTapPath, "utf8");
    expect(pgTap).toContain("set local role authenticated");
    expect(pgTap).toContain("two-tenant");
    expect(pgTap).toContain("viewer cannot update governed grants");
    expect(pgTap).toContain("inactive connection disables grants");
    expect(pgTap).toContain("composite ownership rejects a foreign connection");
    expect(pgTap).toContain("direct RPC rejects a forged capability");
    expect(pgTap).toContain("grant version increases monotonically");
    expect(pgTap).toContain("no-op recompute preserves grant version");
    expect(pgTap).toContain("caller-supplied grant version is rejected");
    expect(pgTap).toContain("direct RPC rejects an extra grant key");
  });

  it("repairs the pushed fixture RPC forward without rewriting migration history", () => {
    const sql = readActionCapabilitiesRepairMigration();

    expect(sql).toContain("pg_get_functiondef(function_signature)");
    expect(sql).toContain("'pg_catalog.coalesce'");
    expect(sql).toContain("'coalesce'");
    expect(sql).toContain("connect_fixture_integration_with_grants");
    expect(sql).toContain("replace_integration_mappings_with_grants");
    expect(sql).toContain("expected integration RPC repair target is unavailable");
    expect(sql).toContain(
      "grant execute on function public.connect_fixture_integration_with_grants",
    );
    expect(sql).toContain(
      "grant execute on function public.replace_integration_mappings_with_grants",
    );
  });

  it("repairs exact fixture grant key counting through a portable PostgreSQL primitive", () => {
    const sql = readFixtureGrantValidationRepairMigration();

    expect(sql).toContain("private.assert_google_fixture_grants(jsonb,text,text)");
    expect(sql).toContain("pg_catalog.jsonb_object_length(grant_payload) <> 7");
    expect(sql).toContain(
      "(select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(grant_payload)) <> 7",
    );
    expect(sql).toContain("expected fixture grant validator repair target is unavailable");
    expect(sql).toContain(
      "revoke all on function private.assert_google_fixture_grants(jsonb, text, text) from public",
    );
  });

  it("hardens mapping JSON and seeds exact fixture resources in a forward-only migration", () => {
    const sql = readFixtureMappingHardeningMigration();
    const mappingValidator = functionDefinition(sql, "private.assert_google_fixture_mappings");
    const connect = functionDefinition(sql, "public.connect_fixture_integration_with_grants");
    const mappings = functionDefinition(sql, "public.replace_integration_mappings_with_grants");

    expect(mappingValidator).toContain("jsonb_typeof(p_mappings) <> 'array'");
    expect(mappingValidator).toContain("jsonb_array_length(p_mappings) <> 2");
    expect(mappingValidator).toContain("jsonb_object_keys(mapping_payload)");
    expect(mappingValidator).toContain("external_resource_id");
    expect(mappingValidator).toContain(
      "count(distinct mapping_payload ->> 'external_resource_id')",
    );
    expect(mappingValidator).toContain("locations/fixture-harbor-house");
    expect(mappingValidator).toContain("locations/fixture-river-market");
    expect(mappings).toContain("perform private.assert_google_fixture_mappings(p_mappings)");
    expect(connect).toContain("locations/fixture-harbor-house");
    expect(connect).toContain("locations/fixture-river-market");
    expect(connect).toContain(
      "on conflict (organization_id, connection_id, external_resource_id) do nothing",
    );
    expect(connect).toContain("mapping_row.status = 'mapped'");
    expect(connect).toContain("perform private.assert_google_fixture_grants");
    expect(sql).toContain(
      "grant execute on function public.connect_fixture_integration_with_grants",
    );
    expect(sql).toContain(
      "grant execute on function public.replace_integration_mappings_with_grants",
    );
  });

  it("uses authenticated, tenant-checked atomic RPCs for connection operations", () => {
    const sql = readAuthenticatedOperationsMigration();
    const connect = functionDefinition(sql, "public.connect_fixture_integration_with_grants");
    const mappings = functionDefinition(sql, "public.replace_integration_mappings_with_grants");
    const disconnect = functionDefinition(sql, "public.disconnect_integration_connection");

    for (const operation of [connect, mappings, disconnect]) {
      expect(operation).toContain("security definer");
      expect(operation).toContain("set search_path = ''");
      expect(operation).toContain("private.has_organization_role");
      expect(operation).toContain("(select auth.uid()) <> p_actor_id");
    }
    expect(connect).toContain("on conflict (organization_id, provider_key, external_account_id)");
    expect(
      connect,
      "first-creation is derived from an explicit pre-check, not the internal xmax column",
    ).not.toContain("xmax");
    expect(connect).toMatch(
      /select not exists \(\s*select 1\s*from public\.integration_connections existing_connection/,
    );
    expect(connect).toContain("into created");
    expect(sql).toContain("create table public.integration_fixture_connect_operations");
    expect(connect).toContain("p_idempotency_key text");
    expect(connect).toContain("md5(");
    expect(connect).toContain("fixture connect idempotency key was reused");
    expect(connect).toContain("p_provider_key <> 'google_business_profile'");
    expect(connect).toContain("p_adapter_version <> '1'");
    expect(connect).toContain("read_google_business_profile");
    expect(connect).toContain("read_reviews");
    expect(connect).toContain("grant_payload ->> 'derived_from_adapter_version' <> '1'");
    expect(connect).toContain("grant_payload ->> 'availability' not in ('blocked', 'disabled')");
    expect(connect).toContain("jsonb_array_length(p_grants) <> 2");
    expect(connect).toContain("perform pg_catalog.set_config('app.correlation_id'");
    expect(connect).toContain("delete from public.integration_capability_grants");
    expect(sql).toContain("create table public.integration_mapping_operations");
    expect(mappings).toContain("md5(p_mappings::text || p_grants::text)");
    expect(mappings).toContain("for update");
    expect(mappings).toContain("delete from public.integration_account_mappings");
    expect(mappings).toContain("delete from public.integration_capability_grants");
    expect(mappings).toContain("left join public.branches branch");
    expect(mappings).toContain("locked_connection.provider_key <> 'google_business_profile'");
    expect(mappings).toContain("grant_payload ->> 'derived_from_adapter_version' <> '1'");
    expect(mappings).toContain("grant_payload ->> 'availability' = 'available'");
    expect(mappings).toContain("mapping_row.status = 'mapped'");
    expect(mappings).toContain("perform pg_catalog.set_config('app.correlation_id'");
    expect(disconnect).toContain("for update");
    expect(disconnect).toContain("set status = 'disconnected'");
    expect(disconnect).toContain("next_scheduled_sync_at = null");
    expect(disconnect).toContain("perform pg_catalog.set_config('app.correlation_id'");
    expect(sql).toContain(
      "grant execute on function public.connect_fixture_integration_with_grants",
    );
    expect(sql).toContain(
      "grant execute on function public.replace_integration_mappings_with_grants",
    );
    expect(sql).toContain("grant execute on function public.disconnect_integration_connection");
    expect(sql).toContain("current_setting('app.correlation_id', true)");
  });
  it("replays data-source mutations through a tenant-scoped idempotency record", () => {
    const sql = readDataSourceOperationsMigration();
    const operations = statementContaining(
      sql,
      "create table public.integration_data_source_operations",
    );
    const create = functionDefinition(
      sql,
      "public.create_integration_data_source_with_idempotency",
    );
    const update = functionDefinition(
      sql,
      "public.update_integration_data_source_with_idempotency",
    );

    expect(operations).toContain("unique (organization_id, idempotency_key)");
    expect(sql).toContain("force row level security");
    expect(sql).toContain(
      "revoke all on table public.integration_data_source_operations from public, anon, authenticated",
    );
    for (const operation of [create, update]) {
      expect(operation).toContain("security definer");
      expect(operation).toContain("set search_path = ''");
      expect(operation).toContain("(select auth.uid()) <> p_actor_id");
      expect(operation).toContain("private.has_organization_role");
      expect(operation).toContain("array['owner', 'admin', 'operator']");
      expect(operation).toContain("on conflict (organization_id, idempotency_key) do nothing");
      expect(operation).toContain("for update");
      expect(operation).toContain("operation.request_fingerprint <> p_request_fingerprint");
      expect(operation).toContain("pg_catalog.jsonb_build_object('deduplicated', true)");
      expect(operation).toContain("perform pg_catalog.set_config('app.correlation_id'");
    }
    expect(create).toContain("p_source_type not in ('manual', 'csv_import')");
    expect(create).toContain("'dataSource', pg_catalog.to_jsonb(source), 'created', true");
    expect(update).toContain("p_status not in ('archived', 'failed')");
    expect(update).toContain("where organization_id = p_organization_id and id = p_data_source_id");
    expect(update).toContain("data source was not found");
    expect(sql).toContain(
      "grant execute on function public.create_integration_data_source_with_idempotency",
    );
    expect(sql).toContain(
      "grant execute on function public.update_integration_data_source_with_idempotency",
    );
  });

  it("leases worker execution by tenant and prevents a late claimant from transitioning a run", () => {
    const sql = readWorkerTransitionsMigration();
    const lease = statementContaining(
      sql,
      "create table public.integration_worker_execution_leases",
    );
    const claim = functionDefinition(sql, "public.claim_integration_worker_execution_lease");
    const transition = functionDefinition(sql, "public.transition_integration_ingestion_run");

    expect(lease).toContain("primary key (organization_id, ingestion_run_id)");
    expect(lease).toContain(
      "foreign key (organization_id, ingestion_run_id) references public.integration_ingestion_runs(organization_id, id)",
    );
    expect(sql).toContain("force row level security");
    expect(sql).toContain(
      "revoke all on table public.integration_worker_execution_leases from public, anon, authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.claim_integration_worker_execution_lease(uuid, uuid, text, uuid) to service_role",
    );
    expect(sql).toContain("integration_worker_execution_leases_prevent_identity_change");
    expect(claim).toContain("existing.idempotency_key <> p_idempotency_key");
    expect(claim).toContain("locked_run.idempotency_key <> p_idempotency_key");
    expect(claim).toContain("from public.integration_ingestion_runs");
    expect(claim).toContain("for update");
    expect(claim).toContain("existing.lease_expires_at <= now()");
    expect(claim).toContain("interval '20 minutes'");
    expect(claim).toContain("claim_token = p_claim_token");
    expect(transition).toContain("p_execution_claim_token uuid default null");
    expect(transition).toContain("execution_lease.claim_token = p_execution_claim_token");
    expect(transition).toContain("execution_lease.lease_expires_at > now()");
  });

  it("supersedes an active worker lease before marking a matching run cancelled", () => {
    const sql = readWorkerTransitionsMigration();
    const cancellation = functionDefinition(sql, "public.cancel_integration_worker_execution");

    expect(cancellation).toContain("locked_run.idempotency_key <> p_idempotency_key");
    expect(cancellation).toContain("for update");
    expect(cancellation).toContain("set claim_token = p_cancellation_token");
    expect(cancellation).toContain("status in ('queued', 'running')");
    expect(sql).toContain(
      "grant execute on function public.cancel_integration_worker_execution(uuid, uuid, text, uuid) to service_role",
    );
  });

  it("makes health and connection writes conditional on the same active execution lease", () => {
    const sql = readWorkerTransitionsMigration();
    const health = functionDefinition(
      sql,
      "public.append_integration_health_check_with_execution_lease",
    );
    const connection = functionDefinition(
      sql,
      "public.update_integration_connection_with_execution_lease",
    );

    for (const write of [health, connection]) {
      expect(write).toContain("from public.integration_ingestion_runs");
      expect(write).toContain("from public.integration_worker_execution_leases");
      expect(write).toContain("for update");
      expect(write).toContain("locked_run.idempotency_key is distinct from p_idempotency_key");
      expect(write).toContain("locked_run.connection_id is distinct from p_connection_id");
      expect(write).toContain("locked_run.status = 'cancelled'");
      expect(write).toContain("locked_lease.claim_token is distinct from p_claim_token");
      expect(write).toContain("locked_lease.lease_expires_at <= now()");
    }
    expect(health).toContain("insert into public.integration_health_checks");
    expect(connection).toContain("update public.integration_connections connection");
  });

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

    // The policy bodies in this migration were superseded by
    // 20260810150000_fix_integration_import_storage_policies.sql, so the
    // effective definitions are asserted there rather than here.
    const effective = readFileSync(storagePolicyFixMigrationPath, "utf8");

    for (const policyName of [
      "members can read integration imports",
      "operators can upload integration imports",
      "operators can update integration imports",
      "operators can delete integration imports",
    ]) {
      const policy = statementContaining(effective, `create policy \"${policyName}\"`);
      expect(policy).toContain("bucket_id = 'integration-imports'");
      expect(policy).toContain("cardinality(storage.foldername(objects.name)) = 3");
      expect(policy).toContain("(storage.foldername(objects.name))[1]");
      expect(policy).toContain("(storage.foldername(objects.name))[2]");
      expect(policy).toContain("(storage.foldername(objects.name))[3]");
      expect(policy).toContain("source.source_type = 'csv_import'");
    }
  });

  it("keeps the effective governed report upload policy qualified", () => {
    // The exemption above lets the intake migration keep its original,
    // unqualified body. That is only safe while the policy that actually runs
    // is the corrected one, so the replacement is asserted rather than assumed.
    const effective = readFileSync(
      resolve(migrationsDirectory, "20260822090000_qualify_governed_report_storage_policy.sql"),
      "utf8",
    );
    const policy = statementContaining(
      effective,
      'create policy "operators upload governed report package objects"',
    );

    expect(policy).toContain("bucket_id = 'governed-report-packages'");
    expect(policy).toContain("(storage.foldername(objects.name))[1]");
    expect(policy).toContain("(storage.foldername(objects.name))[2]");
    expect(policy).toContain("(storage.foldername(objects.name))[3]");
    expect(policy).toContain("objects.name = p.storage_path");
    expect(policy).toContain("private.has_organization_permission(p.organization_id, 'report.upload')");
    expect(policy).not.toMatch(/storage\.foldername\(\s*name\s*\)/);
  });

  it("qualifies the storage column inside every policy subquery", () => {
    // `integration_data_sources` has a `name` column of its own, so an
    // unqualified storage.foldername(name) inside `exists (...)` binds to the
    // data source's display name instead of the object path and evaluates false
    // for every row. That silently disabled the whole bucket once already, and
    // a permissive policy that never matches denies everything.
    for (const file of readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql"))) {
      if (supersededStoragePolicyMigrations.has(file)) continue;

      // Comment lines are dropped first: the corrective migration quotes the
      // broken form to explain it, and that explanation is not a policy.
      const sql = readFileSync(resolve(migrationsDirectory, file), "utf8").replace(
        /^[ \t]*--.*$/gm,
        "",
      );

      for (const subquery of existsSubqueries(sql)) {
        expect(subquery, `${file} captures an unqualified column inside a subquery`).not.toMatch(
          /storage\.foldername\(\s*name\s*\)/,
        );
      }
    }
  });
});

/** Every `exists ( ... )` block, matched to its balancing parenthesis. */
function existsSubqueries(sql: string): string[] {
  const blocks: string[] = [];
  const opener = /exists\s*\(/gi;

  for (let match = opener.exec(sql); match !== null; match = opener.exec(sql)) {
    let depth = 1;
    let index = match.index + match[0].length;

    while (index < sql.length && depth > 0) {
      if (sql[index] === "(") depth += 1;
      else if (sql[index] === ")") depth -= 1;
      index += 1;
    }

    blocks.push(sql.slice(match.index, index));
  }

  return blocks;
}
