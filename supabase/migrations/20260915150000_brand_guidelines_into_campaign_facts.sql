-- Give the brand rule keys their first producer.
--
-- `hardConstraints`, `softConventions` and `restrictedTerms` have been read
-- from `business_profiles.brand_context` since this function was written,
-- rendered into the image prompt by `reference-prompt.ts`, and checked by
-- `content-policy.ts`. Nothing has ever written them there, so every campaign
-- in every organization has been generated against three empty arrays.
--
-- They now come from `organization_brand_guidelines`, along with the palette.
--
-- `brand_context ->> 'voice'` is deliberately unchanged. Voice describes how a
-- brand sounds; rules constrain what it may say and show. Only the constraining
-- half moved, and the voice promotion added on 2026-09-14 keeps working.
--
-- Also adds `canonicalLogoVersionId`: the reference resolver already admits any
-- usable brand_mark asset, so an organization with three old logos in its
-- library had one chosen for it. This names the one that is actually its mark.
-- A pointer at a version that is not usable, or whose latest review is a
-- rejection, resolves fine and must still never reach a generation request.

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
  guidelines public.organization_brand_guidelines;
  primary_goal public.goals;
  baseline_source text;
  hard_rules jsonb;
  soft_rules jsonb;
  canonical_logo_version_id uuid;
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

  select scoped.* into guidelines
  from public.organization_brand_guidelines scoped
  where scoped.organization_id = target_organization_id;

  -- One pass, split by the strength the author chose. A rule's strength is
  -- never inferred here: an unmarked rule cannot be stored, so it cannot
  -- arrive.
  select
    coalesce(
      pg_catalog.jsonb_agg(rule.value ->> 'text')
        filter (where rule.value ->> 'strength' = 'hard'),
      '[]'::jsonb
    ),
    coalesce(
      pg_catalog.jsonb_agg(rule.value ->> 'text')
        filter (where rule.value ->> 'strength' = 'soft'),
      '[]'::jsonb
    )
  into hard_rules, soft_rules
  from pg_catalog.jsonb_array_elements(coalesce(guidelines.rules, '[]'::jsonb)) as rule(value);

  select logo.brand_asset_version_id into canonical_logo_version_id
  from public.organization_brand_logos logo
  where logo.organization_id = target_organization_id
    and logo.variant = 'primary'
    and exists (
      select 1
      from public.organization_brand_asset_versions version
      where version.organization_id = logo.organization_id
        and version.id = logo.brand_asset_version_id
        and version.is_usable
    )
    -- Only the latest review decides. An image rejected once and approved
    -- since is usable again, and treating any historical rejection as
    -- permanent would strand it.
    and coalesce(
      (
        select review.verdict
        from public.creative_asset_reviews review
        where review.organization_id = logo.organization_id
          and review.subject_kind = 'brand_asset_version'
          and review.subject_id = logo.brand_asset_version_id
        order by review.reviewed_at desc, review.id desc
        limit 1
      ),
      'none'
    ) <> 'rejected';

  select goal.* into primary_goal
  from public.goals goal
  where goal.organization_id = target_organization_id
    and goal.metric_key is not null
  order by goal.priority asc, goal.id asc
  limit 1;

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
      'hardConstraints', coalesce(hard_rules, '[]'::jsonb),
      'softConventions', coalesce(soft_rules, '[]'::jsonb),
      'restrictedTerms', coalesce(pg_catalog.to_jsonb(guidelines.restricted_terms), '[]'::jsonb),
      -- Null, never `{}`. An empty object reads downstream as "three colours,
      -- all unset", which is a different claim from "no palette".
      'palette', case
        when guidelines.palette is null or guidelines.palette = '{}'::jsonb then null
        else guidelines.palette
      end,
      'canonicalLogoVersionId', canonical_logo_version_id,
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
