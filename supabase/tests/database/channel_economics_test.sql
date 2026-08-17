begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(23);

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
  'test_commission', 'Marketplace commission', 'pack', 'restaurant', 'rate_of_revenue'
);

-- Definitions ----------------------------------------------------------------

select extensions.throws_ok(
  $$
    insert into public.cost_component_definitions (organization_id, key, label, owner_scope, computation_kind)
    values (
      '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid,
      'test_commission', 'Our commission', 'organization', 'rate_of_revenue'
    )
  $$,
  '23505',
  null,
  'an organization key that shadows shared cost vocabulary is rejected'
);

select extensions.throws_ok(
  $$
    insert into public.cost_component_definitions (key, label, owner_scope, computation_kind, applies_to_channels)
    values ('test_packaging', 'Packaging', 'core', 'per_unit', array[]::text[])
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
    where e.organization_id = '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid
      and e.channel = 'talabat'
  $$,
  '23514',
  null,
  'a missing component cannot carry an amount'
);

select extensions.throws_ok(
  $$
    insert into public.channel_economics_entries (
      organization_id, grain, channel, period_start, period_end, period_timezone,
      gross_revenue_minor, transaction_count, currency, margin_source,
      completeness_grade, contribution_margin_minor, reported_quality_tier,
      reported_margin_minor
    )
    values (
      '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid, 'period', 'careem',
      timestamptz '2026-08-01 20:00+00', timestamptz '2026-08-02 20:00+00', 'Asia/Dubai',
      1000000, 200, 'AED', 'reported', 'complete', 345000, 'measured', 300000
    )
  $$,
  '23514',
  null,
  'a reported entry cannot also hold a separate reported figure to disagree with'
);

-- Recomputation ----------------------------------------------------------------

insert into public.cost_component_definitions (id, key, label, owner_scope, pack_slug, computation_kind)
values (
  '6c3a0c1f-1760-4b25-8b15-300000000002'::uuid,
  'test_food_cost', 'Food cost', 'pack', 'restaurant', 'rate_of_revenue'
);

select extensions.lives_ok(
  $$
    select public.record_channel_economics_entries(
      '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid,
      $json$[
        {
          "grain": "period",
          "channel": "noon_food",
          "period_start": "2026-08-01T20:00:00+00:00",
          "period_end": "2026-08-02T20:00:00+00:00",
          "period_timezone": "Asia/Dubai",
          "gross_revenue_minor": 1000000,
          "transaction_count": 200,
          "currency": "AED",
          "margin_source": "derived",
          "completeness_grade": "complete",
          "contribution_margin_minor": 420000,
          "components": [
            {
              "definition_id": "6c3a0c1f-1760-4b25-8b15-300000000001",
              "amount_minor": 280000,
              "quality_tier": "measured"
            },
            {
              "definition_id": "6c3a0c1f-1760-4b25-8b15-300000000002",
              "amount_minor": 300000,
              "quality_tier": "measured"
            }
          ]
        }
      ]$json$::jsonb
    )
  $$,
  'the write path records an entry and its components together'
);

-- The same period again, repriced after food cost lost its rate. This is the
-- recomputation case: a correction has to overwrite the period it applies to.
select public.record_channel_economics_entries(
  '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid,
  $json$[
    {
      "grain": "period",
      "channel": "noon_food",
      "period_start": "2026-08-01T20:00:00+00:00",
      "period_end": "2026-08-02T20:00:00+00:00",
      "period_timezone": "Asia/Dubai",
      "gross_revenue_minor": 1000000,
      "transaction_count": 200,
      "currency": "AED",
      "margin_source": "derived",
      "completeness_grade": "indicative",
      "at_most_minor": 720000,
      "components": [
        {
          "definition_id": "6c3a0c1f-1760-4b25-8b15-300000000001",
          "amount_minor": 280000,
          "quality_tier": "measured"
        }
      ]
    }
  ]$json$::jsonb
);

-- Scoped to the fixture tenant throughout. This suite runs against a shared
-- development database that already holds a seeded organization's entries, so
-- an unscoped count would be measuring somebody else's data.
select extensions.is(
  (
    select count(*)
    from public.channel_economics_entries
    where organization_id = '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid
      and channel = 'noon_food'
  ),
  1::bigint,
  'recomputing a period replaces its entry rather than adding a second'
);

select extensions.is(
  (
    select contribution_margin_minor
    from public.channel_economics_entries
    where organization_id = '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid
      and channel = 'noon_food'
  ),
  null::bigint,
  'a period that regrades to indicative loses the figure it used to state'
);

select extensions.is(
  (
    select at_most_minor
    from public.channel_economics_entries
    where organization_id = '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid
      and channel = 'noon_food'
  ),
  720000::bigint,
  'and reports a ceiling in its place'
);

select extensions.is(
  (
    select count(*)
    from public.channel_economics_components components
    join public.channel_economics_entries entries on entries.id = components.entry_id
    where entries.organization_id = '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid
      and entries.channel = 'noon_food'
  ),
  1::bigint,
  'components are replaced wholesale, so one that no longer applies stops subtracting'
);

-- Rate capture -----------------------------------------------------------------

-- The write path behind the onboarding cost structure section. Run as the
-- owner, because the function refuses anyone else.

insert into public.organization_memberships (organization_id, user_id, role)
values (
  '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid,
  '6c3a0c1f-1760-4b25-8b15-100000000001'::uuid,
  'owner'
)
on conflict do nothing;

set local role authenticated;
set local request.jwt.claim.sub = '6c3a0c1f-1760-4b25-8b15-100000000001';

select extensions.lives_ok(
  $$
    select public.record_cost_component_rates(
      '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid,
      $json$[
        {
          "definition_id": "6c3a0c1f-1760-4b25-8b15-300000000002",
          "channel": null,
          "rate_of_revenue": 0.30,
          "quality_tier": "estimated",
          "effective_from": "2026-06-01"
        }
      ]$json$::jsonb
    )
  $$,
  'an operator can record a typed cost as an effective-dated rate'
);

-- The same date again. Correcting a typo is not a commission tier change.
select public.record_cost_component_rates(
  '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid,
  $json$[
    {
      "definition_id": "6c3a0c1f-1760-4b25-8b15-300000000002",
      "channel": null,
      "rate_of_revenue": 0.34,
      "quality_tier": "measured",
      "effective_from": "2026-06-01"
    }
  ]$json$::jsonb
);

reset role;

select extensions.is(
  (
    select count(*)
    from public.cost_component_rates
    where organization_id = '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid
      and definition_id = '6c3a0c1f-1760-4b25-8b15-300000000002'::uuid
  ),
  1::bigint,
  'saving the section again on the same date corrects the rate rather than duplicating it'
);

select extensions.is(
  (
    select quality_tier
    from public.cost_component_rates
    where organization_id = '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid
      and definition_id = '6c3a0c1f-1760-4b25-8b15-300000000002'::uuid
  ),
  'measured',
  'and carries the confidence the operator last chose'
);

insert into auth.users (id)
values ('6c3a0c1f-1760-4b25-8b15-100000000002'::uuid);

set local role authenticated;
set local request.jwt.claim.sub = '6c3a0c1f-1760-4b25-8b15-100000000002';

select extensions.throws_ok(
  $$
    select public.record_cost_component_rates(
      '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid,
      $json$[
        {
          "definition_id": "6c3a0c1f-1760-4b25-8b15-300000000001",
          "rate_of_revenue": 0.10,
          "quality_tier": "measured",
          "effective_from": "2026-06-01"
        }
      ]$json$::jsonb
    )
  $$,
  '42501',
  null,
  'a non-member cannot price another tenant cost structure'
);

-- Still acting as the non-member. The operator view reads these two tables
-- directly under the member policy, so this is the isolation that protects it.
select extensions.is(
  (
    select count(*)
    from public.channel_economics_entries
    where organization_id = '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid
  ),
  0::bigint,
  'a non-member reads no economics entries at all'
);

select extensions.is(
  (
    select count(*)
    from public.channel_economics_components
    where organization_id = '6c3a0c1f-1760-4b25-8b15-200000000001'::uuid
  ),
  0::bigint,
  'nor the components behind them'
);

reset role;

select * from extensions.finish();

rollback;
