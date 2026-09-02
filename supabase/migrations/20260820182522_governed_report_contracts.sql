-- Governed report contracts: value-free schema fingerprints and exact human
-- approval. This migration deliberately creates no model route, no workbook
-- row persistence, and no financial projection.

alter table public.integration_report_packages
  add column parser_version integer not null default 1 check (parser_version = 1),
  add column fingerprint_version integer not null default 1 check (fingerprint_version = 1),
  add column schema_fingerprint text check (schema_fingerprint is null or schema_fingerprint ~ '^[a-f0-9]{64}$');

alter table public.integration_report_packages
  drop constraint integration_report_packages_status_check,
  add constraint integration_report_packages_status_check
    check (status in ('awaiting_upload', 'uploaded', 'profiling', 'awaiting_contract', 'awaiting_approval', 'awaiting_validation', 'failed'));

alter table public.integration_report_sheet_manifests
  add column normalized_sheet_name text not null default 'unknown' check (normalized_sheet_name ~ '^[a-z][a-z0-9_]{0,63}$'),
  add column header_candidates jsonb not null default '[]'::jsonb check (jsonb_typeof(header_candidates) = 'array'),
  add column has_formula boolean not null default false,
  add column has_merged_cells boolean not null default false,
  add column has_repeated_header boolean not null default false;

comment on column public.integration_report_packages.schema_fingerprint is
  'Versioned SHA-256 over declared report context and bounded workbook structure. It never includes workbook values, filenames, or PII.';
comment on column public.integration_report_sheet_manifests.header_candidates is
  'Bounded, normalized header labels and row positions only. Never raw workbook rows or cells.';

create table public.report_contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  channel_id uuid not null,
  report_type text not null check (char_length(report_type) between 2 and 120),
  outlet_grain text not null check (outlet_grain = 'branch'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, channel_id, report_type, outlet_grain),
  foreign key (organization_id, channel_id)
    references public.organization_channels(organization_id, id) on delete restrict
);

create table public.report_contract_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  report_contract_id uuid not null,
  report_package_id uuid not null,
  version integer not null check (version > 0),
  schema_fingerprint text not null check (schema_fingerprint ~ '^[a-f0-9]{64}$'),
  parser_version integer not null check (parser_version = 1),
  fingerprint_version integer not null check (fingerprint_version = 1),
  mapping_document jsonb not null check (jsonb_typeof(mapping_document) = 'object'),
  mapping_digest text not null check (mapping_digest ~ '^[a-f0-9]{64}$'),
  declared_currency text not null check (declared_currency ~ '^[A-Z]{3}$'),
  financial_sign_semantics jsonb not null check (jsonb_typeof(financial_sign_semantics) = 'array'),
  controls jsonb not null check (jsonb_typeof(controls) = 'array'),
  unmapped_field_disposition text not null check (unmapped_field_disposition in ('reviewed_ignore', 'requires_mapping')),
  proposal_source text not null check (proposal_source = 'human'),
  created_by uuid not null references auth.users(id),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, report_contract_id, version),
  foreign key (organization_id, report_contract_id)
    references public.report_contracts(organization_id, id) on delete restrict,
  foreign key (organization_id, report_package_id)
    references public.integration_report_packages(organization_id, id) on delete restrict
);

create table public.report_contract_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  report_contract_version_id uuid not null,
  decision text not null check (decision in ('approved', 'rejected')),
  mapping_digest text not null check (mapping_digest ~ '^[a-f0-9]{64}$'),
  reason text check (reason is null or char_length(reason) between 1 and 500),
  decided_by uuid not null references auth.users(id),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, report_contract_version_id),
  foreign key (organization_id, report_contract_version_id)
    references public.report_contract_versions(organization_id, id) on delete restrict
);

create table public.report_contract_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  report_contract_id uuid not null,
  report_contract_version_id uuid not null,
  channel_id uuid not null,
  report_type text not null check (char_length(report_type) between 2 and 120),
  schema_fingerprint text not null check (schema_fingerprint ~ '^[a-f0-9]{64}$'),
  declared_currency text not null check (declared_currency ~ '^[A-Z]{3}$'),
  outlet_grain text not null check (outlet_grain = 'branch'),
  active boolean not null default true,
  bound_by uuid not null references auth.users(id),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, report_contract_version_id),
  foreign key (organization_id, report_contract_id)
    references public.report_contracts(organization_id, id) on delete restrict,
  foreign key (organization_id, report_contract_version_id)
    references public.report_contract_versions(organization_id, id) on delete restrict,
  foreign key (organization_id, channel_id)
    references public.organization_channels(organization_id, id) on delete restrict
);

create unique index report_contract_bindings_active_exact_tuple_idx
  on public.report_contract_bindings (
    organization_id, channel_id, report_type, schema_fingerprint, declared_currency, outlet_grain
  ) where active;
create index report_contracts_organization_channel_report_idx
  on public.report_contracts (organization_id, channel_id, report_type);
create index report_contract_versions_organization_package_idx
  on public.report_contract_versions (organization_id, report_package_id, created_at desc);
create index report_contract_decisions_organization_version_idx
  on public.report_contract_decisions (organization_id, report_contract_version_id);
create index integration_report_sheet_manifests_fingerprint_lookup_idx
  on public.integration_report_sheet_manifests (organization_id, report_package_id, normalized_sheet_name);

create table private.report_contract_write_operations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_kind text not null check (operation_kind in ('propose', 'decide')),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  report_contract_version_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, operation_kind, idempotency_key),
  foreign key (organization_id, report_contract_version_id)
    references public.report_contract_versions(organization_id, id) on delete restrict
);

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
    or (old.status = 'awaiting_validation' and new.status = 'awaiting_validation')
    or (old.status = 'failed' and new.status in ('failed', 'uploaded'))
  ) then
    raise exception 'report_package_status_transition_is_invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.prevent_report_contract_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'report_contract_records_are_append_only' using errcode = '55000';
end;
$$;

create or replace function private.assert_report_contract_document(p_document jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  sheet jsonb;
  field jsonb;
  control jsonb;
begin
  if jsonb_typeof(p_document) <> 'object'
    or (select bool_or(key not in ('schemaVersion', 'currency', 'outletGrain', 'sheets', 'controls', 'unmappedFieldDisposition')) from jsonb_object_keys(p_document) key)
    or p_document ->> 'schemaVersion' <> '1'
    or coalesce(p_document ->> 'currency', '') !~ '^[A-Z]{3}$'
    or p_document ->> 'outletGrain' <> 'branch'
    or p_document ->> 'unmappedFieldDisposition' not in ('reviewed_ignore', 'requires_mapping')
    or jsonb_typeof(p_document -> 'sheets') <> 'array'
    or jsonb_array_length(p_document -> 'sheets') not between 1 and 25
    or jsonb_typeof(p_document -> 'controls') <> 'array'
    or jsonb_array_length(p_document -> 'controls') > 50 then
    raise exception 'report contract document is invalid' using errcode = '22023';
  end if;
  for sheet in select value from jsonb_array_elements(p_document -> 'sheets') loop
    if jsonb_typeof(sheet) <> 'object'
      or (select bool_or(key not in ('normalizedSheetName', 'headerRow', 'dataStartRow', 'allowFormula', 'allowMergedCells', 'fields')) from jsonb_object_keys(sheet) key)
      or coalesce(sheet ->> 'normalizedSheetName', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce((sheet ->> 'headerRow')::integer, 0) not between 1 and 250000
      or coalesce((sheet ->> 'dataStartRow')::integer, 0) not between 2 and 250000
      or (sheet ->> 'dataStartRow')::integer <= (sheet ->> 'headerRow')::integer
      or jsonb_typeof(sheet -> 'allowFormula') <> 'boolean'
      or jsonb_typeof(sheet -> 'allowMergedCells') <> 'boolean'
      or jsonb_typeof(sheet -> 'fields') <> 'array'
      or jsonb_array_length(sheet -> 'fields') not between 1 and 250 then
      raise exception 'report contract sheet rule is invalid' using errcode = '22023';
    end if;
    for field in select value from jsonb_array_elements(sheet -> 'fields') loop
      if jsonb_typeof(field) <> 'object'
        or (select bool_or(key not in ('canonicalField', 'sourceHeader', 'parser', 'required', 'financialSign')) from jsonb_object_keys(field) key)
        or coalesce(field ->> 'canonicalField', '') !~ '^[a-z][a-z0-9_]{0,63}$'
        or coalesce(field ->> 'sourceHeader', '') !~ '^[a-z][a-z0-9_]{0,63}$'
        or field ->> 'parser' not in ('integer', 'decimal', 'money', 'local_date', 'timestamp', 'duration', 'percentage', 'text', 'enum')
        or jsonb_typeof(field -> 'required') <> 'boolean'
        or (field ->> 'parser' = 'money' and field ->> 'financialSign' not in ('positive', 'negative'))
        or (field ->> 'parser' <> 'money' and field ? 'financialSign') then
        raise exception 'report contract field rule is invalid' using errcode = '22023';
      end if;
    end loop;
  end loop;
  if (select count(*) from jsonb_array_elements(p_document -> 'sheets'))
    <> (select count(distinct value ->> 'normalizedSheetName') from jsonb_array_elements(p_document -> 'sheets')) then
    raise exception 'report contract sheet rules are duplicated' using errcode = '22023';
  end if;
  for control in select value from jsonb_array_elements(p_document -> 'controls') loop
    if jsonb_typeof(control) <> 'object'
      or (select bool_or(key not in ('key', 'kind', 'normalizedSheetName', 'tolerance')) from jsonb_object_keys(control) key)
      or coalesce(control ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or control ->> 'kind' not in ('row_count', 'populated_cell_count')
      or coalesce(control ->> 'normalizedSheetName', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce((control ->> 'tolerance')::integer, -1) not between 0 and 1000000 then
      raise exception 'report contract control rule is invalid' using errcode = '22023';
    end if;
  end loop;
end;
$$;

create or replace function private.report_contract_financial_signs(p_document jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'sheet', sheet.value ->> 'normalizedSheetName',
    'field', field.value ->> 'canonicalField',
    'sign', field.value ->> 'financialSign'
  ) order by sheet.ordinality, field.ordinality), '[]'::jsonb)
  from jsonb_array_elements(p_document -> 'sheets') with ordinality as sheet(value, ordinality)
  cross join lateral jsonb_array_elements(sheet.value -> 'fields') with ordinality as field(value, ordinality)
  where field.value ->> 'parser' = 'money'
$$;

create or replace function private.assert_report_contract_matches_package(
  p_package public.integration_report_packages,
  p_document jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  sheet jsonb;
  field jsonb;
  manifest public.integration_report_sheet_manifests;
  candidate jsonb;
begin
  if p_document ->> 'currency' <> p_package.declared_currency
    or p_document ->> 'outletGrain' <> 'branch'
    or jsonb_array_length(p_document -> 'sheets') <> (
      select count(*) from public.integration_report_sheet_manifests
      where organization_id = p_package.organization_id and report_package_id = p_package.id
    ) then
    raise exception 'report contract does not match its package context' using errcode = '23514';
  end if;
  for sheet in select value from jsonb_array_elements(p_document -> 'sheets') loop
    select * into manifest from public.integration_report_sheet_manifests
    where organization_id = p_package.organization_id
      and report_package_id = p_package.id
      and normalized_sheet_name = sheet ->> 'normalizedSheetName';
    if not found
      or (manifest.has_formula and not (sheet ->> 'allowFormula')::boolean)
      or (manifest.has_merged_cells and not (sheet ->> 'allowMergedCells')::boolean) then
      raise exception 'report contract sheet does not match package structure' using errcode = '23514';
    end if;
    select value into candidate from jsonb_array_elements(manifest.header_candidates)
    where (value ->> 'rowPosition')::integer = (sheet ->> 'headerRow')::integer;
    if candidate is null then
      raise exception 'report contract header row was not profiled' using errcode = '23514';
    end if;
    for field in select value from jsonb_array_elements(sheet -> 'fields') loop
      if not ((candidate -> 'normalizedHeaders') ? (field ->> 'sourceHeader')) then
        raise exception 'report contract source header was not profiled' using errcode = '23514';
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function private.audit_report_contract_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload
  ) values (
    new.organization_id, 'report_contract.proposed', 'user', new.created_by,
    'report_contract_version', new.id, new.correlation_id,
    jsonb_build_object(
      'contractId', new.report_contract_id,
      'reportPackageId', new.report_package_id,
      'version', new.version,
      'schemaFingerprint', new.schema_fingerprint,
      'mappingDigest', new.mapping_digest,
      'proposalSource', new.proposal_source
    )
  );
  return new;
end;
$$;

create or replace function private.audit_report_contract_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  contract_version public.report_contract_versions;
begin
  select * into contract_version from public.report_contract_versions
  where organization_id = new.organization_id and id = new.report_contract_version_id;
  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload
  ) values (
    new.organization_id,
    case new.decision when 'approved' then 'report_contract.approved' else 'report_contract.rejected' end,
    'user', new.decided_by, 'report_contract_version', new.report_contract_version_id, new.correlation_id,
    jsonb_build_object(
      'contractId', contract_version.report_contract_id,
      'reportPackageId', contract_version.report_package_id,
      'mappingDigest', new.mapping_digest
    )
  );
  return new;
end;
$$;

create trigger report_contract_versions_prevent_update
before update or delete on public.report_contract_versions
for each row execute function private.prevent_report_contract_mutation();
create trigger report_contract_decisions_prevent_update
before update or delete on public.report_contract_decisions
for each row execute function private.prevent_report_contract_mutation();
create trigger report_contract_bindings_prevent_update
before update or delete on public.report_contract_bindings
for each row execute function private.prevent_report_contract_mutation();
create trigger report_contract_versions_audit
after insert on public.report_contract_versions
for each row execute function private.audit_report_contract_version();
create trigger report_contract_decisions_audit
after insert on public.report_contract_decisions
for each row execute function private.audit_report_contract_decision();

create function public.complete_governed_report_package_profiling(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_claim_token uuid,
  p_content_sha256 text,
  p_schema_fingerprint text,
  p_sheets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_package public.integration_report_packages;
  operation private.integration_report_profile_operations;
  sheet jsonb;
begin
  if p_content_sha256 !~ '^[a-f0-9]{64}$'
    or p_schema_fingerprint !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_sheets) <> 'array'
    or jsonb_array_length(p_sheets) not between 1 and 25 then
    raise exception 'report profile evidence is invalid' using errcode = '22023';
  end if;
  select * into operation from private.integration_report_profile_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id
  for update;
  if not found or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then return null; end if;
  select * into locked_package from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id and status = 'profiling'
  for update;
  if not found then return null; end if;
  for sheet in select value from jsonb_array_elements(p_sheets) loop
    if coalesce((sheet ->> 'sheetPosition')::integer, 0) not between 1 and 25
      or char_length(coalesce(sheet ->> 'sheetName', '')) not between 1 and 100
      or coalesce(sheet ->> 'normalizedSheetName', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce((sheet ->> 'rowCount')::integer, -1) not between 0 and 250000
      or coalesce((sheet ->> 'populatedCellCount')::integer, -1) not between 0 and 2500000
      or coalesce((sheet ->> 'expandedBytes')::bigint, -1) not between 0 and 262144000
      or jsonb_typeof(sheet -> 'headerCandidates') <> 'array'
      or jsonb_array_length(sheet -> 'headerCandidates') > 10
      or jsonb_typeof(sheet -> 'hasFormula') <> 'boolean'
      or jsonb_typeof(sheet -> 'hasMergedCells') <> 'boolean'
      or jsonb_typeof(sheet -> 'hasRepeatedHeader') <> 'boolean' then
      raise exception 'report sheet manifest is invalid' using errcode = '22023';
    end if;
  end loop;
  insert into public.integration_report_sheet_manifests (
    organization_id, report_package_id, sheet_position, sheet_name, normalized_sheet_name,
    row_count, populated_cell_count, expanded_bytes, content_digest, header_candidates,
    has_formula, has_merged_cells, has_repeated_header
  )
  select p_organization_id, p_report_package_id,
    (value ->> 'sheetPosition')::integer, value ->> 'sheetName', value ->> 'normalizedSheetName',
    (value ->> 'rowCount')::integer, (value ->> 'populatedCellCount')::integer,
    (value ->> 'expandedBytes')::bigint, nullif(value ->> 'contentDigest', ''), value -> 'headerCandidates',
    (value ->> 'hasFormula')::boolean, (value ->> 'hasMergedCells')::boolean, (value ->> 'hasRepeatedHeader')::boolean
  from jsonb_array_elements(p_sheets)
  on conflict (organization_id, report_package_id, sheet_position) do nothing;
  if (select count(*) from public.integration_report_sheet_manifests where organization_id = p_organization_id and report_package_id = p_report_package_id) <> jsonb_array_length(p_sheets) then
    raise exception 'report sheet manifests already differ' using errcode = '23505';
  end if;
  update public.integration_report_packages set
    status = 'awaiting_contract', content_sha256 = p_content_sha256, schema_fingerprint = p_schema_fingerprint,
    profiled_at = now(), safe_failure_code = null, safe_failure_at = null
  where organization_id = p_organization_id and id = p_report_package_id
  returning * into locked_package;
  return to_jsonb(locked_package);
end;
$$;

create function public.propose_governed_report_contract(
  p_organization_id uuid,
  p_actor_id uuid,
  p_report_package_id uuid,
  p_mapping_document jsonb,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_package public.integration_report_packages;
  contract_row public.report_contracts;
  version_row public.report_contract_versions;
  operation private.report_contract_write_operations;
  mapping_digest text;
  operation_fingerprint text;
  next_version integer;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.contract_approve') then
    raise exception 'report contract proposal is not authorized' using errcode = '42501';
  end if;
  if char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  perform private.assert_report_contract_document(p_mapping_document);
  mapping_digest := encode(extensions.digest(p_mapping_document::text, 'sha256'), 'hex');
  operation_fingerprint := encode(extensions.digest(concat_ws('|', p_report_package_id, mapping_digest), 'sha256'), 'hex');
  select * into locked_package from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id
  for update;
  if not found or locked_package.status <> 'awaiting_contract' or locked_package.schema_fingerprint is null then
    raise exception 'report package is not eligible for a contract proposal' using errcode = '23514';
  end if;
  select * into operation from private.report_contract_write_operations
  where organization_id = p_organization_id and operation_kind = 'propose' and idempotency_key = p_idempotency_key
  for update;
  if found then
    if operation.fingerprint <> operation_fingerprint then
      raise exception 'idempotency key conflicts with another contract proposal' using errcode = '23505';
    end if;
    select * into version_row from public.report_contract_versions
    where organization_id = p_organization_id and id = operation.report_contract_version_id;
    return to_jsonb(version_row);
  end if;
  perform private.assert_report_contract_matches_package(locked_package, p_mapping_document);
  insert into public.report_contracts (
    organization_id, channel_id, report_type, outlet_grain, created_by
  ) values (
    p_organization_id, locked_package.channel_id, locked_package.report_type, 'branch', p_actor_id
  ) on conflict (organization_id, channel_id, report_type, outlet_grain) do nothing;
  select * into contract_row from public.report_contracts
  where organization_id = p_organization_id and channel_id = locked_package.channel_id
    and report_type = locked_package.report_type and outlet_grain = 'branch'
  for update;
  select coalesce(max(version), 0) + 1 into next_version from public.report_contract_versions
  where organization_id = p_organization_id and report_contract_id = contract_row.id;
  insert into public.report_contract_versions (
    organization_id, report_contract_id, report_package_id, version, schema_fingerprint, parser_version,
    fingerprint_version, mapping_document, mapping_digest, declared_currency, financial_sign_semantics,
    controls, unmapped_field_disposition, proposal_source, created_by, correlation_id
  ) values (
    p_organization_id, contract_row.id, locked_package.id, next_version, locked_package.schema_fingerprint,
    locked_package.parser_version, locked_package.fingerprint_version, p_mapping_document, mapping_digest,
    locked_package.declared_currency, private.report_contract_financial_signs(p_mapping_document),
    p_mapping_document -> 'controls', p_mapping_document ->> 'unmappedFieldDisposition', 'human', p_actor_id,
    p_correlation_id
  ) returning * into version_row;
  insert into private.report_contract_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, report_contract_version_id
  ) values (p_organization_id, 'propose', p_idempotency_key, operation_fingerprint, version_row.id);
  update public.integration_report_packages set status = 'awaiting_approval', correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = locked_package.id;
  return to_jsonb(version_row);
end;
$$;

create function public.decide_governed_report_contract(
  p_organization_id uuid,
  p_actor_id uuid,
  p_report_contract_version_id uuid,
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
  version_row public.report_contract_versions;
  package_row public.integration_report_packages;
  decision_row public.report_contract_decisions;
  operation private.report_contract_write_operations;
  operation_fingerprint text;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.contract_approve') then
    raise exception 'report contract decision is not authorized' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected')
    or char_length(p_idempotency_key) not between 16 and 200
    or (p_reason is not null and char_length(p_reason) not between 1 and 500) then
    raise exception 'report contract decision is invalid' using errcode = '22023';
  end if;
  operation_fingerprint := encode(extensions.digest(concat_ws('|', p_report_contract_version_id, p_decision, p_reason), 'sha256'), 'hex');
  select * into version_row from public.report_contract_versions
  where organization_id = p_organization_id and id = p_report_contract_version_id
  for update;
  if not found then raise exception 'report contract version was not found' using errcode = 'P0002'; end if;
  select * into operation from private.report_contract_write_operations
  where organization_id = p_organization_id and operation_kind = 'decide' and idempotency_key = p_idempotency_key
  for update;
  if found then
    if operation.fingerprint <> operation_fingerprint then
      raise exception 'idempotency key conflicts with another contract decision' using errcode = '23505';
    end if;
    select * into decision_row from public.report_contract_decisions
    where organization_id = p_organization_id and report_contract_version_id = operation.report_contract_version_id;
    return to_jsonb(decision_row);
  end if;
  if exists (
    select 1 from public.report_contract_decisions
    where organization_id = p_organization_id and report_contract_version_id = version_row.id
  ) then
    raise exception 'report contract version already has a decision' using errcode = '23505';
  end if;
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = version_row.report_package_id
  for update;
  if not found or package_row.status <> 'awaiting_approval'
    or package_row.schema_fingerprint is distinct from version_row.schema_fingerprint
    or package_row.declared_currency is distinct from version_row.declared_currency then
    raise exception 'report contract version is no longer eligible for decision' using errcode = '23514';
  end if;
  insert into public.report_contract_decisions (
    organization_id, report_contract_version_id, decision, mapping_digest, reason, decided_by, correlation_id
  ) values (
    p_organization_id, version_row.id, p_decision, version_row.mapping_digest, p_reason, p_actor_id, p_correlation_id
  ) returning * into decision_row;
  if p_decision = 'approved' then
    insert into public.report_contract_bindings (
      organization_id, report_contract_id, report_contract_version_id, channel_id, report_type, schema_fingerprint,
      declared_currency, outlet_grain, bound_by, correlation_id
    ) select
      p_organization_id, version_row.report_contract_id, version_row.id, package_row.channel_id, package_row.report_type,
      version_row.schema_fingerprint, version_row.declared_currency, 'branch', p_actor_id, p_correlation_id;
    update public.integration_report_packages set status = 'awaiting_validation', correlation_id = p_correlation_id
    where organization_id = p_organization_id and id = package_row.id;
  else
    update public.integration_report_packages set status = 'awaiting_contract', correlation_id = p_correlation_id
    where organization_id = p_organization_id and id = package_row.id;
  end if;
  insert into private.report_contract_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, report_contract_version_id
  ) values (p_organization_id, 'decide', p_idempotency_key, operation_fingerprint, version_row.id);
  return to_jsonb(decision_row);
end;
$$;

revoke all on function private.prevent_report_contract_mutation() from public;
revoke all on function private.assert_report_contract_document(jsonb) from public;
revoke all on function private.report_contract_financial_signs(jsonb) from public;
revoke all on function private.assert_report_contract_matches_package(public.integration_report_packages, jsonb) from public;
revoke all on function private.audit_report_contract_version() from public;
revoke all on function private.audit_report_contract_decision() from public;

revoke all on table public.report_contracts from public, anon, authenticated;
revoke all on table public.report_contract_versions from public, anon, authenticated;
revoke all on table public.report_contract_decisions from public, anon, authenticated;
revoke all on table public.report_contract_bindings from public, anon, authenticated;
revoke all on table private.report_contract_write_operations from public, anon, authenticated;
grant select on table public.report_contracts, public.report_contract_versions,
  public.report_contract_decisions, public.report_contract_bindings to authenticated;

alter table public.report_contracts enable row level security;
alter table public.report_contracts force row level security;
alter table public.report_contract_versions enable row level security;
alter table public.report_contract_versions force row level security;
alter table public.report_contract_decisions enable row level security;
alter table public.report_contract_decisions force row level security;
alter table public.report_contract_bindings enable row level security;
alter table public.report_contract_bindings force row level security;
alter table private.report_contract_write_operations enable row level security;
alter table private.report_contract_write_operations force row level security;

create policy "members with report read can view report contracts"
on public.report_contracts for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view report contract versions"
on public.report_contract_versions for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view report contract decisions"
on public.report_contract_decisions for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view report contract bindings"
on public.report_contract_bindings for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));

revoke all on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.propose_governed_report_contract(uuid, uuid, uuid, jsonb, text, uuid) from public, anon;
revoke all on function public.decide_governed_report_contract(uuid, uuid, uuid, text, text, text, uuid) from public, anon;
grant execute on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.propose_governed_report_contract(uuid, uuid, uuid, jsonb, text, uuid) to authenticated;
grant execute on function public.decide_governed_report_contract(uuid, uuid, uuid, text, text, text, uuid) to authenticated;
