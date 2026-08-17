-- The brief's intent belongs in the pinned evidence snapshot.
--
-- `create_campaign_with_source` wrote the brief to `campaign_briefs` and the
-- verified organization facts to the snapshot, but never joined the two. The
-- snapshot is what generation reads, so an operator who typed an objective and
-- an audience into the form was told both were missing:
--
--   needs_data:brand_voice,objective,audience,primary_metric,baseline_source
--
-- Being told you left blank the field you just filled in is the kind of error
-- that makes people stop trusting the rest of the screen.
--
-- The snapshot is immutable by trigger, so existing snapshots are not
-- rewritten. This changes what new campaigns pin.
--
-- Note: this covers the manual-brief path only. An opportunity-sourced
-- campaign passes no brief, and still has no objective or audience in its
-- snapshot. That gap is real and deliberately left for the Decision Engine
-- work rather than papered over with a default here.

create or replace function public.create_campaign_with_source(
  target_organization_id uuid,
  input_campaign jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.campaigns;
  brief_id uuid;
  campaign_id uuid;
  snapshot_id uuid;
  snapshot_facts jsonb;
  supplied_key text := input_campaign ->> 'idempotency_key';
  source_kind text := input_campaign ->> 'source_kind';
  opportunity_id uuid := (input_campaign ->> 'opportunity_id')::uuid;
begin
  if target_organization_id is null
    or input_campaign ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_create_organization_mismatch' using errcode = '42501';
  end if;

  if auth.uid() is null or not private.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  ) then
    raise exception 'campaign_create_forbidden' using errcode = '42501';
  end if;

  select campaign.* into existing
  from public.campaigns campaign
  where campaign.organization_id = target_organization_id
    and campaign.idempotency_key = supplied_key;

  if found then
    return pg_catalog.jsonb_build_object(
      'campaign_id', existing.id,
      'source_snapshot_id', (
        select snapshot.id from public.campaign_source_snapshots snapshot
        where snapshot.organization_id = target_organization_id
          and snapshot.campaign_id = existing.id
        order by snapshot.captured_at asc
        limit 1
      ),
      'replayed', true
    );
  end if;

  -- The opportunity must belong to this organization and still be open. The
  -- application checks this too; the database checks it because a privileged
  -- path must not assume the caller ran.
  if source_kind = 'decision_opportunity' then
    if not exists (
      select 1 from public.opportunities opportunity
      where opportunity.organization_id = target_organization_id
        and opportunity.id = opportunity_id
        and opportunity.status in ('proposed', 'awaiting_approval')
        and opportunity.expires_at > pg_catalog.now()
    ) then
      raise exception 'campaign_opportunity_not_available' using errcode = '22023';
    end if;
  end if;

  if source_kind = 'manual_brief' then
    insert into public.campaign_briefs (
      organization_id, objective, audience, offer, requested_channels, created_by
    ) values (
      target_organization_id,
      input_campaign #>> '{brief,objective}',
      input_campaign #>> '{brief,audience}',
      input_campaign #>> '{brief,offer}',
      coalesce(
        (select pg_catalog.array_agg(value #>> '{}')
         from pg_catalog.jsonb_array_elements(input_campaign #> '{brief,requested_channels}')),
        '{}'::text[]
      ),
      auth.uid()
    )
    returning id into brief_id;
  end if;

  insert into public.campaigns (
    organization_id, title, source_kind, brief_id, opportunity_id, created_by, idempotency_key
  ) values (
    target_organization_id,
    input_campaign ->> 'title',
    source_kind,
    brief_id,
    case when source_kind = 'decision_opportunity' then opportunity_id else null end,
    auth.uid(),
    supplied_key
  )
  returning id into campaign_id;

  snapshot_facts := coalesce(input_campaign -> 'facts', '{}'::jsonb);

  -- Read back from the brief row rather than from the request body, so the
  -- snapshot and the brief cannot disagree about what was asked for.
  if brief_id is not null then
    snapshot_facts := snapshot_facts || (
      select pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'objective', brief.objective,
          'audience', brief.audience,
          'offer', brief.offer,
          'requestedChannels', pg_catalog.to_jsonb(brief.requested_channels)
        )
      )
      from public.campaign_briefs brief
      where brief.organization_id = target_organization_id and brief.id = brief_id
    );
  end if;

  -- The evidence generation is allowed to use, pinned now. Read live later, an
  -- approval would stop being explicable the moment the brand voice changed.
  insert into public.campaign_source_snapshots (
    organization_id, campaign_id, facts, brand_asset_version_ids, assertions
  ) values (
    target_organization_id,
    campaign_id,
    snapshot_facts,
    coalesce(
      (select pg_catalog.array_agg((value #>> '{}')::uuid)
       from pg_catalog.jsonb_array_elements(input_campaign -> 'brand_asset_version_ids')),
      '{}'::uuid[]
    ),
    coalesce(input_campaign -> 'assertions', '[]'::jsonb)
  )
  returning id into snapshot_id;

  return pg_catalog.jsonb_build_object(
    'campaign_id', campaign_id,
    'source_snapshot_id', snapshot_id,
    'replayed', false
  );
end;
$$;
