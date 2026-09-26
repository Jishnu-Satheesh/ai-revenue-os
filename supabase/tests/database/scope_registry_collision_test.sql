begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(14);

-- Covers `20260926140000_scope_registry_collision_code.sql` (Slice C M10).
--
-- Like a library's hold shelf: when two claim slips name the same books,
-- the older holder keeps the reservation — but now the turned-away slip is
-- stamped with the reason instead of walking away empty-handed. The first
-- project to claim a fingerprint keeps its registry row; the loser's result
-- carries `SCOPE_FINGERPRINT_COLLISION` instead of a silent
-- fingerprint-less row. Rollback-wrapped.
--
-- NOTE: this suite runs at the stage-gate, after the migration is pushed.
-- Before the push the result carries no `reasonCode` key (`->>` reads a
-- missing key as null), so the collision assertion fails while every
-- registry assertion still passes — that failure is expected until the
-- stage-gate push, not a product defect (R1 pattern).

-- Contract: the forward-only replace must not change the signature --------

select extensions.has_function(
  'public', 'update_research_project_schedule_keyed',
  array['uuid', 'uuid', 'uuid', 'jsonb', 'uuid', 'text', 'text'],
  'the collision-code replace keeps the governed RPC signature'
);

-- Two-account fixtures ---------------------------------------------------------

insert into auth.users (id) values
  ('c9000000-0000-4000-8000-000000000001'::uuid),
  ('c9000000-0000-4000-8000-000000000002'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('c9000000-0000-4000-8000-000000000101'::uuid, 'Collision agency', 'collision-agency', 'c9000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('c9000000-0000-4000-8000-000000000201'::uuid, 'c9000000-0000-4000-8000-000000000101'::uuid, 'Collision client', 'collision-client', 'testing', 'AE', 'AED', 'Asia/Dubai', 'c9000000-0000-4000-8000-000000000001'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('c9000000-0000-4000-8000-000000000101'::uuid, 'c9000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('c9000000-0000-4000-8000-000000000101'::uuid, 'c9000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency, is_active
) values
  ('c9000000-0000-4000-8000-000000000301'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid, 'Collision branch', 'collision-branch', 'physical', 'Asia/Dubai', 'AED', true),
  ('c9000000-0000-4000-8000-000000000302'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid, 'Collision second', 'collision-second', 'physical', 'Asia/Dubai', 'AED', true);

-- Two recurring watches, no fingerprints claimed yet ----------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000002';

create temp table pg_temp.collide_a as
select (public.create_research_project_keyed(
  'c9000000-0000-4000-8000-000000000201'::uuid,
  'c9000000-0000-4000-8000-000000000002'::uuid,
  'c9000000-0000-4000-8000-000000000301'::uuid,
  'Collision watch A',
  'What do Deira regulars want for breakfast?',
  'recurring',
  '{"cadence":"weekly","localTime":"09:00","timeZone":"UTC"}'::jsonb,
  'collide-create-a',
  null
) ->> 'projectId')::uuid as project_id;

grant select on pg_temp.collide_a to public;

create temp table pg_temp.collide_b as
select (public.create_research_project_keyed(
  'c9000000-0000-4000-8000-000000000201'::uuid,
  'c9000000-0000-4000-8000-000000000002'::uuid,
  'c9000000-0000-4000-8000-000000000302'::uuid,
  'Collision watch B',
  'What do Marina regulars want for lunch?',
  'recurring',
  '{"cadence":"weekly","localTime":"09:00","timeZone":"UTC"}'::jsonb,
  'collide-create-b',
  null
) ->> 'projectId')::uuid as project_id;

grant select on pg_temp.collide_b to public;

-- First claim wins, with a null code --------------------------------------------

create temp table pg_temp.collide_claim_a as
select public.update_research_project_schedule_keyed(
  'c9000000-0000-4000-8000-000000000201'::uuid,
  'c9000000-0000-4000-8000-000000000002'::uuid,
  (select project_id from pg_temp.collide_a),
  '{"cadence":"weekly","localTime":"10:00","timeZone":"UTC"}'::jsonb,
  null,
  'collide-key-a',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
) as outcome;

grant select on pg_temp.collide_claim_a to public;

select extensions.is(
  (select outcome ->> 'replayed' from pg_temp.collide_claim_a),
  'false',
  'the first fingerprint claim applies instead of replaying'
);
select extensions.ok(
  (select outcome ->> 'reasonCode' from pg_temp.collide_claim_a) is null,
  'the winning claim carries no collision code'
);
select extensions.ok(
  (select pg_catalog.count(*)::integer
   from public.growth_intelligence_monitoring_active_scopes scope_entry
   where scope_entry.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
     and scope_entry.project_id = (select project_id from pg_temp.collide_a)
     and scope_entry.scope_fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') = 1,
  'the registry holds the first claim'
);

-- Second claim collides: older holder keeps the row, loser keeps a code -------

create temp table pg_temp.collide_claim_b as
select public.update_research_project_schedule_keyed(
  'c9000000-0000-4000-8000-000000000201'::uuid,
  'c9000000-0000-4000-8000-000000000002'::uuid,
  (select project_id from pg_temp.collide_b),
  '{"cadence":"weekly","localTime":"10:00","timeZone":"UTC"}'::jsonb,
  null,
  'collide-key-b',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
) as outcome;

grant select on pg_temp.collide_claim_b to public;

select extensions.is(
  (select outcome ->> 'replayed' from pg_temp.collide_claim_b),
  'false',
  'the colliding update still applies its row instead of replaying'
);
select extensions.is(
  (select outcome ->> 'reasonCode' from pg_temp.collide_claim_b),
  'SCOPE_FINGERPRINT_COLLISION',
  'the collision keeps a reason code instead of a silent fingerprint-less row'
);
select extensions.ok(
  (select pg_catalog.count(*)::integer
   from public.growth_intelligence_monitoring_active_scopes scope_entry
   where scope_entry.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
     and scope_entry.project_id = (select project_id from pg_temp.collide_a)
     and scope_entry.scope_fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') = 1,
  'the older holder keeps the fingerprint on collision'
);
select extensions.ok(
  not exists (
    select 1 from public.growth_intelligence_monitoring_active_scopes scope_entry
    where scope_entry.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
      and scope_entry.project_id = (select project_id from pg_temp.collide_b)
  ),
  'the loser holds no scope row for the contested fingerprint'
);

-- Replay reports the kept row, and a fresh fingerprint claims cleanly ---------

select extensions.is(
  (select public.update_research_project_schedule_keyed(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000002'::uuid,
    (select project_id from pg_temp.collide_b),
    '{"cadence":"weekly","localTime":"10:00","timeZone":"UTC"}'::jsonb,
    null,
    'collide-key-b',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ) ->> 'replayed'),
  'true',
  'the same key with the same body replays the kept update'
);
select extensions.ok(
  (select public.update_research_project_schedule_keyed(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000002'::uuid,
    (select project_id from pg_temp.collide_b),
    '{"cadence":"weekly","localTime":"10:00","timeZone":"UTC"}'::jsonb,
    null,
    'collide-key-b',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ) ->> 'reasonCode') is null,
  'the replay reports the kept row with no fresh scope code'
);

create temp table pg_temp.collide_claim_b2 as
select public.update_research_project_schedule_keyed(
  'c9000000-0000-4000-8000-000000000201'::uuid,
  'c9000000-0000-4000-8000-000000000002'::uuid,
  (select project_id from pg_temp.collide_b),
  '{"cadence":"weekly","localTime":"11:00","timeZone":"UTC"}'::jsonb,
  null,
  'collide-key-b2',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
) as outcome;

grant select on pg_temp.collide_claim_b2 to public;

select extensions.is(
  (select outcome ->> 'replayed' from pg_temp.collide_claim_b2),
  'false',
  'a fresh fingerprint applies instead of replaying'
);
select extensions.ok(
  (select outcome ->> 'reasonCode' from pg_temp.collide_claim_b2) is null,
  'the uncontested claim carries no collision code'
);
select extensions.ok(
  (select pg_catalog.count(*)::integer
   from public.growth_intelligence_monitoring_active_scopes scope_entry
   where scope_entry.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
     and scope_entry.project_id = (select project_id from pg_temp.collide_b)
     and scope_entry.scope_fingerprint = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') = 1,
  'the registry holds the fresh claim'
);
select extensions.ok(
  (select pg_catalog.count(*)::integer
   from public.growth_intelligence_monitoring_active_scopes scope_entry
   where scope_entry.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
     and scope_entry.project_id = (select project_id from pg_temp.collide_a)
     and scope_entry.scope_fingerprint = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') = 1,
  'the first claim survives the second project moving on'
);

select * from extensions.finish();

rollback;
