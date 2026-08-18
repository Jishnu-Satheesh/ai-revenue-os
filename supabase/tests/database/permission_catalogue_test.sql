begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(24);

-- Structure -----------------------------------------------------------------

select extensions.has_table('public', 'permissions', 'the permission vocabulary exists');
select extensions.has_table('public', 'account_role_permissions', 'account role mapping exists');
select extensions.has_table('public', 'organization_role_permissions', 'client role mapping exists');
select extensions.has_function(
  'private', 'has_organization_permission', array['uuid', 'text'],
  'the organization permission helper exists'
);
select extensions.has_function(
  'private', 'has_account_permission', array['uuid', 'text'],
  'the account permission helper exists'
);

-- The catalogue is read-only to every application role. If this ever fails, a
-- role could grant itself a permission, which is the one thing the whole
-- permission-as-data design must never allow.
select extensions.is(
  (select count(*)::bigint from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('permissions', 'account_role_permissions', 'organization_role_permissions')
     and grantee in ('authenticated', 'anon')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0::bigint,
  'no application role can write to the catalogue'
);

-- Seeded content ------------------------------------------------------------

select extensions.is(
  (select count(*)::bigint from public.permissions where scope = 'account'),
  7::bigint,
  'the account vocabulary is seeded'
);
select extensions.is(
  (select count(*)::bigint from public.permissions where scope = 'organization'),
  26::bigint,
  'the organization vocabulary is seeded'
);
select extensions.ok(
  not exists (select 1 from public.permissions where description is null or description = ''),
  'every permission carries a description'
);

-- Nesting: viewer is contained in operator, operator in admin, admin in owner.
-- Asserted as containment rather than as counts so a future permission cannot
-- quietly land on a lower role only.
select extensions.ok(
  not exists (
    select permission_key from public.organization_role_permissions where organization_role = 'viewer'
    except
    select permission_key from public.organization_role_permissions where organization_role = 'operator'
  ),
  'an operator holds everything a viewer holds'
);
select extensions.ok(
  not exists (
    select permission_key from public.organization_role_permissions where organization_role = 'operator'
    except
    select permission_key from public.organization_role_permissions where organization_role = 'admin'
  ),
  'an admin holds everything an operator holds'
);
select extensions.ok(
  not exists (
    select permission_key from public.organization_role_permissions where organization_role = 'admin'
    except
    select permission_key from public.organization_role_permissions where organization_role = 'owner'
  ),
  'an owner holds everything an admin holds'
);

-- The specific boundaries the product depends on.
select extensions.ok(
  not exists (
    select 1 from public.organization_role_permissions
    where organization_role = 'operator' and permission_key = 'memory.read_sensitive'
  ),
  'an operator cannot read confidential or customer-content memory'
);
select extensions.ok(
  exists (
    select 1 from public.organization_role_permissions
    where organization_role = 'operator' and permission_key = 'memory.write'
  ),
  'but an operator can still write memory'
);
select extensions.ok(
  not exists (
    select 1 from public.organization_role_permissions
    where organization_role = 'operator'
      and permission_key in ('campaign.approve', 'campaign.publish', 'budget.modify', 'policy.update')
  ),
  'an operator cannot approve, publish, or move money'
);
select extensions.ok(
  not exists (
    select 1 from public.organization_role_permissions
    where organization_role = 'admin' and permission_key = 'organization.archive'
  ),
  'only an owner can archive a client'
);
select extensions.ok(
  not exists (
    select 1 from public.account_role_permissions
    where account_role = 'member' and permission_key = 'member.invite'
  ),
  'an account member cannot invite'
);

-- A permission cannot be mapped onto a role at the wrong scope.
select extensions.throws_ok(
  $$
    insert into public.organization_role_permissions (organization_role, permission_key)
    values ('owner', 'member.invite')
  $$,
  '23503', null,
  'an account permission cannot be mapped onto a client role'
);

-- Resolution ----------------------------------------------------------------

insert into auth.users (id)
values
  ('bc000000-0000-4000-8000-0000000000a1'::uuid),
  ('bc000000-0000-4000-8000-0000000000a2'::uuid),
  ('bc000000-0000-4000-8000-0000000000b1'::uuid);

insert into public.accounts (id, name, slug, created_by)
values
  ('bc000000-0000-4000-8000-000000000a00'::uuid, 'Permission agency A', 'permission-agency-a',
   'bc000000-0000-4000-8000-0000000000a1'::uuid),
  ('bc000000-0000-4000-8000-000000000b00'::uuid, 'Permission agency B', 'permission-agency-b',
   'bc000000-0000-4000-8000-0000000000b1'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, status, created_by, account_id
)
values
  ('bc000000-0000-4000-8000-000000000a01'::uuid, 'Permission client A', 'permission-client-a',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'active',
   'bc000000-0000-4000-8000-0000000000a1'::uuid, 'bc000000-0000-4000-8000-000000000a00'::uuid),
  ('bc000000-0000-4000-8000-000000000b01'::uuid, 'Permission client B', 'permission-client-b',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'active',
   'bc000000-0000-4000-8000-0000000000b1'::uuid, 'bc000000-0000-4000-8000-000000000b00'::uuid);

insert into public.account_memberships (account_id, user_id, account_role, default_organization_role)
values
  ('bc000000-0000-4000-8000-000000000a00'::uuid, 'bc000000-0000-4000-8000-0000000000a1'::uuid, 'owner', null),
  ('bc000000-0000-4000-8000-000000000a00'::uuid, 'bc000000-0000-4000-8000-0000000000a2'::uuid, 'member', 'operator'),
  ('bc000000-0000-4000-8000-000000000b00'::uuid, 'bc000000-0000-4000-8000-0000000000b1'::uuid, 'owner', null);

set local role authenticated;

-- An account member whose default role is operator.
set local request.jwt.claim.sub = 'bc000000-0000-4000-8000-0000000000a2';
select extensions.ok(
  private.has_organization_permission('bc000000-0000-4000-8000-000000000a01'::uuid, 'memory.write'),
  'a permission resolves through the account-derived organization role'
);
select extensions.ok(
  not private.has_organization_permission('bc000000-0000-4000-8000-000000000a01'::uuid, 'campaign.approve'),
  'and stops where that role stops'
);
select extensions.ok(
  not private.has_account_permission('bc000000-0000-4000-8000-000000000a00'::uuid, 'member.invite'),
  'an account member cannot invite in practice, not only on paper'
);

-- Tenant isolation. A permission check must never be a route around ADR 0022.
select extensions.ok(
  not private.has_organization_permission('bc000000-0000-4000-8000-000000000b01'::uuid, 'memory.read'),
  'no permission resolves across the account boundary'
);
set local request.jwt.claim.sub = 'bc000000-0000-4000-8000-0000000000b1';
select extensions.ok(
  not private.has_account_permission('bc000000-0000-4000-8000-000000000a00'::uuid, 'account.read'),
  'and no account permission resolves into another agency'
);
select extensions.ok(
  private.has_account_permission('bc000000-0000-4000-8000-000000000b00'::uuid, 'member.invite'),
  'while an owner can invite inside their own agency'
);

select * from extensions.finish();

rollback;
