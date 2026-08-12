-- Governed credential and OAuth substrate.
--
-- Two boundaries are established here and neither is reachable from a browser
-- role. Credentials live in the `private` schema and hold only a Vault
-- reference, so a leaked application row cannot be decrypted. OAuth sessions
-- live in `public` with forced RLS and no grants at all, so they are reachable
-- solely through the security-definer RPCs below, each of which re-checks the
-- caller's current membership and role at the moment of use.
--
-- No provider is registered as executable by this migration.

create table private.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_key text not null,
  vault_secret_id uuid not null,
  idempotency_key text not null,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz,
  constraint integration_credentials_provider_key_valid
    check (provider_key ~ '^[a-z][a-z0-9_]*$'),
  constraint integration_credentials_idempotency_key_valid
    check (char_length(idempotency_key) between 1 and 200)
);

-- A retried connect or rotation must return the credential it already created
-- rather than stranding a second live secret for the same authorization.
create unique index integration_credentials_idempotent_write_idx
  on private.integration_credentials(organization_id, provider_key, idempotency_key);

create index integration_credentials_organization_provider_idx
  on private.integration_credentials(organization_id, provider_key)
  where revoked_at is null;

alter table private.integration_credentials enable row level security;
alter table private.integration_credentials force row level security;
revoke all on table private.integration_credentials from public, anon, authenticated;

create table public.integration_oauth_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_key text not null,
  state_digest text not null,
  requested_scopes text[] not null,
  callback_url text not null,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint integration_oauth_sessions_provider_key_valid
    check (provider_key ~ '^[a-z][a-z0-9_]*$'),
  -- Only the digest is ever stored. A row that somehow leaked cannot be
  -- replayed against the provider, because the state itself is unrecoverable.
  constraint integration_oauth_sessions_state_digest_valid
    check (state_digest ~ '^[0-9a-f]{64}$'),
  constraint integration_oauth_sessions_scopes_present
    check (pg_catalog.array_length(requested_scopes, 1) >= 1
      and pg_catalog.array_position(requested_scopes, null) is null),
  constraint integration_oauth_sessions_callback_https
    check (callback_url like 'https://%' or callback_url like 'http://localhost%'),
  constraint integration_oauth_sessions_expiry_after_creation
    check (expires_at > created_at)
);

-- A state digest is globally unique, so one tenant's redirect can never be
-- reconciled against another tenant's pending session.
create unique index integration_oauth_sessions_state_digest_idx
  on public.integration_oauth_sessions(state_digest);

create index integration_oauth_sessions_pending_idx
  on public.integration_oauth_sessions(organization_id, provider_key, expires_at)
  where consumed_at is null;

create index integration_oauth_sessions_user_idx
  on public.integration_oauth_sessions(user_id);

alter table public.integration_oauth_sessions enable row level security;
alter table public.integration_oauth_sessions force row level security;
revoke all on table public.integration_oauth_sessions from public, anon, authenticated;

-- Sessions are immutable except for the single consuming write performed by the
-- RPC below. Nothing may rewrite the binding after the fact.
create or replace function private.prevent_integration_oauth_session_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.user_id is distinct from old.user_id
    or new.provider_key is distinct from old.provider_key
    or new.state_digest is distinct from old.state_digest
    or new.requested_scopes is distinct from old.requested_scopes
    or new.callback_url is distinct from old.callback_url
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at
  then
    raise exception 'integration oauth session identity is immutable'
      using errcode = 'check_violation';
  end if;

  if old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at then
    raise exception 'integration oauth session is already consumed'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function private.prevent_integration_oauth_session_identity_change() from public;

create trigger integration_oauth_sessions_identity_immutable
before update on public.integration_oauth_sessions
for each row
execute function private.prevent_integration_oauth_session_identity_change();

create or replace function public.start_integration_oauth_session(
  p_organization_id uuid,
  p_provider_key text,
  p_state_digest text,
  p_requested_scopes text[],
  p_callback_url text,
  p_correlation_id uuid,
  p_ttl_seconds integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_id uuid;
begin
  if p_organization_id is null or p_provider_key is null or p_state_digest is null then
    raise exception 'oauth session request is incomplete' using errcode = 'check_violation';
  end if;

  -- Only a role that could legitimately authorize a provider connection may
  -- open a handshake. A viewer cannot.
  if not private.has_organization_role(
    p_organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  ) then
    raise exception 'not authorized to start an oauth session' using errcode = 'insufficient_privilege';
  end if;

  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 1800 then
    raise exception 'oauth session ttl is out of range' using errcode = 'check_violation';
  end if;

  insert into public.integration_oauth_sessions (
    organization_id,
    user_id,
    provider_key,
    state_digest,
    requested_scopes,
    callback_url,
    correlation_id,
    expires_at
  )
  values (
    p_organization_id,
    (select auth.uid()),
    p_provider_key,
    p_state_digest,
    p_requested_scopes,
    p_callback_url,
    p_correlation_id,
    pg_catalog.now() + pg_catalog.make_interval(secs => p_ttl_seconds)
  )
  returning id into session_id;

  return session_id;
end;
$$;

revoke all on function public.start_integration_oauth_session(
  uuid, text, text, text[], text, uuid, integer
) from public, anon;
grant execute on function public.start_integration_oauth_session(
  uuid, text, text, text[], text, uuid, integer
) to authenticated;

-- The consuming write is the whole single-use guarantee. Matching on
-- `consumed_at is null` inside one statement means two concurrent replays of
-- the same redirect cannot both win.
create or replace function public.consume_integration_oauth_session(
  p_state_digest text,
  p_provider_key text,
  p_correlation_id uuid
)
returns table (
  session_id uuid,
  organization_id uuid,
  user_id uuid,
  requested_scopes text[],
  callback_url text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed public.integration_oauth_sessions;
begin
  select * into claimed
  from public.integration_oauth_sessions candidate
  where candidate.state_digest = p_state_digest
    and candidate.provider_key = p_provider_key
  for update;

  if not found then
    return;
  end if;

  -- Every check is re-evaluated now, not at session creation: the user must
  -- still be the one who started it and must still hold an authorizing role.
  if claimed.user_id is distinct from (select auth.uid()) then
    return;
  end if;

  if not private.has_organization_role(
    claimed.organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  ) then
    return;
  end if;

  if claimed.consumed_at is not null or claimed.expires_at <= pg_catalog.now() then
    return;
  end if;

  update public.integration_oauth_sessions
  set consumed_at = pg_catalog.now()
  where id = claimed.id and consumed_at is null;

  if not found then
    return;
  end if;

  session_id := claimed.id;
  organization_id := claimed.organization_id;
  user_id := claimed.user_id;
  requested_scopes := claimed.requested_scopes;
  callback_url := claimed.callback_url;
  return next;
end;
$$;

revoke all on function public.consume_integration_oauth_session(text, text, uuid) from public, anon;
grant execute on function public.consume_integration_oauth_session(text, text, uuid) to authenticated;

create or replace function public.create_integration_credential(
  p_organization_id uuid,
  p_provider_key text,
  p_secret text,
  p_correlation_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing private.integration_credentials;
  new_secret_id uuid;
  new_credential_id uuid;
begin
  if p_secret is null or pg_catalog.btrim(p_secret) = '' then
    raise exception 'credential secret is required' using errcode = 'check_violation';
  end if;

  select * into existing
  from private.integration_credentials candidate
  where candidate.organization_id = p_organization_id
    and candidate.provider_key = p_provider_key
    and candidate.idempotency_key = p_idempotency_key;

  if found and existing.revoked_at is null then
    return existing.id;
  end if;

  -- `search_path` is empty inside this function, so every call is qualified.
  new_credential_id := pg_catalog.gen_random_uuid();
  new_secret_id := vault.create_secret(
    p_secret,
    'integration_credential:' || new_credential_id::text,
    'Integration provider credential',
    null
  );

  insert into private.integration_credentials (
    id, organization_id, provider_key, vault_secret_id, idempotency_key, correlation_id
  )
  values (
    new_credential_id, p_organization_id, p_provider_key, new_secret_id,
    p_idempotency_key, p_correlation_id
  )
  on conflict (organization_id, provider_key, idempotency_key) do update
    set vault_secret_id = excluded.vault_secret_id,
        revoked_at = null,
        rotated_at = pg_catalog.now()
  returning id into new_credential_id;

  return new_credential_id;
end;
$$;

revoke all on function public.create_integration_credential(uuid, text, text, uuid, text)
  from public, anon, authenticated;

create or replace function public.resolve_integration_credential(
  p_organization_id uuid,
  p_provider_key text,
  p_credential_reference uuid,
  p_correlation_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret_value text;
begin
  select decrypted.decrypted_secret into secret_value
  from private.integration_credentials credential
  join vault.decrypted_secrets decrypted on decrypted.id = credential.vault_secret_id
  where credential.id = p_credential_reference
    and credential.organization_id = p_organization_id
    and credential.provider_key = p_provider_key
    and credential.revoked_at is null;

  if secret_value is null then
    raise exception 'credential not found' using errcode = 'no_data_found';
  end if;

  return secret_value;
end;
$$;

revoke all on function public.resolve_integration_credential(uuid, text, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.replace_integration_credential(
  p_organization_id uuid,
  p_provider_key text,
  p_credential_reference uuid,
  p_secret text,
  p_correlation_id uuid,
  p_idempotency_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target private.integration_credentials;
begin
  if p_secret is null or pg_catalog.btrim(p_secret) = '' then
    raise exception 'credential secret is required' using errcode = 'check_violation';
  end if;

  select * into target
  from private.integration_credentials candidate
  where candidate.id = p_credential_reference
    and candidate.organization_id = p_organization_id
    and candidate.provider_key = p_provider_key
    and candidate.revoked_at is null
  for update;

  if not found then
    raise exception 'credential not found' using errcode = 'no_data_found';
  end if;

  -- Rotation replaces the secret behind the same reference, so every stored
  -- connection keeps working without ever learning the new value.
  perform vault.update_secret(target.vault_secret_id, p_secret, null, null, null);

  update private.integration_credentials
  set rotated_at = pg_catalog.now(),
      correlation_id = p_correlation_id,
      idempotency_key = p_idempotency_key
  where id = target.id;
end;
$$;

revoke all on function public.replace_integration_credential(uuid, text, uuid, text, uuid, text)
  from public, anon, authenticated;

create or replace function public.revoke_integration_credential(
  p_organization_id uuid,
  p_provider_key text,
  p_credential_reference uuid,
  p_correlation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target private.integration_credentials;
begin
  select * into target
  from private.integration_credentials candidate
  where candidate.id = p_credential_reference
    and candidate.organization_id = p_organization_id
    and candidate.provider_key = p_provider_key
  for update;

  -- Repeat-safe by design. A retried disconnect must not fail and strand a
  -- connection in a half-revoked state, so an absent or already revoked
  -- credential is success.
  if not found then
    return;
  end if;

  if target.revoked_at is not null then
    return;
  end if;

  delete from vault.secrets where id = target.vault_secret_id;

  update private.integration_credentials
  set revoked_at = pg_catalog.now(),
      correlation_id = p_correlation_id
  where id = target.id;
end;
$$;

revoke all on function public.revoke_integration_credential(uuid, text, uuid, uuid)
  from public, anon, authenticated;
