create table public.integration_mapping_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  request_fingerprint text not null,
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  unique (organization_id, connection_id, idempotency_key),
  foreign key (organization_id, connection_id)
    references public.integration_connections(organization_id, id) on delete cascade
);

alter table public.integration_mapping_operations enable row level security;
alter table public.integration_mapping_operations force row level security;
revoke all on table public.integration_mapping_operations from public, anon, authenticated;

create or replace function public.connect_fixture_integration_with_grants(
  p_organization_id uuid,
  p_actor_id uuid,
  p_provider_key text,
  p_adapter_version text,
  p_external_account_id text,
  p_external_account_label text,
  p_granted_scopes text[],
  p_correlation_id uuid,
  p_grants jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  connected public.integration_connections;
  created boolean;
  grants_payload jsonb;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_role(
      p_organization_id,
      array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
    raise exception 'integration operation is not authorized' using errcode = '42501';
  end if;

  insert into public.integration_connections (
    organization_id, provider_key, adapter_version, connection_mode, status,
    external_account_id, external_account_label, granted_scopes, credential_reference,
    token_expires_at, last_tested_at, last_successful_sync_at, next_scheduled_sync_at, created_by
  ) values (
    p_organization_id, p_provider_key, p_adapter_version, 'fixture', 'active',
    p_external_account_id, p_external_account_label, p_granted_scopes, null,
    null, null, null, null, p_actor_id
  ) on conflict (organization_id, provider_key, external_account_id) do update
  set
    adapter_version = excluded.adapter_version,
    connection_mode = 'fixture',
    status = 'active',
    external_account_label = excluded.external_account_label,
    granted_scopes = excluded.granted_scopes,
    credential_reference = null,
    token_expires_at = null
  returning integration_connections.*, (xmax = 0) into connected, created;

  delete from public.integration_capability_grants
  where organization_id = p_organization_id and connection_id = connected.id;

  insert into public.integration_capability_grants (
    organization_id, connection_id, capability_key, maturity, availability,
    reason_codes, derived_from_adapter_version
  )
  select
    p_organization_id,
    connected.id,
    grant_row.capability_key,
    grant_row.maturity,
    grant_row.availability,
    coalesce(grant_row.reason_codes, '{}'::text[]),
    grant_row.derived_from_adapter_version
  from pg_catalog.jsonb_to_recordset(p_grants) as grant_row(
    capability_key text,
    maturity text,
    availability text,
    reason_codes text[],
    derived_from_adapter_version text
  );

  select coalesce(jsonb_agg(to_jsonb(grant_row)), '[]'::jsonb)
  into grants_payload
  from public.integration_capability_grants grant_row
  where grant_row.organization_id = p_organization_id and grant_row.connection_id = connected.id;

  return jsonb_build_object(
    'connection', to_jsonb(connected) - 'credential_reference',
    'grants', grants_payload,
    'created', created
  );
end;
$$;

revoke all on function public.connect_fixture_integration_with_grants(
  uuid, uuid, text, text, text, text, text[], uuid, jsonb
) from public, anon;
grant execute on function public.connect_fixture_integration_with_grants(
  uuid, uuid, text, text, text, text, text[], uuid, jsonb
) to authenticated;

create or replace function public.replace_integration_mappings_with_grants(
  p_organization_id uuid,
  p_connection_id uuid,
  p_actor_id uuid,
  p_correlation_id uuid,
  p_idempotency_key text,
  p_mappings jsonb,
  p_grants jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_connection public.integration_connections;
  operation public.integration_mapping_operations;
  request_fingerprint text := md5(p_mappings::text || p_grants::text);
  mappings_payload jsonb;
  grants_payload jsonb;
  response_payload jsonb;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_role(
      p_organization_id,
      array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
    raise exception 'integration operation is not authorized' using errcode = '42501';
  end if;

  select * into locked_connection
  from public.integration_connections connection
  where connection.organization_id = p_organization_id and connection.id = p_connection_id
  for update;
  if not found then
    raise exception 'integration connection was not found' using errcode = 'P0002';
  end if;

  insert into public.integration_mapping_operations (
    organization_id, connection_id, idempotency_key, request_fingerprint, response
  ) values (
    p_organization_id, p_connection_id, p_idempotency_key, request_fingerprint, '{}'::jsonb
  ) on conflict (organization_id, connection_id, idempotency_key) do nothing;

  select * into operation
  from public.integration_mapping_operations mapping_operation
  where mapping_operation.organization_id = p_organization_id
    and mapping_operation.connection_id = p_connection_id
    and mapping_operation.idempotency_key = p_idempotency_key
  for update;

  if operation.request_fingerprint <> request_fingerprint then
    raise exception 'mapping idempotency key was reused with a different request' using errcode = '23505';
  end if;
  if operation.response <> '{}'::jsonb then
    return operation.response;
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_mappings) as mapping_row(
      external_resource_id text,
      external_resource_label text,
      branch_id uuid,
      status text
    )
    left join public.branches branch
      on branch.organization_id = p_organization_id and branch.id = mapping_row.branch_id
    where (mapping_row.status = 'mapped' and mapping_row.branch_id is null)
      or (mapping_row.branch_id is not null and branch.id is null)
  ) then
    raise exception 'mapping branch is unavailable for this organization' using errcode = '23514';
  end if;

  delete from public.integration_account_mappings
  where organization_id = p_organization_id and connection_id = p_connection_id;
  delete from public.integration_capability_grants
  where organization_id = p_organization_id and connection_id = p_connection_id;

  insert into public.integration_account_mappings (
    organization_id, connection_id, external_resource_id, external_resource_label, branch_id, status, created_by
  )
  select
    p_organization_id,
    p_connection_id,
    mapping_row.external_resource_id,
    mapping_row.external_resource_label,
    mapping_row.branch_id,
    mapping_row.status,
    p_actor_id
  from pg_catalog.jsonb_to_recordset(p_mappings) as mapping_row(
    external_resource_id text,
    external_resource_label text,
    branch_id uuid,
    status text
  );

  insert into public.integration_capability_grants (
    organization_id, connection_id, capability_key, maturity, availability,
    reason_codes, derived_from_adapter_version
  )
  select
    p_organization_id,
    p_connection_id,
    grant_row.capability_key,
    grant_row.maturity,
    grant_row.availability,
    coalesce(grant_row.reason_codes, '{}'::text[]),
    grant_row.derived_from_adapter_version
  from pg_catalog.jsonb_to_recordset(p_grants) as grant_row(
    capability_key text,
    maturity text,
    availability text,
    reason_codes text[],
    derived_from_adapter_version text
  );

  select coalesce(jsonb_agg(to_jsonb(mapping_row)), '[]'::jsonb)
  into mappings_payload
  from public.integration_account_mappings mapping_row
  where mapping_row.organization_id = p_organization_id and mapping_row.connection_id = p_connection_id;
  select coalesce(jsonb_agg(to_jsonb(grant_row)), '[]'::jsonb)
  into grants_payload
  from public.integration_capability_grants grant_row
  where grant_row.organization_id = p_organization_id and grant_row.connection_id = p_connection_id;
  response_payload := jsonb_build_object('mappings', mappings_payload, 'grants', grants_payload);

  update public.integration_mapping_operations
  set response = response_payload
  where id = operation.id;
  return response_payload;
end;
$$;

revoke all on function public.replace_integration_mappings_with_grants(
  uuid, uuid, uuid, uuid, text, jsonb, jsonb
) from public, anon;
grant execute on function public.replace_integration_mappings_with_grants(
  uuid, uuid, uuid, uuid, text, jsonb, jsonb
) to authenticated;

create or replace function public.disconnect_integration_connection(
  p_organization_id uuid,
  p_connection_id uuid,
  p_actor_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_connection public.integration_connections;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_role(
      p_organization_id,
      array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
    raise exception 'integration operation is not authorized' using errcode = '42501';
  end if;

  select * into locked_connection
  from public.integration_connections connection
  where connection.organization_id = p_organization_id and connection.id = p_connection_id
  for update;
  if not found then
    raise exception 'integration connection was not found' using errcode = 'P0002';
  end if;

  if locked_connection.status not in ('disconnected', 'revoked') then
    update public.integration_connections connection
    set status = 'disconnected'
    where connection.organization_id = p_organization_id and connection.id = p_connection_id
    returning * into locked_connection;
  end if;

  return to_jsonb(locked_connection) - 'credential_reference';
end;
$$;

revoke all on function public.disconnect_integration_connection(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.disconnect_integration_connection(uuid, uuid, uuid, uuid) to authenticated;
