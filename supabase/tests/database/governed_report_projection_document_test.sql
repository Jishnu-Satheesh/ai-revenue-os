begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(12);

-- The guard between an approved mapping and the ledger. It had never been
-- exercised against the declaration language as it actually stands, which is
-- how three capabilities shipped in TypeScript and were refused here.

create or replace function pg_temp.doc(p_extra jsonb) returns jsonb
language sql immutable as $fn$
  select jsonb_build_object(
    'schemaVersion', 1, 'outputKind', 'exact_range',
    'outputs', jsonb_build_array(jsonb_build_object(
      'key', 'gross_revenue', 'normalizedSheetName', 'csv', 'canonicalField', 'gross_sales',
      'metricKey', 'revenue.gross', 'valueKind', 'money', 'aggregation', 'sum'))
  ) || p_extra;
$fn$;

create or replace function pg_temp.daily(p_extra jsonb) returns jsonb
language sql immutable as $fn$
  select pg_temp.doc(jsonb_build_object(
    'outputKind', 'period_grain', 'grain', 'day',
    'periodKey', jsonb_build_object('normalizedSheetName', 'csv', 'canonicalField', 'period_date'))
  ) || p_extra;
$fn$;

-- The empty array the schema always attaches. Rejecting it made every
-- declaration built after ADR 0029 unproposable, exact-range ones included.
select extensions.lives_ok(
  $$ select private.assert_report_projection_document(pg_temp.doc('{"controlTotals":[]}'::jsonb)) $$,
  'an empty list of stated totals is not an unknown field'
);

select extensions.lives_ok(
  $$ select private.assert_report_projection_document(pg_temp.doc('{}'::jsonb)) $$,
  'a declaration that states no totals at all is still valid'
);

select extensions.lives_ok(
  $$ select private.assert_report_projection_document(pg_temp.daily('{}'::jsonb)) $$,
  'a daily series is a shape this guard now knows'
);

select extensions.lives_ok(
  $$ select private.assert_report_projection_document(pg_temp.doc(
       '{"controlTotals":[{"outputKey":"gross_revenue","source":"sheet_totals_row","toleranceMinorUnits":0}]}'::jsonb)) $$,
  'a total taken from the sheet is accepted'
);

select extensions.lives_ok(
  $$ select private.assert_report_projection_document(pg_temp.doc(
       '{"controlTotals":[{"outputKey":"gross_revenue","source":"operator_stated","statedTotalMinorUnits":"8900","statedSource":"Keeta invoice","toleranceMinorUnits":1}]}'::jsonb)) $$,
  'a total read off a provider statement is accepted with its source named'
);

-- What it still refuses.
select extensions.throws_ok(
  $$ select private.assert_report_projection_document(pg_temp.doc('{"invented":true}'::jsonb)) $$,
  '22023', 'report projection document is invalid',
  'a key nobody declared is still refused'
);

select extensions.throws_ok(
  $$ select private.assert_report_projection_document(pg_temp.doc('{"grain":"day"}'::jsonb)) $$,
  '22023', 'report projection document is invalid',
  'a grain on something that is not a series is refused'
);

select extensions.throws_ok(
  $$ select private.assert_report_projection_document(pg_temp.daily(
       '{"periodKey":{"normalizedSheetName":"other","canonicalField":"period_date"}}'::jsonb)) $$,
  '22023', 'report projection output rule is invalid',
  'the date must come from the same sheet as the values it dates'
);

select extensions.throws_ok(
  $$ select private.assert_report_projection_document(pg_temp.daily(
       '{"periodKey":{"normalizedSheetName":"csv","canonicalField":"gross_sales"}}'::jsonb)) $$,
  '22023', 'report projection output rule is invalid',
  'the date cannot also be projected as a value'
);

select extensions.throws_ok(
  $$ select private.assert_report_projection_document(pg_temp.doc(
       '{"controlTotals":[{"outputKey":"invented","source":"sheet_totals_row","toleranceMinorUnits":0}]}'::jsonb)) $$,
  '22023', 'report projection control total is invalid',
  'a total against an output nobody emits is refused'
);

select extensions.throws_ok(
  $$ select private.assert_report_projection_document(pg_temp.doc(
       '{"controlTotals":[{"outputKey":"gross_revenue","source":"sheet_totals_row","statedTotalMinorUnits":"8900","toleranceMinorUnits":0}]}'::jsonb)) $$,
  '22023', 'report projection control total is invalid',
  'a total taken from the sheet cannot also be stated by hand'
);

select extensions.throws_ok(
  $$ select private.assert_report_projection_document(pg_temp.doc(
       '{"controlTotals":[{"outputKey":"gross_revenue","source":"operator_stated","statedTotalMinorUnits":"8900","toleranceMinorUnits":0}]}'::jsonb)) $$,
  '22023', 'report projection control total is invalid',
  'an operator-stated total with no statement named is refused'
);

select * from extensions.finish();

rollback;
