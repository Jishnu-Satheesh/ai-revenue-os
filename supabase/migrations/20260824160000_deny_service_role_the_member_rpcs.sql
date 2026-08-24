-- Both member RPCs were born carrying an ACL entry nobody asked for. The
-- hosted project's default privileges hand EXECUTE on every new function to
-- service_role, so revoking from public, anon, and authenticated still left
-- the worker role holding the two paths that exist precisely because a person
-- -- not a worker -- answered what the narrator said. A service key able to
-- step into a member's shoes would be able to answer as that member; the
-- decision log would name a human who never spoke.
--
-- This revokes that silent grant explicitly. Members keep execute through
-- 20260824120000, and the body's own gates -- session-is-the-actor,
-- membership through current_organization_role, tenant resolution -- stand
-- unchanged behind it.

revoke all on function public.triage_channel_recommendation(uuid, uuid, text, text, uuid) from service_role;
revoke all on function public.record_channel_recommendation_feedback(uuid, uuid, boolean, uuid) from service_role;
