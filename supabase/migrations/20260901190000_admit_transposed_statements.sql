-- Reading a statement whose periods are its column headings.
--
-- Every provider export this platform reads is one row per period and one
-- column per figure. An accounting profit and loss is the transpose: one row
-- per account, one column per month. All the information is there, rotated
-- ninety degrees, and a reader that only knows the first shape cannot follow
-- it. The sheet now declares which way round it is and the reader rotates it
-- once on the way in; nothing after that knows the difference.
--
-- Two smaller admissions come with it, both for the same underlying reason --
-- a PDF hands over what was printed rather than the values behind it:
--
--   * `month_year`, for a column headed `May 2026`.
--   * `numberFormat`, because a statement prints `1,234.56` and read literally
--     that is not a number at all. Declared rather than sniffed, exactly as the
--     date encoding is: `1,234` is one number on a statement and could be two
--     badly split columns in a CSV, and guessing which is the silent
--     reinterpretation this guard exists to prevent.
--
-- Replaced whole rather than patched. plpgsql has no way to amend a literal
-- list in place, and the checks this adds are new branches rather than new
-- entries. The block below asserts the installed definition is the one this was
-- written against before replacing it, so a definition someone else has moved
-- on fails loudly here instead of being clobbered.
--
-- See ADR 0045 and `specs/018-governed-channel-intelligence.md` section 7.4.

do $check$
declare
  installed text;
  anchors constant text[] := array[
    E'\'allowFormula\', \'allowMergedCells\', \'fields\', \'totalsRow\', \'raggedRows\'',
    E'\'dateEncoding\', \'absentMarkers\'',
    E'\'iso_date\', \'compact_date\', \'text_date\', \'day_month\', \'excel_serial\'',
    E'control ->> \'kind\' not in \\(\'row_count\', \'populated_cell_count\'\\)'
  ];
  anchor text;
  hits integer;
begin
  select pg_catalog.pg_get_functiondef(
    'private.assert_report_contract_document(jsonb)'::regprocedure
  ) into installed;

  foreach anchor in array anchors loop
    select count(*)::integer into hits
    from pg_catalog.regexp_matches(installed, anchor, 'g');
    if hits <> 1 then
      raise exception
        'assert_report_contract_document is not the expected version (anchor % found % times)',
        anchor, hits
        using errcode = '55000';
    end if;
  end loop;
end;
$check$;

CREATE OR REPLACE FUNCTION private.assert_report_contract_document(p_document jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  sheet jsonb;
  field jsonb;
  control jsonb;
  locator jsonb;
  totals jsonb;
  ragged jsonb;
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
        'allowFormula', 'allowMergedCells', 'fields', 'totalsRow', 'raggedRows',
        'recordOrientation', 'periodHeaderRow'
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

    -- The declaration stays one fact -- which header columns are allowed to
    -- move -- rather than naming every ragged row, because which rows reach
    -- further right is a property of the file, read off each row when it is
    -- parsed, and a list nobody can verify against the real export would only
    -- pretend to know.
    if sheet ? 'raggedRows' then
      ragged := sheet -> 'raggedRows';
      if jsonb_typeof(ragged) <> 'object'
        or (select bool_or(key <> 'injectedFromColumnIndex') from jsonb_object_keys(ragged) key)
        or jsonb_typeof(ragged -> 'injectedFromColumnIndex') <> 'number'
        or coalesce((ragged ->> 'injectedFromColumnIndex')::numeric, 0) <> trunc(coalesce((ragged ->> 'injectedFromColumnIndex')::numeric, 0))
        or coalesce((ragged ->> 'injectedFromColumnIndex')::numeric, 0) not between 0 and 249999 then
        raise exception 'report contract ragged rows are invalid' using errcode = '22023';
      end if;
    end if;

    -- Which way round the sheet holds its records. A statement puts one account
    -- on each row and one month in each column heading, which is the mirror
    -- image of every provider export, and the reader rotates it once on the way
    -- in. Absent means `rows`, so every contract approved before this existed
    -- keeps the only orientation it ever had.
    if sheet ? 'recordOrientation'
      and sheet ->> 'recordOrientation' not in ('rows', 'period_columns') then
      raise exception 'report contract record orientation is invalid' using errcode = '22023';
    end if;

    if sheet ->> 'recordOrientation' = 'period_columns' then
      -- A column heading has no heading of its own, so the row carrying the
      -- period names has to be stated. Without it there is nothing to date a
      -- figure by.
      if coalesce((sheet ->> 'periodHeaderRow')::integer, 0) not between 1 and 250000 then
        raise exception 'report contract period header row is invalid' using errcode = '22023';
      end if;
      -- Both describe a shape the sheet has before it is rotated and neither
      -- survives the rotation with its meaning intact. Refusing beats silently
      -- reinterpreting.
      if sheet ? 'totalsRow' or sheet ? 'raggedRows' then
        raise exception 'report contract transposed sheet rule is invalid' using errcode = '22023';
      end if;
    elsif sheet ? 'periodHeaderRow' then
      raise exception 'report contract period header row is invalid' using errcode = '22023';
    end if;

    for field in select value from jsonb_array_elements(sheet -> 'fields') loop
      if jsonb_typeof(field) <> 'object'
        or (select bool_or(key not in (
          'canonicalField', 'sourceHeader', 'parser', 'required', 'financialSign',
          'dateEncoding', 'absentMarkers', 'numberFormat'
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
             or field ->> 'dateEncoding' not in ('iso_date', 'compact_date', 'text_date', 'day_month', 'excel_serial', 'month_year')))
        -- How this provider writes a number belongs to the column too. A
        -- spreadsheet hands over a number; a PDF hands over what was printed,
        -- and an accounting statement prints `1,234.56`.
        or (field ? 'numberFormat' and (
             field ->> 'parser' not in ('integer', 'decimal', 'money', 'percentage')
             or field ->> 'numberFormat' not in ('plain', 'grouped')))
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
    -- Both controls compare a count taken at validation against the one the
    -- profile recorded, and the profile counted the sheet the way it arrived.
    -- Twenty-four accounts over four months profiles as twenty-four rows and
    -- validates as four, so the control would fail every time while nothing
    -- was wrong.
    if exists (
      select 1 from jsonb_array_elements(p_document -> 'sheets') s
      where s.value ->> 'normalizedSheetName' = control ->> 'normalizedSheetName'
        and s.value ->> 'recordOrientation' = 'period_columns'
    ) then
      raise exception 'report contract control rule is invalid' using errcode = '22023';
    end if;
  end loop;
end;
$function$
;
