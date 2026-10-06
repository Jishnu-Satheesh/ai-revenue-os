-- Task 5: private spend reservations, provider qualification, qualified retention.
--
-- Spend is concurrency-safe by construction, not by convention:
--
-- 1. private.growth_intelligence_research_day_allowances holds one row per
--    organization and local day. The database resolves the day from the
--    organization's own default_timezone (never a caller-supplied day, never a
--    UTC guess) and locks that row while a reservation is admitted, so two
--    concurrent reservations cannot overspend the USD 5 day allowance.
-- 2. private.growth_intelligence_research_budget_reservations holds one active
--    quote (capped at USD 1) per pipeline or per standalone request. The work
--    scope is an exclusive pipeline-or-request key: manual pipelines, weekly
--    synthesis and legacy paid research all draw from the same day ledger.
--    A reservation keeps its admission day forever, so a pipeline running
--    across midnight stays charged to the day that admitted it.
-- 3. private.growth_intelligence_research_attempt_ledger debits each attempt's
--    worst-case amount from its reservation before the external call, keyed by
--    the unique (reservation, phase, slot, attempt) tuple. Settlement records
--    reported, estimated or unknown usage; unknown keeps its full liability
--    until an explicit reconciliation, and actuals are never clamped to the
--    cap — an overrun is recorded and blocks further calls.
--
-- Qualification fails closed: the reserve RPCs refuse while the staged
-- provider record is missing, expired, missing rights, rates, credential,
-- model bounds or a passing canary. check_research_provider_qualification
-- answers safely (blocker codes only, no secrets).
--
-- Retention: admitted excerpts record their qualification version and
-- retain-until policy. The privileged erase RPC nulls payloads, marks sources
-- unavailable, withdraws derived claims (including derived text where the
-- obligation covers it) and writes explicit erased audit events, through a
-- narrow documented exception to the append-only evidence triggers. Safe IDs,
-- digests, decisions and events survive.
--
-- No browser or worker role holds any grant on the private ledgers; every
-- write passes through the fenced RPCs below. Money stays in integer micros
-- USD throughout.

-- Private ledgers ---------------------------------------------------------------

create table private.growth_intelligence_research_day_allowances (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  allowance_day date not null,
  allowance_micros_usd bigint not null default 5000000 check (allowance_micros_usd = 5000000),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (organization_id, allowance_day)
);

comment on table private.growth_intelligence_research_day_allowances is
  'One locked row per organization and local day. The USD 5 allowance is a fixed launch ceiling; raising it is a migration, not a caller input.';

-- Staged (possibly incomplete) qualification drafts live here; the reserve
-- RPCs are the gate, so every fail-closed path stays reachable in tests.
create table private.growth_intelligence_provider_qualifications (
  provider text primary key check (provider ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  agreement_version text not null,
  agreement_date date not null,
  agreement_expires_at timestamptz not null,
  permitted_uses text[] not null,
  retention_policy text not null,
  deletion_rules text not null,
  pricing_version text not null,
  search_rate_micros_usd bigint not null,
  credential_ready boolean not null default false,
  model_bounds jsonb not null,
  canary_result text check (canary_result is null or canary_result in ('passed', 'failed', 'pending')),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

comment on table private.growth_intelligence_provider_qualifications is
  'Staged provider qualification. No credential or signed contract text lives here: only version references, readiness flags and safe policy summaries.';

create table private.growth_intelligence_research_budget_reservations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  allowance_day date not null,
  pipeline_id uuid,
  request_id uuid,
  quote_micros_usd bigint not null check (quote_micros_usd between 1 and 1000000),
  price_version text not null check (pg_catalog.char_length(price_version) between 1 and 80),
  status text not null default 'active' check (status in ('active', 'released')),
  overrun_blocked boolean not null default false,
  released_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  foreign key (organization_id, allowance_day)
    references private.growth_intelligence_research_day_allowances(organization_id, allowance_day)
    on delete restrict,
  foreign key (organization_id, pipeline_id)
    references public.growth_intelligence_research_pipelines(organization_id, id)
    on delete restrict,
  foreign key (organization_id, request_id)
    references public.growth_intelligence_requests(organization_id, id)
    on delete restrict,
  check ((pipeline_id is null) <> (request_id is null)),
  check ((status = 'released') = (released_at is not null))
);

comment on table private.growth_intelligence_research_budget_reservations is
  'One admitted quote per pipeline or standalone request, charged to its admission day. Replay returns the row; it never books twice.';

create unique index growth_intelligence_research_budget_reservations_pipeline_key
  on private.growth_intelligence_research_budget_reservations (organization_id, pipeline_id)
  where pipeline_id is not null;

create unique index growth_intelligence_research_budget_reservations_request_key
  on private.growth_intelligence_research_budget_reservations (organization_id, request_id)
  where request_id is not null;

create table private.growth_intelligence_research_attempt_ledger (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  reservation_id uuid not null,
  phase text not null check (phase in ('research', 'synthesis')),
  slot_key text not null check (pg_catalog.char_length(slot_key) between 1 and 160),
  attempt_index integer not null check (attempt_index between 0 and 100),
  maximum_micros_usd bigint not null check (maximum_micros_usd between 1 and 1000000),
  status text not null default 'reserved' check (status in ('reserved', 'settled')),
  settlement_kind text check (settlement_kind is null or settlement_kind in ('reported', 'estimated', 'unknown')),
  actual_micros_usd bigint check (actual_micros_usd is null or actual_micros_usd between 0 and 50000000),
  settled_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, reservation_id, phase, slot_key, attempt_index),
  foreign key (organization_id, reservation_id)
    references private.growth_intelligence_research_budget_reservations(organization_id, id)
    on delete restrict,
  check ((status = 'reserved') = (settlement_kind is null and actual_micros_usd is null and settled_at is null)),
  check (settlement_kind is distinct from 'unknown' or actual_micros_usd is null),
  check (settlement_kind is null or settled_at is not null)
);

comment on table private.growth_intelligence_research_attempt_ledger is
  'Worst-case debits before each paid call plus immutable usage receipts. Unknown stays liable until explicit reconciliation; actuals are never clamped.';

create trigger growth_intelligence_research_day_allowances_set_updated_at
before update on private.growth_intelligence_research_day_allowances
for each row execute function public.set_updated_at();

create trigger growth_intelligence_provider_qualifications_set_updated_at
before update on private.growth_intelligence_provider_qualifications
for each row execute function public.set_updated_at();

create trigger growth_intelligence_research_budget_reservations_set_updated_at
before update on private.growth_intelligence_research_budget_reservations
for each row execute function public.set_updated_at();

-- Private ledgers stay outside every grant: fenced RPCs only ---------------------

alter table private.growth_intelligence_research_day_allowances enable row level security;
alter table private.growth_intelligence_research_day_allowances force row level security;
alter table private.growth_intelligence_provider_qualifications enable row level security;
alter table private.growth_intelligence_provider_qualifications force row level security;
alter table private.growth_intelligence_research_budget_reservations enable row level security;
alter table private.growth_intelligence_research_budget_reservations force row level security;
alter table private.growth_intelligence_research_attempt_ledger enable row level security;
alter table private.growth_intelligence_research_attempt_ledger force row level security;

revoke all on table private.growth_intelligence_research_day_allowances
  from public, anon, authenticated, service_role;
revoke all on table private.growth_intelligence_provider_qualifications
  from public, anon, authenticated, service_role;
revoke all on table private.growth_intelligence_research_budget_reservations
  from public, anon, authenticated, service_role;
revoke all on table private.growth_intelligence_research_attempt_ledger
  from public, anon, authenticated, service_role;

-- Private helpers ------------------------------------------------------------------

-- The organization's local day, resolved by the database from the stored
-- IANA timezone. An unknown timezone refuses rather than guessing UTC.
create function private.research_allowance_day(p_organization_id uuid)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowance_org_timezone text;
begin
  select organization.default_timezone into allowance_org_timezone
  from public.organizations organization
  where organization.id = p_organization_id;
  if not found then
    raise exception 'research_allowance_organization_not_found' using errcode = '42501';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_timezone_names zone where zone.name = allowance_org_timezone
  ) then
    raise exception 'research_allowance_timezone_invalid' using errcode = '22023';
  end if;
  return (pg_catalog.now() at time zone allowance_org_timezone)::date;
end;
$$;

revoke all on function private.research_allowance_day(uuid)
  from public, anon, authenticated, service_role;

-- Fail-closed qualification evaluation. An empty array means qualified; any
-- entry is a safe blocker code for the availability response.
create function private.research_provider_blockers()
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  blocker_qualification private.growth_intelligence_provider_qualifications;
  blocker_codes text[] := '{}';
  blocker_phase text;
  blocker_bounds jsonb;
begin
  select qualification.* into blocker_qualification
  from private.growth_intelligence_provider_qualifications qualification
  where qualification.provider = 'brave';
  if not found then
    return array['qualification_missing'];
  end if;
  if pg_catalog.btrim(blocker_qualification.agreement_version) = '' then
    blocker_codes := blocker_codes || 'agreement_missing';
  end if;
  if blocker_qualification.agreement_expires_at <= pg_catalog.now() then
    blocker_codes := blocker_codes || 'agreement_expired';
  end if;
  if not (blocker_qualification.permitted_uses @> array[
    'snippet_storage', 'commercial_inference', 'organization_display',
    'derived_claims', 'synthesis_reuse', 'agreed_retention'
  ]) then
    blocker_codes := blocker_codes || 'required_rights_missing';
  end if;
  if pg_catalog.btrim(blocker_qualification.pricing_version) = ''
    or blocker_qualification.search_rate_micros_usd <= 0 then
    blocker_codes := blocker_codes || 'rates_missing';
  end if;
  if not blocker_qualification.credential_ready then
    blocker_codes := blocker_codes || 'credential_missing';
  end if;
  if pg_catalog.jsonb_typeof(blocker_qualification.model_bounds) <> 'object' then
    blocker_codes := blocker_codes || 'model_bounds_missing';
  else
    foreach blocker_phase in array array['extraction', 'supportReview', 'synthesis'] loop
      blocker_bounds := blocker_qualification.model_bounds -> blocker_phase;
      if pg_catalog.jsonb_typeof(blocker_bounds) <> 'object'
        or coalesce(blocker_bounds ->> 'maxInputTokens', '') !~ '^[1-9][0-9]{0,6}$'
        or coalesce(blocker_bounds ->> 'maxOutputTokens', '') !~ '^[1-9][0-9]{0,6}$' then
        blocker_codes := blocker_codes || 'model_bounds_missing';
        exit;
      end if;
    end loop;
  end if;
  if blocker_qualification.canary_result is distinct from 'passed' then
    blocker_codes := blocker_codes || 'controlled_canary_missing';
  end if;
  return blocker_codes;
end;
$$;

revoke all on function private.research_provider_blockers()
  from public, anon, authenticated, service_role;

create function private.assert_research_provider_qualified()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  qualified_blockers text[];
begin
  qualified_blockers := private.research_provider_blockers();
  if pg_catalog.cardinality(qualified_blockers) > 0 then
    raise exception 'research_provider_not_qualified' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_research_provider_qualified()
  from public, anon, authenticated, service_role;

-- Retention schema: qualification, retain-until, erasure, review provenance -------

alter table public.market_evidence_sources
  add column excerpt_text text,
  add column excerpt_digest text,
  add column qualification_version text,
  add column retain_until timestamptz,
  add column erased_at timestamptz,
  add column erasure_reason_code text;

alter table public.market_evidence_sources
  add constraint market_evidence_sources_excerpt_check check (
    (
      excerpt_text is null
      and excerpt_digest is null
      and qualification_version is null
      and retain_until is null
    ) or (
      pg_catalog.char_length(excerpt_text) between 1 and 2000
      and excerpt_digest ~ '^[a-f0-9]{64}$'
      and pg_catalog.char_length(qualification_version) between 1 and 80
      and retain_until is not null
    )
  );

alter table public.market_evidence_sources
  add constraint market_evidence_sources_erasure_check check (
    ((erased_at is null) = (erasure_reason_code is null))
    and (
      erasure_reason_code is null
      or erasure_reason_code ~ '^[A-Z][A-Z0-9_]{2,80}$'
    )
    and (
      erased_at is null
      or availability in ('unavailable', 'excluded')
    )
  );

alter table public.market_evidence_claims
  add column text_withdrawn boolean not null default false;

alter table public.market_evidence_claims
  drop constraint market_evidence_claims_paraphrase_check;

alter table public.market_evidence_claims
  add constraint market_evidence_claims_paraphrase_check check (
    (text_withdrawn and paraphrase is null and quotation is null)
    or (not text_withdrawn and pg_catalog.char_length(paraphrase) between 1 and 1000)
  );

alter table public.market_evidence_links
  add column support_verdict text,
  add column reviewed_at timestamptz,
  add column reviewer_ref text;

alter table public.market_evidence_links
  add constraint market_evidence_links_support_review_check check (
    ((support_verdict is null) = (reviewed_at is null))
    and (
      support_verdict is null
      or support_verdict in ('supported', 'unsupported', 'uncertain')
    )
    and (
      reviewer_ref is null
      or pg_catalog.char_length(reviewer_ref) between 1 and 160
    )
  );

alter table public.market_evidence_claim_events
  drop constraint market_evidence_claim_events_event_type_check;

alter table public.market_evidence_claim_events
  add constraint market_evidence_claim_events_event_type_check check (
    event_type in (
      'observed', 'expired', 'withdrawn', 'excluded', 'corrected', 'superseded', 'erased'
    )
  );

-- Narrow erasure exception to the append-only evidence triggers --------------------
--
-- Ordinary evidence writes stay immutable. The privileged
-- erase_research_source_payload RPC alone may null a source payload and mark
-- it erased, or withdraw derived claim text; the transition shape below is
-- the whole exception, and anything else still raises.

create or replace function private.reject_market_evidence_immutable_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'market_evidence_delete_forbidden' using errcode = '55000';
  end if;
  if tg_table_name = 'market_evidence_sources' then
    if old.erased_at is null
      and new.erased_at is not null
      and new.excerpt_text is null
      and new.excerpt_digest is null
      and new.erasure_reason_code ~ '^[A-Z][A-Z0-9_]{2,80}$'
      and (new.availability = 'unavailable' or new.availability = 'excluded')
      and (old.availability <> 'available' or new.availability = 'unavailable')
      and new.safe_failure_code is not null
      and (
        old.safe_failure_code is not null
        or new.safe_failure_code = 'SOURCE_EVIDENCE_WITHDRAWN'
      )
      and old.id is not distinct from new.id
      and old.organization_id is not distinct from new.organization_id
      and old.market_research_run_id is not distinct from new.market_research_run_id
      and old.market_profile_version_id is not distinct from new.market_profile_version_id
      and old.source_key is not distinct from new.source_key
      and old.source_url is not distinct from new.source_url
      and old.source_domain is not distinct from new.source_domain
      and old.publisher is not distinct from new.publisher
      and old.source_class is not distinct from new.source_class
      and old.source_content_digest is not distinct from new.source_content_digest
      and old.quotation_characters is not distinct from new.quotation_characters
      and old.qualification_version is not distinct from new.qualification_version
      and old.retain_until is not distinct from new.retain_until
      and old.retrieved_at is not distinct from new.retrieved_at
      and old.published_at is not distinct from new.published_at
      and old.observed_at is not distinct from new.observed_at
      and old.created_at is not distinct from new.created_at then
      return new;
    end if;
  elsif tg_table_name = 'market_evidence_claims' then
    if not old.text_withdrawn
      and new.text_withdrawn
      and new.paraphrase is null
      and new.quotation is null
      and old.id is not distinct from new.id
      and old.organization_id is not distinct from new.organization_id
      and old.market_research_run_id is not distinct from new.market_research_run_id
      and old.market_profile_version_id is not distinct from new.market_profile_version_id
      and old.claim_key is not distinct from new.claim_key
      and old.claim_digest is not distinct from new.claim_digest
      and old.subject_kind is not distinct from new.subject_kind
      and old.subject_ref is not distinct from new.subject_ref
      and old.claim_kind is not distinct from new.claim_kind
      and old.geographic_layer is not distinct from new.geographic_layer
      and old.geography_ref is not distinct from new.geography_ref
      and old.freshness_class is not distinct from new.freshness_class
      and old.claim_category is not distinct from new.claim_category
      and old.freshness_registry_version is not distinct from new.freshness_registry_version
      and old.published_at is not distinct from new.published_at
      and old.observed_at is not distinct from new.observed_at
      and old.stale_at is not distinct from new.stale_at
      and old.expires_at is not distinct from new.expires_at
      and old.limitations is not distinct from new.limitations
      and old.created_at is not distinct from new.created_at then
      return new;
    end if;
  end if;
  raise exception 'market_evidence_immutable' using errcode = '55000';
end;
$$;

-- Admission accepts the new optional excerpt provenance fields ----------------------
--
-- Older payloads without the four provenance keys keep working: the exact-keys
-- check applies after subtracting them, so this stays backward compatible.

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
      source_item - array['excerptText', 'excerptDigest', 'qualificationVersion', 'retainUntil']::text[],
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
    or (source_item ->> 'availability' <> 'available' and source_item ->> 'safeFailureCode' is null)
    or (source_item ->> 'excerptText' is not null and pg_catalog.char_length(source_item ->> 'excerptText') not between 1 and 2000)
    or ((source_item ->> 'excerptText' is null) <> (source_item ->> 'excerptDigest' is null))
    or (source_item ->> 'excerptDigest' is not null and source_item ->> 'excerptDigest' !~ '^[a-f0-9]{64}$')
    or (source_item ->> 'qualificationVersion' is not null and pg_catalog.char_length(source_item ->> 'qualificationVersion') not between 1 and 80)
    or (source_item ->> 'retainUntil' is not null and source_item ->> 'retainUntil' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T')
    or (source_item ->> 'excerptText' is not null and (source_item ->> 'excerptDigest' is null or source_item ->> 'qualificationVersion' is null or source_item ->> 'retainUntil' is null)) then
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

-- Admission persists the excerpt provenance alongside the source ------------------

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
      safe_failure_code, quotation_characters, excerpt_text, excerpt_digest,
      qualification_version, retain_until, retrieved_at, published_at, observed_at
    ) values (
      p_organization_id, run_row.id, run_row.market_profile_version_id, source_item ->> 'key',
      source_item ->> 'url', source_item ->> 'domain', normalized_publisher,
      source_item ->> 'sourceClass', source_item ->> 'availability', nullif(source_item ->> 'contentDigest', ''),
      nullif(source_item ->> 'safeFailureCode', ''), source_quote_characters,
      nullif(source_item ->> 'excerptText', ''), nullif(source_item ->> 'excerptDigest', ''),
      nullif(source_item ->> 'qualificationVersion', ''),
      nullif(source_item ->> 'retainUntil', '')::timestamptz,
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

-- Spend reservation RPCs ------------------------------------------------------------
--
-- Every RPC below grants execute to signed-in members with the manage
-- permission and to workers under the service role. Tenant scope rides inside
-- each composite key, so one tenant can never book, debit, settle, release or
-- erase another tenant's rows.

create function public.reserve_research_pipeline_budget(
  p_organization_id uuid,
  p_pipeline_id uuid,
  p_quote_micros_usd bigint,
  p_price_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rpb_pipeline public.growth_intelligence_research_pipelines;
  rpb_existing private.growth_intelligence_research_budget_reservations;
  rpb_allowance_row private.growth_intelligence_research_day_allowances;
  rpb_allowance_day date;
  rpb_outstanding bigint;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage') then
    raise exception 'research_budget_forbidden' using errcode = '42501';
  end if;
  if p_pipeline_id is null
    or p_quote_micros_usd is null
    or p_quote_micros_usd not between 1 and 1000000
    or pg_catalog.char_length(coalesce(p_price_version, '')) not between 1 and 80 then
    raise exception 'research_budget_quote_invalid' using errcode = '22023';
  end if;
  select pipeline.* into rpb_pipeline
  from public.growth_intelligence_research_pipelines pipeline
  where pipeline.organization_id = p_organization_id
    and pipeline.id = p_pipeline_id
  for update;
  if not found then
    raise exception 'research_budget_pipeline_not_found' using errcode = '42501';
  end if;
  if rpb_pipeline.stage in (
    'ready', 'partial', 'no_findings', 'research_failed', 'synthesis_failed', 'cancelled'
  ) then
    raise exception 'research_budget_pipeline_closed' using errcode = '23505';
  end if;
  perform private.assert_research_provider_qualified();
  select reservation.* into rpb_existing
  from private.growth_intelligence_research_budget_reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.pipeline_id = p_pipeline_id;
  if found then
    if rpb_existing.quote_micros_usd is distinct from p_quote_micros_usd
      or rpb_existing.price_version is distinct from p_price_version then
      raise exception 'research_budget_reservation_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'reservationId', rpb_existing.id,
      'organizationId', rpb_existing.organization_id,
      'pipelineId', rpb_existing.pipeline_id,
      'allowanceDay', rpb_existing.allowance_day,
      'quoteMicrosUsd', rpb_existing.quote_micros_usd,
      'priceVersion', rpb_existing.price_version,
      'replayed', true
    );
  end if;
  rpb_allowance_day := private.research_allowance_day(p_organization_id);
  insert into private.growth_intelligence_research_day_allowances (
    organization_id, allowance_day
  ) values (p_organization_id, rpb_allowance_day)
  on conflict do nothing;
  select allowance.* into rpb_allowance_row
  from private.growth_intelligence_research_day_allowances allowance
  where allowance.organization_id = p_organization_id
    and allowance.allowance_day = rpb_allowance_day
  for update;
  select pg_catalog.coalesce(pg_catalog.sum(reservation.quote_micros_usd), 0)::bigint into rpb_outstanding
  from private.growth_intelligence_research_budget_reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.allowance_day = rpb_allowance_day
    and reservation.status = 'active';
  if rpb_outstanding + p_quote_micros_usd > 5000000 then
    raise exception 'research_budget_allowance_exceeded' using errcode = '23505';
  end if;
  insert into private.growth_intelligence_research_budget_reservations (
    organization_id, allowance_day, pipeline_id, quote_micros_usd, price_version
  ) values (
    p_organization_id, rpb_allowance_day, p_pipeline_id, p_quote_micros_usd, p_price_version
  ) returning * into rpb_existing;
  return pg_catalog.jsonb_build_object(
    'reservationId', rpb_existing.id,
    'organizationId', rpb_existing.organization_id,
    'pipelineId', rpb_existing.pipeline_id,
    'allowanceDay', rpb_existing.allowance_day,
    'quoteMicrosUsd', rpb_existing.quote_micros_usd,
    'priceVersion', rpb_existing.price_version,
    'replayed', false
  );
end;
$$;

revoke all on function public.reserve_research_pipeline_budget(uuid, uuid, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_research_pipeline_budget(uuid, uuid, bigint, text)
  to authenticated, service_role;

create function public.reserve_research_request_budget(
  p_organization_id uuid,
  p_request_id uuid,
  p_quote_micros_usd bigint,
  p_price_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rrb_request public.growth_intelligence_requests;
  rrb_existing private.growth_intelligence_research_budget_reservations;
  rrb_allowance_row private.growth_intelligence_research_day_allowances;
  rrb_allowance_day date;
  rrb_outstanding bigint;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage') then
    raise exception 'research_budget_forbidden' using errcode = '42501';
  end if;
  if p_request_id is null
    or p_quote_micros_usd is null
    or p_quote_micros_usd not between 1 and 1000000
    or pg_catalog.char_length(coalesce(p_price_version, '')) not between 1 and 80 then
    raise exception 'research_budget_quote_invalid' using errcode = '22023';
  end if;
  select request.* into rrb_request
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
  for update;
  if not found then
    raise exception 'research_budget_request_not_found' using errcode = '42501';
  end if;
  if rrb_request.kind not in ('market_research', 'weekly_synthesis', 'business_evidence_changed') then
    raise exception 'research_budget_request_not_billable' using errcode = '22023';
  end if;
  if rrb_request.status in ('succeeded', 'failed', 'cancelled') then
    raise exception 'research_budget_request_closed' using errcode = '23505';
  end if;
  perform private.assert_research_provider_qualified();
  select reservation.* into rrb_existing
  from private.growth_intelligence_research_budget_reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.request_id = p_request_id;
  if found then
    if rrb_existing.quote_micros_usd is distinct from p_quote_micros_usd
      or rrb_existing.price_version is distinct from p_price_version then
      raise exception 'research_budget_reservation_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'reservationId', rrb_existing.id,
      'organizationId', rrb_existing.organization_id,
      'requestId', rrb_existing.request_id,
      'allowanceDay', rrb_existing.allowance_day,
      'quoteMicrosUsd', rrb_existing.quote_micros_usd,
      'priceVersion', rrb_existing.price_version,
      'replayed', true
    );
  end if;
  rrb_allowance_day := private.research_allowance_day(p_organization_id);
  insert into private.growth_intelligence_research_day_allowances (
    organization_id, allowance_day
  ) values (p_organization_id, rrb_allowance_day)
  on conflict do nothing;
  select allowance.* into rrb_allowance_row
  from private.growth_intelligence_research_day_allowances allowance
  where allowance.organization_id = p_organization_id
    and allowance.allowance_day = rrb_allowance_day
  for update;
  select pg_catalog.coalesce(pg_catalog.sum(reservation.quote_micros_usd), 0)::bigint into rrb_outstanding
  from private.growth_intelligence_research_budget_reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.allowance_day = rrb_allowance_day
    and reservation.status = 'active';
  if rrb_outstanding + p_quote_micros_usd > 5000000 then
    raise exception 'research_budget_allowance_exceeded' using errcode = '23505';
  end if;
  insert into private.growth_intelligence_research_budget_reservations (
    organization_id, allowance_day, request_id, quote_micros_usd, price_version
  ) values (
    p_organization_id, rrb_allowance_day, p_request_id, p_quote_micros_usd, p_price_version
  ) returning * into rrb_existing;
  return pg_catalog.jsonb_build_object(
    'reservationId', rrb_existing.id,
    'organizationId', rrb_existing.organization_id,
    'requestId', rrb_existing.request_id,
    'allowanceDay', rrb_existing.allowance_day,
    'quoteMicrosUsd', rrb_existing.quote_micros_usd,
    'priceVersion', rrb_existing.price_version,
    'replayed', false
  );
end;
$$;

revoke all on function public.reserve_research_request_budget(uuid, uuid, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_research_request_budget(uuid, uuid, bigint, text)
  to authenticated, service_role;

-- One typed boundary for both work scopes: the scope argument is a
-- discriminated pipeline-or-request key, never two incompatible interfaces.
create function public.reserve_research_attempt(
  p_organization_id uuid,
  p_work_scope jsonb,
  p_phase text,
  p_slot_key text,
  p_attempt_index integer,
  p_maximum_micros_usd bigint,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rat_scope_id uuid;
  rat_reservation private.growth_intelligence_research_budget_reservations;
  rat_worker_request public.growth_intelligence_requests;
  rat_worker_request_id uuid;
  rat_existing private.growth_intelligence_research_attempt_ledger;
  rat_liability bigint;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage') then
    raise exception 'research_budget_forbidden' using errcode = '42501';
  end if;
  if not private.jsonb_object_has_exact_keys(p_work_scope, array['kind', 'id']::text[])
    or (p_work_scope ->> 'kind') not in ('pipeline', 'request')
    or coalesce(p_work_scope ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_phase, '') not in ('research', 'synthesis')
    or pg_catalog.char_length(coalesce(p_slot_key, '')) not between 1 and 160
    or p_attempt_index is null
    or p_attempt_index not between 0 and 100
    or p_maximum_micros_usd is null
    or p_maximum_micros_usd not between 1 and 1000000
    or p_claim_token is null then
    raise exception 'research_budget_attempt_invalid' using errcode = '22023';
  end if;
  rat_scope_id := (p_work_scope ->> 'id')::uuid;
  if p_work_scope ->> 'kind' = 'pipeline' then
    select reservation.* into rat_reservation
    from private.growth_intelligence_research_budget_reservations reservation
    where reservation.organization_id = p_organization_id
      and reservation.pipeline_id = rat_scope_id
    for update;
    if not found then
      raise exception 'research_budget_no_reservation' using errcode = '42501';
    end if;
    select
      case when p_phase = 'research'
        then pipeline.research_request_id
        else pipeline.synthesis_request_id
      end into rat_worker_request_id
    from public.growth_intelligence_research_pipelines pipeline
    where pipeline.organization_id = p_organization_id
      and pipeline.id = rat_scope_id;
    if rat_worker_request_id is null then
      raise exception 'research_budget_no_worker_request' using errcode = '42501';
    end if;
  else
    select reservation.* into rat_reservation
    from private.growth_intelligence_research_budget_reservations reservation
    where reservation.organization_id = p_organization_id
      and reservation.request_id = rat_scope_id
    for update;
    if not found then
      raise exception 'research_budget_no_reservation' using errcode = '42501';
    end if;
    rat_worker_request_id := rat_scope_id;
  end if;
  if rat_reservation.status <> 'active' then
    raise exception 'research_budget_reservation_released' using errcode = '23505';
  end if;
  select request.* into rat_worker_request
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = rat_worker_request_id;
  if not found
    or rat_worker_request.status <> 'claimed'
    or rat_worker_request.claim_token is distinct from p_claim_token
    or rat_worker_request.lease_expires_at <= pg_catalog.now() then
    raise exception 'research_budget_lease_stale' using errcode = '42501';
  end if;
  if exists (
    select 1 from private.growth_intelligence_research_attempt_ledger attempt
    where attempt.organization_id = p_organization_id
      and attempt.reservation_id = rat_reservation.id
      and attempt.actual_micros_usd is not null
      and attempt.actual_micros_usd > attempt.maximum_micros_usd
  ) then
    raise exception 'research_budget_overrun_blocked' using errcode = '23505';
  end if;
  select attempt.* into rat_existing
  from private.growth_intelligence_research_attempt_ledger attempt
  where attempt.organization_id = p_organization_id
    and attempt.reservation_id = rat_reservation.id
    and attempt.phase = p_phase
    and attempt.slot_key = p_slot_key
    and attempt.attempt_index = p_attempt_index;
  if found then
    if rat_existing.maximum_micros_usd is distinct from p_maximum_micros_usd then
      raise exception 'research_budget_attempt_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'attemptId', rat_existing.id,
      'reservationId', rat_reservation.id,
      'allowanceDay', rat_reservation.allowance_day,
      'maximumMicrosUsd', rat_existing.maximum_micros_usd,
      'replayed', true
    );
  end if;
  select pg_catalog.coalesce(pg_catalog.sum(
    case
      when attempt.status = 'reserved'
        or attempt.settlement_kind = 'unknown' then attempt.maximum_micros_usd
      else attempt.actual_micros_usd
    end
  ), 0)::bigint into rat_liability
  from private.growth_intelligence_research_attempt_ledger attempt
  where attempt.organization_id = p_organization_id
    and attempt.reservation_id = rat_reservation.id;
  if rat_liability + p_maximum_micros_usd > rat_reservation.quote_micros_usd then
    raise exception 'research_budget_reservation_exceeded' using errcode = '23505';
  end if;
  insert into private.growth_intelligence_research_attempt_ledger (
    organization_id, reservation_id, phase, slot_key, attempt_index, maximum_micros_usd
  ) values (
    p_organization_id, rat_reservation.id, p_phase, p_slot_key, p_attempt_index, p_maximum_micros_usd
  ) returning * into rat_existing;
  return pg_catalog.jsonb_build_object(
    'attemptId', rat_existing.id,
    'reservationId', rat_reservation.id,
    'allowanceDay', rat_reservation.allowance_day,
    'maximumMicrosUsd', rat_existing.maximum_micros_usd,
    'replayed', false
  );
end;
$$;

revoke all on function public.reserve_research_attempt(uuid, jsonb, text, text, integer, bigint, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_research_attempt(uuid, jsonb, text, text, integer, bigint, uuid)
  to authenticated, service_role;

create function public.settle_research_attempt(
  p_organization_id uuid,
  p_attempt_id uuid,
  p_usage jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stl_attempt private.growth_intelligence_research_attempt_ledger;
  stl_reservation private.growth_intelligence_research_budget_reservations;
  stl_kind text;
  stl_actual bigint;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage') then
    raise exception 'research_budget_forbidden' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(p_usage) <> 'object'
    or (p_usage ->> 'kind') not in ('reported', 'estimated', 'unknown') then
    raise exception 'research_budget_usage_invalid' using errcode = '22023';
  end if;
  stl_kind := p_usage ->> 'kind';
  if stl_kind = 'unknown' then
    if not private.jsonb_object_has_exact_keys(p_usage, array['kind']::text[]) then
      raise exception 'research_budget_usage_invalid' using errcode = '22023';
    end if;
    stl_actual := null;
  else
    if not private.jsonb_object_has_exact_keys(p_usage, array['kind', 'microsUsd']::text[])
      or coalesce(p_usage ->> 'microsUsd', '') !~ '^(0|[1-9][0-9]{0,7})$'
      or (p_usage ->> 'microsUsd')::bigint > 50000000 then
      raise exception 'research_budget_usage_invalid' using errcode = '22023';
    end if;
    stl_actual := (p_usage ->> 'microsUsd')::bigint;
  end if;
  select attempt.* into stl_attempt
  from private.growth_intelligence_research_attempt_ledger attempt
  where attempt.organization_id = p_organization_id
    and attempt.id = p_attempt_id
  for update;
  if not found then
    raise exception 'research_budget_attempt_not_found' using errcode = '42501';
  end if;
  select reservation.* into stl_reservation
  from private.growth_intelligence_research_budget_reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.id = stl_attempt.reservation_id
  for update;
  if stl_attempt.status = 'settled' and stl_attempt.settlement_kind in ('reported', 'estimated') then
    if stl_attempt.settlement_kind is not distinct from stl_kind
      and stl_attempt.actual_micros_usd is not distinct from stl_actual then
      return pg_catalog.jsonb_build_object(
        'attemptId', stl_attempt.id,
        'settlementKind', stl_attempt.settlement_kind,
        'actualMicrosUsd', stl_attempt.actual_micros_usd,
        'overrunBlocked', stl_reservation.overrun_blocked,
        'replayed', true
      );
    end if;
    raise exception 'research_budget_receipt_conflict' using errcode = '23505';
  end if;
  update private.growth_intelligence_research_attempt_ledger
  set status = 'settled',
      settlement_kind = stl_kind,
      actual_micros_usd = stl_actual,
      settled_at = pg_catalog.now()
  where organization_id = p_organization_id and id = p_attempt_id
  returning * into stl_attempt;
  -- Actuals are recorded, never clamped: an overrun blocks further calls.
  if stl_kind in ('reported', 'estimated') and stl_actual > stl_attempt.maximum_micros_usd then
    update private.growth_intelligence_research_budget_reservations
    set overrun_blocked = true
    where organization_id = p_organization_id and id = stl_reservation.id
    returning * into stl_reservation;
  end if;
  return pg_catalog.jsonb_build_object(
    'attemptId', stl_attempt.id,
    'settlementKind', stl_attempt.settlement_kind,
    'actualMicrosUsd', stl_attempt.actual_micros_usd,
    'overrunBlocked', stl_reservation.overrun_blocked,
    'replayed', false
  );
end;
$$;

revoke all on function public.settle_research_attempt(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.settle_research_attempt(uuid, uuid, jsonb)
  to authenticated, service_role;

create function public.release_research_budget_reservation(
  p_organization_id uuid,
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rlr_reservation private.growth_intelligence_research_budget_reservations;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage') then
    raise exception 'research_budget_forbidden' using errcode = '42501';
  end if;
  if p_reservation_id is null then
    raise exception 'research_budget_release_invalid' using errcode = '22023';
  end if;
  select reservation.* into rlr_reservation
  from private.growth_intelligence_research_budget_reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.id = p_reservation_id
  for update;
  if not found then
    raise exception 'research_budget_reservation_not_found' using errcode = '42501';
  end if;
  if rlr_reservation.status = 'released' then
    return pg_catalog.jsonb_build_object(
      'reservationId', rlr_reservation.id,
      'released', true,
      'replayed', true
    );
  end if;
  update private.growth_intelligence_research_budget_reservations
  set status = 'released',
      released_at = pg_catalog.now()
  where organization_id = p_organization_id and id = p_reservation_id
  returning * into rlr_reservation;
  return pg_catalog.jsonb_build_object(
    'reservationId', rlr_reservation.id,
    'released', true,
    'replayed', false
  );
end;
$$;

revoke all on function public.release_research_budget_reservation(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.release_research_budget_reservation(uuid, uuid)
  to authenticated, service_role;

-- Safe availability: blocker codes only, never secrets --------------------------------

create function public.check_research_provider_qualification()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cpq_blockers text[];
begin
  cpq_blockers := private.research_provider_blockers();
  return pg_catalog.jsonb_build_object(
    'provider', 'brave',
    'available', pg_catalog.cardinality(cpq_blockers) = 0,
    'blockers', pg_catalog.to_jsonb(cpq_blockers)
  );
end;
$$;

revoke all on function public.check_research_provider_qualification()
  from public, anon, authenticated, service_role;
grant execute on function public.check_research_provider_qualification()
  to authenticated, service_role;

-- Audited payload erasure ---------------------------------------------------------------
--
-- Service-role only: there is no user-facing route. Payloads are nulled, the
-- source renders unavailable, derived claims lose eligibility (and derived
-- text where the obligation covers it), and every affected claim keeps an
-- explicit erased audit event. Safe IDs, digests, decisions and events survive.

create function public.erase_research_source_payload(
  p_organization_id uuid,
  p_source_id uuid,
  p_reason_code text,
  p_include_derived_text boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ers_source public.market_evidence_sources;
  ers_claim_row public.market_evidence_claims;
  ers_erased_at timestamptz;
  ers_event_digest text;
  ers_affected integer := 0;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'research_erasure_forbidden' using errcode = '42501';
  end if;
  if p_source_id is null
    or coalesce(p_reason_code, '') !~ '^[A-Z][A-Z0-9_]{2,80}$'
    or p_include_derived_text is null then
    raise exception 'research_erasure_invalid' using errcode = '22023';
  end if;
  select source.* into ers_source
  from public.market_evidence_sources source
  where source.organization_id = p_organization_id
    and source.id = p_source_id
  for update;
  if not found then
    raise exception 'research_erasure_not_found' using errcode = '42501';
  end if;
  if ers_source.erased_at is not null then
    return pg_catalog.jsonb_build_object(
      'sourceId', ers_source.id,
      'erasedClaims', 0,
      'erasedAt', ers_source.erased_at,
      'replayed', true
    );
  end if;
  ers_erased_at := pg_catalog.now();
  update public.market_evidence_sources
  set excerpt_text = null,
      excerpt_digest = null,
      availability = case
        when ers_source.availability = 'available' then 'unavailable'
        else ers_source.availability
      end,
      safe_failure_code = coalesce(ers_source.safe_failure_code, 'SOURCE_EVIDENCE_WITHDRAWN'),
      erased_at = ers_erased_at,
      erasure_reason_code = p_reason_code
  where organization_id = p_organization_id and id = p_source_id;
  for ers_claim_row in
    select claim.*
    from public.market_evidence_claims claim
    join public.market_evidence_links link
      on link.organization_id = claim.organization_id
      and link.market_evidence_claim_id = claim.id
    where link.organization_id = p_organization_id
      and link.market_evidence_source_id = p_source_id
      and link.relation = 'supports'
  loop
    if p_include_derived_text and not ers_claim_row.text_withdrawn then
      update public.market_evidence_claims
      set paraphrase = null,
          quotation = null,
          text_withdrawn = true
      where organization_id = p_organization_id and id = ers_claim_row.id;
    end if;
    ers_event_digest := pg_catalog.encode(
      extensions.digest(
        ers_claim_row.claim_digest || '|erased|' || p_source_id::text, 'sha256'
      ),
      'hex'
    );
    insert into public.market_evidence_claim_events (
      organization_id, market_evidence_claim_id, event_type, event_digest, reason, occurred_at
    ) values (
      p_organization_id, ers_claim_row.id, 'erased', ers_event_digest, p_reason_code, ers_erased_at
    );
    ers_affected := ers_affected + 1;
  end loop;
  return pg_catalog.jsonb_build_object(
    'sourceId', p_source_id,
    'erasedClaims', ers_affected,
    'erasedAt', ers_erased_at,
    'replayed', false
  );
end;
$$;

revoke all on function public.erase_research_source_payload(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.erase_research_source_payload(uuid, uuid, text, boolean)
  to service_role;
