begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(62);

-- Contract, indexes, and grants --------------------------------------------

select extensions.has_table(
  'public', 'growth_intelligence_research_pipelines',
  'the research pipeline envelope exists'
);
select extensions.has_column(
  'public', 'organization_market_profiles', 'branch_id',
  'profiles carry an independent branch scope'
);
select extensions.has_column(
  'public', 'growth_intelligence_requests', 'pipeline_id',
  'requests carry their pipeline lineage'
);
select extensions.has_column(
  'public', 'growth_intelligence_requests', 'phase',
  'requests name their pipeline phase'
);
select extensions.has_function(
  'public', 'propose_market_profile_version',
  array['uuid', 'uuid', 'jsonb', 'text', 'jsonb', 'text', 'uuid'],
  'profile proposals stay on one governed operation'
);
select extensions.has_function(
  'private', 'assert_market_profile_document_v2',
  array['uuid', 'uuid', 'jsonb'],
  'branch documents have a dedicated v2 validator beside the frozen v1 validator'
);
select extensions.has_function(
  'private', 'assert_market_profile_document_v1',
  array['uuid', 'jsonb'],
  'the frozen v1 validator is preserved'
);
select extensions.has_function(
  'private', 'assert_research_pipeline_coverage',
  array['jsonb'],
  'pipeline coverage entries are validated against the domain manifest shape'
);
select extensions.ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'public.growth_intelligence_research_pipelines'::regclass
  ),
  'the pipeline envelope enables and forces RLS'
);
select extensions.ok(
  pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_research_pipelines', 'select'
  ),
  'authenticated members receive a pipeline read grant'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_research_pipelines',
    'insert,update,delete'
  ),
  'authenticated sessions cannot write pipeline state directly'
);
select extensions.ok(
  pg_catalog.has_table_privilege(
    'service_role', 'public.growth_intelligence_research_pipelines', 'select'
  ),
  'workers keep read access to the pipeline envelope'
);
select extensions.has_index(
  'public', 'organization_market_profiles',
  'organization_market_profiles_legacy_scope_key',
  'legacy organization scope keeps its own partial uniqueness'
);
select extensions.has_index(
  'public', 'organization_market_profiles',
  'organization_market_profiles_branch_scope_key',
  'branch scope is unique per organization and branch'
);
select extensions.has_index(
  'public', 'growth_intelligence_research_pipelines',
  'growth_intelligence_research_pipelines_active_branch_key',
  'one active pipeline exists per organization and branch'
);
select extensions.has_index(
  'public', 'growth_intelligence_requests',
  'growth_intelligence_requests_pipeline_phase_idx',
  'one request exists per pipeline and phase'
);
select extensions.ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_item.oid) like '%1, 2%'
    from pg_catalog.pg_constraint constraint_item
    where constraint_item.conrelid = 'public.organization_market_profile_versions'::regclass
      and constraint_item.conname = 'organization_market_profile_versions_schema_version_check'
  ),
  'profile versions admit the branch document generation alongside v1'
);
select extensions.ok(
  (
    select constraint_item.condeferrable and constraint_item.condeferred
    from pg_catalog.pg_constraint constraint_item
    where constraint_item.conrelid = 'public.growth_intelligence_research_pipelines'::regclass
      and constraint_item.conname = 'growth_intelligence_research_pipelines_research_request_fk'
  ),
  'pipeline to request lineage is deferred for the atomic start transaction'
);
select extensions.ok(
  (
    select constraint_item.condeferrable and constraint_item.condeferred
    from pg_catalog.pg_constraint constraint_item
    where constraint_item.conrelid = 'public.growth_intelligence_requests'::regclass
      and constraint_item.conname = 'growth_intelligence_requests_pipeline_fk'
  ),
  'request to pipeline lineage is deferred for the atomic start transaction'
);
select extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.propose_market_profile_version(uuid,uuid,jsonb,text,jsonb,text,uuid)'::regprocedure
    ),
    'branch_id is null'
  ) > 0,
  'the legacy proposal wrapper stays scoped to the null-branch profile'
);
select extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'private.enforce_growth_intelligence_request_mutation()'::regprocedure
    ),
    'pipeline_id'
  ) > 0,
  'the request identity guard explicitly governs pipeline lineage fields'
);
select extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'private.prevent_market_profile_identity_mutation()'::regprocedure
    ),
    'branch_id'
  ) > 0,
  'the profile identity guard explicitly governs branch scope'
);

-- Two-account fixtures ------------------------------------------------------

insert into auth.users (id) values
  ('c9000000-0000-4000-8000-000000000001'::uuid),
  ('c9000000-0000-4000-8000-000000000002'::uuid),
  ('c9000000-0000-4000-8000-000000000003'::uuid),
  ('c9000000-0000-4000-8000-000000000004'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('c9000000-0000-4000-8000-000000000101'::uuid, 'Branch profile agency A', 'branch-profile-agency-a', 'c9000000-0000-4000-8000-000000000001'::uuid),
  ('c9000000-0000-4000-8000-000000000102'::uuid, 'Branch profile agency B', 'branch-profile-agency-b', 'c9000000-0000-4000-8000-000000000004'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('c9000000-0000-4000-8000-000000000201'::uuid, 'c9000000-0000-4000-8000-000000000101'::uuid, 'Branch profile client A', 'branch-profile-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'c9000000-0000-4000-8000-000000000001'::uuid),
  ('c9000000-0000-4000-8000-000000000202'::uuid, 'c9000000-0000-4000-8000-000000000102'::uuid, 'Branch profile client B', 'branch-profile-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'c9000000-0000-4000-8000-000000000004'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('c9000000-0000-4000-8000-000000000101'::uuid, 'c9000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('c9000000-0000-4000-8000-000000000101'::uuid, 'c9000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator'),
  ('c9000000-0000-4000-8000-000000000101'::uuid, 'c9000000-0000-4000-8000-000000000003'::uuid, 'member', 'viewer'),
  ('c9000000-0000-4000-8000-000000000102'::uuid, 'c9000000-0000-4000-8000-000000000004'::uuid, 'owner', 'owner');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency
) values
  ('c9000000-0000-4000-8000-000000000301'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid, 'Dubai Marina', 'dubai-marina', 'physical', 'Asia/Dubai', 'AED'),
  ('c9000000-0000-4000-8000-000000000302'::uuid, 'c9000000-0000-4000-8000-000000000201'::uuid, 'Downtown Dubai', 'downtown-dubai', 'physical', 'Asia/Dubai', 'AED'),
  ('c9000000-0000-4000-8000-000000000303'::uuid, 'c9000000-0000-4000-8000-000000000202'::uuid, 'Other tenant branch', 'other-tenant-branch', 'physical', 'Asia/Dubai', 'AED');

create or replace function pg_temp.market_profile_document(
  p_branch_id uuid default 'c9000000-0000-4000-8000-000000000301'::uuid,
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

create or replace function pg_temp.v2_document(
  p_branch_id uuid default 'c9000000-0000-4000-8000-000000000301'::uuid,
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

create or replace function pg_temp.profile_digest(p_document jsonb)
returns text
language sql
security definer
set search_path = ''
as $$
  select private.create_market_profile_digest(p_document);
$$;

create or replace function pg_temp.propose(
  p_actor_id uuid,
  p_document jsonb,
  p_idempotency_key text,
  p_organization_id uuid default 'c9000000-0000-4000-8000-000000000201'::uuid
)
returns jsonb
language sql
as $$
  select public.propose_market_profile_version(
    p_organization_id,
    p_actor_id,
    p_document,
    pg_temp.profile_digest(p_document),
    '{"source":"operator"}'::jsonb,
    p_idempotency_key,
    'c9000000-0000-4000-8000-000000000701'::uuid
  );
$$;

create or replace function pg_temp.request_fingerprint(p_seed text)
returns text
language sql
immutable
as $$
  select pg_catalog.encode(extensions.digest(p_seed, 'sha256'), 'hex');
$$;

-- Frozen v1 compatibility ---------------------------------------------------

select extensions.is(
  pg_temp.profile_digest(
    pg_temp.market_profile_document('11111111-1111-4111-8111-111111111111'::uuid)
  ),
  'e054b02adfd9e95c4030430d7689819aa231bc58134b38160c173c88486c9f82',
  'the v1 profile digest still matches the TypeScript canonical fixture'
);
select extensions.throws_ok(
  $$ select private.assert_market_profile_document_v1(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    pg_temp.market_profile_document() || '{"unapprovedField":"expand scope"}'::jsonb
  ) $$,
  '22023', null,
  'the frozen v1 validator still refuses a field outside the allowlist'
);

-- v2 validator beside v1 ----------------------------------------------------

select extensions.lives_ok(
  $$ select private.assert_market_profile_document_v2(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000301'::uuid,
    pg_temp.v2_document()
  ) $$,
  'a branch document with one trade area, city and country validates'
);
select extensions.throws_ok(
  $$ select private.assert_market_profile_document_v2(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000301'::uuid,
    pg_temp.v2_document('c9000000-0000-4000-8000-000000000302'::uuid)
  ) $$,
  '22023', null,
  'a trade area bound to another branch cannot validate for this profile branch'
);
select extensions.throws_ok(
  $$ select private.assert_market_profile_document_v2(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000301'::uuid,
    pg_temp.v2_document()
      || pg_catalog.jsonb_build_object(
        'competitors',
        (select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'key', 'rival-' || series.n,
            'name', 'Rival ' || series.n,
            'geographyRefs', pg_catalog.jsonb_build_array('ae:du'),
            'provenance', 'operator_lead', 'suggestedBy', 'operator',
            'relevanceEvidenceUrls', '[]'::jsonb
          )
          order by series.n
        ) from pg_catalog.generate_series(1, 6) series(n))
      )
  ) $$,
  '22023', null,
  'a sixth competitor cannot validate on a branch document'
);
select extensions.throws_ok(
  $$ select private.assert_market_profile_document_v2(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000301'::uuid,
    pg_temp.v2_document()
      || pg_catalog.jsonb_build_object(
        'competitors',
        pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'key', 'ai-rival', 'name', 'AI Rival',
            'geographyRefs', pg_catalog.jsonb_build_array('ae:du'),
            'provenance', 'operator_lead', 'suggestedBy', 'ai',
            'relevanceEvidenceUrls', '[]'::jsonb
          )
        )
      )
  ) $$,
  '22023', null,
  'an uncited AI-suggested competitor cannot validate on a branch document'
);
select extensions.throws_ok(
  $$ select private.assert_market_profile_document_v2(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000303'::uuid,
    pg_temp.v2_document('c9000000-0000-4000-8000-000000000303'::uuid)
  ) $$,
  '42501', null,
  'a branch document cannot validate against another tenant branch'
);
select extensions.lives_ok(
  $$ select private.assert_market_profile_document_v2(
    'c9000000-0000-4000-8000-000000000201'::uuid,
    'c9000000-0000-4000-8000-000000000301'::uuid,
    pg_temp.v2_document()
      || pg_catalog.jsonb_build_object(
        'competitors',
        pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'key', 'marina-lead', 'name', 'Marina Lead',
            'geographyRefs', '[]'::jsonb,
            'provenance', 'operator_lead', 'suggestedBy', 'operator',
            'relevanceEvidenceUrls', '[]'::jsonb
          )
        )
      )
  ) $$,
  'a name-only operator lead without refs or evidence validates'
);

-- Legacy proposal path stays on the null-branch profile ---------------------

set local role authenticated;
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000002';

select extensions.lives_ok(
  $$ select pg_temp.propose(
    'c9000000-0000-4000-8000-000000000002'::uuid,
    pg_temp.market_profile_document(),
    'branch-profile-proposal-0001'
  ) $$,
  'an operator can still propose a legacy organization profile version'
);
select extensions.is(
  (
    select profile.branch_id
    from public.organization_market_profiles profile
    where profile.organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
  ),
  null::uuid,
  'the legacy proposal still lands on the null-branch profile'
);

reset role;

-- Two profiles coexist in one organization ----------------------------------

select extensions.lives_ok(
  $$ insert into public.organization_market_profiles (organization_id, branch_id, enabled)
     values (
       'c9000000-0000-4000-8000-000000000201'::uuid,
       'c9000000-0000-4000-8000-000000000301'::uuid,
       false
     ) $$,
  'a branch profile can sit beside the legacy organization profile'
);
select extensions.is(
  (
    select count(*)::bigint from public.organization_market_profiles
    where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
  ),
  2::bigint,
  'two profiles coexist in one organization'
);
select extensions.throws_ok(
  $$ insert into public.organization_market_profiles (organization_id, branch_id, enabled)
     values (
       'c9000000-0000-4000-8000-000000000201'::uuid,
       'c9000000-0000-4000-8000-000000000301'::uuid,
       false
     ) $$,
  '23505', null,
  'the same branch cannot hold two profiles in one organization'
);
select extensions.throws_ok(
  $$ insert into public.organization_market_profiles (organization_id, enabled)
     values ('c9000000-0000-4000-8000-000000000201'::uuid, false) $$,
  '23505', null,
  'the legacy null scope keeps a single profile per organization'
);
select extensions.throws_ok(
  $$ insert into public.organization_market_profiles (organization_id, branch_id, enabled)
     values (
       'c9000000-0000-4000-8000-000000000201'::uuid,
       'c9000000-0000-4000-8000-000000000303'::uuid,
       false
     ) $$,
  '23503', null,
  'a profile cannot attach another tenant branch'
);

-- One active pipeline per branch --------------------------------------------

select extensions.lives_ok(
  $$ insert into public.growth_intelligence_research_pipelines (
       organization_id, branch_id, market_profile_id, market_profile_version_id,
       scope_digest
     ) values (
       'c9000000-0000-4000-8000-000000000201'::uuid,
       'c9000000-0000-4000-8000-000000000301'::uuid,
       (select id from public.organization_market_profiles
        where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
          and branch_id is null),
       (select id from public.organization_market_profile_versions
        where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid),
       pg_temp.request_fingerprint('branch-pipeline-scope-a-marina')
     ) $$,
  'a first active pipeline opens for the branch'
);
select extensions.throws_ok(
  $$ insert into public.growth_intelligence_research_pipelines (
       organization_id, branch_id, market_profile_id, market_profile_version_id,
       scope_digest
     ) values (
       'c9000000-0000-4000-8000-000000000201'::uuid,
       'c9000000-0000-4000-8000-000000000301'::uuid,
       (select id from public.organization_market_profiles
        where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
          and branch_id is null),
       (select id from public.organization_market_profile_versions
        where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid),
       pg_temp.request_fingerprint('branch-pipeline-scope-a-marina-changed')
     ) $$,
  '23505', null,
  'a second active pipeline cannot open for the same branch'
);
select extensions.lives_ok(
  $$ insert into public.growth_intelligence_research_pipelines (
       organization_id, branch_id, market_profile_id, market_profile_version_id,
       scope_digest
     ) values (
       'c9000000-0000-4000-8000-000000000201'::uuid,
       'c9000000-0000-4000-8000-000000000302'::uuid,
       (select id from public.organization_market_profiles
        where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
          and branch_id is null),
       (select id from public.organization_market_profile_versions
        where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid),
       pg_temp.request_fingerprint('branch-pipeline-scope-a-downtown')
     ) $$,
  'a sibling branch keeps its own active pipeline'
);

-- Cross-tenant lineage is refused -------------------------------------------

select extensions.lives_ok(
  $$ insert into public.organization_market_profiles (organization_id, branch_id, enabled)
     values (
       'c9000000-0000-4000-8000-000000000202'::uuid,
       'c9000000-0000-4000-8000-000000000303'::uuid,
       false
     ) $$,
  'the second tenant records its own branch profile fixture'
);
select extensions.throws_ok(
  $$ insert into public.growth_intelligence_research_pipelines (
       organization_id, branch_id, market_profile_id, market_profile_version_id,
       scope_digest
     ) values (
       'c9000000-0000-4000-8000-000000000201'::uuid,
       'c9000000-0000-4000-8000-000000000303'::uuid,
       (select id from public.organization_market_profiles
        where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
          and branch_id is null),
       (select id from public.organization_market_profile_versions
        where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid),
       pg_temp.request_fingerprint('branch-pipeline-cross-tenant-branch')
     ) $$,
  '23503', null,
  'a pipeline cannot attach another tenant branch'
);
select extensions.throws_ok(
  $$ insert into public.growth_intelligence_research_pipelines (
       organization_id, branch_id, market_profile_id, market_profile_version_id,
       scope_digest, stage, safe_failure_code
     ) values (
       'c9000000-0000-4000-8000-000000000201'::uuid,
       'c9000000-0000-4000-8000-000000000301'::uuid,
       (select id from public.organization_market_profiles
        where organization_id = 'c9000000-0000-4000-8000-000000000202'::uuid
          and branch_id is not null),
       (select id from public.organization_market_profile_versions
        where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid),
       pg_temp.request_fingerprint('branch-pipeline-cross-tenant-profile'),
       'cancelled', 'CROSS_TENANT_PROBE'
     ) $$,
  '23503', null,
  'a pipeline cannot attach another tenant profile'
);
select extensions.lives_ok(
  $$ insert into public.organization_market_profile_versions (
       organization_id, market_profile_id, version, schema_version,
       profile_document, profile_digest, source_policy_digest,
       proposal_source, created_by, correlation_id
     ) values (
       'c9000000-0000-4000-8000-000000000202'::uuid,
       (select id from public.organization_market_profiles
        where organization_id = 'c9000000-0000-4000-8000-000000000202'::uuid
          and branch_id is not null),
       1, 1,
       pg_temp.market_profile_document('c9000000-0000-4000-8000-000000000303'::uuid, 'Other tenant draft'),
       pg_temp.profile_digest(
         pg_temp.market_profile_document('c9000000-0000-4000-8000-000000000303'::uuid, 'Other tenant draft')
       ),
       pg_temp.profile_digest(
         pg_temp.market_profile_document('c9000000-0000-4000-8000-000000000303'::uuid, 'Other tenant draft')
           -> 'sourcePolicy'
       ),
       'operator', 'c9000000-0000-4000-8000-000000000004'::uuid,
       'c9000000-0000-4000-8000-000000000702'::uuid
     ) $$,
  'the second tenant records its own profile version fixture'
);
select extensions.throws_ok(
  $$ insert into public.growth_intelligence_research_pipelines (
       organization_id, branch_id, market_profile_id, market_profile_version_id,
       scope_digest, stage, safe_failure_code
     ) values (
       'c9000000-0000-4000-8000-000000000201'::uuid,
       'c9000000-0000-4000-8000-000000000301'::uuid,
       (select id from public.organization_market_profiles
        where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
          and branch_id is null),
       (select id from public.organization_market_profile_versions
        where organization_id = 'c9000000-0000-4000-8000-000000000202'::uuid),
       pg_temp.request_fingerprint('branch-pipeline-cross-tenant-version'),
       'cancelled', 'CROSS_TENANT_PROBE'
     ) $$,
  '23503', null,
  'a pipeline cannot attach another tenant profile version'
);

-- A terminal pipeline releases its branch -----------------------------------

select extensions.lives_ok(
  $$ update public.growth_intelligence_research_pipelines
     set stage = 'cancelled', safe_failure_code = 'REPLACED'
     where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
       and branch_id = 'c9000000-0000-4000-8000-000000000301'::uuid
       and stage = 'queued' $$,
  'a governed lifecycle field can terminalize the open pipeline'
);
select extensions.lives_ok(
  $$ insert into public.growth_intelligence_research_pipelines (
       organization_id, branch_id, market_profile_id, market_profile_version_id,
       scope_digest
     ) values (
       'c9000000-0000-4000-8000-000000000201'::uuid,
       'c9000000-0000-4000-8000-000000000301'::uuid,
       (select id from public.organization_market_profiles
        where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
          and branch_id is null),
       (select id from public.organization_market_profile_versions
        where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid),
       pg_temp.request_fingerprint('branch-pipeline-scope-a-marina-next')
     ) $$,
  'a new active pipeline opens after the prior one terminalizes'
);
select extensions.throws_ok(
  $$ update public.growth_intelligence_research_pipelines
     set coverage = '[{"slotKey":"","kind":"topic","outcome":"supported"}]'::jsonb
     where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
       and branch_id = 'c9000000-0000-4000-8000-000000000302'::uuid $$,
  '22023', null,
  'coverage outside the manifest shape cannot persist on a pipeline'
);

-- One request per pipeline and phase ----------------------------------------

create or replace function pg_temp.insert_request(
  p_fingerprint_seed text,
  p_pipeline_id uuid,
  p_phase text,
  p_organization_id uuid default 'c9000000-0000-4000-8000-000000000201'::uuid
)
returns uuid
language plpgsql
as $$
declare
  request_id uuid;
begin
  insert into public.growth_intelligence_requests (
    organization_id, branch_id, kind, trigger_reason, request_fingerprint,
    market_profile_version_id, source_policy_digest, research_rule_version,
    local_time_bucket, due_at, pipeline_id, phase, correlation_id
  ) values (
    p_organization_id,
    'c9000000-0000-4000-8000-000000000301'::uuid,
    'market_research', 'profile_confirmed',
    pg_temp.request_fingerprint(p_fingerprint_seed),
    (select id from public.organization_market_profile_versions
     where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid),
    (select source_policy_digest from public.organization_market_profile_versions
     where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid),
    'market-research@1', 'immediate', pg_catalog.now(),
    p_pipeline_id, p_phase,
    'c9000000-0000-4000-8000-000000000703'::uuid
  ) returning id into request_id;
  return request_id;
end;
$$;

select extensions.lives_ok(
  $$ select pg_temp.insert_request(
    'branch-request-research-a',
    (select id from public.growth_intelligence_research_pipelines
     where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
       and branch_id = 'c9000000-0000-4000-8000-000000000302'::uuid
       and stage = 'queued'),
    'research'
  ) $$,
  'a research request can join its branch pipeline'
);
select extensions.throws_ok(
  $$ select pg_temp.insert_request(
    'branch-request-research-a-dup',
    (select id from public.growth_intelligence_research_pipelines
     where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
       and branch_id = 'c9000000-0000-4000-8000-000000000302'::uuid
       and stage = 'queued'),
    'research'
  ) $$,
  '23505', null,
  'a pipeline cannot hold two research requests'
);
select extensions.lives_ok(
  $$ select pg_temp.insert_request(
    'branch-request-synthesis-a',
    (select id from public.growth_intelligence_research_pipelines
     where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
       and branch_id = 'c9000000-0000-4000-8000-000000000302'::uuid
       and stage = 'queued'),
    'synthesis'
  ) $$,
  'the synthesis child joins the same pipeline under its own phase'
);
select extensions.throws_ok(
  $$ select pg_temp.insert_request(
    'branch-request-cross-pipeline',
    (select id from public.growth_intelligence_research_pipelines
     where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
       and branch_id = 'c9000000-0000-4000-8000-000000000302'::uuid
       and stage = 'queued'),
    'research',
    'c9000000-0000-4000-8000-000000000202'::uuid
  ) $$,
  '23503', null,
  'a request cannot join another tenant pipeline'
);
select extensions.throws_ok(
  $$ select pg_temp.insert_request('branch-request-bad-phase', null, 'evidence') $$,
  '23514', null,
  'a pipeline phase outside research and synthesis is refused'
);
select extensions.throws_ok(
  $$ select pg_temp.insert_request(
    'branch-request-null-phase',
    (select id from public.growth_intelligence_research_pipelines
     where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
       and branch_id = 'c9000000-0000-4000-8000-000000000302'::uuid
       and stage = 'queued'),
    null
  ) $$,
  '23514', null,
  'a pipeline lineage cannot name a request without its phase'
);
select extensions.throws_ok(
  $$ update public.growth_intelligence_requests
     set pipeline_id = null, phase = null
     where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
       and request_fingerprint = pg_temp.request_fingerprint('branch-request-synthesis-a') $$,
  '55000', null,
  'request pipeline lineage is immutable once recorded'
);

-- Research runs stay tenant-fenced ------------------------------------------

insert into public.growth_intelligence_requests (
  organization_id, kind, trigger_reason, request_fingerprint,
  market_profile_version_id, source_policy_digest, research_rule_version,
  local_time_bucket, due_at, correlation_id
) values (
  'c9000000-0000-4000-8000-000000000202'::uuid,
  'market_research', 'profile_confirmed',
  pg_temp.request_fingerprint('branch-request-tenant-b'),
  (select id from public.organization_market_profile_versions
   where organization_id = 'c9000000-0000-4000-8000-000000000202'::uuid),
  (select source_policy_digest from public.organization_market_profile_versions
   where organization_id = 'c9000000-0000-4000-8000-000000000202'::uuid),
  'market-research@1', 'immediate', pg_catalog.now(),
  'c9000000-0000-4000-8000-000000000704'::uuid
);

select extensions.throws_ok(
  $$ insert into public.market_research_runs (
       organization_id, growth_intelligence_request_id, market_profile_version_id,
       claim_token, adapter_provider, adapter_version, run_fingerprint, correlation_id
     ) values (
       'c9000000-0000-4000-8000-000000000201'::uuid,
       (select id from public.growth_intelligence_requests
        where organization_id = 'c9000000-0000-4000-8000-000000000202'::uuid
          and request_fingerprint = pg_temp.request_fingerprint('branch-request-tenant-b')),
       (select id from public.organization_market_profile_versions
        where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid),
       'c9000000-0000-4000-8000-000000000705'::uuid,
       'brave', 'search@1',
       pg_temp.request_fingerprint('branch-run-cross-tenant'),
       'c9000000-0000-4000-8000-000000000706'::uuid
     ) $$,
  '23503', null,
  'a research run cannot attach another tenant request'
);

-- Branch schema_version 2 is storable ----------------------------------------

select extensions.lives_ok(
  $$ insert into public.organization_market_profile_versions (
       organization_id, market_profile_id, version, schema_version,
       profile_document, profile_digest, source_policy_digest,
       proposal_source, created_by, correlation_id
     ) values (
       'c9000000-0000-4000-8000-000000000201'::uuid,
       (select id from public.organization_market_profiles
        where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
          and branch_id = 'c9000000-0000-4000-8000-000000000301'::uuid),
       1, 2,
       pg_temp.v2_document(),
       pg_temp.profile_digest(pg_temp.v2_document()),
       pg_temp.profile_digest(pg_temp.v2_document() -> 'sourcePolicy'),
       'operator', 'c9000000-0000-4000-8000-000000000002'::uuid,
       'c9000000-0000-4000-8000-000000000707'::uuid
     ) $$,
  'a branch profile can store its v2 version beside frozen v1 rows'
);

-- Authenticated writes are denied; viewer reads are fenced ------------------

set local role authenticated;
set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$ insert into public.growth_intelligence_research_pipelines (
       organization_id, branch_id, market_profile_id, market_profile_version_id,
       scope_digest
     ) values (
       'c9000000-0000-4000-8000-000000000201'::uuid,
       'c9000000-0000-4000-8000-000000000301'::uuid,
       (select id from public.organization_market_profiles
        where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
          and branch_id is null),
       (select id from public.organization_market_profile_versions
        where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid),
       pg_temp.request_fingerprint('branch-pipeline-direct-write')
     ) $$,
  '42501', null,
  'a signed-in session cannot insert a pipeline directly'
);
select extensions.throws_ok(
  $$ update public.growth_intelligence_research_pipelines
     set safe_failure_code = 'REWRITTEN'
     where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid $$,
  '42501', null,
  'a signed-in session cannot update a pipeline directly'
);
select extensions.throws_ok(
  $$ insert into public.organization_market_profiles (organization_id, branch_id, enabled)
     values (
       'c9000000-0000-4000-8000-000000000201'::uuid,
       'c9000000-0000-4000-8000-000000000302'::uuid,
       false
     ) $$,
  '42501', null,
  'a signed-in session cannot insert a profile directly'
);

set local request.jwt.claim.sub = 'c9000000-0000-4000-8000-000000000003';
select extensions.is(
  (
    select count(*)::bigint from public.growth_intelligence_research_pipelines
    where organization_id = 'c9000000-0000-4000-8000-000000000201'::uuid
  ),
  3::bigint,
  'a viewer reads their own organization pipelines'
);
select extensions.is(
  (
    select count(*)::bigint from public.growth_intelligence_research_pipelines
  ),
  3::bigint,
  'RLS hides another tenant pipeline from the viewer'
);

reset role;

select * from extensions.finish();

rollback;
