-- Repair the month-cache migration's signature overload.
--
-- `create or replace` with two new defaulted arguments created a second
-- overload instead of replacing the first, so a 13-argument call no longer
-- resolves to one function. Exactly one claim signature remains: the 15-
-- argument form whose digest and key default to null, preserving every
-- existing caller. The worker-only grant posture is re-asserted on the
-- surviving signature.

drop function if exists public.claim_channel_analysis(uuid, uuid, uuid, date, date, text, uuid, integer, jsonb, jsonb, text, uuid, uuid);

revoke all on function public.claim_channel_analysis(uuid, uuid, uuid, date, date, text, uuid, integer, jsonb, jsonb, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_channel_analysis(uuid, uuid, uuid, date, date, text, uuid, integer, jsonb, jsonb, text, uuid, uuid, text, text) to service_role;
