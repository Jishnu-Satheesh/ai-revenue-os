begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(75);

-- Storage for the narration slice (ADR 0037) and its judge (ADR 0038): five
-- tables that any organization member with `report.read` can read and that no
-- session can write, because every write belongs to a later fenced RPC. What
-- can be enforced without those RPCs is enforced here — forced RLS,
-- tenant-composite keys, and a dismissal that must say why.

-- Structure -----------------------------------------------------------------------

select extensions.has_table('public', 'channel_recommendations', 'the narrated answers are stored');
select extensions.has_table('public', 'channel_recommendation_citations', 'so are the findings each answer was built from');
select extensions.has_table('public', 'channel_recommendation_decisions', 'and the human triage answers');
select extensions.has_table('public', 'channel_recommendation_feedback', 'and the helpfulness vote');
select extensions.has_table('public', 'channel_recommendation_evaluations', 'and the judge verdict');

select extensions.ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.channel_recommendations'::regclass),
  'recommendations force RLS even against their owner');
select extensions.ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.channel_recommendation_citations'::regclass),
  'citations force RLS');
select extensions.ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.channel_recommendation_decisions'::regclass),
  'decisions force RLS');
select extensions.ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.channel_recommendation_feedback'::regclass),
  'feedback forces RLS');
select extensions.ok(
  (select relrowsecurity and relforcerowsecurity from pg_catalog.pg_class where oid = 'public.channel_recommendation_evaluations'::regclass),
  'evaluations force RLS');

select extensions.has_index('public', 'channel_recommendations',
  'channel_recommendations_organization_id_id_key', 'a recommendation resolves by tenant and id');
select extensions.has_index('public', 'channel_recommendation_decisions',
  'channel_recommendation_decisions_organization_id_id_key', 'so does a triage decision');
select extensions.has_index('public', 'channel_recommendation_evaluations',
  'channel_recommendation_evaluations_organization_id_id_key', 'and so does a judge verdict');

-- A recommendation is bound to its tenant's own facts by composite foreign
-- key, the same wiring channel_findings received in 20260823120000, so the
-- narrator RPC is never the only thing standing between one tenant and
-- another's evidence.
select extensions.ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.channel_recommendations'::regclass
    and conname = 'channel_recommendations_organization_id_fkey'
), 'a recommendation belongs to a real organization');
select extensions.ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.channel_recommendations'::regclass
    and conname = 'channel_recommendations_organization_id_analysis_run_id_fkey'
), 'its analysis run resolves within its own tenant');
select extensions.ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.channel_recommendations'::regclass
    and conname = 'channel_recommendations_organization_id_channel_id_fkey'
), 'so does its channel');
select extensions.ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.channel_recommendations'::regclass
    and conname = 'channel_recommendations_organization_id_branch_id_fkey'
), 'and its branch');

-- No policy may write these rows. Reads go through RLS; writes belong to the
-- worker and member RPCs of the next tasks.
select extensions.ok((
  select count(*) = 0 from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'channel_recommendations' and cmd <> 'SELECT'
), 'nothing but a select policy may exist on recommendations');
select extensions.ok((
  select count(*) = 0 from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'channel_recommendation_citations' and cmd <> 'SELECT'
), 'nor on citations');
select extensions.ok((
  select count(*) = 0 from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'channel_recommendation_decisions' and cmd <> 'SELECT'
), 'nor on decisions');
select extensions.ok((
  select count(*) = 0 from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'channel_recommendation_feedback' and cmd <> 'SELECT'
), 'nor on feedback');
select extensions.ok((
  select count(*) = 0 from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'channel_recommendation_evaluations' and cmd <> 'SELECT'
), 'nor on evaluations');

select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.channel_recommendations', 'insert'),
  'sessions cannot insert recommendations');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.channel_recommendations', 'update'),
  'cannot update them');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.channel_recommendations', 'delete'),
  'cannot delete them');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.channel_recommendation_citations', 'insert'),
  'sessions cannot insert citations');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.channel_recommendation_citations', 'update'),
  'cannot update them');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.channel_recommendation_citations', 'delete'),
  'cannot delete them');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.channel_recommendation_decisions', 'insert'),
  'sessions cannot insert decisions');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.channel_recommendation_decisions', 'update'),
  'cannot update them');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.channel_recommendation_decisions', 'delete'),
  'cannot delete them');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.channel_recommendation_feedback', 'insert'),
  'sessions cannot insert feedback');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.channel_recommendation_feedback', 'update'),
  'cannot update it');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.channel_recommendation_feedback', 'delete'),
  'cannot delete it');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.channel_recommendation_evaluations', 'insert'),
  'sessions cannot insert evaluations');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.channel_recommendation_evaluations', 'update'),
  'cannot update them');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.channel_recommendation_evaluations', 'delete'),
  'cannot delete them');

-- Fixtures -------------------------------------------------------------------------

insert into auth.users (id) values
  ('f2000000-0000-4000-8000-000000000001'::uuid),
  ('f2000000-0000-4000-8000-000000000002'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('f2000000-0000-4000-8000-000000000101'::uuid, 'Rec verifier', 'rec-verifier', 'f2000000-0000-4000-8000-000000000001'::uuid),
  ('f2000000-0000-4000-8000-000000000102'::uuid, 'Rec outsider', 'rec-outsider', 'f2000000-0000-4000-8000-000000000002'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000101'::uuid, 'Rec verifier', 'rec-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'f2000000-0000-4000-8000-000000000001'::uuid),
  ('f2000000-0000-4000-8000-000000000202'::uuid, 'f2000000-0000-4000-8000-000000000102'::uuid, 'Rec outsider', 'rec-outsider', 'testing', 'AE', 'AED', 'Asia/Dubai', 'f2000000-0000-4000-8000-000000000002'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('f2000000-0000-4000-8000-000000000101'::uuid, 'f2000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('f2000000-0000-4000-8000-000000000102'::uuid, 'f2000000-0000-4000-8000-000000000002'::uuid, 'owner', 'owner');
insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('f2000000-0000-4000-8000-000000000301'::uuid, 'f2000000-0000-4000-8000-000000000201'::uuid, 'Dubai outlet', 'dubai-outlet', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('f2000000-0000-4000-8000-000000000401'::uuid, 'f2000000-0000-4000-8000-000000000201'::uuid, 'talabat', 'Talabat', 'marketplace', 'f2000000-0000-4000-8000-000000000001'::uuid);

-- The outsider organization gets real parents of its own -- branch, channel,
-- and a completed analysis run -- so the cross-tenant refusals below are
-- exercised against rows another tenant actually owns rather than invented ids.
insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values ('f2000000-0000-4000-8000-000000000302'::uuid, 'f2000000-0000-4000-8000-000000000202'::uuid, 'Outsider outlet', 'outsider-outlet', 'physical', 'Asia/Dubai', 'AED');
insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values ('f2000000-0000-4000-8000-000000000402'::uuid, 'f2000000-0000-4000-8000-000000000202'::uuid, 'talabat', 'Talabat', 'marketplace', 'f2000000-0000-4000-8000-000000000002'::uuid);
insert into public.channel_analysis_runs (
  id, organization_id, window_start, window_end, period_grain, window_timezone,
  registry_version, detector_versions, metric_versions, input_digest,
  status, result_digest, correlation_id, completed_at
) values (
  'f2000000-0000-4000-8000-000000000602'::uuid, 'f2000000-0000-4000-8000-000000000202'::uuid,
  date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
  '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
  repeat('0', 64), 'completed', repeat('9', 64),
  'f2000000-0000-4000-8000-000000000702'::uuid, now());

insert into public.channel_analysis_runs (
  id, organization_id, channel_id, branch_id, window_start, window_end, period_grain,
  window_timezone, registry_version, detector_versions, metric_versions, input_digest,
  status, result_digest, correlation_id, completed_at
) values (
  'f2000000-0000-4000-8000-000000000601'::uuid, 'f2000000-0000-4000-8000-000000000201'::uuid,
  'f2000000-0000-4000-8000-000000000401'::uuid, 'f2000000-0000-4000-8000-000000000301'::uuid,
  date '2026-01-01', date '2026-01-05', 'day', 'Asia/Dubai', 1,
  '[{"key":"evidence.period_coverage","calculationVersion":1}]'::jsonb, '[]'::jsonb,
  repeat('a', 64), 'completed', repeat('b', 64),
  'f2000000-0000-4000-8000-000000000700'::uuid, now());

insert into public.channel_findings (
  id, organization_id, analysis_run_id, channel_id, branch_id, detector_key, detector_version,
  kind, code, quality_state, calculation_digest
) values (
  'f2000000-0000-4000-8000-000000000501'::uuid, 'f2000000-0000-4000-8000-000000000201'::uuid,
  'f2000000-0000-4000-8000-000000000601'::uuid, 'f2000000-0000-4000-8000-000000000401'::uuid,
  'f2000000-0000-4000-8000-000000000301'::uuid, 'evidence.period_coverage', 1, 'observation',
  'PERIOD_COVERAGE_INCOMPLETE', 'complete', repeat('c', 64));

-- Owner-context behaviour -------------------------------------------------------------

select extensions.lives_ok(
  $$ insert into public.channel_recommendations (
    id, organization_id, channel_id, branch_id, analysis_run_id, window_start, window_end,
    period_grain, label, headline, detail, supported_actions, limitations, prompt_version,
    prompt_digest, output_digest, provider, model_id, result_digest
  ) values (
    'f2000000-0000-4000-8000-000000000701'::uuid, 'f2000000-0000-4000-8000-000000000201'::uuid,
    'f2000000-0000-4000-8000-000000000401'::uuid, 'f2000000-0000-4000-8000-000000000301'::uuid,
    'f2000000-0000-4000-8000-000000000601'::uuid, date '2026-01-01', date '2026-01-05', 'day',
    'recommendation', 'Two days of Talabat revenue are missing from the window',
    'The window declares five days but evidence covers three, so movement figures compare unequal periods.',
    '[]'::jsonb, '["A period is counted as covered when a current observation starts in it."]'::jsonb,
    1, repeat('d', 64), repeat('e', 64), 'openai', 'gpt-test', repeat('f', 64)) $$,
  'the narrator''s answer is storable');

select extensions.lives_ok(
  $$ insert into public.channel_recommendation_citations (
    recommendation_id, finding_id, organization_id
  ) values (
    'f2000000-0000-4000-8000-000000000701'::uuid, 'f2000000-0000-4000-8000-000000000501'::uuid,
    'f2000000-0000-4000-8000-000000000201'::uuid) $$,
  'a recommendation cites the stored finding it was built from');

select extensions.lives_ok(
  $$ insert into public.channel_recommendation_decisions (
    id, organization_id, recommendation_id, decision, actor_id
  ) values (
    'f2000000-0000-4000-8000-000000000801'::uuid, 'f2000000-0000-4000-8000-000000000201'::uuid,
    'f2000000-0000-4000-8000-000000000701'::uuid, 'acknowledged', 'f2000000-0000-4000-8000-000000000001'::uuid) $$,
  'a human can acknowledge a recommendation');

select extensions.throws_ok(
  $$ insert into public.channel_recommendation_decisions (
    organization_id, recommendation_id, decision, dismissal_reason, actor_id
  ) values (
    'f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000701'::uuid,
    'dismissed', null, 'f2000000-0000-4000-8000-000000000001'::uuid) $$,
  '23514', 'new row for relation "channel_recommendation_decisions" violates check constraint "channel_recommendation_decisions_check"',
  'dismissing without saying why is refused');

select extensions.throws_ok(
  $$ insert into public.channel_recommendation_decisions (
    organization_id, recommendation_id, decision, dismissal_reason, actor_id
  ) values (
    'f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000701'::uuid,
    'dismissed', '   ', 'f2000000-0000-4000-8000-000000000001'::uuid) $$,
  '23514', 'new row for relation "channel_recommendation_decisions" violates check constraint "channel_recommendation_decisions_check"',
  'a dismissal whose reason is whitespace is still silence, and is refused too');

select extensions.lives_ok(
  $$ insert into public.channel_recommendation_decisions (
    id, organization_id, recommendation_id, decision, dismissal_reason, actor_id
  ) values (
    'f2000000-0000-4000-8000-000000000802'::uuid, 'f2000000-0000-4000-8000-000000000201'::uuid,
    'f2000000-0000-4000-8000-000000000701'::uuid, 'dismissed', 'Breakfast delivery is not part of our plan.',
    'f2000000-0000-4000-8000-000000000001'::uuid) $$,
  'a stated reason makes the dismissal acceptable');

select extensions.lives_ok(
  $$ insert into public.channel_recommendation_evaluations (
    id, organization_id, recommendation_id, batch_id, citation_faithful, label_appropriate,
    invented_value_detected, uncertainty_honest, score, issues, notes, judge_provider, judge_model,
    judge_prompt_version, judge_prompt_digest, judge_output_digest
  ) values (
    'f2000000-0000-4000-8000-000000000901'::uuid, 'f2000000-0000-4000-8000-000000000201'::uuid,
    'f2000000-0000-4000-8000-000000000701'::uuid, 'f2000000-0000-4000-8000-000000000903'::uuid,
    true, true, false, true, 4, '[]'::jsonb, 'Cites the coverage finding it rests on.',
    'google', 'judge-test', 1, repeat('5', 64), repeat('6', 64)) $$,
  'the judge files one verdict per recommendation');

select extensions.throws_ok(
  $$ insert into public.channel_recommendation_evaluations (
    id, organization_id, recommendation_id, batch_id, citation_faithful, label_appropriate,
    invented_value_detected, uncertainty_honest, score, issues, notes, judge_provider, judge_model,
    judge_prompt_version, judge_prompt_digest, judge_output_digest
  ) values (
    'f2000000-0000-4000-8000-000000000902'::uuid, 'f2000000-0000-4000-8000-000000000201'::uuid,
    'f2000000-0000-4000-8000-000000000701'::uuid, 'f2000000-0000-4000-8000-000000000903'::uuid,
    true, true, false, true, 4, '[]'::jsonb, 'Cites what it used.', 'google', 'judge-test', 1,
    repeat('1', 64), repeat('2', 64)) $$,
  '23505', 'duplicate key value violates unique constraint "channel_recommendation_evaluations_recommendation_id_key"',
  'a second verdict for an already judged recommendation is refused');

select extensions.throws_ok(
  $$ insert into public.channel_recommendation_evaluations (
    organization_id, recommendation_id, batch_id, citation_faithful, label_appropriate,
    invented_value_detected, uncertainty_honest, score, notes, judge_provider, judge_model,
    judge_prompt_version, judge_prompt_digest, judge_output_digest
  ) values (
    'f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000701'::uuid,
    'f2000000-0000-4000-8000-000000000903'::uuid, true, true, false, true, 6, 'Score inflation.',
    'google', 'judge-test', 1, repeat('3', 64), repeat('4', 64)) $$,
  '23514', 'new row for relation "channel_recommendation_evaluations" violates check constraint "channel_recommendation_evaluations_score_check"',
  'an advisory score outside the agreed scale is refused');

select extensions.lives_ok(
  $$ insert into public.channel_recommendation_feedback (
    organization_id, recommendation_id, actor_id, helpful
  ) values (
    'f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000701'::uuid,
    'f2000000-0000-4000-8000-000000000001'::uuid, true) $$,
  'a member can vote a recommendation helpful');

select extensions.lives_ok(
  $$ update public.channel_recommendation_decisions set decision = 'dismissed',
       dismissal_reason = 'Not actionable this quarter.'
     where id = 'f2000000-0000-4000-8000-000000000801'::uuid $$,
  'a triage answer can change its mind');

select extensions.lives_ok(
  $$ delete from public.channel_recommendation_decisions
     where id = 'f2000000-0000-4000-8000-000000000802'::uuid $$,
  'and a mistaken one can be withdrawn');

-- Audit ---------------------------------------------------------------------------

select extensions.is((
  select count(*)::integer from public.audit_events
  where entity_id = 'f2000000-0000-4000-8000-000000000701'::uuid
    and event_name = 'channel_recommendation.triaged'
    and payload ->> 'transition' = 'recorded'
), 2, 'both triage answers were audited as recorded');

select extensions.is((
  select count(*)::integer from public.audit_events
  where entity_id = 'f2000000-0000-4000-8000-000000000701'::uuid
    and event_name = 'channel_recommendation.triaged'
    and payload ->> 'transition' = 'changed'
), 1, 'the change of mind was audited');

select extensions.is((
  select count(*)::integer from public.audit_events
  where entity_id = 'f2000000-0000-4000-8000-000000000701'::uuid
    and event_name = 'channel_recommendation.triaged'
    and payload ->> 'transition' = 'removed'
), 1, 'so was the withdrawal');

select extensions.is((
  select (payload ->> 'priorDecision') || '->' || (payload ->> 'decision')
  from public.audit_events
  where entity_id = 'f2000000-0000-4000-8000-000000000701'::uuid
    and event_name = 'channel_recommendation.triaged' and payload ->> 'transition' = 'changed'
), 'acknowledged->dismissed', 'the state transition names both sides of the change');

select extensions.ok((
  select bool_and(actor_id = 'f2000000-0000-4000-8000-000000000001'::uuid and payload ? 'decisionId')
  from public.audit_events
  where entity_id = 'f2000000-0000-4000-8000-000000000701'::uuid
    and event_name = 'channel_recommendation.triaged'
), 'every triage event carries who answered and which decision row it was');

select extensions.ok(not exists (
  select 1 from public.audit_events a,
    jsonb_object_keys(a.payload) as payload_key
  where a.entity_id = 'f2000000-0000-4000-8000-000000000701'::uuid
    and a.event_name = 'channel_recommendation.triaged'
    and payload_key not in ('decisionId', 'transition', 'decision', 'priorDecision')
), 'audit payloads carry ids and transitions only, never the operator''s words');

-- Cross-tenant parents are refused by the database, not by the RPC that will
-- one day write these rows. Each attempt below violates exactly one key.
select extensions.throws_ok(
  $$ insert into public.channel_recommendations (
    organization_id, channel_id, analysis_run_id, window_start, window_end, period_grain,
    label, headline, detail, prompt_version, prompt_digest, output_digest, provider, model_id,
    result_digest
  ) values (
    'f2000000-0000-4000-8000-000000000299'::uuid, 'f2000000-0000-4000-8000-000000000401'::uuid,
    'f2000000-0000-4000-8000-000000000601'::uuid, date '2026-01-01', date '2026-01-05', 'day',
    'observation', 'x', 'x', 1, repeat('b', 64), repeat('c', 64), 'openai', 'gpt-test', repeat('8', 64)) $$,
  '23503', 'insert or update on table "channel_recommendations" violates foreign key constraint "channel_recommendations_organization_id_fkey"',
  'a recommendation cannot name an organization that does not exist');

select extensions.throws_ok(
  $$ insert into public.channel_recommendations (
    organization_id, channel_id, analysis_run_id, window_start, window_end, period_grain,
    label, headline, detail, prompt_version, prompt_digest, output_digest, provider, model_id,
    result_digest
  ) values (
    'f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000401'::uuid,
    'f2000000-0000-4000-8000-000000000602'::uuid, date '2026-01-01', date '2026-01-05', 'day',
    'observation', 'x', 'x', 1, repeat('d', 64), repeat('e', 64), 'openai', 'gpt-test', repeat('7', 64)) $$,
  '23503', 'insert or update on table "channel_recommendations" violates foreign key constraint "channel_recommendations_organization_id_analysis_run_id_fkey"',
  'our tenant''s narration cannot be bound to another organization''s analysis run');

select extensions.throws_ok(
  $$ insert into public.channel_recommendations (
    organization_id, channel_id, analysis_run_id, window_start, window_end, period_grain,
    label, headline, detail, prompt_version, prompt_digest, output_digest, provider, model_id,
    result_digest
  ) values (
    'f2000000-0000-4000-8000-000000000202'::uuid, 'f2000000-0000-4000-8000-000000000402'::uuid,
    'f2000000-0000-4000-8000-000000000601'::uuid, date '2026-01-01', date '2026-01-05', 'day',
    'observation', 'x', 'x', 1, repeat('f', 64), repeat('1', 64), 'openai', 'gpt-test', repeat('6', 64)) $$,
  '23503', 'insert or update on table "channel_recommendations" violates foreign key constraint "channel_recommendations_organization_id_analysis_run_id_fkey"',
  'and an outside tenant cannot bind itself to our run either');

select extensions.throws_ok(
  $$ insert into public.channel_recommendations (
    organization_id, channel_id, analysis_run_id, window_start, window_end, period_grain,
    label, headline, detail, prompt_version, prompt_digest, output_digest, provider, model_id,
    result_digest
  ) values (
    'f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000402'::uuid,
    'f2000000-0000-4000-8000-000000000601'::uuid, date '2026-01-01', date '2026-01-05', 'day',
    'observation', 'x', 'x', 1, repeat('2', 64), repeat('3', 64), 'openai', 'gpt-test', repeat('5', 64)) $$,
  '23503', 'insert or update on table "channel_recommendations" violates foreign key constraint "channel_recommendations_organization_id_channel_id_fkey"',
  'a recommendation cannot ride another organization''s channel');

select extensions.throws_ok(
  $$ insert into public.channel_recommendations (
    organization_id, channel_id, branch_id, analysis_run_id, window_start, window_end, period_grain,
    label, headline, detail, prompt_version, prompt_digest, output_digest, provider, model_id,
    result_digest
  ) values (
    'f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000401'::uuid,
    'f2000000-0000-4000-8000-000000000302'::uuid, 'f2000000-0000-4000-8000-000000000601'::uuid,
    date '2026-01-01', date '2026-01-05', 'day',
    'observation', 'x', 'x', 1, repeat('4', 64), repeat('0', 64), 'openai', 'gpt-test', repeat('a', 64)) $$,
  '23503', 'insert or update on table "channel_recommendations" violates foreign key constraint "channel_recommendations_organization_id_branch_id_fkey"',
  'nor speak about another organization''s branch');

-- Member sessions can read their own tenant and write nothing ------------------------

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'f2000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$ insert into public.channel_recommendations (
    organization_id, channel_id, analysis_run_id, window_start, window_end, period_grain,
    label, headline, detail, prompt_version, prompt_digest, output_digest, provider, model_id,
    result_digest
  ) values (
    'f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000401'::uuid,
    'f2000000-0000-4000-8000-000000000601'::uuid, date '2026-01-01', date '2026-01-05', 'day',
    'observation', 'x', 'x', 1, repeat('7', 64), repeat('8', 64), 'openai', 'gpt-test', repeat('9', 64)) $$,
  '42501', 'permission denied for table channel_recommendations',
  'a member session cannot write a recommendation directly');

select extensions.throws_ok(
  $$ insert into public.channel_recommendation_citations (
    recommendation_id, finding_id, organization_id
  ) values (
    'f2000000-0000-4000-8000-000000000701'::uuid, 'f2000000-0000-4000-8000-000000000501'::uuid,
    'f2000000-0000-4000-8000-000000000201'::uuid) $$,
  '42501', 'permission denied for table channel_recommendation_citations',
  'nor a citation');

select extensions.throws_ok(
  $$ insert into public.channel_recommendation_decisions (
    organization_id, recommendation_id, decision, actor_id
  ) values (
    'f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000701'::uuid,
    'acknowledged', 'f2000000-0000-4000-8000-000000000001'::uuid) $$,
  '42501', 'permission denied for table channel_recommendation_decisions',
  'nor a triage decision');

select extensions.throws_ok(
  $$ insert into public.channel_recommendation_feedback (
    organization_id, recommendation_id, actor_id, helpful
  ) values (
    'f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000701'::uuid,
    'f2000000-0000-4000-8000-000000000001'::uuid, true) $$,
  '42501', 'permission denied for table channel_recommendation_feedback',
  'nor a feedback vote');

select extensions.throws_ok(
  $$ insert into public.channel_recommendation_evaluations (
    organization_id, recommendation_id, batch_id, citation_faithful, label_appropriate,
    invented_value_detected, uncertainty_honest, score, notes, judge_provider, judge_model,
    judge_prompt_version, judge_prompt_digest, judge_output_digest
  ) values (
    'f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000701'::uuid,
    'f2000000-0000-4000-8000-000000000903'::uuid, true, true, false, true, 3, 'x',
    'google', 'judge-test', 1, repeat('0', 64), repeat('a', 64)) $$,
  '42501', 'permission denied for table channel_recommendation_evaluations',
  'nor a judge verdict');

-- Tenant isolation --------------------------------------------------------------------

set local request.jwt.claim.sub = 'f2000000-0000-4000-8000-000000000002';

select extensions.is((select count(*)::integer from public.channel_recommendations
  where organization_id = 'f2000000-0000-4000-8000-000000000201'::uuid), 0,
  'another organization''s member sees none of these recommendations');
select extensions.is((select count(*)::integer from public.channel_recommendation_citations
  where organization_id = 'f2000000-0000-4000-8000-000000000201'::uuid), 0,
  'nor what they cite');
select extensions.is((select count(*)::integer from public.channel_recommendation_decisions
  where organization_id = 'f2000000-0000-4000-8000-000000000201'::uuid), 0,
  'nor how they were answered');
select extensions.is((select count(*)::integer from public.channel_recommendation_feedback
  where organization_id = 'f2000000-0000-4000-8000-000000000201'::uuid), 0,
  'nor how they were voted');
select extensions.is((select count(*)::integer from public.channel_recommendation_evaluations
  where organization_id = 'f2000000-0000-4000-8000-000000000201'::uuid), 0,
  'nor how they were judged');

set local request.jwt.claim.sub = 'f2000000-0000-4000-8000-000000000001';

select extensions.is((select count(*)::integer from public.channel_recommendations
  where organization_id = 'f2000000-0000-4000-8000-000000000201'::uuid), 1,
  'an organization member reads their own recommendation');
select extensions.is((select count(*)::integer from public.channel_recommendation_citations
  where organization_id = 'f2000000-0000-4000-8000-000000000201'::uuid), 1,
  'its citation');
select extensions.is((select count(*)::integer from public.channel_recommendation_decisions
  where organization_id = 'f2000000-0000-4000-8000-000000000201'::uuid), 1,
  'the surviving triage answer');
select extensions.is((select count(*)::integer from public.channel_recommendation_feedback
  where organization_id = 'f2000000-0000-4000-8000-000000000201'::uuid), 1,
  'the feedback vote');
select extensions.is((select count(*)::integer from public.channel_recommendation_evaluations
  where organization_id = 'f2000000-0000-4000-8000-000000000201'::uuid), 1,
  'and the judge verdict');

select * from extensions.finish();

rollback;
