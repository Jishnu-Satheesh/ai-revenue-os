-- Approving a revised contract must be able to replace its ancestor.
--
-- The exact-tuple unique index correctly permits one ACTIVE binding per
-- (organization, channel, report type, schema fingerprint, currency, grain).
-- The decision RPC inserted each new approval blindly, so the second approval
-- of an evolved export collided with the first and surfaced to the operator
-- as an unspecific 422. This replaces the function with a copy that retires
-- the incumbent binding in the same transaction before admitting the
-- successor. Nothing else in the body changed.

create or replace function public.decide_governed_report_contract(
  p_organization_id uuid,
  p_actor_id uuid,
  p_report_contract_version_id uuid,
  p_decision text,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_row public.report_contract_versions;
  package_row public.integration_report_packages;
  decision_row public.report_contract_decisions;
  operation private.report_contract_write_operations;
  operation_fingerprint text;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.contract_approve') then
    raise exception 'report contract decision is not authorized' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected')
    or char_length(p_idempotency_key) not between 16 and 200
    or (p_reason is not null and char_length(p_reason) not between 1 and 500) then
    raise exception 'report contract decision is invalid' using errcode = '22023';
  end if;
  operation_fingerprint := encode(extensions.digest(concat_ws('|', p_report_contract_version_id, p_decision, p_reason), 'sha256'), 'hex');
  select * into version_row from public.report_contract_versions
  where organization_id = p_organization_id and id = p_report_contract_version_id
  for update;
  if not found then raise exception 'report contract version was not found' using errcode = 'P0002'; end if;
  select * into operation from private.report_contract_write_operations
  where organization_id = p_organization_id and operation_kind = 'decide' and idempotency_key = p_idempotency_key
  for update;
  if found then
    if operation.fingerprint <> operation_fingerprint then
      raise exception 'idempotency key conflicts with another contract decision' using errcode = '23505';
    end if;
    select * into decision_row from public.report_contract_decisions
    where organization_id = p_organization_id and report_contract_version_id = operation.report_contract_version_id;
    return to_jsonb(decision_row);
  end if;
  if exists (
    select 1 from public.report_contract_decisions
    where organization_id = p_organization_id and report_contract_version_id = version_row.id
  ) then
    raise exception 'report contract version already has a decision' using errcode = '23505';
  end if;
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = version_row.report_package_id
  for update;
  if not found or package_row.status <> 'awaiting_approval'
    or package_row.schema_fingerprint is distinct from version_row.schema_fingerprint
    or package_row.declared_currency is distinct from version_row.declared_currency then
    raise exception 'report contract version is no longer eligible for decision' using errcode = '23514';
  end if;
  insert into public.report_contract_decisions (
    organization_id, report_contract_version_id, decision, mapping_digest, reason, decided_by, correlation_id
  ) values (
    p_organization_id, version_row.id, p_decision, version_row.mapping_digest, p_reason, p_actor_id, p_correlation_id
  ) returning * into decision_row;
  if p_decision = 'approved' then
    -- One active contract per exact tuple. Approving a successor retires the
    -- incumbent binding inside this same transaction: without this, a revised
    -- contract could never be approved while its ancestor still held the
    -- tuple, and the unique index turned every such approval into a collision.
    -- The retired row is kept, flipped inactive, so the binding history stays
    -- readable and the superseded contract's projections stay explicable.
    update public.report_contract_bindings
    set active = false
    where organization_id = p_organization_id
      and channel_id = package_row.channel_id
      and report_type = package_row.report_type
      and schema_fingerprint = version_row.schema_fingerprint
      and declared_currency = version_row.declared_currency
      and outlet_grain = 'branch'
      and active
      and report_contract_version_id <> version_row.id;
    insert into public.report_contract_bindings (
      organization_id, report_contract_id, report_contract_version_id, channel_id, report_type, schema_fingerprint,
      declared_currency, outlet_grain, bound_by, correlation_id
    ) select
      p_organization_id, version_row.report_contract_id, version_row.id, package_row.channel_id, package_row.report_type,
      version_row.schema_fingerprint, version_row.declared_currency, 'branch', p_actor_id, p_correlation_id;
    update public.integration_report_packages set status = 'awaiting_validation', correlation_id = p_correlation_id
    where organization_id = p_organization_id and id = package_row.id;
  else
    update public.integration_report_packages set status = 'awaiting_contract', correlation_id = p_correlation_id
    where organization_id = p_organization_id and id = package_row.id;
  end if;
  insert into private.report_contract_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, report_contract_version_id
  ) values (p_organization_id, 'decide', p_idempotency_key, operation_fingerprint, version_row.id);
  return to_jsonb(decision_row);
end;
$$;

-- Bindings are otherwise append-only: identity columns may never change, and
-- deletes stay impossible. The single permitted transition is retirement --
-- active true to false, every other column untouched -- which only the
-- decision RPC above performs, in the same transaction as its insert.
create or replace function private.prevent_report_contract_binding_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'report_contract_records_are_append_only' using errcode = '55000';
  end if;
  if new.active = false and old.active = true
    and new.organization_id is not distinct from old.organization_id
    and new.report_contract_id is not distinct from old.report_contract_id
    and new.report_contract_version_id is not distinct from old.report_contract_version_id
    and new.channel_id is not distinct from old.channel_id
    and new.report_type is not distinct from old.report_type
    and new.schema_fingerprint is not distinct from old.schema_fingerprint
    and new.declared_currency is not distinct from old.declared_currency
    and new.outlet_grain is not distinct from old.outlet_grain
    and new.bound_by is not distinct from old.bound_by
    and new.correlation_id is not distinct from old.correlation_id
    and new.created_at is not distinct from old.created_at then
    return new;
  end if;
  raise exception 'report_contract_records_are_append_only' using errcode = '55000';
end;
$$;

drop trigger report_contract_bindings_prevent_update on public.report_contract_bindings;
create trigger report_contract_bindings_prevent_update
before update or delete on public.report_contract_bindings
for each row execute function private.prevent_report_contract_binding_mutation();
