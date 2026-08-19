-- Finding work that is due, and recording what actually published.
--
-- Two halves of the same problem. Scheduling writes an action run and hands it
-- to Trigger, but a dispatch that never arrives leaves an approved action
-- sitting queued for ever with nobody looking for it. The sweeper is the
-- recovery: Postgres holds the truth about what is due, and a lost dispatch
-- costs a delay rather than a campaign.
--
-- Exposure is the other end. A confirmed publication is the first fact the
-- measurement work will need, and it has to be written when it happens —
-- reconstructing "when did this go out" later from provider APIs is guesswork.

-- Due work ------------------------------------------------------------------

create index if not exists campaign_action_runs_due_idx
  on public.campaign_action_runs (scheduled_for)
  where status = 'queued';

create function public.list_due_campaign_action_runs(
  input_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  due jsonb;
begin
  if input_limit is null or input_limit < 1 or input_limit > 500 then
    raise exception 'campaign_dispatch_invalid_limit' using errcode = '22023';
  end if;

  -- Deliberately not organization-scoped: the sweeper runs for the platform
  -- and has no session. Every row it returns is handed straight back to the
  -- Tool Gateway, which re-checks tenancy, approval and capability before
  -- anything reaches a provider. Nothing here grants authority.
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'organization_id', run.organization_id,
        'campaign_id', run.campaign_id,
        'bundle_version_id', run.bundle_version_id,
        'action_run_id', run.id,
        'action_key', run.action_key,
        'scheduled_for', run.scheduled_for
      )
      order by run.scheduled_for
    ),
    '[]'::jsonb
  )
  into due
  from (
    select *
    from public.campaign_action_runs
    where status = 'queued'
      and scheduled_for <= pg_catalog.now()
    order by scheduled_for
    limit input_limit
  ) run;

  return due;
end;
$$;

revoke all on function public.list_due_campaign_action_runs(integer) from public, anon, authenticated;
grant execute on function public.list_due_campaign_action_runs(integer) to service_role;

-- Exposure ------------------------------------------------------------------

create table public.campaign_exposures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  bundle_version_id uuid not null,
  action_run_id uuid not null,

  -- The provider's own identifier for what published, and its own timestamp.
  -- Recorded rather than derived: our clock is not evidence about their post.
  external_reference text not null check (char_length(external_reference) between 1 and 200),
  provider_status text not null check (char_length(provider_status) between 1 and 60),
  published_at timestamptz not null,

  -- Metrics are not available the moment something publishes. This records the
  -- earliest a fetch is worth making, so collection does not poll into an
  -- empty window and record zeroes that look like measurements.
  metrics_eligible_at timestamptz not null,

  created_at timestamptz not null default now(),

  unique (organization_id, id),
  -- One exposure per action run. A second would double-count the same post.
  unique (organization_id, action_run_id),

  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, action_run_id)
    references public.campaign_action_runs (organization_id, id) on delete cascade
);

create index campaign_exposures_campaign_idx
  on public.campaign_exposures (organization_id, campaign_id, published_at desc);
create index campaign_exposures_eligible_idx
  on public.campaign_exposures (metrics_eligible_at)
  where metrics_eligible_at is not null;

alter table public.campaign_exposures enable row level security;
alter table public.campaign_exposures force row level security;

revoke all on public.campaign_exposures from anon, authenticated;

-- Members read their own exposures; nobody writes one from a session, because
-- an exposure is a claim about what a provider did.
grant select on public.campaign_exposures to authenticated;

create policy campaign_exposures_member_read
  on public.campaign_exposures
  for select to authenticated
  using (private.is_organization_member(organization_id));

-- An exposure is immutable. What published, and when, does not change.
create function private.reject_campaign_exposure_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'campaign_exposure_is_immutable' using errcode = '23514';
end;
$$;

create trigger campaign_exposures_immutable
  before update or delete on public.campaign_exposures
  for each row execute function private.reject_campaign_exposure_mutation();

create function public.record_campaign_exposure(
  target_organization_id uuid,
  input_exposure jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.campaign_action_runs;
  saved_id uuid;
begin
  select existing.* into run
  from public.campaign_action_runs existing
  where existing.organization_id = target_organization_id
    and existing.id = (input_exposure ->> 'action_run_id')::uuid;

  if not found then
    raise exception 'campaign_exposure_action_run_not_found' using errcode = '42501';
  end if;

  -- Only a run the gateway has confirmed or reconciled has published anything.
  -- Writing an exposure for anything else would assert a post exists on the
  -- strength of a worker's optimism rather than a provider receipt.
  if run.status not in ('confirmed', 'reconciled') then
    raise exception 'campaign_exposure_requires_confirmed_run' using errcode = '22023';
  end if;

  insert into public.campaign_exposures (
    organization_id, campaign_id, bundle_version_id, action_run_id,
    external_reference, provider_status, published_at, metrics_eligible_at
  ) values (
    target_organization_id,
    run.campaign_id,
    run.bundle_version_id,
    run.id,
    input_exposure ->> 'external_reference',
    input_exposure ->> 'provider_status',
    (input_exposure ->> 'published_at')::timestamptz,
    (input_exposure ->> 'metrics_eligible_at')::timestamptz
  )
  on conflict (organization_id, action_run_id) do nothing
  returning id into saved_id;

  if saved_id is null then
    -- Already recorded. A replayed dispatch must not double-count the post.
    return pg_catalog.jsonb_build_object('outcome', 'already_recorded');
  end if;

  return pg_catalog.jsonb_build_object('outcome', 'recorded', 'exposure_id', saved_id);
end;
$$;

revoke all on function public.record_campaign_exposure(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_campaign_exposure(uuid, jsonb) to service_role;

comment on table public.campaign_exposures is
  'What actually published, per action run, with the provider''s own identifier and timestamp. Immutable; written only after the Tool Gateway confirms or reconciles the run.';
