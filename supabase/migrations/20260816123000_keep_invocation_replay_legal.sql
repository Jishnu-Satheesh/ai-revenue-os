-- The transition rule added minutes earlier was too strict.
--
-- `record_tool_invocation` handles a replayed idempotency key by rewriting the
-- conflicting row to itself, so the insert can return the id that already
-- exists. That touch fires the guard with an unchanged status, and a rule that
-- demanded every update be a forward transition rejected it — turning a retry,
-- which is the ordinary thing a worker does after a timeout, into an error.
--
-- Only a real change of status is a transition. An update that leaves the
-- status alone is policed by the identity check below, which is what stops a
-- replay from quietly rewriting the tool key, the digest, or the claim it was
-- made under.

create or replace function private.guard_tool_invocation_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'tool_ledger_is_append_only' using errcode = '23514';
  end if;

  if new.status is distinct from old.status then
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
