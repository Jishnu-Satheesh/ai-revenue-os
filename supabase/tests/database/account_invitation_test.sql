begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(33);

-- Structure -----------------------------------------------------------------

select extensions.has_table('public', 'account_invitations', 'the invitation table exists');
select extensions.is(
  (select relrowsecurity from pg_class where oid = 'public.account_invitations'::regclass),
  true, 'row level security is enabled on invitations'
);
select extensions.is(
  (select count(*)::bigint from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'account_invitations'
     and grantee = 'anon'),
  0::bigint,
  'anonymous callers hold no grant on the invitation table'
);
select extensions.is(
  (select count(*)::bigint from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'account_invitations'
     and grantee = 'authenticated' and privilege_type = 'DELETE'),
  0::bigint,
  'invitations are revoked, never deleted'
);

-- Fixtures ------------------------------------------------------------------

insert into auth.users (id, email, email_confirmed_at)
values
  ('1e000000-0000-4000-8000-000000000a01'::uuid, 'owner-a@example.com', now()),
  ('1e000000-0000-4000-8000-000000000a02'::uuid, 'admin-a@example.com', now()),
  ('1e000000-0000-4000-8000-000000000a03'::uuid, 'member-a@example.com', now()),
  ('1e000000-0000-4000-8000-000000000a04'::uuid, 'invitee@example.com', now()),
  ('1e000000-0000-4000-8000-000000000a05'::uuid, 'someone-else@example.com', now()),
  ('1e000000-0000-4000-8000-000000000a06'::uuid, 'unconfirmed@example.com', null),
  ('1e000000-0000-4000-8000-000000000b01'::uuid, 'owner-b@example.com', now());

insert into public.profiles (id, display_name)
values
  ('1e000000-0000-4000-8000-000000000a01'::uuid, 'Owner A'),
  ('1e000000-0000-4000-8000-000000000a02'::uuid, 'Admin A')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.accounts (id, name, slug, created_by)
values
  ('1e000000-0000-4000-8000-000000000a00'::uuid, 'Invite agency A', 'invite-agency-a',
   '1e000000-0000-4000-8000-000000000a01'::uuid),
  ('1e000000-0000-4000-8000-000000000b00'::uuid, 'Invite agency B', 'invite-agency-b',
   '1e000000-0000-4000-8000-000000000b01'::uuid);

insert into public.account_memberships (account_id, user_id, account_role, default_organization_role)
values
  ('1e000000-0000-4000-8000-000000000a00'::uuid, '1e000000-0000-4000-8000-000000000a01'::uuid, 'owner', null),
  ('1e000000-0000-4000-8000-000000000a00'::uuid, '1e000000-0000-4000-8000-000000000a02'::uuid, 'admin', null),
  ('1e000000-0000-4000-8000-000000000a00'::uuid, '1e000000-0000-4000-8000-000000000a03'::uuid, 'member', 'operator'),
  ('1e000000-0000-4000-8000-000000000b00'::uuid, '1e000000-0000-4000-8000-000000000b01'::uuid, 'owner', null);

-- Creating -------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '1e000000-0000-4000-8000-000000000a03';

select extensions.throws_ok(
  $$
    select public.create_account_invitation(
      '1e000000-0000-4000-8000-000000000a00'::uuid, 'nope@example.com',
      'member', 'viewer', repeat('a', 64), now() + interval '7 days')
  $$,
  '42501', null,
  'an account member cannot invite'
);

set local request.jwt.claim.sub = '1e000000-0000-4000-8000-000000000a02';
select extensions.throws_ok(
  $$
    select public.create_account_invitation(
      '1e000000-0000-4000-8000-000000000a00'::uuid, 'nope@example.com',
      'owner', null, repeat('b', 64), now() + interval '7 days')
  $$,
  '42501', null,
  'an admin cannot invite someone at owner'
);

select extensions.throws_ok(
  $$
    select public.create_account_invitation(
      '1e000000-0000-4000-8000-000000000a00'::uuid, 'nope@example.com',
      'member', 'viewer', repeat('c', 64), now() - interval '1 day')
  $$,
  '23514', null,
  'an invitation cannot be created already expired'
);

select extensions.throws_ok(
  $$
    select public.create_account_invitation(
      '1e000000-0000-4000-8000-000000000a00'::uuid, 'member-a@example.com',
      'member', 'viewer', repeat('d', 64), now() + interval '7 days')
  $$,
  '23505', null,
  'someone already in the account cannot be invited again'
);

set local request.jwt.claim.sub = '1e000000-0000-4000-8000-000000000a01';
select extensions.lives_ok(
  $$
    select public.create_account_invitation(
      '1e000000-0000-4000-8000-000000000a00'::uuid, 'Invitee@Example.com',
      'member', 'operator',
      '1111111111111111111111111111111111111111111111111111111111111111',
      now() + interval '7 days')
  $$,
  'an owner can invite'
);

select extensions.is(
  (select email from public.account_invitations
   where token_hash = '1111111111111111111111111111111111111111111111111111111111111111'),
  'invitee@example.com',
  'the address is stored lower-cased so acceptance is a plain equality'
);

select extensions.throws_ok(
  $$
    select public.create_account_invitation(
      '1e000000-0000-4000-8000-000000000a00'::uuid, 'invitee@example.com',
      'member', 'operator', repeat('e', 64), now() + interval '7 days')
  $$,
  '23505', null,
  'a second live invitation for the same address is refused'
);

-- Isolation ------------------------------------------------------------------

set local request.jwt.claim.sub = '1e000000-0000-4000-8000-000000000b01';
select extensions.is(
  (select count(*)::bigint from public.account_invitations),
  0::bigint,
  'another agency cannot see the invitation at all'
);
select extensions.throws_ok(
  $$
    select public.create_account_invitation(
      '1e000000-0000-4000-8000-000000000a00'::uuid, 'stranger@example.com',
      'member', 'viewer', repeat('f', 64), now() + interval '7 days')
  $$,
  '42501', null,
  'another agency cannot invite into this one'
);

-- A member of the account may not read invitations either: member.read is on
-- the account roles that administer membership, not on every seat.
set local request.jwt.claim.sub = '1e000000-0000-4000-8000-000000000a03';
select extensions.is(
  (select count(*)::bigint from public.account_invitations),
  1::bigint,
  'an account member can read invitations, holding member.read'
);

-- Previewing ------------------------------------------------------------------

set local request.jwt.claim.sub = '1e000000-0000-4000-8000-000000000a04';
select extensions.is(
  (select state from public.preview_account_invitation(
     '1111111111111111111111111111111111111111111111111111111111111111')),
  'valid',
  'the recipient can preview a live invitation'
);
select extensions.is(
  (select account_name from public.preview_account_invitation(
     '1111111111111111111111111111111111111111111111111111111111111111')),
  'Invite agency A',
  'and sees which agency invited them'
);
select extensions.is(
  (select inviter_name from public.preview_account_invitation(
     '1111111111111111111111111111111111111111111111111111111111111111')),
  'Owner A',
  'and who sent it'
);
select extensions.ok(
  (select matches_caller from public.preview_account_invitation(
     '1111111111111111111111111111111111111111111111111111111111111111')),
  'and that it is addressed to them'
);

set local request.jwt.claim.sub = '1e000000-0000-4000-8000-000000000a05';
select extensions.ok(
  not (select matches_caller from public.preview_account_invitation(
     '1111111111111111111111111111111111111111111111111111111111111111')),
  'someone signed in as a different address is told it is not theirs'
);

select extensions.is(
  (select state from public.preview_account_invitation(repeat('9', 64))),
  'invalid',
  'an unknown token previews as invalid'
);
select extensions.is(
  (select account_name from public.preview_account_invitation(repeat('9', 64))),
  null::text,
  'and reveals nothing about any account'
);

-- The role-ceiling widening must not become a way to self-admit. RLS refuses the
-- direct write before the trigger is ever consulted, so the relaxation only has
-- effect inside the security-definer accept function.
set local request.jwt.claim.sub = '1e000000-0000-4000-8000-000000000a04';
select extensions.throws_ok(
  $$
    insert into public.account_memberships (
      account_id, user_id, account_role, default_organization_role
    )
    values (
      '1e000000-0000-4000-8000-000000000a00'::uuid,
      '1e000000-0000-4000-8000-000000000a04'::uuid, 'member', 'operator'
    )
  $$,
  '42501', null,
  'an invitee holding a live invitation still cannot write their own membership row'
);

-- Accepting -------------------------------------------------------------------

set local request.jwt.claim.sub = '1e000000-0000-4000-8000-000000000a05';
select extensions.throws_ok(
  $$
    select public.accept_account_invitation(
      '1111111111111111111111111111111111111111111111111111111111111111')
  $$,
  '42501', null,
  'holding the link is not enough: the address must match'
);

set local request.jwt.claim.sub = '1e000000-0000-4000-8000-000000000a06';
select extensions.throws_ok(
  $$
    select public.accept_account_invitation(
      '1111111111111111111111111111111111111111111111111111111111111111')
  $$,
  '42501', null,
  'an unconfirmed email cannot accept'
);

set local request.jwt.claim.sub = '1e000000-0000-4000-8000-000000000a04';
select extensions.is(
  (select name from public.accept_account_invitation(
     '1111111111111111111111111111111111111111111111111111111111111111')),
  'Invite agency A',
  'the invited address joins the agency'
);
select extensions.is(
  (select account_role::text from public.account_memberships
   where account_id = '1e000000-0000-4000-8000-000000000a00'::uuid
     and user_id = '1e000000-0000-4000-8000-000000000a04'::uuid),
  'member',
  'at exactly the role they were invited to'
);
select extensions.is(
  (select default_organization_role::text from public.account_memberships
   where account_id = '1e000000-0000-4000-8000-000000000a00'::uuid
     and user_id = '1e000000-0000-4000-8000-000000000a04'::uuid),
  'operator',
  'with the organization role the invitation carried'
);
select extensions.is(
  (select count(*)::bigint from public.audit_events
   where account_id = '1e000000-0000-4000-8000-000000000a00'::uuid
     and event_name = 'account_member.joined'),
  1::bigint,
  'joining is audited on the shared spine'
);

-- Replaying the same link is a success, and writes nothing further.
select extensions.lives_ok(
  $$
    select public.accept_account_invitation(
      '1111111111111111111111111111111111111111111111111111111111111111')
  $$,
  'the same person replaying their link succeeds rather than erroring'
);
select extensions.is(
  (select count(*)::bigint from public.audit_events
   where account_id = '1e000000-0000-4000-8000-000000000a00'::uuid
     and event_name = 'account_member.joined'),
  1::bigint,
  'and the replay writes no second membership or audit row'
);

-- Somebody else cannot redeem a consumed token.
set local request.jwt.claim.sub = '1e000000-0000-4000-8000-000000000a05';
select extensions.throws_ok(
  $$
    select public.accept_account_invitation(
      '1111111111111111111111111111111111111111111111111111111111111111')
  $$,
  'P0002', null,
  'a consumed token cannot be redeemed by anyone else'
);

-- Expiry is evaluated, never trusted from `status` ---------------------------

set local role postgres;
insert into public.account_invitations (
  account_id, email, account_role, default_organization_role,
  token_hash, invited_by, expires_at, status
)
values (
  '1e000000-0000-4000-8000-000000000a00'::uuid, 'someone-else@example.com',
  'member', 'viewer',
  '2222222222222222222222222222222222222222222222222222222222222222',
  '1e000000-0000-4000-8000-000000000a01'::uuid,
  now() - interval '1 day', 'pending'
);

set local role authenticated;
set local request.jwt.claim.sub = '1e000000-0000-4000-8000-000000000a05';
select extensions.throws_ok(
  $$
    select public.accept_account_invitation(
      '2222222222222222222222222222222222222222222222222222222222222222')
  $$,
  'P0002', null,
  'an invitation past its expiry is refused even while it still reads pending'
);
select extensions.is(
  (select state from public.preview_account_invitation(
     '2222222222222222222222222222222222222222222222222222222222222222')),
  'invalid',
  'and previews as invalid rather than as expired'
);

select * from extensions.finish();

rollback;
