create extension if not exists "pgcrypto";

create type public.organization_status as enum ('draft_onboarding', 'active', 'archived');
create type public.organization_role as enum ('owner', 'admin', 'operator', 'viewer');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  industry text not null,
  country_code text not null check (char_length(country_code) = 2),
  base_currency text not null check (char_length(base_currency) = 3),
  default_timezone text not null,
  status public.organization_status not null default 'draft_onboarding',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_memberships_user_idx on public.organization_memberships(user_id);
create index organizations_status_idx on public.organizations(status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger organizations_set_updated_at before update on public.organizations
for each row execute function public.set_updated_at();
create trigger memberships_set_updated_at before update on public.organization_memberships
for each row execute function public.set_updated_at();

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_organization_role(
  target_organization_id uuid,
  allowed_roles public.organization_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.role = any(allowed_roles)
  );
$$;

revoke all on function private.is_organization_member(uuid) from public;
revoke all on function private.has_organization_role(uuid, public.organization_role[]) from public;
grant execute on function private.is_organization_member(uuid) to authenticated;
grant execute on function private.has_organization_role(uuid, public.organization_role[]) to authenticated;

create or replace function private.can_bootstrap_owner(target_organization_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.organizations organization
    where organization.id = target_organization_id
      and organization.created_by = target_user_id
      and organization.status = 'draft_onboarding'
      and target_user_id = (select auth.uid())
  );
$$;

revoke all on function private.can_bootstrap_owner(uuid, uuid) from public;
grant execute on function private.can_bootstrap_owner(uuid, uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;

create policy "users can read their profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);

create policy "users can update their profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "members can read organizations"
on public.organizations for select to authenticated
using (private.is_organization_member(id));

create policy "authenticated users can create organizations"
on public.organizations for insert to authenticated
with check ((select auth.uid()) = created_by);

create policy "authorized members can update organizations"
on public.organizations for update to authenticated
using (private.has_organization_role(id, array['owner', 'admin']::public.organization_role[]))
with check (private.is_organization_member(id));

create policy "members can read memberships"
on public.organization_memberships for select to authenticated
using (private.is_organization_member(organization_id));

create policy "owners and admins can add memberships"
on public.organization_memberships for insert to authenticated
with check (
  private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[])
  or (role = 'owner' and private.can_bootstrap_owner(organization_id, user_id))
);

create policy "owners and admins can update memberships"
on public.organization_memberships for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]))
with check (private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]));

create policy "owners and admins can remove memberships"
on public.organization_memberships for delete to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]));

create or replace function public.create_organization_with_owner(
  input_name text,
  input_slug text,
  input_industry text,
  input_country_code text,
  input_base_currency text,
  input_timezone text
)
returns public.organizations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  created_organization public.organizations;
begin
  insert into public.organizations (name, slug, industry, country_code, base_currency, default_timezone, created_by)
  values (input_name, input_slug, input_industry, input_country_code, input_base_currency, input_timezone, (select auth.uid()))
  returning * into created_organization;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (created_organization.id, (select auth.uid()), 'owner');

  return created_organization;
end;
$$;

revoke all on function public.create_organization_with_owner(text, text, text, text, text, text) from public;
grant execute on function public.create_organization_with_owner(text, text, text, text, text, text) to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

revoke all on function private.handle_new_user() from public;

comment on table public.organizations is 'Tenant root. All future tenant-owned records must scope directly or through a verified relation.';
comment on table public.organization_memberships is 'Explicit many-to-many user tenancy membership; role is not stored in user metadata.';
