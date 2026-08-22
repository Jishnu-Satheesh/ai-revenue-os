begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(22);

select extensions.has_table('public', 'integration_report_validation_runs', 'validation runs retain bounded evidence');
select extensions.has_table('public', 'integration_report_validation_sheet_results', 'sheet summaries are stored separately from workbooks');
select extensions.has_table('public', 'integration_report_validation_control_results', 'control summaries are stored separately from workbooks');
select extensions.ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.integration_report_validation_runs'::regclass),
  'validation runs enforce RLS'
);
select extensions.ok(
  (select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.integration_report_validation_runs'::regclass),
  'validation runs force RLS'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.integration_report_validation_runs', 'insert'),
  'authenticated users cannot write validation evidence directly'
);
select extensions.ok(
  not pg_catalog.has_function_privilege('authenticated', 'public.claim_governed_report_package_validation(uuid,uuid,uuid,uuid,text,uuid,uuid)', 'execute'),
  'authenticated users cannot claim worker validation'
);
select extensions.ok(
  pg_catalog.has_function_privilege('service_role', 'public.claim_governed_report_package_validation(uuid,uuid,uuid,uuid,text,uuid,uuid)', 'execute'),
  'service worker can use the constrained validation claim RPC'
);
select extensions.ok(
  not pg_catalog.has_function_privilege('authenticated', 'public.complete_governed_report_package_validation(uuid,uuid,uuid,uuid,text,jsonb)', 'execute'),
  'authenticated users cannot complete validation with arbitrary evidence'
);
select extensions.has_function(
  'public', 'fail_governed_report_package_validation',
  'worker failure path is available for parser crashes without exposing direct writes'
);

insert into auth.users (id) values
  ('f1000000-0000-4000-8000-000000000001'::uuid),
  ('f1000000-0000-4000-8000-000000000002'::uuid);
insert into public.accounts (id, name, slug, created_by)
values ('f1000000-0000-4000-8000-000000000101'::uuid, 'Validation verifier', 'validation-verifier', 'f1000000-0000-4000-8000-000000000001'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by)
values ('f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000101'::uuid, 'Validation verifier', 'validation-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'f1000000-0000-4000-8000-000000000001'::uuid);
insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('f1000000-0000-4000-8000-000000000301'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'Validation outlet', 'validation-outlet', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('f1000000-0000-4000-8000-000000000401'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'validation-channel', 'Validation channel', 'marketplace', 'f1000000-0000-4000-8000-000000000001'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role)
values ('f1000000-0000-4000-8000-000000000101'::uuid, 'f1000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');

insert into storage.objects (bucket_id, name, metadata, version)
values ('governed-report-packages',
  'f1000000-0000-4000-8000-000000000201/f1000000-0000-4000-8000-000000000401/f1000000-0000-4000-8000-000000000501/1/original/report.csv',
  jsonb_build_object('size', 42, 'mimetype', 'text/csv'), 'validation-test-v1');
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, storage_object_id, storage_object_version, content_sha256, schema_fingerprint, status,
  upload_expires_at, uploaded_at, profiled_at, created_by, correlation_id
) select
  'f1000000-0000-4000-8000-000000000501'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid,
  'f1000000-0000-4000-8000-000000000401'::uuid, 'f1000000-0000-4000-8000-000000000301'::uuid,
  'Settlement', date '2026-08-01', date '2026-08-07', 'AED', 'Asia/Dubai', 'csv', 'validation.csv', 'text/csv', 42,
  name, id, version, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'awaiting_validation', now() + interval '1 hour', now(), now(),
  'f1000000-0000-4000-8000-000000000001'::uuid, 'f1000000-0000-4000-8000-000000000601'::uuid
from storage.objects where bucket_id = 'governed-report-packages'
  and name like 'f1000000-0000-4000-8000-000000000201/%';
insert into public.integration_report_sheet_manifests (
  organization_id, report_package_id, sheet_position, sheet_name, normalized_sheet_name, row_count, populated_cell_count,
  expanded_bytes, header_candidates, header_candidate_digests, has_formula, has_merged_cells, has_repeated_header
) values (
  'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000501'::uuid, 1, 'CSV', 'csv', 2, 4, 42,
  '[]'::jsonb,
  '[{"rowPosition":1,"fieldCount":1,"digest":"b8a78c345cafa060523a4409ef977a18a6e035cf3ede56b295f302332819ae6e","normalizedHeaderDigests":["1f47dd5317fab65368164a12f027f7d16bbe2d3eddfedf05be115fc693324a73"]}]'::jsonb,
  false, false, false
);
insert into public.report_contracts (id, organization_id, channel_id, report_type, outlet_grain, created_by)
values ('f1000000-0000-4000-8000-000000000701'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000401'::uuid, 'Settlement', 'branch', 'f1000000-0000-4000-8000-000000000001'::uuid);
insert into public.report_contract_versions (
  id, organization_id, report_contract_id, report_package_id, version, schema_fingerprint, parser_version, fingerprint_version,
  mapping_document, mapping_digest, declared_currency, financial_sign_semantics, controls, unmapped_field_disposition,
  proposal_source, created_by, correlation_id
) values (
  'f1000000-0000-4000-8000-000000000702'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000701'::uuid,
  'f1000000-0000-4000-8000-000000000501'::uuid, 1, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1, 1,
  '{"schemaVersion":1,"currency":"AED","outletGrain":"branch","sheets":[{"normalizedSheetName":"csv","headerRow":1,"dataStartRow":2,"allowFormula":false,"allowMergedCells":false,"fields":[{"canonicalField":"net_sales","sourceHeader":"net_sales","parser":"money","required":true,"financialSign":"positive"}]}],"controls":[],"unmappedFieldDisposition":"reviewed_ignore"}'::jsonb,
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'AED', '[{"sheet":"csv","field":"net_sales","sign":"positive"}]'::jsonb, '[]'::jsonb,
  'reviewed_ignore', 'human', 'f1000000-0000-4000-8000-000000000001'::uuid, 'f1000000-0000-4000-8000-000000000602'::uuid
);
insert into public.report_contract_decisions (organization_id, report_contract_version_id, decision, mapping_digest, decided_by, correlation_id)
values ('f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000702'::uuid, 'approved', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'f1000000-0000-4000-8000-000000000001'::uuid, 'f1000000-0000-4000-8000-000000000603'::uuid);
insert into public.report_contract_bindings (
  id, organization_id, report_contract_id, report_contract_version_id, channel_id, report_type, schema_fingerprint,
  declared_currency, outlet_grain, bound_by, correlation_id
) values (
  'f1000000-0000-4000-8000-000000000703'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000701'::uuid,
  'f1000000-0000-4000-8000-000000000702'::uuid, 'f1000000-0000-4000-8000-000000000401'::uuid, 'Settlement',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'AED', 'branch', 'f1000000-0000-4000-8000-000000000001'::uuid, 'f1000000-0000-4000-8000-000000000604'::uuid
);

set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000001';
select extensions.lives_ok(
  $$ select public.retry_governed_report_package_validation(
    'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000001'::uuid,
    'f1000000-0000-4000-8000-000000000501'::uuid, 'report-validation-awaiting-retry-0001',
    'f1000000-0000-4000-8000-000000000605'::uuid
  ) $$,
  'awaiting_validation packages can be safely re-dispatched after a worker outage'
);
reset role;

set local role service_role;
select extensions.is(
  (public.claim_governed_report_package_validation(
    'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000501'::uuid,
    'f1000000-0000-4000-8000-000000000702'::uuid, 'f1000000-0000-4000-8000-000000000801'::uuid,
    'report-validation-verifier-0001', 'f1000000-0000-4000-8000-000000000802'::uuid, 'f1000000-0000-4000-8000-000000000803'::uuid
  ) ->> 'outcome'), 'acquired', 'approved exact contract can be claimed once by the worker'
);
select extensions.lives_ok(
  $$ select public.complete_governed_report_package_validation(
    'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000501'::uuid,
    'f1000000-0000-4000-8000-000000000801'::uuid, 'f1000000-0000-4000-8000-000000000802'::uuid,
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    '{"status":"validated","qualityState":"complete","completenessState":"complete","sheetResults":[{"normalizedSheetName":"csv","required":true,"rowCount":2,"populatedCellCount":4,"parsedFieldSuccessCount":1,"parsedFieldFailureCount":0,"errorCodes":[],"warningCodes":[]}],"controlResults":[],"errorCodes":[],"warningCodes":[]}'::jsonb
  ) $$,
  'worker completion persists only bounded validation summaries'
);
select extensions.is(
  (select status from public.integration_report_packages where id = 'f1000000-0000-4000-8000-000000000501'::uuid),
  'validated', 'successful validation transitions the package to validated'
);
select extensions.is(
  (public.claim_governed_report_package_validation(
    'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000501'::uuid,
    'f1000000-0000-4000-8000-000000000702'::uuid, 'f1000000-0000-4000-8000-000000000801'::uuid,
    'report-validation-verifier-0001', 'f1000000-0000-4000-8000-000000000804'::uuid, 'f1000000-0000-4000-8000-000000000803'::uuid
  ) ->> 'outcome'), 'completed', 'idempotent replay returns the completed validation run'
);
select extensions.ok(
  exists (select 1 from public.audit_events where entity_id = 'f1000000-0000-4000-8000-000000000801'::uuid and event_name = 'report_package.validation_succeeded'),
  'validation success emits an immutable audit event'
);
select extensions.ok(
  exists (select 1 from public.audit_events where entity_id = 'f1000000-0000-4000-8000-000000000801'::uuid and event_name = 'report_package.validation_started'),
  'validation claim emits an immutable start audit event'
);
select extensions.lives_ok(
  $$ select public.fail_governed_report_package_validation(
    'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000501'::uuid,
    'f1000000-0000-4000-8000-000000000805'::uuid, 'f1000000-0000-4000-8000-000000000806'::uuid,
    'VALIDATION_PROCESSING_FAILED', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  ) $$,
  'parser-crash failure RPC is safely callable after a stale or unknown claim'
);
select extensions.ok(
  not exists (
    select 1 from public.integration_report_validation_sheet_results
    where validation_run_id = 'f1000000-0000-4000-8000-000000000801'::uuid
      and pg_catalog.to_jsonb(integration_report_validation_sheet_results)::text like '%net_sales_value%'
  ),
  'validation evidence has no raw workbook value field'
);

reset role;
select extensions.throws_ok(
  $$ delete from public.integration_report_validation_sheet_results
    where validation_run_id = 'f1000000-0000-4000-8000-000000000801'::uuid $$,
  '55000', 'report_validation_evidence_is_append_only',
  'validation evidence cannot be removed after it is recorded'
);
set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000001';
select extensions.throws_ok(
  $$ select public.retry_governed_report_package_validation(
    'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000001'::uuid,
    'f1000000-0000-4000-8000-000000000501'::uuid, 'report-validation-retry-verifier-0001',
    'f1000000-0000-4000-8000-000000000807'::uuid
  ) $$,
  '23514', 'report package is not eligible for validation retry',
  'validated packages cannot be replayed through the validation retry RPC'
);
set local request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000002';
select extensions.is(
  (select count(*)::integer from public.integration_report_validation_runs where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid),
  0, 'unrelated tenant user cannot read validation evidence'
);

select * from extensions.finish();

rollback;
