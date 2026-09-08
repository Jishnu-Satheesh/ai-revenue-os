begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(40);

-- Contract, kinds, and grants ----------------------------------------------

select extensions.has_function(
  'public', 'start_branch_market_research',
  array['uuid', 'uuid', 'uuid', 'jsonb', 'text', 'uuid', 'text', 'uuid'],
  'the atomic branch research start is one governed operation'
);
select extensions.has_function(
  'public', 'enqueue_due_scoped_market_research',
  array['integer'],
  'due scheduling enumerates enabled scoped profiles'
);
select extensions.has_function(
  'private', 'enqueue_growth_intelligence_evidence_requests',
  array['uuid', 'uuid', 'uuid', 'date', 'date', 'text'],
  'the report-current wake-up keeps its signature under scoped resolution'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.start_branch_market_research(uuid,uuid,uuid,jsonb,text,uuid,text,uuid)',
    'execute'
  ),
  'signed-in members may start branch research through the governed RPC'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.start_branch_market_research(uuid,uuid,uuid,jsonb,text,uuid,text,uuid)',
    'execute'
  ),
  'anonymous callers cannot start branch research'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.enqueue_due_scoped_market_research(integer)', 'execute'
  ),
  'workers may run the scoped due scheduler'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'public.enqueue_due_scoped_market_research(integer)', 'execute'
  ),
  'browser sessions cannot run the scoped due scheduler directly'
);
select extensions.ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_item.oid)
      like '%start_branch_research%'
    from pg_catalog.pg_constraint constraint_item
    where constraint_item.conrelid = 'private.growth_intelligence_write_operations'::regclass
      and constraint_item.conname = 'growth_intelligence_write_operations_operation_kind_check'
  ),
  'the start operation carries its own idempotency kind'
);

-- Two-account fixtures -------------------------------------------------------

insert into auth.users (id) values
  ('d7000000-0000-4000-8000-000000000001'::uuid),
  ('d7000000-0000-4000-8000-000000000002'::uuid),
  ('d7000000-0000-4000-8000-000000000003'::uuid),
  ('d7000000-0000-4000-8000-000000000004'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('d7000000-0000-4000-8000-000000000101'::uuid, 'Branch start agency A', 'branch-start-agency-a', 'd7000000-0000-4000-8000-000000000001'::uuid),
  ('d7000000-0000-4000-8000-000000000102'::uuid, 'Branch start agency B', 'branch-start-agency-b', 'd7000000-0000-4000-8000-000000000004'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('d7000000-0000-4000-8000-000000000201'::uuid, 'd7000000-0000-4000-8000-000000000101'::uuid, 'Branch start client A', 'branch-start-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'd7000000-0000-4000-8000-000000000001'::uuid),
  ('d7000000-0000-4000-8000-000000000202'::uuid, 'd7000000-0000-4000-8000-000000000102'::uuid, 'Branch start client B', 'branch-start-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'd7000000-0000-4000-8000-000000000004'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('d7000000-0000-4000-8000-000000000101'::uuid, 'd7000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('d7000000-0000-4000-8000-000000000101'::uuid, 'd7000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator'),
  ('d7000000-0000-4000-8000-000000000101'::uuid, 'd7000000-0000-4000-8000-000000000003'::uuid, 'member', 'viewer'),
  ('d7000000-0000-4000-8000-000000000102'::uuid, 'd7000000-0000-4000-8000-000000000004'::uuid, 'owner', 'owner');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency, is_active
) values
  ('d7000000-0000-4000-8000-000000000301'::uuid, 'd7000000-0000-4000-8000-000000000201'::uuid, 'Dubai Marina', 'dubai-marina', 'physical', 'Asia/Dubai', 'AED', true),
  ('d7000000-0000-4000-8000-000000000302'::uuid, 'd7000000-0000-4000-8000-000000000201'::uuid, 'Downtown Dubai', 'downtown-dubai', 'physical', 'Asia/Dubai', 'AED', true),
  ('d7000000-0000-4000-8000-000000000303'::uuid, 'd7000000-0000-4000-8000-000000000202'::uuid, 'Other tenant branch', 'other-tenant-branch', 'physical', 'Asia/Dubai', 'AED', true),
  ('d7000000-0000-4000-8000-000000000304'::uuid, 'd7000000-0000-4000-8000-000000000201'::uuid, 'Closed branch', 'closed-branch', 'physical', 'Asia/Dubai', 'AED', false),
  ('d7000000-0000-4000-8000-000000000305'::uuid, 'd7000000-0000-4000-8000-000000000201'::uuid, 'Umm Suqeim', 'umm-suqeim', 'physical', 'Asia/Dubai', 'AED', true);

create or replace function pg_temp.v2_start_doc(
  p_branch_id uuid default 'd7000000-0000-4000-8000-000000000301'::uuid,
  p_name text default 'Kerala Kitchen Marina'
)
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'branchId', p_branch_id,
    'publicIdentity', pg_catalog.jsonb_build_object(
      'approvedName', p_name,
      'domains', pg_catalog.jsonb_build_array('example.com'),
      'publicUrls', pg_catalog.jsonb_build_array('https://example.com/menu')
    ),
    'nicheDescriptors', pg_catalog.jsonb_build_array('Kerala cuisine', 'Restaurant'),
    'geographies', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'layer', 'city', 'locationRef', 'ae:du', 'name', 'Dubai', 'countryCode', 'AE'
      ),
      pg_catalog.jsonb_build_object(
        'layer', 'country', 'locationRef', 'ae', 'name', 'United Arab Emirates',
        'countryCode', 'AE'
      ),
      pg_catalog.jsonb_build_object(
        'layer', 'trade_area', 'locationRef', 'ae:du:dubai-marina',
        'name', 'Dubai Marina delivery area', 'branchId', p_branch_id, 'radiusKm', 8
      )
    ),
    'competitors', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'key', 'marina-rival', 'name', 'Marina Rival',
        'geographyRefs', pg_catalog.jsonb_build_array('ae:du'),
        'provenance', 'operator_lead', 'suggestedBy', 'operator',
        'relevanceEvidenceUrls', '[]'::jsonb
      )
    ),
    'topics', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('key', 'local-events', 'label', 'Local events', 'provenance', 'operator')
    ),
    'sourcePolicy', pg_catalog.jsonb_build_object(
      'excludedDomains', pg_catalog.jsonb_build_array('spam.example'),
      'excludedPublishers', pg_catalog.jsonb_build_array('Untrusted Publisher'),
      'excludedCompetitorKeys', '[]'::jsonb,
      'allowBoundedQuotes', true,
      'maxQuotationCharacters', 240
    ),
    'cadence', pg_catalog.jsonb_build_object(
      'timeZone', 'Asia/Dubai', 'dailyLocalTime', '06:30',
      'weeklyDay', 'monday', 'weeklyLocalTime', '07:00'
    )
  );
$$;

create or replace function pg_temp.start_digest(p_document jsonb)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.create_market_profile_digest(p_document);
$$;

create or replace function pg_temp.branch_start(
  p_actor_id uuid,
  p_branch_id uuid,
  p_document jsonb,
  p_idempotency_key text,
  p_expected_current_version_id uuid default null,
  p_organization_id uuid default 'd7000000-0000-4000-8000-000000000201'::uuid
)
returns jsonb
language sql
as $$
  select public.start_branch_market_research(
    p_organization_id,
    p_actor_id,
    p_branch_id,
    p_document,
    pg_temp.start_digest(p_document),
    p_expected_current_version_id,
    p_idempotency_key,
    'd7000000-0000-4000-8000-000000000701'::uuid
  );
$$;

-- Atomic start, idempotency, and same-branch replacement -----------------------

set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-4000-8000-000000000002';

select extensions.is(
  (
    select pg_temp.branch_start(
      'd7000000-0000-4000-8000-000000000002'::uuid,
      'd7000000-0000-4000-8000-000000000301'::uuid,
      pg_temp.v2_start_doc(),
      'branch-start-marina-0001'
    ) ->> 'outcome'
  ),
  'started',
  'a first branch start opens its pipeline'
);
select extensions.is(
  (
    select pg_temp.branch_start(
      'd7000000-0000-4000-8000-000000000002'::uuid,
      'd7000000-0000-4000-8000-000000000301'::uuid,
      pg_temp.v2_start_doc(),
      'branch-start-marina-0001'
    ) ->> 'outcome'
  ),
  'replayed',
  'the same retry key with the same body replays the start'
);
select extensions.is(
  (
    select (second.call ->> 'pipelineId')
      = (first.call ->> 'pipelineId')
      and (second.call ->> 'researchRequestId')
      = (first.call ->> 'researchRequestId')
    from (select pg_temp.branch_start(
      'd7000000-0000-4000-8000-000000000002'::uuid,
      'd7000000-0000-4000-8000-000000000301'::uuid,
      pg_temp.v2_start_doc(),
      'branch-start-marina-0001'
    ) as call) first,
    (select pg_temp.branch_start(
      'd7000000-0000-4000-8000-000000000002'::uuid,
      'd7000000-0000-4000-8000-000000000301'::uuid,
      pg_temp.v2_start_doc(),
      'branch-start-marina-0002'
    ) as call) second
  ),
  true,
  'two browser keys with the same scope converge on one pipeline'
);
select extensions.is(
  (
    select pg_temp.branch_start(
      'd7000000-0000-4000-8000-000000000002'::uuid,
      'd7000000-0000-4000-8000-000000000301'::uuid,
      pg_temp.v2_start_doc(),
      'branch-start-marina-0002b'
    ) ->> 'outcome'
  ),
  'existing_active',
  'a fresh key over identical active scope reports the existing pipeline'
);
select extensions.throws_ok(
  $$ select pg_temp.branch_start(
    'd7000000-0000-4000-8000-000000000002'::uuid,
    'd7000000-0000-4000-8000-000000000301'::uuid,
    pg_temp.v2_start_doc(
      'd7000000-0000-4000-8000-000000000301'::uuid,
      'Kerala Kitchen Marina Edited'
    ),
    'branch-start-marina-0001'
  ) $$,
  '23505', 'market_profile_start_idempotency_conflict',
  'the same retry key with a different body conflicts instead of forking'
);
select extensions.is(
  (
    select pg_temp.branch_start(
      'd7000000-0000-4000-8000-000000000002'::uuid,
      'd7000000-0000-4000-8000-000000000302'::uuid,
      pg_temp.v2_start_doc(
        'd7000000-0000-4000-8000-000000000302'::uuid,
        'Kerala Kitchen Downtown'
      ),
      'branch-start-downtown-0001'
    ) ->> 'outcome'
  ),
  'started',
  'a sibling branch start survives beside the first branch pipeline'
);
select extensions.ok(
  (
    select first.call ->> 'pipelineId' is distinct from second.call ->> 'pipelineId'
    from (select pg_temp.branch_start(
      'd7000000-0000-4000-8000-000000000002'::uuid,
      'd7000000-0000-4000-8000-000000000301'::uuid,
      pg_temp.v2_start_doc(),
      'branch-start-marina-0001'
    ) as call) first,
    (select pg_temp.branch_start(
      'd7000000-0000-4000-8000-000000000002'::uuid,
      'd7000000-0000-4000-8000-000000000302'::uuid,
      pg_temp.v2_start_doc(
        'd7000000-0000-4000-8000-000000000302'::uuid,
        'Kerala Kitchen Downtown'
      ),
      'branch-start-downtown-0001'
    ) as call) second
  ),
  'sibling branches hold independent pipelines'
);
select extensions.is(
  (
    select pg_temp.branch_start(
      'd7000000-0000-4000-8000-000000000002'::uuid,
      'd7000000-0000-4000-8000-000000000301'::uuid,
      pg_temp.v2_start_doc(
        'd7000000-0000-4000-8000-000000000301'::uuid,
        'Kerala Kitchen Marina Edited'
      ),
      'branch-start-marina-0003'
    ) ->> 'outcome'
  ),
  'started',
  'editing the scope starts replacement work for that branch'
);
select extensions.is(
  (
    select count(*)::bigint
    from public.growth_intelligence_research_pipelines pipeline
    where pipeline.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
      and pipeline.branch_id = 'd7000000-0000-4000-8000-000000000301'::uuid
      and pipeline.stage = 'cancelled'
  ),
  1::bigint,
  'editing a branch cancels only its own prior pipeline'
);
select extensions.is(
  (
    select count(*)::bigint
    from public.growth_intelligence_research_pipelines pipeline
    where pipeline.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
      and pipeline.branch_id = 'd7000000-0000-4000-8000-000000000302'::uuid
      and pipeline.stage in ('queued', 'researching', 'preparing_insights')
  ),
  1::bigint,
  'the sibling branch pipeline stays active while its neighbor is replaced'
);

-- Stale reviews and failed starts leave nothing behind --------------------------

create temporary table start_version_guard (
  version_count bigint,
  pipeline_count bigint
);

insert into start_version_guard
select
  (select count(*) from public.organization_market_profile_versions
   where organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid),
  (select count(*) from public.growth_intelligence_research_pipelines
   where organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid);

select extensions.throws_ok(
  $$ select pg_temp.branch_start(
    'd7000000-0000-4000-8000-000000000002'::uuid,
    'd7000000-0000-4000-8000-000000000301'::uuid,
    pg_temp.v2_start_doc(
      'd7000000-0000-4000-8000-000000000301'::uuid,
      'Kerala Kitchen Marina Stale'
    ),
    'branch-start-marina-0004',
    'c9000000-0000-4000-8000-000000000099'::uuid
  ) $$,
  '23505', 'market_profile_version_conflict',
  'a stale expected version conflicts and keeps the operator edits uncommitted'
);
select extensions.is(
  (
    select guard.version_count
      = (select count(*) from public.organization_market_profile_versions
         where organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid)
      and guard.pipeline_count
      = (select count(*) from public.growth_intelligence_research_pipelines
         where organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid)
    from start_version_guard guard
  ),
  true,
  'a failed start leaves no half-confirmed version or pipeline behind'
);

reset role;

update public.growth_intelligence_research_pipelines pipeline
set stage = 'ready'
where pipeline.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
  and pipeline.branch_id = 'd7000000-0000-4000-8000-000000000301'::uuid
  and pipeline.stage in ('queued', 'researching', 'preparing_insights');

set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-4000-8000-000000000002';

select extensions.is(
  (
    select replay.call ->> 'outcome'
    from (select pg_temp.branch_start(
      'd7000000-0000-4000-8000-000000000002'::uuid,
      'd7000000-0000-4000-8000-000000000301'::uuid,
      pg_temp.v2_start_doc(
        'd7000000-0000-4000-8000-000000000301'::uuid,
        'Kerala Kitchen Marina Edited'
      ),
      'branch-start-marina-0005'
    ) as call) replay
  ),
  'started',
  'unchanged scope after a terminal outcome starts new work'
);
select extensions.is(
  (
    select guard.version_count
      = (select count(*) from public.organization_market_profile_versions
         where organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid)
      and guard.pipeline_count + 1
      = (select count(*) from public.growth_intelligence_research_pipelines
         where organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid)
    from start_version_guard guard
  ),
  true,
  'unchanged completed scope starts new work without a new profile version'
);
select extensions.is(
  (
    select count(*)::bigint
    from public.growth_intelligence_requests request
    join public.organization_market_profiles profile
      on profile.organization_id = request.organization_id
      and profile.id = (
        select pipeline.market_profile_id
        from public.growth_intelligence_research_pipelines pipeline
        where pipeline.organization_id = request.organization_id
          and pipeline.id = request.pipeline_id
      )
    where request.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
      and request.market_profile_version_id = profile.current_version_id
      and profile.branch_id = 'd7000000-0000-4000-8000-000000000301'::uuid
      and request.phase = 'research'
  ),
  2::bigint,
  'the rerun mints its own research request beside the completed run'
);

-- Lineage: pipeline and request point at each other inside the branch --------

select extensions.is(
  (
    select request.phase = 'research'
      and request.pipeline_id = pipeline.id
      and pipeline.research_request_id = request.id
      and request.branch_id = pipeline.branch_id
      and pipeline.market_profile_id = profile.id
      and profile.branch_id = pipeline.branch_id
    from public.growth_intelligence_research_pipelines pipeline
    join public.growth_intelligence_requests request
      on request.organization_id = pipeline.organization_id
      and request.id = pipeline.research_request_id
    join public.organization_market_profiles profile
      on profile.organization_id = pipeline.organization_id
      and profile.id = pipeline.market_profile_id
    where pipeline.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
      and pipeline.branch_id = 'd7000000-0000-4000-8000-000000000301'::uuid
      and pipeline.stage in ('queued', 'researching', 'preparing_insights', 'ready')
    order by pipeline.created_at desc, pipeline.id desc
    limit 1
  ),
  true,
  'pipeline, request, profile, and branch lineage agree within the branch'
);
select extensions.ok(
  (
    select profile.enabled
      and profile.current_version_id is not null
      and exists (
        select 1 from public.organization_market_profile_decisions decision
        where decision.organization_id = profile.organization_id
          and decision.market_profile_id = profile.id
          and decision.market_profile_version_id = profile.current_version_id
          and decision.decision = 'confirmed'
      )
    from public.organization_market_profiles profile
    where profile.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
      and profile.branch_id = 'd7000000-0000-4000-8000-000000000301'::uuid
  ),
  'a start enables its branch profile and records the confirmation audit'
);

-- Inactive, foreign, and viewer starts are refused ------------------------------

select extensions.throws_ok(
  $$ select pg_temp.branch_start(
    'd7000000-0000-4000-8000-000000000002'::uuid,
    'd7000000-0000-4000-8000-000000000304'::uuid,
    pg_temp.v2_start_doc(
      'd7000000-0000-4000-8000-000000000304'::uuid,
      'Kerala Kitchen Closed'
    ),
    'branch-start-closed-0001'
  ) $$,
  '42501', 'market_profile_branch_not_found',
  'an inactive branch cannot start research'
);
select extensions.throws_ok(
  $$ select pg_temp.branch_start(
    'd7000000-0000-4000-8000-000000000002'::uuid,
    'd7000000-0000-4000-8000-000000000303'::uuid,
    pg_temp.v2_start_doc(
      'd7000000-0000-4000-8000-000000000303'::uuid,
      'Kerala Kitchen Foreign'
    ),
    'branch-start-foreign-0001'
  ) $$,
  '42501', 'market_profile_branch_not_found',
  'another tenant branch cannot start research here'
);

set local request.jwt.claim.sub = 'd7000000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$ select pg_temp.branch_start(
    'd7000000-0000-4000-8000-000000000003'::uuid,
    'd7000000-0000-4000-8000-000000000301'::uuid,
    pg_temp.v2_start_doc(),
    'branch-start-viewer-0001'
  ) $$,
  '42501', 'market_profile_start_forbidden',
  'a viewer mutation is rejected before any branch work begins'
);

reset role;

-- Scoped due scheduling ----------------------------------------------------------

-- The sweep runs staging-wide and other organizations may hold live enabled
-- profiles, so every sweep assertion below filters to this suite's fixtures.
create temporary table due_sweep_first as
select public.enqueue_due_scoped_market_research(100) as result;

select extensions.is(
  (
    select count(*)::integer
    from pg_catalog.jsonb_array_elements((select result from due_sweep_first)) entry
    where entry.value ->> 'organizationId' = 'd7000000-0000-4000-8000-000000000201'
  ),
  4::integer,
  'one sweep enqueues daily and weekly work for each enabled scoped profile'
);
select extensions.is(
  (
    select count(*)::bigint
    from public.growth_intelligence_requests request
    where request.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
      and request.trigger_reason = 'daily_due'
      and request.kind = 'market_research'
      and request.branch_id is not null
      and request.local_time_bucket like 'daily:%'
  ),
  2::bigint,
  'daily due rows carry their source branch and local-day bucket'
);
select extensions.is(
  (
    select count(*)::bigint
    from public.growth_intelligence_requests request
    where request.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
      and request.trigger_reason = 'weekly_due'
      and request.kind = 'weekly_synthesis'
      and request.branch_id is not null
      and request.local_time_bucket like 'weekly:%'
  ),
  2::bigint,
  'weekly due rows carry their source branch and local-week bucket'
);
select extensions.ok(
  (
    select pg_catalog.every(
      profile.next_daily_research_due_at is not null
      and profile.next_weekly_synthesis_due_at is not null
    )
    from public.organization_market_profiles profile
    where profile.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
      and profile.enabled
  ),
  'each swept scope advances its own cadence markers'
);
select extensions.throws_ok(
  $$ select public.enqueue_due_scoped_market_research(0) $$,
  '22023', null,
  'the due scheduler refuses an unbounded sweep'
);

create temporary table due_request_guard (request_count bigint);

insert into due_request_guard
select count(*) from public.growth_intelligence_requests
where organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
  and trigger_reason in ('daily_due', 'weekly_due');

update public.organization_market_profiles profile
set next_daily_research_due_at = pg_catalog.now() - interval '1 hour',
    next_weekly_synthesis_due_at = pg_catalog.now() - interval '1 hour'
where profile.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
  and profile.enabled;

create temporary table due_sweep_second as
select public.enqueue_due_scoped_market_research(100) as result;

select extensions.is(
  (
    select pg_catalog.bool_and((entry.value ->> 'replayed')::boolean)
    from pg_catalog.jsonb_array_elements((select result from due_sweep_second)) entry
    where entry.value ->> 'organizationId' = 'd7000000-0000-4000-8000-000000000201'
  ),
  true,
  'same-bucket due reruns dedupe through the request fingerprint'
);
select extensions.is(
  (
    select guard.request_count
      = (select count(*) from public.growth_intelligence_requests
         where organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
           and trigger_reason in ('daily_due', 'weekly_due'))
    from due_request_guard guard
  ),
  true,
  'deduped due reruns insert no duplicate rows'
);

update public.organization_market_profiles profile
set enabled = false
where profile.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
  and profile.branch_id = 'd7000000-0000-4000-8000-000000000302'::uuid;

update public.organization_market_profiles profile
set next_daily_research_due_at = pg_catalog.now() - interval '1 hour',
    next_weekly_synthesis_due_at = pg_catalog.now() - interval '1 hour'
where profile.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
  and profile.branch_id = 'd7000000-0000-4000-8000-000000000301'::uuid;

select extensions.is(
  (
    select count(*)::bigint
    from pg_catalog.jsonb_array_elements(public.enqueue_due_scoped_market_research(25)) entry
    where (entry.value ->> 'branchId') = 'd7000000-0000-4000-8000-000000000302'::text
      and coalesce((entry.value ->> 'skipped')::boolean, false) = false
  ),
  0::bigint,
  'a disabled scope schedules nothing while its sibling keeps its cadence'
);

-- Scoped report-current wake-up ----------------------------------------------------

select extensions.diag(
  'TMP marina profile state: ' || (
    select pg_catalog.row_to_json(row)::text
    from (
      select profile.enabled, profile.current_version_id, version.profile_digest
      from public.organization_market_profiles profile
      left join public.organization_market_profile_versions version
        on version.organization_id = profile.organization_id
        and version.id = profile.current_version_id
      where profile.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
        and profile.branch_id = 'd7000000-0000-4000-8000-000000000301'::uuid
    ) row
  )
);
select extensions.diag(
  'TMP evidence august result: ' || private.enqueue_growth_intelligence_evidence_requests(
    'd7000000-0000-4000-8000-000000000201'::uuid,
    null,
    'd7000000-0000-4000-8000-000000000301'::uuid,
    '2026-08-01'::date, '2026-08-31'::date, 'Asia/Dubai'
  )::text
);
select extensions.diag(
  'TMP request rows: ' || (
    select count(*)::text from public.growth_intelligence_requests
    where organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
  )
);

select extensions.is(
  (
    select request.market_profile_version_id
    from pg_catalog.jsonb_array_elements(
      private.enqueue_growth_intelligence_evidence_requests(
        'd7000000-0000-4000-8000-000000000201'::uuid,
        null,
        'd7000000-0000-4000-8000-000000000301'::uuid,
        '2026-08-01'::date, '2026-08-31'::date, 'Asia/Dubai'
      )
    ) entry
    join public.growth_intelligence_requests request
      on request.id = (entry.value ->> 'requestId')::uuid
    limit 1
  ),
  (
    select profile.current_version_id
    from public.organization_market_profiles profile
    where profile.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
      and profile.branch_id = 'd7000000-0000-4000-8000-000000000301'::uuid
  ),
  'report-current evidence wakes the exact branch scope'
);
select extensions.is(
  (
    select pg_catalog.bool_and((entry.value ->> 'replayed')::boolean)
    from pg_catalog.jsonb_array_elements(
      private.enqueue_growth_intelligence_evidence_requests(
        'd7000000-0000-4000-8000-000000000201'::uuid,
        null,
        'd7000000-0000-4000-8000-000000000301'::uuid,
        '2026-08-01'::date, '2026-08-31'::date, 'Asia/Dubai'
      )
    ) entry
  ),
  true,
  'unchanged report-current evidence replays its durable request'
);

insert into public.organization_market_profiles (organization_id, branch_id, enabled)
values ('d7000000-0000-4000-8000-000000000201'::uuid, null, false);

insert into public.organization_market_profile_versions (
  organization_id, market_profile_id, version, schema_version,
  profile_document, profile_digest, source_policy_digest, proposal_source,
  created_by, correlation_id
)
select
  'd7000000-0000-4000-8000-000000000201'::uuid,
  profile.id, 1, 1,
  '{"legacy":"organization scope"}'::jsonb,
  pg_temp.start_digest(pg_temp.v2_start_doc()),
  pg_temp.start_digest(pg_temp.v2_start_doc()),
  'operator',
  'd7000000-0000-4000-8000-000000000001'::uuid,
  'd7000000-0000-4000-8000-000000000702'::uuid
from public.organization_market_profiles profile
where profile.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
  and profile.branch_id is null;

update public.organization_market_profiles profile
set current_version_id = version.id, enabled = true
from public.organization_market_profile_versions version
where version.organization_id = profile.organization_id
  and version.market_profile_id = profile.id
  and profile.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
  and profile.branch_id is null;

select extensions.diag(
  'TMP legacy profile state: ' || (
    select pg_catalog.string_agg(
      coalesce(profile.branch_id::text, 'null') || ':' || profile.enabled::text,
      ',' order by profile.branch_id nulls first
    )
    from public.organization_market_profiles profile
    where profile.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
  )
);
select extensions.diag(
  'TMP legacy evidence result: ' || private.enqueue_growth_intelligence_evidence_requests(
    'd7000000-0000-4000-8000-000000000201'::uuid,
    null,
    'd7000000-0000-4000-8000-000000000305'::uuid,
    '2026-08-01'::date, '2026-08-31'::date, 'Asia/Dubai'
  )::text
);
select extensions.is(
  (
    select request.market_profile_version_id
    from pg_catalog.jsonb_array_elements(
      private.enqueue_growth_intelligence_evidence_requests(
        'd7000000-0000-4000-8000-000000000201'::uuid,
        null,
        'd7000000-0000-4000-8000-000000000305'::uuid,
        '2026-08-01'::date, '2026-08-31'::date, 'Asia/Dubai'
      )
    ) entry
    join public.growth_intelligence_requests request
      on request.id = (entry.value ->> 'requestId')::uuid
    limit 1
  ),
  (
    select profile.current_version_id
    from public.organization_market_profiles profile
    where profile.organization_id = 'd7000000-0000-4000-8000-000000000201'::uuid
      and profile.branch_id is null
  ),
  'a branch without its own profile still wakes the legacy organization scope'
);
select extensions.ok(
  (
    select branch_request.market_profile_version_id
      is distinct from legacy_request.market_profile_version_id
    from (
      select request.market_profile_version_id
      from pg_catalog.jsonb_array_elements(
        private.enqueue_growth_intelligence_evidence_requests(
          'd7000000-0000-4000-8000-000000000201'::uuid,
          null,
          'd7000000-0000-4000-8000-000000000301'::uuid,
          '2026-09-01'::date, '2026-09-30'::date, 'Asia/Dubai'
        )
      ) entry
      join public.growth_intelligence_requests request
        on request.id = (entry.value ->> 'requestId')::uuid
      limit 1
    ) branch_request,
    (
      select request.market_profile_version_id
      from pg_catalog.jsonb_array_elements(
        private.enqueue_growth_intelligence_evidence_requests(
          'd7000000-0000-4000-8000-000000000201'::uuid,
          null,
          'd7000000-0000-4000-8000-000000000305'::uuid,
          '2026-09-01'::date, '2026-09-30'::date, 'Asia/Dubai'
        )
      ) entry
      join public.growth_intelligence_requests request
        on request.id = (entry.value ->> 'requestId')::uuid
      limit 1
    ) legacy_request
  ),
  'branch and legacy evidence wake isolated scopes with no duplicate dispatch'
);

rollback;
