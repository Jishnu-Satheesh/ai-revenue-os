create table public.integration_data_source_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  request_fingerprint text not null check (char_length(request_fingerprint) between 1 and 128),
  response jsonb not null default '{}'::jsonb check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

alter table public.integration_data_source_operations enable row level security;
alter table public.integration_data_source_operations force row level security;
revoke all on table public.integration_data_source_operations from public, anon, authenticated;

create or replace function public.create_integration_data_source_with_idempotency(
  p_organization_id uuid,
  p_actor_id uuid,
  p_data_source_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_source_type text,
  p_name text,
  p_branch_id uuid,
  p_column_mapping jsonb,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation public.integration_data_source_operations;
  source public.integration_data_sources;
  response_payload jsonb;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_role(
      p_organization_id,
      array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
    raise exception 'integration operation is not authorized' using errcode = '42501';
  end if;
  if p_source_type not in ('manual', 'csv_import')
    or jsonb_typeof(coalesce(p_column_mapping, '{}'::jsonb)) <> 'object' then
    raise exception 'data source input is invalid' using errcode = '23514';
  end if;
  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);
  insert into public.integration_data_source_operations (
    organization_id, idempotency_key, request_fingerprint
  ) values (p_organization_id, p_idempotency_key, p_request_fingerprint)
  on conflict (organization_id, idempotency_key) do nothing;
  select * into operation
  from public.integration_data_source_operations
  where organization_id = p_organization_id and idempotency_key = p_idempotency_key
  for update;
  if operation.request_fingerprint <> p_request_fingerprint then
    raise exception 'data source idempotency key was reused with a different request' using errcode = '23505';
  end if;
  if operation.response <> '{}'::jsonb then
    return operation.response || pg_catalog.jsonb_build_object('deduplicated', true);
  end if;

  insert into public.integration_data_sources (
    id, organization_id, source_type, name, branch_id, status,
    storage_path, original_filename, media_type, size_bytes, schema_version,
    column_mapping, created_by
  ) values (
    p_data_source_id, p_organization_id, p_source_type, p_name, p_branch_id,
    case when p_source_type = 'manual' then 'ready' else 'pending' end,
    null, null, null, null, 1, p_column_mapping, p_actor_id
  ) returning * into source;
  response_payload := pg_catalog.jsonb_build_object(
    'dataSource', pg_catalog.to_jsonb(source), 'created', true, 'deduplicated', false
  );
  update public.integration_data_source_operations
  set response = response_payload
  where id = operation.id;
  return response_payload;
end;
$$;

create or replace function public.update_integration_data_source_with_idempotency(
  p_organization_id uuid,
  p_actor_id uuid,
  p_data_source_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_name text,
  p_status text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation public.integration_data_source_operations;
  source public.integration_data_sources;
  response_payload jsonb;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_role(
      p_organization_id,
      array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
    raise exception 'integration operation is not authorized' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('archived', 'failed') then
    raise exception 'data source update is invalid' using errcode = '23514';
  end if;
  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);
  insert into public.integration_data_source_operations (
    organization_id, idempotency_key, request_fingerprint
  ) values (p_organization_id, p_idempotency_key, p_request_fingerprint)
  on conflict (organization_id, idempotency_key) do nothing;
  select * into operation
  from public.integration_data_source_operations
  where organization_id = p_organization_id and idempotency_key = p_idempotency_key
  for update;
  if operation.request_fingerprint <> p_request_fingerprint then
    raise exception 'data source idempotency key was reused with a different request' using errcode = '23505';
  end if;
  if operation.response <> '{}'::jsonb then
    return operation.response || pg_catalog.jsonb_build_object('deduplicated', true);
  end if;

  update public.integration_data_sources
  set name = coalesce(p_name, name), status = coalesce(p_status, status)
  where organization_id = p_organization_id and id = p_data_source_id
  returning * into source;
  if source.id is null then
    raise exception 'data source was not found' using errcode = 'P0002';
  end if;
  response_payload := pg_catalog.jsonb_build_object(
    'dataSource', pg_catalog.to_jsonb(source), 'deduplicated', false
  );
  update public.integration_data_source_operations
  set response = response_payload
  where id = operation.id;
  return response_payload;
end;
$$;

revoke all on function public.create_integration_data_source_with_idempotency(
  uuid, uuid, uuid, text, text, text, text, uuid, jsonb, uuid
) from public, anon;
grant execute on function public.create_integration_data_source_with_idempotency(
  uuid, uuid, uuid, text, text, text, text, uuid, jsonb, uuid
) to authenticated;
revoke all on function public.update_integration_data_source_with_idempotency(
  uuid, uuid, uuid, text, text, text, text, uuid
) from public, anon;
grant execute on function public.update_integration_data_source_with_idempotency(
  uuid, uuid, uuid, text, text, text, text, uuid
) to authenticated;
