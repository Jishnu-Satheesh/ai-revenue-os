-- A source may be retained as an unavailable fetch attempt, but it can never
-- become evidence for a claim. Failed requests retain their measured adapter
-- work just as completed requests do; zero is no longer an implicit claim.

create function private.enforce_available_market_evidence_source_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.market_evidence_source_id is not null and exists (
    select 1
    from public.market_evidence_sources source
    where source.organization_id = new.organization_id
      and source.id = new.market_evidence_source_id
      and source.availability <> 'available'
  ) then
    raise exception 'market_evidence_support_source_unavailable' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger market_evidence_links_require_available_source
before insert on public.market_evidence_links
for each row execute function private.enforce_available_market_evidence_source_link();

drop function public.fail_market_research_run(uuid, uuid, uuid, uuid, text);

create function public.fail_market_research_run(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_market_research_run_id uuid,
  p_failure jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
  run_row public.market_research_runs;
  failure jsonb;
  safe_failure_code text;
  adapter_cost_micros_usd bigint;
  adapter_latency_ms integer;
begin
  if p_market_research_run_id is null
    or not private.jsonb_object_has_exact_keys(
      p_failure,
      array['safeFailureCode', 'adapterCostMicrosUsd', 'adapterLatencyMs']::text[]
    )
    or coalesce(p_failure ->> 'safeFailureCode', '') !~ '^[A-Z][A-Z0-9_]{2,80}$'
    or coalesce(p_failure ->> 'adapterCostMicrosUsd', '') !~ '^(0|[1-9][0-9]{0,7})$'
    or coalesce(p_failure ->> 'adapterLatencyMs', '') !~ '^(0|[1-9][0-9]{0,5})$'
    or (p_failure ->> 'adapterCostMicrosUsd')::bigint > 50000000
    or (p_failure ->> 'adapterLatencyMs')::integer > 600000 then
    raise exception 'market_research_failure_invalid' using errcode = '22023';
  end if;
  safe_failure_code := p_failure ->> 'safeFailureCode';
  adapter_cost_micros_usd := (p_failure ->> 'adapterCostMicrosUsd')::bigint;
  adapter_latency_ms := (p_failure ->> 'adapterLatencyMs')::integer;

  select run.* into run_row
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token;
  if found and run_row.status <> 'running' then
    if run_row.status = 'failed'
      and run_row.safe_failure_code = safe_failure_code
      and run_row.adapter_cost_micros_usd = adapter_cost_micros_usd
      and run_row.adapter_latency_ms = adapter_latency_ms then
      return pg_catalog.jsonb_build_object(
        'runId', run_row.id, 'status', run_row.status, 'replayed', true
      );
    end if;
    raise exception 'market_research_run_terminal' using errcode = '23505';
  end if;
  request_row := private.assert_market_research_claim(p_organization_id, p_request_id, p_claim_token);

  select run.* into run_row
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token
  for update;
  if not found then
    raise exception 'market_research_run_not_found' using errcode = '42501';
  end if;
  if run_row.status <> 'running' then
    if run_row.status = 'failed'
      and run_row.safe_failure_code = safe_failure_code
      and run_row.adapter_cost_micros_usd = adapter_cost_micros_usd
      and run_row.adapter_latency_ms = adapter_latency_ms then
      return pg_catalog.jsonb_build_object(
        'runId', run_row.id, 'status', run_row.status, 'replayed', true
      );
    end if;
    raise exception 'market_research_run_terminal' using errcode = '23505';
  end if;

  update public.market_research_runs
  set status = 'failed',
      safe_failure_code = safe_failure_code,
      adapter_cost_micros_usd = adapter_cost_micros_usd,
      adapter_latency_ms = adapter_latency_ms,
      failed_at = pg_catalog.now()
  where organization_id = p_organization_id and id = run_row.id
  returning * into run_row;

  failure := public.fail_growth_intelligence_request(
    p_organization_id, p_request_id, p_claim_token, safe_failure_code
  );
  if failure ->> 'outcome' <> 'failed' then
    raise exception 'market_research_request_failure_failed' using errcode = '42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'runId', run_row.id, 'status', run_row.status, 'replayed', false
  );
end;
$$;

revoke all on function private.enforce_available_market_evidence_source_link()
  from public, anon, authenticated, service_role;
revoke all on function public.fail_market_research_run(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_market_research_run(uuid, uuid, uuid, uuid, jsonb)
  to service_role;
