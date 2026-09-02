-- Record that a mapping came from the checked-in provider library.
--
-- Until now every contract and projection version was `proposal_source =
-- 'human'`, which was true when the only way to make one was to type it. An
-- operator adopting a known report family is not typing anything: the shape
-- comes from an artifact reviewed when it was checked in, and the operator's
-- act is choosing and approving it. Recording that as hand-authored would make
-- the audit trail say something that is not so.
--
-- The provenance is the server's to state, never the caller's. The API builds
-- the document from the library itself and passes only the key it used, so a
-- hand-written document cannot arrive wearing the library's name.
--
-- Additive and forward-only: both new values are optional, both columns are
-- nullable, and every version already stored keeps saying exactly what it said.

alter table public.report_contract_versions
  add column if not exists provider_definition_key text
    check (provider_definition_key is null or provider_definition_key ~ '^[a-z][a-z0-9_.]{1,80}$');

alter table public.report_projection_versions
  add column if not exists provider_definition_key text
    check (provider_definition_key is null or provider_definition_key ~ '^[a-z][a-z0-9_.]{1,80}$');

alter table public.report_contract_versions
  drop constraint if exists report_contract_versions_proposal_source_check,
  add constraint report_contract_versions_proposal_source_check
    check (proposal_source in ('human', 'library'));

alter table public.report_projection_versions
  drop constraint if exists report_projection_versions_proposal_source_check,
  add constraint report_projection_versions_proposal_source_check
    check (proposal_source in ('human', 'library'));

-- A library proposal has to name the definition it came from, and a hand-written
-- one has to name nothing. Either way round, the pair cannot lie about itself.
alter table public.report_contract_versions
  drop constraint if exists report_contract_versions_library_provenance_check,
  add constraint report_contract_versions_library_provenance_check
    check ((proposal_source = 'library') = (provider_definition_key is not null));

alter table public.report_projection_versions
  drop constraint if exists report_projection_versions_library_provenance_check,
  add constraint report_projection_versions_library_provenance_check
    check ((proposal_source = 'library') = (provider_definition_key is not null));

-- Both functions gain two trailing arguments. Dropped and recreated rather than
-- replaced, because a differing argument list would leave the old function in
-- place as an overload and every existing six-argument call would keep hitting
-- it. Nothing else about either function changes.
drop function if exists public.propose_governed_report_contract(uuid, uuid, uuid, jsonb, text, uuid);

create function public.propose_governed_report_contract(
  p_organization_id uuid,
  p_actor_id uuid,
  p_report_package_id uuid,
  p_mapping_document jsonb,
  p_idempotency_key text,
  p_correlation_id uuid,
  p_proposal_source text default 'human',
  p_provider_definition_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_package public.integration_report_packages;
  contract_row public.report_contracts;
  version_row public.report_contract_versions;
  operation private.report_contract_write_operations;
  mapping_digest text;
  operation_fingerprint text;
  next_version integer;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.contract_approve') then
    raise exception 'report contract proposal is not authorized' using errcode = '42501';
  end if;
  if char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  if p_proposal_source not in ('human', 'library')
    or (p_proposal_source = 'library') <> (p_provider_definition_key is not null) then
    raise exception 'report contract proposal source is invalid' using errcode = '22023';
  end if;
  perform private.assert_report_contract_document(p_mapping_document);
  mapping_digest := encode(extensions.digest(p_mapping_document::text, 'sha256'), 'hex');
  operation_fingerprint := encode(extensions.digest(concat_ws('|', p_report_package_id, mapping_digest), 'sha256'), 'hex');
  select * into locked_package from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id
  for update;
  if not found or locked_package.status <> 'awaiting_contract' or locked_package.schema_fingerprint is null then
    raise exception 'report package is not eligible for a contract proposal' using errcode = '23514';
  end if;
  select * into operation from private.report_contract_write_operations
  where organization_id = p_organization_id and operation_kind = 'propose' and idempotency_key = p_idempotency_key
  for update;
  if found then
    if operation.fingerprint <> operation_fingerprint then
      raise exception 'idempotency key conflicts with another contract proposal' using errcode = '23505';
    end if;
    select * into version_row from public.report_contract_versions
    where organization_id = p_organization_id and id = operation.report_contract_version_id;
    return to_jsonb(version_row);
  end if;
  perform private.assert_report_contract_matches_package(locked_package, p_mapping_document);
  insert into public.report_contracts (
    organization_id, channel_id, report_type, outlet_grain, created_by
  ) values (
    p_organization_id, locked_package.channel_id, locked_package.report_type, 'branch', p_actor_id
  ) on conflict (organization_id, channel_id, report_type, outlet_grain) do nothing;
  select * into contract_row from public.report_contracts
  where organization_id = p_organization_id and channel_id = locked_package.channel_id
    and report_type = locked_package.report_type and outlet_grain = 'branch'
  for update;
  select coalesce(max(version), 0) + 1 into next_version from public.report_contract_versions
  where organization_id = p_organization_id and report_contract_id = contract_row.id;
  insert into public.report_contract_versions (
    organization_id, report_contract_id, report_package_id, version, schema_fingerprint, parser_version,
    fingerprint_version, mapping_document, mapping_digest, declared_currency, financial_sign_semantics,
    controls, unmapped_field_disposition, proposal_source, provider_definition_key, created_by, correlation_id
  ) values (
    p_organization_id, contract_row.id, locked_package.id, next_version, locked_package.schema_fingerprint,
    locked_package.parser_version, locked_package.fingerprint_version, p_mapping_document, mapping_digest,
    locked_package.declared_currency, private.report_contract_financial_signs(p_mapping_document),
    p_mapping_document -> 'controls', p_mapping_document ->> 'unmappedFieldDisposition', p_proposal_source,
    p_provider_definition_key, p_actor_id, p_correlation_id
  ) returning * into version_row;
  insert into private.report_contract_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, report_contract_version_id
  ) values (p_organization_id, 'propose', p_idempotency_key, operation_fingerprint, version_row.id);
  update public.integration_report_packages set status = 'awaiting_approval', correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = locked_package.id;
  return to_jsonb(version_row);
end;
$$;

revoke all on function public.propose_governed_report_contract(uuid, uuid, uuid, jsonb, text, uuid, text, text) from public, anon;
grant execute on function public.propose_governed_report_contract(uuid, uuid, uuid, jsonb, text, uuid, text, text) to authenticated, service_role;

drop function if exists public.propose_governed_report_projection(uuid, uuid, uuid, jsonb, text, uuid);

create function public.propose_governed_report_projection(
  p_organization_id uuid,
  p_actor_id uuid,
  p_report_contract_version_id uuid,
  p_projection_document jsonb,
  p_idempotency_key text,
  p_correlation_id uuid,
  p_proposal_source text default 'human',
  p_provider_definition_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  contract_version public.report_contract_versions;
  projection_version public.report_projection_versions;
  existing private.report_projection_write_operations;
  projection_digest text;
  fingerprint text;
  next_version integer;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.contract_approve') then
    raise exception 'report projection proposal is not authorized' using errcode = '42501';
  end if;
  if char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  if p_proposal_source not in ('human', 'library')
    or (p_proposal_source = 'library') <> (p_provider_definition_key is not null) then
    raise exception 'report projection proposal source is invalid' using errcode = '22023';
  end if;
  select * into contract_version from public.report_contract_versions
  where organization_id = p_organization_id and id = p_report_contract_version_id for update;
  if not found or not exists (select 1 from public.report_contract_decisions d
    where d.organization_id = p_organization_id and d.report_contract_version_id = p_report_contract_version_id and d.decision = 'approved') then
    raise exception 'report contract version is not approved' using errcode = '23514';
  end if;
  perform private.assert_report_projection_matches_contract(p_organization_id, contract_version, p_projection_document);
  projection_digest := encode(extensions.digest(p_projection_document::text, 'sha256'), 'hex');
  fingerprint := encode(extensions.digest(concat_ws('|', p_report_contract_version_id, projection_digest), 'sha256'), 'hex');
  select * into existing from private.report_projection_write_operations
  where organization_id = p_organization_id and operation_kind = 'propose' and idempotency_key = p_idempotency_key for update;
  if found then
    if existing.fingerprint <> fingerprint then raise exception 'idempotency key conflicts with another projection proposal' using errcode = '23505'; end if;
    select * into projection_version from public.report_projection_versions where organization_id = p_organization_id and id = existing.reference_id;
    return to_jsonb(projection_version);
  end if;
  select coalesce(max(version), 0) + 1 into next_version from public.report_projection_versions
  where organization_id = p_organization_id and report_contract_version_id = p_report_contract_version_id;
  insert into public.report_projection_versions (
    organization_id, report_contract_version_id, version, projection_document, projection_digest,
    calculation_version, proposal_source, provider_definition_key, created_by, correlation_id
  ) values (
    p_organization_id, p_report_contract_version_id, next_version, p_projection_document, projection_digest,
    1, p_proposal_source, p_provider_definition_key, p_actor_id, p_correlation_id
  ) returning * into projection_version;
  insert into private.report_projection_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, reference_id
  ) values (p_organization_id, 'propose', p_idempotency_key, fingerprint, projection_version.id);
  return to_jsonb(projection_version);
end;
$$;

revoke all on function public.propose_governed_report_projection(uuid, uuid, uuid, jsonb, text, uuid, text, text) from public, anon;
grant execute on function public.propose_governed_report_projection(uuid, uuid, uuid, jsonb, text, uuid, text, text) to authenticated, service_role;
