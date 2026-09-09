begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(68);

-- Contract ------------------------------------------------------------------

select extensions.has_function(
  'public', 'complete_market_research_pipeline',
  array['uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'jsonb', 'jsonb'],
  'research completion plus synthesis scheduling is one fenced operation'
);
select extensions.has_function(
  'public', 'retry_market_research_synthesis',
  array['uuid', 'uuid', 'uuid', 'text', 'uuid'],
  'analysis-only retry requeues the same eligible child'
);
select extensions.has_function(
  'public', 'complete_market_synthesis_pipeline',
  array['uuid', 'uuid', 'uuid', 'uuid', 'jsonb'],
  'synthesis items, request and pipeline settle in one transaction'
);
select extensions.has_function(
  'public', 'fail_market_synthesis_pipeline',
  array['uuid', 'uuid', 'uuid', 'uuid', 'text'],
  'synthesis failure lands run, request and pipeline together'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.complete_market_research_pipeline(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb)',
    'execute'
  ),
  'workers complete pipelines through the fenced RPC'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.complete_market_research_pipeline(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb)',
    'execute'
  ),
  'browser sessions cannot complete pipelines directly'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.retry_market_research_synthesis(uuid,uuid,uuid,text,uuid)',
    'execute'
  ),
  'signed-in managers may retry a failed synthesis'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.retry_market_research_synthesis(uuid,uuid,uuid,text,uuid)',
    'execute'
  ),
  'anonymous callers cannot retry synthesis'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.complete_market_synthesis_pipeline(uuid,uuid,uuid,uuid,jsonb)',
    'execute'
  ),
  'workers finalize synthesis through the fenced RPC'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.complete_market_synthesis_pipeline(uuid,uuid,uuid,uuid,jsonb)',
    'execute'
  ),
  'browser sessions cannot finalize synthesis directly'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.fail_market_synthesis_pipeline(uuid,uuid,uuid,uuid,text)',
    'execute'
  ),
  'workers fail synthesis through the fenced RPC'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.fail_market_synthesis_pipeline(uuid,uuid,uuid,uuid,text)',
    'execute'
  ),
  'browser sessions cannot fail synthesis directly'
);

-- The handoff child needs its kind and trigger reason in the table checks ---

select extensions.ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_item.oid)
      like '%market_evidence_changed%'
    from pg_catalog.pg_constraint constraint_item
    where constraint_item.conrelid = 'public.growth_intelligence_requests'::regclass
      and constraint_item.conname = 'growth_intelligence_requests_kind_check'
  ),
  'the request kind check admits the handoff child'
);
select extensions.ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_item.oid)
      like '%market_research_completed%'
    from pg_catalog.pg_constraint constraint_item
    where constraint_item.conrelid = 'public.growth_intelligence_requests'::regclass
      and constraint_item.conname = 'growth_intelligence_requests_trigger_reason_check'
  ),
  'the trigger reason check admits the handoff reason'
);

-- The sweeper survives poison scopes ------------------------------------------

select extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.enqueue_due_scoped_market_research(integer)'::regprocedure
  ) like '%23505%',
  'the due scheduler skips unique-conflict scopes instead of aborting'
);
select extensions.ok(
  pg_catalog.pg_get_functiondef(
    'public.enqueue_due_scoped_market_research(integer)'::regprocedure
  ) like '%55000%',
  'the due scheduler skips poison-object scopes instead of aborting'
);

-- Two-tenant fixtures ----------------------------------------------------------

insert into auth.users (id) values
  ('f1000000-0000-4000-8000-000000000001'::uuid),
  ('f1000000-0000-4000-8000-000000000002'::uuid),
  ('f1000000-0000-4000-8000-000000000004'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('f1000000-0000-4000-8000-000000000101'::uuid, 'Handoff agency A', 'handoff-agency-a', 'f1000000-0000-4000-8000-000000000001'::uuid),
  ('f1000000-0000-4000-8000-000000000102'::uuid, 'Handoff agency B', 'handoff-agency-b', 'f1000000-0000-4000-8000-000000000004'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('f1000000-0000-4000-8000-000000000201'::uuid, 'f1000000-0000-4000-8000-000000000101'::uuid, 'Handoff client A', 'handoff-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'f1000000-0000-4000-8000-000000000001'::uuid),
  ('f1000000-0000-4000-8000-000000000202'::uuid, 'f1000000-0000-4000-8000-000000000102'::uuid, 'Handoff client B', 'handoff-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'f1000000-0000-4000-8000-000000000004'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('f1000000-0000-4000-8000-000000000101'::uuid, 'f1000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('f1000000-0000-4000-8000-000000000101'::uuid, 'f1000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator'),
  ('f1000000-0000-4000-8000-000000000102'::uuid, 'f1000000-0000-4000-8000-000000000004'::uuid, 'owner', 'owner');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency, is_active
) values
  ('f1000000-0000-4000-8000-000000000301'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'Handoff Marina', 'handoff-marina', 'physical', 'Asia/Dubai', 'AED', true),
  ('f1000000-0000-4000-8000-000000000302'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'Handoff Downtown', 'handoff-downtown', 'physical', 'Asia/Dubai', 'AED', true),
  ('f1000000-0000-4000-8000-000000000303'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'Handoff Deira', 'handoff-deira', 'physical', 'Asia/Dubai', 'AED', true),
  ('f1000000-0000-4000-8000-000000000304'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'Handoff JBR', 'handoff-jbr', 'physical', 'Asia/Dubai', 'AED', true),
  ('f1000000-0000-4000-8000-000000000305'::uuid, 'f1000000-0000-4000-8000-000000000201'::uuid, 'Handoff Palm', 'handoff-palm', 'physical', 'Asia/Dubai', 'AED', true),
  ('f1000000-0000-4000-8000-000000000311'::uuid, 'f1000000-0000-4000-8000-000000000202'::uuid, 'Handoff Other A', 'handoff-other-a', 'physical', 'Asia/Dubai', 'AED', true),
  ('f1000000-0000-4000-8000-000000000312'::uuid, 'f1000000-0000-4000-8000-000000000202'::uuid, 'Handoff Other B', 'handoff-other-b', 'physical', 'Asia/Dubai', 'AED', true);

-- Pipeline identity is captured at start time, keyed by the start
-- idempotency key. Same-transaction created_at ties make "latest by time"
-- random once a branch owns two pipelines, so recency follows the
-- human-ordered keys (-001 before -002) instead of the clock. Created here,
-- before any helper that references it.
create temporary table pg_temp.pipe_keys(
  branch_id uuid, branch_key text, pipeline_id uuid
);

create or replace function pg_temp.handoff_doc(p_branch_id uuid)
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'branchId', p_branch_id,
    'publicIdentity', pg_catalog.jsonb_build_object(
      'approvedName', 'Handoff Kitchen',
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
        'layer', 'trade_area', 'locationRef', 'ae:du:handoff',
        'name', 'Handoff delivery area', 'branchId', p_branch_id, 'radiusKm', 8
      )
    ),
    'competitors', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'key', 'handoff-rival', 'name', 'Handoff Rival',
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

create or replace function pg_temp.handoff_start(
  p_organization_id uuid,
  p_branch_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  started jsonb;
begin
  select public.start_branch_market_research(
    p_organization_id,
    'f1000000-0000-4000-8000-000000000001'::uuid,
    p_branch_id,
    pg_temp.handoff_doc(p_branch_id),
    private.create_market_profile_digest(pg_temp.handoff_doc(p_branch_id)),
    null,
    p_idempotency_key,
    'f1000000-0000-4000-8000-000000000751'::uuid
  ) into started;
  insert into pg_temp.pipe_keys(branch_id, branch_key, pipeline_id)
  values (p_branch_id, p_idempotency_key, (started ->> 'pipelineId')::uuid);
  return started;
end;
$$;

create or replace function pg_temp.handoff_metadata()
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_object(
    'adapterProvider', 'qualified-research', 'adapterVersion', 'market-research@1',
    'modelProvider', 'gemini', 'modelVersion', 'gemini-fixture-review-1',
    'runFingerprint', pg_catalog.repeat('e', 64),
    'queryPlanDigest', pg_catalog.repeat('c', 64),
    'correlationId', 'f1000000-0000-4000-8000-000000000751'
  );
$$;

create or replace function pg_temp.handoff_payload()
returns jsonb
language sql
stable
as $$
  select pg_catalog.jsonb_build_object(
    'sources', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'key', 'tourism-signal', 'url', 'https://tourism.example/dubai-notice', 'domain', 'tourism.example',
        'publisher', 'Dubai Tourism', 'sourceClass', 'official', 'availability', 'available',
        'contentDigest', pg_catalog.repeat('a', 64), 'safeFailureCode', null,
        'retrievedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'publishedAt', null,
        'observedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ),
      pg_catalog.jsonb_build_object(
        'key', 'city-calendar', 'url', 'https://calendar.example/dubai-events', 'domain', 'calendar.example',
        'publisher', 'Dubai Calendar', 'sourceClass', 'first_party', 'availability', 'available',
        'contentDigest', pg_catalog.repeat('b', 64), 'safeFailureCode', null,
        'retrievedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'publishedAt', null,
        'observedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )
    ),
    'claims', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'key', 'tourism-demand', 'claimDigest', pg_catalog.repeat('1', 64),
        'subjectKind', 'market', 'subjectRef', 'dubai-market', 'claimKind', 'demand_signal',
        'paraphrase', 'A public market signal may affect local demand.', 'quotation', 'Dubai public event notice',
        'geographicLayer', 'city', 'geographyRef', 'ae:du', 'sourceKeys', pg_catalog.jsonb_build_array('tourism-signal'),
        'freshnessClass', 'standard', 'claimCategory', 'demand_trend', 'freshnessRegistryVersion', 1,
        'publishedAt', null,
        'observedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'staleAt', pg_catalog.to_char((pg_catalog.now() + interval '14 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'expiresAt', pg_catalog.to_char((pg_catalog.now() + interval '30 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'limitations', pg_catalog.jsonb_build_array('BROADER_MARKET_INFERENCE')
      ),
      pg_catalog.jsonb_build_object(
        'key', 'festival-calendar', 'claimDigest', pg_catalog.repeat('2', 64),
        'subjectKind', 'event', 'subjectRef', 'dubai-festival', 'claimKind', 'event_calendar',
        'paraphrase', 'A local calendar entry may affect demand timing.', 'quotation', null,
        'geographicLayer', 'city', 'geographyRef', 'ae:du', 'sourceKeys', pg_catalog.jsonb_build_array('city-calendar'),
        'freshnessClass', 'standard', 'claimCategory', 'event', 'freshnessRegistryVersion', 1,
        'publishedAt', null,
        'observedAt', pg_catalog.to_char(pg_catalog.now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'staleAt', pg_catalog.to_char((pg_catalog.now() + interval '7 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'expiresAt', pg_catalog.to_char((pg_catalog.now() + interval '14 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'limitations', '[]'::jsonb
      )
    ),
    'links', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('fromClaimKey', 'festival-calendar', 'toClaimKey', 'tourism-demand', 'relation', 'corroborates')
    )
  );
$$;

create or replace function pg_temp.handoff_result(
  p_attempts integer default 2,
  p_success integer default 2
)
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_object(
    'outcome', 'completed', 'resultDigest', pg_catalog.repeat('d', 64),
    'sourceAttemptCount', p_attempts, 'sourceSuccessCount', p_success,
    'adapterCostMicrosUsd', 42000, 'adapterLatencyMs', 721
  );
$$;

create or replace function pg_temp.handoff_coverage(p_second_outcome text default 'supported')
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'slotKey', 'local_market', 'kind', 'local_market', 'outcome', 'supported',
      'attemptIds', pg_catalog.jsonb_build_array('f1000000-0000-4000-8000-000000000761'),
      'acceptedClaimIds', pg_catalog.jsonb_build_array()
    ),
    pg_catalog.jsonb_build_object(
      'slotKey', 'topic:local-events', 'kind', 'topic', 'outcome', p_second_outcome,
      'attemptIds', pg_catalog.jsonb_build_array('f1000000-0000-4000-8000-000000000762'),
      'acceptedClaimIds', pg_catalog.jsonb_build_array()
    )
  );
$$;

create or replace function pg_temp.handoff_synthesis_result()
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_object(
    'outcome', 'completed',
    'resultDigest', pg_catalog.repeat('b', 64),
    'items', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'kind', 'insight',
        'narrative', 'Recorded dinner demand clusters across Dubai this month.',
        'itemFingerprint', pg_catalog.repeat('1', 64),
        'evidenceFingerprint', pg_catalog.repeat('2', 64),
        'geographicLayer', 'city',
        'geographyRef', 'ae:du',
        'supportGrade', 'corroborated',
        'freshness', 'current',
        'urgency', 'high',
        'goalAlignment', 'direct',
        'activityMonth', '2026-08',
        'claimIds', pg_catalog.jsonb_build_array(),
        'findings', pg_catalog.jsonb_build_array(),
        'goals', pg_catalog.jsonb_build_array()
      )
    )
  );
$$;

create or replace function pg_temp.pipeline_of(p_branch_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pipeline_id from pg_temp.pipe_keys
  where branch_id = p_branch_id
  order by branch_key desc limit 1;
$$;

create or replace function pg_temp.research_request_of(p_pipeline_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.growth_intelligence_requests
  where pipeline_id = p_pipeline_id and phase = 'research'
  order by created_at, id limit 1;
$$;

create or replace function pg_temp.synthesis_child_of(p_pipeline_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.growth_intelligence_requests
  where pipeline_id = p_pipeline_id and phase = 'synthesis'
  order by created_at, id limit 1;
$$;

create or replace function pg_temp.run_of(p_request_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.market_research_runs
  where growth_intelligence_request_id = p_request_id
  order by created_at desc, id desc limit 1;
$$;

create or replace function pg_temp.synthesis_run_of(p_request_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.growth_intelligence_synthesis_runs
  where growth_intelligence_request_id = p_request_id
  order by created_at desc, id desc limit 1;
$$;

-- Definer-owned reads for tables the worker role may not select directly.
create or replace function pg_temp.run_status(p_request_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select status from public.market_research_runs
  where growth_intelligence_request_id = p_request_id
  order by created_at desc, id desc limit 1;
$$;

-- Attempt ids cross role boundaries through a session table, the way the
-- budget suite shares replay-captured ids with the worker role.
create temporary table pg_temp.held_attempt(attempt_id uuid);
grant select, insert on pg_temp.held_attempt to service_role;

-- Happy path: start, claim, run, record, atomic handoff -------------------------

set local role service_role;

select extensions.is(
  pg_temp.handoff_start(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    'f1000000-0000-4000-8000-000000000301'::uuid,
    'handoff-pipeline-marina-001'
  ) ->> 'outcome',
  'started',
  'the first branch start opens a pipeline'
);

select extensions.is(
  (select stage from public.growth_intelligence_research_pipelines
   where id = pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)),
  'queued',
  'a fresh pipeline waits in queued'
);

select extensions.is(
  public.claim_growth_intelligence_request(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
    ),
    'f1000000-0000-4000-8000-000000000701'::uuid,
    600
  ) ->> 'outcome',
  'acquired',
  'the worker claims the research root'
);

select extensions.is(
  public.begin_market_research_run(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
    ),
    'f1000000-0000-4000-8000-000000000701'::uuid,
    pg_temp.handoff_metadata()
  ) ->> 'replayed',
  'false',
  'the first delivery begins one research run'
);

select extensions.is(
  public.record_market_evidence_claims(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
    ),
    'f1000000-0000-4000-8000-000000000701'::uuid,
    pg_temp.run_of(
      pg_temp.research_request_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
      )
    ),
    pg_temp.handoff_payload()
  ) ->> 'claimCount',
  '2',
  'the worker records two cited claims'
);

select extensions.is(
  public.complete_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid),
    pg_temp.run_of(
      pg_temp.research_request_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
      )
    ),
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
    ),
    'f1000000-0000-4000-8000-000000000701'::uuid,
    pg_temp.handoff_result(),
    pg_temp.handoff_coverage()
  ) ->> 'pipelineStage',
  'preparing_insights',
  'eligible persisted claims schedule analysis in one transaction'
);

select extensions.is(
  (
    public.complete_market_research_pipeline(
      'f1000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid),
      pg_temp.run_of(
        pg_temp.research_request_of(
          pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
        )
      ),
      pg_temp.research_request_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
      ),
      'f1000000-0000-4000-8000-000000000701'::uuid,
      pg_temp.handoff_result(),
      pg_temp.handoff_coverage()
    ) ->> 'replayed'
  ),
  'true',
  'replay after commit returns the same handoff'
);

select extensions.is(
  (
    select pg_temp.synthesis_child_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
    )
    =
    (
      public.complete_market_research_pipeline(
        'f1000000-0000-4000-8000-000000000201'::uuid,
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid),
        pg_temp.run_of(
          pg_temp.research_request_of(
            pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
          )
        ),
        pg_temp.research_request_of(
          pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
        ),
        'f1000000-0000-4000-8000-000000000701'::uuid,
        pg_temp.handoff_result(),
        pg_temp.handoff_coverage()
      ) ->> 'synthesisRequestId'
    )::uuid
  ),
  true,
  'replay returns the same synthesis child, never a second one'
);

select extensions.is(
  (
    select pg_catalog.concat_ws(
      '|', kind, trigger_reason,
      (pipeline_id = pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid))::text,
      phase, status
    )
    from public.growth_intelligence_requests
    where id = pg_temp.synthesis_child_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
    )
  ),
  concat_ws(
    '|', 'market_evidence_changed', 'market_research_completed', 'true', 'synthesis', 'pending'
  ),
  'the child carries its kind, reason, pipeline lineage and pending dispatch'
);

select extensions.is(
  (
    select request_fingerprint ~ '^[a-f0-9]{64}$'
    from public.growth_intelligence_requests
    where id = pg_temp.synthesis_child_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
    )
  ),
  true,
  'the child fingerprint is a lowercase digest'
);

select extensions.is(
  pg_temp.run_status(
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
    )
  ),
  'completed',
  'the research run completes inside the handoff'
);

select extensions.is(
  (select status from public.growth_intelligence_requests
   where id = pg_temp.research_request_of(
     pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
   )),
  'succeeded',
  'the research root succeeds inside the handoff'
);

select extensions.is(
  (
    select pg_catalog.count(*) from public.audit_events
    where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
      and event_name = 'growth_intelligence.research_prepared'
  ),
  1::bigint,
  'one audit event marks the actual handoff transition'
);

-- Lost immediate wake: the pending child is due, so the sweeper recovers it
select extensions.ok(
  exists (
    select 1 from public.claim_due_growth_intelligence_requests(10, 300) as due
    where due."requestId" = pg_temp.synthesis_child_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
    )
      and due.kind = 'market_evidence_changed'
  ),
  'the sweeper rediscovers a lost synthesis wake through the due index'
);

reset role;

-- Stale leases cannot complete --------------------------------------------------

set local role service_role;

select pg_temp.handoff_start(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  'f1000000-0000-4000-8000-000000000302'::uuid,
  'handoff-pipeline-downtown-001'
) ->> 'outcome';

select public.claim_growth_intelligence_request(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000302'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000702'::uuid,
  600
) ->> 'outcome';

select public.begin_market_research_run(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000302'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000702'::uuid,
  pg_temp.handoff_metadata()
) ->> 'replayed';

select public.record_market_evidence_claims(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000302'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000702'::uuid,
  pg_temp.run_of(
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000302'::uuid)
    )
  ),
  pg_temp.handoff_payload()
) ->> 'claimCount';

-- Direct lease surgery runs as the owner: the worker role holds no UPDATE.
reset role;

update public.growth_intelligence_requests
set lease_expires_at = pg_catalog.now() - interval '1 second'
where id = pg_temp.research_request_of(
  pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000302'::uuid)
);

set local role service_role;

select extensions.throws_ok(
  $$
    select public.complete_market_research_pipeline(
      'f1000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000302'::uuid),
      pg_temp.run_of(
        pg_temp.research_request_of(
          pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000302'::uuid)
        )
      ),
      pg_temp.research_request_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000302'::uuid)
      ),
      'f1000000-0000-4000-8000-000000000702'::uuid,
      pg_temp.handoff_result(),
      pg_temp.handoff_coverage()
    )
  $$,
  '42501', 'market_research_claim_lost',
  'a stale lease cannot complete the handoff'
);

reset role;

-- Same-branch replacement blocks old outputs -------------------------------------

set local role service_role;

select pg_temp.handoff_start(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  'f1000000-0000-4000-8000-000000000303'::uuid,
  'handoff-pipeline-deira-001'
) ->> 'outcome';

select public.claim_growth_intelligence_request(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000303'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000703'::uuid,
  600
) ->> 'outcome';

select public.begin_market_research_run(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000303'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000703'::uuid,
  pg_temp.handoff_metadata()
) ->> 'replayed';

select public.record_market_evidence_claims(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000303'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000703'::uuid,
  pg_temp.run_of(
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000303'::uuid)
    )
  ),
  pg_temp.handoff_payload()
) ->> 'claimCount';

-- A same-branch replacement cancels the pipeline and its claimed root,
-- exactly as the atomic start does on a changed scope. Direct cancellation
-- runs as the owner: the worker role holds no UPDATE.
reset role;

update public.growth_intelligence_research_pipelines
set stage = 'cancelled',
    safe_failure_code = 'SUPERSEDED_BY_NEW_SCOPE',
    stage_changed_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
where id = pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000303'::uuid);

update public.growth_intelligence_requests
set status = 'cancelled', claim_token = null, lease_expires_at = null,
    cancelled_at = pg_catalog.now(),
    cancel_reason = 'Replaced by a new branch research scope.'
where id = pg_temp.research_request_of(
  pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000303'::uuid)
);

set local role service_role;

select extensions.throws_ok(
  $$
    select public.complete_market_research_pipeline(
      'f1000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000303'::uuid),
      pg_temp.run_of(
        pg_temp.research_request_of(
          pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000303'::uuid)
        )
      ),
      pg_temp.research_request_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000303'::uuid)
      ),
      'f1000000-0000-4000-8000-000000000703'::uuid,
      pg_temp.handoff_result(),
      pg_temp.handoff_coverage()
    )
  $$,
  '42501', 'market_research_claim_lost',
  'a replaced pipeline cannot complete its old outputs'
);

select extensions.throws_ok(
  $$
    select public.complete_market_research_run(
      'f1000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.research_request_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000303'::uuid)
      ),
      'f1000000-0000-4000-8000-000000000703'::uuid,
      pg_temp.run_of(
        pg_temp.research_request_of(
          pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000303'::uuid)
        )
      ),
      pg_temp.handoff_result()
    )
  $$,
  '42501', 'market_research_pipeline_bypass_forbidden',
  'the legacy completion refuses pipeline-bound runs'
);

select extensions.throws_ok(
  $$
    select public.fail_market_research_run(
      'f1000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.research_request_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000303'::uuid)
      ),
      'f1000000-0000-4000-8000-000000000703'::uuid,
      pg_temp.run_of(
        pg_temp.research_request_of(
          pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000303'::uuid)
        )
      ),
      pg_catalog.jsonb_build_object(
        'safeFailureCode', 'RESEARCH_PROCESSING_FAILED',
        'adapterCostMicrosUsd', 4200, 'adapterLatencyMs', 91
      )
    )
  $$,
  '42501', 'market_research_pipeline_bypass_forbidden',
  'the legacy failure path refuses pipeline-bound runs'
);

select extensions.is(
  (select status from public.growth_intelligence_requests
   where id = pg_temp.research_request_of(
     pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000303'::uuid)
   )),
  'cancelled',
  'refused completions leave the replacement cancellation intact'
);

reset role;

-- Zero eligible claims ends the pipeline without scheduling analysis -----------

set local role service_role;

select pg_temp.handoff_start(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  'f1000000-0000-4000-8000-000000000304'::uuid,
  'handoff-pipeline-jbr-001'
) ->> 'outcome';

select public.claim_growth_intelligence_request(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000304'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000704'::uuid,
  600
) ->> 'outcome';

select public.begin_market_research_run(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000304'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000704'::uuid,
  pg_temp.handoff_metadata()
) ->> 'replayed';

select extensions.is(
  public.complete_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000304'::uuid),
    pg_temp.run_of(
      pg_temp.research_request_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000304'::uuid)
      )
    ),
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000304'::uuid)
    ),
    'f1000000-0000-4000-8000-000000000704'::uuid,
    pg_temp.handoff_result(0, 0),
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'slotKey', 'local_market', 'kind', 'local_market',
        'outcome', 'searched_no_usable_evidence'
      )
    )
  ) ->> 'pipelineStage',
  'no_findings',
  'a healthy run with no citable claims ends without a child'
);

select extensions.is(
  (
    select pg_catalog.concat_ws(
      '|', stage,
      coalesce(synthesis_request_id::text, 'none'),
      coalesce(safe_failure_code, 'none')
    )
    from public.growth_intelligence_research_pipelines
    where id = pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000304'::uuid)
  ),
  'no_findings|none|NO_ELIGIBLE_FINDINGS',
  'no_findings carries its explicit reason and no child lineage'
);

select extensions.is(
  pg_temp.run_status(
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000304'::uuid)
    )
  ),
  'completed',
  'an empty but healthy run still completes its research lineage'
);

select extensions.is(
  (
    select pg_catalog.count(*) from public.growth_intelligence_requests
    where pipeline_id = pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000304'::uuid)
      and phase = 'synthesis'
  ),
  0::bigint,
  'no child row exists for an empty run'
);

reset role;

-- Atomic synthesis finalization --------------------------------------------------

set local role service_role;

select public.claim_growth_intelligence_request(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.synthesis_child_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000705'::uuid,
  600
) ->> 'outcome';

select public.begin_growth_intelligence_synthesis(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.synthesis_child_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000705'::uuid,
  pg_catalog.jsonb_build_object(
    'provider', 'gemini', 'modelVersion', 'gemini-fixture-synthesis-1',
    'runFingerprint', pg_catalog.repeat('f', 64),
    'correlationId', 'f1000000-0000-4000-8000-000000000751'
  )
) ->> 'replayed';

select extensions.is(
  public.complete_market_synthesis_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.synthesis_child_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
    ),
    'f1000000-0000-4000-8000-000000000705'::uuid,
    pg_temp.synthesis_run_of(
      pg_temp.synthesis_child_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
      )
    ),
    pg_temp.handoff_synthesis_result()
  ) ->> 'pipelineStage',
  'ready',
  'items, request and pipeline settle together as ready'
);

select extensions.is(
  (
    select pg_catalog.concat_ws(
      '|',
      (select status from public.growth_intelligence_requests
       where id = pg_temp.synthesis_child_of(
         pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
       )),
      (select pg_catalog.count(*) from public.audit_events
       where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
         and event_name = 'growth_intelligence.research_finished')::text
    )
  ),
  'succeeded|1',
  'the child succeeds with exactly one finish event'
);

select extensions.is(
  (
    public.complete_market_synthesis_pipeline(
      'f1000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.synthesis_child_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
      ),
      'f1000000-0000-4000-8000-000000000705'::uuid,
      pg_temp.synthesis_run_of(
        pg_temp.synthesis_child_of(
          pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
        )
      ),
      pg_temp.handoff_synthesis_result()
    ) ->> 'replayed'
  ),
  'true',
  'duplicate child execution replays the committed outcome'
);

select extensions.is(
  (
    select pg_catalog.count(*) from public.growth_intelligence_items
    where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
  ),
  1::bigint,
  'replay persists no duplicate items'
);

select extensions.throws_ok(
  $$
    select public.complete_market_synthesis_pipeline(
      'f1000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.synthesis_child_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
      ),
      'f1000000-0000-4000-8000-000000000705'::uuid,
      pg_temp.synthesis_run_of(
        pg_temp.synthesis_child_of(
          pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
        )
      ),
      pg_catalog.jsonb_build_object(
        'outcome', 'completed',
        'resultDigest', pg_catalog.repeat('9', 64),
        'items', pg_catalog.jsonb_build_array()
      )
    )
  $$,
  '23505', null,
  'a second commit with different items conflicts instead of duplicating'
);

reset role;

-- Partial coverage ends partial in the second tenant ------------------------------

set local role service_role;

select pg_temp.handoff_start(
  'f1000000-0000-4000-8000-000000000202'::uuid,
  'f1000000-0000-4000-8000-000000000311'::uuid,
  'handoff-pipeline-other-a-001'
) ->> 'outcome';

select public.claim_growth_intelligence_request(
  'f1000000-0000-4000-8000-000000000202'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000311'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000706'::uuid,
  600
) ->> 'outcome';

select public.begin_market_research_run(
  'f1000000-0000-4000-8000-000000000202'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000311'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000706'::uuid,
  pg_temp.handoff_metadata()
) ->> 'replayed';

select public.record_market_evidence_claims(
  'f1000000-0000-4000-8000-000000000202'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000311'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000706'::uuid,
  pg_temp.run_of(
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000311'::uuid)
    )
  ),
  pg_temp.handoff_payload()
) ->> 'claimCount';

select extensions.is(
  public.complete_market_research_pipeline(
    'f1000000-0000-4000-8000-000000000202'::uuid,
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000311'::uuid),
    pg_temp.run_of(
      pg_temp.research_request_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000311'::uuid)
      )
    ),
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000311'::uuid)
    ),
    'f1000000-0000-4000-8000-000000000706'::uuid,
    pg_temp.handoff_result(),
    pg_temp.handoff_coverage('failed')
  ) ->> 'pipelineStage',
  'preparing_insights',
  'partial coverage still schedules analysis with its coverage preserved'
);

select public.claim_growth_intelligence_request(
  'f1000000-0000-4000-8000-000000000202'::uuid,
  pg_temp.synthesis_child_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000311'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000707'::uuid,
  600
) ->> 'outcome';

select public.begin_growth_intelligence_synthesis(
  'f1000000-0000-4000-8000-000000000202'::uuid,
  pg_temp.synthesis_child_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000311'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000707'::uuid,
  pg_catalog.jsonb_build_object(
    'provider', 'gemini', 'modelVersion', 'gemini-fixture-synthesis-1',
    'runFingerprint', pg_catalog.repeat('f', 64),
    'correlationId', 'f1000000-0000-4000-8000-000000000752'
  )
) ->> 'replayed';

select extensions.is(
  public.complete_market_synthesis_pipeline(
    'f1000000-0000-4000-8000-000000000202'::uuid,
    pg_temp.synthesis_child_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000311'::uuid)
    ),
    'f1000000-0000-4000-8000-000000000707'::uuid,
    pg_temp.synthesis_run_of(
      pg_temp.synthesis_child_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000311'::uuid)
      )
    ),
    pg_temp.handoff_synthesis_result()
  ) ->> 'pipelineStage',
  'partial',
  'a partial research run carries its limitations into synthesis'
);

select extensions.is(
  (
    select coverage from public.growth_intelligence_research_pipelines
    where id = pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000311'::uuid)
  ),
  pg_temp.handoff_coverage('failed'),
  'the terminal pipeline keeps its coverage manifest'
);

select extensions.is(
  (
    select pg_catalog.count(*) from public.growth_intelligence_research_pipelines
    where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
  ),
  4::bigint,
  'the second tenant leaves the first tenant pipelines alone'
);

reset role;

-- Stale evidence refuses finalization and retry ------------------------------------

set local role service_role;

select pg_temp.handoff_start(
  'f1000000-0000-4000-8000-000000000202'::uuid,
  'f1000000-0000-4000-8000-000000000312'::uuid,
  'handoff-pipeline-other-b-001'
) ->> 'outcome';

select public.claim_growth_intelligence_request(
  'f1000000-0000-4000-8000-000000000202'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000312'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000708'::uuid,
  600
) ->> 'outcome';

select public.begin_market_research_run(
  'f1000000-0000-4000-8000-000000000202'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000312'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000708'::uuid,
  pg_temp.handoff_metadata()
) ->> 'replayed';

select public.record_market_evidence_claims(
  'f1000000-0000-4000-8000-000000000202'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000312'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000708'::uuid,
  pg_temp.run_of(
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000312'::uuid)
    )
  ),
  pg_temp.handoff_payload()
) ->> 'claimCount';

select public.complete_market_research_pipeline(
  'f1000000-0000-4000-8000-000000000202'::uuid,
  pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000312'::uuid),
  pg_temp.run_of(
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000312'::uuid)
    )
  ),
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000312'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000708'::uuid,
  pg_temp.handoff_result(),
  pg_temp.handoff_coverage()
) ->> 'pipelineStage';

select public.claim_growth_intelligence_request(
  'f1000000-0000-4000-8000-000000000202'::uuid,
  pg_temp.synthesis_child_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000312'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000709'::uuid,
  600
) ->> 'outcome';

select public.begin_growth_intelligence_synthesis(
  'f1000000-0000-4000-8000-000000000202'::uuid,
  pg_temp.synthesis_child_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000312'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000709'::uuid,
  pg_catalog.jsonb_build_object(
    'provider', 'gemini', 'modelVersion', 'gemini-fixture-synthesis-1',
    'runFingerprint', pg_catalog.repeat('f', 64),
    'correlationId', 'f1000000-0000-4000-8000-000000000752'
  )
) ->> 'replayed';

-- Every persisted claim expires: claims are append-only, so expiry lands as
-- claim events, exactly as retention/erasure would produce them. The direct
-- event insert runs as the owner: the worker role holds no INSERT.
reset role;

insert into public.market_evidence_claim_events (
  organization_id, market_evidence_claim_id, event_type, event_digest, reason, occurred_at
)
select 'f1000000-0000-4000-8000-000000000202'::uuid, claim.id, 'expired',
  pg_catalog.repeat('9', 64), 'STALE_IN_TEST', pg_catalog.now()
from public.market_evidence_claims claim
where claim.organization_id = 'f1000000-0000-4000-8000-000000000202'::uuid
  and claim.market_profile_version_id = (
    select market_profile_version_id from public.growth_intelligence_requests
    where id = pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000312'::uuid)
    )
  );

set local role service_role;

select extensions.throws_ok(
  $$
    select public.complete_market_synthesis_pipeline(
      'f1000000-0000-4000-8000-000000000202'::uuid,
      pg_temp.synthesis_child_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000312'::uuid)
      ),
      'f1000000-0000-4000-8000-000000000709'::uuid,
      pg_temp.synthesis_run_of(
        pg_temp.synthesis_child_of(
          pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000312'::uuid)
        )
      ),
      pg_temp.handoff_synthesis_result()
    )
  $$,
  '42501', 'market_synthesis_evidence_stale',
  'finalization refuses fully stale evidence instead of persisting it'
);

select extensions.is(
  public.fail_market_synthesis_pipeline(
    'f1000000-0000-4000-8000-000000000202'::uuid,
    pg_temp.synthesis_child_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000312'::uuid)
    ),
    'f1000000-0000-4000-8000-000000000709'::uuid,
    pg_temp.synthesis_run_of(
      pg_temp.synthesis_child_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000312'::uuid)
      )
    ),
    'SYNTHESIS_NO_VALID_CANDIDATE'
  ) ->> 'pipelineStage',
  'synthesis_failed',
  'the failed analysis lands the pipeline with its findings retained'
);

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000004';

select extensions.throws_ok(
  $$
    select public.retry_market_research_synthesis(
      'f1000000-0000-4000-8000-000000000202'::uuid,
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000312'::uuid),
      'f1000000-0000-4000-8000-000000000004'::uuid,
      'handoff-retry-other-b-001',
      'f1000000-0000-4000-8000-000000000753'::uuid
    )
  $$,
  '42501', 'market_research_synthesis_evidence_stale',
  'retry requires fresh evidence, never another call on stale claims'
);

reset role;

-- Retry fencing: validation, tenancy, and key conflicts --------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$
    select public.retry_market_research_synthesis(
      'f1000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000305'::uuid),
      'f1000000-0000-4000-8000-000000000002'::uuid,
      'short',
      'f1000000-0000-4000-8000-000000000755'::uuid
    )
  $$,
  '22023', 'growth_intelligence_retry_invalid',
  'retry rejects a short idempotency key before touching state'
);

select extensions.throws_ok(
  $$
    select public.retry_market_research_synthesis(
      'f1000000-0000-4000-8000-000000000201'::uuid,
      'f1000000-0000-4000-8000-000000000799'::uuid,
      'f1000000-0000-4000-8000-000000000002'::uuid,
      'handoff-retry-unknown-001',
      'f1000000-0000-4000-8000-000000000755'::uuid
    )
  $$,
  '42501', 'market_research_pipeline_not_found',
  'retry on an unknown pipeline fences by tenant'
);

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$
    select public.retry_market_research_synthesis(
      'f1000000-0000-4000-8000-000000000202'::uuid,
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000312'::uuid),
      'f1000000-0000-4000-8000-000000000002'::uuid,
      'handoff-retry-cross-tenant-001',
      'f1000000-0000-4000-8000-000000000755'::uuid
    )
  $$,
  '42501', 'growth_intelligence_retry_forbidden',
  'an operator cannot retry another tenant pipeline'
);

reset role;

-- Analysis-only retry reuses the child within its prequoted budget ---------------

insert into private.growth_intelligence_provider_qualifications (
  provider, agreement_version, agreement_date, agreement_expires_at,
  permitted_uses, retention_policy, deletion_rules, pricing_version,
  search_rate_micros_usd, credential_ready, model_bounds, canary_result
) values (
  'brave', 'BRAVE-ORDER-2026-09-08', '2026-09-01', pg_catalog.now() + interval '90 days',
  array['snippet_storage', 'commercial_inference', 'organization_display', 'derived_claims', 'synthesis_reuse', 'agreed_retention'],
  'retain permitted excerpts for 400 days, then erase',
  'erase on termination within 30 days, including derived text on request',
  'brave-search-2026-09', 1200, true,
  '{"extraction": {"maxInputTokens": 12000, "maxOutputTokens": 4000}, "supportReview": {"maxInputTokens": 12000, "maxOutputTokens": 4000}, "synthesis": {"maxInputTokens": 24000, "maxOutputTokens": 6000}}'::jsonb,
  'passed'
);

set local role service_role;

select pg_temp.handoff_start(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  'f1000000-0000-4000-8000-000000000301'::uuid,
  'handoff-pipeline-marina-002'
) ->> 'outcome';

select public.claim_growth_intelligence_request(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000710'::uuid,
  600
) ->> 'outcome';

select public.begin_market_research_run(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000710'::uuid,
  pg_temp.handoff_metadata()
) ->> 'replayed';

select public.record_market_evidence_claims(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000710'::uuid,
  pg_temp.run_of(
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
    )
  ),
  pg_temp.handoff_payload()
) ->> 'claimCount';

select public.complete_market_research_pipeline(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid),
  pg_temp.run_of(
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
    )
  ),
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000710'::uuid,
  pg_temp.handoff_result(),
  pg_temp.handoff_coverage()
) ->> 'pipelineStage';

select public.claim_growth_intelligence_request(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.synthesis_child_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000711'::uuid,
  600
) ->> 'outcome';

select public.begin_growth_intelligence_synthesis(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.synthesis_child_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000711'::uuid,
  pg_catalog.jsonb_build_object(
    'provider', 'gemini', 'modelVersion', 'gemini-fixture-synthesis-1',
    'runFingerprint', pg_catalog.repeat('f', 64),
    'correlationId', 'f1000000-0000-4000-8000-000000000753'
  )
) ->> 'replayed';

select public.reserve_research_pipeline_budget(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid),
  1000000,
  'brave-search-2026-09'
) ->> 'replayed';

select extensions.is(
  public.fail_market_synthesis_pipeline(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.synthesis_child_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
    ),
    'f1000000-0000-4000-8000-000000000711'::uuid,
    pg_temp.synthesis_run_of(
      pg_temp.synthesis_child_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
      )
    ),
    'SYNTHESIS_NO_VALID_CANDIDATE'
  ) ->> 'pipelineStage',
  'synthesis_failed',
  'a failed analysis keeps its evidence and waits for retry'
);

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000002';

select extensions.is(
  public.retry_market_research_synthesis(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid),
    'f1000000-0000-4000-8000-000000000002'::uuid,
    'handoff-retry-marina-001',
    'f1000000-0000-4000-8000-000000000754'::uuid
  ) ->> 'status',
  'pending',
  'retry requeues the same failed child for analysis only'
);

select extensions.is(
  (
    public.retry_market_research_synthesis(
      'f1000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid),
      'f1000000-0000-4000-8000-000000000002'::uuid,
      'handoff-retry-marina-001',
      'f1000000-0000-4000-8000-000000000754'::uuid
    ) ->> 'replayed'
  ),
  'true',
  'retry replays the same child on the same key'
);

select extensions.is(
  (
    select pg_catalog.concat_ws(
      '|', stage,
      (select status from public.growth_intelligence_requests
       where id = pg_temp.synthesis_child_of(
         pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
       )),
      (select pg_catalog.count(*) from public.audit_events
       where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
         and event_name = 'growth_intelligence.research_retried')::text
    )
    from public.growth_intelligence_research_pipelines
    where id = pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
  ),
  'preparing_insights|pending|1',
  'retry returns the pipeline to preparing insights with one retry event'
);

reset role;

-- The second synthesis call still fits the prequoted reservation ---------------

set local role service_role;

select public.claim_growth_intelligence_request(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.synthesis_child_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000712'::uuid,
  600
) ->> 'outcome';

select extensions.is(
  public.reserve_research_attempt(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    pg_catalog.jsonb_build_object(
      'kind', 'pipeline',
      'id', pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
    ),
    'synthesis',
    'synthesis-retry',
    0,
    50000,
    'f1000000-0000-4000-8000-000000000712'::uuid
  ) ->> 'replayed',
  'false',
  'one explicit second synthesis call fits inside the prequoted budget'
);

-- Replaying the same reservation returns the same attempt id for the late
-- receipt below, without touching the private ledger from this role.
insert into pg_temp.held_attempt
select (
  public.reserve_research_attempt(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    pg_catalog.jsonb_build_object(
      'kind', 'pipeline',
      'id', pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
    ),
    'synthesis',
    'synthesis-retry',
    0,
    50000,
    'f1000000-0000-4000-8000-000000000712'::uuid
  ) ->> 'attemptId'
)::uuid;

-- Late cancellation: finalization refuses, accounting still reconciles --------
-- Direct cancellation runs as the owner: the worker role holds no UPDATE.
reset role;

update public.growth_intelligence_research_pipelines
set stage = 'cancelled',
    safe_failure_code = 'SUPERSEDED_BY_NEW_SCOPE',
    stage_changed_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
where id = pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid);

update public.growth_intelligence_requests
set status = 'cancelled', claim_token = null, lease_expires_at = null,
    cancelled_at = pg_catalog.now(),
    cancel_reason = 'Replaced by a new branch research scope.'
where id = pg_temp.synthesis_child_of(
  pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
);

set local role service_role;

select extensions.throws_ok(
  $$
    select public.complete_market_synthesis_pipeline(
      'f1000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.synthesis_child_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
      ),
      'f1000000-0000-4000-8000-000000000712'::uuid,
      pg_temp.synthesis_run_of(
        pg_temp.synthesis_child_of(
          pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
        )
      ),
      pg_temp.handoff_synthesis_result()
    )
  $$,
  '42501', null,
  'finalization after cancellation refuses with no writes'
);

select extensions.throws_ok(
  $$
    select public.fail_market_synthesis_pipeline(
      'f1000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.synthesis_child_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
      ),
      'f1000000-0000-4000-8000-000000000712'::uuid,
      pg_temp.synthesis_run_of(
        pg_temp.synthesis_child_of(
          pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000301'::uuid)
        )
      ),
      'SYNTHESIS_NO_VALID_CANDIDATE'
    )
  $$,
  '42501', 'growth_intelligence_synthesis_claim_lost',
  'failure after cancellation fences instead of conflicting'
);

select extensions.is(
  public.settle_research_attempt(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    (select attempt_id from pg_temp.held_attempt),
    '{"kind": "reported", "microsUsd": 41000}'::jsonb
  ) ->> 'replayed',
  'false',
  'a late spend receipt still reconciles after cancellation'
);

reset role;

-- An exhausted quote refuses the retry -------------------------------------------

set local role service_role;

select pg_temp.handoff_start(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  'f1000000-0000-4000-8000-000000000305'::uuid,
  'handoff-pipeline-palm-001'
) ->> 'outcome';

select public.claim_growth_intelligence_request(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000305'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000713'::uuid,
  600
) ->> 'outcome';

select public.begin_market_research_run(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000305'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000713'::uuid,
  pg_temp.handoff_metadata()
) ->> 'replayed';

select public.record_market_evidence_claims(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000305'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000713'::uuid,
  pg_temp.run_of(
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000305'::uuid)
    )
  ),
  pg_temp.handoff_payload()
) ->> 'claimCount';

select public.complete_market_research_pipeline(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000305'::uuid),
  pg_temp.run_of(
    pg_temp.research_request_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000305'::uuid)
    )
  ),
  pg_temp.research_request_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000305'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000713'::uuid,
  pg_temp.handoff_result(),
  pg_temp.handoff_coverage()
) ->> 'pipelineStage';

select public.claim_growth_intelligence_request(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.synthesis_child_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000305'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000714'::uuid,
  600
) ->> 'outcome';

select public.begin_growth_intelligence_synthesis(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.synthesis_child_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000305'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000714'::uuid,
  pg_catalog.jsonb_build_object(
    'provider', 'gemini', 'modelVersion', 'gemini-fixture-synthesis-1',
    'runFingerprint', pg_catalog.repeat('f', 64),
    'correlationId', 'f1000000-0000-4000-8000-000000000753'
  )
) ->> 'replayed';

select public.reserve_research_pipeline_budget(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000305'::uuid),
  1000000,
  'brave-search-2026-09'
) ->> 'replayed';

select extensions.is(
  public.settle_research_attempt(
    'f1000000-0000-4000-8000-000000000201'::uuid,
    (
      public.reserve_research_attempt(
        'f1000000-0000-4000-8000-000000000201'::uuid,
        pg_catalog.jsonb_build_object(
          'kind', 'pipeline',
          'id', pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000305'::uuid)
        ),
        'synthesis',
        'synthesis-first',
        0,
        1000,
        'f1000000-0000-4000-8000-000000000714'::uuid
      ) ->> 'attemptId'
    )::uuid,
    '{"kind": "reported", "microsUsd": 5000}'::jsonb
  ) ->> 'overrunBlocked',
  'true',
  'an overcharged receipt is recorded, never clamped'
);

select public.fail_market_synthesis_pipeline(
  'f1000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.synthesis_child_of(
    pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000305'::uuid)
  ),
  'f1000000-0000-4000-8000-000000000714'::uuid,
  pg_temp.synthesis_run_of(
    pg_temp.synthesis_child_of(
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000305'::uuid)
    )
  ),
  'SYNTHESIS_NO_VALID_CANDIDATE'
) ->> 'pipelineStage';

reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$
    select public.retry_market_research_synthesis(
      'f1000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000305'::uuid),
      'f1000000-0000-4000-8000-000000000002'::uuid,
      'handoff-retry-marina-001',
      'f1000000-0000-4000-8000-000000000755'::uuid
    )
  $$,
  '23505', 'growth_intelligence_retry_idempotency_conflict',
  'one key retries one pipeline: reuse on another conflicts'
);

select extensions.throws_ok(
  $$
    select public.retry_market_research_synthesis(
      'f1000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000305'::uuid),
      'f1000000-0000-4000-8000-000000000002'::uuid,
      'handoff-retry-palm-001',
      'f1000000-0000-4000-8000-000000000755'::uuid
    )
  $$,
  '23505', 'market_research_synthesis_retry_budget_exhausted',
  'an exhausted prequoted budget refuses the retry'
);

reset role;

-- Tenant isolation ------------------------------------------------------------------

set local role service_role;

select extensions.throws_ok(
  $$
    select public.complete_market_research_pipeline(
      'f1000000-0000-4000-8000-000000000202'::uuid,
      pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000304'::uuid),
      pg_temp.run_of(
        pg_temp.research_request_of(
          pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000304'::uuid)
        )
      ),
      pg_temp.research_request_of(
        pg_temp.pipeline_of('f1000000-0000-4000-8000-000000000304'::uuid)
      ),
      'f1000000-0000-4000-8000-000000000704'::uuid,
      pg_temp.handoff_result(0, 0),
      pg_temp.handoff_coverage()
    )
  $$,
  '42501', null,
  'one tenant cannot complete another tenant pipeline'
);

select extensions.is(
  (
    select pg_catalog.count(*) from public.growth_intelligence_research_pipelines
    where organization_id = 'f1000000-0000-4000-8000-000000000201'::uuid
  ),
  6::bigint,
  'tenant A holds its six pipelines'
);

select extensions.is(
  (
    select pg_catalog.count(*) from public.growth_intelligence_research_pipelines
    where organization_id = 'f1000000-0000-4000-8000-000000000202'::uuid
  ),
  2::bigint,
  'tenant B holds its two pipelines'
);

reset role;
