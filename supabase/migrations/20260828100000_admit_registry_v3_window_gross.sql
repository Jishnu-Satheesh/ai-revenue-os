-- Admit detector registry version 3.
--
-- Version 3 appends `revenue.window_gross`: the channel-scoped sum of reported
-- gross revenue over the analysed window, which gives the VerdictBand a cited
-- base instead of asking an organization-scoped share detector to answer a
-- channel run. The detector shipped in `src/domain/analysis/registry.ts` and
-- was verified with unit tests, which supply their own `claim`. This database
-- still admitted only versions 1 and 2, so every real run was refused at the
-- door with 22023 -- Trigger run `run_06g4f0oies2nfphcqb2kqbkb01`, reproduced
-- directly against staging. Nothing was left half-written, because the guard
-- fires before any insert.
--
-- Two places carry the list and both move together: the column check on
-- `channel_analysis_runs`, and the request guard inside
-- `claim_channel_analysis`. The function body below is otherwise exactly the
-- one migration 20260824000000 installed -- compared against the live
-- definition before this file was written, whitespace-normalised and equal --
-- so replacing it reverts nothing.
--
-- No new metric vocabulary is required. `revenue.window_gross` needs only
-- `revenue.gross`, which `metric_definitions` has admitted since version 1.

alter table public.channel_analysis_runs
  drop constraint channel_analysis_runs_registry_version_check;
alter table public.channel_analysis_runs
  add constraint channel_analysis_runs_registry_version_check
  check (registry_version in (1, 2, 3));

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
    -- The change. Version 3 adds `revenue.window_gross`; every other rule the
    -- fence applies to a request is untouched.
    or p_registry_version not in (1, 2, 3)
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
    -- A run answers one question, and a second attempt at it has to be that
    -- same question.
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
