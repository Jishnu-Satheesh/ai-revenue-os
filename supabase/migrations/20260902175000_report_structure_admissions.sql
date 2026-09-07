-- A standing, revocable permission to read one report structure. See ADR 0046.
--
-- The alternative was writing a proposal and an approval per upload on the
-- uploader's behalf. That records approvals that never happened and leaves
-- nothing to revoke, so reuse is authorised once, by a named person, instead.

create table public.report_structure_admissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  channel_id uuid not null,
  structure_fingerprint text not null check (structure_fingerprint ~ '^[a-f0-9]{64}$'),
  structure_version integer not null check (structure_version = 1),
  declared_currency text not null check (declared_currency ~ '^[A-Z]{3}$'),
  outlet_grain text not null check (outlet_grain = 'branch'),
  -- Inherited by every package admitted under this grant, so the reuse key
  -- stops depending on what an operator typed that day.
  report_type text not null check (char_length(report_type) between 2 and 120),
  -- The shipped library family, when one was recognised. Null for a mapping an
  -- operator built themselves, which is never offered to another tenant.
  report_family_key text check (report_family_key is null or char_length(report_family_key) between 2 and 120),
  report_contract_version_id uuid not null,
  report_projection_version_id uuid not null,
  active boolean not null default true,
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  correlation_id uuid not null,
  unique (organization_id, id),
  foreign key (organization_id, channel_id)
    references public.organization_channels(organization_id, id) on delete restrict,
  foreign key (organization_id, report_contract_version_id)
    references public.report_contract_versions(organization_id, id) on delete restrict,
  foreign key (organization_id, report_projection_version_id)
    references public.report_projection_versions(organization_id, id) on delete restrict,
  check ((revoked_by is null) = (revoked_at is null)),
  check (active or revoked_at is not null)
);

create unique index report_structure_admissions_active_tuple_idx
  on public.report_structure_admissions (
    organization_id, channel_id, structure_fingerprint, declared_currency, outlet_grain
  ) where active;

comment on table public.report_structure_admissions is
  'One durable, revocable grant: for this organization and channel, a file of this structure and currency is read using this approved contract and projection version. Revoking returns the structure to per-upload approval and rewrites no figure.';

alter table public.integration_report_packages
  add column admitted_under_admission_id uuid,
  add constraint integration_report_packages_admission_fk
    foreign key (organization_id, admitted_under_admission_id)
    references public.report_structure_admissions(organization_id, id) on delete restrict;

-- Bindings and contract versions are append-only elsewhere in this domain, and
-- an admission is the same kind of record: identity columns never change, a
-- row is never deleted, and the only permitted transition is the one flip
-- from active to revoked. Without this, a revoked admission could be quietly
-- reactivated, or its granter rewritten after the fact -- which would make
-- "revoking is meaningful" (ADR 0046) false.
create or replace function private.prevent_report_structure_admission_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'report_structure_admissions_are_append_only' using errcode = '55000';
  end if;
  if new.active = false and old.active = true
    and new.organization_id is not distinct from old.organization_id
    and new.channel_id is not distinct from old.channel_id
    and new.structure_fingerprint is not distinct from old.structure_fingerprint
    and new.structure_version is not distinct from old.structure_version
    and new.declared_currency is not distinct from old.declared_currency
    and new.outlet_grain is not distinct from old.outlet_grain
    and new.report_type is not distinct from old.report_type
    and new.report_family_key is not distinct from old.report_family_key
    and new.report_contract_version_id is not distinct from old.report_contract_version_id
    and new.report_projection_version_id is not distinct from old.report_projection_version_id
    and new.granted_by is not distinct from old.granted_by
    and new.granted_at is not distinct from old.granted_at then
    return new;
  end if;
  raise exception 'report_structure_admissions_are_append_only' using errcode = '55000';
end;
$$;

create trigger report_structure_admissions_prevent_update
before update or delete on public.report_structure_admissions
for each row execute function private.prevent_report_structure_admission_mutation();

-- Every existing report audit event is written by a security-definer trigger
-- on the table it describes, never by the RPC body itself, so the event
-- cannot be skipped by a future write path that forgets to call it. Precedent:
-- 20260820182522_governed_report_contracts.sql:327-350. Payload carries
-- identifiers and the fingerprint only -- never a workbook value or filename.
create or replace function private.audit_report_structure_admission_granted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload
  ) values (
    new.organization_id, 'report.structure_admitted', 'user', new.granted_by,
    'report_structure_admission', new.id, new.correlation_id,
    jsonb_build_object(
      'channelId', new.channel_id,
      'structureFingerprint', new.structure_fingerprint,
      'declaredCurrency', new.declared_currency,
      'reportType', new.report_type,
      'reportFamilyKey', new.report_family_key,
      'reportContractVersionId', new.report_contract_version_id,
      'reportProjectionVersionId', new.report_projection_version_id
    )
  );
  return new;
end;
$$;

-- Fires once per active-to-revoked flip, whether that flip came from the
-- explicit revoke RPC or from a grant superseding its own incumbent -- both
-- are the same fact about the row: it stopped being trusted.
create or replace function private.audit_report_structure_admission_revoked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active = false and old.active = true then
    insert into public.audit_events (
      organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload
    ) values (
      new.organization_id, 'report.structure_admission_revoked', 'user', new.revoked_by,
      'report_structure_admission', new.id, new.correlation_id,
      jsonb_build_object(
        'channelId', new.channel_id,
        'structureFingerprint', new.structure_fingerprint,
        'declaredCurrency', new.declared_currency
      )
    );
  end if;
  return new;
end;
$$;

create trigger report_structure_admissions_audit_granted
after insert on public.report_structure_admissions
for each row execute function private.audit_report_structure_admission_granted();
create trigger report_structure_admissions_audit_revoked
after update on public.report_structure_admissions
for each row execute function private.audit_report_structure_admission_revoked();

-- A dedicated idempotency ledger rather than a row in
-- private.report_contract_write_operations: that table's report_contract_version_id
-- column is a required foreign key, which is the wrong shape for a revoke (there
-- is no contract version to name) and couples this table's future changes to an
-- unrelated one's. private.report_projection_write_operations already establishes
-- the alternative -- a generic reference_id per domain -- so this follows that.
create table private.report_structure_admission_write_operations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_kind text not null check (operation_kind in ('grant', 'revoke')),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  reference_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, operation_kind, idempotency_key)
);

create function public.grant_governed_report_structure_admission(
  p_organization_id uuid,
  p_actor_id uuid,
  p_report_package_id uuid,
  p_report_contract_version_id uuid,
  p_report_projection_version_id uuid,
  p_report_family_key text,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package_row public.integration_report_packages;
  contract_version_row public.report_contract_versions;
  projection_version_row public.report_projection_versions;
  admission_row public.report_structure_admissions;
  operation private.report_structure_admission_write_operations;
  operation_fingerprint text;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.contract_approve') then
    raise exception 'report structure admission grant is not authorized' using errcode = '42501';
  end if;
  if char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  if p_report_family_key is not null and char_length(p_report_family_key) not between 2 and 120 then
    raise exception 'report family key is invalid' using errcode = '22023';
  end if;

  operation_fingerprint := encode(extensions.digest(
    concat_ws('|', p_report_package_id, p_report_contract_version_id, p_report_projection_version_id, coalesce(p_report_family_key, '')),
    'sha256'
  ), 'hex');
  select * into operation from private.report_structure_admission_write_operations
  where organization_id = p_organization_id and operation_kind = 'grant' and idempotency_key = p_idempotency_key
  for update;
  if found then
    if operation.fingerprint <> operation_fingerprint then
      raise exception 'idempotency key conflicts with another admission grant' using errcode = '23505';
    end if;
    select * into admission_row from public.report_structure_admissions
    where organization_id = p_organization_id and id = operation.reference_id;
    return to_jsonb(admission_row);
  end if;

  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id
  for update;
  if not found then
    raise exception 'report package was not found' using errcode = 'P0002';
  end if;
  if package_row.structure_fingerprint is null then
    raise exception 'report package has no recorded structure fingerprint' using errcode = '23514';
  end if;

  -- The contract version must be an approved proposal made against this exact
  -- package. Accepting one proposed against a different package would let an
  -- unrelated, unrelated-looking mapping be "borrowed" for a structure it was
  -- never checked against -- the correctness property an admission exists to
  -- protect, not just a convenience.
  select * into contract_version_row from public.report_contract_versions
  where organization_id = p_organization_id and id = p_report_contract_version_id
    and report_package_id = p_report_package_id
  for update;
  if not found or not exists (
    select 1 from public.report_contract_decisions
    where organization_id = p_organization_id
      and report_contract_version_id = contract_version_row.id
      and decision = 'approved'
  ) then
    raise exception 'report contract version is not an approved proposal for this package' using errcode = '23514';
  end if;

  select * into projection_version_row from public.report_projection_versions
  where organization_id = p_organization_id and id = p_report_projection_version_id
    and report_contract_version_id = contract_version_row.id
  for update;
  if not found or not exists (
    select 1 from public.report_projection_decisions
    where organization_id = p_organization_id
      and report_projection_version_id = projection_version_row.id
      and decision = 'approved'
  ) then
    raise exception 'report projection version is not an approved proposal for this contract version' using errcode = '23514';
  end if;

  if contract_version_row.declared_currency is distinct from package_row.declared_currency then
    raise exception 'report contract currency does not match the package currency' using errcode = '23514';
  end if;

  -- One active admission per (channel, structure, currency). Approving a
  -- successor retires the incumbent in the same transaction, exactly as
  -- 20260826130000_supersede_incumbent_contract_binding_on_approval.sql does
  -- for report_contract_bindings: without this, granting a revised admission
  -- for an already-admitted tuple would collide with the unique partial index.
  update public.report_structure_admissions
  set active = false, revoked_by = p_actor_id, revoked_at = now(), correlation_id = p_correlation_id
  where organization_id = p_organization_id
    and channel_id = package_row.channel_id
    and structure_fingerprint = package_row.structure_fingerprint
    and declared_currency = package_row.declared_currency
    and outlet_grain = 'branch'
    and active;

  insert into public.report_structure_admissions (
    organization_id, channel_id, structure_fingerprint, structure_version, declared_currency, outlet_grain,
    report_type, report_family_key, report_contract_version_id, report_projection_version_id,
    granted_by, correlation_id
  ) values (
    p_organization_id, package_row.channel_id, package_row.structure_fingerprint, package_row.structure_version,
    package_row.declared_currency, 'branch', package_row.report_type, p_report_family_key,
    contract_version_row.id, projection_version_row.id, p_actor_id, p_correlation_id
  ) returning * into admission_row;

  insert into private.report_structure_admission_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, reference_id
  ) values (p_organization_id, 'grant', p_idempotency_key, operation_fingerprint, admission_row.id);

  return to_jsonb(admission_row);
end;
$$;

create function public.revoke_governed_report_structure_admission(
  p_organization_id uuid,
  p_actor_id uuid,
  p_admission_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  admission_row public.report_structure_admissions;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.contract_approve') then
    raise exception 'report structure admission revocation is not authorized' using errcode = '42501';
  end if;
  select * into admission_row from public.report_structure_admissions
  where organization_id = p_organization_id and id = p_admission_id
  for update;
  if not found then
    raise exception 'report structure admission was not found' using errcode = 'P0002';
  end if;
  if not admission_row.active then
    -- Already revoked. A retried request reaches the same terminal state
    -- instead of raising, and re-running the update would double the audit
    -- event the first call already recorded.
    return to_jsonb(admission_row);
  end if;
  update public.report_structure_admissions
  set active = false, revoked_by = p_actor_id, revoked_at = now(), correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = p_admission_id
  returning * into admission_row;
  return to_jsonb(admission_row);
end;
$$;

-- Write-once, the same way schema_fingerprint and structure_fingerprint
-- already are: once a package records the admission that authorised it, the
-- pointer cannot be rewritten to point at a different authorisation later.
-- Forward-replaces private.prevent_report_package_mutation, carrying the live
-- body (20260902170000_report_structure_fingerprint.sql) verbatim except for
-- this one addition, so Task 7's own forward-replacement of this function has
-- the smallest possible surface to carry.
create or replace function private.prevent_report_package_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
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
    or new.structure_version is distinct from old.structure_version
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
  if old.structure_fingerprint is not null
    and new.structure_fingerprint is distinct from old.structure_fingerprint then
    raise exception 'report_package_structure_fingerprint_is_immutable' using errcode = '23514';
  end if;
  if old.admitted_under_admission_id is not null
    and new.admitted_under_admission_id is distinct from old.admitted_under_admission_id then
    raise exception 'report_package_admission_is_immutable' using errcode = '23514';
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
    or (old.status = 'reconciliation_required' and new.status in ('reconciliation_required', 'projected', 'partially_projected', 'awaiting_projection'))
    or (old.status = 'projection_failed' and new.status in ('projection_failed', 'awaiting_projection'))
    or (old.status = 'validation_failed' and new.status in ('validation_failed', 'awaiting_validation'))
    or (old.status = 'failed' and new.status in ('failed', 'uploaded'))
    or (old.status in ('projected', 'partially_projected') and new.status = old.status)
  ) then
    raise exception 'report_package_status_transition_is_invalid' using errcode = '23514';
  end if;
  return new;
end;
$function$;

revoke all on function private.prevent_report_structure_admission_mutation() from public;
revoke all on function private.audit_report_structure_admission_granted() from public;
revoke all on function private.audit_report_structure_admission_revoked() from public;

alter table public.report_structure_admissions enable row level security;
alter table public.report_structure_admissions force row level security;
alter table private.report_structure_admission_write_operations enable row level security;
alter table private.report_structure_admission_write_operations force row level security;

revoke all on table public.report_structure_admissions from public, anon, authenticated;
grant select on table public.report_structure_admissions to authenticated;
revoke all on table private.report_structure_admission_write_operations from public, anon, authenticated;

-- Hoisted form: the permission set is computed once per statement rather than
-- once per row, matching every report-domain read policy since
-- 20260831130000_hoist_report_rls_permission_checks.sql. A new table written
-- in the old per-row shape would be the only report table regressing that.
create policy "members with report read can view structure admissions"
  on public.report_structure_admissions
  for select to authenticated
  using (organization_id in (select private.organizations_with_permission('report.read')));

revoke all on function public.grant_governed_report_structure_admission(uuid, uuid, uuid, uuid, uuid, text, text, uuid) from public, anon;
revoke all on function public.revoke_governed_report_structure_admission(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.grant_governed_report_structure_admission(uuid, uuid, uuid, uuid, uuid, text, text, uuid) to authenticated;
grant execute on function public.revoke_governed_report_structure_admission(uuid, uuid, uuid, uuid) to authenticated;
