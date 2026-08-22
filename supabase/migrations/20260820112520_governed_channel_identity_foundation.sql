-- Governed dynamic channel identity foundation. See specs/018 and ADR 0026.
--
-- Channels are business identities owned by an organization. They are not
-- providers, integration connections, credentials, capability grants, or
-- campaign actions. This migration is deliberately additive: the legacy text
-- labels remain immutable source snapshots while new writes move to channel_id.

-- Permission catalogue -------------------------------------------------------

insert into public.permissions (key, description, scope) values
  ('channel.read', 'See organization-owned channels and their mappings.', 'organization'),
  ('channel.manage', 'Create, rename, categorize, archive, and restore channels.', 'organization'),
  ('channel.map_branch', 'Map channel aliases and branch applicability.', 'organization'),
  ('report.read', 'See governed report package status and bounded evidence.', 'organization'),
  ('report.upload', 'Upload a governed report package to private storage.', 'organization'),
  ('report.retry', 'Retry a failed governed report package.', 'organization'),
  ('report.contract_approve', 'Approve report contracts and financial semantics.', 'organization'),
  ('report.download_sensitive', 'Download an original sensitive report workbook.', 'organization'),
  ('recommendation.triage', 'Acknowledge, dismiss, or plan a channel recommendation.', 'organization'),
  ('benchmark.read', 'Read approved benchmark evidence.', 'organization'),
  ('benchmark.approve', 'Approve benchmark evidence for client visibility.', 'organization'),
  ('benchmark.contribute', 'Change peer benchmark contribution consent.', 'organization');

insert into public.organization_role_permissions (organization_role, permission_key) values
  ('viewer', 'channel.read'),
  ('viewer', 'report.read'),
  ('viewer', 'benchmark.read'),
  ('operator', 'channel.read'),
  ('operator', 'channel.map_branch'),
  ('operator', 'report.read'),
  ('operator', 'report.upload'),
  ('operator', 'report.retry'),
  ('operator', 'recommendation.triage'),
  ('operator', 'benchmark.read'),
  ('admin', 'channel.read'),
  ('admin', 'channel.map_branch'),
  ('admin', 'channel.manage'),
  ('admin', 'report.read'),
  ('admin', 'report.upload'),
  ('admin', 'report.retry'),
  ('admin', 'report.contract_approve'),
  ('admin', 'report.download_sensitive'),
  ('admin', 'recommendation.triage'),
  ('admin', 'benchmark.read'),
  ('admin', 'benchmark.approve'),
  ('admin', 'benchmark.contribute'),
  ('owner', 'channel.read'),
  ('owner', 'channel.map_branch'),
  ('owner', 'channel.manage'),
  ('owner', 'report.read'),
  ('owner', 'report.upload'),
  ('owner', 'report.retry'),
  ('owner', 'report.contract_approve'),
  ('owner', 'report.download_sensitive'),
  ('owner', 'recommendation.triage'),
  ('owner', 'benchmark.read'),
  ('owner', 'benchmark.approve'),
  ('owner', 'benchmark.contribute');

-- Stable identity ------------------------------------------------------------

create or replace function private.normalize_channel_alias(source_value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(pg_catalog.normalize(source_value, 'NFC')),
      '\\s+', ' ', 'g'
    )
  );
$$;

revoke all on function private.normalize_channel_alias(text) from public;

create table public.organization_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  key text not null check (key ~ '^[a-z][a-z0-9.-]{1,80}$'),
  display_name text not null check (char_length(display_name) between 1 and 160),
  category text not null check (category in ('marketplace', 'owned_digital', 'physical', 'reseller', 'other')),
  template_key text check (template_key is null or template_key ~ '^[a-z][a-z0-9.-]{1,80}$'),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references auth.users(id),
  archived_by uuid references auth.users(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, key),
  check (
    (status = 'active' and archived_at is null and archived_by is null)
    or (status = 'archived' and archived_at is not null and archived_by is not null)
  )
);

comment on table public.organization_channels is
  'Organization-owned business channel identity. It is not a provider connection, credential, capability grant, or campaign action.';

create table public.organization_channel_branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_id uuid not null,
  branch_id uuid not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  effective_from date,
  effective_to date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, channel_id, branch_id),
  foreign key (organization_id, channel_id)
    references public.organization_channels(organization_id, id) on delete restrict,
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete restrict,
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create table public.channel_source_aliases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel_id uuid not null,
  alias text not null check (char_length(alias) between 1 and 300),
  normalized_alias text not null check (char_length(normalized_alias) between 1 and 300),
  source_scope text not null check (
    source_scope in ('onboarding', 'normalized_metric', 'economics_entry', 'cost_rate', 'report_package', 'manual')
  ),
  source_record_reference text check (source_record_reference is null or char_length(source_record_reference) <= 200),
  status text not null default 'active' check (status in ('active', 'retired')),
  effective_from date,
  effective_to date,
  confirmed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, channel_id)
    references public.organization_channels(organization_id, id) on delete restrict,
  check (normalized_alias = private.normalize_channel_alias(alias)),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create unique index channel_source_aliases_active_scope_alias_idx
  on public.channel_source_aliases (organization_id, source_scope, normalized_alias)
  where status = 'active';

create index organization_channels_organization_status_idx
  on public.organization_channels (organization_id, status, display_name);
create index organization_channel_branches_organization_branch_idx
  on public.organization_channel_branches (organization_id, branch_id)
  where status = 'active';
create index channel_source_aliases_organization_channel_idx
  on public.channel_source_aliases (organization_id, channel_id)
  where status = 'active';

create or replace function private.prevent_organization_channel_key_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.key is distinct from old.key then
    raise exception 'organization_channel_key_is_immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.prevent_organization_channel_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'organization_channel_hard_delete_forbidden' using errcode = '55000';
end;
$$;

revoke all on function private.prevent_organization_channel_key_change() from public;
revoke all on function private.prevent_organization_channel_delete() from public;

create trigger organization_channels_set_updated_at
before update on public.organization_channels
for each row execute function public.set_updated_at();
create trigger organization_channels_prevent_key_change
before update on public.organization_channels
for each row execute function private.prevent_organization_channel_key_change();
create trigger organization_channels_prevent_delete
before delete on public.organization_channels
for each row execute function private.prevent_organization_channel_delete();
create trigger organization_channel_branches_set_updated_at
before update on public.organization_channel_branches
for each row execute function public.set_updated_at();
create trigger channel_source_aliases_set_updated_at
before update on public.channel_source_aliases
for each row execute function public.set_updated_at();

-- Legacy labels remain evidence ------------------------------------------------

alter table public.normalized_metrics
  add column channel_id uuid,
  add column channel_label_snapshot text;
alter table public.channel_economics_entries
  add column channel_id uuid,
  add column channel_label_snapshot text;
alter table public.cost_component_rates
  add column channel_id uuid,
  add column channel_label_snapshot text;

alter table public.normalized_metrics
  add constraint normalized_metrics_channel_id_tenant_fk
  foreign key (organization_id, channel_id)
  references public.organization_channels(organization_id, id) on delete restrict;
alter table public.channel_economics_entries
  add constraint channel_economics_entries_channel_id_tenant_fk
  foreign key (organization_id, channel_id)
  references public.organization_channels(organization_id, id) on delete restrict;
alter table public.cost_component_rates
  add constraint cost_component_rates_channel_id_tenant_fk
  foreign key (organization_id, channel_id)
  references public.organization_channels(organization_id, id) on delete restrict;

create index normalized_metrics_channel_id_idx
  on public.normalized_metrics (organization_id, channel_id, period_start desc)
  where channel_id is not null and superseded_by_id is null;
create index channel_economics_entries_channel_id_idx
  on public.channel_economics_entries (organization_id, channel_id, period_start desc)
  where channel_id is not null;
create index cost_component_rates_channel_id_idx
  on public.cost_component_rates (organization_id, channel_id, effective_from desc)
  where channel_id is not null;

create or replace function private.capture_channel_label_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.channel_label_snapshot is null then
    new.channel_label_snapshot := new.channel;
  elsif tg_op = 'UPDATE' then
    if old.channel_label_snapshot is not null
      and new.channel_label_snapshot is distinct from old.channel_label_snapshot then
      raise exception 'channel_label_snapshot_is_immutable' using errcode = '23514';
    end if;
    if new.channel_label_snapshot is null then
      new.channel_label_snapshot := coalesce(old.channel_label_snapshot, new.channel);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.capture_channel_label_snapshot() from public;

create trigger normalized_metrics_capture_channel_label_snapshot
before insert or update on public.normalized_metrics
for each row execute function private.capture_channel_label_snapshot();
create trigger channel_economics_entries_capture_channel_label_snapshot
before insert or update on public.channel_economics_entries
for each row execute function private.capture_channel_label_snapshot();
create trigger cost_component_rates_capture_channel_label_snapshot
before insert or update on public.cost_component_rates
for each row execute function private.capture_channel_label_snapshot();

-- `normalized_metrics` is append-only by design. This migration changes only
-- newly-added structural lineage columns, never an observed value or revision,
-- and does so inside this transaction. Re-enable the guard before migration
-- completion so ordinary writes retain the original invariant.
alter table public.normalized_metrics disable trigger normalized_metrics_prevent_mutation;

update public.normalized_metrics
set channel_label_snapshot = channel
where channel is not null and channel_label_snapshot is null;
update public.channel_economics_entries
set channel_label_snapshot = channel
where channel is not null and channel_label_snapshot is null;
update public.cost_component_rates
set channel_label_snapshot = channel
where channel is not null and channel_label_snapshot is null;

with legacy_labels as (
  select organization_id, channel_label_snapshot as label
  from public.normalized_metrics
  where channel_label_snapshot is not null and btrim(channel_label_snapshot) <> ''
  union
  select organization_id, channel_label_snapshot
  from public.channel_economics_entries
  where channel_label_snapshot is not null and btrim(channel_label_snapshot) <> ''
  union
  select organization_id, channel_label_snapshot
  from public.cost_component_rates
  where channel_label_snapshot is not null and btrim(channel_label_snapshot) <> ''
), distinct_labels as (
  select organization_id, private.normalize_channel_alias(label) as normalized_label, min(label) as display_name
  from legacy_labels
  group by organization_id, private.normalize_channel_alias(label)
)
insert into public.organization_channels (
  organization_id, key, display_name, category, template_key, created_by
)
select
  organization_id,
  'legacy-' || substr(md5(organization_id::text || ':' || normalized_label), 1, 24),
  display_name,
  'other',
  null,
  (select created_by from public.organizations where id = distinct_labels.organization_id)
from distinct_labels;

insert into public.channel_source_aliases (
  organization_id, channel_id, alias, normalized_alias, source_scope, source_record_reference, confirmed_at, created_by
)
select metric.organization_id, channel.id, metric.channel_label_snapshot,
  private.normalize_channel_alias(metric.channel_label_snapshot), 'normalized_metric', metric.id::text,
  now(), null
from public.normalized_metrics metric
join public.organization_channels channel
  on channel.organization_id = metric.organization_id
 and channel.key = 'legacy-' || substr(md5(metric.organization_id::text || ':' || private.normalize_channel_alias(metric.channel_label_snapshot)), 1, 24)
where metric.channel_label_snapshot is not null and btrim(metric.channel_label_snapshot) <> ''
on conflict do nothing;

insert into public.channel_source_aliases (
  organization_id, channel_id, alias, normalized_alias, source_scope, source_record_reference, confirmed_at, created_by
)
select entry.organization_id, channel.id, entry.channel_label_snapshot,
  private.normalize_channel_alias(entry.channel_label_snapshot), 'economics_entry', entry.id::text,
  now(), null
from public.channel_economics_entries entry
join public.organization_channels channel
  on channel.organization_id = entry.organization_id
 and channel.key = 'legacy-' || substr(md5(entry.organization_id::text || ':' || private.normalize_channel_alias(entry.channel_label_snapshot)), 1, 24)
where entry.channel_label_snapshot is not null and btrim(entry.channel_label_snapshot) <> ''
on conflict do nothing;

insert into public.channel_source_aliases (
  organization_id, channel_id, alias, normalized_alias, source_scope, source_record_reference, confirmed_at, created_by
)
select rate.organization_id, channel.id, rate.channel_label_snapshot,
  private.normalize_channel_alias(rate.channel_label_snapshot), 'cost_rate', rate.id::text,
  now(), rate.created_by
from public.cost_component_rates rate
join public.organization_channels channel
  on channel.organization_id = rate.organization_id
 and channel.key = 'legacy-' || substr(md5(rate.organization_id::text || ':' || private.normalize_channel_alias(rate.channel_label_snapshot)), 1, 24)
where rate.channel_label_snapshot is not null and btrim(rate.channel_label_snapshot) <> ''
on conflict do nothing;

update public.normalized_metrics metric
set channel_id = alias.channel_id
from public.channel_source_aliases alias
where alias.organization_id = metric.organization_id
  and alias.source_scope = 'normalized_metric'
  and alias.source_record_reference = metric.id::text
  and metric.channel_id is null;

update public.channel_economics_entries entry
set channel_id = alias.channel_id
from public.channel_source_aliases alias
where alias.organization_id = entry.organization_id
  and alias.source_scope = 'economics_entry'
  and alias.source_record_reference = entry.id::text
  and entry.channel_id is null;

update public.cost_component_rates rate
set channel_id = alias.channel_id
from public.channel_source_aliases alias
where alias.organization_id = rate.organization_id
  and alias.source_scope = 'cost_rate'
  and alias.source_record_reference = rate.id::text
  and rate.channel_id is null;

alter table public.normalized_metrics enable trigger normalized_metrics_prevent_mutation;

-- Least-privilege access and tenant RLS --------------------------------------

revoke all on table public.organization_channels from anon, authenticated;
revoke all on table public.organization_channel_branches from anon, authenticated;
revoke all on table public.channel_source_aliases from anon, authenticated;
grant select, insert, update on table public.organization_channels to authenticated;
grant select, insert, update on table public.organization_channel_branches to authenticated;
grant select, insert, update on table public.channel_source_aliases to authenticated;

alter table public.organization_channels enable row level security;
alter table public.organization_channels force row level security;
alter table public.organization_channel_branches enable row level security;
alter table public.organization_channel_branches force row level security;
alter table public.channel_source_aliases enable row level security;
alter table public.channel_source_aliases force row level security;

create policy "members with channel read can view organization channels"
on public.organization_channels for select to authenticated
using (private.has_organization_permission(organization_id, 'channel.read'));
create policy "owners and admins can manage organization channels"
on public.organization_channels for insert to authenticated
with check (
  private.has_organization_permission(organization_id, 'channel.manage')
  and created_by = (select auth.uid())
);
create policy "owners and admins can update organization channels"
on public.organization_channels for update to authenticated
using (private.has_organization_permission(organization_id, 'channel.manage'))
with check (private.has_organization_permission(organization_id, 'channel.manage'));

create policy "members with channel read can view channel branch mappings"
on public.organization_channel_branches for select to authenticated
using (private.has_organization_permission(organization_id, 'channel.read'));
create policy "operators can map channel branches"
on public.organization_channel_branches for insert to authenticated
with check (
  private.has_organization_permission(organization_id, 'channel.map_branch')
  and created_by = (select auth.uid())
);
create policy "operators can update channel branch mappings"
on public.organization_channel_branches for update to authenticated
using (private.has_organization_permission(organization_id, 'channel.map_branch'))
with check (private.has_organization_permission(organization_id, 'channel.map_branch'));

create policy "members with channel read can view channel source aliases"
on public.channel_source_aliases for select to authenticated
using (private.has_organization_permission(organization_id, 'channel.read'));
create policy "operators can map channel aliases"
on public.channel_source_aliases for insert to authenticated
with check (private.has_organization_permission(organization_id, 'channel.map_branch'));
create policy "operators can update channel aliases"
on public.channel_source_aliases for update to authenticated
using (private.has_organization_permission(organization_id, 'channel.map_branch'))
with check (private.has_organization_permission(organization_id, 'channel.map_branch'));
