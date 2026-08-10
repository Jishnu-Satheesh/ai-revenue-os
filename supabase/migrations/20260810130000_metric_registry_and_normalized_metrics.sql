-- Metric registry and normalized metrics, first slice.
-- See specs/015-metric-registry-and-normalized-metrics.md.
--
-- specs/003-integration-hub.md deliberately stops at the typed `IngestionSink`
-- handoff and excludes "cross-provider normalized business schemas". Nothing
-- picked that handoff up. This is that consumer: one dimensioned series per
-- registered business quantity, with a declared unit, declared aggregation
-- semantics, and a quality tier.
--
-- Deferred to later slices: `metric_baselines`, pack definition seeds beyond
-- the core vocabulary, and the projection layer that maps ingested record
-- types onto observations.
--
-- The core owns structure; Industry Packs own vocabulary. A core table must
-- never gain an `orders_count` column.

-- Definitions ----------------------------------------------------------------

-- Vocabulary rather than tenant data, following `public.subject_kinds`. A row
-- with a null `organization_id` is core or pack vocabulary visible to every
-- tenant; a non-null `organization_id` is one organization's custom key.
create table public.metric_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  label text not null check (char_length(label) between 1 and 160),
  owner_scope text not null check (owner_scope in ('core', 'pack', 'organization')),
  pack_slug text check (char_length(pack_slug) between 1 and 60),

  -- A ratio stores its numerator and denominator and never a quotient; see the
  -- observation checks below. The kind is what makes that enforceable.
  value_kind text not null check (value_kind in ('count', 'money', 'ratio', 'duration', 'rating')),
  unit text check (unit is null or char_length(unit) between 1 and 40),

  -- specs/015 section 4.3: a definition whose aggregation is undeclared cannot
  -- be registered, so that no consumer has to guess how to combine rows.
  aggregation text not null check (
    aggregation in ('sum', 'ratio_of_sums', 'mean', 'weighted_mean', 'percentile', 'last')
  ),
  percentile_p numeric(5, 4) check (percentile_p is null or (percentile_p > 0 and percentile_p < 1)),

  rating_min numeric,
  rating_max numeric,

  default_quality_tier text not null default 'measured' check (
    default_quality_tier in ('measured', 'derived', 'estimated', 'assumed')
  ),

  replaced_by_key text check (replaced_by_key is null or replaced_by_key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check ((owner_scope = 'pack') = (pack_slug is not null)),
  check ((owner_scope = 'organization') = (organization_id is not null)),
  check ((aggregation = 'percentile') = (percentile_p is not null)),
  check (
    (value_kind = 'rating') = (rating_min is not null and rating_max is not null)
  ),
  check (rating_max is null or rating_max > rating_min),
  check (effective_to is null or effective_to >= effective_from),
  check (replaced_by_key is null or replaced_by_key <> key),

  -- Referenced by the composite foreign key on observations, which is what
  -- lets the value-shape checks below be declarative instead of a trigger.
  unique (id, value_kind)
);

-- Core and pack keys are globally unique; an organization's custom keys are
-- unique within that organization.
create unique index metric_definitions_global_key_idx
  on public.metric_definitions (key)
  where organization_id is null;

create unique index metric_definitions_organization_key_idx
  on public.metric_definitions (organization_id, key)
  where organization_id is not null;

-- specs/015 section 4.1: an organization key that collides with shared
-- vocabulary is a registration conflict, surfaced rather than silently
-- shadowing the shared definition.
create or replace function private.reject_shadowed_metric_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is not null
    and exists (
      select 1
      from public.metric_definitions existing
      where existing.organization_id is null
        and existing.key = new.key
    ) then
    raise exception 'metric_key_conflicts_with_shared_vocabulary' using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger metric_definitions_reject_shadowed_key
before insert or update of key, organization_id on public.metric_definitions
for each row execute function private.reject_shadowed_metric_key();

create trigger metric_definitions_set_updated_at before update on public.metric_definitions
for each row execute function public.set_updated_at();

-- Dimensions -----------------------------------------------------------------

-- Branch, channel, and currency are first-class columns on an observation
-- rather than dimensions: RLS, the money checks, and period bucketing all need
-- them structurally. This registry exists for everything a pack adds on top.
--
-- `cardinality_max` is enforced at the write boundary, not by a constraint: a
-- bound on distinct values across a table is not expressible as a check.
create table public.metric_dimension_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  label text not null check (char_length(label) between 1 and 160),
  owner_scope text not null check (owner_scope in ('core', 'pack')),
  pack_slug text check (char_length(pack_slug) between 1 and 60),
  cardinality_max integer not null check (cardinality_max between 1 and 10000),
  created_at timestamptz not null default now(),
  check ((owner_scope = 'pack') = (pack_slug is not null)),
  unique (key)
);

-- Observations ---------------------------------------------------------------

create table public.normalized_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  metric_definition_id uuid not null references public.metric_definitions(id) on delete restrict,

  -- Denormalized so the value-shape checks can be declarative. The composite
  -- foreign key below guarantees it matches the definition.
  value_kind text not null,

  subject_kind text not null default 'organization' references public.subject_kinds(key),
  subject_ref text check (subject_ref is null or char_length(subject_ref) between 1 and 200),
  channel text check (channel is null or char_length(channel) between 1 and 60),
  dimensions jsonb not null default '{}'::jsonb check (
    jsonb_typeof(dimensions) = 'object' and pg_column_size(dimensions) <= 2048
  ),

  period_grain text not null check (period_grain in ('hour', 'day', 'week', 'month')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  -- specs/015 section 4.4: boundaries are computed in the branch timezone, not
  -- UTC, and the zone in force is recorded so a later branch timezone change
  -- does not silently reinterpret history.
  period_timezone text not null check (char_length(period_timezone) between 1 and 60),

  value_numerator numeric not null,
  value_denominator numeric,
  currency text check (currency is null or char_length(currency) = 3),

  quality_tier text not null check (
    quality_tier in ('measured', 'derived', 'estimated', 'assumed')
  ),

  revision integer not null default 1 check (revision > 0),
  superseded_by_id uuid references public.normalized_metrics(id) on delete restrict,
  supersede_reason text check (supersede_reason is null or char_length(supersede_reason) <= 500),

  source_ingestion_run_id uuid,
  observed_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  foreign key (metric_definition_id, value_kind) references public.metric_definitions(id, value_kind),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,

  check (period_end > period_start),
  check (
    (subject_kind = 'organization' and subject_ref is null)
    or (subject_kind <> 'organization' and subject_ref is not null)
  ),

  -- A ratio or a rating stores both parts. Storing only the quotient makes the
  -- series impossible to aggregate correctly across periods, branches, or
  -- channels, because the mean of daily rates is not the period rate unless
  -- every day carried identical volume.
  check (
    case
      when value_kind in ('ratio', 'rating') then value_denominator is not null and value_denominator > 0
      else value_denominator is null
    end
  ),
  check ((value_kind = 'money') = (currency is not null)),
  -- Money is integer minor units; counts are whole.
  check (value_kind not in ('money', 'count') or value_numerator = trunc(value_numerator)),
  check (superseded_by_id is null or superseded_by_id <> id)
);

-- A restatement is a new revision, so a tuple carries at most one live row.
-- "Current" is `superseded_by_id is null` and has no second source of truth.
create unique index normalized_metrics_revision_idx
  on public.normalized_metrics (
    organization_id,
    metric_definition_id,
    subject_kind,
    (coalesce(subject_ref, '')),
    (coalesce(channel, '')),
    dimensions,
    period_grain,
    period_start,
    revision
  );

create unique index normalized_metrics_current_revision_idx
  on public.normalized_metrics (
    organization_id,
    metric_definition_id,
    subject_kind,
    (coalesce(subject_ref, '')),
    (coalesce(channel, '')),
    dimensions,
    period_grain,
    period_start
  )
  where superseded_by_id is null;

create index normalized_metrics_series_idx
  on public.normalized_metrics (organization_id, metric_definition_id, period_grain, period_start desc)
  where superseded_by_id is null;

create index normalized_metrics_subject_idx
  on public.normalized_metrics (organization_id, subject_kind, subject_ref, period_start desc)
  where superseded_by_id is null and subject_ref is not null;

create index normalized_metrics_branch_idx
  on public.normalized_metrics (organization_id, branch_id, period_start desc)
  where superseded_by_id is null;

create index normalized_metrics_ingestion_run_idx
  on public.normalized_metrics (source_ingestion_run_id)
  where source_ingestion_run_id is not null;

-- An organization may only record observations against shared vocabulary or
-- its own definitions. Not expressible as a check, because it needs the join.
create or replace function private.enforce_metric_definition_tenancy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  definition_organization_id uuid;
  definition_is_active boolean;
begin
  select organization_id, is_active
  into definition_organization_id, definition_is_active
  from public.metric_definitions
  where id = new.metric_definition_id;

  if definition_organization_id is not null and definition_organization_id <> new.organization_id then
    raise exception 'metric_definition_belongs_to_another_organization' using errcode = '42501';
  end if;

  if not definition_is_active then
    raise exception 'metric_definition_is_inactive' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger normalized_metrics_enforce_definition_tenancy
before insert on public.normalized_metrics
for each row execute function private.enforce_metric_definition_tenancy();

-- Observations are append-only. A correction is a new revision, and the only
-- permitted mutation is closing a row by pointing it at its successor.
create or replace function private.prevent_normalized_metric_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.superseded_by_id is not null then
    raise exception 'normalized_metric_already_superseded' using errcode = '23514';
  end if;

  if new.superseded_by_id is null then
    raise exception 'normalized_metric_is_append_only' using errcode = '23514';
  end if;

  if pg_catalog.to_jsonb(new) - 'superseded_by_id' - 'supersede_reason'
    is distinct from pg_catalog.to_jsonb(old) - 'superseded_by_id' - 'supersede_reason' then
    raise exception 'normalized_metric_is_append_only' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger normalized_metrics_prevent_mutation
before update on public.normalized_metrics
for each row execute function private.prevent_normalized_metric_mutation();

-- Goal binding ---------------------------------------------------------------

-- specs/005-decision-engine-v1.md section 15, item 3. `goals.metric` stays for
-- display and audit; screening reads `metric_key` only.
--
-- No foreign key: a key resolves against shared vocabulary or the
-- organization's own definitions, and neither unique index alone is a valid
-- reference target. Resolution and existence are enforced by the read port,
-- which has to handle the shared-versus-custom precedence regardless.
alter table public.goals
  add column metric_key text check (
    metric_key is null or metric_key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'
  );

create index goals_metric_key_idx
  on public.goals (organization_id, metric_key)
  where metric_key is not null;

-- Core vocabulary ------------------------------------------------------------

-- Deliberately small. Everything a restaurant measures belongs to the
-- Restaurant Pack seed, which lands with the projection slice.
insert into public.metric_definitions (key, label, owner_scope, value_kind, unit, aggregation)
values
  ('revenue.gross', 'Gross revenue', 'core', 'money', null, 'sum'),
  ('transactions.count', 'Transactions', 'core', 'count', null, 'sum')
on conflict do nothing;

-- Row level security ---------------------------------------------------------

alter table public.metric_definitions enable row level security;
alter table public.metric_dimension_definitions enable row level security;
alter table public.normalized_metrics enable row level security;
alter table public.normalized_metrics force row level security;

-- Shared vocabulary is readable by anyone signed in; a custom definition is
-- readable only by its own organization.
create policy "members can read metric definitions"
on public.metric_definitions for select to authenticated
using (organization_id is null or private.is_organization_member(organization_id));

create policy "authenticated can read metric dimension definitions"
on public.metric_dimension_definitions for select to authenticated
using (true);

create policy "members can read normalized metrics"
on public.normalized_metrics for select to authenticated
using (private.is_organization_member(organization_id));

-- Reads only. Definitions are seeded and observations are written by the
-- ingestion path, both of which run with the service role; issuing a write
-- grant here would put an unaudited path to the decision inputs in the browser.
grant select on table public.metric_definitions to authenticated;
grant select on table public.metric_dimension_definitions to authenticated;
grant select on table public.normalized_metrics to authenticated;

-- No audit trigger on the definition tables. `audit_events.organization_id` is
-- not null, and shared vocabulary has no organization; the trigger would
-- coalesce to the definition's own id and violate the organization foreign
-- key. Auditing arrives with organization-custom definitions, which do have a
-- tenant, and observations are never audited row-by-row at ingestion volume.
