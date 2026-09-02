-- Require the digests, so a payload cannot supply names alone.
--
-- The version applied minutes earlier tested `jsonb_typeof(sheet ->
-- 'headerCandidateDigests') <> 'array'`, which is NULL rather than true when the
-- key is absent, and a NULL in that OR chain leaves the whole guard NULL and
-- the payload accepted. A caller sending column names with no digests behind
-- them would have been admitted, and the digests are what every fingerprint and
-- contract match is built on.
--
-- Caught by an existing pgTAP assertion that was pinning the older, stricter
-- rule. That assertion has been rewritten rather than deleted: the retained
-- property changed deliberately, and the suite now states the new one.

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
      or not (sheet ? 'headerCandidateDigests')
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

revoke all on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, text, jsonb) to service_role;
