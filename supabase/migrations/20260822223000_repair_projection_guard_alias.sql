-- Rename an alias that collided with a variable.
--
-- The control-total check aliased its subquery `output`, which is also the name
-- of the loop variable holding the current output, so plpgsql raised
-- "column reference is ambiguous" the moment any declaration actually stated a
-- total. Every control total was therefore unusable, which is what the new
-- pgTAP suite caught on its first run.
--
-- Only the alias changes. Same rules, same messages.

create or replace function private.assert_report_projection_document(p_document jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  output jsonb;
  control jsonb;
  period_grain boolean;
begin
  period_grain := p_document ->> 'outputKind' = 'period_grain';

  if jsonb_typeof(p_document) <> 'object'
    or coalesce((
      select bool_or(key not in ('schemaVersion', 'outputKind', 'outputs', 'controlTotals', 'grain', 'periodKey'))
      from jsonb_object_keys(p_document) key), false)
    or p_document ->> 'schemaVersion' <> '1'
    or p_document ->> 'outputKind' not in ('exact_range', 'period_grain')
    or jsonb_typeof(p_document -> 'outputs') <> 'array'
    or jsonb_array_length(p_document -> 'outputs') not between 1 and 50
    -- A grain and a period key belong to a series and to nothing else.
    or (not period_grain and (p_document ? 'grain' or p_document ? 'periodKey'))
    or (period_grain and (
      p_document ->> 'grain' not in ('day', 'week', 'month')
      or jsonb_typeof(p_document -> 'periodKey') <> 'object'
      or coalesce((
        select bool_or(key not in ('normalizedSheetName', 'canonicalField'))
        from jsonb_object_keys(p_document -> 'periodKey') key), false)
      or coalesce(p_document -> 'periodKey' ->> 'normalizedSheetName', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(p_document -> 'periodKey' ->> 'canonicalField', '') !~ '^[a-z][a-z0-9_]{0,63}$'
    )) then
    raise exception 'report projection document is invalid' using errcode = '22023';
  end if;

  for output in select value from jsonb_array_elements(p_document -> 'outputs') loop
    if jsonb_typeof(output) <> 'object'
      or coalesce((select bool_or(key not in ('key', 'normalizedSheetName', 'canonicalField', 'metricKey', 'valueKind', 'aggregation')) from jsonb_object_keys(output) key), false)
      or coalesce(output ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(output ->> 'normalizedSheetName', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(output ->> 'canonicalField', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(output ->> 'metricKey', '') !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'
      or output ->> 'valueKind' not in ('money', 'count')
      or output ->> 'aggregation' <> 'sum'
      -- The date has to come from the same sheet as the values it dates, and
      -- cannot also be projected as one of them.
      or (period_grain and (
        output ->> 'normalizedSheetName' <> p_document -> 'periodKey' ->> 'normalizedSheetName'
        or output ->> 'canonicalField' = p_document -> 'periodKey' ->> 'canonicalField'
      )) then
      raise exception 'report projection output rule is invalid' using errcode = '22023';
    end if;
  end loop;

  if (select count(*) from jsonb_array_elements(p_document -> 'outputs')) <>
    (select count(distinct value ->> 'key') from jsonb_array_elements(p_document -> 'outputs'))
    or (select count(*) from jsonb_array_elements(p_document -> 'outputs')) <>
    (select count(distinct value ->> 'metricKey') from jsonb_array_elements(p_document -> 'outputs'))
    or (select count(*) from jsonb_array_elements(p_document -> 'outputs')) <>
    (select count(distinct concat_ws(':', value ->> 'normalizedSheetName', value ->> 'canonicalField')) from jsonb_array_elements(p_document -> 'outputs')) then
    raise exception 'report projection outputs are duplicated' using errcode = '22023';
  end if;

  if p_document ? 'controlTotals' then
    if jsonb_typeof(p_document -> 'controlTotals') <> 'array'
      or jsonb_array_length(p_document -> 'controlTotals') > 50
      -- Two totals for one output would either agree, and be redundant, or
      -- disagree, and leave no honest answer about which one governs.
      or (select count(*) from jsonb_array_elements(p_document -> 'controlTotals')) <>
         (select count(distinct value ->> 'outputKey') from jsonb_array_elements(p_document -> 'controlTotals')) then
      raise exception 'report projection document is invalid' using errcode = '22023';
    end if;
    for control in select value from jsonb_array_elements(p_document -> 'controlTotals') loop
      if jsonb_typeof(control) <> 'object'
        or coalesce((
          select bool_or(key not in ('outputKey', 'source', 'statedTotalMinorUnits', 'toleranceMinorUnits', 'statedSource'))
          from jsonb_object_keys(control) key), false)
        or coalesce(control ->> 'source', 'operator_stated') not in ('operator_stated', 'sheet_totals_row')
        or coalesce((control ->> 'toleranceMinorUnits')::bigint, -1) not between 0 and 100000000
        -- Only a money output can be reconciled to a stated total, per ADR 0029.
        or not exists (
          select 1 from jsonb_array_elements(p_document -> 'outputs') emitted
          where emitted.value ->> 'key' = control ->> 'outputKey'
            and emitted.value ->> 'valueKind' = 'money'
        )
        or (coalesce(control ->> 'source', 'operator_stated') = 'operator_stated' and (
          coalesce(control ->> 'statedTotalMinorUnits', '') !~ '^-?[0-9]{1,18}$'
          or char_length(coalesce(control ->> 'statedSource', '')) not between 1 and 200
        ))
        -- A total taken from the sheet cannot also be stated by hand.
        or (control ->> 'source' = 'sheet_totals_row'
          and (control ? 'statedTotalMinorUnits' or control ? 'statedSource')) then
        raise exception 'report projection control total is invalid' using errcode = '22023';
      end if;
    end loop;
  end if;
end;
$$;

create or replace function private.assert_report_projection_matches_contract(
  p_organization_id uuid,
  p_contract_version public.report_contract_versions,
  p_document jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  output jsonb;
  control jsonb;
  source_field jsonb;
  period_field jsonb;
  definition_row public.metric_definitions;
  period_grain boolean;
begin
  perform private.assert_report_projection_document(p_document);
  period_grain := p_document ->> 'outputKind' = 'period_grain';

  if period_grain then
    -- The column the rows are dated by has to exist, be required of every row,
    -- and be a date. A row that cannot be dated cannot be filed anywhere.
    select field.value into period_field
    from jsonb_array_elements((p_contract_version).mapping_document -> 'sheets') sheet,
      jsonb_array_elements(sheet.value -> 'fields') field
    where sheet.value ->> 'normalizedSheetName' = p_document -> 'periodKey' ->> 'normalizedSheetName'
      and field.value ->> 'canonicalField' = p_document -> 'periodKey' ->> 'canonicalField'
    limit 1;
    if period_field is null
      or period_field ->> 'parser' <> 'local_date'
      or not coalesce((period_field ->> 'required')::boolean, false) then
      raise exception 'report projection period field is not an approved required date' using errcode = '23514';
    end if;
  end if;

  for output in select value from jsonb_array_elements(p_document -> 'outputs') loop
    select field.value into source_field
    from jsonb_array_elements((p_contract_version).mapping_document -> 'sheets') sheet,
      jsonb_array_elements(sheet.value -> 'fields') field
    where sheet.value ->> 'normalizedSheetName' = output ->> 'normalizedSheetName'
      and field.value ->> 'canonicalField' = output ->> 'canonicalField'
      -- A sum over one declared period is unknowable if any row is silent, so
      -- its source must be required. A daily series expects gaps and must not
      -- demand one, or the provider's own normal export becomes unmappable.
      and (period_grain or (field.value ->> 'required')::boolean)
    limit 1;
    if source_field is null
      or ((output ->> 'valueKind' = 'money') and source_field ->> 'parser' <> 'money')
      or ((output ->> 'valueKind' = 'count') and source_field ->> 'parser' <> 'integer') then
      raise exception 'report projection does not match approved required contract field' using errcode = '23514';
    end if;
    select * into definition_row from public.metric_definitions
    where key = output ->> 'metricKey' and is_active
      and (organization_id is null or organization_id = p_organization_id)
    order by (organization_id is not null) desc
    limit 1;
    if not found or definition_row.value_kind <> output ->> 'valueKind' or definition_row.aggregation <> 'sum' then
      raise exception 'report projection metric definition is invalid' using errcode = '23514';
    end if;
  end loop;

  -- A total taken from the sheet needs the sheet to declare one.
  for control in select value from jsonb_array_elements(coalesce(p_document -> 'controlTotals', '[]'::jsonb)) loop
    if control ->> 'source' = 'sheet_totals_row' and not exists (
      select 1
      from jsonb_array_elements(p_document -> 'outputs') emitted,
        jsonb_array_elements((p_contract_version).mapping_document -> 'sheets') sheet
      where emitted.value ->> 'key' = control ->> 'outputKey'
        and sheet.value ->> 'normalizedSheetName' = emitted.value ->> 'normalizedSheetName'
        and sheet.value ? 'totalsRow'
    ) then
      raise exception 'report projection control total has no approved totals row' using errcode = '23514';
    end if;
  end loop;
end;
$$;
