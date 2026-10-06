-- Spec 024 follow-up: the worker must never grant, revoke, or record
-- grounded-share state on anyone's behalf. New functions on the hosted
-- project carry a default service_role execute grant, so member-only paths
-- need an explicit revoke. Follows
-- 20260824160000_deny_service_role_the_member_rpcs.sql.
-- grounded_share_status keeps its service_role grant: the narration worker
-- reads active share state for its own claimed run scope.

revoke all on function public.grant_grounded_share_consent(uuid, uuid, text, text, uuid)
  from service_role;
revoke all on function public.revoke_grounded_share_consent(uuid, uuid, uuid, text, uuid)
  from service_role;
revoke all on function public.record_grounded_share_qualification(
  uuid, uuid, text, text, text, timestamptz, text, uuid
) from service_role;
