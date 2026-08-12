-- Per-user interface state: where each user last was, so the application can
-- answer "which organization does this user open next?" after the account-wide
-- landing page was removed.
--
-- This is the first user-scoped table in a schema where every other table is
-- tenant-scoped. It is deliberately separate from organization_memberships:
-- that table's UPDATE policy is restricted to owners and admins because it
-- carries `role`, and widening it so an operator could record their own
-- position would put write access on the row that governs authorization.
-- See adrs/0015-user-scoped-interface-state.md.

create table public.organization_last_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  last_accessed_at timestamptz not null default now(),
  primary key (user_id, organization_id)
);

create index organization_last_access_recent_idx
  on public.organization_last_access(user_id, last_accessed_at desc);

alter table public.organization_last_access enable row level security;

create policy "members read their own access positions"
on public.organization_last_access for select to authenticated
using (user_id = (select auth.uid()));

create policy "members record their own access positions"
on public.organization_last_access for insert to authenticated
with check (
  user_id = (select auth.uid())
  and private.is_organization_member(organization_id)
);

create policy "members update their own access positions"
on public.organization_last_access for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and private.is_organization_member(organization_id)
);

-- One ordering rule, under the caller's RLS: most recent access first,
-- never-visited organizations last, then name ascending. Returns null when the
-- caller has no workable organization, which the application routes to the
-- create wizard. Archived organizations are never candidates, so a position
-- recorded before archiving cannot resurrect one.
create or replace function public.resolve_landing_organization()
returns uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select organization.id
  from public.organizations organization
  left join public.organization_last_access access
    on access.organization_id = organization.id
   and access.user_id = (select auth.uid())
  where organization.status <> 'archived'
  order by access.last_accessed_at desc nulls last, organization.name asc
  limit 1;
$$;

revoke all on function public.resolve_landing_organization() from public;
grant execute on function public.resolve_landing_organization() to authenticated;

-- Skips the write when the position is already recent, so ordinary navigation
-- inside an organization does not generate a write per page view.
create or replace function public.touch_organization_access(target_organization_id uuid)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  insert into public.organization_last_access (user_id, organization_id)
  values ((select auth.uid()), target_organization_id)
  on conflict (user_id, organization_id) do update
    set last_accessed_at = now()
    where public.organization_last_access.last_accessed_at < now() - interval '5 minutes';
$$;

revoke all on function public.touch_organization_access(uuid) from public;
grant execute on function public.touch_organization_access(uuid) to authenticated;
