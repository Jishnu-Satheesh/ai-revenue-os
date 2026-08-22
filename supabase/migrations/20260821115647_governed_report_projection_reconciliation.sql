-- Deterministic exact-range revision and overlap reconciliation.
--
-- Values continue to live only in the immutable exact-range ledger. This
-- migration stores reconciliation identifiers, hashes, counts, state, and
-- timestamps only; it never stores rows, cells, formulas, or customer data.

alter table public.exact_range_metric_observations
  drop constraint exact_range_metric_observations_revision_check,
  add constraint exact_range_metric_observations_revision_check check (revision > 0),
  add column reconciliation_state text not null default 'current'
    check (reconciliation_state in ('current', 'blocked_overlap', 'excluded', 'superseded')),
  add column reconciliation_digest text
    check (reconciliation_digest is null or reconciliation_digest ~ '^[a-f0-9]{64}$');

alter table public.integration_report_packages
  drop constraint integration_report_packages_status_check,
  add constraint integration_report_packages_status_check check (status in (
    'awaiting_upload', 'uploaded', 'profiling', 'awaiting_contract', 'awaiting_approval',
    'awaiting_validation', 'validating', 'validated', 'partially_validated',
    'validation_failed', 'awaiting_projection', 'projecting', 'projected',
    'partially_projected', 'reconciliation_required', 'projection_failed', 'failed'
  ));

create table public.report_projection_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  report_package_id uuid not null,
  projection_run_id uuid not null,
  projection_output_key text not null check (projection_output_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  classification text not null check (classification in ('exact_duplicate', 'non_overlapping', 'ambiguous_overlap', 'approved_correction')),
  reconciliation_digest text not null check (reconciliation_digest ~ '^[a-f0-9]{64}$'),
  prior_observation_id uuid,
  result_observation_id uuid,
  candidate_count integer not null check (candidate_count between 0 and 50),
  quality_state text not null check (quality_state in ('complete', 'partial')),
  completeness_state text not null check (completeness_state in ('complete', 'partial')),
  calculation_version integer not null check (calculation_version = 1),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, projection_run_id, projection_output_key, prior_observation_id),
  foreign key (organization_id, report_package_id)
    references public.integration_report_packages(organization_id, id) on delete restrict,
  foreign key (organization_id, projection_run_id)
    references public.integration_report_projection_runs(organization_id, id) on delete restrict,
  foreign key (organization_id, prior_observation_id)
    references public.exact_range_metric_observations(organization_id, id) on delete restrict,
  foreign key (organization_id, result_observation_id)
    references public.exact_range_metric_observations(organization_id, id) on delete restrict
);

create table public.report_projection_reconciliation_resolutions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  reconciliation_id uuid not null,
  resolution text not null check (resolution in ('accept_correction', 'keep_existing')),
  reconciliation_digest text not null check (reconciliation_digest ~ '^[a-f0-9]{64}$'),
  prior_observation_id uuid not null,
  result_observation_id uuid not null,
  resolved_by uuid not null references auth.users(id),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, reconciliation_id),
  foreign key (organization_id, reconciliation_id)
    references public.report_projection_reconciliations(organization_id, id) on delete restrict,
  foreign key (organization_id, prior_observation_id)
    references public.exact_range_metric_observations(organization_id, id) on delete restrict,
  foreign key (organization_id, result_observation_id)
    references public.exact_range_metric_observations(organization_id, id) on delete restrict
);

create index exact_range_metric_observations_reconciliation_lookup_idx
  on public.exact_range_metric_observations (
    organization_id, metric_definition_id, branch_id, channel_id, projection_output_key,
    period_timezone, currency, period_start, period_end
  ) where reconciliation_state = 'current';

create index report_projection_reconciliations_package_idx
  on public.report_projection_reconciliations (organization_id, report_package_id, created_at desc);

create index report_projection_reconciliation_resolutions_reconciliation_idx
  on public.report_projection_reconciliation_resolutions (organization_id, reconciliation_id);

create or replace function private.prevent_report_projection_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'report_projection_evidence_is_append_only' using errcode = '55000';
  end if;
  if tg_table_name <> 'exact_range_metric_observations' then
    raise exception 'report_projection_evidence_is_append_only' using errcode = '55000';
  end if;
  if old.reconciliation_state = 'blocked_overlap'
    and new.reconciliation_state in ('current', 'excluded')
    and new.organization_id is not distinct from old.organization_id
    and new.report_package_id is not distinct from old.report_package_id
    and new.projection_run_id is not distinct from old.projection_run_id
    and new.reconciliation_digest is not distinct from old.reconciliation_digest
    and new.superseded_by_id is not distinct from old.superseded_by_id
    and new.revision is not distinct from old.revision then
    return new;
  end if;
  if old.reconciliation_state = 'current'
    and new.reconciliation_state = 'superseded'
    and new.superseded_by_id is not null
    and new.organization_id is not distinct from old.organization_id
    and new.revision is not distinct from old.revision
    and new.reconciliation_digest is not distinct from old.reconciliation_digest then
    return new;
  end if;
  raise exception 'report_projection_evidence_is_append_only' using errcode = '55000';
end;
$$;

create or replace function private.prevent_report_package_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.channel_id is distinct from old.channel_id
    or new.branch_id is distinct from old.branch_id
    or new.report_type is distinct from old.report_type
    or new.declared_period_start is distinct from old.declared_period_start
    or new.declared_period_end is distinct from old.declared_period_end
    or new.declared_currency is distinct from old.declared_currency
    or new.period_timezone is distinct from old.period_timezone
    or new.file_kind is distinct from old.file_kind
    or new.original_filename is distinct from old.original_filename
    or new.declared_content_type is distinct from old.declared_content_type
    or new.declared_content_length is distinct from old.declared_content_length
    or new.storage_bucket_id is distinct from old.storage_bucket_id
    or new.storage_path is distinct from old.storage_path
    or new.parser_version is distinct from old.parser_version
    or new.fingerprint_version is distinct from old.fingerprint_version
    or new.created_by is distinct from old.created_by
    or new.retained_until is distinct from old.retained_until then
    raise exception 'report_package_context_is_immutable' using errcode = '23514';
  end if;
  if old.content_sha256 is not null and new.content_sha256 is distinct from old.content_sha256 then
    raise exception 'report_package_digest_is_immutable' using errcode = '23514';
  end if;
  if old.schema_fingerprint is not null and new.schema_fingerprint is distinct from old.schema_fingerprint then
    raise exception 'report_package_schema_fingerprint_is_immutable' using errcode = '23514';
  end if;
  if old.storage_object_id is not null and (
    new.storage_object_id is distinct from old.storage_object_id
    or new.storage_object_version is distinct from old.storage_object_version
  ) then
    raise exception 'report_package_object_identity_is_immutable' using errcode = '23514';
  end if;
  if not (
    (old.status = 'awaiting_upload' and new.status in ('awaiting_upload', 'uploaded', 'failed'))
    or (old.status = 'uploaded' and new.status in ('uploaded', 'profiling', 'failed'))
    or (old.status = 'profiling' and new.status in ('profiling', 'awaiting_contract', 'failed'))
    or (old.status = 'awaiting_contract' and new.status in ('awaiting_contract', 'awaiting_approval'))
    or (old.status = 'awaiting_approval' and new.status in ('awaiting_approval', 'awaiting_contract', 'awaiting_validation'))
    or (old.status = 'awaiting_validation' and new.status in ('awaiting_validation', 'validating', 'validation_failed'))
    or (old.status = 'validating' and new.status in ('validating', 'validated', 'partially_validated', 'validation_failed'))
    or (old.status in ('validated', 'partially_validated') and new.status in (old.status, 'awaiting_projection'))
    or (old.status = 'awaiting_projection' and new.status in ('awaiting_projection', 'projecting'))
    or (old.status = 'projecting' and new.status in ('projecting', 'projected', 'partially_projected', 'reconciliation_required', 'projection_failed'))
    or (old.status = 'reconciliation_required' and new.status in ('reconciliation_required', 'projected', 'partially_projected'))
    or (old.status = 'projection_failed' and new.status in ('projection_failed', 'awaiting_projection'))
    or (old.status = 'validation_failed' and new.status in ('validation_failed', 'awaiting_validation'))
    or (old.status in ('projected', 'partially_projected', 'failed') and new.status = old.status)
  ) then
    raise exception 'report_package_status_transition_is_invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.report_projection_reconciliation_digest(
  p_package public.integration_report_packages,
  p_validation public.integration_report_validation_runs,
  p_projection public.report_projection_versions,
  p_metric_definition_id uuid,
  p_output_key text,
  p_source_digest text
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(concat_ws('|', (p_package).organization_id, (p_package).channel_id,
    (p_package).branch_id, p_metric_definition_id, p_output_key, (p_package).declared_period_start,
    (p_package).declared_period_end, (p_package).period_timezone, (p_package).declared_currency,
    (p_package).content_sha256, (p_validation).result_digest,
    (select v.mapping_digest from public.report_contract_versions v where v.organization_id = (p_package).organization_id and v.id = (p_validation).report_contract_version_id),
    (p_projection).projection_digest, (p_projection).calculation_version, p_source_digest), 'sha256'), 'hex')
$$;

create function private.audit_report_projection_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_name text;
begin
  audit_name := case new.classification
    when 'exact_duplicate' then 'report_projection.duplicate_replayed'
    when 'ambiguous_overlap' then 'report_projection.overlap_blocked'
    else null
  end;
  if audit_name is not null then
    insert into public.audit_events (organization_id, event_name, actor_type, entity_type, entity_id, correlation_id, payload)
    values (new.organization_id, audit_name, 'system', 'report_projection_reconciliation', new.id, new.correlation_id,
      jsonb_build_object('reportPackageId', new.report_package_id, 'projectionRunId', new.projection_run_id,
        'projectionOutputKey', new.projection_output_key, 'classification', new.classification,
        'reconciliationDigest', new.reconciliation_digest, 'priorObservationId', new.prior_observation_id,
        'resultObservationId', new.result_observation_id, 'candidateCount', new.candidate_count,
        'qualityState', new.quality_state, 'completenessState', new.completeness_state,
        'calculationVersion', new.calculation_version));
  end if;
  return new;
end;
$$;

create trigger report_projection_reconciliations_audit
after insert on public.report_projection_reconciliations
for each row execute function private.audit_report_projection_reconciliation();

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
#variable_conflict use_column
declare
  operation private.integration_report_projection_operations;
  run_row public.integration_report_projection_runs;
  package_row public.integration_report_packages;
  object_row storage.objects;
  output jsonb;
  projection_document_json jsonb;
  definition_row public.metric_definitions;
  prior_row public.exact_range_metric_observations;
  observation_id uuid;
  reconciliation_digest text;
  overlap_count integer;
  final_status text;
  has_blocked_overlap boolean := false;
  effective_quality_state text;
  effective_completeness_state text;
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
  select v.projection_document into projection_document_json from public.report_projection_versions v
  where v.organization_id = p_organization_id and v.id = run_row.report_projection_version_id;
  if p_result ->> 'status' = 'failed' and jsonb_array_length(p_outputs) <> 0 then raise exception 'failed projection cannot persist outputs' using errcode = '22023'; end if;
  if p_result ->> 'status' <> 'failed' and jsonb_array_length(p_outputs) = 0 then raise exception 'successful projection requires outputs' using errcode = '22023'; end if;
  effective_quality_state := case when p_result ->> 'qualityState' = 'partial' then 'partial' else 'complete' end;
  effective_completeness_state := case when p_result ->> 'completenessState' = 'partial' then 'partial' else 'complete' end;
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
    reconciliation_digest := private.report_projection_reconciliation_digest(
      package_row, (select v from public.integration_report_validation_runs v where v.organization_id = p_organization_id and v.id = run_row.validation_run_id),
      (select p from public.report_projection_versions p where p.organization_id = p_organization_id and p.id = run_row.report_projection_version_id),
      definition_row.id, output ->> 'key', output ->> 'sourceDigest'
    );
    perform pg_advisory_xact_lock(hashtextextended(concat_ws('|', p_organization_id, package_row.channel_id,
      package_row.branch_id, definition_row.id, output ->> 'key', package_row.period_timezone,
      case when output ->> 'valueKind' = 'money' then package_row.declared_currency else '' end), 0));
    select * into prior_row from public.exact_range_metric_observations o
    where o.organization_id = p_organization_id and o.branch_id = package_row.branch_id and o.channel_id = package_row.channel_id
      and o.metric_definition_id = definition_row.id and o.projection_output_key = output ->> 'key'
      and o.period_timezone = package_row.period_timezone
      and o.currency is not distinct from case when output ->> 'valueKind' = 'money' then package_row.declared_currency else null end
      and o.period_start = package_row.declared_period_start and o.period_end = package_row.declared_period_end
      and o.reconciliation_state = 'current' and o.reconciliation_digest = reconciliation_digest
    order by o.id limit 1 for update;
    if found then
      insert into public.report_projection_reconciliations (
        organization_id, report_package_id, projection_run_id, projection_output_key, classification, reconciliation_digest,
        prior_observation_id, candidate_count, quality_state, completeness_state, calculation_version, correlation_id
      ) values (p_organization_id, p_report_package_id, p_projection_run_id, output ->> 'key', 'exact_duplicate', reconciliation_digest,
        prior_row.id, 1, effective_quality_state, effective_completeness_state, run_row.calculation_version, run_row.correlation_id);
      continue;
    end if;
    select count(*) into overlap_count from public.exact_range_metric_observations o
    where o.organization_id = p_organization_id and o.branch_id = package_row.branch_id and o.channel_id = package_row.channel_id
      and o.metric_definition_id = definition_row.id and o.projection_output_key = output ->> 'key'
      and o.period_timezone = package_row.period_timezone
      and o.currency is not distinct from case when output ->> 'valueKind' = 'money' then package_row.declared_currency else null end
      and o.reconciliation_state = 'current'
      and o.period_start <= package_row.declared_period_end and o.period_end >= package_row.declared_period_start;
    select * into prior_row from public.exact_range_metric_observations o
    where o.organization_id = p_organization_id and o.branch_id = package_row.branch_id and o.channel_id = package_row.channel_id
      and o.metric_definition_id = definition_row.id and o.projection_output_key = output ->> 'key'
      and o.period_timezone = package_row.period_timezone
      and o.currency is not distinct from case when output ->> 'valueKind' = 'money' then package_row.declared_currency else null end
      and o.reconciliation_state = 'current'
      and o.period_start <= package_row.declared_period_end and o.period_end >= package_row.declared_period_start
    order by o.period_start, o.period_end, o.id limit 1 for update;
    insert into public.exact_range_metric_observations (
      organization_id, branch_id, channel_id, metric_definition_id, projection_output_key, value_kind,
      period_start, period_end, period_timezone, value_numerator, currency, quality_state, completeness_state,
      reconciliation_state, reconciliation_digest, report_package_id, validation_run_id, report_contract_version_id,
      report_projection_version_id, projection_run_id
    ) values (
      p_organization_id, package_row.branch_id, package_row.channel_id, definition_row.id, output ->> 'key', output ->> 'valueKind',
      package_row.declared_period_start, package_row.declared_period_end, package_row.period_timezone,
      (output ->> 'valueNumerator')::numeric, case when output ->> 'valueKind' = 'money' then package_row.declared_currency else null end,
      effective_quality_state, effective_completeness_state,
      case when overlap_count > 0 then 'blocked_overlap' else 'current' end, reconciliation_digest,
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
      output ->> 'sourceDigest', effective_quality_state, effective_completeness_state
    );
    insert into public.report_projection_reconciliations (
      organization_id, report_package_id, projection_run_id, projection_output_key, classification, reconciliation_digest,
      prior_observation_id, result_observation_id, candidate_count, quality_state, completeness_state, calculation_version, correlation_id
    ) values (
      p_organization_id, p_report_package_id, p_projection_run_id, output ->> 'key',
      case when overlap_count > 0 then 'ambiguous_overlap' else 'non_overlapping' end, reconciliation_digest,
      case when overlap_count > 0 then prior_row.id else null end, observation_id, overlap_count,
      effective_quality_state, effective_completeness_state, run_row.calculation_version, run_row.correlation_id
    );
    has_blocked_overlap := has_blocked_overlap or overlap_count > 0;
  end loop;
  final_status := p_result ->> 'status';
  update public.integration_report_projection_runs set status = final_status, quality_state = p_result ->> 'qualityState',
    completeness_state = p_result ->> 'completenessState', output_count = jsonb_array_length(p_outputs),
    result_digest = p_result_digest, error_codes = coalesce(p_result -> 'errorCodes', '[]'::jsonb),
    warning_codes = coalesce(p_result -> 'warningCodes', '[]'::jsonb), completed_at = now()
  where organization_id = p_organization_id and id = p_projection_run_id;
  update public.integration_report_packages set status = case
    when has_blocked_overlap then 'reconciliation_required'
    when final_status = 'projected' then 'projected'
    when final_status = 'partially_projected' then 'partially_projected'
    else 'projection_failed' end,
    safe_failure_code = case when final_status = 'failed' then coalesce(p_result -> 'errorCodes' ->> 0, 'PROJECTION_PROCESSING_FAILED') else null end,
    safe_failure_at = case when final_status = 'failed' then now() else null end
  where organization_id = p_organization_id and id = p_report_package_id returning * into package_row;
  return to_jsonb(package_row);
end;
$$;

create function public.resolve_governed_report_projection_overlap(
  p_organization_id uuid,
  p_actor_id uuid,
  p_reconciliation_id uuid,
  p_resolution text,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  reconciliation_row public.report_projection_reconciliations;
  prior_row public.exact_range_metric_observations;
  result_row public.exact_range_metric_observations;
  resolution_row public.report_projection_reconciliation_resolutions;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.contract_approve') then
    raise exception 'report overlap resolution is not authorized' using errcode = '42501';
  end if;
  if p_resolution not in ('accept_correction', 'keep_existing') or char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'report overlap resolution is invalid' using errcode = '22023';
  end if;
  select * into reconciliation_row from public.report_projection_reconciliations
  where organization_id = p_organization_id and id = p_reconciliation_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  select * into resolution_row from public.report_projection_reconciliation_resolutions
  where organization_id = p_organization_id and reconciliation_id = p_reconciliation_id;
  if found then return jsonb_build_object('outcome', 'completed', 'resolution', to_jsonb(resolution_row)); end if;
  if reconciliation_row.classification <> 'ambiguous_overlap'
    or reconciliation_row.prior_observation_id is null or reconciliation_row.result_observation_id is null then
    return jsonb_build_object('outcome', 'not_ready');
  end if;
  select * into prior_row from public.exact_range_metric_observations
  where organization_id = p_organization_id and id = reconciliation_row.prior_observation_id for update;
  select * into result_row from public.exact_range_metric_observations
  where organization_id = p_organization_id and id = reconciliation_row.result_observation_id for update;
  if not found or result_row.reconciliation_state <> 'blocked_overlap' then return jsonb_build_object('outcome', 'not_ready'); end if;
  if p_resolution = 'accept_correction' then
    if prior_row.reconciliation_state <> 'current' then return jsonb_build_object('outcome', 'conflict'); end if;
    update public.exact_range_metric_observations set reconciliation_state = 'current', revision = prior_row.revision + 1
    where organization_id = p_organization_id and id = result_row.id;
    update public.exact_range_metric_observations set reconciliation_state = 'superseded', superseded_by_id = result_row.id,
      supersede_reason = 'approved_correction'
    where organization_id = p_organization_id and id = prior_row.id;
  else
    update public.exact_range_metric_observations set reconciliation_state = 'excluded'
    where organization_id = p_organization_id and id = result_row.id;
  end if;
  insert into public.report_projection_reconciliation_resolutions (
    organization_id, reconciliation_id, resolution, reconciliation_digest, prior_observation_id,
    result_observation_id, resolved_by, correlation_id
  ) values (
    p_organization_id, p_reconciliation_id, p_resolution, reconciliation_row.reconciliation_digest,
    prior_row.id, result_row.id, p_actor_id, p_correlation_id
  ) returning * into resolution_row;
  if p_resolution = 'accept_correction' then
    insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload)
    values (p_organization_id, 'report_projection.correction_accepted', 'user', p_actor_id,
      'report_projection_reconciliation_resolution', resolution_row.id, p_correlation_id,
      jsonb_build_object('reconciliationId', reconciliation_row.id, 'priorObservationId', prior_row.id,
        'resultObservationId', result_row.id, 'reconciliationDigest', reconciliation_row.reconciliation_digest));
    insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload)
    values (p_organization_id, 'exact_range_metric_observation.superseded', 'user', p_actor_id,
      'exact_range_metric_observation', prior_row.id, p_correlation_id,
      jsonb_build_object('supersededById', result_row.id, 'reconciliationId', reconciliation_row.id,
        'revision', prior_row.revision + 1));
  end if;
  insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload)
  values (p_organization_id, 'report_projection.overlap_resolved', 'user', p_actor_id,
    'report_projection_reconciliation_resolution', resolution_row.id, p_correlation_id,
    jsonb_build_object('reconciliationId', reconciliation_row.id, 'resolution', p_resolution,
      'priorObservationId', prior_row.id, 'resultObservationId', result_row.id,
      'reconciliationDigest', reconciliation_row.reconciliation_digest));
  update public.integration_report_packages set status = 'projected', correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = reconciliation_row.report_package_id;
  return jsonb_build_object('outcome', 'resolved', 'resolution', to_jsonb(resolution_row));
end;
$$;

revoke all on table public.report_projection_reconciliations, public.report_projection_reconciliation_resolutions from public, anon, authenticated;
revoke all on function private.report_projection_reconciliation_digest(public.integration_report_packages, public.integration_report_validation_runs, public.report_projection_versions, uuid, text, text) from public;
revoke all on function private.audit_report_projection_reconciliation() from public;
revoke all on function public.resolve_governed_report_projection_overlap(uuid, uuid, uuid, text, text, uuid) from public, anon;

alter table public.report_projection_reconciliations enable row level security;
alter table public.report_projection_reconciliations force row level security;
alter table public.report_projection_reconciliation_resolutions enable row level security;
alter table public.report_projection_reconciliation_resolutions force row level security;

create policy "members with report read can view report projection reconciliations"
on public.report_projection_reconciliations for select to authenticated
using ((select private.has_organization_permission(organization_id, 'report.read')));
create policy "members with report read can view report projection reconciliation resolutions"
on public.report_projection_reconciliation_resolutions for select to authenticated
using ((select private.has_organization_permission(organization_id, 'report.read')));

grant select on table public.report_projection_reconciliations, public.report_projection_reconciliation_resolutions to authenticated;
grant execute on function public.resolve_governed_report_projection_overlap(uuid, uuid, uuid, text, text, uuid) to authenticated;
