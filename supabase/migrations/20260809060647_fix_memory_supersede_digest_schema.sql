-- `digest` is a pgcrypto function installed in the `extensions` schema, not a
-- pg_catalog builtin. With `set search_path = ''` the original qualification
-- resolved to nothing, so supersede_memory_item failed on its first real call.
-- `encode`, `concat_ws`, `cardinality`, and `count` are genuine pg_catalog
-- builtins and are left as they are.
--
-- supabase/tests/database/business_memory_write_test.sql now calls the function
-- rather than only inspecting it, because a schema-qualification bug inside a
-- plpgsql body is invisible until execution.

create or replace function public.supersede_memory_item(
  p_organization_id uuid,
  p_actor_id uuid,
  p_item_id uuid,
  p_title text,
  p_body text,
  p_sensitivity text,
  p_supersession_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing jsonb;
  original public.memory_items;
  replacement public.memory_items;
  fingerprint text;
  result jsonb;
begin
  if not private.has_organization_role(
    p_organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  ) then
    raise exception 'memory_authorization_denied' using errcode = '42501';
  end if;

  fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.concat_ws('|', p_item_id::text, p_title, coalesce(p_body, ''), p_sensitivity),
      'sha256'
    ),
    'hex'
  );

  select operation.response into existing
  from public.memory_write_operations operation
  where operation.organization_id = p_organization_id
    and operation.idempotency_key = p_idempotency_key;

  if existing is not null then
    if existing ->> 'fingerprint' is distinct from fingerprint then
      raise exception 'memory_idempotency_conflict' using errcode = '23505';
    end if;
    return existing;
  end if;

  select * into original
  from public.memory_items item
  where item.organization_id = p_organization_id
    and item.id = p_item_id
  for update;

  if original.id is null then
    raise exception 'memory_item_not_found' using errcode = 'P0002';
  end if;
  if original.superseded_by_id is not null then
    raise exception 'memory_already_superseded' using errcode = '23505';
  end if;

  insert into public.memory_items (
    organization_id, branch_id, memory_type, title, body, structured_value,
    origin, sensitivity, verification_state, created_by, verified_by, verified_at
  )
  values (
    p_organization_id, original.branch_id, original.memory_type, p_title, p_body,
    original.structured_value, 'user_verified', p_sensitivity, 'verified',
    p_actor_id, p_actor_id, pg_catalog.now()
  )
  returning * into replacement;

  update public.memory_items
  set superseded_by_id = replacement.id,
      superseded_at = pg_catalog.now(),
      supersession_reason = p_supersession_reason,
      embedding_status = 'skipped'
  where organization_id = p_organization_id
    and id = p_item_id;

  insert into public.memory_links (organization_id, from_item_id, to_item_id, relation, created_by)
  values (p_organization_id, replacement.id, p_item_id, 'supports', p_actor_id)
  on conflict do nothing;

  result := pg_catalog.jsonb_build_object(
    'fingerprint', fingerprint,
    'replacementId', replacement.id,
    'supersededId', p_item_id
  );

  insert into public.memory_write_operations (
    organization_id, idempotency_key, request_fingerprint, response
  )
  values (p_organization_id, p_idempotency_key, fingerprint, result);

  return result;
end;
$$;
