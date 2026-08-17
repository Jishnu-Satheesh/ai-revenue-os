-- Govern browser-authored Memory writes through authenticated, idempotent RPCs.
-- `memory_write_operations` already owns the operation ledger; this migration
-- deliberately adds no table or RLS policy.

revoke insert, update on table public.memory_items from authenticated;

create or replace function private.audit_organization_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_row jsonb := '{}'::jsonb;
  old_row jsonb := '{}'::jsonb;
  target_organization_id uuid;
  target_entity_id uuid;
  target_event_name text;
  target_status text;
  target_actor_id uuid;
  target_actor_type public.audit_actor_type;
  target_correlation_id uuid;
begin
  if TG_OP <> 'DELETE' then new_row := pg_catalog.to_jsonb(new); end if;
  if TG_OP <> 'INSERT' then old_row := pg_catalog.to_jsonb(old); end if;
  target_organization_id := coalesce((new_row ->> 'organization_id')::uuid, (old_row ->> 'organization_id')::uuid, (new_row ->> 'id')::uuid, (old_row ->> 'id')::uuid);
  target_entity_id := coalesce((new_row ->> 'id')::uuid, (old_row ->> 'id')::uuid, target_organization_id);
  target_event_name := case
    when TG_TABLE_NAME = 'organizations' and TG_OP = 'INSERT' then 'organization.created'
    when TG_TABLE_NAME = 'branches' and TG_OP = 'INSERT' then 'branch.created'
    when TG_TABLE_NAME = 'business_profiles' then 'business_profile.updated'
    when TG_TABLE_NAME = 'business_facts' and new_row ->> 'status' = 'verified' then 'business_fact.verified'
    when TG_TABLE_NAME = 'business_facts' then 'business_fact.updated'
    when TG_TABLE_NAME = 'goals' and TG_OP = 'INSERT' then 'goal.created'
    when TG_TABLE_NAME = 'constraints' and TG_OP = 'INSERT' then 'constraint.created'
    when TG_TABLE_NAME = 'policies' then 'policy.updated'
    when TG_TABLE_NAME = 'memory_items' and TG_OP = 'INSERT' then 'memory.item_created'
    when TG_TABLE_NAME = 'memory_items' and new_row ->> 'superseded_by_id' is not null and old_row ->> 'superseded_by_id' is null then 'memory.item_superseded'
    when TG_TABLE_NAME = 'memory_items' and new_row ->> 'verification_state' = 'verified' and old_row ->> 'verification_state' is distinct from 'verified' then 'memory.item_verified'
    when TG_TABLE_NAME = 'memory_items' and new_row ->> 'verification_state' = 'rejected' and old_row ->> 'verification_state' is distinct from 'rejected' then 'memory.item_rejected'
    when TG_TABLE_NAME = 'memory_items' then 'memory.item_updated'
    else pg_catalog.lower(TG_TABLE_NAME || '.' || TG_OP)
  end;
  target_status := coalesce(new_row ->> 'status', old_row ->> 'status', new_row ->> 'verification_state', old_row ->> 'verification_state');
  target_actor_id := (select auth.uid());
  target_actor_type := case when target_actor_id is null then 'system' else 'user' end;
  target_correlation_id := nullif(pg_catalog.current_setting('app.correlation_id', true), '')::uuid;
  insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload)
  values (target_organization_id, target_event_name, target_actor_type, target_actor_id, TG_TABLE_NAME, target_entity_id, coalesce(target_correlation_id, gen_random_uuid()), pg_catalog.jsonb_build_object('operation', TG_OP, 'status', target_status));
  return new;
end;
$$;

create or replace function public.create_authenticated_memory_item(
  p_organization_id uuid, p_actor_id uuid, p_memory_type text, p_title text,
  p_body text, p_branch_id uuid, p_sensitivity text, p_mark_verified boolean,
  p_review_due_at timestamptz, p_expires_at timestamptz, p_idempotency_key text,
  p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  operation public.memory_write_operations;
  created public.memory_items;
  replayed_item_id uuid;
  claimed_operation boolean := false;
  request_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'operation', 'create', 'memory_type', p_memory_type, 'title', p_title, 'body', p_body,
    'branch_id', p_branch_id, 'sensitivity', p_sensitivity, 'mark_verified', p_mark_verified,
    'review_due_at', p_review_due_at, 'expires_at', p_expires_at
  )::text);
  response_payload jsonb;
begin
  if p_organization_id is null or p_actor_id is null or p_memory_type not in ('note', 'document')
    or p_title is null or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 1 and 300
    or (p_body is not null and pg_catalog.char_length(p_body) > 8000)
    or p_sensitivity not in ('public', 'internal', 'confidential', 'customer_content')
    or p_mark_verified is null or p_correlation_id is null or p_idempotency_key is null
    or pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) not between 1 and 200 then
    raise exception 'memory write input is invalid' using errcode = '23514';
  end if;
  if (select auth.uid()) <> p_actor_id or not private.has_organization_role(p_organization_id, array['owner', 'admin', 'operator']::public.organization_role[])
    or (p_sensitivity in ('confidential', 'customer_content') and not private.has_organization_role(p_organization_id, array['owner', 'admin']::public.organization_role[])) then
    raise exception 'memory write is not authorized' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);
  insert into public.memory_write_operations (organization_id, idempotency_key, request_fingerprint, response)
  values (p_organization_id, p_idempotency_key, request_fingerprint, '{}'::jsonb)
  on conflict (organization_id, idempotency_key) do nothing
  returning true into claimed_operation;
  select * into operation from public.memory_write_operations stored_operation
  where stored_operation.organization_id = p_organization_id and stored_operation.idempotency_key = p_idempotency_key for update;
  if operation.request_fingerprint <> request_fingerprint then raise exception 'memory write idempotency key was reused with a different request' using errcode = '23505'; end if;
  if operation.response = '{}'::jsonb and not coalesce(claimed_operation, false) then
    raise exception 'memory write operation is incomplete' using errcode = '23505';
  end if;
  if operation.response <> '{}'::jsonb then
    if not (operation.response ? 'item') or not ((operation.response -> 'item') ? 'id') then
      raise exception 'memory write replay response is invalid' using errcode = '23505';
    end if;
    replayed_item_id := (operation.response -> 'item' ->> 'id')::uuid;
    select * into created from public.memory_items item
    where item.organization_id = p_organization_id and item.id = replayed_item_id for update;
    if not found then raise exception 'memory write replay response is invalid' using errcode = '23505'; end if;
    if created.sensitivity in ('confidential', 'customer_content') and not private.has_organization_role(p_organization_id, array['owner', 'admin']::public.organization_role[]) then
      raise exception 'memory write replay is not authorized' using errcode = '42501';
    end if;
    return operation.response || pg_catalog.jsonb_build_object('replayed', true);
  end if;
  insert into public.memory_items (organization_id, branch_id, memory_type, title, body, origin, sensitivity, verification_state, review_due_at, expires_at, created_by, verified_by, verified_at)
  values (p_organization_id, p_branch_id, p_memory_type, pg_catalog.btrim(p_title), p_body, 'user_verified', p_sensitivity, case when p_mark_verified then 'verified' else 'unverified' end, p_review_due_at, p_expires_at, p_actor_id, case when p_mark_verified then p_actor_id end, case when p_mark_verified then pg_catalog.now() end)
  returning * into created;
  response_payload := pg_catalog.jsonb_build_object('item', pg_catalog.to_jsonb(created) - 'embedding' - 'search_vector');
  update public.memory_write_operations set response = response_payload where id = operation.id and organization_id = p_organization_id;
  return response_payload || pg_catalog.jsonb_build_object('replayed', false);
end;
$$;

create or replace function public.update_authenticated_memory_item(
  p_organization_id uuid, p_actor_id uuid, p_item_id uuid, p_action text, p_reason text,
  p_sensitivity text, p_review_due_at timestamptz, p_set_review_due_at boolean,
  p_idempotency_key text, p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  operation public.memory_write_operations;
  updated public.memory_items;
  claimed_operation boolean := false;
  request_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'operation', 'update', 'item_id', p_item_id, 'action', p_action, 'reason', p_reason,
    'sensitivity', p_sensitivity, 'review_due_at', p_review_due_at, 'set_review_due_at', p_set_review_due_at
  )::text);
  response_payload jsonb;
begin
  if p_organization_id is null or p_actor_id is null or p_item_id is null or p_action not in ('verify', 'reject', 'reclassify')
    or (p_action = 'reject' and (p_reason is null or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 500))
    or (p_sensitivity is not null and p_sensitivity not in ('public', 'internal', 'confidential', 'customer_content'))
    or p_set_review_due_at is null or p_correlation_id is null or p_idempotency_key is null
    or pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) not between 1 and 200 then
    raise exception 'memory write input is invalid' using errcode = '23514';
  end if;
  if (select auth.uid()) <> p_actor_id or not private.has_organization_role(p_organization_id, array['owner', 'admin', 'operator']::public.organization_role[]) then
    raise exception 'memory write is not authorized' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);
  insert into public.memory_write_operations (organization_id, idempotency_key, request_fingerprint, response)
  values (p_organization_id, p_idempotency_key, request_fingerprint, '{}'::jsonb)
  on conflict (organization_id, idempotency_key) do nothing
  returning true into claimed_operation;
  select * into operation from public.memory_write_operations stored_operation
  where stored_operation.organization_id = p_organization_id and stored_operation.idempotency_key = p_idempotency_key for update;
  if operation.request_fingerprint <> request_fingerprint then raise exception 'memory write idempotency key was reused with a different request' using errcode = '23505'; end if;
  if operation.response = '{}'::jsonb and not coalesce(claimed_operation, false) then
    raise exception 'memory write operation is incomplete' using errcode = '23505';
  end if;
  select * into updated from public.memory_items item where item.organization_id = p_organization_id and item.id = p_item_id for update;
  if not found then raise exception 'memory item was not found' using errcode = 'P0002'; end if;
  if operation.response <> '{}'::jsonb then
    if not coalesce(
      pg_catalog.jsonb_typeof(operation.response -> 'item') = 'object'
      and pg_catalog.jsonb_typeof(operation.response -> 'item' -> 'id') = 'string'
      and operation.response -> 'item' ->> 'id' = p_item_id::text
      and pg_catalog.jsonb_typeof(operation.response -> 'item' -> 'organization_id') = 'string'
      and operation.response -> 'item' ->> 'organization_id' = p_organization_id::text
      and pg_catalog.jsonb_typeof(operation.response -> 'item' -> 'sensitivity') = 'string'
      and operation.response -> 'item' ->> 'sensitivity' in ('public', 'internal', 'confidential', 'customer_content'),
      false
    ) then
      raise exception 'memory write replay response is invalid' using errcode = '23505';
    end if;
    if (
      p_sensitivity in ('confidential', 'customer_content')
      or operation.response -> 'item' ->> 'sensitivity' in ('confidential', 'customer_content')
    ) and not private.has_organization_role(p_organization_id, array['owner', 'admin']::public.organization_role[]) then
      raise exception 'memory write replay is not authorized' using errcode = '42501';
    end if;
    if updated.sensitivity in ('confidential', 'customer_content') and not private.has_organization_role(p_organization_id, array['owner', 'admin']::public.organization_role[]) then
      raise exception 'memory write replay is not authorized' using errcode = '42501';
    end if;
    return operation.response || pg_catalog.jsonb_build_object('replayed', true);
  end if;
  -- Proposal terminal transitions belong exclusively to the Task 10 governed
  -- confirmation/rejection RPCs. SECURITY DEFINER would otherwise bypass the
  -- authenticated-only trigger guard below the table.
  if updated.memory_type = 'fact_proposal' then raise exception 'fact proposals require their governed operation' using errcode = '23505'; end if;
  if updated.superseded_by_id is not null then raise exception 'memory item is superseded' using errcode = '23505'; end if;
  if updated.sensitivity in ('confidential', 'customer_content') and not private.has_organization_role(p_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'memory write is not authorized' using errcode = '42501'; end if;
  if p_sensitivity in ('confidential', 'customer_content') and not private.has_organization_role(p_organization_id, array['owner', 'admin']::public.organization_role[]) then raise exception 'memory write is not authorized' using errcode = '42501'; end if;
  update public.memory_items set
    verification_state = case when p_action = 'verify' then 'verified' when p_action = 'reject' then 'rejected' else verification_state end,
    verified_by = case when p_action = 'verify' then p_actor_id else verified_by end,
    verified_at = case when p_action = 'verify' then pg_catalog.now() else verified_at end,
    rejection_reason = case when p_action = 'verify' then null when p_action = 'reject' then pg_catalog.btrim(p_reason) else rejection_reason end,
    embedding_status = case when p_action = 'reject' then 'skipped' else embedding_status end,
    sensitivity = coalesce(p_sensitivity, sensitivity),
    review_due_at = case when p_set_review_due_at then p_review_due_at else review_due_at end
  where organization_id = p_organization_id and id = p_item_id returning * into updated;
  response_payload := pg_catalog.jsonb_build_object('item', pg_catalog.to_jsonb(updated) - 'embedding' - 'search_vector');
  update public.memory_write_operations set response = response_payload where id = operation.id and organization_id = p_organization_id;
  return response_payload || pg_catalog.jsonb_build_object('replayed', false);
end;
$$;

-- The previous eight-argument function remains only as an inert overload. A
-- browser cannot bypass replay/correlation enforcement through it.
revoke all on function public.supersede_memory_item(uuid, uuid, uuid, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.supersede_memory_item(
  p_organization_id uuid, p_actor_id uuid, p_item_id uuid, p_title text, p_body text,
  p_sensitivity text, p_supersession_reason text, p_idempotency_key text, p_correlation_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  operation public.memory_write_operations;
  original public.memory_items;
  replacement public.memory_items;
  replay_replacement public.memory_items;
  replay_replacement_id uuid;
  claimed_operation boolean := false;
  request_fingerprint text := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'operation', 'supersede', 'item_id', p_item_id, 'title', p_title, 'body', p_body,
    'sensitivity', p_sensitivity, 'reason', p_supersession_reason
  )::text);
  legacy_fingerprint text := pg_catalog.encode(extensions.digest(pg_catalog.concat_ws('|', p_item_id::text, p_title, coalesce(p_body, ''), p_sensitivity), 'sha256'), 'hex');
  response_payload jsonb;
begin
  if p_organization_id is null or p_actor_id is null or p_item_id is null or p_title is null
    or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 1 and 300
    or (p_body is not null and pg_catalog.char_length(p_body) > 8000)
    or p_sensitivity not in ('public', 'internal', 'confidential', 'customer_content')
    or p_supersession_reason is null or pg_catalog.char_length(pg_catalog.btrim(p_supersession_reason)) not between 1 and 500
    or p_correlation_id is null or p_idempotency_key is null or pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) not between 1 and 200 then raise exception 'memory write input is invalid' using errcode = '23514'; end if;
  if (select auth.uid()) <> p_actor_id or not private.has_organization_role(p_organization_id, array['owner', 'admin', 'operator']::public.organization_role[])
    or (p_sensitivity in ('confidential', 'customer_content') and not private.has_organization_role(p_organization_id, array['owner', 'admin']::public.organization_role[])) then raise exception 'memory write is not authorized' using errcode = '42501'; end if;
  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);
  insert into public.memory_write_operations (organization_id, idempotency_key, request_fingerprint, response)
  values (p_organization_id, p_idempotency_key, request_fingerprint, '{}'::jsonb)
  on conflict (organization_id, idempotency_key) do nothing
  returning true into claimed_operation;
  select * into operation from public.memory_write_operations stored_operation where stored_operation.organization_id = p_organization_id and stored_operation.idempotency_key = p_idempotency_key for update;
  if operation.response = '{}'::jsonb and not coalesce(claimed_operation, false) then
    raise exception 'memory write operation is incomplete' using errcode = '23505';
  end if;
  select * into original from public.memory_items item where item.organization_id = p_organization_id and item.id = p_item_id for update;
  if not found then raise exception 'memory item was not found' using errcode = 'P0002'; end if;
  if original.sensitivity in ('confidential', 'customer_content') and not private.has_organization_role(p_organization_id, array['owner', 'admin']::public.organization_role[]) then
    if operation.response <> '{}'::jsonb then raise exception 'memory write replay is not authorized' using errcode = '42501'; end if;
    raise exception 'memory write is not authorized' using errcode = '42501';
  end if;
  if operation.response <> '{}'::jsonb then
    if not (operation.response ? 'replacementId') then raise exception 'memory write replay response is invalid' using errcode = '23505'; end if;
    replay_replacement_id := (operation.response ->> 'replacementId')::uuid;
    select * into replay_replacement from public.memory_items item
    where item.organization_id = p_organization_id and item.id = replay_replacement_id for update;
    if not found then raise exception 'memory write replay response is invalid' using errcode = '23505'; end if;
    if replay_replacement.sensitivity in ('confidential', 'customer_content') and not private.has_organization_role(p_organization_id, array['owner', 'admin']::public.organization_role[]) then
      raise exception 'memory write replay is not authorized' using errcode = '42501';
    end if;
  end if;
  if operation.response ? 'fingerprint' then
    -- Before this migration, supersession persisted a SHA-256 fingerprint in
    -- its response and omitted the reason. Accept only a record whose stored
    -- request and response fingerprints both match the legacy request shape.
    if operation.request_fingerprint = legacy_fingerprint
      and operation.response ->> 'fingerprint' = legacy_fingerprint
      and operation.response ?& array['replacementId', 'supersededId'] then
      return pg_catalog.jsonb_build_object(
        'replacementId', operation.response ->> 'replacementId',
        'supersededId', operation.response ->> 'supersededId',
        'replayed', true
      );
    end if;
    raise exception 'memory write idempotency key was reused with a different request' using errcode = '23505';
  end if;
  if operation.request_fingerprint <> request_fingerprint then raise exception 'memory write idempotency key was reused with a different request' using errcode = '23505'; end if;
  if operation.response <> '{}'::jsonb then return operation.response || pg_catalog.jsonb_build_object('replayed', true); end if;
  if original.superseded_by_id is not null then raise exception 'memory item is already superseded' using errcode = '23505'; end if;
  insert into public.memory_items (organization_id, branch_id, memory_type, title, body, structured_value, origin, sensitivity, verification_state, created_by, verified_by, verified_at)
  values (p_organization_id, original.branch_id, original.memory_type, pg_catalog.btrim(p_title), p_body, original.structured_value, 'user_verified', p_sensitivity, 'verified', p_actor_id, p_actor_id, pg_catalog.now()) returning * into replacement;
  update public.memory_items set superseded_by_id = replacement.id, superseded_at = pg_catalog.now(), supersession_reason = pg_catalog.btrim(p_supersession_reason), embedding_status = 'skipped' where organization_id = p_organization_id and id = p_item_id;
  insert into public.memory_links (organization_id, from_item_id, to_item_id, relation, created_by) values (p_organization_id, replacement.id, p_item_id, 'supports', p_actor_id) on conflict do nothing;
  response_payload := pg_catalog.jsonb_build_object('replacementId', replacement.id, 'supersededId', p_item_id);
  update public.memory_write_operations set response = response_payload where id = operation.id and organization_id = p_organization_id;
  return response_payload || pg_catalog.jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.create_authenticated_memory_item(uuid, uuid, text, text, text, uuid, text, boolean, timestamptz, timestamptz, text, uuid) from public, anon, authenticated;
revoke all on function public.update_authenticated_memory_item(uuid, uuid, uuid, text, text, text, timestamptz, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.supersede_memory_item(uuid, uuid, uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_authenticated_memory_item(uuid, uuid, text, text, text, uuid, text, boolean, timestamptz, timestamptz, text, uuid) to authenticated;
grant execute on function public.update_authenticated_memory_item(uuid, uuid, uuid, text, text, text, timestamptz, boolean, text, uuid) to authenticated;
grant execute on function public.supersede_memory_item(uuid, uuid, uuid, text, text, text, text, text, uuid) to authenticated;
