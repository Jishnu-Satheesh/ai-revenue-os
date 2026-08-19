-- Where a campaign's results land.
--
-- The warehouse already stores observations, but only about an organization, a
-- branch, or a channel. A campaign agent cannot reason at that grain: it needs
-- to know how *this variant* did, because the whole point of running four
-- variants is to tell them apart.
--
-- Two things this adds that `normalized_metrics` alone cannot express.
--
-- A subject that is checked. `subject_ref` is free text, so nothing stops a
-- uuid that names no variant, or names another tenant's. The rows here carry
-- real composite foreign keys, so a result can only be attached to a variant or
-- action run that exists inside the same organization.
--
-- Missingness. A period the provider reported nothing for is not the same as a
-- period nobody collected, and neither is a zero. `normalized_metrics` cannot
-- hold "we looked and there was nothing" because it requires a value. Here that
-- is a first-class row, so a gap stays a gap and is never quietly filled in.

-- Needed as a composite foreign key target below, so an observation cannot
-- point at another tenant's metric row.
create unique index normalized_metrics_org_id_idx
  on public.normalized_metrics (organization_id, id);

-- The grains a campaign is measured at ---------------------------------------
insert into public.subject_kinds (key, label, owner_scope)
values
  ('campaign', 'Campaign', 'core'),
  ('campaign_action', 'Campaign action', 'core'),
  ('creative_variant', 'Creative variant', 'core')
on conflict (key) do nothing;

-- Core diagnostics, and only the ones that can be honestly combined.
--
-- Reach and frequency are deliberately absent. Both are counts of unique people
-- and cannot be summed across days, and the registry's aggregation vocabulary
-- has no way to say "do not combine this". Registering them as `sum` would put
-- a fabricated aggregation into shared vocabulary, so they wait for the spec
-- change that would let them be declared honestly.
--
-- Everything here is a diagnostic under ADR 0019, never an outcome. None of
-- these figures is evidence of incremental gross profit.
insert into public.metric_definitions (key, label, owner_scope, value_kind, unit, aggregation)
values
  ('delivery.impressions', 'Impressions', 'core', 'count', null, 'sum'),
  ('delivery.clicks', 'Clicks', 'core', 'count', null, 'sum'),
  ('delivery.spend', 'Advertising spend', 'core', 'money', null, 'sum')
on conflict do nothing;

-- One collected figure, or one recorded gap ----------------------------------
create table public.campaign_metric_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,

  subject_kind text not null references public.subject_kinds(key) check (
    subject_kind in ('campaign', 'campaign_action', 'creative_variant')
  ),
  -- Exactly one of these is set, and which one is decided by `subject_kind`.
  action_run_id uuid,
  variant_id uuid,

  metric_definition_id uuid not null references public.metric_definitions(id) on delete restrict,

  period_grain text not null check (period_grain in ('hour', 'day')),
  period_start timestamptz not null,

  -- The distinction this table exists for. `absent` means the provider was
  -- asked and reported nothing for the period; a row that is simply missing
  -- means nobody has asked yet. A zero is neither.
  presence text not null check (presence in ('observed', 'absent')),
  -- Only an observation has a value. A gap points at nothing on purpose.
  normalized_metric_id uuid,

  -- Which collection produced this, so a bad run can be traced rather than
  -- guessed at.
  collection_run_id uuid not null,
  collected_at timestamptz not null default now(),

  -- Late and restated data are new revisions, exactly as the metric table
  -- treats them. A gap that later fills in keeps the record that it was a gap.
  revision integer not null default 1 check (revision > 0),
  superseded_by_id uuid,
  supersede_reason text check (supersede_reason is null or char_length(supersede_reason) <= 500),

  created_at timestamptz not null default now(),

  unique (organization_id, id),

  check ((subject_kind = 'campaign_action') = (action_run_id is not null)),
  check ((subject_kind = 'creative_variant') = (variant_id is not null)),
  check ((presence = 'observed') = (normalized_metric_id is not null)),
  check (superseded_by_id is null or superseded_by_id <> id),

  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, action_run_id)
    references public.campaign_action_runs (organization_id, id) on delete cascade,
  foreign key (organization_id, variant_id)
    references public.campaign_creative_variants (organization_id, id) on delete cascade,
  foreign key (organization_id, normalized_metric_id)
    references public.normalized_metrics (organization_id, id) on delete restrict,

  -- Deferred for the same reason the metric table's is: a restatement has to
  -- retire the incumbent before its successor exists, or the partial unique
  -- index on current rows rejects the pair.
  foreign key (organization_id, superseded_by_id)
    references public.campaign_metric_observations (organization_id, id)
    deferrable initially deferred
);

-- The subject, whichever kind it is. Written once here so both indexes and the
-- recording function agree on what "the same subject" means.
create index campaign_metric_observations_subject_idx
  on public.campaign_metric_observations (
    organization_id, subject_kind, coalesce(variant_id, action_run_id, campaign_id), period_start desc
  )
  where superseded_by_id is null;

create index campaign_metric_observations_campaign_idx
  on public.campaign_metric_observations (organization_id, campaign_id, period_start desc)
  where superseded_by_id is null;

create unique index campaign_metric_observations_revision_idx
  on public.campaign_metric_observations (
    organization_id,
    subject_kind,
    (coalesce(variant_id, action_run_id, campaign_id)),
    metric_definition_id,
    period_grain,
    period_start,
    revision
  );

-- One live answer per subject, per metric, per period. This is what makes a
-- collector safe to re-run: a second pass over the same window cannot produce a
-- second current figure.
create unique index campaign_metric_observations_current_idx
  on public.campaign_metric_observations (
    organization_id,
    subject_kind,
    (coalesce(variant_id, action_run_id, campaign_id)),
    metric_definition_id,
    period_grain,
    period_start
  )
  where superseded_by_id is null;

alter table public.campaign_metric_observations enable row level security;
alter table public.campaign_metric_observations force row level security;

revoke all on public.campaign_metric_observations from anon, authenticated;
grant select on public.campaign_metric_observations to authenticated;

create policy campaign_metric_observations_member_read
  on public.campaign_metric_observations
  for select to authenticated
  using (private.is_organization_member(organization_id));

-- Append-only, with the same single exception the metric table allows: a row
-- may be closed by pointing it at its successor, and nothing else.
create function private.prevent_campaign_metric_observation_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'campaign_metric_observation_is_append_only' using errcode = '23514';
  end if;

  if old.superseded_by_id is not null then
    raise exception 'campaign_metric_observation_already_superseded' using errcode = '23514';
  end if;

  if new.superseded_by_id is null then
    raise exception 'campaign_metric_observation_is_append_only' using errcode = '23514';
  end if;

  if pg_catalog.to_jsonb(new) - 'superseded_by_id' - 'supersede_reason'
    is distinct from pg_catalog.to_jsonb(old) - 'superseded_by_id' - 'supersede_reason' then
    raise exception 'campaign_metric_observation_is_append_only' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger campaign_metric_observations_append_only
  before update or delete on public.campaign_metric_observations
  for each row execute function private.prevent_campaign_metric_observation_mutation();

comment on table public.campaign_metric_observations is
  'One collected figure or one recorded gap, per campaign subject, per metric, per period. A gap is a row, not an absence of one.';

-- Record one collected figure, or one gap ------------------------------------
--
-- The value and the observation are written together or not at all. An
-- observation pointing at a metric row that never landed, and a metric row
-- nothing points at, are both states nobody could interpret later.
--
-- Re-running a collection over a window it has already covered is normal, not
-- an error: a period whose figure has not changed returns `unchanged` and
-- writes nothing. That is what makes the collector safe to retry.
create function public.record_campaign_metric_observation(
  target_organization_id uuid,
  input_observation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  metric_key text := input_observation ->> 'metric_key';
  input_subject_kind text := input_observation ->> 'subject_kind';
  input_presence text := input_observation ->> 'presence';
  input_period_grain text := input_observation ->> 'period_grain';
  input_period_start timestamptz := (input_observation ->> 'period_start')::timestamptz;
  subject_ref uuid := coalesce(
    (input_observation ->> 'variant_id')::uuid,
    (input_observation ->> 'action_run_id')::uuid,
    (input_observation ->> 'campaign_id')::uuid
  );
  definition_id uuid;
  definition_value_kind text;
  current_observation public.campaign_metric_observations;
  current_metric public.normalized_metrics;
  new_observation_id uuid := pg_catalog.gen_random_uuid();
  new_metric_id uuid := pg_catalog.gen_random_uuid();
  next_revision integer;
begin
  -- An organization's own key takes precedence over shared vocabulary; a
  -- shadowing key is rejected at registration, so at most one of each exists.
  select definition.id, definition.value_kind
  into definition_id, definition_value_kind
  from public.metric_definitions definition
  where definition.key = metric_key
    and (definition.organization_id = target_organization_id or definition.organization_id is null)
  order by definition.organization_id nulls last
  limit 1;

  if definition_id is null then
    raise exception 'metric_definition_not_found' using errcode = '23503';
  end if;

  select observation.* into current_observation
  from public.campaign_metric_observations observation
  where observation.organization_id = target_organization_id
    and observation.subject_kind = input_subject_kind
    and coalesce(observation.variant_id, observation.action_run_id, observation.campaign_id)
        = subject_ref
    and observation.metric_definition_id = definition_id
    and observation.period_grain = input_period_grain
    and observation.period_start = input_period_start
    and observation.superseded_by_id is null;

  if current_observation.id is not null then
    if current_observation.presence = 'absent' and input_presence = 'absent' then
      -- Still nothing. Recording a second gap would say the provider changed
      -- its answer when it did not.
      return pg_catalog.jsonb_build_object('outcome', 'unchanged', 'observation_id', current_observation.id);
    end if;

    if current_observation.presence = 'observed' and input_presence = 'observed' then
      select metric.* into current_metric
      from public.normalized_metrics metric
      where metric.id = current_observation.normalized_metric_id;

      if current_metric.value_numerator = (input_observation ->> 'value_numerator')::numeric
        and current_metric.value_denominator is not distinct from
            (input_observation ->> 'value_denominator')::numeric
        and current_metric.currency is not distinct from (input_observation ->> 'currency')
        and current_metric.quality_tier = (input_observation ->> 'quality_tier')
      then
        -- The provider repeated itself. A re-run over a settled window lands
        -- here, which is exactly why a collector may sweep the same days twice.
        return pg_catalog.jsonb_build_object('outcome', 'unchanged', 'observation_id', current_observation.id);
      end if;
    end if;

    next_revision := current_observation.revision + 1;

    -- Retire the incumbent before its successor exists. The only possible
    -- order: inserting first collides with the partial unique index on current
    -- rows, and the supersession keys are deferred so the pointer resolves
    -- before the transaction ends.
    update public.campaign_metric_observations
    set superseded_by_id = new_observation_id,
        supersede_reason = pg_catalog.left(
          coalesce(input_observation ->> 'supersede_reason', 'provider restatement'), 500
        )
    where id = current_observation.id;

    if current_observation.presence = 'observed' then
      update public.normalized_metrics
      set superseded_by_id = new_metric_id,
          supersede_reason = pg_catalog.left(
            coalesce(input_observation ->> 'supersede_reason', 'provider restatement'), 500
          )
      where id = current_observation.normalized_metric_id;
    end if;
  else
    next_revision := 1;
  end if;

  if input_presence = 'observed' then
    insert into public.normalized_metrics (
      id, organization_id, metric_definition_id, value_kind,
      subject_kind, subject_ref, channel, dimensions,
      period_grain, period_start, period_end, period_timezone,
      value_numerator, value_denominator, currency, quality_tier,
      revision, source_ingestion_run_id, observed_at
    ) values (
      new_metric_id, target_organization_id, definition_id, definition_value_kind,
      input_subject_kind, subject_ref::text, input_observation ->> 'channel',
      coalesce(input_observation -> 'dimensions', '{}'::jsonb),
      input_period_grain, input_period_start,
      (input_observation ->> 'period_end')::timestamptz,
      input_observation ->> 'period_timezone',
      (input_observation ->> 'value_numerator')::numeric,
      (input_observation ->> 'value_denominator')::numeric,
      input_observation ->> 'currency',
      input_observation ->> 'quality_tier',
      -- The metric row's own revision tracks that series, which restates in
      -- step with the observation because they are written together.
      next_revision,
      (input_observation ->> 'collection_run_id')::uuid,
      (input_observation ->> 'observed_at')::timestamptz
    );
  end if;

  insert into public.campaign_metric_observations (
    id, organization_id, campaign_id, subject_kind, action_run_id, variant_id,
    metric_definition_id, period_grain, period_start, presence,
    normalized_metric_id, collection_run_id, revision
  ) values (
    new_observation_id, target_organization_id,
    (input_observation ->> 'campaign_id')::uuid,
    input_subject_kind,
    (input_observation ->> 'action_run_id')::uuid,
    (input_observation ->> 'variant_id')::uuid,
    definition_id, input_period_grain, input_period_start, input_presence,
    case when input_presence = 'observed' then new_metric_id end,
    (input_observation ->> 'collection_run_id')::uuid,
    next_revision
  );

  return pg_catalog.jsonb_build_object(
    'outcome', case when next_revision = 1 then 'recorded' else 'restated' end,
    'observation_id', new_observation_id,
    'revision', next_revision
  );
end;
$$;

revoke all on function public.record_campaign_metric_observation(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_campaign_metric_observation(uuid, jsonb) to service_role;
