-- ---------------------------------------------------------------------------
-- Organization revenue snapshots (GROWTH slice, ADR 0060 follow-up)
--
-- One nightly row per organization holding the verified scenario input behind
-- the home "Current vs projected growth" section, so the page reads a stored
-- answer instead of running analysis on every view. Horizons (1/3/6/12
-- months) derive deterministically from the stored monthly figures at read
-- time; nothing here precomputes them.
--
-- Writes come only from the nightly worker through the service role with an
-- explicit organization scope plus the (organization_id, snapshot_date)
-- upsert key. There is deliberately no client write policy: authenticated
-- callers read their own organization's rows and nothing else. No audit
-- trigger: these are system-written derived rows, not user mutations, and a
-- nightly audit event per organization would be noise, not accountability.
-- ---------------------------------------------------------------------------

create table public.organization_revenue_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  snapshot_date date not null,
  scenario_input jsonb not null,
  ai_note text null,
  input_digest text not null,
  created_at timestamptz not null default now(),
  constraint organization_revenue_snapshots_unique_org_day
    unique (organization_id, snapshot_date)
);

create index organization_revenue_snapshots_org_day_idx
  on public.organization_revenue_snapshots (organization_id, snapshot_date desc);

alter table public.organization_revenue_snapshots enable row level security;
alter table public.organization_revenue_snapshots force row level security;

create policy "members read revenue snapshots"
on public.organization_revenue_snapshots for select to authenticated
using (private.is_organization_member(organization_id));

grant select on table public.organization_revenue_snapshots to authenticated;
