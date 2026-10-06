-- Bounded TinyFish live-execution canary flip (Task 4 of plan
-- docs/superpowers/plans/2026-09-20-tinyfish-live-execution.md).
--
-- This migration authorizes exactly one bounded canary: a single research
-- start on a single branch of the canary organization
-- 2dda45b8-82db-4f5f-b17d-611b9bbb7846 ("Al Noor Kitchen"), run only after
-- the ordered push list 20260920130000 (staged provider row), then
-- 20260920140000 (fenced update spend, pgTAP 24/24), then this flip, and the
-- Trigger workers are redeployed, with kill-switch
-- TINYFISH_MARKET_RESEARCH_ENABLED=true and TINYFISH_SEARCH_API_KEY present.
-- Any deviation from that bound fails the canary and the lane returns to
-- pending. Until this flip the gate keeps reporting
-- controlled_canary_missing and every TinyFish path fails closed.
--
-- Rollback (one line, run by hand only if the canary fails — not executed
-- by this migration):
-- update private.growth_intelligence_provider_qualifications set canary_result = 'pending', updated_at = pg_catalog.now() where provider = 'tinyfish';
--
-- Additive only: a plain UPDATE of the staged row. No schema, RLS, or grant
-- change; no credential or contract text lives here.

update private.growth_intelligence_provider_qualifications
set canary_result = 'passed',
  updated_at = pg_catalog.now()
where provider = 'tinyfish';
