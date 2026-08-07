create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_key text not null check (
    char_length(provider_key) between 2 and 120
    and provider_key ~ '^[a-z][a-z0-9_.-]+$'
  ),
  adapter_version text not null check (char_length(adapter_version) between 1 and 80),
  connection_mode text not null check (connection_mode in ('fixture', 'oauth')),
  status text not null default 'pending' check (
    status in ('pending', 'active', 'degraded', 'disconnected', 'revoked')
  ),
  external_account_id text not null check (char_length(external_account_id) between 1 and 512),
  external_account_label text not null check (char_length(external_account_label) between 1 and 300),
  credential_reference uuid,
  granted_scopes text[] not null default '{}'::text[] check (
    array_position(granted_scopes, null) is null
  ),
  token_expires_at timestamptz,
  last_tested_at timestamptz,
  last_successful_sync_at timestamptz,
  next_scheduled_sync_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, provider_key, external_account_id),
  check (connection_mode <> 'fixture' or credential_reference is null)
);

create table public.integration_capability_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null,
  capability_key text not null check (
    char_length(capability_key) between 2 and 120
    and capability_key ~ '^[a-z][a-z0-9_.-]+$'
  ),
  maturity text not null check (
    maturity in (
      'manual',
      'imported',
      'read-only',
      'draft-write',
      'governed-write',
      'bounded-autonomous'
    )
  ),
  availability text not null check (availability in ('available', 'blocked', 'disabled')),
  reason_codes text[] not null default '{}'::text[] check (
    array_position(reason_codes, null) is null
  ),
  derived_from_adapter_version text not null check (
    char_length(derived_from_adapter_version) between 1 and 80
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, connection_id, capability_key),
  foreign key (organization_id, connection_id) references public.integration_connections(organization_id, id) on delete cascade
);

create table public.integration_account_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null,
  external_resource_id text not null check (char_length(external_resource_id) between 1 and 512),
  external_resource_label text not null check (
    char_length(external_resource_label) between 1 and 300
  ),
  branch_id uuid,
  status text not null default 'unmapped' check (status in ('unmapped', 'mapped', 'ignored')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, connection_id, external_resource_id),
  foreign key (organization_id, connection_id) references public.integration_connections(organization_id, id) on delete cascade,
  foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  check ((status = 'mapped' and branch_id is not null) or status <> 'mapped')
);

create table public.integration_data_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_type text not null check (source_type in ('manual', 'csv_import')),
  name text not null check (char_length(name) between 2 and 160),
  branch_id uuid,
  status text not null default 'pending' check (
    status in ('pending', 'ready', 'processing', 'failed', 'archived')
  ),
  storage_path text check (storage_path is null or char_length(storage_path) between 1 and 1024),
  original_filename text check (
    original_filename is null or char_length(original_filename) between 1 and 255
  ),
  media_type text check (media_type is null or char_length(media_type) between 1 and 120),
  size_bytes integer check (size_bytes is null or (size_bytes >= 0 and size_bytes <= 10485760)),
  schema_version integer not null default 1 check (schema_version > 0),
  column_mapping jsonb not null default '{}'::jsonb check (
    jsonb_typeof(column_mapping) = 'object'
  ),
  last_successful_import_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  check (
    source_type = 'csv_import'
    or (storage_path is null and original_filename is null and media_type is null and size_bytes is null)
  )
);

create table public.integration_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid,
  data_source_id uuid,
  trigger_run_id text check (trigger_run_id is null or char_length(trigger_run_id) between 1 and 255),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  status text not null default 'queued' check (
    status in ('queued', 'running', 'succeeded', 'partially_succeeded', 'failed', 'cancelled')
  ),
  started_at timestamptz,
  completed_at timestamptz,
  records_received integer not null default 0 check (records_received >= 0),
  records_accepted integer not null default 0 check (records_accepted >= 0),
  records_rejected integer not null default 0 check (records_rejected >= 0),
  normalized_error_code text check (
    normalized_error_code is null
    or (
      char_length(normalized_error_code) between 2 and 120
      and normalized_error_code ~ '^[A-Z][A-Z0-9_]+$'
    )
  ),
  safe_error_summary text check (
    safe_error_summary is null or char_length(safe_error_summary) <= 1000
  ),
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, connection_id) references public.integration_connections(organization_id, id) on delete restrict,
  foreign key (organization_id, data_source_id) references public.integration_data_sources(organization_id, id) on delete restrict,
  check ((connection_id is not null) <> (data_source_id is not null)),
  check (records_accepted + records_rejected <= records_received),
  check (completed_at is null or started_at is null or completed_at >= started_at)
);

create table public.integration_health_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null,
  ingestion_run_id uuid,
  check_type text not null check (
    check_type in ('connectivity', 'authentication', 'freshness', 'sync')
  ),
  outcome text not null check (outcome in ('passed', 'warning', 'failed')),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  normalized_error_code text check (
    normalized_error_code is null
    or (
      char_length(normalized_error_code) between 2 and 120
      and normalized_error_code ~ '^[A-Z][A-Z0-9_]+$'
    )
  ),
  safe_detail text check (safe_detail is null or char_length(safe_detail) <= 1000),
  checked_at timestamptz not null default now(),
  correlation_id uuid not null,
  unique (organization_id, id),
  foreign key (organization_id, connection_id) references public.integration_connections(organization_id, id) on delete restrict,
  foreign key (organization_id, ingestion_run_id) references public.integration_ingestion_runs(organization_id, id) on delete restrict
);

create index integration_connections_organization_status_updated_idx
  on public.integration_connections(organization_id, status, updated_at desc);
create index integration_connections_created_by_idx
  on public.integration_connections(created_by);
create index integration_connections_active_idx
  on public.integration_connections(organization_id, updated_at desc)
  where status = 'active';

create index integration_capability_grants_organization_connection_idx
  on public.integration_capability_grants(organization_id, connection_id);

create index integration_account_mappings_organization_connection_idx
  on public.integration_account_mappings(organization_id, connection_id);
create index integration_account_mappings_organization_branch_idx
  on public.integration_account_mappings(organization_id, branch_id);
create index integration_account_mappings_created_by_idx
  on public.integration_account_mappings(created_by);

create index integration_data_sources_organization_branch_idx
  on public.integration_data_sources(organization_id, branch_id);
create index integration_data_sources_created_by_idx
  on public.integration_data_sources(created_by);

create index integration_ingestion_runs_organization_connection_idx
  on public.integration_ingestion_runs(organization_id, connection_id);
create index integration_ingestion_runs_organization_data_source_idx
  on public.integration_ingestion_runs(organization_id, data_source_id);
create index integration_ingestion_runs_organization_status_created_idx
  on public.integration_ingestion_runs(organization_id, status, created_at desc);
create index integration_ingestion_runs_organization_created_idx
  on public.integration_ingestion_runs(organization_id, created_at desc);
create index integration_ingestion_runs_pending_idx
  on public.integration_ingestion_runs(organization_id, created_at desc)
  where status in ('queued', 'running');

create index integration_health_checks_organization_connection_checked_idx
  on public.integration_health_checks(organization_id, connection_id, checked_at desc);
create index integration_health_checks_organization_ingestion_run_idx
  on public.integration_health_checks(organization_id, ingestion_run_id);

create trigger integration_connections_set_updated_at
before update on public.integration_connections
for each row execute function public.set_updated_at();
create trigger integration_capability_grants_set_updated_at
before update on public.integration_capability_grants
for each row execute function public.set_updated_at();
create trigger integration_account_mappings_set_updated_at
before update on public.integration_account_mappings
for each row execute function public.set_updated_at();
create trigger integration_data_sources_set_updated_at
before update on public.integration_data_sources
for each row execute function public.set_updated_at();
create trigger integration_ingestion_runs_set_updated_at
before update on public.integration_ingestion_runs
for each row execute function public.set_updated_at();

alter table public.integration_connections enable row level security;
alter table public.integration_connections force row level security;
alter table public.integration_capability_grants enable row level security;
alter table public.integration_capability_grants force row level security;
alter table public.integration_account_mappings enable row level security;
alter table public.integration_account_mappings force row level security;
alter table public.integration_data_sources enable row level security;
alter table public.integration_data_sources force row level security;
alter table public.integration_ingestion_runs enable row level security;
alter table public.integration_ingestion_runs force row level security;
alter table public.integration_health_checks enable row level security;
alter table public.integration_health_checks force row level security;

create policy "members can read integration connections"
on public.integration_connections for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create integration connections"
on public.integration_connections for insert to authenticated
with check (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);
create policy "operators can update integration connections"
on public.integration_connections for update to authenticated
using (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
)
with check (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);

create policy "members can read integration capability grants"
on public.integration_capability_grants for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create integration capability grants"
on public.integration_capability_grants for insert to authenticated
with check (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);
create policy "operators can update integration capability grants"
on public.integration_capability_grants for update to authenticated
using (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
)
with check (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);

create policy "members can read integration account mappings"
on public.integration_account_mappings for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create integration account mappings"
on public.integration_account_mappings for insert to authenticated
with check (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);
create policy "operators can update integration account mappings"
on public.integration_account_mappings for update to authenticated
using (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
)
with check (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);

create policy "members can read integration data sources"
on public.integration_data_sources for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create integration data sources"
on public.integration_data_sources for insert to authenticated
with check (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);
create policy "operators can update integration data sources"
on public.integration_data_sources for update to authenticated
using (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
)
with check (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);

create policy "members can read integration ingestion runs"
on public.integration_ingestion_runs for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create integration ingestion runs"
on public.integration_ingestion_runs for insert to authenticated
with check (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);
create policy "operators can update integration ingestion runs"
on public.integration_ingestion_runs for update to authenticated
using (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
)
with check (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);

create policy "members can read integration health checks"
on public.integration_health_checks for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create integration health checks"
on public.integration_health_checks for insert to authenticated
with check (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);

revoke all privileges on table public.integration_connections from anon, authenticated;
revoke all privileges on table public.integration_capability_grants from anon, authenticated;
revoke all privileges on table public.integration_account_mappings from anon, authenticated;
revoke all privileges on table public.integration_data_sources from anon, authenticated;
revoke all privileges on table public.integration_ingestion_runs from anon, authenticated;
revoke all privileges on table public.integration_health_checks from anon, authenticated;

grant select (
  id,
  organization_id,
  provider_key,
  adapter_version,
  connection_mode,
  status,
  external_account_id,
  external_account_label,
  granted_scopes,
  token_expires_at,
  last_tested_at,
  last_successful_sync_at,
  next_scheduled_sync_at,
  created_by,
  created_at,
  updated_at
) on table public.integration_connections to authenticated;
grant insert (
  id,
  organization_id,
  provider_key,
  adapter_version,
  connection_mode,
  status,
  external_account_id,
  external_account_label,
  granted_scopes,
  token_expires_at,
  last_tested_at,
  last_successful_sync_at,
  next_scheduled_sync_at,
  created_by,
  created_at,
  updated_at
) on table public.integration_connections to authenticated;
grant update (
  adapter_version,
  connection_mode,
  status,
  external_account_label,
  granted_scopes,
  token_expires_at,
  last_tested_at,
  last_successful_sync_at,
  next_scheduled_sync_at
) on table public.integration_connections to authenticated;
grant select, insert, update on table public.integration_capability_grants to authenticated;
grant select, insert, update on table public.integration_account_mappings to authenticated;
grant select, insert, update on table public.integration_data_sources to authenticated;
grant select, insert, update on table public.integration_ingestion_runs to authenticated;
grant select, insert on table public.integration_health_checks to authenticated;

create trigger integration_connections_audit after insert or update on public.integration_connections
for each row execute function private.audit_organization_change();
create trigger integration_capability_grants_audit after insert or update on public.integration_capability_grants
for each row execute function private.audit_organization_change();
create trigger integration_account_mappings_audit after insert or update on public.integration_account_mappings
for each row execute function private.audit_organization_change();
create trigger integration_data_sources_audit after insert or update on public.integration_data_sources
for each row execute function private.audit_organization_change();
create trigger integration_ingestion_runs_audit after insert or update on public.integration_ingestion_runs
for each row execute function private.audit_organization_change();

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'integration-imports',
  'integration-imports',
  false,
  10485760,
  array['text/csv']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "members can read integration imports"
on storage.objects for select to authenticated
using (
  bucket_id = 'integration-imports'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.is_organization_member(((storage.foldername(name))[1])::uuid)
  and exists (
    select 1
    from public.integration_data_sources source
    where source.organization_id = ((storage.foldername(name))[1])::uuid
      and source.id = ((storage.foldername(name))[2])::uuid
      and source.source_type = 'csv_import'
  )
);
create policy "operators can upload integration imports"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'integration-imports'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
  and exists (
    select 1
    from public.integration_data_sources source
    where source.organization_id = ((storage.foldername(name))[1])::uuid
      and source.id = ((storage.foldername(name))[2])::uuid
      and source.source_type = 'csv_import'
  )
);
create policy "operators can update integration imports"
on storage.objects for update to authenticated
using (
  bucket_id = 'integration-imports'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
  and exists (
    select 1
    from public.integration_data_sources source
    where source.organization_id = ((storage.foldername(name))[1])::uuid
      and source.id = ((storage.foldername(name))[2])::uuid
      and source.source_type = 'csv_import'
  )
)
with check (
  bucket_id = 'integration-imports'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
  and exists (
    select 1
    from public.integration_data_sources source
    where source.organization_id = ((storage.foldername(name))[1])::uuid
      and source.id = ((storage.foldername(name))[2])::uuid
      and source.source_type = 'csv_import'
  )
);
create policy "operators can delete integration imports"
on storage.objects for delete to authenticated
using (
  bucket_id = 'integration-imports'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
  and exists (
    select 1
    from public.integration_data_sources source
    where source.organization_id = ((storage.foldername(name))[1])::uuid
      and source.id = ((storage.foldername(name))[2])::uuid
      and source.source_type = 'csv_import'
  )
);

comment on table public.integration_connections is
  'Tenant-scoped provider connection metadata. Credential references are opaque and server-only.';
comment on table public.integration_health_checks is
  'Append-only tenant-scoped connection health history; safe_detail must never contain secrets or raw provider responses.';
