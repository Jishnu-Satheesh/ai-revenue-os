-- Accept fingerprint version 3 when matching a contract to its package.
--
-- The guard was written against a single current version and hard-coded it.
-- Version 3 records several candidate header rows instead of only the first,
-- which is what lets a contract point at Noon's fourth row or Keeta's third;
-- nothing else about the evidence changed, and the matching below reads a
-- candidate by row position either way.
--
-- Version 1 stays legacy, because it predates the safe header evidence this
-- function depends on.
--
-- Caught by the hosted pgTAP suite the moment the default moved to 3, which is
-- the whole reason that suite runs against staging.

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
begin
  if p_package.fingerprint_version not in (2, 3) then
    raise exception 'report package uses legacy profile evidence' using errcode = '23514';
  end if;
  if p_document ->> 'currency' <> p_package.declared_currency
    or p_document ->> 'outletGrain' <> 'branch'
    or jsonb_array_length(p_document -> 'sheets') <> (
      select count(*) from public.integration_report_sheet_manifests
      where organization_id = p_package.organization_id and report_package_id = p_package.id
    ) then
    raise exception 'report contract does not match its package context' using errcode = '23514';
  end if;
  for sheet in select value from jsonb_array_elements(p_document -> 'sheets') loop
    select * into manifest from public.integration_report_sheet_manifests
    where organization_id = p_package.organization_id
      and report_package_id = p_package.id
      and normalized_sheet_name = sheet ->> 'normalizedSheetName';
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
