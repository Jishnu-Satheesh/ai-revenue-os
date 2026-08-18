-- Every user is supposed to get a `profiles` row from the `on_auth_user_created`
-- trigger. One user does not have one: they signed up before the migration that
-- created the trigger was applied, so it never fired for them. The trigger has
-- been correct ever since, which is why this is a one-off gap rather than an
-- ongoing fault -- but nothing repairs a row that was never written.
--
-- It matters now because `specs/017-account-identity-and-access.md` starts
-- reading profiles for real: the invitation names its sender, and the sidebar
-- names the signed-in operator. A missing profile also produced a nonsense
-- account name during the account backfill, which is how it was noticed.

insert into public.profiles (id, display_name)
select
  auth_user.id,
  coalesce(auth_user.raw_user_meta_data ->> 'full_name', auth_user.email)
from auth.users auth_user
left join public.profiles profile on profile.id = auth_user.id
where profile.id is null
on conflict (id) do nothing;

-- Idempotent from here on. The trigger could previously fail a signup outright
-- if a profile already existed -- on a replay, or a race with a repair like the
-- one above. A signup must not fail because its side effect was already done.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

-- The account-name fallback produced "Agency agency" for a user with no display
-- name, because it appended a suffix to a placeholder. Fall back to a whole
-- name instead of decorating an empty one.
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
  owner_label text;
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
      select nullif(split_part(trim(coalesce(profile.display_name, '')), '@', 1), '')
      into owner_label
      from public.profiles profile
      where profile.id = acting_user;

      insert into public.accounts (name, slug, created_by)
      values (
        left(coalesce(owner_label || ' agency', 'Untitled agency'), 120),
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
