-- Every provider object a paid action created, recorded as it is created.
--
-- A capped experiment is four sequential provider writes: campaign, ad set,
-- creative, ad. If the third fails, a retry that starts from the beginning
-- creates a second campaign and a second ad set — and the first pair still
-- exists, still attached to an ad account, still able to spend. Nothing in the
-- Tool Gateway can prevent that, because from its side one action was attempted
-- once.
--
-- So each id is written the moment the provider returns it, and a retry resumes
-- from what is already here. This table is the difference between a retry that
-- continues and a retry that duplicates.

create table public.campaign_ads_objects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action_run_id uuid not null,

  object_type text not null check (
    object_type in ('campaign', 'ad_set', 'ad_creative', 'ad')
  ),
  -- The provider's own identifier. Never ours: this exists to say what is out
  -- there under someone's ad account.
  external_id text not null check (char_length(external_id) between 1 and 200),

  -- What the object was created as. A paid object is created paused and
  -- activated last, so a partial build leaves nothing able to spend.
  created_status text not null check (created_status in ('PAUSED', 'ACTIVE')),

  created_at timestamptz not null default now(),

  unique (organization_id, id),
  -- One object of each kind per action run. A second campaign for the same
  -- action is precisely the duplicate this table exists to make impossible.
  unique (organization_id, action_run_id, object_type),

  foreign key (organization_id, action_run_id)
    references public.campaign_action_runs (organization_id, id) on delete cascade
);

create index campaign_ads_objects_run_idx
  on public.campaign_ads_objects (organization_id, action_run_id);

alter table public.campaign_ads_objects enable row level security;
alter table public.campaign_ads_objects force row level security;

revoke all on public.campaign_ads_objects from anon, authenticated;
grant select on public.campaign_ads_objects to authenticated;

create policy campaign_ads_objects_member_read
  on public.campaign_ads_objects
  for select to authenticated
  using (private.is_organization_member(organization_id));

-- Immutable. What was created, and under what id, does not change.
create function private.reject_ads_object_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'campaign_ads_object_is_immutable' using errcode = '23514';
end;
$$;

create trigger campaign_ads_objects_immutable
  before update or delete on public.campaign_ads_objects
  for each row execute function private.reject_ads_object_mutation();

-- Record one created object, or report that it already exists ---------------
create function public.record_campaign_ads_object(
  target_organization_id uuid,
  input_object jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  existing_external text;
begin
  insert into public.campaign_ads_objects (
    organization_id, action_run_id, object_type, external_id, created_status
  ) values (
    target_organization_id,
    (input_object ->> 'action_run_id')::uuid,
    input_object ->> 'object_type',
    input_object ->> 'external_id',
    input_object ->> 'created_status'
  )
  on conflict (organization_id, action_run_id, object_type) do nothing
  returning id into saved_id;

  if saved_id is null then
    -- Already built. The caller resumes from the existing id rather than
    -- creating a second object of the same kind.
    select object.external_id into existing_external
    from public.campaign_ads_objects object
    where object.organization_id = target_organization_id
      and object.action_run_id = (input_object ->> 'action_run_id')::uuid
      and object.object_type = input_object ->> 'object_type';

    return pg_catalog.jsonb_build_object(
      'outcome', 'already_created', 'external_id', existing_external
    );
  end if;

  return pg_catalog.jsonb_build_object('outcome', 'recorded', 'object_id', saved_id);
end;
$$;

revoke all on function public.record_campaign_ads_object(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_campaign_ads_object(uuid, jsonb) to service_role;

-- What has already been built for an action run -----------------------------
create function public.read_campaign_ads_objects(
  target_organization_id uuid,
  target_action_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return coalesce(
    (select pg_catalog.jsonb_object_agg(object.object_type, object.external_id)
     from public.campaign_ads_objects object
     where object.organization_id = target_organization_id
       and object.action_run_id = target_action_run_id),
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.read_campaign_ads_objects(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_campaign_ads_objects(uuid, uuid) to service_role;

comment on table public.campaign_ads_objects is
  'Provider objects created for a paid action, recorded as each id is returned. A retry resumes from these rather than creating a second campaign or ad set.';
