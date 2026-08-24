-- Rejected reference bytes are not positive candidates, but the deterministic
-- resolver needs their asset-specific review evidence to populate its bounded
-- `avoid` set. Return all usable, unarchived versions and leave positive versus
-- avoid routing to the versioned domain resolver.

create or replace function public.read_reference_candidates(target_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  candidate_rows jsonb;
  rejected_reason_rows jsonb;
  caller_database_role text := pg_catalog.current_setting('role', true);
begin
  if target_organization_id is null then
    raise exception 'reference_candidates_organization_required' using errcode = '23514';
  end if;

  if caller_database_role is distinct from 'service_role'
    and (
      (select auth.uid()) is null
      or not private.has_organization_permission(target_organization_id, 'asset.read')
    ) then
    raise exception 'reference_candidates_forbidden' using errcode = '42501';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'brand_asset_id', asset.id,
        'brand_asset_version_id', version.id,
        'label', asset.label,
        'asset_role', asset.asset_role,
        'conditioning_roles', pg_catalog.to_jsonb(asset.conditioning_roles),
        'tags', pg_catalog.to_jsonb(asset.tags),
        'scripts', pg_catalog.to_jsonb(asset.scripts),
        'ownership', asset.ownership,
        'version', version.version,
        'storage_path', version.storage_path,
        'content_hash', version.content_hash,
        'mime_type', version.mime_type,
        'byte_size', version.byte_size,
        'width_px', version.width_px,
        'height_px', version.height_px,
        'current_verdict', latest_review.verdict,
        'current_reason_codes', coalesce(
          pg_catalog.to_jsonb(latest_review.reason_codes),
          '[]'::jsonb
        ),
        'current_reviewed_at', latest_review.reviewed_at
      ) order by asset.id asc, version.version desc, version.id asc
    ),
    '[]'::jsonb
  )
  into candidate_rows
  from public.organization_brand_assets asset
  join public.organization_brand_asset_versions version
    on version.organization_id = asset.organization_id
   and version.brand_asset_id = asset.id
  left join lateral (
    select review.verdict, review.reason_codes, review.reviewed_at
    from public.creative_asset_reviews review
    where review.organization_id = target_organization_id
      and review.subject_kind = 'brand_asset_version'
      and review.subject_id = version.id
    order by review.reviewed_at desc, review.id desc
    limit 1
  ) latest_review on true
  where asset.organization_id = target_organization_id
    and asset.archived_at is null
    and version.is_usable;

  with current_reviews as (
    select distinct on (review.subject_kind, review.subject_id)
      review.subject_kind,
      review.subject_id,
      review.verdict,
      review.reason_codes
    from public.creative_asset_reviews review
    where review.organization_id = target_organization_id
    order by
      review.subject_kind,
      review.subject_id,
      review.reviewed_at desc,
      review.id desc
  ), distinct_codes as (
    select distinct supplied.code
    from current_reviews current_review
    cross join lateral pg_catalog.unnest(current_review.reason_codes) as supplied(code)
    where current_review.verdict = 'rejected'
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'code', reason.key,
        'description', reason.description
      ) order by reason.key
    ),
    '[]'::jsonb
  )
  into rejected_reason_rows
  from distinct_codes code
  join public.creative_review_reasons reason on reason.key = code.code;

  return pg_catalog.jsonb_build_object(
    'candidates', candidate_rows,
    'rejected_reasons', rejected_reason_rows
  );
end;
$$;

revoke all on function public.read_reference_candidates(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_reference_candidates(uuid)
  to authenticated, service_role;
