-- Slice 7 forward correction: let the governed release paths delete scope rows.
--
-- Migration 20260914054733 put a blanket BEFORE UPDATE OR DELETE guard
-- (private.reject_growth_intelligence_append_only_mutation) on
-- growth_intelligence_monitoring_active_scopes, while its own governed RPCs
-- must delete from that same table: create_research_project_keyed reclaims a
-- stale (archived keeper) fingerprint, and release_monitoring_active_scope
-- releases a fingerprint on archive. Trigger guards fire inside
-- security-definer writes too, so the first staging run of the Slice 7 pgTAP
-- suite died on release with growth_intelligence_monitoring_active_scopes
-- _is_append_only, and neither governed delete path could ever succeed.
--
-- Like a suggestion box with no key for the person who empties it: anyone
-- could drop a fingerprint in, but the two governed emptying routes were
-- locked out by the same latch.
--
-- Repair: narrow the guard to UPDATE only. Scope rows stay immutable in
-- place; removal travels exclusively through the two fenced RPCs, which
-- re-check tenant membership and growth_intelligence.manage inside their own
-- transactions. Direct sessions still hold no write grant at all (SELECT
-- only for authenticated/service_role), so unwritten deletes keep failing
-- with 42501 before any trigger runs. No table, column, index, policy,
-- grant, or RPC body changes; no existing-table alterations.

drop trigger if exists growth_intelligence_monitoring_active_scopes_append_only
  on public.growth_intelligence_monitoring_active_scopes;

create trigger growth_intelligence_monitoring_active_scopes_append_only
before update on public.growth_intelligence_monitoring_active_scopes
for each row execute function private.reject_growth_intelligence_append_only_mutation();
