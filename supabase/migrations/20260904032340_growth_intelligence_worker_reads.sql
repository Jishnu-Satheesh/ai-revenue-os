-- Synthesis trigger workers read worker tables directly as service_role, outside
-- any RPC call. RLS bypass alone is not enough (service_role bypasses RLS but
-- still needs table GRANTs for direct reads; the fenced RPCs themselves run
-- with definer rights and are unaffected). Tasks 3/6 never granted worker
-- reads and the Task 13 migration revoked without granting, so production
-- worker reads and test subselects fail with 42501. Grant SELECT-only: every
-- write stays fenced behind its RPC, which keeps its own role check.
grant select on table public.growth_intelligence_requests to service_role;
grant select on table public.organization_market_profiles to service_role;
grant select on table public.organization_market_profile_versions to service_role;
grant select on table public.market_evidence_sources to service_role;
grant select on table public.market_evidence_claims to service_role;
grant select on table public.market_evidence_claim_events to service_role;
grant select on table public.market_evidence_links to service_role;
-- channel_findings belongs to the channel analysis module: the synthesis
-- worker only reads finding digests when linking items to evidence.
-- Analysis owners: this grant is read-only and exists solely for that link
-- step; writes stay fenced behind the analysis RPCs.
grant select on table public.channel_findings to service_role;
grant select on table public.growth_intelligence_synthesis_runs to service_role;
grant select on table public.growth_intelligence_items to service_role;

-- Repair the Task 13 completion RPC: pg_catalog.coalesce(...) does not
-- resolve (COALESCE is syntax, not a catalog function), so every completion
-- raised "function pg_catalog.coalesce(jsonb, jsonb) does not exist". The
-- body below is identical except for the unqualified coalesce. Existing runs
-- and items stay intact; only future execution is repaired.
create or replace function public.complete_growth_intelligence_synthesis(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_synthesis_run_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.growth_intelligence_synthesis_runs;
  item_record jsonb;
  item_row public.growth_intelligence_items;
  stored_item_count integer := 0;
  superseded_ids uuid[] := '{}';
  superseded_item_ids jsonb;
  flipped_id uuid;
begin
  if p_organization_id is null or p_request_id is null or p_claim_token is null
    or p_synthesis_run_id is null then
    raise exception 'growth_intelligence_synthesis_result_invalid' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_result) <> 'object'
    or (p_result ->> 'outcome') <> 'completed'
    or (p_result ->> 'resultDigest') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_result -> 'items') <> 'array'
    or pg_catalog.jsonb_array_length(p_result -> 'items') > 200 then
    raise exception 'growth_intelligence_synthesis_result_invalid' using errcode = '22023';
  end if;
  perform private.assert_growth_intelligence_synthesis_claim(
    p_organization_id, p_request_id, p_claim_token
  );
  select run.* into run_row
  from public.growth_intelligence_synthesis_runs run
  where run.organization_id = p_organization_id
    and run.id = p_synthesis_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token
    and run.status = 'running'
  for update;
  if not found then
    raise exception 'growth_intelligence_synthesis_run_not_running' using errcode = '22023';
  end if;
  for item_record in select * from pg_catalog.jsonb_array_elements(p_result -> 'items') loop
    if pg_catalog.jsonb_typeof(item_record) <> 'object'
      or (item_record ->> 'kind') not in ('insight', 'recommendation', 'data_gap')
      or pg_catalog.char_length(item_record ->> 'narrative') not between 1 and 2000
      or (item_record ->> 'itemFingerprint') !~ '^[a-f0-9]{64}$'
      or (item_record ->> 'evidenceFingerprint') !~ '^[a-f0-9]{64}$'
      or (item_record ->> 'geographicLayer') not in ('trade_area', 'city', 'country')
      or pg_catalog.char_length(item_record ->> 'geographyRef') not between 2 and 160
      or (item_record ->> 'supportGrade') not in ('primary', 'corroborated', 'single_source', 'contextual', 'conflicted')
      or (item_record ->> 'freshness') not in ('current', 'stale', 'expired')
      or (item_record ->> 'urgency') not in ('high', 'medium', 'low')
      or (item_record ->> 'goalAlignment') not in ('direct', 'indirect', 'none')
      or (item_record ->> 'activityMonth') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      or pg_catalog.jsonb_typeof(item_record -> 'claimIds') <> 'array'
      or pg_catalog.jsonb_typeof(item_record -> 'findings') <> 'array'
      or pg_catalog.jsonb_typeof(item_record -> 'goals') <> 'array'
      or exists (
        select 1 from pg_catalog.jsonb_array_elements_text(item_record -> 'claimIds') as claim_id(value)
        where claim_id.value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(item_record -> 'findings') as finding(value)
        where pg_catalog.jsonb_typeof(finding.value) <> 'object'
          or (finding.value ->> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or (finding.value ->> 'digest') !~ '^[a-f0-9]{64}$'
      )
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(item_record -> 'goals') as goal(value)
        where pg_catalog.jsonb_typeof(goal.value) <> 'object'
          or pg_catalog.char_length(goal.value ->> 'ref') not between 2 and 160
          or (goal.value ->> 'alignment') not in ('direct', 'indirect', 'none')
      ) then
      raise exception 'growth_intelligence_synthesis_item_invalid' using errcode = '22023';
    end if;
    if ((item_record ->> 'kind') = 'data_gap') <> (item_record -> 'missingInput' is not null
      and item_record ->> 'missingInput' <> '') then
      raise exception 'growth_intelligence_synthesis_item_invalid' using errcode = '22023';
    end if;
    insert into public.growth_intelligence_items (
      organization_id, growth_intelligence_synthesis_run_id, market_profile_version_id,
      kind, narrative, item_fingerprint, evidence_fingerprint,
      geographic_layer, geography_ref, support_grade, freshness, urgency, goal_alignment,
      activity_month, missing_input
    ) values (
      p_organization_id, p_synthesis_run_id, run_row.market_profile_version_id,
      item_record ->> 'kind', item_record ->> 'narrative',
      item_record ->> 'itemFingerprint', item_record ->> 'evidenceFingerprint',
      item_record ->> 'geographicLayer', item_record ->> 'geographyRef',
      item_record ->> 'supportGrade', item_record ->> 'freshness',
      item_record ->> 'urgency', item_record ->> 'goalAlignment',
      item_record ->> 'activityMonth',
      nullif(item_record ->> 'missingInput', '')
    )
    on conflict (organization_id, item_fingerprint) do nothing
    returning * into item_row;
    if found then
      stored_item_count := stored_item_count + 1;
      insert into public.growth_intelligence_item_market_claims (
        organization_id, growth_intelligence_item_id, market_evidence_claim_id
      )
      select p_organization_id, item_row.id, claim_id.value::uuid
      from pg_catalog.jsonb_array_elements_text(item_record -> 'claimIds') as claim_id(value)
      on conflict do nothing;
      insert into public.growth_intelligence_item_channel_findings (
        organization_id, growth_intelligence_item_id, finding_id, finding_digest
      )
      select p_organization_id, item_row.id,
        (finding.value ->> 'id')::uuid, finding.value ->> 'digest'
      from pg_catalog.jsonb_array_elements(item_record -> 'findings') as finding(value)
      on conflict do nothing;
      insert into public.growth_intelligence_item_goals (
        organization_id, growth_intelligence_item_id, goal_ref, alignment
      )
      select p_organization_id, item_row.id,
        goal.value ->> 'ref', goal.value ->> 'alignment'
      from pg_catalog.jsonb_array_elements(item_record -> 'goals') as goal(value)
      on conflict do nothing;
      -- Committed supersession: each newly stored item retires prior current
      -- items of the same kind, geographic layer, geography, and activity
      -- month. Currency is per-month (a revised profile retires same-month
      -- priors); profile version stays unscoped so prior-month unresolved
      -- items keep their status for carry-over. The items table guard permits
      -- exactly this transition.
      for flipped_id in
        update public.growth_intelligence_items as prior
        set status = 'superseded',
          superseded_by_item_id = item_row.id
        where prior.organization_id = p_organization_id
          and prior.kind = item_row.kind
          and prior.geographic_layer = item_row.geographic_layer
          and prior.geography_ref = item_row.geography_ref
          and prior.activity_month = item_row.activity_month
          and prior.status = 'current'
          and prior.id <> item_row.id
        returning prior.id
      loop
        superseded_ids := superseded_ids || flipped_id;
      end loop;
    end if;
  end loop;
  select coalesce(
    pg_catalog.jsonb_agg(flipped.id order by flipped.id),
    pg_catalog.jsonb_build_array()
  ) into superseded_item_ids
  from pg_catalog.unnest(superseded_ids) as flipped(id);
  update public.growth_intelligence_synthesis_runs
  set status = 'completed',
    result_digest = p_result ->> 'resultDigest',
    item_count = stored_item_count,
    completed_at = pg_catalog.now()
  where organization_id = p_organization_id and id = run_row.id;
  return pg_catalog.jsonb_build_object(
    'runId', run_row.id, 'status', 'completed', 'itemCount', stored_item_count,
    'supersededItemIds', superseded_item_ids
  );
end;
$$;

revoke all on function public.complete_growth_intelligence_synthesis(uuid,uuid,uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_growth_intelligence_synthesis(uuid,uuid,uuid,uuid,jsonb)
  to service_role;
