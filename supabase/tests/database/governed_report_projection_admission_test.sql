begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(7);

-- ADR 0046 gives the projection claim two admissible paths: a mapping
-- approved against the exact package, or a matching active admission. The
-- second path was never built: the claim demanded the package's schema
-- fingerprint equal the binding's even for admitted packages, and the
-- schema fingerprint hashes the worksheet tab name -- which Talabat rewrites
-- every month. Proved here against real leases: an admitted package whose
-- tab was renamed claims, while the strict path and the admission's own
-- identity checks still refuse.

select extensions.has_function('public', 'claim_governed_report_package_projection', 'the projection claim is database-owned');

insert into auth.users (id) values
  ('b1000000-0000-4000-8000-000000000001'::uuid);
insert into public.accounts (id, name, slug, created_by)
values ('b1000000-0000-4000-8000-000000000101'::uuid, 'Projection admission verifier', 'projection-admission-verifier', 'b1000000-0000-4000-8000-000000000001'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by)
values ('b1000000-0000-4000-8000-000000000201'::uuid, 'b1000000-0000-4000-8000-000000000101'::uuid, 'Projection admission verifier', 'projection-admission-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'b1000000-0000-4000-8000-000000000001'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role)
values ('b1000000-0000-4000-8000-000000000101'::uuid, 'b1000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');
insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('b1000000-0000-4000-8000-000000000301'::uuid, 'b1000000-0000-4000-8000-000000000201'::uuid, 'Projection admission outlet', 'projection-admission-outlet', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('b1000000-0000-4000-8000-000000000401'::uuid, 'b1000000-0000-4000-8000-000000000201'::uuid, 'projection-admission-chan', 'Projection admission channel', 'marketplace', 'b1000000-0000-4000-8000-000000000001'::uuid);

insert into storage.objects (bucket_id, name, metadata, version)
select 'governed-report-packages',
  'b1000000-0000-4000-8000-000000000201/b1000000-0000-4000-8000-000000000401/' || package_id || '/1/original/report.csv',
  jsonb_build_object('size', 42, 'mimetype', 'text/csv'), 'admission-' || ordinal
from (values
  ('b1000000-0000-4000-8000-000000000501', 1), ('b1000000-0000-4000-8000-000000000502', 2),
  ('b1000000-0000-4000-8000-000000000503', 3), ('b1000000-0000-4000-8000-000000000504', 4)
) as packages(package_id, ordinal);

-- Packages first: contract versions point at them, while the admission link
-- points back at the admission -- so the link is set by update below, once
-- the admission exists. The write-once guard allows null to a first value.
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, storage_object_id, storage_object_version, content_sha256, schema_fingerprint, structure_fingerprint,
  status, upload_expires_at, uploaded_at, profiled_at, created_by, correlation_id
)
select package_id::uuid, 'b1000000-0000-4000-8000-000000000201'::uuid,
  'b1000000-0000-4000-8000-000000000401'::uuid, 'b1000000-0000-4000-8000-000000000301'::uuid,
  'performance_daily', date '2026-05-01', date '2026-05-31', 'AED', 'Asia/Dubai', 'csv', 'report.csv', 'text/csv', 42,
  o.name, o.id, o.version, content_sha256, repeat('d', 64), structure_fp, 'awaiting_projection', now() + interval '1 hour', now(), now(),
  'b1000000-0000-4000-8000-000000000001'::uuid, correlation_id::uuid
from (values
  ('b1000000-0000-4000-8000-000000000501', repeat('e', 64), repeat('a', 64), 'b1000000-0000-4000-8000-000000000621'),
  ('b1000000-0000-4000-8000-000000000502', repeat('e', 64), repeat('a', 64), 'b1000000-0000-4000-8000-000000000622'),
  ('b1000000-0000-4000-8000-000000000503', repeat('e', 64), repeat('f', 64), 'b1000000-0000-4000-8000-000000000623'),
  ('b1000000-0000-4000-8000-000000000504', repeat('e', 64), repeat('a', 64), 'b1000000-0000-4000-8000-000000000624')
) as p(package_id, content_sha256, structure_fp, correlation_id)
join storage.objects o on o.bucket_id = 'governed-report-packages'
  and o.name = 'b1000000-0000-4000-8000-000000000201/b1000000-0000-4000-8000-000000000401/' || p.package_id || '/1/original/report.csv';

insert into public.report_contracts (id, organization_id, channel_id, report_type, outlet_grain, created_by)
values ('b1000000-0000-4000-8000-000000000601'::uuid, 'b1000000-0000-4000-8000-000000000201'::uuid, 'b1000000-0000-4000-8000-000000000401'::uuid, 'performance_daily', 'branch', 'b1000000-0000-4000-8000-000000000001'::uuid);

insert into public.report_contract_versions (
  id, organization_id, report_contract_id, report_package_id, version, schema_fingerprint, parser_version, fingerprint_version,
  mapping_document, mapping_digest, declared_currency, financial_sign_semantics, controls, unmapped_field_disposition, proposal_source, created_by, correlation_id
) values
  ('b1000000-0000-4000-8000-000000000602'::uuid, 'b1000000-0000-4000-8000-000000000201'::uuid, 'b1000000-0000-4000-8000-000000000601'::uuid,
   'b1000000-0000-4000-8000-000000000501'::uuid, 1, repeat('b', 64), 1, 3,
   '{}'::jsonb, repeat('c', 64), 'AED', '[]'::jsonb, '[]'::jsonb, 'reviewed_ignore', 'human', 'b1000000-0000-4000-8000-000000000001'::uuid, 'b1000000-0000-4000-8000-000000000606'::uuid);

insert into public.report_contract_decisions (organization_id, report_contract_version_id, decision, mapping_digest, decided_by, correlation_id)
values ('b1000000-0000-4000-8000-000000000201'::uuid, 'b1000000-0000-4000-8000-000000000602'::uuid, 'approved', repeat('c', 64), 'b1000000-0000-4000-8000-000000000001'::uuid, 'b1000000-0000-4000-8000-000000000607'::uuid);

insert into public.report_contract_bindings (id, organization_id, report_contract_id, report_contract_version_id, channel_id, report_type, schema_fingerprint, declared_currency, outlet_grain, bound_by, correlation_id)
values ('b1000000-0000-4000-8000-000000000603'::uuid, 'b1000000-0000-4000-8000-000000000201'::uuid, 'b1000000-0000-4000-8000-000000000601'::uuid, 'b1000000-0000-4000-8000-000000000602'::uuid, 'b1000000-0000-4000-8000-000000000401'::uuid, 'performance_daily', repeat('b', 64), 'AED', 'branch', 'b1000000-0000-4000-8000-000000000001'::uuid, 'b1000000-0000-4000-8000-000000000608'::uuid);

insert into public.report_projection_versions (id, organization_id, report_contract_version_id, version, projection_document, projection_digest, calculation_version, proposal_source, created_by, correlation_id)
values ('b1000000-0000-4000-8000-000000000604'::uuid, 'b1000000-0000-4000-8000-000000000201'::uuid, 'b1000000-0000-4000-8000-000000000602'::uuid, 1,
  '{"schemaVersion":1,"outputKind":"exact_range","outputs":[{"key":"gross_revenue","metricKey":"revenue.gross","valueKind":"money","aggregation":"sum","normalizedSheetName":"csv","canonicalField":"net_sales"}],"controlTotals":[]}'::jsonb,
  repeat('d', 64), 1, 'human', 'b1000000-0000-4000-8000-000000000001'::uuid, 'b1000000-0000-4000-8000-000000000609'::uuid);

insert into public.report_projection_decisions (organization_id, report_projection_version_id, decision, projection_digest, decided_by, correlation_id)
values ('b1000000-0000-4000-8000-000000000201'::uuid, 'b1000000-0000-4000-8000-000000000604'::uuid, 'approved', repeat('d', 64), 'b1000000-0000-4000-8000-000000000001'::uuid, 'b1000000-0000-4000-8000-000000000610'::uuid);

insert into public.report_projection_bindings (id, organization_id, report_contract_version_id, report_contract_binding_id, report_projection_version_id, schema_fingerprint, declared_currency, bound_by, correlation_id)
values ('b1000000-0000-4000-8000-000000000605'::uuid, 'b1000000-0000-4000-8000-000000000201'::uuid, 'b1000000-0000-4000-8000-000000000602'::uuid, 'b1000000-0000-4000-8000-000000000603'::uuid, 'b1000000-0000-4000-8000-000000000604'::uuid, repeat('b', 64), 'AED', 'b1000000-0000-4000-8000-000000000001'::uuid, 'b1000000-0000-4000-8000-000000000611'::uuid);

-- The standing admission: this channel's structure SSS is read with the
-- approved mapping above. Every package below carries schema DDD -- a
-- renamed worksheet tab -- which matches no binding on purpose.
insert into public.report_structure_admissions (
  id, organization_id, channel_id, structure_fingerprint, structure_version, declared_currency, outlet_grain,
  report_type, report_contract_version_id, report_projection_version_id, granted_by, correlation_id
) values ('b1000000-0000-4000-8000-000000000612'::uuid, 'b1000000-0000-4000-8000-000000000201'::uuid, 'b1000000-0000-4000-8000-000000000401'::uuid,
  repeat('a', 64), 1, 'AED', 'branch', 'performance_daily',
  'b1000000-0000-4000-8000-000000000602'::uuid, 'b1000000-0000-4000-8000-000000000604'::uuid,
  'b1000000-0000-4000-8000-000000000001'::uuid, 'b1000000-0000-4000-8000-000000000613'::uuid);

-- Three of the four packages arrived through the admission, exactly as the
-- validation claim records it. The second package is the ordinary path.
update public.integration_report_packages
set admitted_under_admission_id = 'b1000000-0000-4000-8000-000000000612'::uuid
where id in (
  'b1000000-0000-4000-8000-000000000501'::uuid,
  'b1000000-0000-4000-8000-000000000503'::uuid,
  'b1000000-0000-4000-8000-000000000504'::uuid
);

insert into public.integration_report_validation_runs (id, organization_id, report_package_id, report_contract_version_id, report_contract_binding_id, validator_version, input_digest, result_digest, status, quality_state, completeness_state, correlation_id, completed_at)
select validation_id::uuid, 'b1000000-0000-4000-8000-000000000201'::uuid, package_id::uuid, 'b1000000-0000-4000-8000-000000000602'::uuid, 'b1000000-0000-4000-8000-000000000603'::uuid, 1, repeat('e', 64), repeat('f', 64), 'validated', 'complete', 'complete', correlation_id::uuid, now()
from (values
  ('b1000000-0000-4000-8000-000000000501', 'b1000000-0000-4000-8000-000000000701', 'b1000000-0000-4000-8000-000000000631'),
  ('b1000000-0000-4000-8000-000000000502', 'b1000000-0000-4000-8000-000000000702', 'b1000000-0000-4000-8000-000000000632'),
  ('b1000000-0000-4000-8000-000000000503', 'b1000000-0000-4000-8000-000000000703', 'b1000000-0000-4000-8000-000000000633'),
  ('b1000000-0000-4000-8000-000000000504', 'b1000000-0000-4000-8000-000000000704', 'b1000000-0000-4000-8000-000000000634')
) as valueset(package_id, validation_id, correlation_id);

set local role service_role;

-- The May 2026 case: admitted, same columns, renamed tab. The schema the
-- provider renamed must not stop a lease the admission authorises.
select extensions.is((public.claim_governed_report_package_projection('b1000000-0000-4000-8000-000000000201'::uuid, 'b1000000-0000-4000-8000-000000000501'::uuid, 'b1000000-0000-4000-8000-000000000602'::uuid, 'b1000000-0000-4000-8000-000000000604'::uuid, 'b1000000-0000-4000-8000-000000000801'::uuid, 'projection-admission-claim-01', 'b1000000-0000-4000-8000-000000000a01'::uuid, 'b1000000-0000-4000-8000-000000000641'::uuid) ->> 'outcome'), 'acquired', 'an admitted package with a renamed tab claims its projection lease');
select extensions.is((select status from public.integration_report_packages where id = 'b1000000-0000-4000-8000-000000000501'::uuid), 'projecting', 'the admitted claim moves the package to projecting');

-- The ordinary path is untouched: no admission, renamed tab, still refused.
select extensions.is((public.claim_governed_report_package_projection('b1000000-0000-4000-8000-000000000201'::uuid, 'b1000000-0000-4000-8000-000000000502'::uuid, 'b1000000-0000-4000-8000-000000000602'::uuid, 'b1000000-0000-4000-8000-000000000604'::uuid, 'b1000000-0000-4000-8000-000000000802'::uuid, 'projection-admission-claim-02', 'b1000000-0000-4000-8000-000000000a02'::uuid, 'b1000000-0000-4000-8000-000000000642'::uuid) ->> 'outcome'), 'not_ready', 'a non-admitted package with a renamed tab is still refused');

-- The admission is still an identity check, not a waiver: columns that do
-- not match the admitted structure cannot claim under it.
select extensions.is((public.claim_governed_report_package_projection('b1000000-0000-4000-8000-000000000201'::uuid, 'b1000000-0000-4000-8000-000000000503'::uuid, 'b1000000-0000-4000-8000-000000000602'::uuid, 'b1000000-0000-4000-8000-000000000604'::uuid, 'b1000000-0000-4000-8000-000000000803'::uuid, 'projection-admission-claim-03', 'b1000000-0000-4000-8000-000000000a03'::uuid, 'b1000000-0000-4000-8000-000000000643'::uuid) ->> 'outcome'), 'not_ready', 'an admitted package with different columns is still refused');

-- Revoking returns the structure to per-upload approval for future uploads.
-- A package that already validated under the admission has no second
-- approval it could take, so its in-flight projection still completes
-- rather than stranding in awaiting_projection with no path forward.
update public.report_structure_admissions
set active = false, revoked_by = 'b1000000-0000-4000-8000-000000000001'::uuid, revoked_at = now()
where id = 'b1000000-0000-4000-8000-000000000612'::uuid;

select extensions.is((public.claim_governed_report_package_projection('b1000000-0000-4000-8000-000000000201'::uuid, 'b1000000-0000-4000-8000-000000000504'::uuid, 'b1000000-0000-4000-8000-000000000602'::uuid, 'b1000000-0000-4000-8000-000000000604'::uuid, 'b1000000-0000-4000-8000-000000000804'::uuid, 'projection-admission-claim-04', 'b1000000-0000-4000-8000-000000000a04'::uuid, 'b1000000-0000-4000-8000-000000000644'::uuid) ->> 'outcome'), 'acquired', 'an in-flight admitted package still projects after its admission is revoked');
select extensions.is((select active from public.report_structure_admissions where id = 'b1000000-0000-4000-8000-000000000612'::uuid), false, 'the revocation the previous claim survived is really recorded');

select * from extensions.finish();

rollback;
