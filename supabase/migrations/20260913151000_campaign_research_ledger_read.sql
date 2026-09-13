-- Task 6 follow-up: scoped ledger read for research admission (C03).
--
-- The research tables are closed to every client role, so the application
-- cannot count pending runs or read the binding policy directly. This
-- function returns exactly the numbers admission needs — the current policy
-- document plus pending count, window spend, and last admission — and nothing
-- else. The numbers are advisory: `request_campaign_research_run` rechecks
-- every limit under lock, so a race between this read and admission can only
-- produce a precise refusal, never an overrun.

create function public.read_campaign_research_ledger(
  target_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.campaign_research_policies;
  v_pending integer;
  v_spent bigint;
  v_last_admitted timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'campaign_research_forbidden' using errcode = '42501';
  end if;
  if not private.has_organization_permission(target_organization_id, 'campaign.research_request') then
    raise exception 'campaign_research_forbidden' using errcode = '42501';
  end if;

  select policy.* into v_policy
  from public.campaign_research_policy_current current_pointer
  join public.campaign_research_policies policy on policy.id = current_pointer.policy_id
  where current_pointer.organization_id = target_organization_id;

  if v_policy.id is null then
    return jsonb_build_object(
      'policy', null,
      'pending_count', 0,
      'window_spent_minor', 0,
      'last_admitted_at', null
    );
  end if;

  select count(*) into v_pending
  from public.campaign_research_runs run
  where run.organization_id = target_organization_id
    and run.status in ('queued', 'claimed');

  select coalesce(sum(run.budget_minor), 0) into v_spent
  from public.campaign_research_runs run
  where run.organization_id = target_organization_id
    and run.status in ('queued', 'claimed', 'succeeded')
    and run.allowance_currency = v_policy.allowance_currency
    and (run.ended_at is null or run.ended_at > now() - (v_policy.window_days || ' days')::interval);

  select max(run.started_at) into v_last_admitted
  from public.campaign_research_runs run
  where run.organization_id = target_organization_id;

  return jsonb_build_object(
    'policy', jsonb_build_object(
      'schemaVersion', 1,
      'organizationId', v_policy.organization_id,
      'version', v_policy.version,
      'enabled', v_policy.enabled,
      'timezone', v_policy.schedule_timezone,
      'evidenceQualificationRuleVersion', v_policy.evidence_qualification_rule_version,
      'cooldownSeconds', v_policy.cooldown_seconds,
      'maxPendingProposals', v_policy.max_pending_proposals,
      'perRunAllowance', jsonb_build_object(
        'amountMinor', v_policy.per_run_allowance_minor,
        'currency', v_policy.allowance_currency
      ),
      'windowAllowance', jsonb_build_object(
        'amountMinor', v_policy.window_allowance_minor,
        'currency', v_policy.allowance_currency
      ),
      'windowDays', v_policy.window_days
    ),
    'pending_count', v_pending,
    'window_spent_minor', v_spent,
    'last_admitted_at', v_last_admitted
  );
end;
$$;

revoke all on function public.read_campaign_research_ledger(uuid) from public, anon;
grant execute on function public.read_campaign_research_ledger(uuid) to authenticated;
