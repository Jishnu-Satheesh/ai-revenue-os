-- Agent fallback lane opt-in (Task 2 of 2026-09-21-agent-fallback-lane).
--
-- Adds a per-project operator opt-in flag on
-- public.growth_intelligence_research_projects. The default (false) keeps
-- every existing project on today's search-only behavior, so no backfill is
-- needed. The projects PATCH endpoint flips one project's flag; Task 3 reads
-- it with the project row fetch to route opted-in competitor slots to the
-- Agent lane.
--
-- No RLS, grant, or function change in this slice. Note for the follow-up:
-- the table currently grants authenticated SELECT only with no UPDATE
-- policy, so the PATCH fails closed (500/404, nothing written) until a
-- pinned UPDATE policy plus grant lands.
-- Superseded in part by 20260921191000 policy migration.

alter table public.growth_intelligence_research_projects
  add column if not exists agent_lane_opt_in boolean not null default false;

comment on column public.growth_intelligence_research_projects.agent_lane_opt_in is
  'Operator opt-in for the TinyFish Agent fallback lane. False keeps the project on search-only research.';
