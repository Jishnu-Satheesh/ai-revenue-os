-- Keep the deterministic fixture product-complete without turning its RPCs
-- into generic provider admission. Mapping payloads are exact and fixture
-- resources are seeded tenant-locally while reconnect preserves prior mapping.

create or replace function private.assert_google_fixture_mappings(p_mappings jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if pg_catalog.jsonb_typeof(p_mappings) <> 'array' then
    raise exception 'fixture mappings are not permitted' using errcode = '23514';
  end if;
  if pg_catalog.jsonb_array_length(p_mappings) <> 2 then
    raise exception 'fixture mappings are not permitted' using errcode = '23514';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_mappings) mapping_payload
    where pg_catalog.jsonb_typeof(mapping_payload) <> 'object'
  ) then
    raise exception 'fixture mappings are not permitted' using errcode = '23514';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_mappings) mapping_payload
    where (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(mapping_payload)) <> 4
      or not mapping_payload ?& array[
        'external_resource_id', 'external_resource_label', 'branch_id', 'status'
      ]
      or pg_catalog.char_length(mapping_payload ->> 'external_resource_id') not between 1 and 500
      or pg_catalog.char_length(mapping_payload ->> 'external_resource_label') not between 1 and 500
      or mapping_payload ->> 'status' not in ('unmapped', 'mapped', 'ignored')
      or mapping_payload ->> 'external_resource_id' not in (
        'locations/fixture-harbor-house', 'locations/fixture-river-market'
      )
      or (mapping_payload ->> 'external_resource_id' = 'locations/fixture-harbor-house'
        and mapping_payload ->> 'external_resource_label' <> 'Harbor House')
      or (mapping_payload ->> 'external_resource_id' = 'locations/fixture-river-market'
        and mapping_payload ->> 'external_resource_label' <> 'River Market')
  ) then
    raise exception 'fixture mappings are not permitted' using errcode = '23514';
  end if;
  if (
    select pg_catalog.count(*) <>
      pg_catalog.count(distinct mapping_payload ->> 'external_resource_id')
    from pg_catalog.jsonb_array_elements(p_mappings) mapping_payload
  ) then
    raise exception 'fixture mappings are not permitted' using errcode = '23514';
  end if;
  if not exists (
    select 1 from pg_catalog.jsonb_array_elements(p_mappings) mapping_payload
    where mapping_payload ->> 'external_resource_id' = 'locations/fixture-harbor-house'
      and mapping_payload ->> 'external_resource_label' = 'Harbor House'
  ) or not exists (
    select 1 from pg_catalog.jsonb_array_elements(p_mappings) mapping_payload
    where mapping_payload ->> 'external_resource_id' = 'locations/fixture-river-market'
      and mapping_payload ->> 'external_resource_label' = 'River Market'
  ) then
    raise exception 'fixture mappings are not permitted' using errcode = '23514';
  end if;
end;
$$;

revoke all on function private.assert_google_fixture_mappings(jsonb) from public, anon, authenticated;

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
  expected_availability text := 'blocked';
  expected_reason text := 'account_unmapped';
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_role(
      p_organization_id, array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
    raise exception 'integration operation is not authorized' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);
  if p_provider_key <> 'google_business_profile' or p_adapter_version <> '1'
    or coalesce(pg_catalog.array_length(p_granted_scopes, 1), 0) <> 0 then
    raise exception 'fixture provider or capability grants are not permitted' using errcode = '23514';
  end if;

  select * into connected
  from public.integration_connections connection
  where connection.organization_id = p_organization_id
    and connection.provider_key = p_provider_key
    and connection.external_account_id = p_external_account_id
  for update;
  created := not found;
  if not created and exists (
    select 1
    from public.integration_account_mappings mapping_row
    where mapping_row.organization_id = p_organization_id
      and mapping_row.connection_id = connected.id
      and mapping_row.status = 'mapped'
      and mapping_row.branch_id is not null
  ) then
    expected_availability := 'available';
    expected_reason := null;
  end if;
  perform private.assert_google_fixture_grants(
    p_grants, expected_availability, expected_reason
  );

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

  insert into public.integration_account_mappings (
    organization_id, connection_id, external_resource_id, external_resource_label,
    branch_id, status, created_by
  ) values
    (
      p_organization_id, connected.id, 'locations/fixture-harbor-house',
      'Harbor House', null, 'unmapped', p_actor_id
    ),
    (
      p_organization_id, connected.id, 'locations/fixture-river-market',
      'River Market', null, 'unmapped', p_actor_id
    )
  on conflict (organization_id, connection_id, external_resource_id) do nothing;

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

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(grant_row)), '[]'::jsonb)
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
  perform private.assert_google_fixture_mappings(p_mappings);
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
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(mapping_row)), '[]'::jsonb)
  into mappings_payload from public.integration_account_mappings mapping_row
  where mapping_row.organization_id = p_organization_id and mapping_row.connection_id = p_connection_id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(grant_row)), '[]'::jsonb)
  into grants_payload from public.integration_capability_grants grant_row
  where grant_row.organization_id = p_organization_id and grant_row.connection_id = p_connection_id;
  response_payload := pg_catalog.jsonb_build_object(
    'mappings', mappings_payload, 'grants', grants_payload
  );
  update public.integration_mapping_operations set response = response_payload where id = operation.id;
  return response_payload;
end;
$$;

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
