-- Repair final Campaign recommendation admission and truthful readiness.
--
-- This remains recommendation-only. It does not enable campaign creation,
-- dispatch, Meta execution, or any direct service-role table mutation.

alter function public.load_campaign_decision_context(uuid, jsonb)
  set schema private;

revoke all on function private.load_campaign_decision_context(uuid, jsonb)
  from public, anon, authenticated, service_role;

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
  decision_context jsonb;
  profile_observed_at timestamptz;
  economics_observed_at timestamptz;
  inputs_observed_at timestamptz;
begin
  -- The private predecessor retains the exact claim-token, tenant, input-shape,
  -- policy, playbook, and artifact fencing from the applied runtime migration.
  decision_context := private.load_campaign_decision_context(
    target_organization_id,
    input_claim
  );

  select pg_catalog.max(profile.updated_at)
  into profile_observed_at
  from public.business_profiles profile
  where profile.organization_id = target_organization_id;

  select entry.computed_at
  into economics_observed_at
  from public.channel_economics_entries entry
  where entry.organization_id = target_organization_id
  order by entry.computed_at desc, entry.id desc
  limit 1;

  -- Both inputs are required. A missing source is not fresh, and the oldest
  -- required observation controls the aggregate freshness bound.
  inputs_observed_at := case
    when profile_observed_at is not null and economics_observed_at is not null
      then least(profile_observed_at, economics_observed_at)
    else null
  end;

  decision_context := pg_catalog.jsonb_set(
    decision_context,
    '{evidence,inputs_observed_at}',
    coalesce(pg_catalog.to_jsonb(inputs_observed_at), 'null'::jsonb),
    false
  );

  -- No governed baseline and attribution plan is registered yet. An active
  -- playbook is a rule definition, not a measurement-plan registration.
  decision_context := pg_catalog.jsonb_set(
    decision_context,
    '{evidence,measurement_plan_registered}',
    'false'::jsonb,
    false
  );

  return decision_context;
end;
$$;

revoke all on function public.load_campaign_decision_context(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.load_campaign_decision_context(uuid, jsonb)
  to service_role;

create function private.enforce_active_opportunity_admission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  access_policy public.policies;
  maximum_active integer;
  active_count integer;
begin
  if new.status not in ('proposed', 'awaiting_approval', 'approved') then
    return new;
  end if;

  -- An already-active row changing only lifecycle state does not consume a new
  -- slot. Identity changes and inactive-to-active transitions are admissions.
  if tg_op = 'UPDATE'
    and old.status in ('proposed', 'awaiting_approval', 'approved')
    and old.organization_id = new.organization_id
    and old.candidate_fingerprint = new.candidate_fingerprint
  then
    return new;
  end if;

  -- Serialize every active-opportunity admission for an organization. The
  -- xact lock is retained through the insert, closing the stale-context race.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'campaign_decision_active_admission:' || new.organization_id::text,
      0
    )
  );

  select policy.*
  into access_policy
  from public.policies policy
  where policy.organization_id = new.organization_id
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

  if exists (
    select 1
    from public.opportunities opportunity
    where opportunity.organization_id = new.organization_id
      and opportunity.candidate_fingerprint = new.candidate_fingerprint
      and opportunity.status in ('proposed', 'awaiting_approval', 'approved')
      and opportunity.id is distinct from new.id
  ) then
    raise exception 'campaign_decision_active_duplicate' using errcode = '23505';
  end if;

  maximum_active :=
    (access_policy.configuration ->> 'max_active_recommendations')::integer;

  select pg_catalog.count(*)::integer
  into active_count
  from public.opportunities opportunity
  where opportunity.organization_id = new.organization_id
    and opportunity.status in ('proposed', 'awaiting_approval', 'approved')
    and opportunity.id is distinct from new.id;

  if active_count >= maximum_active then
    raise exception 'campaign_decision_capacity_exhausted' using errcode = '40001';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_active_opportunity_admission() from public;

create trigger opportunities_enforce_active_admission
before insert or update of organization_id, candidate_fingerprint, status
on public.opportunities
for each row
execute function private.enforce_active_opportunity_admission();

create unique index opportunities_active_candidate_fingerprint_idx
  on public.opportunities (organization_id, candidate_fingerprint)
  where status in ('proposed', 'awaiting_approval', 'approved');
