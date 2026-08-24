begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(24);

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

-- The five optional keys a contract has been able to declare since the provider
-- library was drafted. This shape is representative rather than a copy of any
-- checked-in definition; `provider-library/database-agreement.test.ts` is what
-- keeps the key list itself honest against the real ones.
create function pg_temp.contract_shape() returns jsonb language sql immutable as $shape$
  select '{
    "schemaVersion": 1,
    "currency": "AED",
    "outletGrain": "branch",
    "sheets": [{
      "normalizedSheetName": "performance",
      "sheetLocator": {"kind": "position", "position": 1},
      "headerRow": 1,
      "dataStartRow": 2,
      "allowFormula": false,
      "allowMergedCells": false,
      "totalsRow": {"canonicalField": "row_label", "label": "Total"},
      "fields": [
        {"canonicalField": "period_date", "sourceHeader": "date", "parser": "local_date", "dateEncoding": "excel_serial", "required": true},
        {"canonicalField": "gross_sales", "sourceHeader": "gross_sales", "parser": "money", "financialSign": "positive", "required": false, "absentMarkers": ["-"]},
        {"canonicalField": "row_label", "sourceHeader": "branch_name", "parser": "text", "required": false}
      ]
    }],
    "controls": [],
    "unmappedFieldDisposition": "reviewed_ignore",
    "unmappedSheetDisposition": "reviewed_ignore"
  }'::jsonb
$shape$;

select extensions.lives_ok(
  $q$ select private.assert_report_contract_document(pg_temp.contract_shape()) $q$,
  'a contract declaring a sheet locator, totals row, date encoding and absent markers is accepted'
);
select extensions.throws_ok(
  $q$ select private.assert_report_contract_document(jsonb_set(pg_temp.contract_shape(), '{unmappedSheetDisposition}', '"sometimes"'::jsonb)) $q$,
  '22023',
  'report contract document is invalid',
  'a sheet disposition outside the two it may say is refused'
);
select extensions.throws_ok(
  $q$ select private.assert_report_contract_document(jsonb_set(pg_temp.contract_shape(), '{sheets,0,sheetLocator,position}', '99'::jsonb)) $q$,
  '22023',
  'report contract sheet locator is invalid',
  'a sheet position outside the readable range is refused'
);
select extensions.throws_ok(
  $q$ select private.assert_report_contract_document(jsonb_set(pg_temp.contract_shape(), '{sheets,0,totalsRow,canonicalField}', '"nothing_binds_this"'::jsonb)) $q$,
  '22023',
  'report contract totals row is invalid',
  'a totals row labelled in a column the sheet never reads is refused'
);
select extensions.throws_ok(
  $q$ select private.assert_report_contract_document(jsonb_set(pg_temp.contract_shape(), '{sheets,0,fields,1,dateEncoding}', '"iso_date"'::jsonb)) $q$,
  '22023',
  'report contract field rule is invalid',
  'a date encoding on a field that holds money is refused'
);
select extensions.throws_ok(
  $q$ select private.assert_report_contract_document(jsonb_set(pg_temp.contract_shape(), '{sheets,0,fields,1,absentMarkers}', '["0"]'::jsonb)) $q$,
  '22023',
  'report contract absent markers are invalid',
  'a number is never allowed to mean absent'
);
select extensions.throws_ok(
  $q$ select private.assert_report_contract_document(jsonb_set(
        pg_temp.contract_shape(),
        '{sheets,0,fields}',
        (pg_temp.contract_shape() -> 'sheets' -> 0 -> 'fields')
          || jsonb_build_array(pg_temp.contract_shape() -> 'sheets' -> 0 -> 'fields' -> 1))) $q$,
  '22023',
  'report contract fields are duplicated',
  'one canonical field read from two columns of the same sheet is refused'
);
select extensions.throws_ok(
  $q$ select private.assert_report_contract_document(jsonb_set(
        pg_temp.contract_shape(),
        '{sheets}',
        (pg_temp.contract_shape() -> 'sheets')
          || jsonb_build_array(jsonb_set(pg_temp.contract_shape() -> 'sheets' -> 0, '{normalizedSheetName}', '"second"'::jsonb)))) $q$,
  '22023',
  'report contract sheet positions are duplicated',
  'two sheets read from the same position are refused'
);

select * from extensions.finish();

rollback;
