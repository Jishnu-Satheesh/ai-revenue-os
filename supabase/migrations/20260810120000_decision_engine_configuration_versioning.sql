-- Decision Engine V1 configuration prerequisites.
--
-- The version tuple in specs/011-learning-ledger.md requires that "the policy
-- and threshold configuration in force" resolves to exactly one row. Two gaps
-- prevented that:
--
--   1. `public.policies` carried `version` and `unique (organization_id,
--      policy_type, version)`, but `is_active` was independent of both.
--      savePolicy() inserted every new version with `is_active = true` and
--      never retired its predecessor, so a policy type accumulated active
--      rows and "the active version" was ambiguous.
--
--   2. `public.constraints` was neither versioned nor effective-dated and had
--      no scope, while specs/013-margin-firewall.md section 4.1 requires
--      margin floors to be effective-dated, versioned, and resolved
--      most-specific-wins, with the floor in force recorded on every
--      evaluation.
--
-- Both invariants are enforced by partial unique indexes rather than by the
-- accompanying RPCs, so a direct write that would break them fails loudly
-- instead of silently producing an unresolvable configuration.
--
-- See specs/005-decision-engine-v1.md section 15.

-- Subject kinds -------------------------------------------------------------

-- Shared vocabulary for "what a thing is attached to". Constraints scope to a
-- subject here; specs/015 metric observations and specs/005 decision
-- candidates will reference the same registry, which is what lets a pack
-- playbook screen its own entities without the core learning what they are.
--
-- Vocabulary, not tenant data: rows are seeded by migrations and readable by
-- every authenticated user. No write grant is issued.
create table public.subject_kinds (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  label text not null check (char_length(label) between 1 and 120),
  owner_scope text not null check (owner_scope in ('core', 'pack')),
  pack_slug text check (char_length(pack_slug) between 1 and 60),
  created_at timestamptz not null default now(),
  check (
    (owner_scope = 'pack' and pack_slug is not null)
    or (owner_scope = 'core' and pack_slug is null)
  )
);

insert into public.subject_kinds (key, label, owner_scope)
values
  ('organization', 'Organization', 'core'),
  ('branch', 'Branch', 'core'),
  ('channel', 'Channel', 'core')
on conflict (key) do nothing;

alter table public.subject_kinds enable row level security;

create policy "authenticated can read subject kinds"
on public.subject_kinds for select to authenticated
using (true);

grant select on table public.subject_kinds to authenticated;

-- Policies: exactly one active version per type ------------------------------

-- Retire every active row that a later active version already superseded in
-- practice. The highest active version per type wins; lower ones were only
-- ever active because nothing retired them.
update public.policies as stale
set is_active = false
where stale.is_active
  and exists (
    select 1
    from public.policies as newer
    where newer.organization_id = stale.organization_id
      and newer.policy_type = stale.policy_type
      and newer.is_active
      and newer.version > stale.version
  );

create unique index policies_one_active_version_idx
  on public.policies (organization_id, policy_type)
  where is_active;

-- Constraints: identity, scope, versioning, effective dating -----------------

alter table public.constraints
  add column constraint_key text,
  add column scope_kind text not null default 'organization' references public.subject_kinds(key),
  add column scope_ref text check (scope_ref is null or char_length(scope_ref) between 1 and 200),
  add column version integer not null default 1 check (version > 0),
  add column effective_from date not null default current_date,
  add column effective_to date,
  add column superseded_by_id uuid references public.constraints(id) on delete set null;

-- Backfill a stable key from the display name. `name` is user-facing and
-- mutable, so it cannot be the identity that versions hang off; the slug is
-- derived once here and is immutable afterwards.
with slugged as (
  select
    id,
    organization_id,
    coalesce(
      nullif(btrim(regexp_replace(lower(name), '[^a-z0-9]+', '_', 'g'), '_'), ''),
      'constraint'
    ) as base
  from public.constraints
),
normalized as (
  select
    id,
    organization_id,
    left(case when base ~ '^[a-z]' then base else 'c_' || base end, 100) as base
  from slugged
),
numbered as (
  select
    id,
    base,
    row_number() over (partition by organization_id, base order by id) as ordinal
  from normalized
)
update public.constraints as target
set constraint_key = case
  when numbered.ordinal = 1 then numbered.base
  else numbered.base || '_' || numbered.ordinal
end
from numbered
where target.id = numbered.id;

alter table public.constraints
  alter column constraint_key set not null,
  add constraint constraints_key_format
    check (constraint_key ~ '^[a-z][a-z0-9_.-]{1,120}$'),
  add constraint constraints_scope_ref_matches_kind
    check (
      (scope_kind = 'organization' and scope_ref is null)
      or (scope_kind <> 'organization' and scope_ref is not null)
    ),
  add constraint constraints_effective_window
    check (effective_to is null or effective_to >= effective_from),
  add constraint constraints_supersede_not_self
    check (superseded_by_id is null or superseded_by_id <> id);

create unique index constraints_version_idx
  on public.constraints (
    organization_id,
    constraint_key,
    scope_kind,
    (coalesce(scope_ref, '')),
    version
  );

create unique index constraints_one_active_version_idx
  on public.constraints (
    organization_id,
    constraint_key,
    scope_kind,
    (coalesce(scope_ref, ''))
  )
  where is_active;

-- Resolution order for the margin firewall is most-specific-wins, which reads
-- active rows for one organization ordered by scope specificity.
create index constraints_active_scope_idx
  on public.constraints (organization_id, constraint_type, scope_kind)
  where is_active;

-- Audit event names ----------------------------------------------------------

-- Supersession previously emitted the same event name as creation, which makes
-- it impossible to read back which version was in force at a point in time --
-- the exact question the version tuple exists to answer. Mirrors the
-- `memory.item_superseded` precedent.
create or replace function private.audit_organization_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_row jsonb := '{}'::jsonb;
  old_row jsonb := '{}'::jsonb;
  target_organization_id uuid;
  target_entity_id uuid;
  target_event_name text;
  target_status text;
  target_actor_id uuid;
  target_actor_type public.audit_actor_type;
  target_correlation_id uuid;
begin
  if TG_OP <> 'DELETE' then new_row := pg_catalog.to_jsonb(new); end if;
  if TG_OP <> 'INSERT' then old_row := pg_catalog.to_jsonb(old); end if;
  target_organization_id := coalesce((new_row ->> 'organization_id')::uuid, (old_row ->> 'organization_id')::uuid, (new_row ->> 'id')::uuid, (old_row ->> 'id')::uuid);
  target_entity_id := coalesce((new_row ->> 'id')::uuid, (old_row ->> 'id')::uuid, target_organization_id);
  target_event_name := case
    when TG_TABLE_NAME = 'organizations' and TG_OP = 'INSERT' then 'organization.created'
    when TG_TABLE_NAME = 'branches' and TG_OP = 'INSERT' then 'branch.created'
    when TG_TABLE_NAME = 'business_profiles' then 'business_profile.updated'
    when TG_TABLE_NAME = 'business_facts' and new_row ->> 'status' = 'verified' then 'business_fact.verified'
    when TG_TABLE_NAME = 'business_facts' then 'business_fact.updated'
    when TG_TABLE_NAME = 'goals' and TG_OP = 'INSERT' then 'goal.created'
    when TG_TABLE_NAME = 'constraints' and TG_OP = 'INSERT' then 'constraint.created'
    when TG_TABLE_NAME = 'constraints'
      and (old_row ->> 'is_active')::boolean
      and not (new_row ->> 'is_active')::boolean then 'constraint.superseded'
    when TG_TABLE_NAME = 'constraints' then 'constraint.updated'
    when TG_TABLE_NAME = 'policies'
      and (old_row ->> 'is_active')::boolean
      and not (new_row ->> 'is_active')::boolean then 'policy.superseded'
    when TG_TABLE_NAME = 'policies' then 'policy.updated'
    when TG_TABLE_NAME = 'memory_items' and TG_OP = 'INSERT' then 'memory.item_created'
    when TG_TABLE_NAME = 'memory_items' and new_row ->> 'superseded_by_id' is not null and old_row ->> 'superseded_by_id' is null then 'memory.item_superseded'
    when TG_TABLE_NAME = 'memory_items' and new_row ->> 'verification_state' = 'verified' and old_row ->> 'verification_state' is distinct from 'verified' then 'memory.item_verified'
    when TG_TABLE_NAME = 'memory_items' and new_row ->> 'verification_state' = 'rejected' and old_row ->> 'verification_state' is distinct from 'rejected' then 'memory.item_rejected'
    when TG_TABLE_NAME = 'memory_items' then 'memory.item_updated'
    else pg_catalog.lower(TG_TABLE_NAME || '.' || TG_OP)
  end;
  target_status := coalesce(new_row ->> 'status', old_row ->> 'status', new_row ->> 'verification_state', old_row ->> 'verification_state');
  target_actor_id := (select auth.uid());
  target_actor_type := case when target_actor_id is null then 'system' else 'user' end;
  target_correlation_id := nullif(pg_catalog.current_setting('app.correlation_id', true), '')::uuid;
  insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload)
  values (target_organization_id, target_event_name, target_actor_type, target_actor_id, TG_TABLE_NAME, target_entity_id, coalesce(target_correlation_id, gen_random_uuid()), pg_catalog.jsonb_build_object('operation', TG_OP, 'status', target_status));
  return new;
end;
$$;

-- Versioned write paths -------------------------------------------------------

-- Both RPCs retire the incumbent before inserting the successor, because the
-- partial unique indexes above are enforced per statement and cannot be
-- deferred. The supersession pointer is set afterwards, once the successor has
-- an id.

create or replace function public.save_policy_version(
  target_organization_id uuid,
  input_policy_type text,
  input_name text,
  input_mode public.policy_mode,
  input_configuration jsonb,
  input_monthly_budget_minor integer,
  input_budget_currency text
)
returns public.policies
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  saved_policy public.policies;
  next_version integer;
begin
  if not private.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then
    raise exception 'policy_write_forbidden';
  end if;

  select coalesce(max(version), 0) + 1
  into next_version
  from public.policies
  where organization_id = target_organization_id
    and policy_type = input_policy_type;

  update public.policies
  set is_active = false,
      updated_by = (select auth.uid())
  where organization_id = target_organization_id
    and policy_type = input_policy_type
    and is_active;

  insert into public.policies (
    organization_id,
    policy_type,
    name,
    mode,
    configuration,
    monthly_budget_minor,
    budget_currency,
    version,
    is_active,
    created_by,
    updated_by
  )
  values (
    target_organization_id,
    input_policy_type,
    input_name,
    input_mode,
    coalesce(input_configuration, '{}'::jsonb),
    input_monthly_budget_minor,
    input_budget_currency,
    next_version,
    true,
    (select auth.uid()),
    (select auth.uid())
  )
  returning * into saved_policy;

  return saved_policy;
end;
$$;

revoke all on function public.save_policy_version(uuid, text, text, public.policy_mode, jsonb, integer, text) from public;
grant execute on function public.save_policy_version(uuid, text, text, public.policy_mode, jsonb, integer, text) to authenticated;

create or replace function public.save_constraint_version(
  target_organization_id uuid,
  input_constraint_key text,
  input_name text,
  input_constraint_type text,
  input_value jsonb,
  input_severity text,
  input_source text,
  input_scope_kind text,
  input_scope_ref text,
  input_effective_from date
)
returns public.constraints
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  incumbent public.constraints;
  saved_constraint public.constraints;
  next_version integer;
  effective_date date := coalesce(input_effective_from, current_date);
begin
  if not private.has_organization_role(target_organization_id, array['owner', 'admin', 'operator']::public.organization_role[]) then
    raise exception 'constraint_write_forbidden';
  end if;

  select *
  into incumbent
  from public.constraints
  where organization_id = target_organization_id
    and constraint_key = input_constraint_key
    and scope_kind = input_scope_kind
    and coalesce(scope_ref, '') = coalesce(input_scope_ref, '')
    and is_active
  for update;

  -- Adding a constraint is an operator action; replacing one already in force
  -- changes governed configuration and is reserved to admins, matching the
  -- update policy on the table and specs/013 section 10.
  if incumbent.id is not null
    and not private.has_organization_role(target_organization_id, array['owner', 'admin']::public.organization_role[]) then
    raise exception 'constraint_supersede_forbidden';
  end if;

  select coalesce(max(version), 0) + 1
  into next_version
  from public.constraints
  where organization_id = target_organization_id
    and constraint_key = input_constraint_key
    and scope_kind = input_scope_kind
    and coalesce(scope_ref, '') = coalesce(input_scope_ref, '');

  if incumbent.id is not null then
    update public.constraints
    set is_active = false,
        effective_to = coalesce(effective_to, effective_date)
    where id = incumbent.id;
  end if;

  insert into public.constraints (
    organization_id,
    constraint_key,
    name,
    constraint_type,
    value,
    severity,
    source,
    scope_kind,
    scope_ref,
    version,
    effective_from,
    is_active,
    created_by
  )
  values (
    target_organization_id,
    input_constraint_key,
    input_name,
    input_constraint_type,
    input_value,
    coalesce(input_severity, 'hard'),
    coalesce(input_source, 'user'),
    coalesce(input_scope_kind, 'organization'),
    input_scope_ref,
    next_version,
    effective_date,
    true,
    (select auth.uid())
  )
  returning * into saved_constraint;

  if incumbent.id is not null then
    update public.constraints
    set superseded_by_id = saved_constraint.id
    where id = incumbent.id;
  end if;

  return saved_constraint;
end;
$$;

revoke all on function public.save_constraint_version(uuid, text, text, text, jsonb, text, text, text, text, date) from public;
grant execute on function public.save_constraint_version(uuid, text, text, text, jsonb, text, text, text, text, date) to authenticated;
