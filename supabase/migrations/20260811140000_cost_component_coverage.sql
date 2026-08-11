-- Which cost components are priced, without revealing what they cost.
--
-- The operator view's third question -- "what would I have to fix to trust this
-- number" (specs/012 section 7) -- needs to know whether each component has a
-- rate and how well it is known. It must not need the rate itself.
--
-- Reading public.cost_component_rates is not an option: specs/012 section 9
-- makes cost structure confidential and the table is owner/admin only, so an
-- operator or viewer would see every priced component reported as unpriced and
-- be sent to re-enter figures that already exist.
--
-- Deriving it from the entries' own components does not work either. A margin
-- that came in `reported` carries no components at all, which is exactly the
-- state a client starts in, so coverage would read zero for precisely the
-- organizations the task list exists to help.
--
-- So this returns coverage metadata and nothing else. A percentage is
-- commercially sensitive; "commission is priced, from a contract" is the
-- readiness signal every member needs to see.

create or replace function public.get_cost_component_coverage(
  target_organization_id uuid
)
returns table (
  key text,
  label text,
  computation_kind text,
  has_rate boolean,
  weakest_tier text
)
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select
      definition.id,
      definition.key,
      definition.label,
      definition.computation_kind,
      definition.organization_id
    from public.cost_component_definitions definition
    where definition.is_active
      and (definition.organization_id is null
           or definition.organization_id = target_organization_id)
  ),
  -- A custom definition outranks shared vocabulary for the same key, the same
  -- most-specific-wins rule the registry uses everywhere else.
  resolved as (
    select distinct on (visible.key)
      visible.id, visible.key, visible.label, visible.computation_kind
    from visible
    order by visible.key, visible.organization_id nulls last
  )
  select
    resolved.key,
    resolved.label,
    resolved.computation_kind,
    count(rate.id) > 0 as has_rate,
    -- The weakest tier across every rate for the component: one guess among
    -- otherwise measured rates is what drags a margin down to `partial`, so it
    -- is the tier worth surfacing. Ranked numerically, then mapped back to the
    -- name the application reads.
    (array['assumed', 'estimated', 'derived', 'measured'])[
      min(
        case rate.quality_tier
          when 'assumed' then 1 when 'estimated' then 2
          when 'derived' then 3 when 'measured' then 4
        end
      ) filter (where rate.id is not null)
    ] as weakest_tier
  from resolved
  left join public.cost_component_rates rate
    on rate.definition_id = resolved.id
   and rate.organization_id = target_organization_id
  where private.is_organization_member(target_organization_id)
  group by resolved.key, resolved.label, resolved.computation_kind
  order by resolved.key;
$$;

revoke all on function public.get_cost_component_coverage(uuid) from public;
grant execute on function public.get_cost_component_coverage(uuid) to authenticated;
