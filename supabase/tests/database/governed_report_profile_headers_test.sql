begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(13);

-- Profiling completion, exercised against a real package with a real lease.
-- Three things are being pinned: that a sheet may offer several candidate
-- header rows, that the column names it found are kept rather than discarded,
-- and that a rotated statement's candidate -- filed at the reserved row
-- position zero, outside the range a contract may name -- can be stored at all.
-- It could not be until 2026-09-07: the contract gate knew about position zero
-- and the function that writes the profile did not, so the client's own profit
-- and loss failed on upload. See ADR 0045.

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

-- A second package, because completing the first moves it past `profiling` and
-- every later call against it returns null instead of deciding anything. This
-- one carries the rotated statement.
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type,
  declared_content_length, storage_path, upload_expires_at, created_by, correlation_id, status
) values (
  'd1000000-0000-4000-8000-000000000402'::uuid, 'd1000000-0000-4000-8000-000000000101'::uuid,
  'd1000000-0000-4000-8000-000000000201'::uuid, 'd1000000-0000-4000-8000-000000000301'::uuid,
  'profit_and_loss_monthly', '2026-05-01', '2026-08-31', 'AED', 'Asia/Dubai', 'pdf',
  'profit-and-loss.pdf', 'application/pdf', 4096,
  'd1000000-0000-4000-8000-000000000101/d1000000-0000-4000-8000-000000000201/d1000000-0000-4000-8000-000000000402/1/original/report.pdf',
  now() + interval '1 day', 'd1000000-0000-4000-8000-000000000001'::uuid,
  'd1000000-0000-4000-8000-000000000502'::uuid, 'profiling'
);

insert into private.integration_report_profile_operations (
  organization_id, report_package_id, idempotency_key, claim_token, lease_expires_at
) values (
  'd1000000-0000-4000-8000-000000000101'::uuid, 'd1000000-0000-4000-8000-000000000402'::uuid,
  'profile-headers-fixture-key-0002', 'd1000000-0000-4000-8000-000000000602'::uuid, now() + interval '1 hour'
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

create or replace function pg_temp.complete_rotated(p_sheets jsonb) returns jsonb
language sql as $fn$
  select public.complete_governed_report_package_profiling(
    'd1000000-0000-4000-8000-000000000101'::uuid,
    'd1000000-0000-4000-8000-000000000402'::uuid,
    'd1000000-0000-4000-8000-000000000602'::uuid,
    repeat('d', 64), repeat('e', 64), repeat('f', 64), p_sheets);
$fn$;

-- A statement the profiler read twice over: five row candidates capped as
-- always, and the column that names its accounts appended beside them at the
-- reserved position zero. Six in all, which is the shape the profiler actually
-- produces for a profit and loss.
create or replace function pg_temp.rotated_sheets() returns jsonb
language sql immutable as $fn$
  select pg_temp.sheets(
    jsonb_build_array(
      pg_temp.candidate(1, array['nostaza_restaurant_llc']),
      pg_temp.candidate(2, array['profit_and_loss']),
      pg_temp.candidate(3, array['basis_accrual']),
      pg_temp.candidate(4, array['may_2026', 'jun_2026', 'jul_2026', 'aug_2026']),
      pg_temp.candidate(5, array['account', 'total']),
      pg_temp.candidate(0, array['daily_sales', 'food_items', 'gross_profit', 'report_period'])),
    jsonb_build_array(
      pg_temp.names(0, array['daily_sales', 'food_items', 'gross_profit', 'report_period'])));
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

-- The cap is on real rows, and it has not moved. Six of them is still six too
-- many; admitting the rotated candidate did not buy an extra ordinary one.
select extensions.throws_ok(
  $$ select pg_temp.complete(pg_temp.sheets(
       jsonb_build_array(
         pg_temp.candidate(1, array['sales']), pg_temp.candidate(2, array['sales']),
         pg_temp.candidate(3, array['sales']), pg_temp.candidate(4, array['sales']),
         pg_temp.candidate(5, array['sales']), pg_temp.candidate(6, array['sales'])),
       '[]'::jsonb)) $$,
  '22023', 'report sheet manifest is invalid',
  'six candidates at real row positions are still refused'
);

-- A sheet has one first column, so it has at most one rotated candidate.
select extensions.throws_ok(
  $$ select pg_temp.complete(pg_temp.sheets(
       jsonb_build_array(
         pg_temp.candidate(0, array['sales', 'report_period']),
         pg_temp.candidate(0, array['orders', 'report_period'])),
       '[]'::jsonb)) $$,
  '22023', 'report sheet manifest is invalid',
  'a second rotated candidate is refused'
);

-- Stricter than what it replaces: a missing row position used to coalesce to
-- zero and be refused for being out of range. Now zero is a real position, so
-- the absence has to be refused on its own account rather than by accident.
select extensions.throws_ok(
  $$ select pg_temp.complete(pg_temp.sheets(
       jsonb_build_array(jsonb_build_object(
         'fieldCount', 1, 'digest', repeat('a', 64),
         'normalizedHeaderDigests', jsonb_build_array(repeat('b', 64)))),
       '[]'::jsonb)) $$,
  '22023', 'report sheet manifest is invalid',
  'a candidate carrying no row position at all is refused'
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

-- The rotated statement, on its own package.
set local role service_role;

select extensions.lives_ok(
  $$ select pg_temp.complete_rotated(pg_temp.rotated_sheets()) $$,
  'a rotated statement may file its candidate at the reserved row position'
);

reset role;

select extensions.is(
  (select jsonb_array_length(header_candidate_digests) from public.integration_report_sheet_manifests
   where report_package_id = 'd1000000-0000-4000-8000-000000000402'::uuid),
  6, 'five row candidates and the rotated one beside them are all kept'
);

-- The point of keeping it. The contract gate reads the rotated candidate by
-- this position, so a manifest that dropped it would leave a statement
-- unrecognisable no matter what a contract declared.
select extensions.is(
  (select count(*) from public.integration_report_sheet_manifests m,
     jsonb_array_elements(m.header_candidate_digests) c
   where m.report_package_id = 'd1000000-0000-4000-8000-000000000402'::uuid
     and (c ->> 'rowPosition')::integer = 0),
  1::bigint, 'the rotated candidate is stored where the contract gate looks for it'
);

select * from extensions.finish();

rollback;
