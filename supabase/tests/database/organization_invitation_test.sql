begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(51);

-- Covers `20260917090000_organization_invitations.sql`: client-scoped
-- invitations for outsiders, plus the membership role ceiling. Mirrors
-- `account_invitation_test.sql`; anything that differs is commented where it
-- differs, because a silent drift between the two flows is how a hole opens.

-- Structure -----------------------------------------------------------------

select extensions.has_table('public', 'organization_invitations', 'the invitation table exists');
select extensions.is(
  (select relrowsecurity from pg_class where oid = 'public.organization_invitations'::regclass),
  true, 'row level security is enabled on invitations'
);
select extensions.is(
  (select count(*)::bigint from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'organization_invitations'
     and grantee = 'anon'),
  0::bigint,
  'anonymous callers hold no grant on the invitation table'
);
select extensions.is(
  (select count(*)::bigint from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'organization_invitations'
     and grantee = 'authenticated' and privilege_type = 'DELETE'),
  0::bigint,
  'invitations are revoked, never deleted'
);
select extensions.is(
  (select count(*)::bigint from public.organization_role_permissions
   where permission_key in (
     'organization.member.invite',
     'organization.member.manage_role',
     'organization.member.remove'
   ) and organization_role in ('owner', 'admin')),
  6::bigint,
  'owner and admin hold the three member permissions'
);

-- Fixtures ------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at)
values
  ('2e000000-0000-4000-8000-000000000a01'::uuid, 'owner-o@example.com', now()),
  ('2e000000-0000-4000-8000-000000000a02'::uuid, 'admin-o@example.com', now()),
  ('2e000000-0000-4000-8000-000000000a03'::uuid, 'operator-o@example.com', now()),
  ('2e000000-0000-4000-8000-000000000a04'::uuid, 'viewer-o@example.com', now()),
  ('2e000000-0000-4000-8000-000000000a05'::uuid, 'invitee@example.com', now()),
  ('2e000000-0000-4000-8000-000000000a06'::uuid, 'someone-else@example.com', now()),
  ('2e000000-0000-4000-8000-000000000a07'::uuid, 'unconfirmed@example.com', null),
  ('2e000000-0000-4000-8000-000000000b01'::uuid, 'owner-b@example.com', now());

insert into public.profiles (id, display_name)
values
  ('2e000000-0000-4000-8000-000000000a01'::uuid, 'Owner O')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.accounts (id, name, slug, created_by)
values
  ('2e000000-0000-4000-8000-000000000a00'::uuid, 'Org invite agency A', 'org-invite-agency-a',
   '2e000000-0000-4000-8000-000000000a01'::uuid),
  ('2e000000-0000-4000-8000-000000000b00'::uuid, 'Org invite agency B', 'org-invite-agency-b',
   '2e000000-0000-4000-8000-000000000b01'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, status, created_by
)
values
  ('2e000000-0000-4000-8000-000000000a10'::uuid, '2e000000-0000-4000-8000-000000000a00'::uuid,
   'Client Alpha', 'client-alpha', 'restaurant', 'AE', 'AED', 'Asia/Dubai', 'active',
   '2e000000-0000-4000-8000-000000000a01'::uuid),
  ('2e000000-0000-4000-8000-000000000b10'::uuid, '2e000000-0000-4000-8000-000000000b00'::uuid,
   'Client Beta', 'client-beta', 'restaurant', 'AE', 'AED', 'Asia/Dubai', 'active',
   '2e000000-0000-4000-8000-000000000b01'::uuid),
  ('2e000000-0000-4000-8000-000000000a11'::uuid, '2e000000-0000-4000-8000-000000000a00'::uuid,
   'Client Archived', 'client-archived', 'restaurant', 'AE', 'AED', 'Asia/Dubai', 'archived',
   '2e000000-0000-4000-8000-000000000a01'::uuid);

insert into public.organization_memberships (organization_id, user_id, role)
values
  ('2e000000-0000-4000-8000-000000000a10'::uuid, '2e000000-0000-4000-8000-000000000a01'::uuid, 'owner'),
  ('2e000000-0000-4000-8000-000000000a10'::uuid, '2e000000-0000-4000-8000-000000000a02'::uuid, 'admin'),
  ('2e000000-0000-4000-8000-000000000a10'::uuid, '2e000000-0000-4000-8000-000000000a03'::uuid, 'operator'),
  ('2e000000-0000-4000-8000-000000000a10'::uuid, '2e000000-0000-4000-8000-000000000a04'::uuid, 'viewer'),
  ('2e000000-0000-4000-8000-000000000a11'::uuid, '2e000000-0000-4000-8000-000000000a01'::uuid, 'owner'),
  ('2e000000-0000-4000-8000-000000000b10'::uuid, '2e000000-0000-4000-8000-000000000b01'::uuid, 'owner');

-- Creating -------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000a04';

select extensions.throws_ok(
  $$
    select public.create_organization_invitation(
      '2e000000-0000-4000-8000-000000000a10'::uuid, 'nope@example.com',
      'viewer', repeat('a', 64), now() + interval '7 days')
  $$,
  '42501', null,
  'a viewer cannot invite'
);

set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000a03';

select extensions.throws_ok(
  $$
    select public.create_organization_invitation(
      '2e000000-0000-4000-8000-000000000a10'::uuid, 'nope@example.com',
      'viewer', repeat('a', 64), now() + interval '7 days')
  $$,
  '42501', null,
  'an operator cannot invite'
);

set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000a02';

select extensions.throws_ok(
  $$
    select public.create_organization_invitation(
      '2e000000-0000-4000-8000-000000000a10'::uuid, 'nope@example.com',
      'owner', repeat('a', 64), now() + interval '7 days')
  $$,
  '42501', null,
  'an admin cannot invite someone at owner'
);

select extensions.throws_ok(
  $$
    select public.create_organization_invitation(
      '2e000000-0000-4000-8000-000000000a10'::uuid, 'nope@example.com',
      'admin', repeat('a', 64), now() + interval '7 days')
  $$,
  '42501', null,
  'an admin cannot invite someone at admin either'
);

select extensions.lives_ok(
  $$
    select public.create_organization_invitation(
      '2e000000-0000-4000-8000-000000000a10'::uuid, 'adminop@example.com',
      'operator', repeat('a', 64), now() + interval '7 days')
  $$,
  'an admin can invite an operator'
);

set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000a01';

select extensions.lives_ok(
  $$
    select public.create_organization_invitation(
      '2e000000-0000-4000-8000-000000000a10'::uuid, 'Invitee@Example.com',
      'viewer',
      '1111111111111111111111111111111111111111111111111111111111111111',
      now() + interval '7 days')
  $$,
  'an owner can invite an outsider'
);

select extensions.lives_ok(
  $$
    select public.create_organization_invitation(
      '2e000000-0000-4000-8000-000000000a10'::uuid, 'second-owner@example.com',
      'owner', repeat('b', 64), now() + interval '7 days')
  $$,
  'an owner can invite another owner'
);

select extensions.is(
  (select email from public.organization_invitations
   where token_hash = '1111111111111111111111111111111111111111111111111111111111111111'),
  'invitee@example.com',
  'the address is stored lower-cased so acceptance is a plain equality'
);

select extensions.throws_ok(
  $$
    select public.create_organization_invitation(
      '2e000000-0000-4000-8000-000000000a10'::uuid, 'stale@example.com',
      'viewer', repeat('c', 64), now() - interval '1 day')
  $$,
  '23514', null,
  'an invitation cannot be created already expired'
);

select extensions.throws_ok(
  $$
    select public.create_organization_invitation(
      '2e000000-0000-4000-8000-000000000a10'::uuid, 'operator-o@example.com',
      'viewer', repeat('d', 64), now() + interval '7 days')
  $$,
  '23505', null,
  'someone already an explicit member cannot be invited again'
);

select extensions.throws_ok(
  $$
    select public.create_organization_invitation(
      '2e000000-0000-4000-8000-000000000a11'::uuid, 'nope@example.com',
      'viewer', repeat('d', 64), now() + interval '7 days')
  $$,
  '23514', null,
  'an archived organization refuses invites'
);

-- Isolation ------------------------------------------------------------------

set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000b01';
select extensions.is(
  (select count(*)::bigint from public.organization_invitations),
  0::bigint,
  'another client cannot see the invitation at all'
);
select extensions.throws_ok(
  $$
    select public.create_organization_invitation(
      '2e000000-0000-4000-8000-000000000a10'::uuid, 'stranger@example.com',
      'viewer', repeat('f', 64), now() + interval '7 days')
  $$,
  '42501', null,
  'another client cannot invite into this one'
);

-- A viewer holds no invite permission and reads no pending rows either.
set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000a04';
select extensions.is(
  (select count(*)::bigint from public.organization_invitations),
  0::bigint,
  'a viewer sees no pending invitations'
);

-- Previewing ------------------------------------------------------------------

set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000a05';
select extensions.is(
  (select state from public.preview_organization_invitation(
     '1111111111111111111111111111111111111111111111111111111111111111')),
  'valid',
  'the recipient can preview a live invitation'
);
select extensions.is(
  (select organization_name from public.preview_organization_invitation(
     '1111111111111111111111111111111111111111111111111111111111111111')),
  'Client Alpha',
  'and sees which client invited them'
);
select extensions.is(
  (select inviter_name from public.preview_organization_invitation(
     '1111111111111111111111111111111111111111111111111111111111111111')),
  'Owner O',
  'and who sent it'
);
select extensions.ok(
  (select matches_caller from public.preview_organization_invitation(
     '1111111111111111111111111111111111111111111111111111111111111111')),
  'and that it is addressed to them'
);

set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000a06';
select extensions.ok(
  not (select matches_caller from public.preview_organization_invitation(
     '1111111111111111111111111111111111111111111111111111111111111111')),
  'someone signed in as a different address is told it is not theirs'
);

select extensions.is(
  (select state from public.preview_organization_invitation(repeat('9', 64))),
  'invalid',
  'an unknown token previews as invalid'
);
select extensions.is(
  (select organization_name from public.preview_organization_invitation(repeat('9', 64))),
  null::text,
  'and reveals nothing about any organization'
);

-- The invitation relaxation must not become a way to self-admit. RLS refuses
-- the direct write before the trigger is ever consulted, so the relaxation
-- only has effect inside the security-definer accept function.
set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000a05';
select extensions.throws_ok(
  $$
    insert into public.organization_memberships (
      organization_id, user_id, role
    )
    values (
      '2e000000-0000-4000-8000-000000000a10'::uuid,
      '2e000000-0000-4000-8000-000000000a05'::uuid, 'viewer'
    )
  $$,
  '42501', null,
  'the invitee cannot write their own membership row'
);

-- Accepting -------------------------------------------------------------------

select extensions.lives_ok(
  $$
    select public.accept_organization_invitation(
      '1111111111111111111111111111111111111111111111111111111111111111')
  $$,
  'the invitee accepts'
);
select extensions.is(
  (select role::text from public.organization_memberships
   where organization_id = '2e000000-0000-4000-8000-000000000a10'::uuid
     and user_id = '2e000000-0000-4000-8000-000000000a05'::uuid),
  'viewer',
  'accepting writes exactly the invited role'
);
select extensions.is(
  (select status::text from public.organization_invitations
   where token_hash = '1111111111111111111111111111111111111111111111111111111111111111'),
  'accepted',
  'the invitation is consumed'
);
select extensions.lives_ok(
  $$
    select public.accept_organization_invitation(
      '1111111111111111111111111111111111111111111111111111111111111111')
  $$,
  'a replay by the same person succeeds instead of erroring'
);

set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000a01';
select extensions.lives_ok(
  $$
    select public.create_organization_invitation(
      '2e000000-0000-4000-8000-000000000a10'::uuid, 'nomatch@example.com',
      'viewer', repeat('3', 64), now() + interval '7 days')
  $$,
  'setup: an invitation for an address nobody here holds'
);
select extensions.lives_ok(
  $$
    select public.create_organization_invitation(
      '2e000000-0000-4000-8000-000000000a10'::uuid, 'unconfirmed@example.com',
      'viewer', repeat('4', 64), now() + interval '7 days')
  $$,
  'setup: an invitation for the unconfirmed address'
);

set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000a06';
select extensions.throws_ok(
  $$
    select public.accept_organization_invitation(repeat('3', 64))
  $$,
  '42501', null,
  'holding the link is not enough without the matching address'
);

set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000a07';
select extensions.throws_ok(
  $$
    select public.accept_organization_invitation(repeat('4', 64))
  $$,
  '42501', null,
  'an unconfirmed address cannot accept'
);

-- The ceiling ------------------------------------------------------------------
--
-- Direct membership writes stay open to owners and admins by policy; this
-- trigger is what stops an admin reaching at or above their own role, and
-- what keeps every organization administrable by protecting its last owner.

set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000a02';
select extensions.throws_ok(
  $$
    insert into public.organization_memberships (
      organization_id, user_id, role
    )
    values (
      '2e000000-0000-4000-8000-000000000a10'::uuid,
      '2e000000-0000-4000-8000-000000000a06'::uuid, 'owner'
    )
  $$,
  '42501', null,
  'an admin cannot directly grant owner'
);
select extensions.throws_ok(
  $$
    update public.organization_memberships
    set role = 'admin'
    where organization_id = '2e000000-0000-4000-8000-000000000a10'::uuid
      and user_id = '2e000000-0000-4000-8000-000000000a03'::uuid
  $$,
  '42501', null,
  'an admin cannot promote an operator to admin'
);
select extensions.throws_ok(
  $$
    delete from public.organization_memberships
    where organization_id = '2e000000-0000-4000-8000-000000000a10'::uuid
      and user_id = '2e000000-0000-4000-8000-000000000a01'::uuid
  $$,
  '42501', null,
  'an admin cannot remove the owner'
);

set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000a01';
select extensions.throws_ok(
  $$
    update public.organization_memberships
    set role = 'viewer'
    where organization_id = '2e000000-0000-4000-8000-000000000a10'::uuid
      and user_id = '2e000000-0000-4000-8000-000000000a01'::uuid
  $$,
  'P0001', null,
  'not even an owner demotes the last owner'
);
select extensions.throws_ok(
  $$
    delete from public.organization_memberships
    where organization_id = '2e000000-0000-4000-8000-000000000a10'::uuid
      and user_id = '2e000000-0000-4000-8000-000000000a01'::uuid
  $$,
  'P0001', null,
  'not even an owner removes the last owner'
);
select extensions.lives_ok(
  $$
    delete from public.organization_memberships
    where organization_id = '2e000000-0000-4000-8000-000000000a10'::uuid
      and user_id = '2e000000-0000-4000-8000-000000000a03'::uuid
  $$,
  'an owner can still remove an operator'
);
select extensions.throws_ok(
  $$
    insert into public.organization_memberships (
      organization_id, user_id, role
    )
    values (
      '2e000000-0000-4000-8000-000000000a10'::uuid,
      '2e000000-0000-4000-8000-000000000a06'::uuid, 'viewer'
    )
  $$,
  '42501', null,
  'an outsider cannot write any membership row'
);

-- Listing the team -------------------------------------------------------------
--
-- By this point the team is owner, admin, viewer, and the accepted invitee:
-- the operator row was removed above and the two pending invites carry no
-- membership rows.

set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000a01';
select extensions.is(
  (select count(*)::bigint from public.list_organization_members(
    '2e000000-0000-4000-8000-000000000a10'::uuid)),
  4::bigint,
  'a manager lists the four explicit team rows'
);
select extensions.is(
  (select email from public.list_organization_members(
    '2e000000-0000-4000-8000-000000000a10'::uuid)
   where user_id = '2e000000-0000-4000-8000-000000000a05'::uuid),
  'invitee@example.com',
  'the listing carries addresses for the table'
);

set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000a04';
select extensions.is(
  (select count(*)::bigint from public.list_organization_members(
    '2e000000-0000-4000-8000-000000000a10'::uuid)),
  0::bigint,
  'a viewer lists nobody'
);

-- Revoking and reissuing -------------------------------------------------------

set local request.jwt.claim.sub = '2e000000-0000-4000-8000-000000000a01';
select extensions.lives_ok(
  $$
    select public.revoke_organization_invitation(
      (select id from public.organization_invitations where token_hash = repeat('a', 64)))
  $$,
  'revoking succeeds'
);
select extensions.is(
  (select state from public.preview_organization_invitation(repeat('a', 64))),
  'invalid',
  'a revoked invitation previews as invalid'
);

select extensions.lives_ok(
  $$
    select public.create_organization_invitation(
      '2e000000-0000-4000-8000-000000000a10'::uuid, 'reissued@example.com',
      'operator', repeat('e', 64), now() + interval '7 days')
  $$,
  'setup: a fresh invitation for the reissue round-trip'
);
select extensions.lives_ok(
  $$
    select public.reissue_organization_invitation(
      (select id from public.organization_invitations where token_hash = repeat('e', 64)),
      repeat('5', 64), now() + interval '7 days')
  $$,
  'reissue succeeds'
);
select extensions.is(
  (select state from public.preview_organization_invitation(repeat('e', 64))),
  'invalid',
  'the replaced token stops working immediately'
);
select extensions.is(
  (select state from public.preview_organization_invitation(repeat('5', 64))),
  'valid',
  'the new token works'
);

rollback;
