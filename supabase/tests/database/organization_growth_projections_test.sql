begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Covers `20260918120000_organization_growth_projections.sql`.
--
-- Like a sealed bid box: members may look at their own organization's slip
-- through a permission-checked window, nobody rewrites a slip once filed,
-- and only the guarded slot (the service-only RPC) accepts new slips.
-- Every RPC and trigger below is exercised here; the suite is
-- rollback-wrapped. Amounts are small synthetic test figures, never client
-- data and never the planning PNG's illustrative numbers.

-- Fixtures ---------------------------------------------------------------------

insert into auth.users (id) values
  ('a1000000-0000-4000-8000-000000000001'::uuid),
  ('a1000000-0000-4000-8000-000000000002'::uuid),
  ('a1000000-0000-4000-8000-000000000003'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('a1000000-0000-4000-8000-000000000011'::uuid, 'Projection agency A', 'projection-agency-a', 'a1000000-0000-4000-8000-000000000001'::uuid),
  ('a1000000-0000-4000-8000-000000000012'::uuid, 'Projection agency B', 'projection-agency-b', 'a1000000-0000-4000-8000-000000000002'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('a1000000-0000-4000-8000-000000000021'::uuid, 'a1000000-0000-4000-8000-000000000011'::uuid, 'Projection client A', 'projection-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'a1000000-0000-4000-8000-000000000001'::uuid),
  ('a1000000-0000-4000-8000-000000000022'::uuid, 'a1000000-0000-4000-8000-000000000012'::uuid, 'Projection client B', 'projection-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'a1000000-0000-4000-8000-000000000002'::uuid);

insert into public.organization_memberships (organization_id, user_id, role) values
  ('a1000000-0000-4000-8000-000000000021'::uuid, 'a1000000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('a1000000-0000-4000-8000-000000000022'::uuid, 'a1000000-0000-4000-8000-000000000002'::uuid, 'owner');

insert into public.organization_channels (id, organization_id, key, display_name, category, created_by) values
  ('a1000000-0000-4000-8000-000000000031'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid, 'test-channel-a', 'Test channel A', 'owned_digital', 'a1000000-0000-4000-8000-000000000001'::uuid),
  ('a1000000-0000-4000-8000-000000000032'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid, 'test-channel-b', 'Test channel B', 'owned_digital', 'a1000000-0000-4000-8000-000000000002'::uuid);

insert into public.branches (id, organization_id, name, slug, timezone, currency) values
  ('a1000000-0000-4000-8000-000000000041'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid, 'Branch B', 'branch-b', 'Asia/Dubai', 'AED');

insert into public.metric_definitions (
  id, organization_id, key, label, owner_scope, value_kind, aggregation
) values (
  'a1000000-0000-4000-8000-000000000051'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid,
  'test.gross', 'Org B private gross', 'organization', 'money', 'sum'
);

-- Ledger fixtures. srcA is the healthy org-A observation; the rest each break
-- exactly one publication rule so the failure matrix stays honest.
insert into public.normalized_metrics (
  id, organization_id, metric_definition_id, value_kind, period_grain,
  period_start, period_end, period_timezone, value_numerator, currency,
  quality_tier, observed_at
) values
  ('a1000000-0000-4000-8000-000000000061'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid,
   (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
   'money', 'day', '2029-12-01T00:00:00Z', '2030-01-01T00:00:00Z', 'Asia/Dubai', 5000, 'AED',
   'measured', '2029-12-15T00:00:00Z'),
  ('a1000000-0000-4000-8000-000000000062'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid,
   (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
   'money', 'day', '2029-12-01T00:00:00Z', '2030-01-01T00:00:00Z', 'Asia/Dubai', 5000, 'AED',
   'measured', '2029-12-15T00:00:00Z'),
  ('a1000000-0000-4000-8000-000000000063'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid,
   (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
   'money', 'day', '2029-12-01T00:00:00Z', '2030-01-01T00:00:00Z', 'Asia/Dubai', 5000, 'AED',
   'estimated', '2029-12-15T00:00:00Z'),
  ('a1000000-0000-4000-8000-000000000065'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid,
   (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
   'money', 'day', '2029-12-02T00:00:00Z', '2030-01-01T00:00:00Z', 'Asia/Dubai', 4000, 'AED',
   'measured', '2029-12-15T00:00:00Z'),
  ('a1000000-0000-4000-8000-000000000064'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid,
   (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
   'money', 'day', '2029-12-01T00:00:00Z', '2030-01-01T00:00:00Z', 'Asia/Dubai', 5000, 'AED',
   'measured', '2029-12-15T00:00:00Z'),
  ('a1000000-0000-4000-8000-000000000066'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid,
   (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
   'money', 'day', '2029-12-01T00:00:00Z', '2030-01-01T00:00:00Z', 'Asia/Dubai', 5000, 'AED',
   'measured', '2029-12-15T00:00:00Z'),
  ('a1000000-0000-4000-8000-000000000067'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid,
   (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
   'money', 'day', '2029-12-01T00:00:00Z', '2030-01-01T00:00:00Z', 'Asia/Dubai', 5000, 'EUR',
   'measured', '2029-12-15T00:00:00Z');

update public.normalized_metrics
set superseded_by_id = 'a1000000-0000-4000-8000-000000000065'::uuid,
    supersede_reason = 'test restatement'
where id = 'a1000000-0000-4000-8000-000000000064'::uuid;

update public.normalized_metrics
set created_at = '2031-06-01T00:00:00Z'::timestamptz
where id = 'a1000000-0000-4000-8000-000000000066'::uuid;

-- Org-A branch for the exact-range happy path (exact observations always
-- carry a branch; normalized fixtures above stay organization-level).
insert into public.branches (id, organization_id, name, slug, timezone, currency) values
  ('a1000000-0000-4000-8000-000000000042'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid, 'Branch A', 'branch-a', 'Asia/Dubai', 'AED');

-- Exact-range report chains, one per tenant. Direct inserts as the owner:
-- the claim-fenced RPCs govern application writes, but fixtures must exist
-- before any RPC can cite them. All values synthetic.
insert into public.report_contracts (id, organization_id, channel_id, report_type, outlet_grain, created_by) values
  ('b2000000-0000-4000-8000-000000000101'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid, 'a1000000-0000-4000-8000-000000000032'::uuid, 'test-sales', 'branch', 'a1000000-0000-4000-8000-000000000002'::uuid),
  ('a2000000-0000-4000-8000-000000000111'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid, 'a1000000-0000-4000-8000-000000000031'::uuid, 'test-sales', 'branch', 'a1000000-0000-4000-8000-000000000001'::uuid);

insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type,
  declared_period_start, declared_period_end, declared_currency, period_timezone,
  file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, upload_expires_at, created_by, correlation_id
) values
  ('b2000000-0000-4000-8000-000000000102'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid,
   'a1000000-0000-4000-8000-000000000032'::uuid, 'a1000000-0000-4000-8000-000000000041'::uuid,
   'test-sales', '2029-12-01', '2030-01-01', 'AED', 'Asia/Dubai',
   'csv', 'sales.csv', 'text/csv', 1024,
   'b2000000-0000-4000-8000-000000000102/b2000000-0000-4000-8000-000000000102/b2000000-0000-4000-8000-000000000102/1/original/report.csv',
   now() + interval '1 day', 'a1000000-0000-4000-8000-000000000002'::uuid, 'b2000000-0000-4000-8000-000000000001'::uuid),
  ('a2000000-0000-4000-8000-000000000112'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid,
   'a1000000-0000-4000-8000-000000000031'::uuid, 'a1000000-0000-4000-8000-000000000042'::uuid,
   'test-sales', '2029-12-01', '2030-01-01', 'AED', 'Asia/Dubai',
   'csv', 'sales.csv', 'text/csv', 1024,
   'a2000000-0000-4000-8000-000000000112/a2000000-0000-4000-8000-000000000112/a2000000-0000-4000-8000-000000000112/1/original/report.csv',
   now() + interval '1 day', 'a1000000-0000-4000-8000-000000000001'::uuid, 'a2000000-0000-4000-8000-000000000001'::uuid);

insert into public.report_contract_versions (
  id, organization_id, report_contract_id, report_package_id, version,
  schema_fingerprint, mapping_document, mapping_digest, declared_currency,
  financial_sign_semantics, controls, unmapped_field_disposition,
  proposal_source, created_by, correlation_id
) values
  ('b2000000-0000-4000-8000-000000000103'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid,
   'b2000000-0000-4000-8000-000000000101'::uuid, 'b2000000-0000-4000-8000-000000000102'::uuid, 1,
   repeat('b', 64), '{}'::jsonb, repeat('b', 64), 'AED',
   '[]'::jsonb, '[]'::jsonb, 'reviewed_ignore', 'human',
   'a1000000-0000-4000-8000-000000000002'::uuid, 'b2000000-0000-4000-8000-000000000001'::uuid),
  ('a2000000-0000-4000-8000-000000000113'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid,
   'a2000000-0000-4000-8000-000000000111'::uuid, 'a2000000-0000-4000-8000-000000000112'::uuid, 1,
   repeat('b', 64), '{}'::jsonb, repeat('b', 64), 'AED',
   '[]'::jsonb, '[]'::jsonb, 'reviewed_ignore', 'human',
   'a1000000-0000-4000-8000-000000000001'::uuid, 'a2000000-0000-4000-8000-000000000001'::uuid);

insert into public.report_contract_bindings (
  id, organization_id, report_contract_id, report_contract_version_id, channel_id,
  report_type, schema_fingerprint, declared_currency, outlet_grain, bound_by, correlation_id
) values
  ('b2000000-0000-4000-8000-000000000104'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid,
   'b2000000-0000-4000-8000-000000000101'::uuid, 'b2000000-0000-4000-8000-000000000103'::uuid,
   'a1000000-0000-4000-8000-000000000032'::uuid, 'test-sales', repeat('b', 64), 'AED', 'branch',
   'a1000000-0000-4000-8000-000000000002'::uuid, 'b2000000-0000-4000-8000-000000000001'::uuid),
  ('a2000000-0000-4000-8000-000000000114'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid,
   'a2000000-0000-4000-8000-000000000111'::uuid, 'a2000000-0000-4000-8000-000000000113'::uuid,
   'a1000000-0000-4000-8000-000000000031'::uuid, 'test-sales', repeat('b', 64), 'AED', 'branch',
   'a1000000-0000-4000-8000-000000000001'::uuid, 'a2000000-0000-4000-8000-000000000001'::uuid);

insert into public.report_projection_versions (
  id, organization_id, report_contract_version_id, version, projection_document,
  projection_digest, created_by, correlation_id
) values
  ('b2000000-0000-4000-8000-000000000105'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid,
   'b2000000-0000-4000-8000-000000000103'::uuid, 1, '{}'::jsonb, repeat('b', 64),
   'a1000000-0000-4000-8000-000000000002'::uuid, 'b2000000-0000-4000-8000-000000000001'::uuid),
  ('a2000000-0000-4000-8000-000000000115'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid,
   'a2000000-0000-4000-8000-000000000113'::uuid, 1, '{}'::jsonb, repeat('b', 64),
   'a1000000-0000-4000-8000-000000000001'::uuid, 'a2000000-0000-4000-8000-000000000001'::uuid);

insert into public.report_projection_bindings (
  id, organization_id, report_contract_version_id, report_contract_binding_id,
  report_projection_version_id, schema_fingerprint, declared_currency, bound_by, correlation_id
) values
  ('b2000000-0000-4000-8000-000000000106'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid,
   'b2000000-0000-4000-8000-000000000103'::uuid, 'b2000000-0000-4000-8000-000000000104'::uuid,
   'b2000000-0000-4000-8000-000000000105'::uuid, repeat('b', 64), 'AED',
   'a1000000-0000-4000-8000-000000000002'::uuid, 'b2000000-0000-4000-8000-000000000001'::uuid),
  ('a2000000-0000-4000-8000-000000000116'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid,
   'a2000000-0000-4000-8000-000000000113'::uuid, 'a2000000-0000-4000-8000-000000000114'::uuid,
   'a2000000-0000-4000-8000-000000000115'::uuid, repeat('b', 64), 'AED',
   'a1000000-0000-4000-8000-000000000001'::uuid, 'a2000000-0000-4000-8000-000000000001'::uuid);

insert into public.integration_report_validation_runs (
  id, organization_id, report_package_id, report_contract_version_id,
  report_contract_binding_id, input_digest, status, completed_at, result_digest,
  quality_state, completeness_state, correlation_id
) values
  ('b2000000-0000-4000-8000-000000000107'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid,
   'b2000000-0000-4000-8000-000000000102'::uuid, 'b2000000-0000-4000-8000-000000000103'::uuid,
   'b2000000-0000-4000-8000-000000000104'::uuid, repeat('b', 64), 'validated', now(), repeat('b', 64),
   'complete', 'complete', 'b2000000-0000-4000-8000-000000000001'::uuid),
  ('a2000000-0000-4000-8000-000000000117'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid,
   'a2000000-0000-4000-8000-000000000112'::uuid, 'a2000000-0000-4000-8000-000000000113'::uuid,
   'a2000000-0000-4000-8000-000000000114'::uuid, repeat('b', 64), 'validated', now(), repeat('b', 64),
   'complete', 'complete', 'a2000000-0000-4000-8000-000000000001'::uuid);

insert into public.integration_report_projection_runs (
  id, organization_id, report_package_id, report_contract_version_id,
  report_contract_binding_id, report_projection_version_id, report_projection_binding_id,
  validation_run_id, input_digest, status, completed_at, result_digest,
  quality_state, completeness_state, correlation_id
) values
  ('b2000000-0000-4000-8000-000000000108'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid,
   'b2000000-0000-4000-8000-000000000102'::uuid, 'b2000000-0000-4000-8000-000000000103'::uuid,
   'b2000000-0000-4000-8000-000000000104'::uuid, 'b2000000-0000-4000-8000-000000000105'::uuid,
   'b2000000-0000-4000-8000-000000000106'::uuid, 'b2000000-0000-4000-8000-000000000107'::uuid,
   repeat('b', 64), 'projected', now(), repeat('b', 64),
   'complete', 'complete', 'b2000000-0000-4000-8000-000000000001'::uuid),
  ('a2000000-0000-4000-8000-000000000118'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid,
   'a2000000-0000-4000-8000-000000000112'::uuid, 'a2000000-0000-4000-8000-000000000113'::uuid,
   'a2000000-0000-4000-8000-000000000114'::uuid, 'a2000000-0000-4000-8000-000000000115'::uuid,
   'a2000000-0000-4000-8000-000000000116'::uuid, 'a2000000-0000-4000-8000-000000000117'::uuid,
   repeat('b', 64), 'projected', now(), repeat('b', 64),
   'complete', 'complete', 'a2000000-0000-4000-8000-000000000001'::uuid);

insert into public.exact_range_metric_observations (
  id, organization_id, branch_id, channel_id, metric_definition_id,
  projection_output_key, value_kind, period_start, period_end, period_timezone,
  value_numerator, currency, quality_state, completeness_state,
  report_package_id, validation_run_id, report_contract_version_id,
  report_projection_version_id, projection_run_id
) values
  ('b2000000-0000-4000-8000-000000000109'::uuid, 'a1000000-0000-4000-8000-000000000022'::uuid,
   'a1000000-0000-4000-8000-000000000041'::uuid, 'a1000000-0000-4000-8000-000000000032'::uuid,
   (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
   'gross_total', 'money', '2029-12-01', '2030-01-01', 'Asia/Dubai',
   5000, 'AED', 'complete', 'complete',
   'b2000000-0000-4000-8000-000000000102'::uuid, 'b2000000-0000-4000-8000-000000000107'::uuid,
   'b2000000-0000-4000-8000-000000000103'::uuid, 'b2000000-0000-4000-8000-000000000105'::uuid,
   'b2000000-0000-4000-8000-000000000108'::uuid),
  ('a2000000-0000-4000-8000-000000000119'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid,
   'a1000000-0000-4000-8000-000000000042'::uuid, 'a1000000-0000-4000-8000-000000000031'::uuid,
   (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
   'gross_total', 'money', '2029-12-01', '2030-01-01', 'Asia/Dubai',
   5000, 'AED', 'complete', 'complete',
   'a2000000-0000-4000-8000-000000000112'::uuid, 'a2000000-0000-4000-8000-000000000117'::uuid,
   'a2000000-0000-4000-8000-000000000113'::uuid, 'a2000000-0000-4000-8000-000000000115'::uuid,
   'a2000000-0000-4000-8000-000000000118'::uuid),
  ('a2000000-0000-4000-8000-000000000120'::uuid, 'a1000000-0000-4000-8000-000000000021'::uuid,
   'a1000000-0000-4000-8000-000000000042'::uuid, 'a1000000-0000-4000-8000-000000000031'::uuid,
   (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
   'gross_total_partial', 'money', '2029-12-01', '2030-01-01', 'Asia/Dubai',
   5000, 'AED', 'partial', 'complete',
   'a2000000-0000-4000-8000-000000000112'::uuid, 'a2000000-0000-4000-8000-000000000117'::uuid,
   'a2000000-0000-4000-8000-000000000113'::uuid, 'a2000000-0000-4000-8000-000000000115'::uuid,
   'a2000000-0000-4000-8000-000000000118'::uuid);

-- Document builders ------------------------------------------------------------
--
-- Fixed far-future dates keep every schedule assertion deterministic: the
-- periods are always prospective, so the suite never depends on the day it
-- runs. Cycle/days pairs below follow the 2030 calendar (2030 is not a leap
-- year); each failure case takes its own cycle so a stored replay can never
-- mask the rejection under test.

create function pg_temp.test_points(p_start date, p_days integer) returns jsonb
language sql stable as $$
  select pg_catalog.jsonb_agg(elem order by ord) from (
    select 0 as ord,
      pg_catalog.jsonb_build_object(
        'date', p_start::text, 'lowMinor', 0, 'centralMinor', 0,
        'highMinor', 0, 'anchor', true) as elem
    union all
    select d,
      pg_catalog.jsonb_build_object(
        'date', (p_start + (d - 1))::text,
        'lowMinor', 1000 * d, 'centralMinor', 1100 * d, 'highMinor', 1200 * d,
        'anchor', false)
    from pg_catalog.generate_series(1, p_days) d
  ) s
$$;

create function pg_temp.test_source(
  p_table text, p_row uuid, p_pkey text, p_start date, p_end date
) returns jsonb
language sql immutable as $$
  select pg_catalog.jsonb_build_object(
    'table', p_table, 'rowId', p_row::text, 'revision', '1',
    'digest', repeat('a', 64), 'partitionKey', p_pkey,
    'startDate', p_start::text, 'endDateExclusive', p_end::text,
    'amountMinor', 5000)
$$;

create function pg_temp.test_doc(
  p_org uuid, p_origin date, p_cycle integer, p_horizon integer,
  p_start date, p_end date, p_days integer,
  p_currency text, p_tz text, p_def uuid, p_channel uuid, p_branch uuid,
  p_sources jsonb, p_assumptions jsonb,
  p_low integer, p_high integer
) returns jsonb
language sql stable as $$
  select pg_catalog.jsonb_build_object(
    'organizationId', p_org::text,
    'scheduleOriginDate', p_origin::text,
    'cycleIndex', p_cycle,
    'horizonMonths', p_horizon,
    'startDate', p_start::text,
    'endDateExclusive', p_end::text,
    'issuedAt', '2030-01-02T00:00:00Z',
    'sourceCutoffDate', '2030-01-01',
    'timeZone', p_tz,
    'currency', p_currency,
    'metricKey', 'revenue.gross',
    'scopePartitions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'partitionKey', 'pk-' || substring(p_org::text, 1, 8),
        'channelId', p_channel::text,
        'branchId', p_branch::text,
        'metricDefinitionId', p_def::text,
        'dimensionsDigest', 'empty',
        'periodTimezone', p_tz)),
    'baselineWindow', pg_catalog.jsonb_build_object(
      'startDate', '2029-12-01', 'endDateExclusive', '2030-01-01'),
    'monthlyLowMinor', p_low,
    'monthlyHighMinor', p_high,
    'points', test_points(p_start, p_days),
    'sources', p_sources,
    'actionAssumptions', p_assumptions,
    'limitations', pg_catalog.jsonb_build_array('Seeded capacity note.'))
$$;

create temp table test_docs (name text primary key, doc jsonb);

-- Temp fixtures are owned by the connecting role; the locked-down roles used
-- below need explicit read access or every RPC denial test would pass for the
-- wrong reason (temp-table 42501 instead of the intended RPC/table denial).
grant select on test_docs to authenticated, service_role;

insert into test_docs (name, doc) values
  ('doc-a-h1', test_doc(
    'a1000000-0000-4000-8000-000000000021'::uuid, '2030-01-01'::date, 0, 1,
    '2030-01-01'::date, '2030-02-01'::date, 31,
    'AED', 'Asia/Dubai',
    (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
    null, null,
    jsonb_build_array(test_source('normalized_metrics',
      'a1000000-0000-4000-8000-000000000061'::uuid, 'pk-a1000000',
      '2029-12-01'::date, '2030-01-01'::date)),
    '[]'::jsonb, 31000, 37200)),
  ('doc-b-h1', test_doc(
    'a1000000-0000-4000-8000-000000000022'::uuid, '2030-01-01'::date, 0, 1,
    '2030-01-01'::date, '2030-02-01'::date, 31,
    'aed', 'Asia/Dubai',
    (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
    null, null,
    jsonb_build_array(test_source('normalized_metrics',
      'a1000000-0000-4000-8000-000000000062'::uuid, 'pk-a1000000',
      '2029-12-01'::date, '2030-01-01'::date)),
    '[]'::jsonb, 31000, 37200)),
  ('doc-a-h3-campaign', test_doc(
    'a1000000-0000-4000-8000-000000000021'::uuid, '2030-01-01'::date, 0, 3,
    '2030-01-01'::date, '2030-04-01'::date, 90,
    'AED', 'Asia/Dubai',
    (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
    null, null,
    jsonb_build_array(test_source('normalized_metrics',
      'a1000000-0000-4000-8000-000000000061'::uuid, 'pk-a1000000',
      '2029-12-01'::date, '2030-01-01'::date)),
    jsonb_build_array(jsonb_build_object(
      'sourceKind', 'campaign_proposal', 'sourceId', 'src-1',
      'sourceRevision', 'rev-1',
      'citedFindingId', 'a1000000-0000-4000-8000-000000000081',
      'lowFraction', 0.1, 'highFraction', 0.3)),
    93000, 111600)),
  ('doc-a-h6-growth', test_doc(
    'a1000000-0000-4000-8000-000000000021'::uuid, '2030-01-01'::date, 0, 6,
    '2030-01-01'::date, '2030-07-01'::date, 181,
    'AED', 'Asia/Dubai',
    (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
    null, null,
    jsonb_build_array(test_source('normalized_metrics',
      'a1000000-0000-4000-8000-000000000061'::uuid, 'pk-a1000000',
      '2029-12-01'::date, '2030-01-01'::date)),
    jsonb_build_array(jsonb_build_object(
      'sourceKind', 'growth_insight', 'sourceId', 'src-2',
      'sourceRevision', 'rev-2',
      'citedFindingId', 'a1000000-0000-4000-8000-000000000082',
      'lowFraction', 0.0, 'highFraction', 0.2)),
    186000, 223200)),
  ('doc-a-h12-unknown', test_doc(
    'a1000000-0000-4000-8000-000000000021'::uuid, '2030-01-01'::date, 0, 12,
    '2030-01-01'::date, '2031-01-01'::date, 365,
    'AED', 'Asia/Dubai',
    (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
    null, null,
    jsonb_build_array(test_source('normalized_metrics',
      'a1000000-0000-4000-8000-000000000061'::uuid, 'pk-a1000000',
      '2029-12-01'::date, '2030-01-01'::date)),
    jsonb_build_array(jsonb_build_object(
      'sourceKind', 'mystery_kind', 'sourceId', 'src-3',
      'sourceRevision', 'rev-3',
      'citedFindingId', 'a1000000-0000-4000-8000-000000000083',
      'lowFraction', 0.0, 'highFraction', 0.0)),
    372000, 446400));

-- Failure-identity documents: cycles 5..18 on org A, horizon 1.
insert into test_docs (name, doc)
select 'fail-' || s.cycle::text, test_doc(
    'a1000000-0000-4000-8000-000000000021'::uuid, '2030-01-01'::date, s.cycle, 1,
    s.start_date, s.end_date, s.days,
    'AED', 'Asia/Dubai',
    (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
    null, null,
    jsonb_build_array(test_source('normalized_metrics',
      'a1000000-0000-4000-8000-000000000061'::uuid, 'pk-a1000000',
      '2029-12-01'::date, '2030-01-01'::date)),
    '[]'::jsonb, 31000, 37200)
from (values
  (5, '2030-06-01'::date, '2030-07-01'::date, 30),
  (6, '2030-07-01'::date, '2030-08-01'::date, 31),
  (7, '2030-08-01'::date, '2030-09-01'::date, 31),
  (8, '2030-09-01'::date, '2030-10-01'::date, 30),
  (9, '2030-10-01'::date, '2030-11-01'::date, 31),
  (10, '2030-11-01'::date, '2030-12-01'::date, 30),
  (11, '2030-12-01'::date, '2031-01-01'::date, 31),
  (12, '2031-01-01'::date, '2031-02-01'::date, 31),
  (13, '2031-02-01'::date, '2031-03-01'::date, 28),
  (14, '2031-03-01'::date, '2031-04-01'::date, 31),
  (15, '2031-04-01'::date, '2031-05-01'::date, 30),
  (16, '2031-05-01'::date, '2031-06-01'::date, 31),
  (17, '2031-06-01'::date, '2031-07-01'::date, 30),
  (18, '2031-07-01'::date, '2031-08-01'::date, 31),
  (19, '2031-08-01'::date, '2031-09-01'::date, 31),
  (20, '2031-09-01'::date, '2031-10-01'::date, 30),
  (21, '2031-10-01'::date, '2031-11-01'::date, 31)
) as s (cycle, start_date, end_date, days);

-- Ledger-bound documents: exact-range cross-tenant (cycle 23), exact-range
-- happy path (cycle 24), exact-range partial rejection (cycle 25), and the
-- pinned zero-source rule (cycle 22: an empty sources array is valid).
insert into test_docs (name, doc) values
  ('fail-23', test_doc(
    'a1000000-0000-4000-8000-000000000021'::uuid, '2030-01-01'::date, 23, 1,
    '2031-12-01'::date, '2032-01-01'::date, 31,
    'AED', 'Asia/Dubai',
    (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
    null, null,
    jsonb_build_array(test_source('exact_range_metric_observations',
      'b2000000-0000-4000-8000-000000000109'::uuid, 'pk-a1000000',
      '2029-12-01'::date, '2030-01-01'::date)),
    '[]'::jsonb, 31000, 37200)),
  ('doc-a-h1-exact', test_doc(
    'a1000000-0000-4000-8000-000000000021'::uuid, '2030-01-01'::date, 24, 1,
    '2032-01-01'::date, '2032-02-01'::date, 31,
    'AED', 'Asia/Dubai',
    (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
    null, null,
    jsonb_build_array(test_source('exact_range_metric_observations',
      'a2000000-0000-4000-8000-000000000119'::uuid, 'pk-a1000000',
      '2029-12-01'::date, '2030-01-01'::date)),
    '[]'::jsonb, 31000, 37200)),
  ('fail-25', test_doc(
    'a1000000-0000-4000-8000-000000000021'::uuid, '2030-01-01'::date, 25, 1,
    '2032-02-01'::date, '2032-03-01'::date, 29,
    'AED', 'Asia/Dubai',
    (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
    null, null,
    jsonb_build_array(test_source('exact_range_metric_observations',
      'a2000000-0000-4000-8000-000000000120'::uuid, 'pk-a1000000',
      '2029-12-01'::date, '2030-01-01'::date)),
    '[]'::jsonb, 31000, 37200)),
  ('doc-a-h1-empty', test_doc(
    'a1000000-0000-4000-8000-000000000021'::uuid, '2030-01-01'::date, 22, 1,
    '2031-11-01'::date, '2031-12-01'::date, 30,
    'AED', 'Asia/Dubai',
    (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
    null, null,
    '[]'::jsonb,
    '[]'::jsonb, 31000, 37200));

-- Contract: the table, its identity, its locks ---------------------------------

select extensions.has_table(
  'public', 'organization_growth_projections', 'the projection table exists');
select extensions.columns_are(
  'public', 'organization_growth_projections',
  array['id', 'organization_id', 'schedule_origin_date', 'cycle_index',
        'horizon_months', 'period_start', 'period_end_exclusive', 'issued_at',
        'source_cutoff_date', 'timezone', 'currency', 'metric_key',
        'scope_digest', 'input_digest', 'document_version', 'method_version',
        'requires_growth_read', 'requires_campaign_read', 'frozen_document',
        'created_at'],
  'the D04 column contract holds exactly');
select extensions.has_pk(
  'public', 'organization_growth_projections', 'projections carry a primary key');
select extensions.col_is_unique(
  'public', 'organization_growth_projections',
  array['organization_id', 'horizon_months', 'cycle_index'],
  'one original per organization, horizon and cycle');
select extensions.has_index(
  'public', 'organization_growth_projections',
  'organization_growth_projections_active_period_idx',
  'the active-period lookup is indexed');
select extensions.is(
  (select count(*)::bigint from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'organization_growth_projections'
      and relation.relrowsecurity
      and relation.relforcerowsecurity),
  1::bigint,
  'row level security is enabled and forced on projections');
select extensions.is(
  (select count(*)::bigint from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_growth_projections'
      and cmd <> 'SELECT'),
  0::bigint,
  'no write policy exists: table writes fail closed');
select extensions.is(
  (select count(*)::bigint from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_growth_projections'),
  1::bigint,
  'exactly one read policy guards projections');
select extensions.has_trigger(
  'public', 'organization_growth_projections',
  'organization_growth_projections_refuse_update',
  'the immutability trigger is attached');
select extensions.ok(
  extensions.has_table_privilege(
    'authenticated', 'public.organization_growth_projections', 'SELECT'),
  'members hold SELECT and nothing else');
select extensions.ok(
  not extensions.has_table_privilege(
    'authenticated', 'public.organization_growth_projections', 'INSERT'),
  'members hold no INSERT');
select extensions.ok(
  not extensions.has_table_privilege(
    'authenticated', 'public.organization_growth_projections', 'UPDATE'),
  'members hold no UPDATE');
select extensions.ok(
  not extensions.has_table_privilege(
    'authenticated', 'public.organization_growth_projections', 'DELETE'),
  'members hold no DELETE');
select extensions.ok(
  not extensions.has_table_privilege(
    'service_role', 'public.organization_growth_projections', 'INSERT'),
  'the worker holds no direct INSERT: it must use the RPC');
select extensions.ok(
  not extensions.has_table_privilege(
    'service_role', 'public.organization_growth_projections', 'UPDATE'),
  'the worker holds no direct UPDATE');
select extensions.ok(
  not extensions.has_table_privilege(
    'service_role', 'public.organization_growth_projections', 'DELETE'),
  'the worker holds no direct DELETE: no retention path exists');
select extensions.ok(
  not extensions.has_table_privilege(
    'anon', 'public.organization_growth_projections', 'SELECT'),
  'anonymous callers hold no grant at all');

-- Contract: the publication RPC --------------------------------------------------

select extensions.has_function(
  'public', 'publish_organization_growth_projection',
  array['uuid', 'jsonb', 'uuid'],
  'the publication RPC exists');
select extensions.is(
  (select prosecdef from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'publish_organization_growth_projection'),
  true,
  'the RPC runs as definer behind revoked execute');
select extensions.ok(
  extensions.has_function_privilege(
    'service_role',
    'public.publish_organization_growth_projection(uuid, jsonb, uuid)',
    'EXECUTE'),
  'only the worker role may execute the RPC');
select extensions.ok(
  not extensions.has_function_privilege(
    'authenticated',
    'public.publish_organization_growth_projection(uuid, jsonb, uuid)',
    'EXECUTE'),
  'members cannot execute the RPC, owner included');
select extensions.ok(
  not extensions.has_function_privilege(
    'anon',
    'public.publish_organization_growth_projection(uuid, jsonb, uuid)',
    'EXECUTE'),
  'anonymous callers cannot execute the RPC');

-- Absence: nothing stored, nothing visible ---------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';

select extensions.is(
  (select count(*)::bigint from public.organization_growth_projections),
  0::bigint,
  'before publication the member reads no projection');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select doc from test_docs where name = 'doc-a-h1'),
    'a1000000-0000-4000-8000-000000000071'::uuid)$_$,
  '42501', null,
  'every authenticated role is denied the RPC');

reset role;

-- Service publication -------------------------------------------------------------
--
-- service_role may EXECUTE the RPC but holds no table grant, so every call
-- below returns RPC outputs only. Anything read back from the table happens
-- after reset role as the owner; the captures bridge the two.

set local role service_role;

select extensions.is(
  (select published from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select doc from test_docs where name = 'doc-a-h1'),
    'a1000000-0000-4000-8000-000000000071'::uuid)),
  true,
  'the first publication stores the original');

select extensions.ok(
  (select digest from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select doc from test_docs where name = 'doc-a-h1'),
    'a1000000-0000-4000-8000-000000000071'::uuid))
  ~ '^[0-9a-f]{64}$',
  'the replay returns the server-computed canonical digest');

select extensions.is(
  (select published from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select doc from test_docs where name = 'doc-a-h1'),
    'a1000000-0000-4000-8000-000000000071'::uuid)),
  false,
  'the same identity replays instead of inserting');

create temp table test_replay_h1 as
select * from public.publish_organization_growth_projection(
  'a1000000-0000-4000-8000-000000000021'::uuid,
  (select doc from test_docs where name = 'doc-a-h1'),
  'a1000000-0000-4000-8000-000000000071'::uuid);

create temp table test_replay_changed as
select * from public.publish_organization_growth_projection(
  'a1000000-0000-4000-8000-000000000021'::uuid,
  (select doc || '{"monthlyHighMinor": 99999}'::jsonb from test_docs where name = 'doc-a-h1'),
  'a1000000-0000-4000-8000-000000000071'::uuid);

reset role;

select extensions.is(
  (select published from test_replay_h1),
  false,
  'the captured replay confirms published=false');

select extensions.is(
  (select projection_id from test_replay_h1),
  (select id from public.organization_growth_projections
    where organization_id = 'a1000000-0000-4000-8000-000000000021'::uuid
      and horizon_months = 1 and cycle_index = 0),
  'the replay returns the original identity');

select extensions.is(
  (select digest from test_replay_changed),
  (select input_digest from public.organization_growth_projections
    where organization_id = 'a1000000-0000-4000-8000-000000000021'::uuid
      and horizon_months = 1 and cycle_index = 0),
  'a changed candidate cannot move the stored digest');

select extensions.is(
  (select frozen_document ->> 'monthlyHighMinor'
    from public.organization_growth_projections
    where organization_id = 'a1000000-0000-4000-8000-000000000021'::uuid
      and horizon_months = 1 and cycle_index = 0),
  '37200',
  'a changed candidate cannot move the stored points');

-- Rejection matrix ------------------------------------------------------------------
--
-- Each case uses a fresh cycle so a stored replay can never mask the error.

set local role service_role;

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select doc - 'scopePartitions' from test_docs where name = 'fail-5'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR01', null,
  'a malformed envelope is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select doc from test_docs where name = 'doc-b-h1'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR02', null,
  'a document naming another tenant is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select pg_catalog.jsonb_set(doc, '{scopePartitions,0,channelId}',
       '"a1000000-0000-4000-8000-000000000032"') from test_docs where name = 'fail-6'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR02', null,
  'a cross-tenant channel reference is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select pg_catalog.jsonb_set(doc, '{scopePartitions,0,branchId}',
       '"a1000000-0000-4000-8000-000000000041"') from test_docs where name = 'fail-7'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR02', null,
  'a cross-tenant branch reference is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select pg_catalog.jsonb_set(doc, '{scopePartitions,0,metricDefinitionId}',
       '"a1000000-0000-4000-8000-000000000051"') from test_docs where name = 'fail-8'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR02', null,
  'a cross-tenant metric definition is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select pg_catalog.jsonb_set(doc, '{sources,0,rowId}',
       '"a1000000-0000-4000-8000-000000000062"') from test_docs where name = 'fail-9'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR02', null,
  'a cross-tenant source observation is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select pg_catalog.jsonb_set(doc, '{sources,0,rowId}',
       '"a1000000-0000-4000-8000-000000000063"') from test_docs where name = 'fail-10'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR01', null,
  'an estimated observation never becomes recorded revenue');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select pg_catalog.jsonb_set(doc, '{sources,0,rowId}',
       '"a1000000-0000-4000-8000-000000000064"') from test_docs where name = 'fail-11'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR01', null,
  'a superseded observation is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select pg_catalog.jsonb_set(doc, '{sources,0,rowId}',
       '"a1000000-0000-4000-8000-000000000066"') from test_docs where name = 'fail-12'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR01', null,
  'evidence created after issue is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select pg_catalog.jsonb_set(doc, '{sources,0,rowId}',
       '"a1000000-0000-4000-8000-000000000067"') from test_docs where name = 'fail-13'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR01', null,
  'a mismatched source currency is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select pg_catalog.jsonb_set(doc, '{sources,0,table}',
       '"campaign_proposals"') from test_docs where name = 'fail-14'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR01', null,
  'an unadmitted source table is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select pg_catalog.jsonb_set(doc, '{sources,0,rowId}',
       '"a1000000-0000-4000-8000-000000000099"') from test_docs where name = 'fail-15'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR01', null,
  'a missing source row is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select doc || '{"monthlyLowMinor": 99999}'::jsonb from test_docs where name = 'fail-16'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR05', null,
  'an inverted monthly range is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select pg_catalog.jsonb_set(doc, '{points,1,lowMinor}', '99999999')
       from test_docs where name = 'fail-17'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR05', null,
  'an inverted point range is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select doc || '{"currency": "AE"}'::jsonb from test_docs where name = 'fail-18'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR01', null,
  'an invalid currency is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select pg_catalog.jsonb_set(doc, '{sources,0,startDate}',
       '"2029-12-15"') from test_docs where name = 'fail-19'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR01', null,
  'a source window misstating the ledger is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select pg_catalog.jsonb_set(doc, '{sources,0,amountMinor}', '5001')
       from test_docs where name = 'fail-20'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR01', null,
  'a source amount misstating the ledger is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select pg_catalog.jsonb_set(doc, '{sources,0,revision}', '"2"')
       from test_docs where name = 'fail-21'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR01', null,
  'a source revision misstating the ledger is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select doc from test_docs where name = 'fail-23'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR02', null,
  'a cross-tenant exact-range observation is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select doc from test_docs where name = 'fail-25'),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR01', null,
  'a partial exact-range observation is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    test_doc('a1000000-0000-4000-8000-000000000021'::uuid, '2025-11-01'::date, 0, 1,
      '2025-11-01'::date, '2025-12-01'::date, 30,
      'AED', 'Asia/Dubai',
      (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
      null, null, '[]'::jsonb, '[]'::jsonb, 30000, 36000),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR03', null,
  'a period that already started is rejected as hindsight');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    test_doc('a1000000-0000-4000-8000-000000000021'::uuid, '2030-01-01'::date, 1, 1,
      '2030-01-01'::date, '2030-02-01'::date, 31,
      'AED', 'Asia/Dubai',
      (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
      null, null, '[]'::jsonb, '[]'::jsonb, 31000, 37200),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR04', null,
  'off-grid period dates are rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    test_doc('a1000000-0000-4000-8000-000000000021'::uuid, '2030-05-01'::date, 0, 1,
      '2030-05-01'::date, '2030-06-01'::date, 30,
      'AED', 'Asia/Dubai',
      (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
      null, null, '[]'::jsonb, '[]'::jsonb, 31000, 37200),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR04', null,
  'a second schedule origin for one organization is rejected');

select extensions.throws_ok(
  $_$select * from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    test_doc('a1000000-0000-4000-8000-000000000021'::uuid, '2030-01-01'::date, 2, 1,
      '2030-03-01'::date, '2030-04-01'::date, 31,
      'AED', 'America/New_York',
      (select id from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
      null, null, '[]'::jsonb, '[]'::jsonb, 31000, 37200),
    'a1000000-0000-4000-8000-000000000072'::uuid)$_$,
  'PGR04', null,
  'a timezone outside the organization zone is rejected');

-- Permission-derived flags and the second tenant --------------------------------

select extensions.is(
  (select published from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000022'::uuid,
    (select doc from test_docs where name = 'doc-b-h1'),
    'a1000000-0000-4000-8000-000000000072'::uuid)),
  true,
  'the second tenant publishes its own original');

select extensions.is(
  (select published from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select doc from test_docs where name = 'doc-a-h3-campaign'),
    'a1000000-0000-4000-8000-000000000073'::uuid)),
  true,
  'an assumption-backed projection publishes');

select extensions.is(
  (select published from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select doc from test_docs where name = 'doc-a-h6-growth'),
    'a1000000-0000-4000-8000-000000000074'::uuid)),
  true,
  'a growth-backed projection publishes');

select extensions.is(
  (select published from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select doc from test_docs where name = 'doc-a-h12-unknown'),
    'a1000000-0000-4000-8000-000000000075'::uuid)),
  true,
  'an unknown-kind projection publishes under the strictest flags');

select extensions.is(
  (select published from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select doc from test_docs where name = 'doc-a-h1-empty'),
    'a1000000-0000-4000-8000-000000000076'::uuid)),
  true,
  'an empty sources array is valid: no cited observation is still a claim about none');

select extensions.is(
  (select published from public.publish_organization_growth_projection(
    'a1000000-0000-4000-8000-000000000021'::uuid,
    (select doc from test_docs where name = 'doc-a-h1-exact'),
    'a1000000-0000-4000-8000-000000000077'::uuid)),
  true,
  'a ledger-bound exact-range projection publishes');

reset role;

select extensions.is(
  (select currency from public.organization_growth_projections
    where organization_id = 'a1000000-0000-4000-8000-000000000022'::uuid),
  'AED',
  'currency normalizes to uppercase at the boundary');

-- Tenant and permission reads ------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';

select extensions.is(
  (select count(*)::bigint from public.organization_growth_projections),
  6::bigint,
  'a member reads exactly their own organization rows');

select extensions.is(
  (select count(*)::bigint from public.organization_growth_projections
    where organization_id = 'a1000000-0000-4000-8000-000000000022'::uuid),
  0::bigint,
  'a member reads nothing from the other tenant');

select extensions.is(
  (select requires_campaign_read and not requires_growth_read
    from public.organization_growth_projections
    where organization_id = 'a1000000-0000-4000-8000-000000000021'::uuid
      and horizon_months = 3),
  true,
  'a campaign-backed projection requires campaign read');

select extensions.is(
  (select requires_growth_read and not requires_campaign_read
    from public.organization_growth_projections
    where organization_id = 'a1000000-0000-4000-8000-000000000021'::uuid
      and horizon_months = 6),
  true,
  'a growth-backed projection requires growth read');

select extensions.is(
  (select requires_growth_read and requires_campaign_read
    from public.organization_growth_projections
    where organization_id = 'a1000000-0000-4000-8000-000000000021'::uuid
      and horizon_months = 12),
  true,
  'unknown provenance reads as the most restrictive combination');

select extensions.is(
  (select requires_growth_read or requires_campaign_read
    from public.organization_growth_projections
    where organization_id = 'a1000000-0000-4000-8000-000000000021'::uuid
      and horizon_months = 1),
  false,
  'a baseline-only projection needs no extra source permission');

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000002';

select extensions.is(
  (select count(*)::bigint from public.organization_growth_projections),
  1::bigint,
  'the second tenant reads exactly their own row');

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000003';

select extensions.is(
  (select count(*)::bigint from public.organization_growth_projections),
  0::bigint,
  'a nonmember reads no projection');

reset role;

set local role anon;

select extensions.throws_ok(
  $$select * from public.organization_growth_projections$$,
  '42501', null,
  'anonymous callers read no projection');

reset role;

-- Immutability and audit atomicity ----------------------------------------------------

-- Immutability lives in the trigger, not in the absence of a policy: open a
-- momentary permissive UPDATE policy inside this rollback-wrapped suite and
-- prove the trigger still refuses. The policy is dropped two statements
-- later, so production keeps zero write policies.
create policy "test momentary update"
on public.organization_growth_projections for update to authenticated
using (true) with check (true);
grant update on table public.organization_growth_projections to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$update public.organization_growth_projections
    set frozen_document = '{}'::jsonb
    where organization_id = 'a1000000-0000-4000-8000-000000000021'::uuid$$,
  'PGR06', null,
  'the trigger refuses updates even where a policy and grant allow the attempt');

reset role;

revoke update on table public.organization_growth_projections from authenticated;
drop policy "test momentary update" on public.organization_growth_projections;

set local role service_role;

select extensions.throws_ok(
  $$update public.organization_growth_projections
    set frozen_document = '{}'::jsonb
    where organization_id = 'a1000000-0000-4000-8000-000000000021'::uuid$$,
  '42501', null,
  'the worker role holds no direct UPDATE grant');

select extensions.throws_ok(
  $$delete from public.organization_growth_projections
    where organization_id = 'a1000000-0000-4000-8000-000000000021'::uuid$$,
  '42501', null,
  'even the worker role cannot delete a stored projection');

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'a1000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$update public.organization_growth_projections
    set frozen_document = '{}'::jsonb$$,
  '42501', null,
  'members cannot update a stored projection');

reset role;

select extensions.is(
  (select count(*)::bigint from public.organization_growth_projections),
  7::bigint,
  'seven originals are stored and none was altered or lost');

select extensions.is(
  (select count(*)::bigint from public.audit_events
    where event_name = 'organization.growth_projection_published'
      and organization_id = 'a1000000-0000-4000-8000-000000000021'::uuid),
  6::bigint,
  'replays emit no duplicate publication event for the first tenant');

select extensions.is(
  (select count(*)::bigint from public.audit_events
    where event_name = 'organization.growth_projection_published'
      and organization_id = 'a1000000-0000-4000-8000-000000000022'::uuid),
  1::bigint,
  'the second tenant holds exactly one publication event');

select extensions.ok(
  (select event_name = 'organization.growth_projection_published'
      and actor_type = 'system'
      and actor_id is null
      and entity_type = 'growth_projection'
      and entity_id = (select id from public.organization_growth_projections
        where organization_id = 'a1000000-0000-4000-8000-000000000021'::uuid
          and horizon_months = 1 and cycle_index = 0)
      and correlation_id = 'a1000000-0000-4000-8000-000000000071'::uuid
    from public.audit_events
    where correlation_id = 'a1000000-0000-4000-8000-000000000071'::uuid),
  'the publication audit carries the verified envelope');

select extensions.ok(
  (select payload ?& array['periodStart', 'periodEndExclusive', 'horizonMonths',
                           'cycleIndex', 'methodVersion', 'scopeDigest', 'inputDigest']
      and not (payload ?| array['monthlyLowMinor', 'monthlyHighMinor', 'sources',
                                'points', 'actionAssumptions'])
    from public.audit_events
    where correlation_id = 'a1000000-0000-4000-8000-000000000071'::uuid),
  'the audit payload holds period, method and digests only');

-- Concurrent publication: single-session mechanism proofs --------------------------
--
-- True two-session interleaving needs two live connections against applied
-- staging, which this rollback-wrapped suite and its single-connection runner
-- cannot do without staging writes — that run is a recorded gate item (see
-- persistence.md). What one session CAN prove: the RPC takes the
-- organization advisory lock on every call (still held: xact locks release
-- at transaction end and this whole suite is one transaction), and the
-- unique identity key that backstops the lock exists (asserted above via
-- col_is_unique). Gate procedure: open two psql sessions, BEGIN both, call
-- the RPC with one fresh identity in each, COMMIT both, assert one row, one
-- id, one audit event.

select extensions.ok(
  (select count(*) from pg_locks
    where locktype = 'advisory'
      and pid = pg_catalog.pg_backend_pid()
      and granted) >= 1,
  'the publication path holds the organization advisory lock');

-- Trim isolation: the old snapshot lifecycle cannot reach this table ---------------

select extensions.is(
  (select count(*)::bigint from pg_trigger
    where tgrelid = 'public.organization_growth_projections'::regclass
      and not tgisinternal),
  1::bigint,
  'the only trigger on projections is the immutability guard');

select extensions.is(
  (select count(*)::bigint from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname in ('public', 'private')
      and procedure.prosrc ilike '%organization_growth_projections%'
      and procedure.proname not in (
        'publish_organization_growth_projection',
        'read_organization_growth_schedule')),
  0::bigint,
  'no other routine references projections: no trim path exists');

select extensions.finish();

rollback;
