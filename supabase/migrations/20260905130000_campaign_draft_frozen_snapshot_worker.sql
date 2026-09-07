-- Growth Intelligence Task 22: frozen snapshot worker support.
--
-- Two gaps stood between the draft request and an atomic frozen draft. First,
-- the objective and audience the operator states at request time lived
-- nowhere in the chain, yet the snapshot must freeze exactly what was asked
-- for — so the request row carries them from here on. Second, the snapshot
-- table knew facts, brand assets, and assertions but not the decision
-- identity, estimate, evaluation plan, or market references the freeze
-- requires — so those columns land beside them.
--
-- `create_campaign_draft_from_request` is the worker's single atomic step
-- (service_role only, fenced by the draft-request claim token): it reloads
-- every bound version, refuses changed prerequisites as permanent failures,
-- and commits brief, campaign, snapshot, request completion, and the
-- Opportunity transition together. It calls no generation model, provider,
-- publish, schedule, spend, approval, or Tool Gateway path. Exact redelivery
-- returns the existing campaign rather than creating another.

alter table public.campaign_draft_requests
  add column objective text,
  add column audience text;

update public.campaign_draft_requests
set objective = 'Governed draft objective pending member statement',
  audience = 'Governed draft audience pending member statement'
where objective is null or audience is null;

alter table public.campaign_draft_requests
  alter column objective set not null,
  alter column audience set not null,
  add constraint campaign_draft_requests_objective_check
    check (char_length(objective) between 1 and 500),
  add constraint campaign_draft_requests_audience_check
    check (char_length(audience) between 1 and 500);

alter table public.campaign_source_snapshots
  add column decision_record_id uuid,
  add column playbook_version_id uuid,
  add column opportunity_id uuid,
  add column opportunity_version integer check (opportunity_version is null or opportunity_version > 0),
  add column action_key text check (action_key is null or action_key ~ '^[a-z][a-z0-9_.-]{1,120}$'),
  add column market_profile_version_id uuid,
  add column goal_metric_key text check (goal_metric_key is null or char_length(goal_metric_key) between 1 and 200),
  add column estimate jsonb check (estimate is null or jsonb_typeof(estimate) = 'object'),
  add column evaluation_freeze jsonb check (evaluation_freeze is null or jsonb_typeof(evaluation_freeze) = 'object'),
  add column evidence_freeze jsonb check (evidence_freeze is null or jsonb_typeof(evidence_freeze) = 'object'),
  add column brand_readiness jsonb check (brand_readiness is null or jsonb_typeof(brand_readiness) = 'object');

comment on column public.campaign_source_snapshots.evidence_freeze is
  'The Opportunity evidence bundle verbatim plus resolved market references '
  'where the chain links them. Market claim linkage is not persisted in the V1 '
  'chain, so resolved ids may be empty while the bundle itself always freezes.';


-- The request intent carries the objective and audience the snapshot must
-- freeze. The prior 8-argument form is dropped so exactly one signature
-- exists; no staging caller references it yet.
drop function if exists public.request_campaign_draft_from_opportunity(
  uuid, uuid, uuid, integer, text, jsonb, text, uuid
);

create function public.request_campaign_draft_from_opportunity(
  p_organization_id uuid,
  p_actor_id uuid,
  p_opportunity_id uuid,
  p_opportunity_version integer,
  p_action_key text,
  p_objective text,
  p_audience text,
  p_assertions jsonb,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  opportunity_row public.opportunities;
  existing_row public.campaign_draft_requests;
  stored_key text;
  requested_key text;
begin
  if (select auth.uid()) is distinct from p_actor_id then
    raise exception 'campaign draft request is not authorized' using errcode = '42501';
  end if;
  if not private.has_organization_permission(p_organization_id, 'campaign.create') then
    raise exception 'campaign draft request is not authorized' using errcode = '42501';
  end if;
  if p_opportunity_version is null or p_opportunity_version < 1 then
    raise exception 'campaign draft request is not valid' using errcode = '22023';
  end if;
  if p_action_key is distinct from 'campaign.governed_draft_v1' then
    raise exception 'campaign draft request is not valid' using errcode = '22023';
  end if;
  if char_length(coalesce(p_objective, '')) not between 1 and 500
    or char_length(coalesce(p_audience, '')) not between 1 and 500
  then
    raise exception 'campaign draft request is not valid' using errcode = '22023';
  end if;
  if jsonb_typeof(p_assertions) <> 'array'
    or jsonb_array_length(p_assertions) not between 1 and 50
  then
    raise exception 'campaign draft request is not valid' using errcode = '22023';
  end if;
  if char_length(coalesce(p_idempotency_key, '')) not between 16 and 200 then
    raise exception 'campaign draft request is not valid' using errcode = '22023';
  end if;

  -- One admission per organization and opportunity: concurrent members
  -- serialize here and share the outcome below.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_opportunity_id::text, 0)
  );

  select opportunity.* into opportunity_row
  from public.opportunities opportunity
  where opportunity.organization_id = p_organization_id
    and opportunity.id = p_opportunity_id
  for update;
  if not found then
    raise exception 'campaign draft opportunity was not found' using errcode = 'P0002';
  end if;

  select request.* into existing_row
  from public.campaign_draft_requests request
  where request.organization_id = p_organization_id
    and request.opportunity_id = p_opportunity_id
  for update;
  if found then
    -- A failed-but-retryable request is explicitly requeued by asking again;
    -- every other state replays as-is, including completed and cancelled. The
    -- replay path deliberately skips the open-state gates below: the work was
    -- already admitted once, and re-asking must report standing, not re-argue it.
    if existing_row.status = 'retryable_failed' then
      update public.campaign_draft_requests
      set status = 'pending',
        claim_token = null,
        lease_expires_at = null,
        failure_code = null,
        updated_at = pg_catalog.now()
      where id = existing_row.id;
      existing_row.status := 'pending';
    end if;
    return pg_catalog.jsonb_build_object(
      'requestId', existing_row.id,
      'status', 'replayed',
      'draftRequestStatus', existing_row.status
    );
  end if;

  if opportunity_row.status <> 'proposed' then
    raise exception 'campaign draft opportunity is not open' using errcode = '22023';
  end if;
  if opportunity_row.version is distinct from p_opportunity_version then
    raise exception 'campaign draft opportunity changed under review' using errcode = '22023';
  end if;
  if opportunity_row.action_key is distinct from p_action_key then
    raise exception 'campaign draft action changed under review' using errcode = '22023';
  end if;
  if opportunity_row.expires_at <= pg_catalog.now() then
    raise exception 'campaign draft opportunity is not open' using errcode = '22023';
  end if;
  -- Every requested assertion must already be asserted on the stored
  -- Opportunity; a new assertion at request time is a different proposal.
  for requested_key in
    select value ->> 'key' from jsonb_array_elements(p_assertions)
  loop
    select value ->> 'key' into stored_key
    from jsonb_array_elements(opportunity_row.assertions)
    where value ->> 'key' = requested_key;
    if not found then
      raise exception 'campaign draft assertions changed under review' using errcode = '22023';
    end if;
  end loop;

  insert into public.campaign_draft_requests (
    organization_id, opportunity_id, opportunity_version, action_key, objective,
    audience, assertions, idempotency_key, actor_id, status
  ) values (
    p_organization_id, p_opportunity_id, p_opportunity_version, p_action_key,
    p_objective, p_audience, p_assertions, p_idempotency_key, p_actor_id, 'pending'
  )
  returning * into existing_row;

  update public.opportunities
  set status = 'draft_requested'
  where organization_id = p_organization_id and id = p_opportunity_id;

  return pg_catalog.jsonb_build_object(
    'requestId', existing_row.id,
    'status', 'created',
    'draftRequestStatus', 'pending'
  );
end;
$$;
create function public.create_campaign_draft_from_request(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_request public.campaign_draft_requests;
  opportunity_row public.opportunities;
  new_campaign_id uuid;
  snapshot_id uuid;
  goal_metric_key text;
  requested_key text;
  stored_key text;
begin
  if char_length(coalesce(p_idempotency_key, '')) not between 16 and 200 then
    raise exception 'campaign draft creation is not valid' using errcode = '22023';
  end if;

  -- One worker per request: concurrent deliveries serialize here and the
  -- second one replays below instead of drafting twice.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organization_id::text || ':' || p_request_id::text, 0)
  );

  select request.* into draft_request
  from public.campaign_draft_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
  for update;
  if not found then
    raise exception 'campaign draft request was not found' using errcode = 'P0002';
  end if;
  -- Exact redelivery after a committed draft returns the same campaign. This
  -- precedes the token check because completion clears the token; the request
  -- id itself is unguessable, so no enumeration opens here.
  if draft_request.campaign_id is not null then
    select snapshot.id into snapshot_id
    from public.campaign_source_snapshots snapshot
    where snapshot.organization_id = p_organization_id
      and snapshot.campaign_id = draft_request.campaign_id
    order by snapshot.captured_at asc
    limit 1;
    return pg_catalog.jsonb_build_object(
      'campaignId', draft_request.campaign_id,
      'sourceSnapshotId', snapshot_id,
      'status', 'replayed'
    );
  end if;
  if draft_request.status <> 'processing' then
    raise exception 'campaign draft request is not processing' using errcode = '22023';
  end if;
  if draft_request.claim_token is distinct from p_claim_token then
    raise exception 'campaign draft claim is not current' using errcode = '42501';
  end if;

  -- Reload every bound version: a prerequisite that moved under the worker is
  -- a permanent failure, never a draft of stale evidence.
  select opportunity.* into opportunity_row
  from public.opportunities opportunity
  where opportunity.organization_id = p_organization_id
    and opportunity.id = draft_request.opportunity_id
  for update;
  if not found then
    raise exception 'campaign draft opportunity was not found' using errcode = 'P0002';
  end if;
  if opportunity_row.status <> 'draft_requested' then
    raise exception 'campaign draft opportunity is not requested' using errcode = '22023';
  end if;
  if opportunity_row.version is distinct from draft_request.opportunity_version then
    raise exception 'campaign draft opportunity changed under work' using errcode = '22023';
  end if;
  if opportunity_row.action_key is distinct from draft_request.action_key then
    raise exception 'campaign draft action changed under work' using errcode = '22023';
  end if;
  for requested_key in
    select value ->> 'key' from jsonb_array_elements(draft_request.assertions)
  loop
    select value ->> 'key' into stored_key
    from jsonb_array_elements(opportunity_row.assertions)
    where value ->> 'key' = requested_key;
    if not found then
      raise exception 'campaign draft assertions changed under work' using errcode = '22023';
    end if;
  end loop;

  -- The goal the draft serves, read from the bound playbook version rather
  -- than trusted from any caller.
  select playbook.primary_metric_key into goal_metric_key
  from public.playbook_versions playbook
  where playbook.organization_id = p_organization_id
    and playbook.id = opportunity_row.playbook_version_id;
  if not found or goal_metric_key is null then
    raise exception 'campaign draft goal is not resolvable' using errcode = '22023';
  end if;

  -- The draft references its opportunity, never a brief: the campaigns table
  -- enforces exactly one source, and the objective and audience freeze into
  -- the snapshot facts below rather than a second intent row.
  insert into public.campaigns (
    organization_id, title, source_kind, brief_id, opportunity_id, created_by, idempotency_key
  ) values (
    p_organization_id,
    opportunity_row.title,
    'decision_opportunity',
    null,
    opportunity_row.id,
    draft_request.actor_id,
    p_idempotency_key
  )
  returning id into new_campaign_id;

  insert into public.campaign_source_snapshots (
    organization_id, campaign_id, facts, brand_asset_version_ids, assertions,
    decision_record_id, playbook_version_id, opportunity_id, opportunity_version,
    action_key, goal_metric_key, estimate, evaluation_freeze, evidence_freeze,
    brand_readiness
  ) values (
    p_organization_id,
    new_campaign_id,
    pg_catalog.jsonb_build_object(
      'objective', draft_request.objective,
      'audience', draft_request.audience
    ),
    '{}'::uuid[],
    opportunity_row.assertions,
    opportunity_row.decision_record_id,
    opportunity_row.playbook_version_id,
    opportunity_row.id,
    opportunity_row.version,
    opportunity_row.action_key,
    goal_metric_key,
    pg_catalog.jsonb_build_object(
      'impactLowMinor', opportunity_row.impact_low_minor,
      'impactHighMinor', opportunity_row.impact_high_minor,
      'expectedContributionMinor', opportunity_row.expected_contribution_minor,
      'currency', opportunity_row.currency,
      'assumptions', opportunity_row.assumptions
    ),
    opportunity_row.evaluation_plan,
    pg_catalog.jsonb_build_object('evidenceBundle', opportunity_row.evidence_bundle),
    null
  )
  returning id into snapshot_id;

  update public.campaign_draft_requests
  set status = 'completed',
    campaign_id = new_campaign_id,
    claim_token = null,
    lease_expires_at = null,
    updated_at = pg_catalog.now()
  where id = draft_request.id;

  update public.opportunities
  set status = 'draft_created'
  where organization_id = p_organization_id
    and id = opportunity_row.id;

  return pg_catalog.jsonb_build_object(
    'campaignId', new_campaign_id,
    'sourceSnapshotId', snapshot_id,
    'status', 'created'
  );
end;
$$;

revoke all on function public.create_campaign_draft_from_request(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_campaign_draft_from_request(uuid, uuid, uuid, text)
  to service_role;
