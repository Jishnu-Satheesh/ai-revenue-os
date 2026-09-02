-- Deterministic post-contract report validation. Validation consumes private
-- Storage objects and approved contract structure only; it stores bounded
-- evidence, never workbook cells, rows, formula text, customer data, or URLs.

alter table public.integration_report_packages
  drop constraint integration_report_packages_status_check,
  add constraint integration_report_packages_status_check check (status in (
    'awaiting_upload', 'uploaded', 'profiling', 'awaiting_contract', 'awaiting_approval',
    'awaiting_validation', 'validating', 'validated', 'partially_validated',
    'validation_failed', 'failed'
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
    'UNDECLARED_SHEET_PRESENT', 'VALIDATION_PROCESSING_FAILED'
  ));

create table public.integration_report_validation_runs (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  report_package_id uuid not null,
  report_contract_version_id uuid not null,
  report_contract_binding_id uuid not null,
  validator_version integer not null check (validator_version = 1),
  input_digest text not null check (input_digest ~ '^[a-f0-9]{64}$'),
  result_digest text check (result_digest is null or result_digest ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('running', 'validated', 'partially_validated', 'failed')),
  quality_state text check (quality_state is null or quality_state in ('complete', 'partial', 'failed')),
  completeness_state text check (completeness_state is null or completeness_state in ('complete', 'partial', 'unavailable')),
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
  check ((status = 'running' and completed_at is null and result_digest is null)
    or (status <> 'running' and completed_at is not null and result_digest is not null))
);

create table public.integration_report_validation_sheet_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  validation_run_id uuid not null,
  normalized_sheet_name text not null check (normalized_sheet_name ~ '^[a-z][a-z0-9_]{0,63}$'),
  required boolean not null,
  outcome text not null check (outcome in ('validated', 'warning', 'failed')),
  row_count integer not null check (row_count between 0 and 250000),
  populated_cell_count integer not null check (populated_cell_count between 0 and 2500000),
  parsed_field_success_count integer not null check (parsed_field_success_count between 0 and 62500000),
  parsed_field_failure_count integer not null check (parsed_field_failure_count between 0 and 62500000),
  error_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(error_codes) = 'array' and jsonb_array_length(error_codes) <= 50),
  warning_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(warning_codes) = 'array' and jsonb_array_length(warning_codes) <= 50),
  created_at timestamptz not null default now(),
  unique (organization_id, validation_run_id, normalized_sheet_name),
  foreign key (organization_id, validation_run_id)
    references public.integration_report_validation_runs(organization_id, id) on delete restrict
);

create table public.integration_report_validation_control_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  validation_run_id uuid not null,
  control_key text not null check (control_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  control_kind text not null check (control_kind in ('row_count', 'populated_cell_count')),
  normalized_sheet_name text not null check (normalized_sheet_name ~ '^[a-z][a-z0-9_]{0,63}$'),
  expected_count integer not null check (expected_count between 0 and 2500000),
  actual_count integer not null check (actual_count between 0 and 2500000),
  tolerance integer not null check (tolerance between 0 and 1000000),
  passed boolean not null,
  created_at timestamptz not null default now(),
  unique (organization_id, validation_run_id, control_key),
  foreign key (organization_id, validation_run_id)
    references public.integration_report_validation_runs(organization_id, id) on delete restrict
);

create table private.integration_report_validation_operations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_package_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  input_digest text not null check (input_digest ~ '^[a-f0-9]{64}$'),
  validation_run_id uuid not null,
  claim_token uuid not null,
  lease_expires_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, report_package_id),
  unique (organization_id, idempotency_key),
  unique (organization_id, validation_run_id),
  foreign key (organization_id, report_package_id)
    references public.integration_report_packages(organization_id, id) on delete restrict,
  foreign key (organization_id, validation_run_id)
    references public.integration_report_validation_runs(organization_id, id) on delete restrict
);

create index integration_report_validation_runs_package_idx
  on public.integration_report_validation_runs (organization_id, report_package_id, created_at desc);
create index integration_report_validation_sheet_results_run_idx
  on public.integration_report_validation_sheet_results (organization_id, validation_run_id);
create index integration_report_validation_control_results_run_idx
  on public.integration_report_validation_control_results (organization_id, validation_run_id);

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
    or (old.status = 'validation_failed' and new.status in ('validation_failed', 'awaiting_validation'))
    or (old.status in ('validated', 'partially_validated') and new.status = old.status)
    or (old.status = 'failed' and new.status in ('failed', 'uploaded'))
  ) then
    raise exception 'report_package_status_transition_is_invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.prevent_report_validation_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'report_validation_evidence_is_append_only' using errcode = '55000';
end;
$$;

create function private.prevent_report_validation_run_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.report_package_id is distinct from old.report_package_id
    or new.report_contract_version_id is distinct from old.report_contract_version_id
    or new.report_contract_binding_id is distinct from old.report_contract_binding_id
    or new.validator_version is distinct from old.validator_version
    or new.input_digest is distinct from old.input_digest
    or new.correlation_id is distinct from old.correlation_id
    or new.started_at is distinct from old.started_at
    or new.created_at is distinct from old.created_at
    or old.status <> 'running'
    or new.status not in ('validated', 'partially_validated', 'failed') then
    raise exception 'report_validation_run_is_immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

create function private.assert_report_validation_codes(p_codes jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_codes) <> 'array' or jsonb_array_length(p_codes) > 50
    or exists (
      select 1 from jsonb_array_elements_text(p_codes) code
      where code not in (
        'REQUIRED_SHEET_MISSING', 'OPTIONAL_SHEET_MISSING', 'UNDECLARED_SHEET_PRESENT',
        'REQUIRED_SOURCE_HEADER_MISSING', 'REQUIRED_FIELD_MISSING', 'OPTIONAL_FIELD_MISSING',
        'INVALID_INTEGER', 'INVALID_DECIMAL', 'INVALID_MONEY', 'INVALID_LOCAL_DATE', 'INVALID_TIMESTAMP',
        'INVALID_DURATION', 'INVALID_PERCENTAGE', 'INVALID_TEXT', 'INVALID_ENUM', 'FORMULA_REJECTED',
        'FORMULA_VALUE_UNSUPPORTED', 'MERGED_CELLS_REJECTED', 'CONTROL_MISMATCH',
        'OBJECT_IDENTITY_CHANGED', 'OBJECT_UNAVAILABLE', 'PACKAGE_EXPIRED',
        'CONTRACT_VERSION_NOT_APPROVED', 'CONTRACT_BINDING_INACTIVE', 'CONTRACT_CONTEXT_MISMATCH',
        'VALIDATION_PROCESSING_FAILED', 'UNREADABLE_WORKBOOK'
      )
    ) then
    raise exception 'report validation codes are invalid' using errcode = '22023';
  end if;
end;
$$;

create function private.report_validation_input_digest(
  p_package public.integration_report_packages,
  p_contract_version public.report_contract_versions,
  p_binding public.report_contract_bindings
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(concat_ws('|', (p_package).id, (p_package).content_sha256,
    (p_package).schema_fingerprint, (p_package).declared_currency, (p_contract_version).id,
    (p_contract_version).mapping_digest, (p_binding).id, (p_binding).schema_fingerprint,
    (p_binding).declared_currency, (p_package).storage_object_id, (p_package).storage_object_version), 'sha256'), 'hex')
$$;

create function private.audit_report_validation_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
  sheet_count integer;
  control_count integer;
begin
  if tg_op = 'INSERT' then
    event_name := 'report_package.validation_started';
  elsif new.status = 'validated' then
    event_name := 'report_package.validation_succeeded';
  elsif new.status = 'partially_validated' then
    event_name := 'report_package.validation_partially_succeeded';
  elsif new.status = 'failed' then
    event_name := 'report_package.validation_failed';
  else
    return new;
  end if;
  select count(*) into sheet_count from public.integration_report_validation_sheet_results
  where organization_id = new.organization_id and validation_run_id = new.id;
  select count(*) into control_count from public.integration_report_validation_control_results
  where organization_id = new.organization_id and validation_run_id = new.id;
  insert into public.audit_events (
    organization_id, event_name, actor_type, entity_type, entity_id, correlation_id, payload
  ) values (
    new.organization_id, event_name, 'system', 'integration_report_validation_run', new.id,
    new.correlation_id,
    jsonb_build_object('reportPackageId', new.report_package_id,
      'reportContractVersionId', new.report_contract_version_id,
      'reportContractBindingId', new.report_contract_binding_id,
      'validatorVersion', new.validator_version, 'status', new.status,
      'resultDigest', new.result_digest, 'errorCodes', new.error_codes,
      'warningCodes', new.warning_codes, 'sheetCount', sheet_count,
      'controlCount', control_count)
  );
  return new;
end;
$$;

create trigger integration_report_validation_runs_prevent_delete
before delete on public.integration_report_validation_runs
for each row execute function private.prevent_report_validation_evidence_mutation();
create trigger integration_report_validation_runs_prevent_mutation
before update on public.integration_report_validation_runs
for each row execute function private.prevent_report_validation_run_mutation();
create trigger integration_report_validation_sheet_results_prevent_mutation
before update or delete on public.integration_report_validation_sheet_results
for each row execute function private.prevent_report_validation_evidence_mutation();
create trigger integration_report_validation_control_results_prevent_mutation
before update or delete on public.integration_report_validation_control_results
for each row execute function private.prevent_report_validation_evidence_mutation();
create trigger integration_report_validation_runs_audit_insert
after insert on public.integration_report_validation_runs
for each row execute function private.audit_report_validation_run();
create trigger integration_report_validation_runs_audit_completion
after update on public.integration_report_validation_runs
for each row when (old.status is distinct from new.status)
execute function private.audit_report_validation_run();

create function public.claim_governed_report_package_validation(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_report_contract_version_id uuid,
  p_validation_run_id uuid,
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
  version_row public.report_contract_versions;
  binding_row public.report_contract_bindings;
  operation private.integration_report_validation_operations;
  existing_run public.integration_report_validation_runs;
  object_row storage.objects;
  input_digest text;
begin
  if char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  select * into operation from private.integration_report_validation_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id for update;
  if found then
    if operation.idempotency_key <> p_idempotency_key or operation.validation_run_id <> p_validation_run_id then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    select * into existing_run from public.integration_report_validation_runs
    where organization_id = p_organization_id and id = operation.validation_run_id;
    if existing_run.report_contract_version_id <> p_report_contract_version_id then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    if existing_run.status <> 'running' then return jsonb_build_object('outcome', 'completed', 'validationRunId', existing_run.id); end if;
    if operation.claim_token <> p_claim_token and operation.lease_expires_at > now() then
      return jsonb_build_object('outcome', 'in_progress', 'validationRunId', existing_run.id);
    end if;
    update private.integration_report_validation_operations set claim_token = p_claim_token,
      lease_expires_at = now() + interval '20 minutes', attempt_count = attempt_count + 1, updated_at = now()
    where organization_id = p_organization_id and report_package_id = p_report_package_id;
    select * into version_row from public.report_contract_versions
    where organization_id = p_organization_id and id = existing_run.report_contract_version_id;
    return jsonb_build_object('outcome', 'acquired', 'reportPackage', to_jsonb(package_row),
      'contractVersion', to_jsonb(version_row),
      'sheetManifests', coalesce((select jsonb_agg(to_jsonb(m) order by m.sheet_position) from public.integration_report_sheet_manifests m where m.organization_id = p_organization_id and m.report_package_id = p_report_package_id), '[]'::jsonb));
  end if;
  if package_row.status not in ('awaiting_validation', 'validating') then
    return jsonb_build_object('outcome', 'not_ready');
  end if;
  if package_row.retained_until <= now() then
    update public.integration_report_packages set status = 'validation_failed', safe_failure_code = 'PACKAGE_EXPIRED', safe_failure_at = now(), correlation_id = p_correlation_id
    where organization_id = p_organization_id and id = p_report_package_id;
    return jsonb_build_object('outcome', 'expired');
  end if;
  select * into version_row from public.report_contract_versions
  where organization_id = p_organization_id and id = p_report_contract_version_id and report_package_id = p_report_package_id;
  if not found or not exists (select 1 from public.report_contract_decisions d where d.organization_id = p_organization_id and d.report_contract_version_id = p_report_contract_version_id and d.decision = 'approved') then
    return jsonb_build_object('outcome', 'not_ready');
  end if;
  select * into binding_row from public.report_contract_bindings
  where organization_id = p_organization_id and report_contract_version_id = version_row.id and active for update;
  if not found
    or package_row.schema_fingerprint is distinct from version_row.schema_fingerprint
    or package_row.schema_fingerprint is distinct from binding_row.schema_fingerprint
    or package_row.declared_currency is distinct from version_row.declared_currency
    or package_row.declared_currency is distinct from binding_row.declared_currency
    or package_row.channel_id is distinct from binding_row.channel_id
    or package_row.report_type is distinct from binding_row.report_type
    or binding_row.outlet_grain <> 'branch'
    or package_row.content_sha256 is null
    or package_row.storage_object_id is null
    or package_row.storage_object_version is null then
    return jsonb_build_object('outcome', 'not_ready');
  end if;
  select * into object_row from storage.objects where bucket_id = package_row.storage_bucket_id and name = package_row.storage_path;
  if not found or object_row.id <> package_row.storage_object_id or object_row.version <> package_row.storage_object_version then
    update public.integration_report_packages set status = 'validation_failed', safe_failure_code = 'OBJECT_IDENTITY_CHANGED', safe_failure_at = now(), correlation_id = p_correlation_id
    where organization_id = p_organization_id and id = p_report_package_id;
    return jsonb_build_object('outcome', 'object_mismatch');
  end if;
  input_digest := private.report_validation_input_digest(package_row, version_row, binding_row);
  insert into public.integration_report_validation_runs (
    id, organization_id, report_package_id, report_contract_version_id, report_contract_binding_id,
    validator_version, input_digest, status, correlation_id
  ) values (
    p_validation_run_id, p_organization_id, p_report_package_id, version_row.id, binding_row.id,
    1, input_digest, 'running', p_correlation_id
  );
  insert into private.integration_report_validation_operations (
    organization_id, report_package_id, idempotency_key, input_digest, validation_run_id, claim_token, lease_expires_at, attempt_count
  ) values (
    p_organization_id, p_report_package_id, p_idempotency_key, input_digest, p_validation_run_id, p_claim_token, now() + interval '20 minutes', 1
  );
  update public.integration_report_packages set status = 'validating', safe_failure_code = null, safe_failure_at = null, correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = p_report_package_id;
  return jsonb_build_object('outcome', 'acquired', 'reportPackage', to_jsonb(package_row),
    'contractVersion', to_jsonb(version_row),
    'sheetManifests', coalesce((select jsonb_agg(to_jsonb(m) order by m.sheet_position) from public.integration_report_sheet_manifests m where m.organization_id = p_organization_id and m.report_package_id = p_report_package_id), '[]'::jsonb));
end;
$$;

create function public.complete_governed_report_package_validation(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_validation_run_id uuid,
  p_claim_token uuid,
  p_result_digest text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.integration_report_validation_operations;
  run_row public.integration_report_validation_runs;
  package_row public.integration_report_packages;
  object_row storage.objects;
  sheet jsonb;
  control jsonb;
  final_status text;
begin
  if p_result_digest !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_result) <> 'object'
    or (select bool_or(key not in ('status', 'qualityState', 'completenessState', 'sheetResults', 'controlResults', 'errorCodes', 'warningCodes')) from jsonb_object_keys(p_result) key)
    or p_result ->> 'status' not in ('validated', 'partially_validated', 'failed')
    or p_result ->> 'qualityState' not in ('complete', 'partial', 'failed')
    or p_result ->> 'completenessState' not in ('complete', 'partial', 'unavailable')
    or jsonb_typeof(p_result -> 'sheetResults') <> 'array' or jsonb_array_length(p_result -> 'sheetResults') > 25
    or jsonb_typeof(p_result -> 'controlResults') <> 'array' or jsonb_array_length(p_result -> 'controlResults') > 50 then
    raise exception 'report validation evidence is invalid' using errcode = '22023';
  end if;
  perform private.assert_report_validation_codes(p_result -> 'errorCodes');
  perform private.assert_report_validation_codes(p_result -> 'warningCodes');
  select * into operation from private.integration_report_validation_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id for update;
  if not found or operation.validation_run_id <> p_validation_run_id or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then return null; end if;
  select * into run_row from public.integration_report_validation_runs
  where organization_id = p_organization_id and id = p_validation_run_id and status = 'running' for update;
  if not found then return null; end if;
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id and status = 'validating' for update;
  if not found then return null; end if;
  select * into object_row from storage.objects where bucket_id = package_row.storage_bucket_id and name = package_row.storage_path;
  if not found or object_row.id <> package_row.storage_object_id or object_row.version <> package_row.storage_object_version then
    raise exception 'report validation object identity changed' using errcode = '23514';
  end if;
  for sheet in select value from jsonb_array_elements(p_result -> 'sheetResults') loop
    if jsonb_typeof(sheet) <> 'object'
      or (select bool_or(key not in ('normalizedSheetName', 'required', 'rowCount', 'populatedCellCount', 'parsedFieldSuccessCount', 'parsedFieldFailureCount', 'errorCodes', 'warningCodes')) from jsonb_object_keys(sheet) key)
      or coalesce(sheet ->> 'normalizedSheetName', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or jsonb_typeof(sheet -> 'required') <> 'boolean'
      or coalesce((sheet ->> 'rowCount')::integer, -1) not between 0 and 250000
      or coalesce((sheet ->> 'populatedCellCount')::integer, -1) not between 0 and 2500000
      or coalesce((sheet ->> 'parsedFieldSuccessCount')::integer, -1) not between 0 and 62500000
      or coalesce((sheet ->> 'parsedFieldFailureCount')::integer, -1) not between 0 and 62500000 then
      raise exception 'report validation sheet evidence is invalid' using errcode = '22023';
    end if;
    perform private.assert_report_validation_codes(sheet -> 'errorCodes');
    perform private.assert_report_validation_codes(sheet -> 'warningCodes');
  end loop;
  for control in select value from jsonb_array_elements(p_result -> 'controlResults') loop
    if jsonb_typeof(control) <> 'object'
      or (select bool_or(key not in ('key', 'kind', 'normalizedSheetName', 'expectedCount', 'actualCount', 'tolerance', 'passed')) from jsonb_object_keys(control) key)
      or coalesce(control ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or control ->> 'kind' not in ('row_count', 'populated_cell_count')
      or coalesce(control ->> 'normalizedSheetName', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce((control ->> 'expectedCount')::integer, -1) not between 0 and 2500000
      or coalesce((control ->> 'actualCount')::integer, -1) not between 0 and 2500000
      or coalesce((control ->> 'tolerance')::integer, -1) not between 0 and 1000000
      or jsonb_typeof(control -> 'passed') <> 'boolean' then
      raise exception 'report validation control evidence is invalid' using errcode = '22023';
    end if;
  end loop;
  final_status := p_result ->> 'status';
  insert into public.integration_report_validation_sheet_results (
    organization_id, validation_run_id, normalized_sheet_name, required, outcome, row_count, populated_cell_count,
    parsed_field_success_count, parsed_field_failure_count, error_codes, warning_codes
  ) select p_organization_id, p_validation_run_id, value ->> 'normalizedSheetName',
    (value ->> 'required')::boolean,
    case when jsonb_array_length(value -> 'errorCodes') > 0 then 'failed' when jsonb_array_length(value -> 'warningCodes') > 0 then 'warning' else 'validated' end,
    (value ->> 'rowCount')::integer, (value ->> 'populatedCellCount')::integer,
    (value ->> 'parsedFieldSuccessCount')::integer, (value ->> 'parsedFieldFailureCount')::integer,
    value -> 'errorCodes', value -> 'warningCodes'
  from jsonb_array_elements(p_result -> 'sheetResults');
  insert into public.integration_report_validation_control_results (
    organization_id, validation_run_id, control_key, control_kind, normalized_sheet_name, expected_count, actual_count, tolerance, passed
  ) select p_organization_id, p_validation_run_id, value ->> 'key', value ->> 'kind', value ->> 'normalizedSheetName',
    (value ->> 'expectedCount')::integer, (value ->> 'actualCount')::integer, (value ->> 'tolerance')::integer, (value ->> 'passed')::boolean
  from jsonb_array_elements(p_result -> 'controlResults');
  update public.integration_report_validation_runs set status = final_status, quality_state = p_result ->> 'qualityState',
    completeness_state = p_result ->> 'completenessState', result_digest = p_result_digest,
    error_codes = p_result -> 'errorCodes', warning_codes = p_result -> 'warningCodes', completed_at = now()
  where organization_id = p_organization_id and id = p_validation_run_id;
  update public.integration_report_packages set status = case final_status when 'validated' then 'validated' when 'partially_validated' then 'partially_validated' else 'validation_failed' end,
    safe_failure_code = case when final_status = 'failed' then coalesce(p_result -> 'errorCodes' ->> 0, 'VALIDATION_PROCESSING_FAILED') else null end,
    safe_failure_at = case when final_status = 'failed' then now() else null end
  where organization_id = p_organization_id and id = p_report_package_id
  returning * into package_row;
  return to_jsonb(package_row);
end;
$$;

create function public.fail_governed_report_package_validation(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_validation_run_id uuid,
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
  operation private.integration_report_validation_operations;
  run_row public.integration_report_validation_runs;
  package_row public.integration_report_packages;
begin
  if p_failure_code not in ('OBJECT_IDENTITY_CHANGED', 'OBJECT_UNAVAILABLE', 'PACKAGE_EXPIRED',
    'CONTRACT_VERSION_NOT_APPROVED', 'CONTRACT_BINDING_INACTIVE', 'CONTRACT_CONTEXT_MISMATCH',
    'UNREADABLE_WORKBOOK', 'VALIDATION_PROCESSING_FAILED') or p_result_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'report validation failure is invalid' using errcode = '22023';
  end if;
  select * into operation from private.integration_report_validation_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id for update;
  if not found or operation.validation_run_id <> p_validation_run_id or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then return null; end if;
  select * into run_row from public.integration_report_validation_runs
  where organization_id = p_organization_id and id = p_validation_run_id and status = 'running' for update;
  if not found then return null; end if;
  update public.integration_report_validation_runs set status = 'failed', quality_state = 'failed', completeness_state = 'unavailable',
    result_digest = p_result_digest, error_codes = jsonb_build_array(p_failure_code), warning_codes = '[]'::jsonb, completed_at = now()
  where organization_id = p_organization_id and id = p_validation_run_id;
  update public.integration_report_packages set status = 'validation_failed', safe_failure_code = p_failure_code,
    safe_failure_at = now()
  where organization_id = p_organization_id and id = p_report_package_id
  returning * into package_row;
  return to_jsonb(package_row);
end;
$$;

create function public.retry_governed_report_package_validation(
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
  existing private.integration_report_write_operations;
  fingerprint text;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.retry') then
    raise exception 'report validation retry is not authorized' using errcode = '42501';
  end if;
  if char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id for update;
  if not found then raise exception 'report package was not found' using errcode = 'P0002'; end if;
  fingerprint := encode(extensions.digest(concat_ws('|', p_report_package_id, package_row.content_sha256, package_row.schema_fingerprint), 'sha256'), 'hex');
  select * into existing from private.integration_report_write_operations
  where organization_id = p_organization_id and operation_kind = 'retry' and idempotency_key = p_idempotency_key for update;
  if found then
    if existing.fingerprint <> fingerprint or existing.report_package_id <> p_report_package_id then
      raise exception 'idempotency key conflicts with another retry' using errcode = '23505';
    end if;
    return to_jsonb(package_row);
  end if;
  if package_row.status <> 'validation_failed' or package_row.retained_until <= now() then
    raise exception 'report package is not eligible for validation retry' using errcode = '23514';
  end if;
  update public.integration_report_packages set status = 'awaiting_validation', safe_failure_code = null,
    safe_failure_at = null, correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = p_report_package_id returning * into package_row;
  insert into private.integration_report_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, report_package_id
  ) values (p_organization_id, 'retry', p_idempotency_key, fingerprint, p_report_package_id);
  return to_jsonb(package_row);
end;
$$;

revoke all on function private.prevent_report_validation_evidence_mutation() from public;
revoke all on function private.prevent_report_validation_run_mutation() from public;
revoke all on function private.assert_report_validation_codes(jsonb) from public;
revoke all on function private.report_validation_input_digest(public.integration_report_packages, public.report_contract_versions, public.report_contract_bindings) from public;
revoke all on function private.audit_report_validation_run() from public;
revoke all on table public.integration_report_validation_runs from public, anon, authenticated;
revoke all on table public.integration_report_validation_sheet_results from public, anon, authenticated;
revoke all on table public.integration_report_validation_control_results from public, anon, authenticated;
revoke all on table private.integration_report_validation_operations from public, anon, authenticated;
grant select on table public.integration_report_validation_runs, public.integration_report_validation_sheet_results,
  public.integration_report_validation_control_results to authenticated;

alter table public.integration_report_validation_runs enable row level security;
alter table public.integration_report_validation_runs force row level security;
alter table public.integration_report_validation_sheet_results enable row level security;
alter table public.integration_report_validation_sheet_results force row level security;
alter table public.integration_report_validation_control_results enable row level security;
alter table public.integration_report_validation_control_results force row level security;
alter table private.integration_report_validation_operations enable row level security;
alter table private.integration_report_validation_operations force row level security;
create policy "members with report read can view report validation runs"
on public.integration_report_validation_runs for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view report validation sheet results"
on public.integration_report_validation_sheet_results for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view report validation control results"
on public.integration_report_validation_control_results for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));

revoke all on function public.claim_governed_report_package_validation(uuid, uuid, uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_governed_report_package_validation(uuid, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_governed_report_package_validation(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.retry_governed_report_package_validation(uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.claim_governed_report_package_validation(uuid, uuid, uuid, uuid, text, uuid, uuid) to service_role;
grant execute on function public.complete_governed_report_package_validation(uuid, uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.fail_governed_report_package_validation(uuid, uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.retry_governed_report_package_validation(uuid, uuid, uuid, text, uuid) to authenticated;
