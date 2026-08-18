begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(37);

-- Structure -----------------------------------------------------------------

select extensions.has_table('public', 'accounts', 'the account tenant root exists');
select extensions.has_table('public', 'account_memberships', 'account membership exists');
select extensions.has_column('public', 'organizations', 'account_id', 'organizations carry their account');
select extensions.has_function(
  'private', 'effective_organization_role', array['uuid', 'uuid'],
  'the single access resolver exists'
);
select extensions.is(
  (select relrowsecurity from pg_class where oid = 'public.accounts'::regclass),
  true, 'row level security is enabled on accounts'
);
select extensions.is(
  (select relrowsecurity from pg_class where oid = 'public.account_memberships'::regclass),
  true, 'row level security is enabled on account memberships'
);

-- Fixtures ------------------------------------------------------------------
--
-- Two accounts so every isolation claim is made across a real boundary rather
-- than against an absent row. `direct` deliberately holds no account membership
-- at all: it is the shape every user in the database had before this migration,
-- and its behavior must be identical afterwards.

insert into auth.users (id)
values
  ('ac000000-0000-4000-8000-0000000000a1'::uuid), -- account A owner
  ('ac000000-0000-4000-8000-0000000000a2'::uuid), -- account A admin
  ('ac000000-0000-4000-8000-0000000000a3'::uuid), -- account A member, default operator
  ('ac000000-0000-4000-8000-0000000000a4'::uuid), -- account A member, no default
  ('ac000000-0000-4000-8000-0000000000a5'::uuid), -- direct organization membership only
  ('ac000000-0000-4000-8000-0000000000b1'::uuid), -- account B owner
  ('ac000000-0000-4000-8000-0000000000c1'::uuid), -- belongs to nothing, later admitted
  ('ac000000-0000-4000-8000-0000000000d1'::uuid); -- belongs to nothing, stays that way

insert into public.accounts (id, name, slug, created_by)
values
  ('ac000000-0000-4000-8000-000000000a00'::uuid, 'Account A', 'account-a',
   'ac000000-0000-4000-8000-0000000000a1'::uuid),
  ('ac000000-0000-4000-8000-000000000b00'::uuid, 'Account B', 'account-b',
   'ac000000-0000-4000-8000-0000000000b1'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, status,
  created_by, account_id
)
values
  ('ac000000-0000-4000-8000-000000000a01'::uuid, 'Client A One', 'client-a-one',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'active',
   'ac000000-0000-4000-8000-0000000000a1'::uuid, 'ac000000-0000-4000-8000-000000000a00'::uuid),
  ('ac000000-0000-4000-8000-000000000a02'::uuid, 'Client A Two', 'client-a-two',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'active',
   'ac000000-0000-4000-8000-0000000000a1'::uuid, 'ac000000-0000-4000-8000-000000000a00'::uuid),
  ('ac000000-0000-4000-8000-000000000b01'::uuid, 'Client B One', 'client-b-one',
   'testing', 'AE', 'AED', 'Asia/Dubai', 'active',
   'ac000000-0000-4000-8000-0000000000b1'::uuid, 'ac000000-0000-4000-8000-000000000b00'::uuid);

insert into public.account_memberships (account_id, user_id, account_role, default_organization_role)
values
  ('ac000000-0000-4000-8000-000000000a00'::uuid, 'ac000000-0000-4000-8000-0000000000a1'::uuid, 'owner', null),
  ('ac000000-0000-4000-8000-000000000a00'::uuid, 'ac000000-0000-4000-8000-0000000000a2'::uuid, 'admin', null),
  ('ac000000-0000-4000-8000-000000000a00'::uuid, 'ac000000-0000-4000-8000-0000000000a3'::uuid, 'member', 'operator'),
  ('ac000000-0000-4000-8000-000000000a00'::uuid, 'ac000000-0000-4000-8000-0000000000a4'::uuid, 'member', null),
  ('ac000000-0000-4000-8000-000000000b00'::uuid, 'ac000000-0000-4000-8000-0000000000b1'::uuid, 'owner', null);

insert into public.organization_memberships (organization_id, user_id, role)
values
  -- The pre-migration shape: a direct grant with no account behind it.
  ('ac000000-0000-4000-8000-000000000a01'::uuid, 'ac000000-0000-4000-8000-0000000000a5'::uuid, 'viewer'),
  -- An override that raises a member above their account default.
  ('ac000000-0000-4000-8000-000000000a01'::uuid, 'ac000000-0000-4000-8000-0000000000a3'::uuid, 'admin'),
  -- An override that grants access where the account default grants none.
  ('ac000000-0000-4000-8000-000000000a02'::uuid, 'ac000000-0000-4000-8000-0000000000a4'::uuid, 'viewer');

-- The resolver truth table --------------------------------------------------

select extensions.is(
  private.effective_organization_role(
    'ac000000-0000-4000-8000-000000000a01'::uuid, 'ac000000-0000-4000-8000-0000000000a1'::uuid),
  'owner'::public.organization_role,
  'an account owner owns every client in the account'
);
select extensions.is(
  private.effective_organization_role(
    'ac000000-0000-4000-8000-000000000a02'::uuid, 'ac000000-0000-4000-8000-0000000000a2'::uuid),
  'admin'::public.organization_role,
  'an account admin administers every client in the account'
);
select extensions.is(
  private.effective_organization_role(
    'ac000000-0000-4000-8000-000000000a02'::uuid, 'ac000000-0000-4000-8000-0000000000a3'::uuid),
  'operator'::public.organization_role,
  'a member holds their default role in a client with no override'
);
select extensions.is(
  private.effective_organization_role(
    'ac000000-0000-4000-8000-000000000a01'::uuid, 'ac000000-0000-4000-8000-0000000000a3'::uuid),
  'admin'::public.organization_role,
  'an override raises a member above their account default'
);
select extensions.is(
  private.effective_organization_role(
    'ac000000-0000-4000-8000-000000000a01'::uuid, 'ac000000-0000-4000-8000-0000000000a4'::uuid),
  null::public.organization_role,
  'a member with no default role has no blanket access'
);
select extensions.is(
  private.effective_organization_role(
    'ac000000-0000-4000-8000-000000000a02'::uuid, 'ac000000-0000-4000-8000-0000000000a4'::uuid),
  'viewer'::public.organization_role,
  'an override grants access where the account default grants none'
);

-- The regression guarantee: users who predate accounts are unaffected.
select extensions.is(
  private.effective_organization_role(
    'ac000000-0000-4000-8000-000000000a01'::uuid, 'ac000000-0000-4000-8000-0000000000a5'::uuid),
  'viewer'::public.organization_role,
  'a direct membership with no account behind it resolves to exactly its own role'
);
select extensions.is(
  private.effective_organization_role(
    'ac000000-0000-4000-8000-000000000a02'::uuid, 'ac000000-0000-4000-8000-0000000000a5'::uuid),
  null::public.organization_role,
  'a direct membership grants nothing on a sibling client'
);

-- Tenant isolation. The assertions that matter most in this file.
select extensions.is(
  private.effective_organization_role(
    'ac000000-0000-4000-8000-000000000b01'::uuid, 'ac000000-0000-4000-8000-0000000000a1'::uuid),
  null::public.organization_role,
  'owning one account grants nothing in another account'
);
select extensions.is(
  private.effective_organization_role(
    'ac000000-0000-4000-8000-000000000a01'::uuid, 'ac000000-0000-4000-8000-0000000000b1'::uuid),
  null::public.organization_role,
  'the isolation holds in the other direction'
);
select extensions.is(
  private.effective_organization_role(
    'ac000000-0000-4000-8000-000000000a01'::uuid, 'ac000000-0000-4000-8000-0000000000c1'::uuid),
  null::public.organization_role,
  'a user who belongs to nothing resolves to nothing'
);

-- Union semantics: a grant never lowers authority.
select extensions.ok(
  private.organization_role_rank(
    private.effective_organization_role(
      'ac000000-0000-4000-8000-000000000a01'::uuid, 'ac000000-0000-4000-8000-0000000000a3'::uuid))
  >= private.organization_role_rank('operator'::public.organization_role),
  'adding an override never reduces the account-derived grant'
);

-- The two rewritten helpers -------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-4000-8000-0000000000a3';

select extensions.ok(
  private.is_organization_member('ac000000-0000-4000-8000-000000000a02'::uuid),
  'membership now follows from account access alone'
);
select extensions.ok(
  private.has_organization_role(
    'ac000000-0000-4000-8000-000000000a02'::uuid,
    array['operator']::public.organization_role[]),
  'the role helper reports the account-derived role'
);
select extensions.ok(
  not private.has_organization_role(
    'ac000000-0000-4000-8000-000000000b01'::uuid,
    array['owner', 'admin', 'operator', 'viewer']::public.organization_role[]),
  'the role helper refuses across the account boundary'
);

set local request.jwt.claim.sub = 'ac000000-0000-4000-8000-0000000000a4';
select extensions.ok(
  not private.is_organization_member('ac000000-0000-4000-8000-000000000a01'::uuid),
  'a member with no default role is not a member of an un-overridden client'
);

-- Row level security behavior -----------------------------------------------

set local request.jwt.claim.sub = 'ac000000-0000-4000-8000-0000000000a3';
select extensions.is(
  (select count(*) from public.organizations
   where id in ('ac000000-0000-4000-8000-000000000a01'::uuid,
                'ac000000-0000-4000-8000-000000000a02'::uuid,
                'ac000000-0000-4000-8000-000000000b01'::uuid)),
  2::bigint,
  'an account member reads every client in their account and none outside it'
);

set local request.jwt.claim.sub = 'ac000000-0000-4000-8000-0000000000a5';
select extensions.is(
  (select count(*) from public.organizations
   where id in ('ac000000-0000-4000-8000-000000000a01'::uuid,
                'ac000000-0000-4000-8000-000000000a02'::uuid,
                'ac000000-0000-4000-8000-000000000b01'::uuid)),
  1::bigint,
  'a direct-membership user still reads exactly the one client they were granted'
);

set local request.jwt.claim.sub = 'ac000000-0000-4000-8000-0000000000b1';
select extensions.is(
  (select count(*) from public.organizations
   where id in ('ac000000-0000-4000-8000-000000000a01'::uuid,
                'ac000000-0000-4000-8000-000000000a02'::uuid,
                'ac000000-0000-4000-8000-000000000b01'::uuid)),
  1::bigint,
  'the other account reads only its own client'
);
select extensions.is(
  (select count(*) from public.accounts
   where id in ('ac000000-0000-4000-8000-000000000a00'::uuid,
                'ac000000-0000-4000-8000-000000000b00'::uuid)),
  1::bigint,
  'an account is invisible to anyone outside it'
);

-- Reading the membership table under its own policy must not recurse.
set local request.jwt.claim.sub = 'ac000000-0000-4000-8000-0000000000a1';
select extensions.is(
  (select count(*) from public.account_memberships
   where account_id = 'ac000000-0000-4000-8000-000000000a00'::uuid),
  4::bigint,
  'account membership is readable under its own policy without recursion'
);
select extensions.is(
  (select count(*) from public.account_memberships
   where account_id = 'ac000000-0000-4000-8000-000000000b00'::uuid),
  0::bigint,
  'account membership of another account is invisible'
);

-- Integrity rules ------------------------------------------------------------

select extensions.throws_ok(
  $$
    delete from public.account_memberships
    where account_id = 'ac000000-0000-4000-8000-000000000a00'::uuid
      and user_id = 'ac000000-0000-4000-8000-0000000000a1'::uuid
  $$,
  '23514', null,
  'an account cannot lose its last owner'
);

select extensions.throws_ok(
  $$
    update public.account_memberships set account_role = 'member'
    where account_id = 'ac000000-0000-4000-8000-000000000a00'::uuid
      and user_id = 'ac000000-0000-4000-8000-0000000000a1'::uuid
  $$,
  '23514', null,
  'the last owner cannot demote themselves'
);

set local request.jwt.claim.sub = 'ac000000-0000-4000-8000-0000000000a2';
select extensions.throws_ok(
  $$
    insert into public.account_memberships (account_id, user_id, account_role)
    values (
      'ac000000-0000-4000-8000-000000000a00'::uuid,
      'ac000000-0000-4000-8000-0000000000c1'::uuid,
      'owner'
    )
  $$,
  '42501', null,
  'an admin cannot mint an owner'
);
select extensions.lives_ok(
  $$
    insert into public.account_memberships (account_id, user_id, account_role)
    values (
      'ac000000-0000-4000-8000-000000000a00'::uuid,
      'ac000000-0000-4000-8000-0000000000c1'::uuid,
      'member'
    )
  $$,
  'an admin may admit a member'
);

set local request.jwt.claim.sub = 'ac000000-0000-4000-8000-0000000000a1';
select extensions.throws_ok(
  $$
    update public.organizations
    set account_id = 'ac000000-0000-4000-8000-000000000b00'::uuid
    where id = 'ac000000-0000-4000-8000-000000000a01'::uuid
  $$,
  '23514', null,
  'a client cannot be moved between agencies'
);

set local request.jwt.claim.sub = 'ac000000-0000-4000-8000-0000000000b1';
select extensions.throws_ok(
  $$
    insert into public.organizations (
      name, slug, industry, country_code, base_currency, default_timezone,
      created_by, account_id
    ) values (
      'Smuggled Client', 'smuggled-client', 'testing', 'AE', 'AED', 'Asia/Dubai',
      'ac000000-0000-4000-8000-0000000000b1'::uuid,
      'ac000000-0000-4000-8000-000000000a00'::uuid
    )
  $$,
  '42501', null,
  'a client cannot be created inside an account the caller does not administer'
);

-- Organization creation ------------------------------------------------------
--
-- These calls exist because AGENTS.md requires every new plpgsql function that
-- reads a table it did not create to be executed, not merely applied.

set local request.jwt.claim.sub = 'ac000000-0000-4000-8000-0000000000a1';
select extensions.is(
  (select account_id from public.create_organization_with_owner_v3(
    'Resolved Client', 'resolved-client', 'testing', 'AE', 'AED', 'Asia/Dubai', 'core'
  )),
  'ac000000-0000-4000-8000-000000000a00'::uuid,
  'creation resolves the caller''s only account without being told'
);

-- d1 rather than c1: c1 was admitted to account A above, so it would resolve an
-- existing account instead of exercising the creation path.
set local request.jwt.claim.sub = 'ac000000-0000-4000-8000-0000000000d1';
select extensions.isnt(
  (select account_id from public.create_organization_with_owner_v3(
    'First Client', 'first-client', 'testing', 'AE', 'AED', 'Asia/Dubai', 'core'
  )),
  null::uuid,
  'a caller with no account gets one created for them'
);
select extensions.is(
  (select count(*) from public.account_memberships
   where user_id = 'ac000000-0000-4000-8000-0000000000d1'::uuid
     and account_role = 'owner'),
  1::bigint,
  'and owns the account that was created for them'
);

select * from extensions.finish();

rollback;
