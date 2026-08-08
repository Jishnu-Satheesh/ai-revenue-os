-- private.audit_onboarding_change() built actor_type from a CASE expression
-- without an explicit cast. Postgres resolves a CASE of two unknown-type string
-- literals to `text`, and `text` does not implicitly cast to the
-- `audit_actor_type` enum on insert (only bare untyped literals do). Every
-- insert/update on the seven onboarding tables this trigger covers
-- (onboarding_sessions, onboarding_section_states, onboarding_requests,
-- onboarding_uploads, onboarding_extractions, onboarding_extraction_candidates,
-- ai_readiness_assessments) was failing with:
--   column "actor_type" is of type audit_actor_type but expression is of type text
create or replace function private.audit_onboarding_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_organization_id uuid := coalesce(new.organization_id, old.organization_id);
  target_entity_id uuid := coalesce(new.id, old.id);
  target_event_name text := lower('onboarding.' || replace(TG_TABLE_NAME, 'onboarding_', '') || '.' || lower(TG_OP));
begin
  insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, payload)
  values (
    target_organization_id,
    target_event_name,
    (case when (select auth.uid()) is null then 'system' else 'user' end)::public.audit_actor_type,
    (select auth.uid()),
    TG_TABLE_NAME,
    target_entity_id,
    jsonb_build_object('operation', TG_OP)
  );
  return new;
end;
$$;

revoke all on function private.audit_onboarding_change() from public;
