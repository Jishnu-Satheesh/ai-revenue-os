begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(7);

-- Profiling completion, exercised against a real package with a real lease.
-- Two things are being pinned: that a sheet may offer several candidate header
-- rows, and that the column names it found are kept rather than discarded.

insert into auth.users (id) values ('d1000000-0000-4000-8000-000000000001'::uuid);

insert into public.accounts (id, name, slug, created_by)
values ('d1000000-0000-4000-8000-00000000000a'::uuid, 'Profile headers agency',
        'fixture-agency-governed-report-profile-headers', 'd1000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id)
values ('d1000000-0000-4000-8000-000000000101'::uuid, 'Profile headers tenant', 'profile-headers-tenant',
        'testing', 'AE', 'AED', 'Asia/Dubai', 'd1000000-0000-4000-8000-000000000001'::uuid,
        'd1000000-0000-4000-8000-00000000000a'::uuid);

insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('d1000000-0000-4000-8000-000000000201'::uuid, 'd1000000-0000-4000-8000-000000000101'::uuid,
        'noon', 'Noon', 'marketplace', 'd1000000-0000-4000-8000-000000000001'::uuid);

insert into public.branches (id, organization_id, name, slug, timezone, currency)
values ('d1000000-0000-4000-8000-000000000301'::uuid, 'd1000000-0000-4000-8000-000000000101'::uuid,
        'Al Warqa', 'al-warqa-profile-headers', 'Asia/Dubai', 'AED');

insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type,
  declared_content_length, storage_path, upload_expires_at, created_by, correlation_id, status
) values (
  'd1000000-0000-4000-8000-000000000401'::uuid, 'd1000000-0000-4000-8000-000000000101'::uuid,
  'd1000000-0000-4000-8000-000000000201'::uuid, 'd1000000-0000-4000-8000-000000000301'::uuid,
  'sales_period_summary', '2026-01-01', '2026-02-28', 'AED', 'Asia/Dubai', 'xlsx',
  'noon.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 4096,
  'd1000000-0000-4000-8000-000000000101/d1000000-0000-4000-8000-000000000201/d1000000-0000-4000-8000-000000000401/1/original/report.xlsx',
  now() + interval '1 day', 'd1000000-0000-4000-8000-000000000001'::uuid,
  'd1000000-0000-4000-8000-000000000501'::uuid, 'profiling'
);

insert into private.integration_report_profile_operations (
  organization_id, report_package_id, idempotency_key, claim_token, lease_expires_at
) values (
  'd1000000-0000-4000-8000-000000000101'::uuid, 'd1000000-0000-4000-8000-000000000401'::uuid,
  'profile-headers-fixture-key-0001', 'd1000000-0000-4000-8000-000000000601'::uuid, now() + interval '1 hour'
);

create or replace function pg_temp.candidate(p_row integer, p_headers text[]) returns jsonb
language sql immutable as $fn$
  select jsonb_build_object(
    'rowPosition', p_row,
    'fieldCount', array_length(p_headers, 1),
    'digest', encode(extensions.digest(array_to_string(p_headers, '|'), 'sha256'), 'hex'),
    'normalizedHeaderDigests', (
      select jsonb_agg(encode(extensions.digest(h, 'sha256'), 'hex')) from unnest(p_headers) h));
$fn$;

create or replace function pg_temp.names(p_row integer, p_headers text[]) returns jsonb
language sql immutable as $fn$
  select jsonb_build_object('rowPosition', p_row, 'normalizedHeaders', to_jsonb(p_headers));
$fn$;

create or replace function pg_temp.sheets(p_candidates jsonb, p_names jsonb) returns jsonb
language sql immutable as $fn$
  select jsonb_build_array(jsonb_build_object(
    'sheetPosition', 1, 'sheetName', 'sales data', 'normalizedSheetName', 'sales_data',
    'rowCount', 4, 'populatedCellCount', 12, 'expandedBytes', 2048,
    'headerCandidateDigests', p_candidates, 'headerCandidates', p_names,
    'hasFormula', false, 'hasMergedCells', false, 'hasRepeatedHeader', false));
$fn$;

create or replace function pg_temp.complete(p_sheets jsonb) returns jsonb
language sql as $fn$
  select public.complete_governed_report_package_profiling(
    'd1000000-0000-4000-8000-000000000101'::uuid,
    'd1000000-0000-4000-8000-000000000401'::uuid,
    'd1000000-0000-4000-8000-000000000601'::uuid,
    repeat('a', 64), repeat('b', 64), repeat('c', 64), p_sheets);
$fn$;

-- Noon's shape: a field row, then two description rows, then the figures.
-- Three candidates, which the version this replaces refused outright.
create or replace function pg_temp.noon_sheets() returns jsonb
language sql immutable as $fn$
  select pg_temp.sheets(
    jsonb_build_array(
      pg_temp.candidate(1, array['average_order_value', 'sales', 'successful_orders']),
      pg_temp.candidate(2, array['average_order_value', 'sales', 'successful_orders']),
      pg_temp.candidate(3, array['average_order_value', 'sales', 'successful_orders'])),
    -- Three candidate rows, two of them named. Noon's third row is rich text
    -- the profiler will not keep, which is the normal shape rather than a fault.
    jsonb_build_array(
      pg_temp.names(1, array['average_order_value', 'sales', 'successful_orders']),
      pg_temp.names(2, array['average_order_value', 'sales', 'successful_orders'])));
$fn$;

set local role service_role;

select extensions.throws_ok(
  $$ select pg_temp.complete(pg_temp.sheets(
       jsonb_build_array(pg_temp.candidate(1, array['sales'])),
       jsonb_build_array(pg_temp.names(1, array['Sales Report; drop table'])))) $$,
  '22023', 'report sheet manifest is invalid',
  'a header that is not a normalized identifier is refused'
);

-- Fewer names than candidates is the normal case, not an error. A CSV row of
-- figures becomes a candidate because every cell is a string, and the profiler
-- refuses to keep its text.
select extensions.throws_ok(
  $$ select pg_temp.complete(pg_temp.sheets(
       jsonb_build_array(pg_temp.candidate(1, array['sales'])),
       jsonb_build_array(pg_temp.names(4, array['sales'])))) $$,
  '22023', 'report sheet manifest is invalid',
  'a named row with no profiled candidate behind it is refused'
);

reset role;

-- Only now the accepted shape, which moves the package on for good.
set local role service_role;

select extensions.lives_ok(
  $$ select pg_temp.complete(pg_temp.noon_sheets()) $$,
  'a sheet may offer several candidate header rows'
);

reset role;

select extensions.is(
  (select jsonb_array_length(header_candidate_digests) from public.integration_report_sheet_manifests
   where report_package_id = 'd1000000-0000-4000-8000-000000000401'::uuid),
  3, 'all three candidates are kept, not just the first'
);

-- Fewer names than candidates is the normal case, not an error. A CSV row of
-- figures becomes a candidate because every cell is a string, and the profiler
-- refuses to keep its text.
select extensions.is(
  (select jsonb_array_length(header_candidates) from public.integration_report_sheet_manifests
   where report_package_id = 'd1000000-0000-4000-8000-000000000401'::uuid),
  2, 'a candidate row may keep its digests and no name'
);

select extensions.is(
  (select header_candidates -> 0 -> 'normalizedHeaders' from public.integration_report_sheet_manifests
   where report_package_id = 'd1000000-0000-4000-8000-000000000401'::uuid),
  '["average_order_value", "sales", "successful_orders"]'::jsonb,
  'the column names an operator has to map are kept, not discarded'
);

select extensions.is(
  (select status from public.integration_report_packages
   where id = 'd1000000-0000-4000-8000-000000000401'::uuid),
  'awaiting_contract', 'the package moves on to await a contract'
);


select * from extensions.finish();

rollback;
