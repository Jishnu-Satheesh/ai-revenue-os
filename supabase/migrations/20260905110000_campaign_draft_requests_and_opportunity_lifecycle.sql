-- Growth Intelligence Task 21: atomic Campaign draft requests.
--
-- One durable request per organization and opportunity. A member admits the
-- request (or replays the existing one) through
-- `request_campaign_draft_from_opportunity`; a worker claims, fails, or
-- completes it through fenced service-role RPCs; the requesting actor may
-- cancel a pending request through `cancel_campaign_draft_request`. The
-- Opportunity stays `draft_requested` while work is outstanding — a failed
-- worker never pretends it returned to `proposed` — and moves to
-- `draft_created` atomically with the Campaign link in Task 22.
--
-- Deviation from the plan's four named RPCs: cancellation needs an
-- authenticated member path (the worker fail path cannot speak for the
-- actor), so `cancel_campaign_draft_request` is a fifth function.

create table public.campaign_draft_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  opportunity_id uuid not null,
  opportunity_version integer not null check (opportunity_version > 0),
  action_key text not null check (action_key ~ '^[a-z][a-z0-9_.-]{1,120}$'),
  assertions jsonb not null check (
    jsonb_typeof(assertions) = 'array' and jsonb_array_length(assertions) between 1 and 50
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  actor_id uuid not null,
  status text not null check (status in (
    'pending', 'processing', 'completed', 'retryable_failed', 'permanent_failed', 'cancelled'
  )),
  claim_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  campaign_id uuid,
  failure_code text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  foreign key (organization_id, opportunity_id)
    references public.opportunities (organization_id, id) on delete restrict,
  unique (organization_id, opportunity_id)
);

comment on table public.campaign_draft_requests is
  'One durable Campaign draft request per organization and opportunity. '
  'Concurrent or repeated admissions return the same row rather than creating another.';

alter table public.campaign_draft_requests enable row level security;
alter table public.campaign_draft_requests force row level security;

-- Members read their organization's requests; every write passes through a
-- fenced definer function below, so no direct write policy exists.
create policy "members with campaign create read draft requests"
on public.campaign_draft_requests
for select to authenticated
using (private.has_organization_permission(organization_id, 'campaign.create'));

revoke all on table public.campaign_draft_requests from anon, authenticated;

-- The Opportunity lifecycle gains its draft states. Legacy values stay
-- readable; nothing existing is renamed.
alter table public.opportunities
  drop constraint if exists opportunities_status_check;

alter table public.opportunities
  add constraint opportunities_status_check
  check (status in (
    'proposed', 'awaiting_approval', 'approved', 'rejected', 'snoozed', 'expired',
    'draft_requested', 'draft_created'
  ));

-- Member admission ------------------------------------------------------------

create function public.request_campaign_draft_from_opportunity(
  p_organization_id uuid,
  p_actor_id uuid,
  p_opportunity_id uuid,
  p_opportunity_version integer,
  p_action_key text,
  p_assertions jsonb,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  opportunity_row public.opportunities;
  existing_row public.campaign_draft_requests;
  stored_key text;
  requested_key text;
begin
  if (select auth.uid()) is distinct from p_actor_id then
    raise exception 'campaign draft request is not authorized' using errcode = '42501';
  end if;
  if not private.has_organization_permission(p_organization_id, 'campaign.create') then
    raise exception 'campaign draft request is not authorized' using errcode = '42501';
  end if;
  if p_opportunity_version is null or p_opportunity_version < 1 then
    raise exception 'campaign draft request is not valid' using errcode = '22023';
  end if;
  if p_action_key is distinct from 'campaign.governed_draft_v1' then
    raise exception 'campaign draft request is not valid' using errcode = '22023';
  end if;
  if jsonb_typeof(p_assertions) <> 'array'
    or jsonb_array_length(p_assertions) not between 1 and 50
  then
    raise exception 'campaign draft request is not valid' using errcode = '22023';
  end if;
  if char_length(coalesce(p_idempotency_key, '')) not between 16 and 200 then
    raise exception 'campaign draft request is not valid' using errcode = '22023';
  end if;

  -- One admission per organization and opportunity: concurrent members
  -- serialize here and share the outcome below.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_opportunity_id::text, 0)
  );

  select opportunity.* into opportunity_row
  from public.opportunities opportunity
  where opportunity.organization_id = p_organization_id
    and opportunity.id = p_opportunity_id
  for update;
  if not found then
    raise exception 'campaign draft opportunity was not found' using errcode = 'P0002';
  end if;

  select request.* into existing_row
  from public.campaign_draft_requests request
  where request.organization_id = p_organization_id
    and request.opportunity_id = p_opportunity_id
  for update;
  if found then
    -- A failed-but-retryable request is explicitly requeued by asking again;
    -- every other state replays as-is, including completed and cancelled. The
    -- replay path deliberately skips the open-state gates below: the work was
    -- already admitted once, and re-asking must report standing, not re-argue it.
    if existing_row.status = 'retryable_failed' then
      update public.campaign_draft_requests
      set status = 'pending',
        claim_token = null,
        lease_expires_at = null,
        failure_code = null,
        updated_at = pg_catalog.now()
      where id = existing_row.id;
      existing_row.status := 'pending';
    end if;
    return pg_catalog.jsonb_build_object(
      'requestId', existing_row.id,
      'status', 'replayed',
      'draftRequestStatus', existing_row.status
    );
  end if;

  if opportunity_row.status <> 'proposed' then
    raise exception 'campaign draft opportunity is not open' using errcode = '22023';
  end if;
  if opportunity_row.version is distinct from p_opportunity_version then
    raise exception 'campaign draft opportunity changed under review' using errcode = '22023';
  end if;
  if opportunity_row.action_key is distinct from p_action_key then
    raise exception 'campaign draft action changed under review' using errcode = '22023';
  end if;
  if opportunity_row.expires_at <= pg_catalog.now() then
    raise exception 'campaign draft opportunity is not open' using errcode = '22023';
  end if;
  -- Every requested assertion must already be asserted on the stored
  -- Opportunity; a new assertion at request time is a different proposal.
  for requested_key in
    select value ->> 'key' from jsonb_array_elements(p_assertions)
  loop
    select value ->> 'key' into stored_key
    from jsonb_array_elements(opportunity_row.assertions)
    where value ->> 'key' = requested_key;
    if not found then
      raise exception 'campaign draft assertions changed under review' using errcode = '22023';
    end if;
  end loop;

  insert into public.campaign_draft_requests (
    organization_id, opportunity_id, opportunity_version, action_key, assertions,
    idempotency_key, actor_id, status
  ) values (
    p_organization_id, p_opportunity_id, p_opportunity_version, p_action_key,
    p_assertions, p_idempotency_key, p_actor_id, 'pending'
  )
  returning * into existing_row;

  update public.opportunities
  set status = 'draft_requested'
  where organization_id = p_organization_id and id = p_opportunity_id;

  return pg_catalog.jsonb_build_object(
    'requestId', existing_row.id,
    'status', 'created',
    'draftRequestStatus', 'pending'
  );
end;
$$;

revoke all on function public.request_campaign_draft_from_opportunity(
  uuid, uuid, uuid, integer, text, jsonb, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.request_campaign_draft_from_opportunity(
  uuid, uuid, uuid, integer, text, jsonb, text, uuid
) to authenticated;

-- Member cancellation: a pending request the actor no longer wants. Anything
-- already claimed belongs to the worker until its lease lapses.
create function public.cancel_campaign_draft_request(
  p_organization_id uuid,
  p_actor_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_row public.campaign_draft_requests;
begin
  if (select auth.uid()) is distinct from p_actor_id then
    raise exception 'campaign draft cancellation is not authorized' using errcode = '42501';
  end if;
  if not private.has_organization_permission(p_organization_id, 'campaign.create') then
    raise exception 'campaign draft cancellation is not authorized' using errcode = '42501';
  end if;

  select request.* into existing_row
  from public.campaign_draft_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
    and request.actor_id = p_actor_id
  for update;
  if not found then
    raise exception 'campaign draft request was not found' using errcode = 'P0002';
  end if;
  if existing_row.status <> 'pending' then
    raise exception 'campaign draft request is not cancellable' using errcode = '22023';
  end if;

  update public.campaign_draft_requests
  set status = 'cancelled', updated_at = pg_catalog.now()
  where id = existing_row.id;

  return pg_catalog.jsonb_build_object('requestId', existing_row.id, 'status', 'cancelled');
end;
$$;

revoke all on function public.cancel_campaign_draft_request(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_campaign_draft_request(uuid, uuid, uuid)
  to authenticated;

-- Worker claim: pending becomes processing under a fencing token and lease.
create function public.claim_campaign_draft_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_row public.campaign_draft_requests;
begin
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'campaign draft claim is not valid' using errcode = '22023';
  end if;

  select request.* into existing_row
  from public.campaign_draft_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
  for update;
  if not found then
    raise exception 'campaign draft request was not found' using errcode = 'P0002';
  end if;
  if existing_row.status <> 'pending' then
    raise exception 'campaign draft request is not claimable' using errcode = '22023';
  end if;

  update public.campaign_draft_requests
  set status = 'processing',
    claim_token = p_claim_token,
    lease_expires_at = pg_catalog.now() + (p_lease_seconds || ' seconds')::interval,
    attempt_count = attempt_count + 1,
    updated_at = pg_catalog.now()
  where id = existing_row.id;

  return pg_catalog.jsonb_build_object(
    'requestId', existing_row.id, 'status', 'processing', 'claimToken', p_claim_token
  );
end;
$$;

revoke all on function public.claim_campaign_draft_request(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_campaign_draft_request(uuid, uuid, uuid, integer)
  to service_role;

-- Worker failure: the Opportunity stays `draft_requested`; retryability rides
-- the request row, never a silent return to `proposed`.
create function public.fail_campaign_draft_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_retryable boolean,
  p_failure_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_row public.campaign_draft_requests;
begin
  if p_failure_code is null or char_length(p_failure_code) not between 1 and 200 then
    raise exception 'campaign draft failure is not valid' using errcode = '22023';
  end if;

  select request.* into existing_row
  from public.campaign_draft_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
  for update;
  if not found then
    raise exception 'campaign draft request was not found' using errcode = 'P0002';
  end if;
  if existing_row.status <> 'processing' then
    raise exception 'campaign draft request is not failing' using errcode = '22023';
  end if;
  if existing_row.claim_token is distinct from p_claim_token then
    raise exception 'campaign draft claim is not current' using errcode = '42501';
  end if;

  update public.campaign_draft_requests
  set status = case when p_retryable then 'retryable_failed' else 'permanent_failed' end,
    claim_token = null,
    lease_expires_at = null,
    failure_code = p_failure_code,
    updated_at = pg_catalog.now()
  where id = existing_row.id;

  return pg_catalog.jsonb_build_object(
    'requestId', existing_row.id,
    'status', case when p_retryable then 'retryable_failed' else 'permanent_failed' end
  );
end;
$$;

revoke all on function public.fail_campaign_draft_request(uuid, uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.fail_campaign_draft_request(uuid, uuid, uuid, boolean, text)
  to service_role;

-- Worker completion: the Campaign link and the Opportunity transition commit
-- together, so `draft_created` always means a linked draft exists.
create function public.complete_campaign_draft_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_campaign_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_row public.campaign_draft_requests;
begin
  select request.* into existing_row
  from public.campaign_draft_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
  for update;
  if not found then
    raise exception 'campaign draft request was not found' using errcode = 'P0002';
  end if;
  if existing_row.status <> 'processing' then
    raise exception 'campaign draft request is not completing' using errcode = '22023';
  end if;
  if existing_row.claim_token is distinct from p_claim_token then
    raise exception 'campaign draft claim is not current' using errcode = '42501';
  end if;

  update public.campaign_draft_requests
  set status = 'completed',
    campaign_id = p_campaign_id,
    claim_token = null,
    lease_expires_at = null,
    updated_at = pg_catalog.now()
  where id = existing_row.id;

  update public.opportunities
  set status = 'draft_created'
  where organization_id = p_organization_id
    and id = existing_row.opportunity_id;

  return pg_catalog.jsonb_build_object('requestId', existing_row.id, 'status', 'completed');
end;
$$;

revoke all on function public.complete_campaign_draft_request(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_campaign_draft_request(uuid, uuid, uuid, uuid)
  to service_role;
