-- Task 2's migration (20260902170000_report_structure_fingerprint.sql) added a
-- seventh argument to public.complete_governed_report_package_profiling and
-- dropped the six-argument version in the same migration. The Trigger.dev
-- worker deployed to the cloud runs pre-branch code and still calls the
-- six-argument signature; that function no longer exists, so every profiling
-- run in the deployed environment has been failing function-not-found and
-- recording a generic PROFILE_FAILED. See ADR 0046 and Task 9C.
--
-- This restores the six-argument overload as a thin compatibility wrapper that
-- delegates to the seven-argument function, passing null for the structure
-- fingerprint because the deployed worker cannot compute one -- the function
-- that computes it is not in its bundle. A package profiled through this
-- overload simply matches no standing admission until it is re-profiled by an
-- up-to-date worker, which is correct behaviour rather than degraded.
--
-- This overload exists only to keep the already-deployed worker from failing
-- every profiling run. It must be dropped in a later migration once the
-- worker is redeployed with the seven-argument call -- do not treat it as a
-- second permanent entry point.
create function public.complete_governed_report_package_profiling(
  p_organization_id uuid,
  p_report_package_id uuid,
  p_claim_token uuid,
  p_content_sha256 text,
  p_schema_fingerprint text,
  p_sheets jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.complete_governed_report_package_profiling(
    p_organization_id, p_report_package_id, p_claim_token,
    p_content_sha256, p_schema_fingerprint, null::text, p_sheets
  );
$$;

revoke all on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, text, jsonb) to service_role;
