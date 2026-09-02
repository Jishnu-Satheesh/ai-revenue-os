-- The fast loop's ledger and its only outward action.
--
-- Task 20, in one migration. Everything here is additive: a new append-only
-- ledger, the variant state transitions that a pause and an operator resume
-- need, the pause-run substrate that lets a pause flow through the Tool Gateway
-- as its own action run, and the worker-only readers the loop evaluates from.
--
-- The wall (ADR 0021) is enforced by omission. None of the functions here
-- write to the evidence loop's exposure, observation, or outcome records, and
-- none of them grants the allocation loop a path to those tables. A test below
-- asserts this at the function-definition level.

-- ---------------------------------------------------------------------------
-- The allocation ledger
-- ---------------------------------------------------------------------------

create table public.campaign_allocation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  cycle_id uuid not null,
  variant_id uuid not null,

  -- Which rule, in which version. Versioned so a later rule change never
  -- rewrites what an earlier cycle decided.
  rule_key text not null check (char_length(rule_key) between 1 and 120),
  rule_version text not null check (char_length(rule_version) between 1 and 40),

  -- What the rule saw and what it was compared against. Null when the rule did
  -- not apply (below the exposure floor, grade insufficient, no data yet).
  observed_value numeric,
  threshold numeric,

  -- Present only on a margin rule: the figure compared, and how trustworthy it
  -- was. Every other rule leaves both null.
  resolved_margin_minor bigint,
  resolved_margin_grade text check (
    resolved_margin_grade in ('measured', 'derived', 'estimated', 'assumed')
  ),

  action text not null check (action in ('pause', 'no_action')),
  reason_code text not null check (char_length(reason_code) between 1 and 120),

  -- Who decided. 'agent' for the loop; a user uuid for anything an operator did.
  actor text not null check (
    actor = 'agent' or actor ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),

  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  unique (organization_id, id),

  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, variant_id)
    references public.campaign_creative_variants (organization_id, id) on delete cascade
);

create index campaign_allocation_events_campaign_idx
  on public.campaign_allocation_events (organization_id, campaign_id, occurred_at desc);
create index campaign_allocation_events_variant_idx
  on public.campaign_allocation_events (organization_id, variant_id, occurred_at desc);
create index campaign_allocation_events_cycle_idx
  on public.campaign_allocation_events (organization_id, cycle_id);

alter table public.campaign_allocation_events enable row level security;
alter table public.campaign_allocation_events force row level security;

revoke all on public.campaign_allocation_events from anon, authenticated;
grant select on public.campaign_allocation_events to authenticated;

create policy campaign_allocation_events_member_read
  on public.campaign_allocation_events
  for select to authenticated
  using (private.is_organization_member(organization_id));

comment on table public.campaign_allocation_events is
  'One decision per evaluated variant per rule, appended every cycle. A decision not to act is recorded exactly like a pause.';

-- Append-only. A decision once recorded is not rewritten, because a ledger that
-- can be edited is a ledger nobody can audit.
create function private.reject_campaign_allocation_event_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'campaign_allocation_event_is_append_only' using errcode = '23514';
end;
$$;

create trigger campaign_allocation_events_append_only
  before update or delete on public.campaign_allocation_events
  for each row execute function private.reject_campaign_allocation_event_mutation();

-- Append one decision --------------------------------------------------------

create function public.append_campaign_allocation_event(
  target_organization_id uuid,
  input_event jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
begin
  if target_organization_id is null
    or input_event ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_allocation_organization_mismatch' using errcode = '42501';
  end if;

  insert into public.campaign_allocation_events (
    organization_id, campaign_id, cycle_id, variant_id,
    rule_key, rule_version, observed_value, threshold,
    resolved_margin_minor, resolved_margin_grade, action, reason_code, actor,
    occurred_at
  ) values (
    target_organization_id,
    (input_event ->> 'campaign_id')::uuid,
    (input_event ->> 'cycle_id')::uuid,
    (input_event ->> 'variant_id')::uuid,
    input_event ->> 'rule_key',
    input_event ->> 'rule_version',
    (input_event ->> 'observed_value')::numeric,
    (input_event ->> 'threshold')::numeric,
    (input_event ->> 'resolved_margin_minor')::bigint,
    input_event ->> 'resolved_margin_grade',
    input_event ->> 'action',
    input_event ->> 'reason_code',
    input_event ->> 'actor',
    coalesce((input_event ->> 'at')::timestamptz, pg_catalog.now())
  )
  returning id into saved_id;

  return saved_id;
end;
$$;

revoke all on function public.append_campaign_allocation_event(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.append_campaign_allocation_event(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Variant state transitions: pause and resume
-- ---------------------------------------------------------------------------

-- Task 15 made a variant immutable except that "state moves through its own
-- RPC". That RPC never existed, so state could not move at all. The new trigger
-- keeps every other column frozen and whitelists exactly the transitions the
-- loop and an operator may make.
create or replace function private.reject_campaign_variant_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'campaign_creative_variant_is_immutable' using errcode = '23514';
  end if;

  if pg_catalog.to_jsonb(new) - 'state' is distinct from pg_catalog.to_jsonb(old) - 'state' then
    raise exception 'campaign_creative_variant_is_immutable' using errcode = '23514';
  end if;

  if new.state = old.state then
    raise exception 'campaign_creative_variant_is_immutable' using errcode = '23514';
  end if;

  if not (
    (old.state = 'published' and new.state in ('paused_by_agent', 'paused_by_operator'))
    or (old.state in ('paused_by_agent', 'paused_by_operator') and new.state = 'published')
  ) then
    raise exception 'campaign_variant_state_transition_not_allowed' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- The agent-side pause. It only marks the variant; the provider write goes
-- through the Tool Gateway as its own action run, and the reason lives in the
-- allocation ledger, not here.
create function public.pause_campaign_variant(
  target_organization_id uuid,
  input_pause jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  variant public.campaign_creative_variants;
begin
  if target_organization_id is null
    or input_pause ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_allocation_organization_mismatch' using errcode = '42501';
  end if;

  select v.* into variant
  from public.campaign_creative_variants v
  where v.organization_id = target_organization_id
    and v.id = (input_pause ->> 'variant_id')::uuid
  for update;

  if not found then
    raise exception 'campaign_allocation_variant_not_found' using errcode = '42501';
  end if;

  if variant.state = 'paused_by_agent' then
    return pg_catalog.jsonb_build_object('outcome', 'already_paused');
  end if;

  if variant.state <> 'published' then
    return pg_catalog.jsonb_build_object('outcome', 'not_pausable');
  end if;

  update public.campaign_creative_variants
  set state = 'paused_by_agent'
  where organization_id = target_organization_id and id = variant.id;

  return pg_catalog.jsonb_build_object('outcome', 'paused');
end;
$$;

revoke all on function public.pause_campaign_variant(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pause_campaign_variant(uuid, jsonb) to service_role;

-- Operator-only resume, recorded with actor and time. There is deliberately no
-- service-role resume: only an authenticated user with an approving role may
-- restart a paused variant, which is the whole point of ADR 0021.
create table public.campaign_variant_resumes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  variant_id uuid not null,
  from_state text not null check (from_state in ('paused_by_agent', 'paused_by_operator')),
  resumed_by uuid not null references auth.users(id) on delete restrict,
  resumed_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, variant_id)
    references public.campaign_creative_variants (organization_id, id) on delete cascade
);

create index campaign_variant_resumes_variant_idx
  on public.campaign_variant_resumes (organization_id, variant_id, resumed_at desc);

alter table public.campaign_variant_resumes enable row level security;
alter table public.campaign_variant_resumes force row level security;

revoke all on public.campaign_variant_resumes from anon, authenticated;
grant select on public.campaign_variant_resumes to authenticated;

create policy campaign_variant_resumes_member_read
  on public.campaign_variant_resumes
  for select to authenticated
  using (private.is_organization_member(organization_id));

create function public.resume_campaign_variant(
  target_organization_id uuid,
  input_resume jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  variant public.campaign_creative_variants;
begin
  if target_organization_id is null
    or input_resume ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_resume_organization_mismatch' using errcode = '42501';
  end if;

  if auth.uid() is null or not private.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  ) then
    raise exception 'campaign_resume_forbidden' using errcode = '42501';
  end if;

  select v.* into variant
  from public.campaign_creative_variants v
  where v.organization_id = target_organization_id
    and v.id = (input_resume ->> 'variant_id')::uuid
  for update;

  if not found then
    raise exception 'campaign_resume_variant_not_found' using errcode = '42501';
  end if;

  if variant.state not in ('paused_by_agent', 'paused_by_operator') then
    return pg_catalog.jsonb_build_object('outcome', 'not_paused');
  end if;

  update public.campaign_creative_variants
  set state = 'published'
  where organization_id = target_organization_id and id = variant.id;

  insert into public.campaign_variant_resumes (
    organization_id, variant_id, from_state, resumed_by
  ) values (
    target_organization_id, variant.id, variant.state, auth.uid()
  );

  return pg_catalog.jsonb_build_object('outcome', 'resumed');
end;
$$;

revoke all on function public.resume_campaign_variant(uuid, jsonb) from public, anon;
grant execute on function public.resume_campaign_variant(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Pause runs: the substrate that lets a pause be its own action run
-- ---------------------------------------------------------------------------

create table public.campaign_pause_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pause_action_run_id uuid not null,
  target_action_run_id uuid not null,
  depth text not null check (depth in ('ad', 'experiment')),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, pause_action_run_id),
  foreign key (organization_id, pause_action_run_id)
    references public.campaign_action_runs (organization_id, id) on delete cascade,
  foreign key (organization_id, target_action_run_id)
    references public.campaign_action_runs (organization_id, id) on delete cascade
);

create index campaign_pause_runs_target_idx
  on public.campaign_pause_runs (organization_id, target_action_run_id);

alter table public.campaign_pause_runs enable row level security;
alter table public.campaign_pause_runs force row level security;

revoke all on public.campaign_pause_runs from anon, authenticated;
grant select on public.campaign_pause_runs to authenticated;

create policy campaign_pause_runs_member_read
  on public.campaign_pause_runs
  for select to authenticated
  using (private.is_organization_member(organization_id));

-- Create a pause action run for a variant, resolving the build run that created
-- the ad. The pause run carries a synthetic action key: the claim path below
-- recognizes it as a pause from this table and skips the channel-action and
-- reservation checks that a spending action needs.
create function public.create_campaign_pause_run(
  target_organization_id uuid,
  input_pause jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_run public.campaign_action_runs;
  pause_run_id uuid := pg_catalog.gen_random_uuid();
begin
  if target_organization_id is null
    or input_pause ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_pause_organization_mismatch' using errcode = '42501';
  end if;

  select r.* into target_run
  from public.campaign_creative_variants v
  join public.campaign_channel_actions a
    on a.organization_id = v.organization_id
   and a.bundle_version_id = v.bundle_version_id
   and a.direction_key = v.direction_key
  join public.campaign_action_runs r
    on r.organization_id = a.organization_id
   and r.bundle_version_id = a.bundle_version_id
   and r.action_key = a.action_key
  where v.organization_id = target_organization_id
    and v.id = (input_pause ->> 'variant_id')::uuid
  order by r.scheduled_for desc
  limit 1
  for update of r;

  if not found then
    raise exception 'campaign_pause_target_not_found' using errcode = '42501';
  end if;

  -- A pause can only name objects a confirmed build actually created.
  if target_run.status not in ('confirmed', 'reconciled') then
    return pg_catalog.jsonb_build_object('outcome', 'target_not_confirmed');
  end if;

  insert into public.campaign_action_runs (
    id, organization_id, campaign_id, bundle_version_id, action_key, scheduled_for
  ) values (
    pause_run_id, target_organization_id, target_run.campaign_id,
    target_run.bundle_version_id, pg_catalog.gen_random_uuid(), pg_catalog.now()
  );

  insert into public.campaign_pause_runs (
    organization_id, pause_action_run_id, target_action_run_id, depth
  ) values (
    target_organization_id, pause_run_id, target_run.id,
    coalesce(input_pause ->> 'depth', 'ad')
  );

  return pg_catalog.jsonb_build_object('outcome', 'created', 'pause_action_run_id', pause_run_id);
end;
$$;

revoke all on function public.create_campaign_pause_run(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_campaign_pause_run(uuid, jsonb) to service_role;

-- What a pause action run actually pauses. This is the pause adapter's request
-- loader: it turns a pause run id into the target build run and depth.
create function public.read_campaign_pause_request(
  target_organization_id uuid,
  target_pause_action_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return (
    select pg_catalog.jsonb_build_object(
      'target_action_run_id', pr.target_action_run_id,
      'depth', pr.depth
    )
    from public.campaign_pause_runs pr
    where pr.organization_id = target_organization_id
      and pr.pause_action_run_id = target_pause_action_run_id
  );
end;
$$;

revoke all on function public.read_campaign_pause_request(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_campaign_pause_request(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Workers' readers
-- ---------------------------------------------------------------------------

-- The live variants a campaign still has in flight, with their own diagnostics.
-- A metric with no observed rows is null, never zero: the loop must not read an
-- absence as a measurement.
create function public.read_campaign_allocation_candidates(
  target_organization_id uuid,
  target_campaign_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return coalesce(
    (select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'variant_id', v.id,
        'channel', v.channel,
        'impressions', sums.impressions,
        'clicks', sums.clicks,
        'spend_minor', sums.spend_minor
      ) order by v.total_ordinal
    )
    from public.campaign_creative_variants v
    left join lateral (
      select
        pg_catalog.sum(case when d.key = 'delivery.impressions' then m.value_numerator end) as impressions,
        pg_catalog.sum(case when d.key = 'delivery.clicks' then m.value_numerator end) as clicks,
        pg_catalog.sum(case when d.key = 'delivery.spend' then m.value_numerator end) as spend_minor
      from public.campaign_metric_observations o
      join public.normalized_metrics m on m.id = o.normalized_metric_id
      join public.metric_definitions d on d.id = o.metric_definition_id
      where o.organization_id = target_organization_id
        and o.variant_id = v.id
        and o.superseded_by_id is null
        and o.presence = 'observed'
    ) sums on true
    where v.organization_id = target_organization_id
      and v.campaign_id = target_campaign_id
      and v.state = 'published'
    ), '[]'::jsonb
  );
end;
$$;

revoke all on function public.read_campaign_allocation_candidates(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_campaign_allocation_candidates(uuid, uuid) to service_role;

-- The channel's contribution margin, or null when the grade is insufficient.
-- An indicative margin is a bound, not a figure, so it is never returned as a
-- scalar the floor rule could compare.
create function public.read_campaign_channel_margin(
  target_organization_id uuid,
  target_channel text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.channel_economics_entries;
  resolved_grade text;
begin
  select e.* into entry
  from public.channel_economics_entries e
  where e.organization_id = target_organization_id
    and e.channel = target_channel
    and e.completeness_grade <> 'indicative'
    and e.contribution_margin_minor is not null
  order by e.period_end desc, e.computed_at desc
  limit 1;

  if not found then
    return null;
  end if;

  if entry.margin_source = 'reported' then
    resolved_grade := entry.reported_quality_tier;
  else
    -- The exact weakest component tier, so the ledger records how trustworthy
    -- the compared figure actually was.
    select case pg_catalog.min(ranked.rank)
      when 4 then 'measured' when 3 then 'derived' when 2 then 'estimated' when 1 then 'assumed'
    end into resolved_grade
    from (
      select case c.quality_tier
        when 'measured' then 4 when 'derived' then 3 when 'estimated' then 2 when 'assumed' then 1 else 0
      end as rank
      from public.channel_economics_components c
      where c.organization_id = target_organization_id
        and c.entry_id = entry.id
    ) ranked;
  end if;

  if resolved_grade is null then
    resolved_grade := 'estimated';
  end if;

  return pg_catalog.jsonb_build_object(
    'contribution_margin_minor', entry.contribution_margin_minor,
    'resolved_margin_grade', resolved_grade,
    'currency', entry.currency
  );
end;
$$;

revoke all on function public.read_campaign_channel_margin(uuid, text)
  from public, anon, authenticated;
grant execute on function public.read_campaign_channel_margin(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- The Tool Gateway claim, taught to recognize a pause
-- ---------------------------------------------------------------------------
--
-- A pause is a provider write with no money attached, so it must pass the
-- gateway's approval and capability checks but must never reserve budget or be
-- matched against a channel action. The rest of the function is byte-for-byte
-- the claim path Task 17 shipped; the only change is the pause branch.

create or replace function public.claim_campaign_action(
  target_organization_id uuid,
  input_claim jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.campaign_action_runs;
  campaign public.campaigns;
  approval public.campaign_approvals;
  version public.campaign_bundle_versions;
  action public.campaign_channel_actions;
  latest_version_id uuid;
  grant_row public.integration_capability_grants;
  committed bigint;
  reservation bigint;
  token uuid := gen_random_uuid();
  codes text[] := '{}';
  asserted jsonb := coalesce(input_claim -> 'asserted_facts', '{}'::jsonb);
  completed_receipt uuid;
  unknown_invocation uuid;
  is_pause boolean := false;
begin
  if target_organization_id is null
    or input_claim ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'tool_gateway_organization_mismatch' using errcode = '42501';
  end if;

  select existing.* into run
  from public.campaign_action_runs existing
  where existing.organization_id = target_organization_id
    and existing.id = (input_claim ->> 'action_run_id')::uuid
  for update;

  if not found then
    raise exception 'tool_gateway_action_run_not_found' using errcode = '42501';
  end if;

  -- A pause run is named by the campaign_pause_runs row that created it. It is
  -- the one kind of action run that spends nothing and matches no channel action.
  select exists (
    select 1 from public.campaign_pause_runs pr
    where pr.organization_id = target_organization_id
      and pr.pause_action_run_id = run.id
  ) into is_pause;

  select receipt.id into completed_receipt
  from public.provider_receipts receipt
  join public.tool_invocations invocation
    on invocation.organization_id = receipt.organization_id
   and invocation.id = receipt.invocation_id
  where invocation.organization_id = target_organization_id
    and invocation.action_run_id = run.id
    and invocation.status = 'succeeded'
  limit 1;

  if completed_receipt is not null then
    return pg_catalog.jsonb_build_object('outcome', 'already_completed', 'receipt_id', completed_receipt);
  end if;

  select invocation.id into unknown_invocation
  from public.tool_invocations invocation
  where invocation.organization_id = target_organization_id
    and invocation.action_run_id = run.id
    and invocation.status = 'unknown'
  limit 1;

  if unknown_invocation is not null then
    return pg_catalog.jsonb_build_object(
      'outcome', 'provider_outcome_unknown', 'invocation_id', unknown_invocation
    );
  end if;

  if run.status = 'claimed' and run.lease_expires_at > pg_catalog.now() then
    return pg_catalog.jsonb_build_object('outcome', 'already_claimed');
  end if;

  select scoped.* into campaign from public.campaigns scoped
  where scoped.organization_id = target_organization_id and scoped.id = run.campaign_id
  for update;

  select scoped.* into version from public.campaign_bundle_versions scoped
  where scoped.organization_id = target_organization_id and scoped.id = run.bundle_version_id;

  -- A pause has no channel action; leave `action` null and skip its checks.
  if not is_pause then
    select scoped.* into action from public.campaign_channel_actions scoped
    where scoped.organization_id = target_organization_id
      and scoped.bundle_version_id = run.bundle_version_id
      and scoped.action_key = run.action_key;
  end if;

  select scoped.id into latest_version_id from public.campaign_bundle_versions scoped
  where scoped.organization_id = target_organization_id and scoped.campaign_id = run.campaign_id
  order by scoped.version desc limit 1;

  select scoped.* into approval from public.campaign_approvals scoped
  where scoped.organization_id = target_organization_id
    and scoped.campaign_id = run.campaign_id
    and scoped.revoked_at is null
  for update;

  if campaign.state = 'cancelled' then codes := codes || 'campaign_cancelled'; end if;

  if not found or approval.id is null then
    codes := codes || 'no_active_approval';
  else
    if approval.bundle_version_id is distinct from run.bundle_version_id
      or run.bundle_version_id is distinct from latest_version_id
    then
      codes := codes || 'approval_version_superseded';
    end if;
    if approval.bundle_digest is distinct from version.digest then
      codes := codes || 'approval_digest_mismatch';
    end if;
    if approval.expires_at <= pg_catalog.now() then codes := codes || 'approval_expired'; end if;
    if approval.attestation_id is null then codes := codes || 'attestation_missing'; end if;
    if not is_pause and not (run.action_key = any (approval.action_keys)) then
      codes := codes || 'action_not_approved';
    end if;
  end if;

  if not is_pause then
    if action.id is null then
      codes := codes || 'action_not_approved';
    elsif pg_catalog.now() + interval '5 minutes' < action.scheduled_for then
      codes := codes || 'outside_schedule_window';
    end if;
  end if;

  select scoped.* into grant_row from public.integration_capability_grants scoped
  where scoped.organization_id = target_organization_id
    and scoped.capability_key = input_claim ->> 'capability_key';

  if not found then
    codes := codes || 'capability_not_granted';
  else
    if pg_catalog.cardinality(grant_row.restriction_codes) > 0 then
      codes := codes || 'capability_restricted';
    end if;
    if approval.capability_grant_versions ? (input_claim ->> 'capability_key')
      and (approval.capability_grant_versions ->> (input_claim ->> 'capability_key'))
        is distinct from grant_row.grant_version::text
    then
      codes := codes || 'capability_grant_changed';
    end if;
  end if;

  if coalesce((asserted ->> 'credential_healthy')::boolean, false) is not true then
    codes := codes || 'credential_unhealthy';
  end if;
  if coalesce((asserted ->> 'tracking_ready')::boolean, false) is not true then
    codes := codes || 'tracking_not_ready';
  end if;
  if coalesce((asserted ->> 'consent_withdrawn')::boolean, false) is true then
    codes := codes || 'consent_withdrawn';
  end if;

  -- A pause never reserves: stopping an object moves no money.
  reservation := null;
  if not is_pause and action.spend_ceiling_minor is not null then
    if action.spend_currency is distinct from approval.spend_currency then
      codes := codes || 'spend_currency_mismatch';
    else
      select coalesce(pg_catalog.sum(
        case when ledger.state = 'released' then 0
             else pg_catalog.greatest(ledger.reserved_minor, coalesce(ledger.settled_minor, 0))
        end
      ), 0)
      into committed
      from public.campaign_budget_reservations ledger
      where ledger.organization_id = target_organization_id
        and ledger.campaign_id = run.campaign_id
        and ledger.action_run_id <> run.id;

      if approval.total_spend_ceiling_minor is null
        or committed + action.spend_ceiling_minor > approval.total_spend_ceiling_minor
      then
        codes := codes || 'spend_ceiling_exhausted';
      else
        reservation := action.spend_ceiling_minor;
      end if;
    end if;
  end if;

  if pg_catalog.cardinality(codes) > 0 then
    update public.campaign_action_runs
    set status = 'blocked',
        claim_token = null,
        lease_expires_at = null,
        last_refusal_codes = codes,
        asserted_facts = asserted,
        updated_at = pg_catalog.now()
    where organization_id = target_organization_id and id = run.id;

    insert into private.tool_gateway_operations (
      organization_id, action_run_id, operation, outcome, refusal_codes
    ) values (target_organization_id, run.id, 'claim', 'refused', codes);

    return pg_catalog.jsonb_build_object('outcome', 'refused', 'reason_codes', pg_catalog.to_jsonb(codes));
  end if;

  if reservation is not null then
    insert into public.campaign_budget_reservations (
      organization_id, campaign_id, action_run_id, currency, reserved_minor
    ) values (
      target_organization_id, run.campaign_id, run.id, action.spend_currency, reservation
    )
    on conflict (organization_id, action_run_id) do nothing;
  end if;

  update public.campaign_action_runs
  set status = 'claimed',
      claim_token = token,
      lease_expires_at = pg_catalog.now()
        + pg_catalog.make_interval(secs => coalesce((input_claim ->> 'lease_seconds')::integer, 300)),
      attempt = attempt + 1,
      approval_id = approval.id,
      asserted_facts = asserted,
      last_refusal_codes = '{}',
      updated_at = pg_catalog.now()
  where organization_id = target_organization_id and id = run.id;

  insert into private.tool_gateway_operations (
    organization_id, action_run_id, operation, claim_token, outcome
  ) values (target_organization_id, run.id, 'claim', token, 'claimed');

  return pg_catalog.jsonb_build_object(
    'outcome', 'claimed',
    'claim_token', token,
    'attempt', run.attempt + 1,
    'reservation_minor', reservation,
    'currency', case when is_pause then null else action.spend_currency end
  );
end;
$$;
