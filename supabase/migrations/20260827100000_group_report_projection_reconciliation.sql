-- Replace row-by-row reconciliation evidence with an action-oriented read model.
--
-- The immutable reconciliation ledger remains the source of truth. This
-- migration adds a tenant-scoped projection that exposes only unresolved
-- ambiguous overlaps, grouped by the uploaded field that needs one decision.
-- A matching group resolver applies that decision atomically to every affected
-- observation while retaining one resolution record per ledger row.

-- Period-grain projection completion already assigns each blocked candidate the
-- successor revision for its tuple. Resolution therefore needs to permit a
-- blocked -> current transition that retains that preassigned revision. The
-- resolver below still proves that the revision is at least one above every
-- prior row before it performs the transition.
create or replace function private.prevent_normalized_metric_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.to_jsonb(new) - array['superseded_by_id', 'supersede_reason', 'reconciliation_state', 'revision']
    is distinct from pg_catalog.to_jsonb(old) - array['superseded_by_id', 'supersede_reason', 'reconciliation_state', 'revision'] then
    raise exception 'normalized_metric_is_append_only' using errcode = '23514';
  end if;

  if old.superseded_by_id is null and new.superseded_by_id is not null
    and new.reconciliation_state = old.reconciliation_state
    and new.revision = old.revision then
    return new;
  end if;

  if old.superseded_by_id is not null then
    raise exception 'normalized_metric_already_superseded' using errcode = '23514';
  end if;

  if old.reconciliation_state = 'blocked_overlap' and new.reconciliation_state = 'current'
    and new.revision >= old.revision
    and new.superseded_by_id is not distinct from old.superseded_by_id
    and new.supersede_reason is not distinct from old.supersede_reason then
    return new;
  end if;

  if old.reconciliation_state in ('blocked_overlap', 'current') and new.reconciliation_state = 'excluded'
    and new.revision is not distinct from old.revision
    and new.superseded_by_id is not distinct from old.superseded_by_id
    and new.supersede_reason is not distinct from old.supersede_reason then
    return new;
  end if;

  raise exception 'normalized_metric_is_append_only' using errcode = '23514';
end;
$$;

create or replace function public.list_governed_report_projection_reconciliation_groups(
  p_organization_id uuid
)
returns table (
  representative_reconciliation_id uuid,
  organization_id uuid,
  report_package_id uuid,
  projection_run_id uuid,
  projection_output_key text,
  projection_target text,
  metric_key text,
  normalized_sheet_name text,
  canonical_field text,
  source_header text,
  affected_record_count integer,
  matching_record_count integer,
  affected_dates date[],
  affected_dates_truncated boolean,
  first_period date,
  last_period date,
  prior_upload_count integer,
  prior_report_type text,
  prior_period_start date,
  prior_period_end date
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recent_packages as (
    select package.id
    from public.integration_report_packages package
    where package.organization_id = p_organization_id
    order by package.created_at desc
    limit 30
  ), unresolved as (
    select
      reconciliation.*,
      coalesce(
        reconciliation.period_start,
        result_exact.period_start,
        (result_metric.period_start at time zone result_metric.period_timezone)::date
      ) as affected_date,
      coalesce(
        reconciliation.result_normalized_metric_id::text,
        reconciliation.result_observation_id::text
      ) as result_evidence_id,
      coalesce(
        reconciliation.prior_normalized_metric_id::text,
        reconciliation.prior_observation_id::text
      ) as prior_evidence_id,
      output_rule.document ->> 'metricKey' as metric_key,
      output_rule.document ->> 'normalizedSheetName' as normalized_sheet_name,
      output_rule.document ->> 'canonicalField' as canonical_field,
      source_rule.source_header,
      prior_package.id as prior_package_id,
      prior_package.report_type as prior_report_type,
      prior_package.declared_period_start as prior_period_start,
      prior_package.declared_period_end as prior_period_end
    from public.report_projection_reconciliations reconciliation
    join recent_packages recent on recent.id = reconciliation.report_package_id
    join public.integration_report_projection_runs projection_run
      on projection_run.organization_id = reconciliation.organization_id
      and projection_run.id = reconciliation.projection_run_id
    join public.report_projection_versions projection_version
      on projection_version.organization_id = projection_run.organization_id
      and projection_version.id = projection_run.report_projection_version_id
    join public.report_contract_versions contract_version
      on contract_version.organization_id = projection_run.organization_id
      and contract_version.id = projection_run.report_contract_version_id
    left join public.exact_range_metric_observations result_exact
      on result_exact.organization_id = reconciliation.organization_id
      and result_exact.id = reconciliation.result_observation_id
    left join public.normalized_metrics result_metric
      on result_metric.organization_id = reconciliation.organization_id
      and result_metric.id = reconciliation.result_normalized_metric_id
    left join public.exact_range_metric_observations prior_exact
      on prior_exact.organization_id = reconciliation.organization_id
      and prior_exact.id = reconciliation.prior_observation_id
    left join public.report_projection_lineage prior_lineage
      on prior_lineage.organization_id = reconciliation.organization_id
      and (
        prior_lineage.exact_range_metric_observation_id = reconciliation.prior_observation_id
        or prior_lineage.normalized_metric_id = reconciliation.prior_normalized_metric_id
      )
    left join public.integration_report_packages prior_package
      on prior_package.organization_id = reconciliation.organization_id
      and prior_package.id = coalesce(prior_lineage.report_package_id, prior_exact.report_package_id)
    left join lateral (
      select output.value as document
      from pg_catalog.jsonb_array_elements(
        coalesce(projection_version.projection_document -> 'outputs', '[]'::jsonb)
      ) output(value)
      where output.value ->> 'key' = reconciliation.projection_output_key
      limit 1
    ) output_rule on true
    left join lateral (
      select field.value ->> 'sourceHeader' as source_header
      from pg_catalog.jsonb_array_elements(
        coalesce(contract_version.mapping_document -> 'sheets', '[]'::jsonb)
      ) sheet(value)
      cross join lateral pg_catalog.jsonb_array_elements(
        coalesce(sheet.value -> 'fields', '[]'::jsonb)
      ) field(value)
      where sheet.value ->> 'normalizedSheetName' = output_rule.document ->> 'normalizedSheetName'
        and field.value ->> 'canonicalField' = output_rule.document ->> 'canonicalField'
      limit 1
    ) source_rule on true
    where reconciliation.organization_id = p_organization_id
      and private.is_organization_member(p_organization_id)
      and reconciliation.classification = 'ambiguous_overlap'
      and not exists (
        select 1
        from public.report_projection_reconciliation_resolutions resolution
        where resolution.organization_id = reconciliation.organization_id
          and resolution.reconciliation_id = reconciliation.id
      )
  )
  select
    min(unresolved.id::text)::uuid as representative_reconciliation_id,
    unresolved.organization_id,
    unresolved.report_package_id,
    unresolved.projection_run_id,
    unresolved.projection_output_key,
    unresolved.projection_target,
    min(unresolved.metric_key) as metric_key,
    min(unresolved.normalized_sheet_name) as normalized_sheet_name,
    min(unresolved.canonical_field) as canonical_field,
    min(unresolved.source_header) as source_header,
    count(distinct unresolved.result_evidence_id)::integer as affected_record_count,
    count(distinct unresolved.prior_evidence_id)::integer as matching_record_count,
    coalesce(
      (array_agg(distinct unresolved.affected_date order by unresolved.affected_date)
        filter (where unresolved.affected_date is not null))[1:100],
      '{}'::date[]
    ) as affected_dates,
    count(distinct unresolved.affected_date) > 100 as affected_dates_truncated,
    min(unresolved.affected_date) as first_period,
    max(unresolved.affected_date) as last_period,
    count(distinct unresolved.prior_package_id)::integer as prior_upload_count,
    case when count(distinct unresolved.prior_package_id) = 1
      then min(unresolved.prior_report_type)
      else null
    end as prior_report_type,
    min(unresolved.prior_period_start) as prior_period_start,
    max(unresolved.prior_period_end) as prior_period_end
  from unresolved
  group by
    unresolved.organization_id,
    unresolved.report_package_id,
    unresolved.projection_run_id,
    unresolved.projection_output_key,
    unresolved.projection_target
  order by min(unresolved.created_at), unresolved.projection_output_key
  limit 50;
$$;

comment on function public.list_governed_report_projection_reconciliation_groups(uuid) is
  'Lists at most fifty unresolved overlap actions for the thirty most recent report packages. Harmless reconciliation history and raw workbook data are intentionally omitted.';

revoke all on function public.list_governed_report_projection_reconciliation_groups(uuid) from public, anon;
grant execute on function public.list_governed_report_projection_reconciliation_groups(uuid) to authenticated;

create or replace function public.resolve_governed_report_projection_overlap_group(
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
#variable_conflict use_variable
declare
  requested_reconciliation public.report_projection_reconciliations;
  reconciliation_row public.report_projection_reconciliations;
  inserted_resolution public.report_projection_reconciliation_resolutions;
  group_row_count integer;
  existing_resolution_count integer;
  result_count integer;
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
  where organization_id = p_organization_id
    and id = p_reconciliation_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'not_found', 'resolvedCount', 0);
  end if;

  if requested_reconciliation.classification <> 'ambiguous_overlap' then
    return pg_catalog.jsonb_build_object('outcome', 'not_ready', 'resolvedCount', 0);
  end if;

  -- A stable lock order turns two simultaneous clicks into a replay rather than
  -- two partial decisions.
  perform reconciliation.id
  from public.report_projection_reconciliations reconciliation
  where reconciliation.organization_id = p_organization_id
    and reconciliation.report_package_id = requested_reconciliation.report_package_id
    and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
    and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
    and reconciliation.projection_target = requested_reconciliation.projection_target
    and reconciliation.classification = 'ambiguous_overlap'
  order by reconciliation.id
  for update;

  select count(*)::integer into group_row_count
  from public.report_projection_reconciliations reconciliation
  where reconciliation.organization_id = p_organization_id
    and reconciliation.report_package_id = requested_reconciliation.report_package_id
    and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
    and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
    and reconciliation.projection_target = requested_reconciliation.projection_target
    and reconciliation.classification = 'ambiguous_overlap';

  select count(*)::integer into existing_resolution_count
  from public.report_projection_reconciliation_resolutions resolution
  join public.report_projection_reconciliations reconciliation
    on reconciliation.organization_id = resolution.organization_id
    and reconciliation.id = resolution.reconciliation_id
  where reconciliation.organization_id = p_organization_id
    and reconciliation.report_package_id = requested_reconciliation.report_package_id
    and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
    and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
    and reconciliation.projection_target = requested_reconciliation.projection_target
    and reconciliation.classification = 'ambiguous_overlap';

  if group_row_count = 0 then
    return pg_catalog.jsonb_build_object('outcome', 'not_ready', 'resolvedCount', 0);
  end if;
  if existing_resolution_count = group_row_count then
    return pg_catalog.jsonb_build_object('outcome', 'completed', 'resolvedCount', 0);
  end if;
  if existing_resolution_count > 0 then
    return pg_catalog.jsonb_build_object('outcome', 'conflict', 'resolvedCount', 0);
  end if;

  if requested_reconciliation.projection_target = 'period_grain' then
    if exists (
      select 1
      from public.report_projection_reconciliations reconciliation
      left join public.normalized_metrics result_metric
        on result_metric.organization_id = reconciliation.organization_id
        and result_metric.id = reconciliation.result_normalized_metric_id
      where reconciliation.organization_id = p_organization_id
        and reconciliation.report_package_id = requested_reconciliation.report_package_id
        and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
        and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
        and reconciliation.projection_target = requested_reconciliation.projection_target
        and reconciliation.classification = 'ambiguous_overlap'
        and (result_metric.id is null or result_metric.reconciliation_state <> 'blocked_overlap')
    ) then
      return pg_catalog.jsonb_build_object('outcome', 'not_ready', 'resolvedCount', 0);
    end if;
  else
    if exists (
      select 1
      from public.report_projection_reconciliations reconciliation
      left join public.exact_range_metric_observations result_observation
        on result_observation.organization_id = reconciliation.organization_id
        and result_observation.id = reconciliation.result_observation_id
      where reconciliation.organization_id = p_organization_id
        and reconciliation.report_package_id = requested_reconciliation.report_package_id
        and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
        and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
        and reconciliation.projection_target = requested_reconciliation.projection_target
        and reconciliation.classification = 'ambiguous_overlap'
        and (result_observation.id is null or result_observation.reconciliation_state <> 'blocked_overlap')
    ) then
      return pg_catalog.jsonb_build_object('outcome', 'not_ready', 'resolvedCount', 0);
    end if;
  end if;

  if exists (
    select 1
    from public.report_projection_reconciliations reconciliation
    left join public.normalized_metrics prior_metric
      on prior_metric.organization_id = reconciliation.organization_id
      and prior_metric.id = reconciliation.prior_normalized_metric_id
    left join public.exact_range_metric_observations prior_observation
      on prior_observation.organization_id = reconciliation.organization_id
      and prior_observation.id = reconciliation.prior_observation_id
    where reconciliation.organization_id = p_organization_id
      and reconciliation.report_package_id = requested_reconciliation.report_package_id
      and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
      and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
      and reconciliation.projection_target = requested_reconciliation.projection_target
      and reconciliation.classification = 'ambiguous_overlap'
      and (
        (reconciliation.prior_normalized_metric_id is not null
          and (prior_metric.id is null or prior_metric.reconciliation_state <> 'current'
            or prior_metric.superseded_by_id is not null))
        or (reconciliation.prior_observation_id is not null
          and (prior_observation.id is null or prior_observation.reconciliation_state <> 'current'))
        or (reconciliation.prior_normalized_metric_id is null
          and reconciliation.prior_observation_id is null)
      )
  ) then
    return pg_catalog.jsonb_build_object('outcome', 'conflict', 'resolvedCount', 0);
  end if;

  -- Lock every evidence row before the first transition. The statement order
  -- below then removes current evidence before promoting its replacement, so a
  -- uniqueness constraint can never observe two live rows for one tuple.
  perform metric.id
  from public.normalized_metrics metric
  where metric.organization_id = p_organization_id
    and metric.id in (
      select reconciliation.prior_normalized_metric_id
      from public.report_projection_reconciliations reconciliation
      where reconciliation.organization_id = p_organization_id
        and reconciliation.report_package_id = requested_reconciliation.report_package_id
        and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
        and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
        and reconciliation.projection_target = requested_reconciliation.projection_target
      union
      select reconciliation.result_normalized_metric_id
      from public.report_projection_reconciliations reconciliation
      where reconciliation.organization_id = p_organization_id
        and reconciliation.report_package_id = requested_reconciliation.report_package_id
        and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
        and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
        and reconciliation.projection_target = requested_reconciliation.projection_target
    )
  order by metric.id
  for update;

  perform observation.id
  from public.exact_range_metric_observations observation
  where observation.organization_id = p_organization_id
    and observation.id in (
      select reconciliation.prior_observation_id
      from public.report_projection_reconciliations reconciliation
      where reconciliation.organization_id = p_organization_id
        and reconciliation.report_package_id = requested_reconciliation.report_package_id
        and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
        and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
        and reconciliation.projection_target = requested_reconciliation.projection_target
      union
      select reconciliation.result_observation_id
      from public.report_projection_reconciliations reconciliation
      where reconciliation.organization_id = p_organization_id
        and reconciliation.report_package_id = requested_reconciliation.report_package_id
        and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
        and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
        and reconciliation.projection_target = requested_reconciliation.projection_target
    )
  order by observation.id
  for update;

  select count(distinct coalesce(
    reconciliation.result_normalized_metric_id::text,
    reconciliation.result_observation_id::text
  ))::integer into result_count
  from public.report_projection_reconciliations reconciliation
  where reconciliation.organization_id = p_organization_id
    and reconciliation.report_package_id = requested_reconciliation.report_package_id
    and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
    and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
    and reconciliation.projection_target = requested_reconciliation.projection_target
    and reconciliation.classification = 'ambiguous_overlap';

  if p_resolution = 'accept_correction' then
    if requested_reconciliation.projection_target = 'period_grain' then
      if exists (
        select 1
        from public.report_projection_reconciliations reconciliation
        where reconciliation.organization_id = p_organization_id
          and reconciliation.report_package_id = requested_reconciliation.report_package_id
          and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
          and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
          and reconciliation.prior_normalized_metric_id is not null
        group by reconciliation.prior_normalized_metric_id
        having count(distinct reconciliation.result_normalized_metric_id) > 1
      ) then
        return pg_catalog.jsonb_build_object('outcome', 'conflict', 'resolvedCount', 0);
      end if;

      with replacements as (
        select distinct
          reconciliation.prior_normalized_metric_id as prior_id,
          reconciliation.result_normalized_metric_id as result_id
        from public.report_projection_reconciliations reconciliation
        where reconciliation.organization_id = p_organization_id
          and reconciliation.report_package_id = requested_reconciliation.report_package_id
          and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
          and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
          and reconciliation.projection_target = requested_reconciliation.projection_target
          and reconciliation.prior_normalized_metric_id is not null
      )
      update public.normalized_metrics prior
      set superseded_by_id = replacements.result_id,
        supersede_reason = 'approved_correction'
      from replacements
      where prior.organization_id = p_organization_id
        and prior.id = replacements.prior_id;

      update public.exact_range_metric_observations prior
      set reconciliation_state = 'excluded'
      where prior.organization_id = p_organization_id
        and prior.id in (
          select reconciliation.prior_observation_id
          from public.report_projection_reconciliations reconciliation
          where reconciliation.organization_id = p_organization_id
            and reconciliation.report_package_id = requested_reconciliation.report_package_id
            and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
            and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
            and reconciliation.projection_target = requested_reconciliation.projection_target
            and reconciliation.prior_observation_id is not null
        );

      with successor_revisions as (
        select
          result.id,
          pg_catalog.greatest(
            result.revision,
            coalesce(max(prior_metric.revision), max(prior_observation.revision), 0) + 1
          ) as next_revision
        from public.normalized_metrics result
        join public.report_projection_reconciliations reconciliation
          on reconciliation.organization_id = result.organization_id
          and reconciliation.result_normalized_metric_id = result.id
        left join public.normalized_metrics prior_metric
          on prior_metric.organization_id = reconciliation.organization_id
          and prior_metric.id = reconciliation.prior_normalized_metric_id
        left join public.exact_range_metric_observations prior_observation
          on prior_observation.organization_id = reconciliation.organization_id
          and prior_observation.id = reconciliation.prior_observation_id
        where reconciliation.organization_id = p_organization_id
          and reconciliation.report_package_id = requested_reconciliation.report_package_id
          and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
          and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
          and reconciliation.projection_target = requested_reconciliation.projection_target
        group by result.id, result.revision
      )
      update public.normalized_metrics result
      set reconciliation_state = 'current',
        revision = successor_revisions.next_revision
      from successor_revisions
      where result.organization_id = p_organization_id
        and result.id = successor_revisions.id;
    else
      if exists (
        select 1
        from public.report_projection_reconciliations reconciliation
        where reconciliation.organization_id = p_organization_id
          and reconciliation.report_package_id = requested_reconciliation.report_package_id
          and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
          and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
          and reconciliation.prior_observation_id is not null
        group by reconciliation.prior_observation_id
        having count(distinct reconciliation.result_observation_id) > 1
      ) then
        return pg_catalog.jsonb_build_object('outcome', 'conflict', 'resolvedCount', 0);
      end if;

      with replacements as (
        select distinct
          reconciliation.prior_observation_id as prior_id,
          reconciliation.result_observation_id as result_id
        from public.report_projection_reconciliations reconciliation
        where reconciliation.organization_id = p_organization_id
          and reconciliation.report_package_id = requested_reconciliation.report_package_id
          and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
          and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
          and reconciliation.projection_target = requested_reconciliation.projection_target
          and reconciliation.prior_observation_id is not null
      )
      update public.exact_range_metric_observations prior
      set reconciliation_state = 'superseded',
        superseded_by_id = replacements.result_id,
        supersede_reason = 'approved_correction'
      from replacements
      where prior.organization_id = p_organization_id
        and prior.id = replacements.prior_id;

      update public.normalized_metrics prior
      set reconciliation_state = 'excluded'
      where prior.organization_id = p_organization_id
        and prior.id in (
          select reconciliation.prior_normalized_metric_id
          from public.report_projection_reconciliations reconciliation
          where reconciliation.organization_id = p_organization_id
            and reconciliation.report_package_id = requested_reconciliation.report_package_id
            and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
            and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
            and reconciliation.projection_target = requested_reconciliation.projection_target
            and reconciliation.prior_normalized_metric_id is not null
        );

      with successor_revisions as (
        select
          result.id,
          pg_catalog.greatest(
            result.revision,
            coalesce(max(prior_observation.revision), max(prior_metric.revision), 0) + 1
          ) as next_revision
        from public.exact_range_metric_observations result
        join public.report_projection_reconciliations reconciliation
          on reconciliation.organization_id = result.organization_id
          and reconciliation.result_observation_id = result.id
        left join public.exact_range_metric_observations prior_observation
          on prior_observation.organization_id = reconciliation.organization_id
          and prior_observation.id = reconciliation.prior_observation_id
        left join public.normalized_metrics prior_metric
          on prior_metric.organization_id = reconciliation.organization_id
          and prior_metric.id = reconciliation.prior_normalized_metric_id
        where reconciliation.organization_id = p_organization_id
          and reconciliation.report_package_id = requested_reconciliation.report_package_id
          and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
          and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
          and reconciliation.projection_target = requested_reconciliation.projection_target
        group by result.id, result.revision
      )
      update public.exact_range_metric_observations result
      set reconciliation_state = 'current',
        revision = successor_revisions.next_revision
      from successor_revisions
      where result.organization_id = p_organization_id
        and result.id = successor_revisions.id;
    end if;
  else
    if requested_reconciliation.projection_target = 'period_grain' then
      update public.normalized_metrics result
      set reconciliation_state = 'excluded'
      where result.organization_id = p_organization_id
        and result.id in (
          select reconciliation.result_normalized_metric_id
          from public.report_projection_reconciliations reconciliation
          where reconciliation.organization_id = p_organization_id
            and reconciliation.report_package_id = requested_reconciliation.report_package_id
            and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
            and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
            and reconciliation.projection_target = requested_reconciliation.projection_target
        );
    else
      update public.exact_range_metric_observations result
      set reconciliation_state = 'excluded'
      where result.organization_id = p_organization_id
        and result.id in (
          select reconciliation.result_observation_id
          from public.report_projection_reconciliations reconciliation
          where reconciliation.organization_id = p_organization_id
            and reconciliation.report_package_id = requested_reconciliation.report_package_id
            and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
            and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
            and reconciliation.projection_target = requested_reconciliation.projection_target
        );
    end if;
  end if;

  for reconciliation_row in
    select reconciliation.*
    from public.report_projection_reconciliations reconciliation
    where reconciliation.organization_id = p_organization_id
      and reconciliation.report_package_id = requested_reconciliation.report_package_id
      and reconciliation.projection_run_id = requested_reconciliation.projection_run_id
      and reconciliation.projection_output_key = requested_reconciliation.projection_output_key
      and reconciliation.projection_target = requested_reconciliation.projection_target
      and reconciliation.classification = 'ambiguous_overlap'
    order by reconciliation.id
  loop
    insert into public.report_projection_reconciliation_resolutions (
      organization_id, reconciliation_id, resolution, outcome_classification, reconciliation_digest,
      prior_observation_id, prior_normalized_metric_id, result_observation_id,
      result_normalized_metric_id, resolved_by, correlation_id
    ) values (
      p_organization_id, reconciliation_row.id, p_resolution,
      case when p_resolution = 'accept_correction' then 'approved_correction' else 'existing_retained' end,
      reconciliation_row.reconciliation_digest, reconciliation_row.prior_observation_id,
      reconciliation_row.prior_normalized_metric_id, reconciliation_row.result_observation_id,
      reconciliation_row.result_normalized_metric_id, p_actor_id, p_correlation_id
    ) returning * into inserted_resolution;

    insert into public.audit_events (
      organization_id, event_name, actor_type, actor_id, entity_type, entity_id,
      correlation_id, payload
    ) values (
      p_organization_id, 'report_projection.overlap_resolved', 'user', p_actor_id,
      'report_projection_reconciliation_resolution', inserted_resolution.id,
      p_correlation_id,
      pg_catalog.jsonb_build_object(
        'reconciliationId', reconciliation_row.id,
        'resolution', p_resolution,
        'outcomeClassification', inserted_resolution.outcome_classification,
        'projectionTarget', reconciliation_row.projection_target,
        'priorObservationId', reconciliation_row.prior_observation_id,
        'priorNormalizedMetricId', reconciliation_row.prior_normalized_metric_id,
        'resultObservationId', reconciliation_row.result_observation_id,
        'resultNormalizedMetricId', reconciliation_row.result_normalized_metric_id,
        'reconciliationDigest', reconciliation_row.reconciliation_digest
      )
    );
  end loop;

  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id,
    correlation_id, payload
  ) values (
    p_organization_id, 'report_projection.overlap_group_resolved', 'user', p_actor_id,
    'integration_report_package', requested_reconciliation.report_package_id,
    p_correlation_id,
    pg_catalog.jsonb_build_object(
      'representativeReconciliationId', p_reconciliation_id,
      'projectionRunId', requested_reconciliation.projection_run_id,
      'projectionOutputKey', requested_reconciliation.projection_output_key,
      'projectionTarget', requested_reconciliation.projection_target,
      'resolution', p_resolution,
      'affectedRecordCount', result_count
    )
  );

  select case when projection_run.status = 'partially_projected'
    then 'partially_projected'
    else 'projected'
  end into package_status
  from public.integration_report_projection_runs projection_run
  where projection_run.organization_id = p_organization_id
    and projection_run.id = requested_reconciliation.projection_run_id;

  update public.integration_report_packages package
  set status = case when exists (
      select 1
      from public.exact_range_metric_observations observation
      where observation.organization_id = p_organization_id
        and observation.report_package_id = package.id
        and observation.reconciliation_state = 'blocked_overlap'
    ) or exists (
      select 1
      from public.report_projection_lineage lineage
      join public.normalized_metrics metric
        on metric.organization_id = lineage.organization_id
        and metric.id = lineage.normalized_metric_id
      where lineage.organization_id = p_organization_id
        and lineage.report_package_id = package.id
        and metric.reconciliation_state = 'blocked_overlap'
    ) then 'reconciliation_required' else package_status end,
    correlation_id = p_correlation_id
  where package.organization_id = p_organization_id
    and package.id = requested_reconciliation.report_package_id;

  return pg_catalog.jsonb_build_object(
    'outcome', 'resolved',
    'resolvedCount', result_count
  );
end;
$$;

comment on function public.resolve_governed_report_projection_overlap_group(uuid, uuid, uuid, text, text, uuid) is
  'Applies one owner or admin decision to every unresolved overlap for one package projection output in one transaction.';

revoke all on function public.resolve_governed_report_projection_overlap_group(uuid, uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.resolve_governed_report_projection_overlap_group(uuid, uuid, uuid, text, text, uuid) to authenticated;
