-- Recognising a statement by the column that names its accounts.
--
-- This function is the admission gate: a contract it refuses cannot be
-- approved, so a definition it cannot recognise is not merely unoffered, it is
-- unusable. It looks for a profiled header candidate at the row the contract
-- calls its header row.
--
-- A rotated sheet has no such row. Its names run down the first column, and row
-- one of a profit and loss is the company's own name. The profiler now digests
-- that column and files it at row position zero -- outside the range a contract
-- may name, so nothing reaches it by accident -- and a sheet declaring
-- `period_columns` is sent there by its orientation rather than its row number.
--
-- Replaced whole from the installed definition, with the block below asserting
-- it is the one this was written against. The preamble is upper case because
-- that is how `pg_get_functiondef` renders it.
--
-- See ADR 0045.

do $check$
declare
  installed text;
  anchor constant text := E'\\(value ->> \'rowPosition\'\\)::integer = \\(sheet ->> \'headerRow\'\\)::integer';
  hits integer;
begin
  select pg_catalog.pg_get_functiondef(
    'private.assert_report_contract_matches_package(public.integration_report_packages,jsonb)'::regprocedure
  ) into installed;

  select count(*)::integer into hits
  from pg_catalog.regexp_matches(installed, anchor, 'g');

  if hits <> 1 then
    raise exception
      'assert_report_contract_matches_package is not the expected version (anchor found % times)',
      hits
      using errcode = '55000';
  end if;
end;
$check$;

CREATE OR REPLACE FUNCTION private.assert_report_contract_matches_package(p_package integration_report_packages, p_document jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  sheet jsonb;
  field jsonb;
  manifest public.integration_report_sheet_manifests;
  candidate jsonb;
  source_header_digest text;
  declared_sheets integer;
  profiled_sheets integer;
  ignores_unmapped boolean;
  locator jsonb;
begin
  if p_package.fingerprint_version not in (2, 3) then
    raise exception 'report package uses legacy profile evidence' using errcode = '23514';
  end if;

  declared_sheets := jsonb_array_length(p_document -> 'sheets');
  select count(*) into profiled_sheets from public.integration_report_sheet_manifests
  where organization_id = p_package.organization_id and report_package_id = p_package.id;
  ignores_unmapped := coalesce(p_document ->> 'unmappedSheetDisposition', 'requires_mapping') = 'reviewed_ignore';

  if p_document ->> 'currency' <> p_package.declared_currency
    or p_document ->> 'outletGrain' <> 'branch'
    or declared_sheets > profiled_sheets
    or (not ignores_unmapped and declared_sheets <> profiled_sheets) then
    raise exception 'report contract does not match its package context' using errcode = '23514';
  end if;

  for sheet in select value from jsonb_array_elements(p_document -> 'sheets') loop
    locator := sheet -> 'sheetLocator';
    if coalesce(locator ->> 'kind', 'name') = 'position' then
      select * into manifest from public.integration_report_sheet_manifests
      where organization_id = p_package.organization_id
        and report_package_id = p_package.id
        and sheet_position = (locator ->> 'position')::integer;
    else
      select * into manifest from public.integration_report_sheet_manifests
      where organization_id = p_package.organization_id
        and report_package_id = p_package.id
        and normalized_sheet_name = sheet ->> 'normalizedSheetName';
    end if;
    if not found
      or (manifest.has_formula and not (sheet ->> 'allowFormula')::boolean)
      or (manifest.has_merged_cells and not (sheet ->> 'allowMergedCells')::boolean) then
      raise exception 'report contract sheet does not match package structure' using errcode = '23514';
    end if;
    -- A rotated sheet keeps its names down the first column, so its candidate
    -- is filed under a position no row can occupy. Reading it at the declared
    -- header row would find the sheet's actual first row instead -- on a profit
    -- and loss, the company's own name.
    select value into candidate from jsonb_array_elements(manifest.header_candidate_digests)
    where (value ->> 'rowPosition')::integer = case
      when sheet ->> 'recordOrientation' = 'period_columns' then 0
      else (sheet ->> 'headerRow')::integer
    end;
    if candidate is null then
      raise exception 'report contract header row was not profiled' using errcode = '23514';
    end if;
    for field in select value from jsonb_array_elements(sheet -> 'fields') loop
      source_header_digest := encode(extensions.digest(field ->> 'sourceHeader', 'sha256'), 'hex');
      if not ((candidate -> 'normalizedHeaderDigests') ? source_header_digest) then
        raise exception 'report contract source header was not profiled' using errcode = '23514';
      end if;
    end loop;
  end loop;
end;
$function$
;
