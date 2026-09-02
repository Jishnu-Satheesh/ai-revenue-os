-- The original completion RPC declared a local variable named
-- `projection_document`, which made its table-column lookup ambiguous at the
-- first real completion. Keep the evidence contract unchanged and qualify the
-- column while using a distinct local variable.
create or replace function public.complete_governed_report_package_projection(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_projection_run_id uuid,
  p_claim_token uuid,
  p_result_digest text,
  p_result jsonb,
  p_outputs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.integration_report_projection_operations;
  run_row public.integration_report_projection_runs;
  package_row public.integration_report_packages;
  object_row storage.objects;
  output jsonb;
  projection_document_json jsonb;
  definition_row public.metric_definitions;
  observation_id uuid;
  final_status text;
begin
  if p_result_digest !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_result) <> 'object' or jsonb_typeof(p_outputs) <> 'array'
    or coalesce((select bool_or(key not in ('status', 'qualityState', 'completenessState', 'errorCodes', 'warningCodes')) from jsonb_object_keys(p_result) key), false)
    or p_result ->> 'status' not in ('projected', 'partially_projected', 'failed')
    or p_result ->> 'qualityState' not in ('complete', 'partial', 'failed')
    or p_result ->> 'completenessState' not in ('complete', 'partial', 'unavailable')
    or jsonb_array_length(p_outputs) > 50 then
    raise exception 'report projection evidence is invalid' using errcode = '22023';
  end if;
  select * into operation from private.integration_report_projection_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id for update;
  if not found or operation.projection_run_id <> p_projection_run_id or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then return null; end if;
  select * into run_row from public.integration_report_projection_runs
  where organization_id = p_organization_id and id = p_projection_run_id and status = 'running' for update;
  if not found then return null; end if;
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id and status = 'projecting' for update;
  if not found then return null; end if;
  select * into object_row from storage.objects where bucket_id = package_row.storage_bucket_id and name = package_row.storage_path;
  if not found or object_row.id <> package_row.storage_object_id or object_row.version <> package_row.storage_object_version then
    raise exception 'report projection object identity changed' using errcode = '23514';
  end if;
  select v.projection_document into projection_document_json
  from public.report_projection_versions v
  where v.organization_id = p_organization_id and v.id = run_row.report_projection_version_id;
  if p_result ->> 'status' = 'failed' and jsonb_array_length(p_outputs) <> 0 then
    raise exception 'failed projection cannot persist outputs' using errcode = '22023';
  end if;
  if p_result ->> 'status' <> 'failed' and jsonb_array_length(p_outputs) = 0 then
    raise exception 'successful projection requires outputs' using errcode = '22023';
  end if;
  for output in select value from jsonb_array_elements(p_outputs) loop
    if jsonb_typeof(output) <> 'object'
      or coalesce((select bool_or(key not in ('key', 'metricKey', 'metricDefinitionId', 'valueKind', 'valueNumerator', 'currency', 'normalizedSheetName', 'canonicalField', 'sourceColumnOrdinal', 'firstDataRow', 'lastDataRow', 'contributorCount', 'sourceDigest')) from jsonb_object_keys(output) key), false)
      or coalesce(output ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(output ->> 'metricKey', '') !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'
      or coalesce(output ->> 'metricDefinitionId', '') !~ '^[0-9a-f-]{36}$'
      or output ->> 'valueKind' not in ('money', 'count')
      or coalesce(output ->> 'valueNumerator', '') !~ '^-?[0-9]+$'
      or ((output ->> 'valueKind' = 'money') and coalesce(output ->> 'currency', '') <> package_row.declared_currency)
      or ((output ->> 'valueKind' = 'count') and output ? 'currency' and output ->> 'currency' is not null)
      or coalesce(output ->> 'normalizedSheetName', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(output ->> 'canonicalField', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce((output ->> 'sourceColumnOrdinal')::integer, 0) not between 1 and 250000
      or coalesce((output ->> 'firstDataRow')::integer, 0) not between 1 and 250000
      or coalesce((output ->> 'lastDataRow')::integer, -1) not between 0 and 250000
      or coalesce((output ->> 'contributorCount')::integer, -1) not between 0 and 250000
      or coalesce(output ->> 'sourceDigest', '') !~ '^[a-f0-9]{64}$' then
      raise exception 'report projection output evidence is invalid' using errcode = '22023';
    end if;
    if not exists (
      select 1 from jsonb_array_elements(projection_document_json -> 'outputs') expected
      where expected ->> 'key' = output ->> 'key' and expected ->> 'metricKey' = output ->> 'metricKey'
        and expected ->> 'valueKind' = output ->> 'valueKind'
        and expected ->> 'normalizedSheetName' = output ->> 'normalizedSheetName'
        and expected ->> 'canonicalField' = output ->> 'canonicalField'
    ) then raise exception 'projection output does not match binding' using errcode = '23514'; end if;
    select * into definition_row from public.metric_definitions
    where id = (output ->> 'metricDefinitionId')::uuid and key = output ->> 'metricKey'
      and value_kind = output ->> 'valueKind' and aggregation = 'sum' and is_active
      and (organization_id is null or organization_id = p_organization_id);
    if not found then raise exception 'projection metric definition is invalid' using errcode = '23514'; end if;
    insert into public.exact_range_metric_observations (
      organization_id, branch_id, channel_id, metric_definition_id, projection_output_key, value_kind,
      period_start, period_end, period_timezone, value_numerator, currency, quality_state, completeness_state,
      report_package_id, validation_run_id, report_contract_version_id, report_projection_version_id, projection_run_id
    ) values (
      p_organization_id, package_row.branch_id, package_row.channel_id, definition_row.id, output ->> 'key', output ->> 'valueKind',
      package_row.declared_period_start, package_row.declared_period_end, package_row.period_timezone,
      (output ->> 'valueNumerator')::numeric, case when output ->> 'valueKind' = 'money' then package_row.declared_currency else null end,
      case when p_result ->> 'qualityState' = 'partial' then 'partial' else 'complete' end,
      case when p_result ->> 'completenessState' = 'partial' then 'partial' else 'complete' end,
      p_report_package_id, run_row.validation_run_id, run_row.report_contract_version_id, run_row.report_projection_version_id, p_projection_run_id
    ) returning id into observation_id;
    insert into public.report_projection_lineage (
      organization_id, exact_range_metric_observation_id, report_package_id, validation_run_id, projection_run_id,
      report_contract_version_id, report_projection_version_id, normalized_sheet_name, canonical_field,
      source_column_ordinal, first_data_row, last_data_row, contributor_count, calculation_version,
      source_digest, quality_state, completeness_state
    ) values (
      p_organization_id, observation_id, p_report_package_id, run_row.validation_run_id, p_projection_run_id,
      run_row.report_contract_version_id, run_row.report_projection_version_id, output ->> 'normalizedSheetName', output ->> 'canonicalField',
      (output ->> 'sourceColumnOrdinal')::integer, (output ->> 'firstDataRow')::integer,
      (output ->> 'lastDataRow')::integer, (output ->> 'contributorCount')::integer, run_row.calculation_version,
      output ->> 'sourceDigest', case when p_result ->> 'qualityState' = 'partial' then 'partial' else 'complete' end,
      case when p_result ->> 'completenessState' = 'partial' then 'partial' else 'complete' end
    );
  end loop;
  final_status := p_result ->> 'status';
  update public.integration_report_projection_runs set status = final_status, quality_state = p_result ->> 'qualityState',
    completeness_state = p_result ->> 'completenessState', output_count = jsonb_array_length(p_outputs),
    result_digest = p_result_digest, error_codes = coalesce(p_result -> 'errorCodes', '[]'::jsonb),
    warning_codes = coalesce(p_result -> 'warningCodes', '[]'::jsonb), completed_at = now()
  where organization_id = p_organization_id and id = p_projection_run_id;
  update public.integration_report_packages set status = case final_status when 'projected' then 'projected' when 'partially_projected' then 'partially_projected' else 'projection_failed' end,
    safe_failure_code = case when final_status = 'failed' then coalesce(p_result -> 'errorCodes' ->> 0, 'PROJECTION_PROCESSING_FAILED') else null end,
    safe_failure_at = case when final_status = 'failed' then now() else null end
  where organization_id = p_organization_id and id = p_report_package_id returning * into package_row;
  return to_jsonb(package_row);
end;
$$;
