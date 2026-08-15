-- Campaign Bundle control plane.
--
-- Postgres is authoritative for what was proposed, what a human approved, and
-- what that approval covers. Everything here follows from one rule: an approval
-- names an exact bundle version and an exact digest, and nothing may edit its
-- way out of that. Bundle versions and their children are immutable, version
-- numbers are assigned under a campaign lock, and approvals and attestations
-- are append-only.

-- ---------------------------------------------------------------------------
-- Governed brand assets
-- ---------------------------------------------------------------------------

create table public.organization_brand_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 160),
  asset_role text not null check (asset_role in ('logo', 'product', 'venue', 'team', 'other')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

-- A version becomes usable only after the server has decoded, re-encoded, and
-- hashed the bytes. Until then it is a row pointing at an unverified upload,
-- and generation must not touch it.
create table public.organization_brand_asset_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_asset_id uuid not null,
  version integer not null check (version > 0),
  storage_path text not null check (char_length(storage_path) between 1 and 1024),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size > 0),
  width_px integer not null check (width_px > 0),
  height_px integer not null check (height_px > 0),
  is_usable boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, brand_asset_id, version),
  foreign key (organization_id, brand_asset_id)
    references public.organization_brand_assets (organization_id, id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- Campaign identity and its immutable source
-- ---------------------------------------------------------------------------

create table public.campaign_briefs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  objective text not null check (char_length(objective) between 1 and 600),
  audience text not null check (char_length(audience) between 1 and 600),
  offer text check (char_length(offer) between 1 and 600),
  requested_channels text[] not null default '{}',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 240),
  source_kind text not null check (source_kind in ('manual_brief', 'decision_opportunity')),
  -- Exactly one source, fixed at creation. A campaign that could be re-pointed
  -- at another proposal could not be reconciled against the decision that
  -- caused it.
  brief_id uuid,
  opportunity_id uuid,
  state text not null default 'draft' check (
    state in (
      'draft', 'needs_data', 'ready_for_review', 'approved', 'scheduled',
      'executing', 'measuring', 'completed', 'partially_completed',
      'blocked', 'cancelled', 'failed'
    )
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, brief_id)
    references public.campaign_briefs (organization_id, id) on delete restrict,
  foreign key (organization_id, opportunity_id)
    references public.opportunities (organization_id, id) on delete restrict,
  check (
    (source_kind = 'manual_brief' and brief_id is not null and opportunity_id is null)
    or (source_kind = 'decision_opportunity' and opportunity_id is not null and brief_id is null)
  )
);

-- The exact verified facts generation was allowed to use. Pinned, not
-- referenced live: an approval must remain explicable after the underlying
-- profile or brand asset changes.
create table public.campaign_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  captured_at timestamptz not null default now(),
  facts jsonb not null check (jsonb_typeof(facts) = 'object'),
  brand_asset_version_ids uuid[] not null default '{}',
  assertions jsonb not null check (jsonb_typeof(assertions) = 'array'),
  unique (organization_id, id),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Immutable bundle versions
-- ---------------------------------------------------------------------------

create table public.campaign_bundle_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  version integer not null check (version > 0),
  parent_version_id uuid,
  source_snapshot_id uuid not null,
  -- The canonical manifest and the digest taken over it. Both are stored: the
  -- digest is what approval binds to, the manifest is what a human read.
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  generation_profile text not null check (
    generation_profile in ('brand_restricted', 'brand_guided', 'full_visual_freedom')
  ),
  execution_mode text not null check (execution_mode in ('best_effort', 'all_channels_required')),
  total_spend_ceiling_minor bigint check (total_spend_ceiling_minor >= 0),
  spend_currency text check (spend_currency ~ '^[A-Z]{3}$'),
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  -- One version number per campaign. Assigned under a campaign lock, and this
  -- is the constraint that makes the lock's failure visible instead of silent.
  unique (organization_id, campaign_id, version),
  unique (organization_id, campaign_id, digest),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, parent_version_id)
    references public.campaign_bundle_versions (organization_id, id) on delete restrict,
  foreign key (organization_id, source_snapshot_id)
    references public.campaign_source_snapshots (organization_id, id) on delete restrict,
  -- The manifest must agree with the columns queries read, or the two could
  -- drift and a query would answer differently from the approved document.
  check ((manifest ->> 'version')::integer = version),
  check (manifest ->> 'campaignId' = campaign_id::text),
  check (manifest ->> 'generationProfile' = generation_profile),
  check (manifest ->> 'executionMode' = execution_mode),
  check ((total_spend_ceiling_minor is null) = (spend_currency is null)),
  check (version = 1 or parent_version_id is not null)
);

create table public.campaign_creative_directions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bundle_version_id uuid not null,
  direction_key uuid not null,
  kind text not null check (kind in ('control', 'evidence_led', 'experimental')),
  name text not null check (char_length(name) between 1 and 120),
  rationale text not null check (char_length(rationale) between 1 and 1200),
  generation_profile_override text check (
    generation_profile_override in ('brand_restricted', 'brand_guided', 'full_visual_freedom')
  ),
  experiment jsonb check (experiment is null or jsonb_typeof(experiment) = 'object'),
  unique (organization_id, id),
  unique (organization_id, bundle_version_id, direction_key),
  -- Exactly one of each kind per version, enforced by the database and not
  -- only by the application that wrote it.
  unique (organization_id, bundle_version_id, kind),
  foreign key (organization_id, bundle_version_id)
    references public.campaign_bundle_versions (organization_id, id) on delete cascade,
  check ((kind = 'experimental') = (experiment is not null))
);

create table public.campaign_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bundle_version_id uuid not null,
  asset_key uuid not null,
  storage_path text not null check (char_length(storage_path) between 1 and 1024),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  width_px integer not null check (width_px > 0),
  height_px integer not null check (height_px > 0),
  truth_class text not null check (
    truth_class in ('synthetic_generated', 'synthetic_composite', 'authentic_source')
  ),
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
  alt_text text not null check (char_length(alt_text) between 1 and 420),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, bundle_version_id, asset_key),
  foreign key (organization_id, bundle_version_id)
    references public.campaign_bundle_versions (organization_id, id) on delete cascade
);

create table public.campaign_channel_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bundle_version_id uuid not null,
  action_key uuid not null,
  direction_key uuid not null,
  channel text not null check (channel in ('instagram', 'facebook')),
  placement text not null check (placement in ('feed_image', 'image_story')),
  scheduled_for timestamptz not null,
  requirement text not null check (requirement in ('required', 'optional')),
  spend_ceiling_minor bigint check (spend_ceiling_minor >= 0),
  spend_currency text check (spend_currency ~ '^[A-Z]{3}$'),
  unique (organization_id, id),
  unique (organization_id, bundle_version_id, action_key),
  foreign key (organization_id, bundle_version_id)
    references public.campaign_bundle_versions (organization_id, id) on delete cascade,
  foreign key (organization_id, bundle_version_id, direction_key)
    references public.campaign_creative_directions (organization_id, bundle_version_id, direction_key)
    on delete cascade,
  check ((spend_ceiling_minor is null) = (spend_currency is null))
);

create table public.campaign_measurement_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bundle_version_id uuid not null,
  primary_metric_key text not null check (char_length(primary_metric_key) between 1 and 160),
  guardrail_metric_keys text[] not null default '{}',
  baseline_source text not null check (char_length(baseline_source) between 1 and 240),
  baseline_lookback_days integer not null check (baseline_lookback_days between 1 and 730),
  attribution_method text not null check (
    attribution_method in ('observational_prepost', 'provider_randomized_experiment')
  ),
  outcome_window_days integer not null check (outcome_window_days between 1 and 365),
  settlement_delay_days integer not null check (settlement_delay_days between 0 and 90),
  minimum_evidence_tier text not null check (minimum_evidence_tier in ('computed', 'observed')),
  unique (organization_id, id),
  -- One registered plan per version. Preregistration means one plan, decided
  -- before anything runs.
  unique (organization_id, bundle_version_id),
  foreign key (organization_id, bundle_version_id)
    references public.campaign_bundle_versions (organization_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Attestation and approval
-- ---------------------------------------------------------------------------

-- The operator's statement that they looked at every proposed image and that
-- none of them falsely depicts a real-world fact. Bound to a digest, because
-- an attestation of different pixels is not this attestation.
create table public.campaign_visual_attestations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  bundle_version_id uuid not null,
  bundle_digest text not null check (bundle_digest ~ '^[0-9a-f]{64}$'),
  attested_by uuid not null references auth.users(id) on delete restrict,
  attested_at timestamptz not null default now(),
  statement text not null check (char_length(statement) between 1 and 1000),
  unique (organization_id, id),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, bundle_version_id)
    references public.campaign_bundle_versions (organization_id, id) on delete cascade
);

create table public.campaign_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  bundle_version_id uuid not null,
  bundle_digest text not null check (bundle_digest ~ '^[0-9a-f]{64}$'),
  attestation_id uuid not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- What the approval assumed was true about provider capability and policy.
  -- Execution re-checks these; an approval granted under different assumptions
  -- must not authorize an action under new ones.
  capability_grant_versions jsonb not null check (jsonb_typeof(capability_grant_versions) = 'object'),
  policy_version_ids uuid[] not null default '{}',
  action_keys uuid[] not null,
  total_spend_ceiling_minor bigint check (total_spend_ceiling_minor >= 0),
  spend_currency text check (spend_currency ~ '^[A-Z]{3}$'),
  -- Set when a later version supersedes this approval, or an operator revokes
  -- it. Never deleted: what was authorized once stays in the record.
  revoked_at timestamptz,
  revoked_reason text check (
    revoked_reason in ('superseded_by_new_version', 'operator_revoked', 'capability_lost')
  ),
  unique (organization_id, id),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, bundle_version_id)
    references public.campaign_bundle_versions (organization_id, id) on delete cascade,
  foreign key (organization_id, attestation_id)
    references public.campaign_visual_attestations (organization_id, id) on delete restrict,
  check (expires_at > approved_at),
  check ((total_spend_ceiling_minor is null) = (spend_currency is null)),
  check ((revoked_at is null) = (revoked_reason is null)),
  check (cardinality(action_keys) > 0)
);

-- At most one live approval per version. A second one would make "which
-- approval authorized this?" ambiguous at exactly the moment it matters.
create unique index campaign_approvals_one_live_per_version_idx
  on public.campaign_approvals (organization_id, bundle_version_id)
  where revoked_at is null;

create index campaign_bundle_versions_campaign_idx
  on public.campaign_bundle_versions (organization_id, campaign_id, version desc);
create index campaign_approvals_campaign_idx
  on public.campaign_approvals (organization_id, campaign_id);
create index campaign_visual_attestations_version_idx
  on public.campaign_visual_attestations (organization_id, bundle_version_id);
create index campaign_source_snapshots_campaign_idx
  on public.campaign_source_snapshots (organization_id, campaign_id);
create index campaign_channel_actions_direction_idx
  on public.campaign_channel_actions (organization_id, bundle_version_id, direction_key);
create index organization_brand_asset_versions_asset_idx
  on public.organization_brand_asset_versions (organization_id, brand_asset_id, version desc);
create index campaigns_brief_idx on public.campaigns (organization_id, brief_id);
create index campaigns_opportunity_idx on public.campaigns (organization_id, opportunity_id);
create index campaigns_created_by_idx on public.campaigns (created_by);
create index campaign_briefs_created_by_idx on public.campaign_briefs (created_by);
create index organization_brand_assets_created_by_idx
  on public.organization_brand_assets (created_by);
create index campaign_bundle_versions_parent_idx
  on public.campaign_bundle_versions (organization_id, parent_version_id);
create index campaign_bundle_versions_snapshot_idx
  on public.campaign_bundle_versions (organization_id, source_snapshot_id);
create index campaign_bundle_versions_created_by_idx
  on public.campaign_bundle_versions (created_by);
create index campaign_visual_attestations_campaign_idx
  on public.campaign_visual_attestations (organization_id, campaign_id);
create index campaign_visual_attestations_attested_by_idx
  on public.campaign_visual_attestations (attested_by);
create index campaign_approvals_attestation_idx
  on public.campaign_approvals (organization_id, attestation_id);
create index campaign_approvals_approved_by_idx on public.campaign_approvals (approved_by);

-- ---------------------------------------------------------------------------
-- Immutability
-- ---------------------------------------------------------------------------

-- A published version is evidence of what was reviewed. Editing one would
-- rewrite the thing an approval points at, so a correction is a new version.
create function private.reject_campaign_version_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'campaign_bundle_version_is_immutable' using errcode = '23514';
end;
$$;

create trigger campaign_bundle_versions_immutable
  before update or delete on public.campaign_bundle_versions
  for each row execute function private.reject_campaign_version_mutation();
create trigger campaign_creative_directions_immutable
  before update or delete on public.campaign_creative_directions
  for each row execute function private.reject_campaign_version_mutation();
create trigger campaign_assets_immutable
  before update or delete on public.campaign_assets
  for each row execute function private.reject_campaign_version_mutation();
create trigger campaign_channel_actions_immutable
  before update or delete on public.campaign_channel_actions
  for each row execute function private.reject_campaign_version_mutation();
create trigger campaign_measurement_plans_immutable
  before update or delete on public.campaign_measurement_plans
  for each row execute function private.reject_campaign_version_mutation();
create trigger campaign_source_snapshots_immutable
  before update or delete on public.campaign_source_snapshots
  for each row execute function private.reject_campaign_version_mutation();
create trigger campaign_briefs_immutable
  before update or delete on public.campaign_briefs
  for each row execute function private.reject_campaign_version_mutation();

-- Attestations are never edited or withdrawn: the operator did look, at that
-- moment, at that digest.
create function private.reject_campaign_attestation_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'campaign_attestation_is_append_only' using errcode = '23514';
end;
$$;

create trigger campaign_visual_attestations_append_only
  before update or delete on public.campaign_visual_attestations
  for each row execute function private.reject_campaign_attestation_mutation();

-- An approval may be revoked but never rewritten or deleted, and revocation is
-- one-way. Anything else would let the record disagree with what actually ran.
create function private.guard_campaign_approval_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'campaign_approval_is_append_only' using errcode = '23514';
  end if;

  if old.revoked_at is not null then
    raise exception 'campaign_approval_already_revoked' using errcode = '23514';
  end if;

  if (
    new.organization_id, new.campaign_id, new.bundle_version_id, new.bundle_digest,
    new.attestation_id, new.approved_by, new.approved_at, new.expires_at,
    new.capability_grant_versions, new.policy_version_ids, new.action_keys,
    new.total_spend_ceiling_minor, new.spend_currency
  ) is distinct from (
    old.organization_id, old.campaign_id, old.bundle_version_id, old.bundle_digest,
    old.attestation_id, old.approved_by, old.approved_at, old.expires_at,
    old.capability_grant_versions, old.policy_version_ids, old.action_keys,
    old.total_spend_ceiling_minor, old.spend_currency
  ) then
    raise exception 'campaign_approval_is_append_only' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger campaign_approvals_append_only
  before update or delete on public.campaign_approvals
  for each row execute function private.guard_campaign_approval_mutation();

create trigger campaigns_audit after insert or update on public.campaigns
  for each row execute function private.audit_organization_change();
create trigger campaign_approvals_audit after insert or update on public.campaign_approvals
  for each row execute function private.audit_organization_change();
create trigger campaign_visual_attestations_audit after insert on public.campaign_visual_attestations
  for each row execute function private.audit_organization_change();

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.organization_brand_assets enable row level security;
alter table public.organization_brand_assets force row level security;
alter table public.organization_brand_asset_versions enable row level security;
alter table public.organization_brand_asset_versions force row level security;
alter table public.campaign_briefs enable row level security;
alter table public.campaign_briefs force row level security;
alter table public.campaigns enable row level security;
alter table public.campaigns force row level security;
alter table public.campaign_source_snapshots enable row level security;
alter table public.campaign_source_snapshots force row level security;
alter table public.campaign_bundle_versions enable row level security;
alter table public.campaign_bundle_versions force row level security;
alter table public.campaign_creative_directions enable row level security;
alter table public.campaign_creative_directions force row level security;
alter table public.campaign_assets enable row level security;
alter table public.campaign_assets force row level security;
alter table public.campaign_channel_actions enable row level security;
alter table public.campaign_channel_actions force row level security;
alter table public.campaign_measurement_plans enable row level security;
alter table public.campaign_measurement_plans force row level security;
alter table public.campaign_visual_attestations enable row level security;
alter table public.campaign_visual_attestations force row level security;
alter table public.campaign_approvals enable row level security;
alter table public.campaign_approvals force row level security;

-- Members read. Every write that matters goes through a security-definer RPC,
-- so the browser holds no insert or update grant on a versioned table.
create policy "members read brand assets" on public.organization_brand_assets
  for select to authenticated using (private.is_organization_member(organization_id));
create policy "members read brand asset versions" on public.organization_brand_asset_versions
  for select to authenticated using (private.is_organization_member(organization_id));
create policy "members read campaign briefs" on public.campaign_briefs
  for select to authenticated using (private.is_organization_member(organization_id));
create policy "members read campaigns" on public.campaigns
  for select to authenticated using (private.is_organization_member(organization_id));
create policy "members read campaign snapshots" on public.campaign_source_snapshots
  for select to authenticated using (private.is_organization_member(organization_id));
create policy "members read bundle versions" on public.campaign_bundle_versions
  for select to authenticated using (private.is_organization_member(organization_id));
create policy "members read creative directions" on public.campaign_creative_directions
  for select to authenticated using (private.is_organization_member(organization_id));
create policy "members read campaign assets" on public.campaign_assets
  for select to authenticated using (private.is_organization_member(organization_id));
create policy "members read channel actions" on public.campaign_channel_actions
  for select to authenticated using (private.is_organization_member(organization_id));
create policy "members read measurement plans" on public.campaign_measurement_plans
  for select to authenticated using (private.is_organization_member(organization_id));
create policy "members read attestations" on public.campaign_visual_attestations
  for select to authenticated using (private.is_organization_member(organization_id));
create policy "members read approvals" on public.campaign_approvals
  for select to authenticated using (private.is_organization_member(organization_id));

revoke all on table
  public.organization_brand_assets, public.organization_brand_asset_versions,
  public.campaign_briefs, public.campaigns, public.campaign_source_snapshots,
  public.campaign_bundle_versions, public.campaign_creative_directions,
  public.campaign_assets, public.campaign_channel_actions,
  public.campaign_measurement_plans, public.campaign_visual_attestations,
  public.campaign_approvals
from anon;
revoke all on table
  public.organization_brand_assets, public.organization_brand_asset_versions,
  public.campaign_briefs, public.campaigns, public.campaign_source_snapshots,
  public.campaign_bundle_versions, public.campaign_creative_directions,
  public.campaign_assets, public.campaign_channel_actions,
  public.campaign_measurement_plans, public.campaign_visual_attestations,
  public.campaign_approvals
from authenticated;

grant select on table
  public.organization_brand_assets, public.organization_brand_asset_versions,
  public.campaign_briefs, public.campaigns, public.campaign_source_snapshots,
  public.campaign_bundle_versions, public.campaign_creative_directions,
  public.campaign_assets, public.campaign_channel_actions,
  public.campaign_measurement_plans, public.campaign_visual_attestations,
  public.campaign_approvals
to authenticated;

-- ---------------------------------------------------------------------------
-- Private storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'brand-assets', 'brand-assets', false, 15728640,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'campaign-assets', 'campaign-assets', false, 15728640,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  )
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Paths are `organizationId/brandAssetId/versionId/filename` and
-- `organizationId/campaignId/bundleVersionId/assetId.ext`. The first segment is
-- the tenant, checked against live membership on every read and write.
create policy "members read brand asset objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'brand-assets'
  and cardinality(storage.foldername(name)) = 3
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.is_organization_member(((storage.foldername(name))[1])::uuid)
);

create policy "operators upload brand asset objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'brand-assets'
  and cardinality(storage.foldername(name)) = 3
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);

create policy "members read campaign asset objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'campaign-assets'
  and cardinality(storage.foldername(name)) = 3
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.is_organization_member(((storage.foldername(name))[1])::uuid)
);

-- Generated campaign assets are written by the worker after validation, never
-- uploaded from a browser, so `authenticated` gets no insert policy at all.

-- ---------------------------------------------------------------------------
-- Atomic writes
-- ---------------------------------------------------------------------------

create function public.create_campaign_bundle_version(
  target_organization_id uuid,
  input_bundle jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_campaign_id uuid := (input_bundle ->> 'campaign_id')::uuid;
  snapshot_id uuid := (input_bundle ->> 'source_snapshot_id')::uuid;
  manifest jsonb := input_bundle -> 'manifest';
  next_version integer;
  parent_id uuid;
  saved_id uuid := gen_random_uuid();
  direction jsonb;
  asset jsonb;
  action jsonb;
  plan jsonb := input_bundle -> 'measurement_plan';
  revoked_count integer := 0;
begin
  if target_organization_id is null
    or input_bundle ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_bundle_organization_mismatch' using errcode = '42501';
  end if;

  if manifest is null or jsonb_typeof(manifest) <> 'object' then
    raise exception 'campaign_bundle_manifest_invalid' using errcode = '22023';
  end if;

  -- Serialize every version write for one campaign. Two concurrent revisions
  -- would otherwise both read "latest is 3" and both try to write 4; the
  -- unique constraint would catch it, but as a confusing conflict rather than
  -- an orderly wait.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('campaign_bundle_version:' || target_campaign_id::text, 0)
  );

  if not exists (
    select 1 from public.campaigns campaign
    where campaign.organization_id = target_organization_id
      and campaign.id = target_campaign_id
  ) then
    raise exception 'campaign_not_found' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.campaign_source_snapshots snapshot
    where snapshot.organization_id = target_organization_id
      and snapshot.id = snapshot_id
      and snapshot.campaign_id = target_campaign_id
  ) then
    raise exception 'campaign_source_snapshot_not_found' using errcode = '42501';
  end if;

  select coalesce(pg_catalog.max(existing.version), 0) + 1, (
    select latest.id from public.campaign_bundle_versions latest
    where latest.organization_id = target_organization_id
      and latest.campaign_id = target_campaign_id
    order by latest.version desc
    limit 1
  )
  into next_version, parent_id
  from public.campaign_bundle_versions existing
  where existing.organization_id = target_organization_id
    and existing.campaign_id = target_campaign_id;

  insert into public.campaign_bundle_versions (
    id, organization_id, campaign_id, version, parent_version_id, source_snapshot_id,
    manifest, digest, generation_profile, execution_mode,
    total_spend_ceiling_minor, spend_currency, created_by
  ) values (
    saved_id, target_organization_id, target_campaign_id, next_version, parent_id, snapshot_id,
    pg_catalog.jsonb_set(manifest, '{version}', pg_catalog.to_jsonb(next_version)),
    input_bundle ->> 'digest',
    manifest ->> 'generationProfile',
    manifest ->> 'executionMode',
    (input_bundle -> 'total_spend_ceiling' ->> 'amountMinor')::bigint,
    input_bundle -> 'total_spend_ceiling' ->> 'currency',
    auth.uid()
  );

  for direction in select * from pg_catalog.jsonb_array_elements(input_bundle -> 'directions') loop
    insert into public.campaign_creative_directions (
      organization_id, bundle_version_id, direction_key, kind, name, rationale,
      generation_profile_override, experiment
    ) values (
      target_organization_id, saved_id, (direction ->> 'id')::uuid, direction ->> 'kind',
      direction ->> 'name', direction ->> 'rationale',
      direction ->> 'generationProfileOverride',
      case when direction -> 'experiment' = 'null'::jsonb then null else direction -> 'experiment' end
    );
  end loop;

  for asset in select * from pg_catalog.jsonb_array_elements(input_bundle -> 'assets') loop
    insert into public.campaign_assets (
      organization_id, bundle_version_id, asset_key, storage_path, content_hash,
      mime_type, width_px, height_px, truth_class, provenance, alt_text
    ) values (
      target_organization_id, saved_id, (asset ->> 'id')::uuid, asset ->> 'storagePath',
      asset ->> 'contentHash', asset ->> 'mimeType', (asset ->> 'widthPx')::integer,
      (asset ->> 'heightPx')::integer, asset ->> 'truthClass', asset -> 'provenance',
      asset ->> 'altText'
    );
  end loop;

  for action in select * from pg_catalog.jsonb_array_elements(input_bundle -> 'actions') loop
    insert into public.campaign_channel_actions (
      organization_id, bundle_version_id, action_key, direction_key, channel, placement,
      scheduled_for, requirement, spend_ceiling_minor, spend_currency
    ) values (
      target_organization_id, saved_id, (action ->> 'id')::uuid, (action ->> 'directionId')::uuid,
      action ->> 'channel', action ->> 'placement', (action ->> 'scheduledFor')::timestamptz,
      action ->> 'requirement',
      (action -> 'spendCeiling' ->> 'amountMinor')::bigint,
      action -> 'spendCeiling' ->> 'currency'
    );
  end loop;

  insert into public.campaign_measurement_plans (
    organization_id, bundle_version_id, primary_metric_key, guardrail_metric_keys,
    baseline_source, baseline_lookback_days, attribution_method, outcome_window_days,
    settlement_delay_days, minimum_evidence_tier
  ) values (
    target_organization_id, saved_id, plan ->> 'primaryMetricKey',
    coalesce(
      (select pg_catalog.array_agg(value #>> '{}')
       from pg_catalog.jsonb_array_elements(plan -> 'guardrailMetricKeys')),
      '{}'::text[]
    ),
    plan ->> 'baselineSource', (plan ->> 'baselineLookbackDays')::integer,
    plan ->> 'attributionMethod', (plan ->> 'outcomeWindowDays')::integer,
    (plan ->> 'settlementDelayDays')::integer, plan ->> 'minimumEvidenceTier'
  );

  -- A new version invalidates every live approval on an earlier one. This is
  -- the whole point of version-exact approval: what an operator agreed to no
  -- longer exists, so their permission cannot travel forward.
  with superseded as (
    update public.campaign_approvals approval
    set revoked_at = pg_catalog.now(), revoked_reason = 'superseded_by_new_version'
    where approval.organization_id = target_organization_id
      and approval.campaign_id = target_campaign_id
      and approval.bundle_version_id <> saved_id
      and approval.revoked_at is null
    returning 1
  )
  select pg_catalog.count(*)::integer into revoked_count from superseded;

  update public.campaigns
  set updated_at = pg_catalog.now()
  where organization_id = target_organization_id and id = target_campaign_id;

  return pg_catalog.jsonb_build_object(
    'bundle_version_id', saved_id,
    'version', next_version,
    'parent_version_id', parent_id,
    'revoked_approval_count', revoked_count
  );
end;
$$;

create function public.approve_campaign_bundle(
  target_organization_id uuid,
  input_approval jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_version_id uuid := (input_approval ->> 'bundle_version_id')::uuid;
  supplied_digest text := input_approval ->> 'bundle_digest';
  version_row public.campaign_bundle_versions;
  attestation public.campaign_visual_attestations;
  saved_id uuid;
  supplied_actions uuid[] := coalesce(
    (select pg_catalog.array_agg((value #>> '{}')::uuid)
     from pg_catalog.jsonb_array_elements(input_approval -> 'action_keys')),
    '{}'::uuid[]
  );
begin
  if target_organization_id is null
    or input_approval ->> 'organization_id' is distinct from target_organization_id::text
  then
    raise exception 'campaign_approval_organization_mismatch' using errcode = '42501';
  end if;

  -- Role is re-checked here, not trusted from the caller. This function is a
  -- privileged path, so it must not assume the route in front of it ran.
  if auth.uid() is null or not private.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  ) then
    raise exception 'campaign_approval_forbidden' using errcode = '42501';
  end if;

  select version.* into version_row
  from public.campaign_bundle_versions version
  where version.organization_id = target_organization_id
    and version.id = target_version_id
  for update;

  if not found then
    raise exception 'campaign_bundle_version_not_found' using errcode = '42501';
  end if;

  -- The digest the operator saw must be the digest stored. A mismatch means
  -- they approved a different document from the one on file.
  if version_row.digest is distinct from supplied_digest then
    raise exception 'campaign_approval_digest_mismatch' using errcode = '22023';
  end if;

  -- Approval may only ever cover the newest version. An older one has already
  -- been superseded, and authorizing it would authorize a proposal nobody is
  -- looking at any more.
  if exists (
    select 1 from public.campaign_bundle_versions newer
    where newer.organization_id = target_organization_id
      and newer.campaign_id = version_row.campaign_id
      and newer.version > version_row.version
  ) then
    raise exception 'campaign_approval_version_superseded' using errcode = '22023';
  end if;

  select attest.* into attestation
  from public.campaign_visual_attestations attest
  where attest.organization_id = target_organization_id
    and attest.id = (input_approval ->> 'attestation_id')::uuid;

  if not found
    or attestation.bundle_version_id is distinct from target_version_id
    or attestation.bundle_digest is distinct from supplied_digest
  then
    raise exception 'campaign_attestation_missing_for_version' using errcode = '22023';
  end if;

  if cardinality(supplied_actions) = 0 then
    raise exception 'campaign_approval_actions_missing' using errcode = '22023';
  end if;

  -- Every approved action must belong to this version, and every action of
  -- this version must be approved. A partial list would silently authorize
  -- some of a proposal an operator read as a whole.
  if exists (
    select 1
    from pg_catalog.unnest(supplied_actions) as supplied(action_key)
    where not exists (
      select 1 from public.campaign_channel_actions channel_action
      where channel_action.organization_id = target_organization_id
        and channel_action.bundle_version_id = target_version_id
        and channel_action.action_key = supplied.action_key
    )
  ) or (
    select pg_catalog.count(*) from public.campaign_channel_actions channel_action
    where channel_action.organization_id = target_organization_id
      and channel_action.bundle_version_id = target_version_id
  ) <> cardinality(supplied_actions) then
    raise exception 'campaign_approval_actions_mismatch' using errcode = '22023';
  end if;

  -- The approved ceiling must match the version's own, or the approval would
  -- authorize a different amount of money from the one under review.
  if (input_approval -> 'total_spend_ceiling' ->> 'amountMinor')::bigint
      is distinct from version_row.total_spend_ceiling_minor
    or input_approval -> 'total_spend_ceiling' ->> 'currency'
      is distinct from version_row.spend_currency
  then
    raise exception 'campaign_approval_spend_mismatch' using errcode = '22023';
  end if;

  insert into public.campaign_approvals (
    organization_id, campaign_id, bundle_version_id, bundle_digest, attestation_id,
    approved_by, expires_at, capability_grant_versions, policy_version_ids,
    action_keys, total_spend_ceiling_minor, spend_currency
  ) values (
    target_organization_id, version_row.campaign_id, target_version_id, supplied_digest,
    attestation.id, auth.uid(), (input_approval ->> 'expires_at')::timestamptz,
    coalesce(input_approval -> 'capability_grant_versions', '{}'::jsonb),
    coalesce(
      (select pg_catalog.array_agg((value #>> '{}')::uuid)
       from pg_catalog.jsonb_array_elements(input_approval -> 'policy_version_ids')),
      '{}'::uuid[]
    ),
    supplied_actions,
    version_row.total_spend_ceiling_minor,
    version_row.spend_currency
  )
  returning id into saved_id;

  update public.campaigns
  set state = 'approved', updated_at = pg_catalog.now()
  where organization_id = target_organization_id and id = version_row.campaign_id;

  return saved_id;
end;
$$;

revoke all on function public.create_campaign_bundle_version(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_campaign_bundle_version(uuid, jsonb) to service_role;

-- Approval is a human act performed in a session, so the authenticated role
-- holds it. Every check inside is re-evaluated against `auth.uid()`.
revoke all on function public.approve_campaign_bundle(uuid, jsonb) from public, anon;
grant execute on function public.approve_campaign_bundle(uuid, jsonb) to authenticated;

create function public.record_campaign_visual_attestation(
  target_organization_id uuid,
  target_bundle_version_id uuid,
  input_digest text,
  input_statement text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_row public.campaign_bundle_versions;
  saved_id uuid;
begin
  if auth.uid() is null or not private.has_organization_role(
    target_organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  ) then
    raise exception 'campaign_attestation_forbidden' using errcode = '42501';
  end if;

  select version.* into version_row
  from public.campaign_bundle_versions version
  where version.organization_id = target_organization_id
    and version.id = target_bundle_version_id;

  if not found then
    raise exception 'campaign_bundle_version_not_found' using errcode = '42501';
  end if;

  if version_row.digest is distinct from input_digest then
    raise exception 'campaign_attestation_digest_mismatch' using errcode = '22023';
  end if;

  insert into public.campaign_visual_attestations (
    organization_id, campaign_id, bundle_version_id, bundle_digest, attested_by, statement
  ) values (
    target_organization_id, version_row.campaign_id, target_bundle_version_id,
    input_digest, auth.uid(), input_statement
  )
  returning id into saved_id;

  return saved_id;
end;
$$;

revoke all on function public.record_campaign_visual_attestation(uuid, uuid, text, text) from public, anon;
grant execute on function public.record_campaign_visual_attestation(uuid, uuid, text, text) to authenticated;
