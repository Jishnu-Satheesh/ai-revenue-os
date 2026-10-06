-- A campaign may not keep saying "approved" once its approval is gone.
--
-- `src/domain/campaigns/state-machine.ts` states the invariant in its own
-- words: `approved` means "an approval row currently covers the version this
-- campaign is on" -- nothing more. Staging disagreed. Campaign `783ab4e1` sat
-- in `approved` while its only approval had been revoked on 2026-09-06 as
-- `superseded_by_new_version`, because this function revoked the approval and
-- then touched nothing on the campaign but `updated_at`.
--
-- The cost was not theoretical. The portfolio list and the campaign header both
-- render their badge from that column, so an operator was shown a green
-- "Approved" chip on the same screen whose review rail said nothing was
-- approved. An approval badge that outlives its approval is worse than no badge
-- at all: it is the one thing on the page a client would repeat out loud.
--
-- Only the exact `approved` state moves, and only to `ready_for_review`, which
-- is where a campaign whose approval just died belongs -- in front of a
-- reviewer again.
--
-- Every later state is deliberately left alone. `scheduled`, `executing`,
-- `measuring`, `partially_completed` and `completed` describe things that
-- actually happened; a plate edit that writes a new version does not un-publish
-- a post that already went out, and rewinding those would erase a record rather
-- than correct one. Such a campaign simply ends up on a version no approval
-- covers, which the approval panel now says in as many words.
--
-- This is a forward replacement of a `security definer` function on shared
-- staging. The body below is the live definition -- diffed against
-- `pg_get_functiondef` before this was written, and identical -- with one
-- changed statement, the `update public.campaigns` near the end.

create or replace function public.create_campaign_bundle_version(
  target_organization_id uuid,
  input_bundle jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_campaign_id uuid := (input_bundle ->> 'campaign_id')::uuid;
  snapshot_id uuid := (input_bundle ->> 'source_snapshot_id')::uuid;
  manifest jsonb := input_bundle -> 'manifest';
  next_version integer;
  parent_id uuid;
  saved_id uuid := gen_random_uuid();
  direction jsonb;
  asset jsonb;
  action jsonb;
  plan jsonb := input_bundle -> 'measurement_plan';
  revoked_count integer := 0;
begin
  if target_organization_id is null
    or input_bundle ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_bundle_organization_mismatch' using errcode = '42501';
  end if;

  if manifest is null or jsonb_typeof(manifest) <> 'object' then
    raise exception 'campaign_bundle_manifest_invalid' using errcode = '22023';
  end if;

  -- Serialize every version write for one campaign. Two concurrent revisions
  -- would otherwise both read "latest is 3" and both try to write 4; the
  -- unique constraint would catch it, but as a confusing conflict rather than
  -- an orderly wait.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('campaign_bundle_version:' || target_campaign_id::text, 0)
  );

  if not exists (
    select 1 from public.campaigns campaign
    where campaign.organization_id = target_organization_id
      and campaign.id = target_campaign_id
  ) then
    raise exception 'campaign_not_found' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.campaign_source_snapshots snapshot
    where snapshot.organization_id = target_organization_id
      and snapshot.id = snapshot_id
      and snapshot.campaign_id = target_campaign_id
  ) then
    raise exception 'campaign_source_snapshot_not_found' using errcode = '42501';
  end if;

  select coalesce(pg_catalog.max(existing.version), 0) + 1, (
    select latest.id from public.campaign_bundle_versions latest
    where latest.organization_id = target_organization_id
      and latest.campaign_id = target_campaign_id
    order by latest.version desc
    limit 1
  )
  into next_version, parent_id
  from public.campaign_bundle_versions existing
  where existing.organization_id = target_organization_id
    and existing.campaign_id = target_campaign_id;

  insert into public.campaign_bundle_versions (
    id, organization_id, campaign_id, version, parent_version_id, source_snapshot_id,
    manifest, digest, generation_profile, execution_mode,
    total_spend_ceiling_minor, spend_currency, created_by
  ) values (
    saved_id, target_organization_id, target_campaign_id, next_version, parent_id, snapshot_id,
    pg_catalog.jsonb_set(manifest, '{version}', pg_catalog.to_jsonb(next_version)),
    input_bundle ->> 'digest',
    manifest ->> 'generationProfile',
    manifest ->> 'executionMode',
    (input_bundle -> 'total_spend_ceiling' ->> 'amountMinor')::bigint,
    input_bundle -> 'total_spend_ceiling' ->> 'currency',
    auth.uid()
  );

  for direction in select * from pg_catalog.jsonb_array_elements(input_bundle -> 'directions') loop
    insert into public.campaign_creative_directions (
      organization_id, bundle_version_id, direction_key, kind, name, rationale,
      generation_profile_override, experiment
    ) values (
      target_organization_id, saved_id, (direction ->> 'id')::uuid, direction ->> 'kind',
      direction ->> 'name', direction ->> 'rationale',
      direction ->> 'generationProfileOverride',
      case when direction -> 'experiment' = 'null'::jsonb then null else direction -> 'experiment' end
    );
  end loop;

  for asset in select * from pg_catalog.jsonb_array_elements(input_bundle -> 'assets') loop
    insert into public.campaign_assets (
      organization_id, bundle_version_id, asset_key, storage_path, content_hash,
      mime_type, width_px, height_px, truth_class, provenance, alt_text
    ) values (
      target_organization_id, saved_id, (asset ->> 'id')::uuid, asset ->> 'storagePath',
      asset ->> 'contentHash', asset ->> 'mimeType', (asset ->> 'widthPx')::integer,
      (asset ->> 'heightPx')::integer, asset ->> 'truthClass', asset -> 'provenance',
      asset ->> 'altText'
    );
  end loop;

  for action in select * from pg_catalog.jsonb_array_elements(input_bundle -> 'actions') loop
    insert into public.campaign_channel_actions (
      organization_id, bundle_version_id, action_key, direction_key, channel, placement,
      scheduled_for, requirement, spend_ceiling_minor, spend_currency
    ) values (
      target_organization_id, saved_id, (action ->> 'id')::uuid, (action ->> 'directionId')::uuid,
      action ->> 'channel', action ->> 'placement', (action ->> 'scheduledFor')::timestamptz,
      action ->> 'requirement',
      (action -> 'spendCeiling' ->> 'amountMinor')::bigint,
      action -> 'spendCeiling' ->> 'currency'
    );
  end loop;

  insert into public.campaign_measurement_plans (
    organization_id, bundle_version_id, primary_metric_key, guardrail_metric_keys,
    baseline_source, baseline_lookback_days, attribution_method, outcome_window_days,
    settlement_delay_days, minimum_evidence_tier
  ) values (
    target_organization_id, saved_id, plan ->> 'primaryMetricKey',
    coalesce(
      (select pg_catalog.array_agg(value #>> '{}')
       from pg_catalog.jsonb_array_elements(plan -> 'guardrailMetricKeys')),
      '{}'::text[]
    ),
    plan ->> 'baselineSource', (plan ->> 'baselineLookbackDays')::integer,
    plan ->> 'attributionMethod', (plan ->> 'outcomeWindowDays')::integer,
    (plan ->> 'settlementDelayDays')::integer, plan ->> 'minimumEvidenceTier'
  );

  -- A new version invalidates every live approval on an earlier one. This is
  -- the whole point of version-exact approval: what an operator agreed to no
  -- longer exists, so their permission cannot travel forward.
  with superseded as (
    update public.campaign_approvals approval
    set revoked_at = pg_catalog.now(), revoked_reason = 'superseded_by_new_version'
    where approval.organization_id = target_organization_id
      and approval.campaign_id = target_campaign_id
      and approval.bundle_version_id <> saved_id
      and approval.revoked_at is null
    returning 1
  )
  select pg_catalog.count(*)::integer into revoked_count from superseded;

  -- Revoking an approval without moving the state would leave the campaign
  -- claiming a permission it no longer holds. Only `approved` moves: every
  -- later state describes execution that really happened.
  update public.campaigns campaign
  set
    updated_at = pg_catalog.now(),
    state = case
      when revoked_count > 0 and campaign.state = 'approved' then 'ready_for_review'
      else campaign.state
    end
  where campaign.organization_id = target_organization_id
    and campaign.id = target_campaign_id;

  return pg_catalog.jsonb_build_object(
    'bundle_version_id', saved_id,
    'version', next_version,
    'parent_version_id', parent_id,
    'revoked_approval_count', revoked_count
  );
end;
$$;

-- The one campaign this already happened to. Its approval was revoked as
-- superseded on 2026-09-06 and its state was never moved, so it is corrected
-- here rather than left as the single row that contradicts the rule above.
-- Scoped by the revoked approval, not by id, so it can only ever touch a
-- campaign that is genuinely in this position.
update public.campaigns campaign
set state = 'ready_for_review', updated_at = pg_catalog.now()
where campaign.state = 'approved'
  and not exists (
    select 1
    from public.campaign_approvals approval
    where approval.campaign_id = campaign.id
      and approval.organization_id = campaign.organization_id
      and approval.revoked_at is null
  );
