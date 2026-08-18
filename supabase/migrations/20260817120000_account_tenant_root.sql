-- Account as the tenant root above Organization. See specs/017-account-identity-and-access.md
-- and adrs/0022-account-as-tenant-root.md.
--
-- This migration is deliberately additive to authority. Every existing
-- organization_memberships row keeps granting exactly the role it grants today,
-- and account membership can only add a grant on top. No user can lose access,
-- which is what makes the revert at the bottom of this file safe.

create type public.account_role as enum ('owner', 'admin', 'member');

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `default_organization_role` is the role this member holds in every organization
-- of the account that does not carry an explicit override for them. It is the
-- reason access does not have to be fanned out per organization: a client added
-- next month is covered by the row that already exists.
--
-- It is meaningful only for `account_role = 'member'`. Owners and admins derive
-- their organization role from their account role, so the column stays null for
-- them rather than stating the same authority twice.
create table public.account_memberships (
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_role public.account_role not null default 'member',
  default_organization_role public.organization_role,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

create index account_memberships_user_idx on public.account_memberships(user_id);

create trigger accounts_set_updated_at before update on public.accounts
for each row execute function public.set_updated_at();
create trigger account_memberships_set_updated_at before update on public.account_memberships
for each row execute function public.set_updated_at();

comment on table public.accounts is
  'Tenant root. An account is the agency; organizations are the clients it runs.';
comment on table public.account_memberships is
  'Account-level tenancy. Carries agency authority and the default organization role, so organization access does not have to be fanned out.';

-- Organizations gain their account ------------------------------------------

alter table public.organizations
  add column account_id uuid references public.accounts(id) on delete restrict;

-- Backfill: one account per distinct organization creator, that creator its
-- owner. Staging holds one such creator, so this produces one account; the
-- statement is written generally so it is correct wherever it runs.
--
-- The slug is derived from the creator's id rather than their name: it must
-- match the slug pattern and be unique, and a display name derived from an
-- email address satisfies neither.
with creator as (
  select distinct organization.created_by as user_id
  from public.organizations organization
)
insert into public.accounts (name, slug, created_by)
select
  left(
    coalesce(
      nullif(split_part(trim(coalesce(profile.display_name, '')), '@', 1), ''),
      'Agency'
    ) || ' agency',
    120
  ),
  'agency-' || left(replace(creator.user_id::text, '-', ''), 12),
  creator.user_id
from creator
left join public.profiles profile on profile.id = creator.user_id;

insert into public.account_memberships (account_id, user_id, account_role, default_organization_role)
select account.id, account.created_by, 'owner', null
from public.accounts account;

update public.organizations organization
set account_id = account.id
from public.accounts account
where account.created_by = organization.created_by
  and organization.account_id is null;

alter table public.organizations alter column account_id set not null;

create index organizations_account_idx on public.organizations(account_id);

comment on column public.organizations.account_id is
  'The agency that owns this client. Immutable after creation: re-parenting is a data migration, not a product action.';

-- Access resolution ---------------------------------------------------------

create or replace function private.organization_role_rank(role public.organization_role)
returns integer
language sql
immutable
as $$
  select case role
    when 'viewer' then 1
    when 'operator' then 2
    when 'admin' then 3
    when 'owner' then 4
  end;
$$;

-- The single place organization access is decided.
--
-- Access is a union of grants, and the effective role is the highest-ranked
-- grant that applies. Grants only ever add authority; nothing subtracts. That
-- is what makes this migration safe to revert -- an existing membership row
-- still resolves to exactly its own role when no account grant exists.
--
-- security definer so it reads the membership tables without RLS. Every policy
-- in the schema calls this indirectly, so if it were invoker it would recurse
-- into the policies that call it.
create or replace function private.effective_organization_role(
  target_organization_id uuid,
  target_user_id uuid default null
)
returns public.organization_role
language sql
stable
security definer
set search_path = ''
as $$
  with subject as (
    select coalesce(target_user_id, (select auth.uid())) as user_id
  ),
  grant_candidate as (
    -- An explicit membership on this exact organization.
    select membership.role as role
    from public.organization_memberships membership
    join subject on subject.user_id = membership.user_id
    where membership.organization_id = target_organization_id

    union all

    -- The grant derived from account membership. Null for a member whose
    -- default organization role has not been set, which means no blanket
    -- access rather than viewer access.
    select case account_membership.account_role
             when 'owner' then 'owner'::public.organization_role
             when 'admin' then 'admin'::public.organization_role
             else account_membership.default_organization_role
           end
    from public.organizations organization
    join public.account_memberships account_membership
      on account_membership.account_id = organization.account_id
    join subject on subject.user_id = account_membership.user_id
    where organization.id = target_organization_id
  )
  select grant_candidate.role
  from grant_candidate
  where grant_candidate.role is not null
  order by private.organization_role_rank(grant_candidate.role) desc
  limit 1;
$$;

revoke all on function private.organization_role_rank(public.organization_role) from public;
revoke all on function private.effective_organization_role(uuid, uuid) from public;
grant execute on function private.organization_role_rank(public.organization_role) to authenticated;
grant execute on function private.effective_organization_role(uuid, uuid) to authenticated;

-- Account-level helpers. Deliberately separate from the organization helpers:
-- account_memberships' own policies call these, and a helper that read
-- account_memberships under RLS would recurse.
create or replace function private.is_account_member(target_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.account_memberships membership
    where membership.account_id = target_account_id
      and membership.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_account_role(
  target_account_id uuid,
  allowed_roles public.account_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.account_memberships membership
    where membership.account_id = target_account_id
      and membership.user_id = (select auth.uid())
      and membership.account_role = any(allowed_roles)
  );
$$;

-- Account owner bootstrap, mirroring private.can_bootstrap_owner for
-- organizations: valid only while the account has no memberships at all.
create or replace function private.can_bootstrap_account_owner(
  target_account_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.accounts account
    where account.id = target_account_id
      and account.created_by = target_user_id
      and target_user_id = (select auth.uid())
      and not exists (
        select 1 from public.account_memberships membership
        where membership.account_id = target_account_id
      )
  );
$$;

revoke all on function private.is_account_member(uuid) from public;
revoke all on function private.has_account_role(uuid, public.account_role[]) from public;
revoke all on function private.can_bootstrap_account_owner(uuid, uuid) from public;
grant execute on function private.is_account_member(uuid) to authenticated;
grant execute on function private.has_account_role(uuid, public.account_role[]) to authenticated;
grant execute on function private.can_bootstrap_account_owner(uuid, uuid) to authenticated;

-- The two helpers every policy in the schema already calls -------------------
--
-- 78 policies call is_organization_member and 141 call has_organization_role.
-- Only these two bodies change; not one policy is edited, and both signatures,
-- names, and grants are unchanged.
--
-- REVERT: to undo this migration, restore these two bodies verbatim:
--
--   private.is_organization_member(target_organization_id uuid) returns boolean
--     select exists (
--       select 1 from public.organization_memberships membership
--       where membership.organization_id = target_organization_id
--         and membership.user_id = (select auth.uid())
--     );
--
--   private.has_organization_role(target_organization_id uuid,
--                                 allowed_roles public.organization_role[]) returns boolean
--     select exists (
--       select 1 from public.organization_memberships membership
--       where membership.organization_id = target_organization_id
--         and membership.user_id = (select auth.uid())
--         and membership.role = any(allowed_roles)
--     );
--
-- Both were `language sql stable security definer set search_path = public, pg_temp`.
-- Because account access only ever adds a grant, restoring them restores exactly
-- today's behavior and cannot lock any user out.

create or replace function private.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.effective_organization_role(target_organization_id) is not null;
$$;

create or replace function private.has_organization_role(
  target_organization_id uuid,
  allowed_roles public.organization_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- coalesce because `null = any(...)` is null, and a policy reading null is
  -- only accidentally equivalent to false.
  select coalesce(
    private.effective_organization_role(target_organization_id) = any(allowed_roles),
    false
  );
$$;

-- Integrity rules -----------------------------------------------------------

-- An account always keeps at least one owner.
create or replace function private.protect_last_account_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining_owners integer;
begin
  -- NEW is unassigned in a DELETE trigger, so it may only be touched under an
  -- explicit TG_OP guard rather than inside a compound condition.
  if TG_OP = 'UPDATE' then
    if new.account_role = 'owner' then
      return new;
    end if;
  end if;

  if old.account_role <> 'owner' then
    if TG_OP = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  select count(*) into remaining_owners
  from public.account_memberships membership
  where membership.account_id = old.account_id
    and membership.account_role = 'owner'
    and membership.user_id <> old.user_id;

  if remaining_owners = 0 then
    raise exception 'An account must keep at least one owner.'
      using errcode = 'check_violation';
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger account_memberships_protect_last_owner
before update or delete on public.account_memberships
for each row execute function private.protect_last_account_owner();

-- No one may grant authority they do not hold. An owner may appoint a
-- co-owner; an admin may only admit members.
create or replace function private.enforce_account_role_ceiling()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.account_role;
begin
  -- Bootstrap and privileged/system paths carry no authenticated actor.
  if (select auth.uid()) is null then
    return new;
  end if;

  select membership.account_role into actor_role
  from public.account_memberships membership
  where membership.account_id = new.account_id
    and membership.user_id = (select auth.uid());

  if actor_role is null then
    -- The account's creator laying down its first owner row.
    if private.can_bootstrap_account_owner(new.account_id, new.user_id) then
      return new;
    end if;
    raise exception 'Only a member of this account can grant access to it.'
      using errcode = 'insufficient_privilege';
  end if;

  if actor_role = 'owner' then
    return new;
  end if;

  if actor_role = 'admin' and new.account_role = 'member' then
    return new;
  end if;

  raise exception 'You cannot grant an account role at or above your own.'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger account_memberships_enforce_role_ceiling
before insert or update on public.account_memberships
for each row execute function private.enforce_account_role_ceiling();

-- Re-parenting a client between agencies is a data migration, not a product
-- action. RLS `with check` cannot see the old row, so this must be a trigger.
create or replace function private.prevent_organization_account_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.account_id is distinct from old.account_id then
    raise exception 'An organization cannot be moved between accounts.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger organizations_prevent_account_change
before update on public.organizations
for each row execute function private.prevent_organization_account_change();

revoke all on function private.protect_last_account_owner() from public;
revoke all on function private.enforce_account_role_ceiling() from public;
revoke all on function private.prevent_organization_account_change() from public;

-- Exposure and policies -----------------------------------------------------

grant select, insert, update on table public.accounts to authenticated;
grant select, insert, update, delete on table public.account_memberships to authenticated;

alter table public.accounts enable row level security;
alter table public.account_memberships enable row level security;

-- create_organization_with_owner_v3 inserts the account with `returning id`
-- before the owner's membership row exists, and Postgres enforces the SELECT
-- policy on rows returned via RETURNING. The creator must therefore be able to
-- read their own not-yet-membered account, exactly as
-- 20260808054138_fix_organization_creator_select_policy.sql established for
-- organizations. Without this clause the bootstrap fails with
-- "new row violates row-level security policy for table accounts".
create policy "members can read their account"
on public.accounts for select to authenticated
using (
  private.is_account_member(id)
  or created_by = (select auth.uid())
);

create policy "users can create their own account"
on public.accounts for insert to authenticated
with check ((select auth.uid()) = created_by);

create policy "owners and admins can update the account"
on public.accounts for update to authenticated
using (private.has_account_role(id, array['owner', 'admin']::public.account_role[]))
with check (private.has_account_role(id, array['owner', 'admin']::public.account_role[]));

create policy "members can read account memberships"
on public.account_memberships for select to authenticated
using (private.is_account_member(account_id));

create policy "owners and admins can add account memberships"
on public.account_memberships for insert to authenticated
with check (
  private.has_account_role(account_id, array['owner', 'admin']::public.account_role[])
  or (account_role = 'owner' and private.can_bootstrap_account_owner(account_id, user_id))
);

create policy "owners and admins can update account memberships"
on public.account_memberships for update to authenticated
using (private.has_account_role(account_id, array['owner', 'admin']::public.account_role[]))
with check (private.has_account_role(account_id, array['owner', 'admin']::public.account_role[]));

create policy "owners and admins can remove account memberships"
on public.account_memberships for delete to authenticated
using (private.has_account_role(account_id, array['owner', 'admin']::public.account_role[]));

-- Creating an organization now also asserts authority over the agency it is
-- being created inside. Without the account clause, any authenticated user
-- could hang a new organization off someone else's account.
drop policy if exists "authenticated users can create organizations" on public.organizations;
create policy "authenticated users can create organizations"
on public.organizations for insert to authenticated
with check (
  (select auth.uid()) = created_by
  and private.has_account_role(account_id, array['owner', 'admin']::public.account_role[])
);

-- Organization creation ------------------------------------------------------

-- v3 differs from v2 only in resolving and recording the account. A new name
-- rather than a changed signature: adding a defaulted parameter to v2 would
-- create a second overload and make every existing ten-argument call ambiguous.
--
-- A null input_account_id means "the caller's only account". A caller with no
-- account gets one created here rather than at signup, so an invited teammate
-- never accumulates a stray empty agency of their own.
create or replace function public.create_organization_with_owner_v3(
  input_name text,
  input_slug text,
  input_industry text,
  input_country_code text,
  input_base_currency text,
  input_timezone text,
  input_industry_pack_slug text,
  input_first_branch_name text default null,
  input_first_branch_slug text default null,
  input_first_branch_kind public.branch_kind default 'physical',
  input_account_id uuid default null
)
returns public.organizations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  created_organization public.organizations;
  acting_user uuid := (select auth.uid());
  resolved_account_id uuid := input_account_id;
  candidate_count integer;
begin
  if acting_user is null then
    raise exception 'Authentication is required to create an organization.'
      using errcode = 'insufficient_privilege';
  end if;

  if resolved_account_id is null then
    select count(*) into candidate_count
    from public.account_memberships membership
    where membership.user_id = acting_user;

    -- Deliberately not min(account_id): uuid has no guaranteed min aggregate.
    select membership.account_id into resolved_account_id
    from public.account_memberships membership
    where membership.user_id = acting_user
    order by membership.created_at asc
    limit 1;

    if candidate_count > 1 then
      raise exception 'This user belongs to more than one account; name the account explicitly.'
        using errcode = 'cardinality_violation';
    end if;

    if candidate_count = 0 then
      insert into public.accounts (name, slug, created_by)
      values (
        left(
          coalesce(
            nullif(
              split_part(
                trim(coalesce((select profile.display_name from public.profiles profile where profile.id = acting_user), '')),
                '@', 1
              ),
              ''
            ),
            'Agency'
          ) || ' agency',
          120
        ),
        'agency-' || left(replace(acting_user::text, '-', ''), 12),
        acting_user
      )
      returning id into resolved_account_id;

      insert into public.account_memberships (account_id, user_id, account_role, default_organization_role)
      values (resolved_account_id, acting_user, 'owner', null);
    end if;
  end if;

  insert into public.organizations (
    name, slug, industry, country_code, base_currency, default_timezone,
    industry_pack_slug, branchless_confirmed, created_by, account_id
  )
  values (
    input_name, input_slug, input_industry, input_country_code, input_base_currency,
    input_timezone, input_industry_pack_slug, input_first_branch_name is null,
    acting_user, resolved_account_id
  )
  returning * into created_organization;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (created_organization.id, acting_user, 'owner');

  insert into public.business_profiles (organization_id, updated_by)
  values (created_organization.id, acting_user);

  insert into public.policies (organization_id, policy_type, name, mode, created_by, updated_by)
  values
    (created_organization.id, 'access', 'Access and approval policy', 'approval_required', acting_user, acting_user),
    (created_organization.id, 'spend', 'Spend and budget policy', 'approval_required', acting_user, acting_user);

  if input_first_branch_name is not null then
    insert into public.branches (organization_id, name, slug, kind, timezone, currency)
    values (
      created_organization.id, input_first_branch_name,
      coalesce(input_first_branch_slug, input_first_branch_name),
      input_first_branch_kind, input_timezone, input_base_currency
    );
  end if;

  return created_organization;
end;
$$;

revoke all on function public.create_organization_with_owner_v3(
  text, text, text, text, text, text, text, text, text, public.branch_kind, uuid
) from public;
grant execute on function public.create_organization_with_owner_v3(
  text, text, text, text, text, text, text, text, text, public.branch_kind, uuid
) to authenticated;

revoke execute on function public.create_organization_with_owner_v2(
  text, text, text, text, text, text, text, text, text, public.branch_kind
) from authenticated;
