-- Spec 023 Swarm 4: campaign generation context usage.
--
-- The pinned shared-memory manifest travels with the claimed run, and only
-- its digest travels forward in provenance. A new material revision is a new
-- immutable bundle version under the existing lifecycle; a changed pack is a
-- new bounded attempt, never a silent swap. Rejected or historical design
-- bytes never reach final image generation: the loader below returns ids and
-- digests, never bytes, and the TypeScript assembler enforces the same
-- text-only rule before any model call.
--
-- This slice forward-replaces public.load_campaign_generation_context (the
-- same additive pattern the channel slices use): byte-for-byte the
-- 20260825090000 definition plus the two pinned-context fields, read from the
-- latest campaign_generation / campaign_revision manifest for the run.
-- v_ prefixes every plpgsql local; empty search_path; revoke public.

create or replace function public.load_campaign_generation_context(
  target_organization_id uuid,
  input_context jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  run_row public.campaign_generation_runs;
  snapshot_row public.campaign_source_snapshots;
  campaign_row public.campaigns;
  latest_version_id uuid;
  base_version_row public.campaign_bundle_versions;
  v_manifest public.memory_context_manifests;
begin
  run_row := private.assert_campaign_generation_claim(
    target_organization_id,
    (input_context ->> 'run_id')::uuid,
    (input_context ->> 'claim_token')::uuid
  );

  select scoped.* into snapshot_row
  from public.campaign_source_snapshots scoped
  where scoped.organization_id = target_organization_id
    and scoped.id = run_row.source_snapshot_id;

  if not found then
    raise exception 'campaign_source_snapshot_not_found' using errcode = '42501';
  end if;

  select scoped.* into campaign_row
  from public.campaigns scoped
  where scoped.organization_id = target_organization_id
    and scoped.id = run_row.campaign_id;

  select version.id into latest_version_id
  from public.campaign_bundle_versions version
  where version.organization_id = target_organization_id
    and version.campaign_id = run_row.campaign_id
  order by version.version desc
  limit 1;

  if run_row.base_version_id is not null then
    select version.* into base_version_row
    from public.campaign_bundle_versions version
    where version.organization_id = target_organization_id
      and version.id = run_row.base_version_id;
  end if;

  select manifest_row.* into v_manifest
  from public.memory_context_manifests manifest_row
  where manifest_row.organization_id = target_organization_id
    and manifest_row.campaign_generation_run_id = run_row.id
    and manifest_row.purpose in ('campaign_generation', 'campaign_revision')
  order by manifest_row.as_of desc
  limit 1;

  return pg_catalog.jsonb_build_object(
    'campaign_id', run_row.campaign_id,
    'source_snapshot_id', run_row.source_snapshot_id,
    'kind', run_row.kind,
    'context_manifest_id', case when v_manifest.id is null then null else v_manifest.id end,
    'context_digest', case when v_manifest.id is null then null else v_manifest.context_digest end,
    'facts', snapshot_row.facts,
    'assertions', snapshot_row.assertions,
    'brand_asset_version_ids', pg_catalog.to_jsonb(snapshot_row.brand_asset_version_ids),
    'reference_slots', snapshot_row.reference_slots,
    'negative_rules', snapshot_row.negative_rules,
    'resolver_version', snapshot_row.resolver_version,
    'resolution_outcome', snapshot_row.resolution_outcome,
    'subject_profile_id', snapshot_row.subject_profile_id,
    'subject_description', snapshot_row.subject_description,
    'avoid_reference_version_ids',
      pg_catalog.to_jsonb(snapshot_row.avoid_reference_version_ids),
    'blueprint', snapshot_row.blueprint,
    'plan_model_id', snapshot_row.plan_model_id,
    'creative_direction', snapshot_row.creative_direction,
    'campaign_title', campaign_row.title,
    'latest_version_id', latest_version_id,
    'operator_prompt', run_row.operator_prompt,
    'patch_scope', run_row.patch_scope,
    'base_version', case
      when base_version_row.id is null then 'null'::jsonb
      else pg_catalog.jsonb_build_object(
        'id', base_version_row.id,
        'digest', base_version_row.digest,
        'manifest', base_version_row.manifest,
        'source_snapshot_id', base_version_row.source_snapshot_id,
        'asset_storage_paths', coalesce(
          (
            select pg_catalog.jsonb_object_agg(asset.asset_key::text, asset.storage_path)
            from public.campaign_assets asset
            where asset.organization_id = target_organization_id
              and asset.bundle_version_id = base_version_row.id
          ),
          '{}'::jsonb
        )
      )
    end
  );
end;
$$;

revoke all on function public.load_campaign_generation_context(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.load_campaign_generation_context(uuid, jsonb) to service_role;
