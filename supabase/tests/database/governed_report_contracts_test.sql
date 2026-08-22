begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(16);

select extensions.has_table('public', 'report_contracts', 'stable report contract identities exist');
select extensions.has_table('public', 'report_contract_versions', 'immutable report contract versions exist');
select extensions.has_table('public', 'report_contract_decisions', 'append-only report contract decisions exist');
select extensions.has_table('public', 'report_contract_bindings', 'exact approved contract bindings exist');
select extensions.has_column('public', 'integration_report_packages', 'schema_fingerprint', 'packages retain a value-free schema fingerprint');
select extensions.has_column('public', 'integration_report_sheet_manifests', 'header_candidate_digests', 'sheet evidence retains digest-only header candidates');

select extensions.ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.report_contract_versions'::regclass),
  'report contract versions enforce RLS'
);
select extensions.ok(
  (select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.report_contract_versions'::regclass),
  'report contract versions force RLS'
);
select extensions.ok(
  pg_catalog.has_table_privilege('authenticated', 'public.report_contract_versions', 'select'),
  'authenticated users receive the report contract read surface'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.report_contract_versions', 'insert'),
  'authenticated users cannot insert contract versions directly'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.propose_governed_report_contract(uuid,uuid,uuid,jsonb,text,uuid,text,text)',
    'execute'
  ),
  'authenticated administrators use the constrained contract proposal RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.decide_governed_report_contract(uuid,uuid,uuid,text,text,text,uuid)',
    'execute'
  ),
  'authenticated administrators use the constrained contract decision RPC'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.complete_governed_report_package_profiling(uuid,uuid,uuid,text,text,jsonb)',
    'execute'
  ),
  'authenticated users cannot complete profiling with arbitrary fingerprint evidence'
);
select extensions.has_trigger('public', 'report_contract_versions', 'report_contract_versions_prevent_update', 'contract versions are immutable');
select extensions.has_trigger('public', 'report_contract_decisions', 'report_contract_decisions_prevent_update', 'contract decisions are immutable');
select extensions.has_trigger('public', 'report_contracts', 'report_contracts_prevent_update', 'contract identities are immutable');

select * from extensions.finish();

rollback;
