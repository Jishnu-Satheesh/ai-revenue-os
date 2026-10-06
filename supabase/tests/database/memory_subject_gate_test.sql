begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(16);

-- Slice 1: the search boundary excludes the unqualified legacy corpus by
-- default, and the authenticated subject path reads its flags through one
-- member-checked gate. Fixture prefix fb45.

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

select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.search_memory_items(uuid,text,extensions.vector,uuid,text[],text[],integer,boolean,boolean,real,real,integer,integer,boolean)',
    'execute'),
  'members keep search through the legacy-gated shape');
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.read_subject_context_gate(uuid)', 'execute'),
  'members hold the subject gate read');
select extensions.ok(
  not pg_catalog.has_function_privilege('anon', 'public.read_subject_context_gate(uuid)', 'execute'),
  'anonymous callers hold no gate read');
select extensions.ok(
  not pg_catalog.has_function_privilege('service_role', 'public.read_subject_context_gate(uuid)', 'execute'),
  'the worker holds no member gate read');

-- Fixtures --------------------------------------------------------------------

insert into auth.users (id) values
  ('fb450000-0000-4000-8000-000000000001'::uuid),
  ('fb450000-0000-4000-8000-000000000002'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb450000-0000-4000-8000-000000000101'::uuid, 'Gate A', 'gate-a', 'fb450000-0000-4000-8000-000000000001'::uuid),
  ('fb450000-0000-4000-8000-000000000102'::uuid, 'Gate B', 'gate-b', 'fb450000-0000-4000-8000-000000000002'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb450000-0000-4000-8000-000000000201'::uuid, 'fb450000-0000-4000-8000-000000000101'::uuid, 'Gate A', 'gate-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb450000-0000-4000-8000-000000000001'::uuid),
  ('fb450000-0000-4000-8000-000000000202'::uuid, 'fb450000-0000-4000-8000-000000000102'::uuid, 'Gate B', 'gate-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb450000-0000-4000-8000-000000000002'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb450000-0000-4000-8000-000000000101'::uuid, 'fb450000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('fb450000-0000-4000-8000-000000000102'::uuid, 'fb450000-0000-4000-8000-000000000002'::uuid, 'owner', 'owner');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('fb450000-0000-4000-8000-000000000201'::uuid, 'fb450000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('fb450000-0000-4000-8000-000000000202'::uuid, 'fb450000-0000-4000-8000-000000000002'::uuid, 'owner');

insert into public.memory_items (
  id, organization_id, memory_type, title, body, origin, verification_state, sensitivity, knowledge_kind
) values
  ('fb450000-0000-4000-8000-000000000301'::uuid, 'fb450000-0000-4000-8000-000000000201'::uuid,
   'note', 'fb45 cardamom legacy note', 'fb45 cardamom sourced years ago.', 'system_generated', 'unverified', 'internal', 'legacy'),
  ('fb450000-0000-4000-8000-000000000302'::uuid, 'fb450000-0000-4000-8000-000000000201'::uuid,
   'episode', 'fb45 cardamom captured note', 'fb45 cardamom observed this month.', 'system_generated', 'unverified', 'internal', 'observation'),
  ('fb450000-0000-4000-8000-000000000303'::uuid, 'fb450000-0000-4000-8000-000000000202'::uuid,
   'note', 'fb45 cardamom outsider note', 'fb45 cardamom from another tenant.', 'system_generated', 'unverified', 'internal', 'legacy');

-- Legacy gate -----------------------------------------------------------------

select extensions.is(
  (select array_agg(result.id order by result.id) from public.search_memory_items(
    'fb450000-0000-4000-8000-000000000201'::uuid, 'fb45 cardamom'
  ) result),
  array['fb450000-0000-4000-8000-000000000302'::uuid],
  'default search excludes the unqualified legacy row but keeps the captured row');

select extensions.is(
  (select array_agg(result.id order by result.id) from public.search_memory_items(
    'fb450000-0000-4000-8000-000000000201'::uuid, 'fb45 cardamom', null, null, null, array['public', 'internal'], null, false, false, null, null, null, null, true
  ) result),
  array['fb450000-0000-4000-8000-000000000301'::uuid, 'fb450000-0000-4000-8000-000000000302'::uuid],
  'an explicit legacy opt-in still reads both rows');

select extensions.is(
  (select count(*)::integer from public.search_memory_items(
    'fb450000-0000-4000-8000-000000000201'::uuid, 'fb45 cardamom', null, null, null, array['public', 'internal'], null, false, false, null, null, null, null, true
  ) result where result.id = 'fb450000-0000-4000-8000-000000000303'::uuid),
  0, 'even opted in, another tenant legacy row never crosses');

-- Gate RPC --------------------------------------------------------------------
--
-- The gate refuses callers without membership before answering anything, so
-- every read below runs as an explicit role like the consent suite does.

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb450000-0000-4000-8000-000000000001';

select extensions.is(
  (public.read_subject_context_gate('fb450000-0000-4000-8000-000000000201'::uuid)
    ->> 'subjectEnabled'),
  'false', 'without a settings row the subject purpose stays disabled');
select extensions.is(
  (public.read_subject_context_gate('fb450000-0000-4000-8000-000000000201'::uuid)
    ->> 'legacyQualified'),
  'false', 'without a settings row the legacy corpus stays unqualified');
select extensions.is(
  (public.read_subject_context_gate('fb450000-0000-4000-8000-000000000201'::uuid)
    ->> 'policyVersion'),
  'shared-context-v1', 'without a settings row the policy version is the default');

reset role;

insert into public.memory_integration_settings (
  organization_id, subject_context_enabled, legacy_corpus_qualified
) values
  ('fb450000-0000-4000-8000-000000000201'::uuid, true, true);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb450000-0000-4000-8000-000000000001';

select extensions.is(
  ((public.read_subject_context_gate('fb450000-0000-4000-8000-000000000201'::uuid)
    ->> 'subjectEnabled')::boolean
   and (public.read_subject_context_gate('fb450000-0000-4000-8000-000000000201'::uuid)
    ->> 'legacyQualified')::boolean),
  true, 'a settings row is reflected honestly');

select extensions.is(
  pg_temp.state_of($$ select public.read_subject_context_gate(null) $$),
  '22023', 'a null organization is refused before any authorization');

reset role;
set local role anon;

select extensions.is(
  pg_temp.state_of(
    $$ select public.read_subject_context_gate('fb450000-0000-4000-8000-000000000201'::uuid) $$),
  '42501', 'anonymous callers hold no gate read');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb450000-0000-4000-8000-000000000002';

select extensions.is(
  pg_temp.state_of(
    $$ select public.read_subject_context_gate('fb450000-0000-4000-8000-000000000201'::uuid) $$),
  '42501', 'another tenant owner reads none of this gate');

set local request.jwt.claim.sub = 'fb450000-0000-4000-8000-000000000001';

select extensions.is(
  pg_temp.state_of(
    $$ select public.read_subject_context_gate('fb450000-0000-4000-8000-000000000201'::uuid) $$),
  'no-error', 'the owning member reads its own gate');

reset role;
set local role service_role;

select extensions.is(
  pg_temp.state_of(
    $$ select public.read_subject_context_gate('fb450000-0000-4000-8000-000000000201'::uuid) $$),
  '42501', 'the worker holds no member gate read');

reset role;

select * from extensions.finish();

rollback;
