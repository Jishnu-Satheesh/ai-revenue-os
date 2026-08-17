-- Transactional confirmation for Business Memory proposals. Facts remain owned
-- by the Digital Twin; this operation is the only human-confirmed promotion
-- path from a memory proposal into that authoritative store.

create table public.memory_promotion_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  request_fingerprint text not null,
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

alter table public.memory_promotion_operations enable row level security;
alter table public.memory_promotion_operations force row level security;
revoke all on table public.memory_promotion_operations from public, anon, authenticated;

create or replace function public.confirm_memory_fact_proposal(
  p_organization_id uuid,
  p_actor_id uuid,
  p_item_id uuid,
  p_override_verified boolean,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation public.memory_promotion_operations;
  proposal public.memory_items;
  existing_fact public.business_facts;
  promoted_fact public.business_facts;
  request_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'item_id', p_item_id,
    'override_verified', p_override_verified
  )::text);
  response_payload jsonb;
  fact_changed boolean := false;
  overrode_verified boolean := false;
begin
  if p_organization_id is null
    or p_actor_id is null
    or p_item_id is null
    or p_override_verified is null
    or p_correlation_id is null
    or p_idempotency_key is null
    or pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) not between 1 and 200 then
    raise exception 'memory promotion input is invalid' using errcode = '23514';
  end if;

  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_role(
      p_organization_id,
      array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
    raise exception 'memory promotion is not authorized' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);

  insert into public.memory_promotion_operations (
    organization_id, idempotency_key, request_fingerprint, response
  ) values (
    p_organization_id, p_idempotency_key, request_fingerprint, '{}'::jsonb
  ) on conflict (organization_id, idempotency_key) do nothing;

  select * into operation
  from public.memory_promotion_operations stored_operation
  where stored_operation.organization_id = p_organization_id
    and stored_operation.idempotency_key = p_idempotency_key
  for update;

  if operation.request_fingerprint <> request_fingerprint then
    raise exception 'memory promotion idempotency key was reused with a different request'
      using errcode = '23505';
  end if;
  if operation.response <> '{}'::jsonb then
    -- The persisted response is stable. `replayed` is transient transport
    -- metadata so callers can suppress a duplicate best-effort event.
    return operation.response || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  select * into proposal
  from public.memory_items proposal
  where proposal.organization_id = p_organization_id
    and proposal.id = p_item_id
  for update;
  if not found then
    raise exception 'memory proposal was not found' using errcode = 'P0002';
  end if;
  if proposal.verification_state <> 'proposed' then
    raise exception 'memory proposal is no longer pending review' using errcode = '23505';
  end if;
  if proposal.sensitivity in ('confidential', 'customer_content')
    and not private.has_organization_role(
      p_organization_id,
      array['owner', 'admin']::public.organization_role[]
    ) then
    raise exception 'memory promotion is not authorized' using errcode = '42501';
  end if;

  if proposal.memory_type = 'fact_proposal' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      p_organization_id::text || ':' || coalesce(proposal.proposed_branch_id::text, '-')
        || ':' || proposal.proposed_fact_key,
      0
    ));

    select * into existing_fact
    from public.business_facts existing_fact
    where existing_fact.organization_id = p_organization_id
      and existing_fact.branch_id is not distinct from proposal.proposed_branch_id
      and existing_fact.fact_key = proposal.proposed_fact_key
    for update;

    if found and existing_fact.status = 'verified'
      and existing_fact.value is distinct from proposal.proposed_fact_value
      and not p_override_verified then
      raise exception 'memory promotion would overwrite a verified fact without an override'
        using errcode = '23505';
    end if;
    overrode_verified := found and existing_fact.status = 'verified'
      and existing_fact.value is distinct from proposal.proposed_fact_value
      and p_override_verified;

    if found then
      update public.business_facts
      set
        value = case
          when existing_fact.status = 'verified'
            and existing_fact.value is not distinct from proposal.proposed_fact_value
          then existing_fact.value else proposal.proposed_fact_value end,
        source = case
          when existing_fact.status = 'verified'
            and existing_fact.value is not distinct from proposal.proposed_fact_value
          then existing_fact.source else 'memory_fact_proposal' end,
        source_reference = case
          when existing_fact.status = 'verified'
            and existing_fact.value is not distinct from proposal.proposed_fact_value
          then existing_fact.source_reference else proposal.id::text end,
        status = 'verified'::public.digital_twin_fact_status,
        confidence = case
          when existing_fact.status = 'verified'
            and existing_fact.value is not distinct from proposal.proposed_fact_value
          then existing_fact.confidence else proposal.confidence end,
        last_verified_at = pg_catalog.now(),
        updated_by = p_actor_id
      where public.business_facts.organization_id = p_organization_id
        and public.business_facts.id = existing_fact.id
      returning * into promoted_fact;
      fact_changed := existing_fact.value is distinct from proposal.proposed_fact_value
        or existing_fact.status <> 'verified';
    else
      insert into public.business_facts (
        organization_id, branch_id, fact_key, value, source, source_reference,
        status, confidence, last_verified_at, created_by, updated_by
      ) values (
        p_organization_id, proposal.proposed_branch_id, proposal.proposed_fact_key,
        proposal.proposed_fact_value, 'memory_fact_proposal', proposal.id::text,
        'verified'::public.digital_twin_fact_status, proposal.confidence, pg_catalog.now(),
        p_actor_id, p_actor_id
      ) returning * into promoted_fact;
      fact_changed := true;
    end if;

    if coalesce(pg_catalog.current_setting('app.memory_promotion_force_failure', true), '') = 'true' then
      raise exception 'memory promotion forced failure' using errcode = 'P0001';
    end if;
  end if;

  update public.memory_items
  set
    verification_state = 'verified',
    verified_by = p_actor_id,
    verified_at = pg_catalog.now(),
    rejection_reason = null,
    embedding_status = case
      when proposal.memory_type = 'fact_proposal' then 'skipped' else embedding_status end
  where public.memory_items.organization_id = p_organization_id
    and public.memory_items.id = proposal.id;

  if proposal.memory_type = 'fact_proposal' then
    insert into public.audit_events (
      organization_id, event_name, actor_type, actor_id, entity_type, entity_id,
      correlation_id, payload
    ) values (
      p_organization_id, 'memory.fact_promoted', 'user', p_actor_id, 'business_facts',
      promoted_fact.id, p_correlation_id,
      pg_catalog.jsonb_build_object(
        'proposalId', proposal.id,
        'factId', promoted_fact.id,
        'overrodeVerified', overrode_verified,
        'factChanged', fact_changed
      )
    );
  end if;

  response_payload := pg_catalog.jsonb_build_object(
    'itemId', proposal.id,
    'factId', case when proposal.memory_type = 'fact_proposal' then promoted_fact.id else null end,
    'promoted', proposal.memory_type = 'fact_proposal',
    'factKey', case when proposal.memory_type = 'fact_proposal' then proposal.proposed_fact_key else null end,
    'branchScoped', proposal.proposed_branch_id is not null,
    'overrodeVerified', overrode_verified,
    'memoryType', proposal.memory_type,
    'origin', proposal.origin,
    'sensitivity', proposal.sensitivity,
    'verificationState', 'verified'
  );

  update public.memory_promotion_operations
  set response = response_payload
  where public.memory_promotion_operations.id = operation.id
    and public.memory_promotion_operations.organization_id = p_organization_id;

  return response_payload || pg_catalog.jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.confirm_memory_fact_proposal(
  uuid, uuid, uuid, boolean, text, uuid
) from public, anon;
grant execute on function public.confirm_memory_fact_proposal(
  uuid, uuid, uuid, boolean, text, uuid
) to authenticated;

-- An authenticated client may edit metadata on a memory item, but a proposal's
-- verification/rejection state is governed exclusively by the locked RPCs
-- below. This trigger remains useful defence in depth even if a future column
-- grant is accidentally widened.
create or replace function private.guard_authenticated_memory_item_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
    and old.memory_type = 'fact_proposal'
    and (
      new.verification_state is distinct from old.verification_state
      or new.verified_by is distinct from old.verified_by
      or new.verified_at is distinct from old.verified_at
      or new.rejection_reason is distinct from old.rejection_reason
      or new.embedding_status is distinct from old.embedding_status
    ) then
    raise exception 'memory_fact_proposal_transition_requires_governed_operation'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_authenticated_memory_item_transition() from public;

create trigger memory_items_guard_authenticated_transition
before update on public.memory_items
for each row execute function private.guard_authenticated_memory_item_transition();

create table public.memory_proposal_rejection_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  request_fingerprint text not null,
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

alter table public.memory_proposal_rejection_operations enable row level security;
alter table public.memory_proposal_rejection_operations force row level security;
revoke all on table public.memory_proposal_rejection_operations from public, anon, authenticated;

create or replace function public.reject_memory_proposal(
  p_organization_id uuid,
  p_actor_id uuid,
  p_item_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation public.memory_proposal_rejection_operations;
  proposal public.memory_items;
  request_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'item_id', p_item_id,
    'reason', p_reason
  )::text);
  response_payload jsonb;
begin
  if p_organization_id is null
    or p_actor_id is null
    or p_item_id is null
    or p_reason is null
    or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 500
    or p_idempotency_key is null
    or pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) not between 1 and 200
    or p_correlation_id is null then
    raise exception 'memory proposal rejection input is invalid' using errcode = '23514';
  end if;
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_role(
      p_organization_id,
      array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
    raise exception 'memory proposal rejection is not authorized' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);

  insert into public.memory_proposal_rejection_operations (
    organization_id, idempotency_key, request_fingerprint, response
  ) values (
    p_organization_id, p_idempotency_key, request_fingerprint, '{}'::jsonb
  ) on conflict (organization_id, idempotency_key) do nothing;

  select * into operation
  from public.memory_proposal_rejection_operations stored_operation
  where stored_operation.organization_id = p_organization_id
    and stored_operation.idempotency_key = p_idempotency_key
  for update;
  if operation.request_fingerprint <> request_fingerprint then
    raise exception 'memory proposal rejection idempotency key was reused with a different request'
      using errcode = '23505';
  end if;
  if operation.response <> '{}'::jsonb then
    -- Do not attribute a retry to a new actor or event ID.
    return operation.response || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  select * into proposal
  from public.memory_items proposal
  where proposal.organization_id = p_organization_id
    and proposal.id = p_item_id
  for update;
  if not found then
    raise exception 'memory proposal was not found' using errcode = 'P0002';
  end if;
  if proposal.verification_state <> 'proposed' then
    raise exception 'memory proposal is no longer pending review' using errcode = '23505';
  end if;
  if proposal.sensitivity in ('confidential', 'customer_content')
    and not private.has_organization_role(
      p_organization_id,
      array['owner', 'admin']::public.organization_role[]
    ) then
    raise exception 'memory proposal rejection is not authorized' using errcode = '42501';
  end if;

  update public.memory_items
  set
    verification_state = 'rejected',
    rejection_reason = pg_catalog.btrim(p_reason),
    embedding_status = 'skipped'
  where public.memory_items.organization_id = p_organization_id
    and public.memory_items.id = proposal.id
    and public.memory_items.verification_state = 'proposed';
  if not found then
    raise exception 'memory proposal is no longer pending review' using errcode = '23505';
  end if;

  response_payload := pg_catalog.jsonb_build_object(
    'itemId', proposal.id,
    'memoryType', proposal.memory_type,
    'origin', proposal.origin,
    'sensitivity', proposal.sensitivity,
    'verificationState', 'rejected'
  );
  update public.memory_proposal_rejection_operations
  set response = response_payload
  where public.memory_proposal_rejection_operations.id = operation.id
    and public.memory_proposal_rejection_operations.organization_id = p_organization_id;

  return response_payload || pg_catalog.jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.reject_memory_proposal(
  uuid, uuid, uuid, text, text, uuid
) from public, anon;
grant execute on function public.reject_memory_proposal(
  uuid, uuid, uuid, text, text, uuid
) to authenticated;
