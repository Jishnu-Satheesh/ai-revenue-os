begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(11);

insert into auth.users (id)
values ('6c3a0c1f-1760-4b25-8b15-100000000001'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by
)
values (
  '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid,
  'Economics ledger', 'economics-ledger', 'testing', 'AE', 'AED', 'Asia/Dubai',
  '6c3a0c1f-1760-4b25-8b15-100000000001'::uuid
);

insert into public.cost_component_definitions (id, key, label, owner_scope, pack_slug, computation_kind)
values (
  '6c3a0c1f-1760-4b25-8b15-300000000001'::uuid,
  'commission', 'Marketplace commission', 'pack', 'restaurant', 'rate_of_revenue'
);

-- Definitions ----------------------------------------------------------------

select extensions.throws_ok(
  $$
    insert into public.cost_component_definitions (organization_id, key, label, owner_scope, computation_kind)
    values (
      '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid,
      'commission', 'Our commission', 'organization', 'rate_of_revenue'
    )
  $$,
  '23505',
  null,
  'an organization key that shadows shared cost vocabulary is rejected'
);

select extensions.throws_ok(
  $$
    insert into public.cost_component_definitions (key, label, owner_scope, computation_kind, applies_to_channels)
    values ('packaging', 'Packaging', 'core', 'per_unit', array[]::text[])
  $$,
  '23514',
  null,
  'a component that applies to no channel at all is rejected'
);

-- Rates ----------------------------------------------------------------------

select extensions.throws_ok(
  $$
    insert into public.cost_component_rates (
      organization_id, definition_id, quality_tier, amount_minor, rate_of_revenue, currency
    )
    values (
      '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid,
      '6c3a0c1f-1760-4b25-8b15-300000000001'::uuid,
      'measured', 500, 0.28, 'AED'
    )
  $$,
  '23514',
  null,
  'a rate cannot set both an absolute amount and a revenue share'
);

select extensions.throws_ok(
  $$
    insert into public.cost_component_rates (
      organization_id, definition_id, quality_tier, amount_minor
    )
    values (
      '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid,
      '6c3a0c1f-1760-4b25-8b15-300000000001'::uuid,
      'measured', 500
    )
  $$,
  '23514',
  null,
  'an absolute amount must carry its currency'
);

insert into public.cost_component_rates (
  organization_id, definition_id, channel, quality_tier, rate_of_revenue, effective_from
)
values (
  '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid,
  '6c3a0c1f-1760-4b25-8b15-300000000001'::uuid,
  'talabat', 'measured', 0.28, date '2026-03-01'
);

select extensions.lives_ok(
  $$
    insert into public.cost_component_rates (
      organization_id, definition_id, channel, quality_tier, rate_of_revenue, effective_from
    )
    values (
      '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid,
      '6c3a0c1f-1760-4b25-8b15-300000000001'::uuid,
      'talabat', 'measured', 0.30, date '2026-06-01'
    )
  $$,
  'a commission tier change opens a new effective period rather than rewriting the old one'
);

select extensions.throws_ok(
  $$
    insert into public.cost_component_rates (
      organization_id, definition_id, channel, quality_tier, rate_of_revenue, effective_from
    )
    values (
      '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid,
      '6c3a0c1f-1760-4b25-8b15-300000000001'::uuid,
      'talabat', 'measured', 0.31, date '2026-06-01'
    )
  $$,
  '23505',
  null,
  'two rates cannot start on the same day for one scope'
);

-- Entries --------------------------------------------------------------------

-- A complete margin states a figure and no ceiling.
select extensions.lives_ok(
  $$
    insert into public.channel_economics_entries (
      organization_id, grain, channel, period_start, period_end, period_timezone,
      gross_revenue_minor, transaction_count, currency, margin_source,
      completeness_grade, contribution_margin_minor
    )
    values (
      '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid, 'period', 'talabat',
      timestamptz '2026-08-01 20:00+00', timestamptz '2026-08-02 20:00+00', 'Asia/Dubai',
      1000000, 200, 'AED', 'derived', 'complete', 345000
    )
  $$,
  'a complete derived margin records a figure'
);

select extensions.throws_ok(
  $$
    insert into public.channel_economics_entries (
      organization_id, grain, channel, period_start, period_end, period_timezone,
      gross_revenue_minor, transaction_count, currency, margin_source,
      completeness_grade, contribution_margin_minor, at_most_minor
    )
    values (
      '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid, 'period', 'deliveroo',
      timestamptz '2026-08-01 20:00+00', timestamptz '2026-08-02 20:00+00', 'Asia/Dubai',
      1000000, 200, 'AED', 'derived', 'indicative', 345000, 645000
    )
  $$,
  '23514',
  null,
  'an indicative margin cannot also state a scalar figure'
);

select extensions.throws_ok(
  $$
    insert into public.channel_economics_entries (
      organization_id, grain, channel, period_start, period_end, period_timezone,
      gross_revenue_minor, transaction_count, currency, margin_source,
      completeness_grade, contribution_margin_minor
    )
    values (
      '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid, 'period', 'deliveroo',
      timestamptz '2026-08-01 20:00+00', timestamptz '2026-08-02 20:00+00', 'Asia/Dubai',
      1000000, 200, 'AED', 'derived', 'indicative', null
    )
  $$,
  '23514',
  null,
  'an indicative margin must record its ceiling'
);

select extensions.throws_ok(
  $$
    insert into public.channel_economics_entries (
      organization_id, grain, channel, period_start, period_end, period_timezone,
      gross_revenue_minor, transaction_count, currency, margin_source,
      completeness_grade, contribution_margin_minor, at_most_minor, reported_quality_tier
    )
    values (
      '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid, 'period', 'noon_food',
      timestamptz '2026-08-01 20:00+00', timestamptz '2026-08-02 20:00+00', 'Asia/Dubai',
      1000000, 200, 'AED', 'reported', 'indicative', null, 900000, 'measured'
    )
  $$,
  '23514',
  null,
  'a reported margin is stated, so it can never be indicative'
);

-- Components -----------------------------------------------------------------

select extensions.throws_ok(
  $$
    insert into public.channel_economics_components (
      organization_id, entry_id, definition_id, amount_minor, quality_tier
    )
    select
      '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid, e.id,
      '6c3a0c1f-1760-4b25-8b15-300000000001'::uuid, 280000, 'missing'
    from public.channel_economics_entries e
    where e.channel = 'talabat'
  $$,
  '23514',
  null,
  'a missing component cannot carry an amount'
);

select * from extensions.finish();

rollback;
