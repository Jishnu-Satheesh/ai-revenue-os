begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(58);

-- Contract, indexes, and grants --------------------------------------------

select extensions.has_table('public', 'growth_intelligence_requests', 'the durable request ledger exists');
select extensions.has_function(
  'public', 'enqueue_growth_intelligence_request', array['uuid', 'jsonb'],
  'request admission is one database operation'
);
select extensions.has_function(
  'public', 'retry_growth_intelligence_request',
  array['uuid', 'uuid', 'uuid', 'text', 'uuid'],
  'failed requests have one governed retry operation'
);
select extensions.has_function(
  'public', 'claim_growth_intelligence_request',
  array['uuid', 'uuid', 'uuid', 'integer'],
  'workers claim one request with a caller-stable fencing token'
);
select extensions.has_function(
  'public', 'complete_growth_intelligence_request', array['uuid', 'uuid', 'uuid'],
  'request completion is fenced'
);
select extensions.has_function(
  'public', 'fail_growth_intelligence_request', array['uuid', 'uuid', 'uuid', 'text'],
  'request failure is fenced and sanitized'
);
select extensions.has_function(
  'public', 'cancel_growth_intelligence_request',
  array['uuid', 'uuid', 'uuid', 'text', 'text', 'uuid'],
  'operators cancel durable requests through one governed operation'
);
select extensions.has_function(
  'public', 'claim_due_growth_intelligence_requests', array['integer', 'integer'],
  'the dispatcher leases a bounded due batch from Postgres'
);
select extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.enqueue_growth_intelligence_request(uuid,jsonb)'::regprocedure
    ),
    'pg_advisory_xact_lock'
  ) > 0,
  'request fingerprint admission is serialized before lookup'
);
select extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.retry_growth_intelligence_request(uuid,uuid,uuid,text,uuid)'::regprocedure
    ),
    'pg_advisory_xact_lock'
  ) > 0,
  'request retry idempotency is serialized before lookup'
);
select extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.cancel_growth_intelligence_request(uuid,uuid,uuid,text,text,uuid)'::regprocedure
    ),
    'pg_advisory_xact_lock'
  ) > 0,
  'request cancellation idempotency is serialized before lookup'
);
select extensions.throws_ok(
  $$ select public.claim_due_growth_intelligence_requests(null, 300) $$,
  '22023', null,
  'the dispatcher refuses a null batch limit instead of claiming unbounded work'
);
select extensions.throws_ok(
  $$ select public.claim_due_growth_intelligence_requests(10, null) $$,
  '22023', null,
  'the dispatcher refuses a null recovery cooldown'
);
select extensions.throws_ok(
  $$
    select public.claim_growth_intelligence_request(
      '11111111-1111-4111-8111-111111111111'::uuid,
      '22222222-2222-4222-8222-222222222222'::uuid,
      '33333333-3333-4333-8333-333333333333'::uuid,
      null
    )
  $$,
  '22023', null,
  'a worker claim refuses a null lease bound'
);
select extensions.throws_ok(
  $$
    select public.fail_growth_intelligence_request(
      '11111111-1111-4111-8111-111111111111'::uuid,
      '22222222-2222-4222-8222-222222222222'::uuid,
      '33333333-3333-4333-8333-333333333333'::uuid,
      null
    )
  $$,
  '22023', null,
  'a worker failure refuses an absent safe code'
);
select extensions.ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'public.growth_intelligence_requests'::regclass
  ),
  'the request ledger enables and forces RLS'
);
select extensions.ok(
  pg_catalog.has_table_privilege('authenticated', 'public.growth_intelligence_requests', 'select'),
  'authenticated members receive a read grant'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_requests', 'insert,update,delete'
  ),
  'authenticated sessions cannot write request state directly'
);
select extensions.has_index(
  'public', 'growth_intelligence_requests',
  'growth_intelligence_requests_due_idx',
  'pending and expired work has a bounded due index'
);
select extensions.has_index(
  'public', 'growth_intelligence_requests',
  'growth_intelligence_requests_profile_idx',
  'profile lineage reads are tenant-leading'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.enqueue_growth_intelligence_request(uuid,jsonb)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.claim_growth_intelligence_request(uuid,uuid,uuid,integer)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.complete_growth_intelligence_request(uuid,uuid,uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.fail_growth_intelligence_request(uuid,uuid,uuid,text)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'service_role', 'public.claim_due_growth_intelligence_requests(integer,integer)', 'execute'
  ),
  'only the worker role receives queue admission and lifecycle entry points'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated', 'public.enqueue_growth_intelligence_request(uuid,jsonb)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.claim_growth_intelligence_request(uuid,uuid,uuid,integer)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.complete_growth_intelligence_request(uuid,uuid,uuid)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.fail_growth_intelligence_request(uuid,uuid,uuid,text)', 'execute'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated', 'public.claim_due_growth_intelligence_requests(integer,integer)', 'execute'
  ),
  'a signed-in session cannot impersonate a worker'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.retry_growth_intelligence_request(uuid,uuid,uuid,text,uuid)', 'execute'
  )
  and pg_catalog.has_function_privilege(
    'authenticated', 'public.cancel_growth_intelligence_request(uuid,uuid,uuid,text,text,uuid)', 'execute'
  ),
  'authenticated operators receive only retry and cancellation entry points'
);

-- Two-account fixtures ------------------------------------------------------

insert into auth.users (id) values
  ('a8000000-0000-4000-8000-000000000001'::uuid),
  ('a8000000-0000-4000-8000-000000000002'::uuid),
  ('a8000000-0000-4000-8000-000000000003'::uuid),
  ('a8000000-0000-4000-8000-000000000004'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('a8000000-0000-4000-8000-000000000101'::uuid, 'Growth request agency A', 'growth-request-agency-a', 'a8000000-0000-4000-8000-000000000001'::uuid),
  ('a8000000-0000-4000-8000-000000000102'::uuid, 'Growth request agency B', 'growth-request-agency-b', 'a8000000-0000-4000-8000-000000000004'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('a8000000-0000-4000-8000-000000000201'::uuid, 'a8000000-0000-4000-8000-000000000101'::uuid, 'Growth request client A', 'growth-request-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'a8000000-0000-4000-8000-000000000001'::uuid),
  ('a8000000-0000-4000-8000-000000000202'::uuid, 'a8000000-0000-4000-8000-000000000102'::uuid, 'Growth request client B', 'growth-request-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'a8000000-0000-4000-8000-000000000004'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('a8000000-0000-4000-8000-000000000101'::uuid, 'a8000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('a8000000-0000-4000-8000-000000000101'::uuid, 'a8000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator'),
  ('a8000000-0000-4000-8000-000000000101'::uuid, 'a8000000-0000-4000-8000-000000000003'::uuid, 'member', 'viewer'),
  ('a8000000-0000-4000-8000-000000000102'::uuid, 'a8000000-0000-4000-8000-000000000004'::uuid, 'owner', 'owner');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency
) values
  ('a8000000-0000-4000-8000-000000000301'::uuid, 'a8000000-0000-4000-8000-000000000201'::uuid, 'Dubai Marina', 'dubai-marina', 'physical', 'Asia/Dubai', 'AED'),
  ('a8000000-0000-4000-8000-000000000302'::uuid, 'a8000000-0000-4000-8000-000000000202'::uuid, 'Other tenant branch', 'other-tenant-branch', 'physical', 'Asia/Dubai', 'AED');

insert into public.organization_channels (
  id, organization_id, key, display_name, category, created_by
) values
  ('a8000000-0000-4000-8000-000000000401'::uuid, 'a8000000-0000-4000-8000-000000000201'::uuid, 'owned-digital', 'Owned digital', 'owned_digital', 'a8000000-0000-4000-8000-000000000001'::uuid),
  ('a8000000-0000-4000-8000-000000000402'::uuid, 'a8000000-0000-4000-8000-000000000202'::uuid, 'other-channel', 'Other channel', 'owned_digital', 'a8000000-0000-4000-8000-000000000004'::uuid);

create or replace function pg_temp.market_profile_document()
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'publicIdentity', pg_catalog.jsonb_build_object(
      'approvedName', 'Kerala Kitchen',
      'domains', pg_catalog.jsonb_build_array('example.com'),
      'publicUrls', pg_catalog.jsonb_build_array('https://example.com/menu')
    ),
    'nicheDescriptors', pg_catalog.jsonb_build_array('Kerala cuisine'),
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
        'name', 'Dubai Marina delivery area',
        'branchId', 'a8000000-0000-4000-8000-000000000301', 'radiusKm', 8
      )
    ),
    'competitors', '[]'::jsonb,
    'topics', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('key', 'local-events', 'label', 'Local events', 'provenance', 'core')
    ),
    'sourcePolicy', pg_catalog.jsonb_build_object(
      'excludedDomains', '[]'::jsonb,
      'excludedPublishers', '[]'::jsonb,
      'excludedCompetitorKeys', '[]'::jsonb,
      'allowBoundedQuotes', false,
      'maxQuotationCharacters', 0
    ),
    'cadence', pg_catalog.jsonb_build_object(
      'timeZone', 'Asia/Dubai', 'dailyLocalTime', '06:30',
      'weeklyDay', 'monday', 'weeklyLocalTime', '07:00'
    )
  );
$$;

create or replace function pg_temp.profile_digest()
returns text
language sql
security definer
set search_path = ''
as $$
  select private.create_market_profile_digest(pg_temp.market_profile_document());
$$;

create or replace function pg_temp.request_document(
  p_kind text,
  p_trigger_reason text,
  p_local_time_bucket text,
  p_business_evidence_digest text default null,
  p_branch_id uuid default null,
  p_channel_id uuid default null,
  p_due_at timestamptz default pg_catalog.now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_version_id uuid;
  policy_digest text;
  request_fingerprint text;
begin
  select version.id, version.source_policy_digest
  into profile_version_id, policy_digest
  from public.organization_market_profiles profile
  join public.organization_market_profile_versions version
    on version.organization_id = profile.organization_id
    and version.id = profile.current_version_id
  where profile.organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid;

  request_fingerprint := private.create_growth_intelligence_request_fingerprint(
    'a8000000-0000-4000-8000-000000000201'::uuid,
    p_branch_id,
    p_channel_id,
    p_kind,
    p_trigger_reason,
    p_business_evidence_digest,
    profile_version_id,
    policy_digest,
    'market-research@1',
    p_local_time_bucket,
    null,
    null
  );

  return pg_catalog.jsonb_build_object(
    'organizationId', 'a8000000-0000-4000-8000-000000000201',
    'branchId', p_branch_id,
    'channelId', p_channel_id,
    'kind', p_kind,
    'triggerReason', p_trigger_reason,
    'businessEvidenceDigest', p_business_evidence_digest,
    'marketProfileVersionId', profile_version_id,
    'sourcePolicyDigest', policy_digest,
    'researchRuleVersion', 'market-research@1',
    'localTimeBucket', p_local_time_bucket,
    'synthesisVersionTuple', null,
    'playbookVersionTuple', null,
    'requestFingerprint', request_fingerprint,
    'dueAt', p_due_at,
    'correlationId', 'a8000000-0000-4000-8000-000000000701',
    'requestedBy', null
  );
end;
$$;

create or replace function pg_temp.request_id(p_status text default null)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select request.id
  from public.growth_intelligence_requests request
  where request.organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid
    and (p_status is null or request.status = p_status)
  order by request.created_at desc
  limit 1;
$$;

create or replace function pg_temp.request_attempt_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select request.attempt_count
  from public.growth_intelligence_requests request
  where request.organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid
  order by request.created_at
  limit 1;
$$;

create or replace function pg_temp.request_status(p_kind text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select request.status
  from public.growth_intelligence_requests request
  where request.organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid
    and request.kind = p_kind
  order by request.created_at desc
  limit 1;
$$;

select extensions.is(
  private.create_growth_intelligence_request_fingerprint(
    '11111111-1111-4111-8111-111111111111'::uuid,
    null,
    '22222222-2222-4222-8222-222222222222'::uuid,
    'market_research',
    'daily_due',
    repeat('a', 64),
    '33333333-3333-4333-8333-333333333333'::uuid,
    repeat('b', 64),
    'market-research-rules@1',
    'daily:2026-08-31',
    null,
    null
  ),
  '83ff7ff74b7da6205d7f09cb66c95d83bec41516160e4eef7bdde618719e262f',
  'the request fingerprint matches the TypeScript canonical fixture'
);

-- Confirming a profile creates the first pending request. -------------------

set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-4000-8000-000000000002';

select public.propose_market_profile_version(
  'a8000000-0000-4000-8000-000000000201'::uuid,
  'a8000000-0000-4000-8000-000000000002'::uuid,
  pg_temp.market_profile_document(),
  pg_temp.profile_digest(),
  '{"source":"operator"}'::jsonb,
  'request-suite-profile-proposal',
  'a8000000-0000-4000-8000-000000000702'::uuid
);

select public.decide_market_profile_version(
  'a8000000-0000-4000-8000-000000000201'::uuid,
  'a8000000-0000-4000-8000-000000000002'::uuid,
  (select id from public.organization_market_profile_versions where organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid),
  pg_temp.profile_digest(),
  'confirmed', null, 'request-suite-profile-confirm',
  'a8000000-0000-4000-8000-000000000703'::uuid
);

select extensions.is(
  (
    select count(*)::bigint from public.growth_intelligence_requests
    where organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid
      and status = 'pending'
  ),
  1::bigint,
  'profile confirmation admits one pending request'
);
select extensions.is(
  (
    select request_fingerprint from public.growth_intelligence_requests
    where organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid
  ),
  pg_temp.request_document('market_research', 'profile_confirmed', 'immediate') ->> 'requestFingerprint',
  'the stored request identity binds every canonical input'
);

set local role service_role;

select extensions.is(
  (
    select (public.enqueue_growth_intelligence_request(
      'a8000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.request_document('market_research', 'profile_confirmed', 'immediate')
    ) ->> 'requestId')::uuid
  ),
  pg_temp.request_id(),
  'enqueue replay returns the same request identifier'
);
select extensions.throws_ok(
  $$
    select public.enqueue_growth_intelligence_request(
      'a8000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.request_document('market_research', 'profile_confirmed', 'immediate')
        || pg_catalog.jsonb_build_object('kind', 'weekly_synthesis')
    )
  $$,
  '22023', null,
  'a supplied fingerprint cannot be reused for changed request semantics'
);
select extensions.throws_ok(
  $$
    select public.enqueue_growth_intelligence_request(
      'a8000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.request_document(
        'business_evidence_changed', 'business_evidence_current', 'immediate',
        repeat('b', 64),
        'a8000000-0000-4000-8000-000000000302'::uuid,
        'a8000000-0000-4000-8000-000000000402'::uuid
      )
    )
  $$,
  '42501', null,
  'request scope cannot cite another tenant branch or channel'
);

select extensions.is(
  (select count(*)::integer from public.claim_due_growth_intelligence_requests(1, 300)),
  1,
  'the dispatcher claims one bounded due identifier'
);
select extensions.is(
  (select count(*)::integer from public.claim_due_growth_intelligence_requests(1, 300)),
  0,
  'the dispatch cooldown recovers loss without hot-looping one request'
);
select extensions.ok(
  not exists (
    select 1
    from public.claim_due_growth_intelligence_requests(1, 0) due,
      lateral pg_catalog.jsonb_object_keys(pg_catalog.to_jsonb(due)) key
    where key not in ('organizationId', 'requestId', 'kind', 'correlationId')
  ),
  'dispatcher payloads contain identifiers and correlation metadata only'
);

select extensions.is(
  public.claim_growth_intelligence_request(
    'a8000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.request_id(),
    'a8000000-0000-4000-8000-000000000801'::uuid,
    600
  ) ->> 'outcome',
  'acquired',
  'the first worker acquires the request lease'
);
select extensions.is(
  pg_temp.request_attempt_count(),
  1,
  'a first claim records one attempt'
);
select extensions.is(
  public.claim_growth_intelligence_request(
    'a8000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.request_id(),
    'a8000000-0000-4000-8000-000000000801'::uuid,
    600
  ) ->> 'outcome',
  'acquired',
  'a duplicate delivery with the same token replays its lease'
);
select extensions.is(
  pg_temp.request_attempt_count(),
  1,
  'a same-token replay does not count another attempt'
);
select extensions.is(
  public.claim_growth_intelligence_request(
    'a8000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.request_id(),
    'a8000000-0000-4000-8000-000000000802'::uuid,
    600
  ) ->> 'outcome',
  'in_progress',
  'a second worker cannot steal a live lease'
);

reset role;
update public.growth_intelligence_requests
set lease_expires_at = pg_catalog.now() - interval '1 second'
where organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid;
set local role service_role;

select extensions.is(
  public.claim_growth_intelligence_request(
    'a8000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.request_id(),
    'a8000000-0000-4000-8000-000000000802'::uuid,
    600
  ) ->> 'outcome',
  'acquired',
  'an expired lease can be recovered by a new worker'
);
select extensions.is(
  pg_temp.request_attempt_count(),
  2,
  'lease recovery records a second attempt'
);
select extensions.is(
  public.complete_growth_intelligence_request(
    'a8000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.request_id(),
    'a8000000-0000-4000-8000-000000000801'::uuid
  ) ->> 'outcome',
  'claim_lost',
  'the old worker is fenced after lease recovery'
);
select extensions.is(
  public.complete_growth_intelligence_request(
    'a8000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.request_id(),
    'a8000000-0000-4000-8000-000000000802'::uuid
  ) ->> 'outcome',
  'completed',
  'the current worker completes through its fencing token'
);
select extensions.is(
  pg_temp.request_status('market_research'),
  'succeeded',
  'successful completion is durable'
);
select extensions.is(
  public.complete_growth_intelligence_request(
    'a8000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.request_id(),
    'a8000000-0000-4000-8000-000000000802'::uuid
  ) ->> 'outcome',
  'already_finished',
  'a lost completion response replays terminal state'
);

-- Failure, retry, cancellation, and stale completion -----------------------

select public.enqueue_growth_intelligence_request(
  'a8000000-0000-4000-8000-000000000201'::uuid,
  pg_temp.request_document(
    'evidence_reassessment', 'source_changed', 'immediate', repeat('c', 64)
  )
);

select extensions.is(
  public.claim_growth_intelligence_request(
    'a8000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.request_id('pending'),
    'a8000000-0000-4000-8000-000000000803'::uuid,
    600
  ) ->> 'outcome',
  'acquired',
  'a second request receives its own lease'
);
select extensions.throws_ok(
  $$
    select public.fail_growth_intelligence_request(
      'a8000000-0000-4000-8000-000000000201'::uuid,
      pg_temp.request_id('claimed'),
      'a8000000-0000-4000-8000-000000000803'::uuid,
      'raw provider stack trace'
    )
  $$,
  '22023', null,
  'raw or unregistered failure text cannot enter the ledger'
);
select extensions.is(
  public.fail_growth_intelligence_request(
    'a8000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.request_id('claimed'),
    'a8000000-0000-4000-8000-000000000803'::uuid,
    'ADAPTER_UNAVAILABLE'
  ) ->> 'outcome',
  'failed',
  'a current worker records only a safe failure code'
);

set local role authenticated;
set local request.jwt.claim.sub = 'a8000000-0000-4000-8000-000000000003';
select extensions.throws_ok(
  $$
    select public.retry_growth_intelligence_request(
      'a8000000-0000-4000-8000-000000000201'::uuid,
      'a8000000-0000-4000-8000-000000000003'::uuid,
      (select id from public.growth_intelligence_requests where organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid and status = 'failed'),
      'request-retry-viewer',
      'a8000000-0000-4000-8000-000000000704'::uuid
    )
  $$,
  '42501', null,
  'a viewer cannot retry failed research'
);

set local request.jwt.claim.sub = 'a8000000-0000-4000-8000-000000000002';
select extensions.is(
  public.retry_growth_intelligence_request(
    'a8000000-0000-4000-8000-000000000201'::uuid,
    'a8000000-0000-4000-8000-000000000002'::uuid,
    (select id from public.growth_intelligence_requests where organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid and status = 'failed'),
    'request-retry-operator',
    'a8000000-0000-4000-8000-000000000705'::uuid
  ) ->> 'outcome',
  'retried',
  'an operator can return a failed request to pending'
);
select extensions.is(
  public.retry_growth_intelligence_request(
    'a8000000-0000-4000-8000-000000000201'::uuid,
    'a8000000-0000-4000-8000-000000000002'::uuid,
    (select id from public.growth_intelligence_requests where organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid and status = 'pending'),
    'request-retry-operator',
    'a8000000-0000-4000-8000-000000000705'::uuid
  ) ->> 'replayed',
  'true',
  'a retry replay is idempotent after state has moved'
);
select extensions.is(
  public.cancel_growth_intelligence_request(
    'a8000000-0000-4000-8000-000000000201'::uuid,
    'a8000000-0000-4000-8000-000000000002'::uuid,
    (select id from public.growth_intelligence_requests where organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid and status = 'pending'),
    'Operator stopped this reassessment',
    'request-cancel-operator',
    'a8000000-0000-4000-8000-000000000706'::uuid
  ) ->> 'outcome',
  'cancelled',
  'an operator can cancel pending work'
);
select extensions.is(
  (
    select status from public.growth_intelligence_requests
    where organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid
      and kind = 'evidence_reassessment'
  ),
  'cancelled',
  'cancellation is durable'
);
select extensions.throws_ok(
  $$
    select public.cancel_growth_intelligence_request(
      'a8000000-0000-4000-8000-000000000202'::uuid,
      'a8000000-0000-4000-8000-000000000002'::uuid,
      (select id from public.growth_intelligence_requests where organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid limit 1),
      'Cross tenant attempt', 'request-cancel-cross-tenant',
      'a8000000-0000-4000-8000-000000000707'::uuid
    )
  $$,
  '42501', null,
  'request cancellation cannot cross the account boundary'
);

select extensions.throws_ok(
  $$
    select public.retry_growth_intelligence_request(
      'a8000000-0000-4000-8000-000000000201'::uuid,
      'a8000000-0000-4000-8000-000000000002'::uuid,
      (select id from public.growth_intelligence_requests where organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid and status = 'succeeded'),
      'request-retry-succeeded',
      'a8000000-0000-4000-8000-000000000708'::uuid
    )
  $$,
  '23514', null,
  'a succeeded request cannot be rewritten as a retry'
);

select extensions.is(
  (select count(*)::bigint from public.growth_intelligence_requests),
  2::bigint,
  'a member sees both requests in their own organization'
);
set local request.jwt.claim.sub = 'a8000000-0000-4000-8000-000000000004';
select extensions.is(
  (select count(*)::bigint from public.growth_intelligence_requests),
  0::bigint,
  'RLS hides another account request ledger'
);

reset role;

select extensions.throws_ok(
  $$
    update public.growth_intelligence_requests
    set request_fingerprint = repeat('f', 64)
    where organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid
  $$,
  '55000', null,
  'request identity and bound lineage are immutable'
);
select extensions.ok(
  not exists (
    select 1
    from public.audit_events event,
      lateral pg_catalog.jsonb_object_keys(event.payload) payload_key
    where event.organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid
      and event.event_name like 'growth_intelligence.%'
      and payload_key not in ('requestId', 'profileVersionId', 'kind', 'status')
  ),
  'request audit events contain identifiers and lifecycle state only'
);
select extensions.ok(
  exists (
    select 1 from public.audit_events
    where organization_id = 'a8000000-0000-4000-8000-000000000201'::uuid
      and event_name = 'growth_intelligence.request_cancelled'
      and correlation_id = 'a8000000-0000-4000-8000-000000000706'::uuid
  ),
  'the cancellation audit event commits with request state'
);

select * from extensions.finish();

rollback;
