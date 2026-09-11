-- Spec 023 Task B: capture-dispatch cursor plus reconcile power. The queue,
-- leased runtime, and three Channel adapters are live; nothing pumps the
-- queue yet. The Trigger pump (dispatch every minute, reconcile every
-- fifteen) arrives in TypeScript alongside this migration. This file teaches
-- Postgres what the pump cannot do for itself:
--
-- 1. Persist one opaque per-adapter reconcile cursor per organization without
--    ever flipping a capture/context flag.
-- 2. Rotate reconcile fairly across organizations: a nullable
--    reconcile_org_cursor (last fully-reconciled org) with wrap-around, so a
--    fixed top-N scan can never starve org N+1.
-- 3. Replay Channel sources through three thin PUBLIC service-only wrapper
--    RPCs over the existing private enqueue helpers. The wrappers follow the
--    established fenced-RPC pattern (security definer, empty search_path,
--    per-function service_role-only grants) because private-schema PostgREST
--    calls are dead: schema exposure is platform config no migration
--    controls, and service-wide USAGE would expose every private helper
--    (controller ruling, fix round 1). Redelivery stays harmless under the
--    per-revision unique indexes.
--
-- The three helper signatures below were read from their own migration files
-- (20260911112812, 20260911112817, 20260911112823); all three take
-- (uuid, uuid), so no reality mismatch to report.

-- Rotation state: last fully-reconciled organization -------------------------------
--
-- One nullable uuid per settings row, written by the worker RPC below after
-- each fully-reconciled org. The reconcile scan resumes after the freshest
-- value with wrap-around. A plain uuid with no FK: it is an opaque rotation
-- marker the worker rewrites every pass, never a reference the database must
-- defend (the referenced org may since have been disabled or removed, in
-- which case the scan restarts from the beginning).

alter table public.memory_integration_settings
  add column reconcile_org_cursor uuid;

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

-- Reconcile-org cursor: worker-only rotation marker --------------------------------
--
-- Marks an organization fully reconciled by writing its own id. Creates the
-- row disabled-defaults when absent, exactly like the adapter-cursor RPC, so
-- rotation bookkeeping can never enable capture or context either.

create or replace function public.update_memory_reconcile_org_cursor(
  p_organization_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cursor uuid;
begin
  if p_organization_id is null or p_correlation_id is null then
    raise exception 'memory reconcile organization cursor input is invalid' using errcode = '23514';
  end if;

  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);

  insert into public.memory_integration_settings (organization_id, reconcile_org_cursor)
  values (p_organization_id, p_organization_id)
  on conflict (organization_id) do update set
    reconcile_org_cursor = excluded.reconcile_org_cursor
  returning memory_integration_settings.reconcile_org_cursor into v_cursor;

  return pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'reconcileOrgCursor', v_cursor
  );
end;
$$;

revoke all on function public.update_memory_reconcile_org_cursor(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.update_memory_reconcile_org_cursor(uuid, uuid)
  to service_role;

-- Reconcile power: the worker may call the Channel enqueue helpers --------------
--
-- Exactly these three, exactly service_role. The private EXECUTE grants below
-- stay as depth (the source transactions' own path is untouched), but nothing
-- calls through schema('private') from PostgREST: the three thin public
-- wrappers are the worker's only path, each strict on nulls, each revoked
-- from every session role and granted to service_role only. No member path
-- exists for any RPC in this file, and no schema-level grant of any kind.

create or replace function public.reconcile_memory_channel_findings(
  p_organization_id uuid,
  p_analysis_run_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or p_analysis_run_id is null then
    raise exception 'memory reconcile findings input is invalid' using errcode = '23514';
  end if;
  return private.enqueue_memory_channel_findings(p_organization_id, p_analysis_run_id);
end;
$$;

revoke all on function public.reconcile_memory_channel_findings(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_memory_channel_findings(uuid, uuid)
  to service_role;

create or replace function public.reconcile_memory_channel_recommendations(
  p_organization_id uuid,
  p_analysis_run_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or p_analysis_run_id is null then
    raise exception 'memory reconcile recommendations input is invalid' using errcode = '23514';
  end if;
  return private.enqueue_memory_channel_recommendations(p_organization_id, p_analysis_run_id);
end;
$$;

revoke all on function public.reconcile_memory_channel_recommendations(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_memory_channel_recommendations(uuid, uuid)
  to service_role;

create or replace function public.reconcile_memory_channel_decision(
  p_organization_id uuid,
  p_decision_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or p_decision_id is null then
    raise exception 'memory reconcile decision input is invalid' using errcode = '23514';
  end if;
  return private.enqueue_memory_channel_decision(p_organization_id, p_decision_id);
end;
$$;

revoke all on function public.reconcile_memory_channel_decision(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_memory_channel_decision(uuid, uuid)
  to service_role;

grant execute on function private.enqueue_memory_channel_findings(uuid, uuid)
  to service_role;
grant execute on function private.enqueue_memory_channel_recommendations(uuid, uuid)
  to service_role;
grant execute on function private.enqueue_memory_channel_decision(uuid, uuid)
  to service_role;
