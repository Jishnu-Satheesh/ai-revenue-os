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
  p_started_at timestamptz default null
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
  returning * into transitioned;

  if not found then return null; end if;
  return pg_catalog.to_jsonb(transitioned);
end;
$$;

revoke all on function public.transition_integration_ingestion_run(
  uuid, uuid, text[], text, integer, integer, integer, timestamptz, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.transition_integration_ingestion_run(
  uuid, uuid, text[], text, integer, integer, integer, timestamptz, text, text, timestamptz
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
