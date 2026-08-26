begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(56);

-- The fenced write path for a daily, weekly, or monthly series. Exercised
-- against a real package with a real lease, because everything interesting
-- here -- the branch timezone, the grain arithmetic, the declared window, the
-- overlap search across both ledgers -- is resolved at execution time and
-- cannot be checked any other way.

select extensions.has_function('public', 'complete_governed_report_package_period_grain_projection', 'the series write path is database-owned');
select extensions.ok(pg_catalog.has_function_privilege('service_role', 'public.complete_governed_report_package_period_grain_projection(uuid,uuid,uuid,uuid,text,jsonb,jsonb,integer)', 'execute'), 'service workers hold the fenced series completion path');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated', 'public.complete_governed_report_package_period_grain_projection(uuid,uuid,uuid,uuid,text,jsonb,jsonb,integer)', 'execute'), 'members cannot write series evidence directly');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.complete_governed_report_package_period_grain_projection(uuid,uuid,uuid,uuid,text,jsonb,jsonb,integer)', 'execute'), 'anonymous callers cannot write series evidence');
select extensions.has_column('public', 'normalized_metrics', 'reconciliation_state', 'the metrics ledger can hold evidence back from a rollup');
select extensions.has_column('public', 'report_projection_lineage', 'normalized_metric_id', 'lineage can point at the metrics ledger');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.normalized_metrics', 'insert'), 'members cannot write the metrics ledger directly');

-- Fixtures ---------------------------------------------------------------------

insert into auth.users (id) values
  ('e5000000-0000-4000-8000-000000000001'::uuid),
  ('e5000000-0000-4000-8000-000000000002'::uuid);
insert into public.accounts (id, name, slug, created_by)
values ('e5000000-0000-4000-8000-000000000101'::uuid, 'Series verifier', 'series-verifier', 'e5000000-0000-4000-8000-000000000001'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by)
values ('e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000101'::uuid, 'Series verifier', 'series-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'e5000000-0000-4000-8000-000000000001'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role)
values ('e5000000-0000-4000-8000-000000000101'::uuid, 'e5000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');

-- The branch sits in a different zone from the organization default the package
-- carries. That is the whole point: `specs/015` section 4.4 buckets a day in the
-- branch's zone, and a package copied from the organization default must not be
-- allowed to shift the outlet's trading day.
insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('e5000000-0000-4000-8000-000000000301'::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid, 'Riyadh outlet', 'riyadh-outlet', 'physical', 'Asia/Riyadh', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('e5000000-0000-4000-8000-000000000401'::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid, 'talabat', 'Talabat', 'marketplace', 'e5000000-0000-4000-8000-000000000001'::uuid);

insert into storage.objects (bucket_id, name, metadata, version)
select 'governed-report-packages',
  'e5000000-0000-4000-8000-000000000201/e5000000-0000-4000-8000-000000000401/' || package_id || '/1/original/report.csv',
  jsonb_build_object('size', 42, 'mimetype', 'text/csv'), 'series-' || ordinal
from (values
  ('e5000000-0000-4000-8000-000000000501', 1), ('e5000000-0000-4000-8000-000000000502', 2),
  ('e5000000-0000-4000-8000-000000000503', 3), ('e5000000-0000-4000-8000-000000000504', 4),
  ('e5000000-0000-4000-8000-000000000505', 5)
) as packages(package_id, ordinal);

insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, storage_object_id, storage_object_version, content_sha256, schema_fingerprint, status,
  upload_expires_at, uploaded_at, profiled_at, created_by, correlation_id
)
select package_id::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid,
  'e5000000-0000-4000-8000-000000000401'::uuid, 'e5000000-0000-4000-8000-000000000301'::uuid,
  report_type, date '2026-01-01', date '2026-01-31', 'AED', 'Asia/Dubai', 'csv', 'report.csv', 'text/csv', 42,
  o.name, o.id, o.version, content_sha256, repeat('b', 64), 'awaiting_projection', now() + interval '1 hour', now(), now(),
  'e5000000-0000-4000-8000-000000000001'::uuid, correlation_id::uuid
from (values
  ('e5000000-0000-4000-8000-000000000501', 'performance_daily', repeat('a', 64), 'e5000000-0000-4000-8000-000000000601'),
  ('e5000000-0000-4000-8000-000000000502', 'performance_daily', repeat('a', 64), 'e5000000-0000-4000-8000-000000000602'),
  ('e5000000-0000-4000-8000-000000000503', 'settlement_total', repeat('c', 64), 'e5000000-0000-4000-8000-000000000603'),
  ('e5000000-0000-4000-8000-000000000504', 'settlement_total', repeat('d', 64), 'e5000000-0000-4000-8000-000000000604'),
  ('e5000000-0000-4000-8000-000000000505', 'performance_daily', repeat('e', 64), 'e5000000-0000-4000-8000-000000000605')
) as p(package_id, report_type, content_sha256, correlation_id)
join storage.objects o on o.bucket_id = 'governed-report-packages'
  and o.name = 'e5000000-0000-4000-8000-000000000201/e5000000-0000-4000-8000-000000000401/' || p.package_id || '/1/original/report.csv';

-- One contract for the daily export, one for the settlement total, so the two
-- declarations can both be bound and active at once.
insert into public.report_contracts (id, organization_id, channel_id, report_type, outlet_grain, created_by)
values
  ('e5000000-0000-4000-8000-000000000701'::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000401'::uuid, 'performance_daily', 'branch', 'e5000000-0000-4000-8000-000000000001'::uuid),
  ('e5000000-0000-4000-8000-000000000711'::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000401'::uuid, 'settlement_total', 'branch', 'e5000000-0000-4000-8000-000000000001'::uuid);

insert into public.report_contract_versions (
  id, organization_id, report_contract_id, report_package_id, version, schema_fingerprint, parser_version, fingerprint_version,
  mapping_document, mapping_digest, declared_currency, financial_sign_semantics, controls, unmapped_field_disposition, proposal_source, created_by, correlation_id
) values
  ('e5000000-0000-4000-8000-000000000702'::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000701'::uuid,
   'e5000000-0000-4000-8000-000000000501'::uuid, 1, repeat('b', 64), 1, 3,
   jsonb_build_object('schemaVersion', 1, 'currency', 'AED', 'outletGrain', 'branch', 'controls', '[]'::jsonb,
     'unmappedFieldDisposition', 'reviewed_ignore',
     'sheets', jsonb_build_array(jsonb_build_object(
       'normalizedSheetName', 'csv', 'headerRow', 1, 'dataStartRow', 2, 'allowFormula', false, 'allowMergedCells', false,
       'fields', jsonb_build_array(
         jsonb_build_object('canonicalField', 'business_date', 'sourceHeader', 'business_date', 'parser', 'local_date', 'required', true, 'dateEncoding', 'iso_date'),
         jsonb_build_object('canonicalField', 'net_sales', 'sourceHeader', 'net_sales', 'parser', 'money', 'financialSign', 'positive', 'required', false),
         jsonb_build_object('canonicalField', 'closed_minutes', 'sourceHeader', 'closed_minutes', 'parser', 'decimal', 'required', false))))),
   repeat('c', 64), 'AED', '[]'::jsonb, '[]'::jsonb, 'reviewed_ignore', 'human', 'e5000000-0000-4000-8000-000000000001'::uuid, 'e5000000-0000-4000-8000-000000000606'::uuid),
  ('e5000000-0000-4000-8000-000000000712'::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000711'::uuid,
   'e5000000-0000-4000-8000-000000000503'::uuid, 1, repeat('b', 64), 1, 3,
   jsonb_build_object('schemaVersion', 1, 'currency', 'AED', 'outletGrain', 'branch', 'controls', '[]'::jsonb,
     'unmappedFieldDisposition', 'reviewed_ignore',
     'sheets', jsonb_build_array(jsonb_build_object(
       'normalizedSheetName', 'csv', 'headerRow', 1, 'dataStartRow', 2, 'allowFormula', false, 'allowMergedCells', false,
       'fields', jsonb_build_array(
         jsonb_build_object('canonicalField', 'net_sales', 'sourceHeader', 'net_sales', 'parser', 'money', 'financialSign', 'positive', 'required', true))))),
   repeat('e', 64), 'AED', '[]'::jsonb, '[]'::jsonb, 'reviewed_ignore', 'human', 'e5000000-0000-4000-8000-000000000001'::uuid, 'e5000000-0000-4000-8000-000000000616'::uuid);

insert into public.report_contract_decisions (organization_id, report_contract_version_id, decision, mapping_digest, decided_by, correlation_id)
values
  ('e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000702'::uuid, 'approved', repeat('c', 64), 'e5000000-0000-4000-8000-000000000001'::uuid, 'e5000000-0000-4000-8000-000000000607'::uuid),
  ('e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000712'::uuid, 'approved', repeat('e', 64), 'e5000000-0000-4000-8000-000000000001'::uuid, 'e5000000-0000-4000-8000-000000000617'::uuid);

insert into public.report_contract_bindings (id, organization_id, report_contract_id, report_contract_version_id, channel_id, report_type, schema_fingerprint, declared_currency, outlet_grain, bound_by, correlation_id)
values
  ('e5000000-0000-4000-8000-000000000703'::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000701'::uuid, 'e5000000-0000-4000-8000-000000000702'::uuid, 'e5000000-0000-4000-8000-000000000401'::uuid, 'performance_daily', repeat('b', 64), 'AED', 'branch', 'e5000000-0000-4000-8000-000000000001'::uuid, 'e5000000-0000-4000-8000-000000000608'::uuid),
  ('e5000000-0000-4000-8000-000000000713'::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000711'::uuid, 'e5000000-0000-4000-8000-000000000712'::uuid, 'e5000000-0000-4000-8000-000000000401'::uuid, 'settlement_total', repeat('b', 64), 'AED', 'branch', 'e5000000-0000-4000-8000-000000000001'::uuid, 'e5000000-0000-4000-8000-000000000618'::uuid);

insert into public.report_projection_versions (id, organization_id, report_contract_version_id, version, projection_document, projection_digest, calculation_version, proposal_source, created_by, correlation_id)
values
  ('e5000000-0000-4000-8000-000000000704'::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000702'::uuid, 1,
   '{"schemaVersion":1,"outputKind":"period_grain","grain":"day","periodKey":{"normalizedSheetName":"csv","canonicalField":"business_date"},"outputs":[{"key":"gross_revenue","metricKey":"revenue.gross","valueKind":"money","aggregation":"sum","normalizedSheetName":"csv","canonicalField":"net_sales"},{"key":"closed_minutes","metricKey":"operations.closed_minutes","valueKind":"count","aggregation":"sum","normalizedSheetName":"csv","canonicalField":"closed_minutes"}],"controlTotals":[]}'::jsonb,
   repeat('d', 64), 1, 'human', 'e5000000-0000-4000-8000-000000000001'::uuid, 'e5000000-0000-4000-8000-000000000609'::uuid),
  ('e5000000-0000-4000-8000-000000000714'::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000712'::uuid, 1,
   '{"schemaVersion":1,"outputKind":"exact_range","outputs":[{"key":"gross_revenue","metricKey":"revenue.gross","valueKind":"money","aggregation":"sum","normalizedSheetName":"csv","canonicalField":"net_sales"}],"controlTotals":[]}'::jsonb,
   repeat('9', 64), 1, 'human', 'e5000000-0000-4000-8000-000000000001'::uuid, 'e5000000-0000-4000-8000-000000000619'::uuid);

insert into public.report_projection_decisions (organization_id, report_projection_version_id, decision, projection_digest, decided_by, correlation_id)
values
  ('e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000704'::uuid, 'approved', repeat('d', 64), 'e5000000-0000-4000-8000-000000000001'::uuid, 'e5000000-0000-4000-8000-000000000610'::uuid),
  ('e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000714'::uuid, 'approved', repeat('9', 64), 'e5000000-0000-4000-8000-000000000001'::uuid, 'e5000000-0000-4000-8000-000000000620'::uuid);

insert into public.report_projection_bindings (id, organization_id, report_contract_version_id, report_contract_binding_id, report_projection_version_id, schema_fingerprint, declared_currency, bound_by, correlation_id)
values
  ('e5000000-0000-4000-8000-000000000705'::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000702'::uuid, 'e5000000-0000-4000-8000-000000000703'::uuid, 'e5000000-0000-4000-8000-000000000704'::uuid, repeat('b', 64), 'AED', 'e5000000-0000-4000-8000-000000000001'::uuid, 'e5000000-0000-4000-8000-000000000611'::uuid),
  ('e5000000-0000-4000-8000-000000000715'::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000712'::uuid, 'e5000000-0000-4000-8000-000000000713'::uuid, 'e5000000-0000-4000-8000-000000000714'::uuid, repeat('b', 64), 'AED', 'e5000000-0000-4000-8000-000000000001'::uuid, 'e5000000-0000-4000-8000-000000000621'::uuid);

insert into public.integration_report_validation_runs (id, organization_id, report_package_id, report_contract_version_id, report_contract_binding_id, validator_version, input_digest, result_digest, status, quality_state, completeness_state, correlation_id, completed_at)
select validation_id::uuid, 'e5000000-0000-4000-8000-000000000201'::uuid, package_id::uuid, contract_version_id::uuid, contract_binding_id::uuid, 1, repeat('e', 64), repeat('f', 64), 'validated', 'complete', 'complete', correlation_id::uuid, now()
from (values
  ('e5000000-0000-4000-8000-000000000501', 'e5000000-0000-4000-8000-000000000801', 'e5000000-0000-4000-8000-000000000702', 'e5000000-0000-4000-8000-000000000703', 'e5000000-0000-4000-8000-000000000631'),
  ('e5000000-0000-4000-8000-000000000502', 'e5000000-0000-4000-8000-000000000802', 'e5000000-0000-4000-8000-000000000702', 'e5000000-0000-4000-8000-000000000703', 'e5000000-0000-4000-8000-000000000632'),
  ('e5000000-0000-4000-8000-000000000503', 'e5000000-0000-4000-8000-000000000803', 'e5000000-0000-4000-8000-000000000712', 'e5000000-0000-4000-8000-000000000713', 'e5000000-0000-4000-8000-000000000633'),
  ('e5000000-0000-4000-8000-000000000504', 'e5000000-0000-4000-8000-000000000804', 'e5000000-0000-4000-8000-000000000712', 'e5000000-0000-4000-8000-000000000713', 'e5000000-0000-4000-8000-000000000634'),
  ('e5000000-0000-4000-8000-000000000505', 'e5000000-0000-4000-8000-000000000805', 'e5000000-0000-4000-8000-000000000702', 'e5000000-0000-4000-8000-000000000703', 'e5000000-0000-4000-8000-000000000635')
) as valueset(package_id, validation_id, contract_version_id, contract_binding_id, correlation_id);

-- One day's evidence, built so a wrong field can be swapped in for a refusal.
create or replace function pg_temp.day(p_start text, p_value text, p_digest text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'key', 'gross_revenue', 'metricKey', 'revenue.gross',
    'metricDefinitionId', (select id::text from public.metric_definitions where key = 'revenue.gross' and organization_id is null),
    'valueKind', 'money', 'valueNumerator', p_value, 'currency', 'AED',
    'periodStart', p_start, 'periodEnd', p_start,
    'normalizedSheetName', 'csv', 'canonicalField', 'net_sales',
    'sourceColumnOrdinal', 2, 'contributorCount', 1, 'sourceDigest', p_digest);
$$;

create or replace function pg_temp.quantity_day(p_start text, p_value text, p_digest text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'key', 'closed_minutes', 'metricKey', 'operations.closed_minutes',
    'metricDefinitionId', (select id::text from public.metric_definitions where key = 'operations.closed_minutes' and organization_id is null),
    'valueKind', 'count', 'valueNumerator', p_value, 'currency', null,
    'periodStart', p_start, 'periodEnd', p_start,
    'normalizedSheetName', 'csv', 'canonicalField', 'closed_minutes',
    'sourceColumnOrdinal', 3, 'contributorCount', 1, 'sourceDigest', p_digest);
$$;

create or replace function pg_temp.complete_series(p_package uuid, p_run uuid, p_token uuid, p_digest text, p_observations jsonb, p_absent integer)
returns jsonb language sql as $$
  select public.complete_governed_report_package_period_grain_projection(
    'e5000000-0000-4000-8000-000000000201'::uuid, p_package, p_run, p_token, p_digest,
    '{"status":"projected","qualityState":"complete","completenessState":"complete","errorCodes":[],"warningCodes":[]}'::jsonb,
    p_observations, p_absent);
$$;

set local role service_role;

select extensions.is((public.claim_governed_report_package_projection('e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000501'::uuid, 'e5000000-0000-4000-8000-000000000702'::uuid, 'e5000000-0000-4000-8000-000000000704'::uuid, 'e5000000-0000-4000-8000-000000000901'::uuid, 'series-projection-run-000001', 'e5000000-0000-4000-8000-000000000a01'::uuid, 'e5000000-0000-4000-8000-000000000641'::uuid) ->> 'outcome'), 'acquired', 'the daily package receives a worker lease through the fenced claim RPC');

-- Refusals first, while the lease is live and nothing has been written -----------

select extensions.is(pg_temp.complete_series('e5000000-0000-4000-8000-000000000501'::uuid, 'e5000000-0000-4000-8000-000000000901'::uuid, 'e5000000-0000-4000-8000-000000000aff'::uuid, repeat('1', 64), jsonb_build_array(pg_temp.day('2026-01-01', '120000', repeat('9', 64))), 0), null, 'a claim token the worker does not hold writes nothing');

select extensions.throws_ok(
  $$ select pg_temp.complete_series('e5000000-0000-4000-8000-000000000501'::uuid, 'e5000000-0000-4000-8000-000000000901'::uuid, 'e5000000-0000-4000-8000-000000000a01'::uuid, repeat('1', 64), jsonb_build_array(pg_temp.day('2026-01-01', '120000', repeat('9', 64)) || jsonb_build_object('invented', 1)), 0) $$,
  '22023', 'report projection observation evidence is invalid',
  'a field the declaration does not know is refused rather than ignored');

select extensions.throws_ok(
  $$ select pg_temp.complete_series('e5000000-0000-4000-8000-000000000501'::uuid, 'e5000000-0000-4000-8000-000000000901'::uuid, 'e5000000-0000-4000-8000-000000000a01'::uuid, repeat('1', 64), jsonb_build_array(jsonb_set(pg_temp.day('2026-01-01', '120000', repeat('9', 64)), '{contributorCount}', '0')), 0) $$,
  '22023', 'report projection observation evidence is invalid',
  'a period no row contributed to cannot arrive as evidence, because blank is not zero');

select extensions.throws_ok(
  $$ select pg_temp.complete_series('e5000000-0000-4000-8000-000000000501'::uuid, 'e5000000-0000-4000-8000-000000000901'::uuid, 'e5000000-0000-4000-8000-000000000a01'::uuid, repeat('1', 64), jsonb_build_array(jsonb_set(pg_temp.day('2026-01-01', '120000', repeat('9', 64)), '{valueNumerator}', '"12.34"')), 0) $$,
  '22023', 'report projection observation evidence is invalid',
  'money arrives as integer minor units or not at all');

select extensions.throws_ok(
  $$ select pg_temp.complete_series('e5000000-0000-4000-8000-000000000501'::uuid, 'e5000000-0000-4000-8000-000000000901'::uuid, 'e5000000-0000-4000-8000-000000000a01'::uuid, repeat('1', 64), jsonb_build_array(jsonb_set(pg_temp.day('2026-01-01', '120000', repeat('9', 64)), '{currency}', '"SAR"')), 0) $$,
  '22023', 'report projection observation evidence is invalid',
  'a currency the package did not declare is refused');

select extensions.throws_ok(
  $$ select pg_temp.complete_series('e5000000-0000-4000-8000-000000000501'::uuid, 'e5000000-0000-4000-8000-000000000901'::uuid, 'e5000000-0000-4000-8000-000000000a01'::uuid, repeat('1', 64), jsonb_build_array(jsonb_set(pg_temp.day('2026-01-01', '120000', repeat('9', 64)), '{periodEnd}', '"2026-01-07"')), 0) $$,
  '23514', 'report projection period does not match the declared grain',
  'a week filed under a declaration that says day is refused, never reinterpreted');

select extensions.throws_ok(
  $$ select pg_temp.complete_series('e5000000-0000-4000-8000-000000000501'::uuid, 'e5000000-0000-4000-8000-000000000901'::uuid, 'e5000000-0000-4000-8000-000000000a01'::uuid, repeat('1', 64), jsonb_build_array(pg_temp.day('2025-12-31', '120000', repeat('9', 64))), 0) $$,
  '23514', 'report projection period falls outside the declared package period',
  'a day outside the window the operator declared is refused');

select extensions.throws_ok(
  $$ select pg_temp.complete_series('e5000000-0000-4000-8000-000000000501'::uuid, 'e5000000-0000-4000-8000-000000000901'::uuid, 'e5000000-0000-4000-8000-000000000a01'::uuid, repeat('1', 64), jsonb_build_array(jsonb_set(pg_temp.day('2026-01-01', '120000', repeat('9', 64)), '{canonicalField}', '"other_column"')), 0) $$,
  '23514', 'projection observation does not match binding',
  'a column the approved declaration does not name cannot reach the ledger');

select extensions.is((select count(*)::integer from public.normalized_metrics where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid), 0, 'every refusal so far has written nothing');

-- The successful write ----------------------------------------------------------

-- Two days of evidence over a January package. The second of January is blank
-- in the export and is simply not present here.
select extensions.lives_ok(
  $$ select pg_temp.complete_series('e5000000-0000-4000-8000-000000000501'::uuid, 'e5000000-0000-4000-8000-000000000901'::uuid, 'e5000000-0000-4000-8000-000000000a01'::uuid, repeat('1', 64), jsonb_build_array(pg_temp.day('2026-01-01', '120000', repeat('9', 64)), pg_temp.day('2026-01-03', '80000', repeat('8', 64))), 1) $$,
  'an approved daily declaration now completes instead of being refused');

select extensions.is((select count(*)::integer from public.normalized_metrics where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid), 2, 'one observation per period the provider reported on');
select extensions.is((select count(*)::integer from public.normalized_metrics m where m.organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid and m.period_start = timestamptz '2026-01-02 00:00:00+03'), 0, 'a blank period produces no row at all, not a zero');
select extensions.is((select status from public.integration_report_packages where id = 'e5000000-0000-4000-8000-000000000501'::uuid), 'projected', 'the package reaches projected');
select extensions.is((select absent_row_count from public.integration_report_projection_runs where id = 'e5000000-0000-4000-8000-000000000901'::uuid), 1, 'the gap is reported on the run rather than swallowed');
select extensions.is((select output_count from public.integration_report_projection_runs where id = 'e5000000-0000-4000-8000-000000000901'::uuid), 2, 'the run records how many periods it wrote');

select extensions.is((select distinct period_timezone from public.normalized_metrics where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid), 'Asia/Riyadh', 'the branch timezone governs the boundary, not the organization default the package carries');
select extensions.is((select period_start from public.normalized_metrics where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid order by period_start limit 1), timestamptz '2026-01-01 00:00:00+03', 'a day starts at local midnight in the branch zone');
select extensions.is((select period_end from public.normalized_metrics where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid order by period_start limit 1), timestamptz '2026-01-02 00:00:00+03', 'and ends at the next local midnight');
select extensions.is((select period_grain from public.normalized_metrics where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid order by period_start limit 1), 'day', 'the declared grain is recorded, never inferred');
select extensions.is((select value_numerator::text from public.normalized_metrics where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid order by period_start limit 1), '120000', 'money is retained as integer minor units');
select extensions.is((select currency from public.normalized_metrics where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid order by period_start limit 1), 'AED', 'with the declared currency');
select extensions.is((select channel_id from public.normalized_metrics where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid order by period_start limit 1), 'e5000000-0000-4000-8000-000000000401'::uuid, 'a governed write carries the channel identity');

select extensions.is((select count(*)::integer from public.report_projection_lineage where report_package_id = 'e5000000-0000-4000-8000-000000000501'::uuid), 2, 'every projected figure resolves through lineage');
select extensions.is((select count(*)::integer from public.report_projection_lineage l where l.report_package_id = 'e5000000-0000-4000-8000-000000000501'::uuid and l.normalized_metric_id is not null and l.exact_range_metric_observation_id is null and l.first_data_row is null), 2, 'series lineage names the metrics ledger and claims no row range it did not compute');
select extensions.is((select count(*)::integer from public.report_projection_reconciliations where report_package_id = 'e5000000-0000-4000-8000-000000000501'::uuid and classification = 'non_overlapping' and projection_target = 'period_grain'), 2, 'each period records a reconciliation decision');

select extensions.is(pg_temp.complete_series('e5000000-0000-4000-8000-000000000501'::uuid, 'e5000000-0000-4000-8000-000000000901'::uuid, 'e5000000-0000-4000-8000-000000000a01'::uuid, repeat('1', 64), jsonb_build_array(pg_temp.day('2026-01-01', '999999', repeat('9', 64))), 0), null, 'a completed package writes nothing on a second call');
select extensions.is((select status from public.integration_report_packages where id = 'e5000000-0000-4000-8000-000000000501'::uuid), 'projected', 'and keeps the status it reached');
select extensions.is((select count(*)::integer from public.normalized_metrics where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid), 2, 'and gains no observation');

-- A wrong declaration kind cannot borrow this path ------------------------------

select extensions.is((public.claim_governed_report_package_projection('e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000504'::uuid, 'e5000000-0000-4000-8000-000000000712'::uuid, 'e5000000-0000-4000-8000-000000000714'::uuid, 'e5000000-0000-4000-8000-000000000904'::uuid, 'series-projection-run-000004', 'e5000000-0000-4000-8000-000000000a04'::uuid, 'e5000000-0000-4000-8000-000000000644'::uuid) ->> 'outcome'), 'acquired', 'an exact-range package receives its own lease');
select extensions.throws_ok(
  $$ select pg_temp.complete_series('e5000000-0000-4000-8000-000000000504'::uuid, 'e5000000-0000-4000-8000-000000000904'::uuid, 'e5000000-0000-4000-8000-000000000a04'::uuid, repeat('4', 64), jsonb_build_array(pg_temp.day('2026-01-05', '50000', repeat('5', 64))), 0) $$,
  '23514', 'projection declaration does not emit a period grain series',
  'an exact-range declaration cannot be written as a series');

-- Byte-identical evidence is a replay ---------------------------------------------

select extensions.is((public.claim_governed_report_package_projection('e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000502'::uuid, 'e5000000-0000-4000-8000-000000000702'::uuid, 'e5000000-0000-4000-8000-000000000704'::uuid, 'e5000000-0000-4000-8000-000000000902'::uuid, 'series-projection-run-000002', 'e5000000-0000-4000-8000-000000000a02'::uuid, 'e5000000-0000-4000-8000-000000000642'::uuid) ->> 'outcome'), 'acquired', 'the identical re-upload receives an independent lease');
select extensions.lives_ok(
  $$ select pg_temp.complete_series('e5000000-0000-4000-8000-000000000502'::uuid, 'e5000000-0000-4000-8000-000000000902'::uuid, 'e5000000-0000-4000-8000-000000000a02'::uuid, repeat('2', 64), jsonb_build_array(pg_temp.day('2026-01-01', '120000', repeat('9', 64)), pg_temp.day('2026-01-03', '80000', repeat('8', 64))), 1) $$,
  'identical evidence replays safely');
select extensions.is((select count(*)::integer from public.normalized_metrics where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid), 2, 'a replay creates no duplicate observation');
select extensions.is((select count(*)::integer from public.report_projection_reconciliations where report_package_id = 'e5000000-0000-4000-8000-000000000502'::uuid and classification = 'exact_duplicate'), 2, 'and is classified as the duplicate it is');

-- Continuous quantities keep their exact decimal value --------------------------

select extensions.is((public.claim_governed_report_package_projection('e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000505'::uuid, 'e5000000-0000-4000-8000-000000000702'::uuid, 'e5000000-0000-4000-8000-000000000704'::uuid, 'e5000000-0000-4000-8000-000000000905'::uuid, 'series-projection-run-000005', 'e5000000-0000-4000-8000-000000000a05'::uuid, 'e5000000-0000-4000-8000-000000000645'::uuid) ->> 'outcome'), 'acquired', 'a fractional availability package receives a worker lease');
select extensions.lives_ok(
  $$ select pg_temp.complete_series('e5000000-0000-4000-8000-000000000505'::uuid, 'e5000000-0000-4000-8000-000000000905'::uuid, 'e5000000-0000-4000-8000-000000000a05'::uuid, repeat('5', 64), jsonb_build_array(pg_temp.quantity_day('2026-01-31', '355.6', repeat('6', 64))), 0) $$,
  'a non-money continuous quantity retains its exact decimal numerator');
select extensions.is((select m.value_numerator::text from public.normalized_metrics m join public.report_projection_lineage l on l.normalized_metric_id = m.id where l.report_package_id = 'e5000000-0000-4000-8000-000000000505'::uuid), '355.6', 'fractional availability minutes land without rounding or truncation');

-- A total laid over the same days is an owner decision ----------------------------

select extensions.is((public.claim_governed_report_package_projection('e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000503'::uuid, 'e5000000-0000-4000-8000-000000000712'::uuid, 'e5000000-0000-4000-8000-000000000714'::uuid, 'e5000000-0000-4000-8000-000000000903'::uuid, 'series-projection-run-000003', 'e5000000-0000-4000-8000-000000000a03'::uuid, 'e5000000-0000-4000-8000-000000000643'::uuid) ->> 'outcome'), 'acquired', 'the settlement total receives a lease');
select extensions.lives_ok(
  $$ select public.complete_governed_report_package_projection('e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000503'::uuid, 'e5000000-0000-4000-8000-000000000903'::uuid, 'e5000000-0000-4000-8000-000000000a03'::uuid, repeat('3', 64), '{"status":"projected","qualityState":"complete","completenessState":"complete","errorCodes":[],"warningCodes":[]}'::jsonb, jsonb_build_array(jsonb_build_object('key','gross_revenue','metricKey','revenue.gross','metricDefinitionId',(select id::text from public.metric_definitions where key = 'revenue.gross' and organization_id is null),'valueKind','money','valueNumerator','200000','currency','AED','normalizedSheetName','csv','canonicalField','net_sales','sourceColumnOrdinal',2,'firstDataRow',2,'lastDataRow',2,'contributorCount',1,'sourceDigest',repeat('7',64)))) $$,
  'a month total covering an imported series completes into a held state');
select extensions.is((select status from public.integration_report_packages where id = 'e5000000-0000-4000-8000-000000000503'::uuid), 'reconciliation_required', 'the total is held for an owner rather than added to the days it totals');
select extensions.is((select reconciliation_state from public.exact_range_metric_observations where report_package_id = 'e5000000-0000-4000-8000-000000000503'::uuid), 'blocked_overlap', 'and does not become current evidence on its own');
select extensions.is((select count(*)::integer from public.report_projection_reconciliations where report_package_id = 'e5000000-0000-4000-8000-000000000503'::uuid and prior_normalized_metric_id is not null), 2, 'the overlap names every series row it collided with, across ledgers');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-000000000001';
select extensions.is((public.resolve_governed_report_projection_overlap('e5000000-0000-4000-8000-000000000201'::uuid, 'e5000000-0000-4000-8000-000000000001'::uuid, (select id from public.report_projection_reconciliations where report_package_id = 'e5000000-0000-4000-8000-000000000503'::uuid order by id limit 1), 'accept_correction', 'series-overlap-resolution-01', 'e5000000-0000-4000-8000-000000000651'::uuid) ->> 'outcome'), 'resolved', 'an owner can accept the total as the correction');
select extensions.is((select reconciliation_state from public.exact_range_metric_observations where report_package_id = 'e5000000-0000-4000-8000-000000000503'::uuid), 'current', 'the accepted total becomes current evidence');
select extensions.is((select count(*)::integer from public.normalized_metrics where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid and reconciliation_state = 'excluded'), 2, 'every day the total covered is set aside, not just the first, so nothing double-counts');

-- Tenant isolation -----------------------------------------------------------------

set local request.jwt.claim.sub = 'e5000000-0000-4000-8000-000000000002';
select extensions.is((select count(*)::integer from public.normalized_metrics where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid), 0, 'a member of another organization cannot read this series');
select extensions.is((select count(*)::integer from public.report_projection_lineage where organization_id = 'e5000000-0000-4000-8000-000000000201'::uuid), 0, 'nor its lineage');
select extensions.throws_ok(
  $$ select pg_temp.complete_series('e5000000-0000-4000-8000-000000000501'::uuid, 'e5000000-0000-4000-8000-000000000901'::uuid, 'e5000000-0000-4000-8000-000000000a01'::uuid, repeat('1', 64), jsonb_build_array(pg_temp.day('2026-01-05', '1', repeat('9', 64))), 0) $$,
  '42501');

select * from extensions.finish();

rollback;
