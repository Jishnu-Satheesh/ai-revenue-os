-- Repair fail_channel_recommendations: read back what was recorded.
--
-- The failure path updated the lease row correctly but then asked plpgsql to
-- pour a jsonb value into a composite variable, which arrives as a string no
-- uuid column can parse -- so every honest admission of failure crashed
-- instead of being recorded. Read the two fields back as scalars, and let the
-- UPDATE itself carry the lease and token checks: one locked statement, no
-- gap between the check and the write.

create or replace function public.fail_channel_recommendations(
  p_organization_id uuid,
  p_analysis_run_id uuid,
  p_claim_token uuid,
  p_failure_code text,
  p_result_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failure_code text;
  v_result_digest text;
begin
  if p_failure_code not in ('MODEL_PROVIDER_UNAVAILABLE', 'NARRATION_VALIDATION_FAILED',
    'NARRATION_PROCESSING_FAILED')
    or coalesce(p_result_digest, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'channel recommendation failure is invalid' using errcode = '22023';
  end if;
  update private.channel_recommendation_operations o
    set failure_code = p_failure_code, result_digest = p_result_digest,
        lease_expires_at = now(), updated_at = now()
  where o.organization_id = p_organization_id
    and o.analysis_run_id = p_analysis_run_id
    and o.claim_token = p_claim_token
    and o.lease_expires_at > now()
  returning o.failure_code, o.result_digest into v_failure_code, v_result_digest;
  if v_failure_code is null then return null; end if;
  return jsonb_build_object('failureCode', v_failure_code, 'resultDigest', v_result_digest);
end;
$$;
