-- Governed channel analysis: the first shipped detector slice.
--
-- Until now the platform could import a governed report and file its figures in
-- the metrics ledger, and then say nothing about them. This migration adds the
-- record of an analysis having run and the deterministic findings it produced.
--
-- Deliberately narrow, per `specs/018` section 11.2 "First shipped detector
-- slice". Four detectors ship, all core-owned, all running on evidence a
-- governed report package already produces. Recommendations, narration,
-- benchmarks, and every economics-dependent detector stay out; a detector
-- registered against vocabulary nothing writes answers `needs_data` forever.
-- See ADR 0031.
--
-- Nothing here is model-authored. Every value in `channel_findings` is computed
-- by a versioned deterministic detector and cites the rows it came from.

-- Analysis runs ----------------------------------------------------------------

-- `specs/018` section 11.3: one organization/channel/branch/window bound to the
-- exact metric and detector version tuples that ran over it.
--
-- `channel_id` is nullable, and that is a decision rather than laxity. Two of
-- the four shipped detectors answer a question about one channel; the fourth
-- asks how the channels compare, and has no single channel to bind to. A run
-- therefore names either one channel or none, and the registry runs exactly the
-- detectors whose declared scope matches. See ADR 0031.
create table public.channel_analysis_runs (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  channel_id uuid,
  branch_id uuid,
  -- Inclusive local calendar dates in `window_timezone`. Supplied by the
  -- caller; nothing here infers a window from whatever evidence happens to
  -- exist, because a window inferred from the data can never report a gap at
  -- its own edges.
  window_start date not null,
  window_end date not null,
  period_grain text not null check (period_grain in ('day', 'week', 'month')),
  window_timezone text not null check (char_length(window_timezone) between 1 and 60),
  registry_version integer not null check (registry_version = 1),
  -- What actually ran, key and calculation version, so a finding read a year
  -- from now resolves to the arithmetic that produced it rather than to
  -- whatever the registry says today.
  detector_versions jsonb not null check (
    jsonb_typeof(detector_versions) = 'array' and jsonb_array_length(detector_versions) between 1 and 50
  ),
  -- The metric definition ids the run bound its required vocabulary to,
  -- resolved by the database rather than accepted from the worker.
  metric_versions jsonb not null check (
    jsonb_typeof(metric_versions) = 'array' and jsonb_array_length(metric_versions) between 0 and 50
  ),
  input_digest text not null check (input_digest ~ '^[a-f0-9]{64}$'),
  result_digest text check (result_digest is null or result_digest ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('running', 'completed', 'failed')),
  finding_count integer not null default 0 check (finding_count between 0 and 500),
  observation_count integer not null default 0 check (observation_count between 0 and 500),
  needs_data_count integer not null default 0 check (needs_data_count between 0 and 500),
  safe_failure_code text,
  correlation_id uuid not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, channel_id)
    references public.organization_channels(organization_id, id) on delete restrict,
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete restrict,
  check (window_end >= window_start),
  -- A year of daily periods is the widest window worth one run. Wider is a
  -- reporting question, not an analysis one.
  check (window_end - window_start <= 400),
  check ((status = 'running') = (completed_at is null and result_digest is null)),
  check ((status = 'failed') = (safe_failure_code is not null))
);

comment on table public.channel_analysis_runs is
  'One deterministic analysis pass over one window. Records what ran and over which metric and detector versions; the numbers themselves live in channel_findings.';
comment on column public.channel_analysis_runs.channel_id is
  'The channel analysed, or null for a run whose detectors compare channels against each other.';

-- Findings ---------------------------------------------------------------------

-- All three outcomes a detector may return are stored here, distinguished by
-- `kind`. `needs_data` is a record rather than a silence on purpose: an
-- operator who cannot see that a detector had nothing to work with will read
-- its absence as "nothing wrong here".
create table public.channel_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  analysis_run_id uuid not null,
  -- The channel this particular figure is about. On a cross-channel run each
  -- finding names its own channel even though the run names none.
  channel_id uuid,
  branch_id uuid,
  detector_key text not null check (detector_key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  detector_version integer not null check (detector_version between 1 and 1000),
  kind text not null check (kind in ('observation', 'finding', 'needs_data')),
  -- What the outcome is, in the detector's own stable vocabulary.
  code text not null check (code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  severity text check (severity in ('critical', 'high', 'medium', 'low')),
  -- 1 is most urgent. Deterministic per detector; see ADR 0031. Null wherever
  -- the evidence does not support an ordering, which is most of this slice.
  priority integer check (priority between 1 and 100),
  metric_key text check (metric_key is null or metric_key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  metric_definition_id uuid references public.metric_definitions(id) on delete restrict,
  -- Inclusive local dates in the run's window timezone.
  period_start date,
  period_end date,
  value_kind text check (value_kind in ('money', 'count', 'ratio')),
  value_numerator numeric,
  -- The base a value is measured against where one exists: the prior period for
  -- a movement, the cross-channel total for a share. Unlike the two ledgers,
  -- a money finding may carry one, because a movement without its base is a
  -- number nobody can size.
  value_denominator numeric,
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  -- Signed integer minor units, and only where the detector declares the method
  -- by which it is computable. Never inferred, never modelled.
  monetary_impact_minor_units numeric,
  expected_period_count integer check (expected_period_count is null or expected_period_count between 0 and 10000),
  observed_period_count integer check (observed_period_count is null or observed_period_count between 0 and 10000),
  absent_period_count integer check (absent_period_count is null or absent_period_count between 0 and 10000),
  quality_state text not null check (quality_state in ('complete', 'partial')),
  needs_data_reason text check (needs_data_reason is null or needs_data_reason ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  limitations jsonb not null default '[]'::jsonb check (
    jsonb_typeof(limitations) = 'array' and jsonb_array_length(limitations) <= 10
      and pg_column_size(limitations) <= 4096
  ),
  -- Identifies the inputs and the version that produced this figure, so the
  -- same evidence run again is recognisably the same answer.
  calculation_digest text not null check (calculation_digest ~ '^[a-f0-9]{64}$'),
  status text not null default 'open' check (status in ('open', 'superseded')),
  superseded_by_run_id uuid,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, analysis_run_id)
    references public.channel_analysis_runs(organization_id, id) on delete restrict,
  foreign key (organization_id, superseded_by_run_id)
    references public.channel_analysis_runs(organization_id, id) on delete restrict,
  foreign key (organization_id, channel_id)
    references public.organization_channels(organization_id, id) on delete restrict,
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete restrict,
  -- Severity and priority belong to a quantified finding. An authoritative
  -- observation carries neither rather than carrying an invented one, and
  -- `needs_data` carries no value at all.
  check ((kind = 'finding') = (severity is not null)),
  check ((kind = 'finding') = (priority is not null)),
  check (kind <> 'needs_data' or (
    value_kind is null and value_numerator is null and value_denominator is null
      and monetary_impact_minor_units is null and needs_data_reason is not null
  )),
  check (kind = 'needs_data' or needs_data_reason is null),
  check ((value_kind is null) = (value_numerator is null)),
  check (value_kind <> 'money' or currency is not null),
  check (value_kind <> 'ratio' or (value_denominator is not null and value_denominator <> 0)),
  -- Every value in this slice is a sum of integer minor units or a whole count.
  check (value_numerator is null or value_numerator = trunc(value_numerator)),
  check (value_denominator is null or value_denominator = trunc(value_denominator)),
  check (monetary_impact_minor_units is null or monetary_impact_minor_units = trunc(monetary_impact_minor_units)),
  check ((period_start is null) = (period_end is null)),
  check (period_end is null or period_end >= period_start),
  check ((status = 'superseded') = (superseded_by_run_id is not null)),
  check ((superseded_by_run_id is null) = (superseded_at is null)),
  check (superseded_by_run_id is null or superseded_by_run_id <> analysis_run_id)
);

comment on table public.channel_findings is
  'Deterministic detector output. Never model-authored: every value is computed by a versioned detector from cited evidence.';
comment on column public.channel_findings.kind is
  'observation = an authoritative fact; finding = a quantified problem carrying severity; needs_data = the detector''s evidence contract was unsatisfied.';

-- Typed evidence references ------------------------------------------------------

-- `specs/018` section 11.3 requires typed evidence references. Each row names
-- exactly one stored record by tenant-composite foreign key, so a finding
-- cannot cite another tenant's row and cannot cite a row that has since been
-- removed.
create table public.channel_finding_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  finding_id uuid not null,
  evidence_kind text not null check (evidence_kind in (
    'normalized_metric', 'exact_range_metric_observation', 'report_projection_reconciliation', 'projection_run'
  )),
  -- What the cited record contributed. A reader can tell the period that moved
  -- from the period it moved against without re-deriving the calculation.
  evidence_role text not null check (evidence_role in (
    'subject_period', 'prior_period', 'component', 'denominator', 'held_evidence', 'gap_count'
  )),
  normalized_metric_id uuid,
  exact_range_metric_observation_id uuid,
  reconciliation_id uuid,
  projection_run_id uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, finding_id)
    references public.channel_findings(organization_id, id) on delete restrict,
  foreign key (organization_id, normalized_metric_id)
    references public.normalized_metrics(organization_id, id) on delete restrict,
  foreign key (organization_id, exact_range_metric_observation_id)
    references public.exact_range_metric_observations(organization_id, id) on delete restrict,
  foreign key (organization_id, reconciliation_id)
    references public.report_projection_reconciliations(organization_id, id) on delete restrict,
  foreign key (organization_id, projection_run_id)
    references public.integration_report_projection_runs(organization_id, id) on delete restrict,
  check (num_nonnulls(
    normalized_metric_id, exact_range_metric_observation_id, reconciliation_id, projection_run_id
  ) = 1),
  check (case evidence_kind
    when 'normalized_metric' then normalized_metric_id is not null
    when 'exact_range_metric_observation' then exact_range_metric_observation_id is not null
    when 'report_projection_reconciliation' then reconciliation_id is not null
    else projection_run_id is not null
  end)
);

comment on table public.channel_finding_evidence is
  'What a finding cites. Ledger citations must be current evidence; a reconciliation citation names an undecided question, which is a fact about the evidence rather than evidence itself.';

-- The worker lease ---------------------------------------------------------------

-- Keyed on the run rather than on the window, because re-analysing a window is
-- an ordinary act: new evidence arrives and the same days deserve a fresh
-- answer. Keying it on the window would make the first analysis the only one.
create table private.channel_analysis_operations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  analysis_run_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  input_digest text not null check (input_digest ~ '^[a-f0-9]{64}$'),
  claim_token uuid not null,
  lease_expires_at timestamptz not null,
  attempt_count integer not null default 1 check (attempt_count between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, analysis_run_id),
  foreign key (organization_id, analysis_run_id)
    references public.channel_analysis_runs(organization_id, id) on delete restrict
);

create index channel_analysis_runs_scope_idx
  on public.channel_analysis_runs (organization_id, channel_id, window_start desc, created_at desc);
create index channel_findings_open_idx
  on public.channel_findings (organization_id, channel_id, detector_key, period_start desc)
  where status = 'open';
create index channel_findings_run_idx
  on public.channel_findings (organization_id, analysis_run_id);
create index channel_finding_evidence_finding_idx
  on public.channel_finding_evidence (organization_id, finding_id);

-- Immutability -------------------------------------------------------------------

create function private.prevent_channel_analysis_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'channel_analysis_evidence_is_append_only' using errcode = '55000';
end;
$$;

-- A run is written once while it holds a lease and closed once. Nothing about
-- what it bound may change afterwards, or a finding's version tuple would stop
-- describing the arithmetic that produced it.
create function private.prevent_channel_analysis_run_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status <> 'running'
    or new.organization_id is distinct from old.organization_id
    or new.channel_id is distinct from old.channel_id
    or new.branch_id is distinct from old.branch_id
    or new.window_start is distinct from old.window_start
    or new.window_end is distinct from old.window_end
    or new.period_grain is distinct from old.period_grain
    or new.window_timezone is distinct from old.window_timezone
    or new.registry_version is distinct from old.registry_version
    or new.detector_versions is distinct from old.detector_versions
    or new.metric_versions is distinct from old.metric_versions
    or new.input_digest is distinct from old.input_digest
    or new.correlation_id is distinct from old.correlation_id
    or new.started_at is distinct from old.started_at
    or new.created_at is distinct from old.created_at
    or new.status not in ('completed', 'failed')
    or new.completed_at is null then
    raise exception 'channel_analysis_run_is_append_only' using errcode = '55000';
  end if;
  return new;
end;
$$;

-- One transition is permitted on a finding, and only one: a later run over the
-- same scope supersedes it. The figure itself never changes, because a
-- corrected number is a new finding from a new run and the operator has to be
-- able to see that the answer moved.
create function private.prevent_channel_finding_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'channel_finding_is_append_only' using errcode = '55000';
  end if;
  if old.status = 'open'
    and new.status = 'superseded'
    and new.superseded_by_run_id is not null
    and new.superseded_at is not null
    and new.organization_id is not distinct from old.organization_id
    and new.analysis_run_id is not distinct from old.analysis_run_id
    and new.detector_key is not distinct from old.detector_key
    and new.detector_version is not distinct from old.detector_version
    and new.kind is not distinct from old.kind
    and new.code is not distinct from old.code
    and new.severity is not distinct from old.severity
    and new.priority is not distinct from old.priority
    and new.value_numerator is not distinct from old.value_numerator
    and new.value_denominator is not distinct from old.value_denominator
    and new.monetary_impact_minor_units is not distinct from old.monetary_impact_minor_units
    and new.calculation_digest is not distinct from old.calculation_digest then
    return new;
  end if;
  raise exception 'channel_finding_is_append_only' using errcode = '55000';
end;
$$;

create trigger channel_analysis_runs_prevent_delete
before delete on public.channel_analysis_runs
for each row execute function private.prevent_channel_analysis_evidence_mutation();
create trigger channel_analysis_runs_prevent_mutation
before update on public.channel_analysis_runs
for each row execute function private.prevent_channel_analysis_run_mutation();
create trigger channel_findings_prevent_mutation
before update or delete on public.channel_findings
for each row execute function private.prevent_channel_finding_mutation();
create trigger channel_finding_evidence_prevent_mutation
before update or delete on public.channel_finding_evidence
for each row execute function private.prevent_channel_analysis_evidence_mutation();

-- Audit --------------------------------------------------------------------------

-- `specs/018` section 13 names `channel_analysis.completed` as a required
-- stable event. Counts and version tuples only: no value, no cell, no PII.
create function private.audit_channel_analysis_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
begin
  if tg_op = 'INSERT' then
    event_name := 'channel_analysis.started';
  elsif new.status = 'completed' then
    event_name := 'channel_analysis.completed';
  elsif new.status = 'failed' then
    event_name := 'channel_analysis.failed';
  else
    return new;
  end if;
  insert into public.audit_events (
    organization_id, event_name, actor_type, entity_type, entity_id, correlation_id, payload
  ) values (
    new.organization_id, event_name, 'system', 'channel_analysis_run', new.id, new.correlation_id,
    jsonb_build_object(
      'channelId', new.channel_id, 'branchId', new.branch_id,
      'windowStart', new.window_start, 'windowEnd', new.window_end,
      'periodGrain', new.period_grain, 'windowTimezone', new.window_timezone,
      'registryVersion', new.registry_version, 'detectorVersions', new.detector_versions,
      'metricVersions', new.metric_versions, 'status', new.status,
      'resultDigest', new.result_digest, 'findingCount', new.finding_count,
      'observationCount', new.observation_count, 'needsDataCount', new.needs_data_count,
      'failureCode', new.safe_failure_code)
  );
  return new;
end;
$$;

create trigger channel_analysis_runs_audit_insert
after insert on public.channel_analysis_runs
for each row execute function private.audit_channel_analysis_run();
create trigger channel_analysis_runs_audit_completion
after update on public.channel_analysis_runs
for each row when (old.status is distinct from new.status)
execute function private.audit_channel_analysis_run();

-- The fenced worker path -----------------------------------------------------------

-- Identity of what was asked for, not of what was found. Two requests for the
-- same window, grain, zone, registry, and version tuple are the same question;
-- the answer may legitimately differ once new evidence lands, which is why the
-- evidence itself is digested per finding instead.
create function private.channel_analysis_input_digest(
  p_organization_id uuid,
  p_channel_id uuid,
  p_branch_id uuid,
  p_window_start date,
  p_window_end date,
  p_period_grain text,
  p_window_timezone text,
  p_registry_version integer,
  p_detectors jsonb,
  p_metrics jsonb
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(concat_ws('|', p_organization_id, coalesce(p_channel_id::text, ''),
    coalesce(p_branch_id::text, ''), p_window_start, p_window_end, p_period_grain, p_window_timezone,
    p_registry_version, p_detectors::text, p_metrics::text), 'sha256'), 'hex')
$$;

create function public.claim_channel_analysis(
  p_organization_id uuid,
  p_channel_id uuid,
  p_branch_id uuid,
  p_window_start date,
  p_window_end date,
  p_period_grain text,
  p_analysis_run_id uuid,
  p_registry_version integer,
  p_detectors jsonb,
  p_metric_keys jsonb,
  p_idempotency_key text,
  p_claim_token uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  detector jsonb;
  metric_key text;
  definition_row public.metric_definitions;
  metric_versions jsonb := '[]'::jsonb;
  channel_row public.organization_channels;
  window_timezone text;
  operation private.channel_analysis_operations;
  run_row public.channel_analysis_runs;
  input_digest text;
begin
  if char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  if p_period_grain not in ('day', 'week', 'month')
    or p_window_start is null or p_window_end is null or p_window_end < p_window_start
    or p_window_end - p_window_start > 400
    or p_registry_version <> 1
    or jsonb_typeof(p_detectors) <> 'array'
    or jsonb_array_length(p_detectors) not between 1 and 50
    or jsonb_typeof(p_metric_keys) <> 'array'
    or jsonb_array_length(p_metric_keys) > 50 then
    raise exception 'channel analysis request is invalid' using errcode = '22023';
  end if;

  for detector in select value from jsonb_array_elements(p_detectors) loop
    if jsonb_typeof(detector) <> 'object'
      or coalesce((select bool_or(key not in ('key', 'calculationVersion')) from jsonb_object_keys(detector) key), false)
      or coalesce(detector ->> 'key', '') !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'
      or jsonb_typeof(detector -> 'calculationVersion') <> 'number'
      or (detector ->> 'calculationVersion')::numeric <> trunc((detector ->> 'calculationVersion')::numeric)
      or (detector ->> 'calculationVersion')::integer not between 1 and 1000 then
      raise exception 'channel analysis detector declaration is invalid' using errcode = '22023';
    end if;
  end loop;
  if (select count(distinct value ->> 'key') from jsonb_array_elements(p_detectors))
    <> jsonb_array_length(p_detectors) then
    raise exception 'channel analysis detector declaration is duplicated' using errcode = '22023';
  end if;

  -- Scope. A channel or branch that does not resolve in this tenant is not a
  -- reason to analyse everything instead.
  if p_channel_id is not null then
    select * into channel_row from public.organization_channels c
    where c.organization_id = p_organization_id and c.id = p_channel_id;
    if not found or channel_row.status <> 'active' then
      return jsonb_build_object('outcome', 'not_found');
    end if;
  end if;

  -- `specs/015` section 4.4 again: a window is stated in the branch's zone when
  -- the run names one, and the organization default only when it does not.
  if p_branch_id is not null then
    select b.timezone into window_timezone from public.branches b
    where b.organization_id = p_organization_id and b.id = p_branch_id;
    if window_timezone is null then return jsonb_build_object('outcome', 'not_found'); end if;
  else
    select o.default_timezone into window_timezone from public.organizations o where o.id = p_organization_id;
    if window_timezone is null then return jsonb_build_object('outcome', 'not_found'); end if;
  end if;

  -- The metric vocabulary the detectors require, resolved here rather than
  -- accepted from the worker. A key with no active definition means the run
  -- cannot honestly bind a version tuple, so it does not start.
  for metric_key in select value #>> '{}' from jsonb_array_elements(p_metric_keys) order by 1 loop
    if metric_key !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$' then
      raise exception 'channel analysis metric key is invalid' using errcode = '22023';
    end if;
    select * into definition_row from public.metric_definitions d
    where d.key = metric_key and d.is_active
      and (d.organization_id is null or d.organization_id = p_organization_id)
    order by (d.organization_id is not null) desc
    limit 1;
    if not found then
      return jsonb_build_object('outcome', 'not_ready', 'unresolvedMetricKey', metric_key);
    end if;
    metric_versions := metric_versions || jsonb_build_array(jsonb_build_object(
      'key', definition_row.key, 'metricDefinitionId', definition_row.id, 'valueKind', definition_row.value_kind));
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|', p_organization_id, p_analysis_run_id), 0));

  select * into operation from private.channel_analysis_operations
  where organization_id = p_organization_id and analysis_run_id = p_analysis_run_id for update;
  if found then
    if operation.idempotency_key <> p_idempotency_key then return jsonb_build_object('outcome', 'conflict'); end if;
    select * into run_row from public.channel_analysis_runs
    where organization_id = p_organization_id and id = p_analysis_run_id;
    if run_row.status <> 'running' then
      return jsonb_build_object('outcome', 'completed', 'analysisRunId', run_row.id);
    end if;
    if operation.claim_token <> p_claim_token and operation.lease_expires_at > now() then
      return jsonb_build_object('outcome', 'in_progress', 'analysisRunId', run_row.id);
    end if;
    update private.channel_analysis_operations set claim_token = p_claim_token,
      lease_expires_at = now() + interval '10 minutes', attempt_count = attempt_count + 1, updated_at = now()
    where organization_id = p_organization_id and analysis_run_id = p_analysis_run_id;
  else
    input_digest := private.channel_analysis_input_digest(p_organization_id, p_channel_id, p_branch_id,
      p_window_start, p_window_end, p_period_grain, window_timezone, p_registry_version, p_detectors, metric_versions);
    insert into public.channel_analysis_runs (
      id, organization_id, channel_id, branch_id, window_start, window_end, period_grain,
      window_timezone, registry_version, detector_versions, metric_versions, input_digest, status, correlation_id
    ) values (
      p_analysis_run_id, p_organization_id, p_channel_id, p_branch_id, p_window_start, p_window_end,
      p_period_grain, window_timezone, p_registry_version, p_detectors, metric_versions, input_digest,
      'running', p_correlation_id
    ) returning * into run_row;
    insert into private.channel_analysis_operations (
      organization_id, analysis_run_id, idempotency_key, input_digest, claim_token, lease_expires_at
    ) values (
      p_organization_id, p_analysis_run_id, p_idempotency_key, input_digest, p_claim_token, now() + interval '10 minutes'
    );
  end if;

  return jsonb_build_object('outcome', 'acquired', 'analysisRun', to_jsonb(run_row),
    'windowTimezone', run_row.window_timezone,
    'channel', case when p_channel_id is null then null
      else jsonb_build_object('id', channel_row.id, 'key', channel_row.key) end,
    'metrics', run_row.metric_versions);
end;
$$;

-- Called by the worker under the claim token and lease it already holds. Every
-- rule the TypeScript registry enforces is checked again here, because the
-- worker is not the authority on what may be recorded as a finding: the
-- detector version is checked against what the run bound, the metric against
-- what the run resolved, the period against the declared window, and every
-- cited ledger row against its own reconciliation state.
create function public.complete_channel_analysis(
  p_organization_id uuid,
  p_analysis_run_id uuid,
  p_claim_token uuid,
  p_result_digest text,
  p_findings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.channel_analysis_operations;
  run_row public.channel_analysis_runs;
  v_finding jsonb;
  v_evidence jsonb;
  v_limitation jsonb;
  v_finding_id uuid;
  v_metric_definition_id uuid;
  v_evidence_total integer := 0;
  v_detector_keys text[];
begin
  if p_result_digest !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_findings) <> 'array'
    or jsonb_array_length(p_findings) not between 1 and 500 then
    raise exception 'channel analysis result is invalid' using errcode = '22023';
  end if;

  select * into operation from private.channel_analysis_operations
  where organization_id = p_organization_id and analysis_run_id = p_analysis_run_id for update;
  if not found or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then
    return null;
  end if;
  select * into run_row from public.channel_analysis_runs
  where organization_id = p_organization_id and id = p_analysis_run_id and status = 'running' for update;
  if not found then return null; end if;

  for v_finding in select value from jsonb_array_elements(p_findings) loop
    if jsonb_typeof(v_finding) <> 'object'
      or coalesce((select bool_or(key not in ('detectorKey', 'detectorVersion', 'kind', 'code', 'severity',
        'priority', 'channelId', 'branchId', 'metricKey', 'periodStart', 'periodEnd', 'valueKind',
        'valueNumerator', 'valueDenominator', 'currency', 'monetaryImpactMinorUnits', 'expectedPeriodCount',
        'observedPeriodCount', 'absentPeriodCount', 'qualityState', 'needsDataReason', 'limitations',
        'calculationDigest', 'evidence')) from jsonb_object_keys(v_finding) key), false)
      or coalesce(v_finding ->> 'detectorKey', '') !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'
      or coalesce((v_finding ->> 'detectorVersion')::integer, 0) not between 1 and 1000
      or v_finding ->> 'kind' not in ('observation', 'finding', 'needs_data')
      or coalesce(v_finding ->> 'code', '') !~ '^[A-Z][A-Z0-9_]{2,63}$'
      or coalesce(v_finding ->> 'qualityState', '') not in ('complete', 'partial')
      or coalesce(v_finding ->> 'calculationDigest', '') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(coalesce(v_finding -> 'evidence', '[]'::jsonb)) <> 'array'
      or jsonb_typeof(coalesce(v_finding -> 'limitations', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(v_finding -> 'limitations', '[]'::jsonb)) > 10
      or jsonb_array_length(coalesce(v_finding -> 'evidence', '[]'::jsonb)) > 2000 then
      raise exception 'channel analysis finding is invalid' using errcode = '22023';
    end if;

    -- Severity belongs to a quantified finding and nothing else. An
    -- observation arriving with one would be a threshold nobody agreed to.
    if (v_finding ->> 'kind' = 'finding') <> (v_finding ->> 'severity' is not null)
      or (v_finding ->> 'kind' = 'finding') <> (v_finding ->> 'priority' is not null)
      or (v_finding ->> 'severity' is not null and v_finding ->> 'severity' not in ('critical', 'high', 'medium', 'low'))
      or (v_finding ->> 'priority' is not null and coalesce((v_finding ->> 'priority')::integer, 0) not between 1 and 100)
      or (v_finding ->> 'kind' = 'needs_data') <> (v_finding ->> 'needsDataReason' is not null)
      or (v_finding ->> 'needsDataReason' is not null and v_finding ->> 'needsDataReason' !~ '^[A-Z][A-Z0-9_]{2,63}$') then
      raise exception 'channel analysis finding severity is invalid' using errcode = '22023';
    end if;

    -- A detector that never ran cannot have produced a finding, and neither can
    -- a version of it the run did not bind.
    if not exists (
      select 1 from jsonb_array_elements(run_row.detector_versions) declared
      where declared ->> 'key' = v_finding ->> 'detectorKey'
        and (declared ->> 'calculationVersion')::integer = (v_finding ->> 'detectorVersion')::integer
    ) then
      raise exception 'channel analysis finding names a detector the run did not bind' using errcode = '23514';
    end if;

    -- Every value in this slice is a sum of integer minor units or a whole
    -- count. A decimal here would mean somebody divided and rounded.
    if (v_finding ->> 'valueKind' is not null and v_finding ->> 'valueKind' not in ('money', 'count', 'ratio'))
      or (v_finding ->> 'valueKind' is not null) <> (v_finding ->> 'valueNumerator' is not null)
      or (v_finding ->> 'valueNumerator' is not null and v_finding ->> 'valueNumerator' !~ '^-?[0-9]+$')
      or (v_finding ->> 'valueDenominator' is not null and v_finding ->> 'valueDenominator' !~ '^-?[0-9]+$')
      or (v_finding ->> 'monetaryImpactMinorUnits' is not null and v_finding ->> 'monetaryImpactMinorUnits' !~ '^-?[0-9]+$')
      or (v_finding ->> 'currency' is not null and v_finding ->> 'currency' !~ '^[A-Z]{3}$')
      or (v_finding ->> 'valueKind' = 'money' and v_finding ->> 'currency' is null)
      or (v_finding ->> 'valueKind' = 'ratio' and coalesce(v_finding ->> 'valueDenominator', '0') = '0')
      or (v_finding ->> 'kind' = 'needs_data' and (
        v_finding ->> 'valueKind' is not null or v_finding ->> 'monetaryImpactMinorUnits' is not null)) then
      raise exception 'channel analysis finding value is invalid' using errcode = '22023';
    end if;

    for v_limitation in select value from jsonb_array_elements(coalesce(v_finding -> 'limitations', '[]'::jsonb)) loop
      if jsonb_typeof(v_limitation) <> 'string' or char_length(v_limitation #>> '{}') not between 1 and 300 then
        raise exception 'channel analysis finding limitation is invalid' using errcode = '22023';
      end if;
    end loop;

    -- A figure filed outside the window the run declared is a figure about days
    -- nobody asked about.
    if (v_finding ->> 'periodStart' is null) <> (v_finding ->> 'periodEnd' is null)
      or (v_finding ->> 'periodStart' is not null and (
        (v_finding ->> 'periodStart')::date < run_row.window_start
        or (v_finding ->> 'periodEnd')::date > run_row.window_end
        or (v_finding ->> 'periodEnd')::date < (v_finding ->> 'periodStart')::date)) then
      raise exception 'channel analysis finding period falls outside the declared window' using errcode = '23514';
    end if;

    -- A run bound to one channel may not report about another. A run bound to
    -- none may, because comparing channels is the whole point of it.
    if (run_row.channel_id is not null and (v_finding ->> 'channelId')::uuid is distinct from run_row.channel_id)
      or (run_row.branch_id is not null and (v_finding ->> 'branchId')::uuid is distinct from run_row.branch_id) then
      raise exception 'channel analysis finding falls outside the run scope' using errcode = '23514';
    end if;

    v_metric_definition_id := null;
    if v_finding ->> 'metricKey' is not null then
      select (bound ->> 'metricDefinitionId')::uuid into v_metric_definition_id
      from jsonb_array_elements(run_row.metric_versions) bound
      where bound ->> 'key' = v_finding ->> 'metricKey';
      if v_metric_definition_id is null then
        raise exception 'channel analysis finding names a metric the run did not bind' using errcode = '23514';
      end if;
    end if;

    insert into public.channel_findings (
      organization_id, analysis_run_id, channel_id, branch_id, detector_key, detector_version, kind, code,
      severity, priority, metric_key, metric_definition_id, period_start, period_end, value_kind,
      value_numerator, value_denominator, currency, monetary_impact_minor_units, expected_period_count,
      observed_period_count, absent_period_count, quality_state, needs_data_reason, limitations, calculation_digest
    ) values (
      p_organization_id, p_analysis_run_id, (v_finding ->> 'channelId')::uuid, (v_finding ->> 'branchId')::uuid,
      v_finding ->> 'detectorKey', (v_finding ->> 'detectorVersion')::integer, v_finding ->> 'kind', v_finding ->> 'code',
      v_finding ->> 'severity', (v_finding ->> 'priority')::integer, v_finding ->> 'metricKey', v_metric_definition_id,
      (v_finding ->> 'periodStart')::date, (v_finding ->> 'periodEnd')::date, v_finding ->> 'valueKind',
      (v_finding ->> 'valueNumerator')::numeric, (v_finding ->> 'valueDenominator')::numeric, v_finding ->> 'currency',
      (v_finding ->> 'monetaryImpactMinorUnits')::numeric, (v_finding ->> 'expectedPeriodCount')::integer,
      (v_finding ->> 'observedPeriodCount')::integer, (v_finding ->> 'absentPeriodCount')::integer,
      v_finding ->> 'qualityState', v_finding ->> 'needsDataReason',
      coalesce(v_finding -> 'limitations', '[]'::jsonb), v_finding ->> 'calculationDigest'
    ) returning id into v_finding_id;

    for v_evidence in select value from jsonb_array_elements(coalesce(v_finding -> 'evidence', '[]'::jsonb)) loop
      v_evidence_total := v_evidence_total + 1;
      if v_evidence_total > 20000 then
        raise exception 'channel analysis cites more evidence than one run may record' using errcode = '23514';
      end if;
      if jsonb_typeof(v_evidence) <> 'object'
        or coalesce((select bool_or(key not in ('kind', 'role', 'id')) from jsonb_object_keys(v_evidence) key), false)
        or v_evidence ->> 'kind' not in ('normalized_metric', 'exact_range_metric_observation',
          'report_projection_reconciliation', 'projection_run')
        or v_evidence ->> 'role' not in ('subject_period', 'prior_period', 'component', 'denominator',
          'held_evidence', 'gap_count')
        or coalesce(v_evidence ->> 'id', '') !~ '^[0-9a-f-]{36}$' then
        raise exception 'channel analysis evidence reference is invalid' using errcode = '22023';
      end if;

      -- Held evidence is not fact. A finding may name the reconciliation record
      -- that holds it -- that is what tells the operator a decision is waiting
      -- -- but it may not cite the held figure as though it were settled.
      if v_evidence ->> 'kind' = 'normalized_metric' and not exists (
        select 1 from public.normalized_metrics m
        where m.organization_id = p_organization_id and m.id = (v_evidence ->> 'id')::uuid
          and m.reconciliation_state = 'current' and m.superseded_by_id is null
      ) then
        raise exception 'channel analysis cites metric evidence that is not current' using errcode = '23514';
      end if;
      if v_evidence ->> 'kind' = 'exact_range_metric_observation' and not exists (
        select 1 from public.exact_range_metric_observations o
        where o.organization_id = p_organization_id and o.id = (v_evidence ->> 'id')::uuid
          and o.reconciliation_state = 'current' and o.superseded_by_id is null
      ) then
        raise exception 'channel analysis cites exact range evidence that is not current' using errcode = '23514';
      end if;

      insert into public.channel_finding_evidence (
        organization_id, finding_id, evidence_kind, evidence_role, normalized_metric_id,
        exact_range_metric_observation_id, reconciliation_id, projection_run_id
      ) values (
        p_organization_id, v_finding_id, v_evidence ->> 'kind', v_evidence ->> 'role',
        case when v_evidence ->> 'kind' = 'normalized_metric' then (v_evidence ->> 'id')::uuid end,
        case when v_evidence ->> 'kind' = 'exact_range_metric_observation' then (v_evidence ->> 'id')::uuid end,
        case when v_evidence ->> 'kind' = 'report_projection_reconciliation' then (v_evidence ->> 'id')::uuid end,
        case when v_evidence ->> 'kind' = 'projection_run' then (v_evidence ->> 'id')::uuid end
      );
    end loop;
  end loop;

  -- A later answer over the same question replaces the earlier one, and the
  -- earlier one stays readable. Scoped by the run's own window and by the
  -- detectors this run actually carried, so re-running one detector does not
  -- retire the output of another that did not run.
  select array_agg(distinct value ->> 'detectorKey') into v_detector_keys from jsonb_array_elements(p_findings);
  update public.channel_findings f
  set status = 'superseded', superseded_by_run_id = p_analysis_run_id, superseded_at = now()
  from public.channel_analysis_runs prior
  where f.organization_id = p_organization_id
    and f.analysis_run_id = prior.id
    and prior.organization_id = p_organization_id
    and prior.id <> p_analysis_run_id
    and prior.channel_id is not distinct from run_row.channel_id
    and prior.branch_id is not distinct from run_row.branch_id
    and prior.window_start = run_row.window_start
    and prior.window_end = run_row.window_end
    and prior.period_grain = run_row.period_grain
    and f.detector_key = any (v_detector_keys)
    and f.status = 'open';

  update public.channel_analysis_runs set status = 'completed', result_digest = p_result_digest,
    finding_count = (select count(*) from jsonb_array_elements(p_findings) v where v.value ->> 'kind' = 'finding'),
    observation_count = (select count(*) from jsonb_array_elements(p_findings) v where v.value ->> 'kind' = 'observation'),
    needs_data_count = (select count(*) from jsonb_array_elements(p_findings) v where v.value ->> 'kind' = 'needs_data'),
    completed_at = now()
  where organization_id = p_organization_id and id = p_analysis_run_id returning * into run_row;
  return to_jsonb(run_row);
end;
$$;

create function public.fail_channel_analysis(
  p_organization_id uuid,
  p_analysis_run_id uuid,
  p_claim_token uuid,
  p_failure_code text,
  p_result_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.channel_analysis_operations;
  run_row public.channel_analysis_runs;
begin
  -- A short, closed vocabulary. A failure an operator cannot read is a failure
  -- nobody acts on.
  if p_failure_code not in ('EVIDENCE_UNAVAILABLE', 'WINDOW_CONTEXT_UNAVAILABLE',
    'DETECTOR_REGISTRY_MISMATCH', 'ANALYSIS_PROCESSING_FAILED')
    or p_result_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'channel analysis failure is invalid' using errcode = '22023';
  end if;
  select * into operation from private.channel_analysis_operations
  where organization_id = p_organization_id and analysis_run_id = p_analysis_run_id for update;
  if not found or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then
    return null;
  end if;
  select * into run_row from public.channel_analysis_runs
  where organization_id = p_organization_id and id = p_analysis_run_id and status = 'running' for update;
  if not found then return null; end if;
  update public.channel_analysis_runs set status = 'failed', safe_failure_code = p_failure_code,
    result_digest = p_result_digest, completed_at = now()
  where organization_id = p_organization_id and id = p_analysis_run_id returning * into run_row;
  return to_jsonb(run_row);
end;
$$;

-- Row level security ---------------------------------------------------------------

revoke all on function private.prevent_channel_analysis_evidence_mutation() from public;
revoke all on function private.prevent_channel_analysis_run_mutation() from public;
revoke all on function private.prevent_channel_finding_mutation() from public;
revoke all on function private.audit_channel_analysis_run() from public;
revoke all on function private.channel_analysis_input_digest(uuid, uuid, uuid, date, date, text, text, integer, jsonb, jsonb) from public;
revoke all on table public.channel_analysis_runs, public.channel_findings, public.channel_finding_evidence
  from public, anon, authenticated;
revoke all on table private.channel_analysis_operations from public, anon, authenticated;

alter table public.channel_analysis_runs enable row level security;
alter table public.channel_analysis_runs force row level security;
alter table public.channel_findings enable row level security;
alter table public.channel_findings force row level security;
alter table public.channel_finding_evidence enable row level security;
alter table public.channel_finding_evidence force row level security;
alter table private.channel_analysis_operations enable row level security;
alter table private.channel_analysis_operations force row level security;

-- Readable, never writable, from a session. The only way a finding is created
-- is a fenced worker holding a lease.
create policy "members with report read can view channel analysis runs"
on public.channel_analysis_runs for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view channel findings"
on public.channel_findings for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view channel finding evidence"
on public.channel_finding_evidence for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));

grant select on table public.channel_analysis_runs, public.channel_findings, public.channel_finding_evidence
  to authenticated;

revoke all on function public.claim_channel_analysis(uuid, uuid, uuid, date, date, text, uuid, integer, jsonb, jsonb, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_channel_analysis(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_channel_analysis(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_channel_analysis(uuid, uuid, uuid, date, date, text, uuid, integer, jsonb, jsonb, text, uuid, uuid) to service_role;
grant execute on function public.complete_channel_analysis(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.fail_channel_analysis(uuid, uuid, uuid, text, text) to service_role;
