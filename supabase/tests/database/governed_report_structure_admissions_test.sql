begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(37);

select extensions.has_table('public', 'report_structure_admissions',
  'standing report admissions exist');
select extensions.has_column('public', 'report_structure_admissions', 'structure_fingerprint',
  'an admission is keyed on the structure it admits');
select extensions.has_column('public', 'report_structure_admissions', 'granted_by',
  'an admission names the person who granted it');
select extensions.has_column('public', 'report_structure_admissions', 'revoked_at',
  'an admission can be revoked without being deleted');
select extensions.has_column('public', 'integration_report_packages', 'admitted_under_admission_id',
  'an import records the authorisation that admitted it');

select extensions.ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.report_structure_admissions'::regclass),
  'admissions enforce RLS'
);
select extensions.ok(
  (select relforcerowsecurity from pg_catalog.pg_class
   where oid = 'public.report_structure_admissions'::regclass),
  'admissions force RLS'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.report_structure_admissions', 'insert'),
  'authenticated users cannot insert an admission directly'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.report_structure_admissions', 'update'),
  'authenticated users cannot rewrite an admission directly'
);
select extensions.has_function('public', 'grant_governed_report_structure_admission',
  'granting an admission goes through a governed function');
select extensions.has_function('public', 'revoke_governed_report_structure_admission',
  'revoking an admission goes through a governed function');
select extensions.ok(
  (select count(*) from pg_catalog.pg_indexes
   where schemaname = 'public'
     and tablename = 'report_structure_admissions'
     and indexdef ilike '%unique%active%') >= 1,
  'at most one active admission exists per structure, channel and currency'
);

-- Two organizations. Org A carries the behavioural cases; org B exists only
-- to prove that org A's grant is invisible and unnameable from the outside.

insert into auth.users (id) values
  ('a6000000-0000-4000-8000-000000000001'::uuid), -- org A owner: has report.contract_approve
  ('a6000000-0000-4000-8000-000000000002'::uuid), -- org A operator: report.upload only
  ('b6000000-0000-4000-8000-000000000001'::uuid); -- org B owner

insert into public.accounts (id, name, slug, created_by) values
  ('a6000000-0000-4000-8000-000000000101'::uuid, 'Admission verifier A', 'admission-verifier-a', 'a6000000-0000-4000-8000-000000000001'::uuid),
  ('b6000000-0000-4000-8000-000000000101'::uuid, 'Admission verifier B', 'admission-verifier-b', 'b6000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000101'::uuid, 'Admission verifier A', 'admission-verifier-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'a6000000-0000-4000-8000-000000000001'::uuid),
  ('b6000000-0000-4000-8000-000000000201'::uuid, 'b6000000-0000-4000-8000-000000000101'::uuid, 'Admission verifier B', 'admission-verifier-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'b6000000-0000-4000-8000-000000000001'::uuid);

insert into public.branches (id, organization_id, name, slug, kind, timezone, currency) values
  ('a6000000-0000-4000-8000-000000000301'::uuid, 'a6000000-0000-4000-8000-000000000201'::uuid, 'Admission outlet A', 'admission-outlet-a', 'physical', 'Asia/Dubai', 'AED'),
  ('b6000000-0000-4000-8000-000000000301'::uuid, 'b6000000-0000-4000-8000-000000000201'::uuid, 'Admission outlet B', 'admission-outlet-b', 'physical', 'Asia/Dubai', 'AED');

insert into public.organization_channels (id, organization_id, key, display_name, category, created_by) values
  ('a6000000-0000-4000-8000-000000000401'::uuid, 'a6000000-0000-4000-8000-000000000201'::uuid, 'admission-channel-a', 'Admission channel A', 'marketplace', 'a6000000-0000-4000-8000-000000000001'::uuid),
  ('b6000000-0000-4000-8000-000000000401'::uuid, 'b6000000-0000-4000-8000-000000000201'::uuid, 'admission-channel-b', 'Admission channel B', 'marketplace', 'b6000000-0000-4000-8000-000000000001'::uuid);

insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('a6000000-0000-4000-8000-000000000101'::uuid, 'a6000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('a6000000-0000-4000-8000-000000000101'::uuid, 'a6000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator'),
  ('b6000000-0000-4000-8000-000000000101'::uuid, 'b6000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');

-- Org A packages: P1 is the clean happy-path structure; P1b never got a
-- fingerprint (most of Nostaza's real packages are in this state today); P3
-- carries a different declared currency than the mapping being tested against
-- it; P4 has its own, unrelated, approved mapping.
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, content_sha256, structure_fingerprint, status, upload_expires_at, created_by, correlation_id
) values
  ('a6000000-0000-4000-8000-000000000501'::uuid, 'a6000000-0000-4000-8000-000000000201'::uuid,
   'a6000000-0000-4000-8000-000000000401'::uuid, 'a6000000-0000-4000-8000-000000000301'::uuid,
   'Marketplace Sales', date '2026-01-01', date '2026-01-31', 'AED', 'Asia/Dubai', 'csv', 'p1.csv', 'text/csv', 42,
   'a6000000-0000-4000-8000-000000000201/a6000000-0000-4000-8000-000000000401/a6000000-0000-4000-8000-000000000501/1/original/report.csv',
   '1111111111111111111111111111111111111111111111111111111111111111',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'awaiting_contract',
   now() + interval '1 hour', 'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000901'::uuid),
  ('a6000000-0000-4000-8000-000000000502'::uuid, 'a6000000-0000-4000-8000-000000000201'::uuid,
   'a6000000-0000-4000-8000-000000000401'::uuid, 'a6000000-0000-4000-8000-000000000301'::uuid,
   'Marketplace Sales', date '2026-01-01', date '2026-01-31', 'AED', 'Asia/Dubai', 'csv', 'p1b.csv', 'text/csv', 42,
   'a6000000-0000-4000-8000-000000000201/a6000000-0000-4000-8000-000000000401/a6000000-0000-4000-8000-000000000502/1/original/report.csv',
   '1111111111111111111111111111111111111111111111111111111111111112',
   null, 'awaiting_contract',
   now() + interval '1 hour', 'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000902'::uuid),
  ('a6000000-0000-4000-8000-000000000503'::uuid, 'a6000000-0000-4000-8000-000000000201'::uuid,
   'a6000000-0000-4000-8000-000000000401'::uuid, 'a6000000-0000-4000-8000-000000000301'::uuid,
   'Marketplace Sales', date '2026-01-01', date '2026-01-31', 'USD', 'Asia/Dubai', 'csv', 'p3.csv', 'text/csv', 42,
   'a6000000-0000-4000-8000-000000000201/a6000000-0000-4000-8000-000000000401/a6000000-0000-4000-8000-000000000503/1/original/report.csv',
   '1111111111111111111111111111111111111111111111111111111111111113',
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'awaiting_contract',
   now() + interval '1 hour', 'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000903'::uuid),
  ('a6000000-0000-4000-8000-000000000504'::uuid, 'a6000000-0000-4000-8000-000000000201'::uuid,
   'a6000000-0000-4000-8000-000000000401'::uuid, 'a6000000-0000-4000-8000-000000000301'::uuid,
   'Marketplace Orders', date '2026-01-01', date '2026-01-31', 'AED', 'Asia/Dubai', 'csv', 'p4.csv', 'text/csv', 42,
   'a6000000-0000-4000-8000-000000000201/a6000000-0000-4000-8000-000000000401/a6000000-0000-4000-8000-000000000504/1/original/report.csv',
   '1111111111111111111111111111111111111111111111111111111111111114',
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'awaiting_contract',
   now() + interval '1 hour', 'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000904'::uuid);

insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, content_sha256, structure_fingerprint, status, upload_expires_at, created_by, correlation_id
) values
  ('b6000000-0000-4000-8000-000000000501'::uuid, 'b6000000-0000-4000-8000-000000000201'::uuid,
   'b6000000-0000-4000-8000-000000000401'::uuid, 'b6000000-0000-4000-8000-000000000301'::uuid,
   'Marketplace Sales', date '2026-01-01', date '2026-01-31', 'AED', 'Asia/Dubai', 'csv', 'pb1.csv', 'text/csv', 42,
   'b6000000-0000-4000-8000-000000000201/b6000000-0000-4000-8000-000000000401/b6000000-0000-4000-8000-000000000501/1/original/report.csv',
   '2111111111111111111111111111111111111111111111111111111111111111',
   'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'awaiting_contract',
   now() + interval '1 hour', 'b6000000-0000-4000-8000-000000000001'::uuid, 'b6000000-0000-4000-8000-000000000901'::uuid);

-- Contracts and projections are inserted directly, bypassing the propose/decide
-- RPCs, exactly as governed_report_validation_test.sql does for a package that
-- is already past that stage -- only the admission RPCs are under test here.
insert into public.report_contracts (id, organization_id, channel_id, report_type, outlet_grain, created_by) values
  ('a6000000-0000-4000-8000-000000000601'::uuid, 'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000401'::uuid, 'Marketplace Sales Contract', 'branch', 'a6000000-0000-4000-8000-000000000001'::uuid),
  ('a6000000-0000-4000-8000-000000000602'::uuid, 'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000401'::uuid, 'Marketplace Orders Contract', 'branch', 'a6000000-0000-4000-8000-000000000001'::uuid),
  ('a6000000-0000-4000-8000-000000000603'::uuid, 'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000401'::uuid, 'Marketplace Sales Contract Mismatch', 'branch', 'a6000000-0000-4000-8000-000000000001'::uuid),
  ('b6000000-0000-4000-8000-000000000601'::uuid, 'b6000000-0000-4000-8000-000000000201'::uuid, 'b6000000-0000-4000-8000-000000000401'::uuid, 'Marketplace Sales Contract', 'branch', 'b6000000-0000-4000-8000-000000000001'::uuid);

insert into public.report_contract_versions (
  id, organization_id, report_contract_id, report_package_id, version, schema_fingerprint, parser_version,
  fingerprint_version, mapping_document, mapping_digest, declared_currency, financial_sign_semantics, controls,
  unmapped_field_disposition, proposal_source, created_by, correlation_id
) values
  ('a6000000-0000-4000-8000-000000000701'::uuid, 'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000601'::uuid,
   'a6000000-0000-4000-8000-000000000501'::uuid, 1, '3333333333333333333333333333333333333333333333333333333333333333', 1, 1,
   '{}'::jsonb, 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'AED', '[]'::jsonb, '[]'::jsonb,
   'reviewed_ignore', 'human', 'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000905'::uuid),
  ('a6000000-0000-4000-8000-000000000702'::uuid, 'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000602'::uuid,
   'a6000000-0000-4000-8000-000000000504'::uuid, 1, '4444444444444444444444444444444444444444444444444444444444444444', 1, 1,
   '{}'::jsonb, 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'AED', '[]'::jsonb, '[]'::jsonb,
   'reviewed_ignore', 'human', 'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000906'::uuid),
  -- Proposed and approved for P3 itself, but at a currency P3 does not carry.
  -- This can never happen through propose_governed_report_contract, which
  -- always copies the package's own currency -- it models a data
  -- inconsistency the grant RPC must still catch rather than trust.
  ('a6000000-0000-4000-8000-000000000703'::uuid, 'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000603'::uuid,
   'a6000000-0000-4000-8000-000000000503'::uuid, 1, '6666666666666666666666666666666666666666666666666666666666666666', 1, 1,
   '{}'::jsonb, '6767676767676767676767676767676767676767676767676767676767676767', 'AED', '[]'::jsonb, '[]'::jsonb,
   'reviewed_ignore', 'human', 'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000930'::uuid),
  ('b6000000-0000-4000-8000-000000000701'::uuid, 'b6000000-0000-4000-8000-000000000201'::uuid, 'b6000000-0000-4000-8000-000000000601'::uuid,
   'b6000000-0000-4000-8000-000000000501'::uuid, 1, '5555555555555555555555555555555555555555555555555555555555555555', 1, 1,
   '{}'::jsonb, 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'AED', '[]'::jsonb, '[]'::jsonb,
   'reviewed_ignore', 'human', 'b6000000-0000-4000-8000-000000000001'::uuid, 'b6000000-0000-4000-8000-000000000907'::uuid);

insert into public.report_contract_decisions (organization_id, report_contract_version_id, decision, mapping_digest, decided_by, correlation_id) values
  ('a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000701'::uuid, 'approved', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000908'::uuid),
  ('a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000702'::uuid, 'approved', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000909'::uuid),
  ('a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000703'::uuid, 'approved', '6767676767676767676767676767676767676767676767676767676767676767', 'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000931'::uuid),
  ('b6000000-0000-4000-8000-000000000201'::uuid, 'b6000000-0000-4000-8000-000000000701'::uuid, 'approved', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'b6000000-0000-4000-8000-000000000001'::uuid, 'b6000000-0000-4000-8000-000000000910'::uuid);

insert into public.report_projection_versions (
  id, organization_id, report_contract_version_id, version, projection_document, projection_digest,
  calculation_version, proposal_source, created_by, correlation_id
) values
  ('a6000000-0000-4000-8000-000000000801'::uuid, 'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000701'::uuid,
   1, '{}'::jsonb, 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 1, 'human', 'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000911'::uuid),
  ('a6000000-0000-4000-8000-000000000802'::uuid, 'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000702'::uuid,
   1, '{}'::jsonb, '1010101010101010101010101010101010101010101010101010101010101010', 1, 'human', 'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000912'::uuid),
  ('a6000000-0000-4000-8000-000000000803'::uuid, 'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000703'::uuid,
   1, '{}'::jsonb, '7878787878787878787878787878787878787878787878787878787878787878', 1, 'human', 'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000932'::uuid),
  ('b6000000-0000-4000-8000-000000000801'::uuid, 'b6000000-0000-4000-8000-000000000201'::uuid, 'b6000000-0000-4000-8000-000000000701'::uuid,
   1, '{}'::jsonb, '2020202020202020202020202020202020202020202020202020202020202020', 1, 'human', 'b6000000-0000-4000-8000-000000000001'::uuid, 'b6000000-0000-4000-8000-000000000913'::uuid);

insert into public.report_projection_decisions (organization_id, report_projection_version_id, decision, projection_digest, decided_by, correlation_id) values
  ('a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000801'::uuid, 'approved', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000914'::uuid),
  ('a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000802'::uuid, 'approved', '1010101010101010101010101010101010101010101010101010101010101010', 'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000915'::uuid),
  ('a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000803'::uuid, 'approved', '7878787878787878787878787878787878787878787878787878787878787878', 'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000933'::uuid),
  ('b6000000-0000-4000-8000-000000000201'::uuid, 'b6000000-0000-4000-8000-000000000801'::uuid, 'approved', '2020202020202020202020202020202020202020202020202020202020202020', 'b6000000-0000-4000-8000-000000000001'::uuid, 'b6000000-0000-4000-8000-000000000916'::uuid);

-- The tenant boundary this whole feature rests on: a contract version that
-- belongs to org B can never be named inside an org A admission, because the
-- table's foreign keys are composite on (organization_id, ...). This is
-- checked structurally, as the owning role, before any RPC or RLS is involved.
select extensions.throws_ok(
  $$ insert into public.report_structure_admissions (
       organization_id, channel_id, structure_fingerprint, structure_version, declared_currency, outlet_grain,
       report_type, report_contract_version_id, report_projection_version_id, granted_by, correlation_id
     ) values (
       'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000401'::uuid,
       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1, 'AED', 'branch', 'Marketplace Sales',
       'b6000000-0000-4000-8000-000000000701'::uuid, 'a6000000-0000-4000-8000-000000000801'::uuid,
       'a6000000-0000-4000-8000-000000000001'::uuid, 'a6000000-0000-4000-8000-000000000917'::uuid
     ) $$,
  '23503', null,
  'a foreign-org contract version cannot be named inside an admission row -- the composite foreign key refuses it structurally'
);

-- Grant is refused for a caller with report.upload but not report.contract_approve.
set local role authenticated;
set local request.jwt.claim.sub = 'a6000000-0000-4000-8000-000000000002';
select extensions.throws_ok(
  $$ select public.grant_governed_report_structure_admission(
    'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000002'::uuid,
    'a6000000-0000-4000-8000-000000000501'::uuid, 'a6000000-0000-4000-8000-000000000701'::uuid,
    'a6000000-0000-4000-8000-000000000801'::uuid, null, 'admission-grant-operator-refused-01', 'a6000000-0000-4000-8000-000000000918'::uuid
  ) $$,
  '42501', 'report structure admission grant is not authorized',
  'an operator who can upload cannot admit a structure -- only report.contract_approve can'
);

set local request.jwt.claim.sub = 'a6000000-0000-4000-8000-000000000001';

-- A package profiling never fingerprinted cannot be admitted.
select extensions.throws_ok(
  $$ select public.grant_governed_report_structure_admission(
    'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000001'::uuid,
    'a6000000-0000-4000-8000-000000000502'::uuid, 'a6000000-0000-4000-8000-000000000701'::uuid,
    'a6000000-0000-4000-8000-000000000801'::uuid, null, 'admission-grant-null-fingerprint-01', 'a6000000-0000-4000-8000-000000000919'::uuid
  ) $$,
  '23514', 'report package has no recorded structure fingerprint',
  'a package profiled before Task 2 has nothing to key an admission on'
);

-- A mapping approved at a different currency than the package cannot admit it,
-- even when it was proposed against this exact package (a state the real
-- propose RPC cannot produce, but the grant RPC must not trust blindly).
select extensions.throws_ok(
  $$ select public.grant_governed_report_structure_admission(
    'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000001'::uuid,
    'a6000000-0000-4000-8000-000000000503'::uuid, 'a6000000-0000-4000-8000-000000000703'::uuid,
    'a6000000-0000-4000-8000-000000000803'::uuid, null, 'admission-grant-currency-mismatch-01', 'a6000000-0000-4000-8000-000000000920'::uuid
  ) $$,
  '23514', 'report contract currency does not match the package currency',
  'a USD package cannot be admitted under an AED-approved mapping'
);

-- A mapping approved for a different package cannot admit this one, even
-- though both belong to the same organization and currency.
select extensions.throws_ok(
  $$ select public.grant_governed_report_structure_admission(
    'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000001'::uuid,
    'a6000000-0000-4000-8000-000000000501'::uuid, 'a6000000-0000-4000-8000-000000000702'::uuid,
    'a6000000-0000-4000-8000-000000000802'::uuid, null, 'admission-grant-wrong-package-01', 'a6000000-0000-4000-8000-000000000921'::uuid
  ) $$,
  '23514', 'report contract version is not an approved proposal for this package',
  'an unrelated approved mapping cannot be borrowed for a package it was never proposed against'
);

-- The happy path: grant succeeds.
select extensions.is(
  (public.grant_governed_report_structure_admission(
    'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000001'::uuid,
    'a6000000-0000-4000-8000-000000000501'::uuid, 'a6000000-0000-4000-8000-000000000701'::uuid,
    'a6000000-0000-4000-8000-000000000801'::uuid, 'talabat.performance.daily', 'admission-grant-p1-01', 'a6000000-0000-4000-8000-000000000922'::uuid
  ) ->> 'active')::boolean,
  true,
  'granting a package with an approved matching contract and projection succeeds'
);
select extensions.ok(
  exists (
    select 1 from public.audit_events
    where organization_id = 'a6000000-0000-4000-8000-000000000201'::uuid
      and event_name = 'report.structure_admitted'
      and entity_id = (
        select id from public.report_structure_admissions
        where organization_id = 'a6000000-0000-4000-8000-000000000201'::uuid and active
      )
  ),
  'granting an admission emits an immutable audit event'
);

-- Idempotent replay: the same key returns the same row rather than a second one.
select extensions.is(
  (public.grant_governed_report_structure_admission(
    'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000001'::uuid,
    'a6000000-0000-4000-8000-000000000501'::uuid, 'a6000000-0000-4000-8000-000000000701'::uuid,
    'a6000000-0000-4000-8000-000000000801'::uuid, 'talabat.performance.daily', 'admission-grant-p1-01', 'a6000000-0000-4000-8000-000000000923'::uuid
  ) ->> 'id'),
  (select id::text from public.report_structure_admissions where organization_id = 'a6000000-0000-4000-8000-000000000201'::uuid and active),
  'a replayed grant with the same idempotency key returns the row it already created'
);
select extensions.is(
  (select count(*)::integer from public.report_structure_admissions
   where organization_id = 'a6000000-0000-4000-8000-000000000201'::uuid
     and channel_id = 'a6000000-0000-4000-8000-000000000401'::uuid
     and structure_fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
  1,
  'the replay did not insert a second admission row'
);
select extensions.throws_ok(
  $$ select public.grant_governed_report_structure_admission(
    'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000001'::uuid,
    'a6000000-0000-4000-8000-000000000501'::uuid, 'a6000000-0000-4000-8000-000000000701'::uuid,
    'a6000000-0000-4000-8000-000000000801'::uuid, 'a-different-family-key', 'admission-grant-p1-01', 'a6000000-0000-4000-8000-000000000924'::uuid
  ) $$,
  '23505', 'idempotency key conflicts with another admission grant',
  'the same key cannot be reused for a materially different grant'
);

-- Granting the tuple again supersedes the incumbent rather than colliding
-- with the unique-active index, mirroring
-- 20260826130000_supersede_incumbent_contract_binding_on_approval.sql.
select extensions.is(
  (public.grant_governed_report_structure_admission(
    'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000001'::uuid,
    'a6000000-0000-4000-8000-000000000501'::uuid, 'a6000000-0000-4000-8000-000000000701'::uuid,
    'a6000000-0000-4000-8000-000000000801'::uuid, 'talabat.performance.daily', 'admission-grant-p1-02', 'a6000000-0000-4000-8000-000000000925'::uuid
  ) ->> 'active')::boolean,
  true,
  'a second grant for the same tuple succeeds and becomes the active admission'
);
select extensions.is(
  (select count(*)::integer from public.report_structure_admissions
   where organization_id = 'a6000000-0000-4000-8000-000000000201'::uuid
     and channel_id = 'a6000000-0000-4000-8000-000000000401'::uuid
     and structure_fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
     and active),
  1,
  'exactly one admission is active for the tuple after the supersede'
);
select extensions.ok(
  exists (
    select 1 from public.report_structure_admissions
    where organization_id = 'a6000000-0000-4000-8000-000000000201'::uuid
      and channel_id = 'a6000000-0000-4000-8000-000000000401'::uuid
      and structure_fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      and not active and revoked_at is not null and revoked_by = 'a6000000-0000-4000-8000-000000000001'::uuid
  ),
  'the superseded incumbent is retained, flipped inactive, and stamped revoked'
);
select extensions.ok(
  exists (
    select 1 from public.audit_events a
    join public.report_structure_admissions r
      on r.organization_id = a.organization_id and r.id = a.entity_id
    where a.organization_id = 'a6000000-0000-4000-8000-000000000201'::uuid
      and a.event_name = 'report.structure_admission_revoked'
      and not r.active
      and r.channel_id = 'a6000000-0000-4000-8000-000000000401'::uuid
  ),
  'superseding an admission emits the same revoked audit event a direct revoke does'
);

-- Explicit revoke of the now-active admission.
select extensions.is(
  (public.revoke_governed_report_structure_admission(
    'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000001'::uuid,
    (select id from public.report_structure_admissions where organization_id = 'a6000000-0000-4000-8000-000000000201'::uuid and active),
    'a6000000-0000-4000-8000-000000000926'::uuid
  ) ->> 'active')::boolean,
  false,
  'revoking the active admission deactivates it'
);
select extensions.is(
  (select count(*)::integer from public.report_structure_admissions
   where organization_id = 'a6000000-0000-4000-8000-000000000201'::uuid
     and channel_id = 'a6000000-0000-4000-8000-000000000401'::uuid
     and structure_fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
     and active),
  0,
  'no admission remains active for the tuple after the explicit revoke'
);
select extensions.ok(
  exists (
    select 1 from public.audit_events a
    join public.report_structure_admissions r
      on r.organization_id = a.organization_id and r.id = a.entity_id
    where a.organization_id = 'a6000000-0000-4000-8000-000000000201'::uuid
      and a.event_name = 'report.structure_admission_revoked'
      and r.revoked_by = 'a6000000-0000-4000-8000-000000000001'::uuid
      and r.channel_id = 'a6000000-0000-4000-8000-000000000401'::uuid
  ),
  'the explicit revoke emits its own audit event'
);

-- A second revoke of the same admission is a safe no-op, not an error and not
-- a second audit event.
select extensions.lives_ok(
  $$ select public.revoke_governed_report_structure_admission(
    'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000001'::uuid,
    (select id from public.report_structure_admissions
     where organization_id = 'a6000000-0000-4000-8000-000000000201'::uuid
       and channel_id = 'a6000000-0000-4000-8000-000000000401'::uuid
       and structure_fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
       and not active
     order by revoked_at desc limit 1),
    'a6000000-0000-4000-8000-000000000927'::uuid
  ) $$,
  'revoking an already-revoked admission is a safe, idempotent no-op'
);
select extensions.is(
  (select count(*)::integer from public.audit_events
   where organization_id = 'a6000000-0000-4000-8000-000000000201'::uuid
     and event_name = 'report.structure_admission_revoked'
     and entity_id = (
       select id from public.report_structure_admissions
       where organization_id = 'a6000000-0000-4000-8000-000000000201'::uuid
         and channel_id = 'a6000000-0000-4000-8000-000000000401'::uuid
         and structure_fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
         and not active
       order by revoked_at desc limit 1
     )),
  1,
  'the no-op replay did not write a second revoked audit event'
);

-- Revoke is refused for a caller without report.contract_approve.
set local request.jwt.claim.sub = 'a6000000-0000-4000-8000-000000000002';
select extensions.throws_ok(
  $$ select public.revoke_governed_report_structure_admission(
    'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000002'::uuid,
    (select id from public.report_structure_admissions where organization_id = 'a6000000-0000-4000-8000-000000000201'::uuid limit 1),
    'a6000000-0000-4000-8000-000000000928'::uuid
  ) $$,
  '42501', 'report structure admission revocation is not authorized',
  'an operator cannot revoke an admission either'
);

-- Org B grants its own admission, used only to prove org A cannot see or
-- reach it.
set local request.jwt.claim.sub = 'b6000000-0000-4000-8000-000000000001';
select extensions.is(
  (public.grant_governed_report_structure_admission(
    'b6000000-0000-4000-8000-000000000201'::uuid, 'b6000000-0000-4000-8000-000000000001'::uuid,
    'b6000000-0000-4000-8000-000000000501'::uuid, 'b6000000-0000-4000-8000-000000000701'::uuid,
    'b6000000-0000-4000-8000-000000000801'::uuid, null, 'admission-grant-b1-01', 'b6000000-0000-4000-8000-000000000918'::uuid
  ) ->> 'active')::boolean,
  true,
  'org B can grant its own admission independently of org A'
);

-- Org A cannot even name org B's admission to revoke it: not authorized to
-- an org A caller acting on org A, and simply absent to a lookup scoped to
-- org A, because the row does not exist inside org A's tenant boundary.
set local request.jwt.claim.sub = 'a6000000-0000-4000-8000-000000000001';
select extensions.throws_ok(
  $$ select public.revoke_governed_report_structure_admission(
    'a6000000-0000-4000-8000-000000000201'::uuid, 'a6000000-0000-4000-8000-000000000001'::uuid,
    (select id from public.report_structure_admissions where organization_id = 'b6000000-0000-4000-8000-000000000201'::uuid and active),
    'a6000000-0000-4000-8000-000000000929'::uuid
  ) $$,
  'P0002', 'report structure admission was not found',
  'org A cannot revoke an admission that belongs to org B, even by exact id'
);

-- RLS itself: org A's read policy never surfaces org B's row.
select extensions.is(
  (select count(*)::integer from public.report_structure_admissions where organization_id = 'b6000000-0000-4000-8000-000000000201'::uuid),
  0,
  'an org A member reading the admissions table sees none of org B''s rows'
);
reset role;

-- admitted_under_admission_id is write-once, matching every other identity
-- column this trigger already protects.
select extensions.lives_ok(
  $$ update public.integration_report_packages
     set admitted_under_admission_id = (
       select id from public.report_structure_admissions
       where organization_id = 'a6000000-0000-4000-8000-000000000201'::uuid
         and channel_id = 'a6000000-0000-4000-8000-000000000401'::uuid
       limit 1
     )
     where id = 'a6000000-0000-4000-8000-000000000501'::uuid $$,
  'a package can record the admission that will eventually admit it'
);
select extensions.throws_ok(
  $$ update public.integration_report_packages
     set admitted_under_admission_id = 'b6000000-0000-4000-8000-000000000201'::uuid
     where id = 'a6000000-0000-4000-8000-000000000501'::uuid $$,
  '23514', 'report_package_admission_is_immutable',
  'once recorded, the admission a package points at cannot be rewritten'
);

select * from extensions.finish();

rollback;
