-- Forward fix for create_agent_thread_keyed: nullif is not a pg_catalog function.
--
-- The 20260926120000 repair fixed the (text, unknown) overload error, but
-- `nullif` is a parser construct, not a real pg_catalog function, so ANY
-- schema-qualified call fails with "function pg_catalog.nullif(text, text)
-- does not exist" on first real invocation. The precedent repair
-- (20260923141000_public_leads_nullif_fix) uses the UNQUALIFIED form, which
-- the parser rewrites to CASE and which works under `set search_path = ''`.
-- The body below is otherwise identical to 20260926120000.

create or replace function public.create_agent_thread_keyed(
  p_organization_id uuid,
  p_actor_id uuid,
  p_idempotency_key text,
  p_title text,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  key_row public.agent_thread_create_keys;
  kept public.agent_threads;
  created public.agent_threads;
  clean_title text;
  body_digest text;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_role(
        p_organization_id,
        array['owner', 'admin', 'operator']::public.organization_role[]
      )
    ) then
    raise exception 'agent_thread_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_actor_id is null
    or p_idempotency_key is null
    or p_idempotency_key is distinct from pg_catalog.btrim(p_idempotency_key)
    or pg_catalog.char_length(p_idempotency_key) not between 1 and 200
    or p_mode not in ('quick', 'deepthink') then
    raise exception 'agent_thread_invalid' using errcode = '22023';
  end if;
  clean_title := nullif(pg_catalog.btrim(coalesce(p_title, '')), ''::text);
  if clean_title is null then
    clean_title := 'New chat';
  elsif pg_catalog.char_length(clean_title) > 200 then
    raise exception 'agent_thread_invalid' using errcode = '22023';
  end if;

  -- The digest pins the creation body to the key: same key plus same body
  -- replays, same key plus another body is a conflict.
  body_digest := pg_catalog.md5(pg_catalog.concat_ws(
    '|', p_organization_id::text, clean_title, p_mode
  ));

  -- One serialized create per key, so twin sends converge instead of
  -- minting twin threads.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'agent', 'create_thread_keyed',
      p_organization_id, p_idempotency_key
    ),
    0
  ));

  select key_entry.* into key_row
  from public.agent_thread_create_keys key_entry
  where key_entry.organization_id = p_organization_id
    and key_entry.idempotency_key = p_idempotency_key
  for update;
  if found then
    if key_row.body_digest is distinct from body_digest then
      raise exception 'agent_thread_key_conflict' using errcode = '23505';
    end if;
    select thread.* into kept
    from public.agent_threads thread
    where thread.organization_id = p_organization_id
      and thread.id = key_row.thread_id;
    return pg_catalog.jsonb_build_object(
      'threadId', kept.id,
      'status', kept.status,
      'replayed', true
    );
  end if;

  insert into public.agent_threads (
    organization_id, title, mode, created_by
  ) values (
    p_organization_id, clean_title, p_mode, p_actor_id
  ) returning * into created;

  insert into public.agent_thread_create_keys (
    organization_id, idempotency_key, thread_id, body_digest, created_by
  ) values (
    p_organization_id, p_idempotency_key, created.id, body_digest, p_actor_id
  );

  return pg_catalog.jsonb_build_object(
    'threadId', created.id,
    'status', created.status,
    'replayed', false
  );
end;
$$;
