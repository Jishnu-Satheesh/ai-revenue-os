begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(33);

-- Existence and grants. Worker-only, matching
-- `complete_governed_report_package_profiling`'s grants exactly: a human
-- session -- including `authenticated` -- must never be able to call either
-- link directly, because each is fenced by the absence of a human actor.
select extensions.has_function('public', 'advance_governed_report_package_on_admission', 'link A exists: it advances an admitted package into validation without a human');
select extensions.has_function('public', 'advance_admitted_report_package_to_projection', 'link B exists: it advances an admitted, validated package into projection without a human');
select extensions.ok(
  not pg_catalog.has_function_privilege('authenticated', 'public.advance_governed_report_package_on_admission(uuid,uuid,uuid)', 'execute'),
  'authenticated users cannot call link A -- it is a worker-only path'
);
select extensions.ok(
  pg_catalog.has_function_privilege('service_role', 'public.advance_governed_report_package_on_admission(uuid,uuid,uuid)', 'execute'),
  'the service worker can call link A'
);
select extensions.ok(
  not pg_catalog.has_function_privilege('authenticated', 'public.advance_admitted_report_package_to_projection(uuid,uuid,uuid)', 'execute'),
  'authenticated users cannot call link B -- it is a worker-only path'
);
select extensions.ok(
  pg_catalog.has_function_privilege('service_role', 'public.advance_admitted_report_package_to_projection(uuid,uuid,uuid)', 'execute'),
  'the service worker can call link B'
);

-- Organization A: the tenant every positive and negative case below belongs
-- to, apart from the one deliberately cross-tenant case.
insert into auth.users (id) values
  ('c1000000-0000-4000-8000-000000000001'::uuid);
insert into public.accounts (id, name, slug, created_by)
values ('c1000000-0000-4000-8000-000000000101'::uuid, 'Admitted advance verifier', 'admitted-advance-verifier', 'c1000000-0000-4000-8000-000000000001'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by)
values ('c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000101'::uuid, 'Admitted advance verifier', 'admitted-advance-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'c1000000-0000-4000-8000-000000000001'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role)
values ('c1000000-0000-4000-8000-000000000101'::uuid, 'c1000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');
insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('c1000000-0000-4000-8000-000000000301'::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid, 'Admitted advance outlet', 'admitted-advance-outlet', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('c1000000-0000-4000-8000-000000000401'::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid, 'admitted-advance-channel', 'Admitted advance channel', 'marketplace', 'c1000000-0000-4000-8000-000000000001'::uuid);

-- Organization B: exists only to prove its admission -- for the exact same
-- structure fingerprint and currency -- cannot admit organization A's
-- package.
insert into auth.users (id) values ('c2000000-0000-4000-8000-000000000001'::uuid);
insert into public.accounts (id, name, slug, created_by)
values ('c2000000-0000-4000-8000-000000000101'::uuid, 'Admitted advance verifier (other org)', 'admitted-advance-verifier-other-org', 'c2000000-0000-4000-8000-000000000001'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by)
values ('c2000000-0000-4000-8000-000000000201'::uuid, 'c2000000-0000-4000-8000-000000000101'::uuid, 'Admitted advance verifier (other org)', 'admitted-advance-verifier-other-org', 'testing', 'AE', 'AED', 'Asia/Dubai', 'c2000000-0000-4000-8000-000000000001'::uuid);
insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('c2000000-0000-4000-8000-000000000301'::uuid, 'c2000000-0000-4000-8000-000000000201'::uuid, 'Other org outlet', 'other-org-outlet', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('c2000000-0000-4000-8000-000000000401'::uuid, 'c2000000-0000-4000-8000-000000000201'::uuid, 'other-org-channel', 'Other org channel', 'marketplace', 'c2000000-0000-4000-8000-000000000001'::uuid);

-- Neither link inspects storage identity or retention, so no real storage
-- object is needed -- only a syntactically valid, unique storage_path.

-- Origin package: exists only to satisfy report_contract_versions' required
-- report_package_id. Never itself advanced.
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, status, upload_expires_at, created_by, correlation_id
) values (
  'c1000000-0000-4000-8000-000000000500'::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid,
  'c1000000-0000-4000-8000-000000000401'::uuid, 'c1000000-0000-4000-8000-000000000301'::uuid,
  'Settlement', date '2026-07-01', date '2026-07-07', 'AED', 'Asia/Dubai', 'csv', 'origin.csv', 'text/csv', 42,
  'c1000000-0000-4000-8000-000000000201/c1000000-0000-4000-8000-000000000401/c1000000-0000-4000-8000-000000000500/1/original/report.csv',
  'awaiting_upload', now() + interval '1 hour', 'c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000600'::uuid
);

-- The approved contract + projection an admission points at (CV1/PV1,
-- bound and active), plus a second approved contract version (CV2) that is
-- deliberately left with no active projection binding, for the "no active
-- binding" refusal.
insert into public.report_contracts (id, organization_id, channel_id, report_type, outlet_grain, created_by)
values ('c1000000-0000-4000-8000-000000000701'::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000401'::uuid, 'Settlement', 'branch', 'c1000000-0000-4000-8000-000000000001'::uuid);
insert into public.report_contract_versions (
  id, organization_id, report_contract_id, report_package_id, version, schema_fingerprint, parser_version, fingerprint_version,
  mapping_document, mapping_digest, declared_currency, financial_sign_semantics, controls, unmapped_field_disposition,
  proposal_source, created_by, correlation_id
) values (
  'c1000000-0000-4000-8000-000000000702'::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000701'::uuid,
  'c1000000-0000-4000-8000-000000000500'::uuid, 1, repeat('9', 64), 1, 1,
  '{"schemaVersion":1,"currency":"AED","outletGrain":"branch","sheets":[],"controls":[],"unmappedFieldDisposition":"reviewed_ignore"}'::jsonb,
  repeat('c', 64), 'AED', '[]'::jsonb, '[]'::jsonb, 'reviewed_ignore', 'human', 'c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000603'::uuid
);
insert into public.report_contract_decisions (organization_id, report_contract_version_id, decision, mapping_digest, decided_by, correlation_id)
values ('c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000702'::uuid, 'approved', repeat('c', 64), 'c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000604'::uuid);
insert into public.report_contract_bindings (
  id, organization_id, report_contract_id, report_contract_version_id, channel_id, report_type, schema_fingerprint,
  declared_currency, outlet_grain, bound_by, correlation_id
) values (
  'c1000000-0000-4000-8000-000000000703'::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000701'::uuid,
  'c1000000-0000-4000-8000-000000000702'::uuid, 'c1000000-0000-4000-8000-000000000401'::uuid, 'Settlement',
  repeat('9', 64), 'AED', 'branch', 'c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000605'::uuid
);
insert into public.report_projection_versions (
  id, organization_id, report_contract_version_id, version, projection_document, projection_digest,
  calculation_version, proposal_source, created_by, correlation_id
) values (
  'c1000000-0000-4000-8000-000000000704'::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid,
  'c1000000-0000-4000-8000-000000000702'::uuid, 1, '{}'::jsonb, repeat('d', 64),
  1, 'human', 'c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000606'::uuid
);
insert into public.report_projection_decisions (organization_id, report_projection_version_id, decision, projection_digest, decided_by, correlation_id)
values ('c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000704'::uuid, 'approved', repeat('d', 64), 'c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000607'::uuid);
insert into public.report_projection_bindings (
  id, organization_id, report_contract_version_id, report_contract_binding_id, report_projection_version_id,
  schema_fingerprint, declared_currency, bound_by, correlation_id
) values (
  'c1000000-0000-4000-8000-000000000705'::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid,
  'c1000000-0000-4000-8000-000000000702'::uuid, 'c1000000-0000-4000-8000-000000000703'::uuid, 'c1000000-0000-4000-8000-000000000704'::uuid,
  repeat('9', 64), 'AED', 'c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000608'::uuid
);

-- CV2/CB2: a second approved contract version, deliberately never given a
-- projection binding -- what makes package 523 below prove "no_binding"
-- rather than something else.
insert into public.report_contract_versions (
  id, organization_id, report_contract_id, report_package_id, version, schema_fingerprint, parser_version, fingerprint_version,
  mapping_document, mapping_digest, declared_currency, financial_sign_semantics, controls, unmapped_field_disposition,
  proposal_source, created_by, correlation_id
) values (
  'c1000000-0000-4000-8000-000000000712'::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000701'::uuid,
  'c1000000-0000-4000-8000-000000000500'::uuid, 2, repeat('8', 64), 1, 1,
  '{"schemaVersion":1,"currency":"AED","outletGrain":"branch","sheets":[],"controls":[],"unmappedFieldDisposition":"reviewed_ignore"}'::jsonb,
  repeat('e', 64), 'AED', '[]'::jsonb, '[]'::jsonb, 'reviewed_ignore', 'human', 'c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000613'::uuid
);
insert into public.report_contract_decisions (organization_id, report_contract_version_id, decision, mapping_digest, decided_by, correlation_id)
values ('c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000712'::uuid, 'approved', repeat('e', 64), 'c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000614'::uuid);
insert into public.report_contract_bindings (
  id, organization_id, report_contract_id, report_contract_version_id, channel_id, report_type, schema_fingerprint,
  declared_currency, outlet_grain, bound_by, correlation_id
) values (
  'c1000000-0000-4000-8000-000000000713'::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000701'::uuid,
  'c1000000-0000-4000-8000-000000000712'::uuid, 'c1000000-0000-4000-8000-000000000401'::uuid, 'Settlement',
  repeat('8', 64), 'AED', 'branch', 'c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000615'::uuid
);

-- The standing admission link A must find, and the only one it may use.
insert into public.report_structure_admissions (
  id, organization_id, channel_id, structure_fingerprint, structure_version, declared_currency, outlet_grain,
  report_type, report_contract_version_id, report_projection_version_id, granted_by, correlation_id
) values (
  'c1000000-0000-4000-8000-000000000720'::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid,
  'c1000000-0000-4000-8000-000000000401'::uuid, repeat('1', 64), 1, 'AED', 'branch', 'Settlement',
  'c1000000-0000-4000-8000-000000000702'::uuid, 'c1000000-0000-4000-8000-000000000704'::uuid,
  'c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000721'::uuid
);

-- Organization B's admission: same structure fingerprint and currency as
-- package 512 below, on organization B's own channel. Its existence must
-- not let an unrelated organization's package through.
insert into public.report_contracts (id, organization_id, channel_id, report_type, outlet_grain, created_by)
values ('c2000000-0000-4000-8000-000000000701'::uuid, 'c2000000-0000-4000-8000-000000000201'::uuid, 'c2000000-0000-4000-8000-000000000401'::uuid, 'Settlement', 'branch', 'c2000000-0000-4000-8000-000000000001'::uuid);
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, status, upload_expires_at, created_by, correlation_id
) values (
  'c2000000-0000-4000-8000-000000000500'::uuid, 'c2000000-0000-4000-8000-000000000201'::uuid,
  'c2000000-0000-4000-8000-000000000401'::uuid, 'c2000000-0000-4000-8000-000000000301'::uuid,
  'Settlement', date '2026-07-01', date '2026-07-07', 'AED', 'Asia/Dubai', 'csv', 'other-org-origin.csv', 'text/csv', 42,
  'c2000000-0000-4000-8000-000000000201/c2000000-0000-4000-8000-000000000401/c2000000-0000-4000-8000-000000000500/1/original/report.csv',
  'awaiting_upload', now() + interval '1 hour', 'c2000000-0000-4000-8000-000000000001'::uuid, 'c2000000-0000-4000-8000-000000000600'::uuid
);
insert into public.report_contract_versions (
  id, organization_id, report_contract_id, report_package_id, version, schema_fingerprint, parser_version, fingerprint_version,
  mapping_document, mapping_digest, declared_currency, financial_sign_semantics, controls, unmapped_field_disposition,
  proposal_source, created_by, correlation_id
) values (
  'c2000000-0000-4000-8000-000000000702'::uuid, 'c2000000-0000-4000-8000-000000000201'::uuid, 'c2000000-0000-4000-8000-000000000701'::uuid,
  'c2000000-0000-4000-8000-000000000500'::uuid, 1, repeat('9', 64), 1, 1,
  '{"schemaVersion":1,"currency":"AED","outletGrain":"branch","sheets":[],"controls":[],"unmappedFieldDisposition":"reviewed_ignore"}'::jsonb,
  repeat('c', 64), 'AED', '[]'::jsonb, '[]'::jsonb, 'reviewed_ignore', 'human', 'c2000000-0000-4000-8000-000000000001'::uuid, 'c2000000-0000-4000-8000-000000000603'::uuid
);
insert into public.report_projection_versions (
  id, organization_id, report_contract_version_id, version, projection_document, projection_digest,
  calculation_version, proposal_source, created_by, correlation_id
) values (
  'c2000000-0000-4000-8000-000000000704'::uuid, 'c2000000-0000-4000-8000-000000000201'::uuid,
  'c2000000-0000-4000-8000-000000000702'::uuid, 1, '{}'::jsonb, repeat('d', 64),
  1, 'human', 'c2000000-0000-4000-8000-000000000001'::uuid, 'c2000000-0000-4000-8000-000000000606'::uuid
);
insert into public.report_structure_admissions (
  id, organization_id, channel_id, structure_fingerprint, structure_version, declared_currency, outlet_grain,
  report_type, report_contract_version_id, report_projection_version_id, granted_by, correlation_id
) values (
  'c2000000-0000-4000-8000-000000000720'::uuid, 'c2000000-0000-4000-8000-000000000201'::uuid,
  'c2000000-0000-4000-8000-000000000401'::uuid, repeat('3', 64), 1, 'AED', 'branch', 'Settlement',
  'c2000000-0000-4000-8000-000000000702'::uuid, 'c2000000-0000-4000-8000-000000000704'::uuid,
  'c2000000-0000-4000-8000-000000000001'::uuid, 'c2000000-0000-4000-8000-000000000721'::uuid
);

-- Packages link A is exercised against.
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, schema_fingerprint, structure_fingerprint, status, upload_expires_at, created_by, correlation_id
)
select
  package_id::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000401'::uuid,
  'c1000000-0000-4000-8000-000000000301'::uuid, 'Settlement', date '2026-08-01', date '2026-08-07', 'AED', 'Asia/Dubai',
  'csv', filename, 'text/csv', 42,
  'c1000000-0000-4000-8000-000000000201/c1000000-0000-4000-8000-000000000401/' || package_id || '/1/original/report.csv',
  repeat('9', 64), structure_fingerprint, status, now() + interval '1 hour',
  'c1000000-0000-4000-8000-000000000001'::uuid, correlation_id::uuid
from (values
  -- 510: admitted advance succeeds, and is replayed idempotently below.
  ('c1000000-0000-4000-8000-000000000510', 'link-a-success.csv', repeat('1', 64), 'awaiting_contract', 'c1000000-0000-4000-8000-000000000801'),
  -- 511: profiled, but nothing has ever admitted this structure.
  ('c1000000-0000-4000-8000-000000000511', 'link-a-no-admission.csv', repeat('2', 64), 'awaiting_contract', 'c1000000-0000-4000-8000-000000000802'),
  -- 512: shares organization B's admitted fingerprint and currency, but on
  -- organization A's own channel -- organization A never admitted it.
  ('c1000000-0000-4000-8000-000000000512', 'link-a-cross-org.csv', repeat('3', 64), 'awaiting_contract', 'c1000000-0000-4000-8000-000000000803'),
  -- 513: already `validated`. Its fingerprint matches the active admission,
  -- proving the status gate wins even when a match would otherwise apply.
  ('c1000000-0000-4000-8000-000000000513', 'link-a-wrong-status.csv', repeat('1', 64), 'validated', 'c1000000-0000-4000-8000-000000000804')
) as p(package_id, filename, structure_fingerprint, status, correlation_id);

-- 514: profiled before the fingerprint existed (or profiling never
-- recorded one) -- structure_fingerprint is null, so nothing can match.
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, status, upload_expires_at, created_by, correlation_id
) values (
  'c1000000-0000-4000-8000-000000000514'::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid,
  'c1000000-0000-4000-8000-000000000401'::uuid, 'c1000000-0000-4000-8000-000000000301'::uuid,
  'Settlement', date '2026-08-01', date '2026-08-07', 'AED', 'Asia/Dubai', 'csv', 'link-a-null-fingerprint.csv', 'text/csv', 42,
  'c1000000-0000-4000-8000-000000000201/c1000000-0000-4000-8000-000000000401/c1000000-0000-4000-8000-000000000514/1/original/report.csv',
  'awaiting_contract', now() + interval '1 hour', 'c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000805'::uuid
);

-- 515: approved through the *ordinary human* per-package path -- already at
-- `awaiting_validation`, but `admitted_under_admission_id` is null. Proves
-- link A does not mistake the human path's own waiting room for its own
-- idempotent-replay state.
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, schema_fingerprint, structure_fingerprint, status, upload_expires_at, created_by, correlation_id
) values (
  'c1000000-0000-4000-8000-000000000515'::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid,
  'c1000000-0000-4000-8000-000000000401'::uuid, 'c1000000-0000-4000-8000-000000000301'::uuid,
  'Settlement', date '2026-08-01', date '2026-08-07', 'AED', 'Asia/Dubai', 'csv', 'link-a-human-path.csv', 'text/csv', 42,
  'c1000000-0000-4000-8000-000000000201/c1000000-0000-4000-8000-000000000401/c1000000-0000-4000-8000-000000000515/1/original/report.csv',
  repeat('9', 64), repeat('1', 64), 'awaiting_validation', now() + interval '1 hour', 'c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000806'::uuid
);

-- Packages link B is exercised against. 520/523 are admitted
-- (`admitted_under_admission_id` set); 521 is the ordinary human path
-- (null); 522 is partially validated.
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, schema_fingerprint, structure_fingerprint, admitted_under_admission_id, status,
  upload_expires_at, created_by, correlation_id
)
select
  package_id::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000401'::uuid,
  'c1000000-0000-4000-8000-000000000301'::uuid, 'Settlement', date '2026-08-08', date '2026-08-14', 'AED', 'Asia/Dubai',
  'csv', filename, 'text/csv', 42,
  'c1000000-0000-4000-8000-000000000201/c1000000-0000-4000-8000-000000000401/' || package_id || '/1/original/report.csv',
  repeat('1', 64), repeat('1', 64), admission_id::uuid, status, now() + interval '1 hour',
  'c1000000-0000-4000-8000-000000000001'::uuid, correlation_id::uuid
from (values
  -- 520: admitted and cleanly validated -- link B should advance it, and
  -- the idempotent replay below is exercised against this same package.
  ('c1000000-0000-4000-8000-000000000520', 'link-b-success.csv', 'c1000000-0000-4000-8000-000000000720', 'validated', 'c1000000-0000-4000-8000-000000000807'),
  -- 522: admitted, but only partially validated -- must never advance.
  ('c1000000-0000-4000-8000-000000000522', 'link-b-partial.csv', 'c1000000-0000-4000-8000-000000000720', 'partially_validated', 'c1000000-0000-4000-8000-000000000808'),
  -- 523: admitted and validated, but under a contract version (CV2) with
  -- no active projection binding.
  ('c1000000-0000-4000-8000-000000000523', 'link-b-no-binding.csv', 'c1000000-0000-4000-8000-000000000720', 'validated', 'c1000000-0000-4000-8000-000000000809')
) as p(package_id, filename, admission_id, status, correlation_id);

-- 521: the ordinary human path -- validated, but never admitted.
-- `admitted_under_admission_id` is null, which is the assertion that proves
-- link B cannot be used to bypass a human's approval.
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, schema_fingerprint, status, upload_expires_at, created_by, correlation_id
) values (
  'c1000000-0000-4000-8000-000000000521'::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid,
  'c1000000-0000-4000-8000-000000000401'::uuid, 'c1000000-0000-4000-8000-000000000301'::uuid,
  'Settlement', date '2026-08-08', date '2026-08-14', 'AED', 'Asia/Dubai', 'csv', 'link-b-not-admitted.csv', 'text/csv', 42,
  'c1000000-0000-4000-8000-000000000201/c1000000-0000-4000-8000-000000000401/c1000000-0000-4000-8000-000000000521/1/original/report.csv',
  repeat('9', 64), 'validated', now() + interval '1 hour', 'c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000810'::uuid
);

-- Validation evidence link B reads. 520 validated under CV1/CB1 (which has
-- an active binding); 523 validated under CV2/CB2 (which does not).
insert into public.integration_report_validation_runs (
  id, organization_id, report_package_id, report_contract_version_id, report_contract_binding_id,
  validator_version, input_digest, result_digest, status, quality_state, completeness_state, correlation_id, completed_at
) values (
  'c1000000-0000-4000-8000-000000000901'::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid,
  'c1000000-0000-4000-8000-000000000520'::uuid, 'c1000000-0000-4000-8000-000000000702'::uuid, 'c1000000-0000-4000-8000-000000000703'::uuid,
  1, repeat('a', 64), repeat('b', 64), 'validated', 'complete', 'complete', 'c1000000-0000-4000-8000-000000000902'::uuid, now()
), (
  'c1000000-0000-4000-8000-000000000903'::uuid, 'c1000000-0000-4000-8000-000000000201'::uuid,
  'c1000000-0000-4000-8000-000000000523'::uuid, 'c1000000-0000-4000-8000-000000000712'::uuid, 'c1000000-0000-4000-8000-000000000713'::uuid,
  1, repeat('a', 64), repeat('b', 64), 'validated', 'complete', 'complete', 'c1000000-0000-4000-8000-000000000904'::uuid, now()
);

set local role service_role;

-- Link A: not_found.
select extensions.is(
  (public.advance_governed_report_package_on_admission(
    'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000599'::uuid,
    'c1000000-0000-4000-8000-000000000950'::uuid
  ) ->> 'outcome'), 'not_found',
  'link A refuses a package that does not exist'
);

-- Link A: success. outcome/admissionId/contractVersionId come from the
-- function's own return value, so they are checked in the same statement
-- that calls it. The column writes are checked as their own separate
-- top-level statements immediately after, for the reason
-- governed_report_validation_test.sql documents: a scalar subquery folded
-- into the calling statement would run under that statement's own snapshot,
-- taken before this call's internal update, and would see the pre-update
-- value even though the update has genuinely committed inside the
-- function's own transaction-scoped write.
select extensions.is(
  (select jsonb_build_object('outcome', result ->> 'outcome', 'admissionId', result ->> 'admissionId', 'reportContractVersionId', result ->> 'reportContractVersionId')
   from (select public.advance_governed_report_package_on_admission(
     'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000510'::uuid,
     'c1000000-0000-4000-8000-000000000951'::uuid
   ) as result) advanced),
  jsonb_build_object('outcome', 'admitted', 'admissionId', 'c1000000-0000-4000-8000-000000000720', 'reportContractVersionId', 'c1000000-0000-4000-8000-000000000702'),
  'a package with a matching active admission advances, using the admission''s contract version'
);
select extensions.is(
  (select status from public.integration_report_packages where id = 'c1000000-0000-4000-8000-000000000510'::uuid),
  'awaiting_validation', 'the advanced package now waits for the validation worker, not a person'
);
select extensions.is(
  (select admitted_under_admission_id from public.integration_report_packages where id = 'c1000000-0000-4000-8000-000000000510'::uuid),
  'c1000000-0000-4000-8000-000000000720'::uuid,
  'the advanced package records which admission advanced it'
);

-- Link A: idempotent replay. A second call, with a different correlation
-- id, must return the same admission and must not overwrite the package --
-- proven by the correlation id still being the first call's, not the
-- second's.
select extensions.is(
  (select jsonb_build_object('outcome', result ->> 'outcome', 'admissionId', result ->> 'admissionId', 'reportContractVersionId', result ->> 'reportContractVersionId')
   from (select public.advance_governed_report_package_on_admission(
     'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000510'::uuid,
     'c1000000-0000-4000-8000-000000000952'::uuid
   ) as result) replayed),
  jsonb_build_object('outcome', 'admitted', 'admissionId', 'c1000000-0000-4000-8000-000000000720', 'reportContractVersionId', 'c1000000-0000-4000-8000-000000000702'),
  'a retried call lands on the same admission, not a fresh lookup'
);
select extensions.is(
  (select correlation_id from public.integration_report_packages where id = 'c1000000-0000-4000-8000-000000000510'::uuid),
  'c1000000-0000-4000-8000-000000000951'::uuid,
  'the retried call performed no second write -- the package still carries the first call''s correlation id'
);

-- Link A: no admission matches this structure at all.
select extensions.is(
  (public.advance_governed_report_package_on_admission(
    'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000511'::uuid,
    'c1000000-0000-4000-8000-000000000953'::uuid
  ) ->> 'outcome'), 'no_admission',
  'link A refuses a structure nobody has admitted'
);
select extensions.is(
  (select status from public.integration_report_packages where id = 'c1000000-0000-4000-8000-000000000511'::uuid),
  'awaiting_contract', 'the unmatched package is left waiting for a person, unchanged'
);

-- Link A: a matching admission belonging to a different organization must
-- not admit this organization's package.
select extensions.is(
  (public.advance_governed_report_package_on_admission(
    'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000512'::uuid,
    'c1000000-0000-4000-8000-000000000954'::uuid
  ) ->> 'outcome'), 'no_admission',
  'an admission belonging to a different organization does not admit this package'
);
select extensions.is(
  (select status from public.integration_report_packages where id = 'c1000000-0000-4000-8000-000000000512'::uuid),
  'awaiting_contract', 'the cross-organization package is left waiting for a person, unchanged'
);

-- Link A: wrong status. The package's fingerprint matches the active
-- admission, but its status is not `awaiting_contract` -- the status gate
-- must win regardless.
select extensions.is(
  (public.advance_governed_report_package_on_admission(
    'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000513'::uuid,
    'c1000000-0000-4000-8000-000000000955'::uuid
  ) ->> 'outcome'), 'not_ready',
  'link A refuses a package that is not awaiting a contract, even when a matching admission exists'
);
select extensions.is(
  (select status from public.integration_report_packages where id = 'c1000000-0000-4000-8000-000000000513'::uuid),
  'validated', 'the already-validated package is not dragged backwards'
);

-- Link A: null structure_fingerprint has nothing to match.
select extensions.is(
  (public.advance_governed_report_package_on_admission(
    'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000514'::uuid,
    'c1000000-0000-4000-8000-000000000956'::uuid
  ) ->> 'outcome'), 'not_ready',
  'link A refuses a package with no recorded structure fingerprint'
);
select extensions.is(
  (select status from public.integration_report_packages where id = 'c1000000-0000-4000-8000-000000000514'::uuid),
  'awaiting_contract', 'the unfingerprinted package is left unchanged'
);

-- Link A: the ordinary human path (already awaiting_validation, no
-- admission id) is not mistaken for link A's own idempotent-replay state.
select extensions.is(
  (public.advance_governed_report_package_on_admission(
    'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000515'::uuid,
    'c1000000-0000-4000-8000-000000000957'::uuid
  ) ->> 'outcome'), 'not_ready',
  'link A refuses a package already awaiting validation through the ordinary human approval'
);
select extensions.is(
  (select status from public.integration_report_packages where id = 'c1000000-0000-4000-8000-000000000515'::uuid),
  'awaiting_validation', 'the human-approved package is left exactly where the human path put it'
);

-- Link B: not_found.
select extensions.is(
  (public.advance_admitted_report_package_to_projection(
    'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000599'::uuid,
    'c1000000-0000-4000-8000-000000000960'::uuid
  ) ->> 'outcome'), 'not_found',
  'link B refuses a package that does not exist'
);

-- Link B: the assertion that proves the human path cannot be bypassed. A
-- validated package that was never admitted must stay on the human retry
-- path.
select extensions.is(
  (public.advance_admitted_report_package_to_projection(
    'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000521'::uuid,
    'c1000000-0000-4000-8000-000000000961'::uuid
  ) ->> 'outcome'), 'not_admitted',
  'link B refuses a validated package whose admitted_under_admission_id is null'
);
select extensions.is(
  (select status from public.integration_report_packages where id = 'c1000000-0000-4000-8000-000000000521'::uuid),
  'validated', 'the never-admitted package is left on the human path, unchanged'
);

-- Link B: partially_validated must never advance to projection, admitted or
-- not.
select extensions.is(
  (public.advance_admitted_report_package_to_projection(
    'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000522'::uuid,
    'c1000000-0000-4000-8000-000000000962'::uuid
  ) ->> 'outcome'), 'not_ready',
  'link B refuses a partially validated package even when it was admitted'
);
select extensions.is(
  (select status from public.integration_report_packages where id = 'c1000000-0000-4000-8000-000000000522'::uuid),
  'partially_validated', 'the partially validated package is not dragged into projection'
);

-- Link B: no active projection binding for the validated contract version.
select extensions.is(
  (public.advance_admitted_report_package_to_projection(
    'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000523'::uuid,
    'c1000000-0000-4000-8000-000000000963'::uuid
  ) ->> 'outcome'), 'no_binding',
  'link B refuses when the validated contract version has no active projection binding'
);
select extensions.is(
  (select status from public.integration_report_packages where id = 'c1000000-0000-4000-8000-000000000523'::uuid),
  'validated', 'the unbound package is left waiting for a person, unchanged'
);

-- Link B: success.
select extensions.is(
  (select jsonb_build_object('outcome', result ->> 'outcome', 'reportContractVersionId', result ->> 'reportContractVersionId', 'reportProjectionVersionId', result ->> 'reportProjectionVersionId')
   from (select public.advance_admitted_report_package_to_projection(
     'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000520'::uuid,
     'c1000000-0000-4000-8000-000000000964'::uuid
   ) as result) advanced),
  jsonb_build_object('outcome', 'requested', 'reportContractVersionId', 'c1000000-0000-4000-8000-000000000702', 'reportProjectionVersionId', 'c1000000-0000-4000-8000-000000000704'),
  'an admitted, cleanly validated package advances to projection, using the bound projection version'
);
select extensions.is(
  (select status from public.integration_report_packages where id = 'c1000000-0000-4000-8000-000000000520'::uuid),
  'awaiting_projection', 'the advanced package now waits for the projection worker, not a person'
);

-- Link B: idempotent replay. A second call, with a different correlation
-- id, must return the same result and must not error or move the package
-- any further.
select extensions.is(
  (select jsonb_build_object('outcome', result ->> 'outcome', 'reportContractVersionId', result ->> 'reportContractVersionId', 'reportProjectionVersionId', result ->> 'reportProjectionVersionId')
   from (select public.advance_admitted_report_package_to_projection(
     'c1000000-0000-4000-8000-000000000201'::uuid, 'c1000000-0000-4000-8000-000000000520'::uuid,
     'c1000000-0000-4000-8000-000000000965'::uuid
   ) as result) replayed),
  jsonb_build_object('outcome', 'requested', 'reportContractVersionId', 'c1000000-0000-4000-8000-000000000702', 'reportProjectionVersionId', 'c1000000-0000-4000-8000-000000000704'),
  'a retried call returns the same result without erroring'
);
select extensions.is(
  (select status from public.integration_report_packages where id = 'c1000000-0000-4000-8000-000000000520'::uuid),
  'awaiting_projection', 'the retried call did not move the package any further'
);

reset role;

select * from extensions.finish();

rollback;
