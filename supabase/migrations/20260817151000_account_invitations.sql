-- Account invitations. See specs/017-account-identity-and-access.md.
--
-- An invitation binds an email address, an account role, and a default
-- organization role to an account, for a bounded time, once.
--
-- The database never holds a credential that grants account access: only the
-- SHA-256 of the token is stored, and the raw value is returned exactly once by
-- the API that minted it. This is the same digest-only discipline
-- `integration_oauth_sessions` already uses for OAuth state.

create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');

create table public.account_invitations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- Stored lower-cased so the acceptance comparison is a plain equality rather
  -- than a rule someone has to remember to apply on both sides.
  email text not null check (email = lower(email) and char_length(email) between 3 and 320),
  account_role public.account_role not null default 'member',
  default_organization_role public.organization_role,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status public.invitation_status not null default 'pending',
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live invitation per address per account. Re-inviting reissues rather than
-- accumulating a second redeemable token for the same person.
create unique index account_invitations_pending_email_idx
  on public.account_invitations(account_id, email)
  where status = 'pending';

create index account_invitations_account_idx
  on public.account_invitations(account_id, created_at desc);

create trigger account_invitations_set_updated_at before update on public.account_invitations
for each row execute function public.set_updated_at();

comment on table public.account_invitations is
  'Pending and historical invitations into an account. Holds only a hash of each token; the raw token exists once, in the response that created it.';

-- Membership by invitation --------------------------------------------------
--
-- Accepting inserts an `account_memberships` row for a user who is, by
-- definition, not yet a member -- so the role-ceiling trigger from
-- 20260817120000 would refuse it: there is no acting member with authority to
-- grant.
--
-- Rather than a bypass flag, the rule the trigger enforces is widened to state
-- what is actually true: a membership is legitimate if someone with authority
-- granted it, **or** if the subject holds a live invitation for exactly that
-- authority. Matching on both roles is what stops the invitation being a route
-- to more than was offered.
--
-- This is not a way to self-admit. The `account_memberships` INSERT policy still
-- requires owner/admin or the account bootstrap, so an invitee writing the row
-- directly is refused by RLS before the trigger is ever consulted. The relaxation
-- only has effect inside `accept_account_invitation`, which is security definer.
create or replace function private.membership_matches_pending_invitation(
  target_account_id uuid,
  target_user_id uuid,
  target_account_role public.account_role,
  target_default_organization_role public.organization_role
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.account_invitations invitation
    join auth.users invited_user on lower(invited_user.email) = invitation.email
    where invitation.account_id = target_account_id
      and invited_user.id = target_user_id
      and invitation.status = 'pending'
      and invitation.expires_at > now()
      and invitation.account_role = target_account_role
      and invitation.default_organization_role
          is not distinct from target_default_organization_role
  );
$$;

revoke all on function private.membership_matches_pending_invitation(
  uuid, uuid, public.account_role, public.organization_role
) from public;

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

  -- Admitted because they were invited to exactly this authority.
  if private.membership_matches_pending_invitation(
       new.account_id, new.user_id, new.account_role, new.default_organization_role
     ) then
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

-- Exposure and policies -----------------------------------------------------
--
-- The revoke is load-bearing: Supabase's default privileges grant `authenticated`
-- every privilege on a new public table, delete included.
revoke all on table public.account_invitations from authenticated, anon;
grant select, insert, update on table public.account_invitations to authenticated;

alter table public.account_invitations enable row level security;

-- The invitee never touches this table. Preview and acceptance are security
-- definer functions with their own explicit checks, which is the only reason a
-- person with no rights on the account can act on a row in it at all.
create policy "members who may read membership can read invitations"
on public.account_invitations for select to authenticated
using (private.has_account_permission(account_id, 'member.read'));

create policy "members who may invite can create invitations"
on public.account_invitations for insert to authenticated
with check (private.has_account_permission(account_id, 'member.invite'));

create policy "members who may invite can update invitations"
on public.account_invitations for update to authenticated
using (private.has_account_permission(account_id, 'member.invite'))
with check (private.has_account_permission(account_id, 'member.invite'));

-- Reading whether an address is already a member ----------------------------
--
-- `authenticated` holds no grant on auth.users, so this cannot be inlined into
-- the invoker functions below. It checks the caller's permission itself, so
-- being executable does not make it an email-enumeration oracle.
create or replace function private.account_has_member_email(
  target_account_id uuid,
  target_email text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_account_permission(target_account_id, 'member.read')
     and exists (
       select 1
       from public.account_memberships membership
       join auth.users member_user on member_user.id = membership.user_id
       where membership.account_id = target_account_id
         and lower(member_user.email) = lower(target_email)
     );
$$;

revoke all on function private.account_has_member_email(uuid, text) from public;
grant execute on function private.account_has_member_email(uuid, text) to authenticated;

-- Recording an account-scoped audit event ------------------------------------
--
-- `audit_events` has RLS with a read policy and no write policy: every existing
-- audit row is written by a security-definer trigger, which bypasses RLS. The
-- invitation functions below are deliberately security *invoker*, so they cannot
-- write there directly.
--
-- This is the narrow definer that can. It is not a general-purpose audit writer:
-- the actor is always the caller, never a parameter, and the caller must belong
-- to the account the row is about. So it can neither forge an actor nor plant a
-- row in another agency's history.
create or replace function private.record_account_audit_event(
  target_account_id uuid,
  target_event_name text,
  target_entity_id uuid,
  target_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_account_member(target_account_id) then
    raise exception 'You cannot record activity for this account.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_events (
    account_id, event_name, actor_type, actor_id, entity_type, entity_id, payload
  )
  values (
    target_account_id, target_event_name, 'user', (select auth.uid()),
    'account_invitations', target_entity_id, coalesce(target_payload, '{}'::jsonb)
  );
end;
$$;

revoke all on function private.record_account_audit_event(uuid, text, uuid, jsonb) from public;
grant execute on function private.record_account_audit_event(uuid, text, uuid, jsonb) to authenticated;

-- Creating an invitation ------------------------------------------------------
--
-- security invoker, so the table's policies apply on top of the explicit checks.
-- The caller computes the token and passes only its hash: the raw value must
-- never cross this boundary, or it would be in the database's logs.
create or replace function public.create_account_invitation(
  p_account_id uuid,
  p_email text,
  p_account_role public.account_role,
  p_default_organization_role public.organization_role,
  p_token_hash text,
  p_expires_at timestamptz
)
returns public.account_invitations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  acting_user uuid := (select auth.uid());
  normalized_email text := lower(trim(p_email));
  actor_role public.account_role;
  recent_count integer;
  created public.account_invitations;
begin
  if acting_user is null then
    raise exception 'Authentication is required.' using errcode = 'insufficient_privilege';
  end if;

  if not private.has_account_permission(p_account_id, 'member.invite') then
    raise exception 'You cannot invite members to this account.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Mirrors the membership role ceiling: an invitation must not be able to
  -- confer authority its sender could not confer directly.
  select membership.account_role into actor_role
  from public.account_memberships membership
  where membership.account_id = p_account_id
    and membership.user_id = acting_user;

  if actor_role <> 'owner' and p_account_role <> 'member' then
    raise exception 'You cannot invite someone at a role at or above your own.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'The invitation lifetime is out of range.'
      using errcode = 'check_violation';
  end if;

  select count(*) into recent_count
  from public.account_invitations invitation
  where invitation.account_id = p_account_id
    and invitation.created_at > now() - interval '1 hour';

  if recent_count >= 20 then
    raise exception 'Too many invitations from this account in the last hour.'
      using errcode = '53400';
  end if;

  if private.account_has_member_email(p_account_id, normalized_email) then
    raise exception 'That person is already a member of this account.'
      using errcode = 'unique_violation';
  end if;

  insert into public.account_invitations (
    account_id, email, account_role, default_organization_role,
    token_hash, invited_by, expires_at
  )
  values (
    p_account_id, normalized_email, p_account_role, p_default_organization_role,
    p_token_hash, acting_user, p_expires_at
  )
  returning * into created;

  perform private.record_account_audit_event(
    p_account_id, 'account_member.invited', created.id,
    jsonb_build_object(
      'accountRole', p_account_role,
      'defaultOrganizationRole', p_default_organization_role,
      'expiresAt', p_expires_at
    )
  );

  return created;
end;
$$;

-- Revoking --------------------------------------------------------------------

create or replace function public.revoke_account_invitation(p_invitation_id uuid)
returns public.account_invitations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  acting_user uuid := (select auth.uid());
  revoked public.account_invitations;
begin
  update public.account_invitations invitation
  set status = 'revoked', revoked_by = acting_user, revoked_at = now()
  where invitation.id = p_invitation_id
    and invitation.status = 'pending'
  returning * into revoked;

  if revoked.id is null then
    raise exception 'That invitation is no longer pending.'
      using errcode = 'no_data_found';
  end if;

  perform private.record_account_audit_event(
    revoked.account_id, 'account_member.invitation_revoked', revoked.id, '{}'::jsonb
  );

  return revoked;
end;
$$;

-- Reissuing -------------------------------------------------------------------
--
-- The raw token is unrecoverable by design, so "send it again" is necessarily
-- "revoke and replace". Both halves happen here so there is no moment where the
-- address has neither a live invitation nor a revoked one.
create or replace function public.reissue_account_invitation(
  p_invitation_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns public.account_invitations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  acting_user uuid := (select auth.uid());
  previous public.account_invitations;
  created public.account_invitations;
begin
  update public.account_invitations invitation
  set status = 'revoked', revoked_by = acting_user, revoked_at = now()
  where invitation.id = p_invitation_id
    and invitation.status = 'pending'
  returning * into previous;

  if previous.id is null then
    raise exception 'That invitation is no longer pending.'
      using errcode = 'no_data_found';
  end if;

  if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'The invitation lifetime is out of range.'
      using errcode = 'check_violation';
  end if;

  insert into public.account_invitations (
    account_id, email, account_role, default_organization_role,
    token_hash, invited_by, expires_at
  )
  values (
    previous.account_id, previous.email, previous.account_role,
    previous.default_organization_role, p_token_hash, acting_user, p_expires_at
  )
  returning * into created;

  perform private.record_account_audit_event(
    created.account_id, 'account_member.invitation_reissued', created.id,
    jsonb_build_object('replacedInvitationId', previous.id)
  );

  return created;
end;
$$;

-- Previewing ------------------------------------------------------------------
--
-- security definer because the recipient has no rights on the account yet.
--
-- Unknown, expired, revoked, and consumed tokens all return the same `invalid`
-- shape with every field null, so the route cannot be used to probe for valid
-- tokens or to learn that an account exists. The one exception is deliberate:
-- the person who already accepted this invitation is told so, because they can
-- learn nothing from it that they do not already know.
create or replace function public.preview_account_invitation(p_token_hash text)
returns table (
  state text,
  account_name text,
  invited_email text,
  inviter_name text,
  account_role public.account_role,
  default_organization_role public.organization_role,
  expires_at timestamptz,
  matches_caller boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with found as (
    select invitation.*, account.name as account_name
    from public.account_invitations invitation
    join public.accounts account on account.id = invitation.account_id
    where invitation.token_hash = p_token_hash
  ),
  caller as (
    select lower(auth_user.email) as email
    from auth.users auth_user
    where auth_user.id = (select auth.uid())
  )
  select
    case
      when found.id is null then 'invalid'
      when found.status = 'accepted' and found.accepted_by = (select auth.uid())
        then 'already_accepted'
      when found.status <> 'pending' then 'invalid'
      when found.expires_at <= now() then 'invalid'
      else 'valid'
    end as state,
    case when found.status = 'pending' and found.expires_at > now()
         then found.account_name end as account_name,
    case when found.status = 'pending' and found.expires_at > now()
         then found.email end as invited_email,
    case when found.status = 'pending' and found.expires_at > now()
         then (select profile.display_name from public.profiles profile
               where profile.id = found.invited_by) end as inviter_name,
    case when found.status = 'pending' and found.expires_at > now()
         then found.account_role end as account_role,
    case when found.status = 'pending' and found.expires_at > now()
         then found.default_organization_role end as default_organization_role,
    case when found.status = 'pending' and found.expires_at > now()
         then found.expires_at end as expires_at,
    case when found.status = 'pending' and found.expires_at > now()
         then coalesce((select caller.email from caller) = found.email, false)
         end as matches_caller
  from (select 1) placeholder
  left join found on true;
$$;

-- Accepting -------------------------------------------------------------------
--
-- One transaction: verify, admit, consume, audit. security definer because the
-- invitee holds no rights on the account until the moment this succeeds.
create or replace function public.accept_account_invitation(p_token_hash text)
returns public.accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_user uuid := (select auth.uid());
  invitation public.account_invitations;
  caller_email text;
  caller_confirmed timestamptz;
  target_account public.accounts;
begin
  if acting_user is null then
    raise exception 'Authentication is required.' using errcode = 'insufficient_privilege';
  end if;

  -- Locked, so two clicks on the same link cannot both admit.
  select * into invitation
  from public.account_invitations existing
  where existing.token_hash = p_token_hash
  for update;

  if invitation.id is null then
    raise exception 'This invitation link is no longer valid.' using errcode = 'no_data_found';
  end if;

  -- A replay by the same person is a success, not an error.
  if invitation.status = 'accepted' and invitation.accepted_by = acting_user then
    select * into target_account from public.accounts
    where accounts.id = invitation.account_id;
    return target_account;
  end if;

  if invitation.status <> 'pending' then
    raise exception 'This invitation link is no longer valid.' using errcode = 'no_data_found';
  end if;

  -- Expiry is evaluated, never trusted from `status`, so a missed sweep can
  -- never admit a stale invitation.
  if invitation.expires_at <= now() then
    raise exception 'This invitation link is no longer valid.' using errcode = 'no_data_found';
  end if;

  select lower(auth_user.email), auth_user.email_confirmed_at
  into caller_email, caller_confirmed
  from auth.users auth_user
  where auth_user.id = acting_user;

  if caller_confirmed is null then
    raise exception 'Confirm your email address before accepting an invitation.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The binding that makes a link safe to send: holding it is not enough.
  if caller_email is distinct from invitation.email then
    raise exception 'This invitation was sent to a different email address.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Membership is inserted before the invitation is consumed, because the
  -- role-ceiling trigger admits this row on the strength of the invitation
  -- still being pending.
  insert into public.account_memberships (
    account_id, user_id, account_role, default_organization_role
  )
  values (
    invitation.account_id, acting_user, invitation.account_role,
    invitation.default_organization_role
  )
  on conflict (account_id, user_id) do nothing;

  update public.account_invitations existing
  set status = 'accepted', accepted_by = acting_user, accepted_at = now()
  where existing.id = invitation.id;

  insert into public.audit_events (
    account_id, event_name, actor_type, actor_id, entity_type, entity_id, payload
  )
  values (
    invitation.account_id, 'account_member.joined', 'user', acting_user,
    'account_invitations', invitation.id,
    jsonb_build_object(
      'accountRole', invitation.account_role,
      'defaultOrganizationRole', invitation.default_organization_role
    )
  );

  select * into target_account from public.accounts
  where accounts.id = invitation.account_id;
  return target_account;
end;
$$;

revoke all on function public.create_account_invitation(
  uuid, text, public.account_role, public.organization_role, text, timestamptz
) from public;
revoke all on function public.revoke_account_invitation(uuid) from public;
revoke all on function public.reissue_account_invitation(uuid, text, timestamptz) from public;
revoke all on function public.preview_account_invitation(text) from public;
revoke all on function public.accept_account_invitation(text) from public;

grant execute on function public.create_account_invitation(
  uuid, text, public.account_role, public.organization_role, text, timestamptz
) to authenticated;
grant execute on function public.revoke_account_invitation(uuid) to authenticated;
grant execute on function public.reissue_account_invitation(uuid, text, timestamptz) to authenticated;
-- Preview is reachable before sign-in: the recipient must be able to read who
-- invited them in order to decide whether to sign in at all.
grant execute on function public.preview_account_invitation(text) to anon, authenticated;
grant execute on function public.accept_account_invitation(text) to authenticated;
