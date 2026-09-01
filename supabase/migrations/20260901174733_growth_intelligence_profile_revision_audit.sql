-- Classify proposals from immutable version history. A profile can have more
-- than one proposed version before any version is confirmed, so the mutable
-- current-version pointer is not a reliable revision signal.
create or replace function private.audit_market_profile_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id,
    correlation_id, payload
  ) values (
    new.organization_id,
    case
      when new.version > 1 then 'market_profile.revision_proposed'
      else 'market_profile.proposed'
    end,
    case
      when new.created_by is null then 'system'::public.audit_actor_type
      else 'user'::public.audit_actor_type
    end,
    new.created_by,
    'organization_market_profile_version',
    new.id,
    new.correlation_id,
    pg_catalog.jsonb_build_object(
      'profileId', new.market_profile_id,
      'profileVersionId', new.id,
      'version', new.version
    )
  );
  return new;
end;
$$;

revoke all on function private.audit_market_profile_version()
from public, anon, authenticated, service_role;
