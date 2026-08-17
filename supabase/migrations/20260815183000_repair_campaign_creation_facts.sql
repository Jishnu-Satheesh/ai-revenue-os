-- Repair: `load_campaign_creation_facts` referenced `business_profiles.brand_voice`,
-- which does not exist. plpgsql does not resolve a record field until the
-- function runs, so the previous migration applied cleanly and would have
-- failed on the first real call.
--
-- The brand voice lives inside the `brand_context` JSON document, alongside the
-- claims and restrictions a campaign must not contradict. Reading the whole
-- document is also more honest than plucking one field: what generation needs
-- from brand context will grow, and a snapshot that pinned only one key would
-- silently stop being the evidence it claims to be.

create or replace function public.load_campaign_creation_facts(target_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization public.organizations;
  brand_context jsonb := '{}'::jsonb;
begin
  if auth.uid() is null or not private.is_organization_member(target_organization_id) then
    raise exception 'campaign_facts_forbidden' using errcode = '42501';
  end if;

  select scoped.* into organization
  from public.organizations scoped where scoped.id = target_organization_id;

  if not found then
    raise exception 'campaign_facts_organization_not_found' using errcode = '42501';
  end if;

  select coalesce(profile.brand_context, '{}'::jsonb) into brand_context
  from public.business_profiles profile
  where profile.organization_id = target_organization_id;

  return pg_catalog.jsonb_build_object(
    'facts', pg_catalog.jsonb_build_object(
      'organizationProfile', organization.name,
      'currency', organization.base_currency,
      'timeZone', organization.default_timezone,
      -- Absent rather than invented. A missing brand voice becomes a named
      -- `needs_data` gap at generation, which an operator can act on; a
      -- fabricated one would produce confident creative nobody approved.
      'brandVoice', brand_context ->> 'voice',
      'hardConstraints', coalesce(brand_context -> 'hard_constraints', '[]'::jsonb),
      'softConventions', coalesce(brand_context -> 'soft_conventions', '[]'::jsonb),
      'restrictedTerms', coalesce(brand_context -> 'restricted_terms', '[]'::jsonb),
      'syntheticAssetsAllowed',
        coalesce((brand_context ->> 'synthetic_assets_allowed')::boolean, false)
    ),
    'brand_asset_version_ids', coalesce(
      (
        select pg_catalog.jsonb_agg(version.id)
        from public.organization_brand_asset_versions version
        where version.organization_id = target_organization_id and version.is_usable
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.load_campaign_creation_facts(uuid) from public, anon;
grant execute on function public.load_campaign_creation_facts(uuid) to authenticated;
