begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(20);

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

-- A categorical output, for the label map that translates a provider's own
-- words into the approved vocabulary.
create or replace function pg_temp.categorical(p_categorical jsonb) returns jsonb
language sql immutable as $fn$
  select jsonb_build_object(
    'schemaVersion', 1, 'outputKind', 'period_grain', 'grain', 'day',
    'periodKey', jsonb_build_object('normalizedSheetName', 'csv', 'canonicalField', 'period_date'),
    'outputs', jsonb_build_array(jsonb_build_object(
      'key', 'cancellation_party', 'normalizedSheetName', 'csv',
      'canonicalField', 'cancellation_type',
      'metricKey', 'order.cancellation_attribution_count',
      'valueKind', 'count', 'aggregation', 'sum',
      'categorical', jsonb_build_object(
        'dimensionKey', 'cancelled_by', 'collectInjectedValues', false) || p_categorical)),
    'controlTotals', '[]'::jsonb);
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

-- The label map. Keeta writes `Cancelled by merchant` where Talabat writes
-- `CHECK_IN_REQUIRED`, and a dimension value has to be a stable key.
select extensions.lives_ok(
  $$ select private.assert_report_projection_document(pg_temp.categorical(
       '{"allowedValues":["MERCHANT","CUSTOMER_SERVICE"],
         "labelMap":{"Cancelled by merchant":"MERCHANT",
                     "Cancelled by customer service":"CUSTOMER_SERVICE"}}'::jsonb)) $$,
  'a map that reaches every allowed value is accepted'
);

select extensions.lives_ok(
  $$ select private.assert_report_projection_document(pg_temp.categorical(
       '{"allowedValues":["CHECK_IN_REQUIRED","UNREACHABLE"]}'::jsonb)) $$,
  'a column that already writes codes still needs no map at all'
);

select extensions.throws_ok(
  $$ select private.assert_report_projection_document(pg_temp.categorical(
       '{"allowedValues":["MERCHANT"],
         "labelMap":{"Cancelled by merchant":"MERCHANT",
                     "Cancelled by customer service":"CUSTOMER_SERVICE"}}'::jsonb)) $$,
  '22023', 'report projection categorical label map is invalid',
  'a map may not produce a value the output never allowed'
);

select extensions.throws_ok(
  $$ select private.assert_report_projection_document(pg_temp.categorical(
       '{"allowedValues":["MERCHANT","CUSTOMER_SERVICE"],
         "labelMap":{"Cancelled by merchant":"MERCHANT"}}'::jsonb)) $$,
  '22023', 'report projection categorical label map is invalid',
  'an allowed value no label can produce is refused'
);

select extensions.throws_ok(
  $$ select private.assert_report_projection_document(pg_temp.categorical(
       '{"allowedValues":["MERCHANT"],
         "labelMap":{"Cancelled by merchant":"MERCHANT",
                     "  cancelled BY merchant ":"MERCHANT"}}'::jsonb)) $$,
  '22023', 'report projection categorical label map is invalid',
  'two labels differing only by case or spacing are one rule with two answers'
);

select extensions.throws_ok(
  $$ select private.assert_report_projection_document(pg_temp.categorical(
       '{"allowedValues":["MERCHANT"],"labelMap":"Cancelled by merchant"}'::jsonb)) $$,
  '22023', 'report projection categorical label map is invalid',
  'a map that is not a map is refused'
);

-- The value separator. Talabat's CSV export cannot shift cells the way its
-- spreadsheet export does, so a day's second closure reason joins the first
-- in one cell instead of landing in an injected one.
select extensions.lives_ok(
  $$ select private.assert_report_projection_document(pg_temp.categorical(
       '{"allowedValues":["CHECK_IN_REQUIRED","UNREACHABLE"],"valueSeparator":";"}'::jsonb)) $$,
  'a declared separator for a cell carrying two labels is accepted'
);

select extensions.throws_ok(
  $$ select private.assert_report_projection_document(pg_temp.categorical(
       '{"allowedValues":["CHECK_IN_REQUIRED","UNREACHABLE"],"valueSeparator":"12345"}'::jsonb)) $$,
  '22023', 'report projection categorical output is invalid',
  'a separator longer than four characters is refused'
);

select * from extensions.finish();

rollback;
