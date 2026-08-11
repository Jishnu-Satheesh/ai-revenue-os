begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(18);

insert into auth.users (id)
values ('4b2f0c1f-1760-4b25-8b15-100000000001'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by
)
values
  (
    '4b2f0c1f-1760-4b25-8b15-200000000001'::uuid,
    'Metric registry', 'metric-registry', 'testing', 'AE', 'AED', 'Asia/Dubai',
    '4b2f0c1f-1760-4b25-8b15-100000000001'::uuid
  ),
  (
    '4b2f0c1f-1760-4b25-8b15-200000000002'::uuid,
    'Other tenant', 'other-tenant', 'testing', 'AE', 'AED', 'Asia/Dubai',
    '4b2f0c1f-1760-4b25-8b15-100000000001'::uuid
  );

-- Definitions ----------------------------------------------------------------

select extensions.is(
  (select count(*)::bigint from public.metric_definitions where owner_scope = 'core'),
  2::bigint,
  'the core metric vocabulary is seeded and stays industry-neutral'
);

select extensions.throws_ok(
  $$
    insert into public.metric_definitions (key, label, owner_scope, value_kind, aggregation)
    values ('OrdersCount', 'Bad key', 'core', 'count', 'sum')
  $$,
  '23514',
  null,
  'a metric key must be a dotted lower-case path'
);

select extensions.throws_ok(
  $$
    insert into public.metric_definitions (key, label, owner_scope, value_kind, aggregation)
    values ('kitchen.prep_time', 'Prep time', 'core', 'duration', 'percentile')
  $$,
  '23514',
  null,
  'a percentile aggregation must declare its p value'
);

select extensions.throws_ok(
  $$
    insert into public.metric_definitions (key, label, owner_scope, value_kind, aggregation)
    values ('review.rating', 'Rating', 'core', 'rating', 'weighted_mean')
  $$,
  '23514',
  null,
  'a rating metric must declare its bounds'
);

select extensions.throws_ok(
  $$
    insert into public.metric_definitions (organization_id, key, label, owner_scope, value_kind, aggregation)
    values (
      '4b2f0c1f-1760-4b25-8b15-200000000001'::uuid,
      'revenue.gross', 'Shadowed', 'organization', 'money', 'sum'
    )
  $$,
  '23505',
  null,
  'an organization key that shadows shared vocabulary is rejected'
);

-- A fixture-only key. Using a real one would collide with seeded vocabulary
-- the moment a pack registers it, which is exactly what happened once.
insert into public.metric_definitions (key, label, owner_scope, value_kind, aggregation)
values ('testing.conversion_rate', 'Conversion rate', 'core', 'ratio', 'ratio_of_sums');

-- Observations ---------------------------------------------------------------

select extensions.throws_ok(
  $$
    insert into public.normalized_metrics (
      organization_id, metric_definition_id, value_kind, period_grain,
      period_start, period_end, period_timezone, value_numerator, quality_tier, observed_at
    )
    select
      '4b2f0c1f-1760-4b25-8b15-200000000001'::uuid, id, 'ratio', 'day',
      timestamptz '2026-08-01 20:00+00', timestamptz '2026-08-02 20:00+00', 'Asia/Dubai',
      0.12, 'measured', timestamptz '2026-08-02 20:00+00'
    from public.metric_definitions where key = 'testing.conversion_rate'
  $$,
  '23514',
  null,
  'a ratio cannot be stored as a bare quotient'
);

select extensions.throws_ok(
  $$
    insert into public.normalized_metrics (
      organization_id, metric_definition_id, value_kind, period_grain,
      period_start, period_end, period_timezone, value_numerator, quality_tier, observed_at
    )
    select
      '4b2f0c1f-1760-4b25-8b15-200000000001'::uuid, id, 'money', 'day',
      timestamptz '2026-08-01 20:00+00', timestamptz '2026-08-02 20:00+00', 'Asia/Dubai',
      125000, 'measured', timestamptz '2026-08-02 20:00+00'
    from public.metric_definitions where key = 'revenue.gross'
  $$,
  '23514',
  null,
  'a money observation must carry a currency'
);

select extensions.throws_ok(
  $$
    insert into public.normalized_metrics (
      organization_id, metric_definition_id, value_kind, period_grain,
      period_start, period_end, period_timezone, value_numerator, currency, quality_tier, observed_at
    )
    select
      '4b2f0c1f-1760-4b25-8b15-200000000001'::uuid, id, 'duration', 'day',
      timestamptz '2026-08-01 20:00+00', timestamptz '2026-08-02 20:00+00', 'Asia/Dubai',
      125000, null, 'measured', timestamptz '2026-08-02 20:00+00'
    from public.metric_definitions where key = 'revenue.gross'
  $$,
  '23503',
  null,
  'a declared value kind that disagrees with its definition is rejected'
);

insert into public.normalized_metrics (
  id, organization_id, metric_definition_id, value_kind, period_grain,
  period_start, period_end, period_timezone, value_numerator, currency, quality_tier, observed_at
)
select
  '4b2f0c1f-1760-4b25-8b15-300000000001'::uuid,
  '4b2f0c1f-1760-4b25-8b15-200000000001'::uuid, id, 'money', 'day',
  timestamptz '2026-08-01 20:00+00', timestamptz '2026-08-02 20:00+00', 'Asia/Dubai',
  125000, 'AED', 'measured', timestamptz '2026-08-02 20:00+00'
from public.metric_definitions where key = 'revenue.gross';

select extensions.throws_ok(
  $$
    insert into public.normalized_metrics (
      organization_id, metric_definition_id, value_kind, period_grain,
      period_start, period_end, period_timezone, value_numerator, currency, quality_tier, observed_at, revision
    )
    select
      '4b2f0c1f-1760-4b25-8b15-200000000001'::uuid, id, 'money', 'day',
      timestamptz '2026-08-01 20:00+00', timestamptz '2026-08-02 20:00+00', 'Asia/Dubai',
      130000, 'AED', 'measured', timestamptz '2026-08-02 20:00+00', 2
    from public.metric_definitions where key = 'revenue.gross'
  $$,
  '23505',
  null,
  'a second current revision of one series is rejected'
);

select extensions.throws_ok(
  $$
    update public.normalized_metrics
    set value_numerator = 999
    where id = '4b2f0c1f-1760-4b25-8b15-300000000001'::uuid
  $$,
  '23514',
  null,
  'an observation cannot be edited in place'
);

-- A restatement retires the incumbent before the successor exists, which is the
-- only possible order: inserting first would collide with the partial unique
-- index on current rows. The supersession foreign key is deferred so the
-- dangling pointer resolves within the transaction.
update public.normalized_metrics
set superseded_by_id = '4b2f0c1f-1760-4b25-8b15-300000000002'::uuid,
    supersede_reason = 'provider restatement'
where id = '4b2f0c1f-1760-4b25-8b15-300000000001'::uuid;

insert into public.normalized_metrics (
  id, organization_id, metric_definition_id, value_kind, period_grain,
  period_start, period_end, period_timezone, value_numerator, currency, quality_tier, observed_at, revision
)
select
  '4b2f0c1f-1760-4b25-8b15-300000000002'::uuid,
  '4b2f0c1f-1760-4b25-8b15-200000000001'::uuid, id, 'money', 'day',
  timestamptz '2026-08-01 20:00+00', timestamptz '2026-08-02 20:00+00', 'Asia/Dubai',
  130000, 'AED', 'measured', timestamptz '2026-08-02 20:00+00', 2
from public.metric_definitions where key = 'revenue.gross';

-- The suite rolls back rather than commits, so force the deferred foreign key
-- to be validated here. Without this the restatement would appear to pass even
-- if the pointer never resolved.
set constraints all immediate;

select extensions.is(
  (
    select count(*)::bigint
    from public.normalized_metrics
    where organization_id = '4b2f0c1f-1760-4b25-8b15-200000000001'::uuid
      and superseded_by_id is null
  ),
  1::bigint,
  'a restated series keeps exactly one current revision'
);

select extensions.is(
  (
    select value_numerator
    from public.normalized_metrics
    where id = '4b2f0c1f-1760-4b25-8b15-300000000001'::uuid
  ),
  125000::numeric,
  'the superseded revision keeps the value that was read at the time'
);

select extensions.throws_ok(
  $$
    update public.normalized_metrics
    set superseded_by_id = '4b2f0c1f-1760-4b25-8b15-300000000002'::uuid
    where id = '4b2f0c1f-1760-4b25-8b15-300000000001'::uuid
  $$,
  '23514',
  null,
  'an already superseded revision cannot be superseded again'
);

-- Tenancy --------------------------------------------------------------------

insert into public.metric_definitions (organization_id, key, label, owner_scope, value_kind, aggregation)
values (
  '4b2f0c1f-1760-4b25-8b15-200000000002'::uuid,
  'custom.footfall', 'Footfall', 'organization', 'count', 'sum'
);

select extensions.throws_ok(
  $$
    insert into public.normalized_metrics (
      organization_id, metric_definition_id, value_kind, period_grain,
      period_start, period_end, period_timezone, value_numerator, quality_tier, observed_at
    )
    select
      '4b2f0c1f-1760-4b25-8b15-200000000001'::uuid, id, 'count', 'day',
      timestamptz '2026-08-01 20:00+00', timestamptz '2026-08-02 20:00+00', 'Asia/Dubai',
      10, 'measured', timestamptz '2026-08-02 20:00+00'
    from public.metric_definitions where key = 'custom.footfall'
  $$,
  '42501',
  null,
  'an organization cannot record against another tenant custom definition'
);

-- Economics roles --------------------------------------------------------------

-- The binding the channel economics ledger reads instead of naming pack
-- vocabulary in core code. See specs/015 section 5 and specs/012 section 6.

select extensions.is(
  (
    select key
    from public.metric_definitions
    where organization_id is null and economics_role = 'reported_margin'
  ),
  'margin.contribution',
  'the pack declares which metric states a reported margin'
);

select extensions.throws_ok(
  $$
    insert into public.metric_definitions (key, label, owner_scope, value_kind, aggregation, economics_role)
    values ('testing.other_revenue', 'Other revenue', 'core', 'money', 'sum', 'gross_revenue')
  $$,
  '23505',
  null,
  'two shared metrics cannot claim one economics role'
);

select extensions.lives_ok(
  $$
    insert into public.metric_definitions (
      organization_id, key, label, owner_scope, value_kind, aggregation, economics_role
    )
    values (
      '4b2f0c1f-1760-4b25-8b15-200000000001'::uuid,
      'testing.net_margin', 'Net margin', 'organization', 'money', 'sum', 'reported_margin'
    )
  $$,
  'an organization may point a role at its own key without touching shared vocabulary'
);

select extensions.throws_ok(
  $$
    insert into public.metric_definitions (
      organization_id, key, label, owner_scope, value_kind, aggregation, economics_role
    )
    values (
      '4b2f0c1f-1760-4b25-8b15-200000000001'::uuid,
      'testing.other_margin', 'Other margin', 'organization', 'money', 'sum', 'reported_margin'
    )
  $$,
  '23505',
  null,
  'but only once, or the ledger''s choice of input would be arbitrary'
);

select * from extensions.finish();

rollback;
