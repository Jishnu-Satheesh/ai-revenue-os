-- Harden the first Market Evidence release without changing its public worker
-- operations. The database, rather than an adapter or model, owns exclusions,
-- aggregate quotation retention, freshness timing, and bounded run audit data.

alter table public.market_research_runs
  add column query_plan_digest text,
  add column adapter_cost_micros_usd bigint not null default 0,
  add column adapter_latency_ms integer not null default 0,
  add constraint market_research_runs_query_plan_digest_check
    check (query_plan_digest is null or query_plan_digest ~ '^[a-f0-9]{64}$'),
  add constraint market_research_runs_adapter_cost_check
    check (adapter_cost_micros_usd between 0 and 50000000),
  add constraint market_research_runs_adapter_latency_check
    check (adapter_latency_ms between 0 and 600000);

alter table public.market_evidence_sources
  add column quotation_characters integer not null default 0,
  add constraint market_evidence_sources_quotation_characters_check
    check (quotation_characters between 0 and 500);

alter table public.market_evidence_claims
  add column claim_category text not null default 'structural_context',
  add column freshness_registry_version integer not null default 1,
  add column stale_at timestamptz not null default pg_catalog.now(),
  add constraint market_evidence_claims_category_check
    check (claim_category in (
      'availability', 'offer', 'price', 'event', 'review_trend', 'demand_trend',
      'regulation', 'seasonality', 'structural_context'
    )),
  add constraint market_evidence_claims_freshness_registry_check
    check (freshness_registry_version = 1);

create or replace function private.enforce_market_research_run_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'market_research_run_delete_forbidden' using errcode = '55000';
  end if;
  if new.organization_id is distinct from old.organization_id
    or new.growth_intelligence_request_id is distinct from old.growth_intelligence_request_id
    or new.market_profile_version_id is distinct from old.market_profile_version_id
    or new.claim_token is distinct from old.claim_token
    or new.adapter_provider is distinct from old.adapter_provider
    or new.adapter_version is distinct from old.adapter_version
    or new.model_provider is distinct from old.model_provider
    or new.model_version is distinct from old.model_version
    or new.run_fingerprint is distinct from old.run_fingerprint
    or new.query_plan_digest is distinct from old.query_plan_digest
    or new.started_at is distinct from old.started_at
    or new.correlation_id is distinct from old.correlation_id
    or new.created_at is distinct from old.created_at then
    raise exception 'market_research_run_identity_immutable' using errcode = '55000';
  end if;
  if old.status <> 'running' then
    raise exception 'market_research_run_terminal' using errcode = '55000';
  end if;
  if new.status = 'running'
    and new.evidence_payload_digest is distinct from old.evidence_payload_digest
    and old.evidence_payload_digest is null
    and new.result_digest is not distinct from old.result_digest
    and new.source_attempt_count = old.source_attempt_count
    and new.source_success_count = old.source_success_count
    and new.adapter_cost_micros_usd = old.adapter_cost_micros_usd
    and new.adapter_latency_ms = old.adapter_latency_ms
    and new.safe_failure_code is not distinct from old.safe_failure_code
    and new.completed_at is not distinct from old.completed_at
    and new.failed_at is not distinct from old.failed_at then
    return new;
  end if;
  if new.status not in ('completed', 'partial', 'failed') then
    raise exception 'market_research_run_transition_invalid' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function private.assert_market_research_run_metadata(p_metadata jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not private.jsonb_object_has_exact_keys(
    p_metadata,
    array['adapterProvider', 'adapterVersion', 'modelProvider', 'modelVersion', 'runFingerprint', 'queryPlanDigest', 'correlationId']::text[]
  )
  or pg_catalog.char_length(coalesce(p_metadata ->> 'adapterProvider', '')) not between 2 and 100
  or pg_catalog.char_length(coalesce(p_metadata ->> 'adapterVersion', '')) not between 1 and 160
  or (p_metadata ->> 'modelProvider' is not null and pg_catalog.char_length(p_metadata ->> 'modelProvider') not between 2 and 100)
  or (p_metadata ->> 'modelVersion' is not null and pg_catalog.char_length(p_metadata ->> 'modelVersion') not between 1 and 160)
  or coalesce(p_metadata ->> 'runFingerprint', '') !~ '^[a-f0-9]{64}$'
  or coalesce(p_metadata ->> 'queryPlanDigest', '') !~ '^[a-f0-9]{64}$'
  or coalesce(p_metadata ->> 'correlationId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'market_research_run_metadata_invalid' using errcode = '22023';
  end if;
end;
$$;

create or replace function private.assert_market_research_result(p_result jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not private.jsonb_object_has_exact_keys(
    p_result,
    array['outcome', 'resultDigest', 'sourceAttemptCount', 'sourceSuccessCount', 'adapterCostMicrosUsd', 'adapterLatencyMs']::text[]
  )
  or p_result ->> 'outcome' not in ('completed', 'partial')
  or coalesce(p_result ->> 'resultDigest', '') !~ '^[a-f0-9]{64}$'
  or coalesce(p_result ->> 'sourceAttemptCount', '') !~ '^(0|[1-9][0-9]{0,2})$'
  or coalesce(p_result ->> 'sourceSuccessCount', '') !~ '^(0|[1-9][0-9]{0,2})$'
  or coalesce(p_result ->> 'adapterCostMicrosUsd', '') !~ '^(0|[1-9][0-9]{0,7})$'
  or coalesce(p_result ->> 'adapterLatencyMs', '') !~ '^(0|[1-9][0-9]{0,5})$'
  or (p_result ->> 'sourceSuccessCount')::integer > (p_result ->> 'sourceAttemptCount')::integer
  or (p_result ->> 'adapterCostMicrosUsd')::bigint > 50000000
  or (p_result ->> 'adapterLatencyMs')::integer > 600000 then
    raise exception 'market_research_result_invalid' using errcode = '22023';
  end if;
end;
$$;

create or replace function private.assert_market_evidence_payload(p_payload jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  source_item jsonb;
  claim_item jsonb;
  link_item jsonb;
begin
  if not private.jsonb_object_has_exact_keys(p_payload, array['sources', 'claims', 'links']::text[])
    or pg_catalog.jsonb_typeof(p_payload -> 'sources') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload -> 'claims') <> 'array'
    or pg_catalog.jsonb_typeof(p_payload -> 'links') <> 'array'
    or pg_catalog.jsonb_array_length(p_payload -> 'sources') > 50
    or pg_catalog.jsonb_array_length(p_payload -> 'claims') > 200
    or pg_catalog.jsonb_array_length(p_payload -> 'links') > 400 then
    raise exception 'market_evidence_payload_invalid' using errcode = '22023';
  end if;

  for source_item in select value from pg_catalog.jsonb_array_elements(p_payload -> 'sources') loop
    if not private.jsonb_object_has_exact_keys(
      source_item,
      array['key', 'url', 'domain', 'publisher', 'sourceClass', 'availability', 'contentDigest', 'safeFailureCode', 'retrievedAt', 'publishedAt', 'observedAt']::text[]
    )
    or coalesce(source_item ->> 'key', '') !~ '^[a-z][a-z0-9_.-]{0,79}$'
    or coalesce(source_item ->> 'url', '') !~ '^https?://[^/?#:@]+(?:/[^?#]*)?$'
    or pg_catalog.char_length(coalesce(source_item ->> 'url', '')) not between 8 and 2048
    or coalesce(source_item ->> 'domain', '') !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
    or source_item ->> 'domain' is distinct from pg_catalog.lower(
      pg_catalog.regexp_replace(source_item ->> 'url', '^https?://([^/?#:]+)(?:/.*)?$', '\1')
    )
    or source_item ->> 'sourceClass' not in ('official', 'first_party', 'industry_research', 'public_signal')
    or source_item ->> 'availability' not in ('available', 'unavailable', 'excluded')
    or pg_catalog.jsonb_typeof(source_item -> 'publisher') not in ('string', 'null')
    or (source_item ->> 'publisher' is not null and pg_catalog.char_length(pg_catalog.btrim(source_item ->> 'publisher')) not between 1 and 200)
    or coalesce(source_item ->> 'retrievedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    or (source_item ->> 'contentDigest' is not null and source_item ->> 'contentDigest' !~ '^[a-f0-9]{64}$')
    or (source_item ->> 'safeFailureCode' is not null and source_item ->> 'safeFailureCode' !~ '^[A-Z][A-Z0-9_]{2,80}$')
    or (source_item ->> 'availability' = 'available' and (source_item ->> 'contentDigest' is null or source_item ->> 'safeFailureCode' is not null))
    or (source_item ->> 'availability' <> 'available' and source_item ->> 'safeFailureCode' is null) then
      raise exception 'market_evidence_source_invalid' using errcode = '22023';
    end if;
  end loop;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_payload -> 'sources') value
    group by value ->> 'key' having pg_catalog.count(*) > 1
  ) then
    raise exception 'market_evidence_source_keys_duplicate' using errcode = '22023';
  end if;

  for claim_item in select value from pg_catalog.jsonb_array_elements(p_payload -> 'claims') loop
    if not private.jsonb_object_has_exact_keys(
      claim_item,
      array['key', 'claimDigest', 'subjectKind', 'subjectRef', 'claimKind', 'paraphrase', 'quotation', 'geographicLayer', 'geographyRef', 'sourceKeys', 'freshnessClass', 'claimCategory', 'freshnessRegistryVersion', 'publishedAt', 'observedAt', 'staleAt', 'expiresAt', 'limitations']::text[]
    )
    or coalesce(claim_item ->> 'key', '') !~ '^[a-z][a-z0-9_.-]{0,79}$'
    or coalesce(claim_item ->> 'claimDigest', '') !~ '^[a-f0-9]{64}$'
    or claim_item ->> 'subjectKind' not in ('market', 'competitor', 'event', 'regulation', 'seasonality', 'audience', 'topic')
    or pg_catalog.char_length(pg_catalog.btrim(coalesce(claim_item ->> 'subjectRef', ''))) not between 1 and 160
    or coalesce(claim_item ->> 'claimKind', '') !~ '^[a-z][a-z0-9_.-]{1,119}$'
    or pg_catalog.char_length(coalesce(claim_item ->> 'paraphrase', '')) not between 1 and 1000
    or (claim_item ->> 'quotation' is not null and pg_catalog.char_length(claim_item ->> 'quotation') not between 1 and 500)
    or claim_item ->> 'geographicLayer' not in ('trade_area', 'city', 'country')
    or pg_catalog.char_length(coalesce(claim_item ->> 'geographyRef', '')) not between 2 and 160
    or pg_catalog.jsonb_typeof(claim_item -> 'sourceKeys') <> 'array'
    or pg_catalog.jsonb_array_length(claim_item -> 'sourceKeys') not between 1 and 50
    or claim_item ->> 'freshnessClass' not in ('fast', 'standard', 'structural')
    or claim_item ->> 'claimCategory' not in ('availability', 'offer', 'price', 'event', 'review_trend', 'demand_trend', 'regulation', 'seasonality', 'structural_context')
    or coalesce(claim_item ->> 'freshnessRegistryVersion', '') <> '1'
    or coalesce(claim_item ->> 'staleAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    or coalesce(claim_item ->> 'expiresAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    or (claim_item ->> 'claimCategory' = 'availability' and claim_item ->> 'freshnessClass' <> 'fast')
    or (claim_item ->> 'claimCategory' in ('offer', 'price', 'event', 'review_trend', 'demand_trend', 'regulation') and claim_item ->> 'freshnessClass' <> 'standard')
    or (claim_item ->> 'claimCategory' in ('seasonality', 'structural_context') and claim_item ->> 'freshnessClass' <> 'structural')
    or pg_catalog.jsonb_typeof(claim_item -> 'limitations') <> 'array'
    or pg_catalog.jsonb_array_length(claim_item -> 'limitations') > 20 then
      raise exception 'market_evidence_claim_invalid' using errcode = '22023';
    end if;
  end loop;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_payload -> 'claims') value
    group by value ->> 'key' having pg_catalog.count(*) > 1
  ) then
    raise exception 'market_evidence_claim_keys_duplicate' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload -> 'claims') claim_value,
      pg_catalog.jsonb_array_elements_text(claim_value -> 'sourceKeys') source_key
    where not exists (
      select 1 from pg_catalog.jsonb_array_elements(p_payload -> 'sources') source_value
      where source_value ->> 'key' = source_key
    )
  ) then
    raise exception 'market_evidence_claim_source_missing' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload -> 'claims') claim_value,
      pg_catalog.jsonb_array_elements_text(claim_value -> 'sourceKeys') source_key
    where source_key !~ '^[a-z][a-z0-9_.-]{0,79}$'
  ) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload -> 'claims') claim_value
    where (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(claim_value -> 'sourceKeys'))
      <> (select pg_catalog.count(distinct value) from pg_catalog.jsonb_array_elements_text(claim_value -> 'sourceKeys'))
  ) then
    raise exception 'market_evidence_claim_sources_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload -> 'claims') claim_value,
      pg_catalog.jsonb_array_elements_text(claim_value -> 'limitations') limitation
    where limitation !~ '^[A-Z][A-Z0-9_]{2,80}$'
  ) then
    raise exception 'market_evidence_limitations_invalid' using errcode = '22023';
  end if;
  for link_item in select value from pg_catalog.jsonb_array_elements(p_payload -> 'links') loop
    if not private.jsonb_object_has_exact_keys(link_item, array['fromClaimKey', 'toClaimKey', 'relation']::text[])
      or link_item ->> 'relation' not in ('corroborates', 'contradicts')
      or link_item ->> 'fromClaimKey' = link_item ->> 'toClaimKey'
      or not exists (select 1 from pg_catalog.jsonb_array_elements(p_payload -> 'claims') value where value ->> 'key' = link_item ->> 'fromClaimKey')
      or not exists (select 1 from pg_catalog.jsonb_array_elements(p_payload -> 'claims') value where value ->> 'key' = link_item ->> 'toClaimKey') then
      raise exception 'market_evidence_link_invalid' using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function public.begin_market_research_run(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
  run_row public.market_research_runs;
begin
  if p_organization_id is null or p_request_id is null or p_claim_token is null then
    raise exception 'market_research_run_invalid' using errcode = '22023';
  end if;
  perform private.assert_market_research_run_metadata(p_metadata);
  request_row := private.assert_market_research_claim(p_organization_id, p_request_id, p_claim_token);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws('|', 'growth_intelligence', 'market_research_run', p_organization_id, p_request_id, p_claim_token),
    0
  ));
  select run.* into run_row
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token
  for update;
  if found then
    if run_row.run_fingerprint is distinct from p_metadata ->> 'runFingerprint'
      or run_row.query_plan_digest is distinct from p_metadata ->> 'queryPlanDigest' then
      raise exception 'market_research_run_idempotency_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'runId', run_row.id, 'requestId', run_row.growth_intelligence_request_id,
      'status', run_row.status, 'replayed', true
    );
  end if;
  insert into public.market_research_runs (
    organization_id, growth_intelligence_request_id, market_profile_version_id, claim_token,
    adapter_provider, adapter_version, model_provider, model_version, run_fingerprint,
    query_plan_digest, correlation_id
  ) values (
    p_organization_id, p_request_id, request_row.market_profile_version_id, p_claim_token,
    p_metadata ->> 'adapterProvider', p_metadata ->> 'adapterVersion',
    nullif(p_metadata ->> 'modelProvider', ''), nullif(p_metadata ->> 'modelVersion', ''),
    p_metadata ->> 'runFingerprint', p_metadata ->> 'queryPlanDigest',
    (p_metadata ->> 'correlationId')::uuid
  ) returning * into run_row;
  return pg_catalog.jsonb_build_object(
    'runId', run_row.id, 'requestId', run_row.growth_intelligence_request_id,
    'status', run_row.status, 'replayed', false
  );
end;
$$;

create or replace function public.record_market_evidence_claims(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_market_research_run_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
  run_row public.market_research_runs;
  profile_document jsonb;
  source_item jsonb;
  claim_item jsonb;
  link_item jsonb;
  source_row public.market_evidence_sources;
  claim_row public.market_evidence_claims;
  referenced_source_key text;
  payload_digest text;
  quote_allowed boolean;
  quote_limit integer;
  source_quote_characters integer;
  normalized_publisher text;
  claim_observed_at timestamptz;
  claim_basis_at timestamptz;
  calculated_stale_at timestamptz;
  calculated_expires_at timestamptz;
begin
  if p_market_research_run_id is null then
    raise exception 'market_evidence_record_invalid' using errcode = '22023';
  end if;
  perform private.assert_market_evidence_payload(p_payload);
  request_row := private.assert_market_research_claim(p_organization_id, p_request_id, p_claim_token);
  select run.* into run_row
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token
  for update;
  if not found or run_row.status <> 'running' then
    raise exception 'market_evidence_run_not_recordable' using errcode = '42501';
  end if;
  payload_digest := pg_catalog.encode(extensions.digest(private.canonical_json_text(p_payload), 'sha256'), 'hex');
  if run_row.evidence_payload_digest is not null then
    if run_row.evidence_payload_digest is distinct from payload_digest then
      raise exception 'market_evidence_record_idempotency_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'runId', run_row.id,
      'claimCount', (
        select pg_catalog.count(*) from public.market_evidence_claims claim
        where claim.organization_id = p_organization_id
          and claim.market_research_run_id = run_row.id
      ),
      'replayed', true
    );
  end if;

  select version.profile_document into profile_document
  from public.organization_market_profile_versions version
  where version.organization_id = p_organization_id
    and version.id = request_row.market_profile_version_id;
  quote_allowed := coalesce((profile_document #>> '{sourcePolicy,allowBoundedQuotes}')::boolean, false);
  quote_limit := coalesce((profile_document #>> '{sourcePolicy,maxQuotationCharacters}')::integer, 0);

  for source_item in select value from pg_catalog.jsonb_array_elements(p_payload -> 'sources') loop
    normalized_publisher := nullif(pg_catalog.btrim(source_item ->> 'publisher'), '');
    select coalesce(pg_catalog.sum(pg_catalog.char_length(claim_value ->> 'quotation')), 0)::integer
    into source_quote_characters
    from pg_catalog.jsonb_array_elements(p_payload -> 'claims') claim_value
    where claim_value -> 'sourceKeys' ? source_item ->> 'key';
    if source_quote_characters > 0 and not quote_allowed then
      raise exception 'market_evidence_quotation_forbidden' using errcode = '22023';
    end if;
    if source_quote_characters > quote_limit then
      raise exception 'market_evidence_quotation_aggregate_exceeded' using errcode = '22023';
    end if;
    if exists (
      select 1 from pg_catalog.jsonb_array_elements_text(profile_document #> '{sourcePolicy,excludedDomains}') excluded(value)
      where pg_catalog.lower(pg_catalog.btrim(excluded.value)) = source_item ->> 'domain'
    ) or exists (
      select 1 from pg_catalog.jsonb_array_elements_text(profile_document #> '{sourcePolicy,excludedPublishers}') excluded(value)
      where pg_catalog.lower(pg_catalog.btrim(excluded.value)) = pg_catalog.lower(normalized_publisher)
    ) then
      raise exception 'market_evidence_source_excluded' using errcode = '22023';
    end if;
    insert into public.market_evidence_sources (
      organization_id, market_research_run_id, market_profile_version_id, source_key,
      source_url, source_domain, publisher, source_class, availability, source_content_digest,
      safe_failure_code, quotation_characters, retrieved_at, published_at, observed_at
    ) values (
      p_organization_id, run_row.id, run_row.market_profile_version_id, source_item ->> 'key',
      source_item ->> 'url', source_item ->> 'domain', normalized_publisher,
      source_item ->> 'sourceClass', source_item ->> 'availability', nullif(source_item ->> 'contentDigest', ''),
      nullif(source_item ->> 'safeFailureCode', ''), source_quote_characters,
      (source_item ->> 'retrievedAt')::timestamptz,
      nullif(source_item ->> 'publishedAt', '')::timestamptz,
      nullif(source_item ->> 'observedAt', '')::timestamptz
    );
  end loop;

  for claim_item in select value from pg_catalog.jsonb_array_elements(p_payload -> 'claims') loop
    if claim_item ->> 'subjectKind' = 'competitor' and exists (
      select 1 from pg_catalog.jsonb_array_elements_text(profile_document #> '{sourcePolicy,excludedCompetitorKeys}') excluded(value)
      where pg_catalog.lower(pg_catalog.btrim(excluded.value))
        = pg_catalog.lower(pg_catalog.btrim(claim_item ->> 'subjectRef'))
    ) then
      raise exception 'market_evidence_competitor_excluded' using errcode = '22023';
    end if;

    claim_observed_at := nullif(claim_item ->> 'observedAt', '')::timestamptz;
    if claim_observed_at is not null then
      claim_basis_at := claim_observed_at;
    else
      select pg_catalog.min(source.retrieved_at) into claim_basis_at
      from public.market_evidence_sources source
      join pg_catalog.jsonb_array_elements_text(claim_item -> 'sourceKeys') referenced_source(value)
        on source.source_key = referenced_source.value
      where source.organization_id = p_organization_id
        and source.market_research_run_id = run_row.id;
    end if;
    case claim_item ->> 'claimCategory'
      when 'availability' then
        calculated_stale_at := claim_basis_at + interval '6 hours';
        calculated_expires_at := claim_basis_at + interval '1 day';
      when 'offer', 'price' then
        calculated_stale_at := claim_basis_at + interval '3 days';
        calculated_expires_at := claim_basis_at + interval '7 days';
      when 'event' then
        calculated_stale_at := claim_basis_at + interval '7 days';
        calculated_expires_at := claim_basis_at + interval '14 days';
      when 'review_trend', 'demand_trend' then
        calculated_stale_at := claim_basis_at + interval '14 days';
        calculated_expires_at := claim_basis_at + interval '30 days';
      when 'regulation' then
        calculated_stale_at := claim_basis_at + interval '30 days';
        calculated_expires_at := claim_basis_at + interval '90 days';
      when 'seasonality', 'structural_context' then
        calculated_stale_at := claim_basis_at + interval '180 days';
        calculated_expires_at := claim_basis_at + interval '400 days';
    end case;
    if (claim_item ->> 'staleAt')::timestamptz is distinct from calculated_stale_at
      or (claim_item ->> 'expiresAt')::timestamptz is distinct from calculated_expires_at then
      raise exception 'market_evidence_freshness_invalid' using errcode = '22023';
    end if;

    insert into public.market_evidence_claims (
      organization_id, market_research_run_id, market_profile_version_id, claim_key, claim_digest,
      subject_kind, subject_ref, claim_kind, paraphrase, quotation, geographic_layer, geography_ref,
      freshness_class, claim_category, freshness_registry_version, published_at, observed_at,
      stale_at, expires_at, limitations
    ) values (
      p_organization_id, run_row.id, run_row.market_profile_version_id, claim_item ->> 'key', claim_item ->> 'claimDigest',
      claim_item ->> 'subjectKind', pg_catalog.btrim(claim_item ->> 'subjectRef'), claim_item ->> 'claimKind', claim_item ->> 'paraphrase',
      nullif(claim_item ->> 'quotation', ''), claim_item ->> 'geographicLayer', claim_item ->> 'geographyRef',
      claim_item ->> 'freshnessClass', claim_item ->> 'claimCategory', (claim_item ->> 'freshnessRegistryVersion')::integer,
      nullif(claim_item ->> 'publishedAt', '')::timestamptz, claim_observed_at,
      calculated_stale_at, calculated_expires_at, claim_item -> 'limitations'
    ) returning * into claim_row;
    insert into public.market_evidence_claim_events (
      organization_id, market_evidence_claim_id, event_type, event_digest, reason, occurred_at
    ) values (
      p_organization_id, claim_row.id, 'observed',
      pg_catalog.encode(extensions.digest(claim_row.claim_digest || '|observed', 'sha256'), 'hex'),
      null, pg_catalog.now()
    );
    for referenced_source_key in select value from pg_catalog.jsonb_array_elements_text(claim_item -> 'sourceKeys') value loop
      select source.* into source_row
      from public.market_evidence_sources source
      where source.organization_id = p_organization_id
        and source.market_research_run_id = run_row.id
        and source.source_key = referenced_source_key;
      insert into public.market_evidence_links (
        organization_id, market_evidence_claim_id, market_evidence_source_id, relation
      ) values (p_organization_id, claim_row.id, source_row.id, 'supports');
    end loop;
  end loop;
  for link_item in select value from pg_catalog.jsonb_array_elements(p_payload -> 'links') loop
    insert into public.market_evidence_links (
      organization_id, market_evidence_claim_id, related_market_evidence_claim_id, relation
    )
    select p_organization_id, source_claim.id, target_claim.id, link_item ->> 'relation'
    from public.market_evidence_claims source_claim
    join public.market_evidence_claims target_claim
      on target_claim.organization_id = source_claim.organization_id
      and target_claim.market_research_run_id = source_claim.market_research_run_id
      and target_claim.claim_key = link_item ->> 'toClaimKey'
    where source_claim.organization_id = p_organization_id
      and source_claim.market_research_run_id = run_row.id
      and source_claim.claim_key = link_item ->> 'fromClaimKey';
  end loop;
  update public.market_research_runs
  set evidence_payload_digest = payload_digest
  where organization_id = p_organization_id and id = run_row.id;
  return pg_catalog.jsonb_build_object(
    'runId', run_row.id,
    'claimCount', pg_catalog.jsonb_array_length(p_payload -> 'claims'),
    'replayed', false
  );
end;
$$;

create or replace function public.complete_market_research_run(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_market_research_run_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
  run_row public.market_research_runs;
  completion jsonb;
  recorded_source_count integer;
  recorded_success_count integer;
begin
  if p_market_research_run_id is null then
    raise exception 'market_research_completion_invalid' using errcode = '22023';
  end if;
  perform private.assert_market_research_result(p_result);
  select run.* into run_row
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token;
  if found and run_row.status <> 'running' then
    if run_row.status = p_result ->> 'outcome'
      and run_row.result_digest = p_result ->> 'resultDigest'
      and run_row.adapter_cost_micros_usd = (p_result ->> 'adapterCostMicrosUsd')::bigint
      and run_row.adapter_latency_ms = (p_result ->> 'adapterLatencyMs')::integer then
      return pg_catalog.jsonb_build_object(
        'runId', run_row.id, 'status', run_row.status, 'replayed', true
      );
    end if;
    raise exception 'market_research_run_terminal' using errcode = '23505';
  end if;
  request_row := private.assert_market_research_claim(p_organization_id, p_request_id, p_claim_token);

  select run.* into run_row
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token
  for update;
  if not found then
    raise exception 'market_research_run_not_found' using errcode = '42501';
  end if;
  if run_row.status <> 'running' then
    if run_row.status = p_result ->> 'outcome'
      and run_row.result_digest = p_result ->> 'resultDigest'
      and run_row.adapter_cost_micros_usd = (p_result ->> 'adapterCostMicrosUsd')::bigint
      and run_row.adapter_latency_ms = (p_result ->> 'adapterLatencyMs')::integer then
      return pg_catalog.jsonb_build_object(
        'runId', run_row.id, 'status', run_row.status, 'replayed', true
      );
    end if;
    raise exception 'market_research_run_terminal' using errcode = '23505';
  end if;

  select pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where source.availability = 'available')::integer
  into recorded_source_count, recorded_success_count
  from public.market_evidence_sources source
  where source.organization_id = p_organization_id
    and source.market_research_run_id = run_row.id;
  if recorded_source_count <> (p_result ->> 'sourceAttemptCount')::integer
    or recorded_success_count <> (p_result ->> 'sourceSuccessCount')::integer then
    raise exception 'market_research_result_source_count_mismatch' using errcode = '22023';
  end if;

  update public.market_research_runs
  set status = p_result ->> 'outcome',
      result_digest = p_result ->> 'resultDigest',
      source_attempt_count = (p_result ->> 'sourceAttemptCount')::integer,
      source_success_count = (p_result ->> 'sourceSuccessCount')::integer,
      adapter_cost_micros_usd = (p_result ->> 'adapterCostMicrosUsd')::bigint,
      adapter_latency_ms = (p_result ->> 'adapterLatencyMs')::integer,
      completed_at = pg_catalog.now()
  where organization_id = p_organization_id and id = run_row.id
  returning * into run_row;

  completion := public.complete_growth_intelligence_request(
    p_organization_id, p_request_id, p_claim_token
  );
  if completion ->> 'outcome' <> 'completed' then
    raise exception 'market_research_request_completion_failed' using errcode = '42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'runId', run_row.id, 'status', run_row.status, 'replayed', false
  );
end;
$$;

create or replace function public.market_evidence_claim_current_state(
  p_organization_id uuid,
  p_market_evidence_claim_id uuid
)
returns text
language sql
stable
set search_path = ''
as $$
  with latest_event as (
    select event.event_type
    from public.market_evidence_claim_events event
    where event.organization_id = p_organization_id
      and event.market_evidence_claim_id = p_market_evidence_claim_id
      and event.occurred_at <= pg_catalog.now()
    order by event.occurred_at desc, event.created_at desc, event.id desc
    limit 1
  )
  select case
    when not exists (
      select 1 from public.market_evidence_claims claim
      where claim.organization_id = p_organization_id and claim.id = p_market_evidence_claim_id
    ) then null
    when (select event_type from latest_event) in ('withdrawn', 'excluded', 'corrected', 'superseded')
      then case when (select event_type from latest_event) = 'corrected' then 'superseded'
        else (select event_type from latest_event) end
    when (select event_type from latest_event) = 'expired'
      or exists (
        select 1 from public.market_evidence_claims claim
        where claim.organization_id = p_organization_id
          and claim.id = p_market_evidence_claim_id
          and claim.expires_at <= pg_catalog.now()
      ) then 'expired'
    when exists (
      select 1 from public.market_evidence_claims claim
      where claim.organization_id = p_organization_id
        and claim.id = p_market_evidence_claim_id
        and claim.stale_at <= pg_catalog.now()
    ) then 'stale'
    else 'current'
  end;
$$;

revoke all on function private.enforce_market_research_run_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.assert_market_research_run_metadata(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.assert_market_research_result(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.assert_market_evidence_payload(jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.begin_market_research_run(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.record_market_evidence_claims(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_market_research_run(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.market_evidence_claim_current_state(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.begin_market_research_run(uuid, uuid, uuid, jsonb)
  to service_role;
grant execute on function public.record_market_evidence_claims(uuid, uuid, uuid, uuid, jsonb)
  to service_role;
grant execute on function public.complete_market_research_run(uuid, uuid, uuid, uuid, jsonb)
  to service_role;
grant execute on function public.market_evidence_claim_current_state(uuid, uuid)
  to authenticated;
