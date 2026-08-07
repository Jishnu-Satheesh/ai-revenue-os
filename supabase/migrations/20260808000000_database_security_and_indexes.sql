-- Keep the Data API closed to anonymous callers. RLS remains the final tenant boundary,
-- but unauthenticated roles do not need table privileges for this application.
alter default privileges in schema public revoke all privileges on tables from anon;

revoke all privileges on table
  public.profiles,
  public.organizations,
  public.organization_memberships,
  public.onboarding_sessions,
  public.onboarding_section_states,
  public.onboarding_requests,
  public.onboarding_uploads,
  public.onboarding_extractions,
  public.onboarding_extraction_candidates,
  public.ai_readiness_assessments,
  public.onboarding_idempotency_records,
  public.branches,
  public.business_profiles,
  public.business_facts,
  public.goals,
  public.constraints,
  public.policies,
  public.audit_events
from anon;

-- The timestamp trigger must not resolve objects through a caller-controlled search path.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;

-- Cover every foreign key reported by the Supabase performance advisor. These indexes
-- support referential actions and the user/session filters used by operator workflows.
create index ai_readiness_assessments_created_by_idx
  on public.ai_readiness_assessments(created_by);
create index ai_readiness_assessments_organization_session_idx
  on public.ai_readiness_assessments(organization_id, session_id);
create index business_facts_created_by_idx
  on public.business_facts(created_by);
create index business_facts_updated_by_idx
  on public.business_facts(updated_by);
create index business_profiles_updated_by_idx
  on public.business_profiles(updated_by);
create index constraints_created_by_idx
  on public.constraints(created_by);
create index goals_organization_scope_branch_idx
  on public.goals(organization_id, scope_branch_id);
create index goals_owner_idx
  on public.goals(owner_id);
create index onboarding_candidates_reviewed_by_idx
  on public.onboarding_extraction_candidates(reviewed_by);
create index onboarding_idempotency_records_created_by_idx
  on public.onboarding_idempotency_records(created_by);
create index onboarding_requests_assignee_idx
  on public.onboarding_requests(assignee_user_id);
create index onboarding_requests_created_by_idx
  on public.onboarding_requests(created_by);
create index onboarding_requests_organization_session_idx
  on public.onboarding_requests(organization_id, session_id);
create index onboarding_requests_updated_by_idx
  on public.onboarding_requests(updated_by);
create index onboarding_section_states_organization_session_idx
  on public.onboarding_section_states(organization_id, session_id);
create index onboarding_section_states_updated_by_idx
  on public.onboarding_section_states(updated_by);
create index onboarding_sessions_owner_idx
  on public.onboarding_sessions(owner_id);
create index onboarding_uploads_created_by_idx
  on public.onboarding_uploads(created_by);
create index onboarding_uploads_organization_session_idx
  on public.onboarding_uploads(organization_id, session_id);
create index organizations_created_by_idx
  on public.organizations(created_by);
create index policies_created_by_idx
  on public.policies(created_by);
create index policies_updated_by_idx
  on public.policies(updated_by);
