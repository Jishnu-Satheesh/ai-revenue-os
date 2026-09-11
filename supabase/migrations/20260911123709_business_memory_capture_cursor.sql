-- Spec 023 Task B: capture-dispatch cursor plus reconcile power. The queue,
-- leased runtime, and three Channel adapters are live; nothing pumps the
-- queue yet. The Trigger pump (dispatch every minute, reconcile every
-- fifteen) arrives in TypeScript alongside this migration. This file only
-- teaches Postgres two things the pump cannot do for itself:
--
-- 1. Persist one opaque per-adapter reconcile cursor per organization without
--    ever flipping a capture/context flag.
-- 2. Let the service-role worker execute the three existing Channel enqueue
--    helpers directly, so reconcile reuses the exact code the source
--    transactions run. No public wrapper: a second call path would add
--    surface for no gain, and redelivery stays harmless under the
--    per-revision unique indexes.
--
-- The three helper signatures below were read from their own migration files
-- (20260911112812, 20260911112817, 20260911112823); all three take
-- (uuid, uuid), so no reality mismatch to report.

-- Cursor write: worker-only, one column per call --------------------------------
--
-- The adapter vocabulary is closed: 'channel', 'growth', or 'campaign'. When
-- the organization has no settings row yet, a disabled-defaults row is
-- created first, so cursor progress can never enable capture or context as a
-- side effect. Only the matching cursor column is written; every flag keeps
-- whatever it had (or its disabled default on first write).

create or replace function public.update_memory_capture_cursor(
  p_organization_id uuid,
  p_adapter text,
  p_cursor text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.memory_integration_settings;
begin
  if p_organization_id is null
    or p_adapter is null
    or p_adapter not in ('channel', 'growth', 'campaign')
    or p_cursor is null
    or pg_catalog.char_length(p_cursor) not between 1 and 200
    or p_correlation_id is null then
    raise exception 'memory capture cursor input is invalid' using errcode = '23514';
  end if;

  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);

  insert into public.memory_integration_settings (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  case p_adapter
    when 'channel' then
      update public.memory_integration_settings
      set channel_cursor = p_cursor
      where memory_integration_settings.organization_id = p_organization_id
      returning * into v_settings;
    when 'growth' then
      update public.memory_integration_settings
      set growth_cursor = p_cursor
      where memory_integration_settings.organization_id = p_organization_id
      returning * into v_settings;
    when 'campaign' then
      update public.memory_integration_settings
      set campaign_cursor = p_cursor
      where memory_integration_settings.organization_id = p_organization_id
      returning * into v_settings;
  end case;

  return pg_catalog.jsonb_build_object(
    'organizationId', v_settings.organization_id,
    'adapter', p_adapter,
    'cursor', p_cursor
  );
end;
$$;

revoke all on function public.update_memory_capture_cursor(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.update_memory_capture_cursor(uuid, text, text, uuid)
  to service_role;

-- Reconcile power: the worker may call the Channel enqueue helpers --------------
--
-- Exactly these three, exactly service_role. No member path exists for the
-- cursor RPC, and nothing else is granted here.

grant execute on function private.enqueue_memory_channel_findings(uuid, uuid)
  to service_role;
grant execute on function private.enqueue_memory_channel_recommendations(uuid, uuid)
  to service_role;
grant execute on function private.enqueue_memory_channel_decision(uuid, uuid)
  to service_role;
