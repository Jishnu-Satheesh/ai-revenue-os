-- Task 3 repair: empty competitor arrays are valid on branch documents.
--
-- An operator lead may carry no geography references or relevance evidence,
-- and pg_catalog.jsonb_agg over zero rows returns null, which is distinct
-- from '[]' and tripped the normalization checks. Both checks now coalesce
-- to '[]', matching the domains/URLs/policy convention in the same function.
-- No other behavior changes.

create or replace function private.assert_market_profile_document_v2(
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
    ) or coalesce((
      select pg_catalog.jsonb_agg(value order by value collate "C")
      from pg_catalog.jsonb_array_elements_text(v2_competitor -> 'geographyRefs')
    ), '[]'::jsonb) is distinct from v2_competitor -> 'geographyRefs' then
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
    ) or coalesce((
      select pg_catalog.jsonb_agg(value order by value collate "C")
      from pg_catalog.jsonb_array_elements_text(v2_competitor -> 'relevanceEvidenceUrls')
    ), '[]'::jsonb) is distinct from v2_competitor -> 'relevanceEvidenceUrls' then
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