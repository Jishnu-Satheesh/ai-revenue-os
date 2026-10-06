-- Task 4 repair: let the atomic start assign pipeline lineage once.
--
-- The Task 3 request identity guard froze pipeline_id and phase unconditionally,
-- but the Task 4 start inserts its research root through the fingerprinting
-- enqueue RPC (which owns validation and replay) and links the lineage in the
-- same transaction. The deferred circular foreign keys already anticipate that
-- order; the guard did not. Lineage may now move exactly once, from null to
-- set, inside the start transaction. Any later reassignment stays forbidden,
-- and the null-together table check still rejects a half-linked row.

create or replace function private.enforce_growth_intelligence_request_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'growth_intelligence_request_delete_forbidden' using errcode = '55000';
  end if;
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.branch_id is distinct from old.branch_id
    or new.channel_id is distinct from old.channel_id
    or new.kind is distinct from old.kind
    or new.trigger_reason is distinct from old.trigger_reason
    or new.request_fingerprint is distinct from old.request_fingerprint
    or new.business_evidence_digest is distinct from old.business_evidence_digest
    or new.market_profile_version_id is distinct from old.market_profile_version_id
    or new.source_policy_digest is distinct from old.source_policy_digest
    or new.research_rule_version is distinct from old.research_rule_version
    or new.local_time_bucket is distinct from old.local_time_bucket
    or new.synthesis_version_tuple is distinct from old.synthesis_version_tuple
    or new.playbook_version_tuple is distinct from old.playbook_version_tuple
    or new.max_attempts is distinct from old.max_attempts
    or (old.pipeline_id is not null
        and (new.pipeline_id is distinct from old.pipeline_id
          or new.phase is distinct from old.phase))
    or new.requested_by is distinct from old.requested_by
    or new.created_at is distinct from old.created_at then
    raise exception 'growth_intelligence_request_identity_immutable' using errcode = '55000';
  end if;
  if new.attempt_count < old.attempt_count
    or new.dispatch_attempt_count < old.dispatch_attempt_count then
    raise exception 'growth_intelligence_request_attempts_cannot_decrease' using errcode = '55000';
  end if;
  if not (
    (old.status = 'pending' and new.status in ('pending', 'claimed', 'cancelled'))
    or (old.status = 'claimed' and new.status in ('claimed', 'succeeded', 'failed', 'cancelled'))
    or (old.status = 'failed' and new.status in ('failed', 'pending'))
    or (old.status = 'succeeded' and new.status = 'succeeded')
    or (old.status = 'cancelled' and new.status = 'cancelled')
  ) then
    raise exception 'growth_intelligence_request_transition_invalid' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_growth_intelligence_request_mutation()
  from public, anon, authenticated, service_role;
