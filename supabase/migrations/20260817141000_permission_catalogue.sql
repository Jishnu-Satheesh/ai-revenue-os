-- The permission catalogue. See specs/017-account-identity-and-access.md and
-- adrs/0023-permission-as-data-authorization.md.
--
-- Roles are bundles of permissions, and the bundles are rows rather than
-- conditionals scattered through TypeScript. Changing what a role may do is a
-- data change reviewed as a migration, which is the whole point: an
-- authorization change should be readable line by line in a diff.
--
-- The seed rows below are deliberately explicit rather than derived. An
-- expression like "admin is owner minus archive" would be shorter and would
-- hide exactly the class of mistake this table exists to surface.
--
-- src/domain/access/permissions.ts mirrors this for the browser, and
-- src/domain/access/permissions.drift.test.ts fails if the two disagree. The
-- mirror never grants anything; RLS and the account triggers do.
--
-- Nothing consumes these tables yet. They are the vocabulary; the first
-- enforcement is member.invite in the invitations slice. Said plainly here so
-- nobody reads this migration as a claim that permissions are wired in.

create type public.permission_scope as enum ('account', 'organization');

create table public.permissions (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  description text not null check (char_length(description) between 3 and 300),
  scope public.permission_scope not null,
  -- Lets each mapping table carry a composite foreign key, so a permission can
  -- never be mapped onto a role at the wrong scope.
  unique (key, scope)
);

create table public.account_role_permissions (
  account_role public.account_role not null,
  permission_key text not null,
  permission_scope public.permission_scope not null default 'account'
    check (permission_scope = 'account'),
  primary key (account_role, permission_key),
  foreign key (permission_key, permission_scope)
    references public.permissions(key, scope) on delete cascade
);

create table public.organization_role_permissions (
  organization_role public.organization_role not null,
  permission_key text not null,
  permission_scope public.permission_scope not null default 'organization'
    check (permission_scope = 'organization'),
  primary key (organization_role, permission_key),
  foreign key (permission_key, permission_scope)
    references public.permissions(key, scope) on delete cascade
);

comment on table public.permissions is
  'The permission vocabulary. Seeded by migration; no role holds a write grant.';
comment on table public.account_role_permissions is
  'What each agency role may do. A data change, not a code change.';
comment on table public.organization_role_permissions is
  'What each client role may do. A data change, not a code change.';

insert into public.permissions (key, description, scope) values
  ('account.read', 'See the agency and who belongs to it.', 'account'),
  ('account.update', 'Rename the agency and change its settings.', 'account'),
  ('member.read', 'See the agency''s members and pending invitations.', 'account'),
  ('member.invite', 'Invite a new member to the agency.', 'account'),
  ('member.manage_role', 'Change what an existing member is allowed to do.', 'account'),
  ('member.remove', 'Remove a member from the agency.', 'account'),
  ('organization.create', 'Add a new client organization to the agency.', 'account'),
  ('organization.read', 'Open this client and read its workspace.', 'organization'),
  ('organization.update', 'Change this client''s profile, branches, goals, and constraints.', 'organization'),
  ('organization.archive', 'Archive this client.', 'organization'),
  ('onboarding.manage', 'Work through guided onboarding and answer data requests.', 'organization'),
  ('integration.read', 'See connections, data sources, and their health.', 'organization'),
  ('integration.connect', 'Connect a provider or register a data source.', 'organization'),
  ('integration.disconnect', 'Disconnect a provider and revoke its credentials.', 'organization'),
  ('memory.read', 'Read business memory that is not sensitive.', 'organization'),
  ('memory.read_sensitive', 'Read confidential and customer-content memory.', 'organization'),
  ('memory.write', 'Record notes and documents into business memory.', 'organization'),
  ('memory.verify', 'Confirm or reject a proposed memory item.', 'organization'),
  ('memory.supersede', 'Replace a memory item with a corrected version.', 'organization'),
  ('memory.promote_fact', 'Promote a memory item into a business fact.', 'organization'),
  ('opportunity.read', 'Read the revenue opportunity feed.', 'organization'),
  ('opportunity.approve', 'Approve or reject a proposed opportunity.', 'organization'),
  ('campaign.read', 'Read campaigns and their versions.', 'organization'),
  ('campaign.create', 'Create a campaign from a brief or an opportunity.', 'organization'),
  ('campaign.edit', 'Revise a campaign that has not been approved.', 'organization'),
  ('campaign.approve', 'Approve an exact campaign version for execution.', 'organization'),
  ('campaign.publish', 'Publish an approved campaign to a provider.', 'organization'),
  ('economics.read', 'Read channel economics and contribution margin.', 'organization'),
  ('economics.write', 'Record cost components and economic inputs.', 'organization'),
  ('policy.read', 'Read governance policies and approval thresholds.', 'organization'),
  ('policy.update', 'Change governance policies and approval thresholds.', 'organization'),
  ('budget.modify', 'Change spend limits and budgets.', 'organization'),
  ('audit.read', 'Read the audit and decision timeline.', 'organization');

insert into public.account_role_permissions (account_role, permission_key) values
  ('owner', 'account.read'),
  ('owner', 'member.read'),
  ('owner', 'account.update'),
  ('owner', 'member.invite'),
  ('owner', 'member.manage_role'),
  ('owner', 'member.remove'),
  ('owner', 'organization.create'),
  ('admin', 'account.read'),
  ('admin', 'member.read'),
  ('admin', 'account.update'),
  ('admin', 'member.invite'),
  ('admin', 'member.manage_role'),
  ('admin', 'member.remove'),
  ('admin', 'organization.create'),
  ('member', 'account.read'),
  ('member', 'member.read');

insert into public.organization_role_permissions (organization_role, permission_key) values
  ('owner', 'organization.read'),
  ('owner', 'integration.read'),
  ('owner', 'memory.read'),
  ('owner', 'opportunity.read'),
  ('owner', 'campaign.read'),
  ('owner', 'economics.read'),
  ('owner', 'policy.read'),
  ('owner', 'audit.read'),
  ('owner', 'onboarding.manage'),
  ('owner', 'memory.write'),
  ('owner', 'memory.verify'),
  ('owner', 'memory.supersede'),
  ('owner', 'memory.promote_fact'),
  ('owner', 'campaign.create'),
  ('owner', 'campaign.edit'),
  ('owner', 'economics.write'),
  ('owner', 'organization.update'),
  ('owner', 'integration.connect'),
  ('owner', 'integration.disconnect'),
  ('owner', 'memory.read_sensitive'),
  ('owner', 'opportunity.approve'),
  ('owner', 'campaign.approve'),
  ('owner', 'campaign.publish'),
  ('owner', 'policy.update'),
  ('owner', 'budget.modify'),
  ('owner', 'organization.archive'),
  ('admin', 'organization.read'),
  ('admin', 'integration.read'),
  ('admin', 'memory.read'),
  ('admin', 'opportunity.read'),
  ('admin', 'campaign.read'),
  ('admin', 'economics.read'),
  ('admin', 'policy.read'),
  ('admin', 'audit.read'),
  ('admin', 'onboarding.manage'),
  ('admin', 'memory.write'),
  ('admin', 'memory.verify'),
  ('admin', 'memory.supersede'),
  ('admin', 'memory.promote_fact'),
  ('admin', 'campaign.create'),
  ('admin', 'campaign.edit'),
  ('admin', 'economics.write'),
  ('admin', 'organization.update'),
  ('admin', 'integration.connect'),
  ('admin', 'integration.disconnect'),
  ('admin', 'memory.read_sensitive'),
  ('admin', 'opportunity.approve'),
  ('admin', 'campaign.approve'),
  ('admin', 'campaign.publish'),
  ('admin', 'policy.update'),
  ('admin', 'budget.modify'),
  ('operator', 'organization.read'),
  ('operator', 'integration.read'),
  ('operator', 'memory.read'),
  ('operator', 'opportunity.read'),
  ('operator', 'campaign.read'),
  ('operator', 'economics.read'),
  ('operator', 'policy.read'),
  ('operator', 'audit.read'),
  ('operator', 'onboarding.manage'),
  ('operator', 'memory.write'),
  ('operator', 'memory.verify'),
  ('operator', 'memory.supersede'),
  ('operator', 'memory.promote_fact'),
  ('operator', 'campaign.create'),
  ('operator', 'campaign.edit'),
  ('operator', 'economics.write'),
  ('viewer', 'organization.read'),
  ('viewer', 'integration.read'),
  ('viewer', 'memory.read'),
  ('viewer', 'opportunity.read'),
  ('viewer', 'campaign.read'),
  ('viewer', 'economics.read'),
  ('viewer', 'policy.read'),
  ('viewer', 'audit.read');

-- Resolution ----------------------------------------------------------------
--
-- Both helpers resolve through the same access rule as every existing policy:
-- private.effective_organization_role for clients, account membership for the
-- agency. A permission check can therefore never be a way around the tenancy
-- boundary ADR 0022 established.

create or replace function private.has_organization_permission(
  target_organization_id uuid,
  target_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_role_permissions role_permission
    where role_permission.permission_key = target_permission
      and role_permission.organization_role
          = private.effective_organization_role(target_organization_id, (select auth.uid()))
  );
$$;

create or replace function private.has_account_permission(
  target_account_id uuid,
  target_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.account_memberships membership
    join public.account_role_permissions role_permission
      on role_permission.account_role = membership.account_role
    where membership.account_id = target_account_id
      and membership.user_id = (select auth.uid())
      and role_permission.permission_key = target_permission
  );
$$;

revoke all on function private.has_organization_permission(uuid, text) from public;
revoke all on function private.has_account_permission(uuid, text) from public;
grant execute on function private.has_organization_permission(uuid, text) to authenticated;
grant execute on function private.has_account_permission(uuid, text) to authenticated;

-- Readable by any signed-in user so the browser can resolve its own capabilities;
-- writable by nobody, because these tables change by migration only.
--
-- The revoke is not ceremony. This project inherits Supabase's default
-- privileges, under which a table created by `postgres` in `public` grants
-- `authenticated` and `anon` every privilege automatically -- insert, update and
-- delete included. RLS still refuses those writes because no write policy
-- exists, but a catalogue that decides authorization must not be one forgotten
-- policy away from being writable by the people it governs. Two locks, not one.
revoke all on table public.permissions from authenticated, anon;
revoke all on table public.account_role_permissions from authenticated, anon;
revoke all on table public.organization_role_permissions from authenticated, anon;

grant select on table public.permissions to authenticated;
grant select on table public.account_role_permissions to authenticated;
grant select on table public.organization_role_permissions to authenticated;

alter table public.permissions enable row level security;
alter table public.account_role_permissions enable row level security;
alter table public.organization_role_permissions enable row level security;

create policy "signed-in users can read the permission vocabulary"
on public.permissions for select to authenticated using (true);
create policy "signed-in users can read account role permissions"
on public.account_role_permissions for select to authenticated using (true);
create policy "signed-in users can read organization role permissions"
on public.organization_role_permissions for select to authenticated using (true);
