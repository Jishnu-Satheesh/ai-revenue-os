-- Let a variants run report success.
--
-- `20260818110000` allows a succeeded variants run to name no version. This is
-- the other half: the completion function validated the version unconditionally
-- and would reject a null before the constraint ever saw it.

create or replace function public.complete_campaign_generation_run(
  target_organization_id uuid,
  input_completion jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.campaign_generation_runs;
  produced_version uuid := (input_completion ->> 'result_version_id')::uuid;
begin
  run := private.assert_campaign_generation_claim(
    target_organization_id,
    (input_completion ->> 'run_id')::uuid,
    (input_completion ->> 'claim_token')::uuid
  );

  -- A variants run produces creative inside an existing version and names no
  -- result of its own, so there is no version to check ownership of. Every
  -- other kind still must name one that belongs to its campaign, or a run that
  -- published into a different campaign would be untraceable afterwards.
  if run.kind <> 'variants' and not exists (
    select 1 from public.campaign_bundle_versions version
    where version.organization_id = target_organization_id
      and version.id = produced_version
      and version.campaign_id = run.campaign_id
  ) then
    raise exception 'campaign_generation_version_mismatch' using errcode = '22023';
  end if;

  -- Guarded rather than trusted: a variants run that somehow arrived with a
  -- version id would otherwise write it and claim to have produced something.
  if run.kind = 'variants' then
    produced_version := null;
  end if;

  update public.campaign_generation_runs
  set status = 'succeeded',
      result_version_id = produced_version,
      claim_token = null,
      lease_expires_at = null,
      cost_minor = (input_completion ->> 'cost_minor')::bigint,
      updated_at = pg_catalog.now()
  where organization_id = target_organization_id and id = run.id;
end;
$$;

revoke all on function public.complete_campaign_generation_run(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_campaign_generation_run(uuid, jsonb) to service_role;
