begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(83);

-- Contract, indexes, and grants ----------------------------------------------

select extensions.has_table(
  'public', 'growth_intelligence_monitoring_updates',
  'one durable row lives per background update attempt'
);
select extensions.has_table(
  'public', 'growth_intelligence_project_create_keys',
  'project creation keys bind an idempotency key to its project'
);
select extensions.has_table(
  'public', 'growth_intelligence_monitoring_active_scopes',
  'one live scope fingerprint lives per organization'
);
select extensions.has_table(
  'public', 'growth_intelligence_report_reviews',
  'explicit item-less reviews live per report version'
);
select extensions.has_function(
  'public', 'open_monitoring_update',
  array['uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'integer'],
  'updates reserve through one governed open'
);
select extensions.has_function(
  'public', 'advance_monitoring_update_stage',
  array['uuid', 'uuid', 'uuid', 'text', 'uuid'],
  'running updates heartbeat through one governed advance'
);
select extensions.has_function(
  'public', 'settle_monitoring_update',
  array['uuid', 'uuid', 'uuid', 'text', 'text', 'boolean', 'jsonb', 'bigint', 'integer', 'uuid'],
  'terminal updates settle with reason, retry flag, coverage and cost'
);
select extensions.has_function(
  'public', 'create_research_project_keyed',
  array['uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'jsonb', 'text', 'text'],
  'projects create through a keyed governed operation'
);
select extensions.has_function(
  'public', 'release_monitoring_active_scope',
  array['uuid', 'uuid', 'uuid'],
  'archived projects release their scope fingerprint'
);
select extensions.has_function(
  'public', 'mark_report_reviewed',
  array['uuid', 'uuid', 'uuid'],
  'item-less reports review idempotently per version'
);
select extensions.has_function(
  'public', 'erase_monitoring_update_extracts',
  array['uuid', 'uuid', 'text'],
  'a privileged path erases extract-derived coverage with audit'
);
select extensions.has_function(
  'public', 'cancel_monitoring_update',
  array['uuid', 'uuid', 'uuid', 'text'],
  'cancellation settles non-terminal updates without the lease token'
);
select extensions.has_function(
  'private', 'assert_monitoring_update_coverage',
  array['jsonb'],
  'coverage validates per requested dimension with honest statuses'
);
select extensions.ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'public.growth_intelligence_monitoring_updates'::regclass
  ),
  'monitoring updates enable and force RLS'
);
select extensions.ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'public.growth_intelligence_project_create_keys'::regclass
  ),
  'project create keys enable and force RLS'
);
select extensions.ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'public.growth_intelligence_monitoring_active_scopes'::regclass
  ),
  'monitoring scopes enable and force RLS'
);
select extensions.ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'public.growth_intelligence_report_reviews'::regclass
  ),
  'report reviews enable and force RLS'
);
select extensions.ok(
  pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_monitoring_updates', 'select'
  ),
  'authenticated members receive a monitoring update read grant'
);
select extensions.ok(
  pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_project_create_keys', 'select'
  ),
  'authenticated members receive a create-key read grant'
);
select extensions.ok(
  pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_monitoring_active_scopes', 'select'
  ),
  'authenticated members receive a monitoring scope read grant'
);
select extensions.ok(
  pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_report_reviews', 'select'
  ),
  'authenticated members receive a report review read grant'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_monitoring_updates',
    'insert,update,delete'
  ),
  'authenticated sessions cannot write monitoring updates directly'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_project_create_keys',
    'insert,update,delete'
  ),
  'authenticated sessions cannot write create keys directly'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_monitoring_active_scopes',
    'insert,update,delete'
  ),
  'authenticated sessions cannot write monitoring scopes directly'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_report_reviews',
    'insert,update,delete'
  ),
  'authenticated sessions cannot write report reviews directly'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.open_monitoring_update(uuid,uuid,uuid,uuid,uuid,uuid,integer)',
    'execute'
  ),
  'signed-in members may open monitoring updates through the governed RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.advance_monitoring_update_stage(uuid,uuid,uuid,text,uuid)',
    'execute'
  ),
  'signed-in members may advance monitoring updates through the governed RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.settle_monitoring_update(uuid,uuid,uuid,text,text,boolean,jsonb,bigint,integer,uuid)',
    'execute'
  ),
  'signed-in members may settle monitoring updates through the governed RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_research_project_keyed(uuid,uuid,uuid,text,text,text,jsonb,text,text)',
    'execute'
  ),
  'signed-in members may create keyed projects through the governed RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.release_monitoring_active_scope(uuid,uuid,uuid)',
    'execute'
  ),
  'signed-in members may release scopes through the governed RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.mark_report_reviewed(uuid,uuid,uuid)',
    'execute'
  ),
  'signed-in members may mark reviews through the governed RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.cancel_monitoring_update(uuid,uuid,uuid,text)',
    'execute'
  ),
  'signed-in members may cancel running updates through the governed RPC'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.erase_monitoring_update_extracts(uuid,uuid,text)',
    'execute'
  ),
  'browser sessions cannot erase update extracts directly'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.erase_monitoring_update_extracts(uuid,uuid,text)',
    'execute'
  ),
  'support tooling erases through the governed RPC'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.open_monitoring_update(uuid,uuid,uuid,uuid,uuid,uuid,integer)',
    'execute'
  ),
  'anonymous callers cannot open monitoring updates'
);
select extensions.has_index(
  'public', 'growth_intelligence_monitoring_updates',
  'growth_intelligence_monitoring_updates_project_history_idx',
  'update history paginates per project without scanning the tenant'
);
select extensions.has_index(
  'public', 'growth_intelligence_monitoring_updates',
  'growth_intelligence_monitoring_updates_active_idx',
  'the running view reads only non-terminal updates through a partial index'
);
select extensions.has_index(
  'public', 'growth_intelligence_monitoring_updates',
  'growth_intelligence_monitoring_updates_brief_revision_idx',
  'update pins resolve per brief revision without scanning the tenant'
);

-- Two-account fixtures ---------------------------------------------------------

insert into auth.users (id) values
  ('e7000000-0000-4000-8000-000000000001'::uuid),
  ('e7000000-0000-4000-8000-000000000002'::uuid),
  ('e7000000-0000-4000-8000-000000000003'::uuid),
  ('e7000000-0000-4000-8000-000000000004'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('e7000000-0000-4000-8000-000000000101'::uuid, 'Lifecycle agency A', 'lifecycle-agency-a', 'e7000000-0000-4000-8000-000000000001'::uuid),
  ('e7000000-0000-4000-8000-000000000102'::uuid, 'Lifecycle agency B', 'lifecycle-agency-b', 'e7000000-0000-4000-8000-000000000004'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('e7000000-0000-4000-8000-000000000201'::uuid, 'e7000000-0000-4000-8000-000000000101'::uuid, 'Lifecycle client A', 'lifecycle-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'e7000000-0000-4000-8000-000000000001'::uuid),
  ('e7000000-0000-4000-8000-000000000202'::uuid, 'e7000000-0000-4000-8000-000000000102'::uuid, 'Lifecycle client B', 'lifecycle-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'e7000000-0000-4000-8000-000000000004'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('e7000000-0000-4000-8000-000000000101'::uuid, 'e7000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('e7000000-0000-4000-8000-000000000101'::uuid, 'e7000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator'),
  ('e7000000-0000-4000-8000-000000000101'::uuid, 'e7000000-0000-4000-8000-000000000003'::uuid, 'member', 'viewer'),
  ('e7000000-0000-4000-8000-000000000102'::uuid, 'e7000000-0000-4000-8000-000000000004'::uuid, 'owner', 'owner');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency, is_active
) values
  ('e7000000-0000-4000-8000-000000000301'::uuid, 'e7000000-0000-4000-8000-000000000201'::uuid, 'Lifecycle branch', 'lifecycle-branch', 'physical', 'Asia/Dubai', 'AED', true),
  ('e7000000-0000-4000-8000-000000000302'::uuid, 'e7000000-0000-4000-8000-000000000201'::uuid, 'Lifecycle second', 'lifecycle-second', 'physical', 'Asia/Dubai', 'AED', true),
  ('e7000000-0000-4000-8000-000000000303'::uuid, 'e7000000-0000-4000-8000-000000000202'::uuid, 'Other tenant branch', 'other-tenant-branch', 'physical', 'Asia/Dubai', 'AED', true);

create or replace function pg_temp.ml_brief(
  p_project_id uuid,
  p_org_id uuid,
  p_revision_number integer,
  p_pinned_id uuid default null
)
returns jsonb
language sql
as $$
  select pg_catalog.jsonb_build_object(
    'revisionId', pg_catalog.gen_random_uuid(),
    'projectId', p_project_id,
    'organizationId', p_org_id,
    'revisionNumber', p_revision_number,
    'question', 'What do Marina families want for Friday dinner?',
    'title', 'Marina Friday dinner',
    'locationId', 'e7000000-0000-4000-8000-000000000301',
    'researchArea', 'Family dining',
    'competitors', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'name', 'Marina Rival',
        'source', 'operator_lead'
      )
    ),
    'investigationAreas', pg_catalog.jsonb_build_array('demand', 'reviews'),
    'evidencePeriods', pg_catalog.jsonb_build_array(),
    'businessContextSnapshotId', 'e7000000-0000-4000-8000-000000000401',
    'frequency', 'once',
    'pinnedToUpdateId',
      case when p_pinned_id is null then 'null'::jsonb else pg_catalog.to_jsonb(p_pinned_id) end,
    'createdAtUtc', '2026-09-14T06:00:00.000Z'
  );
$$;

create or replace function pg_temp.ml_report(
  p_version_id uuid,
  p_org_id uuid,
  p_project_id uuid,
  p_branch_id uuid,
  p_revision_id uuid,
  p_digest text
)
returns jsonb
language sql
as $$
  select pg_catalog.jsonb_build_object(
    'reportId', pg_catalog.gen_random_uuid(),
    'reportVersionId', p_version_id,
    'organizationId', p_org_id,
    'projectId', p_project_id,
    'locationId', p_branch_id,
    'briefRevisionId', p_revision_id,
    'evidenceDigest', p_digest,
    'summary', 'Marina families book early for Friday dinner.',
    'localMeaning', 'An early-bird family offer fits the Marina week.',
    'findings', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'key', 'early-booking',
        'statement', 'Rival listings show Friday slots filling by Thursday.',
        'citationSlots', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'claimId', 'e7000000-0000-4000-8000-000000000501',
            'sourceRef', 'src-one'
          )
        )
      )
    ),
    'competitorComparison', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'competitorName', 'Marina Rival',
        'summary', 'Rival pushes Friday family platters.'
      )
    ),
    'sources', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('sourceRef', 'src-one')
    ),
    'plainLanguageRequired', true
  );
$$;

-- Coverage validator ------------------------------------------------------------

select extensions.lives_ok(
  $$ select private.assert_monitoring_update_coverage(
    '[{"dimensionKind":"investigation_area","dimensionKey":"area:demand","label":"demand","status":"unavailable"}]'::jsonb
  ) $$,
  'a per-dimension unavailable backfill validates'
);
select extensions.throws_ok(
  $$ select private.assert_monitoring_update_coverage(
    '[{"dimensionKind":"investigation_area","dimensionKey":"area:demand","label":"demand","status":"percent-40"}]'::jsonb
  ) $$,
  '22023', null,
  'coverage refuses invented completion figures'
);
select extensions.throws_ok(
  $$ select private.assert_monitoring_update_coverage('[]'::jsonb) $$,
  '22023', null,
  'coverage refuses an empty list on the failure path'
);

-- Keyed create with scope convergence --------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'e7000000-0000-4000-8000-000000000002';

create temp table pg_temp.ml_keyed as
select (public.create_research_project_keyed(
  'e7000000-0000-4000-8000-000000000201'::uuid,
  'e7000000-0000-4000-8000-000000000002'::uuid,
  'e7000000-0000-4000-8000-000000000301'::uuid,
  'Marina Friday dinner',
  'What do Marina families want for Friday dinner?',
  'one-time',
  null,
  'lifecycle-key-1',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
) ->> 'projectId')::uuid as project_id;

select extensions.ok(
  (select pg_catalog.count(*)::integer from pg_temp.ml_keyed) = 1,
  'a keyed one-time project creates'
);

select extensions.is(
  (select public.create_research_project_keyed(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000301'::uuid,
    'Marina Friday dinner',
    'What do Marina families want for Friday dinner?',
    'one-time',
    null,
    'lifecycle-key-1',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ) ->> 'replayed'),
  'true',
  'the same key with the same body replays the kept project'
);

select extensions.throws_ok(
  $$ select public.create_research_project_keyed(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000301'::uuid,
    'Marina Friday dinner',
    'What do Marina families want for Saturday lunch?',
    'one-time',
    null,
    'lifecycle-key-1',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  ) $$,
  '23505', null,
  'the same key with another body is a conflict'
);

select extensions.is(
  (select public.create_research_project_keyed(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000301'::uuid,
    'Marina Friday dinner',
    'What do Marina families want for Friday dinner?',
    'one-time',
    null,
    'lifecycle-key-2',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ) ->> 'converged'),
  'true',
  'a second key on the identical scope converges instead of minting a twin'
);

select extensions.is(
  (select public.release_monitoring_active_scope(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    (select project_id from pg_temp.ml_keyed)
  ) ->> 'released'),
  '1',
  'archiving releases the scope fingerprint for reuse'
);

select extensions.is(
  (select public.create_research_project_keyed(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000301'::uuid,
    'Marina Friday dinner',
    'What do Marina families want for Friday dinner?',
    'one-time',
    null,
    'lifecycle-key-3',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ) ->> 'replayed'),
  'false',
  'a released scope researches again with a new project'
);

select extensions.throws_ok(
  $$ select public.create_research_project_keyed(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000303'::uuid,
    'e7000000-0000-4000-8000-000000000303'::uuid,
    'Marina Friday dinner',
    'What do Marina families want for Friday dinner?',
    'one-time',
    null,
    'lifecycle-key-4',
    null
  ) $$,
  '42501', null,
  'a keyed create can never point at another tenant branch'
);

select extensions.is(
  (select public.create_research_project_keyed(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000302'::uuid,
    'Downtown lunch rush',
    'Where do Downtown teams eat on weekdays?',
    'one-time',
    null,
    'lifecycle-key-5',
    null
  ) ->> 'replayed'),
  'false',
  'a keyed create without a scope fingerprint still creates'
);

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'e7000000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$ select public.create_research_project_keyed(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000003'::uuid,
    'e7000000-0000-4000-8000-000000000301'::uuid,
    'Viewer attempt',
    'Can a viewer start research?',
    'one-time',
    null,
    'lifecycle-key-viewer',
    null
  ) $$,
  '42501', null,
  'viewers cannot create keyed projects'
);

reset role;

-- Lifecycle transitions and fencing -----------------------------------------------

set local role service_role;

select extensions.is(
  (select public.open_monitoring_update(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    (select project_id from pg_temp.ml_keyed),
    'e7000000-0000-4000-8000-000000000601'::uuid,
    null,
    'e7000000-0000-4000-8000-000000000611'::uuid,
    600
  ) ->> 'stage'),
  'queued',
  'an update reserves in queued with its lease'
);

select extensions.is(
  (select public.advance_monitoring_update_stage(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000601'::uuid,
    'researching',
    'e7000000-0000-4000-8000-000000000611'::uuid
  ) ->> 'stage'),
  'researching',
  'the running view reads the real researching stage'
);

select extensions.throws_ok(
  $$ select public.advance_monitoring_update_stage(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000601'::uuid,
    'preparing_insights',
    'e7000000-0000-4000-8000-000000000612'::uuid
  ) $$,
  '55000', null,
  'a rival lease token is fenced off the running update'
);

select extensions.is(
  (select public.open_monitoring_update(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    (select project_id from pg_temp.ml_keyed),
    'e7000000-0000-4000-8000-000000000601'::uuid,
    null,
    'e7000000-0000-4000-8000-000000000611'::uuid,
    600
  ) ->> 'replayed'),
  'true',
  'a redelivered open with the same token heartbeats instead of forking'
);

select extensions.throws_ok(
  $$ select public.settle_monitoring_update(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000601'::uuid,
    'research_failed',
    null,
    true,
    null,
    0,
    0,
    'e7000000-0000-4000-8000-000000000611'::uuid
  ) $$,
  '22023', null,
  'a failed update must name its safe reason'
);

select extensions.is(
  (select public.settle_monitoring_update(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000601'::uuid,
    'research_failed',
    'ADAPTER_UNAVAILABLE',
    true,
    '[{"dimensionKind":"investigation_area","dimensionKey":"area:demand","label":"demand","status":"unavailable"},{"dimensionKind":"investigation_area","dimensionKey":"area:reviews","label":"reviews","status":"unavailable"},{"dimensionKind":"competitor","dimensionKey":"competitor:marina-rival","label":"Marina Rival","status":"unavailable"}]'::jsonb,
    1200,
    1,
    'e7000000-0000-4000-8000-000000000611'::uuid
  ) ->> 'stage'),
  'research_failed',
  'a failed update settles with reason, retry flag, coverage and cost'
);

select extensions.is(
  (select public.settle_monitoring_update(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000601'::uuid,
    'research_failed',
    'ADAPTER_UNAVAILABLE',
    true,
    null,
    1200,
    1,
    'e7000000-0000-4000-8000-000000000611'::uuid
  ) ->> 'replayed'),
  'true',
  'a redelivered settle converges instead of rewriting the terminal row'
);

select extensions.throws_ok(
  $$ select public.settle_monitoring_update(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000601'::uuid,
    'cancelled',
    'WORKER_CANCELLED',
    false,
    null,
    1200,
    1,
    'e7000000-0000-4000-8000-000000000611'::uuid
  ) $$,
  '55000', null,
  'a terminal update never moves to another terminal stage'
);

select extensions.throws_ok(
  $$ select public.open_monitoring_update(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    (select project_id from pg_temp.ml_keyed),
    'e7000000-0000-4000-8000-000000000601'::uuid,
    null,
    'e7000000-0000-4000-8000-000000000613'::uuid,
    600
  ) $$,
  '55000', null,
  'a settled update never reopens; a refresh mints a new update'
);

select extensions.is(
  (select public.open_monitoring_update(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    (select project_id from pg_temp.ml_keyed),
    'e7000000-0000-4000-8000-000000000602'::uuid,
    null,
    'e7000000-0000-4000-8000-000000000616'::uuid,
    600
  ) ->> 'stage'),
  'queued',
  'a second update reserves while the first runs terminally'
);

select extensions.throws_ok(
  $$ select public.open_monitoring_update(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    (select project_id from pg_temp.ml_keyed),
    'e7000000-0000-4000-8000-000000000602'::uuid,
    null,
    'e7000000-0000-4000-8000-000000000614'::uuid,
    600
  ) $$,
  '55000', null,
  'a live lease fences a rival token until it expires'
);

select extensions.is(
  (select public.cancel_monitoring_update(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000602'::uuid,
    'WORKER_CANCELLED'
  ) ->> 'stage'),
  'cancelled',
  'cancellation settles a running update without the lease token'
);

select extensions.throws_ok(
  $$ select public.cancel_monitoring_update(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000601'::uuid,
    'WORKER_CANCELLED'
  ) $$,
  '55000', null,
  'a settled update is never rewritten by a late cancel'
);

reset role;

-- Review state idempotency ----------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'e7000000-0000-4000-8000-000000000002';

create temp table pg_temp.ml_chain as
select
  (public.save_brief_revision(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    (select project_id from pg_temp.ml_keyed),
    1,
    pg_temp.ml_brief(
      (select project_id from pg_temp.ml_keyed),
      'e7000000-0000-4000-8000-000000000201'::uuid,
      1
    ),
    null
  ) ->> 'revisionId')::uuid as revision_id;

create temp table pg_temp.ml_reports as
select 'empty' as label, public.persist_report_version(
  'e7000000-0000-4000-8000-000000000201'::uuid,
  'e7000000-0000-4000-8000-000000000002'::uuid,
  (select project_id from pg_temp.ml_keyed),
  'e7000000-0000-4000-8000-000000000301'::uuid,
  (select revision_id from pg_temp.ml_chain),
  'e7000000-0000-4000-8000-000000000701'::uuid,
  'digest-empty',
  pg_temp.ml_report(
    'e7000000-0000-4000-8000-000000000701'::uuid,
    'e7000000-0000-4000-8000-000000000201'::uuid,
    (select project_id from pg_temp.ml_keyed),
    'e7000000-0000-4000-8000-000000000301'::uuid,
    (select revision_id from pg_temp.ml_chain),
    'digest-empty'
  ) - 'draftAdvice'
) as r
union all
select 'with-items', public.persist_report_version(
  'e7000000-0000-4000-8000-000000000201'::uuid,
  'e7000000-0000-4000-8000-000000000002'::uuid,
  (select project_id from pg_temp.ml_keyed),
  'e7000000-0000-4000-8000-000000000301'::uuid,
  (select revision_id from pg_temp.ml_chain),
  'e7000000-0000-4000-8000-000000000702'::uuid,
  'digest-items',
  (pg_temp.ml_report(
    'e7000000-0000-4000-8000-000000000702'::uuid,
    'e7000000-0000-4000-8000-000000000201'::uuid,
    (select project_id from pg_temp.ml_keyed),
    'e7000000-0000-4000-8000-000000000301'::uuid,
    (select revision_id from pg_temp.ml_chain),
    'digest-items'
  ) || '{"draftAdvice":[{"itemKey":"fix-queues","kind":"action","title":"Open a second till","detail":"Queues form after 19:00."}]}'::jsonb)
) as r;

select extensions.is(
  (select public.mark_report_reviewed(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000701'::uuid
  ) ->> 'replayed'),
  'false',
  'an item-less report records its first review'
);

select extensions.is(
  (select public.mark_report_reviewed(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000701'::uuid
  ) ->> 'replayed'),
  'true',
  'a repeated review replays the kept reviewer row'
);

select extensions.throws_ok(
  $$ select public.mark_report_reviewed(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000002'::uuid,
    'e7000000-0000-4000-8000-000000000702'::uuid
  ) $$,
  '23505', null,
  'a report with draft items is reviewed item by item, never marked over the top'
);

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'e7000000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$ select public.mark_report_reviewed(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000003'::uuid,
    'e7000000-0000-4000-8000-000000000701'::uuid
  ) $$,
  '42501', null,
  'viewers cannot mark reports reviewed'
);

reset role;

-- Privileged erasure ------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'e7000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$ select public.erase_monitoring_update_extracts(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000601'::uuid,
    'AGREEMENT_TERMINATED'
  ) $$,
  '42501', null,
  'browser members cannot erase update extracts'
);

reset role;

set local role service_role;

select extensions.throws_ok(
  $$ select public.erase_monitoring_update_extracts(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000601'::uuid,
    'lowercase-reason'
  ) $$,
  '22023', null,
  'erasure reasons stay safe codes'
);

select extensions.is(
  (select public.erase_monitoring_update_extracts(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000601'::uuid,
    'AGREEMENT_TERMINATED'
  ) ->> 'erased'),
  'true',
  'the privileged path erases extract-derived coverage with audit'
);

select extensions.is(
  (select coverage from public.growth_intelligence_monitoring_updates
   where organization_id = 'e7000000-0000-4000-8000-000000000201'::uuid
     and update_id = 'e7000000-0000-4000-8000-000000000601'::uuid),
  null,
  'erasure removes the extract-derived coverage'
);

select extensions.is(
  (select stage from public.growth_intelligence_monitoring_updates
   where organization_id = 'e7000000-0000-4000-8000-000000000201'::uuid
     and update_id = 'e7000000-0000-4000-8000-000000000601'::uuid),
  'research_failed',
  'erasure keeps the terminal stage it audited'
);

select extensions.is(
  (select known_cost_micros_usd from public.growth_intelligence_monitoring_updates
   where organization_id = 'e7000000-0000-4000-8000-000000000201'::uuid
     and update_id = 'e7000000-0000-4000-8000-000000000601'::uuid),
  1200,
  'erasure keeps the ledger totals it audited'
);

select extensions.is(
  (select erasure_reason_code from public.growth_intelligence_monitoring_updates
   where organization_id = 'e7000000-0000-4000-8000-000000000201'::uuid
     and update_id = 'e7000000-0000-4000-8000-000000000601'::uuid),
  'AGREEMENT_TERMINATED',
  'erasure keeps the safe reason code'
);

reset role;

-- Two-account isolation -----------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'e7000000-0000-4000-8000-000000000004';

select extensions.is(
  (select pg_catalog.count(*)::integer from public.growth_intelligence_monitoring_updates),
  0,
  'the second tenant reads none of the first tenant lifecycle rows'
);

select extensions.throws_ok(
  $$ select public.open_monitoring_update(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000004'::uuid,
    (select project_id from pg_temp.ml_keyed),
    'e7000000-0000-4000-8000-000000000603'::uuid,
    null,
    'e7000000-0000-4000-8000-000000000615'::uuid,
    600
  ) $$,
  '42501', null,
  'the second tenant cannot open updates on the first tenant project'
);

select extensions.throws_ok(
  $$ select public.settle_monitoring_update(
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000004'::uuid,
    'e7000000-0000-4000-8000-000000000601'::uuid,
    'cancelled',
    'WORKER_CANCELLED',
    false,
    null,
    0,
    0,
    'e7000000-0000-4000-8000-000000000611'::uuid
  ) $$,
  '42501', null,
  'the second tenant cannot settle the first tenant update'
);

reset role;

-- Direct-DML refusal ----------------------------------------------------------------------

-- The guard triggers sit below the table grants, so these probes run as the
-- table owner: no session role holds a write grant by design.

select extensions.throws_ok(
  $$ insert into public.growth_intelligence_monitoring_updates (
    update_id, organization_id, project_id, stage
  ) values (
    'e7000000-0000-4000-8000-000000000604'::uuid,
    'e7000000-0000-4000-8000-000000000201'::uuid,
    (select project_id from pg_temp.ml_keyed),
    'ready'
  ) $$,
  '42501', null,
  'sessions without a write grant cannot insert lifecycle rows'
);

select extensions.throws_ok(
  $$ update public.growth_intelligence_monitoring_updates
     set stage = 'cancelled'
     where organization_id = 'e7000000-0000-4000-8000-000000000201'::uuid
       and update_id = 'e7000000-0000-4000-8000-000000000601'::uuid $$,
  '42501', null,
  'sessions without a write grant cannot rewrite lifecycle stages'
);

select extensions.throws_ok(
  $$ delete from public.growth_intelligence_monitoring_updates
     where organization_id = 'e7000000-0000-4000-8000-000000000201'::uuid
       and update_id = 'e7000000-0000-4000-8000-000000000601'::uuid $$,
  '42501', null,
  'lifecycle history cannot be deleted outside the governed path'
);

select extensions.throws_ok(
  $$ insert into public.growth_intelligence_project_create_keys (
    organization_id, idempotency_key, project_id, body_digest
  ) values (
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'direct-key',
    (select project_id from pg_temp.ml_keyed),
    '0123456789abcdef0123456789abcdef'
  ) $$,
  '42501', null,
  'sessions without a write grant cannot forge create keys'
);

select extensions.throws_ok(
  $$ delete from public.growth_intelligence_monitoring_active_scopes
     where organization_id = 'e7000000-0000-4000-8000-000000000201'::uuid $$,
  '42501', null,
  'scope fingerprints cannot be dropped outside the governed release'
);

select extensions.throws_ok(
  $$ insert into public.growth_intelligence_report_reviews (
    organization_id, report_version_id
  ) values (
    'e7000000-0000-4000-8000-000000000201'::uuid,
    'e7000000-0000-4000-8000-000000000701'::uuid
  ) $$,
  '42501', null,
  'sessions without a write grant cannot forge reviews'
);

select * from extensions.finish();

rollback;
