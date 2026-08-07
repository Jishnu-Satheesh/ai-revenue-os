create type public.branch_kind as enum ('physical', 'virtual');
create type public.digital_twin_fact_status as enum ('verified', 'imported', 'inferred', 'stale');
create type public.goal_baseline_status as enum ('known', 'unknown', 'estimated');
create type public.policy_mode as enum ('recommendation_only', 'approval_required', 'bounded_auto_execution', 'fully_autonomous');
create type public.audit_actor_type as enum ('user', 'system', 'ai');

alter table public.organizations
  add column industry_pack_slug text not null default 'core'
    check (industry_pack_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  add column branchless_confirmed boolean not null default false;

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  kind public.branch_kind not null default 'physical',
  timezone text not null,
  currency text not null check (char_length(currency) = 3),
  service_area jsonb not null default '{}'::jsonb,
  operating_hours jsonb not null default '{}'::jsonb,
  contact_details jsonb not null default '{}'::jsonb,
  capacity_metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug),
  unique (organization_id, id)
);

create table public.business_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  business_model text,
  value_proposition text,
  customer_segments jsonb not null default '[]'::jsonb,
  brand_context jsonb not null default '{}'::jsonb,
  languages text[] not null default '{}',
  operating_model jsonb not null default '{}'::jsonb,
  source text not null default 'user',
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  fact_key text not null check (fact_key ~ '^[a-z][a-z0-9_.-]{1,120}$'),
  value jsonb not null,
  source text not null,
  source_reference text,
  status public.digital_twin_fact_status not null default 'imported',
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  effective_from date,
  effective_to date,
  last_verified_at timestamptz,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete cascade
);

create unique index business_facts_org_key_idx on public.business_facts (organization_id, fact_key)
  where branch_id is null;
create unique index business_facts_branch_key_idx on public.business_facts (organization_id, branch_id, fact_key)
  where branch_id is not null;

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  metric text not null check (char_length(metric) between 2 and 120),
  baseline_status public.goal_baseline_status not null,
  baseline_value numeric,
  target_value numeric not null,
  unit text not null,
  currency text check (currency is null or char_length(currency) = 3),
  deadline date,
  scope_kind text not null check (scope_kind in ('organization', 'branch')),
  scope_branch_id uuid,
  owner_id uuid references auth.users(id),
  priority smallint not null default 3 check (priority between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope_kind = 'organization' and scope_branch_id is null) or (scope_kind = 'branch' and scope_branch_id is not null)),
  foreign key (organization_id, scope_branch_id) references public.branches(organization_id, id) on delete cascade
);

create table public.constraints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  constraint_type text not null,
  value jsonb not null,
  severity text not null default 'hard' check (severity in ('soft', 'hard')),
  source text not null default 'user',
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_type text not null,
  name text not null,
  mode public.policy_mode not null default 'approval_required',
  configuration jsonb not null default '{}'::jsonb,
  monthly_budget_minor integer check (monthly_budget_minor is null or monthly_budget_minor >= 0),
  budget_currency text check (budget_currency is null or char_length(budget_currency) = 3),
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, policy_type, version)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_name text not null,
  actor_type public.audit_actor_type not null,
  actor_id uuid,
  entity_type text not null,
  entity_id uuid,
  correlation_id uuid not null default gen_random_uuid(),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index branches_organization_idx on public.branches(organization_id);
create index business_facts_organization_idx on public.business_facts(organization_id, updated_at desc);
create index goals_organization_idx on public.goals(organization_id, priority);
create index constraints_organization_idx on public.constraints(organization_id, is_active);
create index policies_organization_idx on public.policies(organization_id, policy_type, is_active);
create index audit_events_organization_idx on public.audit_events(organization_id, occurred_at desc);

create trigger branches_set_updated_at before update on public.branches
for each row execute function public.set_updated_at();
create trigger business_profiles_set_updated_at before update on public.business_profiles
for each row execute function public.set_updated_at();
create trigger business_facts_set_updated_at before update on public.business_facts
for each row execute function public.set_updated_at();
create trigger goals_set_updated_at before update on public.goals
for each row execute function public.set_updated_at();
create trigger constraints_set_updated_at before update on public.constraints
for each row execute function public.set_updated_at();
create trigger policies_set_updated_at before update on public.policies
for each row execute function public.set_updated_at();

create or replace function private.prevent_verified_fact_downgrade()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.status = 'verified' and new.status <> 'verified' then
    raise exception 'verified_fact_cannot_be_downgraded';
  end if;
  return new;
end;
$$;

create trigger business_facts_prevent_downgrade before update on public.business_facts
for each row execute function private.prevent_verified_fact_downgrade();

alter table public.branches enable row level security;
alter table public.business_profiles enable row level security;
alter table public.business_facts enable row level security;
alter table public.goals enable row level security;
alter table public.constraints enable row level security;
alter table public.policies enable row level security;
alter table public.audit_events enable row level security;

create policy "members can read branches"
on public.branches for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create branches"
on public.branches for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));
create policy "admins can update branches"
on public.branches for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]))
with check (private.is_organization_member(organization_id));

create policy "members can read business profiles"
on public.business_profiles for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create business profiles"
on public.business_profiles for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));
create policy "operators can update business profiles"
on public.business_profiles for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]))
with check (private.is_organization_member(organization_id));

create policy "members can read business facts"
on public.business_facts for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create business facts"
on public.business_facts for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));
create policy "operators can update business facts"
on public.business_facts for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]))
with check (private.is_organization_member(organization_id));

create policy "members can read goals"
on public.goals for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create goals"
on public.goals for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));
create policy "admins can update goals"
on public.goals for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]))
with check (private.is_organization_member(organization_id));

create policy "members can read constraints"
on public.constraints for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create constraints"
on public.constraints for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));
create policy "admins can update constraints"
on public.constraints for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]))
with check (private.is_organization_member(organization_id));

create policy "members can read policies"
on public.policies for select to authenticated
using (private.is_organization_member(organization_id));
create policy "admins can create policies"
on public.policies for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]));
create policy "admins can update policies"
on public.policies for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]))
with check (private.is_organization_member(organization_id));

create policy "members can read audit events"
on public.audit_events for select to authenticated
using (private.is_organization_member(organization_id));

create or replace function private.audit_organization_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_organization_id uuid;
  target_entity_id uuid;
  target_event_name text;
  target_status text;
begin
  target_organization_id := case when TG_TABLE_NAME = 'organizations' then coalesce(new.id, old.id) else coalesce(new.organization_id, old.organization_id) end;
  target_entity_id := case when TG_TABLE_NAME = 'business_profiles' then target_organization_id else coalesce(new.id, old.id) end;
  target_event_name := case
    when TG_TABLE_NAME = 'organizations' and TG_OP = 'INSERT' then 'organization.created'
    when TG_TABLE_NAME = 'branches' and TG_OP = 'INSERT' then 'branch.created'
    when TG_TABLE_NAME = 'business_profiles' then 'business_profile.updated'
    when TG_TABLE_NAME = 'business_facts' and coalesce(new.status::text, '') = 'verified' then 'business_fact.verified'
    when TG_TABLE_NAME = 'business_facts' then 'business_fact.updated'
    when TG_TABLE_NAME = 'goals' and TG_OP = 'INSERT' then 'goal.created'
    when TG_TABLE_NAME = 'constraints' and TG_OP = 'INSERT' then 'constraint.created'
    when TG_TABLE_NAME = 'policies' then 'policy.updated'
    else lower(TG_TABLE_NAME || '.' || TG_OP)
  end;
  target_status := case when TG_TABLE_NAME = 'organizations' then coalesce(new.status::text, old.status::text) else null end;

  insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, payload)
  values (
    target_organization_id,
    target_event_name,
    'user',
    (select auth.uid()),
    TG_TABLE_NAME,
    target_entity_id,
    jsonb_build_object('operation', TG_OP, 'status', target_status)
  );
  return new;
end;
$$;

create trigger organizations_audit after insert or update on public.organizations
for each row execute function private.audit_organization_change();
create trigger branches_audit after insert or update on public.branches
for each row execute function private.audit_organization_change();
create trigger business_profiles_audit after insert or update on public.business_profiles
for each row execute function private.audit_organization_change();
create trigger business_facts_audit after insert or update on public.business_facts
for each row execute function private.audit_organization_change();
create trigger goals_audit after insert or update on public.goals
for each row execute function private.audit_organization_change();
create trigger constraints_audit after insert or update on public.constraints
for each row execute function private.audit_organization_change();
create trigger policies_audit after insert or update on public.policies
for each row execute function private.audit_organization_change();

revoke all on function private.audit_organization_change() from public;

create or replace function private.prevent_unguarded_organization_lifecycle_change()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.created_by <> new.created_by then
    raise exception 'organization_owner_cannot_change_directly';
  end if;
  if old.status <> new.status and coalesce(current_setting('app.allow_organization_lifecycle_change', true), '') <> 'true' then
    raise exception 'organization_lifecycle_change_requires_domain_command';
  end if;
  return new;
end;
$$;

create trigger organizations_guard_lifecycle before update on public.organizations
for each row execute function private.prevent_unguarded_organization_lifecycle_change();
revoke all on function private.prevent_unguarded_organization_lifecycle_change() from public;

create or replace function public.create_organization_with_owner_v2(
  input_name text,
  input_slug text,
  input_industry text,
  input_country_code text,
  input_base_currency text,
  input_timezone text,
  input_industry_pack_slug text,
  input_first_branch_name text default null,
  input_first_branch_slug text default null,
  input_first_branch_kind public.branch_kind default 'physical'
)
returns public.organizations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  created_organization public.organizations;
begin
  insert into public.organizations (name, slug, industry, country_code, base_currency, default_timezone, industry_pack_slug, branchless_confirmed, created_by)
  values (input_name, input_slug, input_industry, input_country_code, input_base_currency, input_timezone, input_industry_pack_slug, input_first_branch_name is null, (select auth.uid()))
  returning * into created_organization;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (created_organization.id, (select auth.uid()), 'owner');

  insert into public.business_profiles (organization_id, updated_by)
  values (created_organization.id, (select auth.uid()));

  insert into public.policies (organization_id, policy_type, name, mode, created_by, updated_by)
  values
    (created_organization.id, 'access', 'Access and approval policy', 'approval_required', (select auth.uid()), (select auth.uid())),
    (created_organization.id, 'spend', 'Spend and budget policy', 'approval_required', (select auth.uid()), (select auth.uid()));

  if input_first_branch_name is not null then
    insert into public.branches (organization_id, name, slug, kind, timezone, currency)
    values (created_organization.id, input_first_branch_name, coalesce(input_first_branch_slug, input_first_branch_name), input_first_branch_kind, input_timezone, input_base_currency);
  end if;

  return created_organization;
end;
$$;

revoke all on function public.create_organization_with_owner_v2(text, text, text, text, text, text, text, text, text, public.branch_kind) from public;
grant execute on function public.create_organization_with_owner_v2(text, text, text, text, text, text, text, text, text, public.branch_kind) to authenticated;
revoke execute on function public.create_organization_with_owner(text, text, text, text, text, text) from authenticated;

create or replace function public.activate_organization(target_organization_id uuid)
returns public.organizations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  activated_organization public.organizations;
begin
  if not private.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then
    raise exception 'organization_activation_forbidden';
  end if;
  if not exists (select 1 from public.policies where organization_id = target_organization_id and policy_type = 'access' and is_active) then
    raise exception 'organization_access_policy_required';
  end if;
  if exists (select 1 from public.organizations where id = target_organization_id and lower(industry) = 'restaurant')
     and not exists (select 1 from public.branches where organization_id = target_organization_id and kind = 'physical' and is_active) then
    raise exception 'organization_branch_required';
  end if;
  perform set_config('app.allow_organization_lifecycle_change', 'true', true);
  update public.organizations
  set status = 'active'
  where id = target_organization_id and status = 'draft_onboarding'
  returning * into activated_organization;
  if activated_organization.id is null then raise exception 'organization_not_ready'; end if;
  return activated_organization;
end;
$$;

create or replace function public.archive_draft_organization(target_organization_id uuid)
returns public.organizations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  archived_organization public.organizations;
begin
  if not private.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then
    raise exception 'organization_archive_forbidden';
  end if;
  perform set_config('app.allow_organization_lifecycle_change', 'true', true);
  update public.organizations
  set status = 'archived', archived_at = now()
  where id = target_organization_id and status = 'draft_onboarding'
  returning * into archived_organization;
  if archived_organization.id is null then raise exception 'only_draft_organizations_can_be_archived'; end if;
  return archived_organization;
end;
$$;

revoke all on function public.activate_organization(uuid) from public;
grant execute on function public.activate_organization(uuid) to authenticated;
revoke all on function public.archive_draft_organization(uuid) from public;
grant execute on function public.archive_draft_organization(uuid) to authenticated;
