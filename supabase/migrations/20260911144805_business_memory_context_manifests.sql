-- Spec 023 Task C: governed context manifests + assembly.
--
-- Capture, projectors, dispatch, and narration share-mode plumbing are live.
-- This slice builds the governed pack itself: pinned manifests, ordered
-- source-visible entries, revalidation, consume binding, rights-driven
-- erasure, and the SQL half of byte/count enforcement (the TS assembler in
-- src/modules/memory mirrors every constant and summary rule here; either
-- layer alone would invite drift).
--
-- Composite-FK uniqueness verification (inspected before writing, never
-- assumed — brief §C1):
--   Consumer targets WITH unique(organization_id, id), FK applied:
--     channel_analysis_runs (20260823120000, line 63)
--     growth_intelligence_requests (20260831154256, line 148)
--     campaign_generation_runs (20260815140000, line 44)
--     memory_write_operations — ABSENT, added narrowly below (brief orders it)
--   Entry sources WITH unique(organization_id, id), FK applied:
--     memory_items (20260809053839, line 98)
--     memory_capture_events (20260911104742, line 154)
--     campaign_bundle_versions (20260815110000, campaign_bundle_versions block)
--   Entry sources WITHOUT it, column WITHOUT constraint (brief: stop the FK,
--   report, prove the gap with a negative test — no invented migrations):
--     business_facts (PK id only; only (org, fact_key) uniqueness exists)
--     goals (PK id only)
--     constraints (PK id only)
--     business_profiles (no id column at all; PK is organization_id, so the
--       profile identity IS the organization — entries carry organization_id
--       in business_profile_id, documented in the prepare RPC)
--   The prepare RPC re-reads every source row inside the transaction, so a
--   dangling unconstrained reference is refused (P0002/23514), never trusted.
--
-- Digest canonicalization (both layers, documented once here): one line per
-- kept entry
--   context_ref|source_kind|source_id|revision|summary
-- lines sorted by context_ref, joined with chr(10), no trailing newline; the
-- empty pack canonicalizes to '' (sha256 e3b0c44..b855 on both sides). Hashed
-- with pg_catalog.encode(extensions.digest(text, 'sha256'), 'hex') here and
-- node:crypto sha256 in context-service.ts.
--
-- Safe-summary rules (the RPC recomputes each; caller-invented text under a
-- valid source id is refused 23514 — the TS builders in
-- src/domain/memory/context.ts predict these exact expressions):
--   memory_item:      left(title || coalesce(chr(10) || body, ''), 600)
--   capture_event:    left(projection_document::text, 600)
--   business_fact:    left(fact_key || ' [' || status || '] ' || source
--                       || ' :: ' || left(value::text, 200), 600)
--   business_profile: left(coalesce(business_model,'') || chr(10)
--                       || coalesce(value_proposition,''), 600)
--   goal:             left(name || ' [' || metric || '] target '
--                       || target_value::text || ' ' || unit, 600)
--   constraint:       left(name || ' [' || constraint_type || '/' || severity
--                       || '] ' || left(value::text, 200), 600)
--   campaign_version: left('v' || version || ' ' || generation_profile || '/'
--                       || execution_mode || ' ' || campaign_id::text
--                       || ' ' || digest, 600)
--
-- Ordinals and context_refs (ctx-NNNN) follow selected input order; budget
-- drops leave gaps rather than renumbering, and the TS renderer drops the
-- same way, so both digests agree. A same-attempt retry returns the pinned
-- manifest unchanged.
--
-- v_ prefixes every plpgsql local; empty search_path; fully qualified
-- objects; revoke public everywhere. No bodies, queries, or prompts are ever
-- logged or raised — refusals carry static codes only.

-- Subject binding on the existing workspace ------------------------------------
-- Legacy rows stay null (no backfill, no behavior change). operation_kind
-- admits only the value introduced here.

alter table public.memory_write_operations
  add column actor_id uuid,
  add column operation_kind text check (
    operation_kind is null or operation_kind in ('subject_context')
  );

alter table public.memory_write_operations
  add constraint memory_write_operations_organization_id_key unique (organization_id, id);

-- Manifests ----------------------------------------------------------------------

create table public.memory_context_manifests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purpose text not null check (purpose in (
    'channel_advice', 'growth_research', 'growth_synthesis',
    'campaign_generation', 'campaign_revision', 'subject_drafting'
  )),
  schema_version integer not null default 1 check (schema_version = 1),
  policy_version text not null check (char_length(policy_version) between 1 and 60),
  context_digest text not null check (context_digest ~ '^[0-9a-f]{64}$'),
  as_of timestamptz not null default now(),
  branch_id uuid,
  channel_id uuid,
  campaign_id uuid,
  actor_id uuid,
  correlation_id uuid not null,
  status text not null check (status in ('ready', 'empty', 'partial', 'unavailable', 'disabled')),
  exclusion_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(exclusion_counts) = 'object'),
  degraded_reasons text[] not null default '{}',
  selected_count integer not null default 0 check (selected_count >= 0),
  selected_bytes integer not null default 0 check (selected_bytes >= 0),
  retrieval_latency_ms integer check (retrieval_latency_ms is null or retrieval_latency_ms >= 0),
  -- Exactly one typed consumer binding (check below). Composite FKs verified above.
  analysis_run_id uuid,
  growth_request_id uuid,
  campaign_generation_run_id uuid,
  subject_operation_id uuid,
  attempt_key text not null check (char_length(attempt_key) between 1 and 200),
  state text not null default 'prepared' check (state in ('prepared', 'consumed', 'abandoned')),
  model_called_at timestamptz,
  completed_at timestamptz,
  provider_name text check (provider_name is null or char_length(provider_name) between 1 and 120),
  model_id text check (model_id is null or char_length(model_id) between 1 and 120),
  unique (organization_id, id),
  constraint memory_context_manifests_consumer_exactly_one check (
    num_nonnulls(analysis_run_id, growth_request_id, campaign_generation_run_id, subject_operation_id) = 1
  ),
  constraint memory_context_manifests_consume_pair check (
    (state = 'prepared') = (completed_at is null)
  ),
  constraint memory_context_manifests_analysis_fk foreign key (organization_id, analysis_run_id)
    references public.channel_analysis_runs (organization_id, id) on delete restrict,
  constraint memory_context_manifests_growth_fk foreign key (organization_id, growth_request_id)
    references public.growth_intelligence_requests (organization_id, id) on delete restrict,
  constraint memory_context_manifests_campaign_fk foreign key (organization_id, campaign_generation_run_id)
    references public.campaign_generation_runs (organization_id, id) on delete restrict,
  constraint memory_context_manifests_subject_fk foreign key (organization_id, subject_operation_id)
    references public.memory_write_operations (organization_id, id) on delete restrict
);

-- One attempt key per consumer binding: a same-attempt retry replays the
-- pinned manifest instead of minting a second pack.
create unique index memory_context_manifests_analysis_attempt
  on public.memory_context_manifests (organization_id, purpose, analysis_run_id, attempt_key)
  where analysis_run_id is not null;
create unique index memory_context_manifests_growth_attempt
  on public.memory_context_manifests (organization_id, purpose, growth_request_id, attempt_key)
  where growth_request_id is not null;
create unique index memory_context_manifests_campaign_attempt
  on public.memory_context_manifests (organization_id, purpose, campaign_generation_run_id, attempt_key)
  where campaign_generation_run_id is not null;
create unique index memory_context_manifests_subject_attempt
  on public.memory_context_manifests (organization_id, purpose, subject_operation_id, attempt_key)
  where subject_operation_id is not null;

create index memory_context_manifests_due
  on public.memory_context_manifests (organization_id, purpose, status, as_of desc);
create index memory_context_manifests_analysis
  on public.memory_context_manifests (organization_id, analysis_run_id)
  where analysis_run_id is not null;
create index memory_context_manifests_growth
  on public.memory_context_manifests (organization_id, growth_request_id)
  where growth_request_id is not null;
create index memory_context_manifests_campaign
  on public.memory_context_manifests (organization_id, campaign_generation_run_id)
  where campaign_generation_run_id is not null;
create index memory_context_manifests_subject
  on public.memory_context_manifests (organization_id, subject_operation_id)
  where subject_operation_id is not null;
create index memory_context_manifests_org_time
  on public.memory_context_manifests (organization_id, as_of desc);

alter table public.memory_context_manifests enable row level security;
alter table public.memory_context_manifests force row level security;
revoke all on table public.memory_context_manifests from public, anon, authenticated;

create policy "members read context manifests"
on public.memory_context_manifests for select to authenticated
using (private.is_organization_member(organization_id));

grant select on table public.memory_context_manifests to authenticated;

-- Entries --------------------------------------------------------------------------

create table public.memory_context_entries (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  manifest_id uuid not null,
  ordinal integer not null check (ordinal >= 1),
  primary key (organization_id, manifest_id, ordinal),
  context_ref text not null check (char_length(context_ref) between 1 and 60),
  unique (organization_id, manifest_id, context_ref),
  source_kind text not null check (source_kind in (
    'memory_item', 'capture_event', 'business_fact', 'business_profile',
    'goal', 'constraint', 'campaign_version'
  )),
  -- Exactly one typed primary source. Composite FKs only where the target
  -- carries unique(organization_id, id) (verified above); the remaining four
  -- slots are deliberately unconstrained and validated inside the RPC.
  memory_item_id uuid,
  capture_event_id uuid,
  business_fact_id uuid,
  business_profile_id uuid,
  goal_id uuid,
  constraint_id uuid,
  campaign_version_id uuid,
  source_revision bigint check (source_revision is null or source_revision >= 1),
  source_digest text check (source_digest is null or source_digest ~ '^[0-9a-f]{64}$'),
  statement_kind text not null check (statement_kind in (
    'observation', 'recommendation', 'operator_decision',
    'campaign_state', 'measured_outcome', 'lesson'
  )),
  scope_branch_id uuid,
  scope_channel_id uuid,
  trust_rank smallint not null check (trust_rank between 0 and 4),
  freshness text not null check (freshness in ('fresh', 'aging', 'stale', 'superseded', 'expired')),
  sensitivity text not null check (sensitivity in ('public', 'internal', 'confidential', 'customer_content')),
  observed_at timestamptz,
  effective_from timestamptz,
  effective_to timestamptz,
  reporting_start timestamptz,
  reporting_end timestamptz,
  root_refs uuid[] not null default '{}' check (
    array_position(root_refs, null) is null and pg_catalog.cardinality(root_refs) <= 100
  ),
  use_restriction text check (use_restriction is null or char_length(use_restriction) between 1 and 200),
  -- The exact bounded representation handed to the model: title plus the
  -- server-recomputed summary and its statement/trust markers. Erasure sets
  -- this to '{}'; readers then see ids/digests only.
  safe_snapshot jsonb not null check (jsonb_typeof(safe_snapshot) = 'object'),
  constraint memory_context_entries_manifest_fk foreign key (organization_id, manifest_id)
    references public.memory_context_manifests (organization_id, id) on delete cascade,
  constraint memory_context_entries_source_exactly_one check (
    num_nonnulls(
      memory_item_id, capture_event_id, business_fact_id, business_profile_id,
      goal_id, constraint_id, campaign_version_id
    ) = 1
  ),
  constraint memory_context_entries_source_kind_slot check (
    (source_kind = 'memory_item' and memory_item_id is not null and capture_event_id is null
      and business_fact_id is null and business_profile_id is null and goal_id is null
      and constraint_id is null and campaign_version_id is null)
    or (source_kind = 'capture_event' and memory_item_id is null and capture_event_id is not null
      and business_fact_id is null and business_profile_id is null and goal_id is null
      and constraint_id is null and campaign_version_id is null)
    or (source_kind = 'business_fact' and memory_item_id is null and capture_event_id is null
      and business_fact_id is not null and business_profile_id is null and goal_id is null
      and constraint_id is null and campaign_version_id is null)
    or (source_kind = 'business_profile' and memory_item_id is null and capture_event_id is null
      and business_fact_id is null and business_profile_id is not null and goal_id is null
      and constraint_id is null and campaign_version_id is null)
    or (source_kind = 'goal' and memory_item_id is null and capture_event_id is null
      and business_fact_id is null and business_profile_id is null and goal_id is not null
      and constraint_id is null and campaign_version_id is null)
    or (source_kind = 'constraint' and memory_item_id is null and capture_event_id is null
      and business_fact_id is null and business_profile_id is null and goal_id is null
      and constraint_id is not null and campaign_version_id is null)
    or (source_kind = 'campaign_version' and memory_item_id is null and capture_event_id is null
      and business_fact_id is null and business_profile_id is null and goal_id is null
      and constraint_id is null and campaign_version_id is not null)
  ),
  constraint memory_context_entries_memory_item_fk foreign key (organization_id, memory_item_id)
    references public.memory_items (organization_id, id) on delete restrict,
  constraint memory_context_entries_capture_event_fk foreign key (organization_id, capture_event_id)
    references public.memory_capture_events (organization_id, id) on delete restrict,
  constraint memory_context_entries_campaign_version_fk foreign key (organization_id, campaign_version_id)
    references public.campaign_bundle_versions (organization_id, id) on delete restrict
);

create index memory_context_entries_memory_item
  on public.memory_context_entries (organization_id, memory_item_id)
  where memory_item_id is not null;
create index memory_context_entries_capture_event
  on public.memory_context_entries (organization_id, capture_event_id)
  where capture_event_id is not null;
create index memory_context_entries_business_fact
  on public.memory_context_entries (organization_id, business_fact_id)
  where business_fact_id is not null;
create index memory_context_entries_business_profile
  on public.memory_context_entries (organization_id, business_profile_id)
  where business_profile_id is not null;
create index memory_context_entries_goal
  on public.memory_context_entries (organization_id, goal_id)
  where goal_id is not null;
create index memory_context_entries_constraint
  on public.memory_context_entries (organization_id, constraint_id)
  where constraint_id is not null;
create index memory_context_entries_campaign_version
  on public.memory_context_entries (organization_id, campaign_version_id)
  where campaign_version_id is not null;

alter table public.memory_context_entries enable row level security;
alter table public.memory_context_entries force row level security;
revoke all on table public.memory_context_entries from public, anon, authenticated;

create policy "members read context entries"
on public.memory_context_entries for select to authenticated
using (private.is_organization_member(organization_id));

grant select on table public.memory_context_entries to authenticated;

-- Immutability: no silent mutation ----------------------------------------------------
-- Manifests change only through the consume transition (prepared to
-- consumed/abandoned with call metadata); entries never change. Erasure works
-- by nulling snapshots through its audited RPC, which only writes the
-- snapshot-bearing tables, never manifest identity.

create or replace function private.prevent_memory_context_manifest_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'memory context manifest is immutable' using errcode = '23514';
  end if;
  if OLD.state = 'prepared'
    and NEW.state in ('consumed', 'abandoned')
    and NEW.id = OLD.id
    and NEW.organization_id = OLD.organization_id
    and NEW.purpose = OLD.purpose
    and NEW.schema_version = OLD.schema_version
    and NEW.policy_version = OLD.policy_version
    and NEW.context_digest = OLD.context_digest
    and NEW.as_of = OLD.as_of
    and NEW.branch_id is not distinct from OLD.branch_id
    and NEW.channel_id is not distinct from OLD.channel_id
    and NEW.campaign_id is not distinct from OLD.campaign_id
    and NEW.actor_id is not distinct from OLD.actor_id
    and NEW.correlation_id = OLD.correlation_id
    and NEW.status = OLD.status
    and NEW.exclusion_counts = OLD.exclusion_counts
    and NEW.degraded_reasons = OLD.degraded_reasons
    and NEW.selected_count = OLD.selected_count
    and NEW.selected_bytes = OLD.selected_bytes
    and NEW.retrieval_latency_ms is not distinct from OLD.retrieval_latency_ms
    and NEW.analysis_run_id is not distinct from OLD.analysis_run_id
    and NEW.growth_request_id is not distinct from OLD.growth_request_id
    and NEW.campaign_generation_run_id is not distinct from OLD.campaign_generation_run_id
    and NEW.subject_operation_id is not distinct from OLD.subject_operation_id
    and NEW.attempt_key = OLD.attempt_key then
    return NEW;
  end if;
  raise exception 'memory context manifest is immutable' using errcode = '23514';
end;
$$;

revoke all on function private.prevent_memory_context_manifest_mutation() from public;

create trigger memory_context_manifests_immutable
before update or delete on public.memory_context_manifests
for each row execute function private.prevent_memory_context_manifest_mutation();

create or replace function private.prevent_memory_context_entry_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The audited erasure RPC may null a snapshot to '{}' and nothing else:
  -- identity, source binding, revision, and every other column stay pinned.
  if TG_OP = 'UPDATE'
    and NEW.safe_snapshot = '{}'::jsonb
    and NEW.organization_id = OLD.organization_id
    and NEW.manifest_id = OLD.manifest_id
    and NEW.ordinal = OLD.ordinal
    and NEW.context_ref = OLD.context_ref
    and NEW.source_kind = OLD.source_kind
    and NEW.memory_item_id is not distinct from OLD.memory_item_id
    and NEW.capture_event_id is not distinct from OLD.capture_event_id
    and NEW.business_fact_id is not distinct from OLD.business_fact_id
    and NEW.business_profile_id is not distinct from OLD.business_profile_id
    and NEW.goal_id is not distinct from OLD.goal_id
    and NEW.constraint_id is not distinct from OLD.constraint_id
    and NEW.campaign_version_id is not distinct from OLD.campaign_version_id
    and NEW.source_revision is not distinct from OLD.source_revision
    and NEW.source_digest is not distinct from OLD.source_digest
    and NEW.statement_kind = OLD.statement_kind
    and NEW.scope_branch_id is not distinct from OLD.scope_branch_id
    and NEW.scope_channel_id is not distinct from OLD.scope_channel_id
    and NEW.trust_rank = OLD.trust_rank
    and NEW.freshness = OLD.freshness
    and NEW.sensitivity = OLD.sensitivity
    and NEW.observed_at is not distinct from OLD.observed_at
    and NEW.effective_from is not distinct from OLD.effective_from
    and NEW.effective_to is not distinct from OLD.effective_to
    and NEW.reporting_start is not distinct from OLD.reporting_start
    and NEW.reporting_end is not distinct from OLD.reporting_end
    and NEW.root_refs = OLD.root_refs
    and NEW.use_restriction is not distinct from OLD.use_restriction then
    return NEW;
  end if;
  raise exception 'memory context entry is immutable' using errcode = '23514';
end;
$$;

revoke all on function private.prevent_memory_context_entry_mutation() from public;

create trigger memory_context_entries_immutable
before update or delete on public.memory_context_entries
for each row execute function private.prevent_memory_context_entry_mutation();

-- Helpers -------------------------------------------------------------------------------

-- Strict timestamptz cast: an unparseable timestamp in an entry payload is a
-- shape refusal (23514), never a silent null.
create or replace function private.memory_context_cast_timestamptz(p_value text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result timestamptz;
begin
  if p_value is null then
    return null;
  end if;
  begin
    v_result := p_value::timestamptz;
  exception when invalid_datetime_format then
    raise exception 'memory context timestamp is invalid' using errcode = '23514';
  end;
  return v_result;
end;
$$;

revoke all on function private.memory_context_cast_timestamptz(text) from public;

-- Source resolution: re-reads the row INSIDE the RPC, compares liveness and
-- rights, and recomputes the permitted safe summary. Anything the caller
-- invented is refused by the caller (summary mismatch), never stored.
-- OUT v_status: 'ok' | 'revoked' | 'unknown'; v_exclusion carries the safe
-- code when not ok. v_revision may be null (only capture events and campaign
-- versions carry numeric revisions).
create or replace function private.resolve_memory_context_source(
  p_organization_id uuid,
  p_source_kind text,
  p_source_id uuid,
  out v_summary text,
  out v_revision bigint,
  out v_digest text,
  out v_status text,
  out v_exclusion text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.memory_items;
  v_event public.memory_capture_events;
  v_fact public.business_facts;
  v_profile public.business_profiles;
  v_goal public.goals;
  v_constraint public.constraints;
  v_version public.campaign_bundle_versions;
begin
  v_summary := null;
  v_revision := null;
  v_digest := null;
  v_status := 'unknown';
  v_exclusion := 'UNKNOWN_SOURCE';

  case p_source_kind
    when 'memory_item' then
      select * into v_item
      from public.memory_items stored_item
      where stored_item.organization_id = p_organization_id
        and stored_item.id = p_source_id;
      if not found then
        return;
      end if;
      if v_item.superseded_by_id is not null then
        v_status := 'revoked';
        v_exclusion := 'SUPERSEDED';
        return;
      end if;
      if v_item.expires_at is not null and v_item.expires_at <= pg_catalog.now() then
        v_status := 'revoked';
        v_exclusion := 'EXPIRED';
        return;
      end if;
      if v_item.sensitivity not in ('public', 'internal') then
        v_status := 'revoked';
        v_exclusion := 'SENSITIVITY_BLOCKED';
        return;
      end if;
      if v_item.verification_state in ('proposed', 'rejected') then
        v_status := 'revoked';
        v_exclusion := 'RIGHTS_DENIED';
        return;
      end if;
      v_summary := pg_catalog.left(
        v_item.title || pg_catalog.coalesce(pg_catalog.chr(10) || v_item.body, ''), 600
      );
      v_status := 'ok';
      v_exclusion := null;
    when 'capture_event' then
      select * into v_event
      from public.memory_capture_events stored_event
      where stored_event.organization_id = p_organization_id
        and stored_event.id = p_source_id;
      if not found then
        return;
      end if;
      if v_event.projection_document = '{}'::jsonb then
        v_status := 'revoked';
        v_exclusion := 'WITHDRAWN';
        return;
      end if;
      if v_event.reuse_class = 'denied' then
        v_status := 'revoked';
        v_exclusion := 'RIGHTS_DENIED';
        return;
      end if;
      if v_event.sensitivity not in ('public', 'internal') then
        v_status := 'revoked';
        v_exclusion := 'SENSITIVITY_BLOCKED';
        return;
      end if;
      v_summary := pg_catalog.left(v_event.projection_document::text, 600);
      v_revision := v_event.source_revision;
      v_status := 'ok';
      v_exclusion := null;
    when 'business_fact' then
      select * into v_fact
      from public.business_facts stored_fact
      where stored_fact.organization_id = p_organization_id
        and stored_fact.id = p_source_id;
      if not found then
        return;
      end if;
      if v_fact.effective_to is not null and v_fact.effective_to < pg_catalog.current_date then
        v_status := 'revoked';
        v_exclusion := 'EXPIRED';
        return;
      end if;
      v_summary := pg_catalog.left(
        v_fact.fact_key || ' [' || v_fact.status || '] ' || pg_catalog.coalesce(v_fact.source, '')
          || ' :: ' || pg_catalog.left(v_fact.value::text, 200),
        600
      );
      v_status := 'ok';
      v_exclusion := null;
    when 'business_profile' then
      -- Profiles have no id column: the profile identity is the organization.
      if p_source_id is distinct from p_organization_id then
        return;
      end if;
      select * into v_profile
      from public.business_profiles stored_profile
      where stored_profile.organization_id = p_organization_id;
      if not found then
        return;
      end if;
      v_summary := pg_catalog.left(
        pg_catalog.coalesce(v_profile.business_model, '') || pg_catalog.chr(10)
          || pg_catalog.coalesce(v_profile.value_proposition, ''),
        600
      );
      v_status := 'ok';
      v_exclusion := null;
    when 'goal' then
      select * into v_goal
      from public.goals stored_goal
      where stored_goal.organization_id = p_organization_id
        and stored_goal.id = p_source_id;
      if not found then
        return;
      end if;
      v_summary := pg_catalog.left(
        v_goal.name || ' [' || v_goal.metric || '] target '
          || v_goal.target_value::text || ' ' || v_goal.unit,
        600
      );
      v_status := 'ok';
      v_exclusion := null;
    when 'constraint' then
      select * into v_constraint
      from public.constraints stored_constraint
      where stored_constraint.organization_id = p_organization_id
        and stored_constraint.id = p_source_id;
      if not found then
        return;
      end if;
      if not v_constraint.is_active then
        v_status := 'revoked';
        v_exclusion := 'WITHDRAWN';
        return;
      end if;
      v_summary := pg_catalog.left(
        v_constraint.name || ' [' || v_constraint.constraint_type || '/' || v_constraint.severity
          || '] ' || pg_catalog.left(v_constraint.value::text, 200),
        600
      );
      v_status := 'ok';
      v_exclusion := null;
    when 'campaign_version' then
      select * into v_version
      from public.campaign_bundle_versions stored_version
      where stored_version.organization_id = p_organization_id
        and stored_version.id = p_source_id;
      if not found then
        return;
      end if;
      v_summary := pg_catalog.left(
        'v' || v_version.version || ' ' || v_version.generation_profile || '/'
          || v_version.execution_mode || ' ' || v_version.campaign_id::text
          || ' ' || v_version.digest,
        600
      );
      v_revision := v_version.version;
      v_status := 'ok';
      v_exclusion := null;
    else
      raise exception 'memory context source kind is invalid' using errcode = '23514';
  end case;

  if v_status = 'ok' then
    v_digest := pg_catalog.encode(extensions.digest(v_summary, 'sha256'), 'hex');
  end if;
  return;
end;
$$;

revoke all on function private.resolve_memory_context_source(uuid, text, uuid) from public;

-- Prepare core --------------------------------------------------------------------------
--
-- Shared by the worker and subject entry points. The wrappers prove caller
-- class (claimed run vs authenticated membership); this core owns purpose
-- maps, scope checks, flag gates, strict entry validation, server-side
-- summary recomputation, 24-entry/16384-byte enforcement with deterministic
-- optional-first drop, digesting, and attempt-key replay.

create or replace function private.prepare_memory_context_core(
  p_organization_id uuid,
  p_purpose text,
  p_consumer_kind text,
  p_consumer_id uuid,
  p_attempt_key text,
  p_correlation_id uuid,
  p_branch_id uuid,
  p_channel_id uuid,
  p_campaign_id uuid,
  p_policy_version text,
  p_entries jsonb,
  p_retrieval_latency_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.memory_integration_settings;
  v_flags_on boolean := false;
  v_count integer;
  v_manifest public.memory_context_manifests;
  v_existing public.memory_context_manifests;
  v_length integer;
  v_index integer;
  v_element jsonb;
  v_key text;
  v_allowed_keys text[] := array[
    'sourceKind', 'sourceId', 'summary', 'priority', 'optional', 'section',
    'statementKind', 'trustRank', 'freshness', 'sensitivity', 'title',
    'scopeBranchId', 'scopeChannelId', 'observedAt', 'effectiveFrom',
    'effectiveTo', 'reportingStart', 'reportingEnd', 'rootRefs', 'useRestriction'
  ];
  v_source_kind text;
  v_source_id uuid;
  v_summary text;
  v_priority integer;
  v_optional boolean;
  v_section text;
  v_statement text;
  v_trust integer;
  v_freshness text;
  v_sensitivity text;
  v_scope_branch uuid;
  v_scope_channel uuid;
  v_observed timestamptz;
  v_effective_from timestamptz;
  v_effective_to timestamptz;
  v_reporting_start timestamptz;
  v_reporting_end timestamptz;
  v_roots uuid[];
  v_restriction text;
  v_resolved record;
  v_item_origin text;
  v_item_verification text;
  v_title text;
  v_bytes integer;
  v_valid jsonb[] := '{}';
  v_entry jsonb;
  v_excl_codes text[] := '{}';
  v_exclusion_counts jsonb;
  v_reasons text[] := '{}';
  v_status text := 'ready';
  v_kept_ordinals integer[] := '{}';
  v_dropped_ordinals integer[] := '{}';
  v_ordinal integer;
  v_drop_count integer;
  v_drop record;
  v_total_bytes integer := 0;
  v_selected_count integer;
  v_selected_bytes integer := 0;
  v_canonical text := '';
  v_line text;
  v_digest text;
  v_analysis uuid := null;
  v_growth uuid := null;
  v_campaign_run uuid := null;
  v_subject_op uuid := null;
  v_ref text;
begin
  if p_organization_id is null
    or p_purpose is null
    or p_purpose not in (
      'channel_advice', 'growth_research', 'growth_synthesis',
      'campaign_generation', 'campaign_revision', 'subject_drafting'
    )
    or p_consumer_kind is null
    or p_consumer_id is null
    or p_attempt_key is null or pg_catalog.char_length(p_attempt_key) not between 1 and 200
    or p_correlation_id is null
    or p_policy_version is null or pg_catalog.char_length(p_policy_version) not between 1 and 60
    or (p_retrieval_latency_ms is not null and p_retrieval_latency_ms < 0) then
    raise exception 'memory context preparation input is invalid' using errcode = '23514';
  end if;

  if not (
    (p_consumer_kind = 'analysis_run' and p_purpose = 'channel_advice')
    or (p_consumer_kind = 'growth_request' and p_purpose in ('growth_research', 'growth_synthesis'))
    or (p_consumer_kind = 'campaign_generation_run' and p_purpose in ('campaign_generation', 'campaign_revision'))
    or (p_consumer_kind = 'subject_operation' and p_purpose = 'subject_drafting')
  ) then
    raise exception 'memory context consumer purpose is invalid' using errcode = '23514';
  end if;

  case p_consumer_kind
    when 'analysis_run' then v_analysis := p_consumer_id;
    when 'growth_request' then v_growth := p_consumer_id;
    when 'campaign_generation_run' then v_campaign_run := p_consumer_id;
    when 'subject_operation' then v_subject_op := p_consumer_id;
    else
      raise exception 'memory context consumer kind is invalid' using errcode = '23514';
  end case;

  -- Scope ids must be same-organization references, never inferred names.
  if p_branch_id is not null then
    select pg_catalog.count(*) into v_count
    from public.branches scope_branch
    where scope_branch.organization_id = p_organization_id
      and scope_branch.id = p_branch_id;
    if v_count = 0 then
      raise exception 'memory context scope is not authorized' using errcode = '42501';
    end if;
  end if;
  if p_channel_id is not null then
    select pg_catalog.count(*) into v_count
    from public.organization_channels scope_channel
    where scope_channel.organization_id = p_organization_id
      and scope_channel.id = p_channel_id;
    if v_count = 0 then
      raise exception 'memory context scope is not authorized' using errcode = '42501';
    end if;
  end if;
  if p_campaign_id is not null then
    select pg_catalog.count(*) into v_count
    from public.campaigns scope_campaign
    where scope_campaign.organization_id = p_organization_id
      and scope_campaign.id = p_campaign_id;
    if v_count = 0 then
      raise exception 'memory context scope is not authorized' using errcode = '42501';
    end if;
  end if;

  select * into v_settings
  from public.memory_integration_settings configured
  where configured.organization_id = p_organization_id;

  if v_settings.organization_id is not null then
    v_flags_on := case p_purpose
      when 'channel_advice' then v_settings.channel_context_enabled
      when 'growth_research' then v_settings.growth_context_enabled
      when 'growth_synthesis' then v_settings.growth_context_enabled
      when 'campaign_generation' then v_settings.campaign_context_enabled
      when 'campaign_revision' then v_settings.campaign_context_enabled
      else v_settings.subject_context_enabled
    end;
  end if;

  -- A same-attempt retry replays the pinned manifest; the digest below is
  -- recomputed only for fresh attempts. Disabled and unavailable attempts
  -- persist that status with zero entries so the owning output can disclose
  -- the limit honestly instead of claiming untracked context use.
  begin
    if not v_flags_on then
      insert into public.memory_context_manifests (
        organization_id, purpose, policy_version, context_digest, branch_id,
        channel_id, campaign_id, actor_id, correlation_id, status,
        analysis_run_id, growth_request_id, campaign_generation_run_id,
        subject_operation_id, attempt_key, retrieval_latency_ms
      )
      select p_organization_id, p_purpose, p_policy_version,
        pg_catalog.encode(extensions.digest('', 'sha256'), 'hex'),
        p_branch_id, p_channel_id, p_campaign_id,
        (select auth.uid()), p_correlation_id, 'disabled',
        v_analysis, v_growth, v_campaign_run, v_subject_op,
        p_attempt_key, p_retrieval_latency_ms
      returning * into v_manifest;
      return pg_catalog.jsonb_build_object(
        'manifestId', v_manifest.id, 'contextDigest', v_manifest.context_digest,
        'status', v_manifest.status, 'selectedCount', 0, 'selectedBytes', 0
      );
    end if;

    if p_entries is null then
      insert into public.memory_context_manifests (
        organization_id, purpose, policy_version, context_digest, branch_id,
        channel_id, campaign_id, actor_id, correlation_id, status,
        analysis_run_id, growth_request_id, campaign_generation_run_id,
        subject_operation_id, attempt_key, retrieval_latency_ms
      )
      select p_organization_id, p_purpose, p_policy_version,
        pg_catalog.encode(extensions.digest('', 'sha256'), 'hex'),
        p_branch_id, p_channel_id, p_campaign_id,
        (select auth.uid()), p_correlation_id, 'unavailable',
        v_analysis, v_growth, v_campaign_run, v_subject_op,
        p_attempt_key, p_retrieval_latency_ms
      returning * into v_manifest;
      return pg_catalog.jsonb_build_object(
        'manifestId', v_manifest.id, 'contextDigest', v_manifest.context_digest,
        'status', v_manifest.status, 'selectedCount', 0, 'selectedBytes', 0
      );
    end if;

    if pg_catalog.jsonb_typeof(p_entries) <> 'array' then
      raise exception 'memory context entries are invalid' using errcode = '23514';
    end if;

    v_length := pg_catalog.jsonb_array_length(p_entries);
    for v_index in 0 .. v_length - 1 loop
      v_element := p_entries -> v_index;
      v_ordinal := v_index + 1;
      if pg_catalog.jsonb_typeof(v_element) <> 'object' then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;
      for v_key in select pg_catalog.jsonb_object_keys(v_element) loop
        if not (v_key = any(v_allowed_keys)) then
          raise exception 'memory context entry is invalid' using errcode = '23514';
        end if;
      end loop;

      v_source_kind := v_element ->> 'sourceKind';
      if v_source_kind is null or v_source_kind not in (
        'memory_item', 'capture_event', 'business_fact', 'business_profile',
        'goal', 'constraint', 'campaign_version'
      ) then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;

      if v_element ->> 'sourceId' is null
        or (v_element ->> 'sourceId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;
      v_source_id := (v_element ->> 'sourceId')::uuid;

      v_summary := v_element ->> 'summary';
      if v_summary is null or pg_catalog.char_length(v_summary) not between 1 and 600 then
        raise exception 'memory context summary is invalid' using errcode = '23514';
      end if;

      begin
        v_priority := (v_element ->> 'priority')::integer;
      exception when invalid_text_representation then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end;
      if v_priority is null or v_priority < -1000000 or v_priority > 1000000 then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;
      if pg_catalog.jsonb_typeof(v_element -> 'optional') <> 'boolean' then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;
      v_optional := (v_element ->> 'optional')::boolean;

      v_section := v_element ->> 'section';
      v_statement := v_element ->> 'statementKind';
      v_freshness := v_element ->> 'freshness';
      v_sensitivity := v_element ->> 'sensitivity';
      if v_section is null or v_section not in ('current', 'intent', 'observations', 'lessons')
        or v_statement is null or v_statement not in (
          'observation', 'recommendation', 'operator_decision',
          'campaign_state', 'measured_outcome', 'lesson'
        )
        or v_freshness is null or v_freshness not in ('fresh', 'aging', 'stale', 'superseded', 'expired')
        or v_sensitivity is null
        or v_sensitivity not in ('public', 'internal', 'confidential', 'customer_content') then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;
      if (v_element ->> 'trustRank') is null or (v_element ->> 'trustRank') !~ '^[0-4]$' then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;
      v_trust := (v_element ->> 'trustRank')::integer;

      -- Sensitive entries are excluded with a safe code, never stored.
      if v_sensitivity not in ('public', 'internal') then
        v_excl_codes := v_excl_codes || 'SENSITIVITY_BLOCKED';
        continue;
      end if;

      if v_element ->> 'scopeBranchId' is null then
        v_scope_branch := null;
      elsif (v_element ->> 'scopeBranchId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_scope_branch := (v_element ->> 'scopeBranchId')::uuid;
        select pg_catalog.count(*) into v_count
        from public.branches entry_branch
        where entry_branch.organization_id = p_organization_id
          and entry_branch.id = v_scope_branch;
        if v_count = 0 then
          v_excl_codes := v_excl_codes || 'SCOPE_BLOCKED';
          continue;
        end if;
      else
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;

      if v_element ->> 'scopeChannelId' is null then
        v_scope_channel := null;
      elsif (v_element ->> 'scopeChannelId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_scope_channel := (v_element ->> 'scopeChannelId')::uuid;
        select pg_catalog.count(*) into v_count
        from public.organization_channels entry_channel
        where entry_channel.organization_id = p_organization_id
          and entry_channel.id = v_scope_channel;
        if v_count = 0 then
          v_excl_codes := v_excl_codes || 'SCOPE_BLOCKED';
          continue;
        end if;
      else
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;

      v_observed := private.memory_context_cast_timestamptz(v_element ->> 'observedAt');
      v_effective_from := private.memory_context_cast_timestamptz(v_element ->> 'effectiveFrom');
      v_effective_to := private.memory_context_cast_timestamptz(v_element ->> 'effectiveTo');
      v_reporting_start := private.memory_context_cast_timestamptz(v_element ->> 'reportingStart');
      v_reporting_end := private.memory_context_cast_timestamptz(v_element ->> 'reportingEnd');

      if v_element -> 'rootRefs' is null or v_element -> 'rootRefs' = 'null'::jsonb then
        v_roots := '{}';
      elsif pg_catalog.jsonb_typeof(v_element -> 'rootRefs') = 'array'
        and pg_catalog.jsonb_array_length(v_element -> 'rootRefs') <= 100 then
        select pg_catalog.array_agg(
          case when root_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then root_value::uuid end
        ) into v_roots
        from pg_catalog.jsonb_array_elements_text(v_element -> 'rootRefs') as root_value;
        if v_roots is null then
          v_roots := '{}';
        end if;
        if pg_catalog.cardinality(v_roots) <> pg_catalog.jsonb_array_length(v_element -> 'rootRefs') then
          raise exception 'memory context entry is invalid' using errcode = '23514';
        end if;
      else
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;

      v_restriction := v_element ->> 'useRestriction';
      if v_restriction is not null
        and pg_catalog.char_length(v_restriction) not between 1 and 200 then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;

      v_title := v_element ->> 'title';
      if v_title is null or pg_catalog.char_length(v_title) not between 1 and 300 then
        raise exception 'memory context entry is invalid' using errcode = '23514';
      end if;

      select * into v_resolved
      from private.resolve_memory_context_source(p_organization_id, v_source_kind, v_source_id)
        as resolved(v_summary text, v_revision bigint, v_digest text, v_status text, v_exclusion text);

      if v_resolved.v_status <> 'ok' then
        v_excl_codes := v_excl_codes || v_resolved.v_exclusion;
        continue;
      end if;

      -- A valid source id paired with caller-invented text is refused, never stored.
      if v_resolved.v_summary is distinct from v_summary then
        raise exception 'memory context summary mismatch' using errcode = '23514';
      end if;

      -- No trust elevation: unconfirmed model output can never enter below rank 4.
      if v_source_kind = 'memory_item' then
        select stored_item.origin, stored_item.verification_state
        into v_item_origin, v_item_verification
        from public.memory_items stored_item
        where stored_item.organization_id = p_organization_id
          and stored_item.id = v_source_id;
        if v_item_origin in ('ai_proposed', 'outcome_learned')
          and v_item_verification <> 'verified'
          and v_trust < 4 then
          raise exception 'memory context trust elevation is refused' using errcode = '23514';
        end if;
      end if;

      v_bytes := pg_catalog.octet_length(v_summary);
      v_entry := pg_catalog.jsonb_build_object(
        'ordinal', v_ordinal, 'sourceKind', v_source_kind, 'sourceId', v_source_id,
        'summary', v_summary, 'priority', v_priority, 'optional', v_optional,
        'section', v_section, 'statementKind', v_statement, 'trustRank', v_trust,
        'freshness', v_freshness, 'sensitivity', v_sensitivity,
        'scopeBranchId', v_scope_branch, 'scopeChannelId', v_scope_channel,
        'observedAt', v_observed, 'effectiveFrom', v_effective_from,
        'effectiveTo', v_effective_to, 'reportingStart', v_reporting_start,
        'reportingEnd', v_reporting_end, 'rootRefs', v_roots,
        'useRestriction', v_restriction, 'title', v_title,
        'revision', v_resolved.v_revision, 'digest', v_resolved.v_digest,
        'bytes', v_bytes
      );
      v_valid := v_valid || v_entry;
    end loop;

    -- 24-entry budget: deterministic drop of lowest-priority optionals.
    if pg_catalog.cardinality(v_valid) > 24 then
      v_drop_count := pg_catalog.cardinality(v_valid) - 24;
      for v_drop in
        select (drop_row.e ->> 'ordinal')::integer as ord,
          (drop_row.e ->> 'optional')::boolean as opt
        from pg_catalog.unnest(v_valid) as drop_row(e)
        order by (drop_row.e ->> 'optional')::boolean desc,
          (drop_row.e ->> 'priority')::integer asc,
          (drop_row.e ->> 'ordinal')::integer desc
        limit v_drop_count
      loop
        v_dropped_ordinals := v_dropped_ordinals || v_drop.ord;
        if not v_drop.opt then
          v_status := 'partial';
          if not ('MANDATORY_OVERFLOW' = any(v_reasons)) then
            v_reasons := v_reasons || 'MANDATORY_OVERFLOW';
          end if;
          v_excl_codes := v_excl_codes || 'MANDATORY_OVERFLOW';
        else
          v_excl_codes := v_excl_codes || 'OVER_BUDGET';
        end if;
      end loop;
    end if;

    -- 16384-byte budget over raw summaries: same deterministic drop order.
    v_total_bytes := 0;
    for v_index in 1 .. pg_catalog.cardinality(v_valid) loop
      v_entry := v_valid[v_index];
      if not ((v_entry ->> 'ordinal')::integer = any(v_dropped_ordinals)) then
        v_total_bytes := v_total_bytes + (v_entry ->> 'bytes')::integer;
      end if;
    end loop;
    if v_total_bytes > 16384 then
      for v_drop in
        select (drop_row.e ->> 'ordinal')::integer as ord,
          (drop_row.e ->> 'optional')::boolean as opt,
          (drop_row.e ->> 'bytes')::integer as nbytes
        from pg_catalog.unnest(v_valid) as drop_row(e)
        where not ((drop_row.e ->> 'ordinal')::integer = any(v_dropped_ordinals))
        order by (drop_row.e ->> 'optional')::boolean desc,
          (drop_row.e ->> 'priority')::integer asc,
          (drop_row.e ->> 'ordinal')::integer desc
      loop
        exit when v_total_bytes <= 16384;
        if not v_drop.opt
          and (select pg_catalog.count(*) from pg_catalog.unnest(v_valid) as kept(e)
               where not ((kept.e ->> 'ordinal')::integer = any(v_dropped_ordinals))) <= 1 then
          exit;
        end if;
        v_dropped_ordinals := v_dropped_ordinals || v_drop.ord;
        v_total_bytes := v_total_bytes - v_drop.nbytes;
        if not v_drop.opt then
          v_status := 'partial';
          if not ('MANDATORY_OVERFLOW' = any(v_reasons)) then
            v_reasons := v_reasons || 'MANDATORY_OVERFLOW';
          end if;
          v_excl_codes := v_excl_codes || 'MANDATORY_OVERFLOW';
        else
          v_excl_codes := v_excl_codes || 'OVER_BUDGET';
        end if;
      end loop;
      if v_total_bytes > 16384 then
        v_status := 'partial';
        if not ('MANDATORY_OVERFLOW' = any(v_reasons)) then
          v_reasons := v_reasons || 'MANDATORY_OVERFLOW';
        end if;
        v_excl_codes := v_excl_codes || 'MANDATORY_OVERFLOW';
      end if;
    end if;

    for v_index in 1 .. pg_catalog.cardinality(v_valid) loop
      v_entry := v_valid[v_index];
      if not ((v_entry ->> 'ordinal')::integer = any(v_dropped_ordinals)) then
        v_kept_ordinals := v_kept_ordinals || (v_entry ->> 'ordinal')::integer;
      end if;
    end loop;

    if pg_catalog.cardinality(v_kept_ordinals) = 0 then
      v_status := 'empty';
    end if;

    for v_index in 1 .. pg_catalog.cardinality(v_valid) loop
      v_entry := v_valid[v_index];
      v_ordinal := (v_entry ->> 'ordinal')::integer;
      if v_ordinal = any(v_kept_ordinals) then
        v_ref := 'ctx-' || pg_catalog.lpad(v_ordinal::text, 4, '0');
        v_line := v_ref || '|' || (v_entry ->> 'sourceKind') || '|'
          || (v_entry ->> 'sourceId') || '|'
          || pg_catalog.coalesce(v_entry ->> 'revision', '') || '|'
          || (v_entry ->> 'summary');
        v_canonical := v_canonical || case when v_canonical = '' then '' else pg_catalog.chr(10) end || v_line;
      end if;
    end loop;
    v_digest := pg_catalog.encode(extensions.digest(v_canonical, 'sha256'), 'hex');

    select pg_catalog.coalesce(
      (select pg_catalog.jsonb_object_agg(counts.code, counts.n)
       from (select code, pg_catalog.count(*) as n
             from pg_catalog.unnest(v_excl_codes) as code
             group by code) as counts),
      '{}'::jsonb
    ) into v_exclusion_counts;

    v_selected_count := pg_catalog.cardinality(v_kept_ordinals);
    v_selected_bytes := 0;
    for v_index in 1 .. pg_catalog.cardinality(v_valid) loop
      v_entry := v_valid[v_index];
      if ((v_entry ->> 'ordinal')::integer = any(v_kept_ordinals)) then
        v_selected_bytes := v_selected_bytes + (v_entry ->> 'bytes')::integer;
      end if;
    end loop;

    insert into public.memory_context_manifests (
      organization_id, purpose, policy_version, context_digest, branch_id,
      channel_id, campaign_id, actor_id, correlation_id, status,
      exclusion_counts, degraded_reasons, selected_count, selected_bytes,
      analysis_run_id, growth_request_id, campaign_generation_run_id,
      subject_operation_id, attempt_key, retrieval_latency_ms
    )
    select p_organization_id, p_purpose, p_policy_version, v_digest,
      p_branch_id, p_channel_id, p_campaign_id,
      (select auth.uid()), p_correlation_id, v_status,
      v_exclusion_counts, v_reasons, v_selected_count, v_selected_bytes,
      v_analysis, v_growth, v_campaign_run, v_subject_op,
      p_attempt_key, p_retrieval_latency_ms
    returning * into v_manifest;

    for v_index in 1 .. pg_catalog.cardinality(v_valid) loop
      v_entry := v_valid[v_index];
      v_ordinal := (v_entry ->> 'ordinal')::integer;
      if v_ordinal = any(v_kept_ordinals) then
        insert into public.memory_context_entries (
          organization_id, manifest_id, ordinal, context_ref, source_kind,
          memory_item_id, capture_event_id, business_fact_id, business_profile_id,
          goal_id, constraint_id, campaign_version_id,
          source_revision, source_digest, statement_kind,
          scope_branch_id, scope_channel_id, trust_rank, freshness, sensitivity,
          observed_at, effective_from, effective_to, reporting_start, reporting_end,
          root_refs, use_restriction, safe_snapshot
        ) values (
          p_organization_id, v_manifest.id, v_ordinal,
          'ctx-' || pg_catalog.lpad(v_ordinal::text, 4, '0'),
          v_entry ->> 'sourceKind',
          case when v_entry ->> 'sourceKind' = 'memory_item' then (v_entry ->> 'sourceId')::uuid end,
          case when v_entry ->> 'sourceKind' = 'capture_event' then (v_entry ->> 'sourceId')::uuid end,
          case when v_entry ->> 'sourceKind' = 'business_fact' then (v_entry ->> 'sourceId')::uuid end,
          case when v_entry ->> 'sourceKind' = 'business_profile' then (v_entry ->> 'sourceId')::uuid end,
          case when v_entry ->> 'sourceKind' = 'goal' then (v_entry ->> 'sourceId')::uuid end,
          case when v_entry ->> 'sourceKind' = 'constraint' then (v_entry ->> 'sourceId')::uuid end,
          case when v_entry ->> 'sourceKind' = 'campaign_version' then (v_entry ->> 'sourceId')::uuid end,
          case when v_entry ->> 'revision' is null then null else (v_entry ->> 'revision')::bigint end,
          v_entry ->> 'digest',
          v_entry ->> 'statementKind',
          case when v_entry ->> 'scopeBranchId' is null then null else (v_entry ->> 'scopeBranchId')::uuid end,
          case when v_entry ->> 'scopeChannelId' is null then null else (v_entry ->> 'scopeChannelId')::uuid end,
          (v_entry ->> 'trustRank')::smallint,
          v_entry ->> 'freshness',
          v_entry ->> 'sensitivity',
          private.memory_context_cast_timestamptz(v_entry ->> 'observedAt'),
          private.memory_context_cast_timestamptz(v_entry ->> 'effectiveFrom'),
          private.memory_context_cast_timestamptz(v_entry ->> 'effectiveTo'),
          private.memory_context_cast_timestamptz(v_entry ->> 'reportingStart'),
          private.memory_context_cast_timestamptz(v_entry ->> 'reportingEnd'),
          case when v_entry -> 'rootRefs' is null or v_entry -> 'rootRefs' = 'null'::jsonb
            then '{}'::uuid[]
            else pg_catalog.coalesce(
              (select pg_catalog.array_agg(root_value::uuid)
               from pg_catalog.jsonb_array_elements_text(v_entry -> 'rootRefs') as root_value
               where root_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
              '{}'::uuid[]) end,
          v_entry ->> 'useRestriction',
          pg_catalog.jsonb_build_object(
            'summary', v_entry ->> 'summary',
            'title', v_entry ->> 'title',
            'statementKind', v_entry ->> 'statementKind',
            'trustRank', (v_entry ->> 'trustRank')::integer,
            'freshness', v_entry ->> 'freshness',
            'sensitivity', v_entry ->> 'sensitivity'
          )
        );
      end if;
    end loop;

    return pg_catalog.jsonb_build_object(
      'manifestId', v_manifest.id, 'contextDigest', v_manifest.context_digest,
      'status', v_manifest.status, 'selectedCount', v_manifest.selected_count,
      'selectedBytes', v_manifest.selected_bytes
    );
  exception when unique_violation then
    -- Same-attempt replay: return the pinned manifest, never a second pack.
    case p_consumer_kind
      when 'analysis_run' then
        select * into v_existing
        from public.memory_context_manifests replayed
        where replayed.organization_id = p_organization_id
          and replayed.purpose = p_purpose
          and replayed.analysis_run_id = v_analysis
          and replayed.attempt_key = p_attempt_key;
      when 'growth_request' then
        select * into v_existing
        from public.memory_context_manifests replayed
        where replayed.organization_id = p_organization_id
          and replayed.purpose = p_purpose
          and replayed.growth_request_id = v_growth
          and replayed.attempt_key = p_attempt_key;
      when 'campaign_generation_run' then
        select * into v_existing
        from public.memory_context_manifests replayed
        where replayed.organization_id = p_organization_id
          and replayed.purpose = p_purpose
          and replayed.campaign_generation_run_id = v_campaign_run
          and replayed.attempt_key = p_attempt_key;
      else
        select * into v_existing
        from public.memory_context_manifests replayed
        where replayed.organization_id = p_organization_id
          and replayed.purpose = p_purpose
          and replayed.subject_operation_id = v_subject_op
          and replayed.attempt_key = p_attempt_key;
    end case;
    if v_existing.id is null then
      raise;
    end if;
    return pg_catalog.jsonb_build_object(
      'manifestId', v_existing.id, 'contextDigest', v_existing.context_digest,
      'status', v_existing.status, 'selectedCount', v_existing.selected_count,
      'selectedBytes', v_existing.selected_bytes
    );
  end;
end;
$$;

revoke all on function private.prepare_memory_context_core(
  uuid, text, text, uuid, text, uuid, uuid, uuid, uuid, text, jsonb, integer
) from public;

-- Prepare: worker entry point (service_role only) ---------------------------------------
-- The caller proves authority with a claimed run binding, never a user
-- identity. A worker must never mint subject bindings: subject_operation is
-- refused here even with a valid operation id.

create or replace function public.prepare_memory_context(
  p_organization_id uuid,
  p_purpose text,
  p_consumer_kind text,
  p_consumer_id uuid,
  p_attempt_key text,
  p_correlation_id uuid,
  p_branch_id uuid,
  p_channel_id uuid,
  p_campaign_id uuid,
  p_policy_version text,
  p_entries jsonb,
  p_retrieval_latency_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_consumer_kind is null
    or p_consumer_kind not in ('analysis_run', 'growth_request', 'campaign_generation_run') then
    raise exception 'memory context consumer kind is invalid' using errcode = '23514';
  end if;
  if p_correlation_id is null then
    raise exception 'memory context preparation input is invalid' using errcode = '23514';
  end if;

  case p_consumer_kind
    when 'analysis_run' then
      select pg_catalog.count(*) into v_count
      from public.channel_analysis_runs claimed_run
      where claimed_run.organization_id = p_organization_id
        and claimed_run.id = p_consumer_id;
    when 'growth_request' then
      select pg_catalog.count(*) into v_count
      from public.growth_intelligence_requests claimed_run
      where claimed_run.organization_id = p_organization_id
        and claimed_run.id = p_consumer_id;
    else
      select pg_catalog.count(*) into v_count
      from public.campaign_generation_runs claimed_run
      where claimed_run.organization_id = p_organization_id
        and claimed_run.id = p_consumer_id;
  end case;
  if v_count = 0 then
    raise exception 'memory context consumer binding is not authorized' using errcode = '42501';
  end if;

  return private.prepare_memory_context_core(
    p_organization_id, p_purpose, p_consumer_kind, p_consumer_id,
    p_attempt_key, p_correlation_id, p_branch_id, p_channel_id, p_campaign_id,
    p_policy_version, p_entries, p_retrieval_latency_ms
  );
end;
$$;

revoke all on function public.prepare_memory_context(
  uuid, text, text, uuid, text, uuid, uuid, uuid, uuid, text, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.prepare_memory_context(
  uuid, text, text, uuid, text, uuid, uuid, uuid, uuid, text, jsonb, integer
) to service_role;

-- Prepare: authenticated subject entry point (authenticated only) --------------------------
-- The subject-context operation row is created by this transaction itself,
-- never by callers: the idempotency key subject-context:<actor>:<correlation>
-- binds actor and request, and a mismatched replay is refused. Only these
-- operations may satisfy the subject FK, structurally — no caller UUID can
-- establish authority. business_profile entries carry organization_id as
-- their source id (profiles have no id column; verified in the resolver).

create or replace function public.prepare_subject_memory_context(
  p_organization_id uuid,
  p_actor_id uuid,
  p_purpose text,
  p_correlation_id uuid,
  p_branch_id uuid,
  p_channel_id uuid,
  p_request_fingerprint text,
  p_policy_version text,
  p_entries jsonb,
  p_retrieval_latency_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation public.memory_write_operations;
  v_key text;
  v_answer jsonb;
begin
  if p_actor_id is null
    or p_purpose is null or p_purpose <> 'subject_drafting'
    or p_correlation_id is null
    or p_request_fingerprint is null
    or pg_catalog.char_length(p_request_fingerprint) not between 1 and 500 then
    raise exception 'memory subject context input is invalid' using errcode = '23514';
  end if;

  if (select auth.uid()) is distinct from p_actor_id
    or not private.is_organization_member(p_organization_id) then
    raise exception 'memory subject context is not authorized' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);

  v_key := 'subject-context:' || p_actor_id::text || ':' || p_correlation_id::text;

  select * into v_operation
  from public.memory_write_operations existing_operation
  where existing_operation.organization_id = p_organization_id
    and existing_operation.idempotency_key = v_key;

  if found then
    if v_operation.request_fingerprint is distinct from p_request_fingerprint then
      raise exception 'memory subject context replay mismatch' using errcode = '23505';
    end if;
  else
    insert into public.memory_write_operations (
      organization_id, idempotency_key, request_fingerprint, response,
      actor_id, operation_kind
    ) values (
      p_organization_id, v_key, p_request_fingerprint,
      pg_catalog.jsonb_build_object(
        'purpose', p_purpose, 'correlationId', p_correlation_id
      ),
      p_actor_id, 'subject_context'
    )
    returning * into v_operation;
  end if;

  select private.prepare_memory_context_core(
    p_organization_id, p_purpose, 'subject_operation', v_operation.id,
    v_key, p_correlation_id, p_branch_id, p_channel_id, null,
    p_policy_version, p_entries, p_retrieval_latency_ms
  ) into v_answer;

  return v_answer || pg_catalog.jsonb_build_object('operationId', v_operation.id);
end;
$$;

revoke all on function public.prepare_subject_memory_context(
  uuid, uuid, text, uuid, uuid, uuid, text, text, jsonb, integer
) from public, anon, authenticated, service_role;
grant execute on function public.prepare_subject_memory_context(
  uuid, uuid, text, uuid, uuid, uuid, text, text, jsonb, integer
) to authenticated;

-- Revalidate ---------------------------------------------------------------------------------
-- Re-reads every included revision, permission, and right immediately before
-- the model call and before fenced completion: valid | changed | revoked |
-- unavailable. Never mutates the pinned manifest.

create or replace function private.revalidate_memory_manifest(
  p_organization_id uuid,
  p_manifest_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manifest public.memory_context_manifests;
  v_settings public.memory_integration_settings;
  v_flags_on boolean := false;
  v_entry public.memory_context_entries;
  v_source_id uuid;
  v_resolved record;
  v_changed boolean := false;
begin
  select * into v_manifest
  from public.memory_context_manifests stored_manifest
  where stored_manifest.organization_id = p_organization_id
    and stored_manifest.id = p_manifest_id;

  if not found then
    raise exception 'memory context manifest was not found' using errcode = 'P0002';
  end if;

  select * into v_settings
  from public.memory_integration_settings configured
  where configured.organization_id = p_organization_id;

  if v_settings.organization_id is not null then
    v_flags_on := case v_manifest.purpose
      when 'channel_advice' then v_settings.channel_context_enabled
      when 'growth_research' then v_settings.growth_context_enabled
      when 'growth_synthesis' then v_settings.growth_context_enabled
      when 'campaign_generation' then v_settings.campaign_context_enabled
      when 'campaign_revision' then v_settings.campaign_context_enabled
      else v_settings.subject_context_enabled
    end;
  end if;

  if not v_flags_on then
    return 'unavailable';
  end if;

  for v_entry in
    select * from public.memory_context_entries stored_entry
    where stored_entry.organization_id = p_organization_id
      and stored_entry.manifest_id = p_manifest_id
    order by stored_entry.ordinal
  loop
    -- Erased content is revoked, never merely changed: there is no summary
    -- left to compare, and descendants must stop, not rebuild against it.
    if v_entry.safe_snapshot = '{}'::jsonb then
      return 'revoked';
    end if;
    v_source_id := pg_catalog.coalesce(
      v_entry.memory_item_id, v_entry.capture_event_id, v_entry.business_fact_id,
      v_entry.business_profile_id, v_entry.goal_id, v_entry.constraint_id,
      v_entry.campaign_version_id
    );
    select * into v_resolved
    from private.resolve_memory_context_source(
      p_organization_id, v_entry.source_kind, v_source_id
    ) as resolved(v_summary text, v_revision bigint, v_digest text, v_status text, v_exclusion text);
    if v_resolved.v_status <> 'ok' then
      return 'revoked';
    end if;
    if v_resolved.v_summary is distinct from (v_entry.safe_snapshot ->> 'summary') then
      v_changed := true;
    end if;
  end loop;

  if v_changed then
    return 'changed';
  end if;
  return 'valid';
end;
$$;

revoke all on function private.revalidate_memory_manifest(uuid, uuid) from public;

create or replace function public.revalidate_memory_context(
  p_organization_id uuid,
  p_manifest_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_organization_id is null or p_manifest_id is null then
    raise exception 'memory context revalidation input is invalid' using errcode = '23514';
  end if;
  v_status := private.revalidate_memory_manifest(p_organization_id, p_manifest_id);
  return pg_catalog.jsonb_build_object('manifestId', p_manifest_id, 'status', v_status);
end;
$$;

revoke all on function public.revalidate_memory_context(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.revalidate_memory_context(uuid, uuid)
  to service_role;

create or replace function public.revalidate_subject_memory_context(
  p_organization_id uuid,
  p_manifest_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_organization_id is null or p_manifest_id is null then
    raise exception 'memory context revalidation input is invalid' using errcode = '23514';
  end if;
  if (select auth.uid()) is null
    or not private.is_organization_member(p_organization_id) then
    raise exception 'memory context revalidation is not authorized' using errcode = '42501';
  end if;
  v_status := private.revalidate_memory_manifest(p_organization_id, p_manifest_id);
  return pg_catalog.jsonb_build_object('manifestId', p_manifest_id, 'status', v_status);
end;
$$;

revoke all on function public.revalidate_subject_memory_context(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.revalidate_subject_memory_context(uuid, uuid)
  to authenticated;

-- Consume ------------------------------------------------------------------------------------------------
-- Binds model-call time and the actual provider/model identifiers to a
-- prepared manifest. The immutability trigger admits exactly this
-- prepared-to-consumed transition; any other mutation is refused.

create or replace function private.consume_memory_manifest(
  p_organization_id uuid,
  p_manifest_id uuid,
  p_provider_name text,
  p_model_id text,
  p_model_called_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manifest public.memory_context_manifests;
begin
  if p_provider_name is null or pg_catalog.char_length(p_provider_name) not between 1 and 120
    or p_model_id is null or pg_catalog.char_length(p_model_id) not between 1 and 120
    or p_model_called_at is null
    or p_model_called_at > pg_catalog.now() then
    raise exception 'memory context consumption input is invalid' using errcode = '23514';
  end if;

  select * into v_manifest
  from public.memory_context_manifests stored_manifest
  where stored_manifest.organization_id = p_organization_id
    and stored_manifest.id = p_manifest_id
  for update;

  if not found then
    raise exception 'memory context manifest was not found' using errcode = 'P0002';
  end if;
  if v_manifest.state <> 'prepared' then
    raise exception 'memory context manifest is already consumed' using errcode = '23505';
  end if;
  if p_model_called_at < v_manifest.as_of then
    raise exception 'memory context consumption input is invalid' using errcode = '23514';
  end if;

  update public.memory_context_manifests
  set state = 'consumed',
    model_called_at = p_model_called_at,
    completed_at = pg_catalog.now(),
    provider_name = p_provider_name,
    model_id = p_model_id
  where memory_context_manifests.organization_id = p_organization_id
    and memory_context_manifests.id = p_manifest_id;

  return pg_catalog.jsonb_build_object('manifestId', p_manifest_id, 'state', 'consumed');
end;
$$;

revoke all on function private.consume_memory_manifest(uuid, uuid, text, text, timestamptz) from public;

create or replace function public.consume_memory_context(
  p_organization_id uuid,
  p_manifest_id uuid,
  p_provider_name text,
  p_model_id text,
  p_model_called_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or p_manifest_id is null then
    raise exception 'memory context consumption input is invalid' using errcode = '23514';
  end if;
  return private.consume_memory_manifest(
    p_organization_id, p_manifest_id, p_provider_name, p_model_id, p_model_called_at
  );
end;
$$;

revoke all on function public.consume_memory_context(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.consume_memory_context(uuid, uuid, text, text, timestamptz)
  to service_role;

create or replace function public.consume_subject_memory_context(
  p_organization_id uuid,
  p_manifest_id uuid,
  p_provider_name text,
  p_model_id text,
  p_model_called_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or p_manifest_id is null then
    raise exception 'memory context consumption input is invalid' using errcode = '23514';
  end if;
  if (select auth.uid()) is null
    or not private.is_organization_member(p_organization_id) then
    raise exception 'memory context consumption is not authorized' using errcode = '42501';
  end if;
  return private.consume_memory_manifest(
    p_organization_id, p_manifest_id, p_provider_name, p_model_id, p_model_called_at
  );
end;
$$;

revoke all on function public.consume_subject_memory_context(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_subject_memory_context(uuid, uuid, text, text, timestamptz)
  to authenticated;

-- Erasure -------------------------------------------------------------------------------------------------------
-- Rights-driven erasure path (Spec 023 §§11/14): nulls projection documents,
-- safe snapshots, and derived embeddings for one source identity across
-- events, items, and entries, retaining only permitted ids/digests/decision
-- metadata. Every call writes an audit row. Owner/admin members and the
-- worker are both allowed; anonymous callers are denied outright.

create or replace function public.erase_memory_source_content(
  p_organization_id uuid,
  p_actor_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
  v_event_ids uuid[] := '{}';
  v_item_ids uuid[] := '{}';
  v_erased_events integer := 0;
  v_erased_items integer := 0;
  v_erased_entries integer := 0;
  v_count integer;
begin
  if p_organization_id is null
    or p_source_kind is null
    or p_source_kind not in (
      'channel_finding', 'channel_recommendation', 'channel_decision',
      'market_claim', 'growth_item', 'growth_decision',
      'campaign_state', 'campaign_outcome', 'campaign_lesson',
      'memory_item'
    )
    or p_source_id is null
    or p_reason is null or pg_catalog.char_length(p_reason) not between 1 and 300 then
    raise exception 'memory source erasure input is invalid' using errcode = '23514';
  end if;

  v_caller := (select auth.uid());
  if v_caller is null then
    -- Worker path: no actor may be forged.
    if p_actor_id is not null then
      raise exception 'memory source erasure is not authorized' using errcode = '42501';
    end if;
  else
    if p_actor_id is distinct from v_caller
      or not private.has_organization_role(
        p_organization_id, array['owner', 'admin']::public.organization_role[]
      ) then
      raise exception 'memory source erasure is not authorized' using errcode = '42501';
    end if;
  end if;

  if p_source_kind = 'memory_item' then
    select pg_catalog.count(*) into v_count
    from public.memory_items root_item
    where root_item.organization_id = p_organization_id
      and root_item.id = p_source_id;
    if v_count = 0 then
      raise exception 'memory erasure source was not found' using errcode = 'P0002';
    end if;
    v_item_ids := array[p_source_id];
    select pg_catalog.coalesce(pg_catalog.array_agg(erased_event.id), '{}') into v_event_ids
    from public.memory_capture_events erased_event
    where erased_event.organization_id = p_organization_id
      and erased_event.projected_item_id = p_source_id;
  else
    case p_source_kind
      when 'channel_finding' then
        select pg_catalog.coalesce(pg_catalog.array_agg(erased_event.id), '{}') into v_event_ids
        from public.memory_capture_events erased_event
        where erased_event.organization_id = p_organization_id
          and erased_event.channel_finding_id = p_source_id;
      when 'channel_recommendation' then
        select pg_catalog.coalesce(pg_catalog.array_agg(erased_event.id), '{}') into v_event_ids
        from public.memory_capture_events erased_event
        where erased_event.organization_id = p_organization_id
          and erased_event.channel_recommendation_id = p_source_id;
      when 'channel_decision' then
        select pg_catalog.coalesce(pg_catalog.array_agg(erased_event.id), '{}') into v_event_ids
        from public.memory_capture_events erased_event
        where erased_event.organization_id = p_organization_id
          and erased_event.channel_decision_id = p_source_id;
      when 'market_claim' then
        select pg_catalog.coalesce(pg_catalog.array_agg(erased_event.id), '{}') into v_event_ids
        from public.memory_capture_events erased_event
        where erased_event.organization_id = p_organization_id
          and erased_event.market_claim_id = p_source_id;
      when 'growth_item' then
        select pg_catalog.coalesce(pg_catalog.array_agg(erased_event.id), '{}') into v_event_ids
        from public.memory_capture_events erased_event
        where erased_event.organization_id = p_organization_id
          and erased_event.growth_item_id = p_source_id;
      when 'growth_decision' then
        select pg_catalog.coalesce(pg_catalog.array_agg(erased_event.id), '{}') into v_event_ids
        from public.memory_capture_events erased_event
        where erased_event.organization_id = p_organization_id
          and erased_event.growth_decision_id = p_source_id;
      when 'campaign_state' then
        select pg_catalog.coalesce(pg_catalog.array_agg(erased_event.id), '{}') into v_event_ids
        from public.memory_capture_events erased_event
        where erased_event.organization_id = p_organization_id
          and erased_event.campaign_id = p_source_id;
      when 'campaign_outcome' then
        select pg_catalog.coalesce(pg_catalog.array_agg(erased_event.id), '{}') into v_event_ids
        from public.memory_capture_events erased_event
        where erased_event.organization_id = p_organization_id
          and erased_event.campaign_outcome_id = p_source_id;
      else
        select pg_catalog.coalesce(pg_catalog.array_agg(erased_event.id), '{}') into v_event_ids
        from public.memory_capture_events erased_event
        where erased_event.organization_id = p_organization_id
          and erased_event.campaign_learning_proposal_id = p_source_id;
    end case;
    select pg_catalog.coalesce(pg_catalog.array_agg(erased_item.id), '{}') into v_item_ids
    from public.memory_items erased_item
    where erased_item.organization_id = p_organization_id
      and erased_item.capture_event_id = any(v_event_ids);
  end if;

  update public.memory_capture_events
  set projection_document = '{}'::jsonb
  where memory_capture_events.organization_id = p_organization_id
    and memory_capture_events.id = any(v_event_ids)
    and memory_capture_events.projection_document is distinct from '{}'::jsonb;
  get diagnostics v_erased_events = row_count;

  update public.memory_items
  set body = null,
    structured_value = null,
    embedding = null,
    embedding_model = null
  where memory_items.organization_id = p_organization_id
    and memory_items.id = any(v_item_ids);
  get diagnostics v_erased_items = row_count;

  update public.memory_context_entries
  set safe_snapshot = '{}'::jsonb
  where memory_context_entries.organization_id = p_organization_id
    and (
      memory_context_entries.capture_event_id = any(v_event_ids)
      or memory_context_entries.memory_item_id = any(v_item_ids)
    )
    and memory_context_entries.safe_snapshot is distinct from '{}'::jsonb;
  get diagnostics v_erased_entries = row_count;

  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id,
    entity_type, entity_id, payload
  ) values (
    p_organization_id, 'memory.source_content_erased',
    case when p_actor_id is null then 'system' else 'user' end::public.audit_actor_type,
    p_actor_id, 'memory_capture_source', p_source_id,
    pg_catalog.jsonb_build_object(
      'sourceKind', p_source_kind,
      'reason', p_reason,
      'erasedEvents', v_erased_events,
      'erasedItems', v_erased_items,
      'erasedEntries', v_erased_entries
    )
  );

  return pg_catalog.jsonb_build_object(
    'sourceId', p_source_id,
    'erasedEvents', v_erased_events,
    'erasedItems', v_erased_items,
    'erasedEntries', v_erased_entries
  );
end;
$$;

revoke all on function public.erase_memory_source_content(uuid, uuid, text, uuid, text)
  from public, anon;
grant execute on function public.erase_memory_source_content(uuid, uuid, text, uuid, text)
  to authenticated, service_role;
