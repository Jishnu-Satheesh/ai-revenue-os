-- The slow evidence loop's verdict record.
--
-- Task 21, in one migration. One settled verdict per campaign, computed by the
-- evidence loop in code and written here by a worker-only RPC. The loop is the
-- sole author of `validated_outcome`, `inconclusive`, `guardrail_breach`, and
-- `execution_only`, and the wall (ADR 0021) is enforced by omission: none of the
-- functions here grant the allocation loop a path to this table, and nothing
-- here reads an allocation diagnostic (impressions or clicks) as evidence.
--
-- Two guarantees are load-bearing and live in the write RPC rather than in code:
--
--  - Preregistration. A verdict is only accepted against the plan that was on
--    file at first exposure. The bundle version and digest must match the
--    campaign's earliest exposure, or the write is refused.
--  - The settlement delay. The write is refused before first exposure plus the
--    plan's outcome window and settlement delay. Nothing — not the allocation
--    loop, not a retry, not a mis-scheduled run — may settle early.

-- ---------------------------------------------------------------------------
-- The outcome record
-- ---------------------------------------------------------------------------

create table public.campaign_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  bundle_version_id uuid not null,

  -- The digest the plan lives inside, so a verdict always names exactly what it
  -- was computed under. Matched against the version on file at first exposure.
  plan_digest text not null check (plan_digest ~ '^[0-9a-f]{64}$'),

  verdict text not null check (
    verdict in ('validated_outcome', 'inconclusive', 'guardrail_breach', 'execution_only')
  ),
  attribution_method text not null check (
    attribution_method in ('observational_prepost', 'provider_randomized_experiment')
  ),
  primary_metric_key text not null check (char_length(primary_metric_key) between 1 and 160),

  -- Copied from the plan at settle time so the record is self-contained, never
  -- re-read from a plan that might later be a different version's.
  outcome_window_days integer not null check (outcome_window_days between 1 and 365),
  settlement_delay_days integer not null check (settlement_delay_days between 0 and 90),
  baseline_source text not null check (char_length(baseline_source) between 1 and 240),
  baseline_lookback_days integer not null check (baseline_lookback_days between 1 and 730),

  -- Planned and realized exposure, stored separately and never reconciled into
  -- one number. A reader can always see how far short of the plan reality fell.
  planned_exposure_count bigint not null check (planned_exposure_count >= 0),
  realized_exposure_count bigint not null check (realized_exposure_count >= 0),

  -- The money guardrail, and whether it held. Spend is a separate fact from the
  -- primary metric's estimate; it is shown beside it, not folded into it.
  guardrail_state text not null check (guardrail_state in ('breached', 'clear', 'unmeasured')),
  realized_spend_minor bigint,
  spend_ceiling_minor bigint,
  spend_currency text check (spend_currency is null or spend_currency ~ '^[A-Z]{3}$'),

  -- The primary metric's point estimate and a descriptive range, in minor
  -- units. Null exactly when the verdict makes no claim.
  estimate_minor bigint,
  estimate_low_minor bigint,
  estimate_high_minor bigint,
  estimate_currency text check (estimate_currency is null or estimate_currency ~ '^[A-Z]{3}$'),
  evidence_tier text check (evidence_tier in ('computed', 'observed')),

  -- Why realized exposure fell short of planned, one entry per truncated
  -- variant, and the limitations an operator must be able to read.
  truncation_causes jsonb not null default '[]' check (jsonb_typeof(truncation_causes) = 'array'),
  limitations jsonb not null default '[]' check (jsonb_typeof(limitations) = 'array'),

  -- A restatement supersedes the incumbent rather than overwriting it. A
  -- rendered result that a restatement changed is marked, never silently edited.
  superseded_by_id uuid,
  supersede_reason text check (supersede_reason is null or char_length(supersede_reason) <= 500),

  settled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  unique (organization_id, id),

  check (superseded_by_id is null or superseded_by_id <> id),
  check (supersede_reason is null or superseded_by_id is not null),
  check ((estimate_minor is null) = (estimate_currency is null)),
  check ((realized_spend_minor is not null) or (guardrail_state <> 'breached')),

  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, bundle_version_id)
    references public.campaign_bundle_versions (organization_id, id) on delete cascade,
  foreign key (organization_id, superseded_by_id)
    references public.campaign_outcomes (organization_id, id)
    deferrable initially deferred
);

create index campaign_outcomes_campaign_idx
  on public.campaign_outcomes (organization_id, campaign_id, settled_at desc);
create index campaign_outcomes_superseded_idx
  on public.campaign_outcomes (organization_id, superseded_by_id);

-- One current verdict per campaign. A restatement retires the incumbent first,
-- and this partial unique index is what makes a second live row unrepresentable.
create unique index campaign_outcomes_one_current_per_campaign_idx
  on public.campaign_outcomes (organization_id, campaign_id)
  where superseded_by_id is null;

alter table public.campaign_outcomes enable row level security;
alter table public.campaign_outcomes force row level security;

revoke all on public.campaign_outcomes from anon, authenticated;
grant select on public.campaign_outcomes to authenticated;

create policy campaign_outcomes_member_read
  on public.campaign_outcomes
  for select to authenticated
  using (private.is_organization_member(organization_id));

comment on table public.campaign_outcomes is
  'One settled verdict per campaign, computed by the evidence loop. Planned and realized exposure are stored separately, and a restatement supersedes rather than overwrites.';

-- Append-only, with the same single exception the metric table allows: a row
-- may be closed by pointing it at its successor, and nothing else.
create function private.prevent_campaign_outcome_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'campaign_outcome_is_append_only' using errcode = '23514';
  end if;

  if old.superseded_by_id is not null then
    raise exception 'campaign_outcome_already_superseded' using errcode = '23514';
  end if;

  if new.superseded_by_id is null then
    raise exception 'campaign_outcome_is_append_only' using errcode = '23514';
  end if;

  if pg_catalog.to_jsonb(new) - 'superseded_by_id' - 'supersede_reason'
    is distinct from pg_catalog.to_jsonb(old) - 'superseded_by_id' - 'supersede_reason' then
    raise exception 'campaign_outcome_is_append_only' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger campaign_outcomes_append_only
  before update or delete on public.campaign_outcomes
  for each row execute function private.prevent_campaign_outcome_mutation();

-- ---------------------------------------------------------------------------
-- The settlement context a worker reads before computing a verdict
-- ---------------------------------------------------------------------------

create function public.read_campaign_measurement_context(
  target_organization_id uuid,
  target_campaign_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_exposure_row public.campaign_exposures;
  plan_row public.campaign_measurement_plans;
  version_row public.campaign_bundle_versions;
  approval_row public.campaign_approvals;
  planned_count bigint;
  realized_count bigint;
  realized_spend bigint;
  ceiling bigint;
  currency text;
  truncations jsonb;
  primary_observations jsonb;
begin
  -- The campaign's own first exposure anchors everything: the executed version,
  -- the plan that was on file, and the settlement window.
  select exposure.* into first_exposure_row
  from public.campaign_exposures exposure
  where exposure.organization_id = target_organization_id
    and exposure.campaign_id = target_campaign_id
  order by exposure.published_at asc
  limit 1;

  if not found then
    raise exception 'campaign_has_no_exposure' using errcode = '22023';
  end if;

  select plan.* into plan_row
  from public.campaign_measurement_plans plan
  where plan.organization_id = target_organization_id
    and plan.bundle_version_id = first_exposure_row.bundle_version_id;

  if not found then
    raise exception 'campaign_measurement_plan_missing' using errcode = '22023';
  end if;

  select version.* into version_row
  from public.campaign_bundle_versions version
  where version.organization_id = target_organization_id
    and version.id = first_exposure_row.bundle_version_id;

  -- Planned exposure is what the plan scheduled; realized exposure is what
  -- actually reached a provider. The two are never summed into one number.
  select count(*)::bigint into planned_count
  from public.campaign_channel_actions action
  where action.organization_id = target_organization_id
    and action.bundle_version_id = first_exposure_row.bundle_version_id;

  select count(*)::bigint into realized_count
  from public.campaign_exposures exposure
  where exposure.organization_id = target_organization_id
    and exposure.campaign_id = target_campaign_id;

  -- Realized spend, reconstructed from receipts rather than assumed from the
  -- plan. Absence of spend observations stays null, never zero.
  select sum(metric.value_numerator)::bigint into realized_spend
  from public.campaign_metric_observations observation
  join public.normalized_metrics metric on metric.id = observation.normalized_metric_id
  join public.metric_definitions definition on definition.id = observation.metric_definition_id
  where observation.organization_id = target_organization_id
    and observation.campaign_id = target_campaign_id
    and observation.superseded_by_id is null
    and observation.presence = 'observed'
    and definition.key = 'delivery.spend';

  -- The money ceiling comes from the approval that authorized the executed
  -- version. Organic campaigns carry no ceiling, so the guardrail is absent.
  select approval.total_spend_ceiling_minor, approval.spend_currency
    into ceiling, currency
  from public.campaign_approvals approval
  where approval.organization_id = target_organization_id
    and approval.bundle_version_id = first_exposure_row.bundle_version_id
  order by approval.approved_at desc
  limit 1;

  -- Truncation, attributed to its cause. A spend-ceiling stop is a guardrail; a
  -- pause made by a user is an operator pause; everything else is an agent
  -- pause inside the approved envelope.
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'variant_id', event.variant_id,
        'cause', case
          when event.reason_code = 'spend_ceiling_exceeded' then 'guardrail'
          when event.actor <> 'agent' then 'operator_pause'
          else 'agent_pause'
        end,
        'rule_key', event.rule_key,
        'at', event.occurred_at
      )
      order by event.occurred_at
    ),
    '[]'::jsonb
  ) into truncations
  from public.campaign_allocation_events event
  where event.organization_id = target_organization_id
    and event.campaign_id = target_campaign_id
    and event.action = 'pause';

  -- The primary metric's observations, if the preregistered metric was actually
  -- collected. Empty until a business metric is registered and ingested — the
  -- honest result then is execution_only or inconclusive, never a fabrication.
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'value_minor', metric.value_numerator,
        'period_start', observation.period_start,
        'evidence_tier', case metric.quality_tier
          when 'measured' then 'observed'
          when 'derived' then 'observed'
          else 'computed'
        end
      )
      order by observation.period_start
    ),
    '[]'::jsonb
  ) into primary_observations
  from public.campaign_metric_observations observation
  join public.normalized_metrics metric on metric.id = observation.normalized_metric_id
  join public.metric_definitions definition on definition.id = observation.metric_definition_id
  where observation.organization_id = target_organization_id
    and observation.campaign_id = target_campaign_id
    and observation.superseded_by_id is null
    and observation.presence = 'observed'
    and definition.key = plan_row.primary_metric_key;

  return pg_catalog.jsonb_build_object(
    'bundle_version_id', first_exposure_row.bundle_version_id,
    'plan_digest', version_row.digest,
    'first_exposure_at', first_exposure_row.published_at,
    'plan', pg_catalog.jsonb_build_object(
      'primary_metric_key', plan_row.primary_metric_key,
      'guardrail_metric_keys', pg_catalog.to_jsonb(plan_row.guardrail_metric_keys),
      'baseline_source', plan_row.baseline_source,
      'baseline_lookback_days', plan_row.baseline_lookback_days,
      'attribution_method', plan_row.attribution_method,
      'outcome_window_days', plan_row.outcome_window_days,
      'settlement_delay_days', plan_row.settlement_delay_days,
      'minimum_evidence_tier', plan_row.minimum_evidence_tier
    ),
    'planned_exposure_count', planned_count,
    'realized_exposure_count', realized_count,
    'truncations', truncations,
    'spend_ceiling_minor', ceiling,
    'spend_currency', currency,
    'realized_spend_minor', realized_spend,
    'primary_observations', primary_observations,
    -- No numeric baseline and no provider effect are stored today. Returning
    -- null keeps the honest conclusion (inconclusive / execution_only) rather
    -- than inventing a before/after difference nobody recorded.
    'baseline_observation', null,
    'provider_effect', null
  );
end;
$$;

revoke all on function public.read_campaign_measurement_context(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_campaign_measurement_context(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Writing the verdict
-- ---------------------------------------------------------------------------

create function public.settle_campaign_outcome(
  target_organization_id uuid,
  input_outcome jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_exposure_row public.campaign_exposures;
  plan_row public.campaign_measurement_plans;
  version_row public.campaign_bundle_versions;
  current_outcome public.campaign_outcomes;
  new_outcome_id uuid := pg_catalog.gen_random_uuid();
  eligible_at timestamptz;
  existing_value jsonb;
  incoming_value jsonb;
begin
  if target_organization_id is null
    or input_outcome ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_outcome_organization_mismatch' using errcode = '42501';
  end if;

  select exposure.* into first_exposure_row
  from public.campaign_exposures exposure
  where exposure.organization_id = target_organization_id
    and exposure.campaign_id = (input_outcome ->> 'campaign_id')::uuid
  order by exposure.published_at asc
  limit 1;

  if not found then
    raise exception 'campaign_has_no_exposure' using errcode = '22023';
  end if;

  -- Preregistration. The verdict must be computed against the version and plan
  -- that were on file when the campaign first published. A verdict against any
  -- other plan is refused, by any path.
  if (input_outcome ->> 'bundle_version_id')::uuid is distinct from first_exposure_row.bundle_version_id then
    raise exception 'campaign_outcome_plan_not_on_file' using errcode = '22023';
  end if;

  select version.* into version_row
  from public.campaign_bundle_versions version
  where version.organization_id = target_organization_id
    and version.id = first_exposure_row.bundle_version_id;

  if (input_outcome ->> 'plan_digest') is distinct from version_row.digest then
    raise exception 'campaign_outcome_plan_not_on_file' using errcode = '22023';
  end if;

  select plan.* into plan_row
  from public.campaign_measurement_plans plan
  where plan.organization_id = target_organization_id
    and plan.bundle_version_id = first_exposure_row.bundle_version_id;

  -- The settlement delay is honored exactly, read back from the immutable plan
  -- rather than trusted from the payload. A caller that shortens the window
  -- cannot slip a premature verdict through.
  eligible_at := first_exposure_row.published_at
    + pg_catalog.make_interval(days => plan_row.outcome_window_days + plan_row.settlement_delay_days);

  if pg_catalog.now() < eligible_at then
    raise exception 'settlement_not_due' using errcode = '22023';
  end if;

  -- A re-run over an unchanged result is idempotent: same verdict, same
  -- exposure, same estimate, same limitations means nothing to announce.
  incoming_value := pg_catalog.jsonb_build_object(
    'verdict', input_outcome ->> 'verdict',
    'attribution_method', input_outcome ->> 'attribution_method',
    'primary_metric_key', input_outcome ->> 'primary_metric_key',
    'planned_exposure_count', (input_outcome ->> 'planned_exposure_count')::bigint,
    'realized_exposure_count', (input_outcome ->> 'realized_exposure_count')::bigint,
    'guardrail_state', input_outcome ->> 'guardrail_state',
    'realized_spend_minor', (input_outcome ->> 'realized_spend_minor')::bigint,
    'spend_ceiling_minor', (input_outcome ->> 'spend_ceiling_minor')::bigint,
    'spend_currency', input_outcome ->> 'spend_currency',
    'estimate_minor', (input_outcome ->> 'estimate_minor')::bigint,
    'estimate_low_minor', (input_outcome ->> 'estimate_low_minor')::bigint,
    'estimate_high_minor', (input_outcome ->> 'estimate_high_minor')::bigint,
    'estimate_currency', input_outcome ->> 'estimate_currency',
    'evidence_tier', input_outcome ->> 'evidence_tier',
    'truncation_causes', input_outcome -> 'truncation_causes',
    'limitations', input_outcome -> 'limitations'
  );

  select outcome.* into current_outcome
  from public.campaign_outcomes outcome
  where outcome.organization_id = target_organization_id
    and outcome.campaign_id = (input_outcome ->> 'campaign_id')::uuid
    and outcome.superseded_by_id is null;

  if current_outcome.id is not null then
    existing_value := pg_catalog.jsonb_build_object(
      'verdict', current_outcome.verdict,
      'attribution_method', current_outcome.attribution_method,
      'primary_metric_key', current_outcome.primary_metric_key,
      'planned_exposure_count', current_outcome.planned_exposure_count,
      'realized_exposure_count', current_outcome.realized_exposure_count,
      'guardrail_state', current_outcome.guardrail_state,
      'realized_spend_minor', current_outcome.realized_spend_minor,
      'spend_ceiling_minor', current_outcome.spend_ceiling_minor,
      'spend_currency', current_outcome.spend_currency,
      'estimate_minor', current_outcome.estimate_minor,
      'estimate_low_minor', current_outcome.estimate_low_minor,
      'estimate_high_minor', current_outcome.estimate_high_minor,
      'estimate_currency', current_outcome.estimate_currency,
      'evidence_tier', current_outcome.evidence_tier,
      'truncation_causes', current_outcome.truncation_causes,
      'limitations', current_outcome.limitations
    );

    if existing_value is not distinct from incoming_value then
      return pg_catalog.jsonb_build_object('outcome', 'unchanged', 'outcome_id', current_outcome.id);
    end if;

    -- Retire the incumbent before its successor exists, so the partial unique
    -- index on current rows never sees two live rows for one campaign.
    update public.campaign_outcomes
    set superseded_by_id = new_outcome_id,
        supersede_reason = 'restatement'
    where id = current_outcome.id;
  end if;

  insert into public.campaign_outcomes (
    id, organization_id, campaign_id, bundle_version_id, plan_digest,
    verdict, attribution_method, primary_metric_key,
    outcome_window_days, settlement_delay_days, baseline_source, baseline_lookback_days,
    planned_exposure_count, realized_exposure_count,
    guardrail_state, realized_spend_minor, spend_ceiling_minor, spend_currency,
    estimate_minor, estimate_low_minor, estimate_high_minor, estimate_currency,
    evidence_tier, truncation_causes, limitations
  ) values (
    new_outcome_id, target_organization_id,
    (input_outcome ->> 'campaign_id')::uuid,
    first_exposure_row.bundle_version_id,
    input_outcome ->> 'plan_digest',
    input_outcome ->> 'verdict',
    input_outcome ->> 'attribution_method',
    input_outcome ->> 'primary_metric_key',
    plan_row.outcome_window_days,
    plan_row.settlement_delay_days,
    plan_row.baseline_source,
    plan_row.baseline_lookback_days,
    (input_outcome ->> 'planned_exposure_count')::bigint,
    (input_outcome ->> 'realized_exposure_count')::bigint,
    input_outcome ->> 'guardrail_state',
    (input_outcome ->> 'realized_spend_minor')::bigint,
    (input_outcome ->> 'spend_ceiling_minor')::bigint,
    input_outcome ->> 'spend_currency',
    (input_outcome ->> 'estimate_minor')::bigint,
    (input_outcome ->> 'estimate_low_minor')::bigint,
    (input_outcome ->> 'estimate_high_minor')::bigint,
    input_outcome ->> 'estimate_currency',
    input_outcome ->> 'evidence_tier',
    coalesce(input_outcome -> 'truncation_causes', '[]'::jsonb),
    coalesce(input_outcome -> 'limitations', '[]'::jsonb)
  );

  return pg_catalog.jsonb_build_object(
    'outcome', case when current_outcome.id is null then 'recorded' else 'restated' end,
    'outcome_id', new_outcome_id
  );
end;
$$;

revoke all on function public.settle_campaign_outcome(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.settle_campaign_outcome(uuid, jsonb) to service_role;
