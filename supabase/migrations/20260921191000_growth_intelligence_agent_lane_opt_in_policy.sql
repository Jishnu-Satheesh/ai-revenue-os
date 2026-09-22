-- Agent fallback lane opt-in write path (Task 2 fix round).
--
-- Controller ruling (recorded as applied): overrides the plan's "no RLS
-- change" line. The projects PATCH fails closed on staging because the
-- authenticated role holds SELECT only on
-- public.growth_intelligence_research_projects. This grants the least
-- privilege needed: UPDATE on that one table to authenticated, plus an
-- UPDATE policy for the caller's own organization only. The policy mirrors
-- the table's SELECT policy shape exactly
-- (private.has_organization_permission on organization_id, same naming
-- convention) with WITH CHECK equal to USING; it gates on
-- growth_intelligence.manage rather than read so the database matches the
-- route, which refuses viewers before touching persistence.
--
-- No other grants, no other tables, no function changes.

grant update on table public.growth_intelligence_research_projects to authenticated;

create policy "members with Growth Intelligence update research projects"
on public.growth_intelligence_research_projects
for update to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.manage'))
with check (private.has_organization_permission(organization_id, 'growth_intelligence.manage'));
