-- The first hardening migration parsed cleanly but PL/pgSQL evaluates the
-- JSON existence operator before the source-key extraction without explicit
-- parentheses. Restore the recorder before any evidence is persisted.

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
    where (claim_value -> 'sourceKeys') ? (source_item ->> 'key');
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

revoke all on function public.record_market_evidence_claims(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.record_market_evidence_claims(uuid, uuid, uuid, uuid, jsonb)
  to service_role;
