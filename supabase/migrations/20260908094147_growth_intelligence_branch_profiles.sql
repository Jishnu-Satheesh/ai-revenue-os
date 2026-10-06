-- Task 3: independent branch profiles and pipeline/request lineage.
--
-- Profiles gain a nullable branch scope. Null means legacy organization scope;
-- a set branch owns independent versions and cadence. Two partial unique
-- indexes replace the old organization singleton: one null-scope row and one
-- row per branch within an organization. The v1 document validator is frozen;
-- a v2 validator sits beside it for branch documents (Task 4 wires the
-- branch start RPC that calls it).
--
-- growth_intelligence_research_pipelines is the lifecycle envelope over the
-- existing leased requests. Pipeline/request references are deferred
-- composite foreign keys in both directions so the Task 4 start operation can
-- insert the pipeline and its root request in one transaction, in either
-- order. Later tasks extend this envelope with their own forward migrations
-- (start RPC, budget/retention, completion, synthesis checks).

-- Branch scope on profiles --------------------------------------------------

alter table public.organization_market_profiles
  add column branch_id uuid;

alter table public.organization_market_profiles
  add constraint organization_market_profiles_branch_fk
  foreign key (organization_id, branch_id)
  references public.branches(organization_id, id)
  on delete restrict;

-- The old organization singleton cannot survive a second scoped row, so it
-- is replaced by two partial indexes: exactly one legacy null-scope profile
-- and exactly one profile per branch within an organization.
alter table public.organization_market_profiles
  drop constraint organization_market_profiles_organization_id_key;

create unique index organization_market_profiles_legacy_scope_key
  on public.organization_market_profiles (organization_id)
  where branch_id is null;

create unique index organization_market_profiles_branch_scope_key
  on public.organization_market_profiles (organization_id, branch_id)
  where branch_id is not null;

comment on column public.organization_market_profiles.branch_id is
  'Null means legacy organization scope. A set branch owns independent versions and cadence.';

-- Branch documents are a second generation alongside v1, never a rewrite.
alter table public.organization_market_profile_versions
  drop constraint organization_market_profile_versions_schema_version_check;

alter table public.organization_market_profile_versions
  add constraint organization_market_profile_versions_schema_version_check
  check (schema_version in (1, 2));

-- Pipeline coverage manifest ------------------------------------------------

create function private.assert_research_pipeline_coverage(
  p_coverage jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  coverage_entry jsonb;
  coverage_expected_keys text[];
  coverage_attempt_id text;
  coverage_claim_id text;
begin
  -- At most one entry per deterministic query slot: the local-market query,
  -- one per topic (20) and one per competitor (5).
  if pg_catalog.jsonb_typeof(p_coverage) <> 'array'
    or pg_catalog.jsonb_array_length(p_coverage) > 26 then
    raise exception 'research_pipeline_coverage_invalid' using errcode = '22023';
  end if;

  for coverage_entry in
    select value from pg_catalog.jsonb_array_elements(p_coverage)
  loop
    coverage_expected_keys := case
      when (coverage_entry ? 'attemptIds') and (coverage_entry ? 'acceptedClaimIds')
        then array['slotKey', 'kind', 'outcome', 'attemptIds', 'acceptedClaimIds']::text[]
      when (coverage_entry ? 'attemptIds')
        then array['slotKey', 'kind', 'outcome', 'attemptIds']::text[]
      when (coverage_entry ? 'acceptedClaimIds')
        then array['slotKey', 'kind', 'outcome', 'acceptedClaimIds']::text[]
      else array['slotKey', 'kind', 'outcome']::text[]
    end;
    if pg_catalog.jsonb_typeof(coverage_entry) <> 'object'
      or not private.jsonb_object_has_exact_keys(coverage_entry, coverage_expected_keys)
      or pg_catalog.char_length(coalesce(coverage_entry ->> 'slotKey', '')) not between 1 and 160
      or coverage_entry ->> 'kind' not in ('local_market', 'topic', 'competitor')
      or coverage_entry ->> 'outcome' not in (
        'not_started', 'searched_no_usable_evidence', 'supported',
        'failed', 'skipped_budget', 'skipped_policy'
      ) then
      raise exception 'research_pipeline_coverage_invalid' using errcode = '22023';
    end if;

    if coverage_entry ? 'attemptIds' then
      if pg_catalog.jsonb_typeof(coverage_entry -> 'attemptIds') <> 'array'
        or pg_catalog.jsonb_array_length(coverage_entry -> 'attemptIds') > 28 then
        raise exception 'research_pipeline_coverage_attempts_invalid' using errcode = '22023';
      end if;
      for coverage_attempt_id in
        select value from pg_catalog.jsonb_array_elements_text(coverage_entry -> 'attemptIds')
      loop
        if coverage_attempt_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
          raise exception 'research_pipeline_coverage_attempts_invalid' using errcode = '22023';
        end if;
      end loop;
    end if;

    if coverage_entry ? 'acceptedClaimIds' then
      if pg_catalog.jsonb_typeof(coverage_entry -> 'acceptedClaimIds') <> 'array' then
        raise exception 'research_pipeline_coverage_claims_invalid' using errcode = '22023';
      end if;
      for coverage_claim_id in
        select value from pg_catalog.jsonb_array_elements_text(coverage_entry -> 'acceptedClaimIds')
      loop
        if coverage_claim_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
          raise exception 'research_pipeline_coverage_claims_invalid' using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;
end;
$$;

revoke all on function private.assert_research_pipeline_coverage(jsonb)
  from public, anon, authenticated, service_role;

-- Branch document (v2) validator --------------------------------------------
--
-- Mirrors the Task 2 MarketProfileDocumentV2 contract beside the frozen v1
-- validator, which this migration does not touch: schemaVersion 2, a
-- top-level branch binding, exactly one trade area/city/country, at most
-- five competitors with operator_lead/cited provenance, and at most twenty
-- topics. Shared public-identity, source-policy and cadence blocks enforce
-- the same normalization the v1 validator requires, so digests stay stable.

create function private.assert_market_profile_document_v2(
  p_organization_id uuid,
  p_branch_id uuid,
  p_document jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v2_identity jsonb;
  v2_policy jsonb;
  v2_cadence jsonb;
  v2_geography jsonb;
  v2_competitor jsonb;
  v2_topic jsonb;
  v2_expected_keys text[];
  v2_item text;
begin
  if not private.jsonb_object_has_exact_keys(
    p_document,
    array[
      'schemaVersion', 'branchId', 'publicIdentity', 'nicheDescriptors', 'geographies',
      'competitors', 'topics', 'sourcePolicy', 'cadence'
    ]::text[]
  )
  or p_document ->> 'schemaVersion' <> '2'
  or coalesce(p_document ->> 'branchId', '') !~ '^[0-9a-fA-F-]{36}$'
  or (p_document ->> 'branchId')::uuid is distinct from p_branch_id then
    raise exception 'market_profile_document_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.branches branch
    where branch.organization_id = p_organization_id
      and branch.id = p_branch_id
  ) then
    raise exception 'market_profile_branch_not_found' using errcode = '42501';
  end if;

  v2_identity := p_document -> 'publicIdentity';
  if not private.jsonb_object_has_exact_keys(
    v2_identity,
    array['approvedName', 'domains', 'publicUrls']::text[]
  )
  or pg_catalog.char_length(coalesce(v2_identity ->> 'approvedName', '')) not between 1 and 200
  or v2_identity ->> 'approvedName' is distinct from pg_catalog.btrim(v2_identity ->> 'approvedName')
  or pg_catalog.jsonb_typeof(v2_identity -> 'domains') <> 'array'
  or pg_catalog.jsonb_array_length(v2_identity -> 'domains') > 10
  or pg_catalog.jsonb_typeof(v2_identity -> 'publicUrls') <> 'array'
  or pg_catalog.jsonb_array_length(v2_identity -> 'publicUrls') > 20 then
    raise exception 'market_profile_public_identity_invalid' using errcode = '22023';
  end if;

  for v2_item in select value from pg_catalog.jsonb_array_elements_text(v2_identity -> 'domains') loop
    if pg_catalog.char_length(v2_item) not between 1 and 254
      or v2_item <> pg_catalog.lower(v2_item)
      or v2_item !~ '^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)([.]([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?))+$' then
      raise exception 'market_profile_domain_invalid' using errcode = '22023';
    end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(v2_identity -> 'domains'))
    <> (select pg_catalog.count(distinct value) from pg_catalog.jsonb_array_elements_text(v2_identity -> 'domains'))
    or coalesce(
      (select pg_catalog.jsonb_agg(value order by value collate "C") from pg_catalog.jsonb_array_elements_text(v2_identity -> 'domains')),
      '[]'::jsonb
    ) is distinct from v2_identity -> 'domains' then
    raise exception 'market_profile_domains_not_normalized' using errcode = '22023';
  end if;

  for v2_item in select value from pg_catalog.jsonb_array_elements_text(v2_identity -> 'publicUrls') loop
    if pg_catalog.char_length(v2_item) not between 1 and 2048
      or v2_item !~ '^https?://[^/@]+(?:/|$)'
      or v2_item ~ '^https?://[^/]*@'
      or v2_item like '%#%' then
      raise exception 'market_profile_public_url_invalid' using errcode = '22023';
    end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(v2_identity -> 'publicUrls'))
    <> (select pg_catalog.count(distinct value) from pg_catalog.jsonb_array_elements_text(v2_identity -> 'publicUrls'))
    or coalesce(
      (select pg_catalog.jsonb_agg(value order by value collate "C") from pg_catalog.jsonb_array_elements_text(v2_identity -> 'publicUrls')),
      '[]'::jsonb
    ) is distinct from v2_identity -> 'publicUrls' then
    raise exception 'market_profile_public_urls_not_normalized' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_document -> 'nicheDescriptors') <> 'array'
    or pg_catalog.jsonb_array_length(p_document -> 'nicheDescriptors') not between 1 and 12 then
    raise exception 'market_profile_niche_invalid' using errcode = '22023';
  end if;
  for v2_item in select value from pg_catalog.jsonb_array_elements_text(p_document -> 'nicheDescriptors') loop
    if pg_catalog.char_length(v2_item) not between 1 and 120 or v2_item <> pg_catalog.btrim(v2_item) then
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
    or pg_catalog.jsonb_array_length(p_document -> 'geographies') <> 3 then
    raise exception 'market_profile_geography_invalid' using errcode = '22023';
  end if;
  for v2_geography in select value from pg_catalog.jsonb_array_elements(p_document -> 'geographies') loop
    if v2_geography ->> 'layer' = 'trade_area' then
      if not private.jsonb_object_has_exact_keys(
        v2_geography,
        case when v2_geography ? 'radiusKm'
          then array['layer', 'locationRef', 'name', 'branchId', 'radiusKm']::text[]
          else array['layer', 'locationRef', 'name', 'branchId']::text[] end
      )
      or coalesce(v2_geography ->> 'locationRef', '') !~ '^[a-z0-9][a-z0-9:._-]+$'
      or pg_catalog.char_length(coalesce(v2_geography ->> 'name', '')) not between 1 and 160
      or coalesce(v2_geography ->> 'branchId', '') !~ '^[0-9a-fA-F-]{36}$'
      or (v2_geography ->> 'branchId')::uuid is distinct from p_branch_id
      or (v2_geography ? 'radiusKm' and (
        pg_catalog.jsonb_typeof(v2_geography -> 'radiusKm') <> 'number'
        or (v2_geography ->> 'radiusKm')::numeric <= 0
        or (v2_geography ->> 'radiusKm')::numeric > 500
      )) then
        raise exception 'market_profile_trade_area_invalid' using errcode = '22023';
      end if;
    elsif v2_geography ->> 'layer' in ('city', 'country') then
      if not private.jsonb_object_has_exact_keys(
        v2_geography,
        array['layer', 'locationRef', 'name', 'countryCode']::text[]
      )
      or coalesce(v2_geography ->> 'locationRef', '') !~ '^[a-z0-9][a-z0-9:._-]+$'
      or pg_catalog.char_length(coalesce(v2_geography ->> 'name', '')) not between 1 and 160
      or coalesce(v2_geography ->> 'countryCode', '') !~ '^[A-Z]{2}$' then
        raise exception 'market_profile_geography_invalid' using errcode = '22023';
      end if;
    else
      raise exception 'market_profile_geography_invalid' using errcode = '22023';
    end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_document -> 'geographies') value
      where value ->> 'layer' = 'trade_area') <> 1
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_document -> 'geographies') value
      where value ->> 'layer' = 'city') <> 1
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_document -> 'geographies') value
      where value ->> 'layer' = 'country') <> 1
    or (
      select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_document -> 'geographies') value
    ) <> (
      select pg_catalog.count(distinct (value ->> 'layer') || ':' || (value ->> 'locationRef'))
      from pg_catalog.jsonb_array_elements(p_document -> 'geographies') value
    ) or (
      select pg_catalog.jsonb_agg(value order by (value ->> 'layer') || ':' || (value ->> 'locationRef') collate "C")
      from pg_catalog.jsonb_array_elements(p_document -> 'geographies') value
    ) is distinct from p_document -> 'geographies' then
    raise exception 'market_profile_geography_not_normalized' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_document -> 'competitors') <> 'array'
    or pg_catalog.jsonb_array_length(p_document -> 'competitors') > 5 then
    raise exception 'market_profile_competitors_invalid' using errcode = '22023';
  end if;
  for v2_competitor in select value from pg_catalog.jsonb_array_elements(p_document -> 'competitors') loop
    v2_expected_keys :=
      array['key', 'name', 'geographyRefs', 'provenance', 'suggestedBy', 'relevanceEvidenceUrls']::text[];
    if v2_competitor ? 'publicUrl' then
      v2_expected_keys := v2_expected_keys || 'publicUrl'::text;
    end if;
    if v2_competitor ? 'locationHint' then
      v2_expected_keys := v2_expected_keys || 'locationHint'::text;
    end if;
    if v2_competitor ? 'relevanceReason' then
      v2_expected_keys := v2_expected_keys || 'relevanceReason'::text;
    end if;
    if not private.jsonb_object_has_exact_keys(v2_competitor, v2_expected_keys)
    or coalesce(v2_competitor ->> 'key', '') !~ '^[a-z][a-z0-9_.-]{1,119}$'
    or pg_catalog.char_length(coalesce(v2_competitor ->> 'name', '')) not between 1 and 160
    or pg_catalog.jsonb_typeof(v2_competitor -> 'geographyRefs') <> 'array'
    or pg_catalog.jsonb_array_length(v2_competitor -> 'geographyRefs') > 20
    or v2_competitor ->> 'provenance' not in ('operator_lead', 'cited')
    or v2_competitor ->> 'suggestedBy' not in ('operator', 'ai')
    or pg_catalog.jsonb_typeof(v2_competitor -> 'relevanceEvidenceUrls') <> 'array'
    or pg_catalog.jsonb_array_length(v2_competitor -> 'relevanceEvidenceUrls') > 10
    or (v2_competitor ? 'publicUrl' and (
      pg_catalog.char_length(v2_competitor ->> 'publicUrl') not between 1 and 2048
      or v2_competitor ->> 'publicUrl' !~ '^https?://[^/@]+(?:/|$)'
      or v2_competitor ->> 'publicUrl' ~ '^https?://[^/]*@'
      or v2_competitor ->> 'publicUrl' like '%#%'
    ))
    or (v2_competitor ? 'locationHint' and (
      pg_catalog.char_length(v2_competitor ->> 'locationHint') not between 1 and 240
    ))
    or (v2_competitor ? 'relevanceReason' and (
      pg_catalog.char_length(v2_competitor ->> 'relevanceReason') > 600
    )) then
      raise exception 'market_profile_competitor_invalid' using errcode = '22023';
    end if;
    if (v2_competitor ->> 'provenance' = 'cited'
        and pg_catalog.jsonb_array_length(v2_competitor -> 'relevanceEvidenceUrls') = 0)
      or (v2_competitor ->> 'suggestedBy' = 'ai'
        and v2_competitor ->> 'provenance' <> 'cited') then
      raise exception 'market_profile_competitor_provenance_invalid' using errcode = '22023';
    end if;
    if exists (
      select 1 from pg_catalog.jsonb_array_elements_text(v2_competitor -> 'geographyRefs') reference
      where not exists (
        select 1 from pg_catalog.jsonb_array_elements(p_document -> 'geographies') approved
        where approved ->> 'locationRef' = reference
      )
    ) or (
      select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(v2_competitor -> 'geographyRefs')
    ) <> (
      select pg_catalog.count(distinct value) from pg_catalog.jsonb_array_elements_text(v2_competitor -> 'geographyRefs')
    ) or (
      select pg_catalog.jsonb_agg(value order by value collate "C")
      from pg_catalog.jsonb_array_elements_text(v2_competitor -> 'geographyRefs')
    ) is distinct from v2_competitor -> 'geographyRefs' then
      raise exception 'market_profile_competitor_geography_invalid' using errcode = '22023';
    end if;
    for v2_item in select value from pg_catalog.jsonb_array_elements_text(v2_competitor -> 'relevanceEvidenceUrls') loop
      if pg_catalog.char_length(v2_item) not between 1 and 2048
        or v2_item !~ '^https?://[^/@]+(?:/|$)'
        or v2_item ~ '^https?://[^/]*@'
        or v2_item like '%#%' then
        raise exception 'market_profile_competitor_evidence_invalid' using errcode = '22023';
      end if;
    end loop;
    if (
      select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(v2_competitor -> 'relevanceEvidenceUrls')
    ) <> (
      select pg_catalog.count(distinct value) from pg_catalog.jsonb_array_elements_text(v2_competitor -> 'relevanceEvidenceUrls')
    ) or (
      select pg_catalog.jsonb_agg(value order by value collate "C")
      from pg_catalog.jsonb_array_elements_text(v2_competitor -> 'relevanceEvidenceUrls')
    ) is distinct from v2_competitor -> 'relevanceEvidenceUrls' then
      raise exception 'market_profile_competitor_evidence_not_normalized' using errcode = '22023';
    end if;
  end loop;
  if (
    select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_document -> 'competitors') value
  ) <> (
    select pg_catalog.count(distinct value ->> 'key') from pg_catalog.jsonb_array_elements(p_document -> 'competitors') value
  ) or (
    select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_document -> 'competitors') value
  ) <> (
    select pg_catalog.count(distinct pg_catalog.lower(value ->> 'name')) from pg_catalog.jsonb_array_elements(p_document -> 'competitors') value
  ) or coalesce((
    select pg_catalog.jsonb_agg(value order by value ->> 'key' collate "C")
    from pg_catalog.jsonb_array_elements(p_document -> 'competitors') value
  ), '[]'::jsonb) is distinct from p_document -> 'competitors' then
    raise exception 'market_profile_competitors_not_normalized' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_document -> 'topics') <> 'array'
    or pg_catalog.jsonb_array_length(p_document -> 'topics') not between 1 and 20 then
    raise exception 'market_profile_topics_invalid' using errcode = '22023';
  end if;
  for v2_topic in select value from pg_catalog.jsonb_array_elements(p_document -> 'topics') loop
    if not private.jsonb_object_has_exact_keys(v2_topic, array['key', 'label', 'provenance']::text[])
      or coalesce(v2_topic ->> 'key', '') !~ '^[a-z][a-z0-9_.-]{1,119}$'
      or pg_catalog.char_length(coalesce(v2_topic ->> 'label', '')) not between 1 and 160
      or v2_topic ->> 'provenance' not in ('core', 'industry_pack', 'operator', 'ai_proposed') then
      raise exception 'market_profile_topic_invalid' using errcode = '22023';
    end if;
  end loop;
  if (
    select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_document -> 'topics') value
  ) <> (
    select pg_catalog.count(distinct value ->> 'key') from pg_catalog.jsonb_array_elements(p_document -> 'topics') value
  ) or (
    select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_document -> 'topics') value
  ) <> (
    select pg_catalog.count(distinct pg_catalog.lower(value ->> 'label')) from pg_catalog.jsonb_array_elements(p_document -> 'topics') value
  ) or (
    select pg_catalog.jsonb_agg(value order by value ->> 'key' collate "C")
    from pg_catalog.jsonb_array_elements(p_document -> 'topics') value
  ) is distinct from p_document -> 'topics' then
    raise exception 'market_profile_topics_not_normalized' using errcode = '22023';
  end if;

  v2_policy := p_document -> 'sourcePolicy';
  if not private.jsonb_object_has_exact_keys(
    v2_policy,
    array[
      'excludedDomains', 'excludedPublishers', 'excludedCompetitorKeys',
      'allowBoundedQuotes', 'maxQuotationCharacters'
    ]::text[]
  )
  or pg_catalog.jsonb_typeof(v2_policy -> 'excludedDomains') <> 'array'
  or pg_catalog.jsonb_array_length(v2_policy -> 'excludedDomains') > 100
  or pg_catalog.jsonb_typeof(v2_policy -> 'excludedPublishers') <> 'array'
  or pg_catalog.jsonb_array_length(v2_policy -> 'excludedPublishers') > 100
  or pg_catalog.jsonb_typeof(v2_policy -> 'excludedCompetitorKeys') <> 'array'
  or pg_catalog.jsonb_array_length(v2_policy -> 'excludedCompetitorKeys') > 50
  or pg_catalog.jsonb_typeof(v2_policy -> 'allowBoundedQuotes') <> 'boolean'
  or pg_catalog.jsonb_typeof(v2_policy -> 'maxQuotationCharacters') <> 'number'
  or (v2_policy ->> 'maxQuotationCharacters')::numeric <> pg_catalog.trunc((v2_policy ->> 'maxQuotationCharacters')::numeric)
  or (v2_policy ->> 'maxQuotationCharacters')::integer not between 0 and 500
  or ((v2_policy ->> 'allowBoundedQuotes')::boolean
      <> ((v2_policy ->> 'maxQuotationCharacters')::integer > 0)) then
    raise exception 'market_profile_source_policy_invalid' using errcode = '22023';
  end if;
  for v2_item in select value from pg_catalog.jsonb_array_elements_text(v2_policy -> 'excludedDomains') loop
    if v2_item <> pg_catalog.lower(v2_item)
      or v2_item !~ '^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)([.]([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?))+$' then
      raise exception 'market_profile_excluded_domain_invalid' using errcode = '22023';
    end if;
  end loop;
  for v2_item in select value from pg_catalog.jsonb_array_elements_text(v2_policy -> 'excludedPublishers') loop
    if pg_catalog.char_length(v2_item) not between 1 and 200 or v2_item <> pg_catalog.btrim(v2_item) then
      raise exception 'market_profile_excluded_publisher_invalid' using errcode = '22023';
    end if;
  end loop;
  for v2_item in select value from pg_catalog.jsonb_array_elements_text(v2_policy -> 'excludedCompetitorKeys') loop
    if v2_item !~ '^[a-z][a-z0-9_.-]{1,119}$' then
      raise exception 'market_profile_excluded_competitor_invalid' using errcode = '22023';
    end if;
  end loop;
  if exists (
    select 1 from (values
      (v2_policy -> 'excludedDomains'),
      (v2_policy -> 'excludedPublishers'),
      (v2_policy -> 'excludedCompetitorKeys')
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

  v2_cadence := p_document -> 'cadence';
  if not private.jsonb_object_has_exact_keys(
    v2_cadence,
    array['timeZone', 'dailyLocalTime', 'weeklyDay', 'weeklyLocalTime']::text[]
  )
  or pg_catalog.char_length(coalesce(v2_cadence ->> 'timeZone', '')) not between 1 and 100
  or not exists (
    select 1 from pg_catalog.pg_timezone_names zone where zone.name = v2_cadence ->> 'timeZone'
  )
  or coalesce(v2_cadence ->> 'dailyLocalTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  or v2_cadence ->> 'weeklyDay' not in (
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
  )
  or coalesce(v2_cadence ->> 'weeklyLocalTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'market_profile_cadence_invalid' using errcode = '22023';
  end if;
end;
$$;

revoke all on function private.assert_market_profile_document_v2(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

-- Research pipeline envelope ------------------------------------------------

create table public.growth_intelligence_research_pipelines (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  market_profile_id uuid not null,
  market_profile_version_id uuid not null,
  scope_digest text not null check (scope_digest ~ '^[a-f0-9]{64}$'),
  research_request_id uuid,
  synthesis_request_id uuid,
  stage text not null default 'queued' check (stage in (
    'queued', 'researching', 'preparing_insights',
    'ready', 'partial', 'no_findings',
    'research_failed', 'synthesis_failed', 'cancelled'
  )),
  coverage jsonb not null default '[]'::jsonb,
  stage_changed_at timestamptz not null default pg_catalog.now(),
  safe_failure_code text check (
    safe_failure_code is null or safe_failure_code ~ '^[A-Z][A-Z0-9_]{2,80}$'
  ),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete restrict,
  foreign key (organization_id, market_profile_id)
    references public.organization_market_profiles(organization_id, id) on delete restrict,
  foreign key (organization_id, market_profile_version_id)
    references public.organization_market_profile_versions(organization_id, id) on delete restrict,
  check (
    research_request_id is null
    or synthesis_request_id is null
    or research_request_id <> synthesis_request_id
  )
);

comment on table public.growth_intelligence_research_pipelines is
  'Durable research-to-synthesis lifecycle envelope. Profiles stay settings authority; requests stay work and lease authority.';

-- Deferred both ways: the atomic start inserts the pipeline and its root
-- request in one transaction, in either order. Tenant scope rides inside
-- each composite pair, so a pipeline can never point at another tenant's
-- request and a request can never join another tenant's pipeline.
alter table public.growth_intelligence_research_pipelines
  add constraint growth_intelligence_research_pipelines_research_request_fk
  foreign key (organization_id, research_request_id)
  references public.growth_intelligence_requests(organization_id, id)
  on delete restrict deferrable initially deferred;

alter table public.growth_intelligence_research_pipelines
  add constraint growth_intelligence_research_pipelines_synthesis_request_fk
  foreign key (organization_id, synthesis_request_id)
  references public.growth_intelligence_requests(organization_id, id)
  on delete restrict deferrable initially deferred;

-- Exactly one active pipeline per organization and branch. Terminal stages
-- (ready, partial, no_findings, research_failed, synthesis_failed,
-- cancelled) release the branch for a deliberate later run.
create unique index growth_intelligence_research_pipelines_active_branch_key
  on public.growth_intelligence_research_pipelines (organization_id, branch_id)
  where stage in ('queued', 'researching', 'preparing_insights');

-- A request joins at most one pipeline per role, from either side.
create unique index growth_intelligence_research_pipelines_research_request_key
  on public.growth_intelligence_research_pipelines (organization_id, research_request_id)
  where research_request_id is not null;

create unique index growth_intelligence_research_pipelines_synthesis_request_key
  on public.growth_intelligence_research_pipelines (organization_id, synthesis_request_id)
  where synthesis_request_id is not null;

create index growth_intelligence_research_pipelines_profile_idx
  on public.growth_intelligence_research_pipelines
  (organization_id, market_profile_id, created_at desc, id desc);

-- Pipeline lineage on requests ----------------------------------------------

alter table public.growth_intelligence_requests
  add column pipeline_id uuid,
  add column phase text;

alter table public.growth_intelligence_requests
  add constraint growth_intelligence_requests_phase_check
  check (phase is null or phase in ('research', 'synthesis'));

alter table public.growth_intelligence_requests
  add constraint growth_intelligence_requests_pipeline_scope_check
  check ((pipeline_id is null) = (phase is null));

alter table public.growth_intelligence_requests
  add constraint growth_intelligence_requests_pipeline_fk
  foreign key (organization_id, pipeline_id)
  references public.growth_intelligence_research_pipelines(organization_id, id)
  on delete restrict deferrable initially deferred;

-- Exactly one request per pipeline and phase: the research root and its
-- single synthesis child. Legacy rows carry null lineage and never collide.
create unique index growth_intelligence_requests_pipeline_phase_idx
  on public.growth_intelligence_requests (organization_id, pipeline_id, phase)
  where pipeline_id is not null;

-- Pipeline mutation guard ----------------------------------------------------
--
-- Identity (tenant, branch, profile, version, scope digest) is immutable;
-- lifecycle fields (stage, request lineage, coverage, timestamps, safe code)
-- stay writable for the Task 8 completion RPC, which will tighten stage
-- transitions further. Coverage is revalidated on every write.

create function private.enforce_research_pipeline_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'growth_intelligence_research_pipeline_delete_forbidden' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.organization_id is distinct from old.organization_id
      or new.branch_id is distinct from old.branch_id
      or new.market_profile_id is distinct from old.market_profile_id
      or new.market_profile_version_id is distinct from old.market_profile_version_id
      or new.scope_digest is distinct from old.scope_digest
      or new.created_at is distinct from old.created_at then
      raise exception 'growth_intelligence_research_pipeline_identity_immutable' using errcode = '55000';
    end if;
  end if;
  perform private.assert_research_pipeline_coverage(new.coverage);
  return new;
end;
$$;

revoke all on function private.enforce_research_pipeline_mutation()
  from public, anon, authenticated, service_role;

create trigger growth_intelligence_research_pipelines_set_updated_at
before update on public.growth_intelligence_research_pipelines
for each row execute function public.set_updated_at();
create trigger growth_intelligence_research_pipelines_enforce_mutation
before insert or update on public.growth_intelligence_research_pipelines
for each row execute function private.enforce_research_pipeline_mutation();

-- Pipeline RLS and least-privilege access ------------------------------------

alter table public.growth_intelligence_research_pipelines enable row level security;
alter table public.growth_intelligence_research_pipelines force row level security;

create policy "members with Growth Intelligence read pipelines"
on public.growth_intelligence_research_pipelines
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

revoke all on table public.growth_intelligence_research_pipelines from public, anon, authenticated, service_role;

grant select on table public.growth_intelligence_research_pipelines to authenticated;
grant select on table public.growth_intelligence_research_pipelines to service_role;

-- Scoped guards on existing mutations ----------------------------------------
--
-- Profiles can no longer be read as an organization singleton: the identity
-- guard now pins branch scope, and the legacy proposal wrapper explicitly
-- targets the null-branch profile. Version, decision and request guards are
-- otherwise unchanged, so old organization workflows keep operating.

create or replace function private.prevent_market_profile_identity_mutation()
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
    or new.branch_id is distinct from old.branch_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'organization_market_profile_identity_immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_market_profile_identity_mutation()
  from public, anon, authenticated, service_role;

create or replace function private.enforce_growth_intelligence_request_mutation()
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
    or new.pipeline_id is distinct from old.pipeline_id
    or new.phase is distinct from old.phase
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

revoke all on function private.enforce_growth_intelligence_request_mutation()
  from public, anon, authenticated, service_role;

-- Legacy proposal wrapper on the null-branch profile -------------------------
--
-- Body is the live replacement from 20260901171125, except the profile
-- identity is now the legacy null scope: the upsert targets the partial
-- null-branch uniqueness and every lookup pins branch_id is null. The v1
-- assertion, digest check, AI stable fingerprint and replay semantics are
-- untouched, so old organization proposals keep their exact behavior.

create or replace function public.propose_market_profile_version(
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

  operation_fingerprint := private.market_profile_proposal_operation_fingerprint(
    p_profile_digest,
    p_proposal_context
  );
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
    if not found then
      raise exception 'market_profile_proposal_replay_invalid' using errcode = '55000';
    end if;
    return pg_catalog.jsonb_build_object(
      'profileId', version_row.market_profile_id,
      'profileVersionId', version_row.id,
      'version', version_row.version,
      'profileDigest', version_row.profile_digest,
      'replayed', true
    );
  end if;

  insert into public.organization_market_profiles (
    organization_id, branch_id, created_by
  ) values (
    p_organization_id, null, p_actor_id
  ) on conflict (organization_id) where branch_id is null do nothing;

  select stored.* into profile
  from public.organization_market_profiles stored
  where stored.organization_id = p_organization_id
    and stored.branch_id is null
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

revoke all on function public.propose_market_profile_version(uuid, uuid, jsonb, text, jsonb, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.propose_market_profile_version(uuid, uuid, jsonb, text, jsonb, text, uuid)
  to authenticated, service_role;
