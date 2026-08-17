-- Forward-only repair: atomic aggregate persistence and explicit, resolvable tuple.
create table public.artifact_promotions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  artifact_key text not null check (artifact_key in ('confidence_calibration','ranking_weights','prompt','model','judge')),
  active_artifact_version_id uuid not null,
  rollback_artifact_version_id uuid,
  promoted_at timestamptz not null default now(),
  promoted_by text not null default 'system-baseline',
  unique (organization_id, artifact_key), unique (organization_id, id),
  foreign key (organization_id, active_artifact_version_id) references public.artifact_versions(organization_id,id),
  foreign key (organization_id, rollback_artifact_version_id) references public.artifact_versions(organization_id,id)
);
alter table public.artifact_promotions enable row level security;
alter table public.artifact_promotions force row level security;
revoke all on public.artifact_promotions from anon, authenticated;

insert into public.artifact_versions (organization_id, artifact_key, version, basis, authored_by)
select organization.id, artifact_key, 'baseline-v1', 'Seeded Decision V1 baseline; no provider model or judge ran.', 'system-baseline'
from public.organizations organization
cross join (values ('confidence_calibration'),('ranking_weights'),('prompt'),('model'),('judge')) seeded(artifact_key)
on conflict (organization_id, artifact_key, version) do nothing;
insert into public.artifact_promotions (organization_id, artifact_key, active_artifact_version_id)
select artifact.organization_id, artifact.artifact_key, artifact.id from public.artifact_versions artifact
where artifact.version = 'baseline-v1' and artifact.artifact_key in ('confidence_calibration','ranking_weights','prompt','model','judge')
on conflict (organization_id, artifact_key) do nothing;

create function private.seed_decision_artifact_baselines()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.artifact_versions (organization_id, artifact_key, version, basis, authored_by)
  select new.id, artifact_key, 'baseline-v1', 'Seeded Decision V1 baseline; no provider model or judge ran.', 'system-baseline'
  from (values ('confidence_calibration'),('ranking_weights'),('prompt'),('model'),('judge')) seeded(artifact_key);
  insert into public.artifact_promotions (organization_id, artifact_key, active_artifact_version_id)
  select artifact.organization_id, artifact.artifact_key, artifact.id from public.artifact_versions artifact
  where artifact.organization_id = new.id and artifact.version = 'baseline-v1';
  return new;
end; $$;
create trigger seed_decision_artifact_baselines after insert on public.organizations for each row execute function private.seed_decision_artifact_baselines();

create function private.decision_json_has_only(value jsonb, allowed text[])
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(value) = 'object' and not exists (select 1 from jsonb_object_keys(value) key where not (key = any(allowed)));
$$;

alter table public.decision_records
  add column playbook_version_id uuid,
  add column prompt_version_id uuid,
  add column ranking_weights_id uuid,
  add column model_id uuid,
  add column judge_version_id uuid,
  add column confidence_calibration_id uuid;
alter table public.policies add constraint policies_organization_id_id_key unique (organization_id, id);
alter table public.decision_records alter column policy_version_id set not null;
alter table public.decision_records alter column ranking_weights_id set not null;
alter table public.decision_records alter column confidence_calibration_id set not null;
alter table public.decision_records
  add constraint decision_records_policy_tenant_fk foreign key (organization_id, policy_version_id) references public.policies(organization_id,id),
  add constraint decision_records_playbook_tenant_fk foreign key (organization_id, playbook_version_id) references public.playbook_versions(organization_id,id),
  add constraint decision_records_prompt_tenant_fk foreign key (organization_id, prompt_version_id) references public.artifact_versions(organization_id,id),
  add constraint decision_records_ranking_tenant_fk foreign key (organization_id, ranking_weights_id) references public.artifact_versions(organization_id,id),
  add constraint decision_records_model_tenant_fk foreign key (organization_id, model_id) references public.artifact_versions(organization_id,id),
  add constraint decision_records_judge_tenant_fk foreign key (organization_id, judge_version_id) references public.artifact_versions(organization_id,id),
  add constraint decision_records_confidence_tenant_fk foreign key (organization_id, confidence_calibration_id) references public.artifact_versions(organization_id,id),
  add constraint decision_records_opportunity_tenant_fk foreign key (organization_id, opportunity_id) references public.opportunities(organization_id,id) deferrable initially deferred,
  add constraint decision_records_tuple_shape check ((prompt_version_id is null) = (model_id is null)),
  add constraint decision_records_playbook_required check (playbook_version_id is not null or (outcome = 'no_action' and reason = 'no_active_playbook') or outcome = 'needs_data');

alter table public.decision_feedback add constraint decision_feedback_reason_bound check (reason is null or char_length(reason) <= 500);
alter table public.decision_feedback add constraint decision_feedback_diff_shape check (edit_diff is null or private.decision_json_has_only(edit_diff, array['title','summary','assumptions']));

create function public.persist_decision_aggregate(target_organization_id uuid, input_aggregate jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare record_input jsonb := input_aggregate->'record'; record_id uuid := gen_random_uuid(); opportunity_input jsonb := input_aggregate->'opportunity';
begin
  if not private.decision_json_has_only(input_aggregate, array['record','candidates','opportunity']) or jsonb_typeof(input_aggregate->'candidates') <> 'array' then raise exception 'decision_aggregate_invalid' using errcode='22023'; end if;
  if not private.decision_json_has_only(record_input, array['decisionCycleId','organizationId','correlationId','outcome','reason','selectedCandidateFingerprint','opportunityId','rejectionHistogram','screenedCount','scoredCount','inputsDigest','versionTuple','propensity','isExploration']) then raise exception 'decision_record_invalid' using errcode='22023'; end if;
  if record_input->>'organizationId' is distinct from target_organization_id::text or not private.decision_json_has_only(record_input->'versionTuple', array['policyVersionId','playbookVersionId','promptVersionId','rankingWeightsId','modelId','judgeVersionId','confidenceCalibrationId']) then raise exception 'decision_tuple_invalid' using errcode='22023'; end if;
  insert into public.decision_records (id,organization_id,decision_cycle_id,correlation_id,outcome,reason,selected_candidate_fingerprint,opportunity_id,rejection_histogram,screened_count,scored_count,inputs_digest,artifact_version_tuple,policy_version_id,playbook_version_id,prompt_version_id,ranking_weights_id,model_id,judge_version_id,confidence_calibration_id,propensity,is_exploration)
  values (record_id,target_organization_id,(record_input->>'decisionCycleId')::uuid,(record_input->>'correlationId')::uuid,record_input->>'outcome',record_input->>'reason',record_input->>'selectedCandidateFingerprint',(record_input->>'opportunityId')::uuid,record_input->'rejectionHistogram',(record_input->'versionTuple'),(record_input->>'screenedCount')::int,(record_input->>'scoredCount')::int,record_input->>'inputsDigest',record_input->'versionTuple',(record_input->'versionTuple'->>'policyVersionId')::uuid,(record_input->'versionTuple'->>'playbookVersionId')::uuid,(record_input->'versionTuple'->>'promptVersionId')::uuid,(record_input->'versionTuple'->>'rankingWeightsId')::uuid,(record_input->'versionTuple'->>'modelId')::uuid,(record_input->'versionTuple'->>'judgeVersionId')::uuid,(record_input->'versionTuple'->>'confidenceCalibrationId')::uuid,(record_input->>'propensity')::numeric,(record_input->>'isExploration')::boolean);
  if opportunity_input is not null then
    insert into public.opportunities (id,organization_id,decision_record_id,playbook_version_id,candidate_fingerprint,title,summary,hypothesis,subject_kind,subject_ref,evidence_bundle,assumptions,impact_low_minor,impact_high_minor,confidence,confidence_rationale,evidence_tier,execution_cost_minor,expected_contribution_minor,currency,time_to_impact_days,risk_tier,approval_path,guardrails,assertions,evaluation_plan,expires_at,status)
    values ((opportunity_input->>'id')::uuid,target_organization_id,record_id,(opportunity_input->>'playbookVersionId')::uuid,opportunity_input->>'candidateFingerprint',opportunity_input->>'title',opportunity_input->>'summary',opportunity_input->>'hypothesis',opportunity_input->>'subjectKind',opportunity_input->>'subjectRef',opportunity_input->'evidenceBundle',opportunity_input->'assumptions',(opportunity_input->>'impactLowMinor')::bigint,(opportunity_input->>'impactHighMinor')::bigint,(opportunity_input->>'confidence')::numeric,opportunity_input->>'confidenceRationale',opportunity_input->>'evidenceTier',(opportunity_input->>'executionCostMinor')::bigint,(opportunity_input->>'expectedContributionMinor')::bigint,opportunity_input->>'currency',(opportunity_input->>'timeToImpactDays')::int,(opportunity_input->>'riskTier')::smallint,opportunity_input->>'approvalPath',opportunity_input->'guardrails',opportunity_input->'assertions',opportunity_input->'evaluationPlan',(opportunity_input->>'expiresAt')::timestamptz,opportunity_input->>'status');
  end if;
  return record_id;
end; $$;
revoke all on function public.persist_decision_aggregate(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.persist_decision_aggregate(uuid,jsonb) to service_role;
