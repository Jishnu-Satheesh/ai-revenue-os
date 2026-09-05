-- Growth Intelligence Task 22 repair round 2: the single-source repair
-- itself never landed its fixes — the goal metric value was missing from the
-- snapshot insert, so every draft creation failed. This replacement carries
-- the goal metric from the bound playbook version and keeps the single-source
-- shape. The brief insert is gone; objective and audience freeze into facts.

create or replace function public.create_campaign_draft_from_request(
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
