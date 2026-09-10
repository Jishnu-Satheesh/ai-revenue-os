-- Retry after failure (provider 400 follow-up): a terminally failed narration
-- lease resumes under a new correlation instead of conflicting forever.
--
-- Claim-only change to 20260910100000; the gap-fill outcomes, the uncited-only
-- completion rule, and the run-total cap are untouched. Grants persist across
-- create or replace.
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
    -- A press under a new correlation while another workflow holds a live,
    -- unforgiven lease is a duplicate wake and stays refused. But a lease
    -- whose failure is already recorded is terminal: the press after a
    -- failure is a retry, not a duplicate, so it resumes instead of
    -- conflicting forever. The attempt ceiling still bounds it, and failed
    -- attempts file nothing, so the two-telling budget is untouched.
    if operation.correlation_id <> p_correlation_id and operation.failure_code is null then
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
    update private.channel_recommendation_operations set correlation_id = btrim(p_correlation_id),
      claim_token = p_claim_token,
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
