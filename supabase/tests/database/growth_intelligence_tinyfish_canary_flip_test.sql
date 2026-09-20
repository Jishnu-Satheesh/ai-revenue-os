begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(4);

-- Precondition: the 20260920130000 canary-staging row is pushed.
select extensions.ok(
  exists (
    select 1 from private.growth_intelligence_provider_qualifications
    where provider = 'tinyfish'
  ),
  'the staged tinyfish provider row exists before the flip'
);

-- The flip: same statement shape as migration 20260920141000.
update private.growth_intelligence_provider_qualifications
set canary_result = 'passed',
  updated_at = pg_catalog.now()
where provider = 'tinyfish';

select extensions.is(
  (select canary_result from private.growth_intelligence_provider_qualifications
   where provider = 'tinyfish'),
  'passed',
  'the flip lands canary_result passed for provider tinyfish'
);

select extensions.ok(
  (select (public.check_research_provider_qualification_for('tinyfish') ->> 'available')::boolean),
  'the flipped lane reports available through the governed gate'
);

-- The rollback: the exact one-line statement from the migration header.
update private.growth_intelligence_provider_qualifications
set canary_result = 'pending',
  updated_at = pg_catalog.now()
where provider = 'tinyfish';

select extensions.is(
  (select canary_result from private.growth_intelligence_provider_qualifications
   where provider = 'tinyfish'),
  'pending',
  'the rollback restores canary_result pending for provider tinyfish'
);

rollback;
