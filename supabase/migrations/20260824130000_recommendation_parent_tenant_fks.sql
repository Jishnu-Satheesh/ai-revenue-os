-- Bind every recommendation to its own tenant's facts.
--
-- The storage migration shipped the narration tables with their internal
-- wiring only: a recommendation named an organization, run, channel, and
-- branch as bare uuids, which would have left the Task 2 narrator RPC as the
-- sole guard against a row bound to another tenant's evidence. Everything
-- else in this slice already refuses cross-tenant parents at the database —
-- channel_findings references its run, channel, and branch by tenant-composite
-- key (20260823120000), and each child of channel_recommendations does the
-- same to it. The recommendations table now does too.
--
-- Delete behaviour follows the reference migration exactly: restrict. A
-- recommendation is narration over recorded facts, and deleting the fact out
-- from under the words is not a path this platform takes.

alter table public.channel_recommendations
  add constraint channel_recommendations_organization_id_fkey
  foreign key (organization_id)
    references public.organizations (id) on delete restrict;

alter table public.channel_recommendations
  add constraint channel_recommendations_organization_id_analysis_run_id_fkey
  foreign key (organization_id, analysis_run_id)
    references public.channel_analysis_runs (organization_id, id) on delete restrict;

alter table public.channel_recommendations
  add constraint channel_recommendations_organization_id_channel_id_fkey
  foreign key (organization_id, channel_id)
    references public.organization_channels (organization_id, id) on delete restrict;

-- Nullable parent, nullable constraint: MATCH SIMPLE leaves a recommendation
-- without a branch unenforced on this key, which is the same treatment every
-- other nullable branch reference in the schema receives.
alter table public.channel_recommendations
  add constraint channel_recommendations_organization_id_branch_id_fkey
  foreign key (organization_id, branch_id)
    references public.branches (organization_id, id) on delete restrict;
