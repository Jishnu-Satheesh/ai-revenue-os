begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(78);

-- Covers `20261001023608_agent_durable_turns.sql`.
--
-- Like a coat-check desk: each guest's ticket opens only their own locker
-- (member isolation), a looker may read the board but never take a ticket
-- (viewer refused at create), handing over the same ticket twice returns
-- the same coat (idempotent replay) while a forged ticket is refused
-- (key conflict), only the attendant holding the claim token may move a
-- coat (lease fencing), and one ticket yields exactly one finished parcel
-- (terminal uniqueness). Rollback-wrapped.
--
-- Pre-push this suite ERRORS (tables/RPCs absent) — expected until the
-- migration is pushed. Post-push it must be fully green, and every new
-- PL/pgSQL reader of existing tables gets its first real call here.

-- Fixtures ---------------------------------------------------------------------

insert into auth.users (id) values
  ('ea000000-0000-4000-8000-000000000001'::uuid),
  ('ea000000-0000-4000-8000-000000000002'::uuid),
  ('ea000000-0000-4000-8000-000000000003'::uuid),
  ('ea000000-0000-4000-8000-000000000004'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('ea000000-0000-4000-8000-000000000101'::uuid, 'Turns agency A', 'turns-agency-a', 'ea000000-0000-4000-8000-000000000001'::uuid),
  ('ea000000-0000-4000-8000-000000000102'::uuid, 'Turns agency B', 'turns-agency-b', 'ea000000-0000-4000-8000-000000000004'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('ea000000-0000-4000-8000-000000000201'::uuid, 'ea000000-0000-4000-8000-000000000101'::uuid, 'Turns client A', 'turns-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'ea000000-0000-4000-8000-000000000001'::uuid),
  ('ea000000-0000-4000-8000-000000000202'::uuid, 'ea000000-0000-4000-8000-000000000102'::uuid, 'Turns client B', 'turns-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'ea000000-0000-4000-8000-000000000004'::uuid);

insert into public.organization_memberships (organization_id, user_id, role) values
  ('ea000000-0000-4000-8000-000000000201'::uuid, 'ea000000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('ea000000-0000-4000-8000-000000000201'::uuid, 'ea000000-0000-4000-8000-000000000002'::uuid, 'operator'),
  ('ea000000-0000-4000-8000-000000000201'::uuid, 'ea000000-0000-4000-8000-000000000003'::uuid, 'viewer'),
  ('ea000000-0000-4000-8000-000000000202'::uuid, 'ea000000-0000-4000-8000-000000000004'::uuid, 'owner');

set local role authenticated;
set local request.jwt.claim.sub = 'ea000000-0000-4000-8000-000000000002';

-- One thread + user message per tenant through the governed thread RPCs.
create temp table t_thread_a as
select public.create_agent_thread_keyed(
  'ea000000-0000-4000-8000-000000000201'::uuid,
  'ea000000-0000-4000-8000-000000000002'::uuid,
  'turn-thread-key-a',
  'Talabat check',
  'quick'
) as r;
grant select on t_thread_a to public;

create temp table t_msg_a as
select public.append_agent_message(
  'ea000000-0000-4000-8000-000000000201'::uuid,
  'ea000000-0000-4000-8000-000000000002'::uuid,
  (select (r ->> 'threadId')::uuid from t_thread_a),
  'user',
  'Assess our Talabat channel.',
  'turn-msg-key-a'
) as r;
grant select on t_msg_a to public;

set local request.jwt.claim.sub = 'ea000000-0000-4000-8000-000000000004';

create temp table t_thread_b as
select public.create_agent_thread_keyed(
  'ea000000-0000-4000-8000-000000000202'::uuid,
  'ea000000-0000-4000-8000-000000000004'::uuid,
  'turn-thread-key-b',
  'Other tenant thread',
  'quick'
) as r;
grant select on t_thread_b to public;

create temp table t_msg_b as
select public.append_agent_message(
  'ea000000-0000-4000-8000-000000000202'::uuid,
  'ea000000-0000-4000-8000-000000000004'::uuid,
  (select (r ->> 'threadId')::uuid from t_thread_b),
  'user',
  'Other tenant message.',
  'turn-msg-key-b'
) as r;
grant select on t_msg_b to public;

-- 1. A viewer cannot claim another member's user message ------------------------------------------------

set local request.jwt.claim.sub = 'ea000000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$select public.create_agent_turn(
    'ea000000-0000-4000-8000-000000000201'::uuid,
    'ea000000-0000-4000-8000-000000000003'::uuid,
    (select (r ->> 'threadId')::uuid from t_thread_a),
    (select (r ->> 'messageId')::uuid from t_msg_a),
    'turn-key-viewer-0001',
    'business_advice'
  )$$,
  '42501', null,
  'viewer cannot start a turn from another member message'
);

-- 2. Operator creates a channel-assessment turn ---------------------------------

set local request.jwt.claim.sub = 'ea000000-0000-4000-8000-000000000002';

create temp table t_turn_a as
select public.create_agent_turn(
  'ea000000-0000-4000-8000-000000000201'::uuid,
  'ea000000-0000-4000-8000-000000000002'::uuid,
  (select (r ->> 'threadId')::uuid from t_thread_a),
  (select (r ->> 'messageId')::uuid from t_msg_a),
  'turn-key-operator-001',
  'channel_assessment'
) as r;
grant select on t_turn_a to public;

select extensions.ok(
  (select (r ->> 'replayed')::boolean = false from t_turn_a),
  'operator turn creation succeeds fresh'
);

-- 3. Same key + message replays --------------------------------------------------

select extensions.ok(
  (select (r ->> 'replayed')::boolean = true
     and (r ->> 'turnId') = (select r ->> 'turnId' from t_turn_a)
   from public.create_agent_turn(
    'ea000000-0000-4000-8000-000000000201'::uuid,
    'ea000000-0000-4000-8000-000000000002'::uuid,
    (select (r ->> 'threadId')::uuid from t_thread_a),
    (select (r ->> 'messageId')::uuid from t_msg_a),
    'turn-key-operator-001',
    'channel_assessment'
  ) as r),
  'same idempotency key replays the kept turn'
);

-- 4. Same message with a different key conflicts ---------------------------------

select extensions.throws_ok(
  $$select public.create_agent_turn(
    'ea000000-0000-4000-8000-000000000201'::uuid,
    'ea000000-0000-4000-8000-000000000002'::uuid,
    (select (r ->> 'threadId')::uuid from t_thread_a),
    (select (r ->> 'messageId')::uuid from t_msg_a),
    'turn-key-operator-002',
    'channel_assessment'
  )$$,
  '23505', null,
  'one user message owns at most one turn'
);

-- 5. Cross-organization turns stay invisible -------------------------------------

select extensions.is(
  (select count(*)::bigint from public.agent_turns),
  1::bigint,
  'operator in org A sees only the org A turn'
);

set local request.jwt.claim.sub = 'ea000000-0000-4000-8000-000000000004';

select extensions.is(
  (select count(*)::bigint from public.agent_turns),
  0::bigint,
  'owner in org B sees none of org A turns'
);

-- 6. Worker claims under a fresh lease --------------------------------------------

set local role service_role;

create temp table t_claim as
select public.claim_agent_turn(
  'ea000000-0000-4000-8000-000000000201'::uuid,
  (select (r ->> 'turnId')::uuid from t_turn_a),
  'ea000000-0000-4000-8000-000000000301'::uuid
) as r;
grant select on t_claim to public;

select extensions.ok(
  (select (r ->> 'status') = 'running' from t_claim),
  'worker claim moves the turn to running'
);

-- 7. A second claim under a live lease is stale ------------------------------------

select extensions.throws_ok(
  $$select public.claim_agent_turn(
    'ea000000-0000-4000-8000-000000000201'::uuid,
    (select (r ->> 'turnId')::uuid from t_turn_a),
    'ea000000-0000-4000-8000-000000000302'::uuid
  )$$,
  '23505', null,
  'live lease fences a second claim'
);

-- 8. Lease-gated event append + replay ----------------------------------------------

create temp table t_event as
select public.append_agent_turn_event(
  'ea000000-0000-4000-8000-000000000201'::uuid,
  (select (r ->> 'turnId')::uuid from t_turn_a),
  'ea000000-0000-4000-8000-000000000301'::uuid,
  'period:2026-09-01:2026-09-30:2026-08-01:2026-08-31',
  'period_switched',
  '{"requestedStart":"2026-09-01","requestedEnd":"2026-09-30","selectedStart":"2026-08-01","selectedEnd":"2026-08-31","reason":"The requested period has no usable governed report."}'::jsonb
) as r;
grant select on t_event to public;

select extensions.ok(
  (select (r ->> 'replayed')::boolean = false and (r ->> 'seq')::integer = 2 from t_event),
  'period switch appends as the second ordered event'
);

select extensions.ok(
  (select (r ->> 'replayed')::boolean = true
   from public.append_agent_turn_event(
    'ea000000-0000-4000-8000-000000000201'::uuid,
    (select (r ->> 'turnId')::uuid from t_turn_a),
    'ea000000-0000-4000-8000-000000000301'::uuid,
    'period:2026-09-01:2026-09-30:2026-08-01:2026-08-31',
    'period_switched',
    '{"requestedStart":"2026-09-01","requestedEnd":"2026-09-30","selectedStart":"2026-08-01","selectedEnd":"2026-08-31","reason":"The requested period has no usable governed report."}'::jsonb
  ) as r),
  'same event key replays instead of duplicating the marker'
);

-- 9. Wrong lease cannot append ---------------------------------------------------------

select extensions.throws_ok(
  $$select public.append_agent_turn_event(
    'ea000000-0000-4000-8000-000000000201'::uuid,
    (select (r ->> 'turnId')::uuid from t_turn_a),
    'ea000000-0000-4000-8000-000000000302'::uuid,
    'analysis:x:started',
    'analysis_started',
    '{}'::jsonb
  )$$,
  '23505', null,
  'event append without the live lease is refused'
);

-- 10. Terminal completion writes exactly one final message -------------------------------

create temp table t_complete as
select public.complete_agent_turn(
  'ea000000-0000-4000-8000-000000000201'::uuid,
  (select (r ->> 'turnId')::uuid from t_turn_a),
  'ea000000-0000-4000-8000-000000000301'::uuid,
  'Talabat review is ready.'
) as r;
grant select on t_complete to public;

select extensions.ok(
  (select (r ->> 'replayed')::boolean = false
     and (select count(*)::integer from public.agent_messages
       where turn_id = (select (r ->> 'turnId')::uuid from t_turn_a)
         and role = 'assistant') = 1
   from t_complete),
  'completion persists exactly one final assistant message'
);

-- 11. Completion replays the kept message id -----------------------------------------------

select extensions.ok(
  (select (r ->> 'replayed')::boolean = true
     and (r ->> 'messageId') = (select r ->> 'messageId' from t_complete)
   from public.complete_agent_turn(
    'ea000000-0000-4000-8000-000000000201'::uuid,
    (select (r ->> 'turnId')::uuid from t_turn_a),
    'ea000000-0000-4000-8000-000000000301'::uuid,
    'Talabat review is ready.'
  ) as r),
  'terminal replay returns the kept final message instead of a second row'
);


-- New durable contracts: first-call every bridge on real source-owned rows.
reset role;
insert into public.branches(id,organization_id,name,slug,timezone,currency)
values('ea000000-0000-4000-8000-000000000401','ea000000-0000-4000-8000-000000000201','Turns outlet','turns-outlet','Asia/Dubai','AED');
insert into public.organization_channels(id,organization_id,key,display_name,category,created_by)
values('ea000000-0000-4000-8000-000000000402','ea000000-0000-4000-8000-000000000201','turns-channel','Turns channel','marketplace','ea000000-0000-4000-8000-000000000001');
create function pg_temp.org_a() returns uuid language sql as $$select 'ea000000-0000-4000-8000-000000000201'::uuid$$;
create function pg_temp.operator_a() returns uuid language sql as $$select 'ea000000-0000-4000-8000-000000000002'::uuid$$;
create function pg_temp.viewer_a() returns uuid language sql as $$select 'ea000000-0000-4000-8000-000000000003'::uuid$$;
create function pg_temp.lease_a() returns uuid language sql as $$select 'ea000000-0000-4000-8000-000000000301'::uuid$$;
create function pg_temp.scope_a() returns jsonb language sql as $$select '{"channelId":"ea000000-0000-4000-8000-000000000402","branchId":"ea000000-0000-4000-8000-000000000401","reportType":"performance_daily","periodStart":"2026-08-01","periodEnd":"2026-08-31","currency":"AED"}'::jsonb$$;

set local role authenticated;
set local request.jwt.claim.sub='ea000000-0000-4000-8000-000000000003';
create temp table t_viewer_thread as select public.create_agent_thread_keyed(pg_temp.org_a(),pg_temp.viewer_a(),'viewer-quick-turns','Viewer advice','quick') r;
grant select on t_viewer_thread to public;
select extensions.ok((select r->>'threadId' is not null from t_viewer_thread),'viewer creates own read-only quick chat');
select extensions.throws_ok($q$select public.create_agent_thread_keyed(pg_temp.org_a(),pg_temp.viewer_a(),'viewer-deepthink-turns','Viewer research','deepthink')$q$,'42501',null,'viewer cannot create a research-mode thread');
create temp table t_viewer_message as select public.append_agent_message(pg_temp.org_a(),pg_temp.viewer_a(),(select (r->>'threadId')::uuid from t_viewer_thread),'user','How can I improve my business?','viewer-advice-message') r;
grant select on t_viewer_message to public;
create temp table t_viewer_turn as select public.create_agent_turn(pg_temp.org_a(),pg_temp.viewer_a(),(select (r->>'threadId')::uuid from t_viewer_thread),(select (r->>'messageId')::uuid from t_viewer_message),'viewer-advice-turn-01','business_advice') r;
grant select on t_viewer_turn to public;
select extensions.ok((select r->>'turnId' is not null from t_viewer_turn),'viewer creates a read-only advice turn from own question');
select extensions.throws_ok($q$select public.append_agent_message(pg_temp.org_a(),pg_temp.viewer_a(),(select (r->>'threadId')::uuid from t_viewer_thread),'assistant','Fabricated result','viewer-assistant-message')$q$,'42501',null,'viewer cannot forge an assistant response');
select extensions.throws_ok($q$select public.create_agent_turn(pg_temp.org_a(),pg_temp.viewer_a(),(select (r->>'threadId')::uuid from t_viewer_thread),(select (r->>'messageId')::uuid from t_viewer_message),'viewer-report-turn-01','report_intake')$q$,'42501',null,'viewer cannot start report intake');
select extensions.throws_ok($q$select public.claim_agent_turn(pg_temp.org_a(),(select (r->>'turnId')::uuid from t_viewer_turn),pg_temp.lease_a())$q$,'42501',null,'members cannot claim worker leases');
set local role service_role;
select extensions.lives_ok($q$select public.claim_agent_turn(pg_temp.org_a(),(select (r->>'turnId')::uuid from t_viewer_turn),pg_temp.lease_a())$q$,'worker may claim viewer read-only advice');
select extensions.is(public.get_agent_turn_actor_role(pg_temp.org_a(),(select (r->>'turnId')::uuid from t_viewer_turn),pg_temp.lease_a())->>'role','viewer','role RPC returns live viewer role');
select extensions.lives_ok($q$select public.heartbeat_agent_turn(pg_temp.org_a(),(select (r->>'turnId')::uuid from t_viewer_turn),pg_temp.lease_a())$q$,'heartbeat renews a live lease');
select extensions.throws_ok($q$select public.cancel_revoked_agent_turn(pg_temp.org_a(),(select (r->>'turnId')::uuid from t_viewer_turn))$q$,'23505',null,'worker cannot revoke a still-authorized actor');
select extensions.is(public.release_agent_turn_for_retry(pg_temp.org_a(),(select (r->>'turnId')::uuid from t_viewer_turn),pg_temp.lease_a())->>'status','queued','transient retry releases its matching lease');
select extensions.lives_ok($q$select public.claim_agent_turn(pg_temp.org_a(),(select (r->>'turnId')::uuid from t_viewer_turn),pg_temp.lease_a())$q$,'released work can be claimed immediately');
select extensions.is(public.fail_agent_turn(pg_temp.org_a(),(select (r->>'turnId')::uuid from t_viewer_turn),pg_temp.lease_a(),'SOURCE_UNAVAILABLE')->>'status','failed','failure settles its fenced turn');
select extensions.is(public.release_agent_turn_for_retry(pg_temp.org_a(),(select (r->>'turnId')::uuid from t_viewer_turn),pg_temp.lease_a())->>'status','failed','retry release never reopens terminal work');

set local role authenticated;
set local request.jwt.claim.sub='ea000000-0000-4000-8000-000000000002';
create temp table t_report_message as select public.append_agent_message(pg_temp.org_a(),pg_temp.operator_a(),(select (r->>'threadId')::uuid from t_thread_a),'user','Here is the August performance report.','report-intake-message-01') r;
grant select on t_report_message to public;
create temp table t_report_turn as select public.create_agent_turn(pg_temp.org_a(),pg_temp.operator_a(),(select (r->>'threadId')::uuid from t_thread_a),(select (r->>'messageId')::uuid from t_report_message),'report-intake-turn-01','report_intake') r;
grant select on t_report_turn to public;
create temp table t_attachment as select public.create_agent_attachment_intent(pg_temp.org_a(),pg_temp.operator_a(),(select (r->>'turnId')::uuid from t_report_turn),'report.csv','text/csv',8,'report-attachment-intent-01') r;
grant select on t_attachment to public;
create function pg_temp.report_turn() returns uuid language sql as $$select (r->>'turnId')::uuid from t_report_turn$$;
create function pg_temp.attachment() returns uuid language sql as $$select (r->>'attachmentId')::uuid from t_attachment$$;
select extensions.ok((select (r->>'replayed')::boolean=false from t_attachment),'private staging intent created once');
select extensions.ok((public.create_agent_attachment_intent(pg_temp.org_a(),pg_temp.operator_a(),pg_temp.report_turn(),'report.csv','text/csv',8,'report-attachment-intent-01')->>'replayed')::boolean,'matching staging intent replays before expiry');
select extensions.throws_ok($q$select public.create_agent_attachment_intent(pg_temp.org_a(),pg_temp.operator_a(),pg_temp.report_turn(),'different.csv','text/csv',8,'report-attachment-intent-01')$q$,'23505',null,'changed upload metadata cannot reuse an intent');
select extensions.lives_ok($q$select public.declare_agent_attachment_scope(pg_temp.org_a(),pg_temp.operator_a(),pg_temp.report_turn(),pg_temp.attachment(),null)$q$,'scope can remain unresolved pending Questionnaire');
set local role service_role;
select extensions.lives_ok($q$select public.claim_agent_turn(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.lease_a())$q$,'report continuation acquires its lease');
select extensions.lives_ok($q$select public.authorize_agent_attachment_work(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.attachment(),pg_temp.lease_a())$q$,'attachment byte read authorization rechecks actor and lease');
create temp table t_metadata_question as select public.set_agent_turn_challenge(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.lease_a(),'metadata','[{"key":"periodStart","label":"Period start","kind":"date","required":true}]'::jsonb) r;
grant select on t_metadata_question to public;
select extensions.is((select r->>'status' from t_metadata_question),'awaiting_user','metadata Questionnaire asks only unresolved fields');
set local role authenticated;
select extensions.throws_ok($q$select public.answer_agent_turn_challenge(pg_temp.org_a(),pg_temp.operator_a(),pg_temp.report_turn(),(select (r->>'challengeId')::uuid from t_metadata_question),'metadata-answer-invalid','{"periodStart":"2026-08-01","currency":"AED"}'::jsonb)$q$,'22023',null,'unissued answer fields are refused');
select extensions.lives_ok($q$select public.answer_agent_turn_challenge(pg_temp.org_a(),pg_temp.operator_a(),pg_temp.report_turn(),(select (r->>'challengeId')::uuid from t_metadata_question),'metadata-answer-start','{"periodStart":"2026-08-01"}'::jsonb)$q$,'issued date answer resumes work');
set local role service_role;
select public.claim_agent_turn(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.lease_a());
create temp table t_metadata_question_2 as select public.set_agent_turn_challenge(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.lease_a(),'metadata','[{"key":"periodEnd","label":"Period end","kind":"date","required":true}]'::jsonb) r;
grant select on t_metadata_question_2 to public;
set local role authenticated;
select public.answer_agent_turn_challenge(pg_temp.org_a(),pg_temp.operator_a(),pg_temp.report_turn(),(select (r->>'challengeId')::uuid from t_metadata_question_2),'metadata-answer-end-01','{"periodEnd":"2026-08-31"}'::jsonb);
select extensions.ok((select challenge_answers ?& array['periodStart','periodEnd'] from public.agent_turns where id=pg_temp.report_turn()),'later metadata answers preserve earlier validated answers');
select extensions.ok((public.answer_agent_turn_challenge(pg_temp.org_a(),pg_temp.operator_a(),pg_temp.report_turn(),(select (r->>'challengeId')::uuid from t_metadata_question),'metadata-answer-start','{"periodStart":"2026-08-01"}'::jsonb)->>'replayed')::boolean,'earlier answer retry compares its own digest after later answers');
select extensions.throws_ok($q$select public.answer_agent_turn_challenge(pg_temp.org_a(),pg_temp.operator_a(),pg_temp.report_turn(),(select (r->>'challengeId')::uuid from t_metadata_question),'metadata-answer-start','{"periodStart":"2026-07-01"}'::jsonb)$q$,'23505',null,'changed challenge answer under same key conflicts');
set local role service_role;
select public.claim_agent_turn(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.lease_a());
select extensions.throws_ok($q$select public.apply_agent_attachment_scope_from_challenge(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.attachment(),pg_temp.lease_a())$q$,'22023',null,'legacy full-scope bridge refuses incomplete scope');
select extensions.lives_ok($q$select public.resolve_agent_attachment_scope(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.attachment(),pg_temp.lease_a(),pg_temp.scope_a())$q$,'worker resolves complete merged scope against source channel and branch');
select extensions.lives_ok($q$select public.resolve_agent_attachment_scope(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.attachment(),pg_temp.lease_a(),pg_temp.scope_a())$q$,'merged scope replay is idempotent');
select extensions.throws_ok($q$select public.resolve_agent_attachment_scope(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.attachment(),pg_temp.lease_a(),jsonb_set(pg_temp.scope_a(),'{branchId}','"ea000000-0000-4000-8000-000000000499"'))$q$,'22023',null,'foreign or missing branch scope is refused');
reset role;
insert into storage.objects(bucket_id,name,metadata) select r->>'storageBucketId',r->>'storagePath','{"size":8,"mimetype":"text/csv"}'::jsonb from t_attachment;
set local role service_role;
select extensions.lives_ok($q$select public.verify_agent_attachment(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.attachment(),pg_temp.lease_a(),repeat('a',64))$q$,'verified staged bytes record a digest behind the live lease');
create temp table t_package as select public.begin_agent_report_package(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.attachment(),pg_temp.lease_a()) r;
grant select on t_package to public;
create function pg_temp.package_id() returns uuid language sql as $$select (r->>'packageId')::uuid from t_package$$;
select extensions.ok((select r->>'packageId' is not null from t_package),'worker bridge invokes governed upload intent with real source rows');
select extensions.is(public.begin_agent_report_package(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.attachment(),pg_temp.lease_a())->>'packageId',pg_temp.package_id()::text,'governed package creation replays the same package');
select extensions.throws_ok($q$select public.complete_agent_report_package(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.attachment(),pg_temp.lease_a(),repeat('a',64))$q$,'22023',null,'promotion waits for exact destination object');
reset role;
insert into storage.objects(bucket_id,name,metadata) select r->>'storageBucketId',r->>'storagePath','{"size":8,"mimetype":"text/csv"}'::jsonb from t_package;
set local role service_role;
select extensions.is(public.complete_agent_report_package(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.attachment(),pg_temp.lease_a(),repeat('a',64))->>'status','uploaded','source upload completion accepts verified destination bytes');
select extensions.ok((public.complete_agent_report_package(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.attachment(),pg_temp.lease_a(),repeat('a',64))->>'replayed')::boolean,'storage-copy recovery returns the kept completion');
select extensions.throws_ok($q$select public.promote_agent_attachment(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.attachment(),pg_temp.lease_a(),pg_temp.package_id(),repeat('b',64))$q$,'23505',null,'digest disagreement blocks package reuse');
select extensions.throws_ok($q$select public.promote_agent_attachment(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.attachment(),pg_temp.lease_a(),pg_temp.package_id(),repeat('a',64))$q$,'23505',null,'source profiling must verify its digest before reuse');
select extensions.is(public.set_agent_turn_approval(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.lease_a(),'report_contract',pg_temp.package_id())->>'status','awaiting_approval','worker pauses at source-owned contract approval');
select extensions.throws_ok($q$select public.resume_agent_turn_approval(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.package_id())$q$,'23505',null,'upload does not grant a contract approval');

-- Revocation is checked again after the upload and while work is waiting.
reset role;
set local request.jwt.claim.sub='';
update public.organization_memberships set role='viewer' where organization_id=pg_temp.org_a() and user_id=pg_temp.operator_a();
set local role service_role;
select extensions.throws_ok($q$select public.resume_agent_turn_approval(pg_temp.org_a(),pg_temp.report_turn(),pg_temp.package_id())$q$,'42501',null,'revoked report permission stops approval continuation');
select extensions.is(public.cancel_revoked_agent_turn(pg_temp.org_a(),pg_temp.report_turn())->>'status','cancelled','revoked awaiting work settles with an audit event');
select extensions.is(public.cancel_revoked_agent_turn(pg_temp.org_a(),pg_temp.report_turn())->>'status','cancelled','revocation cancellation is idempotent');
reset role;
set local request.jwt.claim.sub='';
update public.organization_memberships set role='operator' where organization_id=pg_temp.org_a() and user_id=pg_temp.operator_a();
update public.agent_attachments set upload_expires_at=now()-interval '1 hour' where id=pg_temp.attachment();
set local role service_role;
create temp table t_purge as select public.purge_expired_agent_threads(now()-interval '90 days') r;
grant select on t_purge to public;
select extensions.ok((select jsonb_array_length(r->'stagingObjects')>=1 from t_purge),'short-lived staging cleanup includes promoted source copy after expiry');
select extensions.is((select status from public.agent_attachments where id=pg_temp.attachment()),'promoted','staging expiry preserves governed package linkage');
select extensions.lives_ok($q$select public.mark_agent_attachment_staging_deleted(array[pg_temp.attachment()])$q$,'successful Storage deletion gets a durable cleanup acknowledgement');
select extensions.ok(not exists(select 1 from jsonb_array_elements(public.purge_expired_agent_threads(now()-interval '90 days')->'stagingObjects') o where o->>'attachmentId'=pg_temp.attachment()::text),'acknowledged staging object is not repeatedly returned');
reset role;
insert into public.agent_threads(id,organization_id,created_by,title,mode,created_at,updated_at)
values('ea000000-0000-4000-8000-000000000998',pg_temp.org_a(),pg_temp.operator_a(),'Aged retention fixture','quick',now()-interval '100 days',now()-interval '100 days');
update public.agent_messages set thread_id='ea000000-0000-4000-8000-000000000998' where organization_id=pg_temp.org_a();
update public.agent_turns set thread_id='ea000000-0000-4000-8000-000000000998' where organization_id=pg_temp.org_a();
set local role service_role;
select extensions.lives_ok($q$select public.purge_expired_agent_threads(now()-interval '90 days')$q$,'thread retention scrubs message and turn payloads without deleting lineage');
select extensions.ok(not exists(select 1 from public.agent_turns where organization_id=pg_temp.org_a() and (challenge_answers is not null or pending_challenge is not null or pending_approval is not null)),'retention removes Questionnaire and approval content');
select extensions.ok(not exists(select 1 from public.agent_turn_events where organization_id=pg_temp.org_a() and payload<>'{}'::jsonb),'retention removes event payloads while retaining event identifiers');


-- A human-approved per-upload mapping can continue without standing admission.
reset role;
insert into auth.users (id) values
  ('e9100000-0000-4000-8000-000000000001'::uuid);
insert into public.accounts (id, name, slug, created_by)
values ('e9100000-0000-4000-8000-000000000101'::uuid, 'Projection admission verifier', 'agent-bridge-projection-verifier', 'e9100000-0000-4000-8000-000000000001'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by)
values ('e9100000-0000-4000-8000-000000000201'::uuid, 'e9100000-0000-4000-8000-000000000101'::uuid, 'Projection admission verifier', 'agent-bridge-projection-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'e9100000-0000-4000-8000-000000000001'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role)
values ('e9100000-0000-4000-8000-000000000101'::uuid, 'e9100000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');
insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('e9100000-0000-4000-8000-000000000301'::uuid, 'e9100000-0000-4000-8000-000000000201'::uuid, 'Projection admission outlet', 'agent-bridge-outlet', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('e9100000-0000-4000-8000-000000000401'::uuid, 'e9100000-0000-4000-8000-000000000201'::uuid, 'agent-bridge-channel', 'Projection admission channel', 'marketplace', 'e9100000-0000-4000-8000-000000000001'::uuid);

insert into storage.objects (bucket_id, name, metadata, version)
select 'governed-report-packages',
  'e9100000-0000-4000-8000-000000000201/e9100000-0000-4000-8000-000000000401/' || package_id || '/1/original/report.csv',
  jsonb_build_object('size', 42, 'mimetype', 'text/csv'), 'admission-' || ordinal
from (values
  ('e9100000-0000-4000-8000-000000000501', 1), ('e9100000-0000-4000-8000-000000000502', 2),
  ('e9100000-0000-4000-8000-000000000503', 3), ('e9100000-0000-4000-8000-000000000504', 4)
) as packages(package_id, ordinal);

-- Packages first: contract versions point at them, while the admission link
-- points back at the admission -- so the link is set by update below, once
-- the admission exists. The write-once guard allows null to a first value.
insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, storage_object_id, storage_object_version, content_sha256, schema_fingerprint, structure_fingerprint,
  status, upload_expires_at, uploaded_at, profiled_at, created_by, correlation_id
)
select package_id::uuid, 'e9100000-0000-4000-8000-000000000201'::uuid,
  'e9100000-0000-4000-8000-000000000401'::uuid, 'e9100000-0000-4000-8000-000000000301'::uuid,
  'performance_daily', date '2026-05-01', date '2026-05-31', 'AED', 'Asia/Dubai', 'csv', 'report.csv', 'text/csv', 42,
  o.name, o.id, o.version, content_sha256, repeat('b', 64), structure_fp, 'validated', now() + interval '1 hour', now(), now(),
  'e9100000-0000-4000-8000-000000000001'::uuid, correlation_id::uuid
from (values
  ('e9100000-0000-4000-8000-000000000501', repeat('e', 64), repeat('a', 64), 'e9100000-0000-4000-8000-000000000621'),
  ('e9100000-0000-4000-8000-000000000502', repeat('e', 64), repeat('a', 64), 'e9100000-0000-4000-8000-000000000622'),
  ('e9100000-0000-4000-8000-000000000503', repeat('e', 64), repeat('f', 64), 'e9100000-0000-4000-8000-000000000623'),
  ('e9100000-0000-4000-8000-000000000504', repeat('e', 64), repeat('a', 64), 'e9100000-0000-4000-8000-000000000624')
) as p(package_id, content_sha256, structure_fp, correlation_id)
join storage.objects o on o.bucket_id = 'governed-report-packages'
  and o.name = 'e9100000-0000-4000-8000-000000000201/e9100000-0000-4000-8000-000000000401/' || p.package_id || '/1/original/report.csv';

insert into public.report_contracts (id, organization_id, channel_id, report_type, outlet_grain, created_by)
values ('e9100000-0000-4000-8000-000000000601'::uuid, 'e9100000-0000-4000-8000-000000000201'::uuid, 'e9100000-0000-4000-8000-000000000401'::uuid, 'performance_daily', 'branch', 'e9100000-0000-4000-8000-000000000001'::uuid);

insert into public.report_contract_versions (
  id, organization_id, report_contract_id, report_package_id, version, schema_fingerprint, parser_version, fingerprint_version,
  mapping_document, mapping_digest, declared_currency, financial_sign_semantics, controls, unmapped_field_disposition, proposal_source, created_by, correlation_id
) values
  ('e9100000-0000-4000-8000-000000000602'::uuid, 'e9100000-0000-4000-8000-000000000201'::uuid, 'e9100000-0000-4000-8000-000000000601'::uuid,
   'e9100000-0000-4000-8000-000000000501'::uuid, 1, repeat('b', 64), 1, 3,
   '{}'::jsonb, repeat('c', 64), 'AED', '[]'::jsonb, '[]'::jsonb, 'reviewed_ignore', 'human', 'e9100000-0000-4000-8000-000000000001'::uuid, 'e9100000-0000-4000-8000-000000000606'::uuid);

insert into public.report_contract_decisions (organization_id, report_contract_version_id, decision, mapping_digest, decided_by, correlation_id)
values ('e9100000-0000-4000-8000-000000000201'::uuid, 'e9100000-0000-4000-8000-000000000602'::uuid, 'approved', repeat('c', 64), 'e9100000-0000-4000-8000-000000000001'::uuid, 'e9100000-0000-4000-8000-000000000607'::uuid);

insert into public.report_contract_bindings (id, organization_id, report_contract_id, report_contract_version_id, channel_id, report_type, schema_fingerprint, declared_currency, outlet_grain, bound_by, correlation_id)
values ('e9100000-0000-4000-8000-000000000603'::uuid, 'e9100000-0000-4000-8000-000000000201'::uuid, 'e9100000-0000-4000-8000-000000000601'::uuid, 'e9100000-0000-4000-8000-000000000602'::uuid, 'e9100000-0000-4000-8000-000000000401'::uuid, 'performance_daily', repeat('b', 64), 'AED', 'branch', 'e9100000-0000-4000-8000-000000000001'::uuid, 'e9100000-0000-4000-8000-000000000608'::uuid);

insert into public.report_projection_versions (id, organization_id, report_contract_version_id, version, projection_document, projection_digest, calculation_version, proposal_source, created_by, correlation_id)
values ('e9100000-0000-4000-8000-000000000604'::uuid, 'e9100000-0000-4000-8000-000000000201'::uuid, 'e9100000-0000-4000-8000-000000000602'::uuid, 1,
  '{"schemaVersion":1,"outputKind":"exact_range","outputs":[{"key":"gross_revenue","metricKey":"revenue.gross","valueKind":"money","aggregation":"sum","normalizedSheetName":"csv","canonicalField":"net_sales"}],"controlTotals":[]}'::jsonb,
  repeat('d', 64), 1, 'human', 'e9100000-0000-4000-8000-000000000001'::uuid, 'e9100000-0000-4000-8000-000000000609'::uuid);

insert into public.report_projection_decisions (organization_id, report_projection_version_id, decision, projection_digest, decided_by, correlation_id)
values ('e9100000-0000-4000-8000-000000000201'::uuid, 'e9100000-0000-4000-8000-000000000604'::uuid, 'approved', repeat('d', 64), 'e9100000-0000-4000-8000-000000000001'::uuid, 'e9100000-0000-4000-8000-000000000610'::uuid);

insert into public.report_projection_bindings (id, organization_id, report_contract_version_id, report_contract_binding_id, report_projection_version_id, schema_fingerprint, declared_currency, bound_by, correlation_id)
values ('e9100000-0000-4000-8000-000000000605'::uuid, 'e9100000-0000-4000-8000-000000000201'::uuid, 'e9100000-0000-4000-8000-000000000602'::uuid, 'e9100000-0000-4000-8000-000000000603'::uuid, 'e9100000-0000-4000-8000-000000000604'::uuid, repeat('b', 64), 'AED', 'e9100000-0000-4000-8000-000000000001'::uuid, 'e9100000-0000-4000-8000-000000000611'::uuid);

insert into public.integration_report_validation_runs (id, organization_id, report_package_id, report_contract_version_id, report_contract_binding_id, validator_version, input_digest, result_digest, status, quality_state, completeness_state, correlation_id, completed_at)
select validation_id::uuid, 'e9100000-0000-4000-8000-000000000201'::uuid, package_id::uuid, 'e9100000-0000-4000-8000-000000000602'::uuid, 'e9100000-0000-4000-8000-000000000603'::uuid, 1, repeat('e', 64), repeat('f', 64), 'validated', 'complete', 'complete', correlation_id::uuid, now()
from (values
  ('e9100000-0000-4000-8000-000000000501', 'e9100000-0000-4000-8000-000000000701', 'e9100000-0000-4000-8000-000000000631'),
  ('e9100000-0000-4000-8000-000000000502', 'e9100000-0000-4000-8000-000000000702', 'e9100000-0000-4000-8000-000000000632'),
  ('e9100000-0000-4000-8000-000000000503', 'e9100000-0000-4000-8000-000000000703', 'e9100000-0000-4000-8000-000000000633'),
  ('e9100000-0000-4000-8000-000000000504', 'e9100000-0000-4000-8000-000000000704', 'e9100000-0000-4000-8000-000000000634')
) as valueset(package_id, validation_id, correlation_id);


create function pg_temp.org_bridge() returns uuid language sql as $$select 'e9100000-0000-4000-8000-000000000201'::uuid$$;
create function pg_temp.actor_bridge() returns uuid language sql as $$select 'e9100000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.scope_bridge() returns jsonb language sql as $$select '{"channelId":"e9100000-0000-4000-8000-000000000401","branchId":"e9100000-0000-4000-8000-000000000301","reportType":"performance_daily","periodStart":"2026-05-01","periodEnd":"2026-05-31","currency":"AED"}'::jsonb$$;
set local role authenticated;
set local request.jwt.claim.sub='e9100000-0000-4000-8000-000000000001';
create temp table t_bridge_thread as select public.create_agent_thread_keyed(pg_temp.org_bridge(),pg_temp.actor_bridge(),'bridge-human-approved-thread','Correction choice','quick') r;
grant select on t_bridge_thread to public;
create temp table t_bridge_message as select public.append_agent_message(pg_temp.org_bridge(),pg_temp.actor_bridge(),(select (r->>'threadId')::uuid from t_bridge_thread),'user','Keep our previous report.','bridge-human-approved-msg') r;
grant select on t_bridge_message to public;
create temp table t_bridge_turn as select public.create_agent_turn(pg_temp.org_bridge(),pg_temp.actor_bridge(),(select (r->>'threadId')::uuid from t_bridge_thread),(select (r->>'messageId')::uuid from t_bridge_message),'bridge-human-approved-turn','report_intake') r;
grant select on t_bridge_turn to public;
create function pg_temp.bridge_turn() returns uuid language sql as $$select (r->>'turnId')::uuid from t_bridge_turn$$;
create temp table t_bridge_attachment as select public.create_agent_attachment_intent(pg_temp.org_bridge(),pg_temp.actor_bridge(),pg_temp.bridge_turn(),'report.csv','text/csv',42,'bridge-human-approved-intent') r;
grant select on t_bridge_attachment to public;
create function pg_temp.bridge_attachment() returns uuid language sql as $$select (r->>'attachmentId')::uuid from t_bridge_attachment$$;
select public.declare_agent_attachment_scope(pg_temp.org_bridge(),pg_temp.actor_bridge(),pg_temp.bridge_turn(),pg_temp.bridge_attachment(),pg_temp.scope_bridge());
reset role;
insert into storage.objects(bucket_id,name,metadata) select r->>'storageBucketId',r->>'storagePath','{"size":42,"mimetype":"text/csv"}'::jsonb from t_bridge_attachment;
set local role service_role;
select public.claim_agent_turn(pg_temp.org_bridge(),pg_temp.bridge_turn(),pg_temp.lease_a());
select public.verify_agent_attachment(pg_temp.org_bridge(),pg_temp.bridge_turn(),pg_temp.bridge_attachment(),pg_temp.lease_a(),repeat('a',64));
reset role;
set local request.jwt.claim.sub='e9100000-0000-4000-8000-000000000001';
set local role authenticated;
create temp table t_dup_message as select public.append_agent_message(pg_temp.org_bridge(),pg_temp.actor_bridge(),(select (r->>'threadId')::uuid from t_bridge_thread),'user','Review the existing report.','bridge-duplicate-message') r;
grant select on t_dup_message to public;
create temp table t_dup_turn as select public.create_agent_turn(pg_temp.org_bridge(),pg_temp.actor_bridge(),(select (r->>'threadId')::uuid from t_bridge_thread),(select (r->>'messageId')::uuid from t_dup_message),'bridge-duplicate-turn','report_intake') r;
grant select on t_dup_turn to public;
create temp table t_dup_attachment as select public.create_agent_attachment_intent(pg_temp.org_bridge(),pg_temp.actor_bridge(),(select (r->>'turnId')::uuid from t_dup_turn),'report.csv','text/csv',42,'bridge-duplicate-intent') r;
grant select on t_dup_attachment to public;
select public.declare_agent_attachment_scope(pg_temp.org_bridge(),pg_temp.actor_bridge(),(select (r->>'turnId')::uuid from t_dup_turn),(select (r->>'attachmentId')::uuid from t_dup_attachment),pg_temp.scope_bridge());
reset role;
insert into storage.objects(bucket_id,name,metadata) select r->>'storageBucketId',r->>'storagePath','{"size":42,"mimetype":"text/csv"}'::jsonb from t_dup_attachment;
set local role service_role;
select public.claim_agent_turn(pg_temp.org_bridge(),(select (r->>'turnId')::uuid from t_dup_turn),pg_temp.lease_a());
select public.verify_agent_attachment(pg_temp.org_bridge(),(select (r->>'turnId')::uuid from t_dup_turn),(select (r->>'attachmentId')::uuid from t_dup_attachment),pg_temp.lease_a(),repeat('e',64));
select extensions.lives_ok($q$select public.promote_agent_attachment(pg_temp.org_bridge(),(select (r->>'turnId')::uuid from t_dup_turn),(select (r->>'attachmentId')::uuid from t_dup_attachment),pg_temp.lease_a(),'e9100000-0000-4000-8000-000000000501',repeat('e',64))$q$,'verified equal-byte equal-scope package is reusable');
reset role;
update public.agent_attachments set declared_scope=jsonb_set(declared_scope,'{currency}','"USD"') where id=(select (r->>'attachmentId')::uuid from t_dup_attachment);
set local role service_role;
select extensions.throws_ok($q$select public.promote_agent_attachment(pg_temp.org_bridge(),(select (r->>'turnId')::uuid from t_dup_turn),(select (r->>'attachmentId')::uuid from t_dup_attachment),pg_temp.lease_a(),'e9100000-0000-4000-8000-000000000501',repeat('e',64))$q$,'23505',null,'equal bytes never override different declared currency scope');

select extensions.throws_ok($q$select public.keep_existing_agent_report_package(pg_temp.org_bridge(),pg_temp.bridge_turn(),pg_temp.bridge_attachment(),pg_temp.lease_a(),'e9100000-0000-4000-8000-000000000502')$q$,'23505',null,'a worker cannot choose an existing correction without the user choice');
create temp table t_correction_question as select public.set_agent_turn_challenge(pg_temp.org_bridge(),pg_temp.bridge_turn(),pg_temp.lease_a(),'correction','[{"key":"decision","label":"Which report?","kind":"single_select","required":true,"options":[{"value":"keep_existing","label":"Keep existing"},{"value":"submit_for_review","label":"Submit correction"}]}]'::jsonb) r;
grant select on t_correction_question to public;
set local role authenticated;
select public.answer_agent_turn_challenge(pg_temp.org_bridge(),pg_temp.actor_bridge(),pg_temp.bridge_turn(),(select (r->>'challengeId')::uuid from t_correction_question),'bridge-keep-existing-answer','{"decision":"keep_existing"}'::jsonb);
set local role service_role;
select public.claim_agent_turn(pg_temp.org_bridge(),pg_temp.bridge_turn(),pg_temp.lease_a());
select extensions.lives_ok($q$select public.keep_existing_agent_report_package(pg_temp.org_bridge(),pg_temp.bridge_turn(),pg_temp.bridge_attachment(),pg_temp.lease_a(),'e9100000-0000-4000-8000-000000000502')$q$,'human keep-existing choice binds its exact previously governed package');
select extensions.is((select status from public.agent_attachments where id=pg_temp.bridge_attachment()),'verified','keeping previous report never claims new bytes were promoted');
select extensions.lives_ok($q$select public.set_agent_turn_approval(pg_temp.org_bridge(),pg_temp.bridge_turn(),pg_temp.lease_a(),'report_projection','e9100000-0000-4000-8000-000000000502')$q$,'verified keep-existing attachment can wait at source projection approval');
select extensions.is(public.resume_agent_turn_approval(pg_temp.org_bridge(),pg_temp.bridge_turn(),'e9100000-0000-4000-8000-000000000502')->>'status','queued','recorded human projection approval permits continuation');
select public.claim_agent_turn(pg_temp.org_bridge(),pg_temp.bridge_turn(),pg_temp.lease_a());
select extensions.is(public.request_agent_report_package_projection(pg_temp.org_bridge(),pg_temp.bridge_turn(),pg_temp.bridge_attachment(),pg_temp.lease_a())->>'outcome','requested','projection request bridge executes the owning function after human approval');
select extensions.is((select status from public.integration_report_packages where id='e9100000-0000-4000-8000-000000000502'),'awaiting_projection','owning report module moves the package to projection');
select extensions.ok((select admitted_under_admission_id is null from public.integration_report_packages where id='e9100000-0000-4000-8000-000000000502'),'per-upload human approval does not manufacture standing admission');
select extensions.is(public.request_agent_report_package_projection(pg_temp.org_bridge(),pg_temp.bridge_turn(),pg_temp.bridge_attachment(),pg_temp.lease_a())->>'projectionVersionId','e9100000-0000-4000-8000-000000000604','projection request replay preserves the exact approved mapping version');
select extensions.ok(not exists(select 1 from public.agent_turns where organization_id=pg_temp.org_a() and id=pg_temp.bridge_turn()),'cross-organization turn query is still pinned after report continuation');

select extensions.throws_ok($q$select public.fail_exhausted_agent_turn(pg_temp.org_bridge(),pg_temp.bridge_turn())$q$,'23505',null,'work below the retry budget cannot be failed as exhausted');
reset role;
set local request.jwt.claim.sub='';
update public.agent_turns set attempt=20,lease_expires_at=now()-interval '1 minute' where id=pg_temp.bridge_turn();
set local role service_role;
select extensions.is(public.fail_exhausted_agent_turn(pg_temp.org_bridge(),pg_temp.bridge_turn())->>'status','failed','an exhausted abandoned turn becomes a durable failure');
select extensions.ok((public.fail_exhausted_agent_turn(pg_temp.org_bridge(),pg_temp.bridge_turn())->>'replayed')::boolean,'exhausted failure replay never creates another terminal event');

reset role;

select * from extensions.finish();

rollback;
