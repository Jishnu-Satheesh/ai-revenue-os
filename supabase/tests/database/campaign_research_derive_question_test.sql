begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(14);

-- Covers `20260916140000_campaign_research_derive_question.sql`.
--
-- The worker plans the real research question from the admitted context and
-- saves it back onto its run exactly once, under a live claim. The save is a
-- worker write like any other: a live claim on the run in this organization,
-- or nothing happens. A second save is not an error and rewrites nothing; it
-- reports `already_set` so a retried worker learns the question is there.
-- The durable event carries identifiers only — the run and the derivation —
-- never a second copy of the question.

select extensions.has_function(
  'public', 'save_derived_campaign_research_question', array['uuid', 'jsonb'],
  'the worker saves its derived question through a governed writer'
);

select extensions.ok(
  has_function_privilege('service_role', 'public.save_derived_campaign_research_question(uuid, jsonb)', 'EXECUTE'),
  'the worker may save its derived question'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.save_derived_campaign_research_question(uuid, jsonb)', 'EXECUTE'),
  'no signed-in member saves a worker-derived question'
);

-- ---------------------------------------------------------------------------
-- Fixtures: two tenants, one claimed run with a live lease in A.
-- ---------------------------------------------------------------------------

insert into auth.users (id) values
  ('dd000001-0000-4000-8000-000000000001'::uuid),
  ('dd000001-0000-4000-8000-000000000002'::uuid);

insert into public.accounts (id, name, slug, created_by) values (
  'ddac0001-0000-4000-8000-000000000001'::uuid,
  'Derive question account', 'derive-question-account',
  'dd000001-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
) values
  ('dd000001-0000-4000-8000-000000000101'::uuid, 'Derive A', 'derive-a',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'dd000001-0000-4000-8000-000000000001'::uuid,
   'ddac0001-0000-4000-8000-000000000001'::uuid),
  ('dd000001-0000-4000-8000-000000000102'::uuid, 'Derive B', 'derive-b',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'dd000001-0000-4000-8000-000000000002'::uuid,
   'ddac0001-0000-4000-8000-000000000001'::uuid);

insert into public.campaign_research_policies (
  id, organization_id, version, enabled, schedule_timezone,
  evidence_qualification_rule_version, evidence_max_age_days, cooldown_seconds,
  max_pending_proposals, max_attempts, per_run_allowance_minor,
  window_allowance_minor, allowance_currency, window_days, created_by
) values
  ('ddb00001-0000-4000-8000-000000000001'::uuid,
   'dd000001-0000-4000-8000-000000000101'::uuid, 1, true, 'Asia/Dubai',
   'evidence-qualification@2', 30, 0, 5, 3, 5000, 20000, 'AED', 30,
   'dd000001-0000-4000-8000-000000000001'::uuid),
  ('ddb00001-0000-4000-8000-000000000002'::uuid,
   'dd000001-0000-4000-8000-000000000102'::uuid, 1, true, 'Asia/Dubai',
   'evidence-qualification@2', 30, 0, 5, 3, 5000, 20000, 'AED', 30,
   'dd000001-0000-4000-8000-000000000002'::uuid);

insert into public.campaign_research_runs (
  id, organization_id, trigger_kind, policy_version, status, claim_token,
  lease_expires_at, idempotency_key, request_digest, budget_minor,
  allowance_currency, started_at
) values (
  'ddf00001-0000-4000-8000-00000000000a'::uuid,
  'dd000001-0000-4000-8000-000000000101'::uuid, 'manual_request', 1, 'claimed',
  'dcc00001-0000-4000-8000-00000000000a'::uuid, now() + interval '15 minutes',
  'derive-question-run', repeat('a', 64), 0, 'AED', now()
);

create temporary table derive_state (key text primary key, value jsonb not null);
grant select, insert on derive_state to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The saved path: one live claim writes the question and leaves one event.
-- ---------------------------------------------------------------------------

set local role service_role;
set local request.jwt.claim.sub = '';

insert into derive_state (key, value)
select 'saved', public.save_derived_campaign_research_question(
  'dd000001-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'run_id', 'ddf00001-0000-4000-8000-00000000000a',
    'claim_token', 'dcc00001-0000-4000-8000-00000000000a',
    'derived_question', 'why did weekday lunch soften?',
    'derivation', jsonb_build_object(
      'source_ids', jsonb_build_array('sig-weekday-lunch', 'sig-weekend-brunch'),
      'model_id', 'derive-model@1',
      'derived_at', now()::text
    )
  )
);

select extensions.is(
  (select value ->> 'outcome' from derive_state where key = 'saved'),
  'saved',
  'a live claim saves the derived question'
);

select extensions.is(
  (select research_question from public.campaign_research_runs
   where id = 'ddf00001-0000-4000-8000-00000000000a'::uuid),
  'why did weekday lunch soften?',
  'the question lands on the run row'
);

select extensions.ok(
  exists (
    select 1 from public.campaign_research_events event
    where event.run_id = 'ddf00001-0000-4000-8000-00000000000a'::uuid
      and event.event = 'campaign.research_question_derived'
  ),
  'the save leaves a durable derived event'
);

select extensions.ok(
  (select payload ?& array['run_id', 'derivation']
   from public.campaign_research_events event
   where event.run_id = 'ddf00001-0000-4000-8000-00000000000a'::uuid
     and event.event = 'campaign.research_question_derived'),
  'the derived event carries the run and the derivation'
);

select extensions.ok(
  not (select payload ?| array['derived_question', 'research_question']
   from public.campaign_research_events event
   where event.run_id = 'ddf00001-0000-4000-8000-00000000000a'::uuid
     and event.event = 'campaign.research_question_derived'),
  'the derived event duplicates no business text'
);

-- ---------------------------------------------------------------------------
-- The already-set path: a second save rewrites nothing.
-- ---------------------------------------------------------------------------

insert into derive_state (key, value)
select 'again', public.save_derived_campaign_research_question(
  'dd000001-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'run_id', 'ddf00001-0000-4000-8000-00000000000a',
    'claim_token', 'dcc00001-0000-4000-8000-00000000000a',
    'derived_question', 'a different question?',
    'derivation', jsonb_build_object(
      'source_ids', jsonb_build_array('sig-other'),
      'model_id', 'derive-model@1',
      'derived_at', now()::text
    )
  )
);

select extensions.is(
  (select value ->> 'outcome' from derive_state where key = 'again'),
  'already_set',
  'a second save under a live claim rewrites nothing'
);

select extensions.is(
  (select research_question from public.campaign_research_runs
   where id = 'ddf00001-0000-4000-8000-00000000000a'::uuid),
  'why did weekday lunch soften?',
  'and the first question stands'
);

-- ---------------------------------------------------------------------------
-- Refusals: a lost claim, a malformed save, another tenant's run.
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  $$select public.save_derived_campaign_research_question(
      'dd000001-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'run_id', 'ddf00001-0000-4000-8000-00000000000a',
        'claim_token', '00000000-0000-4000-8000-000000000000',
        'derived_question', 'why did weekday lunch soften?',
        'derivation', jsonb_build_object(
          'source_ids', jsonb_build_array('sig-weekday-lunch'),
          'model_id', 'derive-model@1',
          'derived_at', now()::text
        )
      ))$$,
  'P0002',
  'campaign_research_claim_lost',
  'a wrong claim token saves nothing'
);

select extensions.throws_ok(
  $$select public.save_derived_campaign_research_question(
      'dd000001-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'run_id', 'ddf00001-0000-4000-8000-00000000000a',
        'claim_token', 'dcc00001-0000-4000-8000-00000000000a',
        'derived_question', '',
        'derivation', jsonb_build_object(
          'source_ids', jsonb_build_array('sig-weekday-lunch'),
          'model_id', 'derive-model@1',
          'derived_at', now()::text
        )
      ))$$,
  '22023',
  'campaign_research_invalid',
  'an empty question admits nothing'
);

select extensions.throws_ok(
  $$select public.save_derived_campaign_research_question(
      'dd000001-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'run_id', 'ddf00001-0000-4000-8000-00000000000a',
        'claim_token', 'dcc00001-0000-4000-8000-00000000000a',
        'derived_question', 'why did weekday lunch soften?',
        'derivation', jsonb_build_object('model_id', 'derive-model@1')
      ))$$,
  '22023',
  'campaign_research_invalid',
  'a derivation without source ids admits nothing'
);

select extensions.throws_ok(
  $$select public.save_derived_campaign_research_question(
      'dd000001-0000-4000-8000-000000000102'::uuid,
      jsonb_build_object(
        'run_id', 'ddf00001-0000-4000-8000-00000000000a',
        'claim_token', 'dcc00001-0000-4000-8000-00000000000a',
        'derived_question', 'why did weekday lunch soften?',
        'derivation', jsonb_build_object(
          'source_ids', jsonb_build_array('sig-weekday-lunch'),
          'model_id', 'derive-model@1',
          'derived_at', now()::text
        )
      ))$$,
  'P0002',
  'campaign_research_claim_lost',
  'a claim is good only in the organization that admitted it'
);

select * from extensions.finish();

rollback;
