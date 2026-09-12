begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(14);

-- Spec 023 Swarm 4: campaign generation context usage.
-- The pinned manifest travels with the claimed run; only its digest travels
-- forward. Fixture prefix fb43.

create or replace function pg_temp.state_of(call_sql text)
returns text language plpgsql as $$
begin
  execute call_sql;
  return 'no-error';
exception when others then
  return SQLSTATE;
end;
$$;

insert into auth.users (id) values
  ('fb430000-0000-4000-8000-000000000011'::uuid),
  ('fb430000-0000-4000-8000-000000000012'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb430000-0000-4000-8000-000000000111'::uuid, 'Campaign context A', 'campaign-context-a', 'fb430000-0000-4000-8000-000000000011'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb430000-0000-4000-8000-000000000211'::uuid, 'fb430000-0000-4000-8000-000000000111'::uuid, 'Campaign context A', 'campaign-context-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb430000-0000-4000-8000-000000000011'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb430000-0000-4000-8000-000000000111'::uuid, 'fb430000-0000-4000-8000-000000000011'::uuid, 'owner', 'owner');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('fb430000-0000-4000-8000-000000000211'::uuid, 'fb430000-0000-4000-8000-000000000011'::uuid, 'owner');

insert into public.memory_integration_settings (organization_id, capture_enabled, campaign_context_enabled) values
  ('fb430000-0000-4000-8000-000000000211'::uuid, true, true);

insert into public.campaign_briefs (id, organization_id, objective, audience, created_by) values
  ('fb430000-0000-4000-8000-000000000361'::uuid, 'fb430000-0000-4000-8000-000000000211'::uuid,
   'Fill weekday tables', 'Nearby families', 'fb430000-0000-4000-8000-000000000011'::uuid);
insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by) values
  ('fb430000-0000-4000-8000-000000000362'::uuid, 'fb430000-0000-4000-8000-000000000211'::uuid,
   'Weekday push', 'manual_brief', 'fb430000-0000-4000-8000-000000000361'::uuid,
   'fb430000-0000-4000-8000-000000000011'::uuid);
insert into public.campaign_source_snapshots (id, organization_id, campaign_id, facts, assertions) values
  ('fb430000-0000-4000-8000-000000000363'::uuid, 'fb430000-0000-4000-8000-000000000211'::uuid,
   'fb430000-0000-4000-8000-000000000362'::uuid, '{}', '[]');
insert into public.campaign_generation_runs (
  id, organization_id, campaign_id, source_snapshot_id, kind, idempotency_key,
  request_digest, correlation_id
) values (
  'fb430000-0000-4000-8000-000000000365'::uuid, 'fb430000-0000-4000-8000-000000000211'::uuid,
  'fb430000-0000-4000-8000-000000000362'::uuid, 'fb430000-0000-4000-8000-000000000363'::uuid,
  'generate', 'fb43-gen-1',
  repeat('1', 64),
  'fb430000-0000-4000-8000-000000000367'::uuid
);

-- The loader exists and stays worker-only ---------------------------------------

select extensions.has_function(
  'public', 'load_campaign_generation_context',
  'the generation context loader exists');

select extensions.is(
  (select pg_catalog.has_function_privilege('service_role', 'public.load_campaign_generation_context(uuid,jsonb)', 'execute')),
  true, 'the worker holds the loader');
select extensions.is(
  (select pg_catalog.has_function_privilege('authenticated', 'public.load_campaign_generation_context(uuid,jsonb)', 'execute')),
  false, 'members do not hold the loader');

-- Without a pinned manifest the context fields stay null -------------------------

set local role service_role;

select extensions.is(
  (select public.claim_campaign_generation_run(
    'fb430000-0000-4000-8000-000000000211'::uuid,
    '{"organization_id": "fb430000-0000-4000-8000-000000000211", "run_id": "fb430000-0000-4000-8000-000000000365", "lease_seconds": 300}'::jsonb
  ) ->> 'outcome'),
  'claimed', 'the run claims');

select extensions.is(
  (select (public.load_campaign_generation_context(
    'fb430000-0000-4000-8000-000000000211'::uuid,
    ('{"run_id": "fb430000-0000-4000-8000-000000000365", "claim_token": "' ||
      (select claim_token::text from public.campaign_generation_runs
       where id = 'fb430000-0000-4000-8000-000000000365') || '"}')::jsonb
  ) ->> 'campaign_id')),
  'fb430000-0000-4000-8000-000000000362', 'the loader returns the claimed campaign');

select extensions.is(
  (select (public.load_campaign_generation_context(
    'fb430000-0000-4000-8000-000000000211'::uuid,
    ('{"run_id": "fb430000-0000-4000-8000-000000000365", "claim_token": "' ||
      (select claim_token::text from public.campaign_generation_runs
       where id = 'fb430000-0000-4000-8000-000000000365') || '"}')::jsonb
  ) ->> 'context_manifest_id') is null),
  true, 'with no pinned pack the manifest stays null');

select extensions.is(
  (select (public.load_campaign_generation_context(
    'fb430000-0000-4000-8000-000000000211'::uuid,
    ('{"run_id": "fb430000-0000-4000-8000-000000000365", "claim_token": "' ||
      (select claim_token::text from public.campaign_generation_runs
       where id = 'fb430000-0000-4000-8000-000000000365') || '"}')::jsonb
  ) ->> 'context_digest') is null),
  true, 'and so does the digest');

-- A pinned pack travels by id and digest, never by bytes --------------------------

select extensions.is(
  (select public.prepare_memory_context(
    'fb430000-0000-4000-8000-000000000211', 'campaign_generation', 'campaign_generation_run',
    'fb430000-0000-4000-8000-000000000365', 'fb43-attempt-1',
    'fb430000-0000-4000-8000-000000000368', null, null, 'fb430000-0000-4000-8000-000000000362',
    'shared-context-v1', '[]'::jsonb, null
  ) ->> 'status'),
  'empty', 'an empty pack still pins a manifest for the run');

select extensions.is(
  (select (public.load_campaign_generation_context(
    'fb430000-0000-4000-8000-000000000211'::uuid,
    ('{"run_id": "fb430000-0000-4000-8000-000000000365", "claim_token": "' ||
      (select claim_token::text from public.campaign_generation_runs
       where id = 'fb430000-0000-4000-8000-000000000365') || '"}')::jsonb
  ) ->> 'context_manifest_id') is not null),
  true, 'the pinned manifest id travels with the claimed run');

select extensions.is(
  pg_temp.state_of($$ select public.load_campaign_generation_context(
    'fb430000-0000-4000-8000-000000000211'::uuid,
    '{"run_id": "fb430000-0000-4000-8000-000000000365", "claim_token": "00000000-0000-4000-8000-000000000000"}') $$),
  '42501', 'a lapsed claim token reads nothing');

-- Revalidation is a new bounded attempt, never a silent swap -----------------------

select extensions.is(
  (select public.revalidate_memory_context(
    'fb430000-0000-4000-8000-000000000211',
    (select id from public.memory_context_manifests where attempt_key = 'fb43-attempt-1')
  ) ->> 'status'),
  'valid', 'an unchanged pack revalidates valid');

select extensions.is(
  (select count(*)::integer from public.memory_context_manifests
   where campaign_generation_run_id = 'fb430000-0000-4000-8000-000000000365'),
  1, 'one run, one pinned pack');

select extensions.is(
  pg_temp.state_of($$ select public.consume_memory_context(
    'fb430000-0000-4000-8000-000000000211',
    (select id from public.memory_context_manifests where attempt_key = 'fb43-attempt-1'),
    'test-provider', 'test-model', now()) $$),
  'no-error', 'consume binds provider and model');

select extensions.is(
  pg_temp.state_of($$ select public.consume_memory_context(
    'fb430000-0000-4000-8000-000000000211',
    (select id from public.memory_context_manifests where attempt_key = 'fb43-attempt-1'),
    'test-provider', 'test-model', now()) $$),
  '23505', 'a second consume is refused, never double-bound');

reset role;

select * from extensions.finish();

rollback;
