begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(11);

-- Covers `20260924120000_agent_threads_and_messages.sql`.
--
-- Like a hotel front desk: a guest sees only their own floor's ledger
-- (member isolation), a looker may read the lobby board but never write in
-- it (viewer read-only), a returned key opens the same locker instead of a
-- new one (same-key replay) while a copied key with a different engraving
-- is refused (conflict), the night porter may relabel lockers only on their
-- own floor (fenced link updates), and old letters are shredded while the
-- register of who wrote when remains (purge keeps audit). Rollback-wrapped.
--
-- Contract caps for Task 3 (enforced in the RPCs + table CHECKs, matched by
-- shape here): thread titles cap at 200 chars (blank becomes 'New chat'),
-- message bodies cap at 20000 chars (trimmed, non-empty).

-- Fixtures ---------------------------------------------------------------------

insert into auth.users (id) values
  ('e8000000-0000-4000-8000-000000000001'::uuid),
  ('e8000000-0000-4000-8000-000000000002'::uuid),
  ('e8000000-0000-4000-8000-000000000003'::uuid),
  ('e8000000-0000-4000-8000-000000000004'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('e8000000-0000-4000-8000-000000000101'::uuid, 'Threads agency A', 'threads-agency-a', 'e8000000-0000-4000-8000-000000000001'::uuid),
  ('e8000000-0000-4000-8000-000000000102'::uuid, 'Threads agency B', 'threads-agency-b', 'e8000000-0000-4000-8000-000000000004'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('e8000000-0000-4000-8000-000000000201'::uuid, 'e8000000-0000-4000-8000-000000000101'::uuid, 'Threads client A', 'threads-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'e8000000-0000-4000-8000-000000000001'::uuid),
  ('e8000000-0000-4000-8000-000000000202'::uuid, 'e8000000-0000-4000-8000-000000000102'::uuid, 'Threads client B', 'threads-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'e8000000-0000-4000-8000-000000000004'::uuid);

insert into public.organization_memberships (organization_id, user_id, role) values
  ('e8000000-0000-4000-8000-000000000201'::uuid, 'e8000000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('e8000000-0000-4000-8000-000000000201'::uuid, 'e8000000-0000-4000-8000-000000000002'::uuid, 'operator'),
  ('e8000000-0000-4000-8000-000000000201'::uuid, 'e8000000-0000-4000-8000-000000000003'::uuid, 'viewer'),
  ('e8000000-0000-4000-8000-000000000202'::uuid, 'e8000000-0000-4000-8000-000000000004'::uuid, 'owner');

-- One thread per tenant plus one message each, created through the governed
-- RPCs (never direct inserts: no session role holds a write grant).
-- Plus one pre-aged thread + message pair in org A, inserted directly as
-- the table owner with old timestamps for the retention probe: a direct
-- INSERT never fires the BEFORE UPDATE clock trigger, so the row stays old,
-- while the RPC clock refresh (append/link) is exactly what keeps live
-- threads fresh. This owner INSERT is the only direct write in the suite.
-- Temp pins are owned by the creating role; later service_role and owner
-- sections read them, so each pin carries a session-local read grant.
-- Harmless beyond this transaction (temp tables die with the session).

insert into public.agent_threads (
  id, organization_id, title, mode, created_by, created_at, updated_at
) values (
  'e8000000-0000-4000-8000-000000000310'::uuid,
  'e8000000-0000-4000-8000-000000000201'::uuid,
  'Aged thread', 'quick',
  'e8000000-0000-4000-8000-000000000002'::uuid,
  pg_catalog.now() - interval '100 days',
  pg_catalog.now() - interval '100 days'
);

insert into public.agent_messages (
  id, organization_id, thread_id, role, body, created_by, created_at
) values (
  'e8000000-0000-4000-8000-000000000311'::uuid,
  'e8000000-0000-4000-8000-000000000201'::uuid,
  'e8000000-0000-4000-8000-000000000310'::uuid,
  'user', 'Aged message body.',
  'e8000000-0000-4000-8000-000000000002'::uuid,
  pg_catalog.now() - interval '100 days'
);

set local role authenticated;
set local request.jwt.claim.sub = 'e8000000-0000-4000-8000-000000000002';

create temp table t_thread_a as
select public.create_agent_thread_keyed(
  'e8000000-0000-4000-8000-000000000201'::uuid,
  'e8000000-0000-4000-8000-000000000002'::uuid,
  'thread-key-1',
  'Hello quick question',
  'quick'
) as r;
grant select on t_thread_a to public;

create temp table t_msg_a as
select public.append_agent_message(
  'e8000000-0000-4000-8000-000000000201'::uuid,
  'e8000000-0000-4000-8000-000000000002'::uuid,
  (select (r ->> 'threadId')::uuid from t_thread_a),
  'user',
  'What should we run next?',
  'msg-key-1'
) as r;
grant select on t_msg_a to public;

set local request.jwt.claim.sub = 'e8000000-0000-4000-8000-000000000004';

create temp table t_thread_b as
select public.create_agent_thread_keyed(
  'e8000000-0000-4000-8000-000000000202'::uuid,
  'e8000000-0000-4000-8000-000000000004'::uuid,
  'thread-key-1',
  'Other tenant thread',
  'deepthink'
) as r;
grant select on t_thread_b to public;

select public.append_agent_message(
  'e8000000-0000-4000-8000-000000000202'::uuid,
  'e8000000-0000-4000-8000-000000000004'::uuid,
  (select (r ->> 'threadId')::uuid from t_thread_b),
  'user',
  'Other tenant message.',
  'b-msg-1'
);

-- 1. Member sees own org threads -------------------------------------------------

set local request.jwt.claim.sub = 'e8000000-0000-4000-8000-000000000002';

select extensions.is(
  (select count(*)::bigint from public.agent_threads),
  2::bigint,
  'a member reads exactly their own organization threads, live and aged'
);

-- 2. Cross-org invisibility -------------------------------------------------------

select extensions.is(
  (select count(*)::bigint from public.agent_threads
    where organization_id = 'e8000000-0000-4000-8000-000000000202'::uuid)
  + (select count(*)::bigint from public.agent_messages
    where organization_id = 'e8000000-0000-4000-8000-000000000202'::uuid),
  0::bigint,
  'the other tenant thread and message stay invisible'
);

-- 3. Viewer read-only --------------------------------------------------------------

set local request.jwt.claim.sub = 'e8000000-0000-4000-8000-000000000003';

select extensions.lives_ok(
  $_$select public.create_agent_thread_keyed(
    'e8000000-0000-4000-8000-000000000201'::uuid,
    'e8000000-0000-4000-8000-000000000003'::uuid,
    'viewer-key-1',
    'Viewer thread',
    'quick'
  )$_$,
  'a viewer may create its own quick chat for read-only advice'
);

-- 4. Viewer cannot append ----------------------------------------------------------------

select extensions.throws_ok(
  $_$select public.append_agent_message(
    'e8000000-0000-4000-8000-000000000201'::uuid,
    'e8000000-0000-4000-8000-000000000003'::uuid,
    (select (r ->> 'threadId')::uuid from t_thread_a),
    'user',
    'Viewer message.',
    'viewer-msg-1'
  )$_$,
  '42501', null,
  'a viewer cannot append messages to another member thread'
);

-- 5. Viewer cannot relink ------------------------------------------------------------------

select extensions.throws_ok(
  $_$select public.set_thread_links(
    'e8000000-0000-4000-8000-000000000201'::uuid,
    'e8000000-0000-4000-8000-000000000003'::uuid,
    (select (r ->> 'threadId')::uuid from t_thread_a),
    null, null, null, null
  )$_$,
  '42501', null,
  'a viewer cannot relink a thread: read-only means read'
);

-- 6. Replay same key returns kept row -------------------------------------------------

set local request.jwt.claim.sub = 'e8000000-0000-4000-8000-000000000002';

select extensions.ok(
  (select (s.r ->> 'threadId') = (select t.r ->> 'threadId' from t_thread_a t)
     and (s.r ->> 'replayed')::boolean
     and (select count(*)::integer from public.agent_threads) = 3
   from (select public.create_agent_thread_keyed(
     'e8000000-0000-4000-8000-000000000201'::uuid,
     'e8000000-0000-4000-8000-000000000002'::uuid,
     'thread-key-1',
     'Hello quick question',
     'quick'
   ) as r) s),
  'replaying the same key and body returns the kept thread, not a twin'
);

-- 7. Conflict different body ------------------------------------------------------------

select extensions.throws_ok(
  $_$select public.create_agent_thread_keyed(
    'e8000000-0000-4000-8000-000000000201'::uuid,
    'e8000000-0000-4000-8000-000000000002'::uuid,
    'thread-key-1',
    'A different title on the same key',
    'quick'
  )$_$,
  '23505', null,
  'the same key with a different body is a conflict, never a silent rewrite'
);

-- 8. Message append replay ----------------------------------------------------------------

select extensions.ok(
  (select (s.r ->> 'messageId') = (select m.r ->> 'messageId' from t_msg_a m)
     and (s.r ->> 'replayed')::boolean
     and (select count(*)::integer from public.agent_messages
       where organization_id = 'e8000000-0000-4000-8000-000000000201'::uuid) = 2
   from (select public.append_agent_message(
     'e8000000-0000-4000-8000-000000000201'::uuid,
     'e8000000-0000-4000-8000-000000000002'::uuid,
     (select (r ->> 'threadId')::uuid from t_thread_a),
     'user',
     'What should we run next?',
     'msg-key-1'
   ) as r) s),
  'replaying the same message key returns the kept message, never a double post'
);

-- 9. Message conflict different body -------------------------------------------------------------

select extensions.throws_ok(
  $_$select public.append_agent_message(
    'e8000000-0000-4000-8000-000000000201'::uuid,
    'e8000000-0000-4000-8000-000000000002'::uuid,
    (select (r ->> 'threadId')::uuid from t_thread_a),
    'user',
    'A different body on the same message key',
    'msg-key-1'
  )$_$,
  '23505', null,
  'the same message key with a different body is a conflict, never a double post'
);

-- 10. Worker link update fenced -----------------------------------------------------------------

select extensions.throws_ok(
  $_$select public.set_thread_links(
    'e8000000-0000-4000-8000-000000000201'::uuid,
    'e8000000-0000-4000-8000-000000000002'::uuid,
    (select (r ->> 'threadId')::uuid from t_thread_b),
    'e8000000-0000-4000-8000-000000000301'::uuid,
    null, null, null
  )$_$,
  '42501', null,
  'a link update naming the live other-tenant thread is refused even with a valid membership'
);

-- 11. Purge removes bodies only with audit kept ----------------------------------------------------
--
-- Aging is trigger-safe by construction: the retention probe row is born
-- old via a direct owner INSERT (a BEFORE UPDATE trigger never fires on
-- insert), while the live threads stay fresh because every RPC clock
-- refresh (append/link) runs the updated_at trigger. An UPDATE-based
-- backdate would be instantly overwritten by agent_threads_set_updated_at,
-- so the suite never does one. The worker links thread A, the purge scrubs
-- only the aged probe, and both fresh tenants must survive untouched.

set local role service_role;

select public.set_thread_links(
  'e8000000-0000-4000-8000-000000000201'::uuid,
  'e8000000-0000-4000-8000-000000000002'::uuid,
  (select (r ->> 'threadId')::uuid from t_thread_a),
  'e8000000-0000-4000-8000-000000000301'::uuid,
  'e8000000-0000-4000-8000-000000000302'::uuid,
  'e8000000-0000-4000-8000-000000000303'::uuid,
  'e8000000-0000-4000-8000-000000000304'::uuid
);

create temp table t_purge as
select public.purge_expired_agent_threads(
  pg_catalog.now() - interval '90 days'
) as r;
grant select on t_purge to public;

reset role;

select extensions.ok(
  (select msg.body is null
     and (select (p.r ->> 'purgedMessages')::integer from t_purge p) = 1
     and (select count(*)::integer from public.agent_messages
       where thread_id = 'e8000000-0000-4000-8000-000000000310'::uuid) = 1
     and (select count(*)::integer from public.agent_threads
       where id = 'e8000000-0000-4000-8000-000000000310'::uuid) = 1
     and th.linked_research_project_id is not null
     and th.linked_request_id is not null
     and th.linked_draft_request_id is not null
     and th.linked_campaign_id is not null
     and (select ma.body is not null from public.agent_messages ma
       where ma.thread_id = ta.id)
     and (select mb.body is not null from public.agent_messages mb
       where mb.thread_id = tb.id)
   from (select (r ->> 'threadId')::uuid as id from t_thread_a) ta
   cross join (select (r ->> 'threadId')::uuid as id from t_thread_b) tb
   join public.agent_messages msg
     on msg.thread_id = 'e8000000-0000-4000-8000-000000000310'::uuid
   join public.agent_threads th on th.id = ta.id),
  'purge scrubs only the aged probe body while its audit rows, the worker links and both fresh tenants stay'
);

select * from extensions.finish();

rollback;
