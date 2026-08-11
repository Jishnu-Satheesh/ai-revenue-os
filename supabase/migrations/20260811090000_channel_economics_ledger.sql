-- Channel economics ledger: what a transaction actually earns after variable
-- cost. See specs/012-channel-economics-ledger.md.
--
-- The core owns the structure of unit economics; Industry Packs own the
-- vocabulary. A core table must never gain a `commission_amount` column, and
-- the core term for the unit is "transaction" — the pack maps its own entity
-- onto it.
--
-- Deferred to a later slice: channel_economics_snapshots, the pack catalog
-- seed, and the computation worker.

-- Definitions ----------------------------------------------------------------

-- Vocabulary, following public.metric_definitions: a null organization is core
-- or pack vocabulary visible to every tenant, a non-null one is a custom key.
-- What an organization actually pays lives in cost_component_rates, because
-- "commission" is the same concept everywhere while 28% on Talabat from March
-- is one tenant's fact and is the only part that changes.
create table public.cost_component_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  label text not null check (char_length(label) between 1 and 160),
  owner_scope text not null check (owner_scope in ('core', 'pack', 'organization')),
  pack_slug text check (char_length(pack_slug) between 1 and 60),

  computation_kind text not null check (
    computation_kind in ('fixed_amount', 'rate_of_revenue', 'per_unit', 'sourced')
  ),

  -- Null means the component applies to every channel. An empty array would
  -- mean "no channel", which is a component that can never apply.
  applies_to_channels text[] check (
    applies_to_channels is null or cardinality(applies_to_channels) > 0
  ),

  default_quality_tier text not null default 'assumed' check (
    default_quality_tier in ('measured', 'derived', 'estimated', 'assumed')
  ),

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check ((owner_scope = 'pack') = (pack_slug is not null)),
  check ((owner_scope = 'organization') = (organization_id is not null))
);

create unique index cost_component_definitions_global_key_idx
  on public.cost_component_definitions (key)
  where organization_id is null;

create unique index cost_component_definitions_organization_key_idx
  on public.cost_component_definitions (organization_id, key)
  where organization_id is not null;

-- Same rule as the metric registry: a custom key that shadows shared vocabulary
-- is a registration conflict, surfaced rather than silently overriding.
create or replace function private.reject_shadowed_cost_component_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is not null
    and exists (
      select 1
      from public.cost_component_definitions existing
      where existing.organization_id is null
        and existing.key = new.key
    ) then
    raise exception 'cost_component_key_conflicts_with_shared_vocabulary' using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger cost_component_definitions_reject_shadowed_key
before insert or update of key, organization_id on public.cost_component_definitions
for each row execute function private.reject_shadowed_cost_component_key();

create trigger cost_component_definitions_set_updated_at
before update on public.cost_component_definitions
for each row execute function public.set_updated_at();

-- Rates ----------------------------------------------------------------------

-- What this organization pays, effective-dated. A marketplace commission tier
-- change creates a new period here; it never rewrites a historical margin,
-- because an entry keeps the rate that was in force when it occurred.
create table public.cost_component_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  definition_id uuid not null references public.cost_component_definitions(id) on delete restrict,
  branch_id uuid,
  -- Null applies to every channel the definition covers.
  channel text check (channel is null or char_length(channel) between 1 and 60),

  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  rate_of_revenue numeric(9, 6) check (
    rate_of_revenue is null or (rate_of_revenue >= 0 and rate_of_revenue <= 1)
  ),
  currency text check (currency is null or char_length(currency) = 3),

  quality_tier text not null check (
    quality_tier in ('measured', 'derived', 'estimated', 'assumed')
  ),
  source_reference text check (source_reference is null or char_length(source_reference) <= 512),

  effective_from date not null default current_date,
  effective_to date,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete cascade,
  check (effective_to is null or effective_to > effective_from),
  -- Exactly one of the two carries the value. A rate that sets both is
  -- ambiguous about which one priced the period.
  check ((amount_minor is not null)::int + (rate_of_revenue is not null)::int <= 1),
  -- An absolute amount is money and needs its currency; a share is not.
  check ((amount_minor is not null) = (currency is not null))
);

-- One rate per scope at a time. Overlapping periods would make the rate in
-- force at a given date ambiguous, and every historical margin unreproducible.
create index cost_component_rates_lookup_idx
  on public.cost_component_rates (organization_id, definition_id, effective_from desc);

create unique index cost_component_rates_no_overlap_idx
  on public.cost_component_rates (
    organization_id,
    definition_id,
    (coalesce(branch_id::text, '')),
    (coalesce(channel, '')),
    effective_from
  );

create trigger cost_component_rates_set_updated_at
before update on public.cost_component_rates
for each row execute function public.set_updated_at();

-- Entries --------------------------------------------------------------------

create table public.channel_economics_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  grain text not null check (grain in ('transaction', 'period')),
  channel text check (channel is null or char_length(channel) between 1 and 60),

  period_start timestamptz not null,
  period_end timestamptz not null,
  period_timezone text not null check (char_length(period_timezone) between 1 and 60),

  gross_revenue_minor bigint not null,
  transaction_count integer not null default 0 check (transaction_count >= 0),
  unit_count integer check (unit_count is null or unit_count >= 0),
  currency text not null check (char_length(currency) = 3),

  -- Derived from components, or reported whole by a system of record.
  margin_source text not null check (margin_source in ('derived', 'reported')),
  completeness_grade text not null check (
    completeness_grade in ('complete', 'partial', 'indicative')
  ),

  -- Null exactly when the grade is indicative. specs/012 section 4.4 forbids
  -- reading an indicative margin as a scalar, so there is no scalar to read:
  -- the ceiling below is all that can be said.
  contribution_margin_minor bigint,
  at_most_minor bigint,

  -- A reported margin carries its own tier and no components.
  reported_quality_tier text check (
    reported_quality_tier in ('measured', 'derived', 'estimated', 'assumed')
  ),

  source_reference text check (source_reference is null or char_length(source_reference) <= 512),
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete cascade,
  check (period_end > period_start),
  check ((completeness_grade = 'indicative') = (contribution_margin_minor is null)),
  check ((completeness_grade = 'indicative') = (at_most_minor is not null)),
  check ((margin_source = 'reported') = (reported_quality_tier is not null)),
  -- A reported margin is stated, never bounded: it is measured, just not
  -- decomposed, so it can never be indicative.
  check (margin_source <> 'reported' or completeness_grade <> 'indicative')
);

create unique index channel_economics_entries_period_idx
  on public.channel_economics_entries (
    organization_id,
    (coalesce(branch_id::text, '')),
    (coalesce(channel, '')),
    grain,
    period_start
  );

create index channel_economics_entries_grade_idx
  on public.channel_economics_entries (organization_id, completeness_grade, period_start desc);

create trigger channel_economics_entries_set_updated_at
before update on public.channel_economics_entries
for each row execute function public.set_updated_at();

-- Components -----------------------------------------------------------------

-- The waterfall behind a derived margin. A missing component is recorded with a
-- zero amount and the `missing` tier rather than omitted: an absent row would
-- read as a cost of nothing and silently inflate the margin.
create table public.channel_economics_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entry_id uuid not null references public.channel_economics_entries(id) on delete cascade,
  definition_id uuid not null references public.cost_component_definitions(id) on delete restrict,
  rate_id uuid references public.cost_component_rates(id) on delete set null,

  amount_minor bigint not null,
  quality_tier text not null check (
    quality_tier in ('measured', 'derived', 'estimated', 'assumed', 'missing')
  ),

  created_at timestamptz not null default now(),

  unique (entry_id, definition_id),
  -- A missing component has no amount to record and no rate that produced it.
  check (quality_tier <> 'missing' or (amount_minor = 0 and rate_id is null))
);

create index channel_economics_components_entry_idx
  on public.channel_economics_components (entry_id);

-- Row level security ---------------------------------------------------------

alter table public.cost_component_definitions enable row level security;
alter table public.cost_component_rates enable row level security;
alter table public.channel_economics_entries enable row level security;
alter table public.channel_economics_components enable row level security;

create policy "members can read cost component definitions"
on public.cost_component_definitions for select to authenticated
using (organization_id is null or private.is_organization_member(organization_id));

-- Cost structure is commercially sensitive, so rates are admin-only reading.
create policy "admins can read cost component rates"
on public.cost_component_rates for select to authenticated
using (
  private.has_organization_role(organization_id, array['owner', 'admin']::public.organization_role[])
);

create policy "members can read channel economics entries"
on public.channel_economics_entries for select to authenticated
using (private.is_organization_member(organization_id));

create policy "members can read channel economics components"
on public.channel_economics_components for select to authenticated
using (private.is_organization_member(organization_id));

grant select on table public.cost_component_definitions to authenticated;
grant select on table public.cost_component_rates to authenticated;
grant select on table public.channel_economics_entries to authenticated;
grant select on table public.channel_economics_components to authenticated;

-- Reads only. Entries are computed by the ledger worker under the service role;
-- a browser write path would let an unaudited number become a decision input.
-- Rate editing arrives with the operator surface and will be a governed RPC.
