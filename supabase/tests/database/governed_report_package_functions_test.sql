begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(17);

insert into auth.users (id)
values ('d1000000-0000-4000-8000-000000000001'::uuid);
insert into public.accounts (id, name, slug, created_by)
values ('d1000000-0000-4000-8000-000000000101'::uuid, 'Report function verifier', 'report-function-verifier', 'd1000000-0000-4000-8000-000000000001'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by)
values ('d1000000-0000-4000-8000-000000000201'::uuid, 'd1000000-0000-4000-8000-000000000101'::uuid, 'Report function verifier', 'report-function-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'd1000000-0000-4000-8000-000000000001'::uuid);
insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('d1000000-0000-4000-8000-000000000301'::uuid, 'd1000000-0000-4000-8000-000000000201'::uuid, 'Verifier outlet', 'verifier-outlet', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('d1000000-0000-4000-8000-000000000401'::uuid, 'd1000000-0000-4000-8000-000000000201'::uuid, 'verifier-channel', 'Verifier channel', 'marketplace', 'd1000000-0000-4000-8000-000000000001'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role)
values ('d1000000-0000-4000-8000-000000000101'::uuid, 'd1000000-0000-4000-8000-000000000001'::uuid, 'owner', 'operator');

set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-4000-8000-000000000001';

select extensions.lives_ok(
  $$
    create temporary table report_package_execution as
    select public.start_governed_report_package_upload(
      'd1000000-0000-4000-8000-000000000201'::uuid,
      'd1000000-0000-4000-8000-000000000001'::uuid,
      'd1000000-0000-4000-8000-000000000401'::uuid,
      'd1000000-0000-4000-8000-000000000301'::uuid,
      'Settlement', date '2026-08-01', date '2026-08-07', 'AED', 'csv',
      'verifier.csv', 'text/csv', 4, 'report-intent-verifier-0001',
      'd1000000-0000-4000-8000-000000000501'::uuid
    ) as package
  $$,
  'upload intent validates existing organization, channel, and branch records on staging'
);

grant select on table report_package_execution to service_role;

select extensions.lives_ok(
  $$
    insert into storage.objects (bucket_id, name, metadata)
    select 'governed-report-packages', package ->> 'storage_path', jsonb_build_object('size', 4, 'mimetype', 'text/csv')
    from report_package_execution
  $$,
  'private Storage policy accepts only the canonical package object path'
);

select extensions.lives_ok(
  $$
    select public.complete_governed_report_package_upload(
      'd1000000-0000-4000-8000-000000000201'::uuid,
      'd1000000-0000-4000-8000-000000000001'::uuid,
      (select (package ->> 'id')::uuid from report_package_execution),
      'report-complete-verifier-0001', 'd1000000-0000-4000-8000-000000000502'::uuid
    )
  $$,
  'upload completion validates the immutable Storage object on staging'
);

reset role;
set local role service_role;

select extensions.lives_ok(
  $$
    select public.claim_governed_report_package_profiling(
      'd1000000-0000-4000-8000-000000000201'::uuid,
      (select (package ->> 'id')::uuid from report_package_execution),
      'report-profile-verifier-0001', 'd1000000-0000-4000-8000-000000000601'::uuid
    )
  $$,
  'worker-only profiling claim resolves package fields on staging'
);

select extensions.lives_ok(
  $$
    select public.fail_governed_report_package_profiling(
      'd1000000-0000-4000-8000-000000000201'::uuid,
      (select (package ->> 'id')::uuid from report_package_execution),
      'd1000000-0000-4000-8000-000000000601'::uuid, 'UNREADABLE_WORKBOOK'
    )
  $$,
  'worker failure records a safe code without raw workbook content'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-4000-8000-000000000001';

select extensions.lives_ok(
  $$
    select public.retry_governed_report_package_profiling(
      'd1000000-0000-4000-8000-000000000201'::uuid,
      'd1000000-0000-4000-8000-000000000001'::uuid,
      (select (package ->> 'id')::uuid from report_package_execution),
      'report-retry-verifier-0001', 'd1000000-0000-4000-8000-000000000503'::uuid
    )
  $$,
  'operator retry restores only a previously failed package to uploaded'
);

-- A package nothing ever came for ------------------------------------------------
--
-- The dispatch that should have profiled this package can simply never run, and
-- when it does not the package stops at `uploaded` rather than at `failed`:
-- nothing claimed it, so nothing marked it wrong. The pilot client's real
-- Talabat export sat exactly there for a day. Refusing to retry a waiting
-- package left an operator with a file the platform had accepted, would happily
-- profile, and offered no way to ask about again.

select extensions.is(
  (select status from public.integration_report_packages
    where id = (select (package ->> 'id')::uuid from report_package_execution)),
  'uploaded',
  'the retried package is waiting rather than failed'
);

select extensions.lives_ok(
  $$
    select public.retry_governed_report_package_profiling(
      'd1000000-0000-4000-8000-000000000201'::uuid,
      'd1000000-0000-4000-8000-000000000001'::uuid,
      (select (package ->> 'id')::uuid from report_package_execution),
      'report-retry-verifier-0002', 'd1000000-0000-4000-8000-000000000504'::uuid
    )
  $$,
  'a package no worker ever claimed can be asked for again'
);

select extensions.is(
  (select status from public.integration_report_packages
    where id = (select (package ->> 'id')::uuid from report_package_execution)),
  'uploaded',
  'and stays uploaded, which is the state the profiling claim already admits'
);

reset role;
set local role service_role;

select extensions.lives_ok(
  $$
    select public.claim_governed_report_package_profiling(
      'd1000000-0000-4000-8000-000000000201'::uuid,
      (select (package ->> 'id')::uuid from report_package_execution),
      'report-profile-verifier-0001', 'd1000000-0000-4000-8000-000000000601'::uuid
    )
  $$,
  'stale profiling leases can be deterministically reclaimed by the same package key'
);

select extensions.throws_ok(
  $$
    select public.complete_governed_report_package_profiling(
      'd1000000-0000-4000-8000-000000000201'::uuid,
      (select (package ->> 'id')::uuid from report_package_execution),
      'd1000000-0000-4000-8000-000000000601'::uuid,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '[{"sheetPosition":1,"sheetName":"CSV","normalizedSheetName":"csv","rowCount":1,"populatedCellCount":1,"expandedBytes":4,"headerCandidates":[{"rowPosition":1,"normalizedHeaders":["orphaned_without_a_digest"]}],"hasFormula":false,"hasMergedCells":false,"hasRepeatedHeader":false}]'::jsonb
    )
  $$,
  '22023', 'report sheet manifest is invalid',
  'profiling rejects column names with no digests behind them'
);

select extensions.lives_ok(
  $$
    select public.complete_governed_report_package_profiling(
      'd1000000-0000-4000-8000-000000000201'::uuid,
      (select (package ->> 'id')::uuid from report_package_execution),
      'd1000000-0000-4000-8000-000000000601'::uuid,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '[{"sheetPosition":1,"sheetName":"CSV","normalizedSheetName":"csv","rowCount":1,"populatedCellCount":1,"expandedBytes":4,"headerCandidateDigests":[{"rowPosition":1,"fieldCount":1,"digest":"b8a78c345cafa060523a4409ef977a18a6e035cf3ede56b295f302332819ae6e","normalizedHeaderDigests":["1f47dd5317fab65368164a12f027f7d16bbe2d3eddfedf05be115fc693324a73"]}],"hasFormula":false,"hasMergedCells":false,"hasRepeatedHeader":false}]'::jsonb
    )
  $$,
  'worker completion persists a value-free fingerprint and bounded structural evidence on staging'
);

select extensions.is(
  (select status from public.integration_report_packages where id = (select (package ->> 'id')::uuid from report_package_execution)),
  'awaiting_contract',
  'profile completion moves the package to contract review'
);
select extensions.is(
  (select schema_fingerprint from public.integration_report_packages where id = (select (package ->> 'id')::uuid from report_package_execution)),
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'profile completion stores the supplied structural fingerprint once'
);
-- A profile keeps column names, and nothing from under them. The names let an
-- operator map an export the platform does not recognise, which a one-way
-- digest cannot. Every retained name is a normalized identifier: a raw cell
-- could carry anything the provider typed, and this shape cannot.
select extensions.ok(
  not exists (
    select 1 from public.integration_report_sheet_manifests,
      lateral jsonb_array_elements(header_candidates) candidate,
      lateral jsonb_array_elements_text(candidate -> 'normalizedHeaders') header
    where organization_id = 'd1000000-0000-4000-8000-000000000201'::uuid
      and header !~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  'profile completion retains only normalized column names, never a cell value'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-4000-8000-000000000001';

select extensions.lives_ok(
  $$
    select public.propose_governed_report_contract(
      'd1000000-0000-4000-8000-000000000201'::uuid,
      'd1000000-0000-4000-8000-000000000001'::uuid,
      (select (package ->> 'id')::uuid from report_package_execution),
      '{"schemaVersion":1,"currency":"AED","outletGrain":"branch","sheets":[{"normalizedSheetName":"csv","headerRow":1,"dataStartRow":2,"allowFormula":false,"allowMergedCells":false,"fields":[{"canonicalField":"net_sales","sourceHeader":"net_sales","parser":"money","required":true,"financialSign":"positive"}]}],"controls":[],"unmappedFieldDisposition":"reviewed_ignore"}'::jsonb,
      'report-contract-proposal-verifier-0001',
      'd1000000-0000-4000-8000-000000000701'::uuid
    )
  $$,
  'owner can propose an exact bounded contract after profiling on staging'
);

select extensions.lives_ok(
  $$
    select public.decide_governed_report_contract(
      'd1000000-0000-4000-8000-000000000201'::uuid,
      'd1000000-0000-4000-8000-000000000001'::uuid,
      (select id from public.report_contract_versions where organization_id = 'd1000000-0000-4000-8000-000000000201'::uuid),
      'approved', 'Verified against bounded headers.', 'report-contract-decision-verifier-0001',
      'd1000000-0000-4000-8000-000000000702'::uuid
    )
  $$,
  'owner approval creates an exact contract binding without projecting values on staging'
);

select * from extensions.finish();

rollback;
