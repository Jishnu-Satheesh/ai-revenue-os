-- Pin the reference resolution and art-direction receipt to the generation run
-- that actually used it.
--
-- A campaign source snapshot is immutable and records what the operator asked
-- for. A campaign can have many generate, revise, and variants runs, each made
-- against a library that may have changed since the prior run. The run is
-- therefore the durable receipt for what this worker sent to the models.

alter table public.campaign_generation_runs
  add column reference_slots jsonb not null default '[]'::jsonb,
  add column avoid_reference_version_ids uuid[] not null default '{}'::uuid[],
  add column negative_rules jsonb not null default '[]'::jsonb,
  add column resolver_version integer,
  add column resolution_outcome text,
  add column blueprint jsonb,
  add column plan_model_id text;

alter table public.campaign_generation_runs
  add constraint campaign_generation_runs_reference_slots_check check (
    pg_catalog.jsonb_typeof(reference_slots) = 'array'
    and pg_catalog.jsonb_array_length(reference_slots) <= 7
  ),
  add constraint campaign_generation_runs_avoid_references_check check (
    pg_catalog.cardinality(avoid_reference_version_ids) <= 2
    and pg_catalog.array_position(avoid_reference_version_ids, null) is null
  ),
  add constraint campaign_generation_runs_negative_rules_check check (
    pg_catalog.jsonb_typeof(negative_rules) = 'array'
    and pg_catalog.jsonb_array_length(negative_rules) <= 12
  ),
  add constraint campaign_generation_runs_resolver_version_check check (
    resolver_version is null or resolver_version > 0
  ),
  add constraint campaign_generation_runs_resolution_outcome_check check (
    resolution_outcome is null
    or resolution_outcome in ('resolved', 'synthesis_permitted')
  ),
  add constraint campaign_generation_runs_resolution_pair_check check (
    (resolver_version is null) = (resolution_outcome is null)
  ),
  add constraint campaign_generation_runs_blueprint_check check (
    blueprint is null or pg_catalog.jsonb_typeof(blueprint) = 'object'
  ),
  add constraint campaign_generation_runs_blueprint_model_pair_check check (
    (blueprint is null) = (plan_model_id is null)
  ),
  add constraint campaign_generation_runs_plan_model_id_check check (
    plan_model_id is null
    or pg_catalog.char_length(pg_catalog.btrim(plan_model_id)) between 1 and 200
  );

comment on column public.campaign_generation_runs.reference_slots is
  'Ordered positive reference slots this run actually sent to generation.';
comment on column public.campaign_generation_runs.avoid_reference_version_ids is
  'At most two rejected reference versions sent only as negative examples by this run.';
comment on column public.campaign_generation_runs.negative_rules is
  'Bounded negative rules in force when this run resolved its references.';
comment on column public.campaign_generation_runs.resolver_version is
  'Deterministic reference resolver version used by this run.';
comment on column public.campaign_generation_runs.resolution_outcome is
  'Realized reference resolution outcome for this run.';
comment on column public.campaign_generation_runs.blueprint is
  'Validated stage-one art-direction object actually used by this run.';
comment on column public.campaign_generation_runs.plan_model_id is
  'Model identifier that produced this run''s validated blueprint.';

-- One endpoint owns both moments of the receipt. Resolution is pinned before
-- any model spend; the parsed blueprint is added only after stage one returns.
-- Exact replay is a no-op. A conflicting replay is a caller defect and cannot
-- rewrite the evidence already attached to the run.
create function public.pin_campaign_generation_run_reference_context(
  target_organization_id uuid,
  input_pin jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.campaign_generation_runs;
  pin_phase text;
  pinned_reference_slots jsonb;
  pinned_avoid_reference_version_ids uuid[];
  pinned_negative_rules jsonb;
  pinned_resolver_version integer;
  pinned_resolution_outcome text;
  pinned_blueprint jsonb;
  pinned_plan_model_id text;
begin
  if input_pin is null or pg_catalog.jsonb_typeof(input_pin) <> 'object' then
    raise exception 'campaign_generation_pin_invalid' using errcode = '22023';
  end if;

  if target_organization_id is null
    or input_pin ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_generation_organization_mismatch' using errcode = '42501';
  end if;

  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'campaign_generation_pin_forbidden' using errcode = '42501';
  end if;

  pin_phase := input_pin ->> 'phase';
  if pin_phase not in ('resolution', 'blueprint') or pin_phase is null then
    raise exception 'campaign_generation_pin_phase_invalid' using errcode = '22023';
  end if;

  run := private.assert_campaign_generation_claim(
    target_organization_id,
    (input_pin ->> 'run_id')::uuid,
    (input_pin ->> 'claim_token')::uuid
  );

  if pin_phase = 'resolution' then
    pinned_reference_slots := input_pin -> 'reference_slots';
    pinned_negative_rules := input_pin -> 'negative_rules';
    pinned_resolution_outcome := input_pin ->> 'resolution_outcome';

    if pg_catalog.jsonb_typeof(pinned_reference_slots) is distinct from 'array'
      or pg_catalog.jsonb_typeof(input_pin -> 'avoid_reference_version_ids')
        is distinct from 'array'
      or pg_catalog.jsonb_typeof(pinned_negative_rules) is distinct from 'array'
      or pg_catalog.jsonb_typeof(input_pin -> 'resolver_version') is distinct from 'number'
      or (input_pin ->> 'resolver_version') !~ '^[1-9][0-9]*$'
      or pinned_resolution_outcome not in ('resolved', 'synthesis_permitted')
      or pinned_resolution_outcome is null
    then
      raise exception 'campaign_generation_resolution_invalid' using errcode = '22023';
    end if;

    if pg_catalog.jsonb_array_length(pinned_reference_slots) > 7
      or pg_catalog.jsonb_array_length(input_pin -> 'avoid_reference_version_ids') > 2
      or pg_catalog.jsonb_array_length(pinned_negative_rules) > 12
    then
      raise exception 'campaign_generation_resolution_invalid' using errcode = '22023';
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(input_pin -> 'avoid_reference_version_ids') item
      where pg_catalog.jsonb_typeof(item) <> 'string'
    ) then
      raise exception 'campaign_generation_resolution_invalid' using errcode = '22023';
    end if;

    begin
      select coalesce(
        pg_catalog.array_agg(item.value::uuid order by item.ordinality),
        '{}'::uuid[]
      )
      into pinned_avoid_reference_version_ids
      from pg_catalog.jsonb_array_elements_text(
        input_pin -> 'avoid_reference_version_ids'
      ) with ordinality as item(value, ordinality);

      pinned_resolver_version := (input_pin ->> 'resolver_version')::integer;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'campaign_generation_resolution_invalid' using errcode = '22023';
    end;

    if pg_catalog.cardinality(pinned_avoid_reference_version_ids) <> (
      select pg_catalog.count(distinct item)::integer
      from pg_catalog.unnest(pinned_avoid_reference_version_ids) item
    ) then
      raise exception 'campaign_generation_resolution_invalid' using errcode = '22023';
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(pinned_reference_slots) slot
      join pg_catalog.unnest(pinned_avoid_reference_version_ids) avoid_id
        on slot ->> 'brandAssetVersionId' = avoid_id::text
    ) then
      raise exception 'campaign_generation_reference_role_conflict' using errcode = '22023';
    end if;

    if run.resolution_outcome is not null then
      if run.reference_slots is not distinct from pinned_reference_slots
        and run.avoid_reference_version_ids
          is not distinct from pinned_avoid_reference_version_ids
        and run.negative_rules is not distinct from pinned_negative_rules
        and run.resolver_version is not distinct from pinned_resolver_version
        and run.resolution_outcome is not distinct from pinned_resolution_outcome
      then
        return pg_catalog.jsonb_build_object(
          'run_id', run.id,
          'phase', pin_phase,
          'replayed', true
        );
      end if;

      raise exception 'campaign_generation_resolution_conflict' using errcode = '22023';
    end if;

    update public.campaign_generation_runs
    set reference_slots = pinned_reference_slots,
        avoid_reference_version_ids = pinned_avoid_reference_version_ids,
        negative_rules = pinned_negative_rules,
        resolver_version = pinned_resolver_version,
        resolution_outcome = pinned_resolution_outcome,
        updated_at = pg_catalog.now()
    where organization_id = target_organization_id
      and id = run.id;

    return pg_catalog.jsonb_build_object(
      'run_id', run.id,
      'phase', pin_phase,
      'replayed', false
    );
  end if;

  pinned_blueprint := input_pin -> 'blueprint';
  pinned_plan_model_id := pg_catalog.btrim(input_pin ->> 'plan_model_id');

  if pg_catalog.jsonb_typeof(pinned_blueprint) is distinct from 'object'
    or pg_catalog.char_length(pinned_plan_model_id) not between 1 and 200
    or pinned_plan_model_id is null
  then
    raise exception 'campaign_generation_blueprint_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from pg_catalog.jsonb_object_keys(pinned_blueprint)
  ) then
    raise exception 'campaign_generation_blueprint_invalid' using errcode = '22023';
  end if;

  if run.resolution_outcome is null then
    raise exception 'campaign_generation_resolution_not_pinned' using errcode = '22023';
  end if;

  if run.blueprint is not null then
    if run.blueprint is not distinct from pinned_blueprint
      and run.plan_model_id is not distinct from pinned_plan_model_id
    then
      return pg_catalog.jsonb_build_object(
        'run_id', run.id,
        'phase', pin_phase,
        'replayed', true
      );
    end if;

    raise exception 'campaign_generation_blueprint_conflict' using errcode = '22023';
  end if;

  update public.campaign_generation_runs
  set blueprint = pinned_blueprint,
      plan_model_id = pinned_plan_model_id,
      updated_at = pg_catalog.now()
  where organization_id = target_organization_id
    and id = run.id;

  return pg_catalog.jsonb_build_object(
    'run_id', run.id,
    'phase', pin_phase,
    'replayed', false
  );
end;
$$;

revoke all on function public.pin_campaign_generation_run_reference_context(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.pin_campaign_generation_run_reference_context(uuid, jsonb)
  to service_role;
