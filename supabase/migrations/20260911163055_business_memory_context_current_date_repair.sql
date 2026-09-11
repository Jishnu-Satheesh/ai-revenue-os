-- Forward repair for 20260911144805 / 20260911162003 (Spec 023 Task C, fix round 5).
--
-- CURRENT_DATE is a SQL keyword, not a function: pg_catalog.current_date
-- parses as table.column and aborts 42P01 at first execution of the fact
-- branch. private.resolve_memory_context_source is recreated here with a
-- body identical except pg_catalog.current_date -> CURRENT_DATE. Every other
-- pg_catalog.X in these files was audited and is a real function
-- (jsonb_build_object, array_agg, count, cardinality, left, char_length,
-- encode, unnest, jsonb_typeof, now, jsonb_array_length, chr, lpad,
-- jsonb_array_elements_text, set_config, octet_length, jsonb_object_keys,
-- jsonb_object_agg). Grants untouched.

create or replace function private.resolve_memory_context_source(
  p_organization_id uuid,
  p_source_kind text,
  p_source_id uuid,
  out v_summary text,
  out v_revision bigint,
  out v_digest text,
  out v_status text,
  out v_exclusion text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.memory_items;
  v_event public.memory_capture_events;
  v_fact public.business_facts;
  v_profile public.business_profiles;
  v_goal public.goals;
  v_constraint public.constraints;
  v_version public.campaign_bundle_versions;
begin
  v_summary := null;
  v_revision := null;
  v_digest := null;
  v_status := 'unknown';
  v_exclusion := 'UNKNOWN_SOURCE';

  case p_source_kind
    when 'memory_item' then
      select * into v_item
      from public.memory_items stored_item
      where stored_item.organization_id = p_organization_id
        and stored_item.id = p_source_id;
      if not found then
        return;
      end if;
      if v_item.superseded_by_id is not null then
        v_status := 'revoked';
        v_exclusion := 'SUPERSEDED';
        return;
      end if;
      if v_item.expires_at is not null and v_item.expires_at <= pg_catalog.now() then
        v_status := 'revoked';
        v_exclusion := 'EXPIRED';
        return;
      end if;
      if v_item.sensitivity not in ('public', 'internal') then
        v_status := 'revoked';
        v_exclusion := 'SENSITIVITY_BLOCKED';
        return;
      end if;
      if v_item.verification_state in ('proposed', 'rejected') then
        v_status := 'revoked';
        v_exclusion := 'RIGHTS_DENIED';
        return;
      end if;
      v_summary := pg_catalog.left(
        v_item.title || coalesce(pg_catalog.chr(10) || v_item.body, ''), 600
      );
      v_status := 'ok';
      v_exclusion := null;
    when 'capture_event' then
      select * into v_event
      from public.memory_capture_events stored_event
      where stored_event.organization_id = p_organization_id
        and stored_event.id = p_source_id;
      if not found then
        return;
      end if;
      if v_event.projection_document = '{}'::jsonb then
        v_status := 'revoked';
        v_exclusion := 'WITHDRAWN';
        return;
      end if;
      if v_event.reuse_class = 'denied' then
        v_status := 'revoked';
        v_exclusion := 'RIGHTS_DENIED';
        return;
      end if;
      if v_event.sensitivity not in ('public', 'internal') then
        v_status := 'revoked';
        v_exclusion := 'SENSITIVITY_BLOCKED';
        return;
      end if;
      v_summary := pg_catalog.left(v_event.projection_document::text, 600);
      v_revision := v_event.source_revision;
      v_status := 'ok';
      v_exclusion := null;
    when 'business_fact' then
      select * into v_fact
      from public.business_facts stored_fact
      where stored_fact.organization_id = p_organization_id
        and stored_fact.id = p_source_id;
      if not found then
        return;
      end if;
      if v_fact.effective_to is not null and v_fact.effective_to < CURRENT_DATE then
        v_status := 'revoked';
        v_exclusion := 'EXPIRED';
        return;
      end if;
      v_summary := pg_catalog.left(
        v_fact.fact_key || ' [' || v_fact.status || '] ' || coalesce(v_fact.source, '')
          || ' :: ' || pg_catalog.left(v_fact.value::text, 200),
        600
      );
      v_status := 'ok';
      v_exclusion := null;
    when 'business_profile' then
      -- Profiles have no id column: the profile identity is the organization.
      if p_source_id is distinct from p_organization_id then
        return;
      end if;
      select * into v_profile
      from public.business_profiles stored_profile
      where stored_profile.organization_id = p_organization_id;
      if not found then
        return;
      end if;
      v_summary := pg_catalog.left(
        coalesce(v_profile.business_model, '') || pg_catalog.chr(10)
          || coalesce(v_profile.value_proposition, ''),
        600
      );
      v_status := 'ok';
      v_exclusion := null;
    when 'goal' then
      select * into v_goal
      from public.goals stored_goal
      where stored_goal.organization_id = p_organization_id
        and stored_goal.id = p_source_id;
      if not found then
        return;
      end if;
      v_summary := pg_catalog.left(
        v_goal.name || ' [' || v_goal.metric || '] target '
          || v_goal.target_value::text || ' ' || v_goal.unit,
        600
      );
      v_status := 'ok';
      v_exclusion := null;
    when 'constraint' then
      select * into v_constraint
      from public.constraints stored_constraint
      where stored_constraint.organization_id = p_organization_id
        and stored_constraint.id = p_source_id;
      if not found then
        return;
      end if;
      if not v_constraint.is_active then
        v_status := 'revoked';
        v_exclusion := 'WITHDRAWN';
        return;
      end if;
      v_summary := pg_catalog.left(
        v_constraint.name || ' [' || v_constraint.constraint_type || '/' || v_constraint.severity
          || '] ' || pg_catalog.left(v_constraint.value::text, 200),
        600
      );
      v_status := 'ok';
      v_exclusion := null;
    when 'campaign_version' then
      select * into v_version
      from public.campaign_bundle_versions stored_version
      where stored_version.organization_id = p_organization_id
        and stored_version.id = p_source_id;
      if not found then
        return;
      end if;
      v_summary := pg_catalog.left(
        'v' || v_version.version || ' ' || v_version.generation_profile || '/'
          || v_version.execution_mode || ' ' || v_version.campaign_id::text
          || ' ' || v_version.digest,
        600
      );
      v_revision := v_version.version;
      v_status := 'ok';
      v_exclusion := null;
    else
      raise exception 'memory context source kind is invalid' using errcode = '23514';
  end case;

  if v_status = 'ok' then
    v_digest := pg_catalog.encode(extensions.digest(v_summary, 'sha256'), 'hex');
  end if;
  return;
end;
$$;
