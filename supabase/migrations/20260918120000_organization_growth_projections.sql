-- Immutable fixed-projection storage and controlled publication (spec 027, D04).
--
-- One frozen original projection per organization, horizon and cycle. The row
-- is written once through the service-only publication RPC below and never
-- updated: a BEFORE UPDATE trigger refuses changes from every role, direct
-- table writes hold no grant for any client or worker role, and a duplicate
-- publication of the same identity replays the stored row without a second
-- audit event. The nightly mutable snapshot table keeps its own behavior;
-- no trim or retention path touches this table.
--
-- Error vocabulary (custom SQLSTATEs, asserted by the pgTAP suite):
--   PGR01 invalid envelope (shape, tenant-blind references, quality gates)
--   PGR02 source tenant mismatch (a referenced row belongs to another tenant)
--   PGR03 nonprospective period (starts at or before the org-local today)
--   PGR04 scheduling mismatch (off-grid dates, second origin, wrong timezone)
--   PGR05 invalid curve (range order, point density/order, unsafe integers)
--   PGR06 immutable row (any UPDATE attempt, every role included)

create table public.organization_growth_projections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  schedule_origin_date date not null,
  cycle_index integer not null check (cycle_index >= 0),
  horizon_months smallint not null check (horizon_months in (1, 3, 6, 12)),
  period_start date not null,
  period_end_exclusive date not null,
  issued_at timestamptz not null,
  source_cutoff_date date not null,
  timezone text not null check (char_length(timezone) between 1 and 60),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  metric_key text not null check (metric_key = 'revenue.gross'),
  scope_digest text not null check (scope_digest ~ '^[0-9a-f]{64}$'),
  input_digest text not null check (input_digest ~ '^[0-9a-f]{64}$'),
  document_version integer not null check (document_version = 1),
  method_version text not null check (method_version = 'even_pace_v1'),
  requires_growth_read boolean not null,
  requires_campaign_read boolean not null,
  frozen_document jsonb not null,
  created_at timestamptz not null default now(),
  check (period_end_exclusive > period_start),
  constraint organization_growth_projections_unique_identity
    unique (organization_id, horizon_months, cycle_index)
);

comment on table public.organization_growth_projections is
  'Frozen original growth projections, one per organization/horizon/cycle. Written once by publish_organization_growth_projection; never updated or trimmed.';

create index organization_growth_projections_active_period_idx
  on public.organization_growth_projections (organization_id, horizon_months, period_start desc);

-- Immutability ---------------------------------------------------------------
--
-- A digest column alone would only detect a rewrite; this trigger prevents
-- one. It fires before any UPDATE for every role, service_role included.

create or replace function private.refuse_organization_growth_projection_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Organization growth projections are immutable.'
    using errcode = 'PGR06';
  return null;
end;
$$;

revoke all on function private.refuse_organization_growth_projection_change() from public;

create trigger organization_growth_projections_refuse_update
before update on public.organization_growth_projections
for each row execute function private.refuse_organization_growth_projection_change();

-- Publication ----------------------------------------------------------------

create or replace function public.publish_organization_growth_projection(
  p_organization_id uuid,
  p_document jsonb,
  p_correlation_id uuid
)
returns table (projection_id uuid, digest text, published boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_status text;
  v_org_timezone text;
  v_today_local date;
  v_doc_org text;
  v_origin_text text;
  v_origin date;
  v_cycle numeric;
  v_cycle_index integer;
  v_horizon numeric;
  v_horizon_months smallint;
  v_start_text text;
  v_start date;
  v_end_text text;
  v_end date;
  v_issued_text text;
  v_issued timestamptz;
  v_cutoff_text text;
  v_cutoff date;
  v_doc_timezone text;
  v_currency text;
  v_metric_key text;
  v_low numeric;
  v_high numeric;
  v_expected_start date;
  v_expected_end date;
  v_partitions jsonb;
  v_partition_count integer;
  v_sources jsonb;
  v_source_count integer;
  v_assumptions jsonb;
  v_assumption_count integer;
  v_limitations jsonb;
  v_limitation_count integer;
  v_points jsonb;
  v_point_count integer;
  v_expected_days integer;
  v_scope_keys text[] := '{}';
  v_index integer;
  v_element jsonb;
  v_text text;
  v_number numeric;
  v_point_date date;
  v_anchor boolean;
  v_amount_low numeric;
  v_amount_central numeric;
  v_amount_high numeric;
  v_definition_org uuid;
  v_definition_active boolean;
  v_definition_kind text;
  v_definition_aggregation text;
  v_row_id uuid;
  v_source_org uuid;
  v_source_created timestamptz;
  v_source_superseded uuid;
  v_source_quality text;
  v_source_kind text;
  v_source_currency text;
  v_fraction_low numeric;
  v_fraction_high numeric;
  v_source_kind_lower text;
  v_needs_growth boolean := false;
  v_needs_campaign boolean := false;
  v_unknown_kind boolean := false;
  v_scope_digest text;
  v_input_digest text;
  v_existing_id uuid;
  v_existing_digest text;
  v_new_id uuid;
begin
  -- One publisher per organization at a time; the unique identity key below
  -- stays the authority, this lock only serializes the check-then-insert.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'organization_growth_projection:' || p_organization_id::text, 0
    )
  );

  if p_organization_id is null
    or p_correlation_id is null
    or p_document is null
    or pg_catalog.jsonb_typeof(p_document) <> 'object'
    or pg_catalog.pg_column_size(p_document) > 524288 then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end if;

  select status::text, default_timezone
    into v_org_status, v_org_timezone
    from public.organizations
    where id = p_organization_id;
  if not found or v_org_status = 'archived' then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end if;

  -- Envelope identity --------------------------------------------------------
  v_doc_org := p_document ->> 'organizationId';
  if v_doc_org is null or v_doc_org <> p_organization_id::text then
    raise exception 'Growth projection tenant does not match.' using errcode = 'PGR02';
  end if;

  begin
    v_origin_text := p_document ->> 'scheduleOriginDate';
    v_start_text := p_document ->> 'startDate';
    v_end_text := p_document ->> 'endDateExclusive';
    v_cutoff_text := p_document ->> 'sourceCutoffDate';
    v_issued_text := p_document ->> 'issuedAt';
    if v_origin_text is null or v_start_text is null or v_end_text is null
      or v_cutoff_text is null or v_issued_text is null
      or v_origin_text !~ '^\d{4}-\d{2}-\d{2}$'
      or v_start_text !~ '^\d{4}-\d{2}-\d{2}$'
      or v_end_text !~ '^\d{4}-\d{2}-\d{2}$'
      or v_cutoff_text !~ '^\d{4}-\d{2}-\d{2}$'
      or pg_catalog.position('T' in v_issued_text) = 0 then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end if;
    v_origin := v_origin_text::date;
    v_start := v_start_text::date;
    v_end := v_end_text::date;
    v_cutoff := v_cutoff_text::date;
    v_issued := v_issued_text::timestamptz;
    v_cycle := (p_document ->> 'cycleIndex')::numeric;
    v_horizon := (p_document ->> 'horizonMonths')::numeric;
    v_low := (p_document ->> 'monthlyLowMinor')::numeric;
    v_high := (p_document ->> 'monthlyHighMinor')::numeric;
  exception when others then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end;

  if v_cycle is null or v_cycle <> pg_catalog.trunc(v_cycle) or v_cycle < 0
    or v_horizon is null or v_horizon not in (1, 3, 6, 12)
    or v_start >= v_end then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end if;
  v_cycle_index := v_cycle::integer;
  v_horizon_months := v_horizon::smallint;

  v_currency := p_document ->> 'currency';
  if v_currency is null then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end if;
  v_currency := pg_catalog.upper(v_currency);
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end if;

  v_metric_key := p_document ->> 'metricKey';
  if v_metric_key is null or v_metric_key <> 'revenue.gross' then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end if;

  v_doc_timezone := p_document ->> 'timeZone';
  if v_doc_timezone is null or v_doc_timezone <> v_org_timezone then
    raise exception 'Growth projection schedule does not match.' using errcode = 'PGR04';
  end if;

  -- Schedule grid: boundaries recomputed from the origin every call, the same
  -- clamping rule the domain month stepper uses, so February never drifts.
  v_expected_start :=
    (v_origin + (v_horizon_months::integer * v_cycle_index || ' months')::interval)::date;
  v_expected_end :=
    (v_origin + (v_horizon_months::integer * (v_cycle_index + 1) || ' months')::interval)::date;
  if v_start <> v_expected_start or v_end <> v_expected_end then
    raise exception 'Growth projection schedule does not match.' using errcode = 'PGR04';
  end if;

  -- Prospective only: a start at or before the org-local today is hindsight.
  v_today_local := (pg_catalog.now() at time zone v_org_timezone)::date;
  if v_start <= v_today_local then
    raise exception 'Growth projection period already started.' using errcode = 'PGR03';
  end if;

  if v_cutoff > (v_issued at time zone v_org_timezone)::date then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end if;

  if exists (
    select 1 from public.organization_growth_projections
    where organization_id = p_organization_id
      and schedule_origin_date <> v_origin
  ) then
    raise exception 'Growth projection schedule does not match.' using errcode = 'PGR04';
  end if;

  -- Replay: the same identity returns the stored row untouched, even when the
  -- new candidate carries different numbers. No second audit event.
  select id, input_digest into v_existing_id, v_existing_digest
    from public.organization_growth_projections
    where organization_id = p_organization_id
      and horizon_months = v_horizon_months
      and cycle_index = v_cycle_index;
  if found then
    projection_id := v_existing_id;
    digest := v_existing_digest;
    published := false;
    return next;
    return;
  end if;

  -- Scope partitions ---------------------------------------------------------
  v_partitions := p_document -> 'scopePartitions';
  if v_partitions is null or pg_catalog.jsonb_typeof(v_partitions) <> 'array' then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end if;
  v_partition_count := pg_catalog.jsonb_array_length(v_partitions);
  if v_partition_count < 1 or v_partition_count > 100 then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end if;

  for v_index in 0 .. v_partition_count - 1 loop
    v_element := v_partitions -> v_index;
    if pg_catalog.jsonb_typeof(v_element) <> 'object' then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end if;
    v_text := v_element ->> 'partitionKey';
    if v_text is null or pg_catalog.char_length(v_text) < 1
      or pg_catalog.char_length(v_text) > 200
      or v_text = any (v_scope_keys) then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end if;
    v_scope_keys := v_scope_keys || v_text;

    begin
      v_text := v_element ->> 'metricDefinitionId';
      if v_text is null then
        raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
      end if;
      v_row_id := v_text::uuid;
    exception when others then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end;
    select organization_id, is_active, value_kind, aggregation
      into v_definition_org, v_definition_active, v_definition_kind, v_definition_aggregation
      from public.metric_definitions
      where id = v_row_id;
    if not found then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end if;
    if v_definition_org is not null and v_definition_org <> p_organization_id then
      raise exception 'Growth projection source belongs to another tenant.'
        using errcode = 'PGR02';
    end if;
    if not v_definition_active or v_definition_kind <> 'money'
      or v_definition_aggregation <> 'sum' then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end if;

    v_text := v_element ->> 'channelId';
    if v_text is not null then
      begin
        v_row_id := v_text::uuid;
      exception when others then
        raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
      end;
      select organization_id into v_source_org
        from public.organization_channels
        where id = v_row_id;
      if not found then
        raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
      end if;
      if v_source_org <> p_organization_id then
        raise exception 'Growth projection source belongs to another tenant.'
          using errcode = 'PGR02';
      end if;
    end if;

    v_text := v_element ->> 'branchId';
    if v_text is not null then
      begin
        v_row_id := v_text::uuid;
      exception when others then
        raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
      end;
      select organization_id into v_source_org
        from public.branches
        where id = v_row_id;
      if not found then
        raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
      end if;
      if v_source_org <> p_organization_id then
        raise exception 'Growth projection source belongs to another tenant.'
          using errcode = 'PGR02';
      end if;
    end if;

    v_text := v_element ->> 'dimensionsDigest';
    if v_text is null or pg_catalog.char_length(v_text) < 1
      or pg_catalog.char_length(v_text) > 256 then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end if;
    v_text := v_element ->> 'periodTimezone';
    if v_text is null or v_text <> v_doc_timezone then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end if;
  end loop;

  -- Sources: tenant-owned, current, complete, same-currency observations -----
  v_sources := p_document -> 'sources';
  if v_sources is null or pg_catalog.jsonb_typeof(v_sources) <> 'array' then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end if;
  v_source_count := pg_catalog.jsonb_array_length(v_sources);
  if v_source_count > 2000 then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end if;

  for v_index in 0 .. v_source_count - 1 loop
    v_element := v_sources -> v_index;
    if pg_catalog.jsonb_typeof(v_element) <> 'object' then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end if;
    v_source_kind := v_element ->> 'table';
    if v_source_kind is null
      or (v_source_kind <> 'normalized_metrics'
        and v_source_kind <> 'exact_range_metric_observations') then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end if;
    begin
      v_text := v_element ->> 'rowId';
      if v_text is null then
        raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
      end if;
      v_row_id := v_text::uuid;
      v_text := v_element ->> 'startDate';
      v_start_text := v_text;
      v_text := v_element ->> 'endDateExclusive';
      v_end_text := v_text;
      if v_start_text is null or v_end_text is null
        or v_start_text !~ '^\d{4}-\d{2}-\d{2}$'
        or v_end_text !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
      end if;
      if (v_start_text::date) >= (v_end_text::date) then
        raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
      end if;
      v_number := (v_element ->> 'amountMinor')::numeric;
      if v_number is null or v_number <> pg_catalog.trunc(v_number)
        or v_number > 9007199254740991 or v_number < -9007199254740991 then
        raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
      end if;
    exception when others then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end;
    v_text := v_element ->> 'partitionKey';
    if v_text is null or not (v_text = any (v_scope_keys)) then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end if;
    v_text := v_element ->> 'digest';
    if v_text is null or pg_catalog.char_length(v_text) < 1
      or pg_catalog.char_length(v_text) > 256 then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end if;

    if v_source_kind = 'normalized_metrics' then
      select organization_id, created_at, superseded_by_id, quality_tier,
             value_kind, currency
        into v_source_org, v_source_created, v_source_superseded,
             v_source_quality, v_definition_kind, v_source_currency
        from public.normalized_metrics
        where id = v_row_id;
      if not found then
        raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
      end if;
      if v_source_org <> p_organization_id then
        raise exception 'Growth projection source belongs to another tenant.'
          using errcode = 'PGR02';
      end if;
      if v_source_created > v_issued
        or v_source_superseded is not null
        or (v_source_quality <> 'measured' and v_source_quality <> 'derived')
        or v_definition_kind <> 'money'
        or v_source_currency is null or v_source_currency <> v_currency then
        raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
      end if;
    else
      select organization_id, created_at, superseded_by_id, quality_state,
             completeness_state, value_kind, currency
        into v_source_org, v_source_created, v_source_superseded,
             v_source_quality, v_text, v_definition_kind, v_source_currency
        from public.exact_range_metric_observations
        where id = v_row_id;
      if not found then
        raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
      end if;
      if v_source_org <> p_organization_id then
        raise exception 'Growth projection source belongs to another tenant.'
          using errcode = 'PGR02';
      end if;
      if v_source_created > v_issued
        or v_source_superseded is not null
        or v_source_quality <> 'complete'
        or v_text <> 'complete'
        or v_definition_kind <> 'money'
        or v_source_currency is null or v_source_currency <> v_currency then
        raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
      end if;
    end if;
  end loop;

  -- Action assumptions: fractions only, plus the permission derivation -------
  v_assumptions := p_document -> 'actionAssumptions';
  if v_assumptions is null or pg_catalog.jsonb_typeof(v_assumptions) <> 'array' then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end if;
  v_assumption_count := pg_catalog.jsonb_array_length(v_assumptions);
  if v_assumption_count > 50 then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end if;

  for v_index in 0 .. v_assumption_count - 1 loop
    v_element := v_assumptions -> v_index;
    if pg_catalog.jsonb_typeof(v_element) <> 'object' then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end if;
    v_source_kind := v_element ->> 'sourceKind';
    v_text := v_element ->> 'sourceId';
    if v_source_kind is null or pg_catalog.char_length(v_source_kind) < 1
      or pg_catalog.char_length(v_source_kind) > 80
      or v_text is null or pg_catalog.char_length(v_text) < 1
      or pg_catalog.char_length(v_text) > 200 then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end if;
    v_text := v_element ->> 'sourceRevision';
    if v_text is null or pg_catalog.char_length(v_text) < 1
      or pg_catalog.char_length(v_text) > 200 then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end if;
    begin
      v_text := v_element ->> 'citedFindingId';
      if v_text is null then
        raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
      end if;
      v_row_id := v_text::uuid;
      v_fraction_low := (v_element ->> 'lowFraction')::numeric;
      v_fraction_high := (v_element ->> 'highFraction')::numeric;
      if v_fraction_low is null or v_fraction_high is null
        or v_fraction_low < 0 or v_fraction_high > 1
        or v_fraction_low > v_fraction_high then
        raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
      end if;
    exception when others then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end;

    -- Permission derivation from admitted source kinds. Unknown provenance is
    -- read as the most restrictive combination; the mapping is reviewed with
    -- the advice qualification in a later task, never relaxed silently.
    v_source_kind_lower := pg_catalog.lower(v_source_kind);
    if v_source_kind_lower like 'campaign%' then
      v_needs_campaign := true;
    elsif v_source_kind_lower like 'growth%' then
      v_needs_growth := true;
    else
      v_unknown_kind := true;
    end if;
  end loop;
  if v_unknown_kind then
    v_needs_growth := true;
    v_needs_campaign := true;
  end if;

  -- Baseline window and limitations ------------------------------------------
  v_element := p_document -> 'baselineWindow';
  if v_element is null or pg_catalog.jsonb_typeof(v_element) <> 'object' then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end if;
  begin
    v_start_text := v_element ->> 'startDate';
    v_end_text := v_element ->> 'endDateExclusive';
    if v_start_text is null or v_end_text is null
      or (v_start_text::date) >= (v_end_text::date) then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end if;
  exception when others then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end;

  v_limitations := p_document -> 'limitations';
  if v_limitations is null or pg_catalog.jsonb_typeof(v_limitations) <> 'array' then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end if;
  v_limitation_count := pg_catalog.jsonb_array_length(v_limitations);
  if v_limitation_count > 20 then
    raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
  end if;
  for v_index in 0 .. v_limitation_count - 1 loop
    v_text := v_limitations ->> v_index;
    if v_text is null or pg_catalog.char_length(v_text) < 1
      or pg_catalog.char_length(v_text) > 300 then
      raise exception 'Growth projection envelope is invalid.' using errcode = 'PGR01';
    end if;
  end loop;

  -- Curve: dense day-end points behind one zero anchor ------------------------
  if v_low is null or v_high is null
    or v_low <> pg_catalog.trunc(v_low) or v_high <> pg_catalog.trunc(v_high)
    or v_low > v_high
    or v_low > 9007199254740991 or v_low < -9007199254740991
    or v_high > 9007199254740991 or v_high < -9007199254740991 then
    raise exception 'Growth projection curve is invalid.' using errcode = 'PGR05';
  end if;

  v_points := p_document -> 'points';
  if v_points is null or pg_catalog.jsonb_typeof(v_points) <> 'array' then
    raise exception 'Growth projection curve is invalid.' using errcode = 'PGR05';
  end if;
  v_point_count := pg_catalog.jsonb_array_length(v_points);
  v_expected_days := (v_end - v_start);
  if v_point_count < 1 or v_point_count > 368
    or v_point_count <> v_expected_days + 1 then
    raise exception 'Growth projection curve is invalid.' using errcode = 'PGR05';
  end if;

  for v_index in 0 .. v_point_count - 1 loop
    v_element := v_points -> v_index;
    if pg_catalog.jsonb_typeof(v_element) <> 'object' then
      raise exception 'Growth projection curve is invalid.' using errcode = 'PGR05';
    end if;
    begin
      v_text := v_element ->> 'date';
      if v_text is null or v_text !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Growth projection curve is invalid.' using errcode = 'PGR05';
      end if;
      v_point_date := v_text::date;
      v_text := v_element ->> 'anchor';
      if v_text is null or (v_text <> 'true' and v_text <> 'false') then
        raise exception 'Growth projection curve is invalid.' using errcode = 'PGR05';
      end if;
      v_anchor := v_text::boolean;
      v_amount_low := (v_element ->> 'lowMinor')::numeric;
      v_amount_central := (v_element ->> 'centralMinor')::numeric;
      v_amount_high := (v_element ->> 'highMinor')::numeric;
      if v_amount_low is null or v_amount_central is null or v_amount_high is null
        or v_amount_low <> pg_catalog.trunc(v_amount_low)
        or v_amount_central <> pg_catalog.trunc(v_amount_central)
        or v_amount_high <> pg_catalog.trunc(v_amount_high)
        or v_amount_low > 9007199254740991 or v_amount_low < -9007199254740991
        or v_amount_central > 9007199254740991 or v_amount_central < -9007199254740991
        or v_amount_high > 9007199254740991 or v_amount_high < -9007199254740991
        or v_amount_low > v_amount_central
        or v_amount_central > v_amount_high then
        raise exception 'Growth projection curve is invalid.' using errcode = 'PGR05';
      end if;
    exception when others then
      raise exception 'Growth projection curve is invalid.' using errcode = 'PGR05';
    end;
    if v_index = 0 then
      if not v_anchor or v_point_date <> v_start
        or v_amount_low <> 0 or v_amount_central <> 0 or v_amount_high <> 0 then
        raise exception 'Growth projection curve is invalid.' using errcode = 'PGR05';
      end if;
    elsif v_anchor or v_point_date <> (v_start + (v_index - 1)) then
      raise exception 'Growth projection curve is invalid.' using errcode = 'PGR05';
    end if;
  end loop;

  -- Digests are computed server-side from the canonical jsonb form, so the
  -- caller cannot claim an identity its content does not earn.
  v_scope_digest :=
    pg_catalog.encode(extensions.digest(v_partitions::text, 'sha256'), 'hex');
  v_input_digest :=
    pg_catalog.encode(extensions.digest(p_document::text, 'sha256'), 'hex');

  insert into public.organization_growth_projections (
    organization_id, schedule_origin_date, cycle_index, horizon_months,
    period_start, period_end_exclusive, issued_at, source_cutoff_date,
    timezone, currency, metric_key, scope_digest, input_digest,
    document_version, method_version,
    requires_growth_read, requires_campaign_read, frozen_document
  ) values (
    p_organization_id, v_origin, v_cycle_index, v_horizon_months,
    v_start, v_end, v_issued, v_cutoff,
    v_doc_timezone, v_currency, 'revenue.gross', v_scope_digest, v_input_digest,
    1, 'even_pace_v1',
    v_needs_growth, v_needs_campaign, p_document
  )
  returning id into v_new_id;

  -- Publication audit, atomically with the row: a failure above leaves
  -- neither half written. Payload carries period, method and digests only.
  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id,
    entity_type, entity_id, correlation_id, payload
  ) values (
    p_organization_id, 'organization.growth_projection_published',
    'system'::public.audit_actor_type, null,
    'growth_projection', v_new_id, p_correlation_id,
    pg_catalog.jsonb_build_object(
      'periodStart', v_start::text,
      'periodEndExclusive', v_end::text,
      'horizonMonths', v_horizon_months,
      'cycleIndex', v_cycle_index,
      'methodVersion', 'even_pace_v1',
      'scopeDigest', v_scope_digest,
      'inputDigest', v_input_digest
    )
  );

  projection_id := v_new_id;
  digest := v_input_digest;
  published := true;
  return next;
  return;
end;
$$;

revoke all on function public.publish_organization_growth_projection(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.publish_organization_growth_projection(uuid, jsonb, uuid)
  to service_role;

comment on function public.publish_organization_growth_projection(uuid, jsonb, uuid) is
  'Service-only fixed-projection publication. Validates envelope, tenant-owned sources, schedule grid and curve, then inserts the row and its audit event atomically. Replays return the stored identity.';

-- Access ----------------------------------------------------------------------
--
-- Members read through RLS; nobody writes through the table. The worker
-- publishes through the RPC above, never through a direct insert.

alter table public.organization_growth_projections enable row level security;
alter table public.organization_growth_projections force row level security;

create policy "members read gated projections"
on public.organization_growth_projections for select to authenticated
using (
  private.has_organization_permission(organization_id, 'channel.read')
  and (
    not requires_growth_read
    or private.has_organization_permission(organization_id, 'growth_intelligence.read')
  )
  and (
    not requires_campaign_read
    or private.has_organization_permission(organization_id, 'campaign.read')
  )
);

revoke all on table public.organization_growth_projections
  from public, anon, authenticated, service_role;
grant select on table public.organization_growth_projections to authenticated;
