-- The worker role reaches the Decision ledger only through the validated,
-- security-definer RPCs. Direct grants would bypass aggregate invariants.
revoke all on table
  public.playbook_definitions,
  public.playbook_versions,
  public.artifact_versions,
  public.artifact_promotions,
  public.decision_cycles,
  public.decision_records,
  public.decision_candidates,
  public.decision_feedback,
  public.candidate_suppressions,
  public.opportunities
from service_role;

grant execute on function public.start_decision_cycle(uuid, jsonb) to service_role;
grant execute on function public.persist_decision_aggregate(uuid, jsonb) to service_role;
