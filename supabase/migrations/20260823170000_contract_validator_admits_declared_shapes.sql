-- The database is told about the five things a contract has been able to say
-- for a week, and has been rejecting the whole time.
--
-- `reportContractDocumentSchema` gained `unmappedSheetDisposition`,
-- `sheetLocator`, `totalsRow`, `dateEncoding` and `absentMarkers` as the five
-- checked-in provider families were drafted. Each is optional, so nothing
-- already stored changed shape and nothing failed a type check. But
-- `private.assert_report_contract_document` validates by an allow-list of keys,
-- and an allow-list that has not been told about a key does not ignore it — it
-- refuses the document that carries one.
--
-- The effect was total rather than partial. Every one of the five library
-- definitions carries `unmappedSheetDisposition`, and so does every mapping the
-- guided questionnaire assembles, so both routes to a contract were closed and
-- the only shape that could still pass was a hand-written document using none
-- of the newer features -- for which the intake screen no longer has a box.
--
-- So the keys are admitted here, and checked rather than merely allowed. The
-- rules below are the ones `contracts.ts` already states, restated where the
-- write actually happens: the worker is not the authority on what may be
-- recorded, and neither is the browser.
--
-- Two checks are new rather than restored. A canonical field bound twice in one
-- sheet, and two sheets claiming the same position, are both rejected by the
-- schema and were silently accepted here. They are added now because the
-- contract tables are empty, so no stored document can be invalidated by
-- tightening them; done later this would need a migration that reads what is
-- already approved.

create or replace function private.assert_report_contract_document(p_document jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  sheet jsonb;
  field jsonb;
  control jsonb;
  locator jsonb;
  totals jsonb;
  marker jsonb;
begin
  if jsonb_typeof(p_document) <> 'object'
    or (select bool_or(key not in (
      'schemaVersion', 'currency', 'outletGrain', 'sheets', 'controls',
      'unmappedFieldDisposition', 'unmappedSheetDisposition'
    )) from jsonb_object_keys(p_document) key)
    or p_document ->> 'schemaVersion' <> '1'
    or coalesce(p_document ->> 'currency', '') !~ '^[A-Z]{3}$'
    or p_document ->> 'outletGrain' <> 'branch'
    or p_document ->> 'unmappedFieldDisposition' not in ('reviewed_ignore', 'requires_mapping')
    -- Absent means `requires_mapping`, which is what every contract approved
    -- before the key existed was already doing. Present means it was declared,
    -- and a declaration has to be one of the two things it can say.
    or (p_document ? 'unmappedSheetDisposition'
        and p_document ->> 'unmappedSheetDisposition' not in ('reviewed_ignore', 'requires_mapping'))
    or jsonb_typeof(p_document -> 'sheets') <> 'array'
    or jsonb_array_length(p_document -> 'sheets') not between 1 and 25
    or jsonb_typeof(p_document -> 'controls') <> 'array'
    or jsonb_array_length(p_document -> 'controls') > 50 then
    raise exception 'report contract document is invalid' using errcode = '22023';
  end if;

  for sheet in select value from jsonb_array_elements(p_document -> 'sheets') loop
    if jsonb_typeof(sheet) <> 'object'
      or (select bool_or(key not in (
        'normalizedSheetName', 'sheetLocator', 'headerRow', 'dataStartRow',
        'allowFormula', 'allowMergedCells', 'fields', 'totalsRow'
      )) from jsonb_object_keys(sheet) key)
      or coalesce(sheet ->> 'normalizedSheetName', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce((sheet ->> 'headerRow')::integer, 0) not between 1 and 250000
      or coalesce((sheet ->> 'dataStartRow')::integer, 0) not between 2 and 250000
      or (sheet ->> 'dataStartRow')::integer <= (sheet ->> 'headerRow')::integer
      or jsonb_typeof(sheet -> 'allowFormula') <> 'boolean'
      or jsonb_typeof(sheet -> 'allowMergedCells') <> 'boolean'
      or jsonb_typeof(sheet -> 'fields') <> 'array'
      or jsonb_array_length(sheet -> 'fields') not between 1 and 250 then
      raise exception 'report contract sheet rule is invalid' using errcode = '22023';
    end if;

    -- How to find the sheet in the file. Talabat names its worksheet after the
    -- export range, so a contract keyed on the name recognises the report once
    -- and never again; `position` exists for exactly that.
    if sheet ? 'sheetLocator' then
      locator := sheet -> 'sheetLocator';
      if jsonb_typeof(locator) <> 'object'
        or locator ->> 'kind' not in ('name', 'position')
        or (locator ->> 'kind' = 'name'
            and (select bool_or(key <> 'kind') from jsonb_object_keys(locator) key))
        or (locator ->> 'kind' = 'position' and (
             (select bool_or(key not in ('kind', 'position')) from jsonb_object_keys(locator) key)
             or jsonb_typeof(locator -> 'position') <> 'number'
             or coalesce((locator ->> 'position')::numeric, 0) <> trunc(coalesce((locator ->> 'position')::numeric, 0))
             or coalesce((locator ->> 'position')::numeric, 0) not between 1 and 25)) then
        raise exception 'report contract sheet locator is invalid' using errcode = '22023';
      end if;
    end if;

    -- A row the provider renders as the sheet's own total rather than as data.
    -- It has to be labelled in a column this sheet actually binds, or there is
    -- nothing to recognise it by when the file is read.
    if sheet ? 'totalsRow' then
      totals := sheet -> 'totalsRow';
      if jsonb_typeof(totals) <> 'object'
        or (select bool_or(key not in ('canonicalField', 'label')) from jsonb_object_keys(totals) key)
        or coalesce(totals ->> 'canonicalField', '') !~ '^[a-z][a-z0-9_]{0,63}$'
        or jsonb_typeof(totals -> 'label') <> 'string'
        or length(btrim(totals ->> 'label')) not between 1 and 64
        or not exists (
             select 1
             from jsonb_array_elements(sheet -> 'fields') bound
             where bound.value ->> 'canonicalField' = totals ->> 'canonicalField') then
        raise exception 'report contract totals row is invalid' using errcode = '22023';
      end if;
    end if;

    for field in select value from jsonb_array_elements(sheet -> 'fields') loop
      if jsonb_typeof(field) <> 'object'
        or (select bool_or(key not in (
          'canonicalField', 'sourceHeader', 'parser', 'required', 'financialSign',
          'dateEncoding', 'absentMarkers'
        )) from jsonb_object_keys(field) key)
        or coalesce(field ->> 'canonicalField', '') !~ '^[a-z][a-z0-9_]{0,63}$'
        or coalesce(field ->> 'sourceHeader', '') !~ '^[a-z][a-z0-9_]{0,63}$'
        or field ->> 'parser' not in ('integer', 'decimal', 'money', 'local_date', 'timestamp', 'duration', 'percentage', 'text', 'enum')
        or jsonb_typeof(field -> 'required') <> 'boolean'
        or (field ->> 'parser' = 'money' and field ->> 'financialSign' not in ('positive', 'negative'))
        or (field ->> 'parser' <> 'money' and field ? 'financialSign')
        -- How this provider writes a date belongs to the column it is read
        -- from, so only a date column may declare one.
        or (field ? 'dateEncoding' and (
             field ->> 'parser' <> 'local_date'
             or field ->> 'dateEncoding' not in ('iso_date', 'compact_date', 'text_date', 'day_month', 'excel_serial')))
        or (field ? 'absentMarkers' and (
             jsonb_typeof(field -> 'absentMarkers') <> 'array'
             or jsonb_array_length(field -> 'absentMarkers') > 5)) then
        raise exception 'report contract field rule is invalid' using errcode = '22023';
      end if;

      -- Tokens this provider writes to mean "no data". A marker that reads as a
      -- figure would turn real data into silence, and `0` is the one every
      -- provider actually writes, so a number can never mean absent.
      if field ? 'absentMarkers' then
        for marker in select value from jsonb_array_elements(field -> 'absentMarkers') loop
          if jsonb_typeof(marker) <> 'string'
            or length(btrim(marker #>> '{}')) not between 1 and 16
            or btrim(marker #>> '{}') ~ '^[+-]?([0-9]+(\.[0-9]+)?|\.[0-9]+)$' then
            raise exception 'report contract absent markers are invalid' using errcode = '22023';
          end if;
        end loop;
        if (select count(*) from jsonb_array_elements_text(field -> 'absentMarkers'))
          <> (select count(distinct btrim(value)) from jsonb_array_elements_text(field -> 'absentMarkers')) then
          raise exception 'report contract absent markers are invalid' using errcode = '22023';
        end if;
      end if;
    end loop;

    if (select count(*) from jsonb_array_elements(sheet -> 'fields'))
      <> (select count(distinct value ->> 'canonicalField') from jsonb_array_elements(sheet -> 'fields')) then
      raise exception 'report contract fields are duplicated' using errcode = '22023';
    end if;
  end loop;

  if (select count(*) from jsonb_array_elements(p_document -> 'sheets'))
    <> (select count(distinct value ->> 'normalizedSheetName') from jsonb_array_elements(p_document -> 'sheets')) then
    raise exception 'report contract sheet rules are duplicated' using errcode = '22023';
  end if;

  -- Two sheets read from the same position are the same sheet bound twice.
  if (select count(*) from jsonb_array_elements(p_document -> 'sheets') s
        where s.value #>> '{sheetLocator,kind}' = 'position')
    <> (select count(distinct s.value #>> '{sheetLocator,position}')
        from jsonb_array_elements(p_document -> 'sheets') s
        where s.value #>> '{sheetLocator,kind}' = 'position') then
    raise exception 'report contract sheet positions are duplicated' using errcode = '22023';
  end if;

  for control in select value from jsonb_array_elements(p_document -> 'controls') loop
    if jsonb_typeof(control) <> 'object'
      or (select bool_or(key not in ('key', 'kind', 'normalizedSheetName', 'tolerance')) from jsonb_object_keys(control) key)
      or coalesce(control ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or control ->> 'kind' not in ('row_count', 'populated_cell_count')
      or coalesce(control ->> 'normalizedSheetName', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce((control ->> 'tolerance')::integer, -1) not between 0 and 1000000 then
      raise exception 'report contract control rule is invalid' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function private.assert_report_contract_document(jsonb) from public;
