-- Forward repair for 20260911144805 (Spec 023 Task C, fix round 3).
--
-- The applied migration calls private.resolve_memory_context_source (declared
-- with OUT parameters) with a redundant column definition list
-- `as resolved(...)`. DDL applies cleanly but the first execution of any
-- prepare/revalidate path aborts 42601 (deferred planning resolves the call
-- shape at first call, never at CREATE). Applied migrations are never
-- edited, so the two containing private functions are recreated here with
-- bodies identical except the alias lists dropped: OUT names already match
-- what the surrounding code reads (v_summary/v_revision/v_digest/v_status/
-- v_exclusion). Grants are untouched (already revoked from public).

create or replace function private.prepare_memory_context_core(
  p_organization_id uuid,
  p_purpose text,
  p_consumer_kind text,
  p_consumer_id uuid,
  p_attempt_key text,
  p_correlation_id uuid,
  p_branch_id uuid,
  p_channel_id uuid,
  p_campaign_id uuid,
  p_policy_version text,
  p_entries jsonb,
  p_retrieval_latency_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.memory_integration_settings;
  v_flags_on boolean := false;
  v_count integer;
  v_manifest public.memory_context_manifests;
  v_existing public.memory_context_manifests;
  v_length integer;
  v_index integer;
  v_element jsonb;
  v_key text;
  v_allowed_keys text[] := array[
    'sourceKind', 'sourceId', 'summary', 'priority', 'optional', 'section',
    'statementKind', 'trustRank', 'freshness', 'sensitivity', 'title',
    'scopeBranchId', 'scopeChannelId', 'observedAt', 'effectiveFrom',
    'effectiveTo', 'reportingStart', 'reportingEnd', 'rootRefs', 'useRestriction'
  ];
  v_source_kind text;
  v_source_id uuid;
  v_summary text;
  v_priority integer;
  v_optional boolean;
  v_section text;
  v_statement text;
  v_trust integer;
  v_freshness text;
  v_sensitivity text;
  v_scope_branch uuid;
  v_scope_channel uuid;
  v_observed timestamptz;
  v_effective_from timestamptz;
  v_effective_to timestamptz;
  v_reporting_start timestamptz;
  v_reporting_end timestamptz;
  v_roots uuid[];
  v_restriction text;
  v_resolved record;
  v_item_origin text;
  v_item_verification text;
  v_title text;
  v_bytes integer;
  v_valid jsonb[] := '{}';
  v_entry jsonb;
  v_excl_codes text[] := '{}';
  v_exclusion_counts jsonb;
  v_reasons text[] := '{}';
  v_status text := 'ready';
  v_kept_ordinals integer[] := '{}';
  v_dropped_ordinals integer[] := '{}';
  v_ordinal integer;
  v_drop_count integer;
  v_drop record;
  v_total_bytes integer := 0;
  v_selected_count integer;
  v_selected_bytes integer := 0;
  v_canonical text := '';
  v_line text;
  v_digest text;
  v_analysis uuid := null;
  v_growth uuid := null;
  v_campaign_run uuid := null;
  v_subject_op uuid := null;
  v_ref text;
begin
  if p_organization_id is null
    or p_purpose is null
    or p_purpose not in (
      'channel_advice', 'growth_research', 'growth_synthesis',
      'campaign_generation', 'campaign_revision', 'subject_drafting'
    )
    or p_consumer_kind is null
    or p_consumer_id is null
    or p_attempt_key is null or pg_catalog.char_length(p_attempt_key) not between 1 and 200
    or p_correlation_id is null
    or p_policy_version is null or pg_catalog.char_length(p_policy_version) not between 1 and 60
    or (p_retrieval_latency_ms is not null and p_retrieval_latency_ms < 0) then
    raise exception 'memory context preparation input is invalid' using errcode = '23514';
  end if;

  if not (
    (p_consumer_kind = 'analysis_run' and p_purpose = 'channel_advice')
    or (p_consumer_kind = 'growth_request' and p_purpose in ('growth_research', 'growth_synthesis'))
    or (p_consumer_kind = 'campaign_generation_run' and p_purpose in ('campaign_generation', 'campaign_revision'))
    or (p_consumer_kind = 'subject_operation' and p_purpose = 'subject_drafting')
  ) then
    raise exception 'memory context consumer purpose is invalid' using errcode = '23514';
  end if;

  case p_consumer_kind
    when 'analysis_run' then v_analysis := p_consumer_id;
    when 'growth_request' then v_growth := p_consumer_id;
    when 'campaign_generation_run' then v_campaign_run := p_consumer_id;
    when 'subject_operation' then v_subject_op := p_consumer_id;
    else
      raise exception 'memory context consumer kind is invalid' using errcode = '23514';
  end case;

  -- Scope ids must be same-organization references, never inferred names.
  if p_branch_id is not null then
    select pg_catalog.count(*) into v_count
    from public.branches scope_branch
    where scope_branch.organization_id = p_organization_id
      and scope_branch.id = p_branch_id;
    if v_count = 0 then
      raise exception 'memory context scope is not authorized' using errcode = '42501';
    end if;
  end if;
  if p_channel_id is not null then
    select pg_catalog.count(*) into v_count
    from public.organization_channels scope_channel
    where scope_channel.organization_id = p_organization_id
      and scope_channel.id = p_channel_id;
    if v_count = 0 then
      raise exception 'memory context scope is not authorized' using errcode = '42501';
    end if;
  end if;
  if p_campaign_id is not null then
    select pg_catalog.count(*) into v_count
    from public.campaigns scope_campaign
    where scope_campaign.organization_id = p_organization_id
      and scope_campaign.id = p_campaign_id;
    if v_count = 0 then
      raise exception 'memory context scope is not authorized' using errcode = '42501';
    end if;
  end if;

  select * into v_settings
  from public.memory_integration_settings configured
  where configured.organization_id = p_organization_id;

  if v_settings.organization_id is not null then
    v_flags_on := case p_purpose
      when 'channel_advice' then v_settings.channel_context_enabled
      when 'growth_research' then v_settings.growth_context_enabled
      when 'growth_synthesis' then v_settings.growth_context_enabled
      when 'campaign_generation' then v_settings.campaign_context_enabled
      when 'campaign_revision' then v_settings.campaign_context_enabled
      else v_settings.subject_context_enabled
    end;
  end if;

  -- A same-attempt retry replays the pinned manifest; the digest below is
  -- recomputed only for fresh attempts. Disabled and unavailable attempts
  -- persist that status with zero entries so the owning output can disclose
  -- the limit honestly instead of claiming untracked context use.
  begin
    if not v_flags_on then
      insert into public.memory_context_manifests (
        organization_id, purpose, policy_version, context_digest, branch_id,
        channel_id, campaign_id, actor_id, correlation_id, status,
        analysis_run_id, growth_request_id, campaign_generation_run_id,
        subject_operation_id, attempt_key, retrieval_latency_ms
      )
      select p_organization_id, p_purpose, p_policy_version,
        pg_catalog.encode(extensions.digest('', 'sha256'), 'hex'),
        p_branch_id, p_channel_id, p_campaign_id,
        (select auth.uid()), p_correlation_id, 'disabled',
        v_analysis, v_growth, v_campaign_run, v_subject_op,
        p_attempt_key, p_retrieval_latency_ms
      returning * into v_manifest;
      return pg_catalog.jsonb_build_object(
        'manifestId', v_manifest.id, 'contextDigest', v_manifest.context_digest,
        'status', v_manifest.status, 'selectedCount', 0, 'selectedBytes', 0
      );
    end if;

    if p_entries is null then
      insert into public.memory_context_manifests (
        organization_id, purpose, policy_version, context_digest, branch_id,
        channel_id, campaign_id, actor_id, correlation_id, status,
        analysis_run_id, growth_request_id, campaign_generation_run_id,
        subject_operation_id, attempt_key, retrieval_latency_ms
      )
      select p_organization_id, p_purpose, p_policy_version,
        pg_catalog.encode(extensions.digest('', 'sha256'), 'hex'),
        p_branch_id, p_channel_id, p_campaign_id,
        (select auth.uid()), p_correlation_id, 'unavailable',
        v_analysis, v_growth, v_campaign_run, v_subject_op,
        p_attempt_key, p_retrieval_latency_ms
      returning * into v_manifest;
      return pg_catalog.jsonb_build_object(
        'manifestId', v_manifest.id, 'contextDigest', v_manifest.context_digest,
        'status', v_manifest.status, 'selectedCount', 0, 'selectedBytes', 0
      );
    end if;

    if pg_catalog.jsonb_typeof(p_entries) <> 'array' then
      raise exception 'memory context entries are invalid' using errcode = '23514';
    end if;

    v_length := pg_catalog.jsonb_array_length(p_entries);
    for v_index in 0 .. v_length - 1 loop
      v_element := p_entries -> v_index;
      v_ordinal := v_index + 1;
      if pg_catalog.jsonb_typeof(v_element) <> 'object' then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;
      for v_key in select pg_catalog.jsonb_object_keys(v_element) loop
        if not (v_key = any(v_allowed_keys)) then
          raise exception 'memory context entry is invalid' using errcode = '23514';
        end if;
      end loop;

      v_source_kind := v_element ->> 'sourceKind';
      if v_source_kind is null or v_source_kind not in (
        'memory_item', 'capture_event', 'business_fact', 'business_profile',
        'goal', 'constraint', 'campaign_version'
      ) then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;

      if v_element ->> 'sourceId' is null
        or (v_element ->> 'sourceId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;
      v_source_id := (v_element ->> 'sourceId')::uuid;

      v_summary := v_element ->> 'summary';
      if v_summary is null or pg_catalog.char_length(v_summary) not between 1 and 600 then
        raise exception 'memory context summary is invalid' using errcode = '23514';
      end if;

      begin
        v_priority := (v_element ->> 'priority')::integer;
      exception when invalid_text_representation then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end;
      if v_priority is null or v_priority < -1000000 or v_priority > 1000000 then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;
      if pg_catalog.jsonb_typeof(v_element -> 'optional') <> 'boolean' then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;
      v_optional := (v_element ->> 'optional')::boolean;

      v_section := v_element ->> 'section';
      v_statement := v_element ->> 'statementKind';
      v_freshness := v_element ->> 'freshness';
      v_sensitivity := v_element ->> 'sensitivity';
      if v_section is null or v_section not in ('current', 'intent', 'observations', 'lessons')
        or v_statement is null or v_statement not in (
          'observation', 'recommendation', 'operator_decision',
          'campaign_state', 'measured_outcome', 'lesson'
        )
        or v_freshness is null or v_freshness not in ('fresh', 'aging', 'stale', 'superseded', 'expired')
        or v_sensitivity is null
        or v_sensitivity not in ('public', 'internal', 'confidential', 'customer_content') then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;
      if (v_element ->> 'trustRank') is null or (v_element ->> 'trustRank') !~ '^[0-4]$' then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;
      v_trust := (v_element ->> 'trustRank')::integer;

      -- Sensitive entries are excluded with a safe code, never stored.
      if v_sensitivity not in ('public', 'internal') then
        v_excl_codes := v_excl_codes || 'SENSITIVITY_BLOCKED';
        continue;
      end if;

      if v_element ->> 'scopeBranchId' is null then
        v_scope_branch := null;
      elsif (v_element ->> 'scopeBranchId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_scope_branch := (v_element ->> 'scopeBranchId')::uuid;
        select pg_catalog.count(*) into v_count
        from public.branches entry_branch
        where entry_branch.organization_id = p_organization_id
          and entry_branch.id = v_scope_branch;
        if v_count = 0 then
          v_excl_codes := v_excl_codes || 'SCOPE_BLOCKED';
          continue;
        end if;
      else
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;

      if v_element ->> 'scopeChannelId' is null then
        v_scope_channel := null;
      elsif (v_element ->> 'scopeChannelId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_scope_channel := (v_element ->> 'scopeChannelId')::uuid;
        select pg_catalog.count(*) into v_count
        from public.organization_channels entry_channel
        where entry_channel.organization_id = p_organization_id
          and entry_channel.id = v_scope_channel;
        if v_count = 0 then
          v_excl_codes := v_excl_codes || 'SCOPE_BLOCKED';
          continue;
        end if;
      else
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;

      v_observed := private.memory_context_cast_timestamptz(v_element ->> 'observedAt');
      v_effective_from := private.memory_context_cast_timestamptz(v_element ->> 'effectiveFrom');
      v_effective_to := private.memory_context_cast_timestamptz(v_element ->> 'effectiveTo');
      v_reporting_start := private.memory_context_cast_timestamptz(v_element ->> 'reportingStart');
      v_reporting_end := private.memory_context_cast_timestamptz(v_element ->> 'reportingEnd');

      if v_element -> 'rootRefs' is null or v_element -> 'rootRefs' = 'null'::jsonb then
        v_roots := '{}';
      elsif pg_catalog.jsonb_typeof(v_element -> 'rootRefs') = 'array'
        and pg_catalog.jsonb_array_length(v_element -> 'rootRefs') <= 100 then
        select pg_catalog.array_agg(
          case when root_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then root_value::uuid end
        ) into v_roots
        from pg_catalog.jsonb_array_elements_text(v_element -> 'rootRefs') as root_value;
        if v_roots is null then
          v_roots := '{}';
        end if;
        if pg_catalog.cardinality(v_roots) <> pg_catalog.jsonb_array_length(v_element -> 'rootRefs') then
          raise exception 'memory context entry is invalid' using errcode = '23514';
        end if;
      else
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;

      v_restriction := v_element ->> 'useRestriction';
      if v_restriction is not null
        and pg_catalog.char_length(v_restriction) not between 1 and 200 then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;

      v_title := v_element ->> 'title';
      if v_title is null or pg_catalog.char_length(v_title) not between 1 and 300 then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;

      select * into v_resolved
      from private.resolve_memory_context_source(p_organization_id, v_source_kind, v_source_id);

      if v_resolved.v_status <> 'ok' then
        v_excl_codes := v_excl_codes || v_resolved.v_exclusion;
        continue;
      end if;

      -- A valid source id paired with caller-invented text is refused, never stored.
      if v_resolved.v_summary is distinct from v_summary then
        raise exception 'memory context summary mismatch' using errcode = '23514';
      end if;

      -- No trust elevation: unconfirmed model output can never enter below rank 4.
      if v_source_kind = 'memory_item' then
        select stored_item.origin, stored_item.verification_state
        into v_item_origin, v_item_verification
        from public.memory_items stored_item
        where stored_item.organization_id = p_organization_id
          and stored_item.id = v_source_id;
        if v_item_origin in ('ai_proposed', 'outcome_learned')
          and v_item_verification <> 'verified'
          and v_trust < 4 then
          raise exception 'memory context trust elevation is refused' using errcode = '23514';
        end if;
      end if;

      v_bytes := pg_catalog.octet_length(v_summary);
      v_entry := pg_catalog.jsonb_build_object(
        'ordinal', v_ordinal, 'sourceKind', v_source_kind, 'sourceId', v_source_id,
        'summary', v_summary, 'priority', v_priority, 'optional', v_optional,
        'section', v_section, 'statementKind', v_statement, 'trustRank', v_trust,
        'freshness', v_freshness, 'sensitivity', v_sensitivity,
        'scopeBranchId', v_scope_branch, 'scopeChannelId', v_scope_channel,
        'observedAt', v_observed, 'effectiveFrom', v_effective_from,
        'effectiveTo', v_effective_to, 'reportingStart', v_reporting_start,
        'reportingEnd', v_reporting_end, 'rootRefs', v_roots,
        'useRestriction', v_restriction, 'title', v_title,
        'revision', v_resolved.v_revision, 'digest', v_resolved.v_digest,
        'bytes', v_bytes
      );
      v_valid := v_valid || v_entry;
    end loop;

    -- 24-entry budget: deterministic drop of lowest-priority optionals.
    if pg_catalog.cardinality(v_valid) > 24 then
      v_drop_count := pg_catalog.cardinality(v_valid) - 24;
      for v_drop in
        select (drop_row.e ->> 'ordinal')::integer as ord,
          (drop_row.e ->> 'optional')::boolean as opt
        from pg_catalog.unnest(v_valid) as drop_row(e)
        order by (drop_row.e ->> 'optional')::boolean desc,
          (drop_row.e ->> 'priority')::integer asc,
          (drop_row.e ->> 'ordinal')::integer desc
        limit v_drop_count
      loop
        v_dropped_ordinals := v_dropped_ordinals || v_drop.ord;
        if not v_drop.opt then
          v_status := 'partial';
          if not ('MANDATORY_OVERFLOW' = any(v_reasons)) then
            v_reasons := v_reasons || 'MANDATORY_OVERFLOW';
          end if;
          v_excl_codes := v_excl_codes || 'MANDATORY_OVERFLOW';
        else
          v_excl_codes := v_excl_codes || 'OVER_BUDGET';
        end if;
      end loop;
    end if;

    -- 16384-byte budget over raw summaries: same deterministic drop order.
    v_total_bytes := 0;
    for v_index in 1 .. pg_catalog.cardinality(v_valid) loop
      v_entry := v_valid[v_index];
      if not ((v_entry ->> 'ordinal')::integer = any(v_dropped_ordinals)) then
        v_total_bytes := v_total_bytes + (v_entry ->> 'bytes')::integer;
      end if;
    end loop;
    if v_total_bytes > 16384 then
      for v_drop in
        select (drop_row.e ->> 'ordinal')::integer as ord,
          (drop_row.e ->> 'optional')::boolean as opt,
          (drop_row.e ->> 'bytes')::integer as nbytes
        from pg_catalog.unnest(v_valid) as drop_row(e)
        where not ((drop_row.e ->> 'ordinal')::integer = any(v_dropped_ordinals))
        order by (drop_row.e ->> 'optional')::boolean desc,
          (drop_row.e ->> 'priority')::integer asc,
          (drop_row.e ->> 'ordinal')::integer desc
      loop
        exit when v_total_bytes <= 16384;
        if not v_drop.opt
          and (select pg_catalog.count(*) from pg_catalog.unnest(v_valid) as kept(e)
               where not ((kept.e ->> 'ordinal')::integer = any(v_dropped_ordinals))) <= 1 then
          exit;
        end if;
        v_dropped_ordinals := v_dropped_ordinals || v_drop.ord;
        v_total_bytes := v_total_bytes - v_drop.nbytes;
        if not v_drop.opt then
          v_status := 'partial';
          if not ('MANDATORY_OVERFLOW' = any(v_reasons)) then
            v_reasons := v_reasons || 'MANDATORY_OVERFLOW';
          end if;
          v_excl_codes := v_excl_codes || 'MANDATORY_OVERFLOW';
        else
          v_excl_codes := v_excl_codes || 'OVER_BUDGET';
        end if;
      end loop;
      if v_total_bytes > 16384 then
        v_status := 'partial';
        if not ('MANDATORY_OVERFLOW' = any(v_reasons)) then
          v_reasons := v_reasons || 'MANDATORY_OVERFLOW';
        end if;
        v_excl_codes := v_excl_codes || 'MANDATORY_OVERFLOW';
      end if;
    end if;

    for v_index in 1 .. pg_catalog.cardinality(v_valid) loop
      v_entry := v_valid[v_index];
      if not ((v_entry ->> 'ordinal')::integer = any(v_dropped_ordinals)) then
        v_kept_ordinals := v_kept_ordinals || (v_entry ->> 'ordinal')::integer;
      end if;
    end loop;

    if pg_catalog.cardinality(v_kept_ordinals) = 0 then
      v_status := 'empty';
    end if;

    for v_index in 1 .. pg_catalog.cardinality(v_valid) loop
      v_entry := v_valid[v_index];
      v_ordinal := (v_entry ->> 'ordinal')::integer;
      if v_ordinal = any(v_kept_ordinals) then
        v_ref := 'ctx-' || pg_catalog.lpad(v_ordinal::text, 4, '0');
        v_line := v_ref || '|' || (v_entry ->> 'sourceKind') || '|'
          || (v_entry ->> 'sourceId') || '|'
          || pg_catalog.coalesce(v_entry ->> 'revision', '') || '|'
          || (v_entry ->> 'summary');
        v_canonical := v_canonical || case when v_canonical = '' then '' else pg_catalog.chr(10) end || v_line;
      end if;
    end loop;
    v_digest := pg_catalog.encode(extensions.digest(v_canonical, 'sha256'), 'hex');

    select pg_catalog.coalesce(
      (select pg_catalog.jsonb_object_agg(counts.code, counts.n)
       from (select code, pg_catalog.count(*) as n
             from pg_catalog.unnest(v_excl_codes) as code
             group by code) as counts),
      '{}'::jsonb
    ) into v_exclusion_counts;

    v_selected_count := pg_catalog.cardinality(v_kept_ordinals);
    v_selected_bytes := 0;
    for v_index in 1 .. pg_catalog.cardinality(v_valid) loop
      v_entry := v_valid[v_index];
      if ((v_entry ->> 'ordinal')::integer = any(v_kept_ordinals)) then
        v_selected_bytes := v_selected_bytes + (v_entry ->> 'bytes')::integer;
      end if;
    end loop;

    insert into public.memory_context_manifests (
      organization_id, purpose, policy_version, context_digest, branch_id,
      channel_id, campaign_id, actor_id, correlation_id, status,
      exclusion_counts, degraded_reasons, selected_count, selected_bytes,
      analysis_run_id, growth_request_id, campaign_generation_run_id,
      subject_operation_id, attempt_key, retrieval_latency_ms
    )
    select p_organization_id, p_purpose, p_policy_version, v_digest,
      p_branch_id, p_channel_id, p_campaign_id,
      (select auth.uid()), p_correlation_id, v_status,
      v_exclusion_counts, v_reasons, v_selected_count, v_selected_bytes,
      v_analysis, v_growth, v_campaign_run, v_subject_op,
      p_attempt_key, p_retrieval_latency_ms
    returning * into v_manifest;

    for v_index in 1 .. pg_catalog.cardinality(v_valid) loop
      v_entry := v_valid[v_index];
      v_ordinal := (v_entry ->> 'ordinal')::integer;
      if v_ordinal = any(v_kept_ordinals) then
        insert into public.memory_context_entries (
          organization_id, manifest_id, ordinal, context_ref, source_kind,
          memory_item_id, capture_event_id, business_fact_id, business_profile_id,
          goal_id, constraint_id, campaign_version_id,
          source_revision, source_digest, statement_kind,
          scope_branch_id, scope_channel_id, trust_rank, freshness, sensitivity,
          observed_at, effective_from, effective_to, reporting_start, reporting_end,
          root_refs, use_restriction, safe_snapshot
        ) values (
          p_organization_id, v_manifest.id, v_ordinal,
          'ctx-' || pg_catalog.lpad(v_ordinal::text, 4, '0'),
          v_entry ->> 'sourceKind',
          case when v_entry ->> 'sourceKind' = 'memory_item' then (v_entry ->> 'sourceId')::uuid end,
          case when v_entry ->> 'sourceKind' = 'capture_event' then (v_entry ->> 'sourceId')::uuid end,
          case when v_entry ->> 'sourceKind' = 'business_fact' then (v_entry ->> 'sourceId')::uuid end,
          case when v_entry ->> 'sourceKind' = 'business_profile' then (v_entry ->> 'sourceId')::uuid end,
          case when v_entry ->> 'sourceKind' = 'goal' then (v_entry ->> 'sourceId')::uuid end,
          case when v_entry ->> 'sourceKind' = 'constraint' then (v_entry ->> 'sourceId')::uuid end,
          case when v_entry ->> 'sourceKind' = 'campaign_version' then (v_entry ->> 'sourceId')::uuid end,
          case when v_entry ->> 'revision' is null then null else (v_entry ->> 'revision')::bigint end,
          v_entry ->> 'digest',
          v_entry ->> 'statementKind',
          case when v_entry ->> 'scopeBranchId' is null then null else (v_entry ->> 'scopeBranchId')::uuid end,
          case when v_entry ->> 'scopeChannelId' is null then null else (v_entry ->> 'scopeChannelId')::uuid end,
          (v_entry ->> 'trustRank')::smallint,
          v_entry ->> 'freshness',
          v_entry ->> 'sensitivity',
          private.memory_context_cast_timestamptz(v_entry ->> 'observedAt'),
          private.memory_context_cast_timestamptz(v_entry ->> 'effectiveFrom'),
          private.memory_context_cast_timestamptz(v_entry ->> 'effectiveTo'),
          private.memory_context_cast_timestamptz(v_entry ->> 'reportingStart'),
          private.memory_context_cast_timestamptz(v_entry ->> 'reportingEnd'),
          case when v_entry -> 'rootRefs' is null or v_entry -> 'rootRefs' = 'null'::jsonb
            then '{}'::uuid[]
            else pg_catalog.coalesce(
              (select pg_catalog.array_agg(root_value::uuid)
               from pg_catalog.jsonb_array_elements_text(v_entry -> 'rootRefs') as root_value
               where root_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
              '{}'::uuid[]) end,
          v_entry ->> 'useRestriction',
          pg_catalog.jsonb_build_object(
            'summary', v_entry ->> 'summary',
            'title', v_entry ->> 'title',
            'statementKind', v_entry ->> 'statementKind',
            'trustRank', (v_entry ->> 'trustRank')::integer,
            'freshness', v_entry ->> 'freshness',
            'sensitivity', v_entry ->> 'sensitivity'
          )
        );
      end if;
    end loop;

    return pg_catalog.jsonb_build_object(
      'manifestId', v_manifest.id, 'contextDigest', v_manifest.context_digest,
      'status', v_manifest.status, 'selectedCount', v_manifest.selected_count,
      'selectedBytes', v_manifest.selected_bytes
    );
  exception when unique_violation then
    -- Same-attempt replay: return the pinned manifest, never a second pack.
    case p_consumer_kind
      when 'analysis_run' then
        select * into v_existing
        from public.memory_context_manifests replayed
        where replayed.organization_id = p_organization_id
          and replayed.purpose = p_purpose
          and replayed.analysis_run_id = v_analysis
          and replayed.attempt_key = p_attempt_key;
      when 'growth_request' then
        select * into v_existing
        from public.memory_context_manifests replayed
        where replayed.organization_id = p_organization_id
          and replayed.purpose = p_purpose
          and replayed.growth_request_id = v_growth
          and replayed.attempt_key = p_attempt_key;
      when 'campaign_generation_run' then
        select * into v_existing
        from public.memory_context_manifests replayed
        where replayed.organization_id = p_organization_id
          and replayed.purpose = p_purpose
          and replayed.campaign_generation_run_id = v_campaign_run
          and replayed.attempt_key = p_attempt_key;
      else
        select * into v_existing
        from public.memory_context_manifests replayed
        where replayed.organization_id = p_organization_id
          and replayed.purpose = p_purpose
          and replayed.subject_operation_id = v_subject_op
          and replayed.attempt_key = p_attempt_key;
    end case;
    if v_existing.id is null then
      raise;
    end if;
    return pg_catalog.jsonb_build_object(
      'manifestId', v_existing.id, 'contextDigest', v_existing.context_digest,
      'status', v_existing.status, 'selectedCount', v_existing.selected_count,
      'selectedBytes', v_existing.selected_bytes
    );
  end;
end;
$$;

create or replace function private.revalidate_memory_manifest(
  p_organization_id uuid,
  p_manifest_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manifest public.memory_context_manifests;
  v_settings public.memory_integration_settings;
  v_flags_on boolean := false;
  v_entry public.memory_context_entries;
  v_source_id uuid;
  v_resolved record;
  v_changed boolean := false;
begin
  select * into v_manifest
  from public.memory_context_manifests stored_manifest
  where stored_manifest.organization_id = p_organization_id
    and stored_manifest.id = p_manifest_id;

  if not found then
    raise exception 'memory context manifest was not found' using errcode = 'P0002';
  end if;

  select * into v_settings
  from public.memory_integration_settings configured
  where configured.organization_id = p_organization_id;

  if v_settings.organization_id is not null then
    v_flags_on := case v_manifest.purpose
      when 'channel_advice' then v_settings.channel_context_enabled
      when 'growth_research' then v_settings.growth_context_enabled
      when 'growth_synthesis' then v_settings.growth_context_enabled
      when 'campaign_generation' then v_settings.campaign_context_enabled
      when 'campaign_revision' then v_settings.campaign_context_enabled
      else v_settings.subject_context_enabled
    end;
  end if;

  if not v_flags_on then
    return 'unavailable';
  end if;

  for v_entry in
    select * from public.memory_context_entries stored_entry
    where stored_entry.organization_id = p_organization_id
      and stored_entry.manifest_id = p_manifest_id
    order by stored_entry.ordinal
  loop
    -- Erased content is revoked, never merely changed: there is no summary
    -- left to compare, and descendants must stop, not rebuild against it.
    if v_entry.safe_snapshot = '{}'::jsonb then
      return 'revoked';
    end if;
    v_source_id := pg_catalog.coalesce(
      v_entry.memory_item_id, v_entry.capture_event_id, v_entry.business_fact_id,
      v_entry.business_profile_id, v_entry.goal_id, v_entry.constraint_id,
      v_entry.campaign_version_id
    );
    select * into v_resolved
    from private.resolve_memory_context_source(
      p_organization_id, v_entry.source_kind, v_source_id
    );
    if v_resolved.v_status <> 'ok' then
      return 'revoked';
    end if;
    if v_resolved.v_summary is distinct from (v_entry.safe_snapshot ->> 'summary') then
      v_changed := true;
    end if;
  end loop;

  if v_changed then
    return 'changed';
  end if;
  return 'valid';
end;
$$;

