-- New Supabase projects no longer expose SQL-created public tables to the Data API by default.
-- Keep anonymous access closed and grant only the operations used by authenticated application paths.
grant usage on schema public to authenticated;

grant select, update on table public.profiles to authenticated;
grant select, insert, update on table public.organizations to authenticated;
grant select, insert, update, delete on table public.organization_memberships to authenticated;

grant select, insert, update on table public.branches to authenticated;
grant select, insert, update on table public.business_profiles to authenticated;
grant select, insert, update on table public.business_facts to authenticated;
grant select, insert, update on table public.goals to authenticated;
grant select, insert, update on table public.constraints to authenticated;
grant select, insert, update on table public.policies to authenticated;
grant select on table public.audit_events to authenticated;

grant select, insert, update on table public.onboarding_sessions to authenticated;
grant select, insert, update on table public.onboarding_section_states to authenticated;
grant select, insert, update on table public.onboarding_requests to authenticated;
grant select, insert, update on table public.onboarding_uploads to authenticated;
grant select, insert, update on table public.onboarding_extractions to authenticated;
grant select, insert, update on table public.onboarding_extraction_candidates to authenticated;
grant select, insert on table public.ai_readiness_assessments to authenticated;
grant select, insert on table public.onboarding_idempotency_records to authenticated;

-- Owner bootstrap is valid only during the transaction that creates the first membership.
create or replace function private.can_bootstrap_owner(
  target_organization_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations organization
    where organization.id = target_organization_id
      and organization.created_by = target_user_id
      and organization.status = 'draft_onboarding'
      and target_user_id = (select auth.uid())
      and not exists (
        select 1 from public.organization_memberships membership
        where membership.organization_id = target_organization_id
      )
  );
$$;

revoke all on function private.can_bootstrap_owner(uuid, uuid) from public;
grant execute on function private.can_bootstrap_owner(uuid, uuid) to authenticated;

-- UPDATE policies must authorize both the existing row and its proposed tenant scope.
drop policy if exists "authorized members can update organizations" on public.organizations;
create policy "authorized members can update organizations"
on public.organizations for update to authenticated
using (private.has_organization_role(id, array['owner', 'admin']::public.organization_role[]))
with check (private.has_organization_role(id, array['owner', 'admin']::public.organization_role[]));

drop policy if exists "admins can update branches" on public.branches;
create policy "admins can update branches"
on public.branches for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]))
with check (private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]));

drop policy if exists "operators can update business profiles" on public.business_profiles;
create policy "operators can update business profiles"
on public.business_profiles for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]))
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));

drop policy if exists "operators can update business facts" on public.business_facts;
create policy "operators can update business facts"
on public.business_facts for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]))
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));

drop policy if exists "admins can update goals" on public.goals;
create policy "admins can update goals"
on public.goals for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]))
with check (private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]));

drop policy if exists "admins can update constraints" on public.constraints;
create policy "admins can update constraints"
on public.constraints for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]))
with check (private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]));

drop policy if exists "admins can update policies" on public.policies;
create policy "admins can update policies"
on public.policies for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]))
with check (private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[]));

drop policy if exists "operators can update onboarding sessions" on public.onboarding_sessions;
create policy "operators can update onboarding sessions"
on public.onboarding_sessions for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]))
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));

drop policy if exists "operators can update onboarding section states" on public.onboarding_section_states;
create policy "operators can update onboarding section states"
on public.onboarding_section_states for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]))
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));

drop policy if exists "operators can update onboarding requests" on public.onboarding_requests;
create policy "operators can update onboarding requests"
on public.onboarding_requests for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]))
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));

drop policy if exists "operators can update onboarding uploads" on public.onboarding_uploads;
create policy "operators can update onboarding uploads"
on public.onboarding_uploads for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]))
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));

drop policy if exists "operators can update onboarding extractions" on public.onboarding_extractions;
create policy "operators can update onboarding extractions"
on public.onboarding_extractions for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]))
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));

drop policy if exists "operators can update onboarding candidates" on public.onboarding_extraction_candidates;
create policy "operators can update onboarding candidates"
on public.onboarding_extraction_candidates for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]))
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));

drop policy if exists "operators can update onboarding files" on storage.objects;
create policy "operators can update onboarding files"
on storage.objects for update to authenticated
using (
  bucket_id = 'onboarding-files'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and private.has_organization_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin', 'operator']::public.organization_role[])
)
with check (
  bucket_id = 'onboarding-files'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and private.has_organization_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin', 'operator']::public.organization_role[])
);
