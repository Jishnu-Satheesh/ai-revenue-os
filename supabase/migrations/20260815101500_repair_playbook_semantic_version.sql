-- Repair the playbook semantic-version contract.
--
-- `playbook_versions_semantic_version_check` was written as
-- `'^v?[0-9]+\\.[0-9]+\\.[0-9]+$'` in a standard-conforming string literal, so
-- the regex received a literal backslash followed by any character instead of
-- an escaped dot. A real semantic version such as `1.0.0` was rejected.
--
-- Rather than repair the constraint, the Campaign seed stored `1\x0\x0` to
-- satisfy it and the read path translated `\x` back to `.` on the way out.
-- Four pgTAP suites copied the encoding. The stored value was therefore never
-- the version it claimed to be, and any caller reading the column directly
-- would have seen a corrupted string.
--
-- Fix the constraint, rewrite the values already stored, and remove both the
-- seed encoding and the read-path translation. The application boundary in
-- `src/modules/decisions/application/ports.ts` already requires a real
-- `MAJOR.MINOR.PATCH` string, so it needs no change.

-- Drop first, rewrite the stored values, then re-add: the corrected constraint
-- rejects every row the broken one accepted, so it cannot be added before the
-- data is repaired.
alter table public.playbook_versions
  drop constraint playbook_versions_semantic_version_check;

update public.playbook_versions
set semantic_version = pg_catalog.replace(semantic_version, E'\\x', '.')
where pg_catalog.strpos(semantic_version, E'\\x') > 0;

alter table public.playbook_versions
  add constraint playbook_versions_semantic_version_check
  check (semantic_version ~ '^v?[0-9]+\.[0-9]+\.[0-9]+$');


CREATE OR REPLACE FUNCTION private.seed_campaign_decision_playbook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    '1.0.0',
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
$function$;

CREATE OR REPLACE FUNCTION private.load_campaign_decision_context(target_organization_id uuid, input_claim jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        'semantic_version', playbook.semantic_version,
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
$function$;
