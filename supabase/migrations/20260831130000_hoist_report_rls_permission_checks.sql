-- Evaluate the report domain's read policies once per query, not once per row.
--
-- Every policy below asks the same question its predecessor asked. The only
-- change is that it asks through the set-returning helpers added in
-- 20260831120000, which take no row as input, so the planner builds the answer
-- once as a hashed SubPlan instead of re-deriving it for each row.
--
-- Why this was worth a migration: on staging,
-- `list_governed_report_projection_reconciliation_groups` took 14,890 ms and
-- 174,195 buffers as a signed-in user against 135 ms and 3,256 buffers with RLS
-- off. The plan showed `Filter: (SubPlan 1)` with `loops=1876` — one permission
-- check per row at 0.638 ms, each running a `union all` over
-- `organization_memberships` and `account_memberships`. That is what pushed
-- GET /api/organizations/:id/report-packages past its statement timeout and
-- broke the Integration Hub's Data sources tab.
--
-- Note for anyone repeating this elsewhere: wrapping the existing call as
-- `(select private.has_organization_permission(organization_id, ...))` does NOT
-- fix it. That wrapper only hoists an *uncorrelated* subquery, and referencing
-- `organization_id` keeps it correlated. Two of the policies below already
-- carried that wrapper and still showed `loops=1876`.
--
-- Equivalence was proved against staging before this was applied: 860
-- (user, organization, permission) pairs across every user and every permission
-- key — 536 allow, 324 deny — agreed exactly between the old predicate and the
-- new one, as did the membership predicate. Separately, all 6,998 rows in the
-- twenty tables resolved to identical visibility for all five principals.
--
-- Only SELECT policies change. The INSERT and UPDATE policies on `branches` and
-- `organization_channels` are untouched: they run against one row at a time and
-- are not the cost, and widening this change into the write path would enlarge
-- the blast radius for no gain.

do $guard$
declare
  expected_policies constant integer := 20;
  found_policies integer;
begin
  select count(*)::integer into found_policies
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and cmd = 'SELECT'
    and (tablename, policyname) in (
      ('branches', 'members can read branches'),
      ('exact_range_metric_observations', 'members with report read can view exact range metric observatio'),
      ('integration_report_packages', 'members with report read can view report packages'),
      ('integration_report_projection_runs', 'members with report read can view report projection runs'),
      ('integration_report_sheet_manifests', 'members with report read can view report sheet manifests'),
      ('integration_report_validation_control_results', 'members with report read can view report validation control res'),
      ('integration_report_validation_runs', 'members with report read can view report validation runs'),
      ('integration_report_validation_sheet_results', 'members with report read can view report validation sheet resul'),
      ('normalized_metrics', 'members can read normalized metrics'),
      ('organization_channels', 'members with channel read can view organization channels'),
      ('report_contract_bindings', 'members with report read can view report contract bindings'),
      ('report_contract_decisions', 'members with report read can view report contract decisions'),
      ('report_contract_versions', 'members with report read can view report contract versions'),
      ('report_contracts', 'members with report read can view report contracts'),
      ('report_projection_bindings', 'members with report read can view report projection bindings'),
      ('report_projection_decisions', 'members with report read can view report projection decisions'),
      ('report_projection_lineage', 'members with report read can view report projection lineage'),
      ('report_projection_reconciliation_resolutions', 'members with report read can view report projection reconciliat'),
      ('report_projection_reconciliations', 'members with report read can view report projection reconciliat'),
      ('report_projection_versions', 'members with report read can view report projection versions')
    );

  if found_policies <> expected_policies then
    raise exception
      'expected % report-domain select policies, found % — refusing to rewrite an unexpected policy set',
      expected_policies, found_policies
      using errcode = '55000';
  end if;
end;
$guard$;

alter policy "members with report read can view exact range metric observatio"
  on public.exact_range_metric_observations
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with report read can view report packages"
  on public.integration_report_packages
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with report read can view report projection runs"
  on public.integration_report_projection_runs
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with report read can view report sheet manifests"
  on public.integration_report_sheet_manifests
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with report read can view report validation control res"
  on public.integration_report_validation_control_results
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with report read can view report validation runs"
  on public.integration_report_validation_runs
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with report read can view report validation sheet resul"
  on public.integration_report_validation_sheet_results
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with report read can view report contract bindings"
  on public.report_contract_bindings
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with report read can view report contract decisions"
  on public.report_contract_decisions
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with report read can view report contract versions"
  on public.report_contract_versions
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with report read can view report contracts"
  on public.report_contracts
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with report read can view report projection bindings"
  on public.report_projection_bindings
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with report read can view report projection decisions"
  on public.report_projection_decisions
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with report read can view report projection lineage"
  on public.report_projection_lineage
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with report read can view report projection reconciliat"
  on public.report_projection_reconciliation_resolutions
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with report read can view report projection reconciliat"
  on public.report_projection_reconciliations
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with report read can view report projection versions"
  on public.report_projection_versions
  using (organization_id in (select private.organizations_with_permission('report.read')));

alter policy "members with channel read can view organization channels"
  on public.organization_channels
  using (organization_id in (select private.organizations_with_permission('channel.read')));

alter policy "members can read branches"
  on public.branches
  using (organization_id in (select private.organizations_with_membership()));

alter policy "members can read normalized metrics"
  on public.normalized_metrics
  using (organization_id in (select private.organizations_with_membership()));
