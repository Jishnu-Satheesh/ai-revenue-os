-- The decision log is append-only, and now the database says so itself.
--
-- Spec 018 section 11.3: a later analysis may supersede a recommendation but
-- may not erase the human's prior decision. Until this migration that promise
-- rested on revoked grants alone — one future maintenance script or grant
-- drift away from silently rewriting history. The sibling findings table has
-- enforced the same rule by trigger since its first migration; decisions get
-- the identical guard, stricter because no transition (not even supersession)
-- ever rewrites a decision row.

create function private.prevent_channel_recommendation_decision_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'channel_recommendation_decision_is_append_only' using errcode = '55000';
  end if;
  raise exception 'channel_recommendation_decision_is_append_only' using errcode = '55000';
end;
$$;

create trigger channel_recommendation_decisions_prevent_mutation
before update or delete on public.channel_recommendation_decisions
for each row execute function private.prevent_channel_recommendation_decision_mutation();

-- The feedback vote is deliberately replaceable (one row per actor per
-- recommendation, latest wins), so it gets no such guard. Recommendations,
-- citations, and evaluations are worker-filed through fenced RPCs whose only
-- mutation path is the lease lifecycle; their immutability is asserted by the
-- fence suites rather than assumed here.
