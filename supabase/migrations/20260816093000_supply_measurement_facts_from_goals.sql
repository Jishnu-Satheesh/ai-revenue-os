-- Give the required measurement evidence an actual producer.
--
-- `buildGenerationContext` requires `primaryMetricKey` and `baselineSource`,
-- but `load_campaign_creation_facts` never supplied either. Every campaign in
-- every organization therefore reported them missing, forever — a required
-- input with nothing on the other end of the wire.
--
-- They come from the organization's goals, which is where a primary metric and
-- its baseline already live. The highest-priority goal that names a metric wins
-- (priority 1 is highest), with the goal's own id as the tie-break so the
-- answer is stable rather than whichever row the planner happened to return.
--
-- A goal with an `unknown` baseline supplies no baseline source. That keeps the
-- honest failure honest: generation should say "we have no baseline" rather
-- than quietly measure against a number nobody established.

create or replace function public.load_campaign_creation_facts(
  target_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization public.organizations;
  brand_context jsonb := '{}'::jsonb;
  primary_goal public.goals;
  baseline_source text;
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

  select goal.* into primary_goal
  from public.goals goal
  where goal.organization_id = target_organization_id
    and goal.metric_key is not null
  order by goal.priority asc, goal.id asc
  limit 1;

  -- Named after where the number actually came from, so a reader of the
  -- measurement plan can tell a measured baseline from an estimated one.
  if primary_goal.id is not null then
    baseline_source := case primary_goal.baseline_status
      when 'known' then 'goal_baseline_measured:' || primary_goal.metric_key
      when 'estimated' then 'goal_baseline_estimated:' || primary_goal.metric_key
      else null
    end;
  end if;

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
        coalesce((brand_context ->> 'synthetic_assets_allowed')::boolean, false),
      'primaryMetricKey', primary_goal.metric_key,
      'baselineSource', baseline_source
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
