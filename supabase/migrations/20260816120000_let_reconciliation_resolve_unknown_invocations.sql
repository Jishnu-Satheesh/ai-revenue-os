-- Reconciliation could never run.
--
-- `guard_tool_invocation_mutation` allowed an update only while the invocation
-- was still `requested`, but `reconcile_tool_invocation` writes to one sitting
-- at `unknown` — the status `fail_tool_invocation` gives an ambiguous send. So
-- the only documented way out of `provider_outcome_unknown` was blocked by the
-- append-only guard, and an action whose outcome nobody knew would have stayed
-- that way permanently with its budget still committed.
--
-- The fix is a transition rule rather than a looser guard. An invocation moves
-- forward only along paths that exist:
--
--   requested -> succeeded | failed | unknown   (completion, failure, ambiguity)
--   unknown   -> succeeded | failed             (reconciliation, and only that)
--
-- A settled invocation stays settled: nothing reopens `succeeded` or `failed`,
-- because those are the rows a receipt and an audit trail are hung from.

create or replace function private.guard_tool_invocation_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'tool_ledger_is_append_only' using errcode = '23514';
  end if;

  if old.status = 'requested' then
    if new.status not in ('succeeded', 'failed', 'unknown') then
      raise exception 'tool_invocation_transition_invalid' using errcode = '23514';
    end if;
  elsif old.status = 'unknown' then
    -- Reconciliation reports what the provider actually holds. It may resolve
    -- the ambiguity in either direction, and it may not invent a third state.
    if new.status not in ('succeeded', 'failed') then
      raise exception 'tool_invocation_transition_invalid' using errcode = '23514';
    end if;
  else
    raise exception 'tool_invocation_already_final' using errcode = '23514';
  end if;

  if (
    new.organization_id, new.action_run_id, new.tool_key, new.idempotency_key,
    new.request_digest, new.claim_token, new.started_at
  ) is distinct from (
    old.organization_id, old.action_run_id, old.tool_key, old.idempotency_key,
    old.request_digest, old.claim_token, old.started_at
  ) then
    raise exception 'tool_ledger_is_append_only' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_tool_invocation_mutation() from public, anon, authenticated;
