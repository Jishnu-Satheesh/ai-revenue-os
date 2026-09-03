-- Task 9B (ADR 0046): the two links that make the automatic chain run.
--
-- Task 9 wired profiling -> validation -> projection, and the wiring was
-- correct. It was also inert: `claim_governed_report_package_validation`
-- only accepts a package at `awaiting_validation` or `validating`, but
-- `complete_governed_report_package_profiling` always leaves a profiled
-- package at `awaiting_contract`. The only things that ever bridged that gap
-- were `decide_governed_report_contract` -- the human approval this feature
-- exists to skip -- and the validation retry RPC. Moving from `validated` to
-- `awaiting_projection` was human-gated too, through
-- `request_governed_report_package_projection`'s `auth.uid()` and
-- `report.retry` checks, so a background worker could not do that move at
-- all.
--
-- Both functions below run as `service_role`, with no human actor -- that is
-- the whole point, and also the whole risk. Each is fenced by the one fact
-- that makes it safe rather than by a person standing in front of it:
--
--   * `advance_governed_report_package_on_admission` moves a package only
--     when an *active* standing admission actually matches its channel,
--     structure and currency. No admission, no advance: the package is left
--     exactly where a human already expects to find it.
--   * `advance_admitted_report_package_to_projection` moves a package only
--     when it carries the admission that put it here
--     (`admitted_under_admission_id is not null`). A package approved
--     through the ordinary per-upload human path never has that column set,
--     so it keeps needing a person to request its projection, exactly as
--     today.
--
-- Neither function takes an idempotency key or a claim token: there is
-- nothing here for two concurrent workers to race over (the row lock plus
-- the status guard already makes a second, later call see the package moved
-- on, not the same starting state), and a retried call is made safe by
-- checking the package's *current*, already-recorded state rather than by a
-- ledger.

-- Link A. Matching tuple deliberately kept identical to the one
-- `claim_governed_report_package_validation` uses
-- (20260902176000_admit_package_on_standing_admission.sql) -- the two must
-- never disagree about what "matching" means, or a package could be advanced
-- here and refused there, or the reverse.
create function public.advance_governed_report_package_on_admission(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  package_row public.integration_report_packages;
  admission_row public.report_structure_admissions;
begin
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- Idempotent replay first, before any status gate: a retried worker call
  -- must land on the *same* admission that already advanced this package,
  -- not whatever happens to be active right now. An admission can be revoked
  -- between the original call and a retry -- revoking governs future
  -- uploads (ADR 0046), not one this package already went through -- so the
  -- lookup is by the id the package already recorded, unfiltered by
  -- `active`. No column is written on this path: a second call with a
  -- different correlation id must not overwrite the one the first call
  -- recorded.
  if package_row.status = 'awaiting_validation' and package_row.admitted_under_admission_id is not null then
    select * into admission_row from public.report_structure_admissions
    where organization_id = p_organization_id and id = package_row.admitted_under_admission_id;
    return jsonb_build_object(
      'outcome', 'admitted',
      'admissionId', admission_row.id,
      'reportContractVersionId', admission_row.report_contract_version_id
    );
  end if;

  -- Anything other than `awaiting_contract` is not this function's to move.
  -- This is what keeps the ordinary human path untouched: a package sitting
  -- at `awaiting_validation` because a person approved its exact contract
  -- (so `admitted_under_admission_id` is null, and the branch above did not
  -- match) is refused here, not silently re-admitted.
  if package_row.status <> 'awaiting_contract' then
    return jsonb_build_object('outcome', 'not_ready');
  end if;

  -- A package profiled before the fingerprint existed -- or whose profiling
  -- never ran to completion -- has nothing for an admission to match
  -- against.
  if package_row.structure_fingerprint is null then
    return jsonb_build_object('outcome', 'not_ready');
  end if;

  select * into admission_row from public.report_structure_admissions
  where organization_id = p_organization_id
    and channel_id = package_row.channel_id
    and structure_fingerprint = package_row.structure_fingerprint
    and declared_currency = package_row.declared_currency
    and outlet_grain = 'branch'
    and active;
  if not found then
    -- The one rule this whole function exists to protect. No admission
    -- means no advance: the package stays at `awaiting_contract` and waits
    -- for a person, exactly as it does today. Nothing is written.
    return jsonb_build_object('outcome', 'no_admission');
  end if;

  update public.integration_report_packages
  set status = 'awaiting_validation', admitted_under_admission_id = admission_row.id, correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = p_report_package_id;

  return jsonb_build_object(
    'outcome', 'admitted',
    'admissionId', admission_row.id,
    'reportContractVersionId', admission_row.report_contract_version_id
  );
end;
$function$;

-- Link B. Modelled on `request_governed_report_package_projection`
-- (20260831190000_refuse_reprojection_that_cannot_run.sql:30-127): every
-- invariant it enforces about what may reach `awaiting_projection` is kept,
-- except the two that cannot apply to a worker with no session --
-- `(select auth.uid()) = p_actor_id` and the `report.retry` permission
-- check. Those are replaced by the one check that substitutes for a human's
-- say-so here: `admitted_under_admission_id is not null`. That substitution
-- is the thing a reviewer most needs to see, so it is named plainly below
-- rather than left to be inferred from what is missing.
--
-- Deliberately narrower than the human RPC it is modelled on: it does not
-- admit `partially_validated`, `projection_failed`, or
-- `reconciliation_required`. Those are recovery paths for evidence a person
-- must look at; this function only carries a package through its first,
-- ordinary, nothing-went-wrong pass.
create function public.advance_admitted_report_package_to_projection(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  package_row public.integration_report_packages;
  validation_row public.integration_report_validation_runs;
  projection_binding public.report_projection_bindings;
begin
  select * into package_row from public.integration_report_packages
  where organization_id = p_organization_id and id = p_report_package_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- The substitution for a human actor, checked before anything else --
  -- including before the idempotent-replay branch below, so that a package
  -- already sitting at `awaiting_projection` through the *ordinary human*
  -- request RPC (which never sets this column) is still refused here rather
  -- than treated as something this function already advanced.
  if package_row.admitted_under_admission_id is null then
    return jsonb_build_object('outcome', 'not_admitted');
  end if;

  -- Idempotent replay: a retried worker call for a package already on its
  -- way must not error, and must not re-derive information that could have
  -- drifted since the first call wrote it.
  if package_row.status in ('awaiting_projection', 'projecting') then
    select * into validation_row from public.integration_report_validation_runs
    where organization_id = p_organization_id and report_package_id = p_report_package_id and status = 'validated'
    order by completed_at desc limit 1;
    select * into projection_binding from public.report_projection_bindings
    where organization_id = p_organization_id and report_contract_version_id = validation_row.report_contract_version_id and active;
    return jsonb_build_object(
      'outcome', 'requested',
      'reportContractVersionId', validation_row.report_contract_version_id,
      'reportProjectionVersionId', projection_binding.report_projection_version_id
    );
  end if;

  -- `partially_validated` must never advance to projection: some sheets
  -- validated and some did not, and a projection over evidence nobody fully
  -- approved is a figure nobody approved either (AGENTS.md: never mark
  -- uncertain data as verified). Only a clean `validated` package may pass.
  if package_row.status <> 'validated' then
    return jsonb_build_object('outcome', 'not_ready');
  end if;

  select * into validation_row from public.integration_report_validation_runs
  where organization_id = p_organization_id and report_package_id = p_report_package_id and status = 'validated'
  order by completed_at desc limit 1;
  if not found then
    return jsonb_build_object('outcome', 'not_ready');
  end if;

  select * into projection_binding from public.report_projection_bindings
  where organization_id = p_organization_id and report_contract_version_id = validation_row.report_contract_version_id and active;
  if not found then
    return jsonb_build_object('outcome', 'no_binding');
  end if;

  update public.integration_report_packages
  set status = 'awaiting_projection', correlation_id = p_correlation_id
  where organization_id = p_organization_id and id = p_report_package_id;

  return jsonb_build_object(
    'outcome', 'requested',
    'reportContractVersionId', validation_row.report_contract_version_id,
    'reportProjectionVersionId', projection_binding.report_projection_version_id
  );
end;
$function$;

-- Worker-only, matching `complete_governed_report_package_profiling`'s
-- grants exactly: nothing with a human session, including `authenticated`,
-- may call either function.
revoke all on function public.advance_governed_report_package_on_admission(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.advance_admitted_report_package_to_projection(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.advance_governed_report_package_on_admission(uuid, uuid, uuid) to service_role;
grant execute on function public.advance_admitted_report_package_to_projection(uuid, uuid, uuid) to service_role;
