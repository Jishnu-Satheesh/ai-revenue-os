-- Organization invitations. See the approved organization-invitation plan
-- (inline, 2026-09-17): the account-invitation pattern from
-- specs/017-account-identity-and-access.md, re-scoped to one organization.
--
-- An invitation binds an email address and an organization role to one client
-- organization, for a bounded time, once. Unlike account invitations, the
-- invitee needs no agency membership: accepting writes an explicit
-- `organization_memberships` row, which the effective-role union picks up
-- alongside (never instead of) any account-derived grant.
--
-- The database never holds a credential that grants access: only the SHA-256
-- of the token is stored, and the raw value is returned exactly once by the
-- API that minted it.

-- Permissions ---------------------------------------------------------------
--
-- `permissions.key` is the primary key, so the org scope cannot reuse the
-- account-scope `member.*` keys. The dotted `organization.member.*` keys sort
-- next to them in the catalogue and read the same way in policy checks.
insert into public.permissions (key, description, scope) values
  ('organization.member.invite', 'Invite a new member to this client.', 'organization'),
  ('organization.member.manage_role', 'Change what an existing member of this client is allowed to do.', 'organization'),
  ('organization.member.remove', 'Remove a member from this client.', 'organization');

insert into public.organization_role_permissions (organization_role, permission_key) values
  ('owner', 'organization.member.invite'),
  ('owner', 'organization.member.manage_role'),
  ('owner', 'organization.member.remove'),
  ('admin', 'organization.member.invite'),
  ('admin', 'organization.member.manage_role'),
  ('admin', 'organization.member.remove');

-- Table ----------------------------------------------------------------------
--
-- `invitation_status` is reused, not duplicated: one vocabulary for both
-- invitation kinds, so every reader filters the same four values.
create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Stored lower-cased so the acceptance comparison is a plain equality rather
  -- than a rule someone has to remember to apply on both sides.
  email text not null check (email = lower(email) and char_length(email) between 3 and 320),
  role public.organization_role not null default 'viewer',
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

-- One live invitation per address per organization. Re-inviting reissues
-- rather than accumulating a second redeemable token for the same person.
create unique index organization_invitations_pending_email_idx
  on public.organization_invitations(organization_id, email)
  where status = 'pending';

create index organization_invitations_organization_idx
  on public.organization_invitations(organization_id, created_at desc);

create trigger organization_invitations_set_updated_at before update on public.organization_invitations
for each row execute function public.set_updated_at();

comment on table public.organization_invitations is
  'Pending and historical invitations into one client organization. Holds only a hash of each token; the raw token exists once, in the response that created it.';

-- Exposure and policies ------------------------------------------------------
--
-- The revoke is load-bearing: default privileges grant `authenticated`
-- every privilege on a new public table, delete included.
revoke all on table public.organization_invitations from authenticated, anon;
grant select, insert, update on table public.organization_invitations to authenticated;

alter table public.organization_invitations enable row level security;

-- The invitee never touches this table. Preview and acceptance are security
-- definer functions with their own explicit checks, which is the only reason
-- a person with no rights on the organization can act on a row in it at all.
-- Reads are gated on the invite permission itself: whoever may invite may see
-- what is pending, and nobody else needs to.
create policy "members who may invite can read organization invitations"
on public.organization_invitations for select to authenticated
using (private.has_organization_permission(organization_id, 'organization.member.invite'));

create policy "members who may invite can create organization invitations"
on public.organization_invitations for insert to authenticated
with check (private.has_organization_permission(organization_id, 'organization.member.invite'));

create policy "members who may invite can update organization invitations"
on public.organization_invitations for update to authenticated
using (private.has_organization_permission(organization_id, 'organization.member.invite'))
with check (private.has_organization_permission(organization_id, 'organization.member.invite'));

-- Reading whether an address is already an explicit member --------------------
--
-- `authenticated` holds no grant on auth.users, so this cannot be inlined into
-- the invoker functions below. It checks the caller's permission itself, so
-- being executable does not make it an email-enumeration oracle.
create or replace function private.organization_has_explicit_member(
  target_organization_id uuid,
  target_email text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_organization_permission(target_organization_id, 'organization.member.invite')
     and exists (
       select 1
       from public.organization_memberships membership
       join auth.users member_user on member_user.id = membership.user_id
       where membership.organization_id = target_organization_id
         and lower(member_user.email) = lower(target_email)
     );
$$;

revoke all on function private.organization_has_explicit_member(uuid, text) from public;
grant execute on function private.organization_has_explicit_member(uuid, text) to authenticated;

-- Recording an organization-scoped audit event --------------------------------
--
-- `audit_events` has RLS with a read policy and no write policy: every existing
-- audit row is written by a security-definer trigger, which bypasses RLS. The
-- invitation functions below are deliberately security *invoker*, so they cannot
-- write there directly.
--
-- This is the narrow definer that can. The actor is always the caller, never a
-- parameter, and the caller must belong to the organization the row is about.
-- So it can neither forge an actor nor plant a row in another client's history.
-- The account side stays null: `audit_events_scope_check` accepts a row scoped
-- by organization alone, and org members read exactly those rows.
create or replace function private.record_organization_audit_event(
  target_organization_id uuid,
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
  if not private.is_organization_member(target_organization_id) then
    raise exception 'You cannot record activity for this organization.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id, payload
  )
  values (
    target_organization_id, target_event_name, 'user', (select auth.uid()),
    'organization_invitations', target_entity_id, coalesce(target_payload, '{}'::jsonb)
  );
end;
$$;

revoke all on function private.record_organization_audit_event(uuid, text, uuid, jsonb) from public;
grant execute on function private.record_organization_audit_event(uuid, text, uuid, jsonb) to authenticated;

-- Membership by invitation ----------------------------------------------------
--
-- Accepting inserts an `organization_memberships` row for a user who is, by
-- definition, not yet entitled to write it -- an outsider holds no rights on
-- the organization at all. The ceiling trigger below would refuse it, so the
-- rule it enforces is widened to state what is actually true: a membership is
-- legitimate if someone with authority granted it, **or** if the subject holds
-- a live invitation for exactly that authority. Matching on the role is what
-- stops the invitation being a route to more than was offered.
--
-- This is not a way to self-admit. The `organization_memberships` INSERT
-- policy still requires owner/admin or the bootstrap, so an invitee writing
-- the row directly is refused by RLS before the trigger is ever consulted.
-- The relaxation only has effect inside `accept_organization_invitation`,
-- which is security definer.
create or replace function private.membership_matches_pending_org_invitation(
  target_organization_id uuid,
  target_user_id uuid,
  target_role public.organization_role
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_invitations invitation
    join auth.users invited_user on lower(invited_user.email) = invitation.email
    where invitation.organization_id = target_organization_id
      and invited_user.id = target_user_id
      and invitation.status = 'pending'
      and invitation.expires_at > now()
      and invitation.role = target_role
  );
$$;

revoke all on function private.membership_matches_pending_org_invitation(
  uuid, uuid, public.organization_role
) from public;

-- Creating an invitation ------------------------------------------------------
--
-- security invoker, so the table's policies apply on top of the explicit checks.
-- The caller computes the token and passes only its hash: the raw value must
-- never cross this boundary, or it would be in the database's logs.
create or replace function public.create_organization_invitation(
  p_organization_id uuid,
  p_email text,
  p_role public.organization_role,
  p_token_hash text,
  p_expires_at timestamptz
)
returns public.organization_invitations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  acting_user uuid := (select auth.uid());
  normalized_email text := lower(trim(p_email));
  actor_role public.organization_role;
  org_status text;
  recent_count integer;
  created public.organization_invitations;
begin
  if acting_user is null then
    raise exception 'Authentication is required.' using errcode = 'insufficient_privilege';
  end if;

  select status::text into org_status
  from public.organizations organization
  where organization.id = p_organization_id;

  if org_status is null then
    raise exception 'That organization does not exist.' using errcode = 'no_data_found';
  end if;

  if org_status = 'archived' then
    raise exception 'That organization is archived.' using errcode = 'check_violation';
  end if;

  if not private.has_organization_permission(p_organization_id, 'organization.member.invite') then
    raise exception 'You cannot invite members to this organization.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Mirrors the membership role ceiling: an invitation must not be able to
  -- confer authority its sender could not confer directly. The effective role
  -- is what counts, so an agency owner acting inside a client is its owner.
  actor_role := private.effective_organization_role(p_organization_id);

  if actor_role <> 'owner' and p_role not in ('operator', 'viewer') then
    raise exception 'You cannot invite someone at a role at or above your own.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'The invitation lifetime is out of range.'
      using errcode = 'check_violation';
  end if;

  select count(*) into recent_count
  from public.organization_invitations invitation
  where invitation.organization_id = p_organization_id
    and invitation.created_at > now() - interval '1 hour';

  if recent_count >= 20 then
    raise exception 'Too many invitations from this organization in the last hour.'
      using errcode = '53400';
  end if;

  -- An explicit row already answers the invitation: re-inviting would only
  -- stack a redundant grant. (Account-derived access alone does not block an
  -- invite; the explicit row documents the client's own decision.)
  if private.organization_has_explicit_member(p_organization_id, normalized_email) then
    raise exception 'That person is already a member of this organization.'
      using errcode = 'unique_violation';
  end if;

  insert into public.organization_invitations (
    organization_id, email, role,
    token_hash, invited_by, expires_at
  )
  values (
    p_organization_id, normalized_email, p_role,
    p_token_hash, acting_user, p_expires_at
  )
  returning * into created;

  perform private.record_organization_audit_event(
    p_organization_id, 'organization_member.invited', created.id,
    jsonb_build_object(
      'organizationRole', p_role,
      'expiresAt', p_expires_at
    )
  );

  return created;
end;
$$;

-- Revoking --------------------------------------------------------------------
--
-- The update policy scopes the row to organizations the caller may invite to,
-- so there is no moment where a caller outside the client can touch it.
create or replace function public.revoke_organization_invitation(p_invitation_id uuid)
returns public.organization_invitations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  acting_user uuid := (select auth.uid());
  revoked public.organization_invitations;
begin
  update public.organization_invitations invitation
  set status = 'revoked', revoked_by = acting_user, revoked_at = now()
  where invitation.id = p_invitation_id
    and invitation.status = 'pending'
  returning * into revoked;

  if revoked.id is null then
    raise exception 'That invitation is no longer pending.'
      using errcode = 'no_data_found';
  end if;

  perform private.record_organization_audit_event(
    revoked.organization_id, 'organization_member.invitation_revoked', revoked.id, '{}'::jsonb
  );

  return revoked;
end;
$$;

-- Reissuing -------------------------------------------------------------------
--
-- The raw token is unrecoverable by design, so "send it again" is necessarily
-- "revoke and replace". Both halves happen here so there is no moment where the
-- address has neither a live invitation nor a revoked one.
create or replace function public.reissue_organization_invitation(
  p_invitation_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns public.organization_invitations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  acting_user uuid := (select auth.uid());
  previous public.organization_invitations;
  created public.organization_invitations;
begin
  update public.organization_invitations invitation
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

  insert into public.organization_invitations (
    organization_id, email, role,
    token_hash, invited_by, expires_at
  )
  values (
    previous.organization_id, previous.email, previous.role,
    p_token_hash, acting_user, p_expires_at
  )
  returning * into created;

  perform private.record_organization_audit_event(
    created.organization_id, 'organization_member.invitation_reissued', created.id,
    jsonb_build_object('replacedInvitationId', previous.id)
  );

  return created;
end;
$$;

-- Previewing ------------------------------------------------------------------
--
-- security definer because the recipient has no rights on the organization yet.
--
-- Unknown, expired, revoked, and consumed tokens all return the same `invalid`
-- shape with every field null, so the route cannot be used to probe for valid
-- tokens or to learn that an organization exists. The one exception is
-- deliberate: the person who already accepted this invitation is told so,
-- because they can learn nothing from it that they do not already know.
create or replace function public.preview_organization_invitation(p_token_hash text)
returns table (
  state text,
  organization_name text,
  invited_email text,
  inviter_name text,
  role public.organization_role,
  expires_at timestamptz,
  matches_caller boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with found as (
    select invitation.*, organization.name as organization_name
    from public.organization_invitations invitation
    join public.organizations organization on organization.id = invitation.organization_id
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
         then found.organization_name end as organization_name,
    case when found.status = 'pending' and found.expires_at > now()
         then found.email end as invited_email,
    case when found.status = 'pending' and found.expires_at > now()
         then (select profile.display_name from public.profiles profile
               where profile.id = found.invited_by) end as inviter_name,
    case when found.status = 'pending' and found.expires_at > now()
         then found.role end as role,
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
-- invitee holds no rights on the organization until the moment this succeeds.
create or replace function public.accept_organization_invitation(p_token_hash text)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  acting_user uuid := (select auth.uid());
  invitation public.organization_invitations;
  caller_email text;
  caller_confirmed timestamptz;
  target_organization public.organizations;
begin
  if acting_user is null then
    raise exception 'Authentication is required.' using errcode = 'insufficient_privilege';
  end if;

  -- Locked, so two clicks on the same link cannot both admit.
  select * into invitation
  from public.organization_invitations existing
  where existing.token_hash = p_token_hash
  for update;

  if invitation.id is null then
    raise exception 'This invitation link is no longer valid.' using errcode = 'no_data_found';
  end if;

  -- A replay by the same person is a success, not an error.
  if invitation.status = 'accepted' and invitation.accepted_by = acting_user then
    select * into target_organization from public.organizations
    where organizations.id = invitation.organization_id;
    return target_organization;
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
  -- ceiling trigger admits this row on the strength of the invitation
  -- still being pending. An existing explicit row keeps its role: grants
  -- only ever add authority, so accepting can never demote.
  insert into public.organization_memberships (
    organization_id, user_id, role
  )
  values (
    invitation.organization_id, acting_user, invitation.role
  )
  on conflict (organization_id, user_id) do nothing;

  update public.organization_invitations existing
  set status = 'accepted', accepted_by = acting_user, accepted_at = now()
  where existing.id = invitation.id;

  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id, payload
  )
  values (
    invitation.organization_id, 'organization_member.joined', 'user', acting_user,
    'organization_invitations', invitation.id,
    jsonb_build_object('organizationRole', invitation.role)
  );

  select * into target_organization from public.organizations
  where organizations.id = invitation.organization_id;

  return target_organization;
end;
$$;

-- The membership role ceiling --------------------------------------------------
--
-- The `organization_memberships` RLS policies let owners and admins write rows
-- directly, which is also what the Team Members table uses for role changes
-- and removals. Without a ceiling, an admin could grant owner -- authority
-- its own invitation flow refuses to confer. This trigger is that ceiling,
-- mirroring `private.enforce_account_role_ceiling`.
--
-- Two guards share it: the ceiling (who may grant what) and the last-owner
-- rule (nobody may demote or remove the final owner, not even an owner).
create or replace function private.enforce_organization_role_ceiling()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  target_role public.organization_role;
  other_owners integer;
begin
  -- Bootstrap and privileged/system paths carry no authenticated actor.
  if (select auth.uid()) is null then
    return coalesce(new, old);
  end if;

  if TG_OP = 'INSERT' then
    target_role := new.role;
  elsif TG_OP = 'UPDATE' then
    target_role := new.role;
  else
    target_role := old.role;
  end if;

  -- Admitted because they were invited to exactly this authority.
  if TG_OP = 'INSERT' and private.membership_matches_pending_org_invitation(
       new.organization_id, new.user_id, new.role
     ) then
    return new;
  end if;

  -- The organization's creator laying down its first owner row.
  if TG_OP = 'INSERT'
     and private.can_bootstrap_owner(new.organization_id, new.user_id) then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    actor_role := private.effective_organization_role(new.organization_id);
  else
    actor_role := private.effective_organization_role(old.organization_id);
  end if;

  if actor_role is null then
    raise exception 'Only a member of this organization can grant access to it.'
      using errcode = 'insufficient_privilege';
  end if;

  if actor_role = 'owner' then
    -- Owners clear the ceiling; the last-owner rule below still applies.
    null;
  elsif actor_role = 'admin'
     and target_role in ('operator', 'viewer')
     and (TG_OP = 'INSERT' or old.role in ('operator', 'viewer')) then
    -- An admin moving a non-elevated row between non-elevated roles.
    null;
  else
    raise exception 'You cannot grant an organization role at or above your own.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Nobody demotes or removes the final owner, because that organization
  -- would be left with no one able to administer it.
  if (TG_OP = 'UPDATE' and old.role = 'owner' and new.role is distinct from 'owner')
     or (TG_OP = 'DELETE' and old.role = 'owner') then
    select count(*) into other_owners
    from public.organization_memberships membership
    where membership.organization_id = old.organization_id
      and membership.role = 'owner'
      and membership.user_id is distinct from old.user_id;

    if other_owners = 0 then
      raise exception 'An organization must keep at least one owner.'
        using errcode = 'P0001';
    end if;
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger organization_memberships_role_ceiling
before insert or update or delete on public.organization_memberships
for each row execute function private.enforce_organization_role_ceiling();

comment on function private.enforce_organization_role_ceiling() is
  'Role ceiling for direct membership writes: owner anything, admin only below admin, invitation-backed accepts admitted, and the last owner can never be demoted or removed.';

-- Listing the team ------------------------------------------------------------
--
-- Member email addresses live in `auth.users`, on which `authenticated` holds
-- no grant -- that is what stops the membership table doubling as an address
-- book for anyone who can read it. The Team Members table legitimately needs
-- them, so this narrow definer joins them in, gated on a team permission and
-- scoped to the one organization. It returns explicit grants only, never
-- account-derived access: the table shows who was deliberately added.
create or replace function public.list_organization_members(p_organization_id uuid)
returns table (
  user_id uuid,
  email text,
  display_name text,
  role public.organization_role,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select membership.user_id, member_user.email, profile.display_name,
         membership.role, membership.created_at
  from public.organization_memberships membership
  join auth.users member_user on member_user.id = membership.user_id
  left join public.profiles profile on profile.id = membership.user_id
  where membership.organization_id = p_organization_id
    and (
      private.has_organization_permission(p_organization_id, 'organization.member.invite')
      or private.has_organization_permission(p_organization_id, 'organization.member.manage_role')
      or private.has_organization_permission(p_organization_id, 'organization.member.remove')
    )
  order by membership.created_at asc;
$$;

revoke all on function public.list_organization_members(uuid) from public;
grant execute on function public.list_organization_members(uuid) to authenticated;

comment on function public.list_organization_members(uuid) is
  'Explicit team rows with addresses for team managers, one organization at a time. Permission-gated inside; the join on auth.users never leaves this function.';

-- Auditing direct membership changes -------------------------------------------
--
-- Invitation accepts audit themselves inside `accept_organization_invitation`.
-- This trigger covers the other two writes: role changes and removals made
-- directly by owners and admins. It skips touches that leave the role alone
-- (for example, timestamp maintenance), so the timeline records decisions,
-- not housekeeping.
create or replace function private.audit_organization_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE' then
    if new.role is not distinct from old.role then
      return new;
    end if;
    insert into public.audit_events (
      organization_id, event_name, actor_type, actor_id,
      entity_type, entity_id, payload
    )
    values (
      new.organization_id, 'organization_member.role_changed', 'user', (select auth.uid()),
      'organization_memberships', new.user_id,
      jsonb_build_object('fromRole', old.role, 'toRole', new.role)
    );
    return new;
  end if;

  if TG_OP = 'DELETE' then
    insert into public.audit_events (
      organization_id, event_name, actor_type, actor_id,
      entity_type, entity_id, payload
    )
    values (
      old.organization_id, 'organization_member.removed', 'user', (select auth.uid()),
      'organization_memberships', old.user_id,
      jsonb_build_object('role', old.role)
    );
    return old;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger organization_memberships_audit_change
after update or delete on public.organization_memberships
for each row execute function private.audit_organization_membership_change();
