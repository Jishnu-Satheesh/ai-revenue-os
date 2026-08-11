-- The two inputs that made a derived margin impossible.
--
-- specs/012 section 11 recorded both: `packaging` is charged per item and no
-- registered metric counted items, and `promotion_funding` is `sourced` with
-- nowhere for an amount to come from. Every applicable component therefore had
-- one that could never be priced, so every Restaurant Pack margin graded
-- `indicative` and fell back to the operator's reported figure.

-- Units sold ------------------------------------------------------------------

-- Core vocabulary, not pack. Every business sells a countable thing, whatever
-- it calls it; only the word for it belongs to a pack. This is deliberately not
-- the transaction count: a three-item basket is one transaction and three
-- units, and charging packaging per transaction understates it on every
-- multi-item order.
insert into public.metric_definitions (
  key, label, owner_scope, value_kind, unit, aggregation, economics_role
)
values ('units.count', 'Units sold', 'core', 'count', 'unit', 'sum', 'unit_count')
on conflict do nothing;

-- Sourced components ------------------------------------------------------------

-- Where a `sourced` component's amount comes from.
--
-- A sourced cost is a measured amount per period per channel, which is exactly
-- what a metric observation is. Modelling it as a rate would mean pretending a
-- period total is a rate, and `cost_component_rates` has no column for it
-- because there should not be one.
--
-- Held on the definition, so the pack that registers the component also names
-- the metric that feeds it. An organization whose data arrives under a
-- different key registers a custom metric with that key -- the same override
-- path economics roles use, so there is one mechanism rather than two.
alter table public.cost_component_definitions
  add column source_metric_key text check (
    source_metric_key is null
    or source_metric_key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'
  );

-- Only a sourced component may name one. On any other kind the amount is
-- computed from a rate, and a metric key sitting there would be silently
-- ignored -- worse than being rejected.
alter table public.cost_component_definitions
  add constraint cost_component_definitions_source_metric_kind_check check (
    source_metric_key is null or computation_kind = 'sourced'
  );

comment on column public.cost_component_definitions.source_metric_key is
  'For a sourced component, the registered metric supplying its amount per period. Null for every other computation kind.';

-- Restaurant Pack vocabulary: the operator's share of a marketplace-funded
-- discount, which varies per promotion and arrives on the provider report
-- rather than from any standing rate.
insert into public.metric_definitions (
  key, label, owner_scope, pack_slug, value_kind, aggregation
)
values (
  'promotion.funding', 'Promotion funding share', 'pack', 'restaurant', 'money', 'sum'
)
on conflict do nothing;

update public.cost_component_definitions
set source_metric_key = 'promotion.funding'
where organization_id is null and key = 'promotion_funding';

-- Coverage --------------------------------------------------------------------

-- A sourced component is never priced by a rate, so the coverage function has
-- to judge it differently: it is covered when its bound metric actually has an
-- observation. Without this the operator view reports it unpriced forever and
-- sends them to type a rate that does not exist.
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
      definition.source_metric_key,
      definition.organization_id
    from public.cost_component_definitions definition
    where definition.is_active
      and (definition.organization_id is null
           or definition.organization_id = target_organization_id)
  ),
  resolved as (
    select distinct on (visible.key)
      visible.id, visible.key, visible.label, visible.computation_kind, visible.source_metric_key
    from visible
    order by visible.key, visible.organization_id nulls last
  ),
  sourced as (
    select
      resolved.key,
      exists (
        select 1
        from public.normalized_metrics observation
        join public.metric_definitions metric
          on metric.id = observation.metric_definition_id
        where observation.organization_id = target_organization_id
          and observation.superseded_by_id is null
          and metric.key = resolved.source_metric_key
      ) as has_observations,
      -- Ranked, not alphabetical. `min()` on the raw text would order
      -- assumed, derived, estimated, measured and so call `derived` weaker
      -- than `estimated`, which inverts two tiers of the trust hierarchy.
      (
        select (array['assumed', 'estimated', 'derived', 'measured'])[
          pg_catalog.min(
            case observation.quality_tier
              when 'assumed' then 1 when 'estimated' then 2
              when 'derived' then 3 when 'measured' then 4
            end
          )
        ]
        from public.normalized_metrics observation
        join public.metric_definitions metric
          on metric.id = observation.metric_definition_id
        where observation.organization_id = target_organization_id
          and observation.superseded_by_id is null
          and metric.key = resolved.source_metric_key
      ) as observed_tier
    from resolved
    where resolved.source_metric_key is not null
  )
  select
    resolved.key,
    resolved.label,
    resolved.computation_kind,
    case
      when resolved.source_metric_key is not null
        then coalesce(sourced.has_observations, false)
      else pg_catalog.count(rate.id) > 0
    end as has_rate,
    case
      when resolved.source_metric_key is not null then sourced.observed_tier
      else (array['assumed', 'estimated', 'derived', 'measured'])[
        pg_catalog.min(
          case rate.quality_tier
            when 'assumed' then 1 when 'estimated' then 2
            when 'derived' then 3 when 'measured' then 4
          end
        ) filter (where rate.id is not null)
      ]
    end as weakest_tier
  from resolved
  left join sourced on sourced.key = resolved.key
  left join public.cost_component_rates rate
    on rate.definition_id = resolved.id
   and rate.organization_id = target_organization_id
  where private.is_organization_member(target_organization_id)
  group by
    resolved.key, resolved.label, resolved.computation_kind, resolved.source_metric_key,
    sourced.has_observations, sourced.observed_tier
  order by resolved.key;
$$;

revoke all on function public.get_cost_component_coverage(uuid) from public;
grant execute on function public.get_cost_component_coverage(uuid) to authenticated;
