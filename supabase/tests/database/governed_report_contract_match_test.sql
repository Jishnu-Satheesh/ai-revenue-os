begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(9);

-- The guard that decides whether a proposed contract may describe a package.
-- Exercised against a real package with real sheet manifests, because the two
-- things it now does — count sheets, and find one by position — cannot be
-- checked any other way.

insert into auth.users (id) values ('c1000000-0000-4000-8000-000000000001'::uuid);

insert into public.accounts (id, name, slug, created_by)
values ('c1000000-0000-4000-8000-00000000000a'::uuid, 'Contract match agency',
        'fixture-agency-governed-report-contract-match', 'c1000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id)
values ('c1000000-0000-4000-8000-000000000101'::uuid, 'Contract match tenant', 'contract-match-tenant',
        'testing', 'AE', 'AED', 'Asia/Dubai', 'c1000000-0000-4000-8000-000000000001'::uuid,
        'c1000000-0000-4000-8000-00000000000a'::uuid);

insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000101'::uuid,
        'talabat', 'Talabat', 'marketplace', 'c1000000-0000-4000-8000-000000000001'::uuid);

insert into public.branches (id, organization_id, name, slug, timezone, currency)
values ('c1000000-0000-4000-8000-000000000301'::uuid, 'c1000000-0000-4000-8000-000000000101'::uuid,
        'Al Warqa', 'al-warqa', 'Asia/Dubai', 'AED');

insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type,
  declared_content_length, storage_path, upload_expires_at, created_by, correlation_id, fingerprint_version
) values (
  'c1000000-0000-4000-8000-000000000401'::uuid, 'c1000000-0000-4000-8000-000000000101'::uuid,
  'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000301'::uuid,
  'performance_daily', '2026-01-01', '2026-02-28', 'AED', 'Asia/Dubai', 'xlsx',
  'performance.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 4096,
  'c1000000-0000-4000-8000-000000000101/c1000000-0000-4000-8000-000000000201/c1000000-0000-4000-8000-000000000401/1/original/report.xlsx', now() + interval '1 day',
  'c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000501'::uuid, 3
);

-- Two sheets, as every real export the client downloads has. The first is
-- named after the export range, exactly as Talabat names it.
insert into public.integration_report_sheet_manifests (
  organization_id, report_package_id, sheet_position, sheet_name, normalized_sheet_name,
  row_count, populated_cell_count, expanded_bytes, header_candidate_digests
) values
  ('c1000000-0000-4000-8000-000000000101'::uuid, 'c1000000-0000-4000-8000-000000000401'::uuid,
   1, 'Talabat-Jan-Feb-2026-Performanc', 'talabat_jan_feb_2026_performanc', 60, 3480, 8192,
   jsonb_build_array(jsonb_build_object(
     'rowPosition', 1, 'fieldCount', 2,
     'normalizedHeaderDigests', jsonb_build_array(
       encode(extensions.digest('date', 'sha256'), 'hex'),
       encode(extensions.digest('gross_sales', 'sha256'), 'hex'))))),
  ('c1000000-0000-4000-8000-000000000101'::uuid, 'c1000000-0000-4000-8000-000000000401'::uuid,
   2, 'Notes', 'notes', 0, 0, 0, '[]'::jsonb);

create or replace function pg_temp.check_contract(p_document jsonb, p_fingerprint_version integer default null)
returns void language plpgsql as $$
declare
  package_row public.integration_report_packages;
begin
  select * into package_row from public.integration_report_packages
  where id = 'c1000000-0000-4000-8000-000000000401'::uuid;
  -- The stored row cannot be edited: a trigger holds a package's context
  -- immutable once it exists. The guard takes a row value rather than an id, so
  -- older evidence is simulated in memory instead.
  package_row.fingerprint_version := coalesce(p_fingerprint_version, package_row.fingerprint_version);
  perform private.assert_report_contract_matches_package(package_row, p_document);
end;
$$;

create or replace function pg_temp.document(p_extra jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'schemaVersion', 1, 'currency', 'AED', 'outletGrain', 'branch',
    'controls', '[]'::jsonb, 'unmappedFieldDisposition', 'reviewed_ignore',
    'sheets', jsonb_build_array(jsonb_build_object(
      'normalizedSheetName', 'performance',
      'sheetLocator', jsonb_build_object('kind', 'position', 'position', 1),
      'headerRow', 1, 'dataStartRow', 2,
      'allowFormula', false, 'allowMergedCells', false,
      'fields', jsonb_build_array(jsonb_build_object(
        'canonicalField', 'gross_sales', 'sourceHeader', 'gross_sales',
        'parser', 'money', 'financialSign', 'positive', 'required', true))))
  ) || p_extra;
$$;

-- A library-shaped contract: one sheet of two, found by position, under a name
-- the file does not carry. This is the whole point, and it used to be refused.
select extensions.lives_ok(
  $$ select pg_temp.check_contract(pg_temp.document('{"unmappedSheetDisposition":"reviewed_ignore"}'::jsonb)) $$,
  'a contract may describe only the sheet it reads, found by position'
);

select extensions.throws_ok(
  $$ select pg_temp.check_contract(pg_temp.document('{}'::jsonb)) $$,
  '23514', 'report contract does not match its package context',
  'and must still account for every sheet when it has not said otherwise'
);

-- The relaxation is about which sheets must be accounted for, never about
-- whether a claim is checked against the evidence.
select extensions.throws_ok(
  $$ select pg_temp.check_contract(pg_temp.document(jsonb_build_object(
       'unmappedSheetDisposition', 'reviewed_ignore',
       'sheets', jsonb_build_array(
         pg_temp.document('{}'::jsonb) -> 'sheets' -> 0,
         jsonb_set(pg_temp.document('{}'::jsonb) -> 'sheets' -> 0, '{sheetLocator,position}', '9'),
         jsonb_set(pg_temp.document('{}'::jsonb) -> 'sheets' -> 0, '{sheetLocator,position}', '8'))))) $$,
  '23514', 'report contract does not match its package context',
  'a contract may never describe more sheets than the file has'
);

select extensions.throws_ok(
  $$ select pg_temp.check_contract(pg_temp.document(jsonb_build_object(
       'unmappedSheetDisposition', 'reviewed_ignore',
       'sheets', jsonb_build_array(jsonb_set(pg_temp.document('{}'::jsonb) -> 'sheets' -> 0, '{sheetLocator,position}', '9'))))) $$,
  '23514', 'report contract sheet does not match package structure',
  'a position the file does not have is refused, not rounded to the nearest sheet'
);

select extensions.throws_ok(
  $$ select pg_temp.check_contract(pg_temp.document(jsonb_build_object(
       'unmappedSheetDisposition', 'reviewed_ignore',
       'sheets', jsonb_build_array(jsonb_set(pg_temp.document('{}'::jsonb) -> 'sheets' -> 0, '{headerRow}', '4'))))) $$,
  '23514', 'report contract header row was not profiled',
  'a header row nobody profiled is refused'
);

select extensions.throws_ok(
  $$ select pg_temp.check_contract(pg_temp.document(jsonb_build_object(
       'unmappedSheetDisposition', 'reviewed_ignore',
       'sheets', jsonb_build_array(jsonb_set(pg_temp.document('{}'::jsonb) -> 'sheets' -> 0,
         '{fields,0,sourceHeader}', '"invented_column"'))))) $$,
  '23514', 'report contract source header was not profiled',
  'a column the file does not carry is refused'
);

-- Matching by name still works, and still finds the sheet by its real name.
select extensions.lives_ok(
  $$ select pg_temp.check_contract(pg_temp.document(jsonb_build_object(
       'unmappedSheetDisposition', 'reviewed_ignore',
       'sheets', jsonb_build_array(
         jsonb_set(jsonb_set(pg_temp.document('{}'::jsonb) -> 'sheets' -> 0, '{sheetLocator}', 'null'::jsonb),
           '{normalizedSheetName}', '"talabat_jan_feb_2026_performanc"'))))) $$,
  'a contract with no locator is still matched by name'
);

select extensions.throws_ok(
  $$ select pg_temp.check_contract(pg_temp.document(jsonb_build_object(
       'unmappedSheetDisposition', 'reviewed_ignore', 'currency', 'SAR'))) $$,
  '23514', 'report contract does not match its package context',
  'a currency the package did not declare is refused'
);

select extensions.throws_ok(
  $$ select pg_temp.check_contract(pg_temp.document('{"unmappedSheetDisposition":"reviewed_ignore"}'::jsonb), 1) $$,
  '23514', 'report package uses legacy profile evidence',
  'evidence older than the safe header digests is still refused'
);

select * from extensions.finish();

rollback;
