-- The narrator's fence: the only write path for channel recommendations.
--
-- ADR 0037 chains a second fenced worker behind the detector run. When an
-- analysis completes, `channel-recommendations.generate` claims that completed
-- run through `claim_channel_recommendations`, reads the run's findings alone,
-- and files at most six schema-shaped recommendations through
-- `complete_channel_recommendations` — every one citing the findings it was
-- built from, with the database re-checking each citation the way the detector
-- path re-checks evidence. When narration cannot be produced,
-- `fail_channel_recommendations` records why without touching a single finding.
--
-- The lease mirrors `private.channel_analysis_operations`: one row per
-- (organization, analysis run), claim token, ten-minute lease, bounded
-- attempts, advisory lock against concurrent claims. There is no idempotency
-- key parameter here because there is no question to restate: the run id is
-- the identity, so the correlation id of the claiming workflow plays the
-- conflict role instead — two different workflows trying to narrate one run is
-- a `conflict`, not a second answer.

create table private.channel_recommendation_operations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  analysis_run_id uuid not null,
  correlation_id text not null check (char_length(correlation_id) between 1 and 200),
  claim_token uuid not null,
  lease_expires_at timestamptz not null,
  attempt_count integer not null default 1 check (attempt_count between 1 and 10),
  -- What the last attempt admitted, when it admitted defeat. Recorded here
  -- rather than on the analysis run, whose own status belongs to the detector
  -- slice: a failed narration leaves the run completed and its findings
  -- visible, exactly as section 11.4 requires as the fallback.
  failure_code text,
  result_digest text check (result_digest is null or result_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, analysis_run_id),
  foreign key (organization_id, analysis_run_id)
    references public.channel_analysis_runs(organization_id, id) on delete restrict
);

revoke all on table private.channel_recommendation_operations from public, anon, authenticated;

alter table private.channel_recommendation_operations enable row level security;
alter table private.channel_recommendation_operations force row level security;

-- Claiming a completed run -----------------------------------------------------------------

-- Outcome vocabulary: acquired = lease granted; completed = this run's
-- recommendations are already filed, nothing left to do; not_found = the run
-- does not resolve in this tenant; not_ready = the run exists but its analysis
-- has not completed (running or failed); in_progress = another live lease
-- holds the same correlation's work; conflict = a different workflow already
-- owns this run's narration slot, or its attempts are exhausted.
create function public.claim_channel_recommendations(
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
    return jsonb_build_object('outcome', 'completed',
      'windowStart', run_row.window_start, 'windowEnd', run_row.window_end,
      'periodGrain', run_row.period_grain);
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

  return jsonb_build_object('outcome', 'acquired',
    'windowStart', run_row.window_start, 'windowEnd', run_row.window_end,
    'periodGrain', run_row.period_grain);
end;
$$;

-- Filing the narration ----------------------------------------------------------------------

-- Called under the claim token and live lease the worker already holds. The
-- cap, the labels, the digests, and every citation are re-checked here, because
-- the worker is not the authority on what may be recorded as narration: a
-- citation must name a finding of this very run whose own ledger evidence is
-- still current, or the words do not go in. Echoes nothing but counts.
create function public.complete_channel_recommendations(
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
begin
  if jsonb_typeof(p_recommendations) <> 'array' then
    raise exception 'channel recommendation submission is invalid' using errcode = '22023';
  end if;
  if jsonb_array_length(p_recommendations) > 6 then
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

  -- One narration per run. A different digest over the same run is a second
  -- answer under one identity; regeneration belongs to a new analysis run.
  if exists (
    select 1 from public.channel_recommendations r
    where r.organization_id = p_organization_id and r.analysis_run_id = p_analysis_run_id
  ) then
    raise exception 'channel recommendations were already filed for this analysis run' using errcode = '23514';
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

-- Recording a failure ------------------------------------------------------------------------

-- Records why narration did not happen and releases the lease, deleting
-- nothing: the run stays completed, its findings stay visible, and the next
-- attempt may claim the run again within the retry budget.
create function public.fail_channel_recommendations(
  p_organization_id uuid,
  p_analysis_run_id uuid,
  p_claim_token uuid,
  p_failure_code text,
  p_result_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.channel_recommendation_operations;
begin
  -- A short, closed vocabulary, in the voice of the narrator's own failure
  -- modes rather than the detector's.
  if p_failure_code not in ('MODEL_PROVIDER_UNAVAILABLE', 'NARRATION_VALIDATION_FAILED',
    'NARRATION_PROCESSING_FAILED')
    or coalesce(p_result_digest, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'channel recommendation failure is invalid' using errcode = '22023';
  end if;
  select * into operation from private.channel_recommendation_operations
  where organization_id = p_organization_id and analysis_run_id = p_analysis_run_id for update;
  if not found or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then
    return null;
  end if;
  update private.channel_recommendation_operations o set failure_code = p_failure_code,
    result_digest = p_result_digest, lease_expires_at = now(), updated_at = now()
  where o.organization_id = p_organization_id and o.analysis_run_id = p_analysis_run_id
  returning to_jsonb(o) into operation;
  return jsonb_build_object('failureCode', operation.failure_code,
    'resultDigest', operation.result_digest);
end;
$$;

-- Callable by the service worker alone ---------------------------------------------------------

revoke all on function public.claim_channel_recommendations(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_channel_recommendations(uuid, uuid, uuid, text, text, integer, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_channel_recommendations(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_channel_recommendations(uuid, uuid, text, uuid) to service_role;
grant execute on function public.complete_channel_recommendations(uuid, uuid, uuid, text, text, integer, text, text, text, jsonb) to service_role;
grant execute on function public.fail_channel_recommendations(uuid, uuid, uuid, text, text) to service_role;
