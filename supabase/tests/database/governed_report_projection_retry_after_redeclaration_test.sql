begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(9);

-- A retry under a newly approved projection version must be claimable.
--
-- March 2026 proved the gap on staging: the file was refused for the
-- undeclared label CLOSED, the label was declared into Figures v2 and
-- approved, the retry moved the package to awaiting_projection -- and the
-- claim answered `conflict` forever, because it compares the requested
-- versions against the failed run's versions before reaching the
-- failed-run recovery branch. No worker can pick up that package, however
-- healthy the fleet is. Refusing the unknown label stays; this only opens
-- the way out once a person has approved the new vocabulary.

insert into auth.users (id) values
  ('f6000000-0000-4000-8000-000000000001'::uuid);

insert into public.accounts (id, name, slug, created_by)
values ('f6000000-0000-4000-8000-000000000101'::uuid, 'Redeclare verifier', 'redeclare-verifier', 'f6000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by)
values ('f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000101'::uuid, 'Redeclare verifier', 'redeclare-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'f6000000-0000-4000-8000-000000000001'::uuid);

insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('f6000000-0000-4000-8000-000000000301'::uuid, 'f6000000-0000-4000-8000-000000000201'::uuid, 'Redeclare outlet', 'redeclare-outlet', 'physical', 'Asia/Dubai', 'AED');

insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('f6000000-0000-4000-8000-000000000401'::uuid, 'f6000000-0000-4000-8000-000000000201'::uuid, 'redeclare-channel', 'Redeclare channel', 'marketplace', 'f6000000-0000-4000-8000-000000000001'::uuid);

insert into public.account_memberships (account_id, user_id, account_role, default_organization_role)
values ('f6000000-0000-4000-8000-000000000101'::uuid, 'f6000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');

-- Two packages with real objects: P1 is the March retried under v2, P2 keeps
-- a live v1 lease so the strict conflict for running work stays proved.
insert into storage.objects (bucket_id, name, metadata, version)
select 'governed-report-packages',
  'f6000000-0000-4000-8000-000000000201/f6000000-0000-4000-8000-000000000401/' || package_id || '/1/original/report.csv',
  jsonb_build_object('size', 42, 'mimetype', 'text/csv'), 'redeclare-' || ordinal
from (values
  ('f6000000-0000-4000-8000-000000000501', 1), ('f6000000-0000-4000-8000-000000000502', 2)
) as packages(package_id, ordinal);

insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, storage_object_id, storage_object_version, content_sha256, schema_fingerprint, status,
  upload_expires_at, uploaded_at, profiled_at, created_by, correlation_id
)
select package_id::uuid, 'f6000000-0000-4000-8000-000000000201'::uuid,
  'f6000000-0000-4000-8000-000000000401'::uuid, 'f6000000-0000-4000-8000-000000000301'::uuid,
  'Marketplace Cancellations', date '2026-03-01', date '2026-03-31', 'AED', 'Asia/Dubai', 'csv', 'mar.csv', 'text/csv', 42,
  o.name, o.id, o.version, repeat('a', 64), repeat('b', 64), 'awaiting_projection', now() + interval '1 hour', now(), now(),
  'f6000000-0000-4000-8000-000000000001'::uuid, correlation_id::uuid
from (values
  ('f6000000-0000-4000-8000-000000000501', 'f6000000-0000-4000-8000-000000000601'),
  ('f6000000-0000-4000-8000-000000000502', 'f6000000-0000-4000-8000-000000000602')
) as p(package_id, correlation_id)
join storage.objects o on o.bucket_id = 'governed-report-packages'
  and o.name = 'f6000000-0000-4000-8000-000000000201/f6000000-0000-4000-8000-000000000401/' || p.package_id || '/1/original/report.csv';

-- P3 never got its retry requested: failed and still projection_failed, with
-- no object row needed because no claim under test may legally reach storage.
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, content_sha256, schema_fingerprint, status,
  upload_expires_at, uploaded_at, profiled_at, created_by, correlation_id
) values
  ('f6000000-0000-4000-8000-000000000503'::uuid, 'f6000000-0000-4000-8000-000000000201'::uuid,
   'f6000000-0000-4000-8000-000000000401'::uuid, 'f6000000-0000-4000-8000-000000000301'::uuid,
   'Marketplace Cancellations', date '2026-03-01', date '2026-03-31', 'AED', 'Asia/Dubai', 'csv', 'mar.csv', 'text/csv', 42,
   'f6000000-0000-4000-8000-000000000201/f6000000-0000-4000-8000-000000000401/f6000000-0000-4000-8000-000000000503/1/original/report.csv',
   repeat('a', 64), repeat('b', 64), 'projection_failed',
   now() + interval '1 hour', now(), now(),
   'f6000000-0000-4000-8000-000000000001'::uuid, 'f6000000-0000-4000-8000-000000000603'::uuid);

insert into public.report_contracts (id, organization_id, channel_id, report_type, outlet_grain, created_by)
values ('f6000000-0000-4000-8000-000000000701'::uuid, 'f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000401'::uuid, 'Marketplace Cancellations Contract', 'branch', 'f6000000-0000-4000-8000-000000000001'::uuid);

insert into public.report_contract_versions (
  id, organization_id, report_contract_id, report_package_id, version, schema_fingerprint, parser_version,
  fingerprint_version, mapping_document, mapping_digest, declared_currency, financial_sign_semantics, controls,
  unmapped_field_disposition, proposal_source, created_by, correlation_id
) values
  ('f6000000-0000-4000-8000-000000000702'::uuid, 'f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000701'::uuid,
   'f6000000-0000-4000-8000-000000000501'::uuid, 1, repeat('b', 64), 1, 3,
   '{"sheets":[{"normalizedSheetName":"csv","fields":[{"canonicalField":"business_date","parser":"local_date","required":true},{"canonicalField":"cancel_reason","parser":"text","required":true}]}]}'::jsonb,
   repeat('c', 64), 'AED', '[]'::jsonb, '[]'::jsonb,
   'reviewed_ignore', 'human', 'f6000000-0000-4000-8000-000000000001'::uuid, 'f6000000-0000-4000-8000-000000000604'::uuid);

insert into public.report_contract_decisions (organization_id, report_contract_version_id, decision, mapping_digest, decided_by, correlation_id)
values ('f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 'approved', repeat('c', 64), 'f6000000-0000-4000-8000-000000000001'::uuid, 'f6000000-0000-4000-8000-000000000605'::uuid);

insert into public.report_contract_bindings (id, organization_id, report_contract_id, report_contract_version_id, channel_id, report_type, schema_fingerprint, declared_currency, outlet_grain, bound_by, correlation_id)
values ('f6000000-0000-4000-8000-000000000703'::uuid, 'f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000701'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 'f6000000-0000-4000-8000-000000000401'::uuid, 'Marketplace Cancellations', repeat('b', 64), 'AED', 'branch', 'f6000000-0000-4000-8000-000000000001'::uuid, 'f6000000-0000-4000-8000-000000000606'::uuid);

-- v1 declares only ITEM_UNAVAILABLE; v2 adds CLOSED. Both approved, but only
-- v2 is bound -- exactly the staging state after the March declaration.
insert into public.report_projection_versions (id, organization_id, report_contract_version_id, version, projection_document, projection_digest, calculation_version, proposal_source, created_by, correlation_id)
values
  ('f6000000-0000-4000-8000-000000000704'::uuid, 'f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 1,
   '{"schemaVersion":1,"outputKind":"period_grain","grain":"day","periodKey":{"normalizedSheetName":"csv","canonicalField":"business_date"},"outputs":[{"key":"cancel_reason","normalizedSheetName":"csv","canonicalField":"cancel_reason","metricKey":"order.avoidable_cancellation_reason","valueKind":"count","aggregation":"sum","categorical":{"dimensionKey":"cancelled_by","allowedValues":["ITEM_UNAVAILABLE"],"collectInjectedValues":false}}]}'::jsonb,
   repeat('d', 64), 1, 'human', 'f6000000-0000-4000-8000-000000000001'::uuid, 'f6000000-0000-4000-8000-000000000607'::uuid),
  ('f6000000-0000-4000-8000-000000000705'::uuid, 'f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 2,
   '{"schemaVersion":1,"outputKind":"period_grain","grain":"day","periodKey":{"normalizedSheetName":"csv","canonicalField":"business_date"},"outputs":[{"key":"cancel_reason","normalizedSheetName":"csv","canonicalField":"cancel_reason","metricKey":"order.avoidable_cancellation_reason","valueKind":"count","aggregation":"sum","categorical":{"dimensionKey":"cancelled_by","allowedValues":["ITEM_UNAVAILABLE","CLOSED"],"collectInjectedValues":false}}]}'::jsonb,
   repeat('e', 64), 1, 'human', 'f6000000-0000-4000-8000-000000000001'::uuid, 'f6000000-0000-4000-8000-000000000608'::uuid);

insert into public.report_projection_decisions (organization_id, report_projection_version_id, decision, projection_digest, decided_by, correlation_id)
values
  ('f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000704'::uuid, 'approved', repeat('d', 64), 'f6000000-0000-4000-8000-000000000001'::uuid, 'f6000000-0000-4000-8000-000000000609'::uuid),
  ('f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000705'::uuid, 'approved', repeat('e', 64), 'f6000000-0000-4000-8000-000000000001'::uuid, 'f6000000-0000-4000-8000-000000000610'::uuid);

insert into public.report_projection_bindings (id, organization_id, report_contract_version_id, report_contract_binding_id, report_projection_version_id, schema_fingerprint, declared_currency, active, bound_by, correlation_id)
values
  ('f6000000-0000-4000-8000-000000000706'::uuid, 'f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 'f6000000-0000-4000-8000-000000000703'::uuid, 'f6000000-0000-4000-8000-000000000704'::uuid, repeat('b', 64), 'AED', false, 'f6000000-0000-4000-8000-000000000001'::uuid, 'f6000000-0000-4000-8000-000000000611'::uuid),
  ('f6000000-0000-4000-8000-000000000707'::uuid, 'f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 'f6000000-0000-4000-8000-000000000703'::uuid, 'f6000000-0000-4000-8000-000000000705'::uuid, repeat('b', 64), 'AED', true, 'f6000000-0000-4000-8000-000000000001'::uuid, 'f6000000-0000-4000-8000-000000000612'::uuid);

insert into public.integration_report_validation_runs (id, organization_id, report_package_id, report_contract_version_id, report_contract_binding_id, validator_version, input_digest, result_digest, status, quality_state, completeness_state, correlation_id, completed_at)
values
  ('f6000000-0000-4000-8000-000000000801'::uuid, 'f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000501'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 'f6000000-0000-4000-8000-000000000703'::uuid, 1, repeat('e', 64), repeat('f', 64), 'validated', 'complete', 'complete', 'f6000000-0000-4000-8000-000000000613'::uuid, now()),
  ('f6000000-0000-4000-8000-000000000802'::uuid, 'f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000502'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 'f6000000-0000-4000-8000-000000000703'::uuid, 1, repeat('e', 64), repeat('f', 64), 'validated', 'complete', 'complete', 'f6000000-0000-4000-8000-000000000614'::uuid, now());

-- A prior failed v1 run with its lease still held, for P1 and P3 alike.
insert into public.integration_report_projection_runs (id, organization_id, report_package_id, report_contract_version_id, report_contract_binding_id, report_projection_version_id, report_projection_binding_id, validation_run_id, calculation_version, input_digest, result_digest, status, quality_state, completeness_state, output_count, error_codes, warning_codes, correlation_id, started_at, completed_at)
values
  ('f6000000-0000-4000-8000-000000000901'::uuid, 'f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000501'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 'f6000000-0000-4000-8000-000000000703'::uuid, 'f6000000-0000-4000-8000-000000000704'::uuid, 'f6000000-0000-4000-8000-000000000706'::uuid, 'f6000000-0000-4000-8000-000000000801'::uuid, 1, repeat('1', 64), repeat('2', 64), 'failed', 'failed', 'unavailable', 0, '["PROJECTION_PROCESSING_FAILED"]'::jsonb, '[]'::jsonb, 'f6000000-0000-4000-8000-000000000615'::uuid, now(), now()),
  ('f6000000-0000-4000-8000-000000000903'::uuid, 'f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000503'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 'f6000000-0000-4000-8000-000000000703'::uuid, 'f6000000-0000-4000-8000-000000000704'::uuid, 'f6000000-0000-4000-8000-000000000706'::uuid, 'f6000000-0000-4000-8000-000000000801'::uuid, 1, repeat('1', 64), repeat('2', 64), 'failed', 'failed', 'unavailable', 0, '["PROJECTION_PROCESSING_FAILED"]'::jsonb, '[]'::jsonb, 'f6000000-0000-4000-8000-000000000616'::uuid, now(), now()),
  ('f6000000-0000-4000-8000-000000000902'::uuid, 'f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000502'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 'f6000000-0000-4000-8000-000000000703'::uuid, 'f6000000-0000-4000-8000-000000000704'::uuid, 'f6000000-0000-4000-8000-000000000706'::uuid, 'f6000000-0000-4000-8000-000000000802'::uuid, 1, repeat('1', 64), null, 'running', 'complete', 'complete', 0, '[]'::jsonb, '[]'::jsonb, 'f6000000-0000-4000-8000-000000000617'::uuid, now(), null);

insert into private.integration_report_projection_operations (organization_id, report_package_id, idempotency_key, input_digest, projection_run_id, claim_token, lease_expires_at)
values
  ('f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000501'::uuid, 'report-projection:f6000000-0000-4000-8000-000000000901', repeat('1', 64), 'f6000000-0000-4000-8000-000000000901'::uuid, 'f6000000-0000-4000-8000-000000000a01'::uuid, now() - interval '1 hour'),
  ('f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000502'::uuid, 'report-projection:f6000000-0000-4000-8000-000000000902', repeat('1', 64), 'f6000000-0000-4000-8000-000000000902'::uuid, 'f6000000-0000-4000-8000-000000000a02'::uuid, now() + interval '20 minutes'),
  ('f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000503'::uuid, 'report-projection:f6000000-0000-4000-8000-000000000903', repeat('1', 64), 'f6000000-0000-4000-8000-000000000903'::uuid, 'f6000000-0000-4000-8000-000000000a03'::uuid, now() - interval '1 hour');

-- P2's worker is still holding its v1 lease.
update public.integration_report_packages set status = 'projecting'
where id = 'f6000000-0000-4000-8000-000000000502'::uuid;

set local role service_role;

-- P2 holds a live v1 lease: the retry runs first so its operation exists.
select extensions.is((public.claim_governed_report_package_projection('f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000502'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 'f6000000-0000-4000-8000-000000000704'::uuid, 'f6000000-0000-4000-8000-000000000902'::uuid, 'report-projection:f6000000-0000-4000-8000-000000000902', 'f6000000-0000-4000-8000-000000000a02'::uuid, 'f6000000-0000-4000-8000-000000000617'::uuid) ->> 'outcome'), 'acquired', 'a live lease is acquired for the running package');

-- The March case: failed under v1, re-requested, now claimed under v2.
select extensions.is((public.claim_governed_report_package_projection('f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000501'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 'f6000000-0000-4000-8000-000000000705'::uuid, 'f6000000-0000-4000-8000-000000000911'::uuid, 'report-projection:f6000000-0000-4000-8000-000000000911', 'f6000000-0000-4000-8000-000000000a11'::uuid, 'f6000000-0000-4000-8000-000000000618'::uuid) ->> 'outcome'), 'acquired', 'a retry under the newly approved version acquires a fresh lease');

select extensions.is((select status from public.integration_report_packages where id = 'f6000000-0000-4000-8000-000000000501'::uuid), 'projecting', 'the retried package moves back to projecting');

select extensions.is((select status from public.integration_report_projection_runs where id = 'f6000000-0000-4000-8000-000000000911'::uuid), 'running', 'the retry opened a new run rather than reusing the failed one');

select extensions.is((public.claim_governed_report_package_projection('f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000501'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 'f6000000-0000-4000-8000-000000000705'::uuid, 'f6000000-0000-4000-8000-000000000911'::uuid, 'report-projection:f6000000-0000-4000-8000-000000000911', 'f6000000-0000-4000-8000-000000000a12'::uuid, 'f6000000-0000-4000-8000-000000000619'::uuid) ->> 'outcome'), 'in_progress', 'the fresh lease is fenced by its claim token');

-- Guards that must not move: a version change never preempts live work, an
-- unrequested failure never becomes claimable, and tenants stay isolated.
select extensions.is((public.claim_governed_report_package_projection('f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000502'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 'f6000000-0000-4000-8000-000000000705'::uuid, 'f6000000-0000-4000-8000-000000000912'::uuid, 'report-projection:f6000000-0000-4000-8000-000000000912', 'f6000000-0000-4000-8000-000000000a13'::uuid, 'f6000000-0000-4000-8000-000000000620'::uuid) ->> 'outcome'), 'conflict', 'a version change still conflicts while its run is live');

select extensions.is((public.claim_governed_report_package_projection('f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000503'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 'f6000000-0000-4000-8000-000000000705'::uuid, 'f6000000-0000-4000-8000-000000000913'::uuid, 'report-projection:f6000000-0000-4000-8000-000000000913', 'f6000000-0000-4000-8000-000000000a14'::uuid, 'f6000000-0000-4000-8000-000000000621'::uuid) ->> 'outcome'), 'not_ready', 'a failure nobody re-requested stays unclaimable');

select extensions.is((public.claim_governed_report_package_projection('b7000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000501'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 'f6000000-0000-4000-8000-000000000705'::uuid, 'f6000000-0000-4000-8000-000000000914'::uuid, 'report-projection:f6000000-0000-4000-8000-000000000914', 'f6000000-0000-4000-8000-000000000a15'::uuid, 'f6000000-0000-4000-8000-000000000622'::uuid) ->> 'outcome'), 'not_found', 'a claim from another organization finds nothing');

reset role;

set local request.jwt.claim.sub = 'f6000000-0000-4000-8000-000000000001';
select extensions.throws_ok(
  $$ select public.claim_governed_report_package_projection('f6000000-0000-4000-8000-000000000201'::uuid, 'f6000000-0000-4000-8000-000000000501'::uuid, 'f6000000-0000-4000-8000-000000000702'::uuid, 'f6000000-0000-4000-8000-000000000705'::uuid, 'f6000000-0000-4000-8000-000000000915'::uuid, 'report-projection:f6000000-0000-4000-8000-000000000915', 'f6000000-0000-4000-8000-000000000a16'::uuid, 'f6000000-0000-4000-8000-000000000623'::uuid) $$,
  '42501', 'report projection claim is worker-only', 'members cannot claim projection work even for a retried package'
);

select * from extensions.finish();

rollback;