-- Worker-visible growth schedule read (spec 027, D08; Task-5 decision b).
--
-- The nightly worker runs as service_role, for which direct SELECT on
-- public.organization_growth_projections is revoked (Task 2 posture: the
-- publication RPC is the only write path, and no client role reads through
-- a privileged fallback). Publication still needs the stored schedule
-- origin to find each horizon's due cycle, so this service-only RPC returns
-- exactly the distinct origin dates behind active/upcoming rows — no
-- amounts, points, scopes, digests or source identities.
--
-- Grants mirror publish_organization_growth_projection: EXECUTE for
-- service_role only, revoked from public/anon/authenticated. Table grants
-- and RLS policies are untouched; nothing is widened.

create or replace function public.read_organization_growth_schedule(
  p_organization_id uuid,
  p_as_of_date date
)
returns table (schedule_origin_date date)
language sql
security definer
set search_path = ''
as $$
  select distinct schedule_origin_date
    from public.organization_growth_projections
   where organization_id = p_organization_id
     and period_end_exclusive > p_as_of_date
     and exists (
       select 1 from public.organizations where id = p_organization_id
     )
   order by 1;
$$;

revoke all on function public.read_organization_growth_schedule(uuid, date)
  from public, anon, authenticated;
grant execute on function public.read_organization_growth_schedule(uuid, date)
  to service_role;

comment on function public.read_organization_growth_schedule(uuid, date) is
  'Service-only growth schedule read. Returns distinct schedule origins behind active/upcoming projection rows; no amounts, points, scopes or digests. Granted to service_role only.';
