begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(45);

select extensions.has_table('public', 'report_projection_reconciliations', 'reconciliation evidence is retained separately from workbook data');
select extensions.has_function('public', 'resolve_governed_report_projection_overlap', 'owner/admin overlap resolution is database-owned');
select extensions.ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.report_projection_reconciliations'::regclass), 'reconciliation evidence enforces RLS');
select extensions.ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.report_projection_reconciliations'::regclass), 'reconciliation evidence forces RLS');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.report_projection_reconciliations', 'insert'), 'members cannot write reconciliation evidence directly');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated', 'public.complete_governed_report_package_projection(uuid,uuid,uuid,uuid,text,jsonb,jsonb)', 'execute'), 'members cannot complete projection evidence');
select extensions.ok(pg_catalog.has_function_privilege('service_role', 'public.complete_governed_report_package_projection(uuid,uuid,uuid,uuid,text,jsonb,jsonb)', 'execute'), 'service workers retain the fenced projection completion path');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.resolve_governed_report_projection_overlap(uuid,uuid,uuid,text,text,uuid)', 'execute'), 'anonymous callers cannot resolve overlaps');

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
  '{"schemaVersion":1,"currency":"AED","outletGrain":"branch","sheets":[],"controls":[],"unmappedFieldDisposition":"reviewed_ignore"}'::jsonb,
  repeat('c', 64), 'AED', '[]'::jsonb, '[]'::jsonb, 'reviewed_ignore', 'human', 'f3000000-0000-4000-8000-000000000001'::uuid, 'f3000000-0000-4000-8000-000000000606'::uuid
);
insert into public.report_contract_decisions (organization_id, report_contract_version_id, decision, mapping_digest, decided_by, correlation_id)
values ('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'approved', repeat('c', 64), 'f3000000-0000-4000-8000-000000000001'::uuid, 'f3000000-0000-4000-8000-000000000607'::uuid);
insert into public.report_contract_bindings (id, organization_id, report_contract_id, report_contract_version_id, channel_id, report_type, schema_fingerprint, declared_currency, outlet_grain, bound_by, correlation_id)
values ('f3000000-0000-4000-8000-000000000703'::uuid, 'f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000701'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000401'::uuid, 'Settlement', repeat('b', 64), 'AED', 'branch', 'f3000000-0000-4000-8000-000000000001'::uuid, 'f3000000-0000-4000-8000-000000000608'::uuid);
insert into public.report_projection_versions (id, organization_id, report_contract_version_id, version, projection_document, projection_digest, calculation_version, proposal_source, created_by, correlation_id)
values ('f3000000-0000-4000-8000-000000000704'::uuid, 'f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 1,
  '{"schemaVersion":1,"outputs":[{"key":"gross_revenue","metricKey":"revenue.gross","valueKind":"money","normalizedSheetName":"csv","canonicalField":"net_sales"}]}'::jsonb,
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
set local role service_role;
select extensions.is((public.claim_governed_report_package_projection('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000501'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000704'::uuid, 'f3000000-0000-4000-8000-000000000901'::uuid, 'reconciliation-projection-run-0001', 'f3000000-0000-4000-8000-000000000a01'::uuid, 'f3000000-0000-4000-8000-000000000631'::uuid) ->> 'outcome'), 'acquired', 'first package receives a worker lease through the fenced claim RPC');
select extensions.is((public.claim_governed_report_package_projection('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000502'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000704'::uuid, 'f3000000-0000-4000-8000-000000000902'::uuid, 'reconciliation-projection-run-0002', 'f3000000-0000-4000-8000-000000000a02'::uuid, 'f3000000-0000-4000-8000-000000000632'::uuid) ->> 'outcome'), 'acquired', 'duplicate package receives an independent worker lease');
select extensions.is((public.claim_governed_report_package_projection('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000503'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000704'::uuid, 'f3000000-0000-4000-8000-000000000903'::uuid, 'reconciliation-projection-run-0003', 'f3000000-0000-4000-8000-000000000a03'::uuid, 'f3000000-0000-4000-8000-000000000633'::uuid) ->> 'outcome'), 'acquired', 'non-overlap package receives a worker lease');
select extensions.is((public.claim_governed_report_package_projection('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000504'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000704'::uuid, 'f3000000-0000-4000-8000-000000000904'::uuid, 'reconciliation-projection-run-0004', 'f3000000-0000-4000-8000-000000000a04'::uuid, 'f3000000-0000-4000-8000-000000000634'::uuid) ->> 'outcome'), 'acquired', 'corrected package receives a worker lease');
select extensions.is((public.claim_governed_report_package_projection('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000505'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000704'::uuid, 'f3000000-0000-4000-8000-000000000905'::uuid, 'reconciliation-projection-run-0005', 'f3000000-0000-4000-8000-000000000a05'::uuid, 'f3000000-0000-4000-8000-000000000635'::uuid) ->> 'outcome'), 'acquired', 'retry fixture receives a worker lease');
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
select extensions.throws_ok($$ select public.resolve_governed_report_projection_overlap('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid, (select id from public.report_projection_reconciliations where report_package_id = 'f3000000-0000-4000-8000-000000000504'::uuid), 'accept_correction', 'reconciliation-resolution-0001', 'f3000000-0000-4000-8000-000000000641'::uuid) $$, '42501', 'report overlap resolution is not authorized', 'unauthenticated callers cannot resolve overlap');
set local role authenticated;
set local request.jwt.claim.sub = 'f3000000-0000-4000-8000-000000000001';
select extensions.lives_ok($$ select public.resolve_governed_report_projection_overlap('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid, (select id from public.report_projection_reconciliations where report_package_id = 'f3000000-0000-4000-8000-000000000504'::uuid), 'accept_correction', 'reconciliation-resolution-0001', 'f3000000-0000-4000-8000-000000000642'::uuid) $$, 'owner can accept an approved correction');
select extensions.ok(exists (select 1 from public.exact_range_metric_observations where report_package_id = 'f3000000-0000-4000-8000-000000000501'::uuid and reconciliation_state = 'superseded'), 'prior revision remains readable as superseded history');
select extensions.is((select revision from public.exact_range_metric_observations where report_package_id = 'f3000000-0000-4000-8000-000000000504'::uuid), 2, 'accepted correction creates a new observation revision');
select extensions.is((select outcome_classification from public.report_projection_reconciliation_resolutions r join public.report_projection_reconciliations c on c.id = r.reconciliation_id where c.report_package_id = 'f3000000-0000-4000-8000-000000000504'::uuid), 'approved_correction', 'resolution records approved correction classification');
select extensions.ok(exists (select 1 from public.audit_events where event_name = 'report_projection.correction_accepted' and organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid), 'accepted correction emits immutable audit evidence');
select extensions.ok(exists (select 1 from public.audit_events where event_name = 'exact_range_metric_observation.superseded' and organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid), 'supersession emits immutable audit evidence');
select extensions.ok(exists (select 1 from public.audit_events where event_name = 'report_projection.overlap_resolved' and organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid), 'overlap resolution emits immutable audit evidence');
select extensions.is((public.resolve_governed_report_projection_overlap('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid, (select id from public.report_projection_reconciliations where report_package_id = 'f3000000-0000-4000-8000-000000000504'::uuid), 'accept_correction', 'reconciliation-resolution-0001', 'f3000000-0000-4000-8000-000000000643'::uuid) ->> 'outcome'), 'completed', 'resolution retry safely replays the append-only outcome');
select extensions.is((select count(*)::integer from public.report_projection_reconciliations r where r.organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid and to_jsonb(r)::text like '%1300%'), 0, 'reconciliation evidence does not persist raw aggregate values');
select extensions.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('report_projection_reconciliations', 'report_projection_reconciliation_resolutions') and column_name in ('value_numerator', 'raw_row', 'raw_cell', 'formula', 'signed_url', 'prompt', 'model_output', 'original_filename')), 'reconciliation tables contain safe evidence fields only');
set local role service_role;
select extensions.is((public.claim_governed_report_package_projection('f3000000-0000-4000-8000-000000000201'::uuid, 'f3000000-0000-4000-8000-000000000505'::uuid, 'f3000000-0000-4000-8000-000000000702'::uuid, 'f3000000-0000-4000-8000-000000000704'::uuid, 'f3000000-0000-4000-8000-000000000905'::uuid, 'reconciliation-projection-run-0005', 'f3000000-0000-4000-8000-000000000a15'::uuid, 'f3000000-0000-4000-8000-000000000644'::uuid) ->> 'outcome'), 'in_progress', 'active worker lease deterministically fences a duplicate retry');
select extensions.ok(pg_get_functiondef('public.claim_governed_report_package_projection(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid)'::regprocedure) ~ E'operation\\.lease_expires_at > now\\(\\)', 'only an unexpired worker lease fences a retry');
select extensions.ok(pg_get_functiondef('public.claim_governed_report_package_projection(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid)'::regprocedure) ~ E'attempt_count = attempt_count \\+ 1', 'expired-lease recovery records a bounded retry attempt');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'f3000000-0000-4000-8000-000000000001';
select extensions.is((select count(*)::integer from public.report_projection_reconciliations where organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid), 4, 'authorized owner can read safe reconciliation history');
set local request.jwt.claim.sub = 'f3000000-0000-4000-8000-000000000002';
select extensions.is((select count(*)::integer from public.report_projection_reconciliations where organization_id = 'f3000000-0000-4000-8000-000000000201'::uuid), 0, 'unrelated tenant user cannot read reconciliation evidence');

select * from extensions.finish();

rollback;
