-- Scope Task 5's admission lock to the registered Campaign recommendation.
-- Other Decision Engine playbooks retain their existing aggregate contract.

create or replace function private.enforce_active_opportunity_admission()
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

  if not exists (
    select 1
    from public.playbook_versions playbook
    where playbook.organization_id = new.organization_id
      and playbook.id = new.playbook_version_id
      and playbook.action_definition ->> 'action_key' = 'campaign.meta_bundle_v1'
  ) then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and old.status in ('proposed', 'awaiting_approval', 'approved')
    and old.organization_id = new.organization_id
    and old.candidate_fingerprint = new.candidate_fingerprint
  then
    return new;
  end if;

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
