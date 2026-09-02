-- Safe structural header evidence. Profiling must never retain report values,
-- including values that merely resemble headers in a repeated row.

begin;

alter table public.integration_report_sheet_manifests
  add column header_candidate_digests jsonb not null default '[]'::jsonb
    check (jsonb_typeof(header_candidate_digests) = 'array');

comment on column public.integration_report_sheet_manifests.header_candidates is
  'Deprecated legacy evidence column. Permanently redacted; do not read or write.';
comment on column public.integration_report_sheet_manifests.header_candidate_digests is
  'Version-2 bounded structural evidence: SHA-256 digests of normalized, non-value header identities and positions only.';

-- The immutable-evidence trigger is deliberately paused only for this one-way
-- redaction. The audit payload contains identifiers and a count, never values.
alter table public.integration_report_sheet_manifests
  disable trigger integration_report_sheet_manifests_prevent_update;

with redacted as (
  update public.integration_report_sheet_manifests
  set header_candidates = '[]'::jsonb,
      header_candidate_digests = '[]'::jsonb
  where header_candidates <> '[]'::jsonb
  returning organization_id, id
)
insert into public.audit_events (
  organization_id, event_name, actor_type, entity_type, entity_id, correlation_id, payload
)
select
  organization_id,
  'report_package.profile_evidence_redacted',
  'system',
  'integration_report_sheet_manifest',
  id,
  gen_random_uuid(),
  jsonb_build_object('evidenceVersion', 2, 'redaction', 'legacy_header_candidates')
from redacted;

alter table public.integration_report_sheet_manifests
  enable trigger integration_report_sheet_manifests_prevent_update;

alter table public.integration_report_packages
  drop constraint if exists integration_report_packages_fingerprint_version_check,
  add constraint integration_report_packages_fingerprint_version_check
    check (fingerprint_version in (1, 2)),
  alter column fingerprint_version set default 2;

alter table public.report_contract_versions
  drop constraint if exists report_contract_versions_fingerprint_version_check,
  add constraint report_contract_versions_fingerprint_version_check
    check (fingerprint_version in (1, 2));

-- Projection reconciliation extended the lifecycle trigger but accidentally
-- omitted the already-approved failed -> uploaded profiling retry transition.
create or replace function private.prevent_report_package_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.channel_id is distinct from old.channel_id
    or new.branch_id is distinct from old.branch_id
    or new.report_type is distinct from old.report_type
    or new.declared_period_start is distinct from old.declared_period_start
    or new.declared_period_end is distinct from old.declared_period_end
    or new.declared_currency is distinct from old.declared_currency
    or new.period_timezone is distinct from old.period_timezone
    or new.file_kind is distinct from old.file_kind
    or new.original_filename is distinct from old.original_filename
    or new.declared_content_type is distinct from old.declared_content_type
    or new.declared_content_length is distinct from old.declared_content_length
    or new.storage_bucket_id is distinct from old.storage_bucket_id
    or new.storage_path is distinct from old.storage_path
    or new.parser_version is distinct from old.parser_version
    or new.fingerprint_version is distinct from old.fingerprint_version
    or new.created_by is distinct from old.created_by
    or new.retained_until is distinct from old.retained_until then
    raise exception 'report_package_context_is_immutable' using errcode = '23514';
  end if;
  if old.content_sha256 is not null and new.content_sha256 is distinct from old.content_sha256 then
    raise exception 'report_package_digest_is_immutable' using errcode = '23514';
  end if;
  if old.schema_fingerprint is not null and new.schema_fingerprint is distinct from old.schema_fingerprint then
    raise exception 'report_package_schema_fingerprint_is_immutable' using errcode = '23514';
  end if;
  if old.storage_object_id is not null and (
    new.storage_object_id is distinct from old.storage_object_id
    or new.storage_object_version is distinct from old.storage_object_version
  ) then
    raise exception 'report_package_object_identity_is_immutable' using errcode = '23514';
  end if;
  if not (
    (old.status = 'awaiting_upload' and new.status in ('awaiting_upload', 'uploaded', 'failed'))
    or (old.status = 'uploaded' and new.status in ('uploaded', 'profiling', 'failed'))
    or (old.status = 'profiling' and new.status in ('profiling', 'awaiting_contract', 'failed'))
    or (old.status = 'awaiting_contract' and new.status in ('awaiting_contract', 'awaiting_approval'))
    or (old.status = 'awaiting_approval' and new.status in ('awaiting_approval', 'awaiting_contract', 'awaiting_validation'))
    or (old.status = 'awaiting_validation' and new.status in ('awaiting_validation', 'validating', 'validation_failed'))
    or (old.status = 'validating' and new.status in ('validating', 'validated', 'partially_validated', 'validation_failed'))
    or (old.status in ('validated', 'partially_validated') and new.status in (old.status, 'awaiting_projection'))
    or (old.status = 'awaiting_projection' and new.status in ('awaiting_projection', 'projecting'))
    or (old.status = 'projecting' and new.status in ('projecting', 'projected', 'partially_projected', 'reconciliation_required', 'projection_failed'))
    or (old.status = 'reconciliation_required' and new.status in ('reconciliation_required', 'projected', 'partially_projected'))
    or (old.status = 'projection_failed' and new.status in ('projection_failed', 'awaiting_projection'))
    or (old.status = 'validation_failed' and new.status in ('validation_failed', 'awaiting_validation'))
    or (old.status = 'failed' and new.status in ('failed', 'uploaded'))
    or (old.status in ('projected', 'partially_projected') and new.status = old.status)
  ) then
    raise exception 'report_package_status_transition_is_invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

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
  if p_package.fingerprint_version <> 2 then
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

create or replace function public.complete_governed_report_package_profiling(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_claim_token uuid,
  p_content_sha256 text,
  p_schema_fingerprint text,
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
          'expandedBytes', 'contentDigest', 'headerCandidateDigests', 'hasFormula',
          'hasMergedCells', 'hasRepeatedHeader'
        )
      )
      or coalesce((sheet ->> 'sheetPosition')::integer, 0) not between 1 and 25
      or char_length(coalesce(sheet ->> 'sheetName', '')) not between 1 and 100
      or coalesce(sheet ->> 'normalizedSheetName', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce((sheet ->> 'rowCount')::integer, -1) not between 0 and 250000
      or coalesce((sheet ->> 'populatedCellCount')::integer, -1) not between 0 and 2500000
      or coalesce((sheet ->> 'expandedBytes')::bigint, -1) not between 0 and 262144000
      or jsonb_typeof(sheet -> 'headerCandidateDigests') <> 'array'
      or jsonb_array_length(sheet -> 'headerCandidateDigests') > 1
      or jsonb_typeof(sheet -> 'hasFormula') <> 'boolean'
      or jsonb_typeof(sheet -> 'hasMergedCells') <> 'boolean'
      or jsonb_typeof(sheet -> 'hasRepeatedHeader') <> 'boolean' then
      raise exception 'report sheet manifest is invalid' using errcode = '22023';
    end if;
    for candidate in select value from jsonb_array_elements(sheet -> 'headerCandidateDigests') loop
      if jsonb_typeof(candidate) <> 'object'
        or exists (
          select 1 from jsonb_object_keys(candidate) key
          where key not in ('rowPosition', 'fieldCount', 'digest', 'normalizedHeaderDigests')
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
    (value ->> 'expandedBytes')::bigint, nullif(value ->> 'contentDigest', ''), '[]'::jsonb,
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

revoke all on function private.assert_report_contract_matches_package(public.integration_report_packages, jsonb) from public;
revoke all on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, text, jsonb) to service_role;

commit;
