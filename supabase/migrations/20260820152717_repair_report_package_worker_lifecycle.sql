-- Supabase Storage supplies a stable object UUID but may leave `version` null
-- for a new object. Keep version as optional evidence instead of rejecting a
-- valid immutable upload. Worker RPCs read private leases, so they must be
-- narrow security-definer entry points rather than granting direct table access.

alter table public.integration_report_packages
  drop constraint if exists integration_report_packages_check1;
alter table public.integration_report_packages
  add constraint integration_report_packages_object_identity_check
  check (storage_object_id is null or uploaded_at is not null);

alter function public.claim_governed_report_package_profiling(uuid, uuid, text, uuid) security definer;
alter function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, jsonb) security definer;
alter function public.fail_governed_report_package_profiling(uuid, uuid, uuid, text) security definer;

revoke all on function public.claim_governed_report_package_profiling(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.fail_governed_report_package_profiling(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_governed_report_package_profiling(uuid, uuid, text, uuid) to service_role;
grant execute on function public.complete_governed_report_package_profiling(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.fail_governed_report_package_profiling(uuid, uuid, uuid, text) to service_role;
