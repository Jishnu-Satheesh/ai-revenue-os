-- Where an operator's revision instruction lives.
--
-- It cannot travel in the task payload: a payload is stored by the queue, shown
-- in a run dashboard, and kept in logs, and an operator's instruction is
-- business content. So the worker reads it from here, under the claim it holds.
--
-- It sits on the run rather than in its own table because it has exactly the
-- run's lifetime and exactly the run's tenancy. A separate table would add a
-- join and a second place for the two to disagree.

alter table public.campaign_generation_runs
  add column operator_prompt text check (char_length(operator_prompt) between 1 and 2000),
  add column patch_scope text check (
    patch_scope in ('bundle', 'direction', 'copy', 'hashtags', 'schedule', 'generation_profile')
  );

-- A revision without an instruction has nothing to do; a generation with one
-- would be carrying an instruction nobody reads.
alter table public.campaign_generation_runs
  add constraint campaign_generation_runs_instruction_matches_kind
  check ((kind = 'revise') = (operator_prompt is not null and patch_scope is not null));

create or replace function public.enqueue_campaign_generation_run(
  target_organization_id uuid,
  input_run jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.campaign_generation_runs;
  saved_id uuid;
  supplied_digest text := input_run ->> 'request_digest';
begin
  if target_organization_id is null
    or input_run ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_generation_organization_mismatch' using errcode = '42501';
  end if;

  if auth.uid() is null or not private.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  ) then
    raise exception 'campaign_generation_forbidden' using errcode = '42501';
  end if;

  select run.* into existing
  from public.campaign_generation_runs run
  where run.organization_id = target_organization_id
    and run.campaign_id = (input_run ->> 'campaign_id')::uuid
    and run.idempotency_key = input_run ->> 'idempotency_key';

  if found then
    -- Same key, different request. Returning the old run would answer a
    -- question nobody asked; creating a new one would break the key's promise.
    if existing.request_digest is distinct from supplied_digest then
      raise exception 'campaign_generation_idempotency_conflict' using errcode = '22023';
    end if;
    return pg_catalog.jsonb_build_object(
      'run_id', existing.id, 'status', existing.status, 'replayed', true
    );
  end if;

  insert into public.campaign_generation_runs (
    organization_id, campaign_id, source_snapshot_id, kind, idempotency_key,
    request_digest, correlation_id, base_version_id, base_digest,
    operator_prompt, patch_scope
  ) values (
    target_organization_id,
    (input_run ->> 'campaign_id')::uuid,
    (input_run ->> 'source_snapshot_id')::uuid,
    input_run ->> 'kind',
    input_run ->> 'idempotency_key',
    supplied_digest,
    (input_run ->> 'correlation_id')::uuid,
    (input_run ->> 'base_version_id')::uuid,
    input_run ->> 'base_digest',
    input_run ->> 'operator_prompt',
    input_run ->> 'patch_scope'
  )
  returning id into saved_id;

  return pg_catalog.jsonb_build_object('run_id', saved_id, 'status', 'queued', 'replayed', false);
end;
$$;

revoke all on function public.enqueue_campaign_generation_run(uuid, jsonb) from public, anon;
grant execute on function public.enqueue_campaign_generation_run(uuid, jsonb) to authenticated;

/**
 * The worker's read of everything one run needs.
 *
 * Returned through an RPC rather than a table select so the instruction and the
 * pinned evidence are only reachable by a caller holding the run's claim token.
 */
create function public.load_campaign_generation_context(
  target_organization_id uuid,
  input_context jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.campaign_generation_runs;
  snapshot public.campaign_source_snapshots;
  campaign public.campaigns;
  latest_version_id uuid;
  base_version public.campaign_bundle_versions;
begin
  run := private.assert_campaign_generation_claim(
    target_organization_id,
    (input_context ->> 'run_id')::uuid,
    (input_context ->> 'claim_token')::uuid
  );

  select scoped.* into snapshot
  from public.campaign_source_snapshots scoped
  where scoped.organization_id = target_organization_id
    and scoped.id = run.source_snapshot_id;

  if not found then
    raise exception 'campaign_source_snapshot_not_found' using errcode = '42501';
  end if;

  select scoped.* into campaign
  from public.campaigns scoped
  where scoped.organization_id = target_organization_id and scoped.id = run.campaign_id;

  select version.id into latest_version_id
  from public.campaign_bundle_versions version
  where version.organization_id = target_organization_id
    and version.campaign_id = run.campaign_id
  order by version.version desc
  limit 1;

  if run.base_version_id is not null then
    select version.* into base_version
    from public.campaign_bundle_versions version
    where version.organization_id = target_organization_id
      and version.id = run.base_version_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'campaign_id', run.campaign_id,
    'source_snapshot_id', run.source_snapshot_id,
    'kind', run.kind,
    'facts', snapshot.facts,
    'assertions', snapshot.assertions,
    'brand_asset_version_ids', pg_catalog.to_jsonb(snapshot.brand_asset_version_ids),
    'campaign_title', campaign.title,
    'latest_version_id', latest_version_id,
    'operator_prompt', run.operator_prompt,
    'patch_scope', run.patch_scope,
    'base_version', case
      when base_version.id is null then 'null'::jsonb
      else pg_catalog.jsonb_build_object(
        'id', base_version.id,
        'digest', base_version.digest,
        'manifest', base_version.manifest,
        'source_snapshot_id', base_version.source_snapshot_id,
        'asset_storage_paths', coalesce(
          (
            select pg_catalog.jsonb_object_agg(asset.asset_key::text, asset.storage_path)
            from public.campaign_assets asset
            where asset.organization_id = target_organization_id
              and asset.bundle_version_id = base_version.id
          ),
          '{}'::jsonb
        )
      )
    end
  );
end;
$$;

revoke all on function public.load_campaign_generation_context(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.load_campaign_generation_context(uuid, jsonb) to service_role;
