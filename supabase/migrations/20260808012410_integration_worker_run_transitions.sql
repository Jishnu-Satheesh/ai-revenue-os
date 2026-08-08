create or replace function public.transition_integration_ingestion_run(
  p_organization_id uuid,
  p_ingestion_run_id uuid,
  p_expected_statuses text[],
  p_status text,
  p_records_received integer,
  p_records_accepted integer,
  p_records_rejected integer,
  p_completed_at timestamptz default null,
  p_normalized_error_code text default null,
  p_safe_error_summary text default null,
  p_started_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  transitioned public.integration_ingestion_runs;
begin
  update public.integration_ingestion_runs
  set
    status = p_status,
    started_at = coalesce(p_started_at, started_at),
    completed_at = p_completed_at,
    records_received = p_records_received,
    records_accepted = p_records_accepted,
    records_rejected = p_records_rejected,
    normalized_error_code = p_normalized_error_code,
    safe_error_summary = p_safe_error_summary
  where organization_id = p_organization_id
    and id = p_ingestion_run_id
    and status = any(p_expected_statuses)
  returning * into transitioned;

  if not found then return null; end if;
  return pg_catalog.to_jsonb(transitioned);
end;
$$;

revoke all on function public.transition_integration_ingestion_run(
  uuid, uuid, text[], text, integer, integer, integer, timestamptz, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.transition_integration_ingestion_run(
  uuid, uuid, text[], text, integer, integer, integer, timestamptz, text, text, timestamptz
) to service_role;
