-- Admission failures occur before a validation run can safely claim the
-- object. They still need one value-free validation-failed audit event.

create or replace function private.audit_report_package_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
  actor_kind public.audit_actor_type;
  actor uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    event_name := case new.status
      when 'uploaded' then 'report_package.uploaded'
      when 'awaiting_contract' then 'report_package.profiled'
      when 'failed' then 'report_package.failed'
      when 'validation_failed' then case when exists (
        select 1 from public.integration_report_validation_runs run
        where run.organization_id = new.organization_id and run.report_package_id = new.id
          and run.status = 'failed'
      ) then null else 'report_package.validation_failed' end
      else null
    end;
    if event_name is not null then
      actor_kind := case when actor is null then 'system'::public.audit_actor_type else 'user'::public.audit_actor_type end;
      insert into public.audit_events (
        organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload
      ) values (
        new.organization_id, event_name, actor_kind, actor, 'integration_report_package', new.id,
        new.correlation_id,
        jsonb_build_object(
          'status', new.status,
          'failureCode', new.safe_failure_code,
          'sheetCount', (select count(*) from public.integration_report_sheet_manifests m where m.organization_id = new.organization_id and m.report_package_id = new.id)
        )
      );
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.audit_report_package_lifecycle() from public;
