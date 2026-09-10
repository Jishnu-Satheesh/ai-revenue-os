-- Amendment C repair: re-raise the per-submission cap to 8.
--
-- The gap-fill migration was generated from the pre-cap source and reverted
-- the Slice-1 cap of 8 back to 6 on staging. Identical body to 20260910100000
-- apart from this line; grants persist across create or replace.
--
create or replace function public.claim_channel_recommendations(
  p_organization_id uuid,
  p_analysis_run_id uuid,
  p_correlation_id text,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.channel_recommendation_operations;
  run_row public.channel_analysis_runs;
  v_gapfill boolean := false;
begin
  if p_claim_token is null
    or p_correlation_id is null or char_length(btrim(p_correlation_id)) not between 1 and 200 then
    raise exception 'channel recommendations request is invalid' using errcode = '22023';
  end if;

  select * into run_row from public.channel_analysis_runs
  where organization_id = p_organization_id and id = p_analysis_run_id;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if run_row.status <> 'completed' then
    return jsonb_build_object('outcome', 'not_ready',
      'windowStart', run_row.window_start, 'windowEnd', run_row.window_end,
      'periodGrain', run_row.period_grain);
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(concat_ws('|', p_organization_id, 'recommendations', p_analysis_run_id), 0));

  if exists (
    select 1 from public.channel_recommendations r
    where r.organization_id = p_organization_id and r.analysis_run_id = p_analysis_run_id
  ) then
    -- One gap-fill per run: two tellings (the first narration plus its
    -- gap-fill) is the whole budget, so a twice-narrated run reads as done.
    if (
      select count(distinct r.result_digest) from public.channel_recommendations r
      where r.organization_id = p_organization_id and r.analysis_run_id = p_analysis_run_id
    ) >= 2 then
      return jsonb_build_object('outcome', 'completed',
        'windowStart', run_row.window_start, 'windowEnd', run_row.window_end,
        'periodGrain', run_row.period_grain);
    end if;
    -- A narration that left chapters bare admits exactly one gap-fill: any
    -- finding of this run that no item cites yet is a section still missing
    -- advice. Fully cited means finished, and the answer stays `completed`.
    if not exists (
      select 1 from public.channel_findings f
      where f.organization_id = p_organization_id and f.analysis_run_id = p_analysis_run_id
        and not exists (
          select 1 from public.channel_recommendation_citations c
          join public.channel_recommendations r
            on r.organization_id = c.organization_id and r.id = c.recommendation_id
          where r.organization_id = p_organization_id
            and r.analysis_run_id = p_analysis_run_id
            and c.finding_id = f.id)
    ) then
      return jsonb_build_object('outcome', 'completed',
        'windowStart', run_row.window_start, 'windowEnd', run_row.window_end,
        'periodGrain', run_row.period_grain);
    end if;
    v_gapfill := true;
  end if;

  select * into operation from private.channel_recommendation_operations
  where organization_id = p_organization_id and analysis_run_id = p_analysis_run_id for update;
  if found then
    if operation.correlation_id <> p_correlation_id then
      return jsonb_build_object('outcome', 'conflict',
        'windowStart', run_row.window_start, 'windowEnd', run_row.window_end,
        'periodGrain', run_row.period_grain);
    end if;
    if operation.claim_token <> p_claim_token and operation.lease_expires_at > now() then
      return jsonb_build_object('outcome', 'in_progress',
        'windowStart', run_row.window_start, 'windowEnd', run_row.window_end,
        'periodGrain', run_row.period_grain);
    end if;
    -- The attempts ceiling doubles as the retry budget; refusing here keeps a
    -- wedged workflow from tripping the column's own check constraint.
    if operation.attempt_count >= 10 then
      return jsonb_build_object('outcome', 'conflict',
        'windowStart', run_row.window_start, 'windowEnd', run_row.window_end,
        'periodGrain', run_row.period_grain);
    end if;
    update private.channel_recommendation_operations set claim_token = p_claim_token,
      lease_expires_at = now() + interval '10 minutes',
      attempt_count = attempt_count + 1, failure_code = null, result_digest = null, updated_at = now()
    where organization_id = p_organization_id and analysis_run_id = p_analysis_run_id;
  else
    insert into private.channel_recommendation_operations (
      organization_id, analysis_run_id, correlation_id, claim_token, lease_expires_at
    ) values (
      p_organization_id, p_analysis_run_id, btrim(p_correlation_id), p_claim_token,
      now() + interval '10 minutes'
    );
  end if;

  return jsonb_build_object('outcome', case when v_gapfill then 'gapfill_acquired' else 'acquired' end,
    'windowStart', run_row.window_start, 'windowEnd', run_row.window_end,
    'periodGrain', run_row.period_grain);
end;
$$;
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

  return jsonb_build_object('recommendationCount', v_recommendation_total,
    'citationCount', v_citation_total);
end;
$$;
