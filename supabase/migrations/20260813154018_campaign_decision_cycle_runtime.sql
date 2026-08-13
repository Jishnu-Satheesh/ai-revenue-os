-- Campaign Decision-cycle runtime. This migration is recommendation-only: it
-- adds the fenced worker ledger and inert configuration, but dispatches no task
-- and grants no Meta capability.

-- Deterministic implementation registry ------------------------------------

alter table public.artifact_versions
  add column implementation_key text;

alter table public.artifact_versions disable trigger artifact_versions_append_only;

update public.artifact_versions
set implementation_key = case artifact_key
  when 'ranking_weights' then 'decision.ranking.evidence_value_time_v1'
  when 'confidence_calibration' then 'decision.confidence.computed_baseline_v1'
  else null
end;

alter table public.artifact_versions enable trigger artifact_versions_append_only;

alter table public.artifact_versions
  add constraint artifact_versions_implementation_key_registered check (
    (
      artifact_key = 'ranking_weights'
      and implementation_key = 'decision.ranking.evidence_value_time_v1'
    )
    or (
      artifact_key = 'confidence_calibration'
      and implementation_key = 'decision.confidence.computed_baseline_v1'
    )
    or (
      artifact_key not in ('ranking_weights', 'confidence_calibration')
      and implementation_key is null
    )
  );

create or replace function private.seed_decision_artifact_baselines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.artifact_versions (
    organization_id, artifact_key, version, basis, authored_by, implementation_key
  )
  select
    new.id,
    seeded.artifact_key,
    'baseline-v1',
    'Seeded Decision V1 baseline; no provider model or judge ran.',
    'system-baseline',
    case seeded.artifact_key
      when 'ranking_weights' then 'decision.ranking.evidence_value_time_v1'
      when 'confidence_calibration' then 'decision.confidence.computed_baseline_v1'
      else null
    end
  from (values
    ('confidence_calibration'), ('ranking_weights'), ('prompt'), ('model'), ('judge')
  ) seeded(artifact_key);

  insert into public.artifact_promotions (
    organization_id, artifact_key, active_artifact_version_id
  )
  select artifact.organization_id, artifact.artifact_key, artifact.id
  from public.artifact_versions artifact
  where artifact.organization_id = new.id
    and artifact.version = 'baseline-v1';

  return new;
end;
$$;

-- Inert organization-owned Campaign playbook -------------------------------

insert into public.playbook_definitions (
  organization_id, key, name, owner_scope, industry_pack_slug, business_objective
)
select
  organization.id,
  'campaign.meta_bundle',
  'Governed Meta Campaign Bundle',
  'core',
  null,
  'Increase incremental gross profit through a governed Meta campaign recommendation'
from public.organizations organization
on conflict (organization_id, key) do nothing;

insert into public.playbook_versions (
  organization_id,
  playbook_definition_id,
  semantic_version,
  eligibility_rules,
  required_capability_keys,
  required_data_keys,
  trigger_signal_keys,
  hypothesis_template,
  action_definition,
  risk_class,
  primary_metric_key,
  guardrail_metric_keys,
  measurement_window_days,
  prior,
  resurface_condition,
  is_active,
  activated_at
)
select
  definition.organization_id,
  definition.id,
  E'1\\x0\\x0',
  pg_catalog.jsonb_build_object(
    'recommendation_only', true,
    'freshness_bound_minutes', 1440,
    'maximum_candidates', 1
  ),
  array['publish_instagram', 'publish_facebook', 'advertise_meta_ads']::text[],
  array[
    'organization_profile_current',
    'brand_constraints_verified',
    'brand_assets_usable_or_synthetic_allowed',
    'economics_configured',
    'active_goal_metric',
    'meta_account_mapped',
    'action_capabilities_granted',
    'spend_policy_configured',
    'tracking_ready',
    'inputs_fresh',
    'impact.range',
    'impact.currency',
    'impact.source_revisions',
    'impact.observed_at',
    'impact.time_to_impact',
    'policy.access.active',
    'policy.spend.active',
    'margin.firewall.pass',
    'measurement.tracking_ready',
    'measurement.plan_registered'
  ]::text[],
  array['manual', 'scheduled', 'integration_sync_completed']::text[],
  'If a governed Meta campaign is approved, incremental gross profit should increase within the measurement window.',
  pg_catalog.jsonb_build_object(
    'action_key', 'campaign.meta_bundle_v1',
    'freshness_bound_minutes', 1440,
    'execution_mode', 'recommendation_only'
  ),
  3,
  'contribution.incremental_gross_profit',
  array['spend.total', 'contribution.margin_rate']::text[],
  7,
  null,
  pg_catalog.jsonb_build_object(
    'signal_key', 'contribution.incremental_gross_profit.delta_pct',
    'threshold', 10
  ),
  true,
  pg_catalog.now()
from public.playbook_definitions definition
where definition.key = 'campaign.meta_bundle'
on conflict (organization_id, playbook_definition_id, semantic_version) do nothing;

create function private.seed_campaign_decision_playbook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  definition_id uuid;
begin
  insert into public.playbook_definitions (
    organization_id, key, name, owner_scope, industry_pack_slug, business_objective
  ) values (
    new.id,
    'campaign.meta_bundle',
    'Governed Meta Campaign Bundle',
    'core',
    null,
    'Increase incremental gross profit through a governed Meta campaign recommendation'
  )
  returning id into definition_id;

  insert into public.playbook_versions (
    organization_id, playbook_definition_id, semantic_version, eligibility_rules,
    required_capability_keys, required_data_keys, trigger_signal_keys,
    hypothesis_template, action_definition, risk_class, primary_metric_key,
    guardrail_metric_keys, measurement_window_days, prior, resurface_condition,
    is_active, activated_at
  ) values (
    new.id,
    definition_id,
    E'1\\x0\\x0',
    pg_catalog.jsonb_build_object(
      'recommendation_only', true,
      'freshness_bound_minutes', 1440,
      'maximum_candidates', 1
    ),
    array['publish_instagram', 'publish_facebook', 'advertise_meta_ads']::text[],
    array[
      'organization_profile_current',
      'brand_constraints_verified',
      'brand_assets_usable_or_synthetic_allowed',
      'economics_configured',
      'active_goal_metric',
      'meta_account_mapped',
      'action_capabilities_granted',
      'spend_policy_configured',
      'tracking_ready',
      'inputs_fresh',
      'impact.range',
      'impact.currency',
      'impact.source_revisions',
      'impact.observed_at',
      'impact.time_to_impact',
      'policy.access.active',
      'policy.spend.active',
      'margin.firewall.pass',
      'measurement.tracking_ready',
      'measurement.plan_registered'
    ]::text[],
    array['manual', 'scheduled', 'integration_sync_completed']::text[],
    'If a governed Meta campaign is approved, incremental gross profit should increase within the measurement window.',
    pg_catalog.jsonb_build_object(
      'action_key', 'campaign.meta_bundle_v1',
      'freshness_bound_minutes', 1440,
      'execution_mode', 'recommendation_only'
    ),
    3,
    'contribution.incremental_gross_profit',
    array['spend.total', 'contribution.margin_rate']::text[],
    7,
    null,
    pg_catalog.jsonb_build_object(
      'signal_key', 'contribution.incremental_gross_profit.delta_pct',
      'threshold', 10
    ),
    true,
    pg_catalog.now()
  );

  return new;
end;
$$;

revoke all on function private.seed_campaign_decision_playbook() from public;

create trigger seed_campaign_decision_playbook
after insert on public.organizations
for each row execute function private.seed_campaign_decision_playbook();

-- Named readiness gaps ------------------------------------------------------

create function private.decision_registered_unique_keys(input_keys text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    input_keys is not null
    and pg_catalog.cardinality(input_keys) <= 50
    and pg_catalog.array_position(input_keys, null) is null
    and not exists (
      select 1
      from pg_catalog.unnest(input_keys) key
      where key !~ '^[a-z][a-z0-9_.-]{0,119}$'
    )
    and pg_catalog.cardinality(input_keys) = (
      select pg_catalog.count(distinct key)::integer
      from pg_catalog.unnest(input_keys) key
    );
$$;

revoke all on function private.decision_registered_unique_keys(text[]) from public;

alter table public.decision_records
  add column needs_data_keys text[] not null default '{}'::text[];

update public.decision_records
set needs_data_keys = array['decision.readiness.legacy_unknown']::text[]
where outcome = 'needs_data';

alter table public.decision_records
  add constraint decision_records_needs_data_keys_valid check (
    private.decision_registered_unique_keys(needs_data_keys)
    and (
      (outcome = 'needs_data' and pg_catalog.cardinality(needs_data_keys) between 1 and 50)
      or (outcome <> 'needs_data' and pg_catalog.cardinality(needs_data_keys) = 0)
    )
  );

create function private.apply_decision_needs_data_keys()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  configured_keys jsonb;
begin
  if new.outcome = 'needs_data' then
    configured_keys := nullif(
      pg_catalog.current_setting('app.decision_needs_data_keys', true),
      ''
    )::jsonb;
    if configured_keys is null then
      new.needs_data_keys := array['decision.readiness.legacy_unknown']::text[];
    else
      select coalesce(pg_catalog.array_agg(value order by ordinal), '{}'::text[])
      into new.needs_data_keys
      from pg_catalog.jsonb_array_elements_text(configured_keys) with ordinality item(value, ordinal);
    end if;
  else
    new.needs_data_keys := '{}'::text[];
  end if;

  if not private.decision_registered_unique_keys(new.needs_data_keys)
    or (
      new.outcome = 'needs_data'
      and pg_catalog.cardinality(new.needs_data_keys) = 0
    )
  then
    raise exception 'decision_needs_data_keys_invalid' using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function private.apply_decision_needs_data_keys() from public;

create trigger decision_records_apply_needs_data_keys
before insert on public.decision_records
for each row execute function private.apply_decision_needs_data_keys();

-- Private claim ledger ------------------------------------------------------

create table private.decision_cycle_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key text not null check (
    pg_catalog.char_length(idempotency_key) between 1 and 160
    and idempotency_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$'
  ),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  decision_cycle_id uuid not null,
  correlation_id uuid not null,
  trigger_type text not null check (
    trigger_type in ('manual', 'scheduled', 'integration_sync_completed')
  ),
  status text not null check (status in ('claimed', 'completed', 'cancelled', 'failed')),
  claim_token uuid not null,
  lease_expires_at timestamptz not null,
  attempt_count integer not null default 1 check (attempt_count >= 0),
  cancelled_at timestamptz,
  failure_code text check (
    failure_code is null or failure_code ~ '^[a-z][a-z0-9_.-]{0,119}$'
  ),
  result_decision_record_id uuid,
  result_opportunity_id uuid,
  retention_until timestamptz not null default (pg_catalog.now() + interval '400 days'),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  unique (organization_id, decision_cycle_id),
  foreign key (organization_id, decision_cycle_id)
    references public.decision_cycles(organization_id, id) on delete restrict,
  foreign key (organization_id, result_decision_record_id)
    references public.decision_records(organization_id, id) on delete restrict,
  foreign key (organization_id, result_opportunity_id)
    references public.opportunities(organization_id, id) on delete restrict,
  check (retention_until >= created_at + interval '400 days'),
  check (
    (status = 'claimed' and cancelled_at is null and failure_code is null
      and result_decision_record_id is null and result_opportunity_id is null)
    or (status = 'completed' and cancelled_at is null and failure_code is null
      and result_decision_record_id is not null)
    or (status = 'cancelled' and cancelled_at is not null and failure_code is null
      and result_decision_record_id is null and result_opportunity_id is null)
    or (status = 'failed' and cancelled_at is null and failure_code is not null
      and result_decision_record_id is null and result_opportunity_id is null)
  )
);

create index decision_cycle_operations_claim_lease_idx
  on private.decision_cycle_operations(organization_id, lease_expires_at)
  where status = 'claimed';

alter table private.decision_cycle_operations enable row level security;
alter table private.decision_cycle_operations force row level security;

revoke all on table private.decision_cycle_operations
  from public, anon, authenticated, service_role;

create function private.validate_campaign_decision_operation(
  target_organization_id uuid,
  input_operation jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if target_organization_id is null
    or not private.decision_json_has_exact(
      input_operation,
      array[
        'organization_id', 'correlation_id', 'idempotency_key',
        'request_digest', 'trigger_type'
      ],
      array[
        'organization_id', 'correlation_id', 'idempotency_key',
        'request_digest', 'trigger_type'
      ]
    )
    or not private.decision_json_is_uuid(input_operation -> 'organization_id')
    or input_operation ->> 'organization_id' is distinct from target_organization_id::text
    or not private.decision_json_is_uuid(input_operation -> 'correlation_id')
    or not private.decision_json_is_text(input_operation -> 'idempotency_key', 1, 160)
    or input_operation ->> 'idempotency_key'
      is distinct from pg_catalog.btrim(input_operation ->> 'idempotency_key')
    or input_operation ->> 'idempotency_key'
      !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$'
    or not private.decision_json_is_text(input_operation -> 'request_digest', 64, 64)
    or input_operation ->> 'request_digest' !~ '^[0-9a-f]{64}$'
    or input_operation ->> 'trigger_type'
      not in ('manual', 'scheduled', 'integration_sync_completed')
  then
    raise exception 'campaign_decision_operation_invalid' using errcode = '22023';
  end if;
end;
$$;

create function private.validate_campaign_decision_claim(
  target_organization_id uuid,
  input_claim jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if target_organization_id is null
    or not private.decision_json_has_exact(
      input_claim,
      array[
        'organization_id', 'idempotency_key', 'request_digest',
        'claim_token', 'decision_cycle_id'
      ],
      array[
        'organization_id', 'idempotency_key', 'request_digest',
        'claim_token', 'decision_cycle_id'
      ]
    )
    or not private.decision_json_is_uuid(input_claim -> 'organization_id')
    or input_claim ->> 'organization_id' is distinct from target_organization_id::text
    or not private.decision_json_is_text(input_claim -> 'idempotency_key', 1, 160)
    or input_claim ->> 'idempotency_key'
      !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$'
    or not private.decision_json_is_text(input_claim -> 'request_digest', 64, 64)
    or input_claim ->> 'request_digest' !~ '^[0-9a-f]{64}$'
    or not private.decision_json_is_uuid(input_claim -> 'claim_token')
    or not private.decision_json_is_uuid(input_claim -> 'decision_cycle_id')
  then
    raise exception 'campaign_decision_claim_invalid' using errcode = '22023';
  end if;
end;
$$;

revoke all on function private.validate_campaign_decision_operation(uuid, jsonb) from public;
revoke all on function private.validate_campaign_decision_claim(uuid, jsonb) from public;

create function private.audit_campaign_decision_operation(
  operation private.decision_cycle_operations,
  transition_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if transition_name not in ('claimed', 'reclaimed', 'completed', 'cancelled', 'failed') then
    raise exception 'campaign_decision_audit_transition_invalid' using errcode = '22023';
  end if;

  insert into public.audit_events (
    organization_id, event_name, actor_type, entity_type, entity_id,
    correlation_id, payload
  ) values (
    operation.organization_id,
    'decision.cycle_operation_' || transition_name,
    'system',
    'decision_cycle_operations',
    operation.id,
    operation.correlation_id,
    pg_catalog.jsonb_build_object(
      'operationId', operation.id,
      'decisionCycleId', operation.decision_cycle_id,
      'status', operation.status,
      'attemptCount', operation.attempt_count
    )
  );
end;
$$;

revoke all on function private.audit_campaign_decision_operation(
  private.decision_cycle_operations, text
) from public;

-- Fenced operation RPCs -----------------------------------------------------

create function public.claim_campaign_decision_cycle(
  target_organization_id uuid,
  input_operation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.decision_cycle_operations;
  saved_cycle_id uuid;
  saved_claim_token uuid;
begin
  perform private.validate_campaign_decision_operation(
    target_organization_id,
    input_operation
  );

  if not exists (
    select 1 from public.organizations organization
    where organization.id = target_organization_id
  ) then
    raise exception 'campaign_decision_organization_not_found' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_organization_id::text || ':' || (input_operation ->> 'idempotency_key'),
      0
    )
  );

  select stored.*
  into operation
  from private.decision_cycle_operations stored
  where stored.organization_id = target_organization_id
    and stored.idempotency_key = input_operation ->> 'idempotency_key'
  for update;

  if not found then
    saved_cycle_id := gen_random_uuid();
    saved_claim_token := gen_random_uuid();

    insert into public.decision_cycles (
      id, organization_id, trigger_name, correlation_id,
      slot_budget, max_scored_candidates
    ) values (
      saved_cycle_id,
      target_organization_id,
      input_operation ->> 'trigger_type',
      (input_operation ->> 'correlation_id')::uuid,
      0,
      1
    );

    insert into private.decision_cycle_operations (
      organization_id, idempotency_key, request_digest, decision_cycle_id,
      correlation_id, trigger_type, status, claim_token, lease_expires_at,
      attempt_count
    ) values (
      target_organization_id,
      input_operation ->> 'idempotency_key',
      input_operation ->> 'request_digest',
      saved_cycle_id,
      (input_operation ->> 'correlation_id')::uuid,
      input_operation ->> 'trigger_type',
      'claimed',
      saved_claim_token,
      pg_catalog.now() + interval '5 minutes',
      1
    )
    returning * into operation;

    perform private.audit_campaign_decision_operation(operation, 'claimed');

    return pg_catalog.jsonb_build_object(
      'status', 'acquired',
      'decision_cycle_id', operation.decision_cycle_id,
      'claim_token', operation.claim_token,
      'lease_expires_at', operation.lease_expires_at
    );
  end if;

  if operation.request_digest is distinct from input_operation ->> 'request_digest' then
    raise exception 'campaign_decision_idempotency_conflict' using errcode = '22023';
  end if;

  if operation.status = 'completed' then
    return pg_catalog.jsonb_build_object(
      'status', 'completed',
      'decision_cycle_id', operation.decision_cycle_id,
      'decision_record_id', operation.result_decision_record_id,
      'opportunity_id', operation.result_opportunity_id
    );
  end if;

  if operation.status = 'cancelled' then
    return pg_catalog.jsonb_build_object(
      'status', 'cancelled',
      'decision_cycle_id', operation.decision_cycle_id
    );
  end if;

  if operation.status = 'failed' then
    raise exception 'campaign_decision_operation_failed' using errcode = '22023';
  end if;

  if operation.lease_expires_at > pg_catalog.now() then
    return pg_catalog.jsonb_build_object(
      'status', 'in_progress',
      'decision_cycle_id', operation.decision_cycle_id,
      'lease_expires_at', operation.lease_expires_at
    );
  end if;

  update private.decision_cycle_operations stored
  set
    claim_token = gen_random_uuid(),
    lease_expires_at = pg_catalog.now() + interval '5 minutes',
    attempt_count = stored.attempt_count + 1,
    updated_at = pg_catalog.now()
  where stored.id = operation.id
  returning * into operation;

  perform private.audit_campaign_decision_operation(operation, 'reclaimed');

  return pg_catalog.jsonb_build_object(
    'status', 'reclaimed',
    'decision_cycle_id', operation.decision_cycle_id,
    'claim_token', operation.claim_token,
    'lease_expires_at', operation.lease_expires_at
  );
end;
$$;

create function private.assert_campaign_decision_claim(
  target_organization_id uuid,
  input_claim jsonb
)
returns private.decision_cycle_operations
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.decision_cycle_operations;
begin
  perform private.validate_campaign_decision_claim(target_organization_id, input_claim);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_organization_id::text || ':' || (input_claim ->> 'idempotency_key'),
      0
    )
  );

  select stored.*
  into operation
  from private.decision_cycle_operations stored
  where stored.organization_id = target_organization_id
    and stored.idempotency_key = input_claim ->> 'idempotency_key'
    and stored.request_digest = input_claim ->> 'request_digest'
    and stored.claim_token = (input_claim ->> 'claim_token')::uuid
    and stored.decision_cycle_id = (input_claim ->> 'decision_cycle_id')::uuid
    and stored.status = 'claimed'
    and stored.cancelled_at is null
    and stored.lease_expires_at > pg_catalog.now()
  for update;

  if not found then
    raise exception 'campaign_decision_claim_fenced' using errcode = '40001';
  end if;

  return operation;
end;
$$;

revoke all on function private.assert_campaign_decision_claim(uuid, jsonb) from public;

create function public.renew_campaign_decision_cycle_claim(
  target_organization_id uuid,
  input_claim jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.decision_cycle_operations;
begin
  operation := private.assert_campaign_decision_claim(
    target_organization_id,
    input_claim
  );

  update private.decision_cycle_operations stored
  set
    lease_expires_at = pg_catalog.now() + interval '5 minutes',
    updated_at = pg_catalog.now()
  where stored.id = operation.id
  returning * into operation;

  return pg_catalog.jsonb_build_object(
    'lease_expires_at', operation.lease_expires_at
  );
end;
$$;

create function public.cancel_campaign_decision_cycle(
  target_organization_id uuid,
  input_operation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.decision_cycle_operations;
  saved_cycle_id uuid;
begin
  perform private.validate_campaign_decision_operation(
    target_organization_id,
    input_operation
  );

  if not exists (
    select 1 from public.organizations organization
    where organization.id = target_organization_id
  ) then
    raise exception 'campaign_decision_organization_not_found' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_organization_id::text || ':' || (input_operation ->> 'idempotency_key'),
      0
    )
  );

  select stored.*
  into operation
  from private.decision_cycle_operations stored
  where stored.organization_id = target_organization_id
    and stored.idempotency_key = input_operation ->> 'idempotency_key'
  for update;

  if not found then
    saved_cycle_id := gen_random_uuid();

    insert into public.decision_cycles (
      id, organization_id, trigger_name, correlation_id,
      slot_budget, max_scored_candidates, termination_reason, completed_at
    ) values (
      saved_cycle_id,
      target_organization_id,
      input_operation ->> 'trigger_type',
      (input_operation ->> 'correlation_id')::uuid,
      0,
      1,
      'cancelled',
      pg_catalog.now()
    );

    insert into private.decision_cycle_operations (
      organization_id, idempotency_key, request_digest, decision_cycle_id,
      correlation_id, trigger_type, status, claim_token, lease_expires_at,
      attempt_count, cancelled_at
    ) values (
      target_organization_id,
      input_operation ->> 'idempotency_key',
      input_operation ->> 'request_digest',
      saved_cycle_id,
      (input_operation ->> 'correlation_id')::uuid,
      input_operation ->> 'trigger_type',
      'cancelled',
      gen_random_uuid(),
      pg_catalog.now(),
      0,
      pg_catalog.now()
    )
    returning * into operation;

    perform private.audit_campaign_decision_operation(operation, 'cancelled');

    return pg_catalog.jsonb_build_object(
      'status', 'cancelled',
      'decision_cycle_id', operation.decision_cycle_id
    );
  end if;

  if operation.request_digest is distinct from input_operation ->> 'request_digest' then
    raise exception 'campaign_decision_idempotency_conflict' using errcode = '22023';
  end if;

  if operation.status = 'completed' then
    return pg_catalog.jsonb_build_object(
      'status', 'completed',
      'decision_cycle_id', operation.decision_cycle_id,
      'decision_record_id', operation.result_decision_record_id,
      'opportunity_id', operation.result_opportunity_id
    );
  end if;

  if operation.status = 'cancelled' then
    return pg_catalog.jsonb_build_object(
      'status', 'cancelled',
      'decision_cycle_id', operation.decision_cycle_id
    );
  end if;

  if operation.status = 'failed' then
    return pg_catalog.jsonb_build_object(
      'status', 'failed',
      'decision_cycle_id', operation.decision_cycle_id
    );
  end if;

  update private.decision_cycle_operations stored
  set
    status = 'cancelled',
    cancelled_at = pg_catalog.now(),
    lease_expires_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where stored.id = operation.id
  returning * into operation;

  update public.decision_cycles cycle
  set termination_reason = 'cancelled', completed_at = pg_catalog.now()
  where cycle.organization_id = target_organization_id
    and cycle.id = operation.decision_cycle_id
    and cycle.completed_at is null;

  perform private.audit_campaign_decision_operation(operation, 'cancelled');

  return pg_catalog.jsonb_build_object(
    'status', 'cancelled',
    'decision_cycle_id', operation.decision_cycle_id
  );
end;
$$;

create function public.load_campaign_decision_context(
  target_organization_id uuid,
  input_claim jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.decision_cycle_operations;
  organization public.organizations;
  access_policy public.policies;
  spend_policy public.policies;
  playbook public.playbook_versions;
  playbook_definition public.playbook_definitions;
  ranking_artifact public.artifact_versions;
  confidence_artifact public.artifact_versions;
  economics public.channel_economics_entries;
  profile_observed_at timestamptz;
  observed_at timestamptz;
  active_opportunity_count integer;
  suppressions jsonb;
  active_goal_keys text[];
  capability_keys text[];
begin
  operation := private.assert_campaign_decision_claim(
    target_organization_id,
    input_claim
  );

  select scoped.*
  into organization
  from public.organizations scoped
  where scoped.id = target_organization_id;

  if not found then
    raise exception 'campaign_decision_organization_not_found' using errcode = '42501';
  end if;

  select policy.*
  into access_policy
  from public.policies policy
  where policy.organization_id = target_organization_id
    and policy.policy_type = 'access'
    and policy.is_active;

  if not found
    or not (access_policy.configuration ? 'max_active_recommendations')
    or not private.decision_json_is_integer(
      access_policy.configuration -> 'max_active_recommendations'
    )
    or (access_policy.configuration ->> 'max_active_recommendations')::numeric
      not between 0 and 100
  then
    raise exception 'campaign_decision_access_policy_invalid' using errcode = '22023';
  end if;

  select policy.*
  into spend_policy
  from public.policies policy
  where policy.organization_id = target_organization_id
    and policy.policy_type = 'spend'
    and policy.is_active;

  select version.*
  into playbook
  from public.playbook_versions version
  join public.playbook_definitions definition
    on definition.organization_id = version.organization_id
   and definition.id = version.playbook_definition_id
  where definition.organization_id = target_organization_id
    and definition.key = 'campaign.meta_bundle'
    and version.is_active;

  if found then
    select definition.*
    into playbook_definition
    from public.playbook_definitions definition
    where definition.organization_id = target_organization_id
      and definition.id = playbook.playbook_definition_id;
  end if;

  select artifact.*
  into ranking_artifact
  from private.current_artifact_promotions promotion
  join public.artifact_versions artifact
    on artifact.organization_id = promotion.organization_id
   and artifact.id = promotion.active_artifact_version_id
  where promotion.organization_id = target_organization_id
    and promotion.artifact_key = 'ranking_weights';

  if not found
    or ranking_artifact.implementation_key
      is distinct from 'decision.ranking.evidence_value_time_v1'
  then
    raise exception 'campaign_decision_ranking_implementation_invalid' using errcode = '22023';
  end if;

  select artifact.*
  into confidence_artifact
  from private.current_artifact_promotions promotion
  join public.artifact_versions artifact
    on artifact.organization_id = promotion.organization_id
   and artifact.id = promotion.active_artifact_version_id
  where promotion.organization_id = target_organization_id
    and promotion.artifact_key = 'confidence_calibration';

  if not found
    or confidence_artifact.implementation_key
      is distinct from 'decision.confidence.computed_baseline_v1'
  then
    raise exception 'campaign_decision_confidence_implementation_invalid' using errcode = '22023';
  end if;

  select pg_catalog.count(*)::integer
  into active_opportunity_count
  from public.opportunities opportunity
  where opportunity.organization_id = target_organization_id
    and opportunity.status in ('proposed', 'awaiting_approval', 'approved');

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'candidate_fingerprint', suppression.candidate_fingerprint,
        'suppressed_until', suppression.suppressed_until
      ) order by suppression.candidate_fingerprint
    ),
    '[]'::jsonb
  )
  into suppressions
  from public.candidate_suppressions suppression
  where suppression.organization_id = target_organization_id
    and suppression.resolved_at is null
    and (
      suppression.suppressed_until is null
      or suppression.suppressed_until > pg_catalog.now()
    );

  select coalesce(
    pg_catalog.array_agg(goal.metric_key order by goal.metric_key),
    '{}'::text[]
  )
  into active_goal_keys
  from public.goals goal
  where goal.organization_id = target_organization_id
    and goal.metric_key is not null
    and (goal.deadline is null or goal.deadline >= current_date);

  select coalesce(
    pg_catalog.array_agg(distinct capability.capability_key order by capability.capability_key),
    '{}'::text[]
  )
  into capability_keys
  from public.integration_capability_grants capability
  join public.integration_connections connection
    on connection.organization_id = capability.organization_id
   and connection.id = capability.connection_id
  where capability.organization_id = target_organization_id
    and capability.availability = 'available'
    and connection.status = 'active';

  select entry.*
  into economics
  from public.channel_economics_entries entry
  where entry.organization_id = target_organization_id
  order by entry.computed_at desc, entry.id desc
  limit 1;

  select pg_catalog.max(profile.updated_at)
  into profile_observed_at
  from public.business_profiles profile
  where profile.organization_id = target_organization_id;

  observed_at := coalesce(
    greatest(profile_observed_at, economics.computed_at),
    profile_observed_at,
    economics.computed_at,
    pg_catalog.now()
  );

  return pg_catalog.jsonb_build_object(
    'organization_id', target_organization_id,
    'organization_currency', organization.base_currency,
    'access_policy', pg_catalog.jsonb_build_object(
      'id', access_policy.id,
      'max_active_recommendations',
        (access_policy.configuration ->> 'max_active_recommendations')::integer
    ),
    'active_opportunity_count', active_opportunity_count,
    'spend_policy', case
      when spend_policy.id is not null
        and spend_policy.monthly_budget_minor is not null
        and spend_policy.budget_currency ~ '^[A-Z]{3}$'
      then pg_catalog.jsonb_build_object(
        'id', spend_policy.id,
        'monthly_budget_minor', spend_policy.monthly_budget_minor,
        'currency', spend_policy.budget_currency
      )
      else 'null'::jsonb
    end,
    'playbook', case
      when playbook.id is null then 'null'::jsonb
      else pg_catalog.jsonb_build_object(
        'definition_id', playbook_definition.id,
        'version_id', playbook.id,
        'semantic_version', pg_catalog.replace(playbook.semantic_version, E'\\x', '.'),
        'action_key', playbook.action_definition ->> 'action_key',
        'required_capability_keys', pg_catalog.to_jsonb(playbook.required_capability_keys),
        'required_evidence_keys', pg_catalog.to_jsonb(playbook.required_data_keys),
        'risk_class', playbook.risk_class,
        'primary_metric_key', playbook.primary_metric_key,
        'guardrail_metric_keys', pg_catalog.to_jsonb(playbook.guardrail_metric_keys),
        'freshness_bound_minutes',
          (playbook.action_definition ->> 'freshness_bound_minutes')::integer,
        'measurement_window_days', playbook.measurement_window_days
      )
    end,
    'ranking_artifact', pg_catalog.jsonb_build_object(
      'id', ranking_artifact.id,
      'implementation_key', ranking_artifact.implementation_key
    ),
    'confidence_artifact', pg_catalog.jsonb_build_object(
      'id', confidence_artifact.id,
      'implementation_key', confidence_artifact.implementation_key
    ),
    'suppressions', suppressions,
    'evidence', pg_catalog.jsonb_build_object(
      'organization_profile_current', profile_observed_at is not null,
      'brand_constraints_verified', exists (
        select 1
        from public.business_facts fact
        where fact.organization_id = target_organization_id
          and fact.fact_key = 'brand.constraints'
          and fact.status = 'verified'
      ),
      'brand_assets_usable', false,
      'synthetic_assets_allowed', false,
      'economics', case
        when economics.id is null then 'null'::jsonb
        else pg_catalog.jsonb_build_object(
          'currency', economics.currency,
          'completeness_grade', economics.completeness_grade
        )
      end,
      'active_goal_metric_keys', pg_catalog.to_jsonb(active_goal_keys),
      'meta_account_mapped', exists (
        select 1
        from public.integration_account_mappings mapping
        join public.integration_connections connection
          on connection.organization_id = mapping.organization_id
         and connection.id = mapping.connection_id
        where mapping.organization_id = target_organization_id
          and connection.provider_key in ('meta', 'meta_ads')
          and connection.status = 'active'
          and mapping.status = 'mapped'
      ),
      'granted_capability_keys', pg_catalog.to_jsonb(capability_keys),
      'tracking_ready', false,
      'measurement_plan_registered', playbook.id is not null,
      'margin_firewall_result', 'unknown',
      'inputs_observed_at', observed_at,
      'observed_volume', coalesce(economics.transaction_count, 0)
    )
  );
end;
$$;

create function public.complete_campaign_decision_cycle(
  target_organization_id uuid,
  input_completion jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.decision_cycle_operations;
  claim_input jsonb;
  aggregate_input jsonb;
  record_input jsonb;
  needs_data_json jsonb;
  needs_data_keys text[];
  persisted_input jsonb;
  saved_record_id uuid;
  saved_opportunity_id uuid;
begin
  if not private.decision_json_has_exact(
    input_completion,
    array[
      'organization_id', 'idempotency_key', 'request_digest',
      'claim_token', 'decision_cycle_id', 'aggregate'
    ],
    array[
      'organization_id', 'idempotency_key', 'request_digest',
      'claim_token', 'decision_cycle_id', 'aggregate'
    ]
  )
    or pg_catalog.jsonb_typeof(input_completion -> 'aggregate') <> 'object'
  then
    raise exception 'campaign_decision_completion_invalid' using errcode = '22023';
  end if;

  claim_input := input_completion - 'aggregate';
  aggregate_input := input_completion -> 'aggregate';
  record_input := aggregate_input -> 'record';
  needs_data_json := record_input -> 'needsDataKeys';

  perform private.validate_campaign_decision_claim(
    target_organization_id,
    claim_input
  );

  if pg_catalog.jsonb_typeof(record_input) <> 'object'
    or pg_catalog.jsonb_typeof(needs_data_json) <> 'array'
    or pg_catalog.jsonb_array_length(needs_data_json) > 50
  then
    raise exception 'campaign_decision_needs_data_keys_invalid' using errcode = '22023';
  end if;

  select coalesce(
    pg_catalog.array_agg(item.value order by item.ordinal),
    '{}'::text[]
  )
  into needs_data_keys
  from pg_catalog.jsonb_array_elements_text(needs_data_json)
    with ordinality item(value, ordinal);

  if not private.decision_registered_unique_keys(needs_data_keys)
    or (
      record_input ->> 'outcome' = 'needs_data'
      and pg_catalog.cardinality(needs_data_keys) = 0
    )
    or (
      record_input ->> 'outcome' <> 'needs_data'
      and pg_catalog.cardinality(needs_data_keys) <> 0
    )
  then
    raise exception 'campaign_decision_needs_data_keys_invalid' using errcode = '22023';
  end if;

  operation := private.assert_campaign_decision_claim(
    target_organization_id,
    claim_input
  );

  if record_input ->> 'decisionCycleId' is distinct from operation.decision_cycle_id::text
    or record_input ->> 'organizationId' is distinct from target_organization_id::text
    or record_input ->> 'correlationId' is distinct from operation.correlation_id::text
  then
    raise exception 'campaign_decision_completion_scope_mismatch' using errcode = '42501';
  end if;

  perform pg_catalog.set_config(
    'app.decision_needs_data_keys',
    pg_catalog.to_jsonb(needs_data_keys)::text,
    true
  );

  persisted_input := pg_catalog.jsonb_set(
    aggregate_input,
    '{record}',
    record_input - 'needsDataKeys'
  );

  saved_record_id := public.persist_decision_aggregate(
    target_organization_id,
    persisted_input
  );
  saved_opportunity_id := (record_input ->> 'opportunityId')::uuid;

  update public.decision_cycles cycle
  set
    slot_budget = (
      select greatest(
        0,
        (policy.configuration ->> 'max_active_recommendations')::integer
          - pg_catalog.count(opportunity.id)::integer
      )
      from public.policies policy
      left join public.opportunities opportunity
        on opportunity.organization_id = policy.organization_id
       and opportunity.status in ('proposed', 'awaiting_approval', 'approved')
       and opportunity.id is distinct from saved_opportunity_id
      where policy.organization_id = target_organization_id
        and policy.id = (record_input #>> '{versionTuple,policyVersionId}')::uuid
      group by policy.configuration
    ),
    screened_count = (record_input ->> 'screenedCount')::integer,
    scored_count = (record_input ->> 'scoredCount')::integer,
    termination_reason = record_input ->> 'reason',
    completed_at = pg_catalog.now()
  where cycle.organization_id = target_organization_id
    and cycle.id = operation.decision_cycle_id;

  update private.decision_cycle_operations stored
  set
    status = 'completed',
    result_decision_record_id = saved_record_id,
    result_opportunity_id = saved_opportunity_id,
    lease_expires_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where stored.id = operation.id
  returning * into operation;

  perform private.audit_campaign_decision_operation(operation, 'completed');

  return pg_catalog.jsonb_build_object(
    'decision_record_id', saved_record_id,
    'opportunity_id', saved_opportunity_id
  );
end;
$$;

create function public.fail_campaign_decision_cycle(
  target_organization_id uuid,
  input_failure jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation private.decision_cycle_operations;
  claim_input jsonb;
begin
  if not private.decision_json_has_exact(
    input_failure,
    array[
      'organization_id', 'idempotency_key', 'request_digest',
      'claim_token', 'decision_cycle_id', 'failure_code'
    ],
    array[
      'organization_id', 'idempotency_key', 'request_digest',
      'claim_token', 'decision_cycle_id', 'failure_code'
    ]
  )
    or not private.decision_json_is_text(input_failure -> 'failure_code', 1, 120)
    or input_failure ->> 'failure_code' !~ '^[a-z][a-z0-9_.-]{0,119}$'
  then
    raise exception 'campaign_decision_failure_invalid' using errcode = '22023';
  end if;

  claim_input := input_failure - 'failure_code';
  operation := private.assert_campaign_decision_claim(
    target_organization_id,
    claim_input
  );

  update private.decision_cycle_operations stored
  set
    status = 'failed',
    failure_code = input_failure ->> 'failure_code',
    lease_expires_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  where stored.id = operation.id
  returning * into operation;

  update public.decision_cycles cycle
  set
    termination_reason = input_failure ->> 'failure_code',
    completed_at = pg_catalog.now()
  where cycle.organization_id = target_organization_id
    and cycle.id = operation.decision_cycle_id
    and cycle.completed_at is null;

  perform private.audit_campaign_decision_operation(operation, 'failed');

  return pg_catalog.jsonb_build_object(
    'status', 'failed',
    'decision_cycle_id', operation.decision_cycle_id
  );
end;
$$;

-- Worker boundary -----------------------------------------------------------

revoke all on function public.claim_campaign_decision_cycle(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.renew_campaign_decision_cycle_claim(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.load_campaign_decision_context(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.complete_campaign_decision_cycle(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_campaign_decision_cycle(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.cancel_campaign_decision_cycle(uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public.claim_campaign_decision_cycle(uuid, jsonb)
  to service_role;
grant execute on function public.renew_campaign_decision_cycle_claim(uuid, jsonb)
  to service_role;
grant execute on function public.load_campaign_decision_context(uuid, jsonb)
  to service_role;
grant execute on function public.complete_campaign_decision_cycle(uuid, jsonb)
  to service_role;
grant execute on function public.fail_campaign_decision_cycle(uuid, jsonb)
  to service_role;
grant execute on function public.cancel_campaign_decision_cycle(uuid, jsonb)
  to service_role;

revoke all on function public.start_decision_cycle(uuid, jsonb) from service_role;
revoke all on function public.persist_decision_aggregate(uuid, jsonb) from service_role;
