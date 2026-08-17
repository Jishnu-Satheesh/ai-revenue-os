-- Manual artifact activation, currently-in-force decision tuples, and strict
-- bounded cycle creation. All worker writes remain RPC-only.

create function public.promote_decision_artifact(
  target_organization_id uuid,
  input_promotion jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_artifact_version_id uuid;
  saved_id uuid;
begin
  if target_organization_id is null
    or jsonb_typeof(input_promotion) <> 'object'
    or not private.decision_json_has_exact(
      input_promotion,
      array[
        'organization_id', 'artifact_key', 'artifact_version_id',
        'expected_current_artifact_version_id', 'promoted_by'
      ],
      array[
        'organization_id', 'artifact_key', 'artifact_version_id',
        'expected_current_artifact_version_id', 'promoted_by'
      ]
    )
    or not private.decision_json_is_uuid(input_promotion -> 'organization_id')
    or not private.decision_json_is_uuid(input_promotion -> 'artifact_version_id')
    or not private.decision_json_is_uuid(
      input_promotion -> 'expected_current_artifact_version_id'
    )
    or input_promotion ->> 'artifact_key' not in (
      'confidence_calibration', 'ranking_weights', 'prompt', 'model', 'judge'
    )
    or not private.decision_json_is_text(input_promotion -> 'promoted_by', 1, 160)
    or input_promotion ->> 'promoted_by'
      is distinct from pg_catalog.btrim(input_promotion ->> 'promoted_by')
  then
    raise exception 'artifact_promotion_invalid' using errcode = '22023';
  end if;

  if input_promotion ->> 'organization_id' is distinct from target_organization_id::text then
    raise exception 'artifact_promotion_organization_mismatch' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_organization_id::text || ':' || (input_promotion ->> 'artifact_key'),
      0
    )
  );

  select promotion.active_artifact_version_id
  into current_artifact_version_id
  from private.current_artifact_promotions promotion
  where promotion.organization_id = target_organization_id
    and promotion.artifact_key = input_promotion ->> 'artifact_key';

  if current_artifact_version_id is null then
    raise exception 'artifact_promotion_current_missing' using errcode = '42501';
  end if;

  if current_artifact_version_id is distinct from
    (input_promotion ->> 'expected_current_artifact_version_id')::uuid
  then
    raise exception 'artifact_promotion_stale' using errcode = '40001';
  end if;

  if not exists (
    select 1
    from public.artifact_versions artifact
    where artifact.organization_id = target_organization_id
      and artifact.id = (input_promotion ->> 'artifact_version_id')::uuid
      and artifact.artifact_key = input_promotion ->> 'artifact_key'
  ) then
    raise exception 'artifact_promotion_version_invalid' using errcode = '42501';
  end if;

  if current_artifact_version_id = (input_promotion ->> 'artifact_version_id')::uuid then
    raise exception 'artifact_promotion_noop' using errcode = '22023';
  end if;

  insert into public.artifact_promotions (
    organization_id,
    artifact_key,
    active_artifact_version_id,
    rollback_artifact_version_id,
    promoted_by
  ) values (
    target_organization_id,
    input_promotion ->> 'artifact_key',
    (input_promotion ->> 'artifact_version_id')::uuid,
    current_artifact_version_id,
    input_promotion ->> 'promoted_by'
  )
  returning id into saved_id;

  return saved_id;
end;
$$;

revoke all on function public.promote_decision_artifact(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.promote_decision_artifact(uuid, jsonb) to service_role;

create function private.validate_decision_record_current_versions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_artifact_version_id uuid;
begin
  if new.playbook_version_id is not null and not exists (
    select 1
    from public.playbook_versions playbook
    where playbook.organization_id = new.organization_id
      and playbook.id = new.playbook_version_id
      and playbook.is_active
  ) then
    raise exception 'decision_playbook_version_not_active' using errcode = '42501';
  end if;

  select promotion.active_artifact_version_id
  into current_artifact_version_id
  from private.current_artifact_promotions promotion
  where promotion.organization_id = new.organization_id
    and promotion.artifact_key = 'ranking_weights';
  if current_artifact_version_id is null
    or new.ranking_weights_id is distinct from current_artifact_version_id
  then
    raise exception 'decision_ranking_weights_not_current' using errcode = '42501';
  end if;

  select promotion.active_artifact_version_id
  into current_artifact_version_id
  from private.current_artifact_promotions promotion
  where promotion.organization_id = new.organization_id
    and promotion.artifact_key = 'confidence_calibration';
  if current_artifact_version_id is null
    or new.confidence_calibration_id is distinct from current_artifact_version_id
  then
    raise exception 'decision_confidence_calibration_not_current' using errcode = '42501';
  end if;

  if new.prompt_version_id is not null then
    select promotion.active_artifact_version_id
    into current_artifact_version_id
    from private.current_artifact_promotions promotion
    where promotion.organization_id = new.organization_id
      and promotion.artifact_key = 'prompt';
    if current_artifact_version_id is null
      or new.prompt_version_id is distinct from current_artifact_version_id
    then
      raise exception 'decision_prompt_version_not_current' using errcode = '42501';
    end if;
  end if;

  if new.model_id is not null then
    select promotion.active_artifact_version_id
    into current_artifact_version_id
    from private.current_artifact_promotions promotion
    where promotion.organization_id = new.organization_id
      and promotion.artifact_key = 'model';
    if current_artifact_version_id is null
      or new.model_id is distinct from current_artifact_version_id
    then
      raise exception 'decision_model_version_not_current' using errcode = '42501';
    end if;
  end if;

  if new.judge_version_id is not null then
    select promotion.active_artifact_version_id
    into current_artifact_version_id
    from private.current_artifact_promotions promotion
    where promotion.organization_id = new.organization_id
      and promotion.artifact_key = 'judge';
    if current_artifact_version_id is null
      or new.judge_version_id is distinct from current_artifact_version_id
    then
      raise exception 'decision_judge_version_not_current' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_decision_record_current_versions()
  from public, anon, authenticated;

create trigger decision_records_validate_current_versions
before insert on public.decision_records
for each row execute function private.validate_decision_record_current_versions();

create or replace function public.start_decision_cycle(
  target_organization_id uuid,
  input_cycle jsonb
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
    or jsonb_typeof(input_cycle) <> 'object'
    or not private.decision_json_has_exact(
      input_cycle,
      array[
        'id', 'organization_id', 'trigger_name', 'correlation_id',
        'slot_budget', 'max_scored_candidates'
      ],
      array[
        'organization_id', 'trigger_name', 'correlation_id',
        'slot_budget', 'max_scored_candidates'
      ]
    )
    or (input_cycle ? 'id' and not private.decision_json_is_uuid(input_cycle -> 'id'))
    or not private.decision_json_is_uuid(input_cycle -> 'organization_id')
    or not private.decision_json_is_text(input_cycle -> 'trigger_name', 1, 160)
    or input_cycle ->> 'trigger_name'
      is distinct from pg_catalog.btrim(input_cycle ->> 'trigger_name')
    or not private.decision_json_is_uuid(input_cycle -> 'correlation_id')
    or not private.decision_json_is_integer(input_cycle -> 'slot_budget')
    or (input_cycle ->> 'slot_budget')::numeric not between 0 and 100
    or not private.decision_json_is_integer(input_cycle -> 'max_scored_candidates')
    or (input_cycle ->> 'max_scored_candidates')::numeric not between 0 and 500
  then
    raise exception 'decision_cycle_invalid' using errcode = '22023';
  end if;

  if input_cycle ->> 'organization_id' is distinct from target_organization_id::text then
    raise exception 'decision_cycle_organization_mismatch' using errcode = '42501';
  end if;

  saved_id := coalesce((input_cycle ->> 'id')::uuid, gen_random_uuid());

  insert into public.decision_cycles (
    id,
    organization_id,
    trigger_name,
    correlation_id,
    slot_budget,
    max_scored_candidates
  ) values (
    saved_id,
    target_organization_id,
    input_cycle ->> 'trigger_name',
    (input_cycle ->> 'correlation_id')::uuid,
    (input_cycle ->> 'slot_budget')::integer,
    (input_cycle ->> 'max_scored_candidates')::integer
  );

  return saved_id;
end;
$$;

revoke all on function public.start_decision_cycle(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.start_decision_cycle(uuid, jsonb) to service_role;
