-- Creating a campaign is one act, not four writes.
--
-- A brief, a campaign, and a pinned source snapshot have to appear together or
-- not at all: a campaign with no snapshot cannot be generated from, and a
-- snapshot with no campaign is unreachable rubbish. Doing it in the request
-- path as separate statements would leave both behind whenever a connection
-- dropped between them.

alter table public.campaigns
  add column idempotency_key text check (char_length(idempotency_key) between 8 and 200);

-- One business key, one campaign, forever. A retried submit returns the
-- campaign it already made rather than a second one.
create unique index campaigns_idempotency_key_idx
  on public.campaigns (organization_id, idempotency_key)
  where idempotency_key is not null;

create function public.create_campaign_with_source(
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

  -- The evidence generation is allowed to use, pinned now. Read live later, an
  -- approval would stop being explicable the moment the brand voice changed.
  insert into public.campaign_source_snapshots (
    organization_id, campaign_id, facts, brand_asset_version_ids, assertions
  ) values (
    target_organization_id,
    campaign_id,
    coalesce(input_campaign -> 'facts', '{}'::jsonb),
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

revoke all on function public.create_campaign_with_source(uuid, jsonb) from public, anon;
grant execute on function public.create_campaign_with_source(uuid, jsonb) to authenticated;

/** The verified facts a new campaign pins, assembled server-side. */
create function public.load_campaign_creation_facts(target_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization public.organizations;
  profile public.business_profiles;
begin
  if auth.uid() is null or not private.is_organization_member(target_organization_id) then
    raise exception 'campaign_facts_forbidden' using errcode = '42501';
  end if;

  select scoped.* into organization
  from public.organizations scoped where scoped.id = target_organization_id;

  select scoped.* into profile
  from public.business_profiles scoped
  where scoped.organization_id = target_organization_id;

  return pg_catalog.jsonb_build_object(
    'facts', pg_catalog.jsonb_build_object(
      'organizationProfile', organization.name,
      'currency', organization.base_currency,
      'timeZone', organization.default_timezone,
      -- Absent rather than invented. A missing brand voice becomes a named
      -- needs_data gap at generation, which an operator can act on.
      'brandVoice', profile.brand_voice,
      'hardConstraints', '[]'::jsonb,
      'softConventions', '[]'::jsonb,
      'restrictedTerms', '[]'::jsonb,
      'syntheticAssetsAllowed', false
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
