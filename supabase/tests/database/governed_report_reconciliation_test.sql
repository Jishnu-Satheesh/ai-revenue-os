begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(67);

select extensions.has_table('public', 'report_projection_reconciliations', 'reconciliation evidence is retained separately from workbook data');
select extensions.has_function('public', 'resolve_governed_report_projection_overlap', 'owner/admin overlap resolution is database-owned');
select extensions.has_function('public', 'list_governed_report_projection_reconciliation_groups', 'the client reads grouped unresolved overlap actions');
select extensions.has_function('public', 'resolve_governed_report_projection_overlap_group', 'one owner decision resolves a safe overlap group atomically');
select extensions.ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.report_projection_reconciliations'::regclass), 'reconciliation evidence enforces RLS');
select extensions.ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.report_projection_reconciliations'::regclass), 'reconciliation evidence forces RLS');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.report_projection_reconciliations', 'insert'), 'members cannot write reconciliation evidence directly');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated', 'public.complete_governed_report_package_projection(uuid,uuid,uuid,uuid,text,jsonb,jsonb)', 'execute'), 'members cannot complete projection evidence');
select extensions.ok(pg_catalog.has_function_privilege('service_role', 'public.complete_governed_report_package_projection(uuid,uuid,uuid,uuid,text,jsonb,jsonb)', 'execute'), 'service workers retain the fenced projection completion path');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.resolve_governed_report_projection_overlap(uuid,uuid,uuid,text,text,uuid)', 'execute'), 'anonymous callers cannot resolve overlaps');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.list_governed_report_projection_reconciliation_groups(uuid)', 'execute'), 'anonymous callers cannot list grouped overlap actions');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.resolve_governed_report_projection_overlap_group(uuid,uuid,uuid,text,text,uuid)', 'execute'), 'anonymous callers cannot resolve grouped overlaps');

insert into auth.users (id) values
  ('f3000000-0000-4000-8000-000000000001'::uuid),
  ('f3000000-0000-4000-8000-000000000002'::uuid);
insert into public.accounts (id, name, slug, created_by)
values ('f3000000-0000-4000-8000-000000000101'::uuid, 'Reconciliation verifier', 'reconciliation-verifier', 'f3000000-0000-4000-8000-000000000001'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by)
values ('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000101'::uuid, 'Reconciliation verifier', 'reconciliation-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'f3000000-0000-4000-8000-000000000001'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role)
values ('f3000000-0000-4000-8000-000000000101'::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');
insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('f3000000-0000-4000-8000-000000000301'::uuid, 'f3000000-0000-4000-8000-000000000201'::uuid, 'Reconciliation outlet', 'reconciliation-outlet', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('f3000000-0000-4000-8000-000000000401'::uuid, 'f3000000-0000-4000-8000-000000000201'::uuid, 'reconciliation-channel', 'Reconciliation channel', 'marketplace', 'f3000000-0000-4000-8000-000000000001'::uuid);

insert into storage.objects (bucket_id, name, metadata, version)
select 'governed-report-packages',
  'f3000000-0000-4000-8000-000000000201/f3000000-0000-4000-8000-000000000401/' || package_id || '/1/original/report.csv',
  jsonb_build_object('size', 42, 'mimetype', 'text/csv'), 'reconciliation-' || ordinal
from (values
  ('f3000000-0000-4000-8000-000000000501', 1), ('f3000000-0000-4000-8000-000000000502', 2),
  ('f3000000-0000-4000-8000-000000000503', 3), ('f3000000-0000-4000-8000-000000000504', 4),
  ('f3000000-0000-4000-8000-000000000505', 5)
) as packages(package_id, ordinal);
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, storage_object_id, storage_object_version, content_sha256, schema_fingerprint, status,
  upload_expires_at, uploaded_at, profiled_at, created_by, correlation_id
)
select package_id::uuid, 'f3000000-0000-4000-8000-000000000201'::uuid,
  'f3000000-0000-4000-8000-000000000401'::uuid, 'f3000000-0000-4000-8000-000000000301'::uuid,
  'Settlement', period_start, period_end, 'AED', 'Asia/Dubai', 'csv', 'report.csv', 'text/csv', 42,
  o.name, o.id, o.version, content_sha256, repeat('b', 64), 'awaiting_projection', now() + interval '1 hour', now(), now(),
  'f3000000-0000-4000-8000-000000000001'::uuid, correlation_id::uuid
from (values
  ('f3000000-0000-4000-8000-000000000501', date '2026-08-01', date '2026-08-07', repeat('a', 64), 'f3000000-0000-4000-8000-000000000601'),
  ('f3000000-0000-4000-8000-000000000502', date '2026-08-01', date '2026-08-07', repeat('a', 64), 'f3000000-0000-4000-8000-000000000602'),
  ('f3000000-0000-4000-8000-000000000503', date '2026-08-08', date '2026-08-14', repeat('b', 64), 'f3000000-0000-4000-8000-000000000603'),
  ('f3000000-0000-4000-8000-000000000504', date '2026-08-01', date '2026-08-07', repeat('c', 64), 'f3000000-0000-4000-8000-000000000604'),
  ('f3000000-0000-4000-8000-000000000505', date '2026-08-15', date '2026-08-21', repeat('d', 64), 'f3000000-0000-4000-8000-000000000605')
) as p(package_id, period_start, period_end, content_sha256, correlation_id)
join storage.objects o on o.bucket_id = 'governed-report-packages'
  and o.name = 'f3000000-0000-4000-8000-000000000201/f3000000-0000-4000-8000-000000000401/' || p.package_id || '/1/original/report.csv';

insert into public.report_contracts (id, organization_id, channel_id, report_type, outlet_grain, created_by)
values ('f3000000-0000-4000-8000-000000000701'::uuid, 'f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000401'::uuid, 'Settlement', 'branch', 'f3000000-0000-4000-8000-000000000001'::uuid);
insert into public.report_contract_versions (
  id, organization_id, report_contract_id, report_package_id, version, schema_fingerprint, parser_version, fingerprint_version,
  mapping_document, mapping_digest, declared_currency, financial_sign_semantics, controls, unmapped_field_disposition, proposal_source, created_by, correlation_id
) values (
  'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000701'::uuid,
  'f3000000-0000-4000-8000-000000000501'::uuid, 1, repeat('b', 64), 1, 1,
  '{"schemaVersion":1,"currency":"AED","outletGrain":"branch","sheets":[{"normalizedSheetName":"csv","headerRow":1,"dataStartRow":2,"allowFormula":false,"allowMergedCells":false,"fields":[{"canonicalField":"net_sales","sourceHeader":"gross_sales","parser":"money","required":true,"financialSign":"positive"},{"canonicalField":"orders","sourceHeader":"orders","parser":"integer","required":true}]}],"controls":[],"unmappedFieldDisposition":"reviewed_ignore"}'::jsonb,
  repeat('c', 64), 'AED', '[]'::jsonb, '[]'::jsonb, 'reviewed_ignore', 'human', 'f3000000-0000-4000-8000-000000000001'::uuid, 'f3000000-0000-4000-8000-000000000606'::uuid
);
insert into public.report_contract_decisions (organization_id, report_contract_version_id, decision, mapping_digest, decided_by, correlation_id)
values ('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'approved', repeat('c', 64), 'f3000000-0000-4000-8000-000000000001'::uuid, 'f3000000-0000-4000-8000-000000000607'::uuid);
insert into public.report_contract_bindings (id, organization_id, report_contract_id, report_contract_version_id, channel_id, report_type, schema_fingerprint, declared_currency, outlet_grain, bound_by, correlation_id)
values ('f3000000-0000-4000-8000-000000000703'::uuid, 'f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000701'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000401'::uuid, 'Settlement', repeat('b', 64), 'AED', 'branch', 'f3000000-0000-4000-8000-000000000001'::uuid, 'f3000000-0000-4000-8000-000000000608'::uuid);
insert into public.report_projection_versions (id, organization_id, report_contract_version_id, version, projection_document, projection_digest, calculation_version, proposal_source, created_by, correlation_id)
values ('f3000000-0000-4000-8000-000000000704'::uuid, 'f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 1,
  '{"schemaVersion":1,"outputKind":"exact_range","outputs":[{"key":"gross_revenue","metricKey":"revenue.gross","valueKind":"money","aggregation":"sum","normalizedSheetName":"csv","canonicalField":"net_sales"},{"key":"orders","metricKey":"transactions.count","valueKind":"count","aggregation":"sum","normalizedSheetName":"csv","canonicalField":"orders"}],"controlTotals":[]}'::jsonb,
  repeat('d', 64), 1, 'human', 'f3000000-0000-4000-8000-000000000001'::uuid, 'f3000000-0000-4000-8000-000000000609'::uuid);
insert into public.report_projection_decisions (organization_id, report_projection_version_id, decision, projection_digest, decided_by, correlation_id)
values ('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000704'::uuid, 'approved', repeat('d', 64), 'f3000000-0000-4000-8000-000000000001'::uuid, 'f3000000-0000-4000-8000-000000000610'::uuid);
insert into public.report_projection_bindings (id, organization_id, report_contract_version_id, report_contract_binding_id, report_projection_version_id, schema_fingerprint, declared_currency, bound_by, correlation_id)
values ('f3000000-0000-4000-8000-000000000705'::uuid, 'f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000703'::uuid, 'f3000000-0000-4000-8000-000000000704'::uuid, repeat('b', 64), 'AED', 'f3000000-0000-4000-8000-000000000001'::uuid, 'f3000000-0000-4000-8000-000000000611'::uuid);

insert into public.integration_report_validation_runs (id, organization_id, report_package_id, report_contract_version_id, report_contract_binding_id, validator_version, input_digest, result_digest, status, quality_state, completeness_state, correlation_id, completed_at)
select validation_id::uuid, 'f3000000-0000-4000-8000-000000000201'::uuid, package_id::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000703'::uuid, 1, repeat('e', 64), repeat('f', 64), 'validated', 'complete', 'complete', correlation_id::uuid, now()
from (values
  ('f3000000-0000-4000-8000-000000000501', 'f3000000-0000-4000-8000-000000000801', 'f3000000-0000-4000-8000-000000000621'),
  ('f3000000-0000-4000-8000-000000000502', 'f3000000-0000-4000-8000-000000000802', 'f3000000-0000-4000-8000-000000000622'),
  ('f3000000-0000-4000-8000-000000000503', 'f3000000-0000-4000-8000-000000000803', 'f3000000-0000-4000-8000-000000000623'),
  ('f3000000-0000-4000-8000-000000000504', 'f3000000-0000-4000-8000-000000000804', 'f3000000-0000-4000-8000-000000000624'),
  ('f3000000-0000-4000-8000-000000000505', 'f3000000-0000-4000-8000-000000000805', 'f3000000-0000-4000-8000-000000000625')
) as valueset(package_id, validation_id, correlation_id);

-- Reproduce the production drift state directly: a still-running ledger and
-- lease whose package was left awaiting projection. Normal package transitions
-- correctly reject moving a healthy projecting package backwards.
insert into public.integration_report_projection_runs (
  id, organization_id, report_package_id, report_contract_version_id, report_contract_binding_id,
  report_projection_version_id, report_projection_binding_id, validation_run_id, calculation_version,
  input_digest, status, correlation_id
) values (
  'f3000000-0000-4000-8000-000000000905'::uuid, 'f3000000-0000-4000-8000-000000000201'::uuid,
  'f3000000-0000-4000-8000-000000000505'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid,
  'f3000000-0000-4000-8000-000000000703'::uuid, 'f3000000-0000-4000-8000-000000000704'::uuid,
  'f3000000-0000-4000-8000-000000000705'::uuid, 'f3000000-0000-4000-8000-000000000805'::uuid,
  1, repeat('1', 64), 'running', 'f3000000-0000-4000-8000-000000000635'::uuid
);
insert into private.integration_report_projection_operations (
  organization_id, report_package_id, idempotency_key, input_digest,
  projection_run_id, claim_token, lease_expires_at
) values (
  'f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000505'::uuid,
  'reconciliation-projection-run-0005', repeat('1', 64), 'f3000000-0000-4000-8000-000000000905'::uuid,
  'f3000000-0000-4000-8000-000000000a05'::uuid, now() + interval '20 minutes'
);
set local role service_role;
select extensions.is((public.claim_governed_report_package_projection('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000501'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000704'::uuid, 'f3000000-0000-4000-8000-000000000901'::uuid, 'reconciliation-projection-run-0001', 'f3000000-0000-4000-8000-000000000a01'::uuid, 'f3000000-0000-4000-8000-000000000631'::uuid) ->> 'outcome'), 'acquired', 'first package receives a worker lease through the fenced claim RPC');
select extensions.is((public.claim_governed_report_package_projection('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000502'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000704'::uuid, 'f3000000-0000-4000-8000-000000000902'::uuid, 'reconciliation-projection-run-0002', 'f3000000-0000-4000-8000-000000000a02'::uuid, 'f3000000-0000-4000-8000-000000000632'::uuid) ->> 'outcome'), 'acquired', 'duplicate package receives an independent worker lease');
select extensions.is((public.claim_governed_report_package_projection('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000503'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000704'::uuid, 'f3000000-0000-4000-8000-000000000903'::uuid, 'reconciliation-projection-run-0003', 'f3000000-0000-4000-8000-000000000a03'::uuid, 'f3000000-0000-4000-8000-000000000633'::uuid) ->> 'outcome'), 'acquired', 'non-overlap package receives a worker lease');
select extensions.is((public.claim_governed_report_package_projection('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000504'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000704'::uuid, 'f3000000-0000-4000-8000-000000000904'::uuid, 'reconciliation-projection-run-0004', 'f3000000-0000-4000-8000-000000000a04'::uuid, 'f3000000-0000-4000-8000-000000000634'::uuid) ->> 'outcome'), 'acquired', 'corrected package receives a worker lease');
select extensions.lives_ok($$ select public.complete_governed_report_package_projection('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000501'::uuid, 'f3000000-0000-4000-8000-000000000901'::uuid, 'f3000000-0000-4000-8000-000000000a01'::uuid, repeat('1', 64), '{"status":"projected","qualityState":"complete","completenessState":"complete","errorCodes":[],"warningCodes":[]}'::jsonb, jsonb_build_array(jsonb_build_object('key','gross_revenue','metricKey','revenue.gross','metricDefinitionId',(select id::text from public.metric_definitions where key = 'revenue.gross' and organization_id is null),'valueKind','money','valueNumerator','1300','currency','AED','normalizedSheetName','csv','canonicalField','net_sales','sourceColumnOrdinal',1,'firstDataRow',2,'lastDataRow',2,'contributorCount',1,'sourceDigest',repeat('9',64)))) $$, 'first exact range creates current projection evidence');
select extensions.is((select reconciliation_state from public.exact_range_metric_observations where report_package_id = 'f3000000-0000-4000-8000-000000000501'::uuid), 'current', 'first exact range is current');
select extensions.is((select count(*)::integer from public.report_projection_lineage where report_package_id = 'f3000000-0000-4000-8000-000000000501'::uuid), 1, 'first exact range has one lineage record');
select extensions.lives_ok($$ select public.complete_governed_report_package_projection('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000502'::uuid, 'f3000000-0000-4000-8000-000000000902'::uuid, 'f3000000-0000-4000-8000-000000000a02'::uuid, repeat('2',64), '{"status":"projected","qualityState":"complete","completenessState":"complete","errorCodes":[],"warningCodes":[]}'::jsonb, jsonb_build_array(jsonb_build_object('key','gross_revenue','metricKey','revenue.gross','metricDefinitionId',(select id::text from public.metric_definitions where key = 'revenue.gross' and organization_id is null),'valueKind','money','valueNumerator','1300','currency','AED','normalizedSheetName','csv','canonicalField','net_sales','sourceColumnOrdinal',1,'firstDataRow',2,'lastDataRow',2,'contributorCount',1,'sourceDigest',repeat('9',64)))) $$, 'identical package completion safely replays');
select extensions.is((select count(*)::integer from public.exact_range_metric_observations where organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid), 1, 'identical replay creates no duplicate observation');
select extensions.is((select count(*)::integer from public.report_projection_lineage where organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid), 1, 'identical replay creates no duplicate lineage');
select extensions.is((select classification from public.report_projection_reconciliations where report_package_id = 'f3000000-0000-4000-8000-000000000502'::uuid), 'exact_duplicate', 'exact duplicate is classified deterministically');
select extensions.ok(exists (select 1 from public.audit_events where event_name = 'report_projection.duplicate_replayed' and organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid), 'duplicate replay emits immutable audit evidence');
select extensions.lives_ok($$ select public.complete_governed_report_package_projection('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000503'::uuid, 'f3000000-0000-4000-8000-000000000903'::uuid, 'f3000000-0000-4000-8000-000000000a03'::uuid, repeat('3',64), '{"status":"projected","qualityState":"complete","completenessState":"complete","errorCodes":[],"warningCodes":[]}'::jsonb, jsonb_build_array(jsonb_build_object('key','gross_revenue','metricKey','revenue.gross','metricDefinitionId',(select id::text from public.metric_definitions where key = 'revenue.gross' and organization_id is null),'valueKind','money','valueNumerator','1400','currency','AED','normalizedSheetName','csv','canonicalField','net_sales','sourceColumnOrdinal',1,'firstDataRow',2,'lastDataRow',2,'contributorCount',1,'sourceDigest',repeat('8',64)))) $$, 'non-overlapping period completes');
select extensions.is((select count(*)::integer from public.exact_range_metric_observations where reconciliation_state = 'current' and organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid), 2, 'non-overlapping periods coexist as current evidence');
select extensions.is((select classification from public.report_projection_reconciliations where report_package_id = 'f3000000-0000-4000-8000-000000000503'::uuid), 'non_overlapping', 'non-overlap classification is retained');
select extensions.lives_ok($$ select public.complete_governed_report_package_projection('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000504'::uuid, 'f3000000-0000-4000-8000-000000000904'::uuid, 'f3000000-0000-4000-8000-000000000a04'::uuid, repeat('4',64), '{"status":"projected","qualityState":"complete","completenessState":"complete","errorCodes":[],"warningCodes":[]}'::jsonb, jsonb_build_array(jsonb_build_object('key','gross_revenue','metricKey','revenue.gross','metricDefinitionId',(select id::text from public.metric_definitions where key = 'revenue.gross' and organization_id is null),'valueKind','money','valueNumerator','1500','currency','AED','normalizedSheetName','csv','canonicalField','net_sales','sourceColumnOrdinal',1,'firstDataRow',2,'lastDataRow',2,'contributorCount',1,'sourceDigest',repeat('7',64)))) $$, 'corrected package completion is held for review');
select extensions.is((select status from public.integration_report_packages where id = 'f3000000-0000-4000-8000-000000000504'::uuid), 'reconciliation_required', 'overlapping package is blocked from automatic rollup');
select extensions.is((select reconciliation_state from public.exact_range_metric_observations where report_package_id = 'f3000000-0000-4000-8000-000000000504'::uuid), 'blocked_overlap', 'overlapping observation is not current');
select extensions.is((select classification from public.report_projection_reconciliations where report_package_id = 'f3000000-0000-4000-8000-000000000504'::uuid), 'ambiguous_overlap', 'ambiguous overlap requires owner or admin resolution');
select extensions.ok(exists (select 1 from public.audit_events where event_name = 'report_projection.overlap_blocked' and organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid), 'blocked overlap emits immutable audit evidence');
reset role;

-- Two independent daily corrections for one approved output reproduce the
-- real client case: the person chooses which upload governs the field once,
-- while the ledger retains one immutable decision per affected day.
insert into public.normalized_metrics (
  id, organization_id, branch_id, metric_definition_id, value_kind, channel, channel_id,
  dimensions, period_grain, period_start, period_end, period_timezone, value_numerator,
  quality_tier, revision, reconciliation_state, reconciliation_digest, observed_at
)
select metric_id::uuid, 'f3000000-0000-4000-8000-000000000201'::uuid,
  'f3000000-0000-4000-8000-000000000301'::uuid,
  (select id from public.metric_definitions where key = 'transactions.count' and organization_id is null),
  'count', 'reconciliation-channel', 'f3000000-0000-4000-8000-000000000401'::uuid,
  '{}'::jsonb, 'day', period_start, period_start + interval '1 day', 'Asia/Dubai', metric_value,
  'measured', revision, reconciliation_state, reconciliation_digest, period_start
from (values
  ('f3000000-0000-4000-8000-000000000b01', timestamptz '2026-08-01 00:00:00+04', 10, 1, 'current', repeat('1', 64)),
  ('f3000000-0000-4000-8000-000000000b11', timestamptz '2026-08-01 00:00:00+04', 11, 2, 'blocked_overlap', repeat('2', 64)),
  ('f3000000-0000-4000-8000-000000000b02', timestamptz '2026-08-02 00:00:00+04', 12, 1, 'current', repeat('3', 64)),
  ('f3000000-0000-4000-8000-000000000b12', timestamptz '2026-08-02 00:00:00+04', 13, 2, 'blocked_overlap', repeat('4', 64)),
  ('f3000000-0000-4000-8000-000000000b13', timestamptz '2026-08-03 00:00:00+04', 14, 1, 'current', repeat('b', 64))
) as metrics(metric_id, period_start, metric_value, revision, reconciliation_state, reconciliation_digest);

insert into public.report_projection_lineage (
  organization_id, normalized_metric_id, report_package_id, validation_run_id, projection_run_id,
  report_contract_version_id, report_projection_version_id, normalized_sheet_name, canonical_field,
  source_column_ordinal, contributor_count, calculation_version, source_digest,
  quality_state, completeness_state
)
select 'f3000000-0000-4000-8000-000000000201'::uuid, metric_id::uuid, package_id::uuid,
  validation_run_id::uuid, projection_run_id::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid,
  'f3000000-0000-4000-8000-000000000704'::uuid, 'csv', 'orders', 2, 1, 1,
  source_digest, 'complete', 'complete'
from (values
  ('f3000000-0000-4000-8000-000000000b01', 'f3000000-0000-4000-8000-000000000501', 'f3000000-0000-4000-8000-000000000801', 'f3000000-0000-4000-8000-000000000901', repeat('5', 64)),
  ('f3000000-0000-4000-8000-000000000b02', 'f3000000-0000-4000-8000-000000000501', 'f3000000-0000-4000-8000-000000000801', 'f3000000-0000-4000-8000-000000000901', repeat('6', 64)),
  ('f3000000-0000-4000-8000-000000000b11', 'f3000000-0000-4000-8000-000000000504', 'f3000000-0000-4000-8000-000000000804', 'f3000000-0000-4000-8000-000000000904', repeat('7', 64)),
  ('f3000000-0000-4000-8000-000000000b12', 'f3000000-0000-4000-8000-000000000504', 'f3000000-0000-4000-8000-000000000804', 'f3000000-0000-4000-8000-000000000904', repeat('8', 64)),
  ('f3000000-0000-4000-8000-000000000b13', 'f3000000-0000-4000-8000-000000000504', 'f3000000-0000-4000-8000-000000000804', 'f3000000-0000-4000-8000-000000000904', repeat('b', 64))
) as lineage(metric_id, package_id, validation_run_id, projection_run_id, source_digest);

insert into public.report_projection_reconciliations (
  id, organization_id, report_package_id, projection_run_id, projection_output_key,
  projection_target, period_start, period_end, classification, reconciliation_digest,
  prior_normalized_metric_id, result_normalized_metric_id, candidate_count,
  quality_state, completeness_state, calculation_version, correlation_id
)
values
  ('f3000000-0000-4000-8000-000000000c01'::uuid, 'f3000000-0000-4000-8000-000000000201'::uuid,
   'f3000000-0000-4000-8000-000000000504'::uuid, 'f3000000-0000-4000-8000-000000000904'::uuid,
   'orders', 'period_grain', date '2026-08-01', date '2026-08-01', 'ambiguous_overlap', repeat('9', 64),
   'f3000000-0000-4000-8000-000000000b01'::uuid, 'f3000000-0000-4000-8000-000000000b11'::uuid,
   1, 'complete', 'complete', 1, 'f3000000-0000-4000-8000-000000000651'::uuid),
  ('f3000000-0000-4000-8000-000000000c02'::uuid, 'f3000000-0000-4000-8000-000000000201'::uuid,
   'f3000000-0000-4000-8000-000000000504'::uuid, 'f3000000-0000-4000-8000-000000000904'::uuid,
   'orders', 'period_grain', date '2026-08-02', date '2026-08-02', 'ambiguous_overlap', repeat('a', 64),
   'f3000000-0000-4000-8000-000000000b02'::uuid, 'f3000000-0000-4000-8000-000000000b12'::uuid,
   1, 'complete', 'complete', 1, 'f3000000-0000-4000-8000-000000000652'::uuid),
  ('f3000000-0000-4000-8000-000000000c03'::uuid, 'f3000000-0000-4000-8000-000000000201'::uuid,
   'f3000000-0000-4000-8000-000000000504'::uuid, 'f3000000-0000-4000-8000-000000000904'::uuid,
   'orders', 'period_grain', date '2026-08-03', date '2026-08-03', 'non_overlapping', repeat('b', 64),
   null, 'f3000000-0000-4000-8000-000000000b13'::uuid,
   0, 'complete', 'complete', 1, 'f3000000-0000-4000-8000-000000000656'::uuid);

select extensions.throws_ok($$ select public.resolve_governed_report_projection_overlap('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid, (select id from public.report_projection_reconciliations where report_package_id = 'f3000000-0000-4000-8000-000000000504'::uuid and projection_output_key = 'gross_revenue'), 'accept_correction', 'reconciliation-resolution-0001', 'f3000000-0000-4000-8000-000000000641'::uuid) $$, '42501', 'report overlap resolution is not authorized', 'unauthenticated callers cannot resolve overlap');
select extensions.throws_ok($$ select public.resolve_governed_report_projection_overlap_group('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid, 'f3000000-0000-4000-8000-000000000c01'::uuid, 'accept_correction', 'reconciliation-group-resolution-0001', 'f3000000-0000-4000-8000-000000000653'::uuid) $$, '42501', 'report overlap resolution is not authorized', 'unauthenticated callers cannot resolve an overlap group');
set local role authenticated;
set local request.jwt.claim.sub = 'f3000000-0000-4000-8000-000000000001';
select extensions.is((select affected_record_count from public.list_governed_report_projection_reconciliation_groups('f3000000-0000-4000-8000-000000000201'::uuid) where projection_output_key = 'orders'), 2, 'the action list groups two affected daily records under one field');
select extensions.is((select matching_record_count from public.list_governed_report_projection_reconciliation_groups('f3000000-0000-4000-8000-000000000201'::uuid) where projection_output_key = 'orders'), 2, 'the grouped action counts the two existing records it would replace');
select extensions.is((select source_header from public.list_governed_report_projection_reconciliation_groups('f3000000-0000-4000-8000-000000000201'::uuid) where projection_output_key = 'orders'), 'orders', 'the grouped action names the approved source field instead of an evidence id');
select extensions.is((select count(*)::integer from public.list_governed_report_projection_reconciliation_groups('f3000000-0000-4000-8000-000000000201'::uuid) where projection_output_key = 'gross_revenue' and affected_record_count = 1), 1, 'only unresolved ambiguous evidence becomes an action; non-overlap history stays hidden');
savepoint keep_existing_group;
select extensions.is((public.resolve_governed_report_projection_overlap_group('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid, 'f3000000-0000-4000-8000-000000000c01'::uuid, 'keep_existing', 'reconciliation-group-resolution-keep-existing', 'f3000000-0000-4000-8000-000000000657'::uuid) ->> 'resolvedCount'), '2', 'keeping existing evidence resolves both daily conflicts atomically');
select extensions.is((select count(*)::integer from public.normalized_metrics where id in ('f3000000-0000-4000-8000-000000000b11'::uuid, 'f3000000-0000-4000-8000-000000000b12'::uuid) and reconciliation_state = 'excluded'), 2, 'keeping existing evidence excludes only the two incoming conflicting records');
select extensions.is((select reconciliation_state from public.normalized_metrics where id = 'f3000000-0000-4000-8000-000000000b13'::uuid), 'current', 'keeping existing evidence leaves a same-field non-overlap record untouched');
rollback to savepoint keep_existing_group;
select extensions.is((public.resolve_governed_report_projection_overlap_group('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid, 'f3000000-0000-4000-8000-000000000c01'::uuid, 'accept_correction', 'reconciliation-group-resolution-0001', 'f3000000-0000-4000-8000-000000000654'::uuid) ->> 'resolvedCount'), '2', 'one owner choice resolves both daily conflicts atomically');
select extensions.is((select count(*)::integer from public.report_projection_reconciliation_resolutions where reconciliation_id in ('f3000000-0000-4000-8000-000000000c01'::uuid, 'f3000000-0000-4000-8000-000000000c02'::uuid)), 2, 'the grouped choice retains one immutable resolution per affected day');
select extensions.is((select count(*)::integer from public.normalized_metrics where id in ('f3000000-0000-4000-8000-000000000b11'::uuid, 'f3000000-0000-4000-8000-000000000b12'::uuid) and reconciliation_state = 'current'), 2, 'accepting the grouped correction promotes both incoming daily records');
select extensions.is((select count(*)::integer from public.normalized_metrics where id in ('f3000000-0000-4000-8000-000000000b01'::uuid, 'f3000000-0000-4000-8000-000000000b02'::uuid) and superseded_by_id is not null), 2, 'accepting the grouped correction retains both prior records as superseded history');
select extensions.is((select reconciliation_state from public.normalized_metrics where id = 'f3000000-0000-4000-8000-000000000b13'::uuid), 'current', 'the grouped choice leaves a same-field non-overlap record untouched');
select extensions.ok(exists (select 1 from public.audit_events where event_name = 'report_projection.overlap_group_resolved' and organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid), 'the single grouped user decision emits its own audit event');
select extensions.is((public.resolve_governed_report_projection_overlap_group('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid, 'f3000000-0000-4000-8000-000000000c01'::uuid, 'accept_correction', 'reconciliation-group-resolution-0001', 'f3000000-0000-4000-8000-000000000655'::uuid) ->> 'outcome'), 'completed', 'a grouped decision safely replays after every member is resolved');
select extensions.is((public.resolve_governed_report_projection_overlap_group('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid, 'f3000000-0000-4000-8000-000000000c01'::uuid, 'keep_existing', 'reconciliation-group-resolution-conflict', 'f3000000-0000-4000-8000-000000000658'::uuid) ->> 'outcome'), 'conflict', 'an opposite choice never masquerades as a successful idempotent replay');
select extensions.lives_ok($$ select public.resolve_governed_report_projection_overlap('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid, (select id from public.report_projection_reconciliations where report_package_id = 'f3000000-0000-4000-8000-000000000504'::uuid and projection_output_key = 'gross_revenue'), 'accept_correction', 'reconciliation-resolution-0001', 'f3000000-0000-4000-8000-000000000642'::uuid) $$, 'owner can accept an approved correction');
select extensions.ok(exists (select 1 from public.exact_range_metric_observations where report_package_id = 'f3000000-0000-4000-8000-000000000501'::uuid and reconciliation_state = 'superseded'), 'prior revision remains readable as superseded history');
select extensions.is((select revision from public.exact_range_metric_observations where report_package_id = 'f3000000-0000-4000-8000-000000000504'::uuid), 2, 'accepted correction creates a new observation revision');
select extensions.is((select outcome_classification from public.report_projection_reconciliation_resolutions r join public.report_projection_reconciliations c on c.id = r.reconciliation_id where c.report_package_id = 'f3000000-0000-4000-8000-000000000504'::uuid and c.projection_output_key = 'gross_revenue'), 'approved_correction', 'resolution records approved correction classification');
select extensions.ok(exists (select 1 from public.audit_events where event_name = 'report_projection.correction_accepted' and organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid), 'accepted correction emits immutable audit evidence');
select extensions.ok(exists (select 1 from public.audit_events where event_name = 'exact_range_metric_observation.superseded' and organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid), 'supersession emits immutable audit evidence');
select extensions.ok(exists (select 1 from public.audit_events where event_name = 'report_projection.overlap_resolved' and organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid), 'overlap resolution emits immutable audit evidence');
select extensions.is((public.resolve_governed_report_projection_overlap('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid, (select id from public.report_projection_reconciliations where report_package_id = 'f3000000-0000-4000-8000-000000000504'::uuid and projection_output_key = 'gross_revenue'), 'accept_correction', 'reconciliation-resolution-0001', 'f3000000-0000-4000-8000-000000000643'::uuid) ->> 'outcome'), 'completed', 'resolution retry safely replays the append-only outcome');
select extensions.is((select count(*)::integer from public.report_projection_reconciliations r where r.organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid and to_jsonb(r)::text like '%1300%'), 0, 'reconciliation evidence does not persist raw aggregate values');
select extensions.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('report_projection_reconciliations', 'report_projection_reconciliation_resolutions') and column_name in ('value_numerator', 'raw_row', 'raw_cell', 'formula', 'signed_url', 'prompt', 'model_output', 'original_filename')), 'reconciliation tables contain safe evidence fields only');
set local role service_role;
set local request.jwt.claim.sub = '';
select extensions.is((public.claim_governed_report_package_projection('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000505'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000704'::uuid, 'f3000000-0000-4000-8000-000000000905'::uuid, 'reconciliation-projection-run-0005', 'f3000000-0000-4000-8000-000000000a15'::uuid, 'f3000000-0000-4000-8000-000000000644'::uuid) ->> 'outcome'), 'in_progress', 'active worker lease deterministically fences a duplicate retry');
select extensions.ok(pg_get_functiondef('public.claim_governed_report_package_projection(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid)'::regprocedure) ~ E'operation\\.lease_expires_at > now\\(\\)', 'only an unexpired worker lease fences a retry');
select extensions.ok(pg_get_functiondef('public.claim_governed_report_package_projection(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid)'::regprocedure) ~ E'attempt_count = attempt_count \\+ 1', 'expired-lease recovery records a bounded retry attempt');
reset role;
update private.integration_report_projection_operations
set lease_expires_at = now() - interval '1 minute'
where organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid
  and report_package_id = 'f3000000-0000-4000-8000-000000000505'::uuid;
set local role service_role;
select extensions.is((public.claim_governed_report_package_projection('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000505'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000704'::uuid, 'f3000000-0000-4000-8000-000000000905'::uuid, 'reconciliation-projection-run-0005', 'f3000000-0000-4000-8000-000000000a25'::uuid, 'f3000000-0000-4000-8000-000000000645'::uuid) ->> 'outcome'), 'acquired', 'an expired lease may be taken over under the same run identity');
select extensions.is((select status from public.integration_report_packages where id = 'f3000000-0000-4000-8000-000000000505'::uuid), 'projecting', 'a takeover restores the package state expected by completion');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'f3000000-0000-4000-8000-000000000001';
select extensions.is((select count(*)::integer from public.report_projection_reconciliations where organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid), 7, 'authorized owner can read safe reconciliation history');
set local request.jwt.claim.sub = 'f3000000-0000-4000-8000-000000000002';
select extensions.is((select count(*)::integer from public.report_projection_reconciliations where organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid), 0, 'unrelated tenant user cannot read reconciliation evidence');
select extensions.is((select count(*)::integer from public.list_governed_report_projection_reconciliation_groups('f3000000-0000-4000-8000-000000000201'::uuid)), 0, 'unrelated tenant user cannot read grouped reconciliation actions');

select * from extensions.finish();

rollback;
