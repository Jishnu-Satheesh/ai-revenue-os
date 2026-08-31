-- Answer "which organizations may I read?" once per query instead of once per row.
--
-- `private.has_organization_permission(organization_id, ...)` is correct but is
-- called from RLS policies that reference the row's own column, so Postgres
-- keeps it a correlated per-row SubPlan. Measured on staging against
-- `report_projection_reconciliations` (1876 rows) it costs 0.638 ms per row —
-- 1162 ms and 14112 buffers for one scan. Wrapping the call in `(select ...)`
-- does not help: the correlation survives the wrapper, and the plan still shows
-- `loops=1876`. Two policies already carry that wrapper and gained nothing.
--
-- These set-returning forms take no row as input, so a policy written as
--   organization_id in (select private.organizations_with_permission('report.read'))
-- is uncorrelated and the planner hoists it to a hashed SubPlan built once. The
-- same scan then costs 6 ms and 684 buffers.
--
-- The role each grant resolves to is chosen exactly as
-- `private.effective_organization_role` chooses it: gather every candidate grant,
-- discard the null ones, keep the highest ranked, and only then ask whether that
-- role holds the permission. Asking whether *any* candidate role holds it would
-- be cheaper and wrong — it would grant through a lower-ranked membership a
-- higher-ranked one does not carry. Today's permission sets happen to be
-- monotonic in rank, so the two agree; that is a fact about the current seed
-- data, not a property this function may assume.

create or replace function private.organizations_with_permission(target_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select ranked.organization_id
  from (
    select
      candidate.organization_id,
      candidate.role,
      row_number() over (
        partition by candidate.organization_id
        order by private.organization_role_rank(candidate.role) desc
      ) as rank_position
    from (
      select membership.organization_id, membership.role
      from public.organization_memberships membership
      where membership.user_id = (select auth.uid())

      union all

      select
        organization.id,
        case account_membership.account_role
          when 'owner' then 'owner'::public.organization_role
          when 'admin' then 'admin'::public.organization_role
          else account_membership.default_organization_role
        end
      from public.organizations organization
      join public.account_memberships account_membership
        on account_membership.account_id = organization.account_id
      where account_membership.user_id = (select auth.uid())
    ) candidate
    where candidate.role is not null
  ) ranked
  where ranked.rank_position = 1
    and exists (
      select 1
      from public.organization_role_permissions role_permission
      where role_permission.permission_key = target_permission
        and role_permission.organization_role = ranked.role
    );
$$;

comment on function private.organizations_with_permission(text) is
  'Organizations where the calling user''s effective role holds the given permission. Set-returning and uncorrelated so an RLS policy can evaluate it once per query rather than once per row. Resolves the effective role exactly as private.effective_organization_role does.';

-- Membership needs no ranking: `is_organization_member` asks only whether the
-- effective role is non-null, and the effective role is non-null exactly when at
-- least one candidate grant is non-null.
create or replace function private.organizations_with_membership()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct candidate.organization_id
  from (
    select membership.organization_id, membership.role
    from public.organization_memberships membership
    where membership.user_id = (select auth.uid())

    union all

    select
      organization.id,
      case account_membership.account_role
        when 'owner' then 'owner'::public.organization_role
        when 'admin' then 'admin'::public.organization_role
        else account_membership.default_organization_role
      end
    from public.organizations organization
    join public.account_memberships account_membership
      on account_membership.account_id = organization.account_id
    where account_membership.user_id = (select auth.uid())
  ) candidate
  where candidate.role is not null;
$$;

comment on function private.organizations_with_membership() is
  'Organizations the calling user belongs to by any grant. The set-returning counterpart of private.is_organization_member, for once-per-query evaluation in RLS policies.';

revoke all on function private.organizations_with_permission(text) from public, anon;
revoke all on function private.organizations_with_membership() from public, anon;
grant execute on function private.organizations_with_permission(text) to authenticated;
grant execute on function private.organizations_with_membership() to authenticated;
