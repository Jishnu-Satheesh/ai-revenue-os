-- Admit a categorical output that declares the separator its provider uses
-- when one cell carries two labels.
--
-- Talabat's spreadsheet export writes a day's second closure reason into an
-- injected cell, which the ragged-row rule already reads. Its CSV export of
-- the same report cannot shift cells, so it joins both reasons into one:
-- `CHECK_IN_REQUIRED;UNREACHABLE`. That joined string is not a declared
-- value, so the import refused a real client's January file over a value the
-- contract had no way to describe.
--
-- Only the first label is counted, which is not a new rule -- it is the rule
-- this output already follows for the spreadsheet: Talabat's own summary
-- counts each closed day once, by its first-listed reason, and collecting the
-- second would double-count days across two labels and break the
-- reconciliation to what Talabat itself reports.
--
-- Declared rather than detected, like every other reading rule this guard
-- enforces. A contract that sets no separator behaves exactly as before, and
-- a joined cell still refuses the import.
--
-- Replaced whole rather than patched: plpgsql has no way to amend a literal
-- allow-list in place. The body below is the live function from
-- 20260901090000 with the categorical allow-list widened by one key and one
-- block added. Nothing else differs.

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
      or coalesce((select bool_or(key not in ('key', 'normalizedSheetName', 'canonicalField', 'metricKey', 'valueKind', 'aggregation', 'categorical', 'sumWith', 'convert', 'signConvention')) from jsonb_object_keys(output) key), false)
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
    -- A provider measuring in one unit and the registry recording in another.
    -- The list of conversions is closed: an unknown name is a refusal, never a
    -- passthrough that would file the provider's own unit under ours. Money has
    -- no unit to convert and a category has no magnitude.
    if output ? 'convert' then
      if output ->> 'convert' not in ('hours_to_minutes')
        or output ->> 'valueKind' <> 'count'
        or output ? 'categorical' then
        raise exception 'report projection unit conversion is invalid' using errcode = '22023';
      end if;
    end if;

    -- Whose sign convention the recorded figure follows. Closed list, money
    -- only: a count has no deduction to restate, and a category has no
    -- magnitude at all. Only money is ever written as something taken away.
    if output ? 'signConvention' then
      if output ->> 'signConvention' not in ('as_reported', 'deduction_as_cost')
        or (output ->> 'signConvention' = 'deduction_as_cost'
            and output ->> 'valueKind' <> 'money') then
        raise exception 'report projection sign convention is invalid' using errcode = '22023';
      end if;
    end if;

    -- One governed figure the provider reports across several columns. It is
    -- addition and nothing else: same sheet, columns named once each, never the
    -- output's own column and never the column that dates the row. A category
    -- counts labels, so there is no arithmetic on it to extend.
    if output ? 'sumWith' then
      if jsonb_typeof(output -> 'sumWith') <> 'array'
        or jsonb_array_length(output -> 'sumWith') not between 1 and 4
        or output ? 'categorical'
        or exists (
             select 1
             from jsonb_array_elements(output -> 'sumWith') added
             where jsonb_typeof(added.value) <> 'string'
               or coalesce(added.value #>> '{}', '') !~ '^[a-z][a-z0-9_]{0,63}$'
               or added.value #>> '{}' = output ->> 'canonicalField'
               or (period_grain
                   and added.value #>> '{}' = p_document -> 'periodKey' ->> 'canonicalField'))
        or (select count(*) from jsonb_array_elements_text(output -> 'sumWith'))
          <> (select count(distinct value) from jsonb_array_elements_text(output -> 'sumWith')) then
        raise exception 'report projection summed columns are invalid' using errcode = '22023';
      end if;
    end if;

    if output ? 'categorical' then
      categorical := output -> 'categorical';
      if jsonb_typeof(categorical) <> 'object'
        or (select bool_or(key not in ('dimensionKey', 'allowedValues', 'collectInjectedValues', 'labelMap', 'valueSeparator')) from jsonb_object_keys(categorical) key)
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

      -- A declared label map translates the provider's own words into the
      -- approved vocabulary. It may only produce values the output already
      -- allows, and it has to reach every one of them: a code nothing maps to
      -- can never be written, and reads in an approved document as a category
      -- that simply never occurred. Two labels differing only by case or
      -- surrounding space are one rule with two answers, because cells are
      -- matched with both ignored.
      if categorical ? 'labelMap' then
        if jsonb_typeof(categorical -> 'labelMap') <> 'object'
          or (select count(*) from jsonb_object_keys(categorical -> 'labelMap') key)
            not between 1 and 20
          or exists (
               select 1
               from jsonb_each(categorical -> 'labelMap') entry
               where jsonb_typeof(entry.value) <> 'string'
                 or length(btrim(entry.key)) not between 1 and 128
                 or coalesce(entry.value #>> '{}', '') !~ '^[A-Z][A-Z0-9_]{0,63}$')
          or (select count(*) from jsonb_object_keys(categorical -> 'labelMap') key)
            <> (select count(distinct lower(btrim(key)))
                from jsonb_object_keys(categorical -> 'labelMap') key)
          or exists (
               select 1
               from jsonb_each_text(categorical -> 'labelMap') entry
               where entry.value not in (
                 select value from jsonb_array_elements_text(categorical -> 'allowedValues')))
          or exists (
               select 1
               from jsonb_array_elements_text(categorical -> 'allowedValues') allowed
               where allowed.value not in (
                 select value from jsonb_each_text(categorical -> 'labelMap'))) then
          raise exception 'report projection categorical label map is invalid' using errcode = '22023';
        end if;
      end if;

      -- The character a provider uses when one cell carries two labels. Kept
      -- short and required non-empty: it identifies a joining character, not
      -- an arbitrary pattern, and a blank separator would split every cell.
      if categorical ? 'valueSeparator' then
        if jsonb_typeof(categorical -> 'valueSeparator') <> 'string'
          or char_length(categorical ->> 'valueSeparator') not between 1 and 4 then
          raise exception 'report projection categorical output is invalid' using errcode = '22023';
        end if;
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
