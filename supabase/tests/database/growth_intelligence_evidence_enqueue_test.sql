begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(12);

-- Report-current evidence must wake Growth Intelligence ----------------------
--
-- When governed evidence becomes current, every affected organization +
-- channel + month gets exactly one durable request. The request carries the
-- server-resolved monthly evidence digest, so an unchanged month replays the
-- standing request while a correction, supersession, or reconciliation
-- mints a new one.

select extensions.has_function(
  'private', 'monthly_business_evidence_digest',
  array['uuid', 'uuid', 'date', 'date', 'text'],
  'one function resolves the monthly evidence digest'
);
select extensions.has_function(
  'private', 'enqueue_growth_intelligence_evidence_requests',
  array['uuid', 'uuid', 'uuid', 'date', 'date', 'text'],
  'one function enqueues every affected month'
);

-- Fixtures -------------------------------------------------------------------

insert into auth.users (id) values ('b8000000-0000-4000-8000-000000000001'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('b8000000-0000-4000-8000-000000000101'::uuid, 'Evidence enqueue agency', 'evidence-enqueue-agency', 'b8000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('b8000000-0000-4000-8000-000000000201'::uuid, 'b8000000-0000-4000-8000-000000000101'::uuid, 'Evidence enqueue client', 'evidence-enqueue-client', 'testing', 'AE', 'AED', 'Asia/Dubai', 'b8000000-0000-4000-8000-000000000001'::uuid),
  ('b8000000-0000-4000-8000-000000000202'::uuid, 'b8000000-0000-4000-8000-000000000101'::uuid, 'Evidence enqueue profileless', 'evidence-enqueue-profileless', 'testing', 'AE', 'AED', 'Asia/Dubai', 'b8000000-0000-4000-8000-000000000001'::uuid);

insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('b8000000-0000-4000-8000-000000000101'::uuid, 'b8000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');

insert into public.branches (id, organization_id, name, slug, kind, timezone, currency) values
  ('b8000000-0000-4000-8000-000000000301'::uuid, 'b8000000-0000-4000-8000-000000000201'::uuid, 'Dubai Marina', 'dubai-marina', 'physical', 'Asia/Dubai', 'AED');

insert into public.organization_channels (id, organization_id, key, display_name, category, created_by) values
  ('b8000000-0000-4000-8000-000000000401'::uuid, 'b8000000-0000-4000-8000-000000000201'::uuid, 'talabat', 'Talabat', 'marketplace', 'b8000000-0000-4000-8000-000000000001'::uuid);

insert into public.metric_definitions (
  id, organization_id, key, label, owner_scope, value_kind, aggregation,
  default_quality_tier, effective_from, is_active
) values
  ('b8000000-0000-4000-8000-000000000501'::uuid, 'b8000000-0000-4000-8000-000000000201'::uuid, 'test.enqueue_gross', 'Enqueue gross', 'organization', 'money', 'sum', 'measured', '2026-01-01', true);

create or replace function pg_temp.market_profile_document()
returns jsonb language sql immutable as $$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'publicIdentity', pg_catalog.jsonb_build_object(
      'approvedName', 'Enqueue Kitchen',
      'domains', pg_catalog.jsonb_build_array('example.com'),
      'publicUrls', pg_catalog.jsonb_build_array('https://example.com/menu')
    ),
    'nicheDescriptors', pg_catalog.jsonb_build_array('Kerala cuisine'),
    'geographies', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('layer', 'city', 'locationRef', 'ae:du', 'name', 'Dubai', 'countryCode', 'AE'),
      pg_catalog.jsonb_build_object('layer', 'country', 'locationRef', 'ae', 'name', 'United Arab Emirates', 'countryCode', 'AE'),
      pg_catalog.jsonb_build_object('layer', 'trade_area', 'locationRef', 'ae:du:dubai-marina', 'name', 'Dubai Marina delivery area', 'branchId', 'b8000000-0000-4000-8000-000000000301', 'radiusKm', 8)
    ),
    'competitors', '[]'::jsonb,
    'topics', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('key', 'local-events', 'label', 'Local events', 'provenance', 'core')
    ),
    'sourcePolicy', pg_catalog.jsonb_build_object(
      'excludedDomains', '[]'::jsonb, 'excludedPublishers', '[]'::jsonb,
      'excludedCompetitorKeys', '[]'::jsonb, 'allowBoundedQuotes', false, 'maxQuotationCharacters', 0
    ),
    'cadence', pg_catalog.jsonb_build_object(
      'timeZone', 'Asia/Dubai', 'dailyLocalTime', '06:30', 'weeklyDay', 'monday', 'weeklyLocalTime', '07:00'
    )
  );
$$;

create or replace function pg_temp.profile_digest()
returns text language sql security definer set search_path = '' as $$
  select private.create_market_profile_digest(pg_temp.market_profile_document());
$$;

create or replace function pg_temp.evidence_digest(p_channel uuid, p_start date, p_end date)
returns text language sql security definer set search_path = '' as $$
  select private.monthly_business_evidence_digest(
    'b8000000-0000-4000-8000-000000000201'::uuid, p_channel, p_start, p_end, 'Asia/Dubai'
  );
$$;

create or replace function pg_temp.enqueue_months(p_start date, p_end date)
returns jsonb language sql security definer set search_path = '' as $$
  select private.enqueue_growth_intelligence_evidence_requests(
    'b8000000-0000-4000-8000-000000000201'::uuid, 'b8000000-0000-4000-8000-000000000401'::uuid,
    'b8000000-0000-4000-8000-000000000301'::uuid, p_start, p_end, 'Asia/Dubai'
  );
$$;

create or replace function pg_temp.enqueue_profileless()
returns jsonb language sql security definer set search_path = '' as $$
  select private.enqueue_growth_intelligence_evidence_requests(
    'b8000000-0000-4000-8000-000000000202'::uuid, null,
    null, date '2026-02-01', date '2026-02-28', 'Asia/Dubai'
  );
$$;

set local role authenticated;
set local request.jwt.claim.sub = 'b8000000-0000-4000-8000-000000000001';

select public.propose_market_profile_version(
  'b8000000-0000-4000-8000-000000000201'::uuid,
  'b8000000-0000-4000-8000-000000000001'::uuid,
  pg_temp.market_profile_document(),
  pg_temp.profile_digest(),
  '{"source":"operator"}'::jsonb,
  'evidence-enqueue-profile-proposal',
  'b8000000-0000-4000-8000-000000000701'::uuid
);

select public.decide_market_profile_version(
  'b8000000-0000-4000-8000-000000000201'::uuid,
  'b8000000-0000-4000-8000-000000000001'::uuid,
  (select id from public.organization_market_profile_versions where organization_id = 'b8000000-0000-4000-8000-000000000201'::uuid),
  pg_temp.profile_digest(),
  'confirmed', null, 'evidence-enqueue-profile-confirm',
  'b8000000-0000-4000-8000-000000000702'::uuid
);

reset role;
set local role service_role;

insert into public.normalized_metrics (
  id, organization_id, branch_id, channel_id, metric_definition_id, value_kind,
  subject_kind, channel, dimensions, period_grain, period_start, period_end, period_timezone,
  value_numerator, currency, quality_tier, revision, reconciliation_state, reconciliation_digest,
  observed_at
) values
  ('b8000000-0000-4000-8000-000000000601'::uuid, 'b8000000-0000-4000-8000-000000000201'::uuid,
   'b8000000-0000-4000-8000-000000000301'::uuid, 'b8000000-0000-4000-8000-000000000401'::uuid,
   'b8000000-0000-4000-8000-000000000501'::uuid, 'money', 'organization', 'talabat', '{}'::jsonb,
   'day', '2026-02-04T20:00:00Z', '2026-02-05T20:00:00Z', 'Asia/Dubai',
   120000, 'AED', 'measured', 1, 'current', repeat('1', 64),
   '2026-02-06T00:00:00Z');

-- Monthly digest -------------------------------------------------------------

select extensions.ok(
pg_temp.evidence_digest(
    'b8000000-0000-4000-8000-000000000401'::uuid, date '2026-02-01', date '2026-02-28'
  ) ~ '^[a-f0-9]{64}$',
  'the monthly digest is sha256 hex'
);
select extensions.is(
pg_temp.evidence_digest(
    'b8000000-0000-4000-8000-000000000401'::uuid, date '2026-02-01', date '2026-02-28'
  ),
pg_temp.evidence_digest(
    'b8000000-0000-4000-8000-000000000401'::uuid, date '2026-02-01', date '2026-02-28'
  ),
  'the monthly digest is stable'
);

-- One request per affected month ---------------------------------------------

select extensions.is(
  (select count(*)::integer from jsonb_array_elements(
pg_temp.enqueue_months(date '2026-02-01', date '2026-02-28')
  )),
  1,
  'one affected month enqueues one request'
);
select extensions.is(
  (select kind from public.growth_intelligence_requests
   where organization_id = 'b8000000-0000-4000-8000-000000000201'::uuid
     and kind = 'business_evidence_changed'
   order by created_at limit 1),
  'business_evidence_changed',
  'the request names the evidence change'
);
select extensions.is(
  (select trigger_reason from public.growth_intelligence_requests
   where organization_id = 'b8000000-0000-4000-8000-000000000201'::uuid
     and kind = 'business_evidence_changed'
   order by created_at limit 1),
  'business_evidence_current',
  'and the reason the evidence turned current'
);
select extensions.is(
  (select count(*)::integer from public.growth_intelligence_requests
   where organization_id = 'b8000000-0000-4000-8000-000000000201'::uuid
     and kind = 'business_evidence_changed'),
  1,
  'replaying the unchanged month writes no second row'
);
select extensions.is(
  (select (value ->> 'replayed')::boolean from jsonb_array_elements(
pg_temp.enqueue_months(date '2026-01-01', date '2026-02-28')
  ) where value ->> 'month' = '2026-02'),
  true,
  'a two-month span replays the unchanged month'
);
select extensions.is(
  (select count(*)::integer from public.growth_intelligence_requests
   where organization_id = 'b8000000-0000-4000-8000-000000000201'::uuid
     and kind = 'business_evidence_changed'),
  2,
  'and mints the newly declared month'
);

-- Evidence change mints again --------------------------------------------------

insert into public.normalized_metrics (
  id, organization_id, branch_id, channel_id, metric_definition_id, value_kind,
  subject_kind, channel, dimensions, period_grain, period_start, period_end, period_timezone,
  value_numerator, currency, quality_tier, revision, reconciliation_state, reconciliation_digest,
  observed_at
) values
  ('b8000000-0000-4000-8000-000000000602'::uuid, 'b8000000-0000-4000-8000-000000000201'::uuid,
   'b8000000-0000-4000-8000-000000000301'::uuid, 'b8000000-0000-4000-8000-000000000401'::uuid,
   'b8000000-0000-4000-8000-000000000501'::uuid, 'money', 'organization', 'talabat', '{}'::jsonb,
   'day', '2026-02-05T20:00:00Z', '2026-02-06T20:00:00Z', 'Asia/Dubai',
   130000, 'AED', 'measured', 1, 'current', repeat('2', 64),
   '2026-02-07T00:00:00Z');

select pg_temp.enqueue_months(date '2026-02-01', date '2026-02-28');

select extensions.is(
  (select count(*)::integer from public.growth_intelligence_requests
   where organization_id = 'b8000000-0000-4000-8000-000000000201'::uuid
     and kind = 'business_evidence_changed'),
  3,
  'a new row in the month mints a new request for it'
);

-- No profile, no request -------------------------------------------------------

select extensions.is(
  (select count(*)::integer from jsonb_array_elements(pg_temp.enqueue_profileless())),
  0,
  'an organization with no profile enqueues nothing'
);

select * from extensions.finish();

rollback;
