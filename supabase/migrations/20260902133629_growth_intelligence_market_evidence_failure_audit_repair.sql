-- The audited failure operation must keep its local failure code distinct
-- from the persisted column so the terminal update resolves at runtime.

create or replace function public.fail_market_research_run(
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
  failure_code text;
  measured_adapter_cost_micros_usd bigint;
  measured_adapter_latency_ms integer;
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
  failure_code := p_failure ->> 'safeFailureCode';
  measured_adapter_cost_micros_usd := (p_failure ->> 'adapterCostMicrosUsd')::bigint;
  measured_adapter_latency_ms := (p_failure ->> 'adapterLatencyMs')::integer;

  select run.* into run_row
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token;
  if found and run_row.status <> 'running' then
    if run_row.status = 'failed'
      and run_row.safe_failure_code = failure_code
      and run_row.adapter_cost_micros_usd = measured_adapter_cost_micros_usd
      and run_row.adapter_latency_ms = measured_adapter_latency_ms then
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
      and run_row.safe_failure_code = failure_code
      and run_row.adapter_cost_micros_usd = measured_adapter_cost_micros_usd
      and run_row.adapter_latency_ms = measured_adapter_latency_ms then
      return pg_catalog.jsonb_build_object(
        'runId', run_row.id, 'status', run_row.status, 'replayed', true
      );
    end if;
    raise exception 'market_research_run_terminal' using errcode = '23505';
  end if;

  update public.market_research_runs run
  set status = 'failed',
      safe_failure_code = failure_code,
      adapter_cost_micros_usd = measured_adapter_cost_micros_usd,
      adapter_latency_ms = measured_adapter_latency_ms,
      failed_at = pg_catalog.now()
  where run.organization_id = p_organization_id and run.id = run_row.id
  returning run.* into run_row;

  failure := public.fail_growth_intelligence_request(
    p_organization_id, p_request_id, p_claim_token, failure_code
  );
  if failure ->> 'outcome' <> 'failed' then
    raise exception 'market_research_request_failure_failed' using errcode = '42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'runId', run_row.id, 'status', run_row.status, 'replayed', false
  );
end;
$$;

revoke all on function public.fail_market_research_run(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_market_research_run(uuid, uuid, uuid, uuid, jsonb)
  to service_role;
