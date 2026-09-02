-- Take the anonymous execute grant off the cost coverage function.
--
-- Supabase's default privileges on `public` hand EXECUTE to anon, authenticated
-- and service_role for every new function. The original migration revoked from
-- `public` and granted to `authenticated`, which does not touch the separate,
-- explicit grant anon received by default -- so anon has been able to call it.
--
-- Nothing has leaked. The function is security definer over
-- `private.is_organization_member(...)`, and an anonymous session has no
-- `auth.uid()`, so the call has always returned zero rows. But a signed-out
-- caller reaching a function about an organization's cost structure at all is
-- one predicate away from a real disclosure, and every other governed function
-- in this schema revokes anon explicitly rather than relying on a filter.
--
-- Forward-only and behaviour-preserving for real users: authenticated members
-- keep exactly the access they had.

revoke all on function public.get_cost_component_coverage(uuid) from public, anon;
grant execute on function public.get_cost_component_coverage(uuid) to authenticated;
