begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(26);

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

-- Task 7 (ADR 0046): a standing admission is a second admissible path for
-- the same claim. Every other check in the function -- binding, channel,
-- report type, outlet grain, object identity, content digest, expiry, the
-- idempotency ledger and the status precondition -- must still run; these
-- assertions exist to prove an admission shortens the ceremony without
-- loosening any of them.
reset role;

insert into public.report_projection_versions (
  id, organization_id, report_contract_version_id, version, projection_document, projection_digest,
  calculation_version, proposal_source, created_by, correlation_id
) values (
  'f1000000-0000-4000-8000-000000000710'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid,
  'f1000000-0000-4000-8000-000000000702'::uuid, 1, '{}'::jsonb,
  '7777777777777777777777777777777777777777777777777777777777777777',
  1, 'human', 'f1000000-0000-4000-8000-000000000001'::uuid, 'f1000000-0000-4000-8000-000000000711'::uuid
);
insert into public.report_structure_admissions (
  id, organization_id, channel_id, structure_fingerprint, structure_version, declared_currency, outlet_grain,
  report_type, report_contract_version_id, report_projection_version_id, granted_by, correlation_id
) values (
  'f1000000-0000-4000-8000-000000000720'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid,
  'f1000000-0000-4000-8000-000000000401'::uuid,
  '5555555555555555555555555555555555555555555555555555555555555555', 1, 'AED', 'branch', 'Settlement',
  'f1000000-0000-4000-8000-000000000702'::uuid, 'f1000000-0000-4000-8000-000000000710'::uuid,
  'f1000000-0000-4000-8000-000000000001'::uuid, 'f1000000-0000-4000-8000-000000000721'::uuid
);

-- Package 510: no per-package contract version, but its channel, structure
-- fingerprint and currency match the active admission above. Its own
-- schema_fingerprint deliberately differs from the bound version's (a
-- provider renaming a worksheet is the entire reason this path exists).
insert into storage.objects (bucket_id, name, metadata, version)
values ('governed-report-packages',
  'f1000000-0000-4000-8000-000000000201/f1000000-0000-4000-8000-000000000401/f1000000-0000-4000-8000-000000000510/1/original/report.csv',
  jsonb_build_object('size', 42, 'mimetype', 'text/csv'), 'validation-test-v2');
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, storage_object_id, storage_object_version, content_sha256, schema_fingerprint, structure_fingerprint,
  status, upload_expires_at, uploaded_at, profiled_at, created_by, correlation_id
) select
  'f1000000-0000-4000-8000-000000000510'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid,
  'f1000000-0000-4000-8000-000000000401'::uuid, 'f1000000-0000-4000-8000-000000000301'::uuid,
  'Settlement', date '2026-09-01', date '2026-09-07', 'AED', 'Asia/Dubai', 'csv', 'validation-admitted.csv', 'text/csv', 42,
  name, id, version, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '9999999999999999999999999999999999999999999999999999999999999999', '5555555555555555555555555555555555555555555555555555555555555555', 'awaiting_validation', now() + interval '1 hour', now(), now(),
  'f1000000-0000-4000-8000-000000000001'::uuid, 'f1000000-0000-4000-8000-000000000811'::uuid
from storage.objects where bucket_id = 'governed-report-packages'
  and name like 'f1000000-0000-4000-8000-000000000201/%000000000510/%';

-- Package 512: same admitted structure and channel, but a different
-- declared currency. The admission is for AED; this package declares USD.
insert into storage.objects (bucket_id, name, metadata, version)
values ('governed-report-packages',
  'f1000000-0000-4000-8000-000000000201/f1000000-0000-4000-8000-000000000401/f1000000-0000-4000-8000-000000000512/1/original/report.csv',
  jsonb_build_object('size', 42, 'mimetype', 'text/csv'), 'validation-test-v4');
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, storage_object_id, storage_object_version, content_sha256, schema_fingerprint, structure_fingerprint,
  status, upload_expires_at, uploaded_at, profiled_at, created_by, correlation_id
) select
  'f1000000-0000-4000-8000-000000000512'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid,
  'f1000000-0000-4000-8000-000000000401'::uuid, 'f1000000-0000-4000-8000-000000000301'::uuid,
  'Settlement', date '2026-09-01', date '2026-09-07', 'USD', 'Asia/Dubai', 'csv', 'validation-currency-mismatch.csv', 'text/csv', 42,
  name, id, version, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '9999999999999999999999999999999999999999999999999999999999999999', '5555555555555555555555555555555555555555555555555555555555555555', 'awaiting_validation', now() + interval '1 hour', now(), now(),
  'f1000000-0000-4000-8000-000000000001'::uuid, 'f1000000-0000-4000-8000-000000000813'::uuid
from storage.objects where bucket_id = 'governed-report-packages'
  and name like 'f1000000-0000-4000-8000-000000000201/%000000000512/%';

set local role service_role;
-- The admitted_under_admission_id write is confirmed separately (staging
-- evidence in the task report): a scalar subquery re-reading the packages
-- table here would run under this statement's own snapshot, taken before
-- the claim's internal update, and would see the pre-update NULL even
-- though the update has genuinely committed inside the function's own
-- transaction-scoped writes.
select extensions.is(
  (select jsonb_build_object('outcome', result ->> 'outcome', 'contractVersionId', result -> 'contractVersion' ->> 'id')
   from (select public.claim_governed_report_package_validation(
     'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000510'::uuid,
     null::uuid, 'f1000000-0000-4000-8000-000000000901'::uuid,
     'report-validation-admission-happy-0001', 'f1000000-0000-4000-8000-000000000902'::uuid,
     'f1000000-0000-4000-8000-000000000903'::uuid
   ) as result) claimed),
  jsonb_build_object('outcome', 'acquired', 'contractVersionId', 'f1000000-0000-4000-8000-000000000702'),
  'a package with no per-package contract version but a matching active admission claims successfully, using the admission''s contract version'
);
select extensions.is(
  (public.claim_governed_report_package_validation(
    'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000512'::uuid,
    null::uuid, 'f1000000-0000-4000-8000-000000000921'::uuid,
    'report-validation-admission-currency-0001', 'f1000000-0000-4000-8000-000000000922'::uuid,
    'f1000000-0000-4000-8000-000000000923'::uuid
  ) ->> 'outcome'), 'not_ready',
  'an admission whose declared currency differs from the package cannot admit it'
);
reset role;

-- Revoke the admission that just admitted package 510. A package sharing its
-- exact structure, channel and currency must fall back to per-upload
-- approval -- reuse is revocable, not a permanent bypass.
update public.report_structure_admissions
set active = false, revoked_by = 'f1000000-0000-4000-8000-000000000001'::uuid, revoked_at = now(),
  correlation_id = 'f1000000-0000-4000-8000-000000000722'::uuid
where id = 'f1000000-0000-4000-8000-000000000720'::uuid;

insert into storage.objects (bucket_id, name, metadata, version)
values ('governed-report-packages',
  'f1000000-0000-4000-8000-000000000201/f1000000-0000-4000-8000-000000000401/f1000000-0000-4000-8000-000000000511/1/original/report.csv',
  jsonb_build_object('size', 42, 'mimetype', 'text/csv'), 'validation-test-v3');
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, storage_object_id, storage_object_version, content_sha256, schema_fingerprint, structure_fingerprint,
  status, upload_expires_at, uploaded_at, profiled_at, created_by, correlation_id
) select
  'f1000000-0000-4000-8000-000000000511'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid,
  'f1000000-0000-4000-8000-000000000401'::uuid, 'f1000000-0000-4000-8000-000000000301'::uuid,
  'Settlement', date '2026-09-08', date '2026-09-14', 'AED', 'Asia/Dubai', 'csv', 'validation-revoked-admission.csv', 'text/csv', 42,
  name, id, version, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '9999999999999999999999999999999999999999999999999999999999999999', '5555555555555555555555555555555555555555555555555555555555555555', 'awaiting_validation', now() + interval '1 hour', now(), now(),
  'f1000000-0000-4000-8000-000000000001'::uuid, 'f1000000-0000-4000-8000-000000000812'::uuid
from storage.objects where bucket_id = 'governed-report-packages'
  and name like 'f1000000-0000-4000-8000-000000000201/%000000000511/%';

set local role service_role;
select extensions.is(
  (public.claim_governed_report_package_validation(
    'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000511'::uuid,
    null::uuid, 'f1000000-0000-4000-8000-000000000911'::uuid,
    'report-validation-admission-revoked-0001', 'f1000000-0000-4000-8000-000000000912'::uuid,
    'f1000000-0000-4000-8000-000000000913'::uuid
  ) ->> 'outcome'), 'not_ready',
  'a revoked admission no longer admits a package that shares its structure'
);
reset role;

-- A second organization grants an admission for the exact same structure
-- fingerprint and currency, on its own channel. Its existence anywhere in
-- the database must not let an unrelated organization's package through.
insert into auth.users (id) values ('f2000000-0000-4000-8000-000000000001'::uuid);
insert into public.accounts (id, name, slug, created_by)
values ('f2000000-0000-4000-8000-000000000101'::uuid, 'Validation verifier (other org)', 'validation-verifier-other-org', 'f2000000-0000-4000-8000-000000000001'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by)
values ('f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000101'::uuid, 'Validation verifier (other org)', 'validation-verifier-other-org', 'testing', 'AE', 'AED', 'Asia/Dubai', 'f2000000-0000-4000-8000-000000000001'::uuid);
insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('f2000000-0000-4000-8000-000000000301'::uuid, 'f2000000-0000-4000-8000-000000000201'::uuid, 'Other org outlet', 'other-org-outlet', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('f2000000-0000-4000-8000-000000000401'::uuid, 'f2000000-0000-4000-8000-000000000201'::uuid, 'other-org-channel', 'Other org channel', 'marketplace', 'f2000000-0000-4000-8000-000000000001'::uuid);
-- A placeholder package only: it exists to satisfy report_contract_versions'
-- required report_package_id, and is never itself claimed. Left unuploaded
-- (no storage object identity), which the package's own check constraints
-- allow for an 'awaiting_upload' row.
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, status, upload_expires_at, created_by, correlation_id
) values (
  'f2000000-0000-4000-8000-000000000501'::uuid, 'f2000000-0000-4000-8000-000000000201'::uuid,
  'f2000000-0000-4000-8000-000000000401'::uuid, 'f2000000-0000-4000-8000-000000000301'::uuid,
  'Settlement', date '2026-09-01', date '2026-09-07', 'AED', 'Asia/Dubai', 'csv', 'other-org.csv', 'text/csv', 42,
  'f2000000-0000-4000-8000-000000000201/f2000000-0000-4000-8000-000000000401/f2000000-0000-4000-8000-000000000501/1/original/report.csv',
  'awaiting_upload', now() + interval '1 hour',
  'f2000000-0000-4000-8000-000000000001'::uuid, 'f2000000-0000-4000-8000-000000000502'::uuid
);
insert into public.report_contracts (id, organization_id, channel_id, report_type, outlet_grain, created_by)
values ('f2000000-0000-4000-8000-000000000701'::uuid, 'f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000401'::uuid, 'Settlement', 'branch', 'f2000000-0000-4000-8000-000000000001'::uuid);
insert into public.report_contract_versions (
  id, organization_id, report_contract_id, report_package_id, version, schema_fingerprint, parser_version, fingerprint_version,
  mapping_document, mapping_digest, declared_currency, financial_sign_semantics, controls, unmapped_field_disposition,
  proposal_source, created_by, correlation_id
) values (
  'f2000000-0000-4000-8000-000000000702'::uuid, 'f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000701'::uuid,
  'f2000000-0000-4000-8000-000000000501'::uuid, 1, '9999999999999999999999999999999999999999999999999999999999999999', 1, 1,
  '{"schemaVersion":1,"currency":"AED","outletGrain":"branch","sheets":[],"controls":[],"unmappedFieldDisposition":"reviewed_ignore"}'::jsonb,
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'AED', '[]'::jsonb, '[]'::jsonb,
  'reviewed_ignore', 'human', 'f2000000-0000-4000-8000-000000000001'::uuid, 'f2000000-0000-4000-8000-000000000703'::uuid
);
insert into public.report_projection_versions (
  id, organization_id, report_contract_version_id, version, projection_document, projection_digest,
  calculation_version, proposal_source, created_by, correlation_id
) values (
  'f2000000-0000-4000-8000-000000000710'::uuid, 'f2000000-0000-4000-8000-000000000201'::uuid,
  'f2000000-0000-4000-8000-000000000702'::uuid, 1, '{}'::jsonb,
  '8888888888888888888888888888888888888888888888888888888888888888',
  1, 'human', 'f2000000-0000-4000-8000-000000000001'::uuid, 'f2000000-0000-4000-8000-000000000711'::uuid
);
insert into public.report_structure_admissions (
  id, organization_id, channel_id, structure_fingerprint, structure_version, declared_currency, outlet_grain,
  report_type, report_contract_version_id, report_projection_version_id, granted_by, correlation_id
) values (
  'f2000000-0000-4000-8000-000000000720'::uuid, 'f2000000-0000-4000-8000-000000000201'::uuid,
  'f2000000-0000-4000-8000-000000000401'::uuid,
  '6666666666666666666666666666666666666666666666666666666666666666', 1, 'AED', 'branch', 'Settlement',
  'f2000000-0000-4000-8000-000000000702'::uuid, 'f2000000-0000-4000-8000-000000000710'::uuid,
  'f2000000-0000-4000-8000-000000000001'::uuid, 'f2000000-0000-4000-8000-000000000721'::uuid
);

-- Package 513 belongs to the FIRST organization, on its own channel, and
-- shares the fingerprint and currency of the SECOND organization's admission
-- above -- but the first organization has never admitted this structure.
insert into storage.objects (bucket_id, name, metadata, version)
values ('governed-report-packages',
  'f1000000-0000-4000-8000-000000000201/f1000000-0000-4000-8000-000000000401/f1000000-0000-4000-8000-000000000513/1/original/report.csv',
  jsonb_build_object('size', 42, 'mimetype', 'text/csv'), 'validation-test-v5');
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, storage_object_id, storage_object_version, content_sha256, schema_fingerprint, structure_fingerprint,
  status, upload_expires_at, uploaded_at, profiled_at, created_by, correlation_id
) select
  'f1000000-0000-4000-8000-000000000513'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid,
  'f1000000-0000-4000-8000-000000000401'::uuid, 'f1000000-0000-4000-8000-000000000301'::uuid,
  'Settlement', date '2026-09-15', date '2026-09-21', 'AED', 'Asia/Dubai', 'csv', 'validation-cross-org.csv', 'text/csv', 42,
  name, id, version, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '9999999999999999999999999999999999999999999999999999999999999999', '6666666666666666666666666666666666666666666666666666666666666666', 'awaiting_validation', now() + interval '1 hour', now(), now(),
  'f1000000-0000-4000-8000-000000000001'::uuid, 'f1000000-0000-4000-8000-000000000814'::uuid
from storage.objects where bucket_id = 'governed-report-packages'
  and name like 'f1000000-0000-4000-8000-000000000201/%000000000513/%';

set local role service_role;
select extensions.is(
  (public.claim_governed_report_package_validation(
    'f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000513'::uuid,
    null::uuid, 'f1000000-0000-4000-8000-000000000931'::uuid,
    'report-validation-admission-crossorg-0001', 'f1000000-0000-4000-8000-000000000932'::uuid,
    'f1000000-0000-4000-8000-000000000933'::uuid
  ) ->> 'outcome'), 'not_ready',
  'a matching admission belonging to a different organization does not admit the package'
);
reset role;

select * from extensions.finish();

rollback;
