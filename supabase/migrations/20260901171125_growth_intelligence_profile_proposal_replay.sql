-- Resolve exact AI proposal retries before a nondeterministic, billable model
-- call. AI operation identity binds the bounded model input and model contract;
-- the generated document remains the immutable result of the first winner.

create function private.market_profile_proposal_operation_fingerprint(
  p_profile_digest text,
  p_proposal_context jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      case when p_proposal_context ->> 'source' = 'ai'
        then private.canonical_json_text(p_proposal_context)
        else p_profile_digest || '|' || private.canonical_json_text(p_proposal_context)
      end,
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function private.market_profile_proposal_operation_fingerprint(text, jsonb)
  from public, anon, authenticated, service_role;

-- Keep any staging-era AI operations readable under the stable request
-- identity. Operator and system operations retain their document-bound key.
update private.growth_intelligence_write_operations operation
set operation_fingerprint = private.market_profile_proposal_operation_fingerprint(
  version_row.profile_digest,
  pg_catalog.jsonb_build_object(
    'source', 'ai',
    'modelProvider', version_row.model_provider,
    'modelName', version_row.model_name,
    'modelVersion', version_row.model_version,
    'modelInputDigest', version_row.model_input_digest
  )
)
from public.organization_market_profile_versions version_row
where operation.operation_kind = 'propose_profile'
  and operation.organization_id = version_row.organization_id
  and operation.market_profile_version_id = version_row.id
  and version_row.proposal_source = 'ai';

create or replace function public.propose_market_profile_version(
  p_organization_id uuid,
  p_actor_id uuid,
  p_profile_document jsonb,
  p_profile_digest text,
  p_proposal_context jsonb,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile public.organization_market_profiles;
  version_row public.organization_market_profile_versions;
  operation private.growth_intelligence_write_operations;
  proposal_source text := p_proposal_context ->> 'source';
  operation_fingerprint text;
  next_version integer;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'market_profile_proposal_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_profile_digest !~ '^[a-f0-9]{64}$'
    or pg_catalog.char_length(p_idempotency_key) not between 16 and 200
    or p_correlation_id is null
    or proposal_source not in ('operator', 'ai', 'system')
    or not private.jsonb_object_has_exact_keys(
      p_proposal_context,
      case when proposal_source = 'ai'
        then array['source', 'modelProvider', 'modelName', 'modelVersion', 'modelInputDigest']::text[]
        else array['source']::text[] end
    )
    or (proposal_source = 'ai' and (
      pg_catalog.char_length(coalesce(p_proposal_context ->> 'modelProvider', '')) not between 2 and 100
      or pg_catalog.char_length(coalesce(p_proposal_context ->> 'modelName', '')) not between 2 and 160
      or pg_catalog.char_length(coalesce(p_proposal_context ->> 'modelVersion', '')) not between 1 and 160
      or coalesce(p_proposal_context ->> 'modelInputDigest', '') !~ '^[a-f0-9]{64}$'
    )) then
    raise exception 'market_profile_proposal_invalid' using errcode = '22023';
  end if;

  perform private.assert_market_profile_document_v1(p_organization_id, p_profile_document);
  if private.create_market_profile_digest(p_profile_document) is distinct from p_profile_digest then
    raise exception 'market_profile_digest_mismatch' using errcode = '22023';
  end if;

  operation_fingerprint := private.market_profile_proposal_operation_fingerprint(
    p_profile_digest,
    p_proposal_context
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'propose_profile', p_organization_id, p_idempotency_key
    ),
    0
  ));
  select stored.* into operation
  from private.growth_intelligence_write_operations stored
  where stored.organization_id = p_organization_id
    and stored.operation_kind = 'propose_profile'
    and stored.idempotency_key = p_idempotency_key
  for update;
  if found then
    if operation.operation_fingerprint is distinct from operation_fingerprint then
      raise exception 'market_profile_proposal_idempotency_conflict' using errcode = '23505';
    end if;
    select stored.* into version_row
    from public.organization_market_profile_versions stored
    where stored.organization_id = p_organization_id
      and stored.id = operation.market_profile_version_id;
    if not found then
      raise exception 'market_profile_proposal_replay_invalid' using errcode = '55000';
    end if;
    return pg_catalog.jsonb_build_object(
      'profileId', version_row.market_profile_id,
      'profileVersionId', version_row.id,
      'version', version_row.version,
      'profileDigest', version_row.profile_digest,
      'replayed', true
    );
  end if;

  insert into public.organization_market_profiles (
    organization_id, created_by
  ) values (
    p_organization_id, p_actor_id
  ) on conflict (organization_id) do nothing;

  select stored.* into profile
  from public.organization_market_profiles stored
  where stored.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'market_profile_organization_not_found' using errcode = '42501';
  end if;

  select stored.* into version_row
  from public.organization_market_profile_versions stored
  where stored.organization_id = p_organization_id
    and stored.market_profile_id = profile.id
    and stored.profile_digest = p_profile_digest;
  if found then
    insert into private.growth_intelligence_write_operations (
      organization_id, operation_kind, idempotency_key, operation_fingerprint,
      market_profile_version_id
    ) values (
      p_organization_id, 'propose_profile', p_idempotency_key,
      operation_fingerprint, version_row.id
    );
    return pg_catalog.jsonb_build_object(
      'profileId', version_row.market_profile_id,
      'profileVersionId', version_row.id,
      'version', version_row.version,
      'profileDigest', version_row.profile_digest,
      'replayed', true
    );
  end if;

  select coalesce(pg_catalog.max(stored.version), 0) + 1
  into next_version
  from public.organization_market_profile_versions stored
  where stored.organization_id = p_organization_id
    and stored.market_profile_id = profile.id;

  insert into public.organization_market_profile_versions (
    organization_id, market_profile_id, version, schema_version,
    profile_document, profile_digest, source_policy_digest, proposal_source,
    model_provider, model_name, model_version, model_input_digest,
    created_by, correlation_id
  ) values (
    p_organization_id,
    profile.id,
    next_version,
    (p_profile_document ->> 'schemaVersion')::integer,
    p_profile_document,
    p_profile_digest,
    private.create_market_profile_digest(p_profile_document -> 'sourcePolicy'),
    proposal_source,
    nullif(p_proposal_context ->> 'modelProvider', ''),
    nullif(p_proposal_context ->> 'modelName', ''),
    nullif(p_proposal_context ->> 'modelVersion', ''),
    nullif(p_proposal_context ->> 'modelInputDigest', ''),
    p_actor_id,
    p_correlation_id
  ) returning * into version_row;

  insert into private.growth_intelligence_write_operations (
    organization_id, operation_kind, idempotency_key, operation_fingerprint,
    market_profile_version_id
  ) values (
    p_organization_id, 'propose_profile', p_idempotency_key,
    operation_fingerprint, version_row.id
  );

  return pg_catalog.jsonb_build_object(
    'profileId', version_row.market_profile_id,
    'profileVersionId', version_row.id,
    'version', version_row.version,
    'profileDigest', version_row.profile_digest,
    'replayed', false
  );
end;
$$;

create function public.find_market_profile_proposal_replay(
  p_organization_id uuid,
  p_actor_id uuid,
  p_proposal_context jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  operation private.growth_intelligence_write_operations;
  version_row public.organization_market_profile_versions;
  operation_fingerprint text;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'market_profile_proposal_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or pg_catalog.char_length(p_idempotency_key) not between 16 and 200
    or p_proposal_context ->> 'source' is distinct from 'ai'
    or not private.jsonb_object_has_exact_keys(
      p_proposal_context,
      array['source', 'modelProvider', 'modelName', 'modelVersion', 'modelInputDigest']::text[]
    )
    or pg_catalog.char_length(coalesce(p_proposal_context ->> 'modelProvider', '')) not between 2 and 100
    or pg_catalog.char_length(coalesce(p_proposal_context ->> 'modelName', '')) not between 2 and 160
    or pg_catalog.char_length(coalesce(p_proposal_context ->> 'modelVersion', '')) not between 1 and 160
    or coalesce(p_proposal_context ->> 'modelInputDigest', '') !~ '^[a-f0-9]{64}$' then
    raise exception 'market_profile_proposal_replay_invalid' using errcode = '22023';
  end if;

  operation_fingerprint := private.market_profile_proposal_operation_fingerprint(
    null,
    p_proposal_context
  );
  select stored.* into operation
  from private.growth_intelligence_write_operations stored
  where stored.organization_id = p_organization_id
    and stored.operation_kind = 'propose_profile'
    and stored.idempotency_key = p_idempotency_key;
  if not found then
    return null;
  end if;
  if operation.operation_fingerprint is distinct from operation_fingerprint then
    raise exception 'market_profile_proposal_idempotency_conflict' using errcode = '23505';
  end if;

  select stored.* into version_row
  from public.organization_market_profile_versions stored
  where stored.organization_id = p_organization_id
    and stored.id = operation.market_profile_version_id;
  if not found then
    raise exception 'market_profile_proposal_replay_invalid' using errcode = '55000';
  end if;

  return pg_catalog.jsonb_build_object(
    'profileId', version_row.market_profile_id,
    'profileVersionId', version_row.id,
    'version', version_row.version,
    'profileDigest', version_row.profile_digest,
    'replayed', true
  );
end;
$$;

revoke all on function public.find_market_profile_proposal_replay(uuid, uuid, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.find_market_profile_proposal_replay(uuid, uuid, jsonb, text)
  to authenticated, service_role;

revoke all on function public.propose_market_profile_version(uuid, uuid, jsonb, text, jsonb, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.propose_market_profile_version(uuid, uuid, jsonb, text, jsonb, text, uuid)
  to authenticated, service_role;
