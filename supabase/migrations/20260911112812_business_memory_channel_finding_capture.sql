-- Spec 023 Task A1: channel_finding capture adapter.
--
-- The capture queue and leased runtime are live; complete_memory_capture_event
-- already dispatches channel_finding deliveries to
-- private.project_memory_channel_finding, which is created here together with
-- the registry row and the enqueue path inside complete_channel_analysis.
--
-- Digest canonicalization (fixed order, unit-separator joined, nulls collapse
-- to empty): detector_key | detector_version | kind | code | severity |
-- priority | metric_key | period_start | period_end | value_kind |
-- value_numerator | value_denominator | currency |
-- monetary_impact_minor_units | expected_period_count | observed_period_count |
-- absent_period_count | quality_state | needs_data_reason | limitations |
-- calculation_digest | channel_id | branch_id. Status is deliberately
-- excluded: the only permitted finding mutation is open->superseded, and that
-- enqueues a withdrawal below under its own digest (base canonical text plus
-- '|superseded|<superseding run>'), never a second recording. A different
-- reporting window is history, not supersession: the existing supersede
-- predicate only matches the same scope and window, so windows never withdraw
-- each other here.
--
-- Every row of the completed run is enqueued (observations, findings and
-- needs_data alike): each is a deterministic detector outcome, and the
-- projector records its kind so consumers can tell them apart.

insert into public.memory_capture_adapters (source_kind, registered, note) values
  ('channel_finding', true, 'Deterministic channel findings project to observation episodes; supersession enqueues withdrawal.')
on conflict (source_kind) do update set
  registered = excluded.registered,
  note = excluded.note;

-- Enqueue helper: one invocation enumerates only the given completed run.
-- Settings-gated (absent or disabled settings enqueue nothing), digest-gated
-- (an unchanged re-completion reuses the allocator revision and the
-- existence check skips the insert), transaction-local (a rolled-back
-- completion removes its events with it). Returns the events inserted.

create or replace function private.enqueue_memory_channel_findings(
  p_organization_id uuid,
  p_analysis_run_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture_on boolean;
  v_run public.channel_analysis_runs;
  v_finding public.channel_findings;
  v_canonical text;
  v_digest text;
  v_revision bigint;
  v_count integer := 0;
begin
  select settings_row.capture_enabled into v_capture_on
  from public.memory_integration_settings settings_row
  where settings_row.organization_id = p_organization_id;
  if not found or not v_capture_on then
    return 0;
  end if;

  select run_row.* into v_run
  from public.channel_analysis_runs run_row
  where run_row.organization_id = p_organization_id
    and run_row.id = p_analysis_run_id;
  if not found then
    return 0;
  end if;

  for v_finding in
    select finding_row.* from public.channel_findings finding_row
    where finding_row.organization_id = p_organization_id
      and finding_row.analysis_run_id = p_analysis_run_id
    order by finding_row.id
  loop
    v_canonical := pg_catalog.concat_ws(pg_catalog.chr(31),
      v_finding.detector_key,
      v_finding.detector_version::text,
      v_finding.kind,
      v_finding.code,
      coalesce(v_finding.severity, ''),
      coalesce(v_finding.priority::text, ''),
      coalesce(v_finding.metric_key, ''),
      coalesce(v_finding.period_start::text, ''),
      coalesce(v_finding.period_end::text, ''),
      coalesce(v_finding.value_kind, ''),
      coalesce(v_finding.value_numerator::text, ''),
      coalesce(v_finding.value_denominator::text, ''),
      coalesce(v_finding.currency, ''),
      coalesce(v_finding.monetary_impact_minor_units::text, ''),
      coalesce(v_finding.expected_period_count::text, ''),
      coalesce(v_finding.observed_period_count::text, ''),
      coalesce(v_finding.absent_period_count::text, ''),
      v_finding.quality_state,
      coalesce(v_finding.needs_data_reason, ''),
      v_finding.limitations::text,
      v_finding.calculation_digest,
      coalesce(v_finding.channel_id::text, ''),
      coalesce(v_finding.branch_id::text, ''));
    v_digest := pg_catalog.encode(extensions.digest(v_canonical, 'sha256'), 'hex');
    v_revision := private.allocate_memory_source_revision(
      p_organization_id, 'channel_finding', v_finding.id, v_digest);

    if not exists (
      select 1 from public.memory_capture_events existing
      where existing.organization_id = p_organization_id
        and existing.channel_finding_id = v_finding.id
        and existing.source_revision = v_revision
    ) then
      insert into public.memory_capture_events (
        organization_id, source_kind, channel_finding_id, source_revision,
        source_digest, event_kind, correlation_id, branch_id, channel_id,
        reporting_start, reporting_end, projection_document
      ) values (
        p_organization_id, 'channel_finding', v_finding.id, v_revision,
        v_digest, 'recorded', v_run.correlation_id, v_finding.branch_id,
        v_finding.channel_id,
        v_run.window_start::timestamptz, v_run.window_end::timestamptz,
        pg_catalog.jsonb_build_object(
          'findingId', v_finding.id,
          'analysisRunId', v_finding.analysis_run_id,
          'detectorKey', v_finding.detector_key,
          'detectorVersion', v_finding.detector_version,
          'kind', v_finding.kind,
          'code', v_finding.code,
          'severity', v_finding.severity,
          'priority', v_finding.priority,
          'channelId', v_finding.channel_id,
          'branchId', v_finding.branch_id,
          'periodStart', v_finding.period_start,
          'periodEnd', v_finding.period_end,
          'qualityState', v_finding.quality_state,
          'calculationDigest', v_finding.calculation_digest,
          'sourceRevision', v_revision)
      );
      v_count := v_count + 1;
    end if;
  end loop;

  -- Withdrawals: findings this run explicitly superseded, at their new
  -- (status-bearing) revision. Only explicit supersession enqueues here.
  for v_finding in
    select finding_row.* from public.channel_findings finding_row
    where finding_row.organization_id = p_organization_id
      and finding_row.superseded_by_run_id = p_analysis_run_id
      and finding_row.status = 'superseded'
    order by finding_row.id
  loop
    v_canonical := pg_catalog.concat_ws(pg_catalog.chr(31),
      v_finding.detector_key,
      v_finding.detector_version::text,
      v_finding.kind,
      v_finding.code,
      coalesce(v_finding.severity, ''),
      coalesce(v_finding.priority::text, ''),
      coalesce(v_finding.metric_key, ''),
      coalesce(v_finding.period_start::text, ''),
      coalesce(v_finding.period_end::text, ''),
      coalesce(v_finding.value_kind, ''),
      coalesce(v_finding.value_numerator::text, ''),
      coalesce(v_finding.value_denominator::text, ''),
      coalesce(v_finding.currency, ''),
      coalesce(v_finding.monetary_impact_minor_units::text, ''),
      coalesce(v_finding.expected_period_count::text, ''),
      coalesce(v_finding.observed_period_count::text, ''),
      coalesce(v_finding.absent_period_count::text, ''),
      v_finding.quality_state,
      coalesce(v_finding.needs_data_reason, ''),
      v_finding.limitations::text,
      v_finding.calculation_digest,
      coalesce(v_finding.channel_id::text, ''),
      coalesce(v_finding.branch_id::text, ''),
      'superseded',
      p_analysis_run_id::text);
    v_digest := pg_catalog.encode(extensions.digest(v_canonical, 'sha256'), 'hex');
    v_revision := private.allocate_memory_source_revision(
      p_organization_id, 'channel_finding', v_finding.id, v_digest);

    if not exists (
      select 1 from public.memory_capture_events existing
      where existing.organization_id = p_organization_id
        and existing.channel_finding_id = v_finding.id
        and existing.source_revision = v_revision
    ) then
      insert into public.memory_capture_events (
        organization_id, source_kind, channel_finding_id, source_revision,
        source_digest, event_kind, correlation_id, branch_id, channel_id,
        reporting_start, reporting_end, projection_document
      ) values (
        p_organization_id, 'channel_finding', v_finding.id, v_revision,
        v_digest, 'withdrawn', v_run.correlation_id, v_finding.branch_id,
        v_finding.channel_id,
        v_finding.period_start::timestamptz, v_finding.period_end::timestamptz,
        pg_catalog.jsonb_build_object(
          'findingId', v_finding.id,
          'analysisRunId', v_finding.analysis_run_id,
          'supersededByRunId', p_analysis_run_id,
          'code', v_finding.code,
          'sourceRevision', v_revision)
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.enqueue_memory_channel_findings(uuid, uuid) from public;

-- Projector: deterministic finding row to observation episode. Runs inside
-- complete_memory_capture_event's transaction via the leased worker path;
-- member sessions reach it only nested inside the fenced source RPCs, never
-- directly. The title is code-derived from the stored row; no text is
-- invented. Withdrawn deliveries project no new item: the withdrawal is
-- recorded on the event itself.

create or replace function private.project_memory_channel_finding(
  p_organization_id uuid,
  p_capture_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.memory_capture_events;
  v_finding public.channel_findings;
  v_title text;
  v_body text;
  v_item_id uuid;
begin
  select event_row.* into v_event
  from public.memory_capture_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.id = p_capture_id;
  if not found then
    raise exception 'memory capture event was not found' using errcode = 'P0002';
  end if;

  select finding_row.* into v_finding
  from public.channel_findings finding_row
  where finding_row.organization_id = v_event.organization_id
    and finding_row.id = v_event.channel_finding_id;
  if not found then
    raise exception 'memory capture source is withdrawn' using errcode = 'P0002';
  end if;
  if v_finding.organization_id is distinct from p_organization_id then
    raise exception 'memory capture source scope is not authorized' using errcode = '42501';
  end if;

  if v_event.event_kind = 'withdrawn' then
    return null;
  end if;

  v_title := pg_catalog.substring(
    v_finding.code || ' - ' || v_finding.detector_key, 1, 300);
  v_body := pg_catalog.substring(pg_catalog.concat_ws(E'\n',
    'Channel ' || v_finding.kind || ' ' || v_finding.code
      || ' from detector ' || v_finding.detector_key
      || ' (version ' || v_finding.detector_version::text || ').',
    'Scope: ' || case when v_finding.branch_id is null then 'organization-wide'
        else 'branch ' || v_finding.branch_id::text end
      || case when v_finding.channel_id is null then ''
        else ', channel ' || v_finding.channel_id::text end
      || '; window ' || coalesce(v_finding.period_start::text, 'unspecified')
      || ' to ' || coalesce(v_finding.period_end::text, 'unspecified') || '.',
    'Quality: ' || v_finding.quality_state
      || case when v_finding.severity is null then ''
        else '; severity ' || v_finding.severity
          || ', priority ' || v_finding.priority::text end || '.',
    'Evidence roots: finding ' || v_finding.id::text
      || ', analysis run ' || v_finding.analysis_run_id::text
      || ', calculation ' || v_finding.calculation_digest || '.',
    'Limitations: ' || v_finding.limitations::text
  ), 1, 2000);

  insert into public.memory_items (
    organization_id, branch_id, memory_type, title, body, origin,
    verification_state, sensitivity, knowledge_kind, capture_event_id,
    source_reference, observed_at, effective_from, effective_to, review_due_at
  ) values (
    p_organization_id, v_finding.branch_id, 'episode', v_title, v_body,
    'system_generated', 'unverified', v_event.sensitivity, 'observation',
    v_event.id,
    'channel_finding:' || v_finding.id::text,
    v_event.occurred_at, v_event.reporting_start, v_event.reporting_end,
    now() + interval '30 days'
  ) returning id into v_item_id;

  return v_item_id;
end;
$$;

revoke all on function private.project_memory_channel_finding(uuid, uuid) from public;

-- Forward replacement of complete_channel_analysis: byte-for-byte the
-- 20260826190000 definition (decimal ratio denominators), plus the single
-- capture enqueue before the return. Gap-fill, cap, snapshot and triage
-- semantics are untouched; grants are re-issued unchanged.

create or replace function public.complete_channel_analysis(
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
  v_ledger_citations integer;
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

    if (v_finding ->> 'kind' = 'finding') <> (v_finding ->> 'severity' is not null)
      or (v_finding ->> 'kind' = 'finding') <> (v_finding ->> 'priority' is not null)
      or (v_finding ->> 'severity' is not null and v_finding ->> 'severity' not in ('critical', 'high', 'medium', 'low'))
      or (v_finding ->> 'priority' is not null and coalesce((v_finding ->> 'priority')::integer, 0) not between 1 and 100)
      or (v_finding ->> 'kind' = 'needs_data') <> (v_finding ->> 'needsDataReason' is not null)
      or (v_finding ->> 'needsDataReason' is not null and v_finding ->> 'needsDataReason' !~ '^[A-Z][A-Z0-9_]{2,63}$') then
      raise exception 'channel analysis finding severity is invalid' using errcode = '22023';
    end if;

    if not exists (
      select 1 from jsonb_array_elements(run_row.detector_versions) declared
      where declared ->> 'key' = v_finding ->> 'detectorKey'
        and (declared ->> 'calculationVersion')::integer = (v_finding ->> 'detectorVersion')::integer
    ) then
      raise exception 'channel analysis finding names a detector the run did not bind' using errcode = '23514';
    end if;

    if (v_finding ->> 'valueKind' is not null and v_finding ->> 'valueKind' not in ('money', 'count', 'ratio'))
      or (v_finding ->> 'valueKind' is not null) <> (v_finding ->> 'valueNumerator' is not null)
      or (v_finding ->> 'valueNumerator' is not null and case when v_finding ->> 'valueKind' = 'ratio'
        then v_finding ->> 'valueNumerator' !~ '^-?[0-9]+(\.[0-9]{1,12})?$'
        else v_finding ->> 'valueNumerator' !~ '^-?[0-9]+$' end)
      or (v_finding ->> 'valueDenominator' is not null and case when v_finding ->> 'valueKind' = 'ratio'
        then v_finding ->> 'valueDenominator' !~ '^-?[0-9]+(\.[0-9]{1,12})?$'
        else v_finding ->> 'valueDenominator' !~ '^-?[0-9]+$' end)
      or (v_finding ->> 'monetaryImpactMinorUnits' is not null and v_finding ->> 'monetaryImpactMinorUnits' !~ '^-?[0-9]+$')
      or (v_finding ->> 'currency' is not null and v_finding ->> 'currency' !~ '^[A-Z]{3}$')
      or (v_finding ->> 'valueKind' = 'money' and v_finding ->> 'currency' is null)
      or (v_finding ->> 'valueKind' = 'ratio' and coalesce(v_finding ->> 'valueDenominator', '0') = '0')
      or (v_finding ->> 'kind' = 'needs_data' and (
        v_finding ->> 'valueKind' is not null or v_finding ->> 'monetaryImpactMinorUnits' is not null)) then
      raise exception 'channel analysis finding value is invalid' using errcode = '22023';
    end if;

    -- The addition. A figure derived from rows has to name them.
    if v_finding ->> 'valueKind' in ('money', 'ratio') then
      select count(*) into v_ledger_citations
      from jsonb_array_elements(coalesce(v_finding -> 'evidence', '[]'::jsonb)) citation
      where citation ->> 'kind' in ('normalized_metric', 'exact_range_metric_observation');
      if v_ledger_citations = 0 then
        raise exception 'channel analysis finding states a value it cites no evidence for' using errcode = '23514';
      end if;
    end if;

    for v_limitation in select value from jsonb_array_elements(coalesce(v_finding -> 'limitations', '[]'::jsonb)) loop
      if jsonb_typeof(v_limitation) <> 'string' or char_length(v_limitation #>> '{}') not between 1 and 300 then
        raise exception 'channel analysis finding limitation is invalid' using errcode = '22023';
      end if;
    end loop;

    if (v_finding ->> 'periodStart' is null) <> (v_finding ->> 'periodEnd' is null)
      or (v_finding ->> 'periodStart' is not null and (
        (v_finding ->> 'periodStart')::date < run_row.window_start
        or (v_finding ->> 'periodEnd')::date > run_row.window_end
        or (v_finding ->> 'periodEnd')::date < (v_finding ->> 'periodStart')::date)) then
      raise exception 'channel analysis finding period falls outside the declared window' using errcode = '23514';
    end if;

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

  -- Business Memory capture (Spec 023 Task A1): record this run's findings
  -- and withdraw the findings this run superseded. The helper no-ops when
  -- capture is disabled, so the completion above behaves exactly as before.
  perform private.enqueue_memory_channel_findings(p_organization_id, p_analysis_run_id);

  return to_jsonb(run_row);
end;
$$;

revoke all on function public.complete_channel_analysis(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_channel_analysis(uuid, uuid, uuid, text, jsonb)
  to service_role;
