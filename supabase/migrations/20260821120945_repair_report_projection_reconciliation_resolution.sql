-- Repair the first reconciliation slice without rewriting its applied migration.
-- A correction must decide every active overlap for one blocked candidate in a
-- single transaction; otherwise a partial decision could create an accidental
-- current rollup. Resolution rows are append-only, safe evidence.

alter table public.report_projection_reconciliation_resolutions
  add column outcome_classification text
    check (outcome_classification in ('approved_correction', 'existing_retained'));

create or replace function private.prevent_report_projection_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_table_name <> 'exact_range_metric_observations' then
    raise exception 'report_projection_evidence_is_append_only' using errcode = '55000';
  end if;

  if to_jsonb(new) - array['reconciliation_state', 'revision', 'superseded_by_id', 'supersede_reason']
     is distinct from to_jsonb(old) - array['reconciliation_state', 'revision', 'superseded_by_id', 'supersede_reason'] then
    raise exception 'report_projection_evidence_is_append_only' using errcode = '55000';
  end if;

  if old.reconciliation_state = 'blocked_overlap'
    and new.reconciliation_state = 'current'
    and new.revision > old.revision
    and new.superseded_by_id is not distinct from old.superseded_by_id
    and new.supersede_reason is not distinct from old.supersede_reason then
    return new;
  end if;
  if old.reconciliation_state = 'blocked_overlap'
    and new.reconciliation_state = 'excluded'
    and new.revision is not distinct from old.revision
    and new.superseded_by_id is not distinct from old.superseded_by_id
    and new.supersede_reason is not distinct from old.supersede_reason then
    return new;
  end if;
  if old.reconciliation_state = 'current'
    and new.reconciliation_state = 'superseded'
    and new.revision is not distinct from old.revision
    and new.superseded_by_id is not null
    and new.supersede_reason = 'approved_correction' then
    return new;
  end if;
  raise exception 'report_projection_evidence_is_append_only' using errcode = '55000';
end;
$$;

create or replace function public.resolve_governed_report_projection_overlap(
  p_organization_id uuid,
  p_actor_id uuid,
  p_reconciliation_id uuid,
  p_resolution text,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  requested_reconciliation public.report_projection_reconciliations;
  reconciliation_row public.report_projection_reconciliations;
  result_row public.exact_range_metric_observations;
  prior_row public.exact_range_metric_observations;
  resolution_row public.report_projection_reconciliation_resolutions;
  prior_ids uuid[] := '{}';
  reconciliation_ids uuid[] := '{}';
  prior_id uuid;
  next_revision integer;
  package_status text;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.contract_approve') then
    raise exception 'report overlap resolution is not authorized' using errcode = '42501';
  end if;
  if p_resolution not in ('accept_correction', 'keep_existing')
    or char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'report overlap resolution is invalid' using errcode = '22023';
  end if;

  select * into requested_reconciliation
  from public.report_projection_reconciliations
  where organization_id = p_organization_id and id = p_reconciliation_id
  for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;

  select * into resolution_row from public.report_projection_reconciliation_resolutions
  where organization_id = p_organization_id and reconciliation_id = p_reconciliation_id;
  if found then return jsonb_build_object('outcome', 'completed', 'resolution', to_jsonb(resolution_row)); end if;

  if requested_reconciliation.classification <> 'ambiguous_overlap'
    or requested_reconciliation.result_observation_id is null then
    return jsonb_build_object('outcome', 'not_ready');
  end if;

  select * into result_row from public.exact_range_metric_observations
  where organization_id = p_organization_id and id = requested_reconciliation.result_observation_id
  for update;
  if not found or result_row.reconciliation_state <> 'blocked_overlap' then
    return jsonb_build_object('outcome', 'not_ready');
  end if;

  for reconciliation_row in
    select * from public.report_projection_reconciliations
    where organization_id = p_organization_id
      and result_observation_id = result_row.id
      and classification = 'ambiguous_overlap'
    order by id
    for update
  loop
    if exists (
      select 1 from public.report_projection_reconciliation_resolutions r
      where r.organization_id = p_organization_id and r.reconciliation_id = reconciliation_row.id
    ) then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    if reconciliation_row.prior_observation_id is null then
      return jsonb_build_object('outcome', 'not_ready');
    end if;
    select * into prior_row from public.exact_range_metric_observations
    where organization_id = p_organization_id and id = reconciliation_row.prior_observation_id
    for update;
    if not found or prior_row.reconciliation_state <> 'current' then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    reconciliation_ids := array_append(reconciliation_ids, reconciliation_row.id);
    prior_ids := array_append(prior_ids, prior_row.id);
  end loop;
  if cardinality(reconciliation_ids) = 0 then return jsonb_build_object('outcome', 'not_ready'); end if;

  if p_resolution = 'accept_correction' then
    select coalesce(max(revision), 0) + 1 into next_revision
    from public.exact_range_metric_observations
    where organization_id = p_organization_id and id = any(prior_ids);
    update public.exact_range_metric_observations
    set reconciliation_state = 'current', revision = next_revision
    where organization_id = p_organization_id and id = result_row.id;
    update public.exact_range_metric_observations
    set reconciliation_state = 'superseded', superseded_by_id = result_row.id,
      supersede_reason = 'approved_correction'
    where organization_id = p_organization_id and id = any(prior_ids);
  else
    update public.exact_range_metric_observations
    set reconciliation_state = 'excluded'
    where organization_id = p_organization_id and id = result_row.id;
  end if;

  for reconciliation_row in
    select * from public.report_projection_reconciliations
    where organization_id = p_organization_id and id = any(reconciliation_ids)
    order by id
  loop
    insert into public.report_projection_reconciliation_resolutions (
      organization_id, reconciliation_id, resolution, outcome_classification, reconciliation_digest,
      prior_observation_id, result_observation_id, resolved_by, correlation_id
    ) values (
      p_organization_id, reconciliation_row.id, p_resolution,
      case when p_resolution = 'accept_correction' then 'approved_correction' else 'existing_retained' end,
      reconciliation_row.reconciliation_digest, reconciliation_row.prior_observation_id,
      result_row.id, p_actor_id, p_correlation_id
    ) returning * into resolution_row;
    insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload)
    values (p_organization_id, 'report_projection.overlap_resolved', 'user', p_actor_id,
      'report_projection_reconciliation_resolution', resolution_row.id, p_correlation_id,
      jsonb_build_object('reconciliationId', reconciliation_row.id, 'resolution', p_resolution,
        'outcomeClassification', resolution_row.outcome_classification,
        'priorObservationId', reconciliation_row.prior_observation_id,
        'resultObservationId', result_row.id, 'reconciliationDigest', reconciliation_row.reconciliation_digest));
  end loop;

  if p_resolution = 'accept_correction' then
    insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload)
    values (p_organization_id, 'report_projection.correction_accepted', 'user', p_actor_id,
      'exact_range_metric_observation', result_row.id, p_correlation_id,
      jsonb_build_object('resultObservationId', result_row.id, 'priorObservationIds', prior_ids,
        'reconciliationIds', reconciliation_ids, 'revision', next_revision));
    foreach prior_id in array prior_ids loop
      insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload)
      values (p_organization_id, 'exact_range_metric_observation.superseded', 'user', p_actor_id,
        'exact_range_metric_observation', prior_id, p_correlation_id,
        jsonb_build_object('supersededById', result_row.id, 'revision', next_revision));
    end loop;
  end if;

  select case when r.status = 'partially_projected' then 'partially_projected' else 'projected' end
  into package_status
  from public.integration_report_projection_runs r
  where r.organization_id = p_organization_id and r.id = requested_reconciliation.projection_run_id;
  update public.integration_report_packages p
  set status = case when exists (
      select 1 from public.exact_range_metric_observations o
      where o.organization_id = p_organization_id and o.report_package_id = p.id
        and o.reconciliation_state = 'blocked_overlap'
    ) then 'reconciliation_required' else package_status end,
    correlation_id = p_correlation_id
  where p.organization_id = p_organization_id and p.id = requested_reconciliation.report_package_id;
  return jsonb_build_object('outcome', 'resolved', 'resolution', to_jsonb(resolution_row));
end;
$$;

revoke all on function private.prevent_report_projection_evidence_mutation() from public;
revoke all on function public.resolve_governed_report_projection_overlap(uuid, uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.resolve_governed_report_projection_overlap(uuid, uuid, uuid, text, text, uuid) to authenticated;
