-- Durable-lane cutover: spend qualification follows TinyFish, not Brave.
--
-- Live canary proved the mismatch: the TinyFish lane opens end to end
-- (adapter selected, provider tinyfish recorded) but every spend reserve
-- refuses, so all canary slots recorded skipped_policy with zero attempts and
-- the pipeline landed no_findings with zero sources. Root cause:
-- private.assert_research_provider_qualified() evaluates the Brave-only
-- private.research_provider_blockers() (hardcoded provider 'brave'), while
-- the lane gate uses the per-provider research_provider_blockers_for().
-- No brave row is staged by design (durable Brave storage is banned), so
-- reserve_research_request_budget and reserve_research_attempt always raise
-- research_provider_not_qualified.
--
-- This retires the brave-only semantics: the assert now evaluates
-- research_provider_blockers_for('tinyfish'). Every caller of the assert
-- (the two request-scope reserve functions and their repair copies, plus the
-- synthesis-retry functions and the coalesce-repair copy) serves the durable
-- lane, which is TinyFish-only now. The legacy
-- public.check_research_provider_qualification() brave status RPC stays
-- byte-identical and untouched. No table, grant, or RLS change.

create or replace function private.assert_research_provider_qualified()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  qualified_blockers text[];
begin
  qualified_blockers := private.research_provider_blockers_for('tinyfish');
  if pg_catalog.cardinality(qualified_blockers) > 0 then
    raise exception 'research_provider_not_qualified' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_research_provider_qualified()
  from public, anon, authenticated, service_role;
