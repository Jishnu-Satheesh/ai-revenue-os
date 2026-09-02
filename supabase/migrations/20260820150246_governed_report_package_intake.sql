-- Governed manual report-package intake. See specs/018 and ADR 0026.
--
-- This is deliberately only the intake boundary: files remain private Storage
-- objects, while Postgres retains declared context, file identity, bounded
-- profile evidence, lifecycle state, and audit history. No raw workbook rows,
-- customer data, financial semantics, or model output enter this schema.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'governed-report-packages',
  'governed-report-packages',
  false,
  52428800,
  array['text/csv', 'application/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.integration_report_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  channel_id uuid not null,
  branch_id uuid not null,
  report_type text not null check (char_length(report_type) between 2 and 120),
  declared_period_start date not null,
  declared_period_end date not null,
  declared_currency text not null check (declared_currency ~ '^[A-Z]{3}$'),
  period_timezone text not null check (char_length(period_timezone) between 1 and 100),
  file_kind text not null check (file_kind in ('csv', 'xlsx')),
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  declared_content_type text not null check (char_length(declared_content_type) between 1 and 200),
  declared_content_length bigint not null check (declared_content_length > 0 and declared_content_length <= 52428800),
  storage_bucket_id text not null default 'governed-report-packages' check (storage_bucket_id = 'governed-report-packages'),
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/1/original/report\.(csv|xlsx)$'),
  storage_object_id uuid,
  storage_object_version text,
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'awaiting_upload' check (status in ('awaiting_upload', 'uploaded', 'profiling', 'awaiting_contract', 'failed')),
  safe_failure_code text check (safe_failure_code is null or safe_failure_code in (
    'UPLOAD_EXPIRED', 'OBJECT_UNAVAILABLE', 'OBJECT_IDENTITY_CHANGED', 'INVALID_FILE_TYPE', 'FILE_TOO_LARGE',
    'TOO_MANY_SHEETS', 'TOO_MANY_ROWS', 'TOO_MANY_POPULATED_CELLS', 'EXPANDED_CONTENT_TOO_LARGE',
    'UNSAFE_WORKBOOK', 'UNREADABLE_WORKBOOK', 'PROFILE_FAILED'
  )),
  safe_failure_at timestamptz,
  upload_expires_at timestamptz not null,
  uploaded_at timestamptz,
  profiled_at timestamptz,
  retained_until timestamptz not null default (now() + interval '13 months'),
  created_by uuid not null references auth.users(id),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, channel_id)
    references public.organization_channels(organization_id, id) on delete restrict,
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete restrict,
  check (declared_period_end >= declared_period_start),
  check ((storage_object_id is null) = (storage_object_version is null)),
  check ((safe_failure_code is null) = (safe_failure_at is null)),
  check ((status = 'awaiting_upload' and uploaded_at is null) or status <> 'awaiting_upload')
);

comment on table public.integration_report_packages is
  'Immutable governed manual report-package intake metadata. Original files are private Storage objects; raw workbook data never belongs here.';

create table public.integration_report_sheet_manifests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  report_package_id uuid not null,
  sheet_position integer not null check (sheet_position between 1 and 25),
  sheet_name text not null check (char_length(sheet_name) between 1 and 100),
  row_count integer not null check (row_count between 0 and 250000),
  populated_cell_count integer not null check (populated_cell_count between 0 and 2500000),
  expanded_bytes bigint not null check (expanded_bytes between 0 and 262144000),
  content_digest text check (content_digest is null or content_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (organization_id, report_package_id, sheet_position),
  unique (organization_id, report_package_id, sheet_name),
  foreign key (organization_id, report_package_id)
    references public.integration_report_packages(organization_id, id) on delete restrict
);

comment on table public.integration_report_sheet_manifests is
  'Bounded structural evidence only: sheet identity and counters, never workbook cells or rows.';

create table private.integration_report_write_operations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_kind text not null check (operation_kind in ('upload_intent', 'upload_complete', 'retry')),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  fingerprint text not null check (char_length(fingerprint) = 64),
  report_package_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, operation_kind, idempotency_key),
  foreign key (organization_id, report_package_id)
    references public.integration_report_packages(organization_id, id) on delete restrict
);

create table private.integration_report_profile_operations (
  organization_id uuid not null,
  report_package_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  claim_token uuid not null,
  lease_expires_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, report_package_id),
  foreign key (organization_id, report_package_id)
    references public.integration_report_packages(organization_id, id) on delete restrict
);

create index integration_report_packages_organization_status_created_idx
  on public.integration_report_packages (organization_id, status, created_at desc);
create index integration_report_packages_channel_branch_period_idx
  on public.integration_report_packages (organization_id, channel_id, branch_id, declared_period_start desc);
create index integration_report_sheet_manifests_package_idx
  on public.integration_report_sheet_manifests (organization_id, report_package_id);

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
    or new.created_by is distinct from old.created_by
    or new.correlation_id is distinct from old.correlation_id
    or new.retained_until is distinct from old.retained_until then
    raise exception 'report_package_context_is_immutable' using errcode = '23514';
  end if;
  if old.content_sha256 is not null and new.content_sha256 is distinct from old.content_sha256 then
    raise exception 'report_package_digest_is_immutable' using errcode = '23514';
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
    or (old.status = 'failed' and new.status in ('failed', 'uploaded'))
    or (old.status = 'awaiting_contract' and new.status = 'awaiting_contract')
  ) then
    raise exception 'report_package_status_transition_is_invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.complete_governed_report_package_upload(
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
  locked_package public.integration_report_packages;
  object_row storage.objects;
  existing private.integration_report_write_operations;
  fingerprint text;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.upload') then
    raise exception 'report upload is not authorized' using errcode = '42501';
  end if;
  if char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  select * into locked_package from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id
  for update;
  if not found then raise exception 'report package was not found' using errcode = 'P0002'; end if;
  fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.concat_ws('|', p_report_package_id, locked_package.storage_path, locked_package.declared_content_length),
    'sha256'
  ), 'hex');
  select * into existing from private.integration_report_write_operations
  where organization_id = p_organization_id and operation_kind = 'upload_complete' and idempotency_key = p_idempotency_key
  for update;
  if found then
    if existing.fingerprint <> fingerprint or existing.report_package_id <> p_report_package_id then
      raise exception 'idempotency key conflicts with another upload completion' using errcode = '23505';
    end if;
    return pg_catalog.to_jsonb(locked_package);
  end if;
  if locked_package.status <> 'awaiting_upload' then
    raise exception 'report package cannot be completed in its current state' using errcode = '23514';
  end if;
  if locked_package.upload_expires_at <= now() then
    update public.integration_report_packages set
      status = 'failed', safe_failure_code = 'UPLOAD_EXPIRED', safe_failure_at = now(), correlation_id = p_correlation_id
    where id = locked_package.id returning * into locked_package;
    return pg_catalog.to_jsonb(locked_package);
  end if;
  select * into object_row from storage.objects
  where bucket_id = locked_package.storage_bucket_id and name = locked_package.storage_path;
  if not found
    or coalesce((object_row.metadata ->> 'size')::bigint, 0) <> locked_package.declared_content_length
    or coalesce(object_row.metadata ->> 'mimetype', '') <> locked_package.declared_content_type then
    update public.integration_report_packages set
      status = 'failed', safe_failure_code = 'OBJECT_UNAVAILABLE', safe_failure_at = now(), correlation_id = p_correlation_id
    where id = locked_package.id returning * into locked_package;
    return pg_catalog.to_jsonb(locked_package);
  end if;
  update public.integration_report_packages set
    status = 'uploaded', storage_object_id = object_row.id, storage_object_version = object_row.version,
    uploaded_at = now(), correlation_id = p_correlation_id
  where id = locked_package.id returning * into locked_package;
  insert into private.integration_report_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, report_package_id
  ) values (p_organization_id, 'upload_complete', p_idempotency_key, fingerprint, locked_package.id);
  return pg_catalog.to_jsonb(locked_package);
end;
$$;

create or replace function public.retry_governed_report_package_profiling(
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
  locked_package public.integration_report_packages;
  existing private.integration_report_write_operations;
  fingerprint text;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.retry') then
    raise exception 'report retry is not authorized' using errcode = '42501';
  end if;
  select * into locked_package from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id
  for update;
  if not found then raise exception 'report package was not found' using errcode = 'P0002'; end if;
  fingerprint := pg_catalog.encode(extensions.digest(pg_catalog.concat_ws('|', p_report_package_id, locked_package.content_sha256), 'sha256'), 'hex');
  select * into existing from private.integration_report_write_operations
  where organization_id = p_organization_id and operation_kind = 'retry' and idempotency_key = p_idempotency_key
  for update;
  if found then
    if existing.fingerprint <> fingerprint or existing.report_package_id <> p_report_package_id then raise exception 'idempotency key conflicts with another retry' using errcode = '23505'; end if;
    return pg_catalog.to_jsonb(locked_package);
  end if;
  if locked_package.status <> 'failed' or locked_package.storage_object_id is null then
    raise exception 'report package is not eligible for retry' using errcode = '23514';
  end if;
  update public.integration_report_packages set
    status = 'uploaded', safe_failure_code = null, safe_failure_at = null, correlation_id = p_correlation_id
  where id = locked_package.id returning * into locked_package;
  insert into private.integration_report_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, report_package_id
  ) values (p_organization_id, 'retry', p_idempotency_key, fingerprint, locked_package.id);
  return pg_catalog.to_jsonb(locked_package);
end;
$$;

-- Worker-only profiling entry points ----------------------------------------

create or replace function public.claim_governed_report_package_profiling(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_idempotency_key text,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_package public.integration_report_packages;
  operation private.integration_report_profile_operations;
begin
  select * into locked_package from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id
  for update;
  if not found then return pg_catalog.jsonb_build_object('outcome', 'not_found'); end if;
  if locked_package.status = 'awaiting_contract' then return pg_catalog.jsonb_build_object('outcome', 'completed'); end if;
  if locked_package.status not in ('uploaded', 'profiling') then return pg_catalog.jsonb_build_object('outcome', 'not_ready'); end if;
  insert into private.integration_report_profile_operations (
    organization_id, report_package_id, idempotency_key, claim_token, lease_expires_at, attempt_count
  ) values (p_organization_id, p_report_package_id, p_idempotency_key, p_claim_token, now() + interval '20 minutes', 1)
  on conflict (organization_id, report_package_id) do nothing;
  select * into operation from private.integration_report_profile_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id
  for update;
  if operation.idempotency_key <> p_idempotency_key then return pg_catalog.jsonb_build_object('outcome', 'conflict'); end if;
  if operation.claim_token <> p_claim_token and operation.lease_expires_at > now() then
    return pg_catalog.jsonb_build_object('outcome', 'in_progress');
  end if;
  update private.integration_report_profile_operations set
    claim_token = p_claim_token, lease_expires_at = now() + interval '20 minutes',
    attempt_count = case when operation.claim_token = p_claim_token then operation.attempt_count else operation.attempt_count + 1 end,
    updated_at = now()
  where organization_id = p_organization_id and report_package_id = p_report_package_id;
  update public.integration_report_packages set status = 'profiling'
  where organization_id = p_organization_id and id = p_report_package_id and status = 'uploaded'
  returning * into locked_package;
  select * into locked_package from public.integration_report_packages where organization_id = p_organization_id and id = p_report_package_id;
  return pg_catalog.jsonb_build_object('outcome', 'acquired', 'reportPackage', pg_catalog.to_jsonb(locked_package));
end;
$$;

create or replace function public.complete_governed_report_package_profiling(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_claim_token uuid,
  p_content_sha256 text,
  p_sheets jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_package public.integration_report_packages;
  operation private.integration_report_profile_operations;
  sheet jsonb;
begin
  if p_content_sha256 !~ '^[a-f0-9]{64}$' or pg_catalog.jsonb_typeof(p_sheets) <> 'array' or pg_catalog.jsonb_array_length(p_sheets) > 25 then
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
  for sheet in select value from pg_catalog.jsonb_array_elements(p_sheets) loop
    if coalesce((sheet ->> 'sheetPosition')::integer, 0) not between 1 and 25
      or char_length(coalesce(sheet ->> 'sheetName', '')) not between 1 and 100
      or coalesce((sheet ->> 'rowCount')::integer, -1) not between 0 and 250000
      or coalesce((sheet ->> 'populatedCellCount')::integer, -1) not between 0 and 2500000
      or coalesce((sheet ->> 'expandedBytes')::bigint, -1) not between 0 and 262144000 then
      raise exception 'report sheet manifest is invalid' using errcode = '22023';
    end if;
  end loop;
  insert into public.integration_report_sheet_manifests (
    organization_id, report_package_id, sheet_position, sheet_name, row_count, populated_cell_count, expanded_bytes, content_digest
  )
  select p_organization_id, p_report_package_id,
    (value ->> 'sheetPosition')::integer, value ->> 'sheetName', (value ->> 'rowCount')::integer,
    (value ->> 'populatedCellCount')::integer, (value ->> 'expandedBytes')::bigint, nullif(value ->> 'contentDigest', '')
  from pg_catalog.jsonb_array_elements(p_sheets)
  on conflict (organization_id, report_package_id, sheet_position) do nothing;
  if (select count(*) from public.integration_report_sheet_manifests where organization_id = p_organization_id and report_package_id = p_report_package_id) <> pg_catalog.jsonb_array_length(p_sheets) then
    raise exception 'report sheet manifests already differ' using errcode = '23505';
  end if;
  update public.integration_report_packages set
    status = 'awaiting_contract', content_sha256 = p_content_sha256, profiled_at = now(), safe_failure_code = null, safe_failure_at = null
  where organization_id = p_organization_id and id = p_report_package_id
  returning * into locked_package;
  return pg_catalog.to_jsonb(locked_package);
end;
$$;

create or replace function public.fail_governed_report_package_profiling(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_claim_token uuid,
  p_failure_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_package public.integration_report_packages;
  operation private.integration_report_profile_operations;
begin
  if p_failure_code not in ('OBJECT_UNAVAILABLE', 'OBJECT_IDENTITY_CHANGED', 'INVALID_FILE_TYPE', 'FILE_TOO_LARGE', 'TOO_MANY_SHEETS', 'TOO_MANY_ROWS', 'TOO_MANY_POPULATED_CELLS', 'EXPANDED_CONTENT_TOO_LARGE', 'UNSAFE_WORKBOOK', 'UNREADABLE_WORKBOOK', 'PROFILE_FAILED') then
    raise exception 'report failure code is invalid' using errcode = '22023';
  end if;
  select * into operation from private.integration_report_profile_operations where organization_id = p_organization_id and report_package_id = p_report_package_id for update;
  if not found or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then return null; end if;
  update public.integration_report_packages set status = 'failed', safe_failure_code = p_failure_code, safe_failure_at = now()
  where organization_id = p_organization_id and id = p_report_package_id and status = 'profiling'
  returning * into locked_package;
  return pg_catalog.to_jsonb(locked_package);
end;
$$;

create or replace function private.prevent_report_package_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'report_package_hard_delete_forbidden' using errcode = '55000';
end;
$$;

create or replace function private.prevent_report_sheet_manifest_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'report_sheet_manifest_is_append_only' using errcode = '55000';
end;
$$;

revoke all on function private.prevent_report_package_mutation() from public;
revoke all on function private.prevent_report_package_delete() from public;
revoke all on function private.prevent_report_sheet_manifest_mutation() from public;

create trigger integration_report_packages_set_updated_at
before update on public.integration_report_packages
for each row execute function public.set_updated_at();
create trigger integration_report_packages_prevent_mutation
before update on public.integration_report_packages
for each row execute function private.prevent_report_package_mutation();
create trigger integration_report_packages_prevent_delete
before delete on public.integration_report_packages
for each row execute function private.prevent_report_package_delete();
create trigger integration_report_sheet_manifests_prevent_update
before update on public.integration_report_sheet_manifests
for each row execute function private.prevent_report_sheet_manifest_mutation();
create trigger integration_report_sheet_manifests_prevent_delete
before delete on public.integration_report_sheet_manifests
for each row execute function private.prevent_report_sheet_manifest_mutation();

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
      else null
    end;
    if event_name is not null then
      actor_kind := case when actor is null then 'system'::public.audit_actor_type else 'user'::public.audit_actor_type end;
      insert into public.audit_events (
        organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload
      ) values (
        new.organization_id, event_name, actor_kind, actor, 'integration_report_package', new.id,
        new.correlation_id,
        pg_catalog.jsonb_build_object(
          'status', new.status,
          'failureCode', new.safe_failure_code,
          'sheetCount', (select count(*) from public.integration_report_sheet_manifests m where m.organization_id = new.organization_id and m.report_package_id = new.id)
        )
      );
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.audit_report_package_lifecycle() from public;
create trigger integration_report_packages_audit
after update on public.integration_report_packages
for each row execute function private.audit_report_package_lifecycle();

-- Authenticated write entry points ------------------------------------------

create or replace function public.start_governed_report_package_upload(
  p_organization_id uuid,
  p_actor_id uuid,
  p_channel_id uuid,
  p_branch_id uuid,
  p_report_type text,
  p_period_start date,
  p_period_end date,
  p_currency text,
  p_file_kind text,
  p_original_filename text,
  p_content_type text,
  p_content_length bigint,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing private.integration_report_write_operations;
  created public.integration_report_packages;
  fingerprint text;
  timezone_name text;
  has_mappings boolean;
  created_id uuid := pg_catalog.gen_random_uuid();
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.upload') then
    raise exception 'report upload is not authorized' using errcode = '42501';
  end if;
  if p_period_end < p_period_start
    or p_content_length <= 0 or p_content_length > 52428800
    or p_file_kind not in ('csv', 'xlsx')
    or p_currency !~ '^[A-Z]{3}$'
    or char_length(p_report_type) not between 2 and 120
    or char_length(p_original_filename) not between 1 and 255
    or char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'report upload context is invalid' using errcode = '22023';
  end if;
  if (p_file_kind = 'csv' and p_content_type not in ('text/csv', 'application/csv'))
    or (p_file_kind = 'xlsx' and p_content_type <> 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then
    raise exception 'report upload file type is invalid' using errcode = '22023';
  end if;

  select o.default_timezone into timezone_name from public.organizations o where o.id = p_organization_id;
  if timezone_name is null then raise exception 'organization was not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.organization_channels c where c.organization_id = p_organization_id and c.id = p_channel_id and c.status = 'active') then
    raise exception 'channel was not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.branches b where b.organization_id = p_organization_id and b.id = p_branch_id and b.is_active) then
    raise exception 'branch was not found' using errcode = 'P0002';
  end if;
  select exists(
    select 1 from public.organization_channel_branches m
    where m.organization_id = p_organization_id and m.channel_id = p_channel_id and m.status = 'active'
  ) into has_mappings;
  if has_mappings and not exists (
    select 1 from public.organization_channel_branches m
    where m.organization_id = p_organization_id and m.channel_id = p_channel_id and m.branch_id = p_branch_id
      and m.status = 'active'
      and (m.effective_from is null or m.effective_from <= p_period_start)
      and (m.effective_to is null or m.effective_to >= p_period_end)
  ) then
    raise exception 'channel is not applicable to this branch for the declared period' using errcode = '23514';
  end if;

  fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.concat_ws('|', p_channel_id, p_branch_id, p_report_type, p_period_start, p_period_end, p_currency, p_file_kind, p_original_filename, p_content_type, p_content_length),
    'sha256'
  ), 'hex');
  select * into existing from private.integration_report_write_operations
  where organization_id = p_organization_id and operation_kind = 'upload_intent' and idempotency_key = p_idempotency_key
  for update;
  if found then
    if existing.fingerprint <> fingerprint then raise exception 'idempotency key conflicts with another upload' using errcode = '23505'; end if;
    select * into created from public.integration_report_packages where organization_id = p_organization_id and id = existing.report_package_id;
    return pg_catalog.to_jsonb(created);
  end if;

  insert into public.integration_report_packages (
    id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end, declared_currency,
    period_timezone, file_kind, original_filename, declared_content_type, declared_content_length, storage_path,
    upload_expires_at, created_by, correlation_id
  ) values (
    created_id, p_organization_id, p_channel_id, p_branch_id, p_report_type, p_period_start, p_period_end, p_currency,
    timezone_name, p_file_kind, p_original_filename, p_content_type, p_content_length,
    p_organization_id::text || '/' || p_channel_id::text || '/' || created_id::text || '/1/original/report.' || p_file_kind,
    now() + interval '2 hours', p_actor_id, p_correlation_id
  ) returning * into created;
  insert into private.integration_report_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, report_package_id
  ) values (p_organization_id, 'upload_intent', p_idempotency_key, fingerprint, created.id);
  return pg_catalog.to_jsonb(created);
end;
$$;

-- Least-privilege table and Storage access ----------------------------------

revoke all on table public.integration_report_packages from public, anon, authenticated;
revoke all on table public.integration_report_sheet_manifests from public, anon, authenticated;
revoke all on table private.integration_report_write_operations from public, anon, authenticated;
revoke all on table private.integration_report_profile_operations from public, anon, authenticated;
grant select on table public.integration_report_packages to authenticated;
grant select on table public.integration_report_sheet_manifests to authenticated;

alter table public.integration_report_packages enable row level security;
alter table public.integration_report_packages force row level security;
alter table public.integration_report_sheet_manifests enable row level security;
alter table public.integration_report_sheet_manifests force row level security;
alter table private.integration_report_write_operations enable row level security;
alter table private.integration_report_write_operations force row level security;
alter table private.integration_report_profile_operations enable row level security;
alter table private.integration_report_profile_operations force row level security;

create policy "members with report read can view report packages"
on public.integration_report_packages for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));
create policy "members with report read can view report sheet manifests"
on public.integration_report_sheet_manifests for select to authenticated
using (private.has_organization_permission(organization_id, 'report.read'));

revoke all on function public.start_governed_report_package_upload(uuid, uuid, uuid, uuid, text, date, date, text, text, text, text, bigint, text, uuid) from public, anon;
revoke all on function public.complete_governed_report_package_upload(uuid, uuid, uuid, text, uuid) from public, anon;
revoke all on function public.retry_governed_report_package_profiling(uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.start_governed_report_package_upload(uuid, uuid, uuid, uuid, text, date, date, text, text, text, text, bigint, text, uuid) to authenticated;
grant execute on function public.complete_governed_report_package_upload(uuid, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.retry_governed_report_package_profiling(uuid, uuid, uuid, text, uuid) to authenticated;

revoke all on function public.claim_governed_report_package_profiling(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_governed_report_package_profiling(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_governed_report_package_profiling(uuid, uuid, text, uuid) to service_role;
grant execute on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.fail_governed_report_package_profiling(uuid, uuid, uuid, text) to service_role;

drop policy if exists "operators upload governed report package objects" on storage.objects;
create policy "operators upload governed report package objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'governed-report-packages'
  and exists (
    select 1 from public.integration_report_packages p
    where p.organization_id::text = (storage.foldername(name))[1]
      and p.channel_id::text = (storage.foldername(name))[2]
      and p.id::text = (storage.foldername(name))[3]
      and name = p.storage_path
      and p.status = 'awaiting_upload'
      and p.upload_expires_at > now()
      and p.created_by = (select auth.uid())
      and private.has_organization_permission(p.organization_id, 'report.upload')
  )
);
