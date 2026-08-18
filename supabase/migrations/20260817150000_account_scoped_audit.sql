-- Account-scoped audit. See specs/017-account-identity-and-access.md.
--
-- `context/06-multi-tenancy-and-security.md` lists membership and role changes
-- first among the things that must be audited. Inviting a teammate is exactly
-- that -- and it belongs to no organization, while `audit_events.organization_id`
-- has been `not null` since the first migration.
--
-- Deliberately widened rather than answered with a second audit table. One spine
-- is the point: a reader asking "what happened, and who did it" should not have
-- to know in advance which of two tables to look in.
--
-- Every existing writer supplies `organization_id` and is unaffected. Every
-- existing reader is organization-scoped, and a null `organization_id` never
-- matches `private.is_organization_member`, so the widening cannot leak an
-- account-scoped row into an organization view.

alter table public.audit_events alter column organization_id drop not null;

alter table public.audit_events
  add column account_id uuid references public.accounts(id) on delete cascade;

alter table public.audit_events
  add constraint audit_events_scope_check
  check (organization_id is not null or account_id is not null);

create index audit_events_account_idx
  on public.audit_events(account_id, occurred_at desc)
  where account_id is not null;

comment on column public.audit_events.account_id is
  'Set for agency-level events that belong to no single client. Exactly one of account_id and organization_id is the row''s scope; both may be set when an event is genuinely both.';

drop policy if exists "members can read audit events" on public.audit_events;
create policy "members can read audit events"
on public.audit_events for select to authenticated
using (
  (organization_id is not null and private.is_organization_member(organization_id))
  or (account_id is not null and private.is_account_member(account_id))
);
