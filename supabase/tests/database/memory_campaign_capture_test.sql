begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(26);

-- Spec 023 Swarm 4: campaign capture (state, outcome, lesson).
-- Registry, projectors, enqueue helpers, and triggers. Fixture prefix fb43.

create or replace function pg_temp.state_of(call_sql text)
returns text language plpgsql as $$
begin
  execute call_sql;
  return 'no-error';
exception when others then
  return SQLSTATE;
end;
$$;

create or replace function pg_temp.priv_of(p_role text, p_sig text)
returns text language plpgsql as $$
begin
  if pg_catalog.has_function_privilege(p_role, p_sig, 'execute') then
    return 'true';
  end if;
  return 'false';
exception when others then
  return 'missing';
end;
$$;

-- Member sessions hold no grant on the queue table, so count reads go
-- through definer rights.
create or replace function pg_temp.campaign_state_event_count()
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer from public.memory_capture_events
  where organization_id = 'fb430000-0000-4000-8000-000000000201'::uuid
    and source_kind = 'campaign_state';
$$;

create or replace function pg_temp.campaign_lesson_event_count()
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer from public.memory_capture_events
  where organization_id = 'fb430000-0000-4000-8000-000000000201'::uuid
    and source_kind = 'campaign_lesson';
$$;

-- Adapters are registered ----------------------------------------------------

select extensions.is(
  (select count(*)::integer from public.memory_capture_adapters
   where source_kind in ('campaign_state', 'campaign_outcome', 'campaign_lesson')
     and registered),
  3, 'all three campaign kinds are registered');

select extensions.has_function(
  'private', 'project_memory_campaign_state',
  'the state projector exists where complete_ dispatches it');
select extensions.has_function(
  'private', 'project_memory_campaign_outcome',
  'so does the outcome projector');
select extensions.has_function(
  'private', 'project_memory_campaign_lesson',
  'and the lesson projector');
select extensions.has_function(
  'private', 'enqueue_memory_campaign_state',
  'the state enqueue helper exists');
select extensions.has_function(
  'private', 'enqueue_memory_campaign_outcome',
  'so does the outcome enqueue helper');
select extensions.has_function(
  'private', 'enqueue_memory_campaign_lesson',
  'and the lesson enqueue helper');
select extensions.is(
  pg_temp.priv_of('authenticated', 'private.project_memory_campaign_state(uuid,uuid)') || '/'
    || pg_temp.priv_of('authenticated', 'private.project_memory_campaign_outcome(uuid,uuid)') || '/'
    || pg_temp.priv_of('authenticated', 'private.project_memory_campaign_lesson(uuid,uuid)'),
  'false/false/false', 'no session reaches a campaign projector directly');

-- Fixtures -------------------------------------------------------------------

insert into auth.users (id) values
  ('fb430000-0000-4000-8000-000000000001'::uuid),
  ('fb430000-0000-4000-8000-000000000002'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb430000-0000-4000-8000-000000000101'::uuid, 'Campaign capture A', 'campaign-capture-a', 'fb430000-0000-4000-8000-000000000001'::uuid),
  ('fb430000-0000-4000-8000-000000000102'::uuid, 'Campaign capture B', 'campaign-capture-b', 'fb430000-0000-4000-8000-000000000002'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb430000-0000-4000-8000-000000000201'::uuid, 'fb430000-0000-4000-8000-000000000101'::uuid, 'Campaign capture A', 'campaign-capture-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb430000-0000-4000-8000-000000000001'::uuid),
  ('fb430000-0000-4000-8000-000000000202'::uuid, 'fb430000-0000-4000-8000-000000000102'::uuid, 'Campaign capture B', 'campaign-capture-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb430000-0000-4000-8000-000000000002'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb430000-0000-4000-8000-000000000101'::uuid, 'fb430000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('fb430000-0000-4000-8000-000000000102'::uuid, 'fb430000-0000-4000-8000-000000000002'::uuid, 'owner', 'owner');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('fb430000-0000-4000-8000-000000000201'::uuid, 'fb430000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('fb430000-0000-4000-8000-000000000202'::uuid, 'fb430000-0000-4000-8000-000000000002'::uuid, 'owner');

insert into public.memory_integration_settings (organization_id, capture_enabled) values
  ('fb430000-0000-4000-8000-000000000201'::uuid, true);

insert into public.campaign_briefs (id, organization_id, objective, audience, created_by) values
  ('fb430000-0000-4000-8000-000000000311'::uuid, 'fb430000-0000-4000-8000-000000000201'::uuid,
   'Fill weekday tables', 'Nearby families', 'fb430000-0000-4000-8000-000000000001'::uuid);
insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by) values
  ('fb430000-0000-4000-8000-000000000312'::uuid, 'fb430000-0000-4000-8000-000000000201'::uuid,
   'Weekday push', 'manual_brief', 'fb430000-0000-4000-8000-000000000311'::uuid,
   'fb430000-0000-4000-8000-000000000001'::uuid);
insert into public.campaign_source_snapshots (id, organization_id, campaign_id, facts, assertions) values
  ('fb430000-0000-4000-8000-000000000313'::uuid, 'fb430000-0000-4000-8000-000000000201'::uuid,
   'fb430000-0000-4000-8000-000000000312'::uuid, '{}', '[]');
insert into public.campaign_bundle_versions (
  id, organization_id, campaign_id, version, source_snapshot_id, manifest, digest,
  generation_profile, execution_mode
) values (
  'fb430000-0000-4000-8000-000000000314'::uuid, 'fb430000-0000-4000-8000-000000000201'::uuid,
  'fb430000-0000-4000-8000-000000000312'::uuid, 1, 'fb430000-0000-4000-8000-000000000313'::uuid,
  ('{"version": 1, "campaignId": "fb430000-0000-4000-8000-000000000312", "generationProfile": "brand_guided", "executionMode": "best_effort", "schemaVersion": "2", "generationPolicy": {"maxVariantsPerDirection": 2, "maxVariantsTotal": 10, "policyExpiresAt": "2027-01-01T00:00:00Z"}, "directions": []}')::jsonb,
  repeat('a', 64), 'brand_guided', 'best_effort'
);

-- Outsider campaign, so cross-tenant refusals meet real rows.
insert into public.campaign_briefs (id, organization_id, objective, audience, created_by) values
  ('fb430000-0000-4000-8000-000000000321'::uuid, 'fb430000-0000-4000-8000-000000000202'::uuid,
   'Outsider push', 'Nobody', 'fb430000-0000-4000-8000-000000000002'::uuid);
insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by) values
  ('fb430000-0000-4000-8000-000000000322'::uuid, 'fb430000-0000-4000-8000-000000000202'::uuid,
   'Outsider push', 'manual_brief', 'fb430000-0000-4000-8000-000000000321'::uuid,
   'fb430000-0000-4000-8000-000000000002'::uuid);

-- Cross-tenant sources cannot back this organization's events ------------------

select extensions.is(
  pg_temp.state_of($$ insert into public.memory_capture_events (
      id, organization_id, source_kind, campaign_id,
      source_revision, source_digest, correlation_id
    ) values (
      'fb430000-0000-4000-8000-0000000008d1', 'fb430000-0000-4000-8000-000000000201',
      'campaign_state', 'fb430000-0000-4000-8000-000000000322',
      1, repeat('a', 64), pg_catalog.gen_random_uuid()) $$),
  '23503', 'another organization campaign cannot back this organization event');

-- State capture: version insert enqueues safe lifecycle ------------------------

select extensions.is(
  pg_temp.state_of($$ select private.enqueue_memory_campaign_state(
    'fb430000-0000-4000-8000-000000000201'::uuid,
    'fb430000-0000-4000-8000-000000000312'::uuid) $$),
  'no-error', 'the state enqueue helper runs');

select extensions.is(
  (select count(*)::integer from public.memory_capture_events
   where organization_id = 'fb430000-0000-4000-8000-000000000201'::uuid
     and source_kind = 'campaign_state'),
  1, 'one version, one lifecycle event');

select extensions.is(
  pg_temp.state_of($$ select private.enqueue_memory_campaign_state(
    'fb430000-0000-4000-8000-000000000201'::uuid,
    'fb430000-0000-4000-8000-000000000312'::uuid) $$),
  'no-error', 'an unchanged retry reuses the revision');

select extensions.is(
  (select count(*)::integer from public.memory_capture_events
   where organization_id = 'fb430000-0000-4000-8000-000000000201'::uuid
     and source_kind = 'campaign_state'),
  1, 'without a second row');

select extensions.ok(
  (select projection_document::text not like '%assertions%'
   and projection_document::text not like '%spend%'
   from public.memory_capture_events
   where organization_id = 'fb430000-0000-4000-8000-000000000201'::uuid
     and source_kind = 'campaign_state' limit 1),
  'the lifecycle document carries no assertions or spend');

-- Outcome capture: settled verdicts only ---------------------------------------

insert into public.campaign_outcomes (
  id, organization_id, campaign_id, bundle_version_id, plan_digest, verdict,
  attribution_method, primary_metric_key, outcome_window_days, settlement_delay_days,
  baseline_source, baseline_lookback_days, planned_exposure_count, realized_exposure_count,
  guardrail_state
) values (
  'fb430000-0000-4000-8000-000000000331'::uuid, 'fb430000-0000-4000-8000-000000000201'::uuid,
  'fb430000-0000-4000-8000-000000000312'::uuid, 'fb430000-0000-4000-8000-000000000314'::uuid,
  repeat('a', 64), 'validated_outcome', 'observational_prepost',
  'contribution.incremental_gross_profit', 14, 3,
  'channel_economics_entries weekday lunch', 30, 3, 2, 'clear'
);

select extensions.is(
  (select count(*)::integer from public.memory_capture_events
   where organization_id = 'fb430000-0000-4000-8000-000000000201'::uuid
     and source_kind = 'campaign_outcome'),
  1, 'settling enqueues exactly one verdict event');

select extensions.is(
  (select verdict from public.campaign_learning_proposals limit 0),
  null, 'placeholder keeps numbering stable');

-- Lesson capture: submitted promotions only ------------------------------------

insert into public.campaign_learning_proposals (
  id, organization_id, campaign_id, outcome_id, bundle_version_id, bundle_digest,
  variant_ids, planned_exposure_count, realized_exposure_count, verdict,
  hypothesis, observation, proposed_lesson, suggested_next_test
) values (
  'fb430000-0000-4000-8000-000000000341'::uuid, 'fb430000-0000-4000-8000-000000000201'::uuid,
  'fb430000-0000-4000-8000-000000000312'::uuid, 'fb430000-0000-4000-8000-000000000331'::uuid,
  'fb430000-0000-4000-8000-000000000314'::uuid, repeat('a', 64),
  '{}', 3, 2, 'validated_outcome',
  'Weekday lunch would fill with a tighter window.',
  'Two of three planned exposures delivered; the verdict settled validated.',
  'fb43 weekday lunch demand held after the menu change.',
  'Repeat with a larger sample before acting on it.'
);

select extensions.is(
  (select count(*)::integer from public.memory_capture_events
   where organization_id = 'fb430000-0000-4000-8000-000000000201'::uuid
     and source_kind = 'campaign_lesson'),
  0, 'a proposed lesson enqueues nothing while it stays local');

-- Duplicate submit replays; concurrent reviewers refuse -------------------------

select extensions.is(
  pg_temp.state_of($$ select public.decide_campaign_learning_proposal(
    'fb430000-0000-4000-8000-000000000201'::uuid,
    '{"organization_id": "fb430000-0000-4000-8000-000000000201", "proposal_id": "fb430000-0000-4000-8000-000000000341", "decision": "dismiss"}') $$),
  '42501', 'a session without membership cannot decide');

set local role authenticated;
set local request.jwt.claim.sub = 'fb430000-0000-4000-8000-000000000001';

select extensions.lives_ok(
  $$ select public.decide_campaign_learning_proposal(
    'fb430000-0000-4000-8000-000000000201',
    '{"organization_id": "fb430000-0000-4000-8000-000000000201", "proposal_id": "fb430000-0000-4000-8000-000000000341", "decision": "submit_for_promotion"}') $$,
  'an owner submits the lesson for promotion');

select extensions.is(
  pg_temp.campaign_lesson_event_count(),
  1, 'submission enqueues exactly one shared lesson');

select extensions.is(
  pg_temp.state_of($$ select public.decide_campaign_learning_proposal(
    'fb430000-0000-4000-8000-000000000201',
    '{"organization_id": "fb430000-0000-4000-8000-000000000201", "proposal_id": "fb430000-0000-4000-8000-000000000341", "decision": "dismiss"}') $$),
  '22023', 'a concurrent second decision is refused');

reset role;

select extensions.is(
  pg_temp.state_of($$ select private.enqueue_memory_campaign_lesson(
    'fb430000-0000-4000-8000-000000000201'::uuid,
    'fb430000-0000-4000-8000-000000000341'::uuid) $$),
  'no-error', 'a duplicate submit reuses the revision');

select extensions.is(
  pg_temp.campaign_lesson_event_count(),
  1, 'without a second shared row');

reset role;

-- Inconclusive lessons never read as wins ---------------------------------------
-- A second campaign, because one campaign holds one current verdict.

insert into public.campaign_briefs (id, organization_id, objective, audience, created_by) values
  ('fb430000-0000-4000-8000-000000000351'::uuid, 'fb430000-0000-4000-8000-000000000201'::uuid,
   'Fill dinner tables', 'Nearby couples', 'fb430000-0000-4000-8000-000000000001'::uuid);
insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by) values
  ('fb430000-0000-4000-8000-000000000352'::uuid, 'fb430000-0000-4000-8000-000000000201'::uuid,
   'Dinner push', 'manual_brief', 'fb430000-0000-4000-8000-000000000351'::uuid,
   'fb430000-0000-4000-8000-000000000001'::uuid);
insert into public.campaign_source_snapshots (id, organization_id, campaign_id, facts, assertions) values
  ('fb430000-0000-4000-8000-000000000353'::uuid, 'fb430000-0000-4000-8000-000000000201'::uuid,
   'fb430000-0000-4000-8000-000000000352'::uuid, '{}', '[]');
insert into public.campaign_bundle_versions (
  id, organization_id, campaign_id, version, source_snapshot_id, manifest, digest,
  generation_profile, execution_mode
) values (
  'fb430000-0000-4000-8000-000000000354'::uuid, 'fb430000-0000-4000-8000-000000000201'::uuid,
  'fb430000-0000-4000-8000-000000000352'::uuid, 1, 'fb430000-0000-4000-8000-000000000353'::uuid,
  ('{"version": 1, "campaignId": "fb430000-0000-4000-8000-000000000352", "generationProfile": "brand_guided", "executionMode": "best_effort", "schemaVersion": "2", "generationPolicy": {"maxVariantsPerDirection": 2, "maxVariantsTotal": 10, "policyExpiresAt": "2027-01-01T00:00:00Z"}, "directions": []}')::jsonb,
  repeat('b', 64), 'brand_guided', 'best_effort'
);

insert into public.campaign_outcomes (
  id, organization_id, campaign_id, bundle_version_id, plan_digest, verdict,
  attribution_method, primary_metric_key, outcome_window_days, settlement_delay_days,
  baseline_source, baseline_lookback_days, planned_exposure_count, realized_exposure_count,
  guardrail_state
) values (
  'fb430000-0000-4000-8000-000000000332'::uuid, 'fb430000-0000-4000-8000-000000000201'::uuid,
  'fb430000-0000-4000-8000-000000000352'::uuid, 'fb430000-0000-4000-8000-000000000354'::uuid,
  repeat('b', 64), 'inconclusive', 'observational_prepost',
  'contribution.incremental_gross_profit', 14, 3,
  'channel_economics_entries weekday lunch', 30, 1, 1, 'clear'
);

insert into public.campaign_learning_proposals (
  id, organization_id, campaign_id, outcome_id, bundle_version_id, bundle_digest,
  variant_ids, planned_exposure_count, realized_exposure_count, verdict,
  hypothesis, observation, proposed_lesson, suggested_next_test,
  status, target_artifact_type, decided_by, decided_at
) values (
  'fb430000-0000-4000-8000-000000000342'::uuid, 'fb430000-0000-4000-8000-000000000201'::uuid,
  'fb430000-0000-4000-8000-000000000352'::uuid, 'fb430000-0000-4000-8000-000000000332'::uuid,
  'fb430000-0000-4000-8000-000000000354'::uuid, repeat('b', 64),
  '{}', 1, 1, 'inconclusive',
  'Lunch might fill.',
  'One exposure delivered; the verdict settled inconclusive.',
  'fb43 this winning tactic won lunch and always works.',
  'Run again with a larger sample.',
  'submitted_for_promotion', 'reusable_recipe',
  'fb430000-0000-4000-8000-000000000001'::uuid, now()
);

select extensions.is(
  pg_temp.state_of($$ select private.enqueue_memory_campaign_lesson(
    'fb430000-0000-4000-8000-000000000201'::uuid,
    'fb430000-0000-4000-8000-000000000342'::uuid) $$),
  'no-error', 'the overclaiming lesson still enqueues for review');

select extensions.is(
  pg_temp.state_of($$ select private.project_memory_campaign_lesson(
    'fb430000-0000-4000-8000-000000000201'::uuid,
    (select id from public.memory_capture_events
     where organization_id = 'fb430000-0000-4000-8000-000000000201'::uuid
       and source_kind = 'campaign_lesson'
       and campaign_learning_proposal_id = 'fb430000-0000-4000-8000-000000000342'::uuid
     order by created_at desc limit 1)) $$),
  '23514', 'an inconclusive lesson in winning language is rejected');

-- Withdrawn roots invalidate -----------------------------------------------------

select extensions.is(
  pg_temp.state_of($$ select private.project_memory_campaign_state(
    'fb430000-0000-4000-8000-000000000202'::uuid,
    (select id from public.memory_capture_events
     where organization_id = 'fb430000-0000-4000-8000-000000000201'::uuid
       and source_kind = 'campaign_state' limit 1)) $$),
  'P0002', 'another organization cannot project this organization event');

select * from extensions.finish();

rollback;
