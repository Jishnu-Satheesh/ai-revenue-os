-- Keep the column names a profile found, and accept every header row it offers.
--
-- Two things are wrong with the version this replaces.
--
-- It rejects a sheet carrying more than one candidate header row, while the
-- profiler was raised to five so a contract could point at Noon's fourth row or
-- Keeta's third. Any real multi-header export therefore fails to profile at the
-- database after passing everything in front of it.
--
-- And it writes `header_candidates` as an empty array unconditionally, so the
-- only record of a sheet's columns is a one-way digest. That is right for
-- matching and wrong for mapping: an operator describing an export the platform
-- does not recognise has to see which columns it has, and no digest can tell
-- them.
--
-- A column name is schema, not data. `customer_name` as a heading says nothing
-- about any customer. The values beneath it are still never read here, never
-- stored, and never returned. The digests stay exactly as they were, so
-- fingerprints and contract matching are untouched.

create or replace function public.complete_governed_report_package_profiling(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_claim_token uuid,
  p_content_sha256 text,
  p_schema_fingerprint text,
  p_sheets jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_package public.integration_report_packages;
  operation private.integration_report_profile_operations;
  sheet jsonb;
  candidate jsonb;
begin
  if p_content_sha256 !~ '^[a-f0-9]{64}$'
    or p_schema_fingerprint !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_sheets) <> 'array'
    or jsonb_array_length(p_sheets) not between 1 and 25 then
    raise exception 'report profile evidence is invalid' using errcode = '22023';
  end if;
  select * into operation from private.integration_report_profile_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id
  for update;
  if not found or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then return null; end if;
  select * into locked_package from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id and status = 'profiling'
  for update;
  if not found then return null; end if;
  for sheet in select value from jsonb_array_elements(p_sheets) loop
    if jsonb_typeof(sheet) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(sheet) key
        where key not in (
          'sheetPosition', 'sheetName', 'normalizedSheetName', 'rowCount', 'populatedCellCount',
          'expandedBytes', 'contentDigest', 'headerCandidateDigests', 'headerCandidates',
          'hasFormula', 'hasMergedCells', 'hasRepeatedHeader'
        )
      )
      or coalesce((sheet ->> 'sheetPosition')::integer, 0) not between 1 and 25
      or char_length(coalesce(sheet ->> 'sheetName', '')) not between 1 and 100
      or coalesce(sheet ->> 'normalizedSheetName', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce((sheet ->> 'rowCount')::integer, -1) not between 0 and 250000
      or coalesce((sheet ->> 'populatedCellCount')::integer, -1) not between 0 and 2500000
      or coalesce((sheet ->> 'expandedBytes')::bigint, -1) not between 0 and 262144000
      or jsonb_typeof(sheet -> 'headerCandidateDigests') <> 'array'
      -- Five, matching MAX_HEADER_CANDIDATES in the profiler. One was never
      -- enough: Noon states a field row, an English description row and an
      -- Arabic one before its single line of figures.
      or jsonb_array_length(sheet -> 'headerCandidateDigests') > 5
      or jsonb_typeof(sheet -> 'hasFormula') <> 'boolean'
      or jsonb_typeof(sheet -> 'hasMergedCells') <> 'boolean'
      or jsonb_typeof(sheet -> 'hasRepeatedHeader') <> 'boolean' then
      raise exception 'report sheet manifest is invalid' using errcode = '22023';
    end if;
    if sheet ? 'headerCandidates' then
      if jsonb_typeof(sheet -> 'headerCandidates') <> 'array'
        or jsonb_array_length(sheet -> 'headerCandidates')
          <> jsonb_array_length(sheet -> 'headerCandidateDigests') then
        raise exception 'report sheet manifest is invalid' using errcode = '22023';
      end if;
      for candidate in select value from jsonb_array_elements(sheet -> 'headerCandidates') loop
        if jsonb_typeof(candidate) <> 'object'
          or exists (
            select 1 from jsonb_object_keys(candidate) key
            where key not in ('rowPosition', 'normalizedHeaders')
          )
          or coalesce((candidate ->> 'rowPosition')::integer, 0) not between 1 and 250000
          or jsonb_typeof(candidate -> 'normalizedHeaders') <> 'array'
          or jsonb_array_length(candidate -> 'normalizedHeaders') not between 1 and 250
          -- Only normalized identifiers are admitted. A raw cell could carry
          -- anything the provider typed; this shape cannot.
          or exists (
            select 1 from jsonb_array_elements_text(candidate -> 'normalizedHeaders') header
            where header !~ '^[a-z][a-z0-9_]{0,63}$'
          ) then
          raise exception 'report sheet manifest is invalid' using errcode = '22023';
        end if;
      end loop;
    end if;
    for candidate in select value from jsonb_array_elements(sheet -> 'headerCandidateDigests') loop
      if jsonb_typeof(candidate) <> 'object'
        or exists (
          select 1 from jsonb_object_keys(candidate) key
          where key not in ('rowPosition', 'fieldCount', 'digest', 'normalizedHeaderDigests', 'normalizedHeaders')
        )
        or coalesce((candidate ->> 'rowPosition')::integer, 0) not between 1 and 250000
        or coalesce((candidate ->> 'fieldCount')::integer, 0) not between 1 and 250
        or coalesce(candidate ->> 'digest', '') !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(candidate -> 'normalizedHeaderDigests') <> 'array'
        or jsonb_array_length(candidate -> 'normalizedHeaderDigests')
          <> (candidate ->> 'fieldCount')::integer
        or exists (
          select 1 from jsonb_array_elements_text(candidate -> 'normalizedHeaderDigests') digest
          where digest !~ '^[a-f0-9]{64}$'
        ) then
        raise exception 'report sheet manifest is invalid' using errcode = '22023';
      end if;
    end loop;
  end loop;
  insert into public.integration_report_sheet_manifests (
    organization_id, report_package_id, sheet_position, sheet_name, normalized_sheet_name,
    row_count, populated_cell_count, expanded_bytes, content_digest, header_candidates,
    header_candidate_digests, has_formula, has_merged_cells, has_repeated_header
  )
  select p_organization_id, p_report_package_id,
    (value ->> 'sheetPosition')::integer, value ->> 'sheetName', value ->> 'normalizedSheetName',
    (value ->> 'rowCount')::integer, (value ->> 'populatedCellCount')::integer,
    (value ->> 'expandedBytes')::bigint, nullif(value ->> 'contentDigest', ''),
    coalesce(value -> 'headerCandidates', '[]'::jsonb),
    value -> 'headerCandidateDigests',
    (value ->> 'hasFormula')::boolean, (value ->> 'hasMergedCells')::boolean, (value ->> 'hasRepeatedHeader')::boolean
  from jsonb_array_elements(p_sheets)
  on conflict (organization_id, report_package_id, sheet_position) do nothing;
  if (select count(*) from public.integration_report_sheet_manifests where organization_id = p_organization_id and report_package_id = p_report_package_id) <> jsonb_array_length(p_sheets) then
    raise exception 'report sheet manifests already differ' using errcode = '23505';
  end if;
  update public.integration_report_packages set
    status = 'awaiting_contract', content_sha256 = p_content_sha256, schema_fingerprint = p_schema_fingerprint,
    profiled_at = now(), safe_failure_code = null, safe_failure_at = null
  where organization_id = p_organization_id and id = p_report_package_id
  returning * into locked_package;
  return to_jsonb(locked_package);
end;
$$;

-- The five-argument version predates the schema fingerprint and no caller has
-- reached it since. Dropped so there is one profiling completion path, not two
-- with different guarantees.
drop function if exists public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, jsonb);

revoke all on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, text, jsonb) to service_role;
