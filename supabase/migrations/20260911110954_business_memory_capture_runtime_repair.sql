-- Spec 023 Task 03 repair: the claim's UPDATE carried a bare RETURNING with
-- no INTO, so every claim died with "query has no destination for result
-- data" before claiming anything. The follow-up SELECT re-reads the claimed
-- rows already, so the RETURNING clause is removed, not redirected.

create or replace function public.claim_memory_capture_events(
  p_organization_id uuid,
  p_claim_token uuid,
  p_limit integer,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed jsonb;
begin
  if p_organization_id is null
    or p_claim_token is null
    or p_limit is null or p_limit < 1 or p_limit > 25
    or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 600 then
    raise exception 'memory capture claim input is invalid' using errcode = '23514';
  end if;

  with due as (
    select due_event.id
    from public.memory_capture_events due_event
    where due_event.organization_id = p_organization_id
      and (
        due_event.status = 'pending' and due_event.next_attempt_at <= now()
        or due_event.status = 'claimed' and due_event.lease_expires_at <= now()
      )
    order by due_event.next_attempt_at asc
    limit p_limit
    for update skip locked
  )
  update public.memory_capture_events claimed_event
  set status = 'claimed',
    claim_token = p_claim_token,
    lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
    attempt_count = claimed_event.attempt_count + 1,
    next_attempt_at = now() + (p_lease_seconds || ' seconds')::interval,
    safe_failure_code = null
  from due
  where claimed_event.id = due.id;

  select pg_catalog.jsonb_agg(id) into claimed from (
    select claimed_event.id from public.memory_capture_events claimed_event
    where claimed_event.organization_id = p_organization_id
      and claimed_event.claim_token = p_claim_token
      and claimed_event.status = 'claimed'
      and claimed_event.lease_expires_at > now()
  ) claimed_ids;

  return pg_catalog.jsonb_build_object('captureIds', coalesce(claimed, '[]'::jsonb));
end;
$$;

revoke all on function public.claim_memory_capture_events(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_memory_capture_events(uuid, uuid, integer, integer)
  to service_role;
