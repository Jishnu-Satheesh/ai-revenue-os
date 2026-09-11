begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(31);

-- Spec 023 Task 02 storage: settings, revisions, events, dependencies and the
-- item link. Flags default off and queues start empty, so nothing about
-- existing features changes until an adapter slice lands.

create or replace function pg_temp.state_of(call_sql text)
returns text language plpgsql as $$
begin
  execute call_sql;
  return 'no-error';
exception when others then
  return SQLSTATE;
end;
$$;

-- Structure ---------------------------------------------------------------------

select extensions.has_table('public', 'memory_integration_settings', 'settings are database-owned');
select extensions.has_table('public', 'memory_source_revisions', 'so are source revisions');
select extensions.has_table('public', 'memory_capture_events', 'so is the capture queue');
select extensions.has_table('public', 'memory_capture_dependencies', 'and event ancestry');
select extensions.has_table('public', 'memory_capture_adapters', 'and the adapter registry');
select extensions.has_function('public', 'update_memory_integration_settings', 'settings change is database-owned');
select extensions.has_function('private', 'allocate_memory_source_revision', 'and the allocator is private');
select extensions.ok(pg_catalog.has_function_privilege('authenticated', 'public.update_memory_integration_settings(uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean,text,uuid)', 'execute'), 'members hold the settings path');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.update_memory_integration_settings(uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean,text,uuid)', 'execute'), 'anonymous callers hold none');
select extensions.ok(not pg_catalog.has_function_privilege('service_role', 'public.update_memory_integration_settings(uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean,text,uuid)', 'execute'), 'nor does the worker');
select extensions.ok((select relrowsecurity from pg_catalog.pg_class where relname = 'memory_integration_settings'), 'settings rows are RLS-protected');
select extensions.ok((select relforcerowsecurity from pg_catalog.pg_class where relname = 'memory_integration_settings'), 'even from the table owner');
select extensions.ok((select relrowsecurity from pg_catalog.pg_class where relname = 'memory_capture_events'), 'capture rows are RLS-protected');
select extensions.ok((select relforcerowsecurity from pg_catalog.pg_class where relname = 'memory_capture_events'), 'even from the table owner');
select extensions.has_column('public', 'memory_items', 'knowledge_kind', 'items carry a statement kind');
select extensions.has_column('public', 'memory_items', 'capture_event_id', 'and a capture link');
select extensions.ok(exists (select 1 from public.permissions where key = 'memory.manage_integrations'), 'the settings permission is seeded');
select extensions.ok(exists (select 1 from public.permissions where key = 'memory.retry_capture'), 'and the retry permission');
select extensions.is(
  (select pg_catalog.array_agg(organization_role::text order by organization_role::text)
   from public.organization_role_permissions where permission_key = 'memory.manage_integrations'),
  array['admin', 'owner']::text[], 'settings stay above the operator line');
select extensions.is(
  (select pg_catalog.array_agg(organization_role::text order by organization_role::text)
   from public.organization_role_permissions where permission_key = 'memory.retry_capture'),
  array['admin', 'owner']::text[], 'and so do retries');

-- Fixtures -----------------------------------------------------------------------

insert into auth.users (id) values
  ('fb340000-0000-4000-8000-000000000001'::uuid),
  ('fb340000-0000-4000-8000-000000000004'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb340000-0000-4000-8000-000000000101'::uuid, 'Capture verifier', 'capture-verifier', 'fb340000-0000-4000-8000-000000000001'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb340000-0000-4000-8000-000000000201'::uuid, 'fb340000-0000-4000-8000-000000000101'::uuid, 'Capture verifier', 'capture-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb340000-0000-4000-8000-000000000001'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb340000-0000-4000-8000-000000000101'::uuid, 'fb340000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('fb340000-0000-4000-8000-000000000201'::uuid, 'fb340000-0000-4000-8000-000000000004'::uuid, 'operator');

-- Settings -------------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb340000-0000-4000-8000-000000000001';

select extensions.is(
  (select public.update_memory_integration_settings('fb340000-0000-4000-8000-000000000201', 'fb340000-0000-4000-8000-000000000001', false, false, false, false, false, false, 'shared-context-v1', 'fb340000-0000-4000-8000-000000000901') ->> 'captureEnabled'),
  'false', 'the owner writes the default-off settings row');

select extensions.is(
  pg_temp.state_of($$ select public.update_memory_integration_settings('fb340000-0000-4000-8000-000000000201', 'fb340000-0000-4000-8000-000000000004', true, false, false, false, false, false, 'shared-context-v1', 'fb340000-0000-4000-8000-000000000902') $$),
  '42501', 'an operator cannot change capture settings');

select extensions.is(
  pg_temp.state_of($$ select public.update_memory_integration_settings('fb340000-0000-4000-8000-000000000201', 'fb340000-0000-4000-8000-000000000004', false, false, false, false, false, false, 'shared-context-v1', 'fb340000-0000-4000-8000-000000000903') $$),
  '42501', 'borrowing another actor identity is refused');

select extensions.is(
  (select count(*)::integer from public.audit_events
   where organization_id = 'fb340000-0000-4000-8000-000000000201' and event_name = 'memory.integration_changed'),
  1, 'the settings change is audited');

-- Allocator --------------------------------------------------------------------------
--
-- The allocator is revoked from every session role by design: only source
-- transactions reach it nested inside their own fenced RPCs. These calls run
-- as the migration owner, the way a nested definer call would.

reset role;

select extensions.is(
  private.allocate_memory_source_revision('fb340000-0000-4000-8000-000000000201', 'channel_finding', 'fb340000-0000-4000-8000-000000000301', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  1::bigint, 'a new source starts at revision one');
select extensions.is(
  private.allocate_memory_source_revision('fb340000-0000-4000-8000-000000000201', 'channel_finding', 'fb340000-0000-4000-8000-000000000301', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  1::bigint, 'an unchanged digest mints no new revision');
select extensions.is(
  private.allocate_memory_source_revision('fb340000-0000-4000-8000-000000000201', 'channel_finding', 'fb340000-0000-4000-8000-000000000301', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
  2::bigint, 'a changed digest advances the revision');
select extensions.is(
  private.allocate_memory_source_revision('fb340000-0000-4000-8000-000000000201', 'channel_finding', 'fb340000-0000-4000-8000-000000000301', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  3::bigint, 'a changed-away-and-back state is a new ordered revision');
select extensions.is(
  pg_temp.state_of($$ select private.allocate_memory_source_revision('fb340000-0000-4000-8000-000000000201', 'channel_finding', 'fb340000-0000-4000-8000-000000000301', 'not-a-digest') $$),
  '23514', 'a malformed digest is refused');

-- Item kind guard ----------------------------------------------------------------------

select extensions.is(
  pg_temp.state_of($$ insert into public.memory_items (organization_id, memory_type, title, origin, knowledge_kind) values ('fb340000-0000-4000-8000-000000000201', 'episode', 'Mismatched kind', 'system_generated', 'operator_decision') $$),
  '23514', 'a decision kind on an episode row is refused');

-- Slot guard -----------------------------------------------------------------------------

select extensions.is(
  pg_temp.state_of($$ insert into public.memory_capture_events (organization_id, source_kind, source_revision, source_digest, correlation_id) values ('fb340000-0000-4000-8000-000000000201', 'channel_finding', 1, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'fb340000-0000-4000-8000-000000000904') $$),
  '23514', 'a kind with no typed source is refused');

select * from extensions.finish();

rollback;
