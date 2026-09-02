-- The remaining set-returning counterparts, for the policy shapes that
-- 20260831120000 did not cover: organization roles, account membership, and
-- account permissions.
--
-- Same reason as before. `private.has_organization_role(organization_id, ...)`,
-- `private.is_account_member(account_id)` and
-- `private.has_account_permission(account_id, ...)` all take the row's own
-- column, so a policy calling them is correlated and Postgres re-runs it per
-- row. Measured on staging after the report domain was converted,
-- `audit_events` still costs 4,402 ms and 29,617 buffers for a single scan of
-- 7,349 rows, because its policy still calls the per-row forms.
--
-- Each function answers the same question its scalar counterpart answers, for
-- the calling user, over every organization or account at once.

-- Mirrors private.has_organization_role: resolve the effective role exactly as
-- private.effective_organization_role does — highest-ranked non-null grant —
-- and only then test membership of the allowed set. The scalar form coalesces
-- because `null = any(...)` is null; here a non-matching organization simply
-- does not appear in the set, which is the same answer.
create or replace function private.organizations_with_any_role(
  allowed_roles public.organization_role[]
)
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
    and ranked.role = any(allowed_roles);
$$;

comment on function private.organizations_with_any_role(public.organization_role[]) is
  'Organizations where the calling user''s effective role is one of the allowed roles. Set-returning counterpart of private.has_organization_role, for once-per-query evaluation in RLS policies.';

create or replace function private.accounts_with_membership()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct membership.account_id
  from public.account_memberships membership
  where membership.user_id = (select auth.uid());
$$;

comment on function private.accounts_with_membership() is
  'Accounts the calling user belongs to. Set-returning counterpart of private.is_account_member.';

create or replace function private.accounts_with_permission(target_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct membership.account_id
  from public.account_memberships membership
  join public.account_role_permissions role_permission
    on role_permission.account_role = membership.account_role
  where membership.user_id = (select auth.uid())
    and role_permission.permission_key = target_permission;
$$;

comment on function private.accounts_with_permission(text) is
  'Accounts where the calling user''s account role holds the given permission. Set-returning counterpart of private.has_account_permission.';

revoke all on function private.organizations_with_any_role(public.organization_role[]) from public, anon;
revoke all on function private.accounts_with_membership() from public, anon;
revoke all on function private.accounts_with_permission(text) from public, anon;
grant execute on function private.organizations_with_any_role(public.organization_role[]) to authenticated;
grant execute on function private.accounts_with_membership() to authenticated;
grant execute on function private.accounts_with_permission(text) to authenticated;
