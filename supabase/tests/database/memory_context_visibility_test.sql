begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(22);

-- Spec 023 Task C: RLS + API-shape reads. Withdrawn sources hide snapshots
-- (ids/digests survive where retention allows), revoked membership hides,
-- sensitive roots never reach operator paths, worker paths stay service-only.

create or replace function pg_temp.state_of(call_sql text)
returns text language plpgsql as $$
begin
  execute call_sql;
  return 'no-error';
exception when others then
  return SQLSTATE;
end;
$$;

-- Grants and policies ---------------------------------------------------------------

select extensions.is(
  (select pg_catalog.count(*)::integer from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'memory_context_manifests'
     and policyname = 'members read context manifests'),
  1, 'manifests carry the member-read policy');
select extensions.is(
  (select pg_catalog.count(*)::integer from pg_catalog.pg_policies
   where schemaname = 'public' and tablename = 'memory_context_entries'
     and policyname = 'members read context entries'),
  1, 'entries carry the member-read policy');
select extensions.ok(pg_catalog.has_table_privilege('authenticated', 'public.memory_context_manifests', 'select'), 'members hold manifest select');
select extensions.ok(pg_catalog.has_table_privilege('authenticated', 'public.memory_context_entries', 'select'), 'members hold entry select');
select extensions.ok(not pg_catalog.has_table_privilege('anon', 'public.memory_context_manifests', 'select'), 'anonymous callers hold no manifest select');
select extensions.ok(not pg_catalog.has_table_privilege('anon', 'public.memory_context_entries', 'select'), 'anonymous callers hold no entry select');

-- Fixtures -----------------------------------------------------------------------

insert into auth.users (id) values
  ('fb390000-0000-4000-8000-000000000011'::uuid),
  ('fb390000-0000-4000-8000-000000000012'::uuid),
  ('fb390000-0000-4000-8000-000000000013'::uuid),
  ('fb390000-0000-4000-8000-000000000014'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb390000-0000-4000-8000-000000000111'::uuid, 'Visibility A', 'visibility-a', 'fb390000-0000-4000-8000-000000000011'::uuid),
  ('fb390000-0000-4000-8000-000000000112'::uuid, 'Visibility B', 'visibility-b', 'fb390000-0000-4000-8000-000000000014'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb390000-0000-4000-8000-000000000211'::uuid, 'fb390000-0000-4000-8000-000000000111'::uuid, 'Visibility A', 'visibility-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb390000-0000-4000-8000-000000000011'::uuid),
  ('fb390000-0000-4000-8000-000000000212'::uuid, 'fb390000-0000-4000-8000-000000000112'::uuid, 'Visibility B', 'visibility-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb390000-0000-4000-8000-000000000014'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb390000-0000-4000-8000-000000000111'::uuid, 'fb390000-0000-4000-8000-000000000011'::uuid, 'owner', 'owner'),
  ('fb390000-0000-4000-8000-000000000111'::uuid, 'fb390000-0000-4000-8000-000000000012'::uuid, 'member', 'operator'),
  ('fb390000-0000-4000-8000-000000000112'::uuid, 'fb390000-0000-4000-8000-000000000014'::uuid, 'owner', 'owner');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('fb390000-0000-4000-8000-000000000211'::uuid, 'fb390000-0000-4000-8000-000000000011'::uuid, 'owner'),
  ('fb390000-0000-4000-8000-000000000211'::uuid, 'fb390000-0000-4000-8000-000000000012'::uuid, 'operator'),
  ('fb390000-0000-4000-8000-000000000212'::uuid, 'fb390000-0000-4000-8000-000000000014'::uuid, 'owner');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb390000-0000-4000-8000-000000000011';
select public.update_memory_integration_settings('fb390000-0000-4000-8000-000000000211', 'fb390000-0000-4000-8000-000000000011', true, true, true, true, true, false, 'shared-context-v1', 'fb390000-0000-4000-8000-000000000931');

reset role;

insert into public.channel_analysis_runs (
  id, organization_id, window_start, window_end, period_grain, window_timezone,
  registry_version, detector_versions, metric_versions, input_digest, status, completed_at,
  result_digest, correlation_id
) values (
  'fb390000-0000-4000-8000-000000000381'::uuid, 'fb390000-0000-4000-8000-000000000211'::uuid,
  '2026-08-01', '2026-08-31', 'day', 'Asia/Dubai', 1, '[{"detectorKey": "kitchen.timing", "version": 1}]',
  '[]', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'completed', now(),
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'fb390000-0000-4000-8000-000000000932'::uuid
);
insert into public.memory_items (id, organization_id, memory_type, title, body, origin, knowledge_kind) values
  ('fb390000-0000-4000-8000-000000000391'::uuid, 'fb390000-0000-4000-8000-000000000211'::uuid,
   'episode', 'Visible note', 'Safe for members.', 'system_generated', 'observation'),
  ('fb390000-0000-4000-8000-000000000392'::uuid, 'fb390000-0000-4000-8000-000000000211'::uuid,
   'episode', 'Secret note', 'Owner eyes only.', 'system_generated', 'observation');
update public.memory_items set sensitivity = 'confidential'
where id = 'fb390000-0000-4000-8000-000000000392';

select public.prepare_memory_context(
  'fb390000-0000-4000-8000-000000000211', 'channel_advice', 'analysis_run',
  'fb390000-0000-4000-8000-000000000381', 'fb39-visibility',
  'fb390000-0000-4000-8000-000000000933', null, null, null,
  'shared-context-v1',
  ('[' ||
    '{"sourceKind": "memory_item", "sourceId": "fb390000-0000-4000-8000-000000000391", "title": "Visible note", "summary": "Visible note\nSafe for members.", "priority": 0, "optional": true, "section": "observations", "statementKind": "observation", "trustRank": 2, "freshness": "fresh", "sensitivity": "internal"},' ||
    '{"sourceKind": "memory_item", "sourceId": "fb390000-0000-4000-8000-000000000392", "title": "Secret note", "summary": "Secret note\nOwner eyes only.", "priority": 0, "optional": true, "section": "observations", "statementKind": "observation", "trustRank": 2, "freshness": "fresh", "sensitivity": "internal"}' ||
  ']')::jsonb,
  null
);

-- Member reads ----------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'fb390000-0000-4000-8000-000000000011';
select extensions.is(
  (select pg_catalog.count(*)::integer from public.memory_context_manifests
   where organization_id = 'fb390000-0000-4000-8000-000000000211'),
  1, 'the owner reads the pinned manifest');
select extensions.is(
  (select pg_catalog.count(*)::integer from public.memory_context_entries
   where organization_id = 'fb390000-0000-4000-8000-000000000211'),
  1, 'the owner reads one safe entry, never the sensitive root');

set local request.jwt.claim.sub = 'fb390000-0000-4000-8000-000000000012';
select extensions.is(
  (select pg_catalog.count(*)::integer from public.memory_context_manifests
   where organization_id = 'fb390000-0000-4000-8000-000000000211'),
  1, 'an operator reads the manifest');
select extensions.is(
  (select safe_snapshot ->> 'summary' from public.memory_context_entries
   where organization_id = 'fb390000-0000-4000-8000-000000000211'),
  'Visible note' || chr(10) || 'Safe for members.', 'an operator sees the safe snapshot only');
select extensions.is(
  (select pg_catalog.count(*)::integer from public.memory_context_entries
   where organization_id = 'fb390000-0000-4000-8000-000000000211'
     and safe_snapshot ->> 'summary' like '%Owner eyes only%'),
  0, 'sensitive roots never reach operator paths');

-- Outsiders and revoked members see nothing ----------------------------------------------
set local request.jwt.claim.sub = 'fb390000-0000-4000-8000-000000000013';
select extensions.is(
  (select pg_catalog.count(*)::integer from public.memory_context_manifests
   where organization_id = 'fb390000-0000-4000-8000-000000000211'),
  0, 'an outsider reads no manifests');
select extensions.is(
  (select pg_catalog.count(*)::integer from public.memory_context_entries
   where organization_id = 'fb390000-0000-4000-8000-000000000211'),
  0, 'an outsider reads no entries');

set local request.jwt.claim.sub = 'fb390000-0000-4000-8000-000000000014';
select extensions.is(
  (select pg_catalog.count(*)::integer from public.memory_context_manifests
   where organization_id = 'fb390000-0000-4000-8000-000000000211'),
  0, 'a member of another tenant reads no manifests');

reset role;
-- Revoke fully: the platform resolves access as a union of grants (ADR 0022),
-- so the account-level default role would keep granting org access after the
-- org override row alone is deleted. Both rows go.
delete from public.organization_memberships
where organization_id = 'fb390000-0000-4000-8000-000000000211'
  and user_id = 'fb390000-0000-4000-8000-000000000012';
delete from public.account_memberships
where account_id = 'fb390000-0000-4000-8000-000000000111'
  and user_id = 'fb390000-0000-4000-8000-000000000012';
set local role authenticated;
set local request.jwt.claim.sub = 'fb390000-0000-4000-8000-000000000012';
select extensions.is(
  (select pg_catalog.count(*)::integer from public.memory_context_manifests
   where organization_id = 'fb390000-0000-4000-8000-000000000211'),
  0, 'a revoked membership hides manifests');
select extensions.is(
  (select pg_catalog.count(*)::integer from public.memory_context_entries
   where organization_id = 'fb390000-0000-4000-8000-000000000211'),
  0, 'a revoked membership hides entries');

-- Withdrawal hides content, keeps ids and digests --------------------------------------------
-- reset role alone keeps the earlier SET LOCAL claim, which would make the
-- worker-path call below look like actor forgery; clear it explicitly.
reset role;
reset request.jwt.claim.sub;
select public.erase_memory_source_content(
  'fb390000-0000-4000-8000-000000000211', null, 'memory_item',
  'fb390000-0000-4000-8000-000000000391', 'fb39 visibility withdrawal'
);

set local role authenticated;
set local request.jwt.claim.sub = 'fb390000-0000-4000-8000-000000000011';
select extensions.is(
  (select safe_snapshot from public.memory_context_entries
   where organization_id = 'fb390000-0000-4000-8000-000000000211'),
  '{}'::jsonb, 'a withdrawn source hides its snapshot');
select extensions.is(
  (select memory_item_id from public.memory_context_entries
   where organization_id = 'fb390000-0000-4000-8000-000000000211'),
  'fb390000-0000-4000-8000-000000000391', 'the source id survives where retention allows');
select extensions.ok(
  (select source_digest from public.memory_context_entries
   where organization_id = 'fb390000-0000-4000-8000-000000000211') is not null,
  'the source digest survives where retention allows');

-- Worker paths ---------------------------------------------------------------------
reset role;
select extensions.ok(pg_catalog.has_function_privilege('service_role', 'public.revalidate_memory_context(uuid,uuid)', 'execute'), 'the worker holds revalidate');
select extensions.ok(pg_catalog.has_function_privilege('service_role', 'public.erase_memory_source_content(uuid,uuid,text,uuid,text)', 'execute'), 'the worker holds erasure');
select extensions.is(
  (select public.revalidate_memory_context(
    'fb390000-0000-4000-8000-000000000211',
    (select id from public.memory_context_manifests where attempt_key = 'fb39-visibility')
  ) ->> 'status'),
  'revoked', 'post-erasure the worker path reports revoked');

select * from extensions.finish();

rollback;
