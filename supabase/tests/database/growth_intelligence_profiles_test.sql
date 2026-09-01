begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(48);

-- Contract and grants -------------------------------------------------------

select extensions.has_table('public', 'organization_market_profiles', 'market profile identities exist');
select extensions.has_table('public', 'organization_market_profile_versions', 'market profile versions exist');
select extensions.has_table('public', 'organization_market_profile_decisions', 'market profile decisions exist');
select extensions.has_function(
  'public', 'propose_market_profile_version',
  array['uuid', 'uuid', 'jsonb', 'text', 'jsonb', 'text', 'uuid'],
  'profile proposals use one governed operation'
);
select extensions.has_function(
  'public', 'decide_market_profile_version',
  array['uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'text', 'uuid'],
  'profile decisions bind an exact version and digest'
);
select extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.propose_market_profile_version(uuid,uuid,jsonb,text,jsonb,text,uuid)'::regprocedure
    ),
    'pg_advisory_xact_lock'
  ) > 0,
  'profile proposal idempotency is serialized before lookup'
);
select extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.decide_market_profile_version(uuid,uuid,uuid,text,text,text,text,uuid)'::regprocedure
    ),
    'pg_advisory_xact_lock'
  ) > 0,
  'profile decision idempotency is serialized before lookup'
);
select extensions.ok(
  (
    select pg_catalog.bool_and(relation.relrowsecurity and relation.relforcerowsecurity)
    from pg_catalog.pg_class relation
    where relation.oid in (
      'public.organization_market_profiles'::regclass,
      'public.organization_market_profile_versions'::regclass,
      'public.organization_market_profile_decisions'::regclass
    )
  ),
  'every exposed profile table enables and forces RLS'
);
select extensions.ok(
  pg_catalog.has_table_privilege('authenticated', 'public.organization_market_profiles', 'select')
  and pg_catalog.has_table_privilege('authenticated', 'public.organization_market_profile_versions', 'select')
  and pg_catalog.has_table_privilege('authenticated', 'public.organization_market_profile_decisions', 'select'),
  'authenticated members receive read grants'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.organization_market_profiles', 'insert,update,delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.organization_market_profile_versions', 'insert,update,delete')
  and not pg_catalog.has_table_privilege('authenticated', 'public.organization_market_profile_decisions', 'insert,update,delete'),
  'authenticated sessions cannot write profile tables directly'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.propose_market_profile_version(uuid,uuid,jsonb,text,jsonb,text,uuid)',
    'execute'
  ),
  'authenticated operators may invoke the proposal boundary'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.decide_market_profile_version(uuid,uuid,uuid,text,text,text,text,uuid)',
    'execute'
  ),
  'authenticated operators may invoke the decision boundary'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.propose_market_profile_version(uuid,uuid,jsonb,text,jsonb,text,uuid)',
    'execute'
  ),
  'anonymous callers cannot propose a profile'
);

-- Two-account fixtures ------------------------------------------------------

insert into auth.users (id) values
  ('a7000000-0000-4000-8000-000000000001'::uuid),
  ('a7000000-0000-4000-8000-000000000002'::uuid),
  ('a7000000-0000-4000-8000-000000000003'::uuid),
  ('a7000000-0000-4000-8000-000000000004'::uuid),
  ('a7000000-0000-4000-8000-000000000005'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('a7000000-0000-4000-8000-000000000101'::uuid, 'Growth profile agency A', 'growth-profile-agency-a', 'a7000000-0000-4000-8000-000000000001'::uuid),
  ('a7000000-0000-4000-8000-000000000102'::uuid, 'Growth profile agency B', 'growth-profile-agency-b', 'a7000000-0000-4000-8000-000000000005'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000101'::uuid, 'Growth profile client A', 'growth-profile-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'a7000000-0000-4000-8000-000000000001'::uuid),
  ('a7000000-0000-4000-8000-000000000202'::uuid, 'a7000000-0000-4000-8000-000000000102'::uuid, 'Growth profile client B', 'growth-profile-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'a7000000-0000-4000-8000-000000000005'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('a7000000-0000-4000-8000-000000000101'::uuid, 'a7000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('a7000000-0000-4000-8000-000000000101'::uuid, 'a7000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator'),
  ('a7000000-0000-4000-8000-000000000101'::uuid, 'a7000000-0000-4000-8000-000000000003'::uuid, 'member', 'viewer'),
  ('a7000000-0000-4000-8000-000000000101'::uuid, 'a7000000-0000-4000-8000-000000000004'::uuid, 'member', 'admin'),
  ('a7000000-0000-4000-8000-000000000102'::uuid, 'a7000000-0000-4000-8000-000000000005'::uuid, 'owner', 'owner');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency
) values
  ('a7000000-0000-4000-8000-000000000301'::uuid, 'a7000000-0000-4000-8000-000000000201'::uuid, 'Dubai Marina', 'dubai-marina', 'physical', 'Asia/Dubai', 'AED'),
  ('a7000000-0000-4000-8000-000000000302'::uuid, 'a7000000-0000-4000-8000-000000000202'::uuid, 'Other tenant branch', 'other-tenant-branch', 'physical', 'Asia/Dubai', 'AED');

create or replace function pg_temp.market_profile_document(
  p_branch_id uuid default 'a7000000-0000-4000-8000-000000000301'::uuid,
  p_name text default 'Kerala Kitchen'
)
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
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
        'key', 'competitor-one', 'name', 'Competitor One',
        'publicUrl', 'https://competitor.example/',
        'geographyRefs', pg_catalog.jsonb_build_array('ae:du'),
        'relevanceEvidenceUrls', pg_catalog.jsonb_build_array('https://directory.example/competitor-one'),
        'relevanceReason', 'Serves the same confirmed city and cuisine category.'
      )
    ),
    'topics', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('key', 'local-events', 'label', 'Local events', 'provenance', 'core')
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

create or replace function pg_temp.profile_digest(p_document jsonb)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.create_market_profile_digest(p_document);
$$;

select extensions.is(
  pg_temp.profile_digest(
    pg_temp.market_profile_document('11111111-1111-4111-8111-111111111111'::uuid)
  ),
  'e054b02adfd9e95c4030430d7689819aa231bc58134b38160c173c88486c9f82',
  'the profile digest matches the TypeScript canonical fixture'
);

create or replace function pg_temp.propose(
  p_actor_id uuid,
  p_document jsonb,
  p_idempotency_key text,
  p_organization_id uuid default 'a7000000-0000-4000-8000-000000000201'::uuid,
  p_context jsonb default '{"source":"operator"}'::jsonb
)
returns jsonb
language sql
as $$
  select public.propose_market_profile_version(
    p_organization_id,
    p_actor_id,
    p_document,
    pg_temp.profile_digest(p_document),
    p_context,
    p_idempotency_key,
    'a7000000-0000-4000-8000-000000000701'::uuid
  );
$$;

set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-4000-8000-000000000002';

select extensions.lives_ok(
  $$ select pg_temp.propose(
    'a7000000-0000-4000-8000-000000000002'::uuid,
    pg_temp.market_profile_document(),
    'profile-proposal-0001'
  ) $$,
  'an operator can propose a bounded profile version'
);
select extensions.is(
  (
    select profile_digest
    from public.organization_market_profile_versions
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
  ),
  pg_temp.profile_digest(pg_temp.market_profile_document()),
  'the stored version binds the exact normalized profile digest'
);
select extensions.is(
  (
    select (pg_temp.propose(
      'a7000000-0000-4000-8000-000000000002'::uuid,
      pg_temp.market_profile_document(),
      'profile-proposal-0001'
    ) ->> 'profileVersionId')::uuid
  ),
  (
    select id from public.organization_market_profile_versions
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
  ),
  'an idempotent proposal replay returns the same version'
);
select extensions.is(
  (
    select (pg_temp.propose(
      'a7000000-0000-4000-8000-000000000002'::uuid,
      pg_temp.market_profile_document(),
      'profile-proposal-same-digest'
    ) ->> 'profileVersionId')::uuid
  ),
  (
    select id from public.organization_market_profile_versions
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
  ),
  'the same profile digest replays across a different delivery key'
);
select extensions.throws_ok(
  $$ select pg_temp.propose(
    'a7000000-0000-4000-8000-000000000002'::uuid,
    pg_temp.market_profile_document('a7000000-0000-4000-8000-000000000301'::uuid, 'Changed name'),
    'profile-proposal-0001'
  ) $$,
  '23505', null,
  'one proposal idempotency key cannot name different content'
);
select extensions.throws_ok(
  $$ select pg_temp.propose(
    'a7000000-0000-4000-8000-000000000002'::uuid,
    pg_temp.market_profile_document() || '{"unapprovedField":"expand scope"}'::jsonb,
    'profile-proposal-unknown-field'
  ) $$,
  '22023', null,
  'the database refuses a profile field outside the Zod allowlist'
);
select extensions.throws_ok(
  $$ select pg_temp.propose(
    'a7000000-0000-4000-8000-000000000002'::uuid,
    pg_temp.market_profile_document('a7000000-0000-4000-8000-000000000302'::uuid),
    'profile-proposal-cross-tenant-branch'
  ) $$,
  '42501', null,
  'a trade area cannot cite another tenant branch'
);

set local request.jwt.claim.sub = 'a7000000-0000-4000-8000-000000000003';
select extensions.throws_ok(
  $$ select pg_temp.propose(
    'a7000000-0000-4000-8000-000000000003'::uuid,
    pg_temp.market_profile_document(),
    'profile-proposal-viewer'
  ) $$,
  '42501', null,
  'a viewer cannot propose a Market Profile'
);
select extensions.is(
  (
    select count(*)::bigint from public.organization_market_profile_versions
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
  ),
  1::bigint,
  'a viewer can read their own organization profile'
);

set local request.jwt.claim.sub = 'a7000000-0000-4000-8000-000000000005';
select extensions.is(
  (select count(*)::bigint from public.organization_market_profile_versions),
  0::bigint,
  'RLS hides another account profile version'
);

set local request.jwt.claim.sub = 'a7000000-0000-4000-8000-000000000002';

select extensions.lives_ok(
  $$
    select public.decide_market_profile_version(
      'a7000000-0000-4000-8000-000000000201'::uuid,
      'a7000000-0000-4000-8000-000000000002'::uuid,
      (select id from public.organization_market_profile_versions where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid),
      pg_temp.profile_digest(pg_temp.market_profile_document()),
      'confirmed', null, 'profile-decision-0001',
      'a7000000-0000-4000-8000-000000000702'::uuid
    )
  $$,
  'an operator can confirm the exact proposed version'
);
select extensions.ok(
  (
    select enabled and current_version_id is not null
    from public.organization_market_profiles
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
  ),
  'confirmation enables the stable profile and moves its current pointer'
);
select extensions.is(
  (
    select profile_digest from public.organization_market_profile_decisions
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
      and decision = 'confirmed'
  ),
  pg_temp.profile_digest(pg_temp.market_profile_document()),
  'the confirmation decision binds the exact digest'
);
select extensions.is(
  (
    select count(*)::bigint from public.growth_intelligence_requests
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
      and kind = 'market_research'
      and trigger_reason = 'profile_confirmed'
      and status = 'pending'
  ),
  1::bigint,
  'confirmation creates the initial durable research request atomically'
);
select extensions.ok(
  not exists (
    select 1
    from public.audit_events event,
      lateral pg_catalog.jsonb_object_keys(event.payload) payload_key
    where event.organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
      and event.event_name like 'market_profile.%'
      and payload_key not in (
        'profileId', 'profileVersionId', 'decision', 'replacementVersionId', 'version'
      )
  ),
  'profile audit events contain identifiers and lifecycle state only'
);

select extensions.lives_ok(
  $$ select pg_temp.propose(
    'a7000000-0000-4000-8000-000000000002'::uuid,
    pg_temp.market_profile_document('a7000000-0000-4000-8000-000000000301'::uuid, 'Kerala Kitchen Dubai'),
    'profile-proposal-0002'
  ) $$,
  'an operator can propose a successor version'
);
select extensions.is(
  (
    select max(version) from public.organization_market_profile_versions
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
  ),
  2,
  'profile version numbers advance under the locked stable identity'
);
select extensions.lives_ok(
  $$
    select public.decide_market_profile_version(
      'a7000000-0000-4000-8000-000000000201'::uuid,
      'a7000000-0000-4000-8000-000000000002'::uuid,
      (select id from public.organization_market_profile_versions where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid and version = 2),
      pg_temp.profile_digest(pg_temp.market_profile_document('a7000000-0000-4000-8000-000000000301'::uuid, 'Kerala Kitchen Dubai')),
      'confirmed', 'Confirmed revised public name', 'profile-decision-0002',
      'a7000000-0000-4000-8000-000000000703'::uuid
    )
  $$,
  'confirming a successor is one governed transaction'
);
select extensions.is(
  (
    select count(*)::bigint from public.organization_market_profile_decisions
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
      and decision = 'superseded'
      and superseded_by_version_id = (
        select id from public.organization_market_profile_versions
        where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid and version = 2
      )
  ),
  1::bigint,
  'confirming a successor appends an explicit prior-version supersession'
);
select extensions.is(
  (
    select current_version_id from public.organization_market_profiles
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
  ),
  (
    select id from public.organization_market_profile_versions
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid and version = 2
  ),
  'exactly one successor version is current'
);
select extensions.is(
  (
    select count(*)::bigint from public.organization_market_profiles
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
  ),
  1::bigint,
  'all versions share one stable organization profile identity'
);

set local request.jwt.claim.sub = 'a7000000-0000-4000-8000-000000000004';
select extensions.lives_ok(
  $$ select pg_temp.propose(
    'a7000000-0000-4000-8000-000000000004'::uuid,
    pg_temp.market_profile_document('a7000000-0000-4000-8000-000000000301'::uuid, 'Rejected candidate'),
    'profile-proposal-admin-reject'
  ) $$,
  'an admin inherits the manage boundary'
);
select extensions.lives_ok(
  $$
    select public.decide_market_profile_version(
      'a7000000-0000-4000-8000-000000000201'::uuid,
      'a7000000-0000-4000-8000-000000000004'::uuid,
      (select id from public.organization_market_profile_versions where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid and version = 3),
      pg_temp.profile_digest(pg_temp.market_profile_document('a7000000-0000-4000-8000-000000000301'::uuid, 'Rejected candidate')),
      'rejected', 'Wrong public identity', 'profile-decision-admin-reject',
      'a7000000-0000-4000-8000-000000000704'::uuid
    )
  $$,
  'an admin can reject a non-current proposal'
);
select extensions.is(
  (
    select version from public.organization_market_profile_versions version
    join public.organization_market_profiles profile
      on profile.organization_id = version.organization_id
      and profile.current_version_id = version.id
    where profile.organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
  ),
  2,
  'rejecting a proposal does not move the current pointer'
);

set local request.jwt.claim.sub = 'a7000000-0000-4000-8000-000000000002';
select extensions.throws_ok(
  $$
    select public.decide_market_profile_version(
      'a7000000-0000-4000-8000-000000000202'::uuid,
      'a7000000-0000-4000-8000-000000000002'::uuid,
      (select id from public.organization_market_profile_versions where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid and version = 2),
      pg_temp.profile_digest(pg_temp.market_profile_document('a7000000-0000-4000-8000-000000000301'::uuid, 'Kerala Kitchen Dubai')),
      'confirmed', null, 'profile-decision-cross-tenant',
      'a7000000-0000-4000-8000-000000000705'::uuid
    )
  $$,
  '42501', null,
  'a profile decision cannot cross the account boundary'
);

select extensions.lives_ok(
  $$
    select public.decide_market_profile_version(
      'a7000000-0000-4000-8000-000000000201'::uuid,
      'a7000000-0000-4000-8000-000000000002'::uuid,
      (select current_version_id from public.organization_market_profiles where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid),
      (select profile_digest from public.organization_market_profile_versions where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid and version = 2),
      'disabled', 'Monitoring paused by operator', 'profile-decision-disable',
      'a7000000-0000-4000-8000-000000000706'::uuid
    )
  $$,
  'an operator can disable the current profile without deleting it'
);
select extensions.ok(
  (
    select not enabled and current_version_id is not null
    from public.organization_market_profiles
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
  ),
  'disablement retains the approved version pointer and history'
);
select extensions.throws_ok(
  $$
    select public.decide_market_profile_version(
      'a7000000-0000-4000-8000-000000000201'::uuid,
      'a7000000-0000-4000-8000-000000000002'::uuid,
      (select current_version_id from public.organization_market_profiles where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid),
      (select profile_digest from public.organization_market_profile_versions where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid and version = 2),
      'confirmed', null, 'profile-disabled-reconfirm',
      'a7000000-0000-4000-8000-000000000709'::uuid
    )
  $$,
  '23514', null,
  'a disabled version requires a new approved revision instead of superseding itself'
);
select extensions.is(
  (
    select count(*)::bigint from public.growth_intelligence_requests
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
      and status = 'cancelled'
  ),
  2::bigint,
  'disablement cancels pending research for both confirmed versions'
);

reset role;

select extensions.throws_ok(
  $$
    update public.organization_market_profile_versions
    set profile_document = profile_document || '{"unapprovedField":true}'::jsonb
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
  $$,
  '55000', null,
  'profile versions are append-only even for privileged direct writes'
);
select extensions.throws_ok(
  $$
    delete from public.organization_market_profile_versions
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
  $$,
  '55000', null,
  'profile versions cannot be deleted'
);
select extensions.throws_ok(
  $$
    update public.organization_market_profile_decisions
    set reason = 'rewritten history'
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
  $$,
  '55000', null,
  'profile decisions are append-only'
);
select extensions.throws_ok(
  $$
    delete from public.organization_market_profile_decisions
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
  $$,
  '55000', null,
  'profile decisions cannot be deleted'
);
select extensions.ok(
  exists (
    select 1 from public.audit_events
    where organization_id = 'a7000000-0000-4000-8000-000000000201'::uuid
      and event_name = 'market_profile.disabled'
      and correlation_id = 'a7000000-0000-4000-8000-000000000706'::uuid
  ),
  'the disablement audit event commits with the profile decision'
);

select * from extensions.finish();

rollback;
