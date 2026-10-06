begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(5);

insert into auth.users (id) values
  ('e8000000-0000-4000-8000-000000000001'::uuid),
  ('e8000000-0000-4000-8000-000000000002'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('e8000000-0000-4000-8000-000000000101'::uuid, 'Debug agency', 'debug-agency', 'e8000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('e8000000-0000-4000-8000-000000000201'::uuid, 'e8000000-0000-4000-8000-000000000101'::uuid, 'Debug client', 'debug-client', 'testing', 'AE', 'AED', 'Asia/Dubai', 'e8000000-0000-4000-8000-000000000001'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('e8000000-0000-4000-8000-000000000101'::uuid, 'e8000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('e8000000-0000-4000-8000-000000000101'::uuid, 'e8000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency, is_active
) values
  ('e8000000-0000-4000-8000-000000000301'::uuid, 'e8000000-0000-4000-8000-000000000201'::uuid, 'Debug Marina', 'debug-marina', 'physical', 'Asia/Dubai', 'AED', true);

create or replace function pg_temp.dbg_doc()
returns jsonb
language sql
immutable
as $$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'branchId', 'e8000000-0000-4000-8000-000000000301',
    'publicIdentity', pg_catalog.jsonb_build_object(
      'approvedName', 'Debug Marina Doc',
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
        'name', 'Dubai Marina delivery area',
        'branchId', 'e8000000-0000-4000-8000-000000000301', 'radiusKm', 8
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

create or replace function pg_temp.dbg_digest()
returns text
language sql
security definer
set search_path = ''
as $$
  select private.create_market_profile_digest(pg_temp.dbg_doc());
$$;

set local role authenticated;
set local request.jwt.claim.sub = 'e8000000-0000-4000-8000-000000000002';

select extensions.is(
  (
    select public.start_branch_market_research(
      'e8000000-0000-4000-8000-000000000201'::uuid,
      'e8000000-0000-4000-8000-000000000002'::uuid,
      'e8000000-0000-4000-8000-000000000301'::uuid,
      pg_temp.dbg_doc(),
      pg_temp.dbg_digest(),
      null,
      'debug-start-00000001',
      'e8000000-0000-4000-8000-000000000701'::uuid
    ) ->> 'outcome'
  ),
  'started',
  'debug start works'
);

reset role;

select extensions.is(
  (
    select pg_catalog.jsonb_array_length(
      private.enqueue_growth_intelligence_evidence_requests(
        'e8000000-0000-4000-8000-000000000201'::uuid,
        null,
        'e8000000-0000-4000-8000-000000000301'::uuid,
        '2026-08-01'::date, '2026-08-31'::date, 'Asia/Dubai'
      )
    )
  ),
  1::integer,
  'debug evidence call returns one entry'
);

select extensions.is(
  (
    select request.market_profile_version_id
    from pg_catalog.jsonb_array_elements(
      private.enqueue_growth_intelligence_evidence_requests(
        'e8000000-0000-4000-8000-000000000201'::uuid,
        null,
        'e8000000-0000-4000-8000-000000000301'::uuid,
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
    where profile.organization_id = 'e8000000-0000-4000-8000-000000000201'::uuid
      and profile.branch_id = 'e8000000-0000-4000-8000-000000000301'::uuid
  ),
  'debug evidence join resolves scope'
);

select extensions.is(
  (select count(*)::bigint from public.growth_intelligence_requests),
  -1::bigint,
  'debug request count sentinel'
);

select extensions.is(
  (select current_setting('role', true)),
  'debug-role-sentinel',
  'debug runner role'
);

rollback;
