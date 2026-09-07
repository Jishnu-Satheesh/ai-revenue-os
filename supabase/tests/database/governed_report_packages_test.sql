begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(22);

select extensions.has_table('public', 'integration_report_packages', 'governed report packages exist');
select extensions.has_table('public', 'integration_report_sheet_manifests', 'bounded report sheet manifests exist');
select extensions.has_column('public', 'integration_report_packages', 'content_sha256', 'content digest is retained as metadata');
select extensions.has_column('public', 'integration_report_packages', 'storage_object_version', 'immutable storage version is retained');
select extensions.has_column('public', 'integration_report_packages', 'retained_until', 'retention metadata is retained');
select extensions.has_column('public', 'integration_report_sheet_manifests', 'populated_cell_count', 'sheet evidence stores counts, not cells');
select extensions.has_column('public', 'integration_report_packages', 'structure_fingerprint',
  'packages retain a worksheet-name-free structure fingerprint');
select extensions.has_column('public', 'integration_report_packages', 'structure_version',
  'packages record which structure algorithm produced that fingerprint');

select extensions.ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.integration_report_packages'::regclass),
  'report packages enforce RLS'
);
select extensions.ok(
  (select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.integration_report_packages'::regclass),
  'report packages force RLS'
);
select extensions.ok(
  pg_catalog.has_table_privilege('authenticated', 'public.integration_report_packages', 'select'),
  'authenticated users receive only the report-package read surface'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.integration_report_packages', 'insert'),
  'authenticated users cannot insert report packages directly'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.integration_report_packages', 'update'),
  'authenticated users cannot mutate report packages directly'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.integration_report_sheet_manifests', 'insert'),
  'authenticated users cannot insert raw-derived sheet manifests directly'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.start_governed_report_package_upload(uuid,uuid,uuid,uuid,text,date,date,text,text,text,text,bigint,text,uuid)',
    'execute'
  ),
  'authenticated operators use the constrained upload-intent RPC'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.claim_governed_report_package_profiling(uuid,uuid,text,uuid)',
    'execute'
  ),
  'authenticated users cannot claim report profiling work'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.claim_governed_report_package_profiling(uuid,uuid,text,uuid)',
    'execute'
  ),
  'only the service worker can claim report profiling work'
);
select extensions.ok(
  exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'operators upload governed report package objects'
  ),
  'private storage accepts only the governed upload policy'
);

-- Task 9C: the deployed Trigger worker still calls the six-argument profiling
-- completion signature Task 2 dropped. Both it and the seven-argument
-- function it now wraps must exist side by side until the worker redeploys.
select extensions.ok(
  pg_catalog.to_regprocedure(
    'public.complete_governed_report_package_profiling(uuid,uuid,uuid,text,text,jsonb)'
  ) is not null
  and pg_catalog.to_regprocedure(
    'public.complete_governed_report_package_profiling(uuid,uuid,uuid,text,text,text,jsonb)'
  ) is not null,
  'both the six-argument compatibility overload and the seven-argument profiling completion function exist'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.complete_governed_report_package_profiling(uuid,uuid,uuid,text,text,jsonb)',
    'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'public.complete_governed_report_package_profiling(uuid,uuid,uuid,text,text,text,jsonb)',
    'execute'
  ),
  'authenticated users cannot execute either profiling completion overload'
);
select extensions.has_trigger('public', 'integration_report_packages', 'integration_report_packages_audit', 'package lifecycle transitions are audited');
select extensions.has_trigger('public', 'integration_report_packages', 'integration_report_packages_prevent_delete', 'package hard deletes are blocked');

select * from extensions.finish();

rollback;
