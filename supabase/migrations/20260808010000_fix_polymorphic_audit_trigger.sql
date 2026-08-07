-- A shared trigger cannot directly reference fields that are absent from some of
-- its table row types. Normalize OLD and NEW to JSON before resolving identifiers.
create or replace function private.audit_organization_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_row jsonb := '{}'::jsonb;
  old_row jsonb := '{}'::jsonb;
  target_organization_id uuid;
  target_entity_id uuid;
  target_event_name text;
  target_status text;
begin
  if TG_OP <> 'DELETE' then
    new_row := pg_catalog.to_jsonb(new);
  end if;
  if TG_OP <> 'INSERT' then
    old_row := pg_catalog.to_jsonb(old);
  end if;

  target_organization_id := pg_catalog.coalesce(
    (new_row ->> 'organization_id')::uuid,
    (old_row ->> 'organization_id')::uuid,
    (new_row ->> 'id')::uuid,
    (old_row ->> 'id')::uuid
  );
  target_entity_id := pg_catalog.coalesce(
    (new_row ->> 'id')::uuid,
    (old_row ->> 'id')::uuid,
    target_organization_id
  );
  target_event_name := case
    when TG_TABLE_NAME = 'organizations' and TG_OP = 'INSERT' then 'organization.created'
    when TG_TABLE_NAME = 'branches' and TG_OP = 'INSERT' then 'branch.created'
    when TG_TABLE_NAME = 'business_profiles' then 'business_profile.updated'
    when TG_TABLE_NAME = 'business_facts' and new_row ->> 'status' = 'verified' then 'business_fact.verified'
    when TG_TABLE_NAME = 'business_facts' then 'business_fact.updated'
    when TG_TABLE_NAME = 'goals' and TG_OP = 'INSERT' then 'goal.created'
    when TG_TABLE_NAME = 'constraints' and TG_OP = 'INSERT' then 'constraint.created'
    when TG_TABLE_NAME = 'policies' then 'policy.updated'
    else pg_catalog.lower(TG_TABLE_NAME || '.' || TG_OP)
  end;
  target_status := pg_catalog.coalesce(new_row ->> 'status', old_row ->> 'status');

  insert into public.audit_events (
    organization_id,
    event_name,
    actor_type,
    actor_id,
    entity_type,
    entity_id,
    payload
  )
  values (
    target_organization_id,
    target_event_name,
    'user',
    (select auth.uid()),
    TG_TABLE_NAME,
    target_entity_id,
    pg_catalog.jsonb_build_object('operation', TG_OP, 'status', target_status)
  );

  return new;
end;
$$;

revoke all on function private.audit_organization_change() from public;
