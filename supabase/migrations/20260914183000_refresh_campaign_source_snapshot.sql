-- Let a repaired organization profile reach a campaign that is waiting on it.
--
-- A campaign pins the evidence it may be built from at creation, and generation
-- reads only that pin. That is deliberate: read live, an approval would stop
-- being explicable the moment the brand voice changed underneath it.
--
-- The consequence nobody had a way out of: an operator told that `brand_voice`
-- is missing goes and supplies it, presses "Generate again", and is told the
-- identical thing, because the run is still reading a snapshot taken before the
-- repair. There was no supported way to move a campaign onto newer evidence
-- short of recreating it and losing its history.
--
-- This adds the missing step, and keeps the property that made pinning
-- worthwhile. Nothing is ever rewritten: an existing snapshot is immutable, and
-- a repair produces a *new* one alongside it. Every version already records the
-- snapshot it was built from, so the old pin stays readable for as long as
-- anything references it.
--
-- It refuses to pin a second identical snapshot. `decideGenerationRetry` treats
-- a different snapshot id as a genuinely different question and lets the retry
-- through; if every refresh minted a new id, the guard that stops an operator
-- paying twice for a run that must fail identically would never fire again.

create function public.refresh_campaign_source_snapshot(
  target_organization_id uuid,
  target_campaign_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_facts jsonb;
  current_asset_ids uuid[];
  latest public.campaign_source_snapshots;
  refreshed_id uuid;
begin
  -- `campaign.edit` rather than membership. Moving a campaign onto newer
  -- evidence changes what it will be built from, which is an edit.
  if (select auth.uid()) is null
    or not private.has_organization_permission(target_organization_id, 'campaign.edit') then
    raise exception 'campaign_snapshot_forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.campaigns campaign
    where campaign.organization_id = target_organization_id
      and campaign.id = target_campaign_id
  ) then
    -- Not found, never "refused". A different answer for a campaign that is
    -- real but belongs to somebody else confirms it exists.
    raise exception 'campaign_snapshot_campaign_not_found' using errcode = 'P0002';
  end if;

  -- The same assembler campaign creation uses, so a refreshed pin and a fresh
  -- one cannot disagree about what the organization's verified facts are.
  select
    loaded -> 'facts',
    coalesce(
      (select pg_catalog.array_agg((value #>> '{}')::uuid)
       from pg_catalog.jsonb_array_elements(loaded -> 'brand_asset_version_ids')),
      '{}'::uuid[]
    )
  into current_facts, current_asset_ids
  from public.load_campaign_creation_facts(target_organization_id) as loaded;

  select * into latest
  from public.campaign_source_snapshots snapshot
  where snapshot.organization_id = target_organization_id
    and snapshot.campaign_id = target_campaign_id
  order by snapshot.captured_at desc, snapshot.id desc
  limit 1;

  -- Nothing has changed, so nothing is pinned. Returning the snapshot already
  -- in force keeps the retry guard meaningful.
  if found
    and latest.facts = current_facts
    and latest.brand_asset_version_ids = current_asset_ids
  then
    return pg_catalog.jsonb_build_object(
      'source_snapshot_id', latest.id,
      'refreshed', false
    );
  end if;

  insert into public.campaign_source_snapshots (
    organization_id, campaign_id, facts, brand_asset_version_ids, assertions
  ) values (
    target_organization_id,
    target_campaign_id,
    coalesce(current_facts, '{}'::jsonb),
    current_asset_ids,
    -- Carried forward, not recomputed. Assertions come from the decision that
    -- opened this campaign; repairing a brand voice does not revisit them, and
    -- silently dropping them would widen what the campaign may claim.
    coalesce(latest.assertions, '[]'::jsonb)
  )
  returning id into refreshed_id;

  return pg_catalog.jsonb_build_object(
    'source_snapshot_id', refreshed_id,
    'refreshed', true
  );
end;
$$;

revoke all on function public.refresh_campaign_source_snapshot(uuid, uuid) from public, anon;
grant execute on function public.refresh_campaign_source_snapshot(uuid, uuid) to authenticated;

comment on function public.refresh_campaign_source_snapshot(uuid, uuid) is
  'Pins a new source snapshot for a campaign when the organization''s verified facts have changed since the last one. Never rewrites an existing snapshot, and pins nothing when the facts are identical.';
