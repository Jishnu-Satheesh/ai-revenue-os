create or replace function public.transition_integration_ingestion_run(
  p_organization_id uuid,
  p_ingestion_run_id uuid,
  p_expected_statuses text[],
  p_status text,
  p_records_received integer,
  p_records_accepted integer,
  p_records_rejected integer,
  p_completed_at timestamptz default null,
  p_normalized_error_code text default null,
  p_safe_error_summary text default null,
  p_started_at timestamptz default null,
  p_execution_claim_token uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  transitioned public.integration_ingestion_runs;
begin
  update public.integration_ingestion_runs
  set
    status = p_status,
    started_at = coalesce(p_started_at, started_at),
    completed_at = p_completed_at,
    records_received = p_records_received,
    records_accepted = p_records_accepted,
    records_rejected = p_records_rejected,
    normalized_error_code = p_normalized_error_code,
    safe_error_summary = p_safe_error_summary
  where organization_id = p_organization_id
    and id = p_ingestion_run_id
    and status = any(p_expected_statuses)
    and exists (
      select 1
      from public.integration_worker_execution_leases execution_lease
      where execution_lease.organization_id = p_organization_id
        and execution_lease.ingestion_run_id = p_ingestion_run_id
        and execution_lease.claim_token = p_execution_claim_token
        and execution_lease.lease_expires_at > now()
    )
  returning * into transitioned;

  if not found then return null; end if;
  return pg_catalog.to_jsonb(transitioned);
end;
$$;

revoke all on function public.transition_integration_ingestion_run(
  uuid, uuid, text[], text, integer, integer, integer, timestamptz, text, text, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.transition_integration_ingestion_run(
  uuid, uuid, text[], text, integer, integer, integer, timestamptz, text, text, timestamptz, uuid
) to service_role;

create table public.integration_ingestion_handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ingestion_run_id uuid not null,
  idempotency_key text not null,
  fingerprint text not null,
  claim_token uuid,
  lease_expires_at timestamptz,
  status text not null check (status in ('claimed', 'completed')),
  accepted integer,
  rejected integer,
  rejection_reasons text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, ingestion_run_id, idempotency_key),
  foreign key (organization_id, ingestion_run_id)
    references public.integration_ingestion_runs(organization_id, id) on delete restrict,
  check (
    (status = 'claimed' and claim_token is not null and lease_expires_at is not null and accepted is null and rejected is null and rejection_reasons is null)
    or (status = 'completed' and accepted >= 0 and rejected >= 0 and rejection_reasons is not null)
  )
);
alter table public.integration_ingestion_handoffs enable row level security;
alter table public.integration_ingestion_handoffs force row level security;
revoke all on table public.integration_ingestion_handoffs from public, anon, authenticated;

create or replace function public.claim_integration_ingestion_handoff(
  p_organization_id uuid, p_ingestion_run_id uuid, p_idempotency_key text, p_fingerprint text, p_claim_token uuid
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare existing public.integration_ingestion_handoffs;
declare inserted boolean := false;
begin
  insert into public.integration_ingestion_handoffs (
    organization_id, ingestion_run_id, idempotency_key, fingerprint, status, claim_token, lease_expires_at
  ) values (p_organization_id, p_ingestion_run_id, p_idempotency_key, p_fingerprint, 'claimed', p_claim_token, now() + interval '5 minutes')
  on conflict (organization_id, ingestion_run_id, idempotency_key) do nothing
  returning true into inserted;
  select * into existing from public.integration_ingestion_handoffs
    where organization_id = p_organization_id and ingestion_run_id = p_ingestion_run_id
      and idempotency_key = p_idempotency_key for update;
  if existing.fingerprint <> p_fingerprint then return jsonb_build_object('outcome', 'conflict'); end if;
  if existing.status = 'completed' then return jsonb_build_object(
    'outcome', 'completed', 'accepted', existing.accepted, 'rejected', existing.rejected,
    'rejectionReasons', existing.rejection_reasons
  ); end if;
  if inserted then return jsonb_build_object('outcome', 'claimed'); end if;
  if existing.lease_expires_at <= now() then
    update public.integration_ingestion_handoffs set claim_token = p_claim_token, lease_expires_at = now() + interval '5 minutes'
    where id = existing.id;
    return jsonb_build_object('outcome', 'claimed');
  end if;
  return jsonb_build_object('outcome', 'in_progress');
end;
$$;

create or replace function public.complete_integration_ingestion_handoff(
  p_organization_id uuid, p_ingestion_run_id uuid, p_idempotency_key text, p_fingerprint text,
  p_claim_token uuid, p_accepted integer, p_rejected integer, p_rejection_reasons text[]
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare completed public.integration_ingestion_handoffs;
begin
  update public.integration_ingestion_handoffs set
    status = 'completed', accepted = p_accepted, rejected = p_rejected,
    rejection_reasons = p_rejection_reasons
  where organization_id = p_organization_id and ingestion_run_id = p_ingestion_run_id
    and idempotency_key = p_idempotency_key and fingerprint = p_fingerprint and status = 'claimed'
    and claim_token = p_claim_token and lease_expires_at > now()
  returning * into completed;
  if not found then return null; end if;
  return jsonb_build_object('accepted', completed.accepted, 'rejected', completed.rejected,
    'rejectionReasons', completed.rejection_reasons);
end;
$$;

revoke all on function public.claim_integration_ingestion_handoff(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_integration_ingestion_handoff(uuid, uuid, text, text, uuid, integer, integer, text[]) from public, anon, authenticated;
grant execute on function public.claim_integration_ingestion_handoff(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.complete_integration_ingestion_handoff(uuid, uuid, text, text, uuid, integer, integer, text[]) to service_role;

create table public.integration_worker_execution_leases (
  organization_id uuid not null,
  ingestion_run_id uuid not null,
  idempotency_key text not null,
  claim_token uuid not null,
  lease_expires_at timestamptz not null,
  primary key (organization_id, ingestion_run_id),
  foreign key (organization_id, ingestion_run_id) references public.integration_ingestion_runs(organization_id, id) on delete cascade
);
create or replace function private.prevent_integration_worker_execution_lease_identity_change()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.organization_id is distinct from new.organization_id
    or old.ingestion_run_id is distinct from new.ingestion_run_id
    or old.idempotency_key is distinct from new.idempotency_key then
    raise exception 'Integration worker execution lease identity is immutable.';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_integration_worker_execution_lease_identity_change() from public;
create trigger integration_worker_execution_leases_prevent_identity_change
before update on public.integration_worker_execution_leases
for each row execute function private.prevent_integration_worker_execution_lease_identity_change();
alter table public.integration_worker_execution_leases enable row level security;
alter table public.integration_worker_execution_leases force row level security;
revoke all on table public.integration_worker_execution_leases from public, anon, authenticated;

create or replace function public.claim_integration_worker_execution_lease(
  p_organization_id uuid, p_ingestion_run_id uuid, p_idempotency_key text, p_claim_token uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare existing public.integration_worker_execution_leases;
declare locked_run public.integration_ingestion_runs;
begin
  select * into locked_run
  from public.integration_ingestion_runs
  where organization_id = p_organization_id and id = p_ingestion_run_id
  for update;
  if not found or locked_run.idempotency_key <> p_idempotency_key then
    return jsonb_build_object('outcome','conflict');
  end if;
  insert into public.integration_worker_execution_leases (
    organization_id, ingestion_run_id, idempotency_key, claim_token, lease_expires_at
  ) values (
    p_organization_id, p_ingestion_run_id, p_idempotency_key, p_claim_token, now() + interval '5 minutes'
  ) on conflict do nothing;
  select * into existing from public.integration_worker_execution_leases where organization_id = p_organization_id and ingestion_run_id = p_ingestion_run_id for update;
  if existing.idempotency_key <> p_idempotency_key then return jsonb_build_object('outcome','conflict'); end if;
  if existing.claim_token = p_claim_token or existing.lease_expires_at <= now() then
    update public.integration_worker_execution_leases set claim_token = p_claim_token, lease_expires_at = now() + interval '5 minutes'
      where organization_id = p_organization_id and ingestion_run_id = p_ingestion_run_id;
    return jsonb_build_object('outcome','acquired');
  end if;
  return jsonb_build_object('outcome','in_progress');
end;
$$;
revoke all on function public.claim_integration_worker_execution_lease(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_integration_worker_execution_lease(uuid, uuid, text, uuid) to service_role;

create or replace function public.cancel_integration_worker_execution(
  p_organization_id uuid, p_ingestion_run_id uuid, p_idempotency_key text, p_cancellation_token uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare locked_run public.integration_ingestion_runs;
declare cancelled public.integration_ingestion_runs;
begin
  select * into locked_run
  from public.integration_ingestion_runs
  where organization_id = p_organization_id and id = p_ingestion_run_id
  for update;
  if not found or locked_run.idempotency_key <> p_idempotency_key then return null; end if;

  insert into public.integration_worker_execution_leases (
    organization_id, ingestion_run_id, idempotency_key, claim_token, lease_expires_at
  ) values (
    p_organization_id, p_ingestion_run_id, p_idempotency_key, p_cancellation_token, now() + interval '5 minutes'
  ) on conflict do nothing;
  update public.integration_worker_execution_leases
  set claim_token = p_cancellation_token, lease_expires_at = now() + interval '5 minutes'
  where organization_id = p_organization_id and ingestion_run_id = p_ingestion_run_id
    and idempotency_key = p_idempotency_key;

  update public.integration_ingestion_runs
  set status = 'cancelled', completed_at = now(), normalized_error_code = 'CANCELLED',
    safe_error_summary = 'The integration task was cancelled.'
  where organization_id = p_organization_id and id = p_ingestion_run_id
    and status in ('queued', 'running')
  returning * into cancelled;
  if not found then return null; end if;
  return pg_catalog.to_jsonb(cancelled);
end;
$$;
revoke all on function public.cancel_integration_worker_execution(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.cancel_integration_worker_execution(uuid, uuid, text, uuid) to service_role;
