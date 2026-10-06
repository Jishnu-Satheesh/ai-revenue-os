begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(26);

-- Spec 023/024 release 1 close (swarm 1): per-recommendation context provenance.
-- Fixture prefix fb40.

create or replace function pg_temp.state_of(call_sql text)
returns text language plpgsql as $$
begin
  execute call_sql;
  return 'no-error';
exception when others then
  return SQLSTATE;
end;
$$;

-- Structure -------------------------------------------------------------------

select extensions.has_table('public', 'channel_recommendation_contexts', 'provenance is database-owned');
select extensions.has_column('public', 'channel_recommendation_contexts', 'share_mode', 'the run mode travels with the row');
select extensions.has_column('public', 'channel_recommendation_contexts', 'provided_refs', 'provided refs persist');
select extensions.has_column('public', 'channel_recommendation_contexts', 'cited_refs', 'cited refs persist');
select extensions.has_function('public', 'record_channel_recommendation_context', 'worker record exists');
select extensions.ok((select relrowsecurity from pg_catalog.pg_class where relname = 'channel_recommendation_contexts'), 'provenance is RLS-protected');
select extensions.ok((select relforcerowsecurity from pg_catalog.pg_class where relname = 'channel_recommendation_contexts'), 'even from the table owner');
select extensions.ok(pg_catalog.has_function_privilege('service_role', 'public.record_channel_recommendation_context(uuid,uuid,uuid,text,text[],text[])', 'execute'), 'the worker holds record');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated', 'public.record_channel_recommendation_context(uuid,uuid,uuid,text,text[],text[])', 'execute'), 'members do not hold worker record');
select extensions.ok(pg_catalog.has_table_privilege('authenticated', 'public.channel_recommendation_contexts', 'SELECT'), 'members read provenance');

-- Fixtures ---------------------------------------------------------------------

insert into auth.users (id) values
  ('fb400000-0000-4000-8000-000000000001'::uuid),
  ('fb400000-0000-4000-8000-000000000002'::uuid),
  ('fb400000-0000-4000-8000-000000000003'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb400000-0000-4000-8000-000000000101'::uuid, 'Channel A', 'channel-a', 'fb400000-0000-4000-8000-000000000001'::uuid),
  ('fb400000-0000-4000-8000-000000000102'::uuid, 'Channel B', 'channel-b', 'fb400000-0000-4000-8000-000000000003'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb400000-0000-4000-8000-000000000201'::uuid, 'fb400000-0000-4000-8000-000000000101'::uuid, 'Channel A', 'channel-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb400000-0000-4000-8000-000000000001'::uuid),
  ('fb400000-0000-4000-8000-000000000202'::uuid, 'fb400000-0000-4000-8000-000000000102'::uuid, 'Channel B', 'channel-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb400000-0000-4000-8000-000000000003'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb400000-0000-4000-8000-000000000101'::uuid, 'fb400000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('fb400000-0000-4000-8000-000000000101'::uuid, 'fb400000-0000-4000-8000-000000000002'::uuid, 'member', 'operator'),
  ('fb400000-0000-4000-8000-000000000102'::uuid, 'fb400000-0000-4000-8000-000000000003'::uuid, 'owner', 'owner');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('fb400000-0000-4000-8000-000000000201'::uuid, 'fb400000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('fb400000-0000-4000-8000-000000000201'::uuid, 'fb400000-0000-4000-8000-000000000002'::uuid, 'operator'),
  ('fb400000-0000-4000-8000-000000000202'::uuid, 'fb400000-0000-4000-8000-000000000003'::uuid, 'owner');

insert into public.channel_analysis_runs (
  id, organization_id, window_start, window_end, period_grain, window_timezone,
  registry_version, detector_versions, metric_versions, input_digest, status, completed_at,
  result_digest, correlation_id
) values
  ('fb400000-0000-4000-8000-000000000301'::uuid, 'fb400000-0000-4000-8000-000000000201'::uuid,
   '2026-08-01', '2026-08-31', 'day', 'Asia/Dubai', 1, '[{"detectorKey": "kitchen.timing", "version": 1}]',
   '[]', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'completed', now(),
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'fb400000-0000-4000-8000-000000000901'::uuid),
  ('fb400000-0000-4000-8000-000000000302'::uuid, 'fb400000-0000-4000-8000-000000000202'::uuid,
   '2026-08-01', '2026-08-31', 'day', 'Asia/Dubai', 1, '[{"detectorKey": "kitchen.timing", "version": 1}]',
   '[]', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'completed', now(),
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'fb400000-0000-4000-8000-000000000902'::uuid),
  ('fb400000-0000-4000-8000-000000000303'::uuid, 'fb400000-0000-4000-8000-000000000201'::uuid,
   '2026-07-01', '2026-07-31', 'day', 'Asia/Dubai', 1, '[{"detectorKey": "kitchen.timing", "version": 1}]',
   '[]', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'completed', now(),
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'fb400000-0000-4000-8000-000000000903'::uuid);

insert into public.organization_channels (id, organization_id, key, display_name, category, created_by) values
  ('fb400000-0000-4000-8000-000000000210'::uuid, 'fb400000-0000-4000-8000-000000000201'::uuid, 'talabat', 'Talabat', 'marketplace', 'fb400000-0000-4000-8000-000000000001'::uuid),
  ('fb400000-0000-4000-8000-000000000211'::uuid, 'fb400000-0000-4000-8000-000000000202'::uuid, 'talabat', 'Talabat', 'marketplace', 'fb400000-0000-4000-8000-000000000003'::uuid);

insert into public.channel_recommendations (
  id, organization_id, channel_id, analysis_run_id, window_start, window_end, period_grain,
  label, headline, detail, prompt_version, prompt_digest, output_digest, provider, model_id, result_digest
) values
  ('fb400000-0000-4000-8000-000000000311'::uuid, 'fb400000-0000-4000-8000-000000000201'::uuid,
   'fb400000-0000-4000-8000-000000000210'::uuid, 'fb400000-0000-4000-8000-000000000301'::uuid,
   '2026-08-01', '2026-08-31', 'day', 'recommendation', 'Widen the promise window',
   'A promise the kitchen can keep.', 8,
   'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1',
   'e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1e1',
   'google', 'test-model',
   'f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1'),
  ('fb400000-0000-4000-8000-000000000312'::uuid, 'fb400000-0000-4000-8000-000000000201'::uuid,
   'fb400000-0000-4000-8000-000000000210'::uuid, 'fb400000-0000-4000-8000-000000000301'::uuid,
   '2026-08-01', '2026-08-31', 'day', 'observation', 'Late plates were recorded',
   'The report shows late plates.', 8,
   'd2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2',
   'e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2e2',
   'google', 'test-model',
   'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2'),
  ('fb400000-0000-4000-8000-000000000313'::uuid, 'fb400000-0000-4000-8000-000000000202'::uuid,
   'fb400000-0000-4000-8000-000000000211'::uuid, 'fb400000-0000-4000-8000-000000000302'::uuid,
   '2026-08-01', '2026-08-31', 'day', 'recommendation', 'Widen the promise window',
   'A promise the kitchen can keep.', 8,
   'd3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3',
   'e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3e3',
   'google', 'test-model',
   'f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3'),
  ('fb400000-0000-4000-8000-000000000314'::uuid, 'fb400000-0000-4000-8000-000000000201'::uuid,
   'fb400000-0000-4000-8000-000000000210'::uuid, 'fb400000-0000-4000-8000-000000000301'::uuid,
   '2026-08-01', '2026-08-31', 'day', 'recommendation', 'Staff the dinner rush',
   'Two riders cover the peak.', 8,
   'd4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4',
   'e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4',
   'google', 'test-model',
   'f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4'),
  ('fb400000-0000-4000-8000-000000000315'::uuid, 'fb400000-0000-4000-8000-000000000201'::uuid,
   'fb400000-0000-4000-8000-000000000210'::uuid, 'fb400000-0000-4000-8000-000000000301'::uuid,
   '2026-08-01', '2026-08-31', 'day', 'recommendation', 'Review the funnel together',
   'One shared action covers both.', 8,
   'd5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5d5',
   'e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5',
   'google', 'test-model',
   'f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5f5'),
  ('fb400000-0000-4000-8000-000000000316'::uuid, 'fb400000-0000-4000-8000-000000000201'::uuid,
   'fb400000-0000-4000-8000-000000000210'::uuid, 'fb400000-0000-4000-8000-000000000301'::uuid,
   '2026-08-01', '2026-08-31', 'day', 'observation', 'The mix held steady',
   'Nothing new to report.', 8,
   'd6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6d6',
   'e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6',
   'google', 'test-model',
   'f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6');

insert into public.memory_context_manifests (
  id, organization_id, purpose, policy_version, context_digest, correlation_id,
  status, analysis_run_id, attempt_key
) values
  ('fb400000-0000-4000-8000-000000000321'::uuid, 'fb400000-0000-4000-8000-000000000201'::uuid,
   'channel_advice', 'shared-context-v1',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'fb400000-0000-4000-8000-000000000904'::uuid, 'ready',
   'fb400000-0000-4000-8000-000000000301'::uuid, 'fb40-attempt-1'),
  ('fb400000-0000-4000-8000-000000000322'::uuid, 'fb400000-0000-4000-8000-000000000202'::uuid,
   'channel_advice', 'shared-context-v1',
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'fb400000-0000-4000-8000-000000000905'::uuid, 'ready',
   'fb400000-0000-4000-8000-000000000302'::uuid, 'fb40-attempt-b'),
  ('fb400000-0000-4000-8000-000000000323'::uuid, 'fb400000-0000-4000-8000-000000000201'::uuid,
   'channel_advice', 'shared-context-v1',
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'fb400000-0000-4000-8000-000000000906'::uuid, 'ready',
   'fb400000-0000-4000-8000-000000000303'::uuid, 'fb40-attempt-other-run');

insert into public.memory_context_entries (
  organization_id, manifest_id, ordinal, context_ref, source_kind, business_fact_id,
  statement_kind, trust_rank, freshness, sensitivity, safe_snapshot
) values
  ('fb400000-0000-4000-8000-000000000201'::uuid, 'fb400000-0000-4000-8000-000000000321'::uuid,
   1, 'ctx-0001', 'business_fact', 'fb400000-0000-4000-8000-000000000399'::uuid,
   'observation', 0, 'fresh', 'internal', '{"title": "Average ticket", "summary": "avg_ticket [verified] pos :: 42"}'),
  ('fb400000-0000-4000-8000-000000000201'::uuid, 'fb400000-0000-4000-8000-000000000321'::uuid,
   2, 'ctx-0002', 'business_fact', 'fb400000-0000-4000-8000-000000000398'::uuid,
   'observation', 1, 'fresh', 'internal', '{"title": "Dinner mix", "summary": "dinner [verified] pos :: family"}'),
  ('fb400000-0000-4000-8000-000000000202'::uuid, 'fb400000-0000-4000-8000-000000000322'::uuid,
   1, 'ctx-0001', 'business_fact', 'fb400000-0000-4000-8000-000000000397'::uuid,
   'observation', 0, 'fresh', 'internal', '{"title": "Other tenant fact", "summary": "other [verified] pos :: 1"}');

-- Record: happy paths ------------------------------------------------------------

select extensions.is(
  (select public.record_channel_recommendation_context(
    'fb400000-0000-4000-8000-000000000201', 'fb400000-0000-4000-8000-000000000311',
    'fb400000-0000-4000-8000-000000000321', 'grounded_share',
    array['ctx-0001', 'ctx-0002'], array['ctx-0001']
  ) ->> 'shareMode'),
  'grounded_share', 'a shared run records its mode');
select extensions.is(
  (select public.record_channel_recommendation_context(
    'fb400000-0000-4000-8000-000000000201', 'fb400000-0000-4000-8000-000000000311',
    'fb400000-0000-4000-8000-000000000321', 'grounded_share',
    array['ctx-0001', 'ctx-0002'], array['ctx-0001']
  ) ->> 'replayed'),
  'true', 'a same-recommendation retry replays the pinned row');
select extensions.is(
  (select provided_refs from public.channel_recommendation_contexts
   where organization_id = 'fb400000-0000-4000-8000-000000000201'
     and recommendation_id = 'fb400000-0000-4000-8000-000000000311'),
  array['ctx-0001', 'ctx-0002'], 'provided refs persist exactly');
select extensions.is(
  pg_temp.state_of($$ select public.record_channel_recommendation_context(
    'fb400000-0000-4000-8000-000000000201', 'fb400000-0000-4000-8000-000000000311',
    'fb400000-0000-4000-8000-000000000321', 'grounded_share',
    array['ctx-0001', 'ctx-0002'], array['ctx-0001', 'ctx-0002']) $$),
  '23505', 'a conflicting provenance claim is refused, never overwritten');
select extensions.is(
  (select public.record_channel_recommendation_context(
    'fb400000-0000-4000-8000-000000000201', 'fb400000-0000-4000-8000-000000000312',
    'fb400000-0000-4000-8000-000000000321', 'internal_only',
    array[]::text[], array[]::text[]
  ) ->> 'shareMode'),
  'internal_only', 'an internal-only run records with no refs');

-- Record: refusals -----------------------------------------------------------------

select extensions.is(
  pg_temp.state_of($$ select public.record_channel_recommendation_context(
    'fb400000-0000-4000-8000-000000000201', 'fb400000-0000-4000-8000-000000000316',
    'fb400000-0000-4000-8000-000000000321', 'internal_only',
    array['ctx-0001'], array[]::text[]) $$),
  '23514', 'internal-only with refs is refused');
select extensions.is(
  pg_temp.state_of($$ select public.record_channel_recommendation_context(
    'fb400000-0000-4000-8000-000000000201', 'fb400000-0000-4000-8000-000000000314',
    'fb400000-0000-4000-8000-000000000321', 'grounded_share',
    array['ctx-9999'], array[]::text[]) $$),
  '23514', 'a caller-invented ref is refused, never stored');
select extensions.is(
  pg_temp.state_of($$ select public.record_channel_recommendation_context(
    'fb400000-0000-4000-8000-000000000201', 'fb400000-0000-4000-8000-000000000315',
    'fb400000-0000-4000-8000-000000000321', 'grounded_share',
    array['ctx-0001'], array['ctx-0002']) $$),
  '23514', 'citing something never provided is refused');
select extensions.is(
  pg_temp.state_of($$ select public.record_channel_recommendation_context(
    'fb400000-0000-4000-8000-000000000201', 'fb400000-0000-4000-8000-000000000311',
    'fb400000-0000-4000-8000-000000000323', 'grounded_share',
    array[]::text[], array[]::text[]) $$),
  '42501', 'a manifest from another run is refused');
select extensions.is(
  pg_temp.state_of($$ select public.record_channel_recommendation_context(
    'fb400000-0000-4000-8000-000000000201', 'fb400000-0000-4000-8000-000000000311',
    'fb400000-0000-4000-8000-000000000322', 'grounded_share',
    array['ctx-0001'], array[]::text[]) $$),
  'P0002', 'a manifest from another tenant is not found');
select extensions.is(
  pg_temp.state_of($$ select public.record_channel_recommendation_context(
    'fb400000-0000-4000-8000-000000000201', 'fb400000-0000-4000-8000-000000000399',
    'fb400000-0000-4000-8000-000000000321', 'grounded_share',
    array['ctx-0001'], array[]::text[]) $$),
  'P0002', 'an unknown recommendation is not found');
select extensions.is(
  pg_temp.state_of($$ select public.record_channel_recommendation_context(
    'fb400000-0000-4000-8000-000000000201', 'fb400000-0000-4000-8000-000000000315',
    'fb400000-0000-4000-8000-000000000399', 'grounded_share',
    array['ctx-0001'], array[]::text[]) $$),
  'P0002', 'an unknown manifest is not found');

-- Session paths: RPC-only writes, member reads --------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'fb400000-0000-4000-8000-000000000001';
select extensions.is(
  pg_temp.state_of($$ insert into public.channel_recommendation_contexts (
    organization_id, recommendation_id, manifest_id, share_mode, provided_refs, cited_refs
  ) values (
    'fb400000-0000-4000-8000-000000000201', 'fb400000-0000-4000-8000-000000000314',
    'fb400000-0000-4000-8000-000000000321', 'grounded_share',
    array['ctx-0001'], array[]::text[]) $$),
  '42501', 'even an owner cannot write provenance by hand');
select extensions.is(
  (select pg_catalog.count(*)::integer from public.channel_recommendation_contexts
   where organization_id = 'fb400000-0000-4000-8000-000000000201'),
  2, 'a member reads exactly their own organization rows');
reset role;

select extensions.is(
  pg_temp.state_of($$ update public.channel_recommendation_contexts
    set share_mode = 'internal_only'
    where organization_id = 'fb400000-0000-4000-8000-000000000201'
      and recommendation_id = 'fb400000-0000-4000-8000-000000000311' $$),
  '23514', 'provenance cannot be silently rewritten');
select extensions.is(
  pg_temp.state_of($$ delete from public.channel_recommendation_contexts
    where organization_id = 'fb400000-0000-4000-8000-000000000201'
      and recommendation_id = 'fb400000-0000-4000-8000-000000000311' $$),
  '23514', 'provenance cannot be silently deleted');

select * from extensions.finish();

rollback;
