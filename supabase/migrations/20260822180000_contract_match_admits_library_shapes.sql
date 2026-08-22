-- Let a contract describe only the sheets it reads, and find a sheet by
-- position when its name is not stable.
--
-- The guard was written when a contract had to account for every sheet in the
-- file, by name. Neither holds against the pilot client's real exports:
--
--   * Keeta's billing report carries a glossary, an order-level sheet and a
--     settlement sheet beside the daily one. Noon and EatEasily each ship an
--     empty second tab. Requiring all of them to be mapped means describing
--     three sheets nobody reads in order to read the fourth.
--   * Talabat names its worksheet after the export range, so a contract keyed
--     on the name recognises the report once and never again.
--
-- Both are now declared in the contract document — `unmappedSheetDisposition`
-- and a per-sheet `sheetLocator` — and this guard reads them. A contract that
-- declares neither behaves exactly as before, so nothing already approved
-- changes meaning.
--
-- What stays strict: a contract may never describe more sheets than the file
-- has, every declared sheet must exist, its header row must have been profiled,
-- and every bound column must appear in that profiled header. The relaxation is
-- about which sheets must be accounted for, never about whether a claim is
-- checked against the evidence.

create or replace function private.assert_report_contract_matches_package(
  p_package public.integration_report_packages,
  p_document jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
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
    select value into candidate from jsonb_array_elements(manifest.header_candidate_digests)
    where (value ->> 'rowPosition')::integer = (sheet ->> 'headerRow')::integer;
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
$$;
