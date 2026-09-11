-- Spec 024 consent-gated grounded share: consent + provider qualification.
--
-- Default deny: both tables start empty, so no organization shares anything
-- until an owner/admin grant plus a current Google qualification both exist.
-- Tables are RPC-only (revoked from anon/authenticated); reads go through
-- grounded_share_status, writes through the grant/revoke/record RPCs below.
-- No Channel/Growth/Campaign behavior changes in this migration.

-- Consent records ----------------------------------------------------------

create table public.grounded_share_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  consent_version text not null default 'grounded-share-v1' check (
    consent_version = 'grounded-share-v1'
  ),
  wording_hash text not null check (wording_hash ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references auth.users(id),
  status text not null default 'granted' check (status in ('granted', 'revoked')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text check (
    revoke_reason is null or char_length(revoke_reason) between 1 and 500
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  request_fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  constraint grounded_share_consents_revoke_pair check (
    (status = 'revoked') = (revoked_at is not null)
  )
);

-- Exactly one active grant per organization.
create unique index grounded_share_consents_one_active
  on public.grounded_share_consents (organization_id)
  where status = 'granted';

create index grounded_share_consents_org_time
  on public.grounded_share_consents (organization_id, created_at desc);

alter table public.grounded_share_consents enable row level security;
alter table public.grounded_share_consents force row level security;
revoke all on table public.grounded_share_consents from public, anon, authenticated;

-- Provider qualifications ---------------------------------------------------

create table public.grounded_share_qualifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'google' check (provider = 'google'),
  product_version text not null check (char_length(product_version) between 1 and 120),
  agreement_version text not null check (char_length(agreement_version) between 1 and 120),
  retention_clause_ref text not null check (char_length(retention_clause_ref) between 1 and 300),
  checked_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > checked_at),
  status text not null default 'current' check (status in ('current', 'expired', 'withdrawn')),
  approved_by uuid not null references auth.users(id),
  note text check (note is null or char_length(note) between 1 and 500),
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

-- Exactly one current qualification per organization.
create unique index grounded_share_qualifications_one_current
  on public.grounded_share_qualifications (organization_id)
  where status = 'current';

create index grounded_share_qualifications_org_time
  on public.grounded_share_qualifications (organization_id, created_at desc);

alter table public.grounded_share_qualifications enable row level security;
alter table public.grounded_share_qualifications force row level security;
revoke all on table public.grounded_share_qualifications from public, anon, authenticated;

-- Grant ---------------------------------------------------------------------

create or replace function public.grant_grounded_share_consent(
  p_organization_id uuid,
  p_actor_id uuid,
  p_wording_hash text,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation public.grounded_share_consents;
  request_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'wording_hash', p_wording_hash
  )::text);
  response_payload jsonb;
begin
  if p_organization_id is null
    or p_actor_id is null
    or p_wording_hash is null
    or p_wording_hash !~ '^[0-9a-f]{64}$'
    or p_idempotency_key is null
    or pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) not between 1 and 200
    or p_correlation_id is null then
    raise exception 'grounded share consent input is invalid' using errcode = '23514';
  end if;

  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_role(
      p_organization_id,
      array['owner', 'admin']::public.organization_role[]
    ) then
    raise exception 'grounded share consent is not authorized' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);

  insert into public.grounded_share_consents (
    organization_id, wording_hash, actor_id, status, idempotency_key, request_fingerprint
  ) values (
    p_organization_id, p_wording_hash, p_actor_id, 'granted',
    p_idempotency_key, request_fingerprint
  ) on conflict (organization_id, idempotency_key) do nothing
  returning * into operation;

  if found then
    -- Newly granted. The partial unique index refuses a second active grant.
    response_payload := pg_catalog.jsonb_build_object(
      'consentId', operation.id,
      'status', operation.status,
      'consentVersion', operation.consent_version
    );
    return response_payload || pg_catalog.jsonb_build_object('replayed', false);
  end if;

  select * into operation
  from public.grounded_share_consents stored_operation
  where stored_operation.organization_id = p_organization_id
    and stored_operation.idempotency_key = p_idempotency_key
  for update;

  if operation.request_fingerprint <> request_fingerprint then
    raise exception 'grounded share idempotency key was reused with a different request'
      using errcode = '23505';
  end if;

  return pg_catalog.jsonb_build_object(
    'consentId', operation.id,
    'status', operation.status,
    'consentVersion', operation.consent_version,
    'replayed', true
  );
exception
  when unique_violation then
    raise exception 'grounded share consent is already granted' using errcode = '23505';
end;
$$;

revoke all on function public.grant_grounded_share_consent(uuid, uuid, text, text, uuid)
  from public, anon;
grant execute on function public.grant_grounded_share_consent(uuid, uuid, text, text, uuid)
  to authenticated;

-- Revoke --------------------------------------------------------------------

create or replace function public.revoke_grounded_share_consent(
  p_organization_id uuid,
  p_actor_id uuid,
  p_consent_id uuid,
  p_reason text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  consent public.grounded_share_consents;
begin
  if p_organization_id is null
    or p_actor_id is null
    or p_consent_id is null
    or p_correlation_id is null
    or (p_reason is not null and pg_catalog.char_length(p_reason) not between 1 and 500) then
    raise exception 'grounded share revocation input is invalid' using errcode = '23514';
  end if;

  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_role(
      p_organization_id,
      array['owner', 'admin']::public.organization_role[]
    ) then
    raise exception 'grounded share revocation is not authorized' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);

  select * into consent
  from public.grounded_share_consents existing
  where existing.organization_id = p_organization_id
    and existing.id = p_consent_id
  for update;
  if not found then
    raise exception 'grounded share consent was not found' using errcode = 'P0002';
  end if;

  if consent.status = 'revoked' then
    return pg_catalog.jsonb_build_object(
      'consentId', consent.id, 'status', 'revoked', 'replayed', true
    );
  end if;

  update public.grounded_share_consents
  set status = 'revoked',
    revoked_at = now(),
    revoke_reason = p_reason
  where grounded_share_consents.organization_id = p_organization_id
    and grounded_share_consents.id = p_consent_id
    and grounded_share_consents.status = 'granted';

  return pg_catalog.jsonb_build_object(
    'consentId', p_consent_id, 'status', 'revoked', 'replayed', false
  );
end;
$$;

revoke all on function public.revoke_grounded_share_consent(uuid, uuid, uuid, text, uuid)
  from public, anon;
grant execute on function public.revoke_grounded_share_consent(uuid, uuid, uuid, text, uuid)
  to authenticated;

-- Qualification ---------------------------------------------------------------

create or replace function public.record_grounded_share_qualification(
  p_organization_id uuid,
  p_actor_id uuid,
  p_product_version text,
  p_agreement_version text,
  p_retention_clause_ref text,
  p_expires_at timestamptz,
  p_note text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  qualification public.grounded_share_qualifications;
begin
  if p_organization_id is null
    or p_actor_id is null
    or p_product_version is null
    or pg_catalog.char_length(p_product_version) not between 1 and 120
    or p_agreement_version is null
    or pg_catalog.char_length(p_agreement_version) not between 1 and 120
    or p_retention_clause_ref is null
    or pg_catalog.char_length(p_retention_clause_ref) not between 1 and 300
    or p_expires_at is null
    or p_expires_at <= now()
    or p_correlation_id is null
    or (p_note is not null and pg_catalog.char_length(p_note) not between 1 and 500) then
    raise exception 'grounded share qualification input is invalid' using errcode = '23514';
  end if;

  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_role(
      p_organization_id,
      array['owner', 'admin']::public.organization_role[]
    ) then
    raise exception 'grounded share qualification is not authorized' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);

  -- Retire any current qualification before recording the new one.
  update public.grounded_share_qualifications
  set status = 'expired'
  where grounded_share_qualifications.organization_id = p_organization_id
    and grounded_share_qualifications.status = 'current';

  insert into public.grounded_share_qualifications (
    organization_id, provider, product_version, agreement_version,
    retention_clause_ref, expires_at, status, approved_by, note
  ) values (
    p_organization_id, 'google', p_product_version, p_agreement_version,
    p_retention_clause_ref, p_expires_at, 'current', p_actor_id, p_note
  ) returning * into qualification;

  return pg_catalog.jsonb_build_object(
    'qualificationId', qualification.id,
    'status', qualification.status,
    'expiresAt', qualification.expires_at
  );
end;
$$;

revoke all on function public.record_grounded_share_qualification(
  uuid, uuid, text, text, text, timestamptz, text, uuid
) from public, anon;
grant execute on function public.record_grounded_share_qualification(
  uuid, uuid, text, text, text, timestamptz, text, uuid
) to authenticated;

-- Status: safe fields only, no bodies ------------------------------------------

create or replace function public.grounded_share_status(
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_worker boolean :=
    pg_catalog.current_setting('role', true) = 'service_role';
  consent public.grounded_share_consents;
  qualification public.grounded_share_qualifications;
  share_active boolean := false;
begin
  if p_organization_id is null then
    raise exception 'grounded share status input is invalid' using errcode = '23514';
  end if;

  if is_worker then
    -- Service role is server-only; the caller binds the organization from the
    -- claimed run, so no auth.uid check applies here. Tenant scope still holds:
    -- every read below filters on the supplied organization.
    null;
  elsif not private.is_organization_member(p_organization_id) then
    raise exception 'grounded share status is not authorized' using errcode = '42501';
  end if;

  select * into consent
  from public.grounded_share_consents active_consent
  where active_consent.organization_id = p_organization_id
    and active_consent.status = 'granted'
  order by active_consent.granted_at desc
  limit 1;

  select * into qualification
  from public.grounded_share_qualifications current_qualification
  where current_qualification.organization_id = p_organization_id
    and current_qualification.status = 'current'
    and current_qualification.expires_at > now()
  order by current_qualification.checked_at desc
  limit 1;

  share_active := consent.id is not null and qualification.id is not null;

  return pg_catalog.jsonb_build_object(
    'shareActive', share_active,
    'consentGranted', consent.id is not null,
    'consentId', consent.id,
    'consentVersion', consent.consent_version,
    'qualificationCurrent', qualification.id is not null,
    'qualificationId', qualification.id,
    'qualificationExpiresAt', qualification.expires_at
  );
end;
$$;

revoke all on function public.grounded_share_status(uuid) from public, anon;
grant execute on function public.grounded_share_status(uuid) to authenticated, service_role;
