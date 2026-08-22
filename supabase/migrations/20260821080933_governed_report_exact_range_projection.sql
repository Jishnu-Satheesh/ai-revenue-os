-- Governed deterministic exact-range report projection.
--
-- This is deliberately narrower than the later normalized-metric and Channel
-- Economics slices: an approved projection declaration can emit only one
-- money/count sum for each required, validated source field over the package's
-- declared exact local period. Workbook rows remain in private Storage.

alter table public.integration_report_packages
  drop constraint integration_report_packages_status_check,
  add constraint integration_report_packages_status_check check (status in (
    'awaiting_upload', 'uploaded', 'profiling', 'awaiting_contract', 'awaiting_approval',
    'awaiting_validation', 'validating', 'validated', 'partially_validated',
    'validation_failed', 'awaiting_projection', 'projecting', 'projected',
    'partially_projected', 'projection_failed', 'failed'
  ));

alter table public.integration_report_packages
  drop constraint if exists integration_report_packages_safe_failure_code_check,
  add constraint integration_report_packages_safe_failure_code_check check (safe_failure_code is null or safe_failure_code in (
    'UPLOAD_EXPIRED', 'OBJECT_UNAVAILABLE', 'OBJECT_IDENTITY_CHANGED', 'INVALID_FILE_TYPE', 'FILE_TOO_LARGE',
    'TOO_MANY_SHEETS', 'TOO_MANY_ROWS', 'TOO_MANY_POPULATED_CELLS', 'EXPANDED_CONTENT_TOO_LARGE',
    'UNSAFE_WORKBOOK', 'UNREADABLE_WORKBOOK', 'PROFILE_FAILED', 'PACKAGE_EXPIRED',
    'CONTRACT_VERSION_NOT_APPROVED', 'CONTRACT_BINDING_INACTIVE', 'CONTRACT_CONTEXT_MISMATCH',
    'REQUIRED_SHEET_MISSING', 'REQUIRED_SOURCE_HEADER_MISSING', 'REQUIRED_FIELD_MISSING',
    'INVALID_INTEGER', 'INVALID_DECIMAL', 'INVALID_MONEY', 'INVALID_LOCAL_DATE', 'INVALID_TIMESTAMP',
    'INVALID_DURATION', 'INVALID_PERCENTAGE', 'INVALID_TEXT', 'INVALID_ENUM', 'FORMULA_REJECTED',
    'FORMULA_VALUE_UNSUPPORTED', 'MERGED_CELLS_REJECTED', 'CONTROL_MISMATCH',
    'UNDECLARED_SHEET_PRESENT', 'VALIDATION_PROCESSING_FAILED',
    'PROJECTION_VERSION_NOT_APPROVED', 'PROJECTION_BINDING_INACTIVE', 'PROJECTION_CONTEXT_MISMATCH',
    'PROJECTION_FIELD_VALUE_KIND_MISMATCH', 'REQUIRED_PROJECTED_VALUE_MISSING',
    'PROJECTION_PROCESSING_FAILED'
  ));

create table public.report_projection_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  report_contract_version_id uuid not null,
  version integer not null check (version > 0),
  projection_document jsonb not null check (jsonb_typeof(projection_document) = 'object'),
  projection_digest text not null check (projection_digest ~ '^[a-f0-9]{64}$'),
  calculation_version integer not null check (calculation_version = 1),
  proposal_source text not null check (proposal_source = 'human'),
  created_by uuid not null references auth.users(id),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, report_contract_version_id, version),
  foreign key (organization_id, report_contract_version_id)
    references public.report_contract_versions(organization_id, id) on delete restrict
);

create table public.report_projection_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  report_projection_version_id uuid not null,
  decision text not null check (decision in ('approved', 'rejected')),
  projection_digest text not null check (projection_digest ~ '^[a-f0-9]{64}$'),
  reason text check (reason is null or char_length(reason) between 1 and 500),
  decided_by uuid not null references auth.users(id),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, report_projection_version_id),
  foreign key (organization_id, report_projection_version_id)
    references public.report_projection_versions(organization_id, id) on delete restrict
);

create table public.report_projection_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  report_contract_version_id uuid not null,
  report_contract_binding_id uuid not null,
  report_projection_version_id uuid not null,
  schema_fingerprint text not null check (schema_fingerprint ~ '^[a-f0-9]{64}$'),
  declared_currency text not null check (declared_currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  bound_by uuid not null references auth.users(id),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, report_contract_version_id)
    references public.report_contract_versions(organization_id, id) on delete restrict,
  foreign key (organization_id, report_contract_binding_id)
    references public.report_contract_bindings(organization_id, id) on delete restrict,
  foreign key (organization_id, report_projection_version_id)
    references public.report_projection_versions(organization_id, id) on delete restrict
);

create unique index report_projection_bindings_active_contract_idx
  on public.report_projection_bindings (organization_id, report_contract_version_id)
  where active;

create index report_projection_versions_contract_idx
  on public.report_projection_versions (organization_id, report_contract_version_id, created_at desc);

create table public.integration_report_projection_runs (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  report_package_id uuid not null,
  report_contract_version_id uuid not null,
  report_contract_binding_id uuid not null,
  report_projection_version_id uuid not null,
  report_projection_binding_id uuid not null,
  validation_run_id uuid not null,
  calculation_version integer not null check (calculation_version = 1),
  input_digest text not null check (input_digest ~ '^[a-f0-9]{64}$'),
  result_digest text check (result_digest is null or result_digest ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('running', 'projected', 'partially_projected', 'failed')),
  quality_state text check (quality_state is null or quality_state in ('complete', 'partial', 'failed')),
  completeness_state text check (completeness_state is null or completeness_state in ('complete', 'partial', 'unavailable')),
  output_count integer not null default 0 check (output_count between 0 and 50),
  error_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(error_codes) = 'array' and jsonb_array_length(error_codes) <= 50),
  warning_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(warning_codes) = 'array' and jsonb_array_length(warning_codes) <= 50),
  correlation_id uuid not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, report_package_id, id),
  foreign key (organization_id, report_package_id)
    references public.integration_report_packages(organization_id, id) on delete restrict,
  foreign key (organization_id, report_contract_version_id)
    references public.report_contract_versions(organization_id, id) on delete restrict,
  foreign key (organization_id, report_contract_binding_id)
    references public.report_contract_bindings(organization_id, id) on delete restrict,
  foreign key (organization_id, report_projection_version_id)
    references public.report_projection_versions(organization_id, id) on delete restrict,
  foreign key (organization_id, report_projection_binding_id)
    references public.report_projection_bindings(organization_id, id) on delete restrict,
  foreign key (organization_id, validation_run_id)
    references public.integration_report_validation_runs(organization_id, id) on delete restrict,
  check ((status = 'running' and completed_at is null and result_digest is null)
    or (status <> 'running' and completed_at is not null and result_digest is not null))
);

create table public.exact_range_metric_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  channel_id uuid not null,
  metric_definition_id uuid not null references public.metric_definitions(id) on delete restrict,
  projection_output_key text not null check (projection_output_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  value_kind text not null check (value_kind in ('money', 'count')),
  subject_kind text not null default 'organization' check (subject_kind = 'organization'),
  subject_ref text check (subject_ref is null),
  dimensions jsonb not null default '{}'::jsonb check (dimensions = '{}'::jsonb),
  period_start date not null,
  period_end date not null,
  period_timezone text not null check (char_length(period_timezone) between 1 and 60),
  value_numerator numeric not null,
  value_denominator numeric check (value_denominator is null),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  quality_state text not null check (quality_state in ('complete', 'partial')),
  completeness_state text not null check (completeness_state in ('complete', 'partial')),
  revision integer not null default 1 check (revision = 1),
  superseded_by_id uuid references public.exact_range_metric_observations(id) on delete restrict,
  supersede_reason text check (supersede_reason is null or char_length(supersede_reason) <= 500),
  report_package_id uuid not null,
  validation_run_id uuid not null,
  report_contract_version_id uuid not null,
  report_projection_version_id uuid not null,
  projection_run_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, projection_run_id, projection_output_key),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  foreign key (organization_id, channel_id) references public.organization_channels(organization_id, id) on delete restrict,
  foreign key (organization_id, report_package_id) references public.integration_report_packages(organization_id, id) on delete restrict,
  foreign key (organization_id, validation_run_id) references public.integration_report_validation_runs(organization_id, id) on delete restrict,
  foreign key (organization_id, report_contract_version_id) references public.report_contract_versions(organization_id, id) on delete restrict,
  foreign key (organization_id, report_projection_version_id) references public.report_projection_versions(organization_id, id) on delete restrict,
  foreign key (organization_id, projection_run_id) references public.integration_report_projection_runs(organization_id, id) on delete restrict,
  check (period_end >= period_start),
  check ((value_kind = 'money') = (currency is not null)),
  check (value_numerator = trunc(value_numerator)),
  check (superseded_by_id is null or superseded_by_id <> id)
);

create table public.report_projection_lineage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  exact_range_metric_observation_id uuid not null,
  report_package_id uuid not null,
  validation_run_id uuid not null,
  projection_run_id uuid not null,
  report_contract_version_id uuid not null,
  report_projection_version_id uuid not null,
  normalized_sheet_name text not null check (normalized_sheet_name ~ '^[a-z][a-z0-9_]{0,63}$'),
  canonical_field text not null check (canonical_field ~ '^[a-z][a-z0-9_]{0,63}$'),
  source_column_ordinal integer not null check (source_column_ordinal between 1 and 250000),
  first_data_row integer not null check (first_data_row between 1 and 250000),
  last_data_row integer not null check (last_data_row between 0 and 250000),
  contributor_count integer not null check (contributor_count between 0 and 250000),
  calculation_version integer not null check (calculation_version = 1),
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  quality_state text not null check (quality_state in ('complete', 'partial')),
  completeness_state text not null check (completeness_state in ('complete', 'partial')),
  created_at timestamptz not null default now(),
  unique (organization_id, exact_range_metric_observation_id),
  foreign key (organization_id, exact_range_metric_observation_id)
    references public.exact_range_metric_observations(organization_id, id) on delete restrict,
  foreign key (organization_id, report_package_id)
    references public.integration_report_packages(organization_id, id) on delete restrict,
  foreign key (organization_id, validation_run_id)
    references public.integration_report_validation_runs(organization_id, id) on delete restrict,
  foreign key (organization_id, projection_run_id)
    references public.integration_report_projection_runs(organization_id, id) on delete restrict,
  foreign key (organization_id, report_contract_version_id)
    references public.report_contract_versions(organization_id, id) on delete restrict,
  foreign key (organization_id, report_projection_version_id)
    references public.report_projection_versions(organization_id, id) on delete restrict
);

create table private.integration_report_projection_operations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_package_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  input_digest text not null check (input_digest ~ '^[a-f0-9]{64}$'),
  projection_run_id uuid not null,
  claim_token uuid not null,
  lease_expires_at timestamptz not null,
  attempt_count integer not null default 1 check (attempt_count between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, report_package_id),
  unique (organization_id, projection_run_id),
  foreign key (organization_id, report_package_id)
    references public.integration_report_packages(organization_id, id) on delete restrict,
  foreign key (organization_id, projection_run_id)
    references public.integration_report_projection_runs(organization_id, id) on delete restrict
);

create table private.report_projection_write_operations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_kind text not null check (operation_kind in ('propose', 'decide', 'request')),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  reference_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, operation_kind, idempotency_key)
);

create index integration_report_projection_runs_package_idx
  on public.integration_report_projection_runs (organization_id, report_package_id, created_at desc);
create index exact_range_metric_observations_read_idx
  on public.exact_range_metric_observations (organization_id, metric_definition_id, branch_id, channel_id, period_start desc)
  where superseded_by_id is null;
create index report_projection_lineage_package_idx
  on public.report_projection_lineage (organization_id, report_package_id, created_at desc);

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
    or (old.status = 'projecting' and new.status in ('projecting', 'projected', 'partially_projected', 'projection_failed'))
    or (old.status = 'projection_failed' and new.status in ('projection_failed', 'awaiting_projection'))
    or (old.status = 'validation_failed' and new.status in ('validation_failed', 'awaiting_validation'))
    or (old.status in ('projected', 'partially_projected', 'failed') and new.status = old.status)
  ) then
    raise exception 'report_package_status_transition_is_invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.prevent_report_projection_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'report_projection_evidence_is_append_only' using errcode = '55000';
end;
$$;

create function private.prevent_report_projection_run_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status <> 'running'
    or new.organization_id is distinct from old.organization_id
    or new.report_package_id is distinct from old.report_package_id
    or new.report_contract_version_id is distinct from old.report_contract_version_id
    or new.report_contract_binding_id is distinct from old.report_contract_binding_id
    or new.report_projection_version_id is distinct from old.report_projection_version_id
    or new.report_projection_binding_id is distinct from old.report_projection_binding_id
    or new.validation_run_id is distinct from old.validation_run_id
    or new.calculation_version is distinct from old.calculation_version
    or new.input_digest is distinct from old.input_digest
    or new.correlation_id is distinct from old.correlation_id
    or new.started_at is distinct from old.started_at
    or new.created_at is distinct from old.created_at
    or new.status not in ('projected', 'partially_projected', 'failed')
    or new.completed_at is null
    or new.result_digest is null then
    raise exception 'report_projection_run_is_append_only' using errcode = '55000';
  end if;
  return new;
end;
$$;

create function private.prevent_report_projection_binding_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.active and not new.active
    and new.organization_id is not distinct from old.organization_id
    and new.report_contract_version_id is not distinct from old.report_contract_version_id
    and new.report_contract_binding_id is not distinct from old.report_contract_binding_id
    and new.report_projection_version_id is not distinct from old.report_projection_version_id
    and new.schema_fingerprint is not distinct from old.schema_fingerprint
    and new.declared_currency is not distinct from old.declared_currency
    and new.bound_by is not distinct from old.bound_by
    and new.correlation_id is not distinct from old.correlation_id
    and new.created_at is not distinct from old.created_at then
    return new;
  end if;
  raise exception 'report_projection_binding_is_immutable' using errcode = '55000';
end;
$$;

create function private.assert_report_projection_document(p_document jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  output jsonb;
begin
  if jsonb_typeof(p_document) <> 'object'
    or coalesce((select bool_or(key not in ('schemaVersion', 'outputKind', 'outputs')) from jsonb_object_keys(p_document) key), false)
    or p_document ->> 'schemaVersion' <> '1'
    or p_document ->> 'outputKind' <> 'exact_range'
    or jsonb_typeof(p_document -> 'outputs') <> 'array'
    or jsonb_array_length(p_document -> 'outputs') not between 1 and 50 then
    raise exception 'report projection document is invalid' using errcode = '22023';
  end if;
  for output in select value from jsonb_array_elements(p_document -> 'outputs') loop
    if jsonb_typeof(output) <> 'object'
      or coalesce((select bool_or(key not in ('key', 'normalizedSheetName', 'canonicalField', 'metricKey', 'valueKind', 'aggregation')) from jsonb_object_keys(output) key), false)
      or coalesce(output ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(output ->> 'normalizedSheetName', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(output ->> 'canonicalField', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(output ->> 'metricKey', '') !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'
      or output ->> 'valueKind' not in ('money', 'count')
      or output ->> 'aggregation' <> 'sum' then
      raise exception 'report projection output rule is invalid' using errcode = '22023';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_document -> 'outputs')) <>
    (select count(distinct value ->> 'key') from jsonb_array_elements(p_document -> 'outputs'))
    or (select count(*) from jsonb_array_elements(p_document -> 'outputs')) <>
    (select count(distinct value ->> 'metricKey') from jsonb_array_elements(p_document -> 'outputs'))
    or (select count(*) from jsonb_array_elements(p_document -> 'outputs')) <>
    (select count(distinct concat_ws(':', value ->> 'normalizedSheetName', value ->> 'canonicalField')) from jsonb_array_elements(p_document -> 'outputs')) then
    raise exception 'report projection outputs are duplicated' using errcode = '22023';
  end if;
end;
$$;

create function private.assert_report_projection_matches_contract(
  p_organization_id uuid,
  p_contract_version public.report_contract_versions,
  p_document jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  output jsonb;
  source_field jsonb;
  definition_row public.metric_definitions;
begin
  perform private.assert_report_projection_document(p_document);
  for output in select value from jsonb_array_elements(p_document -> 'outputs') loop
    select field.value into source_field
    from jsonb_array_elements((p_contract_version).mapping_document -> 'sheets') sheet,
      jsonb_array_elements(sheet.value -> 'fields') field
    where sheet.value ->> 'normalizedSheetName' = output ->> 'normalizedSheetName'
      and field.value ->> 'canonicalField' = output ->> 'canonicalField'
      and (field.value ->> 'required')::boolean
    limit 1;
    if source_field is null
      or ((output ->> 'valueKind' = 'money') and source_field ->> 'parser' <> 'money')
      or ((output ->> 'valueKind' = 'count') and source_field ->> 'parser' <> 'integer') then
      raise exception 'report projection does not match approved required contract field' using errcode = '23514';
    end if;
    select * into definition_row from public.metric_definitions
    where key = output ->> 'metricKey' and is_active
      and (organization_id is null or organization_id = p_organization_id)
    order by (organization_id is not null) desc
    limit 1;
    if not found or definition_row.value_kind <> output ->> 'valueKind' or definition_row.aggregation <> 'sum' then
      raise exception 'report projection metric definition is invalid' using errcode = '23514';
    end if;
  end loop;
end;
$$;

create function private.report_projection_input_digest(
  p_package public.integration_report_packages,
  p_validation public.integration_report_validation_runs,
  p_projection public.report_projection_versions,
  p_binding public.report_projection_bindings
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(concat_ws('|', (p_package).id, (p_package).content_sha256,
    (p_package).storage_object_id, (p_package).storage_object_version, (p_validation).id,
    (p_validation).result_digest, (p_validation).report_contract_version_id,
    (p_projection).id, (p_projection).projection_digest, (p_projection).calculation_version,
    (p_binding).id, (p_package).declared_period_start, (p_package).declared_period_end,
    (p_package).period_timezone, (p_package).declared_currency), 'sha256'), 'hex')
$$;

create function private.audit_report_projection_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
begin
  if tg_op = 'INSERT' then
    event_name := 'report_package.projection_started';
  elsif new.status = 'projected' then
    event_name := 'report_package.projection_succeeded';
  elsif new.status = 'partially_projected' then
    event_name := 'report_package.projection_partially_succeeded';
  elsif new.status = 'failed' then
    event_name := 'report_package.projection_failed';
  else
    return new;
  end if;
  insert into public.audit_events (
    organization_id, event_name, actor_type, entity_type, entity_id, correlation_id, payload
  ) values (
    new.organization_id, event_name, 'system', 'integration_report_projection_run', new.id,
    new.correlation_id,
    jsonb_build_object('reportPackageId', new.report_package_id,
      'reportContractVersionId', new.report_contract_version_id,
      'reportProjectionVersionId', new.report_projection_version_id,
      'validationRunId', new.validation_run_id, 'calculationVersion', new.calculation_version,
      'status', new.status, 'resultDigest', new.result_digest, 'outputCount', new.output_count,
      'errorCodes', new.error_codes, 'warningCodes', new.warning_codes)
  );
  return new;
end;
$$;

-- An admission failure can occur before a projection run is inserted. Emit one
-- package-level failed event in that narrow case; completed runs audit themselves.
create or replace function private.audit_report_package_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
  actor_kind public.audit_actor_type;
  actor uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    event_name := case new.status
      when 'uploaded' then 'report_package.uploaded'
      when 'awaiting_contract' then 'report_package.profiled'
      when 'failed' then 'report_package.failed'
      when 'validation_failed' then case when exists (
        select 1 from public.integration_report_validation_runs run
        where run.organization_id = new.organization_id and run.report_package_id = new.id and run.status = 'failed'
      ) then null else 'report_package.validation_failed' end
      when 'projection_failed' then case when exists (
        select 1 from public.integration_report_projection_runs run
        where run.organization_id = new.organization_id and run.report_package_id = new.id and run.status = 'failed'
      ) then null else 'report_package.projection_failed' end
      else null
    end;
    if event_name is not null then
      actor_kind := case when actor is null then 'system'::public.audit_actor_type else 'user'::public.audit_actor_type end;
      insert into public.audit_events (
        organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload
      ) values (
        new.organization_id, event_name, actor_kind, actor, 'integration_report_package', new.id,
        new.correlation_id,
        jsonb_build_object('status', new.status, 'failureCode', new.safe_failure_code,
          'sheetCount', (select count(*) from public.integration_report_sheet_manifests m
            where m.organization_id = new.organization_id and m.report_package_id = new.id))
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger report_projection_versions_prevent_mutation
before update or delete on public.report_projection_versions
for each row execute function private.prevent_report_projection_evidence_mutation();
create trigger report_projection_decisions_prevent_mutation
before update or delete on public.report_projection_decisions
for each row execute function private.prevent_report_projection_evidence_mutation();
create trigger report_projection_bindings_prevent_mutation
before update or delete on public.report_projection_bindings
for each row execute function private.prevent_report_projection_binding_mutation();
create trigger integration_report_projection_runs_prevent_delete
before delete on public.integration_report_projection_runs
for each row execute function private.prevent_report_projection_evidence_mutation();
create trigger integration_report_projection_runs_prevent_mutation
before update on public.integration_report_projection_runs
for each row execute function private.prevent_report_projection_run_mutation();
create trigger exact_range_metric_observations_prevent_mutation
before update or delete on public.exact_range_metric_observations
for each row execute function private.prevent_report_projection_evidence_mutation();
create trigger report_projection_lineage_prevent_mutation
before update or delete on public.report_projection_lineage
for each row execute function private.prevent_report_projection_evidence_mutation();
create trigger integration_report_projection_runs_audit_insert
after insert on public.integration_report_projection_runs
for each row execute function private.audit_report_projection_run();
create trigger integration_report_projection_runs_audit_completion
after update on public.integration_report_projection_runs
for each row when (old.status is distinct from new.status)
execute function private.audit_report_projection_run();

create function public.propose_governed_report_projection(
  p_organization_id uuid,
  p_actor_id uuid,
  p_report_contract_version_id uuid,
  p_projection_document jsonb,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  contract_version public.report_contract_versions;
  projection_version public.report_projection_versions;
  existing private.report_projection_write_operations;
  projection_digest text;
  fingerprint text;
  next_version integer;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.contract_approve') then
    raise exception 'report projection proposal is not authorized' using errcode = '42501';
  end if;
  if char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  select * into contract_version from public.report_contract_versions
  where organization_id = p_organization_id and id = p_report_contract_version_id for update;
  if not found or not exists (select 1 from public.report_contract_decisions d
    where d.organization_id = p_organization_id and d.report_contract_version_id = p_report_contract_version_id and d.decision = 'approved') then
    raise exception 'report contract version is not approved' using errcode = '23514';
  end if;
  perform private.assert_report_projection_matches_contract(p_organization_id, contract_version, p_projection_document);
  projection_digest := encode(extensions.digest(p_projection_document::text, 'sha256'), 'hex');
  fingerprint := encode(extensions.digest(concat_ws('|', p_report_contract_version_id, projection_digest), 'sha256'), 'hex');
  select * into existing from private.report_projection_write_operations
  where organization_id = p_organization_id and operation_kind = 'propose' and idempotency_key = p_idempotency_key for update;
  if found then
    if existing.fingerprint <> fingerprint then raise exception 'idempotency key conflicts with another projection proposal' using errcode = '23505'; end if;
    select * into projection_version from public.report_projection_versions where organization_id = p_organization_id and id = existing.reference_id;
    return to_jsonb(projection_version);
  end if;
  select coalesce(max(version), 0) + 1 into next_version from public.report_projection_versions
  where organization_id = p_organization_id and report_contract_version_id = p_report_contract_version_id;
  insert into public.report_projection_versions (
    organization_id, report_contract_version_id, version, projection_document, projection_digest,
    calculation_version, proposal_source, created_by, correlation_id
  ) values (
    p_organization_id, p_report_contract_version_id, next_version, p_projection_document, projection_digest,
    1, 'human', p_actor_id, p_correlation_id
  ) returning * into projection_version;
  insert into private.report_projection_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, reference_id
  ) values (p_organization_id, 'propose', p_idempotency_key, fingerprint, projection_version.id);
  return to_jsonb(projection_version);
end;
$$;

create function public.decide_governed_report_projection(
  p_organization_id uuid,
  p_actor_id uuid,
  p_report_projection_version_id uuid,
  p_decision text,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  projection_version public.report_projection_versions;
  contract_version public.report_contract_versions;
  contract_binding public.report_contract_bindings;
  decision_row public.report_projection_decisions;
  existing private.report_projection_write_operations;
  fingerprint text;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.contract_approve') then
    raise exception 'report projection decision is not authorized' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') or char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'report projection decision is invalid' using errcode = '22023';
  end if;
  select * into projection_version from public.report_projection_versions
  where organization_id = p_organization_id and id = p_report_projection_version_id for update;
  if not found then raise exception 'report projection version was not found' using errcode = 'P0002'; end if;
  fingerprint := encode(extensions.digest(concat_ws('|', p_report_projection_version_id, p_decision, coalesce(p_reason, ''), projection_version.projection_digest), 'sha256'), 'hex');
  select * into existing from private.report_projection_write_operations
  where organization_id = p_organization_id and operation_kind = 'decide' and idempotency_key = p_idempotency_key for update;
  if found then
    if existing.fingerprint <> fingerprint then raise exception 'idempotency key conflicts with another projection decision' using errcode = '23505'; end if;
    select * into decision_row from public.report_projection_decisions where organization_id = p_organization_id and id = existing.reference_id;
    return to_jsonb(decision_row);
  end if;
  select * into contract_version from public.report_contract_versions where organization_id = p_organization_id and id = projection_version.report_contract_version_id;
  select * into contract_binding from public.report_contract_bindings
  where organization_id = p_organization_id and report_contract_version_id = projection_version.report_contract_version_id and active for update;
  if not found or not exists (select 1 from public.report_contract_decisions d where d.organization_id = p_organization_id and d.report_contract_version_id = contract_version.id and d.decision = 'approved') then
    raise exception 'report contract binding is not active' using errcode = '23514';
  end if;
  insert into public.report_projection_decisions (
    organization_id, report_projection_version_id, decision, projection_digest, reason, decided_by, correlation_id
  ) values (
    p_organization_id, projection_version.id, p_decision, projection_version.projection_digest, p_reason, p_actor_id, p_correlation_id
  ) returning * into decision_row;
  if p_decision = 'approved' then
    update public.report_projection_bindings set active = false
    where organization_id = p_organization_id and report_contract_version_id = projection_version.report_contract_version_id and active;
    insert into public.report_projection_bindings (
      organization_id, report_contract_version_id, report_contract_binding_id, report_projection_version_id,
      schema_fingerprint, declared_currency, bound_by, correlation_id
    ) values (
      p_organization_id, projection_version.report_contract_version_id, contract_binding.id, projection_version.id,
      contract_version.schema_fingerprint, contract_version.declared_currency, p_actor_id, p_correlation_id
    );
  end if;
  insert into private.report_projection_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, reference_id
  ) values (p_organization_id, 'decide', p_idempotency_key, fingerprint, decision_row.id);
  return to_jsonb(decision_row);
end;
$$;

create function public.request_governed_report_package_projection(
  p_organization_id uuid,
  p_actor_id uuid,
  p_report_package_id uuid,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package_row public.integration_report_packages;
  validation_row public.integration_report_validation_runs;
  projection_binding public.report_projection_bindings;
  existing private.report_projection_write_operations;
  fingerprint text;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.retry') then
    raise exception 'report projection request is not authorized' using errcode = '42501';
  end if;
  if char_length(p_idempotency_key) not between 16 and 200 then raise exception 'idempotency key is invalid' using errcode = '22023'; end if;
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id for update;
  if not found then raise exception 'report package was not found' using errcode = 'P0002'; end if;
  select * into validation_row from public.integration_report_validation_runs
  where organization_id = p_organization_id and report_package_id = p_report_package_id
    and status in ('validated', 'partially_validated')
  order by completed_at desc limit 1;
  select * into projection_binding from public.report_projection_bindings
  where organization_id = p_organization_id and report_contract_version_id = validation_row.report_contract_version_id and active;
  if not found then raise exception 'report projection binding is not active' using errcode = '23514'; end if;
  fingerprint := encode(extensions.digest(concat_ws('|', p_report_package_id, validation_row.id, validation_row.result_digest, projection_binding.id), 'sha256'), 'hex');
  select * into existing from private.report_projection_write_operations
  where organization_id = p_organization_id and operation_kind = 'request' and idempotency_key = p_idempotency_key for update;
  if found then
    if existing.fingerprint <> fingerprint or existing.reference_id <> p_report_package_id then raise exception 'idempotency key conflicts with another projection request' using errcode = '23505'; end if;
    return jsonb_build_object('reportPackage', to_jsonb(package_row), 'reportProjectionVersionId', projection_binding.report_projection_version_id);
  end if;
  if package_row.status not in ('validated', 'partially_validated', 'projection_failed') or package_row.retained_until <= now() then
    raise exception 'report package is not eligible for projection' using errcode = '23514';
  end if;
  update public.integration_report_packages set status = 'awaiting_projection', safe_failure_code = null,
    safe_failure_at = null, correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = p_report_package_id returning * into package_row;
  insert into private.report_projection_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, reference_id
  ) values (p_organization_id, 'request', p_idempotency_key, fingerprint, p_report_package_id);
  return jsonb_build_object('reportPackage', to_jsonb(package_row), 'reportProjectionVersionId', projection_binding.report_projection_version_id);
end;
$$;

create function public.claim_governed_report_package_projection(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_report_contract_version_id uuid,
  p_report_projection_version_id uuid,
  p_projection_run_id uuid,
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
  package_row public.integration_report_packages;
  validation_row public.integration_report_validation_runs;
  projection_version public.report_projection_versions;
  projection_binding public.report_projection_bindings;
  operation private.integration_report_projection_operations;
  existing_run public.integration_report_projection_runs;
  object_row storage.objects;
  input_digest text;
begin
  if char_length(p_idempotency_key) not between 16 and 200 then raise exception 'idempotency key is invalid' using errcode = '22023'; end if;
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  select * into operation from private.integration_report_projection_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id for update;
  if found then
    if operation.idempotency_key <> p_idempotency_key or operation.projection_run_id <> p_projection_run_id then return jsonb_build_object('outcome', 'conflict'); end if;
    select * into existing_run from public.integration_report_projection_runs where organization_id = p_organization_id and id = operation.projection_run_id;
    if existing_run.report_contract_version_id <> p_report_contract_version_id or existing_run.report_projection_version_id <> p_report_projection_version_id then return jsonb_build_object('outcome', 'conflict'); end if;
    if existing_run.status <> 'running' then return jsonb_build_object('outcome', 'completed', 'projectionRunId', existing_run.id); end if;
    if operation.claim_token <> p_claim_token and operation.lease_expires_at > now() then return jsonb_build_object('outcome', 'in_progress', 'projectionRunId', existing_run.id); end if;
    update private.integration_report_projection_operations set claim_token = p_claim_token,
      lease_expires_at = now() + interval '20 minutes', attempt_count = attempt_count + 1, updated_at = now()
    where organization_id = p_organization_id and report_package_id = p_report_package_id;
    return jsonb_build_object('outcome', 'acquired', 'reportPackage', to_jsonb(package_row),
      'contractVersion', (select to_jsonb(v) from public.report_contract_versions v where v.organization_id = p_organization_id and v.id = existing_run.report_contract_version_id),
      'projectionVersion', (select to_jsonb(v) from public.report_projection_versions v where v.organization_id = p_organization_id and v.id = existing_run.report_projection_version_id));
  end if;
  if package_row.status not in ('awaiting_projection', 'projecting') then return jsonb_build_object('outcome', 'not_ready'); end if;
  if package_row.retained_until <= now() then
    update public.integration_report_packages set status = 'projection_failed', safe_failure_code = 'PACKAGE_EXPIRED', safe_failure_at = now(), correlation_id = p_correlation_id where organization_id = p_organization_id and id = p_report_package_id;
    return jsonb_build_object('outcome', 'expired');
  end if;
  select * into validation_row from public.integration_report_validation_runs
  where organization_id = p_organization_id and report_package_id = p_report_package_id
    and report_contract_version_id = p_report_contract_version_id and status in ('validated', 'partially_validated')
  order by completed_at desc limit 1;
  select * into projection_version from public.report_projection_versions
  where organization_id = p_organization_id and id = p_report_projection_version_id and report_contract_version_id = p_report_contract_version_id;
  select * into projection_binding from public.report_projection_bindings
  where organization_id = p_organization_id and report_projection_version_id = p_report_projection_version_id
    and report_contract_version_id = p_report_contract_version_id and active for update;
  if not found or validation_row.id is null
    or projection_binding.report_contract_binding_id <> validation_row.report_contract_binding_id
    or package_row.schema_fingerprint <> projection_binding.schema_fingerprint
    or package_row.declared_currency <> projection_binding.declared_currency then
    return jsonb_build_object('outcome', 'not_ready');
  end if;
  select * into object_row from storage.objects where bucket_id = package_row.storage_bucket_id and name = package_row.storage_path;
  if not found or object_row.id <> package_row.storage_object_id or object_row.version <> package_row.storage_object_version then
    update public.integration_report_packages set status = 'projection_failed', safe_failure_code = 'OBJECT_IDENTITY_CHANGED', safe_failure_at = now(), correlation_id = p_correlation_id where organization_id = p_organization_id and id = p_report_package_id;
    return jsonb_build_object('outcome', 'object_mismatch');
  end if;
  input_digest := private.report_projection_input_digest(package_row, validation_row, projection_version, projection_binding);
  insert into public.integration_report_projection_runs (
    id, organization_id, report_package_id, report_contract_version_id, report_contract_binding_id,
    report_projection_version_id, report_projection_binding_id, validation_run_id, calculation_version,
    input_digest, status, correlation_id
  ) values (
    p_projection_run_id, p_organization_id, p_report_package_id, p_report_contract_version_id, validation_row.report_contract_binding_id,
    p_report_projection_version_id, projection_binding.id, validation_row.id, projection_version.calculation_version,
    input_digest, 'running', p_correlation_id
  );
  insert into private.integration_report_projection_operations (
    organization_id, report_package_id, idempotency_key, input_digest, projection_run_id, claim_token, lease_expires_at
  ) values (
    p_organization_id, p_report_package_id, p_idempotency_key, input_digest, p_projection_run_id, p_claim_token, now() + interval '20 minutes'
  );
  update public.integration_report_packages set status = 'projecting', safe_failure_code = null, safe_failure_at = null, correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = p_report_package_id;
  return jsonb_build_object('outcome', 'acquired', 'reportPackage', to_jsonb(package_row),
    'contractVersion', (select to_jsonb(v) from public.report_contract_versions v where v.organization_id = p_organization_id and v.id = p_report_contract_version_id),
    'projectionVersion', to_jsonb(projection_version));
end;
$$;

create function public.complete_governed_report_package_projection(
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
  projection_document jsonb;
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
  select projection_document into projection_document from public.report_projection_versions
  where organization_id = p_organization_id and id = run_row.report_projection_version_id;
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
      select 1 from jsonb_array_elements(projection_document -> 'outputs') expected
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

create function public.fail_governed_report_package_projection(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_projection_run_id uuid,
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
  operation private.integration_report_projection_operations;
  run_row public.integration_report_projection_runs;
  package_row public.integration_report_packages;
begin
  if p_failure_code not in ('OBJECT_IDENTITY_CHANGED', 'OBJECT_UNAVAILABLE', 'PACKAGE_EXPIRED',
    'PROJECTION_VERSION_NOT_APPROVED', 'PROJECTION_BINDING_INACTIVE', 'PROJECTION_CONTEXT_MISMATCH',
    'UNREADABLE_WORKBOOK', 'PROJECTION_PROCESSING_FAILED') or p_result_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'report projection failure is invalid' using errcode = '22023';
  end if;
  select * into operation from private.integration_report_projection_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id for update;
  if not found or operation.projection_run_id <> p_projection_run_id or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then return null; end if;
  select * into run_row from public.integration_report_projection_runs
  where organization_id = p_organization_id and id = p_projection_run_id and status = 'running' for update;
  if not found then return null; end if;
  update public.integration_report_projection_runs set status = 'failed', quality_state = 'failed', completeness_state = 'unavailable',
    result_digest = p_result_digest, error_codes = jsonb_build_array(p_failure_code), warning_codes = '[]'::jsonb, completed_at = now()
  where organization_id = p_organization_id and id = p_projection_run_id;
  update public.integration_report_packages set status = 'projection_failed', safe_failure_code = p_failure_code, safe_failure_at = now()
  where organization_id = p_organization_id and id = p_report_package_id returning * into package_row;
  return to_jsonb(package_row);
end;
$$;

revoke all on function private.prevent_report_projection_evidence_mutation() from public;
revoke all on function private.prevent_report_projection_run_mutation() from public;
revoke all on function private.prevent_report_projection_binding_mutation() from public;
revoke all on function private.assert_report_projection_document(jsonb) from public;
revoke all on function private.assert_report_projection_matches_contract(uuid, public.report_contract_versions, jsonb) from public;
revoke all on function private.report_projection_input_digest(public.integration_report_packages, public.integration_report_validation_runs, public.report_projection_versions, public.report_projection_bindings) from public;
revoke all on function private.audit_report_projection_run() from public;
revoke all on table public.report_projection_versions, public.report_projection_decisions, public.report_projection_bindings,
  public.integration_report_projection_runs, public.exact_range_metric_observations, public.report_projection_lineage from public, anon, authenticated;
revoke all on table private.integration_report_projection_operations, private.report_projection_write_operations from public, anon, authenticated;

alter table public.report_projection_versions enable row level security;
alter table public.report_projection_versions force row level security;
alter table public.report_projection_decisions enable row level security;
alter table public.report_projection_decisions force row level security;
alter table public.report_projection_bindings enable row level security;
alter table public.report_projection_bindings force row level security;
alter table public.integration_report_projection_runs enable row level security;
alter table public.integration_report_projection_runs force row level security;
alter table public.exact_range_metric_observations enable row level security;
alter table public.exact_range_metric_observations force row level security;
alter table public.report_projection_lineage enable row level security;
alter table public.report_projection_lineage force row level security;
alter table private.integration_report_projection_operations enable row level security;
alter table private.integration_report_projection_operations force row level security;
alter table private.report_projection_write_operations enable row level security;
alter table private.report_projection_write_operations force row level security;

create policy "members with report read can view report projection versions"
on public.report_projection_versions for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view report projection decisions"
on public.report_projection_decisions for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view report projection bindings"
on public.report_projection_bindings for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view report projection runs"
on public.integration_report_projection_runs for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view exact range metric observations"
on public.exact_range_metric_observations for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view report projection lineage"
on public.report_projection_lineage for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));

grant select on table public.report_projection_versions, public.report_projection_decisions, public.report_projection_bindings,
  public.integration_report_projection_runs, public.exact_range_metric_observations, public.report_projection_lineage to authenticated;
revoke all on function public.propose_governed_report_projection(uuid, uuid, uuid, jsonb, text, uuid) from public, anon;
revoke all on function public.decide_governed_report_projection(uuid, uuid, uuid, text, text, text, uuid) from public, anon;
revoke all on function public.request_governed_report_package_projection(uuid, uuid, uuid, text, uuid) from public, anon;
revoke all on function public.claim_governed_report_package_projection(uuid, uuid, uuid, uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_governed_report_package_projection(uuid, uuid, uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.fail_governed_report_package_projection(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.propose_governed_report_projection(uuid, uuid, uuid, jsonb, text, uuid) to authenticated;
grant execute on function public.decide_governed_report_projection(uuid, uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.request_governed_report_package_projection(uuid, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.claim_governed_report_package_projection(uuid, uuid, uuid, uuid, uuid, text, uuid, uuid) to service_role;
grant execute on function public.complete_governed_report_package_projection(uuid, uuid, uuid, uuid, text, jsonb, jsonb) to service_role;
grant execute on function public.fail_governed_report_package_projection(uuid, uuid, uuid, uuid, text, text) to service_role;
