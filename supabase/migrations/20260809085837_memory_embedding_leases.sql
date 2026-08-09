-- A lease owns the paid provider call. It is separate from embedding_status so
-- `pending` remains the public state while a bounded worker is in flight.
create table public.memory_embedding_leases (
  organization_id uuid not null,
  item_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  claim_token uuid not null,
  item_revision timestamptz not null,
  lease_expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (organization_id, item_id),
  foreign key (organization_id, item_id)
    references public.memory_items(organization_id, id) on delete cascade
);

create index memory_embedding_leases_expiry_idx
  on public.memory_embedding_leases (organization_id, lease_expires_at);

create table public.memory_embedding_batch_claims (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  claim_token uuid not null,
  lease_expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (organization_id, idempotency_key)
);

create index memory_embedding_batch_claims_expiry_idx
  on public.memory_embedding_batch_claims (organization_id, lease_expires_at);

alter table public.memory_embedding_leases enable row level security;
alter table public.memory_embedding_leases force row level security;
revoke all on table public.memory_embedding_leases from public, anon, authenticated;
alter table public.memory_embedding_batch_claims enable row level security;
alter table public.memory_embedding_batch_claims force row level security;
revoke all on table public.memory_embedding_batch_claims from public, anon, authenticated;

create or replace function public.claim_memory_embedding_items(
  p_organization_id uuid,
  p_idempotency_key text,
  p_claim_token uuid,
  p_limit integer
)
returns table (
  id uuid,
  organization_id uuid,
  title text,
  body text,
  verification_state text,
  expires_at timestamptz,
  effective_to timestamptz,
  superseded_by_id uuid,
  embedding_status text,
  claim_token uuid,
  item_revision timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 64 then
    raise exception 'Embedding claim limit must be between 1 and 64.';
  end if;

  insert into public.memory_embedding_batch_claims (
    organization_id, idempotency_key, claim_token, lease_expires_at
  ) values (
    p_organization_id, p_idempotency_key, p_claim_token, pg_catalog.now() + interval '10 minutes'
  ) on conflict do nothing;

  if exists (
    select 1 from public.memory_embedding_batch_claims batch
    where batch.organization_id = p_organization_id
      and batch.idempotency_key = p_idempotency_key
      and batch.completed_at is not null
  ) then
    return;
  end if;

  if exists (
    select 1
    from public.memory_embedding_batch_claims batch
    where batch.organization_id = p_organization_id
      and batch.idempotency_key = p_idempotency_key
      and batch.claim_token <> p_claim_token
      and batch.completed_at is null
      and batch.lease_expires_at > pg_catalog.now()
  ) then
    return;
  end if;

  update public.memory_embedding_batch_claims batch
  set claim_token = p_claim_token,
      lease_expires_at = pg_catalog.now() + interval '10 minutes'
  where batch.organization_id = p_organization_id
    and batch.idempotency_key = p_idempotency_key
    and batch.completed_at is null
    and batch.lease_expires_at <= pg_catalog.now();

  if not exists (
    select 1
    from public.memory_embedding_batch_claims batch
    where batch.organization_id = p_organization_id
      and batch.idempotency_key = p_idempotency_key
      and batch.claim_token = p_claim_token
      and batch.completed_at is null
      and batch.lease_expires_at > pg_catalog.now()
  ) then
    return;
  end if;

  return query
  with candidates as materialized (
    select item.*
    from public.memory_items item
    where item.organization_id = p_organization_id
      and item.embedding_status = 'pending'
      and item.verification_state in ('unverified', 'verified')
      and item.superseded_by_id is null
      and (item.expires_at is null or item.expires_at >= pg_catalog.now())
      and (item.effective_to is null or item.effective_to >= pg_catalog.now())
      and not exists (
        select 1
        from public.memory_embedding_leases lease
        where lease.organization_id = item.organization_id
          and lease.item_id = item.id
          and lease.lease_expires_at > pg_catalog.now()
      )
    order by item.created_at asc, item.id asc
    limit p_limit
    for update skip locked
  ), expired_leases as (
    delete from public.memory_embedding_leases lease
    using candidates item
    where lease.organization_id = item.organization_id
      and lease.item_id = item.id
      and lease.lease_expires_at <= pg_catalog.now()
  ), claimed as (
    insert into public.memory_embedding_leases (
      organization_id, item_id, idempotency_key, claim_token, item_revision, lease_expires_at
    )
    select
      item.organization_id, item.id, p_idempotency_key, p_claim_token, item.updated_at,
      pg_catalog.now() + interval '10 minutes'
    from candidates item
    cross join (select count(*) from expired_leases) as expired
    returning organization_id, item_id, claim_token, item_revision
  )
  select
    item.id,
    item.organization_id,
    item.title,
    item.body,
    item.verification_state,
    item.expires_at,
    item.effective_to,
    item.superseded_by_id,
    item.embedding_status,
    claimed.claim_token,
    claimed.item_revision
  from candidates item
  join claimed
    on claimed.organization_id = item.organization_id and claimed.item_id = item.id;
end;
$$;

create or replace function public.get_memory_embedding_batch_state(
  p_organization_id uuid,
  p_idempotency_key text,
  p_claim_token uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare batch public.memory_embedding_batch_claims;
begin
  select * into batch
  from public.memory_embedding_batch_claims
  where organization_id = p_organization_id
    and idempotency_key = p_idempotency_key;

  if not found then
    return 'missing';
  end if;
  if batch.completed_at is not null then
    return 'completed';
  end if;
  if batch.lease_expires_at <= pg_catalog.now() then
    return 'expired';
  end if;
  if batch.claim_token = p_claim_token then
    return 'owned';
  end if;
  return 'active';
end;
$$;

create or replace function public.complete_memory_embedding(
  p_organization_id uuid,
  p_item_id uuid,
  p_claim_token uuid,
  p_item_revision timestamptz,
  p_embedding extensions.vector(1536),
  p_embedding_model text,
  p_embedding_status text,
  p_embedding_updated_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare completed boolean := false;
begin
  if p_embedding_status not in ('ready', 'failed') then
    raise exception 'Embedding completion status is invalid.';
  end if;
  if p_embedding_status = 'ready' and (
    p_embedding is null or p_embedding_model is null or p_embedding_updated_at is null
  ) then
    raise exception 'Ready embedding completion requires a vector and model.';
  end if;

  update public.memory_items item
  set embedding = case when p_embedding_status = 'ready' then p_embedding else item.embedding end,
      embedding_model = case when p_embedding_status = 'ready' then p_embedding_model else item.embedding_model end,
      embedding_status = p_embedding_status,
      embedding_updated_at = p_embedding_updated_at
  from public.memory_embedding_leases lease
  where item.organization_id = p_organization_id
    and item.id = p_item_id
    and item.organization_id = lease.organization_id
    and item.id = lease.item_id
    and lease.claim_token = p_claim_token
    and lease.item_revision = p_item_revision
    and lease.lease_expires_at > pg_catalog.now()
    and item.updated_at = p_item_revision
    and item.embedding_status = 'pending'
    and item.verification_state in ('unverified', 'verified')
    and item.superseded_by_id is null
    and (item.expires_at is null or item.expires_at >= pg_catalog.now())
    and (item.effective_to is null or item.effective_to >= pg_catalog.now())
  returning true into completed;

  delete from public.memory_embedding_leases lease
  where lease.organization_id = p_organization_id
    and lease.item_id = p_item_id
    and lease.claim_token = p_claim_token;

  return coalesce(completed, false);
end;
$$;

create or replace function public.complete_memory_embedding_batch(
  p_organization_id uuid,
  p_idempotency_key text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare completed boolean := false;
begin
  update public.memory_embedding_batch_claims batch
  set completed_at = pg_catalog.now()
  where batch.organization_id = p_organization_id
    and batch.idempotency_key = p_idempotency_key
    and batch.claim_token = p_claim_token
    and batch.completed_at is null
    and batch.lease_expires_at > pg_catalog.now()
  returning true into completed;

  if completed then
    delete from public.memory_embedding_leases lease
    where lease.organization_id = p_organization_id
      and lease.idempotency_key = p_idempotency_key
      and lease.claim_token = p_claim_token;
  end if;
  return coalesce(completed, false);
end;
$$;

revoke all on function public.claim_memory_embedding_items(uuid, text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_memory_embedding(
  uuid, uuid, uuid, timestamptz, extensions.vector, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.complete_memory_embedding_batch(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.get_memory_embedding_batch_state(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_memory_embedding_items(uuid, text, uuid, integer)
  to service_role;
grant execute on function public.complete_memory_embedding(
  uuid, uuid, uuid, timestamptz, extensions.vector, text, text, timestamptz
) to service_role;
grant execute on function public.complete_memory_embedding_batch(uuid, text, uuid) to service_role;
grant execute on function public.get_memory_embedding_batch_state(uuid, text, uuid) to service_role;
