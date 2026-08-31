-- Evaluate the remaining read policies once per query, not once per row.
--
-- Completes what 20260831130000 began for the report domain. Same defect, same
-- fix, applied to the other 75 SELECT policies: each called
-- private.is_organization_member, has_organization_permission,
-- has_organization_role, is_account_member or has_account_permission with the
-- row's own column, which correlates the call and forces Postgres to re-run it
-- for every row. Each now asks the set-returning helper instead (added in
-- 20260831120000 and 20260831140000), which takes no row as input, so the
-- planner builds the answer once.
--
-- Worst case measured on staging before this ran: audit_events at 4,402 ms and
-- 29,617 buffers for a single scan of 7,349 rows.
--
-- Every statement below was generated from pg_policies and had its predicate
-- proved equivalent before applying, rather than hand-transcribed. Across all
-- five principals and all 75 tables (17,183 rows scanned per principal) the old
-- and new predicates admitted exactly the same rows: 17,183 for the three
-- account holders, 218 for the direct-only member, 43 for anonymous, zero
-- disagreements. The compound predicates -- audit_events' organization-or-account
-- branch and memory_items' sensitivity gate -- were rewritten branch by branch
-- and are covered by that proof.
--
-- Only SELECT policies change. INSERT, UPDATE and DELETE policies keep the
-- scalar forms: they run against one row at a time, so they are not the cost,
-- and widening this into the write path would enlarge the blast radius for no
-- gain.

do $guard$
declare
  expected constant integer := 75;
  found integer;
begin
  select count(*)::integer into found
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and cmd = 'SELECT'
    and qual is not null
    and qual not like '%organizations_with_%'
    and qual not like '%accounts_with_%'
    and (qual like '%private.is_organization_member%'
      or qual like '%private.has_organization_permission%'
      or qual like '%private.has_organization_role%'
      or qual like '%private.is_account_member%'
      or qual like '%private.has_account_permission%');

  if found <> expected then
    raise exception
      'expected % per-row select policies to convert, found % - refusing to rewrite an unexpected policy set',
      expected, found
      using errcode = '55000';
  end if;
end;
$guard$;

alter policy "members who may read membership can read invitations"
  on public.account_invitations
  using ((account_id in (select private.accounts_with_permission('member.read'::text))));

alter policy "members can read account memberships"
  on public.account_memberships
  using ((account_id in (select private.accounts_with_membership())));

alter policy "members can read their account"
  on public.accounts
  using (((id in (select private.accounts_with_membership())) OR (created_by = ( SELECT auth.uid() AS uid))));

alter policy "members can read onboarding assessments"
  on public.ai_readiness_assessments
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members can read audit events"
  on public.audit_events
  using ((((organization_id IS NOT NULL) AND (organization_id in (select private.organizations_with_membership()))) OR ((account_id IS NOT NULL) AND (account_id in (select private.accounts_with_membership())))));

alter policy "members can read business facts"
  on public.business_facts
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members can read business profiles"
  on public.business_profiles
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read action runs"
  on public.campaign_action_runs
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "campaign_ads_objects_member_read"
  on public.campaign_ads_objects
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "campaign_allocation_events_member_read"
  on public.campaign_allocation_events
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read approvals"
  on public.campaign_approvals
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read campaign assets"
  on public.campaign_assets
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read campaign briefs"
  on public.campaign_briefs
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read budget reservations"
  on public.campaign_budget_reservations
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read bundle versions"
  on public.campaign_bundle_versions
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read channel actions"
  on public.campaign_channel_actions
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read creative directions"
  on public.campaign_creative_directions
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read creative variants"
  on public.campaign_creative_variants
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "campaign_exposures_member_read"
  on public.campaign_exposures
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read campaign generation runs"
  on public.campaign_generation_runs
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "campaign_learning_proposals_member_read"
  on public.campaign_learning_proposals
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read measurement plans"
  on public.campaign_measurement_plans
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "campaign_metric_observations_member_read"
  on public.campaign_metric_observations
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "campaign_outcomes_member_read"
  on public.campaign_outcomes
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "campaign_pause_runs_member_read"
  on public.campaign_pause_runs
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read campaign plate edits"
  on public.campaign_plate_edits
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read campaign poster renders"
  on public.campaign_poster_renders
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "signed-in users read shared poster templates"
  on public.campaign_poster_templates
  using (((organization_id IS NULL) OR (organization_id in (select private.organizations_with_membership()))));

alter policy "members read campaign snapshots"
  on public.campaign_source_snapshots
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "campaign_variant_resumes_member_read"
  on public.campaign_variant_resumes
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read attestations"
  on public.campaign_visual_attestations
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read campaigns"
  on public.campaigns
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members with report read can view channel analysis runs"
  on public.channel_analysis_runs
  using ((organization_id in (select private.organizations_with_permission('report.read'::text))));

alter policy "members can read channel economics components"
  on public.channel_economics_components
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members can read channel economics entries"
  on public.channel_economics_entries
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members with report read can view channel finding evidence"
  on public.channel_finding_evidence
  using ((organization_id in (select private.organizations_with_permission('report.read'::text))));

alter policy "members with report read can view channel findings"
  on public.channel_findings
  using ((organization_id in (select private.organizations_with_permission('report.read'::text))));

alter policy "members with report read can view channel recommendation citati"
  on public.channel_recommendation_citations
  using ((organization_id in (select private.organizations_with_permission('report.read'::text))));

alter policy "members with report read can view channel recommendation decisi"
  on public.channel_recommendation_decisions
  using ((organization_id in (select private.organizations_with_permission('report.read'::text))));

alter policy "members with report read can view channel recommendation evalua"
  on public.channel_recommendation_evaluations
  using ((organization_id in (select private.organizations_with_permission('report.read'::text))));

alter policy "members with report read can view channel recommendation feedba"
  on public.channel_recommendation_feedback
  using ((organization_id in (select private.organizations_with_permission('report.read'::text))));

alter policy "members with report read can view channel recommendations"
  on public.channel_recommendations
  using ((organization_id in (select private.organizations_with_permission('report.read'::text))));

alter policy "members with channel read can view channel source aliases"
  on public.channel_source_aliases
  using ((organization_id in (select private.organizations_with_permission('channel.read'::text))));

alter policy "members can read constraints"
  on public.constraints
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members can read cost component definitions"
  on public.cost_component_definitions
  using (((organization_id IS NULL) OR (organization_id in (select private.organizations_with_membership()))));

alter policy "admins can read cost component rates"
  on public.cost_component_rates
  using ((organization_id in (select private.organizations_with_any_role(ARRAY['owner'::organization_role, 'admin'::organization_role]))));

alter policy "members read creative asset reviews"
  on public.creative_asset_reviews
  using ((organization_id in (select private.organizations_with_permission('asset.read'::text))));

alter policy "members can read goals"
  on public.goals
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members can read integration account mappings"
  on public.integration_account_mappings
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members can read integration capability grants"
  on public.integration_capability_grants
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members can read integration connections"
  on public.integration_connections
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members can read integration data sources"
  on public.integration_data_sources
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members can read integration health checks"
  on public.integration_health_checks
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members can read integration ingestion runs"
  on public.integration_ingestion_runs
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read memory within their sensitivity ceiling"
  on public.memory_items
  using (((organization_id in (select private.organizations_with_membership())) AND ((sensitivity = ANY (ARRAY['public'::text, 'internal'::text])) OR (organization_id in (select private.organizations_with_any_role(ARRAY['owner'::organization_role, 'admin'::organization_role]))))));

alter policy "members read memory links"
  on public.memory_links
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read their retrieval log"
  on public.memory_retrieval_log
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members can read metric definitions"
  on public.metric_definitions
  using (((organization_id IS NULL) OR (organization_id in (select private.organizations_with_membership()))));

alter policy "members can read onboarding candidates"
  on public.onboarding_extraction_candidates
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members can read onboarding extractions"
  on public.onboarding_extractions
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "operators can read onboarding idempotency records"
  on public.onboarding_idempotency_records
  using ((organization_id in (select private.organizations_with_any_role(ARRAY['owner'::organization_role, 'admin'::organization_role, 'operator'::organization_role]))));

alter policy "members can read onboarding requests"
  on public.onboarding_requests
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members can read onboarding section states"
  on public.onboarding_section_states
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members can read onboarding sessions"
  on public.onboarding_sessions
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members can read onboarding uploads"
  on public.onboarding_uploads
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members can read opportunities"
  on public.opportunities
  using ((organization_id in (select private.organizations_with_any_role(ARRAY['owner'::organization_role, 'admin'::organization_role, 'operator'::organization_role, 'viewer'::organization_role]))));

alter policy "members read brand asset versions"
  on public.organization_brand_asset_versions
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read brand assets"
  on public.organization_brand_assets
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members with channel read can view channel branch mappings"
  on public.organization_channel_branches
  using ((organization_id in (select private.organizations_with_permission('channel.read'::text))));

alter policy "members can read memberships"
  on public.organization_memberships
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read organization subject profiles"
  on public.organization_subject_profiles
  using ((organization_id in (select private.organizations_with_permission('asset.read'::text))));

alter policy "members can read organizations"
  on public.organizations
  using (((id in (select private.organizations_with_membership())) OR (created_by = ( SELECT auth.uid() AS uid))));

alter policy "members can read policies"
  on public.policies
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read provider receipts"
  on public.provider_receipts
  using ((organization_id in (select private.organizations_with_membership())));

alter policy "members read tool invocations"
  on public.tool_invocations
  using ((organization_id in (select private.organizations_with_membership())));
