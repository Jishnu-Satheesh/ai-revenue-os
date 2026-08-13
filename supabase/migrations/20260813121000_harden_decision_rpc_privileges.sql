-- Supabase default ACLs grant executable privileges to concrete API roles on
-- newly-created functions. Revoking PUBLIC alone does not remove those explicit
-- ACL entries, so deny the roles individually before granting the intended path.

revoke all on function public.start_decision_cycle(uuid, jsonb) from anon, authenticated;
revoke all on function public.persist_decision_record(uuid, jsonb) from anon, authenticated;
revoke all on function public.append_decision_feedback(uuid, uuid, text, text, jsonb, uuid) from anon;

grant execute on function public.start_decision_cycle(uuid, jsonb) to service_role;
grant execute on function public.persist_decision_record(uuid, jsonb) to service_role;
grant execute on function public.append_decision_feedback(uuid, uuid, text, text, jsonb, uuid) to authenticated;
