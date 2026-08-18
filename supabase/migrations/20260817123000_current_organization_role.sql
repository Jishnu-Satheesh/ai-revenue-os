-- The effective-role resolver lives in `private`, which PostgREST does not
-- expose, so the application layer had no way to read the role it must enforce
-- alongside RLS. This is that read surface, and nothing more.
--
-- It always resolves for the caller: the organization is a parameter, the user
-- never is. A caller therefore cannot use it to discover anyone else's role,
-- and it returns null for an organization they cannot reach -- indistinguishable
-- from one that does not exist.
--
-- security invoker deliberately: the definer boundary belongs to the resolver
-- underneath, and repeating it here would widen it for no reason.
create or replace function public.current_organization_role(target_organization_id uuid)
returns public.organization_role
language sql
stable
security invoker
set search_path = ''
as $$
  select private.effective_organization_role(target_organization_id, (select auth.uid()));
$$;

revoke all on function public.current_organization_role(uuid) from public;
grant execute on function public.current_organization_role(uuid) to authenticated;

comment on function public.current_organization_role(uuid) is
  'The calling user''s effective role in one organization, or null. The application''s read surface for private.effective_organization_role.';
