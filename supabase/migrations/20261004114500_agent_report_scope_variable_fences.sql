-- Fix first-call ambiguity in the agent report scope reader. Existing role,
-- source scope and permission checks remain unchanged.
create or replace function private.agent_report_scope_is_valid(p_organization_id uuid,p_scope jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare scope_channel_id uuid; scope_branch_id uuid; period_start date; period_end date; has_mappings boolean;
begin
  if jsonb_typeof(p_scope)<>'object' or pg_column_size(p_scope)>4096
    or (select count(*) from jsonb_object_keys(p_scope))<>6
    or not (p_scope ?& array['channelId','branchId','reportType','periodStart','periodEnd','currency'])
    or coalesce(p_scope->>'channelId','') !~* '^[0-9a-f-]{36}$'
    or coalesce(p_scope->>'branchId','') !~* '^[0-9a-f-]{36}$'
    or length(btrim(coalesce(p_scope->>'reportType',''))) not between 2 and 120
    or coalesce(p_scope->>'periodStart','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_scope->>'periodEnd','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_scope->>'currency','') !~ '^[A-Z]{3}$'
  then return false; end if;
  scope_channel_id:=(p_scope->>'channelId')::uuid;
  scope_branch_id:=(p_scope->>'branchId')::uuid;
  period_start:=(p_scope->>'periodStart')::date;
  period_end:=(p_scope->>'periodEnd')::date;
  if period_end<period_start then return false; end if;
  if not exists (select 1 from public.organization_channels c where c.organization_id=p_organization_id and c.id=scope_channel_id and c.status='active')
    or not exists (select 1 from public.branches b where b.organization_id=p_organization_id and b.id=scope_branch_id and b.is_active)
  then return false; end if;
  select exists(select 1 from public.organization_channel_branches m
    where m.organization_id=p_organization_id and m.channel_id=scope_channel_id and m.status='active') into has_mappings;
  if has_mappings and not exists (select 1 from public.organization_channel_branches m
    where m.organization_id=p_organization_id and m.channel_id=scope_channel_id and m.branch_id=scope_branch_id
      and m.status='active' and (m.effective_from is null or m.effective_from<=period_start)
      and (m.effective_to is null or m.effective_to>=period_end))
  then return false; end if;
  return true;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  return false;
end $$;
revoke all on function private.agent_report_scope_is_valid(uuid,jsonb) from public,anon,authenticated,service_role;

