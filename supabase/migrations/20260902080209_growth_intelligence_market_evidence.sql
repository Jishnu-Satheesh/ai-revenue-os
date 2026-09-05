-- Immutable, attributable public-market evidence. Public pages and raw provider
-- payloads do not cross this boundary: a run stores only bounded citation
-- metadata, platform-authored compact claims, and append-only state events.

create table public.market_research_runs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  growth_intelligence_request_id uuid not null,
  market_profile_version_id uuid not null,
  claim_token uuid not null,
  adapter_provider text not null check (pg_catalog.char_length(adapter_provider) between 2 and 100),
  adapter_version text not null check (pg_catalog.char_length(adapter_version) between 1 and 160),
  model_provider text check (model_provider is null or pg_catalog.char_length(model_provider) between 2 and 100),
  model_version text check (model_version is null or pg_catalog.char_length(model_version) between 1 and 160),
  run_fingerprint text not null check (run_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
  evidence_payload_digest text check (evidence_payload_digest is null or evidence_payload_digest ~ '^[a-f0-9]{64}$'),
  result_digest text check (result_digest is null or result_digest ~ '^[a-f0-9]{64}$'),
  source_attempt_count integer not null default 0 check (source_attempt_count between 0 and 200),
  source_success_count integer not null default 0 check (source_success_count between 0 and 200),
  safe_failure_code text check (safe_failure_code is null or safe_failure_code ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  started_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz,
  failed_at timestamptz,
  correlation_id uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, growth_intelligence_request_id, claim_token),
  foreign key (organization_id, growth_intelligence_request_id)
    references public.growth_intelligence_requests(organization_id, id) on delete restrict,
  foreign key (organization_id, market_profile_version_id)
    references public.organization_market_profile_versions(organization_id, id) on delete restrict,
  check (source_success_count <= source_attempt_count),
  check ((status = 'running') = (completed_at is null and failed_at is null and safe_failure_code is null)),
  check (status <> 'completed' or (completed_at is not null and result_digest is not null)),
  check (status <> 'partial' or (completed_at is not null and result_digest is not null)),
  check (status <> 'failed' or (failed_at is not null and safe_failure_code is not null))
);

create table public.market_evidence_sources (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  market_research_run_id uuid not null,
  market_profile_version_id uuid not null,
  source_key text not null check (source_key ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  source_url text not null check (
    pg_catalog.char_length(source_url) between 8 and 2048
    and source_url ~ '^https?://[^/?#]+(?:/[^?#]*)?$'
  ),
  source_domain text not null check (
    pg_catalog.char_length(source_domain) between 3 and 253
    and source_domain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  publisher text check (publisher is null or pg_catalog.char_length(publisher) between 1 and 200),
  source_class text not null check (source_class in ('official', 'first_party', 'industry_research', 'public_signal')),
  availability text not null check (availability in ('available', 'unavailable', 'excluded')),
  source_content_digest text check (source_content_digest is null or source_content_digest ~ '^[a-f0-9]{64}$'),
  safe_failure_code text check (safe_failure_code is null or safe_failure_code ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  retrieved_at timestamptz not null,
  published_at timestamptz,
  observed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, market_research_run_id, source_key),
  unique (organization_id, market_research_run_id, source_url),
  foreign key (organization_id, market_research_run_id)
    references public.market_research_runs(organization_id, id) on delete restrict,
  foreign key (organization_id, market_profile_version_id)
    references public.organization_market_profile_versions(organization_id, id) on delete restrict,
  check ((availability = 'available') = (source_content_digest is not null and safe_failure_code is null)),
  check (availability = 'available' or safe_failure_code is not null)
);

create table public.market_evidence_claims (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  market_research_run_id uuid not null,
  market_profile_version_id uuid not null,
  claim_key text not null check (claim_key ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  claim_digest text not null check (claim_digest ~ '^[a-f0-9]{64}$'),
  subject_kind text not null check (subject_kind in ('market', 'competitor', 'event', 'regulation', 'seasonality', 'audience', 'topic')),
  subject_ref text not null check (pg_catalog.char_length(subject_ref) between 1 and 160),
  claim_kind text not null check (claim_kind ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  paraphrase text not null check (pg_catalog.char_length(paraphrase) between 1 and 1000),
  quotation text check (quotation is null or pg_catalog.char_length(quotation) between 1 and 500),
  geographic_layer text not null check (geographic_layer in ('trade_area', 'city', 'country')),
  geography_ref text not null check (pg_catalog.char_length(geography_ref) between 2 and 160),
  freshness_class text not null check (freshness_class in ('fast', 'standard', 'structural')),
  published_at timestamptz,
  observed_at timestamptz,
  expires_at timestamptz not null,
  limitations jsonb not null default '[]'::jsonb check (pg_catalog.jsonb_typeof(limitations) = 'array'),
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, market_research_run_id, claim_key),
  foreign key (organization_id, market_research_run_id)
    references public.market_research_runs(organization_id, id) on delete restrict,
  foreign key (organization_id, market_profile_version_id)
    references public.organization_market_profile_versions(organization_id, id) on delete restrict,
  -- Evidence may be imported after it has expired. Its retention time must
  -- still follow the fact it describes, rather than the database insert time.
  check (expires_at > coalesce(observed_at, published_at, created_at))
);

create table public.market_evidence_claim_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  market_evidence_claim_id uuid not null,
  event_type text not null check (event_type in ('observed', 'expired', 'withdrawn', 'excluded', 'corrected', 'superseded')),
  event_digest text not null check (event_digest ~ '^[a-f0-9]{64}$'),
  reason text check (reason is null or pg_catalog.char_length(reason) between 1 and 500),
  occurred_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, market_evidence_claim_id, event_digest),
  foreign key (organization_id, market_evidence_claim_id)
    references public.market_evidence_claims(organization_id, id) on delete restrict
);

create table public.market_evidence_links (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  market_evidence_claim_id uuid not null,
  market_evidence_source_id uuid,
  related_market_evidence_claim_id uuid,
  relation text not null check (relation in ('supports', 'corroborates', 'contradicts')),
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  foreign key (organization_id, market_evidence_claim_id)
    references public.market_evidence_claims(organization_id, id) on delete restrict,
  foreign key (organization_id, market_evidence_source_id)
    references public.market_evidence_sources(organization_id, id) on delete restrict,
  foreign key (organization_id, related_market_evidence_claim_id)
    references public.market_evidence_claims(organization_id, id) on delete restrict,
  check (
    (relation = 'supports') = (market_evidence_source_id is not null and related_market_evidence_claim_id is null)
  ),
  check (
    relation = 'supports'
    or (market_evidence_source_id is null and related_market_evidence_claim_id is not null)
  ),
  check (related_market_evidence_claim_id is null or related_market_evidence_claim_id <> market_evidence_claim_id)
);

create unique index market_evidence_links_claim_source_unique
  on public.market_evidence_links (organization_id, market_evidence_claim_id, market_evidence_source_id)
  where market_evidence_source_id is not null;
create unique index market_evidence_links_claim_relation_unique
  on public.market_evidence_links (organization_id, market_evidence_claim_id, related_market_evidence_claim_id, relation)
  where related_market_evidence_claim_id is not null;

create index market_research_runs_profile_idx
  on public.market_research_runs (organization_id, market_profile_version_id, started_at desc, id desc);
create index market_research_runs_request_idx
  on public.market_research_runs (organization_id, growth_intelligence_request_id, started_at desc, id desc);
create index market_evidence_sources_domain_idx
  on public.market_evidence_sources (organization_id, market_profile_version_id, source_domain, retrieved_at desc, id desc);
create index market_evidence_sources_run_idx
  on public.market_evidence_sources (organization_id, market_research_run_id, id);
create index market_evidence_claims_active_idx
  on public.market_evidence_claims (organization_id, market_profile_version_id, expires_at, created_at desc, id desc);
create index market_evidence_claims_geography_idx
  on public.market_evidence_claims (organization_id, geographic_layer, geography_ref, expires_at, id);
create index market_evidence_claim_events_current_idx
  on public.market_evidence_claim_events (organization_id, market_evidence_claim_id, occurred_at desc, created_at desc, id desc);
create index market_evidence_links_source_idx
  on public.market_evidence_links (organization_id, market_evidence_source_id, market_evidence_claim_id)
  where market_evidence_source_id is not null;
create index market_evidence_links_related_claim_idx
  on public.market_evidence_links (organization_id, related_market_evidence_claim_id, relation, market_evidence_claim_id)
  where related_market_evidence_claim_id is not null;

create function private.reject_market_evidence_immutable_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'market_evidence_immutable' using errcode = '55000';
end;
$$;

create function private.enforce_market_research_run_mutation()
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

create trigger market_research_runs_enforce_mutation
before update or delete on public.market_research_runs
for each row execute function private.enforce_market_research_run_mutation();
create trigger market_evidence_sources_append_only
before update or delete on public.market_evidence_sources
for each row execute function private.reject_market_evidence_immutable_mutation();
create trigger market_evidence_claims_append_only
before update or delete on public.market_evidence_claims
for each row execute function private.reject_market_evidence_immutable_mutation();
create trigger market_evidence_claim_events_append_only
before update or delete on public.market_evidence_claim_events
for each row execute function private.reject_market_evidence_immutable_mutation();
create trigger market_evidence_links_append_only
before update or delete on public.market_evidence_links
for each row execute function private.reject_market_evidence_immutable_mutation();

create function private.assert_market_research_run_metadata(p_metadata jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not private.jsonb_object_has_exact_keys(
    p_metadata,
    array['adapterProvider', 'adapterVersion', 'modelProvider', 'modelVersion', 'runFingerprint', 'correlationId']::text[]
  )
  or pg_catalog.char_length(coalesce(p_metadata ->> 'adapterProvider', '')) not between 2 and 100
  or pg_catalog.char_length(coalesce(p_metadata ->> 'adapterVersion', '')) not between 1 and 160
  or (p_metadata ->> 'modelProvider' is not null and pg_catalog.char_length(p_metadata ->> 'modelProvider') not between 2 and 100)
  or (p_metadata ->> 'modelVersion' is not null and pg_catalog.char_length(p_metadata ->> 'modelVersion') not between 1 and 160)
  or coalesce(p_metadata ->> 'runFingerprint', '') !~ '^[a-f0-9]{64}$'
  or coalesce(p_metadata ->> 'correlationId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'market_research_run_metadata_invalid' using errcode = '22023';
  end if;
end;
$$;

create function private.assert_market_research_result(p_result jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not private.jsonb_object_has_exact_keys(
    p_result,
    array['outcome', 'resultDigest', 'sourceAttemptCount', 'sourceSuccessCount']::text[]
  )
  or p_result ->> 'outcome' not in ('completed', 'partial')
  or coalesce(p_result ->> 'resultDigest', '') !~ '^[a-f0-9]{64}$'
  or coalesce(p_result ->> 'sourceAttemptCount', '') !~ '^(0|[1-9][0-9]{0,2})$'
  or coalesce(p_result ->> 'sourceSuccessCount', '') !~ '^(0|[1-9][0-9]{0,2})$'
  or (p_result ->> 'sourceSuccessCount')::integer > (p_result ->> 'sourceAttemptCount')::integer then
    raise exception 'market_research_result_invalid' using errcode = '22023';
  end if;
end;
$$;

create function private.assert_market_evidence_payload(p_payload jsonb)
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
    or coalesce(source_item ->> 'url', '') !~ '^https?://[^/?#]+(?:/[^?#]*)?$'
    or pg_catalog.char_length(coalesce(source_item ->> 'url', '')) not between 8 and 2048
    or coalesce(source_item ->> 'domain', '') !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
    or source_item ->> 'sourceClass' not in ('official', 'first_party', 'industry_research', 'public_signal')
    or source_item ->> 'availability' not in ('available', 'unavailable', 'excluded')
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
  ) then raise exception 'market_evidence_source_keys_duplicate' using errcode = '22023'; end if;
  for claim_item in select value from pg_catalog.jsonb_array_elements(p_payload -> 'claims') loop
    if not private.jsonb_object_has_exact_keys(
      claim_item,
      array['key', 'claimDigest', 'subjectKind', 'subjectRef', 'claimKind', 'paraphrase', 'quotation', 'geographicLayer', 'geographyRef', 'sourceKeys', 'freshnessClass', 'publishedAt', 'observedAt', 'expiresAt', 'limitations']::text[]
    )
    or coalesce(claim_item ->> 'key', '') !~ '^[a-z][a-z0-9_.-]{0,79}$'
    or coalesce(claim_item ->> 'claimDigest', '') !~ '^[a-f0-9]{64}$'
    or claim_item ->> 'subjectKind' not in ('market', 'competitor', 'event', 'regulation', 'seasonality', 'audience', 'topic')
    or pg_catalog.char_length(coalesce(claim_item ->> 'subjectRef', '')) not between 1 and 160
    or coalesce(claim_item ->> 'claimKind', '') !~ '^[a-z][a-z0-9_.-]{1,119}$'
    or pg_catalog.char_length(coalesce(claim_item ->> 'paraphrase', '')) not between 1 and 1000
    or (claim_item ->> 'quotation' is not null and pg_catalog.char_length(claim_item ->> 'quotation') not between 1 and 500)
    or claim_item ->> 'geographicLayer' not in ('trade_area', 'city', 'country')
    or pg_catalog.char_length(coalesce(claim_item ->> 'geographyRef', '')) not between 2 and 160
    or pg_catalog.jsonb_typeof(claim_item -> 'sourceKeys') <> 'array'
    or pg_catalog.jsonb_array_length(claim_item -> 'sourceKeys') not between 1 and 50
    or claim_item ->> 'freshnessClass' not in ('fast', 'standard', 'structural')
    or coalesce(claim_item ->> 'expiresAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    or pg_catalog.jsonb_typeof(claim_item -> 'limitations') <> 'array'
    or pg_catalog.jsonb_array_length(claim_item -> 'limitations') > 20 then
      raise exception 'market_evidence_claim_invalid' using errcode = '22023';
    end if;
  end loop;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_payload -> 'claims') value
    group by value ->> 'key' having pg_catalog.count(*) > 1
  ) then raise exception 'market_evidence_claim_keys_duplicate' using errcode = '22023'; end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload -> 'claims') claim_value,
      pg_catalog.jsonb_array_elements_text(claim_value -> 'sourceKeys') source_key
    where not exists (
      select 1 from pg_catalog.jsonb_array_elements(p_payload -> 'sources') source_value
      where source_value ->> 'key' = source_key
    )
  ) then raise exception 'market_evidence_claim_source_missing' using errcode = '22023'; end if;
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
  ) then raise exception 'market_evidence_claim_sources_invalid' using errcode = '22023'; end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_payload -> 'claims') claim_value,
      pg_catalog.jsonb_array_elements_text(claim_value -> 'limitations') limitation
    where limitation !~ '^[A-Z][A-Z0-9_]{2,80}$'
  ) then raise exception 'market_evidence_limitations_invalid' using errcode = '22023'; end if;
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

create function private.assert_market_research_claim(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid
)
returns public.growth_intelligence_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'market_research_worker_forbidden' using errcode = '42501';
  end if;
  select request.* into request_row
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
  for update;
  if not found or request_row.kind <> 'market_research'
    or request_row.status <> 'claimed'
    or request_row.claim_token is distinct from p_claim_token
    or request_row.lease_expires_at <= pg_catalog.now() then
    raise exception 'market_research_claim_lost' using errcode = '42501';
  end if;
  return request_row;
end;
$$;

create function public.begin_market_research_run(
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
    if run_row.run_fingerprint is distinct from p_metadata ->> 'runFingerprint' then
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
    correlation_id
  ) values (
    p_organization_id, p_request_id, request_row.market_profile_version_id, p_claim_token,
    p_metadata ->> 'adapterProvider', p_metadata ->> 'adapterVersion',
    nullif(p_metadata ->> 'modelProvider', ''), nullif(p_metadata ->> 'modelVersion', ''),
    p_metadata ->> 'runFingerprint', (p_metadata ->> 'correlationId')::uuid
  ) returning * into run_row;
  return pg_catalog.jsonb_build_object(
    'runId', run_row.id, 'requestId', run_row.growth_intelligence_request_id,
    'status', run_row.status, 'replayed', false
  );
end;
$$;

create function public.record_market_evidence_claims(
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
  source_key text;
  payload_digest text;
  quote_allowed boolean;
  quote_limit integer;
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
      'claimCount', (select pg_catalog.count(*) from public.market_evidence_claims claim where claim.organization_id = p_organization_id and claim.market_research_run_id = run_row.id),
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
    if exists (
      select 1 from pg_catalog.jsonb_array_elements_text(profile_document #> '{sourcePolicy,excludedDomains}') excluded(value)
      where excluded.value = source_item ->> 'domain'
    ) or exists (
      select 1 from pg_catalog.jsonb_array_elements_text(profile_document #> '{sourcePolicy,excludedPublishers}') excluded(value)
      where pg_catalog.lower(excluded.value) = pg_catalog.lower(coalesce(source_item ->> 'publisher', ''))
    ) then
      raise exception 'market_evidence_source_excluded' using errcode = '22023';
    end if;
    insert into public.market_evidence_sources (
      organization_id, market_research_run_id, market_profile_version_id, source_key,
      source_url, source_domain, publisher, source_class, availability, source_content_digest,
      safe_failure_code, retrieved_at, published_at, observed_at
    ) values (
      p_organization_id, run_row.id, run_row.market_profile_version_id, source_item ->> 'key',
      source_item ->> 'url', source_item ->> 'domain', nullif(source_item ->> 'publisher', ''),
      source_item ->> 'sourceClass', source_item ->> 'availability', nullif(source_item ->> 'contentDigest', ''),
      nullif(source_item ->> 'safeFailureCode', ''), (source_item ->> 'retrievedAt')::timestamptz,
      nullif(source_item ->> 'publishedAt', '')::timestamptz, nullif(source_item ->> 'observedAt', '')::timestamptz
    );
  end loop;
  for claim_item in select value from pg_catalog.jsonb_array_elements(p_payload -> 'claims') loop
    if claim_item ->> 'quotation' is not null and (
      not quote_allowed or pg_catalog.char_length(claim_item ->> 'quotation') > quote_limit
    ) then
      raise exception 'market_evidence_quotation_forbidden' using errcode = '22023';
    end if;
    insert into public.market_evidence_claims (
      organization_id, market_research_run_id, market_profile_version_id, claim_key, claim_digest,
      subject_kind, subject_ref, claim_kind, paraphrase, quotation, geographic_layer, geography_ref,
      freshness_class, published_at, observed_at, expires_at, limitations
    ) values (
      p_organization_id, run_row.id, run_row.market_profile_version_id, claim_item ->> 'key', claim_item ->> 'claimDigest',
      claim_item ->> 'subjectKind', claim_item ->> 'subjectRef', claim_item ->> 'claimKind', claim_item ->> 'paraphrase',
      nullif(claim_item ->> 'quotation', ''), claim_item ->> 'geographicLayer', claim_item ->> 'geographyRef',
      claim_item ->> 'freshnessClass', nullif(claim_item ->> 'publishedAt', '')::timestamptz,
      nullif(claim_item ->> 'observedAt', '')::timestamptz, (claim_item ->> 'expiresAt')::timestamptz,
      claim_item -> 'limitations'
    ) returning * into claim_row;
    insert into public.market_evidence_claim_events (
      organization_id, market_evidence_claim_id, event_type, event_digest, reason, occurred_at
    ) values (
      p_organization_id, claim_row.id, 'observed',
      pg_catalog.encode(extensions.digest(claim_row.claim_digest || '|observed', 'sha256'), 'hex'),
      null, pg_catalog.now()
    );
    for source_key in select value from pg_catalog.jsonb_array_elements_text(claim_item -> 'sourceKeys') value loop
      select source.* into source_row
      from public.market_evidence_sources source
      where source.organization_id = p_organization_id
        and source.market_research_run_id = run_row.id
        and source.source_key = source_key;
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

create function public.complete_market_research_run(
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
      and run_row.result_digest = p_result ->> 'resultDigest' then
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
      and run_row.result_digest = p_result ->> 'resultDigest' then
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

create function public.fail_market_research_run(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_market_research_run_id uuid,
  p_safe_failure_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
  run_row public.market_research_runs;
  failure jsonb;
begin
  if p_market_research_run_id is null
    or p_safe_failure_code is null
    or p_safe_failure_code !~ '^[A-Z][A-Z0-9_]{2,80}$' then
    raise exception 'market_research_failure_invalid' using errcode = '22023';
  end if;
  select run.* into run_row
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token;
  if found and run_row.status <> 'running' then
    if run_row.status = 'failed' and run_row.safe_failure_code = p_safe_failure_code then
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
    if run_row.status = 'failed' and run_row.safe_failure_code = p_safe_failure_code then
      return pg_catalog.jsonb_build_object(
        'runId', run_row.id, 'status', run_row.status, 'replayed', true
      );
    end if;
    raise exception 'market_research_run_terminal' using errcode = '23505';
  end if;

  update public.market_research_runs
  set status = 'failed', safe_failure_code = p_safe_failure_code,
      failed_at = pg_catalog.now()
  where organization_id = p_organization_id and id = run_row.id
  returning * into run_row;

  failure := public.fail_growth_intelligence_request(
    p_organization_id, p_request_id, p_claim_token, p_safe_failure_code
  );
  if failure ->> 'outcome' <> 'failed' then
    raise exception 'market_research_request_failure_failed' using errcode = '42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'runId', run_row.id, 'status', run_row.status, 'replayed', false
  );
end;
$$;

create function public.append_market_evidence_claim_event(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_event_type text,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
  claim_row public.market_evidence_claims;
  event_digest text;
  event_row public.market_evidence_claim_events;
  market_evidence_claim_id uuid;
begin
  if p_event_type not in ('expired', 'withdrawn', 'excluded', 'corrected', 'superseded')
    or not private.jsonb_object_has_exact_keys(p_event, array['claimId', 'reasonCode', 'occurredAt']::text[])
    or coalesce(p_event ->> 'claimId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_event ->> 'reasonCode', '') !~ '^[A-Z][A-Z0-9_]{2,80}$'
    or coalesce(p_event ->> 'occurredAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then
    raise exception 'market_evidence_claim_event_invalid' using errcode = '22023';
  end if;
  market_evidence_claim_id := (p_event ->> 'claimId')::uuid;
  request_row := private.assert_market_research_claim(p_organization_id, p_request_id, p_claim_token);
  select claim.* into claim_row
  from public.market_evidence_claims claim
  join public.market_research_runs run
    on run.organization_id = claim.organization_id
    and run.id = claim.market_research_run_id
  where claim.organization_id = p_organization_id
    and claim.id = market_evidence_claim_id
    and run.market_profile_version_id = request_row.market_profile_version_id
  for update of claim;
  if not found then
    raise exception 'market_evidence_claim_not_found' using errcode = '42501';
  end if;
  event_digest := pg_catalog.encode(
    extensions.digest(
      private.canonical_json_text(
        pg_catalog.jsonb_build_object(
          'claimId', market_evidence_claim_id,
          'eventType', p_event_type,
          'event', p_event
        )
      ),
      'sha256'
    ),
    'hex'
  );
  select event.* into event_row
  from public.market_evidence_claim_events event
  where event.organization_id = p_organization_id
    and event.market_evidence_claim_id = market_evidence_claim_id
    and event.event_digest = event_digest;
  if found then
    return pg_catalog.jsonb_build_object(
      'claimId', claim_row.id, 'eventId', event_row.id, 'replayed', true
    );
  end if;
  insert into public.market_evidence_claim_events (
    organization_id, market_evidence_claim_id, event_type, event_digest, reason, occurred_at
  ) values (
    p_organization_id, claim_row.id, p_event_type, event_digest,
    p_event ->> 'reasonCode', (p_event ->> 'occurredAt')::timestamptz
  ) returning * into event_row;
  return pg_catalog.jsonb_build_object(
    'claimId', claim_row.id, 'eventId', event_row.id, 'replayed', false
  );
end;
$$;

create function public.market_evidence_claim_current_state(
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
    else 'current'
  end;
$$;

-- Tenant reads remain session-bound. All writes pass through the fenced worker
-- operations above, so no client session can manufacture evidence or history.
alter table public.market_research_runs enable row level security;
alter table public.market_research_runs force row level security;
alter table public.market_evidence_sources enable row level security;
alter table public.market_evidence_sources force row level security;
alter table public.market_evidence_claims enable row level security;
alter table public.market_evidence_claims force row level security;
alter table public.market_evidence_claim_events enable row level security;
alter table public.market_evidence_claim_events force row level security;
alter table public.market_evidence_links enable row level security;
alter table public.market_evidence_links force row level security;

create policy "members with Growth Intelligence read research runs"
on public.market_research_runs
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read evidence sources"
on public.market_evidence_sources
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read evidence claims"
on public.market_evidence_claims
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read claim events"
on public.market_evidence_claim_events
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read evidence links"
on public.market_evidence_links
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

revoke all on table public.market_research_runs from public, anon, authenticated, service_role;
revoke all on table public.market_evidence_sources from public, anon, authenticated, service_role;
revoke all on table public.market_evidence_claims from public, anon, authenticated, service_role;
revoke all on table public.market_evidence_claim_events from public, anon, authenticated, service_role;
revoke all on table public.market_evidence_links from public, anon, authenticated, service_role;

grant select on table public.market_research_runs to authenticated;
grant select on table public.market_evidence_sources to authenticated;
grant select on table public.market_evidence_claims to authenticated;
grant select on table public.market_evidence_claim_events to authenticated;
grant select on table public.market_evidence_links to authenticated;

revoke all on function private.reject_market_evidence_immutable_mutation() from public, anon, authenticated, service_role;
revoke all on function private.enforce_market_research_run_mutation() from public, anon, authenticated, service_role;
revoke all on function private.assert_market_research_run_metadata(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.assert_market_research_result(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.assert_market_evidence_payload(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.assert_market_research_claim(uuid, uuid, uuid) from public, anon, authenticated, service_role;

revoke all on function public.begin_market_research_run(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.record_market_evidence_claims(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.complete_market_research_run(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.fail_market_research_run(uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.append_market_evidence_claim_event(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.market_evidence_claim_current_state(uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function public.begin_market_research_run(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.record_market_evidence_claims(uuid, uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.complete_market_research_run(uuid, uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.fail_market_research_run(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.append_market_evidence_claim_event(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.market_evidence_claim_current_state(uuid, uuid) to authenticated;
