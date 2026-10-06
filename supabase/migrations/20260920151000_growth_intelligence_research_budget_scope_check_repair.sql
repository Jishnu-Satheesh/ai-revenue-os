-- Repair: drop the legacy pipeline-xor-request check.
--
-- 20260920140000 added update_id plus the exactly-one-of-three scope check
-- (exactly one of pipeline_id, request_id, update_id is set), but the legacy
-- pipeline-xor-request check from 20260908140000 still fires and rejects
-- every update-scoped row. Every legacy row has update_id null with exactly
-- one of pipeline_id/request_id set, so all legacy rows satisfy the new
-- check and dropping the legacy one changes nothing for them.
-- Superseded by: growth_intelligence_research_budget_reservations_scope_check.

alter table private.growth_intelligence_research_budget_reservations
  drop constraint growth_intelligence_research_budget_reservations_check;
