-- Write a daily, weekly, or monthly series into the metrics ledger.
--
-- Until now an approved `period_grain` declaration was refused outright with
-- `PROJECTION_OUTPUT_KIND_UNSUPPORTED`, because there was nowhere honest to put
-- its rows: summing a month of daily figures into one exact-range total would
-- have looked like a clean import while being wrong about the shape of every
-- number in it. Three of the five report families the platform knows are daily,
-- so this refusal blocked most of the client's real evidence. See ADR 0029 and
-- ADR 0030.
--
-- What lands here is the persistence path only. The arithmetic already exists
-- and is tested in `src/domain/reports/projection.ts`; this migration stores
-- what that projector returns, checks every rule a second time on the database
-- side, and never trusts the worker's own arithmetic.
--
-- Additive and forward-only. Every column added defaults to the value existing
-- rows already mean, so nothing already stored changes meaning.

-- Reconciliation state on the metrics ledger -----------------------------------

-- `specs/018` section 10.5: overlapping evidence is stored, but two sources
-- cannot both feed one rollup. The exact-range ledger already expresses that
-- with a reconciliation state; the metrics ledger needs the same word, because
-- a daily series can now collide with a prior series or with an exact-range
-- total covering the same days.
alter table public.normalized_metrics
  add column reconciliation_state text not null default 'current'
    check (reconciliation_state in ('current', 'blocked_overlap', 'excluded')),
  add column reconciliation_digest text
    check (reconciliation_digest is null or reconciliation_digest ~ '^[a-f0-9]{64}$');

comment on column public.normalized_metrics.reconciliation_state is
  'Whether this observation is the current evidence for its tuple. Only the governed report projection path writes anything other than ''current''.';
comment on column public.normalized_metrics.reconciliation_digest is
  'Identity of the governed report evidence that produced this row. Null for every other writer, which is what keeps an unrelated series from blocking a report import.';

-- "Current" gains one more condition. Every existing row defaults to `current`,
-- so this index covers exactly the same rows it did a moment ago.
drop index public.normalized_metrics_current_revision_idx;
create unique index normalized_metrics_current_revision_idx
  on public.normalized_metrics (
    organization_id,
    metric_definition_id,
    subject_kind,
    (coalesce(subject_ref, '')),
    (coalesce(channel, '')),
    dimensions,
    period_grain,
    period_start
  )
  where superseded_by_id is null and reconciliation_state = 'current';

create index normalized_metrics_governed_projection_idx
  on public.normalized_metrics (
    organization_id, metric_definition_id, branch_id, channel_id, currency, period_start
  )
  where reconciliation_digest is not null and superseded_by_id is null and reconciliation_state = 'current';

-- Observations stay append-only. Two further transitions are permitted, both of
-- them the recorded outcome of an owner or admin resolving an overlap, and
-- neither of them able to touch a value, a period, or a tenant.
create or replace function private.prevent_normalized_metric_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.to_jsonb(new) - array['superseded_by_id', 'supersede_reason', 'reconciliation_state', 'revision']
    is distinct from pg_catalog.to_jsonb(old) - array['superseded_by_id', 'supersede_reason', 'reconciliation_state', 'revision'] then
    raise exception 'normalized_metric_is_append_only' using errcode = '23514';
  end if;

  -- Closing a row by pointing it at its successor. Unchanged.
  if old.superseded_by_id is null and new.superseded_by_id is not null
    and new.reconciliation_state = old.reconciliation_state
    and new.revision = old.revision then
    return new;
  end if;

  if old.superseded_by_id is not null then
    raise exception 'normalized_metric_already_superseded' using errcode = '23514';
  end if;

  -- An accepted correction promotes the blocked candidate to current, at a
  -- revision above the evidence it replaces.
  if old.reconciliation_state = 'blocked_overlap' and new.reconciliation_state = 'current'
    and new.revision > old.revision
    and new.superseded_by_id is not distinct from old.superseded_by_id
    and new.supersede_reason is not distinct from old.supersede_reason then
    return new;
  end if;

  -- Either the operator kept the existing evidence, and the candidate is set
  -- aside, or the candidate won and evidence from the other ledger is set aside
  -- because a supersession pointer cannot cross tables.
  if old.reconciliation_state in ('blocked_overlap', 'current') and new.reconciliation_state = 'excluded'
    and new.revision is not distinct from old.revision
    and new.superseded_by_id is not distinct from old.superseded_by_id
    and new.supersede_reason is not distinct from old.supersede_reason then
    return new;
  end if;

  raise exception 'normalized_metric_is_append_only' using errcode = '23514';
end;
$$;

-- The exact-range ledger needs the mirror image of that last transition, for
-- the same reason: a daily series accepted over a monthly total cannot point
-- the total at its successor, because the successor lives in another table.
create or replace function private.prevent_report_projection_evidence_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_table_name <> 'exact_range_metric_observations' then
    raise exception 'report_projection_evidence_is_append_only' using errcode = '55000';
  end if;

  if to_jsonb(new) - array['reconciliation_state', 'revision', 'superseded_by_id', 'supersede_reason']
     is distinct from to_jsonb(old) - array['reconciliation_state', 'revision', 'superseded_by_id', 'supersede_reason'] then
    raise exception 'report_projection_evidence_is_append_only' using errcode = '55000';
  end if;

  if old.reconciliation_state = 'blocked_overlap'
    and new.reconciliation_state = 'current'
    and new.revision > old.revision
    and new.superseded_by_id is not distinct from old.superseded_by_id
    and new.supersede_reason is not distinct from old.supersede_reason then
    return new;
  end if;
  if old.reconciliation_state in ('blocked_overlap', 'current')
    and new.reconciliation_state = 'excluded'
    and new.revision is not distinct from old.revision
    and new.superseded_by_id is not distinct from old.superseded_by_id
    and new.supersede_reason is not distinct from old.supersede_reason then
    return new;
  end if;
  if old.reconciliation_state = 'current'
    and new.reconciliation_state = 'superseded'
    and new.revision is not distinct from old.revision
    and new.superseded_by_id is not null
    and new.supersede_reason = 'approved_correction' then
    return new;
  end if;
  raise exception 'report_projection_evidence_is_append_only' using errcode = '55000';
end;
$$;

-- `20260810130000` intended the metrics ledger to be read-only from the browser
-- -- "issuing a write grant here would put an unaudited path to the decision
-- inputs in the browser" -- and granted only `select`. It never revoked the
-- schema-wide default, so `authenticated` still held insert, update, and delete.
-- Row level security refused those writes, so nothing was reachable, but the
-- table's stated boundary and its actual grants disagreed. Every writer is a
-- service-role worker, so this makes the intent true rather than changing it.
revoke insert, update, delete, truncate, references, trigger
  on table public.normalized_metrics from authenticated, anon;
grant select on table public.normalized_metrics to authenticated;

-- Lineage now points at either ledger -----------------------------------------

-- `specs/018` section 10.4 requires every projected number to resolve through
-- lineage. A projected number can now live in one of two tables, so a lineage
-- row names exactly one of them.
--
-- A period-grain row records the sheet, the column, and how many rows fed the
-- period. It does not record a first and last data row, because the projector
-- does not compute one per period and inventing one would be a claim about
-- evidence nobody checked. See ADR 0030.
alter table public.report_projection_lineage
  alter column exact_range_metric_observation_id drop not null,
  alter column first_data_row drop not null,
  alter column last_data_row drop not null,
  add column normalized_metric_id uuid,
  add constraint report_projection_lineage_single_target_check
    check (num_nonnulls(exact_range_metric_observation_id, normalized_metric_id) = 1),
  add constraint report_projection_lineage_exact_range_rows_check
    check (exact_range_metric_observation_id is null
      or (first_data_row is not null and last_data_row is not null)),
  add constraint report_projection_lineage_period_grain_rows_check
    check (normalized_metric_id is null
      or (first_data_row is null and last_data_row is null)),
  add constraint report_projection_lineage_normalized_metric_fk
    foreign key (organization_id, normalized_metric_id)
    references public.normalized_metrics(organization_id, id) on delete restrict;

create unique index report_projection_lineage_normalized_metric_idx
  on public.report_projection_lineage (organization_id, normalized_metric_id)
  where normalized_metric_id is not null;

-- Reconciliation spans both ledgers -------------------------------------------

-- ADR 0029: a period could receive both a daily series and an exact-range total
-- covering the same days, and an ambiguous case is an owner or admin decision
-- rather than a precedence rule buried in code. That decision is recorded in
-- the tables that already exist for it; only their reach widens.
alter table public.report_projection_reconciliations
  add column projection_target text not null default 'exact_range'
    check (projection_target in ('exact_range', 'period_grain')),
  add column period_start date,
  add column period_end date,
  add column prior_normalized_metric_id uuid,
  add column result_normalized_metric_id uuid,
  add constraint report_projection_reconciliations_single_prior_check
    check (num_nonnulls(prior_observation_id, prior_normalized_metric_id) <= 1),
  add constraint report_projection_reconciliations_single_result_check
    check (num_nonnulls(result_observation_id, result_normalized_metric_id) <= 1),
  -- A series row is filed under the period it describes; an exact-range row
  -- takes its period from the package and has none of its own to record.
  add constraint report_projection_reconciliations_period_check
    check ((projection_target = 'period_grain') = (period_start is not null)
      and (period_start is null) = (period_end is null)
      and (period_end is null or period_end >= period_start)),
  add constraint report_projection_reconciliations_prior_metric_fk
    foreign key (organization_id, prior_normalized_metric_id)
    references public.normalized_metrics(organization_id, id) on delete restrict,
  add constraint report_projection_reconciliations_result_metric_fk
    foreign key (organization_id, result_normalized_metric_id)
    references public.normalized_metrics(organization_id, id) on delete restrict;

-- The original uniqueness rule said one run may file one decision per output
-- key per prior. That is still exactly right for an exact-range run, and wrong
-- for a series: thirty-one days landing on one monthly total legitimately name
-- the same prior thirty-one times. The rule is therefore restated per target
-- rather than relaxed for both.
alter table public.report_projection_reconciliations
  drop constraint report_projection_reconciliat_organization_id_projection_ru_key;

-- The prior is part of what makes a decision distinct, and a null prior is one
-- specific case rather than an unknown, so it is folded to a sentinel instead of
-- being allowed to repeat.
create unique index report_projection_reconciliations_exact_range_prior_idx
  on public.report_projection_reconciliations (
    organization_id, projection_run_id, projection_output_key,
    (coalesce(prior_observation_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(prior_normalized_metric_id, '00000000-0000-0000-0000-000000000000'::uuid))
  )
  where projection_target = 'exact_range';

create unique index report_projection_reconciliations_period_grain_idx
  on public.report_projection_reconciliations (
    organization_id, projection_run_id, projection_output_key, period_start,
    (coalesce(prior_observation_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(prior_normalized_metric_id, '00000000-0000-0000-0000-000000000000'::uuid))
  )
  where projection_target = 'period_grain';

-- A month laid over a daily series collides with every day it covers, and each
-- of those collisions is a decision in its own right. Recording only the first
-- would leave the rest live after a resolution, quietly double-counting exactly
-- the days the reconciliation existed to protect.
alter table public.report_projection_reconciliations
  drop constraint report_projection_reconciliations_candidate_count_check,
  add constraint report_projection_reconciliations_candidate_count_check
    check (candidate_count between 0 and 20000);

create unique index report_projection_reconciliations_result_metric_idx
  on public.report_projection_reconciliations (organization_id, result_normalized_metric_id)
  where result_normalized_metric_id is not null;

alter table public.report_projection_reconciliation_resolutions
  alter column prior_observation_id drop not null,
  alter column result_observation_id drop not null,
  add column prior_normalized_metric_id uuid,
  add column result_normalized_metric_id uuid,
  add constraint report_projection_reconciliation_resolutions_single_prior_check
    check (num_nonnulls(prior_observation_id, prior_normalized_metric_id) = 1),
  add constraint report_projection_reconciliation_resolutions_single_result_check
    check (num_nonnulls(result_observation_id, result_normalized_metric_id) = 1),
  add constraint report_projection_reconciliation_resolutions_prior_metric_fk
    foreign key (organization_id, prior_normalized_metric_id)
    references public.normalized_metrics(organization_id, id) on delete restrict,
  add constraint report_projection_reconciliation_resolutions_result_metric_fk
    foreign key (organization_id, result_normalized_metric_id)
    references public.normalized_metrics(organization_id, id) on delete restrict;

-- A run's shape -----------------------------------------------------------

-- A daily file over a declared quarter emits one row per day per output, so the
-- fifty-output ceiling that fits one exact-range sum does not fit a series.
alter table public.integration_report_projection_runs
  drop constraint integration_report_projection_runs_output_count_check,
  add constraint integration_report_projection_runs_output_count_check
    check (output_count between 0 and 20000),
  -- Blank is not zero, and a gap is a fact about the evidence rather than an
  -- error. An operator has to be able to see that eleven of thirty days said
  -- nothing, so the count is stored rather than left in a log line.
  add column absent_row_count integer
    check (absent_row_count is null or absent_row_count between 0 and 10000000);

comment on column public.integration_report_projection_runs.absent_row_count is
  'How many row-and-output pairs the provider left blank. Reported, never turned into a zero observation.';

-- One more way a projection can honestly fail ---------------------------------

--   PERIOD_OUT_OF_DECLARED_RANGE  a row is dated outside the window the
--                                 operator declared this package covers
--
-- The alternative is filing a figure under a period nobody said this file was
-- about, which is how a January total quietly becomes December's.
alter table public.integration_report_packages
  drop constraint if exists integration_report_packages_safe_failure_code_check,
  add constraint integration_report_packages_safe_failure_code_check check (safe_failure_code is null or safe_failure_code in (
    'UPLOAD_EXPIRED', 'OBJECT_UNAVAILABLE', 'OBJECT_IDENTITY_CHANGED', 'INVALID_FILE_TYPE', 'FILE_TOO_LARGE',
    'TOO_MANY_SHEETS', 'TOO_MANY_ROWS', 'TOO_MANY_POPULATED_CELLS', 'EXPANDED_CONTENT_TOO_LARGE',
    'UNSAFE_WORKBOOK', 'UNREADABLE_WORKBOOK', 'PROFILE_FAILED', 'PACKAGE_EXPIRED',
    'CONTRACT_VERSION_NOT_APPROVED', 'CONTRACT_BINDING_INACTIVE', 'CONTRACT_CONTEXT_MISMATCH',
    'REQUIRED_SHEET_MISSING', 'REQUIRED_SOURCE_HEADER_MISSING', 'REQUIRED_FIELD_MISSING',
    'INVALID_INTEGER', 'INVALID_DECIMAL', 'INVALID_MONEY', 'INVALID_LOCAL_DATE', 'INVALID_TIMESTAMP',
    'INVALID_DURATION', 'INVALID_PERCENTAGE', 'INVALID_TEXT', 'INVALID_ENUM', 'FORMULA_REJECTED',
    'FORMULA_VALUE_UNSUPPORTED', 'MERGED_CELLS_REJECTED', 'CONTROL_MISMATCH',
    'UNDECLARED_SHEET_PRESENT', 'VALIDATION_PROCESSING_FAILED',
    'PROJECTION_VERSION_NOT_APPROVED', 'PROJECTION_BINDING_INACTIVE', 'PROJECTION_CONTEXT_MISMATCH',
    'PROJECTION_FIELD_VALUE_KIND_MISMATCH', 'REQUIRED_PROJECTED_VALUE_MISSING',
    'CONTROL_TOTAL_MISMATCH', 'PROJECTION_OUTPUT_KIND_UNSUPPORTED', 'TOTALS_ROW_NOT_RESOLVED',
    'PERIOD_OUT_OF_DECLARED_RANGE',
    'PROJECTION_PROCESSING_FAILED'
  ));

-- Replaced whole rather than patched, because plpgsql has no way to amend a
-- literal list in place. Only the accepted-code list differs from the version
-- installed by 20260822170000.
create or replace function public.fail_governed_report_package_projection(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_projection_run_id uuid,
  p_claim_token uuid,
  p_failure_code text,
  p_result_digest text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.integration_report_projection_operations;
  run_row public.integration_report_projection_runs;
  package_row public.integration_report_packages;
begin
  if p_failure_code not in ('OBJECT_IDENTITY_CHANGED', 'OBJECT_UNAVAILABLE', 'PACKAGE_EXPIRED',
    'PROJECTION_VERSION_NOT_APPROVED', 'PROJECTION_BINDING_INACTIVE', 'PROJECTION_CONTEXT_MISMATCH',
    'UNREADABLE_WORKBOOK', 'CONTROL_TOTAL_MISMATCH', 'PROJECTION_OUTPUT_KIND_UNSUPPORTED',
    'TOTALS_ROW_NOT_RESOLVED', 'INVALID_LOCAL_DATE', 'PERIOD_OUT_OF_DECLARED_RANGE',
    'PROJECTION_PROCESSING_FAILED') or p_result_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'report projection failure is invalid' using errcode = '22023';
  end if;
  select * into operation from private.integration_report_projection_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id for update;
  if not found or operation.projection_run_id <> p_projection_run_id or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then return null; end if;
  select * into run_row from public.integration_report_projection_runs
  where organization_id = p_organization_id and id = p_projection_run_id and status = 'running' for update;
  if not found then return null; end if;
  update public.integration_report_projection_runs set status = 'failed', quality_state = 'failed', completeness_state = 'unavailable',
    result_digest = p_result_digest, error_codes = jsonb_build_array(p_failure_code), warning_codes = '[]'::jsonb, completed_at = now()
  where organization_id = p_organization_id and id = p_projection_run_id;
  update public.integration_report_packages set status = 'projection_failed', safe_failure_code = p_failure_code, safe_failure_at = now()
  where organization_id = p_organization_id and id = p_report_package_id returning * into package_row;
  return to_jsonb(package_row);
end;
$$;

revoke all on function public.fail_governed_report_package_projection(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fail_governed_report_package_projection(uuid, uuid, uuid, uuid, text, text) to service_role;

-- Identity of one period's evidence -------------------------------------------

-- The exact-range digest identifies one output over the package's declared
-- window. A series emits many outputs over many periods from the same package,
-- so the period is part of what makes one of them the same evidence twice.
create function private.report_projection_period_reconciliation_digest(
  p_package public.integration_report_packages,
  p_validation public.integration_report_validation_runs,
  p_projection public.report_projection_versions,
  p_metric_definition_id uuid,
  p_output_key text,
  p_source_digest text,
  p_period_start date,
  p_period_end date,
  p_period_timezone text
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(concat_ws('|', (p_package).organization_id, (p_package).channel_id,
    (p_package).branch_id, p_metric_definition_id, p_output_key, p_period_start, p_period_end,
    p_period_timezone, (p_package).declared_currency, (p_package).content_sha256, (p_validation).result_digest,
    (select v.mapping_digest from public.report_contract_versions v where v.organization_id = (p_package).organization_id and v.id = (p_validation).report_contract_version_id),
    (p_projection).projection_digest, (p_projection).calculation_version, p_source_digest), 'sha256'), 'hex')
$$;

revoke all on function private.report_projection_period_reconciliation_digest(
  public.integration_report_packages, public.integration_report_validation_runs,
  public.report_projection_versions, uuid, text, text, date, date, text) from public;

-- The fenced worker write path ------------------------------------------------

-- Called by the worker under the claim token and lease it already holds, in the
-- same shape as the exact-range completion. Every rule the TypeScript projector
-- enforces is checked again here, because the worker is not the authority on
-- what may enter the ledger: the grain is re-derived from the declaration, the
-- period is checked against the package, the currency against the package, and
-- the metric definition against the registry.
create function public.complete_governed_report_package_period_grain_projection(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_projection_run_id uuid,
  p_claim_token uuid,
  p_result_digest text,
  p_result jsonb,
  p_observations jsonb,
  p_absent_row_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  operation private.integration_report_projection_operations;
  run_row public.integration_report_projection_runs;
  package_row public.integration_report_packages;
  validation_row public.integration_report_validation_runs;
  projection_version_row public.report_projection_versions;
  object_row storage.objects;
  definition_row public.metric_definitions;
  prior_metric public.normalized_metrics;
  emitted jsonb;
  projection_document_json jsonb;
  declared_grain text;
  branch_timezone text;
  channel_key text;
  local_period_start date;
  local_period_end date;
  period_started_at timestamptz;
  period_ended_at timestamptz;
  emitted_currency text;
  evidence_digest text;
  overlap_count integer;
  metric_id uuid;
  final_status text;
  has_blocked_overlap boolean := false;
  effective_quality_state text;
  effective_completeness_state text;
begin
  if p_result_digest !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_result) <> 'object' or jsonb_typeof(p_observations) <> 'array'
    or coalesce((select bool_or(key not in ('status', 'qualityState', 'completenessState', 'errorCodes', 'warningCodes')) from jsonb_object_keys(p_result) key), false)
    or p_result ->> 'status' not in ('projected', 'partially_projected', 'failed')
    or p_result ->> 'qualityState' not in ('complete', 'partial', 'failed')
    or p_result ->> 'completenessState' not in ('complete', 'partial', 'unavailable')
    or jsonb_array_length(p_observations) > 20000
    or p_absent_row_count is null or p_absent_row_count not between 0 and 10000000 then
    raise exception 'report projection evidence is invalid' using errcode = '22023';
  end if;

  select * into operation from private.integration_report_projection_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id for update;
  if not found or operation.projection_run_id <> p_projection_run_id or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then return null; end if;
  select * into run_row from public.integration_report_projection_runs
  where organization_id = p_organization_id and id = p_projection_run_id and status = 'running' for update;
  if not found then return null; end if;
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id and status = 'projecting' for update;
  if not found then return null; end if;
  select * into object_row from storage.objects where bucket_id = package_row.storage_bucket_id and name = package_row.storage_path;
  if not found or object_row.id <> package_row.storage_object_id or object_row.version <> package_row.storage_object_version then
    raise exception 'report projection object identity changed' using errcode = '23514';
  end if;

  select * into validation_row from public.integration_report_validation_runs v
  where v.organization_id = p_organization_id and v.id = run_row.validation_run_id;
  select * into projection_version_row from public.report_projection_versions v
  where v.organization_id = p_organization_id and v.id = run_row.report_projection_version_id;
  projection_document_json := projection_version_row.projection_document;

  -- This path writes a series and only a series. An exact-range declaration
  -- arriving here would be a caller error, not a shape to accommodate.
  declared_grain := projection_document_json ->> 'grain';
  if projection_document_json ->> 'outputKind' <> 'period_grain' or declared_grain not in ('day', 'week', 'month') then
    raise exception 'projection declaration does not emit a period grain series' using errcode = '23514';
  end if;

  -- `specs/015` section 4.4: period boundaries are computed in the branch's
  -- timezone, not the organization default the package carries, and the zone in
  -- force is recorded so a later branch change cannot reinterpret history. See
  -- ADR 0030.
  select b.timezone into branch_timezone from public.branches b
  where b.organization_id = p_organization_id and b.id = package_row.branch_id;
  if branch_timezone is null then
    raise exception 'branch timezone is required to bucket a period grain series' using errcode = '23514';
  end if;
  select c.key into channel_key from public.organization_channels c
  where c.organization_id = p_organization_id and c.id = package_row.channel_id;

  if p_result ->> 'status' = 'failed' and jsonb_array_length(p_observations) <> 0 then
    raise exception 'failed projection cannot persist observations' using errcode = '22023';
  end if;
  if p_result ->> 'status' <> 'failed' and jsonb_array_length(p_observations) = 0 then
    raise exception 'successful projection requires observations' using errcode = '22023';
  end if;
  effective_quality_state := case when p_result ->> 'qualityState' = 'partial' then 'partial' else 'complete' end;
  effective_completeness_state := case when p_result ->> 'completenessState' = 'partial' then 'partial' else 'complete' end;

  for emitted in select value from jsonb_array_elements(p_observations) loop
    if jsonb_typeof(emitted) <> 'object'
      or coalesce((select bool_or(key not in ('key', 'metricKey', 'metricDefinitionId', 'valueKind', 'valueNumerator',
        'currency', 'periodStart', 'periodEnd', 'normalizedSheetName', 'canonicalField', 'sourceColumnOrdinal',
        'contributorCount', 'sourceDigest')) from jsonb_object_keys(emitted) key), false)
      or coalesce(emitted ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(emitted ->> 'metricKey', '') !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'
      or coalesce(emitted ->> 'metricDefinitionId', '') !~ '^[0-9a-f-]{36}$'
      or emitted ->> 'valueKind' not in ('money', 'count')
      or coalesce(emitted ->> 'valueNumerator', '') !~ '^-?[0-9]+$'
      or ((emitted ->> 'valueKind' = 'money') and coalesce(emitted ->> 'currency', '') <> package_row.declared_currency)
      or ((emitted ->> 'valueKind' = 'count') and emitted ? 'currency' and emitted ->> 'currency' is not null)
      or coalesce(emitted ->> 'periodStart', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(emitted ->> 'periodEnd', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(emitted ->> 'normalizedSheetName', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(emitted ->> 'canonicalField', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce((emitted ->> 'sourceColumnOrdinal')::integer, 0) not between 1 and 250000
      -- An observation exists because rows carried a figure. Zero contributors
      -- would be a period the provider said nothing about, and that period must
      -- stay absent rather than arrive as evidence.
      or coalesce((emitted ->> 'contributorCount')::integer, 0) not between 1 and 250000
      or coalesce(emitted ->> 'sourceDigest', '') !~ '^[a-f0-9]{64}$' then
      raise exception 'report projection observation evidence is invalid' using errcode = '22023';
    end if;

    if not exists (
      select 1 from jsonb_array_elements(projection_document_json -> 'outputs') expected
      where expected ->> 'key' = emitted ->> 'key' and expected ->> 'metricKey' = emitted ->> 'metricKey'
        and expected ->> 'valueKind' = emitted ->> 'valueKind'
        and expected ->> 'normalizedSheetName' = emitted ->> 'normalizedSheetName'
        and expected ->> 'canonicalField' = emitted ->> 'canonicalField'
    ) then raise exception 'projection observation does not match binding' using errcode = '23514'; end if;

    local_period_start := (emitted ->> 'periodStart')::date;
    local_period_end := (emitted ->> 'periodEnd')::date;

    -- The grain is declared and never inferred, so the boundary is re-derived
    -- here from the declaration rather than accepted from the caller. A week
    -- starts on Monday and a month on the first, matching the projector.
    -- The `case` is parenthesised deliberately: plpgsql reads an `if`
    -- condition up to the first `then`, and a bare `case` inside one ends the
    -- expression at its own first branch.
    if local_period_end <> (case declared_grain
        when 'day' then local_period_start
        when 'week' then local_period_start + 6
        else (date_trunc('month', local_period_start::timestamp) + interval '1 month' - interval '1 day')::date
      end)
      or (declared_grain = 'week' and extract(isodow from local_period_start) <> 1)
      or (declared_grain = 'month' and local_period_start <> date_trunc('month', local_period_start::timestamp)::date) then
      raise exception 'report projection period does not match the declared grain' using errcode = '23514';
    end if;

    -- A figure filed outside the window the operator declared this package
    -- covers is a figure filed under someone else's month.
    if local_period_start < package_row.declared_period_start or local_period_end > package_row.declared_period_end then
      raise exception 'report projection period falls outside the declared package period' using errcode = '23514';
    end if;

    select * into definition_row from public.metric_definitions d
    where d.id = (emitted ->> 'metricDefinitionId')::uuid and d.key = emitted ->> 'metricKey'
      and d.value_kind = emitted ->> 'valueKind' and d.aggregation = 'sum' and d.is_active
      and (d.organization_id is null or d.organization_id = p_organization_id);
    if not found then raise exception 'projection metric definition is invalid' using errcode = '23514'; end if;

    emitted_currency := case when emitted ->> 'valueKind' = 'money' then package_row.declared_currency else null end;
    period_started_at := local_period_start::timestamp at time zone branch_timezone;
    -- Half-open, matching the table's own `period_end > period_start` check and
    -- every existing reader of the series.
    period_ended_at := (local_period_end + 1)::timestamp at time zone branch_timezone;

    evidence_digest := private.report_projection_period_reconciliation_digest(
      package_row, validation_row, projection_version_row, definition_row.id,
      emitted ->> 'key', emitted ->> 'sourceDigest', local_period_start, local_period_end, branch_timezone
    );

    perform pg_advisory_xact_lock(hashtextextended(concat_ws('|', p_organization_id, package_row.channel_id,
      package_row.branch_id, definition_row.id, branch_timezone, coalesce(emitted_currency, '')), 0));

    -- Byte-identical evidence for the same declared context is an idempotent
    -- replay, per `specs/018` section 10.5.
    select * into prior_metric from public.normalized_metrics m
    where m.organization_id = p_organization_id and m.branch_id = package_row.branch_id
      and m.channel_id = package_row.channel_id and m.metric_definition_id = definition_row.id
      and m.period_grain = declared_grain and m.period_start = period_started_at
      and m.period_timezone = branch_timezone
      and m.currency is not distinct from emitted_currency
      and m.reconciliation_state = 'current' and m.superseded_by_id is null
      and m.reconciliation_digest = evidence_digest
    order by m.id limit 1 for update;
    if found then
      insert into public.report_projection_reconciliations (
        organization_id, report_package_id, projection_run_id, projection_output_key, projection_target,
        period_start, period_end, classification, reconciliation_digest, prior_normalized_metric_id,
        candidate_count, quality_state, completeness_state, calculation_version, correlation_id
      ) values (
        p_organization_id, p_report_package_id, p_projection_run_id, emitted ->> 'key', 'period_grain',
        local_period_start, local_period_end, 'exact_duplicate', evidence_digest, prior_metric.id,
        1, effective_quality_state, effective_completeness_state, run_row.calculation_version, run_row.correlation_id
      );
      continue;
    end if;

    -- Overlap is looked for in both ledgers, because a period could receive a
    -- daily series and an exact-range total covering the same days, and they
    -- cannot both feed one rollup. Each side is compared in its own recorded
    -- zone's local dates, so a branch zone differing from the package's does not
    -- hide a collision. Only rows this projection path wrote are candidates; a
    -- series some other collector produced is not evidence about this import.
    select count(*) into overlap_count from (
      select 1
      from public.normalized_metrics m
      where m.organization_id = p_organization_id and m.branch_id = package_row.branch_id
        and m.channel_id = package_row.channel_id and m.metric_definition_id = definition_row.id
        and m.currency is not distinct from emitted_currency
        and m.reconciliation_state = 'current' and m.superseded_by_id is null
        and m.reconciliation_digest is not null
        and (m.period_start at time zone m.period_timezone)::date <= local_period_end
        and ((m.period_end at time zone m.period_timezone) - interval '1 day')::date >= local_period_start
      union all
      select 1
      from public.exact_range_metric_observations o
      where o.organization_id = p_organization_id and o.branch_id = package_row.branch_id
        and o.channel_id = package_row.channel_id and o.metric_definition_id = definition_row.id
        and o.currency is not distinct from emitted_currency
        and o.reconciliation_state = 'current'
        and o.period_start <= local_period_end and o.period_end >= local_period_start
    ) candidates;

    if overlap_count > 20000 then
      raise exception 'report projection overlap is too broad to reconcile' using errcode = '23514';
    end if;
    if overlap_count > 0 then
      -- Every candidate is locked, and every one of them becomes a decision of
      -- its own below. Recording only the first would leave the rest live after
      -- a resolution, which is the double-count this exists to prevent.
      perform 1 from public.normalized_metrics m
      where m.organization_id = p_organization_id and m.branch_id = package_row.branch_id
        and m.channel_id = package_row.channel_id and m.metric_definition_id = definition_row.id
        and m.currency is not distinct from emitted_currency
        and m.reconciliation_state = 'current' and m.superseded_by_id is null
        and m.reconciliation_digest is not null
        and (m.period_start at time zone m.period_timezone)::date <= local_period_end
        and ((m.period_end at time zone m.period_timezone) - interval '1 day')::date >= local_period_start for update;
      perform 1 from public.exact_range_metric_observations o
      where o.organization_id = p_organization_id and o.branch_id = package_row.branch_id
        and o.channel_id = package_row.channel_id and o.metric_definition_id = definition_row.id
        and o.currency is not distinct from emitted_currency
        and o.reconciliation_state = 'current'
        and o.period_start <= local_period_end and o.period_end >= local_period_start for update;
    end if;

    insert into public.normalized_metrics (
      organization_id, branch_id, channel_id, channel, metric_definition_id, value_kind,
      subject_kind, dimensions, period_grain, period_start, period_end, period_timezone,
      value_numerator, currency, quality_tier, reconciliation_state, reconciliation_digest, observed_at
    ) values (
      p_organization_id, package_row.branch_id, package_row.channel_id, channel_key, definition_row.id, emitted ->> 'valueKind',
      'organization', '{}'::jsonb, declared_grain, period_started_at, period_ended_at, branch_timezone,
      (emitted ->> 'valueNumerator')::numeric, emitted_currency, definition_row.default_quality_tier,
      case when overlap_count > 0 then 'blocked_overlap' else 'current' end, evidence_digest, period_ended_at
    ) returning id into metric_id;

    insert into public.report_projection_lineage (
      organization_id, normalized_metric_id, report_package_id, validation_run_id, projection_run_id,
      report_contract_version_id, report_projection_version_id, normalized_sheet_name, canonical_field,
      source_column_ordinal, contributor_count, calculation_version, source_digest, quality_state, completeness_state
    ) values (
      p_organization_id, metric_id, p_report_package_id, run_row.validation_run_id, p_projection_run_id,
      run_row.report_contract_version_id, run_row.report_projection_version_id,
      emitted ->> 'normalizedSheetName', emitted ->> 'canonicalField',
      (emitted ->> 'sourceColumnOrdinal')::integer, (emitted ->> 'contributorCount')::integer,
      run_row.calculation_version, emitted ->> 'sourceDigest', effective_quality_state, effective_completeness_state
    );

    if overlap_count = 0 then
      insert into public.report_projection_reconciliations (
        organization_id, report_package_id, projection_run_id, projection_output_key, projection_target,
        period_start, period_end, classification, reconciliation_digest, result_normalized_metric_id,
        candidate_count, quality_state, completeness_state, calculation_version, correlation_id
      ) values (
        p_organization_id, p_report_package_id, p_projection_run_id, emitted ->> 'key', 'period_grain',
        local_period_start, local_period_end, 'non_overlapping', evidence_digest, metric_id,
        0, effective_quality_state, effective_completeness_state, run_row.calculation_version, run_row.correlation_id
      );
    else
      insert into public.report_projection_reconciliations (
        organization_id, report_package_id, projection_run_id, projection_output_key, projection_target,
        period_start, period_end, classification, reconciliation_digest, prior_observation_id,
        prior_normalized_metric_id, result_normalized_metric_id, candidate_count,
        quality_state, completeness_state, calculation_version, correlation_id
      )
      select p_organization_id, p_report_package_id, p_projection_run_id, emitted ->> 'key', 'period_grain',
        local_period_start, local_period_end, 'ambiguous_overlap', evidence_digest, candidate.exact_id,
        candidate.metric_id, metric_id, overlap_count,
        effective_quality_state, effective_completeness_state, run_row.calculation_version, run_row.correlation_id
      from (
        select null::uuid as exact_id, m.id as metric_id
        from public.normalized_metrics m
      where m.organization_id = p_organization_id and m.branch_id = package_row.branch_id
        and m.channel_id = package_row.channel_id and m.metric_definition_id = definition_row.id
        and m.currency is not distinct from emitted_currency
        and m.reconciliation_state = 'current' and m.superseded_by_id is null
        and m.reconciliation_digest is not null
        and (m.period_start at time zone m.period_timezone)::date <= local_period_end
        and ((m.period_end at time zone m.period_timezone) - interval '1 day')::date >= local_period_start
        union all
        select o.id as exact_id, null::uuid as metric_id
        from public.exact_range_metric_observations o
      where o.organization_id = p_organization_id and o.branch_id = package_row.branch_id
        and o.channel_id = package_row.channel_id and o.metric_definition_id = definition_row.id
        and o.currency is not distinct from emitted_currency
        and o.reconciliation_state = 'current'
        and o.period_start <= local_period_end and o.period_end >= local_period_start
      ) candidate;
    end if;

    has_blocked_overlap := has_blocked_overlap or overlap_count > 0;
  end loop;

  final_status := p_result ->> 'status';
  update public.integration_report_projection_runs set status = final_status, quality_state = p_result ->> 'qualityState',
    completeness_state = p_result ->> 'completenessState', output_count = jsonb_array_length(p_observations),
    absent_row_count = p_absent_row_count,
    result_digest = p_result_digest, error_codes = coalesce(p_result -> 'errorCodes', '[]'::jsonb),
    warning_codes = coalesce(p_result -> 'warningCodes', '[]'::jsonb), completed_at = now()
  where organization_id = p_organization_id and id = p_projection_run_id;
  update public.integration_report_packages set status = case
    when has_blocked_overlap then 'reconciliation_required'
    when final_status = 'projected' then 'projected'
    when final_status = 'partially_projected' then 'partially_projected'
    else 'projection_failed' end,
    safe_failure_code = case when final_status = 'failed' then coalesce(p_result -> 'errorCodes' ->> 0, 'PROJECTION_PROCESSING_FAILED') else null end,
    safe_failure_at = case when final_status = 'failed' then now() else null end
  where organization_id = p_organization_id and id = p_report_package_id returning * into package_row;
  return to_jsonb(package_row);
end;
$$;

revoke all on function public.complete_governed_report_package_period_grain_projection(uuid, uuid, uuid, uuid, text, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.complete_governed_report_package_period_grain_projection(uuid, uuid, uuid, uuid, text, jsonb, jsonb, integer) to service_role;

-- The exact-range path learns to see the other ledger ---------------------------

-- Replaced whole rather than patched, because plpgsql has no way to amend a
-- statement in place. Only the overlap search differs from the version running
-- before this migration: it now also finds a governed series covering the same
-- days, so a monthly total landing on top of an already-imported month is held
-- for the same owner decision as any other ambiguous overlap.
create or replace function public.complete_governed_report_package_projection(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_projection_run_id uuid,
  p_claim_token uuid,
  p_result_digest text,
  p_result jsonb,
  p_outputs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  operation private.integration_report_projection_operations;
  run_row public.integration_report_projection_runs;
  package_row public.integration_report_packages;
  object_row storage.objects;
  output jsonb;
  projection_document_json jsonb;
  definition_row public.metric_definitions;
  prior_row public.exact_range_metric_observations;
  observation_id uuid;
  reconciliation_digest text;
  overlap_count integer;
  final_status text;
  has_blocked_overlap boolean := false;
  effective_quality_state text;
  effective_completeness_state text;
begin
  if p_result_digest !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_result) <> 'object' or jsonb_typeof(p_outputs) <> 'array'
    or coalesce((select bool_or(key not in ('status', 'qualityState', 'completenessState', 'errorCodes', 'warningCodes')) from jsonb_object_keys(p_result) key), false)
    or p_result ->> 'status' not in ('projected', 'partially_projected', 'failed')
    or p_result ->> 'qualityState' not in ('complete', 'partial', 'failed')
    or p_result ->> 'completenessState' not in ('complete', 'partial', 'unavailable')
    or jsonb_array_length(p_outputs) > 50 then
    raise exception 'report projection evidence is invalid' using errcode = '22023';
  end if;
  select * into operation from private.integration_report_projection_operations
  where organization_id = p_organization_id and report_package_id = p_report_package_id for update;
  if not found or operation.projection_run_id <> p_projection_run_id or operation.claim_token <> p_claim_token or operation.lease_expires_at <= now() then return null; end if;
  select * into run_row from public.integration_report_projection_runs
  where organization_id = p_organization_id and id = p_projection_run_id and status = 'running' for update;
  if not found then return null; end if;
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id and status = 'projecting' for update;
  if not found then return null; end if;
  select * into object_row from storage.objects where bucket_id = package_row.storage_bucket_id and name = package_row.storage_path;
  if not found or object_row.id <> package_row.storage_object_id or object_row.version <> package_row.storage_object_version then
    raise exception 'report projection object identity changed' using errcode = '23514';
  end if;
  select v.projection_document into projection_document_json from public.report_projection_versions v
  where v.organization_id = p_organization_id and v.id = run_row.report_projection_version_id;
  if p_result ->> 'status' = 'failed' and jsonb_array_length(p_outputs) <> 0 then raise exception 'failed projection cannot persist outputs' using errcode = '22023'; end if;
  if p_result ->> 'status' <> 'failed' and jsonb_array_length(p_outputs) = 0 then raise exception 'successful projection requires outputs' using errcode = '22023'; end if;
  effective_quality_state := case when p_result ->> 'qualityState' = 'partial' then 'partial' else 'complete' end;
  effective_completeness_state := case when p_result ->> 'completenessState' = 'partial' then 'partial' else 'complete' end;
  for output in select value from jsonb_array_elements(p_outputs) loop
    if jsonb_typeof(output) <> 'object'
      or coalesce((select bool_or(key not in ('key', 'metricKey', 'metricDefinitionId', 'valueKind', 'valueNumerator', 'currency', 'normalizedSheetName', 'canonicalField', 'sourceColumnOrdinal', 'firstDataRow', 'lastDataRow', 'contributorCount', 'sourceDigest')) from jsonb_object_keys(output) key), false)
      or coalesce(output ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(output ->> 'metricKey', '') !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'
      or coalesce(output ->> 'metricDefinitionId', '') !~ '^[0-9a-f-]{36}$'
      or output ->> 'valueKind' not in ('money', 'count')
      or coalesce(output ->> 'valueNumerator', '') !~ '^-?[0-9]+$'
      or ((output ->> 'valueKind' = 'money') and coalesce(output ->> 'currency', '') <> package_row.declared_currency)
      or ((output ->> 'valueKind' = 'count') and output ? 'currency' and output ->> 'currency' is not null)
      or coalesce(output ->> 'normalizedSheetName', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce(output ->> 'canonicalField', '') !~ '^[a-z][a-z0-9_]{0,63}$'
      or coalesce((output ->> 'sourceColumnOrdinal')::integer, 0) not between 1 and 250000
      or coalesce((output ->> 'firstDataRow')::integer, 0) not between 1 and 250000
      or coalesce((output ->> 'lastDataRow')::integer, -1) not between 0 and 250000
      or coalesce((output ->> 'contributorCount')::integer, -1) not between 0 and 250000
      or coalesce(output ->> 'sourceDigest', '') !~ '^[a-f0-9]{64}$' then
      raise exception 'report projection output evidence is invalid' using errcode = '22023';
    end if;
    if not exists (
      select 1 from jsonb_array_elements(projection_document_json -> 'outputs') expected
      where expected ->> 'key' = output ->> 'key' and expected ->> 'metricKey' = output ->> 'metricKey'
        and expected ->> 'valueKind' = output ->> 'valueKind'
        and expected ->> 'normalizedSheetName' = output ->> 'normalizedSheetName'
        and expected ->> 'canonicalField' = output ->> 'canonicalField'
    ) then raise exception 'projection output does not match binding' using errcode = '23514'; end if;
    select * into definition_row from public.metric_definitions
    where id = (output ->> 'metricDefinitionId')::uuid and key = output ->> 'metricKey'
      and value_kind = output ->> 'valueKind' and aggregation = 'sum' and is_active
      and (organization_id is null or organization_id = p_organization_id);
    if not found then raise exception 'projection metric definition is invalid' using errcode = '23514'; end if;
    reconciliation_digest := private.report_projection_reconciliation_digest(
      package_row, (select v from public.integration_report_validation_runs v where v.organization_id = p_organization_id and v.id = run_row.validation_run_id),
      (select p from public.report_projection_versions p where p.organization_id = p_organization_id and p.id = run_row.report_projection_version_id),
      definition_row.id, output ->> 'key', output ->> 'sourceDigest'
    );
    perform pg_advisory_xact_lock(hashtextextended(concat_ws('|', p_organization_id, package_row.channel_id,
      package_row.branch_id, definition_row.id, output ->> 'key', package_row.period_timezone,
      case when output ->> 'valueKind' = 'money' then package_row.declared_currency else '' end), 0));
    select * into prior_row from public.exact_range_metric_observations o
    where o.organization_id = p_organization_id and o.branch_id = package_row.branch_id and o.channel_id = package_row.channel_id
      and o.metric_definition_id = definition_row.id and o.projection_output_key = output ->> 'key'
      and o.period_timezone = package_row.period_timezone
      and o.currency is not distinct from case when output ->> 'valueKind' = 'money' then package_row.declared_currency else null end
      and o.period_start = package_row.declared_period_start and o.period_end = package_row.declared_period_end
      and o.reconciliation_state = 'current' and o.reconciliation_digest = reconciliation_digest
    order by o.id limit 1 for update;
    if found then
      insert into public.report_projection_reconciliations (
        organization_id, report_package_id, projection_run_id, projection_output_key, classification, reconciliation_digest,
        prior_observation_id, candidate_count, quality_state, completeness_state, calculation_version, correlation_id
      ) values (p_organization_id, p_report_package_id, p_projection_run_id, output ->> 'key', 'exact_duplicate', reconciliation_digest,
        prior_row.id, 1, effective_quality_state, effective_completeness_state, run_row.calculation_version, run_row.correlation_id);
      continue;
    end if;
    -- Both ledgers are searched. A governed series already covering these days
    -- is evidence about the same rollup, so a total laid over it is exactly the
    -- ambiguous overlap ADR 0029 sends to an owner rather than resolving by a
    -- precedence rule. Only rows the projection path wrote are candidates, and
    -- the series is compared in its own recorded zone's local dates.
    select
      (select count(*) from public.exact_range_metric_observations o
        where o.organization_id = p_organization_id and o.branch_id = package_row.branch_id and o.channel_id = package_row.channel_id
          and o.metric_definition_id = definition_row.id and o.projection_output_key = output ->> 'key'
          and o.period_timezone = package_row.period_timezone
          and o.currency is not distinct from case when output ->> 'valueKind' = 'money' then package_row.declared_currency else null end
          and o.reconciliation_state = 'current'
          and o.period_start <= package_row.declared_period_end and o.period_end >= package_row.declared_period_start)
      + (select count(*) from public.normalized_metrics m
        where m.organization_id = p_organization_id and m.branch_id = package_row.branch_id and m.channel_id = package_row.channel_id
          and m.metric_definition_id = definition_row.id
          and m.currency is not distinct from case when output ->> 'valueKind' = 'money' then package_row.declared_currency else null end
          and m.reconciliation_state = 'current' and m.superseded_by_id is null and m.reconciliation_digest is not null
          and (m.period_start at time zone m.period_timezone)::date <= package_row.declared_period_end
          and ((m.period_end at time zone m.period_timezone) - interval '1 day')::date >= package_row.declared_period_start)
    into overlap_count;
    if overlap_count > 20000 then
      raise exception 'report projection overlap is too broad to reconcile' using errcode = '23514';
    end if;
    if overlap_count > 0 then
      -- Every candidate is locked for the life of this transaction. The
      -- advisory lock above already serialises writers for this tuple; this
      -- keeps a concurrent resolution from moving one out from under us.
      perform 1 from public.exact_range_metric_observations o
      where o.organization_id = p_organization_id and o.branch_id = package_row.branch_id and o.channel_id = package_row.channel_id
        and o.metric_definition_id = definition_row.id and o.projection_output_key = output ->> 'key'
        and o.period_timezone = package_row.period_timezone
        and o.currency is not distinct from case when output ->> 'valueKind' = 'money' then package_row.declared_currency else null end
        and o.reconciliation_state = 'current'
        and o.period_start <= package_row.declared_period_end and o.period_end >= package_row.declared_period_start for update;
      perform 1 from public.normalized_metrics m
      where m.organization_id = p_organization_id and m.branch_id = package_row.branch_id and m.channel_id = package_row.channel_id
        and m.metric_definition_id = definition_row.id
        and m.currency is not distinct from case when output ->> 'valueKind' = 'money' then package_row.declared_currency else null end
        and m.reconciliation_state = 'current' and m.superseded_by_id is null and m.reconciliation_digest is not null
        and (m.period_start at time zone m.period_timezone)::date <= package_row.declared_period_end
        and ((m.period_end at time zone m.period_timezone) - interval '1 day')::date >= package_row.declared_period_start for update;
    end if;
    insert into public.exact_range_metric_observations (
      organization_id, branch_id, channel_id, metric_definition_id, projection_output_key, value_kind,
      period_start, period_end, period_timezone, value_numerator, currency, quality_state, completeness_state,
      reconciliation_state, reconciliation_digest, report_package_id, validation_run_id, report_contract_version_id,
      report_projection_version_id, projection_run_id
    ) values (
      p_organization_id, package_row.branch_id, package_row.channel_id, definition_row.id, output ->> 'key', output ->> 'valueKind',
      package_row.declared_period_start, package_row.declared_period_end, package_row.period_timezone,
      (output ->> 'valueNumerator')::numeric, case when output ->> 'valueKind' = 'money' then package_row.declared_currency else null end,
      effective_quality_state, effective_completeness_state,
      case when overlap_count > 0 then 'blocked_overlap' else 'current' end, reconciliation_digest,
      p_report_package_id, run_row.validation_run_id, run_row.report_contract_version_id, run_row.report_projection_version_id, p_projection_run_id
    ) returning id into observation_id;
    insert into public.report_projection_lineage (
      organization_id, exact_range_metric_observation_id, report_package_id, validation_run_id, projection_run_id,
      report_contract_version_id, report_projection_version_id, normalized_sheet_name, canonical_field,
      source_column_ordinal, first_data_row, last_data_row, contributor_count, calculation_version,
      source_digest, quality_state, completeness_state
    ) values (
      p_organization_id, observation_id, p_report_package_id, run_row.validation_run_id, p_projection_run_id,
      run_row.report_contract_version_id, run_row.report_projection_version_id, output ->> 'normalizedSheetName', output ->> 'canonicalField',
      (output ->> 'sourceColumnOrdinal')::integer, (output ->> 'firstDataRow')::integer,
      (output ->> 'lastDataRow')::integer, (output ->> 'contributorCount')::integer, run_row.calculation_version,
      output ->> 'sourceDigest', effective_quality_state, effective_completeness_state
    );
    if overlap_count = 0 then
      insert into public.report_projection_reconciliations (
        organization_id, report_package_id, projection_run_id, projection_output_key, classification, reconciliation_digest,
        result_observation_id, candidate_count, quality_state, completeness_state, calculation_version, correlation_id
      ) values (
        p_organization_id, p_report_package_id, p_projection_run_id, output ->> 'key', 'non_overlapping', reconciliation_digest,
        observation_id, 0, effective_quality_state, effective_completeness_state, run_row.calculation_version, run_row.correlation_id
      );
    else
      insert into public.report_projection_reconciliations (
        organization_id, report_package_id, projection_run_id, projection_output_key, classification, reconciliation_digest,
        prior_observation_id, prior_normalized_metric_id, result_observation_id, candidate_count, quality_state,
        completeness_state, calculation_version, correlation_id
      )
      select p_organization_id, p_report_package_id, p_projection_run_id, output ->> 'key', 'ambiguous_overlap',
        reconciliation_digest, candidate.exact_id, candidate.metric_id, observation_id, overlap_count,
        effective_quality_state, effective_completeness_state, run_row.calculation_version, run_row.correlation_id
      from (
        select o.id as exact_id, null::uuid as metric_id
        from public.exact_range_metric_observations o
      where o.organization_id = p_organization_id and o.branch_id = package_row.branch_id and o.channel_id = package_row.channel_id
        and o.metric_definition_id = definition_row.id and o.projection_output_key = output ->> 'key'
        and o.period_timezone = package_row.period_timezone
        and o.currency is not distinct from case when output ->> 'valueKind' = 'money' then package_row.declared_currency else null end
        and o.reconciliation_state = 'current'
        and o.period_start <= package_row.declared_period_end and o.period_end >= package_row.declared_period_start
        union all
        select null::uuid as exact_id, m.id as metric_id
        from public.normalized_metrics m
      where m.organization_id = p_organization_id and m.branch_id = package_row.branch_id and m.channel_id = package_row.channel_id
        and m.metric_definition_id = definition_row.id
        and m.currency is not distinct from case when output ->> 'valueKind' = 'money' then package_row.declared_currency else null end
        and m.reconciliation_state = 'current' and m.superseded_by_id is null and m.reconciliation_digest is not null
        and (m.period_start at time zone m.period_timezone)::date <= package_row.declared_period_end
        and ((m.period_end at time zone m.period_timezone) - interval '1 day')::date >= package_row.declared_period_start
      ) candidate;
    end if;
    has_blocked_overlap := has_blocked_overlap or overlap_count > 0;
  end loop;
  final_status := p_result ->> 'status';
  update public.integration_report_projection_runs set status = final_status, quality_state = p_result ->> 'qualityState',
    completeness_state = p_result ->> 'completenessState', output_count = jsonb_array_length(p_outputs),
    result_digest = p_result_digest, error_codes = coalesce(p_result -> 'errorCodes', '[]'::jsonb),
    warning_codes = coalesce(p_result -> 'warningCodes', '[]'::jsonb), completed_at = now()
  where organization_id = p_organization_id and id = p_projection_run_id;
  update public.integration_report_packages set status = case
    when has_blocked_overlap then 'reconciliation_required'
    when final_status = 'projected' then 'projected'
    when final_status = 'partially_projected' then 'partially_projected'
    else 'projection_failed' end,
    safe_failure_code = case when final_status = 'failed' then coalesce(p_result -> 'errorCodes' ->> 0, 'PROJECTION_PROCESSING_FAILED') else null end,
    safe_failure_at = case when final_status = 'failed' then now() else null end
  where organization_id = p_organization_id and id = p_report_package_id returning * into package_row;
  return to_jsonb(package_row);
end;
$$;

revoke all on function public.complete_governed_report_package_projection(uuid, uuid, uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.complete_governed_report_package_projection(uuid, uuid, uuid, uuid, text, jsonb, jsonb) to service_role;

-- Audit evidence names whichever ledger it came from -----------------------------

create or replace function private.audit_report_projection_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_name text;
begin
  audit_name := case new.classification
    when 'exact_duplicate' then 'report_projection.duplicate_replayed'
    when 'ambiguous_overlap' then 'report_projection.overlap_blocked'
    else null
  end;
  if audit_name is not null then
    insert into public.audit_events (organization_id, event_name, actor_type, entity_type, entity_id, correlation_id, payload)
    values (new.organization_id, audit_name, 'system', 'report_projection_reconciliation', new.id, new.correlation_id,
      jsonb_build_object('reportPackageId', new.report_package_id, 'projectionRunId', new.projection_run_id,
        'projectionOutputKey', new.projection_output_key, 'projectionTarget', new.projection_target,
        'classification', new.classification,
        'reconciliationDigest', new.reconciliation_digest, 'priorObservationId', new.prior_observation_id,
        'priorNormalizedMetricId', new.prior_normalized_metric_id,
        'resultObservationId', new.result_observation_id,
        'resultNormalizedMetricId', new.result_normalized_metric_id, 'candidateCount', new.candidate_count,
        'periodStart', new.period_start, 'periodEnd', new.period_end,
        'qualityState', new.quality_state, 'completenessState', new.completeness_state,
        'calculationVersion', new.calculation_version));
  end if;
  return new;
end;
$$;

-- Owner and admin resolution, across both ledgers ---------------------------------

-- Replaced whole rather than patched. The decision, the permission, the
-- idempotency, and the all-or-nothing rule are unchanged; what is new is that
-- the blocked candidate may be a series row, and that a prior may sit in the
-- other ledger. A prior in the same ledger is superseded, which is what a
-- revision means. A prior in the other ledger is excluded instead, because a
-- supersession pointer cannot reference another table and pretending otherwise
-- would leave the history unreadable.
create or replace function public.resolve_governed_report_projection_overlap(
  p_organization_id uuid,
  p_actor_id uuid,
  p_reconciliation_id uuid,
  p_resolution text,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  requested_reconciliation public.report_projection_reconciliations;
  reconciliation_row public.report_projection_reconciliations;
  result_exact public.exact_range_metric_observations;
  result_metric public.normalized_metrics;
  prior_exact public.exact_range_metric_observations;
  prior_metric public.normalized_metrics;
  resolution_row public.report_projection_reconciliation_resolutions;
  result_target text;
  result_id uuid;
  prior_exact_ids uuid[] := '{}';
  prior_metric_ids uuid[] := '{}';
  reconciliation_ids uuid[] := '{}';
  prior_id uuid;
  next_revision integer;
  package_status text;
  resolved_package_id uuid;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.contract_approve') then
    raise exception 'report overlap resolution is not authorized' using errcode = '42501';
  end if;
  if p_resolution not in ('accept_correction', 'keep_existing')
    or char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'report overlap resolution is invalid' using errcode = '22023';
  end if;

  select * into requested_reconciliation
  from public.report_projection_reconciliations
  where organization_id = p_organization_id and id = p_reconciliation_id
  for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;

  select * into resolution_row from public.report_projection_reconciliation_resolutions
  where organization_id = p_organization_id and reconciliation_id = p_reconciliation_id;
  if found then return jsonb_build_object('outcome', 'completed', 'resolution', to_jsonb(resolution_row)); end if;

  if requested_reconciliation.classification <> 'ambiguous_overlap' then
    return jsonb_build_object('outcome', 'not_ready');
  end if;

  if requested_reconciliation.result_normalized_metric_id is not null then
    result_target := 'period_grain';
    select * into result_metric from public.normalized_metrics
    where organization_id = p_organization_id and id = requested_reconciliation.result_normalized_metric_id
    for update;
    if not found or result_metric.reconciliation_state <> 'blocked_overlap' then
      return jsonb_build_object('outcome', 'not_ready');
    end if;
    result_id := result_metric.id;
  elsif requested_reconciliation.result_observation_id is not null then
    result_target := 'exact_range';
    select * into result_exact from public.exact_range_metric_observations
    where organization_id = p_organization_id and id = requested_reconciliation.result_observation_id
    for update;
    if not found or result_exact.reconciliation_state <> 'blocked_overlap' then
      return jsonb_build_object('outcome', 'not_ready');
    end if;
    result_id := result_exact.id;
  else
    return jsonb_build_object('outcome', 'not_ready');
  end if;

  -- Every overlap this candidate created is decided together. A partial
  -- decision could leave two live rows feeding one rollup, which is the exact
  -- thing this machinery exists to prevent.
  for reconciliation_row in
    select * from public.report_projection_reconciliations
    where organization_id = p_organization_id
      and classification = 'ambiguous_overlap'
      and ((result_target = 'period_grain' and result_normalized_metric_id = result_id)
        or (result_target = 'exact_range' and result_observation_id = result_id))
    order by id
    for update
  loop
    if exists (
      select 1 from public.report_projection_reconciliation_resolutions r
      where r.organization_id = p_organization_id and r.reconciliation_id = reconciliation_row.id
    ) then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    if reconciliation_row.prior_observation_id is not null then
      select * into prior_exact from public.exact_range_metric_observations
      where organization_id = p_organization_id and id = reconciliation_row.prior_observation_id
      for update;
      if not found or prior_exact.reconciliation_state <> 'current' then
        return jsonb_build_object('outcome', 'conflict');
      end if;
      prior_exact_ids := array_append(prior_exact_ids, prior_exact.id);
    elsif reconciliation_row.prior_normalized_metric_id is not null then
      select * into prior_metric from public.normalized_metrics
      where organization_id = p_organization_id and id = reconciliation_row.prior_normalized_metric_id
      for update;
      if not found or prior_metric.reconciliation_state <> 'current' or prior_metric.superseded_by_id is not null then
        return jsonb_build_object('outcome', 'conflict');
      end if;
      prior_metric_ids := array_append(prior_metric_ids, prior_metric.id);
    else
      return jsonb_build_object('outcome', 'not_ready');
    end if;
    reconciliation_ids := array_append(reconciliation_ids, reconciliation_row.id);
  end loop;
  if cardinality(reconciliation_ids) = 0 then return jsonb_build_object('outcome', 'not_ready'); end if;

  if p_resolution = 'accept_correction' then
    select greatest(
      coalesce((select max(revision) from public.exact_range_metric_observations
        where organization_id = p_organization_id and id = any(prior_exact_ids)), 0),
      coalesce((select max(revision) from public.normalized_metrics
        where organization_id = p_organization_id and id = any(prior_metric_ids)), 0)
    ) + 1 into next_revision;

    -- The evidence being replaced is set aside first, so the promoted row never
    -- shares a live tuple with it for even one statement.
    if result_target = 'exact_range' then
      update public.exact_range_metric_observations
      set reconciliation_state = 'superseded', superseded_by_id = result_id, supersede_reason = 'approved_correction'
      where organization_id = p_organization_id and id = any(prior_exact_ids);
      update public.normalized_metrics
      set reconciliation_state = 'excluded'
      where organization_id = p_organization_id and id = any(prior_metric_ids);
      update public.exact_range_metric_observations
      set reconciliation_state = 'current', revision = next_revision
      where organization_id = p_organization_id and id = result_id;
    else
      update public.normalized_metrics
      set superseded_by_id = result_id, supersede_reason = 'approved_correction'
      where organization_id = p_organization_id and id = any(prior_metric_ids);
      update public.exact_range_metric_observations
      set reconciliation_state = 'excluded'
      where organization_id = p_organization_id and id = any(prior_exact_ids);
      update public.normalized_metrics
      set reconciliation_state = 'current', revision = next_revision
      where organization_id = p_organization_id and id = result_id;
    end if;
  else
    if result_target = 'exact_range' then
      update public.exact_range_metric_observations
      set reconciliation_state = 'excluded'
      where organization_id = p_organization_id and id = result_id;
    else
      update public.normalized_metrics
      set reconciliation_state = 'excluded'
      where organization_id = p_organization_id and id = result_id;
    end if;
  end if;

  for reconciliation_row in
    select * from public.report_projection_reconciliations
    where organization_id = p_organization_id and id = any(reconciliation_ids)
    order by id
  loop
    insert into public.report_projection_reconciliation_resolutions (
      organization_id, reconciliation_id, resolution, outcome_classification, reconciliation_digest,
      prior_observation_id, prior_normalized_metric_id, result_observation_id, result_normalized_metric_id,
      resolved_by, correlation_id
    ) values (
      p_organization_id, reconciliation_row.id, p_resolution,
      case when p_resolution = 'accept_correction' then 'approved_correction' else 'existing_retained' end,
      reconciliation_row.reconciliation_digest, reconciliation_row.prior_observation_id,
      reconciliation_row.prior_normalized_metric_id,
      case when result_target = 'exact_range' then result_id else null end,
      case when result_target = 'period_grain' then result_id else null end,
      p_actor_id, p_correlation_id
    ) returning * into resolution_row;
    insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload)
    values (p_organization_id, 'report_projection.overlap_resolved', 'user', p_actor_id,
      'report_projection_reconciliation_resolution', resolution_row.id, p_correlation_id,
      jsonb_build_object('reconciliationId', reconciliation_row.id, 'resolution', p_resolution,
        'outcomeClassification', resolution_row.outcome_classification,
        'projectionTarget', reconciliation_row.projection_target,
        'priorObservationId', reconciliation_row.prior_observation_id,
        'priorNormalizedMetricId', reconciliation_row.prior_normalized_metric_id,
        'resultId', result_id, 'reconciliationDigest', reconciliation_row.reconciliation_digest));
  end loop;

  if p_resolution = 'accept_correction' then
    insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload)
    values (p_organization_id, 'report_projection.correction_accepted', 'user', p_actor_id,
      case when result_target = 'exact_range' then 'exact_range_metric_observation' else 'normalized_metric' end,
      result_id, p_correlation_id,
      jsonb_build_object('resultId', result_id, 'projectionTarget', result_target,
        'priorObservationIds', prior_exact_ids, 'priorNormalizedMetricIds', prior_metric_ids,
        'reconciliationIds', reconciliation_ids, 'revision', next_revision));
    if result_target = 'exact_range' then
      foreach prior_id in array prior_exact_ids loop
        insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload)
        values (p_organization_id, 'exact_range_metric_observation.superseded', 'user', p_actor_id,
          'exact_range_metric_observation', prior_id, p_correlation_id,
          jsonb_build_object('supersededById', result_id, 'revision', next_revision));
      end loop;
      foreach prior_id in array prior_metric_ids loop
        insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload)
        values (p_organization_id, 'normalized_metric.excluded', 'user', p_actor_id,
          'normalized_metric', prior_id, p_correlation_id,
          jsonb_build_object('excludedInFavourOfId', result_id, 'projectionTarget', result_target));
      end loop;
    else
      foreach prior_id in array prior_metric_ids loop
        insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload)
        values (p_organization_id, 'normalized_metric.superseded', 'user', p_actor_id,
          'normalized_metric', prior_id, p_correlation_id,
          jsonb_build_object('supersededById', result_id, 'revision', next_revision));
      end loop;
      foreach prior_id in array prior_exact_ids loop
        insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload)
        values (p_organization_id, 'exact_range_metric_observation.excluded', 'user', p_actor_id,
          'exact_range_metric_observation', prior_id, p_correlation_id,
          jsonb_build_object('excludedInFavourOfId', result_id, 'projectionTarget', result_target));
      end loop;
    end if;
  end if;

  resolved_package_id := requested_reconciliation.report_package_id;
  select case when r.status = 'partially_projected' then 'partially_projected' else 'projected' end
  into package_status
  from public.integration_report_projection_runs r
  where r.organization_id = p_organization_id and r.id = requested_reconciliation.projection_run_id;
  update public.integration_report_packages p
  set status = case when exists (
      select 1 from public.exact_range_metric_observations o
      where o.organization_id = p_organization_id and o.report_package_id = p.id
        and o.reconciliation_state = 'blocked_overlap'
    ) or exists (
      select 1 from public.report_projection_lineage l
      join public.normalized_metrics m
        on m.organization_id = l.organization_id and m.id = l.normalized_metric_id
      where l.organization_id = p_organization_id and l.report_package_id = p.id
        and m.reconciliation_state = 'blocked_overlap'
    ) then 'reconciliation_required' else package_status end,
    correlation_id = p_correlation_id
  where p.organization_id = p_organization_id and p.id = resolved_package_id;

  return jsonb_build_object('outcome', 'resolved', 'resolution', to_jsonb(resolution_row));
end;
$$;

revoke all on function public.resolve_governed_report_projection_overlap(uuid, uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.resolve_governed_report_projection_overlap(uuid, uuid, uuid, text, text, uuid) to authenticated;

-- Readers that mean "current" ----------------------------------------------------

-- Evidence held for an owner's decision must not read as settled fact. This is
-- the only reader in the schema that treats an unsuperseded observation as
-- current; the rest reach the series through `campaign_metric_observations`,
-- which this path never writes.
create or replace function public.get_cost_component_coverage(
  target_organization_id uuid
)
returns table (
  key text,
  label text,
  computation_kind text,
  has_rate boolean,
  weakest_tier text
)
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select
      definition.id,
      definition.key,
      definition.label,
      definition.computation_kind,
      definition.source_metric_key,
      definition.organization_id
    from public.cost_component_definitions definition
    where definition.is_active
      and (definition.organization_id is null
           or definition.organization_id = target_organization_id)
  ),
  resolved as (
    select distinct on (visible.key)
      visible.id, visible.key, visible.label, visible.computation_kind, visible.source_metric_key
    from visible
    order by visible.key, visible.organization_id nulls last
  ),
  sourced as (
    select
      resolved.key,
      exists (
        select 1
        from public.normalized_metrics observation
        join public.metric_definitions metric
          on metric.id = observation.metric_definition_id
        where observation.organization_id = target_organization_id
          and observation.superseded_by_id is null
          and observation.reconciliation_state = 'current'
          and metric.key = resolved.source_metric_key
      ) as has_observations,
      -- Ranked, not alphabetical. `min()` on the raw text would order
      -- assumed, derived, estimated, measured and so call `derived` weaker
      -- than `estimated`, which inverts two tiers of the trust hierarchy.
      (
        select (array['assumed', 'estimated', 'derived', 'measured'])[
          pg_catalog.min(
            case observation.quality_tier
              when 'assumed' then 1 when 'estimated' then 2
              when 'derived' then 3 when 'measured' then 4
            end
          )
        ]
        from public.normalized_metrics observation
        join public.metric_definitions metric
          on metric.id = observation.metric_definition_id
        where observation.organization_id = target_organization_id
          and observation.superseded_by_id is null
          and observation.reconciliation_state = 'current'
          and metric.key = resolved.source_metric_key
      ) as observed_tier
    from resolved
    where resolved.source_metric_key is not null
  )
  select
    resolved.key,
    resolved.label,
    resolved.computation_kind,
    case
      when resolved.source_metric_key is not null
        then coalesce(sourced.has_observations, false)
      else pg_catalog.count(rate.id) > 0
    end as has_rate,
    case
      when resolved.source_metric_key is not null then sourced.observed_tier
      else (array['assumed', 'estimated', 'derived', 'measured'])[
        pg_catalog.min(
          case rate.quality_tier
            when 'assumed' then 1 when 'estimated' then 2
            when 'derived' then 3 when 'measured' then 4
          end
        ) filter (where rate.id is not null)
      ]
    end as weakest_tier
  from resolved
  left join sourced on sourced.key = resolved.key
  left join public.cost_component_rates rate
    on rate.definition_id = resolved.id
   and rate.organization_id = target_organization_id
  where private.is_organization_member(target_organization_id)
  group by
    resolved.key, resolved.label, resolved.computation_kind, resolved.source_metric_key,
    sourced.has_observations, sourced.observed_tier
  order by resolved.key;
$$;

revoke all on function public.get_cost_component_coverage(uuid) from public;
grant execute on function public.get_cost_component_coverage(uuid) to authenticated;
