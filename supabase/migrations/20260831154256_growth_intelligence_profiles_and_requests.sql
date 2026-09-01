-- Growth Intelligence foundation: an operator-governed Market Profile and a
-- durable, tenant-fenced work ledger. Trigger.dev will carry identifiers only;
-- this schema remains authoritative for approval, replay, due work, leases,
-- retries, cancellation, and terminal state.

-- Profile identity and immutable versions ----------------------------------

create table public.organization_market_profiles (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  current_version_id uuid,
  enabled boolean not null default false,
  next_daily_research_due_at timestamptz,
  next_weekly_synthesis_due_at timestamptz,
  last_research_succeeded_at timestamptz,
  last_weekly_synthesis_succeeded_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id),
  check (not enabled or current_version_id is not null)
);

create table public.organization_market_profile_versions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null,
  market_profile_id uuid not null,
  version integer not null check (version > 0),
  schema_version integer not null check (schema_version = 1),
  profile_document jsonb not null check (pg_catalog.jsonb_typeof(profile_document) = 'object'),
  profile_digest text not null check (profile_digest ~ '^[a-f0-9]{64}$'),
  source_policy_digest text not null check (source_policy_digest ~ '^[a-f0-9]{64}$'),
  proposal_source text not null check (proposal_source in ('operator', 'ai', 'system')),
  model_provider text check (model_provider is null or pg_catalog.char_length(model_provider) between 2 and 100),
  model_name text check (model_name is null or pg_catalog.char_length(model_name) between 2 and 160),
  model_version text check (model_version is null or pg_catalog.char_length(model_version) between 1 and 160),
  model_input_digest text check (model_input_digest is null or model_input_digest ~ '^[a-f0-9]{64}$'),
  created_by uuid references auth.users(id),
  correlation_id uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, market_profile_id, id),
  unique (organization_id, market_profile_id, version),
  unique (organization_id, market_profile_id, profile_digest),
  foreign key (organization_id, market_profile_id)
    references public.organization_market_profiles(organization_id, id) on delete restrict,
  check (
    (proposal_source = 'ai') =
    (model_provider is not null and model_name is not null and model_version is not null and model_input_digest is not null)
  )
);

alter table public.organization_market_profiles
  add constraint organization_market_profiles_current_version_fk
  foreign key (organization_id, id, current_version_id)
  references public.organization_market_profile_versions(organization_id, market_profile_id, id)
  on delete restrict;

create table public.organization_market_profile_decisions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null,
  market_profile_id uuid not null,
  market_profile_version_id uuid not null,
  decision text not null check (decision in ('confirmed', 'rejected', 'disabled', 'superseded')),
  profile_digest text not null check (profile_digest ~ '^[a-f0-9]{64}$'),
  superseded_by_version_id uuid,
  reason text check (reason is null or pg_catalog.char_length(reason) between 1 and 500),
  decided_by uuid not null references auth.users(id),
  correlation_id uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  foreign key (organization_id, market_profile_id)
    references public.organization_market_profiles(organization_id, id) on delete restrict,
  foreign key (organization_id, market_profile_id, market_profile_version_id)
    references public.organization_market_profile_versions(organization_id, market_profile_id, id)
    on delete restrict,
  foreign key (organization_id, market_profile_id, superseded_by_version_id)
    references public.organization_market_profile_versions(organization_id, market_profile_id, id)
    on delete restrict,
  check ((decision = 'superseded') = (superseded_by_version_id is not null)),
  check (
    superseded_by_version_id is null
    or superseded_by_version_id <> market_profile_version_id
  )
);

-- Durable work identity and lifecycle --------------------------------------

create table public.growth_intelligence_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid,
  channel_id uuid,
  kind text not null check (kind in (
    'profile_discovery', 'market_research', 'weekly_synthesis',
    'business_evidence_changed', 'evidence_reassessment'
  )),
  trigger_reason text not null check (trigger_reason in (
    'profile_confirmed', 'profile_revised', 'daily_due', 'weekly_due',
    'business_evidence_current', 'source_policy_changed', 'evidence_expired',
    'source_changed', 'manual_retry'
  )),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  business_evidence_digest text check (
    business_evidence_digest is null or business_evidence_digest ~ '^[a-f0-9]{64}$'
  ),
  market_profile_version_id uuid not null,
  source_policy_digest text not null check (source_policy_digest ~ '^[a-f0-9]{64}$'),
  research_rule_version text not null check (
    research_rule_version ~ '^[a-z][a-z0-9_.-]*@[1-9][0-9]*$'
  ),
  local_time_bucket text not null check (
    local_time_bucket = 'immediate'
    or local_time_bucket ~ '^(daily|weekly):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ),
  synthesis_version_tuple text check (
    synthesis_version_tuple is null
    or synthesis_version_tuple ~ '^[a-z][a-z0-9_.-]*@[1-9][0-9]*$'
  ),
  playbook_version_tuple text check (
    playbook_version_tuple is null
    or playbook_version_tuple ~ '^[a-z][a-z0-9_.-]*@[1-9][0-9]*$'
  ),
  status text not null default 'pending' check (
    status in ('pending', 'claimed', 'succeeded', 'failed', 'cancelled')
  ),
  due_at timestamptz not null,
  claim_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  max_attempts integer not null default 10 check (max_attempts between 1 and 10),
  dispatch_attempt_count integer not null default 0 check (dispatch_attempt_count >= 0),
  last_dispatch_attempt_at timestamptz,
  safe_failure_code text check (
    safe_failure_code is null or safe_failure_code ~ '^[A-Z][A-Z0-9_]{2,80}$'
  ),
  failed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or pg_catalog.char_length(cancel_reason) between 1 and 500),
  requested_by uuid references auth.users(id),
  last_transition_actor_type public.audit_actor_type not null default 'system',
  last_transition_actor_id uuid references auth.users(id),
  correlation_id uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, request_fingerprint),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete restrict,
  foreign key (organization_id, channel_id)
    references public.organization_channels(organization_id, id) on delete restrict,
  foreign key (organization_id, market_profile_version_id)
    references public.organization_market_profile_versions(organization_id, id) on delete restrict,
  check ((status = 'claimed') = (claim_token is not null)),
  check ((claim_token is null) = (lease_expires_at is null)),
  check (status <> 'succeeded' or completed_at is not null),
  check (status <> 'failed' or (safe_failure_code is not null and failed_at is not null)),
  check (status <> 'cancelled' or (cancelled_at is not null and cancel_reason is not null)),
  check (status = 'failed' or (safe_failure_code is null and failed_at is null)),
  check (status = 'succeeded' or completed_at is null),
  check (status = 'cancelled' or (cancelled_at is null and cancel_reason is null))
);

create table private.growth_intelligence_write_operations (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  operation_kind text not null check (operation_kind in ('propose_profile', 'decide_profile', 'retry_request', 'cancel_request')),
  idempotency_key text not null check (pg_catalog.char_length(idempotency_key) between 16 and 200),
  operation_fingerprint text not null check (operation_fingerprint ~ '^[a-f0-9]{64}$'),
  market_profile_version_id uuid,
  market_profile_decision_id uuid,
  request_id uuid,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (organization_id, operation_kind, idempotency_key),
  foreign key (organization_id, market_profile_version_id)
    references public.organization_market_profile_versions(organization_id, id) on delete restrict,
  foreign key (organization_id, market_profile_decision_id)
    references public.organization_market_profile_decisions(organization_id, id) on delete restrict,
  foreign key (organization_id, request_id)
    references public.growth_intelligence_requests(organization_id, id) on delete restrict
);

-- Tenant-leading and bounded-work indexes ----------------------------------

create index organization_market_profile_versions_profile_idx
  on public.organization_market_profile_versions
  (organization_id, market_profile_id, version desc);
create index organization_market_profile_decisions_profile_idx
  on public.organization_market_profile_decisions
  (organization_id, market_profile_id, created_at desc, id desc);
create index growth_intelligence_requests_profile_idx
  on public.growth_intelligence_requests
  (organization_id, market_profile_version_id, created_at desc, id desc);
create index growth_intelligence_requests_branch_idx
  on public.growth_intelligence_requests (organization_id, branch_id)
  where branch_id is not null;
create index growth_intelligence_requests_channel_idx
  on public.growth_intelligence_requests (organization_id, channel_id)
  where channel_id is not null;
create index growth_intelligence_requests_due_idx
  on public.growth_intelligence_requests
  (due_at, last_dispatch_attempt_at, organization_id, id)
  where status in ('pending', 'claimed');

comment on table public.organization_market_profiles is
  'Stable organization Market Profile identity. The current pointer moves only through a governed decision.';
comment on table public.organization_market_profile_versions is
  'Immutable, bounded Market Profile proposals. Recurring research binds one exact confirmed version.';
comment on table public.organization_market_profile_decisions is
  'Append-only operator confirmation, rejection, disablement, and supersession history.';
comment on table public.growth_intelligence_requests is
  'Durable Growth Intelligence work identity, due state, dispatch recovery, lease fencing, retries, and terminal outcome.';

-- Strict JSON agreement and cross-runtime fingerprints ---------------------

create function private.jsonb_object_has_exact_keys(
  p_value jsonb,
  p_keys text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_typeof(p_value) = 'object'
    and (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_value)) = pg_catalog.cardinality(p_keys)
    and not exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_value) actual(key)
      where not (actual.key = any (p_keys))
    );
$$;

create function private.canonical_json_text(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  value_type text := pg_catalog.jsonb_typeof(p_value);
  canonical_output text;
begin
  if value_type = 'object' then
    select '{' || coalesce(
      pg_catalog.string_agg(
        pg_catalog.to_jsonb(member.key)::text || ':' || private.canonical_json_text(member.value),
        ',' order by member.key collate "C"
      ),
      ''
    ) || '}'
    into canonical_output
    from pg_catalog.jsonb_each(p_value) member;
    return canonical_output;
  end if;

  if value_type = 'array' then
    select '[' || coalesce(
      pg_catalog.string_agg(private.canonical_json_text(member.value), ',' order by member.ordinality),
      ''
    ) || ']'
    into canonical_output
    from pg_catalog.jsonb_array_elements(p_value) with ordinality member(value, ordinality);
    return canonical_output;
  end if;

  if value_type = 'number' then
    canonical_output := p_value #>> '{}';
    if pg_catalog.strpos(canonical_output, '.') > 0 then
      canonical_output := pg_catalog.rtrim(pg_catalog.rtrim(canonical_output, '0'), '.');
    end if;
    return canonical_output;
  end if;

  return p_value::text;
end;
$$;

create function private.create_market_profile_digest(p_document jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(private.canonical_json_text(p_document), 'sha256'),
    'hex'
  );
$$;

create function private.create_growth_intelligence_request_fingerprint(
  p_organization_id uuid,
  p_branch_id uuid,
  p_channel_id uuid,
  p_kind text,
  p_trigger_reason text,
  p_business_evidence_digest text,
  p_market_profile_version_id uuid,
  p_source_policy_digest text,
  p_research_rule_version text,
  p_local_time_bucket text,
  p_synthesis_version_tuple text,
  p_playbook_version_tuple text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      '{'
      || '"branchId":' || coalesce(pg_catalog.to_jsonb(p_branch_id)::text, 'null') || ','
      || '"businessEvidenceDigest":' || coalesce(pg_catalog.to_jsonb(p_business_evidence_digest)::text, 'null') || ','
      || '"channelId":' || coalesce(pg_catalog.to_jsonb(p_channel_id)::text, 'null') || ','
      || '"kind":' || pg_catalog.to_jsonb(p_kind)::text || ','
      || '"localTimeBucket":' || pg_catalog.to_jsonb(p_local_time_bucket)::text || ','
      || '"marketProfileVersionId":' || pg_catalog.to_jsonb(p_market_profile_version_id)::text || ','
      || '"organizationId":' || pg_catalog.to_jsonb(p_organization_id)::text || ','
      || '"playbookVersionTuple":' || coalesce(pg_catalog.to_jsonb(p_playbook_version_tuple)::text, 'null') || ','
      || '"researchRuleVersion":' || pg_catalog.to_jsonb(p_research_rule_version)::text || ','
      || '"sourcePolicyDigest":' || pg_catalog.to_jsonb(p_source_policy_digest)::text || ','
      || '"synthesisVersionTuple":' || coalesce(pg_catalog.to_jsonb(p_synthesis_version_tuple)::text, 'null') || ','
      || '"triggerReason":' || pg_catalog.to_jsonb(p_trigger_reason)::text
      || '}',
      'sha256'
    ),
    'hex'
  );
$$;

create function private.assert_market_profile_document_v1(
  p_organization_id uuid,
  p_document jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  public_identity jsonb;
  source_policy jsonb;
  cadence jsonb;
  geography jsonb;
  competitor jsonb;
  topic jsonb;
  item text;
begin
  if not private.jsonb_object_has_exact_keys(
    p_document,
    array[
      'schemaVersion', 'publicIdentity', 'nicheDescriptors', 'geographies',
      'competitors', 'topics', 'sourcePolicy', 'cadence'
    ]::text[]
  ) or p_document ->> 'schemaVersion' <> '1' then
    raise exception 'market_profile_document_invalid' using errcode = '22023';
  end if;

  public_identity := p_document -> 'publicIdentity';
  if not private.jsonb_object_has_exact_keys(
    public_identity,
    array['approvedName', 'domains', 'publicUrls']::text[]
  )
  or pg_catalog.char_length(coalesce(public_identity ->> 'approvedName', '')) not between 1 and 200
  or public_identity ->> 'approvedName' is distinct from pg_catalog.btrim(public_identity ->> 'approvedName')
  or pg_catalog.jsonb_typeof(public_identity -> 'domains') <> 'array'
  or pg_catalog.jsonb_array_length(public_identity -> 'domains') > 10
  or pg_catalog.jsonb_typeof(public_identity -> 'publicUrls') <> 'array'
  or pg_catalog.jsonb_array_length(public_identity -> 'publicUrls') > 20 then
    raise exception 'market_profile_public_identity_invalid' using errcode = '22023';
  end if;

  for item in select value from pg_catalog.jsonb_array_elements_text(public_identity -> 'domains') loop
    if pg_catalog.char_length(item) not between 1 and 254
      or item <> pg_catalog.lower(item)
      or item !~ '^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)([.]([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?))+$' then
      raise exception 'market_profile_domain_invalid' using errcode = '22023';
    end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(public_identity -> 'domains'))
    <> (select pg_catalog.count(distinct value) from pg_catalog.jsonb_array_elements_text(public_identity -> 'domains'))
    or coalesce(
      (select pg_catalog.jsonb_agg(value order by value collate "C") from pg_catalog.jsonb_array_elements_text(public_identity -> 'domains')),
      '[]'::jsonb
    ) is distinct from public_identity -> 'domains' then
    raise exception 'market_profile_domains_not_normalized' using errcode = '22023';
  end if;

  for item in select value from pg_catalog.jsonb_array_elements_text(public_identity -> 'publicUrls') loop
    if pg_catalog.char_length(item) not between 1 and 2048
      or item !~ '^https?://[^/@]+(?:/|$)'
      or item ~ '^https?://[^/]*@'
      or item like '%#%' then
      raise exception 'market_profile_public_url_invalid' using errcode = '22023';
    end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(public_identity -> 'publicUrls'))
    <> (select pg_catalog.count(distinct value) from pg_catalog.jsonb_array_elements_text(public_identity -> 'publicUrls'))
    or coalesce(
      (select pg_catalog.jsonb_agg(value order by value collate "C") from pg_catalog.jsonb_array_elements_text(public_identity -> 'publicUrls')),
      '[]'::jsonb
    ) is distinct from public_identity -> 'publicUrls' then
    raise exception 'market_profile_public_urls_not_normalized' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_document -> 'nicheDescriptors') <> 'array'
    or pg_catalog.jsonb_array_length(p_document -> 'nicheDescriptors') not between 1 and 12 then
    raise exception 'market_profile_niche_invalid' using errcode = '22023';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements_text(p_document -> 'nicheDescriptors') loop
    if pg_catalog.char_length(item) not between 1 and 120 or item <> pg_catalog.btrim(item) then
      raise exception 'market_profile_niche_invalid' using errcode = '22023';
    end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(p_document -> 'nicheDescriptors'))
    <> (select pg_catalog.count(distinct pg_catalog.lower(value)) from pg_catalog.jsonb_array_elements_text(p_document -> 'nicheDescriptors'))
    or (select pg_catalog.jsonb_agg(value order by value collate "C") from pg_catalog.jsonb_array_elements_text(p_document -> 'nicheDescriptors'))
      is distinct from p_document -> 'nicheDescriptors' then
    raise exception 'market_profile_niche_not_normalized' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_document -> 'geographies') <> 'array'
    or pg_catalog.jsonb_array_length(p_document -> 'geographies') not between 2 and 100 then
    raise exception 'market_profile_geography_invalid' using errcode = '22023';
  end if;
  for geography in select value from pg_catalog.jsonb_array_elements(p_document -> 'geographies') loop
    if geography ->> 'layer' = 'trade_area' then
      if not private.jsonb_object_has_exact_keys(
        geography,
        case when geography ? 'radiusKm'
          then array['layer', 'locationRef', 'name', 'branchId', 'radiusKm']::text[]
          else array['layer', 'locationRef', 'name', 'branchId']::text[] end
      )
      or coalesce(geography ->> 'locationRef', '') !~ '^[a-z0-9][a-z0-9:._-]+$'
      or pg_catalog.char_length(coalesce(geography ->> 'name', '')) not between 1 and 160
      or coalesce(geography ->> 'branchId', '') !~ '^[0-9a-fA-F-]{36}$'
      or (geography ? 'radiusKm' and (
        pg_catalog.jsonb_typeof(geography -> 'radiusKm') <> 'number'
        or (geography ->> 'radiusKm')::numeric <= 0
        or (geography ->> 'radiusKm')::numeric > 500
      )) then
        raise exception 'market_profile_trade_area_invalid' using errcode = '22023';
      end if;
      if not exists (
        select 1 from public.branches branch
        where branch.organization_id = p_organization_id
          and branch.id = (geography ->> 'branchId')::uuid
      ) then
        raise exception 'market_profile_trade_area_not_found' using errcode = '42501';
      end if;
    elsif geography ->> 'layer' in ('city', 'country') then
      if not private.jsonb_object_has_exact_keys(
        geography,
        array['layer', 'locationRef', 'name', 'countryCode']::text[]
      )
      or coalesce(geography ->> 'locationRef', '') !~ '^[a-z0-9][a-z0-9:._-]+$'
      or pg_catalog.char_length(coalesce(geography ->> 'name', '')) not between 1 and 160
      or coalesce(geography ->> 'countryCode', '') !~ '^[A-Z]{2}$' then
        raise exception 'market_profile_geography_invalid' using errcode = '22023';
      end if;
    else
      raise exception 'market_profile_geography_invalid' using errcode = '22023';
    end if;
  end loop;
  if not exists (
    select 1 from pg_catalog.jsonb_array_elements(p_document -> 'geographies') value
    where value ->> 'layer' = 'city'
  ) or not exists (
    select 1 from pg_catalog.jsonb_array_elements(p_document -> 'geographies') value
    where value ->> 'layer' = 'country'
  ) or (
    select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_document -> 'geographies') value
  ) <> (
    select pg_catalog.count(distinct (value ->> 'layer') || ':' || (value ->> 'locationRef'))
    from pg_catalog.jsonb_array_elements(p_document -> 'geographies') value
  ) or (
    select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_document -> 'geographies') value
    where value ->> 'layer' = 'trade_area'
  ) <> (
    select pg_catalog.count(distinct value ->> 'branchId')
    from pg_catalog.jsonb_array_elements(p_document -> 'geographies') value
    where value ->> 'layer' = 'trade_area'
  ) or (
    select pg_catalog.jsonb_agg(value order by (value ->> 'layer') || ':' || (value ->> 'locationRef') collate "C")
    from pg_catalog.jsonb_array_elements(p_document -> 'geographies') value
  ) is distinct from p_document -> 'geographies' then
    raise exception 'market_profile_geography_not_normalized' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_document -> 'competitors') <> 'array'
    or pg_catalog.jsonb_array_length(p_document -> 'competitors') > 50 then
    raise exception 'market_profile_competitors_invalid' using errcode = '22023';
  end if;
  for competitor in select value from pg_catalog.jsonb_array_elements(p_document -> 'competitors') loop
    if not private.jsonb_object_has_exact_keys(
      competitor,
      case when competitor ? 'publicUrl'
        then array['key', 'name', 'publicUrl', 'geographyRefs', 'relevanceEvidenceUrls', 'relevanceReason']::text[]
        else array['key', 'name', 'geographyRefs', 'relevanceEvidenceUrls', 'relevanceReason']::text[] end
    )
    or coalesce(competitor ->> 'key', '') !~ '^[a-z][a-z0-9_.-]{1,119}$'
    or pg_catalog.char_length(coalesce(competitor ->> 'name', '')) not between 1 and 160
    or pg_catalog.char_length(coalesce(competitor ->> 'relevanceReason', '')) not between 1 and 600
    or pg_catalog.jsonb_typeof(competitor -> 'geographyRefs') <> 'array'
    or pg_catalog.jsonb_array_length(competitor -> 'geographyRefs') not between 1 and 20
    or pg_catalog.jsonb_typeof(competitor -> 'relevanceEvidenceUrls') <> 'array'
    or pg_catalog.jsonb_array_length(competitor -> 'relevanceEvidenceUrls') not between 1 and 10
    or (competitor ? 'publicUrl' and (
      pg_catalog.char_length(competitor ->> 'publicUrl') not between 1 and 2048
      or competitor ->> 'publicUrl' !~ '^https?://[^/@]+(?:/|$)'
      or competitor ->> 'publicUrl' ~ '^https?://[^/]*@'
      or competitor ->> 'publicUrl' like '%#%'
    )) then
      raise exception 'market_profile_competitor_invalid' using errcode = '22023';
    end if;
    if exists (
      select 1 from pg_catalog.jsonb_array_elements_text(competitor -> 'geographyRefs') reference
      where not exists (
        select 1 from pg_catalog.jsonb_array_elements(p_document -> 'geographies') approved
        where approved ->> 'locationRef' = reference
      )
    ) or (
      select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(competitor -> 'geographyRefs')
    ) <> (
      select pg_catalog.count(distinct value) from pg_catalog.jsonb_array_elements_text(competitor -> 'geographyRefs')
    ) or (
      select pg_catalog.jsonb_agg(value order by value collate "C")
      from pg_catalog.jsonb_array_elements_text(competitor -> 'geographyRefs')
    ) is distinct from competitor -> 'geographyRefs' then
      raise exception 'market_profile_competitor_geography_invalid' using errcode = '22023';
    end if;
    for item in select value from pg_catalog.jsonb_array_elements_text(competitor -> 'relevanceEvidenceUrls') loop
      if pg_catalog.char_length(item) not between 1 and 2048
        or item !~ '^https?://[^/@]+(?:/|$)'
        or item ~ '^https?://[^/]*@'
        or item like '%#%' then
        raise exception 'market_profile_competitor_evidence_invalid' using errcode = '22023';
      end if;
    end loop;
    if (
      select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(competitor -> 'relevanceEvidenceUrls')
    ) <> (
      select pg_catalog.count(distinct value) from pg_catalog.jsonb_array_elements_text(competitor -> 'relevanceEvidenceUrls')
    ) or (
      select pg_catalog.jsonb_agg(value order by value collate "C")
      from pg_catalog.jsonb_array_elements_text(competitor -> 'relevanceEvidenceUrls')
    ) is distinct from competitor -> 'relevanceEvidenceUrls' then
      raise exception 'market_profile_competitor_evidence_not_normalized' using errcode = '22023';
    end if;
  end loop;
  if (
    select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_document -> 'competitors') value
  ) <> (
    select pg_catalog.count(distinct value ->> 'key') from pg_catalog.jsonb_array_elements(p_document -> 'competitors') value
  ) or coalesce((
    select pg_catalog.jsonb_agg(value order by value ->> 'key' collate "C")
    from pg_catalog.jsonb_array_elements(p_document -> 'competitors') value
  ), '[]'::jsonb) is distinct from p_document -> 'competitors' then
    raise exception 'market_profile_competitors_not_normalized' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_document -> 'topics') <> 'array'
    or pg_catalog.jsonb_array_length(p_document -> 'topics') not between 1 and 50 then
    raise exception 'market_profile_topics_invalid' using errcode = '22023';
  end if;
  for topic in select value from pg_catalog.jsonb_array_elements(p_document -> 'topics') loop
    if not private.jsonb_object_has_exact_keys(topic, array['key', 'label', 'provenance']::text[])
      or coalesce(topic ->> 'key', '') !~ '^[a-z][a-z0-9_.-]{1,119}$'
      or pg_catalog.char_length(coalesce(topic ->> 'label', '')) not between 1 and 160
      or topic ->> 'provenance' not in ('core', 'industry_pack', 'operator', 'ai_proposed') then
      raise exception 'market_profile_topic_invalid' using errcode = '22023';
    end if;
  end loop;
  if (
    select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_document -> 'topics') value
  ) <> (
    select pg_catalog.count(distinct value ->> 'key') from pg_catalog.jsonb_array_elements(p_document -> 'topics') value
  ) or (
    select pg_catalog.jsonb_agg(value order by value ->> 'key' collate "C")
    from pg_catalog.jsonb_array_elements(p_document -> 'topics') value
  ) is distinct from p_document -> 'topics' then
    raise exception 'market_profile_topics_not_normalized' using errcode = '22023';
  end if;

  source_policy := p_document -> 'sourcePolicy';
  if not private.jsonb_object_has_exact_keys(
    source_policy,
    array[
      'excludedDomains', 'excludedPublishers', 'excludedCompetitorKeys',
      'allowBoundedQuotes', 'maxQuotationCharacters'
    ]::text[]
  )
  or pg_catalog.jsonb_typeof(source_policy -> 'excludedDomains') <> 'array'
  or pg_catalog.jsonb_array_length(source_policy -> 'excludedDomains') > 100
  or pg_catalog.jsonb_typeof(source_policy -> 'excludedPublishers') <> 'array'
  or pg_catalog.jsonb_array_length(source_policy -> 'excludedPublishers') > 100
  or pg_catalog.jsonb_typeof(source_policy -> 'excludedCompetitorKeys') <> 'array'
  or pg_catalog.jsonb_array_length(source_policy -> 'excludedCompetitorKeys') > 50
  or pg_catalog.jsonb_typeof(source_policy -> 'allowBoundedQuotes') <> 'boolean'
  or pg_catalog.jsonb_typeof(source_policy -> 'maxQuotationCharacters') <> 'number'
  or (source_policy ->> 'maxQuotationCharacters')::numeric <> pg_catalog.trunc((source_policy ->> 'maxQuotationCharacters')::numeric)
  or (source_policy ->> 'maxQuotationCharacters')::integer not between 0 and 500
  or ((source_policy ->> 'allowBoundedQuotes')::boolean
      <> ((source_policy ->> 'maxQuotationCharacters')::integer > 0)) then
    raise exception 'market_profile_source_policy_invalid' using errcode = '22023';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements_text(source_policy -> 'excludedDomains') loop
    if item <> pg_catalog.lower(item)
      or item !~ '^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)([.]([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?))+$' then
      raise exception 'market_profile_excluded_domain_invalid' using errcode = '22023';
    end if;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements_text(source_policy -> 'excludedPublishers') loop
    if pg_catalog.char_length(item) not between 1 and 200 or item <> pg_catalog.btrim(item) then
      raise exception 'market_profile_excluded_publisher_invalid' using errcode = '22023';
    end if;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements_text(source_policy -> 'excludedCompetitorKeys') loop
    if item !~ '^[a-z][a-z0-9_.-]{1,119}$' then
      raise exception 'market_profile_excluded_competitor_invalid' using errcode = '22023';
    end if;
  end loop;
  if exists (
    select 1 from (values
      (source_policy -> 'excludedDomains'),
      (source_policy -> 'excludedPublishers'),
      (source_policy -> 'excludedCompetitorKeys')
    ) arrays(value)
    where (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(arrays.value))
      <> (
        select pg_catalog.count(distinct pg_catalog.lower(element.value))
        from pg_catalog.jsonb_array_elements_text(arrays.value) element(value)
      )
      or coalesce((
        select pg_catalog.jsonb_agg(element.value order by element.value collate "C")
        from pg_catalog.jsonb_array_elements_text(arrays.value) element(value)
      ), '[]'::jsonb) is distinct from arrays.value
  ) then
    raise exception 'market_profile_source_policy_not_normalized' using errcode = '22023';
  end if;

  cadence := p_document -> 'cadence';
  if not private.jsonb_object_has_exact_keys(
    cadence,
    array['timeZone', 'dailyLocalTime', 'weeklyDay', 'weeklyLocalTime']::text[]
  )
  or pg_catalog.char_length(coalesce(cadence ->> 'timeZone', '')) not between 1 and 100
  or not exists (
    select 1 from pg_catalog.pg_timezone_names zone where zone.name = cadence ->> 'timeZone'
  )
  or coalesce(cadence ->> 'dailyLocalTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  or cadence ->> 'weeklyDay' not in (
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
  )
  or coalesce(cadence ->> 'weeklyLocalTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'market_profile_cadence_invalid' using errcode = '22023';
  end if;
end;
$$;

-- Immutability and identifier-only audit -----------------------------------

create function private.reject_growth_intelligence_append_only_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception '%_is_append_only', tg_table_name using errcode = '55000';
end;
$$;

create function private.prevent_market_profile_identity_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'organization_market_profile_delete_forbidden' using errcode = '55000';
  end if;
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'organization_market_profile_identity_immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

create function private.enforce_growth_intelligence_request_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'growth_intelligence_request_delete_forbidden' using errcode = '55000';
  end if;
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.branch_id is distinct from old.branch_id
    or new.channel_id is distinct from old.channel_id
    or new.kind is distinct from old.kind
    or new.trigger_reason is distinct from old.trigger_reason
    or new.request_fingerprint is distinct from old.request_fingerprint
    or new.business_evidence_digest is distinct from old.business_evidence_digest
    or new.market_profile_version_id is distinct from old.market_profile_version_id
    or new.source_policy_digest is distinct from old.source_policy_digest
    or new.research_rule_version is distinct from old.research_rule_version
    or new.local_time_bucket is distinct from old.local_time_bucket
    or new.synthesis_version_tuple is distinct from old.synthesis_version_tuple
    or new.playbook_version_tuple is distinct from old.playbook_version_tuple
    or new.max_attempts is distinct from old.max_attempts
    or new.requested_by is distinct from old.requested_by
    or new.created_at is distinct from old.created_at then
    raise exception 'growth_intelligence_request_identity_immutable' using errcode = '55000';
  end if;
  if new.attempt_count < old.attempt_count
    or new.dispatch_attempt_count < old.dispatch_attempt_count then
    raise exception 'growth_intelligence_request_attempts_cannot_decrease' using errcode = '55000';
  end if;
  if not (
    (old.status = 'pending' and new.status in ('pending', 'claimed', 'cancelled'))
    or (old.status = 'claimed' and new.status in ('claimed', 'succeeded', 'failed', 'cancelled'))
    or (old.status = 'failed' and new.status in ('failed', 'pending'))
    or (old.status = 'succeeded' and new.status = 'succeeded')
    or (old.status = 'cancelled' and new.status = 'cancelled')
  ) then
    raise exception 'growth_intelligence_request_transition_invalid' using errcode = '55000';
  end if;
  return new;
end;
$$;

create function private.audit_market_profile_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
begin
  event_name := case when exists (
    select 1
    from public.organization_market_profiles profile
    where profile.organization_id = new.organization_id
      and profile.id = new.market_profile_id
      and profile.current_version_id is not null
  ) then 'market_profile.revision_proposed' else 'market_profile.proposed' end;

  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id,
    correlation_id, payload
  ) values (
    new.organization_id,
    event_name,
    case when new.created_by is null then 'system'::public.audit_actor_type else 'user'::public.audit_actor_type end,
    new.created_by,
    'organization_market_profile_version',
    new.id,
    new.correlation_id,
    pg_catalog.jsonb_build_object(
      'profileId', new.market_profile_id,
      'profileVersionId', new.id,
      'version', new.version
    )
  );
  return new;
end;
$$;

create function private.audit_market_profile_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id,
    correlation_id, payload
  ) values (
    new.organization_id,
    'market_profile.' || new.decision,
    'user'::public.audit_actor_type,
    new.decided_by,
    'organization_market_profile_decision',
    new.id,
    new.correlation_id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'profileId', new.market_profile_id,
      'profileVersionId', new.market_profile_version_id,
      'decision', new.decision,
      'replacementVersionId', new.superseded_by_version_id
    ))
  );
  return new;
end;
$$;

create function private.audit_growth_intelligence_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
begin
  if tg_op = 'INSERT' then
    event_name := case when new.kind = 'market_research'
      then 'market_research.requested'
      else 'growth_intelligence.requested'
    end;
  elsif old.status is distinct from new.status then
    event_name := case
      when new.status = 'claimed' then 'growth_intelligence.request_claimed'
      when new.status = 'succeeded' then 'growth_intelligence.request_completed'
      when new.status = 'failed' then 'growth_intelligence.request_failed'
      when new.status = 'cancelled' then 'growth_intelligence.request_cancelled'
      when new.status = 'pending' and old.status = 'failed' then 'growth_intelligence.request_retried'
      else null
    end;
  elsif new.dispatch_attempt_count > old.dispatch_attempt_count then
    event_name := 'growth_intelligence.dispatch_claimed';
  end if;

  if event_name is not null then
    insert into public.audit_events (
      organization_id, event_name, actor_type, actor_id, entity_type, entity_id,
      correlation_id, payload
    ) values (
      new.organization_id,
      event_name,
      new.last_transition_actor_type,
      new.last_transition_actor_id,
      'growth_intelligence_request',
      new.id,
      new.correlation_id,
      pg_catalog.jsonb_build_object(
        'requestId', new.id,
        'profileVersionId', new.market_profile_version_id,
        'kind', new.kind,
        'status', new.status
      )
    );
  end if;
  return new;
end;
$$;

create trigger organization_market_profiles_set_updated_at
before update on public.organization_market_profiles
for each row execute function public.set_updated_at();
create trigger organization_market_profiles_prevent_mutation
before update or delete on public.organization_market_profiles
for each row execute function private.prevent_market_profile_identity_mutation();

create trigger organization_market_profile_versions_append_only
before update or delete on public.organization_market_profile_versions
for each row execute function private.reject_growth_intelligence_append_only_mutation();
create trigger organization_market_profile_versions_audit
after insert on public.organization_market_profile_versions
for each row execute function private.audit_market_profile_version();

create trigger organization_market_profile_decisions_append_only
before update or delete on public.organization_market_profile_decisions
for each row execute function private.reject_growth_intelligence_append_only_mutation();
create trigger organization_market_profile_decisions_audit
after insert on public.organization_market_profile_decisions
for each row execute function private.audit_market_profile_decision();

create trigger growth_intelligence_requests_set_updated_at
before update on public.growth_intelligence_requests
for each row execute function public.set_updated_at();
create trigger growth_intelligence_requests_enforce_mutation
before update or delete on public.growth_intelligence_requests
for each row execute function private.enforce_growth_intelligence_request_mutation();
create trigger growth_intelligence_requests_audit
after insert or update on public.growth_intelligence_requests
for each row execute function private.audit_growth_intelligence_request();

-- RLS and least-privilege table access -------------------------------------

alter table public.organization_market_profiles enable row level security;
alter table public.organization_market_profiles force row level security;
alter table public.organization_market_profile_versions enable row level security;
alter table public.organization_market_profile_versions force row level security;
alter table public.organization_market_profile_decisions enable row level security;
alter table public.organization_market_profile_decisions force row level security;
alter table public.growth_intelligence_requests enable row level security;
alter table public.growth_intelligence_requests force row level security;
alter table private.growth_intelligence_write_operations enable row level security;
alter table private.growth_intelligence_write_operations force row level security;

create policy "members with Growth Intelligence read profiles"
on public.organization_market_profiles
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read profile versions"
on public.organization_market_profile_versions
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read profile decisions"
on public.organization_market_profile_decisions
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read requests"
on public.growth_intelligence_requests
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

revoke all on table public.organization_market_profiles from public, anon, authenticated, service_role;
revoke all on table public.organization_market_profile_versions from public, anon, authenticated, service_role;
revoke all on table public.organization_market_profile_decisions from public, anon, authenticated, service_role;
revoke all on table public.growth_intelligence_requests from public, anon, authenticated, service_role;
revoke all on table private.growth_intelligence_write_operations from public, anon, authenticated, service_role;

grant select on table public.organization_market_profiles to authenticated;
grant select on table public.organization_market_profile_versions to authenticated;
grant select on table public.organization_market_profile_decisions to authenticated;
grant select on table public.growth_intelligence_requests to authenticated;

-- Durable request admission ------------------------------------------------

create function public.enqueue_growth_intelligence_request(
  p_organization_id uuid,
  p_request jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.growth_intelligence_requests;
  saved public.growth_intelligence_requests;
  request_branch_id uuid := nullif(p_request ->> 'branchId', '')::uuid;
  request_channel_id uuid := nullif(p_request ->> 'channelId', '')::uuid;
  request_profile_version_id uuid := nullif(p_request ->> 'marketProfileVersionId', '')::uuid;
  request_business_digest text := nullif(p_request ->> 'businessEvidenceDigest', '');
  request_synthesis_version text := nullif(p_request ->> 'synthesisVersionTuple', '');
  request_playbook_version text := nullif(p_request ->> 'playbookVersionTuple', '');
  request_fingerprint text := p_request ->> 'requestFingerprint';
  computed_fingerprint text;
  requester uuid := nullif(p_request ->> 'requestedBy', '')::uuid;
begin
  if p_organization_id is null
    or not private.jsonb_object_has_exact_keys(
      p_request,
      array[
        'organizationId', 'branchId', 'channelId', 'kind', 'triggerReason',
        'businessEvidenceDigest', 'marketProfileVersionId', 'sourcePolicyDigest',
        'researchRuleVersion', 'localTimeBucket', 'synthesisVersionTuple',
        'playbookVersionTuple', 'requestFingerprint', 'dueAt', 'correlationId',
        'requestedBy'
      ]::text[]
    )
    or p_request ->> 'organizationId' is distinct from p_organization_id::text
    or p_request ->> 'kind' not in (
      'profile_discovery', 'market_research', 'weekly_synthesis',
      'business_evidence_changed', 'evidence_reassessment'
    )
    or p_request ->> 'triggerReason' not in (
      'profile_confirmed', 'profile_revised', 'daily_due', 'weekly_due',
      'business_evidence_current', 'source_policy_changed', 'evidence_expired',
      'source_changed', 'manual_retry'
    )
    or request_profile_version_id is null
    or coalesce(p_request ->> 'sourcePolicyDigest', '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_request ->> 'researchRuleVersion', '') !~ '^[a-z][a-z0-9_.-]*@[1-9][0-9]*$'
    or not (
      p_request ->> 'localTimeBucket' = 'immediate'
      or p_request ->> 'localTimeBucket' ~ '^(daily|weekly):[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    )
    or (request_business_digest is not null and request_business_digest !~ '^[a-f0-9]{64}$')
    or (request_synthesis_version is not null and request_synthesis_version !~ '^[a-z][a-z0-9_.-]*@[1-9][0-9]*$')
    or (request_playbook_version is not null and request_playbook_version !~ '^[a-z][a-z0-9_.-]*@[1-9][0-9]*$')
    or request_fingerprint !~ '^[a-f0-9]{64}$'
    or nullif(p_request ->> 'correlationId', '') is null
    or nullif(p_request ->> 'dueAt', '') is null then
    raise exception 'growth_intelligence_request_invalid' using errcode = '22023';
  end if;

  if request_branch_id is not null and not exists (
    select 1 from public.branches branch
    where branch.organization_id = p_organization_id and branch.id = request_branch_id
  ) then
    raise exception 'growth_intelligence_request_scope_not_found' using errcode = '42501';
  end if;
  if request_channel_id is not null and not exists (
    select 1 from public.organization_channels channel
    where channel.organization_id = p_organization_id and channel.id = request_channel_id
  ) then
    raise exception 'growth_intelligence_request_scope_not_found' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.organization_market_profile_versions version
    join public.organization_market_profiles profile
      on profile.organization_id = version.organization_id
      and profile.id = version.market_profile_id
    where version.organization_id = p_organization_id
      and version.id = request_profile_version_id
      and version.source_policy_digest = p_request ->> 'sourcePolicyDigest'
      and profile.current_version_id = version.id
      and profile.enabled
  ) then
    raise exception 'growth_intelligence_request_profile_not_current' using errcode = '42501';
  end if;

  computed_fingerprint := private.create_growth_intelligence_request_fingerprint(
    p_organization_id,
    request_branch_id,
    request_channel_id,
    p_request ->> 'kind',
    p_request ->> 'triggerReason',
    request_business_digest,
    request_profile_version_id,
    p_request ->> 'sourcePolicyDigest',
    p_request ->> 'researchRuleVersion',
    p_request ->> 'localTimeBucket',
    request_synthesis_version,
    request_playbook_version
  );
  if request_fingerprint is distinct from computed_fingerprint then
    raise exception 'growth_intelligence_request_fingerprint_mismatch' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'enqueue_request', p_organization_id, computed_fingerprint
    ),
    0
  ));

  select request.* into existing
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.request_fingerprint = computed_fingerprint
  for update;
  if found then
    return pg_catalog.jsonb_build_object(
      'requestId', existing.id,
      'status', existing.status,
      'replayed', true
    );
  end if;

  insert into public.growth_intelligence_requests (
    organization_id, branch_id, channel_id, kind, trigger_reason,
    request_fingerprint, business_evidence_digest, market_profile_version_id,
    source_policy_digest, research_rule_version, local_time_bucket,
    synthesis_version_tuple, playbook_version_tuple, due_at, requested_by,
    last_transition_actor_type, last_transition_actor_id, correlation_id
  ) values (
    p_organization_id,
    request_branch_id,
    request_channel_id,
    p_request ->> 'kind',
    p_request ->> 'triggerReason',
    computed_fingerprint,
    request_business_digest,
    request_profile_version_id,
    p_request ->> 'sourcePolicyDigest',
    p_request ->> 'researchRuleVersion',
    p_request ->> 'localTimeBucket',
    request_synthesis_version,
    request_playbook_version,
    (p_request ->> 'dueAt')::timestamptz,
    requester,
    case when requester is null then 'system'::public.audit_actor_type else 'user'::public.audit_actor_type end,
    requester,
    (p_request ->> 'correlationId')::uuid
  ) returning * into saved;

  return pg_catalog.jsonb_build_object(
    'requestId', saved.id,
    'status', saved.status,
    'replayed', false
  );
end;
$$;

-- Profile proposal and approval --------------------------------------------

create function public.propose_market_profile_version(
  p_organization_id uuid,
  p_actor_id uuid,
  p_profile_document jsonb,
  p_profile_digest text,
  p_proposal_context jsonb,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.organization_market_profiles;
  version_row public.organization_market_profile_versions;
  operation private.growth_intelligence_write_operations;
  proposal_source text := p_proposal_context ->> 'source';
  operation_fingerprint text;
  next_version integer;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'market_profile_proposal_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_profile_digest !~ '^[a-f0-9]{64}$'
    or pg_catalog.char_length(p_idempotency_key) not between 16 and 200
    or p_correlation_id is null
    or proposal_source not in ('operator', 'ai', 'system')
    or not private.jsonb_object_has_exact_keys(
      p_proposal_context,
      case when proposal_source = 'ai'
        then array['source', 'modelProvider', 'modelName', 'modelVersion', 'modelInputDigest']::text[]
        else array['source']::text[] end
    )
    or (proposal_source = 'ai' and (
      pg_catalog.char_length(coalesce(p_proposal_context ->> 'modelProvider', '')) not between 2 and 100
      or pg_catalog.char_length(coalesce(p_proposal_context ->> 'modelName', '')) not between 2 and 160
      or pg_catalog.char_length(coalesce(p_proposal_context ->> 'modelVersion', '')) not between 1 and 160
      or coalesce(p_proposal_context ->> 'modelInputDigest', '') !~ '^[a-f0-9]{64}$'
    )) then
    raise exception 'market_profile_proposal_invalid' using errcode = '22023';
  end if;

  perform private.assert_market_profile_document_v1(p_organization_id, p_profile_document);
  if private.create_market_profile_digest(p_profile_document) is distinct from p_profile_digest then
    raise exception 'market_profile_digest_mismatch' using errcode = '22023';
  end if;

  operation_fingerprint := pg_catalog.encode(extensions.digest(
    p_profile_digest || '|' || private.canonical_json_text(p_proposal_context),
    'sha256'
  ), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'propose_profile', p_organization_id, p_idempotency_key
    ),
    0
  ));
  select stored.* into operation
  from private.growth_intelligence_write_operations stored
  where stored.organization_id = p_organization_id
    and stored.operation_kind = 'propose_profile'
    and stored.idempotency_key = p_idempotency_key
  for update;
  if found then
    if operation.operation_fingerprint is distinct from operation_fingerprint then
      raise exception 'market_profile_proposal_idempotency_conflict' using errcode = '23505';
    end if;
    select stored.* into version_row
    from public.organization_market_profile_versions stored
    where stored.organization_id = p_organization_id
      and stored.id = operation.market_profile_version_id;
    return pg_catalog.jsonb_build_object(
      'profileId', version_row.market_profile_id,
      'profileVersionId', version_row.id,
      'version', version_row.version,
      'profileDigest', version_row.profile_digest,
      'replayed', true
    );
  end if;

  insert into public.organization_market_profiles (
    organization_id, created_by
  ) values (
    p_organization_id, p_actor_id
  ) on conflict (organization_id) do nothing;

  select stored.* into profile
  from public.organization_market_profiles stored
  where stored.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'market_profile_organization_not_found' using errcode = '42501';
  end if;

  select stored.* into version_row
  from public.organization_market_profile_versions stored
  where stored.organization_id = p_organization_id
    and stored.market_profile_id = profile.id
    and stored.profile_digest = p_profile_digest;
  if found then
    insert into private.growth_intelligence_write_operations (
      organization_id, operation_kind, idempotency_key, operation_fingerprint,
      market_profile_version_id
    ) values (
      p_organization_id, 'propose_profile', p_idempotency_key,
      operation_fingerprint, version_row.id
    );
    return pg_catalog.jsonb_build_object(
      'profileId', version_row.market_profile_id,
      'profileVersionId', version_row.id,
      'version', version_row.version,
      'profileDigest', version_row.profile_digest,
      'replayed', true
    );
  end if;

  select coalesce(pg_catalog.max(stored.version), 0) + 1
  into next_version
  from public.organization_market_profile_versions stored
  where stored.organization_id = p_organization_id
    and stored.market_profile_id = profile.id;

  insert into public.organization_market_profile_versions (
    organization_id, market_profile_id, version, schema_version,
    profile_document, profile_digest, source_policy_digest, proposal_source,
    model_provider, model_name, model_version, model_input_digest,
    created_by, correlation_id
  ) values (
    p_organization_id,
    profile.id,
    next_version,
    (p_profile_document ->> 'schemaVersion')::integer,
    p_profile_document,
    p_profile_digest,
    private.create_market_profile_digest(p_profile_document -> 'sourcePolicy'),
    proposal_source,
    nullif(p_proposal_context ->> 'modelProvider', ''),
    nullif(p_proposal_context ->> 'modelName', ''),
    nullif(p_proposal_context ->> 'modelVersion', ''),
    nullif(p_proposal_context ->> 'modelInputDigest', ''),
    p_actor_id,
    p_correlation_id
  ) returning * into version_row;

  insert into private.growth_intelligence_write_operations (
    organization_id, operation_kind, idempotency_key, operation_fingerprint,
    market_profile_version_id
  ) values (
    p_organization_id, 'propose_profile', p_idempotency_key,
    operation_fingerprint, version_row.id
  );

  return pg_catalog.jsonb_build_object(
    'profileId', version_row.market_profile_id,
    'profileVersionId', version_row.id,
    'version', version_row.version,
    'profileDigest', version_row.profile_digest,
    'replayed', false
  );
end;
$$;

create function public.decide_market_profile_version(
  p_organization_id uuid,
  p_actor_id uuid,
  p_market_profile_version_id uuid,
  p_profile_digest text,
  p_decision text,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.organization_market_profiles;
  version_row public.organization_market_profile_versions;
  prior_version public.organization_market_profile_versions;
  decision_row public.organization_market_profile_decisions;
  operation private.growth_intelligence_write_operations;
  request_result jsonb;
  request_id uuid;
  request_reason text;
  request_fingerprint text;
  operation_fingerprint text;
begin
  if (select auth.uid()) is distinct from p_actor_id
    or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage') then
    raise exception 'market_profile_decision_forbidden' using errcode = '42501';
  end if;
  if p_decision not in ('confirmed', 'rejected', 'disabled')
    or p_profile_digest !~ '^[a-f0-9]{64}$'
    or pg_catalog.char_length(p_idempotency_key) not between 16 and 200
    or (p_reason is not null and pg_catalog.char_length(p_reason) not between 1 and 500)
    or p_correlation_id is null then
    raise exception 'market_profile_decision_invalid' using errcode = '22023';
  end if;

  operation_fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.concat_ws('|', p_market_profile_version_id, p_profile_digest, p_decision, p_reason),
    'sha256'
  ), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'decide_profile', p_organization_id, p_idempotency_key
    ),
    0
  ));
  select stored.* into operation
  from private.growth_intelligence_write_operations stored
  where stored.organization_id = p_organization_id
    and stored.operation_kind = 'decide_profile'
    and stored.idempotency_key = p_idempotency_key
  for update;
  if found then
    if operation.operation_fingerprint is distinct from operation_fingerprint then
      raise exception 'market_profile_decision_idempotency_conflict' using errcode = '23505';
    end if;
    select stored.* into decision_row
    from public.organization_market_profile_decisions stored
    where stored.organization_id = p_organization_id
      and stored.id = operation.market_profile_decision_id;
    return pg_catalog.jsonb_build_object(
      'decisionId', decision_row.id,
      'profileVersionId', decision_row.market_profile_version_id,
      'requestId', operation.request_id,
      'decision', decision_row.decision,
      'replayed', true
    );
  end if;

  select stored.* into version_row
  from public.organization_market_profile_versions stored
  where stored.organization_id = p_organization_id
    and stored.id = p_market_profile_version_id
  for update;
  if not found or version_row.profile_digest is distinct from p_profile_digest then
    raise exception 'market_profile_version_not_found' using errcode = '42501';
  end if;
  select stored.* into profile
  from public.organization_market_profiles stored
  where stored.organization_id = p_organization_id
    and stored.id = version_row.market_profile_id
  for update;
  if not found then
    raise exception 'market_profile_version_not_found' using errcode = '42501';
  end if;
  if p_decision = 'confirmed'
    and profile.current_version_id = version_row.id
    and not profile.enabled then
    raise exception 'market_profile_version_not_decidable' using errcode = '23514';
  end if;

  if p_decision = 'confirmed' and profile.current_version_id = version_row.id and profile.enabled then
    select stored.* into decision_row
    from public.organization_market_profile_decisions stored
    where stored.organization_id = p_organization_id
      and stored.market_profile_version_id = version_row.id
      and stored.decision = 'confirmed'
    order by stored.created_at, stored.id
    limit 1;
    select request.id into request_id
    from public.growth_intelligence_requests request
    where request.organization_id = p_organization_id
      and request.market_profile_version_id = version_row.id
      and request.trigger_reason in ('profile_confirmed', 'profile_revised')
    order by request.created_at, request.id
    limit 1;
  elsif p_decision = 'rejected' and exists (
    select 1 from public.organization_market_profile_decisions stored
    where stored.organization_id = p_organization_id
      and stored.market_profile_version_id = version_row.id
      and stored.decision = 'rejected'
  ) then
    select stored.* into decision_row
    from public.organization_market_profile_decisions stored
    where stored.organization_id = p_organization_id
      and stored.market_profile_version_id = version_row.id
      and stored.decision = 'rejected'
    order by stored.created_at, stored.id
    limit 1;
  elsif p_decision = 'disabled' and profile.current_version_id = version_row.id and not profile.enabled then
    select stored.* into decision_row
    from public.organization_market_profile_decisions stored
    where stored.organization_id = p_organization_id
      and stored.market_profile_version_id = version_row.id
      and stored.decision = 'disabled'
    order by stored.created_at desc, stored.id desc
    limit 1;
  end if;

  if decision_row.id is not null then
    insert into private.growth_intelligence_write_operations (
      organization_id, operation_kind, idempotency_key, operation_fingerprint,
      market_profile_version_id, market_profile_decision_id, request_id
    ) values (
      p_organization_id, 'decide_profile', p_idempotency_key,
      operation_fingerprint, version_row.id, decision_row.id, request_id
    );
    return pg_catalog.jsonb_build_object(
      'decisionId', decision_row.id,
      'profileVersionId', decision_row.market_profile_version_id,
      'requestId', request_id,
      'decision', decision_row.decision,
      'replayed', true
    );
  end if;

  if p_decision = 'rejected' then
    if profile.current_version_id = version_row.id or exists (
      select 1 from public.organization_market_profile_decisions stored
      where stored.organization_id = p_organization_id
        and stored.market_profile_version_id = version_row.id
        and stored.decision in ('confirmed', 'superseded')
    ) then
      raise exception 'market_profile_version_not_decidable' using errcode = '23514';
    end if;
    insert into public.organization_market_profile_decisions (
      organization_id, market_profile_id, market_profile_version_id, decision,
      profile_digest, reason, decided_by, correlation_id
    ) values (
      p_organization_id, profile.id, version_row.id, 'rejected',
      version_row.profile_digest, p_reason, p_actor_id, p_correlation_id
    ) returning * into decision_row;
  elsif p_decision = 'disabled' then
    if profile.current_version_id is distinct from version_row.id or not profile.enabled then
      raise exception 'market_profile_version_not_decidable' using errcode = '23514';
    end if;
    insert into public.organization_market_profile_decisions (
      organization_id, market_profile_id, market_profile_version_id, decision,
      profile_digest, reason, decided_by, correlation_id
    ) values (
      p_organization_id, profile.id, version_row.id, 'disabled',
      version_row.profile_digest, p_reason, p_actor_id, p_correlation_id
    ) returning * into decision_row;
    update public.organization_market_profiles
    set enabled = false
    where organization_id = p_organization_id and id = profile.id;
    update public.growth_intelligence_requests
    set status = 'cancelled', claim_token = null, lease_expires_at = null,
        cancelled_at = pg_catalog.now(), cancel_reason = 'Market Profile disabled.',
        last_transition_actor_type = 'user', last_transition_actor_id = p_actor_id,
        correlation_id = p_correlation_id
    where organization_id = p_organization_id
      and market_profile_version_id in (
        select stored.id from public.organization_market_profile_versions stored
        where stored.organization_id = p_organization_id
          and stored.market_profile_id = profile.id
      )
      and status in ('pending', 'claimed');
  else
    if exists (
      select 1 from public.organization_market_profile_decisions stored
      where stored.organization_id = p_organization_id
        and stored.market_profile_version_id = version_row.id
        and stored.decision = 'rejected'
    ) then
      raise exception 'market_profile_version_not_decidable' using errcode = '23514';
    end if;
    request_reason := case when profile.current_version_id is null
      then 'profile_confirmed' else 'profile_revised' end;
    if profile.current_version_id is not null then
      select stored.* into prior_version
      from public.organization_market_profile_versions stored
      where stored.organization_id = p_organization_id
        and stored.id = profile.current_version_id;
      insert into public.organization_market_profile_decisions (
        organization_id, market_profile_id, market_profile_version_id, decision,
        profile_digest, superseded_by_version_id, reason, decided_by, correlation_id
      ) values (
        p_organization_id, profile.id, prior_version.id, 'superseded',
        prior_version.profile_digest, version_row.id,
        'Replaced by a confirmed Market Profile version.', p_actor_id, p_correlation_id
      );
      update public.growth_intelligence_requests
      set status = 'cancelled', claim_token = null, lease_expires_at = null,
          cancelled_at = pg_catalog.now(), cancel_reason = 'Market Profile superseded.',
          last_transition_actor_type = 'user', last_transition_actor_id = p_actor_id,
          correlation_id = p_correlation_id
      where organization_id = p_organization_id
        and market_profile_version_id = prior_version.id
        and status in ('pending', 'claimed');
    end if;
    insert into public.organization_market_profile_decisions (
      organization_id, market_profile_id, market_profile_version_id, decision,
      profile_digest, reason, decided_by, correlation_id
    ) values (
      p_organization_id, profile.id, version_row.id, 'confirmed',
      version_row.profile_digest, p_reason, p_actor_id, p_correlation_id
    ) returning * into decision_row;
    update public.organization_market_profiles
    set current_version_id = version_row.id, enabled = true
    where organization_id = p_organization_id and id = profile.id;

    request_fingerprint := private.create_growth_intelligence_request_fingerprint(
      p_organization_id, null, null, 'market_research', request_reason, null,
      version_row.id, version_row.source_policy_digest, 'market-research@1',
      'immediate', null, null
    );
    request_result := public.enqueue_growth_intelligence_request(
      p_organization_id,
      pg_catalog.jsonb_build_object(
        'organizationId', p_organization_id,
        'branchId', null,
        'channelId', null,
        'kind', 'market_research',
        'triggerReason', request_reason,
        'businessEvidenceDigest', null,
        'marketProfileVersionId', version_row.id,
        'sourcePolicyDigest', version_row.source_policy_digest,
        'researchRuleVersion', 'market-research@1',
        'localTimeBucket', 'immediate',
        'synthesisVersionTuple', null,
        'playbookVersionTuple', null,
        'requestFingerprint', request_fingerprint,
        'dueAt', pg_catalog.now(),
        'correlationId', p_correlation_id,
        'requestedBy', p_actor_id
      )
    );
    request_id := (request_result ->> 'requestId')::uuid;
  end if;

  insert into private.growth_intelligence_write_operations (
    organization_id, operation_kind, idempotency_key, operation_fingerprint,
    market_profile_version_id, market_profile_decision_id, request_id
  ) values (
    p_organization_id, 'decide_profile', p_idempotency_key,
    operation_fingerprint, version_row.id, decision_row.id, request_id
  );

  return pg_catalog.jsonb_build_object(
    'decisionId', decision_row.id,
    'profileVersionId', decision_row.market_profile_version_id,
    'requestId', request_id,
    'decision', decision_row.decision,
    'replayed', false
  );
end;
$$;

-- Operator retry and cancellation -----------------------------------------

create function public.retry_growth_intelligence_request(
  p_organization_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
  operation private.growth_intelligence_write_operations;
  operation_fingerprint text;
begin
  if (select auth.uid()) is distinct from p_actor_id
    or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage') then
    raise exception 'growth_intelligence_retry_forbidden' using errcode = '42501';
  end if;
  if pg_catalog.char_length(p_idempotency_key) not between 16 and 200
    or p_correlation_id is null then
    raise exception 'growth_intelligence_retry_invalid' using errcode = '22023';
  end if;
  operation_fingerprint := pg_catalog.encode(extensions.digest(p_request_id::text, 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'retry_request', p_organization_id, p_idempotency_key
    ),
    0
  ));
  select stored.* into operation
  from private.growth_intelligence_write_operations stored
  where stored.organization_id = p_organization_id
    and stored.operation_kind = 'retry_request'
    and stored.idempotency_key = p_idempotency_key
  for update;
  if found then
    if operation.operation_fingerprint is distinct from operation_fingerprint
      or operation.request_id is distinct from p_request_id then
      raise exception 'growth_intelligence_retry_idempotency_conflict' using errcode = '23505';
    end if;
    select stored.* into request_row
    from public.growth_intelligence_requests stored
    where stored.organization_id = p_organization_id and stored.id = operation.request_id;
    return pg_catalog.jsonb_build_object(
      'requestId', request_row.id, 'status', request_row.status,
      'outcome', 'retried', 'replayed', true
    );
  end if;

  select stored.* into request_row
  from public.growth_intelligence_requests stored
  where stored.organization_id = p_organization_id and stored.id = p_request_id
  for update;
  if not found then
    raise exception 'growth_intelligence_request_not_found' using errcode = '42501';
  end if;
  if request_row.status <> 'failed' or request_row.attempt_count >= request_row.max_attempts then
    raise exception 'growth_intelligence_request_not_retryable' using errcode = '23514';
  end if;

  update public.growth_intelligence_requests
  set status = 'pending', due_at = pg_catalog.now(), safe_failure_code = null,
      failed_at = null, claim_token = null, lease_expires_at = null,
      last_dispatch_attempt_at = null,
      last_transition_actor_type = 'user', last_transition_actor_id = p_actor_id,
      correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = p_request_id
  returning * into request_row;

  insert into private.growth_intelligence_write_operations (
    organization_id, operation_kind, idempotency_key, operation_fingerprint, request_id
  ) values (
    p_organization_id, 'retry_request', p_idempotency_key, operation_fingerprint, p_request_id
  );

  return pg_catalog.jsonb_build_object(
    'requestId', request_row.id, 'status', request_row.status,
    'outcome', 'retried', 'replayed', false
  );
end;
$$;

create function public.cancel_growth_intelligence_request(
  p_organization_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
  operation private.growth_intelligence_write_operations;
  operation_fingerprint text;
begin
  if (select auth.uid()) is distinct from p_actor_id
    or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage') then
    raise exception 'growth_intelligence_cancel_forbidden' using errcode = '42501';
  end if;
  if pg_catalog.char_length(p_idempotency_key) not between 16 and 200
    or pg_catalog.char_length(p_reason) not between 1 and 500
    or p_correlation_id is null then
    raise exception 'growth_intelligence_cancel_invalid' using errcode = '22023';
  end if;
  operation_fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.concat_ws('|', p_request_id, p_reason), 'sha256'
  ), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'cancel_request', p_organization_id, p_idempotency_key
    ),
    0
  ));
  select stored.* into operation
  from private.growth_intelligence_write_operations stored
  where stored.organization_id = p_organization_id
    and stored.operation_kind = 'cancel_request'
    and stored.idempotency_key = p_idempotency_key
  for update;
  if found then
    if operation.operation_fingerprint is distinct from operation_fingerprint
      or operation.request_id is distinct from p_request_id then
      raise exception 'growth_intelligence_cancel_idempotency_conflict' using errcode = '23505';
    end if;
    select stored.* into request_row
    from public.growth_intelligence_requests stored
    where stored.organization_id = p_organization_id and stored.id = operation.request_id;
    return pg_catalog.jsonb_build_object(
      'requestId', request_row.id, 'status', request_row.status,
      'outcome', 'cancelled', 'replayed', true
    );
  end if;

  select stored.* into request_row
  from public.growth_intelligence_requests stored
  where stored.organization_id = p_organization_id and stored.id = p_request_id
  for update;
  if not found then
    raise exception 'growth_intelligence_request_not_found' using errcode = '42501';
  end if;
  if request_row.status in ('succeeded', 'failed', 'cancelled') then
    return pg_catalog.jsonb_build_object(
      'requestId', request_row.id, 'status', request_row.status,
      'outcome', 'already_finished', 'replayed', false
    );
  end if;

  update public.growth_intelligence_requests
  set status = 'cancelled', claim_token = null, lease_expires_at = null,
      cancelled_at = pg_catalog.now(), cancel_reason = p_reason,
      last_transition_actor_type = 'user', last_transition_actor_id = p_actor_id,
      correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = p_request_id
  returning * into request_row;

  insert into private.growth_intelligence_write_operations (
    organization_id, operation_kind, idempotency_key, operation_fingerprint, request_id
  ) values (
    p_organization_id, 'cancel_request', p_idempotency_key, operation_fingerprint, p_request_id
  );

  return pg_catalog.jsonb_build_object(
    'requestId', request_row.id, 'status', request_row.status,
    'outcome', 'cancelled', 'replayed', false
  );
end;
$$;

-- Worker-only claims, fenced completion, and due recovery ------------------

create function public.claim_growth_intelligence_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
begin
  if p_organization_id is null or p_request_id is null or p_claim_token is null
    or p_lease_seconds is null or p_lease_seconds not between 30 and 1800 then
    raise exception 'growth_intelligence_claim_invalid' using errcode = '22023';
  end if;
  select stored.* into request_row
  from public.growth_intelligence_requests stored
  where stored.organization_id = p_organization_id and stored.id = p_request_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;
  if request_row.status in ('succeeded', 'failed', 'cancelled') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'already_finished', 'requestId', request_row.id,
      'status', request_row.status
    );
  end if;
  if request_row.status = 'pending' and request_row.due_at > pg_catalog.now() then
    return pg_catalog.jsonb_build_object(
      'outcome', 'not_due', 'requestId', request_row.id
    );
  end if;
  if request_row.status = 'claimed' and request_row.lease_expires_at > pg_catalog.now() then
    if request_row.claim_token = p_claim_token then
      return pg_catalog.jsonb_build_object(
        'outcome', 'acquired', 'requestId', request_row.id,
        'organizationId', request_row.organization_id, 'kind', request_row.kind,
        'correlationId', request_row.correlation_id,
        'claimToken', request_row.claim_token, 'attempt', request_row.attempt_count,
        'replayed', true
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'outcome', 'in_progress', 'requestId', request_row.id
    );
  end if;
  if request_row.attempt_count >= request_row.max_attempts then
    update public.growth_intelligence_requests
    set status = 'failed', claim_token = null, lease_expires_at = null,
        safe_failure_code = 'ATTEMPTS_EXHAUSTED', failed_at = pg_catalog.now(),
        last_transition_actor_type = 'system', last_transition_actor_id = null
    where organization_id = p_organization_id and id = p_request_id;
    return pg_catalog.jsonb_build_object(
      'outcome', 'attempts_exhausted', 'requestId', request_row.id
    );
  end if;

  update public.growth_intelligence_requests
  set status = 'claimed', claim_token = p_claim_token,
      lease_expires_at = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds),
      attempt_count = attempt_count + 1,
      safe_failure_code = null, failed_at = null,
      last_transition_actor_type = 'system', last_transition_actor_id = null
  where organization_id = p_organization_id and id = p_request_id
  returning * into request_row;

  return pg_catalog.jsonb_build_object(
    'outcome', 'acquired', 'requestId', request_row.id,
    'organizationId', request_row.organization_id, 'kind', request_row.kind,
    'correlationId', request_row.correlation_id,
    'claimToken', request_row.claim_token, 'attempt', request_row.attempt_count,
    'replayed', false
  );
end;
$$;

create function public.complete_growth_intelligence_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
begin
  select stored.* into request_row
  from public.growth_intelligence_requests stored
  where stored.organization_id = p_organization_id and stored.id = p_request_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;
  if request_row.status in ('succeeded', 'failed', 'cancelled') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'already_finished', 'requestId', request_row.id,
      'status', request_row.status
    );
  end if;
  if request_row.status <> 'claimed'
    or request_row.claim_token is distinct from p_claim_token
    or request_row.lease_expires_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('outcome', 'claim_lost', 'requestId', request_row.id);
  end if;
  update public.growth_intelligence_requests
  set status = 'succeeded', claim_token = null, lease_expires_at = null,
      completed_at = pg_catalog.now(),
      last_transition_actor_type = 'system', last_transition_actor_id = null
  where organization_id = p_organization_id and id = p_request_id
  returning * into request_row;
  return pg_catalog.jsonb_build_object(
    'outcome', 'completed', 'requestId', request_row.id, 'status', request_row.status
  );
end;
$$;

create function public.fail_growth_intelligence_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_safe_failure_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
begin
  if p_safe_failure_code is null
    or p_safe_failure_code !~ '^[A-Z][A-Z0-9_]{2,80}$' then
    raise exception 'growth_intelligence_failure_code_invalid' using errcode = '22023';
  end if;
  select stored.* into request_row
  from public.growth_intelligence_requests stored
  where stored.organization_id = p_organization_id and stored.id = p_request_id
  for update;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;
  if request_row.status in ('succeeded', 'failed', 'cancelled') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'already_finished', 'requestId', request_row.id,
      'status', request_row.status
    );
  end if;
  if request_row.status <> 'claimed'
    or request_row.claim_token is distinct from p_claim_token
    or request_row.lease_expires_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('outcome', 'claim_lost', 'requestId', request_row.id);
  end if;
  update public.growth_intelligence_requests
  set status = 'failed', claim_token = null, lease_expires_at = null,
      safe_failure_code = p_safe_failure_code, failed_at = pg_catalog.now(),
      last_transition_actor_type = 'system', last_transition_actor_id = null
  where organization_id = p_organization_id and id = p_request_id
  returning * into request_row;
  return pg_catalog.jsonb_build_object(
    'outcome', 'failed', 'requestId', request_row.id, 'status', request_row.status
  );
end;
$$;

create function public.claim_due_growth_intelligence_requests(
  p_limit integer,
  p_dispatch_cooldown_seconds integer
)
returns table (
  "organizationId" uuid,
  "requestId" uuid,
  kind text,
  "correlationId" uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 100
    or p_dispatch_cooldown_seconds is null
    or p_dispatch_cooldown_seconds not between 0 and 3600 then
    raise exception 'growth_intelligence_due_claim_invalid' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select request.organization_id, request.id
    from public.growth_intelligence_requests request
    where request.due_at <= pg_catalog.now()
      and (
        request.status = 'pending'
        or (request.status = 'claimed' and request.lease_expires_at <= pg_catalog.now())
      )
      and (
        request.last_dispatch_attempt_at is null
        or request.last_dispatch_attempt_at <= pg_catalog.now()
          - pg_catalog.make_interval(secs => p_dispatch_cooldown_seconds)
      )
    order by request.due_at, request.organization_id, request.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.growth_intelligence_requests request
    set dispatch_attempt_count = request.dispatch_attempt_count + 1,
        last_dispatch_attempt_at = pg_catalog.now(),
        last_transition_actor_type = 'system', last_transition_actor_id = null
    from candidates
    where request.organization_id = candidates.organization_id
      and request.id = candidates.id
    returning request.organization_id, request.id, request.kind, request.correlation_id
  )
  select claimed.organization_id, claimed.id, claimed.kind, claimed.correlation_id
  from claimed;
end;
$$;

-- Exact execution privileges ------------------------------------------------

revoke all on function private.jsonb_object_has_exact_keys(jsonb, text[]) from public, anon, authenticated, service_role;
revoke all on function private.canonical_json_text(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.create_market_profile_digest(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.create_growth_intelligence_request_fingerprint(uuid, uuid, uuid, text, text, text, uuid, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function private.assert_market_profile_document_v1(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.reject_growth_intelligence_append_only_mutation() from public, anon, authenticated, service_role;
revoke all on function private.prevent_market_profile_identity_mutation() from public, anon, authenticated, service_role;
revoke all on function private.enforce_growth_intelligence_request_mutation() from public, anon, authenticated, service_role;
revoke all on function private.audit_market_profile_version() from public, anon, authenticated, service_role;
revoke all on function private.audit_market_profile_decision() from public, anon, authenticated, service_role;
revoke all on function private.audit_growth_intelligence_request() from public, anon, authenticated, service_role;

revoke all on function public.propose_market_profile_version(uuid, uuid, jsonb, text, jsonb, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.decide_market_profile_version(uuid, uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.enqueue_growth_intelligence_request(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.retry_growth_intelligence_request(uuid, uuid, uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.cancel_growth_intelligence_request(uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.claim_growth_intelligence_request(uuid, uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.complete_growth_intelligence_request(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.fail_growth_intelligence_request(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.claim_due_growth_intelligence_requests(integer, integer) from public, anon, authenticated, service_role;

grant execute on function public.propose_market_profile_version(uuid, uuid, jsonb, text, jsonb, text, uuid) to authenticated, service_role;
grant execute on function public.decide_market_profile_version(uuid, uuid, uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.retry_growth_intelligence_request(uuid, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.cancel_growth_intelligence_request(uuid, uuid, uuid, text, text, uuid) to authenticated;

grant execute on function public.enqueue_growth_intelligence_request(uuid, jsonb) to service_role;
grant execute on function public.claim_growth_intelligence_request(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.complete_growth_intelligence_request(uuid, uuid, uuid) to service_role;
grant execute on function public.fail_growth_intelligence_request(uuid, uuid, uuid, text) to service_role;
grant execute on function public.claim_due_growth_intelligence_requests(integer, integer) to service_role;
