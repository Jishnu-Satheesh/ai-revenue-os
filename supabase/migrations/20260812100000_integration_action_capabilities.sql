-- Add server-derived, versioned capability evidence without making the fixture
-- RPC a general provider-admission path.

alter table public.integration_capability_grants
  add column restriction_codes text[] default '{}'::text[],
  add column derived_from_contract_version text default 'legacy-read-v1',
  add column grant_version bigint default 1;

update public.integration_capability_grants grant_row
set derived_from_contract_version = case
  when connection.provider_key = 'google_business_profile' then 'fixture-v1'
  else 'legacy-read-v1'
end
from public.integration_connections connection
where connection.organization_id = grant_row.organization_id
  and connection.id = grant_row.connection_id;

alter table public.integration_capability_grants
  alter column restriction_codes set not null,
  alter column derived_from_contract_version set not null,
  alter column grant_version set not null,
  add constraint integration_capability_grants_restriction_codes_valid
    check (pg_catalog.array_position(restriction_codes, null) is null),
  add constraint integration_capability_grants_contract_version_valid
    check (char_length(derived_from_contract_version) between 1 and 120),
  add constraint integration_capability_grants_grant_version_valid
    check (grant_version > 0);

-- The original check deliberately limited available grants to the fixture-era
-- maturities. ADR 0016 replaces that blanket limit with deterministic grants.
do $$
declare
  constraint_name name;
begin
  select constraint_row.conname
  into constraint_name
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.integration_capability_grants'::regclass
    and constraint_row.contype = 'c'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%availability%'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%maturity%'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%manual%'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%imported%'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%read-only%';
  if constraint_name is not null then
    execute pg_catalog.format(
      'alter table public.integration_capability_grants drop constraint %I',
      constraint_name
    );
  end if;
end;
$$;

create index integration_capability_grants_organization_capability_availability_idx
  on public.integration_capability_grants(organization_id, capability_key, availability);

create or replace function private.prevent_integration_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_row jsonb := pg_catalog.to_jsonb(old);
  new_row jsonb := pg_catalog.to_jsonb(new);
  immutable_keys text[];
  immutable_key text;
begin
  immutable_keys := case TG_TABLE_NAME
    when 'integration_connections' then array[
      'id', 'organization_id', 'provider_key', 'external_account_id', 'created_by', 'created_at'
    ]
    when 'integration_capability_grants' then array[
      'id', 'organization_id', 'connection_id', 'capability_key', 'created_at'
    ]
    when 'integration_account_mappings' then array[
      'id', 'organization_id', 'connection_id', 'external_resource_id', 'created_by', 'created_at'
    ]
    when 'integration_data_sources' then array[
      'id', 'organization_id', 'source_type', 'created_by', 'created_at'
    ]
    when 'integration_ingestion_runs' then array[
      'id', 'organization_id', 'connection_id', 'data_source_id', 'idempotency_key',
      'correlation_id', 'created_at'
    ]
    else array[]::text[]
  end;
  foreach immutable_key in array immutable_keys loop
    if new_row -> immutable_key is distinct from old_row -> immutable_key then
      raise exception 'integration_identity_is_immutable' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

create or replace function private.enforce_integration_grant_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    new.grant_version := 1;
  elsif row(
    new.maturity,
    new.availability,
    new.reason_codes,
    new.restriction_codes,
    new.derived_from_adapter_version,
    new.derived_from_contract_version
  ) is distinct from row(
    old.maturity,
    old.availability,
    old.reason_codes,
    old.restriction_codes,
    old.derived_from_adapter_version,
    old.derived_from_contract_version
  ) then
    new.grant_version := old.grant_version + 1;
  else
    new.grant_version := old.grant_version;
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_integration_grant_version() from public;
drop trigger if exists integration_capability_grants_enforce_version
  on public.integration_capability_grants;
create trigger integration_capability_grants_enforce_version
before insert or update on public.integration_capability_grants
for each row execute function private.enforce_integration_grant_version();

create or replace function private.disable_integration_grants_for_inactive_connection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inactive_reason text;
begin
  if new.status in ('disconnected', 'revoked') and new.status is distinct from old.status then
    inactive_reason := case
      when new.status = 'revoked' then 'connection_revoked'
      else 'connection_disconnected'
    end;
    update public.integration_capability_grants
    set
      availability = 'disabled',
      reason_codes = case
        when inactive_reason = any(reason_codes) then reason_codes
        else pg_catalog.array_append(reason_codes, inactive_reason)
      end
    where organization_id = new.organization_id and connection_id = new.id
      and (
        availability <> 'disabled'
        or not inactive_reason = any(reason_codes)
      );
  end if;
  return new;
end;
$$;

create or replace function private.assert_google_fixture_grants(
  p_grants jsonb,
  p_expected_availability text,
  p_expected_reason text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if pg_catalog.jsonb_typeof(p_grants) <> 'array'
    or pg_catalog.jsonb_array_length(p_grants) <> 2
    or (
      select pg_catalog.count(distinct grant_payload ->> 'capability_key')
      from pg_catalog.jsonb_array_elements(p_grants) grant_payload
    ) <> 2
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_grants) grant_payload
      where pg_catalog.jsonb_object_length(grant_payload) <> 7
        or not grant_payload ?& array[
          'capability_key', 'maturity', 'availability', 'reason_codes',
          'restriction_codes', 'derived_from_adapter_version',
          'derived_from_contract_version'
        ]
        or grant_payload ->> 'capability_key' not in (
          'read_google_business_profile', 'read_reviews'
        )
        or grant_payload ->> 'maturity' <> 'read-only'
        or grant_payload ->> 'availability' <> p_expected_availability
        or grant_payload ->> 'derived_from_adapter_version' <> '1'
        or grant_payload ->> 'derived_from_contract_version' <> 'fixture-v1'
        or grant_payload -> 'restriction_codes' <> '[]'::jsonb
        or grant_payload -> 'reason_codes' <> case
          when p_expected_reason is null then '[]'::jsonb
          else pg_catalog.jsonb_build_array(p_expected_reason)
        end
    ) then
    raise exception 'fixture provider or capability grants are not permitted' using errcode = '23514';
  end if;
end;
$$;

revoke all on function private.assert_google_fixture_grants(jsonb, text, text) from public;

create or replace function public.connect_fixture_integration_with_grants(
  p_organization_id uuid,
  p_actor_id uuid,
  p_provider_key text,
  p_adapter_version text,
  p_external_account_id text,
  p_external_account_label text,
  p_granted_scopes text[],
  p_idempotency_key text,
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
  operation public.integration_fixture_connect_operations;
  request_fingerprint text := md5(pg_catalog.jsonb_build_object(
    'provider_key', p_provider_key,
    'adapter_version', p_adapter_version,
    'external_account_id', p_external_account_id,
    'external_account_label', p_external_account_label,
    'granted_scopes', pg_catalog.to_jsonb(p_granted_scopes),
    'grants', p_grants
  )::text);
  response_payload jsonb;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_role(
      p_organization_id, array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
    raise exception 'integration operation is not authorized' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);
  if p_provider_key <> 'google_business_profile' or p_adapter_version <> '1'
    or pg_catalog.coalesce(pg_catalog.array_length(p_granted_scopes, 1), 0) <> 0 then
    raise exception 'fixture provider or capability grants are not permitted' using errcode = '23514';
  end if;
  perform private.assert_google_fixture_grants(p_grants, 'blocked', 'account_unmapped');

  insert into public.integration_fixture_connect_operations (
    organization_id, idempotency_key, request_fingerprint, response
  ) values (p_organization_id, p_idempotency_key, request_fingerprint, '{}'::jsonb)
  on conflict (organization_id, idempotency_key) do nothing;
  select * into operation
  from public.integration_fixture_connect_operations fixture_operation
  where fixture_operation.organization_id = p_organization_id
    and fixture_operation.idempotency_key = p_idempotency_key
  for update;
  if operation.request_fingerprint <> request_fingerprint then
    raise exception 'fixture connect idempotency key was reused with a different request' using errcode = '23505';
  end if;
  if operation.response <> '{}'::jsonb then
    return operation.response || pg_catalog.jsonb_build_object('deduplicated', true);
  end if;

  select not exists (
    select 1 from public.integration_connections existing_connection
    where existing_connection.organization_id = p_organization_id
      and existing_connection.provider_key = p_provider_key
      and existing_connection.external_account_id = p_external_account_id
  ) into created;
  insert into public.integration_connections (
    organization_id, provider_key, adapter_version, connection_mode, status,
    external_account_id, external_account_label, granted_scopes, credential_reference,
    token_expires_at, last_tested_at, last_successful_sync_at, next_scheduled_sync_at, created_by
  ) values (
    p_organization_id, p_provider_key, p_adapter_version, 'fixture', 'active',
    p_external_account_id, p_external_account_label, p_granted_scopes, null,
    null, null, null, null, p_actor_id
  ) on conflict (organization_id, provider_key, external_account_id) do update set
    adapter_version = excluded.adapter_version,
    connection_mode = 'fixture',
    status = 'active',
    external_account_label = excluded.external_account_label,
    granted_scopes = excluded.granted_scopes,
    credential_reference = null,
    token_expires_at = null
  returning integration_connections.* into connected;

  update public.integration_capability_grants
  set availability = 'disabled',
    reason_codes = case when 'capability_removed' = any(reason_codes) then reason_codes
      else pg_catalog.array_append(reason_codes, 'capability_removed') end
  where organization_id = p_organization_id and connection_id = connected.id
    and capability_key not in ('read_google_business_profile', 'read_reviews');
  insert into public.integration_capability_grants (
    organization_id, connection_id, capability_key, maturity, availability,
    reason_codes, restriction_codes, derived_from_adapter_version,
    derived_from_contract_version
  ) select p_organization_id, connected.id, grant_row.*
  from pg_catalog.jsonb_to_recordset(p_grants) as grant_row(
    capability_key text, maturity text, availability text, reason_codes text[],
    restriction_codes text[], derived_from_adapter_version text,
    derived_from_contract_version text
  ) on conflict (organization_id, connection_id, capability_key) do update set
    maturity = excluded.maturity,
    availability = excluded.availability,
    reason_codes = excluded.reason_codes,
    restriction_codes = excluded.restriction_codes,
    derived_from_adapter_version = excluded.derived_from_adapter_version,
    derived_from_contract_version = excluded.derived_from_contract_version;

  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(grant_row)), '[]'::jsonb)
  into grants_payload from public.integration_capability_grants grant_row
  where grant_row.organization_id = p_organization_id and grant_row.connection_id = connected.id;
  response_payload := pg_catalog.jsonb_build_object(
    'connection', pg_catalog.to_jsonb(connected) - 'credential_reference',
    'grants', grants_payload, 'created', created, 'deduplicated', false
  );
  update public.integration_fixture_connect_operations set response = response_payload
  where id = operation.id;
  return response_payload;
end;
$$;

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
  expected_availability text;
  expected_reason text;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_role(
      p_organization_id, array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
    raise exception 'integration operation is not authorized' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);
  select * into locked_connection from public.integration_connections connection
  where connection.organization_id = p_organization_id and connection.id = p_connection_id
  for update;
  if not found then
    raise exception 'integration connection was not found' using errcode = 'P0002';
  end if;
  if locked_connection.provider_key <> 'google_business_profile'
    or locked_connection.adapter_version <> '1'
    or locked_connection.connection_mode <> 'fixture' then
    raise exception 'fixture provider or capability grants are not permitted' using errcode = '23514';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_to_recordset(p_mappings) as mapping_row(
      external_resource_id text, external_resource_label text, branch_id uuid, status text
    ) left join public.branches branch
      on branch.organization_id = p_organization_id and branch.id = mapping_row.branch_id
    where (mapping_row.status = 'mapped' and mapping_row.branch_id is null)
      or (mapping_row.branch_id is not null and branch.id is null)
  ) then
    raise exception 'mapping branch is unavailable for this organization' using errcode = '23514';
  end if;
  if locked_connection.status = 'revoked' then
    expected_availability := 'disabled'; expected_reason := 'connection_revoked';
  elsif locked_connection.status = 'disconnected' then
    expected_availability := 'disabled'; expected_reason := 'connection_disconnected';
  elsif exists (
    select 1 from pg_catalog.jsonb_to_recordset(p_mappings) as mapping_row(
      external_resource_id text, external_resource_label text, branch_id uuid, status text
    ) join public.branches branch
      on branch.organization_id = p_organization_id and branch.id = mapping_row.branch_id
    where mapping_row.status = 'mapped'
  ) then
    expected_availability := 'available'; expected_reason := null;
  else
    expected_availability := 'blocked'; expected_reason := 'account_unmapped';
  end if;
  perform private.assert_google_fixture_grants(
    p_grants, expected_availability, expected_reason
  );

  insert into public.integration_mapping_operations (
    organization_id, connection_id, idempotency_key, request_fingerprint, response
  ) values (p_organization_id, p_connection_id, p_idempotency_key, request_fingerprint, '{}'::jsonb)
  on conflict (organization_id, connection_id, idempotency_key) do nothing;
  select * into operation from public.integration_mapping_operations mapping_operation
  where mapping_operation.organization_id = p_organization_id
    and mapping_operation.connection_id = p_connection_id
    and mapping_operation.idempotency_key = p_idempotency_key
  for update;
  if operation.request_fingerprint <> request_fingerprint then
    raise exception 'mapping idempotency key was reused with a different request' using errcode = '23505';
  end if;
  if operation.response <> '{}'::jsonb then return operation.response; end if;

  delete from public.integration_account_mappings
  where organization_id = p_organization_id and connection_id = p_connection_id;
  insert into public.integration_account_mappings (
    organization_id, connection_id, external_resource_id, external_resource_label,
    branch_id, status, created_by
  ) select p_organization_id, p_connection_id, mapping_row.*, p_actor_id
  from pg_catalog.jsonb_to_recordset(p_mappings) as mapping_row(
    external_resource_id text, external_resource_label text, branch_id uuid, status text
  );
  update public.integration_capability_grants
  set availability = 'disabled',
    reason_codes = case when 'capability_removed' = any(reason_codes) then reason_codes
      else pg_catalog.array_append(reason_codes, 'capability_removed') end
  where organization_id = p_organization_id and connection_id = p_connection_id
    and capability_key not in ('read_google_business_profile', 'read_reviews');
  insert into public.integration_capability_grants (
    organization_id, connection_id, capability_key, maturity, availability,
    reason_codes, restriction_codes, derived_from_adapter_version,
    derived_from_contract_version
  ) select p_organization_id, p_connection_id, grant_row.*
  from pg_catalog.jsonb_to_recordset(p_grants) as grant_row(
    capability_key text, maturity text, availability text, reason_codes text[],
    restriction_codes text[], derived_from_adapter_version text,
    derived_from_contract_version text
  ) on conflict (organization_id, connection_id, capability_key) do update set
    maturity = excluded.maturity,
    availability = excluded.availability,
    reason_codes = excluded.reason_codes,
    restriction_codes = excluded.restriction_codes,
    derived_from_adapter_version = excluded.derived_from_adapter_version,
    derived_from_contract_version = excluded.derived_from_contract_version;
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(mapping_row)), '[]'::jsonb)
  into mappings_payload from public.integration_account_mappings mapping_row
  where mapping_row.organization_id = p_organization_id and mapping_row.connection_id = p_connection_id;
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(grant_row)), '[]'::jsonb)
  into grants_payload from public.integration_capability_grants grant_row
  where grant_row.organization_id = p_organization_id and grant_row.connection_id = p_connection_id;
  response_payload := pg_catalog.jsonb_build_object(
    'mappings', mappings_payload, 'grants', grants_payload
  );
  update public.integration_mapping_operations set response = response_payload where id = operation.id;
  return response_payload;
end;
$$;

alter table public.integration_capability_grants enable row level security;
alter table public.integration_capability_grants force row level security;
revoke all on table public.integration_capability_grants from public, anon, authenticated;
grant select on table public.integration_capability_grants to authenticated;
revoke all on function public.connect_fixture_integration_with_grants(
  uuid, uuid, text, text, text, text, text[], text, uuid, jsonb
) from public, anon;
grant execute on function public.connect_fixture_integration_with_grants(
  uuid, uuid, text, text, text, text, text[], text, uuid, jsonb
) to authenticated;
revoke all on function public.replace_integration_mappings_with_grants(
  uuid, uuid, uuid, uuid, text, jsonb, jsonb
) from public, anon;
grant execute on function public.replace_integration_mappings_with_grants(
  uuid, uuid, uuid, uuid, text, jsonb, jsonb
) to authenticated;
