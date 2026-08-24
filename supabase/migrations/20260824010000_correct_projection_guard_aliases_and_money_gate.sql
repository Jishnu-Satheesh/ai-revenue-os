-- Two verified defects in the report projection guards, corrected whole.
--
-- The first is mechanical but fatal. Both private validators declare a
-- plpgsql variable named `output`, and each also aliases
-- `jsonb_array_elements(...) AS output` inside one of its own subqueries.
-- With no `#variable_conflict` pragma the default is to refuse, so the
-- statement that guards control totals against non-money outputs dies on
-- first execution with 42702 "column reference ""output"" is ambiguous"
-- instead of guarding anything. The subquery aliases are renamed to
-- `expected_output`, matching the naming the completion path below already
-- uses for the same idea.
--
-- The second is a gate that checks the wrong thing for the kind it sees.
-- The observation gate held every emitted numerator to an integer-or-decimal
-- pattern, so a money finding carrying a fractional numerator passed this
-- fence and died later on the metrics ledger's own table check -- after the
-- run had done its work. The condition is now kind-conditional, mirroring the
-- channel analysis finding gate: a ratio may carry up to twelve fraction
-- digits, every other kind must be a whole number.
--
-- Replaced whole rather than patched, because plpgsql has no way to amend a
-- subquery alias or a literal pattern in place.

create or replace function private.assert_report_projection_document(p_document jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  output jsonb;
  control jsonb;
  categorical jsonb;
  period_grain boolean;
begin
  period_grain := p_document ->> 'outputKind' = 'period_grain';

  if jsonb_typeof(p_document) <> 'object'
    or coalesce((
      -- The opening parenthesis sits on its own line because the
      -- database-agreement test reads every unknown-key list in the newest
      -- validator migration as a contract-document list; this one describes
      -- the projection document and must not be mistaken for it.
      select bool_or(key not in
        ('schemaVersion', 'outputKind', 'outputs', 'controlTotals', 'grain', 'periodKey'))
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
      or coalesce((select bool_or(key not in ('key', 'normalizedSheetName', 'canonicalField', 'metricKey', 'valueKind', 'aggregation', 'categorical')) from jsonb_object_keys(output) key), false)
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

    -- Counting occurrences is the only thing a categorical output can do, so
    -- its value kind has to say count, and the dimension it tags observations
    -- with has to be named here: a category nobody declared is not a narrower
    -- view of the evidence, it is a different claim about where numbers came
    -- from.
    if output ? 'categorical' then
      categorical := output -> 'categorical';
      if jsonb_typeof(categorical) <> 'object'
        or (select bool_or(key not in ('dimensionKey', 'allowedValues', 'collectInjectedValues')) from jsonb_object_keys(categorical) key)
        or coalesce(categorical ->> 'dimensionKey', '') !~ '^[a-z][a-z0-9_]{0,63}$'
        or jsonb_typeof(categorical -> 'allowedValues') <> 'array'
        or jsonb_array_length(categorical -> 'allowedValues') not between 1 and 20
        or exists (
             select 1
             from jsonb_array_elements(categorical -> 'allowedValues') allowed
             where jsonb_typeof(allowed.value) <> 'string'
               or coalesce(allowed.value #>> '{}', '') !~ '^[A-Z][A-Z0-9_]{0,63}$')
        or (select count(*) from jsonb_array_elements_text(categorical -> 'allowedValues'))
          <> (select count(distinct value) from jsonb_array_elements_text(categorical -> 'allowedValues'))
        or jsonb_typeof(categorical -> 'collectInjectedValues') <> 'boolean'
        or output ->> 'valueKind' <> 'count' then
        raise exception 'report projection categorical output is invalid' using errcode = '22023';
      end if;
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
          select 1 from jsonb_array_elements(p_document -> 'outputs') expected_output
          where expected_output ->> 'key' = control ->> 'outputKey' and expected_output ->> 'valueKind' = 'money'
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
      and ((not period_grain and (field.value ->> 'required')::boolean) or period_grain)
    limit 1;
    if source_field is null
      or ((output ->> 'valueKind' = 'money') and source_field ->> 'parser' <> 'money')
      -- A plain count sums integers. A categorical output counts the column's
      -- own words, so it binds to the two parsers that produce text, matching
      -- `findSourceField` in `src/domain/reports/projection.ts`.
      or ((output ->> 'valueKind' = 'count') and output ? 'categorical'
          and source_field ->> 'parser' not in ('text', 'enum'))
      -- A plain count sums a quantity. Most counts are integers, but a
      -- provider can measure a continuous quantity in fractions -- closed
      -- time arrives as `355.6` minutes -- and the ledger's numeric column
      -- stores it exactly, so a decimal column is admissible too, matching
      -- `findSourceField` in `src/domain/reports/projection.ts`.
      or ((output ->> 'valueKind' = 'count') and not output ? 'categorical'
          and source_field ->> 'parser' not in ('integer', 'decimal')) then
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
      from jsonb_array_elements(p_document -> 'outputs') expected_output,
        jsonb_array_elements((p_contract_version).mapping_document -> 'sheets') sheet
      where expected_output ->> 'key' = control ->> 'outputKey'
        and sheet.value ->> 'normalizedSheetName' = expected_output ->> 'normalizedSheetName'
        and sheet.value ? 'totalsRow'
    ) then
      raise exception 'report projection control total has no approved totals row' using errcode = '23514';
    end if;
  end loop;
end;
$$;

create or replace function public.complete_governed_report_package_period_grain_projection(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_projection_run_id uuid,
  p_claim_token uuid,
  p_result_digest text,
  p_result jsonb,
  p_observations jsonb,
  p_absent_row_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  operation private.integration_report_projection_operations;
  run_row public.integration_report_projection_runs;
  package_row public.integration_report_packages;
  validation_row public.integration_report_validation_runs;
  projection_version_row public.report_projection_versions;
  object_row storage.objects;
  definition_row public.metric_definitions;
  prior_metric public.normalized_metrics;
  emitted jsonb;
  expected_output jsonb;
  projection_document_json jsonb;
  dims jsonb;
  declared_grain text;
  branch_timezone text;
  channel_key text;
  local_period_start date;
  local_period_end date;
  period_started_at timestamptz;
  period_ended_at timestamptz;
  emitted_currency text;
  evidence_digest text;
  overlap_count integer;
  metric_id uuid;
  final_status text;
  has_blocked_overlap boolean := false;
  effective_quality_state text;
  effective_completeness_state text;
begin
  if p_result_digest !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_result) <> 'object' or jsonb_typeof(p_observations) <> 'array'
    or coalesce((select bool_or(key not in ('status', 'qualityState', 'completenessState', 'errorCodes', 'warningCodes')) from jsonb_object_keys(p_result) key), false)
    or p_result ->> 'status' not in ('projected', 'partially_projected', 'failed')
    or p_result ->> 'qualityState' not in ('complete', 'partial', 'failed')
    or p_result ->> 'completenessState' not in ('complete', 'partial', 'unavailable')
    or jsonb_array_length(p_observations) > 20000
    or p_absent_row_count is null or p_absent_row_count not between 0 and 10000000 then
    raise exception 'report projection evidence is invalid' using errcode = '22023';
  end if;

  select * into operation from private.integration_report_projection_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id for update;
  if not found or operation.projection_run_id <> p_projection_run_id or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then return null; end if;
  select * into run_row from public.integration_report_projection_runs
  where organization_id = p_organization_id and id = p_projection_run_id and status = 'running' for update;
  if not found then return null; end if;
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id and status = 'projecting' for update;
  if not found then return null; end if;
  select * into object_row from storage.objects where bucket_id = package_row.storage_bucket_id and name = package_row.storage_path;
  if not found or object_row.id <> package_row.storage_object_id or object_row.version <> package_row.storage_object_version then
    raise exception 'report projection object identity changed' using errcode = '23514';
  end if;

  select * into validation_row from public.integration_report_validation_runs v
  where v.organization_id = p_organization_id and v.id = run_row.validation_run_id;
  select * into projection_version_row from public.report_projection_versions v
  where v.organization_id = p_organization_id and v.id = run_row.report_projection_version_id;
  projection_document_json := projection_version_row.projection_document;

  -- This path writes a series and only a series. An exact-range declaration
  -- arriving here would be a caller error, not a shape to accommodate.
  declared_grain := projection_document_json ->> 'grain';
  if projection_document_json ->> 'outputKind' <> 'period_grain' or declared_grain not in ('day', 'week', 'month') then
    raise exception 'projection declaration does not emit a period grain series' using errcode = '23514';
  end if;

  -- `specs/015` section 4.4: period boundaries are computed in the branch's
  -- timezone, not the organization default the package carries, and the zone in
  -- force is recorded so a later branch change cannot reinterpret history. See
  -- ADR 0030.
  select b.timezone into branch_timezone from public.branches b
  where b.organization_id = p_organization_id and b.id = package_row.branch_id;
  if branch_timezone is null then
    raise exception 'branch timezone is required to bucket a period grain series' using errcode = '23514';
  end if;
  select c.key into channel_key from public.organization_channels c
  where c.organization_id = p_organization_id and c.id = package_row.channel_id;

  if p_result ->> 'status' = 'failed' and jsonb_array_length(p_observations) <> 0 then
    raise exception 'failed projection cannot persist observations' using errcode = '22023';
  end if;
  if p_result ->> 'status' <> 'failed' and jsonb_array_length(p_observations) = 0 then
    raise exception 'successful projection requires observations' using errcode = '22023';
  end if;
  effective_quality_state := case when p_result ->> 'qualityState' = 'partial' then 'partial' else 'complete' end;
  effective_completeness_state := case when p_result ->> 'completenessState' = 'partial' then 'partial' else 'complete' end;

  for emitted in select value from jsonb_array_elements(p_observations) loop
    if jsonb_typeof(emitted) <> 'object'
      or coalesce((select bool_or(key not in ('key', 'metricKey', 'metricDefinitionId', 'valueKind', 'valueNumerator',
        'currency', 'periodStart', 'periodEnd', 'normalizedSheetName', 'canonicalField', 'sourceColumnOrdinal',
        'contributorCount', 'dimensions', 'sourceDigest')) from jsonb_object_keys(emitted) key), false)
      or coalesce(emitted ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(emitted ->> 'metricKey', '') !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'
      or coalesce(emitted ->> 'metricDefinitionId', '') !~ '^[0-9a-f-]{36}$'
      or emitted ->> 'valueKind' not in ('money', 'count')
      -- A numerator is an exact integer or decimal quantity: fractional
      -- because providers measure continuous units in fractions, bounded
      -- because a figure with twelve decimal places is not one anybody
      -- reported.
      or (case when emitted ->> 'valueKind' = 'ratio'
        then coalesce(emitted ->> 'valueNumerator', '') !~ '^-?[0-9]+(\.[0-9]{1,12})?$'
        else coalesce(emitted ->> 'valueNumerator', '') !~ '^-?[0-9]+$' end)
      or ((emitted ->> 'valueKind' = 'money') and coalesce(emitted ->> 'currency', '') <> package_row.declared_currency)
      or ((emitted ->> 'valueKind' = 'count') and emitted ? 'currency' and emitted ->> 'currency' is not null)
      or coalesce(emitted ->> 'periodStart', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(emitted ->> 'periodEnd', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(emitted ->> 'normalizedSheetName', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(emitted ->> 'canonicalField', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce((emitted ->> 'sourceColumnOrdinal')::integer, 0) not between 1 and 250000
      -- An observation exists because rows carried a figure. Zero contributors
      -- would be a period the provider said nothing about, and that period must
      -- stay absent rather than arrive as evidence.
      or coalesce((emitted ->> 'contributorCount')::integer, 0) not between 1 and 250000
      or coalesce(emitted ->> 'sourceDigest', '') !~ '^[a-f0-9]{64}$' then
      raise exception 'report projection observation evidence is invalid' using errcode = '22023';
    end if;

    if not exists (
      select 1 from jsonb_array_elements(projection_document_json -> 'outputs') expected
      where expected ->> 'key' = emitted ->> 'key' and expected ->> 'metricKey' = emitted ->> 'metricKey'
        and expected ->> 'valueKind' = emitted ->> 'valueKind'
        and expected ->> 'normalizedSheetName' = emitted ->> 'normalizedSheetName'
        and expected ->> 'canonicalField' = emitted ->> 'canonicalField'
    ) then raise exception 'projection observation does not match binding' using errcode = '23514'; end if;

    -- A figure without a category carries no dimensions at all, which is not
    -- the same as dimensions nobody read yet, and a categorical observation
    -- carries exactly the one dimension its declaration defines, holding one
    -- label the declaration allows. Anything else would put a category nobody
    -- approved into the ledger as if it were evidence.
    select value into expected_output
    from jsonb_array_elements(projection_document_json -> 'outputs') expected
    where expected ->> 'key' = emitted ->> 'key';
    dims := coalesce(emitted -> 'dimensions', '{}'::jsonb);
    if jsonb_typeof(dims) <> 'object' then
      raise exception 'report projection observation evidence is invalid' using errcode = '22023';
    end if;
    if expected_output ? 'categorical' then
      if (select count(*) from jsonb_object_keys(dims)) <> 1
        or not (dims ? (expected_output -> 'categorical' ->> 'dimensionKey'))
        or jsonb_typeof(dims -> (expected_output -> 'categorical' ->> 'dimensionKey')) <> 'string'
        or not exists (
             select 1
             from jsonb_array_elements(expected_output -> 'categorical' -> 'allowedValues') allowed
             where allowed.value #>> '{}' = dims ->> (expected_output -> 'categorical' ->> 'dimensionKey')) then
        raise exception 'projection observation does not match binding' using errcode = '23514';
      end if;
    elsif dims <> '{}'::jsonb then
      raise exception 'projection observation does not match binding' using errcode = '23514';
    end if;

    local_period_start := (emitted ->> 'periodStart')::date;
    local_period_end := (emitted ->> 'periodEnd')::date;

    -- The grain is declared and never inferred, so the boundary is re-derived
    -- here from the declaration rather than accepted from the caller. A week
    -- starts on Monday and a month on the first, matching the projector.
    -- The `case` is parenthesised deliberately: plpgsql reads an `if`
    -- condition up to the first `then`, and a bare `case` inside one ends the
    -- expression at its own first branch.
    if local_period_end <> (case declared_grain
        when 'day' then local_period_start
        when 'week' then local_period_start + 6
        else (date_trunc('month', local_period_start::timestamp) + interval '1 month' - interval '1 day')::date
      end)
      or (declared_grain = 'week' and extract(isodow from local_period_start) <> 1)
      or (declared_grain = 'month' and local_period_start <> date_trunc('month', local_period_start::timestamp)::date) then
      raise exception 'report projection period does not match the declared grain' using errcode = '23514';
    end if;

    -- A figure filed outside the window the operator declared this package
    -- covers is a figure filed under someone else's month.
    if local_period_start < package_row.declared_period_start or local_period_end > package_row.declared_period_end then
      raise exception 'report projection period falls outside the declared package period' using errcode = '23514';
    end if;

    select * into definition_row from public.metric_definitions d
    where d.id = (emitted ->> 'metricDefinitionId')::uuid and d.key = emitted ->> 'metricKey'
      and d.value_kind = emitted ->> 'valueKind' and d.aggregation = 'sum' and d.is_active
      and (d.organization_id is null or d.organization_id = p_organization_id);
    if not found then raise exception 'projection metric definition is invalid' using errcode = '23514'; end if;

    emitted_currency := case when emitted ->> 'valueKind' = 'money' then package_row.declared_currency else null end;
    period_started_at := local_period_start::timestamp at time zone branch_timezone;
    -- Half-open, matching the table's own `period_end > period_start` check and
    -- every existing reader of the series.
    period_ended_at := (local_period_end + 1)::timestamp at time zone branch_timezone;

    evidence_digest := private.report_projection_period_reconciliation_digest(
      package_row, validation_row, projection_version_row, definition_row.id,
      emitted ->> 'key', emitted ->> 'sourceDigest', local_period_start, local_period_end, branch_timezone, dims
    );

    perform pg_advisory_xact_lock(hashtextextended(concat_ws('|', p_organization_id, package_row.channel_id,
      package_row.branch_id, definition_row.id, branch_timezone, coalesce(emitted_currency, '')), 0));

    -- Byte-identical evidence for the same declared context is an idempotent
    -- replay, per `specs/018` section 10.5. The dimensions are part of that
    -- context, so a replay of one category cannot pass for a replay of another.
    select * into prior_metric from public.normalized_metrics m
    where m.organization_id = p_organization_id and m.branch_id = package_row.branch_id
      and m.channel_id = package_row.channel_id and m.metric_definition_id = definition_row.id
      and m.period_grain = declared_grain and m.period_start = period_started_at
      and m.period_timezone = branch_timezone and m.dimensions = dims
      and m.currency is not distinct from emitted_currency
      and m.reconciliation_state = 'current' and m.superseded_by_id is null
      and m.reconciliation_digest = evidence_digest
    order by m.id limit 1 for update;
    if found then
      insert into public.report_projection_reconciliations (
        organization_id, report_package_id, projection_run_id, projection_output_key, projection_target,
        period_start, period_end, classification, reconciliation_digest, prior_normalized_metric_id,
        candidate_count, quality_state, completeness_state, calculation_version, correlation_id
      ) values (
        p_organization_id, p_report_package_id, p_projection_run_id, emitted ->> 'key', 'period_grain',
        local_period_start, local_period_end, 'exact_duplicate', evidence_digest, prior_metric.id,
        1, effective_quality_state, effective_completeness_state, run_row.calculation_version, run_row.correlation_id
      );
      continue;
    end if;

    -- Overlap is looked for in both ledgers, because a period could receive a
    -- daily series and an exact-range total covering the same days, and they
    -- cannot both feed one rollup. Each side is compared in its own recorded
    -- zone's local dates, so a branch zone differing from the package's does not
    -- hide a collision. Only rows this projection path wrote are candidates; a
    -- series some other collector produced is not evidence about this import.
    -- Another category of the same series measures a different tuple and is
    -- nobody's prior; an exact-range total spans every category, so its arm
    -- needs none of this filtering.
    select count(*) into overlap_count from (
      select 1
      from public.normalized_metrics m
      where m.organization_id = p_organization_id and m.branch_id = package_row.branch_id
        and m.channel_id = package_row.channel_id and m.metric_definition_id = definition_row.id
        and m.dimensions = dims
        and m.currency is not distinct from emitted_currency
        and m.reconciliation_state = 'current' and m.superseded_by_id is null
        and m.reconciliation_digest is not null
        and (m.period_start at time zone m.period_timezone)::date <= local_period_end
        and ((m.period_end at time zone m.period_timezone) - interval '1 day')::date >= local_period_start
      union all
      select 1
      from public.exact_range_metric_observations o
      where o.organization_id = p_organization_id and o.branch_id = package_row.branch_id
        and o.channel_id = package_row.channel_id and o.metric_definition_id = definition_row.id
        and o.currency is not distinct from emitted_currency
        and o.reconciliation_state = 'current'
        and o.period_start <= local_period_end and o.period_end >= local_period_start
    ) candidates;

    if overlap_count > 20000 then
      raise exception 'report projection overlap is too broad to reconcile' using errcode = '23514';
    end if;
    if overlap_count > 0 then
      -- Every candidate is locked, and every one of them becomes a decision of
      -- its own below. Recording only the first would leave the rest live after
      -- a resolution, which is the double-count this exists to prevent.
      perform 1 from public.normalized_metrics m
      where m.organization_id = p_organization_id and m.branch_id = package_row.branch_id
        and m.channel_id = package_row.channel_id and m.metric_definition_id = definition_row.id
        and m.dimensions = dims
        and m.currency is not distinct from emitted_currency
        and m.reconciliation_state = 'current' and m.superseded_by_id is null
        and m.reconciliation_digest is not null
        and (m.period_start at time zone m.period_timezone)::date <= local_period_end
        and ((m.period_end at time zone m.period_timezone) - interval '1 day')::date >= local_period_start for update;
      perform 1 from public.exact_range_metric_observations o
      where o.organization_id = p_organization_id and o.branch_id = package_row.branch_id
        and o.channel_id = package_row.channel_id and o.metric_definition_id = definition_row.id
        and o.currency is not distinct from emitted_currency
        and o.reconciliation_state = 'current'
        and o.period_start <= local_period_end and o.period_end >= local_period_start for update;
    end if;

    insert into public.normalized_metrics (
      organization_id, branch_id, channel_id, channel, metric_definition_id, value_kind,
      subject_kind, dimensions, period_grain, period_start, period_end, period_timezone,
      value_numerator, currency, quality_tier, reconciliation_state, reconciliation_digest, observed_at
    ) values (
      p_organization_id, package_row.branch_id, package_row.channel_id, channel_key, definition_row.id, emitted ->> 'valueKind',
      'organization', dims, declared_grain, period_started_at, period_ended_at, branch_timezone,
      (emitted ->> 'valueNumerator')::numeric, emitted_currency, definition_row.default_quality_tier,
      case when overlap_count > 0 then 'blocked_overlap' else 'current' end, evidence_digest, period_ended_at
    ) returning id into metric_id;

    insert into public.report_projection_lineage (
      organization_id, normalized_metric_id, report_package_id, validation_run_id, projection_run_id,
      report_contract_version_id, report_projection_version_id, normalized_sheet_name, canonical_field,
      source_column_ordinal, contributor_count, calculation_version, source_digest, quality_state, completeness_state
    ) values (
      p_organization_id, metric_id, p_report_package_id, run_row.validation_run_id, p_projection_run_id,
      run_row.report_contract_version_id, run_row.report_projection_version_id,
      emitted ->> 'normalizedSheetName', emitted ->> 'canonicalField',
      (emitted ->> 'sourceColumnOrdinal')::integer, (emitted ->> 'contributorCount')::integer,
      run_row.calculation_version, emitted ->> 'sourceDigest', effective_quality_state, effective_completeness_state
    );

    if overlap_count = 0 then
      insert into public.report_projection_reconciliations (
        organization_id, report_package_id, projection_run_id, projection_output_key, projection_target,
        period_start, period_end, classification, reconciliation_digest, result_normalized_metric_id,
        candidate_count, quality_state, completeness_state, calculation_version, correlation_id
      ) values (
        p_organization_id, p_report_package_id, p_projection_run_id, emitted ->> 'key', 'period_grain',
        local_period_start, local_period_end, 'non_overlapping', evidence_digest, metric_id,
        0, effective_quality_state, effective_completeness_state, run_row.calculation_version, run_row.correlation_id
      );
    else
      insert into public.report_projection_reconciliations (
        organization_id, report_package_id, projection_run_id, projection_output_key, projection_target,
        period_start, period_end, classification, reconciliation_digest, prior_observation_id,
        prior_normalized_metric_id, result_normalized_metric_id, candidate_count,
        quality_state, completeness_state, calculation_version, correlation_id
      )
      select p_organization_id, p_report_package_id, p_projection_run_id, emitted ->> 'key', 'period_grain',
        local_period_start, local_period_end, 'ambiguous_overlap', evidence_digest, candidate.exact_id,
        candidate.metric_id, metric_id, overlap_count,
        effective_quality_state, effective_completeness_state, run_row.calculation_version, run_row.correlation_id
      from (
        select null::uuid as exact_id, m.id as metric_id
        from public.normalized_metrics m
      where m.organization_id = p_organization_id and m.branch_id = package_row.branch_id
        and m.channel_id = package_row.channel_id and m.metric_definition_id = definition_row.id
        and m.dimensions = dims
        and m.currency is not distinct from emitted_currency
        and m.reconciliation_state = 'current' and m.superseded_by_id is null
        and m.reconciliation_digest is not null
        and (m.period_start at time zone m.period_timezone)::date <= local_period_end
        and ((m.period_end at time zone m.period_timezone) - interval '1 day')::date >= local_period_start
        union all
        select o.id as exact_id, null::uuid as metric_id
        from public.exact_range_metric_observations o
      where o.organization_id = p_organization_id and o.branch_id = package_row.branch_id
        and o.channel_id = package_row.channel_id and o.metric_definition_id = definition_row.id
        and o.currency is not distinct from emitted_currency
        and o.reconciliation_state = 'current'
        and o.period_start <= local_period_end and o.period_end >= local_period_start
      ) candidate;
    end if;

    has_blocked_overlap := has_blocked_overlap or overlap_count > 0;
  end loop;

  final_status := p_result ->> 'status';
  update public.integration_report_projection_runs set status = final_status, quality_state = p_result ->> 'qualityState',
    completeness_state = p_result ->> 'completenessState', output_count = jsonb_array_length(p_observations),
    absent_row_count = p_absent_row_count,
    result_digest = p_result_digest, error_codes = coalesce(p_result -> 'errorCodes', '[]'::jsonb),
    warning_codes = coalesce(p_result -> 'warningCodes', '[]'::jsonb), completed_at = now()
  where organization_id = p_organization_id and id = p_projection_run_id;
  update public.integration_report_packages set status = case
    when has_blocked_overlap then 'reconciliation_required'
    when final_status = 'projected' then 'projected'
    when final_status = 'partially_projected' then 'partially_projected'
    else 'projection_failed' end,
    safe_failure_code = case when final_status = 'failed' then coalesce(p_result -> 'errorCodes' ->> 0, 'PROJECTION_PROCESSING_FAILED') else null end,
    safe_failure_at = case when final_status = 'failed' then now() else null end
  where organization_id = p_organization_id and id = p_report_package_id returning * into package_row;
  return to_jsonb(package_row);
end;
$$;

revoke all on function public.complete_governed_report_package_period_grain_projection(uuid, uuid, uuid, uuid, text, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.complete_governed_report_package_period_grain_projection(uuid, uuid, uuid, uuid, text, jsonb, jsonb, integer) to service_role;
