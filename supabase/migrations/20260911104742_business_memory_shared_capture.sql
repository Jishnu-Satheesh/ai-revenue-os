-- Spec 023 Task 02: shared-capture storage. No adapter enabled here and no
-- provider behavior changes: every flag defaults off and every queue starts
-- empty, so existing features run exactly as before until their own adapter
-- slice lands.
--
-- Tables are RPC-only: revoked from every session role, written through the
-- settings RPC and (from adapter slices onward) the source transactions that
-- call the private revision allocator below. Reads go through worker RPCs.

-- Integration settings: one row per organization ----------------------------

create table public.memory_integration_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  capture_enabled boolean not null default false,
  channel_context_enabled boolean not null default false,
  growth_context_enabled boolean not null default false,
  campaign_context_enabled boolean not null default false,
  subject_context_enabled boolean not null default false,
  legacy_corpus_qualified boolean not null default false,
  context_policy_version text not null default 'shared-context-v1' check (
    char_length(context_policy_version) between 1 and 60
  ),
  -- Bounded per-adapter reconciliation cursors. Worker-only updates arrive
  -- with the dispatch slice; no RPC writes them yet.
  channel_cursor text check (channel_cursor is null or char_length(channel_cursor) between 1 and 200),
  growth_cursor text check (growth_cursor is null or char_length(growth_cursor) between 1 and 200),
  campaign_cursor text check (campaign_cursor is null or char_length(campaign_cursor) between 1 and 200),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.memory_integration_settings enable row level security;
alter table public.memory_integration_settings force row level security;
revoke all on table public.memory_integration_settings from public, anon, authenticated;

create trigger memory_integration_settings_set_updated_at
before update on public.memory_integration_settings
for each row execute function public.set_updated_at();

create or replace function private.audit_memory_integration_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, payload)
  values (
    coalesce(new.organization_id, old.organization_id),
    'memory.integration_changed',
    'user',
    (select auth.uid()),
    'memory_integration_settings',
    coalesce(new.organization_id, old.organization_id),
    pg_catalog.jsonb_build_object(
      'operation', TG_OP,
      'capture_enabled', coalesce(new.capture_enabled, old.capture_enabled),
      'context_policy_version', coalesce(new.context_policy_version, old.context_policy_version)
    )
  );
  return new;
end;
$$;

revoke all on function private.audit_memory_integration_change() from public;

create trigger memory_integration_settings_audit
after insert or update on public.memory_integration_settings
for each row execute function private.audit_memory_integration_change();

-- Source revisions: monotonic per-source ordering --------------------------------
--
-- Adapters never add revision columns to their own tables. They call the
-- allocator with a canonical allowlisted state digest; only a changed digest
-- advances the revision, so duplicate deliveries and unchanged retries never
-- mint one. A changed-away-and-back state is a new ordered revision.

create table public.memory_source_revisions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_kind text not null check (source_kind in (
    'channel_finding', 'channel_recommendation', 'channel_decision',
    'market_claim', 'growth_item', 'growth_decision',
    'campaign_state', 'campaign_outcome', 'campaign_lesson'
  )),
  source_id uuid not null,
  revision bigint not null default 1 check (revision >= 1),
  state_digest text not null check (state_digest ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_kind, source_id)
);

alter table public.memory_source_revisions enable row level security;
alter table public.memory_source_revisions force row level security;
revoke all on table public.memory_source_revisions from public, anon, authenticated;

-- Capture events: the durable queue --------------------------------------------

create table public.memory_capture_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_kind text not null check (source_kind in (
    'channel_finding', 'channel_recommendation', 'channel_decision',
    'market_claim', 'growth_item', 'growth_decision',
    'campaign_state', 'campaign_outcome', 'campaign_lesson'
  )),
  -- Exactly one typed primary source per kind; the check below enforces it.
  channel_finding_id uuid,
  channel_recommendation_id uuid,
  channel_decision_id uuid,
  market_claim_id uuid,
  growth_item_id uuid,
  growth_decision_id uuid,
  campaign_id uuid,
  campaign_outcome_id uuid,
  campaign_learning_proposal_id uuid,
  source_revision bigint not null check (source_revision >= 1),
  source_digest text not null check (source_digest ~ '^[0-9a-f]{64}$'),
  event_kind text not null check (event_kind in ('recorded', 'changed', 'withdrawn', 'submitted')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  correlation_id uuid not null,
  branch_id uuid,
  channel_id uuid,
  effective_from timestamptz,
  effective_to timestamptz,
  reporting_start timestamptz,
  reporting_end timestamptz,
  sensitivity text not null default 'internal' check (
    sensitivity in ('public', 'internal', 'confidential', 'customer_content')
  ),
  reuse_class text not null default 'internal_reusable' check (
    reuse_class in ('internal_reusable', 'qualified_reusable', 'metadata_only', 'denied')
  ),
  qualification_ref text check (
    qualification_ref is null or char_length(qualification_ref) between 1 and 300
  ),
  retain_until timestamptz,
  projection_document jsonb not null default '{}'::jsonb check (
    jsonb_typeof(projection_document) = 'object'
    and pg_catalog.octet_length(projection_document::text) <= 8192
  ),
  status text not null default 'pending' check (
    status in ('pending', 'claimed', 'completed', 'obsolete', 'quarantined', 'failed')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  safe_failure_code text check (
    safe_failure_code is null or char_length(safe_failure_code) between 1 and 60
  ),
  projected_item_id uuid,
  unique (organization_id, id),
  constraint memory_capture_events_effective_range check (
    effective_to is null or effective_from is null or effective_to >= effective_from
  ),
  constraint memory_capture_events_reporting_range check (
    reporting_end is null or reporting_start is null or reporting_end >= reporting_start
  ),
  constraint memory_capture_events_lease_pair check (
    (claim_token is null) = (lease_expires_at is null)
  ),
  constraint memory_capture_events_completion_pair check (
    (status = 'completed') = (completed_at is not null)
  ),
  constraint memory_capture_events_source_kind_slot check (
    (source_kind = 'channel_finding'
      and channel_finding_id is not null and channel_recommendation_id is null
      and channel_decision_id is null and market_claim_id is null and growth_item_id is null
      and growth_decision_id is null and campaign_id is null and campaign_outcome_id is null
      and campaign_learning_proposal_id is null)
    or (source_kind = 'channel_recommendation'
      and channel_finding_id is null and channel_recommendation_id is not null
      and channel_decision_id is null and market_claim_id is null and growth_item_id is null
      and growth_decision_id is null and campaign_id is null and campaign_outcome_id is null
      and campaign_learning_proposal_id is null)
    or (source_kind = 'channel_decision'
      and channel_finding_id is null and channel_recommendation_id is null
      and channel_decision_id is not null and market_claim_id is null and growth_item_id is null
      and growth_decision_id is null and campaign_id is null and campaign_outcome_id is null
      and campaign_learning_proposal_id is null)
    or (source_kind = 'market_claim'
      and channel_finding_id is null and channel_recommendation_id is null
      and channel_decision_id is null and market_claim_id is not null and growth_item_id is null
      and growth_decision_id is null and campaign_id is null and campaign_outcome_id is null
      and campaign_learning_proposal_id is null)
    or (source_kind = 'growth_item'
      and channel_finding_id is null and channel_recommendation_id is null
      and channel_decision_id is null and market_claim_id is null and growth_item_id is not null
      and growth_decision_id is null and campaign_id is null and campaign_outcome_id is null
      and campaign_learning_proposal_id is null)
    or (source_kind = 'growth_decision'
      and channel_finding_id is null and channel_recommendation_id is null
      and channel_decision_id is null and market_claim_id is null and growth_item_id is null
      and growth_decision_id is not null and campaign_id is null and campaign_outcome_id is null
      and campaign_learning_proposal_id is null)
    or (source_kind = 'campaign_state'
      and channel_finding_id is null and channel_recommendation_id is null
      and channel_decision_id is null and market_claim_id is null and growth_item_id is null
      and growth_decision_id is null and campaign_id is not null and campaign_outcome_id is null
      and campaign_learning_proposal_id is null)
    or (source_kind = 'campaign_outcome'
      and channel_finding_id is null and channel_recommendation_id is null
      and channel_decision_id is null and market_claim_id is null and growth_item_id is null
      and growth_decision_id is null and campaign_id is null and campaign_outcome_id is not null
      and campaign_learning_proposal_id is null)
    or (source_kind = 'campaign_lesson'
      and channel_finding_id is null and channel_recommendation_id is null
      and channel_decision_id is null and market_claim_id is null and growth_item_id is null
      and growth_decision_id is null and campaign_id is null and campaign_outcome_id is null
      and campaign_learning_proposal_id is not null)
  ),
  constraint memory_capture_events_channel_finding_fk foreign key (organization_id, channel_finding_id)
    references public.channel_findings (organization_id, id) on delete cascade,
  constraint memory_capture_events_channel_recommendation_fk foreign key (organization_id, channel_recommendation_id)
    references public.channel_recommendations (organization_id, id) on delete cascade,
  constraint memory_capture_events_channel_decision_fk foreign key (organization_id, channel_decision_id)
    references public.channel_recommendation_decisions (organization_id, id) on delete cascade,
  constraint memory_capture_events_market_claim_fk foreign key (organization_id, market_claim_id)
    references public.market_evidence_claims (organization_id, id) on delete cascade,
  constraint memory_capture_events_growth_item_fk foreign key (organization_id, growth_item_id)
    references public.growth_intelligence_items (organization_id, id) on delete cascade,
  constraint memory_capture_events_growth_decision_fk foreign key (organization_id, growth_decision_id)
    references public.growth_intelligence_item_decisions (organization_id, id) on delete cascade,
  constraint memory_capture_events_campaign_fk foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  constraint memory_capture_events_campaign_outcome_fk foreign key (organization_id, campaign_outcome_id)
    references public.campaign_outcomes (organization_id, id) on delete cascade,
  constraint memory_capture_events_campaign_lesson_fk foreign key (organization_id, campaign_learning_proposal_id)
    references public.campaign_learning_proposals (organization_id, id) on delete cascade,
  constraint memory_capture_events_branch_fk foreign key (organization_id, branch_id)
    references public.branches (organization_id, id) on delete cascade,
  constraint memory_capture_events_channel_fk foreign key (organization_id, channel_id)
    references public.organization_channels (organization_id, id) on delete cascade,
  constraint memory_capture_events_projected_item_fk foreign key (organization_id, projected_item_id)
    references public.memory_items (organization_id, id) on delete set null
);

-- One capture intent per source revision: repeated delivery is harmless.
create unique index memory_capture_events_channel_finding_revision
  on public.memory_capture_events (organization_id, channel_finding_id, source_revision)
  where source_kind = 'channel_finding';
create unique index memory_capture_events_channel_recommendation_revision
  on public.memory_capture_events (organization_id, channel_recommendation_id, source_revision)
  where source_kind = 'channel_recommendation';
create unique index memory_capture_events_channel_decision_revision
  on public.memory_capture_events (organization_id, channel_decision_id, source_revision)
  where source_kind = 'channel_decision';
create unique index memory_capture_events_market_claim_revision
  on public.memory_capture_events (organization_id, market_claim_id, source_revision)
  where source_kind = 'market_claim';
create unique index memory_capture_events_growth_item_revision
  on public.memory_capture_events (organization_id, growth_item_id, source_revision)
  where source_kind = 'growth_item';
create unique index memory_capture_events_growth_decision_revision
  on public.memory_capture_events (organization_id, growth_decision_id, source_revision)
  where source_kind = 'growth_decision';
create unique index memory_capture_events_campaign_revision
  on public.memory_capture_events (organization_id, campaign_id, source_revision)
  where source_kind = 'campaign_state';
create unique index memory_capture_events_campaign_outcome_revision
  on public.memory_capture_events (organization_id, campaign_outcome_id, source_revision)
  where source_kind = 'campaign_outcome';
create unique index memory_capture_events_campaign_lesson_revision
  on public.memory_capture_events (organization_id, campaign_learning_proposal_id, source_revision)
  where source_kind = 'campaign_lesson';

-- One projected item per completed event: a lost receipt replays to the same row.
create unique index memory_capture_events_projected_item
  on public.memory_capture_events (organization_id, projected_item_id)
  where projected_item_id is not null;

create index memory_capture_events_due
  on public.memory_capture_events (status, next_attempt_at, organization_id);
create index memory_capture_events_org_time
  on public.memory_capture_events (organization_id, created_at desc);
create index memory_capture_events_channel_finding
  on public.memory_capture_events (organization_id, channel_finding_id)
  where channel_finding_id is not null;
create index memory_capture_events_channel_recommendation
  on public.memory_capture_events (organization_id, channel_recommendation_id)
  where channel_recommendation_id is not null;
create index memory_capture_events_channel_decision
  on public.memory_capture_events (organization_id, channel_decision_id)
  where channel_decision_id is not null;
create index memory_capture_events_market_claim
  on public.memory_capture_events (organization_id, market_claim_id)
  where market_claim_id is not null;
create index memory_capture_events_growth_item
  on public.memory_capture_events (organization_id, growth_item_id)
  where growth_item_id is not null;
create index memory_capture_events_growth_decision
  on public.memory_capture_events (organization_id, growth_decision_id)
  where growth_decision_id is not null;
create index memory_capture_events_campaign
  on public.memory_capture_events (organization_id, campaign_id)
  where campaign_id is not null;
create index memory_capture_events_campaign_outcome
  on public.memory_capture_events (organization_id, campaign_outcome_id)
  where campaign_outcome_id is not null;
create index memory_capture_events_campaign_lesson
  on public.memory_capture_events (organization_id, campaign_learning_proposal_id)
  where campaign_learning_proposal_id is not null;

alter table public.memory_capture_events enable row level security;
alter table public.memory_capture_events force row level security;
revoke all on table public.memory_capture_events from public, anon, authenticated;

-- Capture dependencies: event ancestry -------------------------------------------

create table public.memory_capture_dependencies (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  capture_event_id uuid not null,
  parent_capture_event_id uuid not null,
  relation text not null check (relation in ('derived_from', 'supports', 'contradicts')),
  primary key (organization_id, capture_event_id, parent_capture_event_id),
  constraint memory_capture_dependencies_no_self_edge check (
    capture_event_id is distinct from parent_capture_event_id
  ),
  constraint memory_capture_dependencies_event_fk foreign key (organization_id, capture_event_id)
    references public.memory_capture_events (organization_id, id) on delete cascade,
  constraint memory_capture_dependencies_parent_fk foreign key (organization_id, parent_capture_event_id)
    references public.memory_capture_events (organization_id, id) on delete cascade
);

create index memory_capture_dependencies_parent
  on public.memory_capture_dependencies (organization_id, parent_capture_event_id);

alter table public.memory_capture_dependencies enable row level security;
alter table public.memory_capture_dependencies force row level security;
revoke all on table public.memory_capture_dependencies from public, anon, authenticated;

-- Adapter registry: which kinds may project ---------------------------------------
--
-- Empty until adapter slices register their kind. Completion quarantines any
-- event whose kind is not registered rather than projecting it.

create table public.memory_capture_adapters (
  source_kind text primary key check (source_kind in (
    'channel_finding', 'channel_recommendation', 'channel_decision',
    'market_claim', 'growth_item', 'growth_decision',
    'campaign_state', 'campaign_outcome', 'campaign_lesson'
  )),
  registered boolean not null default true,
  note text check (note is null or char_length(note) between 1 and 300)
);

alter table public.memory_capture_adapters enable row level security;
alter table public.memory_capture_adapters force row level security;
revoke all on table public.memory_capture_adapters from public, anon, authenticated;

-- memory_items: statement kind + capture link ---------------------------------------

alter table public.memory_items
  add column knowledge_kind text not null default 'legacy' check (knowledge_kind in (
    'observation', 'recommendation', 'operator_decision',
    'campaign_state', 'measured_outcome', 'lesson', 'legacy'
  )),
  add column capture_event_id uuid;

alter table public.memory_items
  add constraint memory_items_knowledge_kind_shape check (
    knowledge_kind = 'legacy'
    or (knowledge_kind = 'observation' and memory_type = 'episode')
    or (knowledge_kind = 'recommendation' and memory_type = 'episode')
    or (knowledge_kind = 'operator_decision' and memory_type = 'decision')
    or (knowledge_kind = 'campaign_state' and memory_type = 'episode')
    or (knowledge_kind = 'measured_outcome' and memory_type = 'outcome')
    or (knowledge_kind = 'lesson' and memory_type = 'lesson')
  ),
  add constraint memory_items_capture_event_fk foreign key (organization_id, capture_event_id)
    references public.memory_capture_events (organization_id, id) on delete set null;

create unique index memory_items_capture_event
  on public.memory_items (organization_id, capture_event_id)
  where capture_event_id is not null;

-- Permission seeds ------------------------------------------------------------------

insert into public.permissions (key, description, scope) values
  ('memory.manage_integrations', 'Change Business Memory capture and context settings.', 'organization'),
  ('memory.retry_capture', 'Retry a failed or quarantined Business Memory capture.', 'organization');

insert into public.organization_role_permissions (organization_role, permission_key) values
  ('owner', 'memory.manage_integrations'),
  ('owner', 'memory.retry_capture'),
  ('admin', 'memory.manage_integrations'),
  ('admin', 'memory.retry_capture');

-- Settings mutation: explicit booleans, owner/admin, audited by trigger --------------

create or replace function public.update_memory_integration_settings(
  p_organization_id uuid,
  p_actor_id uuid,
  p_capture_enabled boolean,
  p_channel_context_enabled boolean,
  p_growth_context_enabled boolean,
  p_campaign_context_enabled boolean,
  p_subject_context_enabled boolean,
  p_legacy_corpus_qualified boolean,
  p_context_policy_version text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.memory_integration_settings;
begin
  if p_organization_id is null
    or p_actor_id is null
    or p_capture_enabled is null
    or p_channel_context_enabled is null
    or p_growth_context_enabled is null
    or p_campaign_context_enabled is null
    or p_subject_context_enabled is null
    or p_legacy_corpus_qualified is null
    or p_context_policy_version is null
    or pg_catalog.char_length(p_context_policy_version) not between 1 and 60
    or p_correlation_id is null then
    raise exception 'memory integration settings input is invalid' using errcode = '23514';
  end if;

  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'memory.manage_integrations') then
    raise exception 'memory integration settings change is not authorized' using errcode = '42501';
  end if;

  perform pg_catalog.set_config('app.correlation_id', p_correlation_id::text, true);

  insert into public.memory_integration_settings (
    organization_id, capture_enabled, channel_context_enabled, growth_context_enabled,
    campaign_context_enabled, subject_context_enabled, legacy_corpus_qualified,
    context_policy_version, updated_by
  ) values (
    p_organization_id, p_capture_enabled, p_channel_context_enabled, p_growth_context_enabled,
    p_campaign_context_enabled, p_subject_context_enabled, p_legacy_corpus_qualified,
    p_context_policy_version, p_actor_id
  )
  on conflict (organization_id) do update set
    capture_enabled = excluded.capture_enabled,
    channel_context_enabled = excluded.channel_context_enabled,
    growth_context_enabled = excluded.growth_context_enabled,
    campaign_context_enabled = excluded.campaign_context_enabled,
    subject_context_enabled = excluded.subject_context_enabled,
    legacy_corpus_qualified = excluded.legacy_corpus_qualified,
    context_policy_version = excluded.context_policy_version,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into settings;

  return pg_catalog.jsonb_build_object(
    'organizationId', settings.organization_id,
    'captureEnabled', settings.capture_enabled,
    'contextPolicyVersion', settings.context_policy_version
  );
end;
$$;

revoke all on function public.update_memory_integration_settings(
  uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean, text, uuid
) from public, anon;
grant execute on function public.update_memory_integration_settings(
  uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean, text, uuid
) to authenticated;

-- Revision allocator: monotonic per source, digest-gated ------------------------------
--
-- Private: only source transactions (through their own fenced RPCs) reach it
-- by nesting inside their definer context. Direct session calls are revoked.
-- The per-source row lock serializes concurrent completions of one source.

create or replace function private.allocate_memory_source_revision(
  p_organization_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_state_digest text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.memory_source_revisions;
begin
  if p_organization_id is null
    or p_source_kind is null
    or p_source_kind not in (
      'channel_finding', 'channel_recommendation', 'channel_decision',
      'market_claim', 'growth_item', 'growth_decision',
      'campaign_state', 'campaign_outcome', 'campaign_lesson'
    )
    or p_source_id is null
    or p_source_id = '00000000-0000-0000-0000-000000000000'
    or p_state_digest is null
    or p_state_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'memory source revision input is invalid' using errcode = '23514';
  end if;

  select * into current_row
  from public.memory_source_revisions existing
  where existing.organization_id = p_organization_id
    and existing.source_kind = p_source_kind
    and existing.source_id = p_source_id
  for update;

  if not found then
    insert into public.memory_source_revisions (
      organization_id, source_kind, source_id, revision, state_digest
    ) values (p_organization_id, p_source_kind, p_source_id, 1, p_state_digest);
    return 1;
  end if;

  if current_row.state_digest = p_state_digest then
    return current_row.revision;
  end if;

  update public.memory_source_revisions
  set revision = current_row.revision + 1,
    state_digest = p_state_digest,
    updated_at = now()
  where memory_source_revisions.organization_id = p_organization_id
    and memory_source_revisions.source_kind = p_source_kind
    and memory_source_revisions.source_id = p_source_id;

  return current_row.revision + 1;
end;
$$;

revoke all on function private.allocate_memory_source_revision(uuid, text, uuid, text) from public;
