-- Two fences the first channel-analysis migration left open.
--
-- Both are replacements rather than patches, because plpgsql has no way to
-- amend a statement in place. Nothing else about either function changes.

-- 1. A resumed claim must be the same question ---------------------------------
--
-- The lease is keyed on the run id, so a caller reusing a run id with a
-- different window or a different channel was handed the lease for the run that
-- already existed. The findings it then computed would describe window B while
-- the run recorded window A. The database refused the out-of-window ones, so
-- nothing wrong could be stored -- but a partial result under a misleading run
-- is worse than a refusal, and the projection path already answers this case
-- with `conflict`.
create or replace function public.claim_channel_analysis(
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

  if p_channel_id is not null then
    select * into channel_row from public.organization_channels c
    where c.organization_id = p_organization_id and c.id = p_channel_id;
    if not found or channel_row.status <> 'active' then
      return jsonb_build_object('outcome', 'not_found');
    end if;
  end if;

  if p_branch_id is not null then
    select b.timezone into window_timezone from public.branches b
    where b.organization_id = p_organization_id and b.id = p_branch_id;
    if window_timezone is null then return jsonb_build_object('outcome', 'not_found'); end if;
  else
    select o.default_timezone into window_timezone from public.organizations o where o.id = p_organization_id;
    if window_timezone is null then return jsonb_build_object('outcome', 'not_found'); end if;
  end if;

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
    -- The addition. A run answers one question, and a second attempt at it has
    -- to be that same question.
    if run_row.channel_id is distinct from p_channel_id
      or run_row.branch_id is distinct from p_branch_id
      or run_row.window_start <> p_window_start
      or run_row.window_end <> p_window_end
      or run_row.period_grain <> p_period_grain
      or run_row.window_timezone <> window_timezone
      or run_row.registry_version <> p_registry_version then
      return jsonb_build_object('outcome', 'conflict');
    end if;
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

-- 2. A money or ratio finding must cite the ledger ---------------------------------
--
-- `specs/018` section 10.4 requires every read-model number to resolve through
-- stored evidence. A count of zero cites nothing because there was nothing to
-- cite -- "no evidence is held" is a true statement about an empty set. A money
-- figure or a share is different: it was computed from rows, and a reader has to
-- be able to reach them.
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
  return to_jsonb(run_row);
end;
$$;

revoke all on function public.claim_channel_analysis(uuid, uuid, uuid, date, date, text, uuid, integer, jsonb, jsonb, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_channel_analysis(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_channel_analysis(uuid, uuid, uuid, date, date, text, uuid, integer, jsonb, jsonb, text, uuid, uuid) to service_role;
grant execute on function public.complete_channel_analysis(uuid, uuid, uuid, text, jsonb) to service_role;
