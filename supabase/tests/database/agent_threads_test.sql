begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(8);

-- Covers `20260924120000_agent_threads_and_messages.sql`.
--
-- Like a hotel front desk: a guest sees only their own floor's ledger
-- (member isolation), a looker may read the lobby board but never write in
-- it (viewer read-only), a returned key opens the same locker instead of a
-- new one (same-key replay) while a copied key with a different engraving
-- is refused (conflict), the night porter may relabel lockers only on their
-- own floor (fenced link updates), and old letters are shredded while the
-- register of who wrote when remains (purge keeps audit). Rollback-wrapped.

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
-- Temp pins are owned by the creating role; later service_role and owner
-- sections read them, so each pin carries a session-local read grant.
-- Harmless beyond this transaction (temp tables die with the session).

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
  1::bigint,
  'a member reads exactly their own organization thread'
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

select extensions.throws_ok(
  $_$select public.create_agent_thread_keyed(
    'e8000000-0000-4000-8000-000000000201'::uuid,
    'e8000000-0000-4000-8000-000000000003'::uuid,
    'viewer-key-1',
    'Viewer thread',
    'quick'
  )$_$,
  '42501', null,
  'a viewer cannot create a thread: read-only means read'
);

-- 4. Replay same key returns kept row -------------------------------------------------

set local request.jwt.claim.sub = 'e8000000-0000-4000-8000-000000000002';

select extensions.ok(
  (select (s.r ->> 'threadId') = (select t.r ->> 'threadId' from t_thread_a t)
     and (s.r ->> 'replayed')::boolean
     and (select count(*)::integer from public.agent_threads) = 1
   from (select public.create_agent_thread_keyed(
     'e8000000-0000-4000-8000-000000000201'::uuid,
     'e8000000-0000-4000-8000-000000000002'::uuid,
     'thread-key-1',
     'Hello quick question',
     'quick'
   ) as r) s),
  'replaying the same key and body returns the kept thread, not a twin'
);

-- 5. Conflict different body ------------------------------------------------------------

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

-- 6. Message append replay ----------------------------------------------------------------

select extensions.ok(
  (select (s.r ->> 'messageId') = (select m.r ->> 'messageId' from t_msg_a m)
     and (s.r ->> 'replayed')::boolean
     and (select count(*)::integer from public.agent_messages
       where organization_id = 'e8000000-0000-4000-8000-000000000201'::uuid) = 1
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

-- 7. Worker link update fenced -----------------------------------------------------------------

select extensions.throws_ok(
  $_$select public.set_thread_links(
    'e8000000-0000-4000-8000-000000000201'::uuid,
    'e8000000-0000-4000-8000-000000000002'::uuid,
    'e8000000-0000-4000-8000-000000000202'::uuid,
    'e8000000-0000-4000-8000-000000000301'::uuid,
    null, null, null
  )$_$,
  '42501', null,
  'a link update naming another tenant thread is refused even with a valid membership'
);

-- 8. Purge removes bodies only with audit kept ----------------------------------------------------
--
-- The worker (service_role) links thread A, then the register is aged past
-- retention while tenant B stays current. The purge scrubs A payloads and
-- must leave every identifier row plus the fresh tenant B body alone.

reset role;

update public.agent_threads
set updated_at = pg_catalog.now() - interval '100 days'
where id = (select (r ->> 'threadId')::uuid from t_thread_a);

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
       where thread_id = ta.id) = 1
     and (select count(*)::integer from public.agent_threads
       where id = ta.id) = 1
     and th.linked_research_project_id is not null
     and th.linked_request_id is not null
     and th.linked_draft_request_id is not null
     and th.linked_campaign_id is not null
     and (select mb.body is not null from public.agent_messages mb
       where mb.thread_id = tb.id)
   from (select (r ->> 'threadId')::uuid as id from t_thread_a) ta
   cross join (select (r ->> 'threadId')::uuid as id from t_thread_b) tb
   join public.agent_messages msg on msg.thread_id = ta.id
   join public.agent_threads th on th.id = ta.id),
  'purge scrubs aged bodies while the thread, the message row, the worker links and the fresh tenant stay'
);

select * from extensions.finish();

rollback;
