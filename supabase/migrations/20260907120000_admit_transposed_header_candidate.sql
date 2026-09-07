-- Let a rotated statement's header candidate actually be stored.
--
-- ADR 0045 gave the profiler a way to recognise a statement that keeps its
-- account names down the first column instead of along a row: it digests that
-- column and files the result at row position zero, deliberately outside the
-- range a contract may name. Migration `20260901193000` taught the contract
-- gate to look for it there.
--
-- Nothing taught the function that *writes* the profile. Both
-- `complete_governed_report_package_profiling` and
-- `private.assert_report_header_candidates` still required every candidate to
-- sit between row one and row 250000, and still capped a sheet at five
-- candidates -- while the profiler appends the rotated candidate after the five
-- row candidates and deliberately outside their cap.
--
-- So the rotated candidate was refused at the door. Profiling raised
-- `report sheet manifest is invalid`, the package was marked `PROFILE_FAILED`,
-- and no manifest row was ever written -- meaning the gate that knows about row
-- position zero was never reached. Every export whose first column reads as a
-- statement failed on upload: the client's own profit and loss (the file ADR
-- 0045 was written for), Noon's sales export, and Keeta's billing report.
--
-- Two rules change, and only these two:
--
--   * A candidate may sit at row position zero, and only there or at a real row
--     number. A candidate carrying no row position at all is now refused
--     outright rather than silently read as zero, which is stricter than what
--     it replaces.
--   * The cap becomes what the profiler actually promises: at most five
--     candidates at real row positions, and at most one rotated candidate
--     beside them. Six arbitrary rows are still refused.
--
-- See ADR 0045 and `src/workflows/reports/profile-report-package.ts`
-- (`MAX_HEADER_CANDIDATES`, `transposedHeaderCandidate`).

create or replace function private.assert_report_header_candidates(p_sheet jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate jsonb;
begin
  if not (p_sheet ? 'headerCandidates') then return; end if;
  if jsonb_typeof(p_sheet -> 'headerCandidates') <> 'array'
    or jsonb_array_length(p_sheet -> 'headerCandidates')
      > jsonb_array_length(p_sheet -> 'headerCandidateDigests') then
    raise exception 'report sheet manifest is invalid' using errcode = '22023';
  end if;
  for candidate in select value from jsonb_array_elements(p_sheet -> 'headerCandidates') loop
    if jsonb_typeof(candidate) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(candidate) key
        where key not in ('rowPosition', 'normalizedHeaders')
      )
      -- Zero is the rotated statement's reserved position. See ADR 0045.
      or jsonb_typeof(candidate -> 'rowPosition') <> 'number'
      or (candidate ->> 'rowPosition')::integer not between 0 and 250000
      -- A name with no profiled candidate behind it has no evidence to stand on.
      or not exists (
        select 1 from jsonb_array_elements(p_sheet -> 'headerCandidateDigests') digest
        where (digest ->> 'rowPosition')::integer = (candidate ->> 'rowPosition')::integer
      )
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
end;
$$;

revoke all on function private.assert_report_header_candidates(jsonb) from public, anon, authenticated;

create or replace function public.complete_governed_report_package_profiling(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_claim_token uuid,
  p_content_sha256 text,
  p_schema_fingerprint text,
  p_structure_fingerprint text,
  p_sheets jsonb
)
returns jsonb
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
    or p_structure_fingerprint !~ '^[a-f0-9]{64}$'
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
      or (
        select count(*) from jsonb_array_elements(sheet -> 'headerCandidateDigests') c
        where coalesce((c ->> 'rowPosition')::integer, -1) > 0
      ) > 5
      -- And one more beside them for a rotated statement, which the profiler
      -- appends outside that cap because a statement's own title and month
      -- headings would otherwise fill all five places before the column that
      -- names its accounts was reached. See ADR 0045.
      or (
        select count(*) from jsonb_array_elements(sheet -> 'headerCandidateDigests') c
        where coalesce((c ->> 'rowPosition')::integer, -1) = 0
      ) > 1
      or jsonb_typeof(sheet -> 'hasFormula') <> 'boolean'
      or jsonb_typeof(sheet -> 'hasMergedCells') <> 'boolean'
      or jsonb_typeof(sheet -> 'hasRepeatedHeader') <> 'boolean' then
      raise exception 'report sheet manifest is invalid' using errcode = '22023';
    end if;
    perform private.assert_report_header_candidates(sheet);
    for candidate in select value from jsonb_array_elements(sheet -> 'headerCandidateDigests') loop
      if jsonb_typeof(candidate) <> 'object'
        or exists (
          select 1 from jsonb_object_keys(candidate) key
          where key not in ('rowPosition', 'fieldCount', 'digest', 'normalizedHeaderDigests', 'normalizedHeaders')
        )
        -- Zero is the rotated statement's reserved position, and a candidate
        -- with no position at all is refused rather than read as zero.
        or jsonb_typeof(candidate -> 'rowPosition') <> 'number'
        or (candidate ->> 'rowPosition')::integer not between 0 and 250000
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
    structure_fingerprint = p_structure_fingerprint,
    profiled_at = now(), safe_failure_code = null, safe_failure_at = null
  where organization_id = p_organization_id and id = p_report_package_id
  returning * into locked_package;
  return to_jsonb(locked_package);
end;
$$;

revoke all on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
