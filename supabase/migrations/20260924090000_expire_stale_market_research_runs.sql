-- Orphan recovery for market research runs whose worker died mid-run.
--
-- Draft only: the controller applies this after review (never push from a
-- worktree session). Runs stuck in `running` with a dead request lease can
-- never settle through the lease-fenced RPCs (complete/fail both demand a
-- live claim), and the due dispatcher recovers by re-claiming with a new
-- token, which opens a *new* run row. This sweeper settles only runs whose
-- request lease is already dead, so a live worker can never lose its run.
-- The parent request rows recover through the existing due dispatcher and
-- are deliberately untouched here.

create or replace function public.expire_stale_market_research_runs(
  p_older_than_seconds integer,
  p_safe_failure_code text default 'WORKER_ORPHANED'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_count integer := 0;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'market_research_expire_forbidden' using errcode = '42501';
  end if;
  if p_older_than_seconds is null or p_older_than_seconds < 3600
    or p_safe_failure_code is null
    or p_safe_failure_code !~ '^[A-Z][A-Z0-9_]{2,80}$' then
    raise exception 'market_research_expire_invalid' using errcode = '22023';
  end if;
  -- Settle only runs whose request lease is already dead, so a live worker can
  -- never lose its run under it. Idempotent: non-running rows never match.
  update public.market_research_runs run
  set status = 'failed',
      safe_failure_code = p_safe_failure_code,
      failed_at = pg_catalog.now()
  from public.growth_intelligence_requests request
  where run.growth_intelligence_request_id = request.id
    and run.organization_id = request.organization_id
    and run.status = 'running'
    and run.started_at < pg_catalog.now() - pg_catalog.make_interval(secs => p_older_than_seconds)
    and (request.status <> 'claimed'
      or request.lease_expires_at <= pg_catalog.now()
      or request.claim_token is distinct from run.claim_token);
  get diagnostics expired_count = row_count;
  return pg_catalog.jsonb_build_object('expiredCount', expired_count, 'replayed', false);
end;
$$;

revoke all on function public.expire_stale_market_research_runs(integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.expire_stale_market_research_runs(integer, text)
  to service_role;
