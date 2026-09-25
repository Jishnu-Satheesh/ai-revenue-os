begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(27);

-- Covers `20260924130000_update_research_project_schedule_keyed.sql`.
--
-- Like a library's hold shelf: a member with a card may move holds on their
-- own floor (operator updates Frequency/Branch/end-date in place), a looker
-- may read the board but never move anything (viewer denial), a stranger
-- from another branch is turned away without being told what sits on the
-- shelf (cross-org fence), a returned claim slip reopens the same locker
-- (same-key replay) while a rewritten slip is refused (conflict), and the
-- shelf ledger keeps every move while the register of who moved what remains
-- (keys table + brief revisions). Rollback-wrapped.
--
-- NOTE: this suite runs at the Task 8 stage-gate, after the migration is
-- pushed. Before the push the function and keys table do not exist on
-- staging, so every assertion here errors — that failure is expected until
-- the stage-gate push, not a product defect.

-- Contract, RLS, and grants ---------------------------------------------------

select extensions.has_table(
  'public', 'growth_intelligence_project_schedule_update_keys',
  'schedule update keys bind an idempotency key to its project'
);
select extensions.has_function(
  'public', 'update_research_project_schedule_keyed',
  array['uuid', 'uuid', 'uuid', 'jsonb', 'uuid', 'text', 'text'],
  'watch schedules update through a keyed governed operation'
);
select extensions.ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'public.growth_intelligence_project_schedule_update_keys'::regclass
  ),
  'schedule update keys enable and force RLS'
);
select extensions.ok(
  pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_project_schedule_update_keys', 'select'
  ),
  'authenticated members receive a schedule-update-key read grant'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_project_schedule_update_keys',
    'insert,update,delete'
  ),
  'authenticated sessions cannot write schedule update keys directly'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.update_research_project_schedule_keyed(uuid,uuid,uuid,jsonb,uuid,text,text)',
    'execute'
  ),
  'signed-in members may update keyed schedules through the governed RPC'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.update_research_project_schedule_keyed(uuid,uuid,uuid,jsonb,uuid,text,text)',
    'execute'
  ),
  'anonymous callers cannot update watch schedules'
);

-- Two-account fixtures ---------------------------------------------------------

insert into auth.users (id) values
  ('b8000000-0000-4000-8000-000000000001'::uuid),
  ('b8000000-0000-4000-8000-000000000002'::uuid),
  ('b8000000-0000-4000-8000-000000000003'::uuid),
  ('b8000000-0000-4000-8000-000000000004'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('b8000000-0000-4000-8000-000000000101'::uuid, 'Schedule agency A', 'schedule-agency-a', 'b8000000-0000-4000-8000-000000000001'::uuid),
  ('b8000000-0000-4000-8000-000000000102'::uuid, 'Schedule agency B', 'schedule-agency-b', 'b8000000-0000-4000-8000-000000000004'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('b8000000-0000-4000-8000-000000000201'::uuid, 'b8000000-0000-4000-8000-000000000101'::uuid, 'Schedule client A', 'schedule-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'b8000000-0000-4000-8000-000000000001'::uuid),
  ('b8000000-0000-4000-8000-000000000202'::uuid, 'b8000000-0000-4000-8000-000000000102'::uuid, 'Schedule client B', 'schedule-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'b8000000-0000-4000-8000-000000000004'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('b8000000-0000-4000-8000-000000000101'::uuid, 'b8000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('b8000000-0000-4000-8000-000000000101'::uuid, 'b8000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator'),
  ('b8000000-0000-4000-8000-000000000101'::uuid, 'b8000000-0000-4000-8000-000000000003'::uuid, 'member', 'viewer'),
  ('b8000000-0000-4000-8000-000000000102'::uuid, 'b8000000-0000-4000-8000-000000000004'::uuid, 'owner', 'owner');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency, is_active
) values
  ('b8000000-0000-4000-8000-000000000301'::uuid, 'b8000000-0000-4000-8000-000000000201'::uuid, 'Schedule branch', 'schedule-branch', 'physical', 'Asia/Dubai', 'AED', true),
  ('b8000000-0000-4000-8000-000000000302'::uuid, 'b8000000-0000-4000-8000-000000000201'::uuid, 'Schedule second', 'schedule-second', 'physical', 'Asia/Dubai', 'AED', true),
  ('b8000000-0000-4000-8000-000000000303'::uuid, 'b8000000-0000-4000-8000-000000000202'::uuid, 'Other tenant branch', 'other-tenant-branch', 'physical', 'Asia/Dubai', 'AED', true);

-- Brief document builder (mirrors the Slice 7 ml_brief shape) ------------------

create or replace function pg_temp.sched_brief(
  p_project_id uuid,
  p_org_id uuid,
  p_revision_number integer,
  p_location_id uuid,
  p_frequency text
)
returns jsonb
language sql
as $$
  select pg_catalog.jsonb_build_object(
    'revisionId', pg_catalog.gen_random_uuid(),
    'projectId', p_project_id,
    'organizationId', p_org_id,
    'revisionNumber', p_revision_number,
    'question', 'What do Deira regulars want for breakfast?',
    'title', 'Deira breakfast watch',
    'locationId', p_location_id,
    'researchArea', 'Deira',
    'competitors', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'name', 'Deira Rival',
        'source', 'operator_lead'
      )
    ),
    'investigationAreas', pg_catalog.jsonb_build_array('demand'),
    'evidencePeriods', pg_catalog.jsonb_build_array(),
    'businessContextSnapshotId', 'b8000000-0000-4000-8000-000000000401',
    'frequency', p_frequency,
    'pinnedToUpdateId', 'null'::jsonb,
    'createdAtUtc', '2026-09-24T06:00:00.000Z'
  );
$$;

-- Recurring watch + first brief, created through the governed RPCs -------------

set local role authenticated;
set local request.jwt.claim.sub = 'b8000000-0000-4000-8000-000000000002';

create temp table pg_temp.sched_project as
select (public.create_research_project_keyed(
  'b8000000-0000-4000-8000-000000000201'::uuid,
  'b8000000-0000-4000-8000-000000000002'::uuid,
  'b8000000-0000-4000-8000-000000000301'::uuid,
  'Deira breakfast watch',
  'What do Deira regulars want for breakfast?',
  'recurring',
  '{"cadence":"weekly","localTime":"09:00","timeZone":"UTC"}'::jsonb,
  'sched-create-1',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
) ->> 'projectId')::uuid as project_id;

grant select on pg_temp.sched_project to public;

select extensions.ok(
  (select pg_catalog.count(*)::integer from pg_temp.sched_project) = 1,
  'a recurring watch creates through the keyed RPC'
);

create temp table pg_temp.sched_rev1 as
select (public.save_brief_revision(
  'b8000000-0000-4000-8000-000000000201'::uuid,
  'b8000000-0000-4000-8000-000000000002'::uuid,
  (select project_id from pg_temp.sched_project),
  1,
  pg_temp.sched_brief(
    (select project_id from pg_temp.sched_project),
    'b8000000-0000-4000-8000-000000000201'::uuid,
    1,
    'b8000000-0000-4000-8000-000000000301'::uuid,
    'weekly'
  ),
  null
) ->> 'revisionId')::uuid as revision_id;

grant select on pg_temp.sched_rev1 to public;

select extensions.ok(
  (select pg_catalog.count(*)::integer from pg_temp.sched_rev1) = 1,
  'the first brief revision saves through the governed RPC'
);

-- Cadence change applies the row plus a new brief revision ---------------------

create temp table pg_temp.sched_daily as
select public.update_research_project_schedule_keyed(
  'b8000000-0000-4000-8000-000000000201'::uuid,
  'b8000000-0000-4000-8000-000000000002'::uuid,
  (select project_id from pg_temp.sched_project),
  '{"cadence":"daily","localTime":"09:00","timeZone":"UTC"}'::jsonb,
  null,
  'sched-key-1',
  null
) as outcome;

grant select on pg_temp.sched_daily to public;

select extensions.is(
  (select (outcome ->> 'replayed') from pg_temp.sched_daily),
  'false',
  'a fresh schedule update applies instead of replaying'
);
select extensions.is(
  (select outcome ->> 'revisionNumber' from pg_temp.sched_daily),
  '2',
  'a cadence change appends brief revision 2'
);
select extensions.is(
  (select schedule ->> 'cadence'
   from public.growth_intelligence_research_projects
   where id = (select project_id from pg_temp.sched_project)),
  'daily',
  'the project row carries the new cadence'
);
select extensions.ok(
  exists (
    select 1 from public.growth_intelligence_brief_revisions revision
    where revision.organization_id = 'b8000000-0000-4000-8000-000000000201'::uuid
      and revision.project_id = (select project_id from pg_temp.sched_project)
      and revision.revision_number = 2
      and revision.document ->> 'locationId' = 'b8000000-0000-4000-8000-000000000301'
      and revision.document ->> 'frequency' = 'daily'
  ),
  'revision 2 keeps the branch and re-times the frequency'
);

-- Idempotency: replay, then conflict -------------------------------------------

select extensions.is(
  (select public.update_research_project_schedule_keyed(
    'b8000000-0000-4000-8000-000000000201'::uuid,
    'b8000000-0000-4000-8000-000000000002'::uuid,
    (select project_id from pg_temp.sched_project),
    '{"cadence":"daily","localTime":"09:00","timeZone":"UTC"}'::jsonb,
    null,
    'sched-key-1',
    null
  ) ->> 'replayed'),
  'true',
  'the same key with the same body replays the kept update'
);
select extensions.throws_ok(
  $$ select public.update_research_project_schedule_keyed(
    'b8000000-0000-4000-8000-000000000201'::uuid,
    'b8000000-0000-4000-8000-000000000002'::uuid,
    (select project_id from pg_temp.sched_project),
    '{"cadence":"monthly","localTime":"09:00","timeZone":"UTC"}'::jsonb,
    null,
    'sched-key-1',
    null
  ) $$,
  '23505', null,
  'the same key with another body is a conflict'
);

-- Timing-only edits append no revision ------------------------------------------

create temp table pg_temp.sched_enddate as
select public.update_research_project_schedule_keyed(
  'b8000000-0000-4000-8000-000000000201'::uuid,
  'b8000000-0000-4000-8000-000000000002'::uuid,
  (select project_id from pg_temp.sched_project),
  '{"cadence":"daily","localTime":"09:00","timeZone":"UTC","endDate":"2026-12-31"}'::jsonb,
  null,
  'sched-key-2',
  null
) as outcome;

grant select on pg_temp.sched_enddate to public;

select extensions.ok(
  (select outcome ->> 'revisionNumber' from pg_temp.sched_enddate) is null,
  'an end-date-only edit appends no brief revision'
);
select extensions.is(
  (select schedule ->> 'endDate'
   from public.growth_intelligence_research_projects
   where id = (select project_id from pg_temp.sched_project)),
  '2026-12-31',
  'the project row carries the new end date'
);

-- Branch move relocates the project and the brief --------------------------------

create temp table pg_temp.sched_branch as
select public.update_research_project_schedule_keyed(
  'b8000000-0000-4000-8000-000000000201'::uuid,
  'b8000000-0000-4000-8000-000000000002'::uuid,
  (select project_id from pg_temp.sched_project),
  '{"cadence":"daily","localTime":"09:00","timeZone":"UTC","endDate":"2026-12-31"}'::jsonb,
  'b8000000-0000-4000-8000-000000000302'::uuid,
  'sched-key-3',
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
) as outcome;

grant select on pg_temp.sched_branch to public;

select extensions.is(
  (select branch_id::text
   from public.growth_intelligence_research_projects
   where id = (select project_id from pg_temp.sched_project)),
  'b8000000-0000-4000-8000-000000000302',
  'the project row moves to the new branch'
);
select extensions.ok(
  exists (
    select 1 from public.growth_intelligence_brief_revisions revision
    where revision.organization_id = 'b8000000-0000-4000-8000-000000000201'::uuid
      and revision.project_id = (select project_id from pg_temp.sched_project)
      and revision.revision_number = 3
      and revision.document ->> 'locationId' = 'b8000000-0000-4000-8000-000000000302'
  ),
  'revision 3 relocates the brief to the new branch'
);
select extensions.ok(
  (select pg_catalog.count(*)::integer
   from public.growth_intelligence_monitoring_active_scopes scope_entry
   where scope_entry.organization_id = 'b8000000-0000-4000-8000-000000000201'::uuid
     and scope_entry.project_id = (select project_id from pg_temp.sched_project)
     and scope_entry.scope_fingerprint = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd') = 1
  and not exists (
    select 1 from public.growth_intelligence_monitoring_active_scopes scope_entry
    where scope_entry.organization_id = 'b8000000-0000-4000-8000-000000000201'::uuid
      and scope_entry.scope_fingerprint = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  ),
  'the new fingerprint replaces the stale one in the scope registry'
);

-- Fences: viewer, stranger, wrong mode, bad shape ---------------------------------
--
-- The branch-move flag is raised and lowered inside the governed RPC only:
-- even an operator with manage rights cannot move a branch directly.

select extensions.throws_ok(
  $$ update public.growth_intelligence_research_projects
     set branch_id = 'b8000000-0000-4000-8000-000000000301'::uuid
     where organization_id = 'b8000000-0000-4000-8000-000000000201'::uuid
       and id = (select project_id from pg_temp.sched_project) $$,
  '55000', null,
  'direct branch moves stay refused outside the governed RPC'
);

set local request.jwt.claim.sub = 'b8000000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$ select public.update_research_project_schedule_keyed(
    'b8000000-0000-4000-8000-000000000201'::uuid,
    'b8000000-0000-4000-8000-000000000003'::uuid,
    (select project_id from pg_temp.sched_project),
    '{"cadence":"daily","localTime":"09:00","timeZone":"UTC"}'::jsonb,
    null,
    'sched-key-viewer',
    null
  ) $$,
  '42501', null,
  'viewers cannot move watch schedules'
);

set local request.jwt.claim.sub = 'b8000000-0000-4000-8000-000000000004';

select extensions.throws_ok(
  $$ select public.update_research_project_schedule_keyed(
    'b8000000-0000-4000-8000-000000000201'::uuid,
    'b8000000-0000-4000-8000-000000000004'::uuid,
    (select project_id from pg_temp.sched_project),
    '{"cadence":"daily","localTime":"09:00","timeZone":"UTC"}'::jsonb,
    null,
    'sched-key-stranger',
    null
  ) $$,
  '42501', null,
  'a stranger from another tenant reads as not-found, never as a denial of something real'
);

set local request.jwt.claim.sub = 'b8000000-0000-4000-8000-000000000002';

create temp table pg_temp.sched_onetime as
select (public.create_research_project_keyed(
  'b8000000-0000-4000-8000-000000000201'::uuid,
  'b8000000-0000-4000-8000-000000000002'::uuid,
  'b8000000-0000-4000-8000-000000000301'::uuid,
  'Deira one-off',
  'What do Deira regulars want once?',
  'one-time',
  null,
  'sched-create-once',
  null
) ->> 'projectId')::uuid as project_id;

grant select on pg_temp.sched_onetime to public;

select extensions.throws_ok(
  $$ select public.update_research_project_schedule_keyed(
    'b8000000-0000-4000-8000-000000000201'::uuid,
    'b8000000-0000-4000-8000-000000000002'::uuid,
    (select project_id from pg_temp.sched_onetime),
    '{"cadence":"daily","localTime":"09:00","timeZone":"UTC"}'::jsonb,
    null,
    'sched-key-once',
    null
  ) $$,
  '22023', null,
  'one-time projects carry no schedule to update'
);
select extensions.throws_ok(
  $$ select public.update_research_project_schedule_keyed(
    'b8000000-0000-4000-8000-000000000201'::uuid,
    'b8000000-0000-4000-8000-000000000002'::uuid,
    (select project_id from pg_temp.sched_project),
    '{"cadence":"hourly","localTime":"09:00","timeZone":"UTC"}'::jsonb,
    null,
    'sched-key-bad',
    null
  ) $$,
  '22023', null,
  'a schedule outside the bounded vocabulary is refused'
);
select extensions.throws_ok(
  $$ select public.update_research_project_schedule_keyed(
    'b8000000-0000-4000-8000-000000000201'::uuid,
    'b8000000-0000-4000-8000-000000000002'::uuid,
    (select project_id from pg_temp.sched_project),
    '{"cadence":"daily","localTime":"09:00","timeZone":"UTC"}'::jsonb,
    'b8000000-0000-4000-8000-000000000303'::uuid,
    'sched-key-elsewhere',
    null
  ) $$,
  '42501', null,
  'a branch from another tenant is refused'
);
select extensions.throws_ok(
  $$ select public.update_research_project_schedule_keyed(
    'b8000000-0000-4000-8000-000000000201'::uuid,
    'b8000000-0000-4000-8000-000000000002'::uuid,
    (select project_id from pg_temp.sched_project),
    '{"cadence":"daily","localTime":"09:00","timeZone":"UTC"}'::jsonb,
    null,
    null,
    null
  ) $$,
  '22023', null,
  'a missing idempotency key is refused'
);

select * from extensions.finish();

rollback;
