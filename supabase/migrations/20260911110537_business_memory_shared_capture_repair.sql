-- Spec 023 Task 02 repair: review findings from the first staging run.
--
-- 1. event_kind had no default, so an insert that names only the source
--    identity fails not-null before the slot check can speak. Adapters pass
--    an explicit kind; the default covers backfill and tests.
-- 2. Member-only paths need explicit service_role revokes (hosted default
--    privileges grant service_role execute on every new function; precedent
--    20260824160000).

alter table public.memory_capture_events
  alter column event_kind set default 'recorded';

revoke all on function public.update_memory_integration_settings(
  uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean, text, uuid
) from service_role;
revoke all on function public.retry_memory_capture(uuid, uuid, uuid, uuid)
  from service_role;
