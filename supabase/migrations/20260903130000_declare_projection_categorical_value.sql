-- A one-click path out of a refusal Task 4 already learned to name: an
-- undeclared categorical value. Refusing an unknown label stays -- the whole
-- reason it exists is that folding it into "other" would make an incomplete
-- count read as complete. What was missing was a way out of the refusal that
-- did not require opening the source code.
--
-- This function proposes only. It reads the projection version an approved
-- run failed against, appends the named value to that output's
-- categorical.allowedValues, and inserts the result as a new, unapproved
-- report_projection_versions row -- exactly the shape
-- propose_governed_report_projection already writes for a hand-authored
-- declaration, and exactly as immutable. It grants nothing: an owner or admin
-- still approves the new version through the existing
-- decide_governed_report_projection RPC. A function that declared and
-- approved in one motion would restore the silent bucketing the refusal
-- exists to prevent.
--
-- No change to private.assert_report_projection_document or
-- private.assert_report_projection_matches_contract. Both are reused
-- unchanged: appending one more string to an already-legal allowedValues
-- array produces a document that is legal by the exact same rules an
-- operator's own hand-typed declaration would have to satisfy, so this
-- migration adds no new guard and touches no existing one.

create function public.propose_governed_report_projection_with_declared_value(
  p_organization_id uuid,
  p_actor_id uuid,
  p_report_projection_version_id uuid,
  p_output_key text,
  p_value text,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_version public.report_projection_versions;
  contract_version public.report_contract_versions;
  existing private.report_projection_write_operations;
  new_document jsonb;
  new_digest text;
  fingerprint text;
  next_version integer;
  new_version_row public.report_projection_versions;
  output_index integer;
  output_value jsonb;
  categorical_value jsonb;
  allowed_values jsonb;
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.contract_approve') then
    raise exception 'report projection categorical value declaration is not authorized' using errcode = '42501';
  end if;
  if char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;
  if p_output_key !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'report projection output key is invalid' using errcode = '22023';
  end if;
  -- The same shape the document guard already requires of every declared
  -- value. A raw label that does not already fit it -- provider prose with
  -- spaces or punctuation, the kind a label map exists to translate -- cannot
  -- be declared through this path; this function only closes the direct case.
  if coalesce(p_value, '') !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception 'report projection categorical value is invalid' using errcode = '22023';
  end if;

  select * into parent_version from public.report_projection_versions
  where organization_id = p_organization_id and id = p_report_projection_version_id;
  if not found then
    raise exception 'report projection version was not found' using errcode = '23514';
  end if;

  -- Locked for the same reason propose_governed_report_projection locks it:
  -- to serialize next_version computation against every other proposal --
  -- hand-typed or declared -- against this same contract lineage.
  select * into contract_version from public.report_contract_versions
  where organization_id = p_organization_id and id = parent_version.report_contract_version_id
  for update;
  if not found then
    raise exception 'report contract version was not found' using errcode = '23514';
  end if;

  select o.value, (o.ordinal - 1)::integer into output_value, output_index
  from jsonb_array_elements(parent_version.projection_document -> 'outputs') with ordinality as o(value, ordinal)
  where o.value ->> 'key' = p_output_key
  limit 1;

  if output_value is null then
    raise exception 'report projection output was not found' using errcode = '23514';
  end if;

  -- Distinct from "already declared" below, so the screen can say which:
  -- an output with nothing to declare into is a different problem than a
  -- value that already governs.
  if not (output_value ? 'categorical') then
    raise exception 'report projection output has no categorical values to declare' using errcode = '23514';
  end if;

  allowed_values := output_value -> 'categorical' -> 'allowedValues';
  if allowed_values ? p_value then
    raise exception 'report projection categorical value is already declared' using errcode = '23514';
  end if;

  categorical_value := (output_value -> 'categorical')
    || jsonb_build_object('allowedValues', allowed_values || to_jsonb(array[p_value]));
  output_value := output_value || jsonb_build_object('categorical', categorical_value);

  new_document := jsonb_set(
    parent_version.projection_document, array['outputs', output_index::text], output_value
  );

  -- The same guard an ordinary hand-typed proposal has to pass: the source
  -- field this output binds to is still an approved required field, the
  -- metric is still active, and the appended array is still legal shape --
  -- unique, uppercase, at most twenty entries.
  perform private.assert_report_projection_matches_contract(p_organization_id, contract_version, new_document);

  new_digest := encode(extensions.digest(new_document::text, 'sha256'), 'hex');
  fingerprint := encode(extensions.digest(
    concat_ws('|', parent_version.report_contract_version_id, new_digest), 'sha256'), 'hex');

  select * into existing from private.report_projection_write_operations
  where organization_id = p_organization_id and operation_kind = 'propose' and idempotency_key = p_idempotency_key
  for update;
  if found then
    if existing.fingerprint <> fingerprint then
      raise exception 'idempotency key conflicts with another projection proposal' using errcode = '23505';
    end if;
    select * into new_version_row from public.report_projection_versions
    where organization_id = p_organization_id and id = existing.reference_id;
    return to_jsonb(new_version_row);
  end if;

  select coalesce(max(version), 0) + 1 into next_version from public.report_projection_versions
  where organization_id = p_organization_id and report_contract_version_id = parent_version.report_contract_version_id;

  insert into public.report_projection_versions (
    organization_id, report_contract_version_id, version, projection_document, projection_digest,
    calculation_version, proposal_source, created_by, correlation_id
  ) values (
    p_organization_id, parent_version.report_contract_version_id, next_version, new_document, new_digest,
    1, 'human', p_actor_id, p_correlation_id
  ) returning * into new_version_row;

  insert into private.report_projection_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, reference_id
  ) values (p_organization_id, 'propose', p_idempotency_key, fingerprint, new_version_row.id);

  return to_jsonb(new_version_row);
end;
$$;

revoke all on function public.propose_governed_report_projection_with_declared_value(uuid, uuid, uuid, text, text, text, uuid) from public, anon;
grant execute on function public.propose_governed_report_projection_with_declared_value(uuid, uuid, uuid, text, text, text, uuid) to authenticated;
