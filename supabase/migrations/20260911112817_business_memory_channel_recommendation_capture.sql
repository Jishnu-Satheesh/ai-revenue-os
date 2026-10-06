-- Spec 023 Task A2: channel_recommendation capture adapter.
--
-- Registry row, projector (private.project_memory_channel_recommendation),
-- enqueue helper, and the forward replacement of
-- complete_channel_recommendations below.
--
-- Digest canonicalization (fixed order, unit-separator joined, nulls collapse
-- to empty): label | headline | detail | supported_actions | limitations |
-- citation finding ids (ordered, comma-joined) | prompt_version |
-- prompt_digest | output_digest | result_digest | analysis_run_id |
-- channel_id | branch_id. The detail text enters the digest only: it is a
-- hash input, never stored or projected.
--
-- Grounding position: channel_recommendations carries no marker for the
-- memory-enabled non-grounded narration path (no context/prompt contract
-- distinguishes it yet), so every recommendation event in this slice is
-- recorded as metadata_only and the projector carries headline plus finding
-- citations plus limitations only. The full narrative detail is never copied
-- into memory. When the narration contract gains its marker, a later slice
-- can qualify non-grounded advice for internal_reusable capture.

insert into public.memory_capture_adapters (source_kind, registered, note) values
  ('channel_recommendation', true, 'Channel narrations project citations-only as metadata_only until provider grounding is qualified.')
on conflict (source_kind) do update set
  registered = excluded.registered,
  note = excluded.note;

-- Enqueue helper: one invocation enumerates only the given completed run's
-- recommendations, including gap-fill additions. Earlier submissions reuse
-- their allocator revision and the existence check skips them, so a gap-fill
-- enqueues exactly its new rows. Failed or rolled-back completions enqueue
-- nothing: this runs inside the completion transaction. Returns events
-- inserted.

create or replace function private.enqueue_memory_channel_recommendations(
  p_organization_id uuid,
  p_analysis_run_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture_on boolean;
  v_run public.channel_analysis_runs;
  v_rec public.channel_recommendations;
  v_citation_ids uuid[];
  v_cited uuid;
  v_canonical text;
  v_digest text;
  v_revision bigint;
  v_event_id uuid;
  v_parent_id uuid;
  v_count integer := 0;
begin
  select settings_row.capture_enabled into v_capture_on
  from public.memory_integration_settings settings_row
  where settings_row.organization_id = p_organization_id;
  if not found or not v_capture_on then
    return 0;
  end if;

  select run_row.* into v_run
  from public.channel_analysis_runs run_row
  where run_row.organization_id = p_organization_id
    and run_row.id = p_analysis_run_id;
  if not found then
    return 0;
  end if;

  for v_rec in
    select rec_row.* from public.channel_recommendations rec_row
    where rec_row.organization_id = p_organization_id
      and rec_row.analysis_run_id = p_analysis_run_id
    order by rec_row.created_at, rec_row.id
  loop
    select coalesce(
        pg_catalog.array_agg(cite.finding_id order by cite.finding_id),
        '{}'::uuid[])
      into v_citation_ids
    from public.channel_recommendation_citations cite
    where cite.organization_id = p_organization_id
      and cite.recommendation_id = v_rec.id;

    v_canonical := pg_catalog.concat_ws(pg_catalog.chr(31),
      v_rec.label,
      v_rec.headline,
      v_rec.detail,
      v_rec.supported_actions::text,
      v_rec.limitations::text,
      coalesce(pg_catalog.array_to_string(v_citation_ids, ','), ''),
      v_rec.prompt_version::text,
      v_rec.prompt_digest,
      v_rec.output_digest,
      v_rec.result_digest,
      v_rec.analysis_run_id::text,
      coalesce(v_rec.channel_id::text, ''),
      coalesce(v_rec.branch_id::text, ''));
    v_digest := pg_catalog.encode(extensions.digest(v_canonical, 'sha256'), 'hex');
    v_revision := private.allocate_memory_source_revision(
      p_organization_id, 'channel_recommendation', v_rec.id, v_digest);

    if not exists (
      select 1 from public.memory_capture_events existing
      where existing.organization_id = p_organization_id
        and existing.channel_recommendation_id = v_rec.id
        and existing.source_revision = v_revision
    ) then
      insert into public.memory_capture_events (
        organization_id, source_kind, channel_recommendation_id,
        source_revision, source_digest, event_kind, occurred_at,
        correlation_id, branch_id, channel_id, reuse_class,
        projection_document
      ) values (
        p_organization_id, 'channel_recommendation', v_rec.id,
        v_revision, v_digest, 'recorded', v_rec.created_at,
        v_run.correlation_id, v_rec.branch_id, v_rec.channel_id,
        'metadata_only',
        pg_catalog.jsonb_build_object(
          'recommendationId', v_rec.id,
          'analysisRunId', v_rec.analysis_run_id,
          'label', v_rec.label,
          'headline', v_rec.headline,
          'citationFindingIds', pg_catalog.to_jsonb(v_citation_ids),
          'limitations', v_rec.limitations,
          'sourceRevision', v_revision)
      ) returning id into v_event_id;
      v_count := v_count + 1;

      -- derived_from edges to the completed capture events of cited
      -- findings, where such events exist. No edge when no parent event
      -- exists yet; self-edges are refused even though kinds make them
      -- impossible here.
      foreach v_cited in array v_citation_ids loop
        select parent.id into v_parent_id
        from public.memory_capture_events parent
        where parent.organization_id = p_organization_id
          and parent.source_kind = 'channel_finding'
          and parent.channel_finding_id = v_cited
          and parent.status = 'completed'
        order by parent.source_revision desc
        limit 1;
        if found and v_parent_id is distinct from v_event_id then
          insert into public.memory_capture_dependencies (
            organization_id, capture_event_id, parent_capture_event_id, relation
          ) values (
            p_organization_id, v_event_id, v_parent_id, 'derived_from'
          ) on conflict do nothing;
        end if;
      end loop;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.enqueue_memory_channel_recommendations(uuid, uuid) from public;

-- Projector: citations-only recommendation to episode. The narrative detail
-- and supported actions are never copied: historical Google-grounded bodies
-- are metadata_only until qualified, and this slice cannot tell a grounded
-- telling from a memory-enabled one (see header). A recommendation with no
-- citation carries no mandatory provenance and is refused outright.

create or replace function private.project_memory_channel_recommendation(
  p_organization_id uuid,
  p_capture_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.memory_capture_events;
  v_rec public.channel_recommendations;
  v_citation_ids uuid[];
  v_title text;
  v_body text;
  v_item_id uuid;
begin
  select event_row.* into v_event
  from public.memory_capture_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.id = p_capture_id;
  if not found then
    raise exception 'memory capture event was not found' using errcode = 'P0002';
  end if;

  select rec_row.* into v_rec
  from public.channel_recommendations rec_row
  where rec_row.organization_id = v_event.organization_id
    and rec_row.id = v_event.channel_recommendation_id;
  if not found then
    raise exception 'memory capture source is withdrawn' using errcode = 'P0002';
  end if;
  if v_rec.organization_id is distinct from p_organization_id then
    raise exception 'memory capture source scope is not authorized' using errcode = '42501';
  end if;

  if v_event.event_kind = 'withdrawn' then
    return null;
  end if;

  select coalesce(
      pg_catalog.array_agg(cite.finding_id order by cite.finding_id),
      '{}'::uuid[])
    into v_citation_ids
  from public.channel_recommendation_citations cite
  where cite.organization_id = v_rec.organization_id
    and cite.recommendation_id = v_rec.id;

  if pg_catalog.array_length(v_citation_ids, 1) is null then
    raise exception 'memory capture source is not projectable' using errcode = '23514';
  end if;

  v_title := pg_catalog.substring(v_rec.headline, 1, 300);
  v_body := pg_catalog.substring(pg_catalog.concat_ws(E'\n',
    'Channel recommendation (' || v_rec.label || ') built from '
      || pg_catalog.array_length(v_citation_ids, 1)::text
      || ' same-run finding citation(s).',
    'Cited findings: ' || pg_catalog.array_to_string(v_citation_ids, ', ') || '.',
    'Analysis run: ' || v_rec.analysis_run_id::text || '.',
    'Limitations: ' || v_rec.limitations::text,
    'Note: citations-only capture; the full narrative detail is excluded as metadata_only until provider grounding is qualified.'
  ), 1, 2000);

  insert into public.memory_items (
    organization_id, branch_id, memory_type, title, body, origin,
    verification_state, sensitivity, knowledge_kind, capture_event_id,
    source_reference, observed_at, review_due_at
  ) values (
    p_organization_id, v_rec.branch_id, 'episode', v_title, v_body,
    'ai_proposed', 'unverified', v_event.sensitivity, 'recommendation',
    v_event.id,
    'channel_recommendation:' || v_rec.id::text,
    v_event.occurred_at,
    pg_catalog.now() + interval '14 days'
  ) returning id into v_item_id;

  return v_item_id;
end;
$$;

revoke all on function private.project_memory_channel_recommendation(uuid, uuid) from public;

-- Forward replacement of complete_channel_recommendations: byte-for-byte the
-- 20260910100000 definition as repaired by the 20260910110000 amendment C
-- repair (per-submission cap 8, run-total cap 8, gap-fill discipline), plus
-- the single capture enqueue before the return. Grants re-issued unchanged.

create or replace function public.complete_channel_recommendations(
  p_organization_id uuid,
  p_analysis_run_id uuid,
  p_claim_token uuid,
  p_provider text,
  p_model_id text,
  p_prompt_version integer,
  p_prompt_digest text,
  p_output_digest text,
  p_result_digest text,
  p_recommendations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.channel_recommendation_operations;
  run_row public.channel_analysis_runs;
  v_item jsonb;
  v_action jsonb;
  v_limitation jsonb;
  v_citation jsonb;
  v_finding_id uuid;
  v_recommendation_id uuid;
  v_recommendation_total integer := 0;
  v_citation_total integer := 0;
  v_existing_total integer := 0;
begin
  if jsonb_typeof(p_recommendations) <> 'array' then
    raise exception 'channel recommendation submission is invalid' using errcode = '22023';
  end if;
  if jsonb_array_length(p_recommendations) > 8 then
    raise exception 'RECOMMENDATION_CAP_EXCEEDED';
  end if;
  if coalesce(p_output_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_prompt_digest, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_result_digest, '') !~ '^[a-f0-9]{64}$'
    or p_prompt_version is null or p_prompt_version < 1
    or p_provider is null or char_length(btrim(p_provider)) not between 1 and 100
    or p_model_id is null or char_length(btrim(p_model_id)) not between 1 and 100
    or jsonb_array_length(p_recommendations) < 1 then
    raise exception 'channel recommendation submission is invalid' using errcode = '22023';
  end if;

  -- Exactly-once replay: the digest binds this submission to what already
  -- landed, so a retry after a lost acknowledgement reports the stored counts
  -- instead of demanding the lease still be alive.
  if exists (
    select 1 from public.channel_recommendations r
    where r.organization_id = p_organization_id
      and r.analysis_run_id = p_analysis_run_id
      and r.result_digest = p_result_digest
  ) then
    return jsonb_build_object(
      'recommendationCount',
        (select count(*)::integer from public.channel_recommendations r
         where r.organization_id = p_organization_id and r.analysis_run_id = p_analysis_run_id),
      'citationCount',
        (select count(*)::integer from public.channel_recommendation_citations c
         join public.channel_recommendations r
           on r.organization_id = c.organization_id and r.id = c.recommendation_id
         where r.organization_id = p_organization_id and r.analysis_run_id = p_analysis_run_id));
  end if;

  -- At most two tellings per run: the first narration plus one gap-fill.
  -- A submission whose every citation is already cited is a second answer
  -- under one identity; regeneration belongs to a new analysis run. A
  -- submission mixing cited and uncited findings is neither a replay nor a
  -- gap-fill and is refused outright. The run-total cap keeps both tellings
  -- inside the same per-run budget as one full narration.
  select count(*) into v_existing_total from public.channel_recommendations r
  where r.organization_id = p_organization_id and r.analysis_run_id = p_analysis_run_id;
  if v_existing_total > 0 then
    if not exists (
      select 1
      from jsonb_array_elements(p_recommendations) v_new_item,
           jsonb_array_elements(coalesce(v_new_item -> 'citations', '[]'::jsonb)) v_new_citation
      where (v_new_citation #>> '{}') not in (
        select c.finding_id::text from public.channel_recommendation_citations c
        join public.channel_recommendations r
          on r.organization_id = c.organization_id and r.id = c.recommendation_id
        where r.organization_id = p_organization_id and r.analysis_run_id = p_analysis_run_id)
    ) then
      raise exception 'channel recommendations were already filed for this analysis run' using errcode = '23514';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_recommendations) v_new_item,
           jsonb_array_elements(coalesce(v_new_item -> 'citations', '[]'::jsonb)) v_new_citation
      where (v_new_citation #>> '{}') in (
        select c.finding_id::text from public.channel_recommendation_citations c
        join public.channel_recommendations r
          on r.organization_id = c.organization_id and r.id = c.recommendation_id
        where r.organization_id = p_organization_id and r.analysis_run_id = p_analysis_run_id)
    ) then
      raise exception 'GAPFILL_CITES_FILED_FINDING' using errcode = '23514';
    end if;
    if v_existing_total + jsonb_array_length(p_recommendations) > 8 then
      raise exception 'RECOMMENDATION_CAP_EXCEEDED';
    end if;
  end if;

  select * into operation from private.channel_recommendation_operations
  where organization_id = p_organization_id and analysis_run_id = p_analysis_run_id for update;
  if not found or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then
    return null;
  end if;
  select * into run_row from public.channel_analysis_runs
  where organization_id = p_organization_id and id = p_analysis_run_id and status = 'completed';
  if not found then return null; end if;

  for v_item in select value from jsonb_array_elements(p_recommendations) loop
    if jsonb_typeof(v_item) <> 'object'
      or coalesce((select bool_or(key not in ('label', 'headline', 'detail', 'supportedActions',
        'limitations', 'citations')) from jsonb_object_keys(v_item) key), false)
      or char_length(coalesce(v_item ->> 'headline', '')) not between 1 and 500
      or char_length(coalesce(v_item ->> 'detail', '')) not between 1 and 4000
      or jsonb_typeof(coalesce(v_item -> 'supportedActions', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(v_item -> 'supportedActions', '[]'::jsonb)) > 10
      or jsonb_typeof(coalesce(v_item -> 'limitations', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(v_item -> 'limitations', '[]'::jsonb)) > 10
      or jsonb_typeof(coalesce(v_item -> 'citations', '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(v_item -> 'citations', '[]'::jsonb)) > 50
      or (select count(distinct value #>> '{}')
            from jsonb_array_elements(coalesce(v_item -> 'citations', '[]'::jsonb)))
        <> jsonb_array_length(coalesce(v_item -> 'citations', '[]'::jsonb)) then
      raise exception 'channel recommendation item is invalid' using errcode = '22023';
    end if;

    for v_action in select value from jsonb_array_elements(coalesce(v_item -> 'supportedActions', '[]'::jsonb)) loop
      if jsonb_typeof(v_action) <> 'string' or char_length(v_action #>> '{}') not between 1 and 300 then
        raise exception 'channel recommendation action is invalid' using errcode = '22023';
      end if;
    end loop;

    for v_limitation in select value from jsonb_array_elements(coalesce(v_item -> 'limitations', '[]'::jsonb)) loop
      if jsonb_typeof(v_limitation) <> 'string' or char_length(v_limitation #>> '{}') not between 1 and 300 then
        raise exception 'channel recommendation limitation is invalid' using errcode = '22023';
      end if;
    end loop;

    for v_citation in select value from jsonb_array_elements(coalesce(v_item -> 'citations', '[]'::jsonb)) loop
      v_citation_total := v_citation_total + 1;
      if v_citation_total > 300 then
        raise exception 'channel recommendations cite more findings than one submission may record' using errcode = '23514';
      end if;
      if jsonb_typeof(v_citation) <> 'string'
        or coalesce(v_citation #>> '{}', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'channel recommendation citation is invalid' using errcode = '22023';
      end if;
      v_finding_id := (v_citation #>> '{}')::uuid;

      -- A narration may only rest on this run's own findings, in this tenant.
      if not exists (
        select 1 from public.channel_findings f
        where f.organization_id = p_organization_id
          and f.id = v_finding_id
          and f.analysis_run_id = p_analysis_run_id
      ) then
        raise exception 'CITATION_NOT_IN_RUN';
      end if;

      -- And the finding's own citations must still be current evidence, by the
      -- identical rule complete_channel_analysis enforces when a detector cites
      -- the ledger. Held evidence is not fact, and prose built on it afterwards
      -- is not fact either.
      if exists (
        select 1 from public.channel_finding_evidence e
        where e.organization_id = p_organization_id
          and e.finding_id = v_finding_id
          and e.evidence_kind = 'normalized_metric'
          and not exists (
            select 1 from public.normalized_metrics m
            where m.organization_id = p_organization_id and m.id = e.normalized_metric_id
              and m.reconciliation_state = 'current' and m.superseded_by_id is null
          )
      ) then
        raise exception 'channel analysis cites metric evidence that is not current' using errcode = '23514';
      end if;
      if exists (
        select 1 from public.channel_finding_evidence e
        where e.organization_id = p_organization_id
          and e.finding_id = v_finding_id
          and e.evidence_kind = 'exact_range_metric_observation'
          and not exists (
            select 1 from public.exact_range_metric_observations o
            where o.organization_id = p_organization_id and o.id = e.exact_range_metric_observation_id
              and o.reconciliation_state = 'current' and o.superseded_by_id is null
          )
      ) then
        raise exception 'channel analysis cites exact range evidence that is not current' using errcode = '23514';
      end if;
    end loop;

    -- The label meets the column's own enum here rather than earlier, exactly
    -- as the storage migration wrote it; anything the CHECK refuses rolls the
    -- whole submission back.
    insert into public.channel_recommendations (
      organization_id, channel_id, branch_id, analysis_run_id, window_start, window_end,
      period_grain, label, headline, detail, supported_actions, limitations, prompt_version,
      prompt_digest, output_digest, provider, model_id, result_digest
    ) values (
      p_organization_id, run_row.channel_id, run_row.branch_id, p_analysis_run_id,
      run_row.window_start, run_row.window_end, run_row.period_grain,
      v_item ->> 'label', v_item ->> 'headline', v_item ->> 'detail',
      coalesce(v_item -> 'supportedActions', '[]'::jsonb), coalesce(v_item -> 'limitations', '[]'::jsonb),
      p_prompt_version, p_prompt_digest, p_output_digest, btrim(p_provider), btrim(p_model_id),
      p_result_digest
    ) returning id into v_recommendation_id;
    v_recommendation_total := v_recommendation_total + 1;

    for v_citation in select value from jsonb_array_elements(coalesce(v_item -> 'citations', '[]'::jsonb)) loop
      insert into public.channel_recommendation_citations (
        organization_id, recommendation_id, finding_id
      ) values (
        p_organization_id, v_recommendation_id, (v_citation #>> '{}')::uuid
      );
    end loop;
  end loop;

  -- The work is done and acknowledged in the same transaction; the lease row
  -- has said everything it ever will. Claiming again answers `completed`.
  delete from private.channel_recommendation_operations
  where organization_id = p_organization_id and analysis_run_id = p_analysis_run_id;

  -- Business Memory capture (Spec 023 Task A2): one event per recommendation
  -- of this run, gap-fill additions included. The helper no-ops when capture
  -- is disabled, so the completion above behaves exactly as before.
  perform private.enqueue_memory_channel_recommendations(p_organization_id, p_analysis_run_id);

  return jsonb_build_object('recommendationCount', v_recommendation_total,
    'citationCount', v_citation_total);
end;
$$;

revoke all on function public.complete_channel_recommendations(uuid, uuid, uuid, text, text, integer, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_channel_recommendations(uuid, uuid, uuid, text, text, integer, text, text, text, jsonb)
  to service_role;
