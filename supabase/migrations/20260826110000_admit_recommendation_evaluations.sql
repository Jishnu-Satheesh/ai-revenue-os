-- The judge's only write path.
--
-- ADR 0038: evaluation is advisory quality evidence for human prompt
-- iteration. The table arrived with the storage slice; this adds the
-- service_role-only admission RPC. One verdict per recommendation, ever --
-- `unique(recommendation_id)` is also the batch cursor, because "not yet
-- judged" is simply the absence of a row.

create function public.admit_channel_recommendation_evaluations(
  p_organization_id uuid,
  p_batch_id uuid,
  p_judge_provider text,
  p_judge_model text,
  p_judge_prompt_version integer,
  p_judge_prompt_digest text,
  p_judge_output_digest text,
  p_evaluations jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_count integer := 0;
begin
  if p_organization_id is null then
    raise exception 'ORGANIZATION_ID_REQUIRED' using errcode = '22023';
  end if;

  if p_batch_id is null then
    raise exception 'BATCH_ID_REQUIRED' using errcode = '22023';
  end if;

  if p_judge_provider is null or length(btrim(p_judge_provider)) = 0
    or p_judge_model is null or length(btrim(p_judge_model)) = 0
    or p_judge_prompt_version is null or p_judge_prompt_version < 1
    or p_judge_prompt_digest is null or length(btrim(p_judge_prompt_digest)) <> 64
    or p_judge_output_digest is null or length(btrim(p_judge_output_digest)) <> 64 then
    raise exception 'JUDGE_METADATA_REQUIRED' using errcode = '22023';
  end if;

  if jsonb_typeof(p_evaluations) <> 'array' then
    raise exception 'EVALUATIONS_MUST_BE_ARRAY' using errcode = '22023';
  end if;

  if jsonb_array_length(p_evaluations) > 200 then
    raise exception 'EVALUATION_BATCH_CAP_EXCEEDED' using errcode = '22023';
  end if;

  -- Insert atomically: any refusal rolls the whole batch back, so a half
  -- -admitted batch can never masquerade as coverage.
  for v_item in select * from jsonb_array_elements(p_evaluations)
  loop
    insert into public.channel_recommendation_evaluations (
      organization_id,
      recommendation_id,
      batch_id,
      citation_faithful,
      label_appropriate,
      invented_value_detected,
      uncertainty_honest,
      score,
      issues,
      notes,
      judge_provider,
      judge_model,
      judge_prompt_version,
      judge_prompt_digest,
      judge_output_digest
    )
    select
      r.organization_id,
      (v_item ->> 'recommendationId')::uuid,
      p_batch_id,
      (v_item ->> 'citationFaithful')::boolean,
      (v_item ->> 'labelAppropriate')::boolean,
      (v_item ->> 'inventedValueDetected')::boolean,
      (v_item ->> 'uncertaintyHonest')::boolean,
      (v_item ->> 'score')::integer,
      coalesce(v_item -> 'issues', '[]'::jsonb),
      coalesce(v_item ->> 'notes', ''),
      p_judge_provider,
      p_judge_model,
      p_judge_prompt_version,
      p_judge_prompt_digest,
      p_judge_output_digest
    from public.channel_recommendations r
    where r.id = (v_item ->> 'recommendationId')::uuid
      and r.organization_id = p_organization_id
    on conflict (recommendation_id) do nothing;

    if found then
      v_count := v_count + 1;
    else
      -- An unknown recommendation is indistinguishable from one that vanished
      -- mid-batch; either way naming it would describe other tenants' rows.
      -- A duplicate id lands here too, via not-found-after-no-op.
      raise exception 'EVALUATION_TARGET_NOT_FOUND' using errcode = 'P0002';
    end if;
  end loop;

  return jsonb_build_object('admitted', v_count);
end;
$$;

revoke all on function public.admit_channel_recommendation_evaluations(
  uuid, uuid, text, text, integer, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.admit_channel_recommendation_evaluations(
  uuid, uuid, text, text, integer, text, text, jsonb
) to service_role;

-- Hosted staging's default privileges hand EXECUTE on new functions to
-- service_role anyway, but say the quiet part explicitly: no other role, ever.
alter function public.admit_channel_recommendation_evaluations(
  uuid, uuid, text, text, integer, text, text, jsonb
) owner to postgres;
