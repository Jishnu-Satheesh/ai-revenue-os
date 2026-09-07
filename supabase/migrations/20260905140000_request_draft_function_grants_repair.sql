-- Growth Intelligence Task 22 follow-up: the re-signed request function
-- arrived without its grant block, leaving the member RPC world-executable.
-- Least privilege restored: members execute, no one else does.

revoke all on function public.request_campaign_draft_from_opportunity(
  uuid, uuid, uuid, integer, text, text, text, jsonb, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.request_campaign_draft_from_opportunity(
  uuid, uuid, uuid, integer, text, text, text, jsonb, text, uuid
) to authenticated;
