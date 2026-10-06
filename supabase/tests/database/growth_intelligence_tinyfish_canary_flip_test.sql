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

-- The flip: same statement shape as migration 20260920141000, which may only
-- be pushed after 20260920130000 (staged row) and 20260920140000 (fenced
-- update spend, pgTAP 24/24) in that order.
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

-- Drift-proof gate read: assert only that the flip clears the canary
-- blocker. The full gate answer is selected below for the report but NOT
-- asserted, so unrelated staging drift (e.g. an expiry or bounds edit) can
-- never false-fail this suite.
select extensions.ok(
  not (select public.check_research_provider_qualification_for('tinyfish') -> 'blockers'
    ? 'controlled_canary_missing'),
  'the flipped lane no longer reports controlled_canary_missing'
);

select public.check_research_provider_qualification_for('tinyfish') as gate_answer_report;

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
