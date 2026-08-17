-- Business Memory V1. See specs/004-business-memory.md and ADR 0011.
--
-- `public.business_facts` remains the single writable source of truth for
-- authoritative facts. This schema owns episodic, semantic, decision, outcome,
-- lesson, and fact-proposal memory only, and a check constraint forbids a
-- `structured_fact` row: that type is produced at read time by projecting
-- `business_facts`.

create extension if not exists vector with schema extensions;

-- Memory items -------------------------------------------------------------

create table public.memory_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  memory_type text not null check (
    memory_type in (
      'document',
      'note',
      'episode',
      'decision',
      'outcome',
      'lesson',
      'fact_proposal'
    )
  ),
  title text not null check (char_length(title) between 1 and 300),
  body text check (body is null or char_length(body) <= 8000),
  structured_value jsonb check (
    structured_value is null or jsonb_typeof(structured_value) = 'object'
  ),
  origin text not null check (
    origin in (
      'user_verified',
      'provider_imported',
      'system_generated',
      'ai_proposed',
      'outcome_learned'
    )
  ),
  -- Derived by private.set_memory_source_tier(); never accepted from a caller,
  -- which is why it carries no insert or update grant.
  source_tier smallint not null default 5 check (source_tier between 1 and 5),
  source_system text check (source_system is null or char_length(source_system) between 1 and 120),
  source_reference text check (
    source_reference is null or char_length(source_reference) between 1 and 512
  ),
  -- An opaque run reference. Deliberately not a foreign key: runs originate in
  -- the integrations module today and in the execution plane later, and memory
  -- must not couple to either schema.
  source_run_id uuid,
  source_record_id text check (
    source_record_id is null or char_length(source_record_id) between 1 and 512
  ),
  verification_state text not null default 'unverified' check (
    verification_state in ('proposed', 'unverified', 'verified', 'rejected')
  ),
  confidence numeric(5, 4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  sensitivity text not null default 'internal' check (
    sensitivity in ('public', 'internal', 'confidential', 'customer_content')
  ),
  observed_at timestamptz,
  effective_from timestamptz,
  effective_to timestamptz,
  review_due_at timestamptz,
  expires_at timestamptz,
  superseded_by_id uuid,
  superseded_at timestamptz,
  supersession_reason text check (
    supersession_reason is null or char_length(supersession_reason) between 1 and 500
  ),
  rejection_reason text check (
    rejection_reason is null or char_length(rejection_reason) between 1 and 500
  ),
  proposed_fact_key text check (
    proposed_fact_key is null or proposed_fact_key ~ '^[a-z][a-z0-9_.-]{1,120}$'
  ),
  proposed_fact_value jsonb,
  proposed_branch_id uuid,
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) stored,
  embedding extensions.vector(1536),
  embedding_model text check (
    embedding_model is null or char_length(embedding_model) between 1 and 120
  ),
  embedding_status text not null default 'pending' check (
    embedding_status in ('pending', 'ready', 'failed', 'skipped')
  ),
  embedding_updated_at timestamptz,
  created_by uuid references auth.users(id),
  verified_by uuid references auth.users(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  -- `structured_fact` is virtual. ADR 0011.
  constraint memory_items_no_structured_fact check (memory_type <> 'structured_fact'),
  constraint memory_items_verification_pair check (
    (verified_by is null) = (verified_at is null)
  ),
  constraint memory_items_verified_requires_actor check (
    verification_state <> 'verified' or verified_at is not null
  ),
  constraint memory_items_supersession_pair check (
    (superseded_by_id is null) = (superseded_at is null)
  ),
  constraint memory_items_no_self_supersession check (superseded_by_id is distinct from id),
  constraint memory_items_effective_range check (
    effective_to is null or effective_from is null or effective_to >= effective_from
  ),
  constraint memory_items_proposal_shape check (
    (memory_type = 'fact_proposal') = (proposed_fact_key is not null)
  ),
  constraint memory_items_proposal_value check (
    (proposed_fact_key is null) = (proposed_fact_value is null)
  ),
  constraint memory_items_proposal_branch check (
    proposed_branch_id is null or memory_type = 'fact_proposal'
  ),
  constraint memory_items_embedding_model check (
    embedding is null or embedding_model is not null
  ),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete cascade,
  foreign key (organization_id, proposed_branch_id)
    references public.branches(organization_id, id) on delete cascade,
  foreign key (organization_id, superseded_by_id)
    references public.memory_items(organization_id, id) on delete set null (superseded_by_id)
);

-- Re-syncing a provider record updates the existing item rather than duplicating it.
create unique index memory_items_source_record_idx
  on public.memory_items (organization_id, source_system, source_record_id)
  where source_record_id is not null;

create index memory_items_organization_type_created_idx
  on public.memory_items (organization_id, memory_type, created_at desc);
create index memory_items_organization_observed_idx
  on public.memory_items (organization_id, observed_at desc nulls last);
create index memory_items_review_queue_idx
  on public.memory_items (organization_id, created_at desc)
  where verification_state = 'proposed';
create index memory_items_embedding_backlog_idx
  on public.memory_items (organization_id, created_at)
  where embedding_status = 'pending';
create index memory_items_organization_branch_idx
  on public.memory_items (organization_id, branch_id);
create index memory_items_organization_proposed_branch_idx
  on public.memory_items (organization_id, proposed_branch_id);
create index memory_items_organization_superseded_by_idx
  on public.memory_items (organization_id, superseded_by_id);
create index memory_items_created_by_idx on public.memory_items (created_by);
create index memory_items_verified_by_idx on public.memory_items (verified_by);
create index memory_items_source_run_idx on public.memory_items (source_run_id);
create index memory_items_search_idx on public.memory_items using gin (search_vector);
create index memory_items_embedding_idx
  on public.memory_items using hnsw (embedding extensions.vector_cosine_ops);

-- Memory links -------------------------------------------------------------

create table public.memory_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  from_item_id uuid not null,
  to_item_id uuid not null,
  relation text not null check (
    relation in ('derived_from', 'supports', 'contradicts', 'explains')
  ),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, from_item_id, to_item_id, relation),
  constraint memory_links_distinct_endpoints check (from_item_id <> to_item_id),
  foreign key (organization_id, from_item_id)
    references public.memory_items(organization_id, id) on delete cascade,
  foreign key (organization_id, to_item_id)
    references public.memory_items(organization_id, id) on delete cascade
);

create index memory_links_organization_from_idx
  on public.memory_links (organization_id, from_item_id);
create index memory_links_organization_to_idx
  on public.memory_links (organization_id, to_item_id);
create index memory_links_created_by_idx on public.memory_links (created_by);

-- Retrieval log ------------------------------------------------------------

-- Append-only. Every retrieval is logged, including empty results and denials,
-- so a cache hit can never create a blind spot in the audit trail.
create table public.memory_retrieval_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  purpose text not null check (
    purpose in (
      'decision_context',
      'opportunity_generation',
      'outcome_analysis',
      'operator_search',
      'onboarding_assist'
    )
  ),
  actor_type public.audit_actor_type not null,
  actor_id uuid,
  query_text text check (query_text is null or char_length(query_text) <= 500),
  retrieval_mode text not null check (retrieval_mode in ('hybrid', 'lexical')),
  degraded_reason text check (
    degraded_reason is null
    or degraded_reason in (
      'EMBEDDING_UNAVAILABLE',
      'EMBEDDING_TIMEOUT',
      'EMBEDDING_NOT_CONFIGURED'
    )
  ),
  requested_types text[] not null default '{}'::text[] check (
    array_position(requested_types, null) is null and cardinality(requested_types) <= 8
  ),
  sensitivity_allowance text not null check (
    sensitivity_allowance in ('public', 'internal', 'confidential', 'customer_content')
  ),
  denied boolean not null default false,
  result_item_ids uuid[] not null default '{}'::uuid[] check (
    array_position(result_item_ids, null) is null and cardinality(result_item_ids) <= 50
  ),
  result_count integer not null default 0 check (result_count >= 0),
  served_from_cache boolean not null default false,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index memory_retrieval_log_organization_created_idx
  on public.memory_retrieval_log (organization_id, created_at desc);
create index memory_retrieval_log_organization_purpose_idx
  on public.memory_retrieval_log (organization_id, purpose, created_at desc);

-- Derivation and integrity triggers ----------------------------------------

create trigger memory_items_set_updated_at
before update on public.memory_items
for each row execute function public.set_updated_at();

-- The source tier stored here is the time-independent part of the precedence
-- rank in specs/004-business-memory.md section 6.3. The historical demotion of
-- provider data past its review date depends on wall-clock time, so it cannot
-- be stored without going stale; retrieval applies it at query time. The
-- branch order mirrors src/domain/memory/trust.ts exactly, minus that branch.
create or replace function private.set_memory_source_tier()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.source_tier := case
    when new.verification_state = 'verified' then 1
    when new.origin in ('ai_proposed', 'outcome_learned') then 5
    when new.origin = 'user_verified' then 1
    when new.memory_type = 'document' then 3
    else 2
  end;
  return new;
end;
$$;

revoke all on function private.set_memory_source_tier() from public;

create trigger memory_items_set_source_tier
before insert or update on public.memory_items
for each row execute function private.set_memory_source_tier();

create or replace function private.prevent_memory_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.memory_type is distinct from old.memory_type
    or new.origin is distinct from old.origin
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'memory_identity_is_immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_memory_identity_change() from public;

create trigger memory_items_prevent_identity_change
before update on public.memory_items
for each row execute function private.prevent_memory_identity_change();

-- Supersession must stay an acyclic chain: a cycle would make "excluded by
-- default" unresolvable and could hide every item in the loop.
create or replace function private.prevent_memory_supersession_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cursor_id uuid := new.superseded_by_id;
  hops integer := 0;
begin
  if cursor_id is null then
    return new;
  end if;

  while cursor_id is not null loop
    hops := hops + 1;
    if cursor_id = new.id then
      raise exception 'memory_supersession_cycle' using errcode = '23514';
    end if;
    if hops > 32 then
      raise exception 'memory_supersession_depth_exceeded' using errcode = '23514';
    end if;
    select item.superseded_by_id into cursor_id
    from public.memory_items item
    where item.id = cursor_id;
  end loop;

  return new;
end;
$$;

revoke all on function private.prevent_memory_supersession_cycle() from public;

create constraint trigger memory_items_prevent_supersession_cycle
after insert or update of superseded_by_id on public.memory_items
deferrable initially immediate
for each row execute function private.prevent_memory_supersession_cycle();

-- Audit -------------------------------------------------------------------

-- Extends the shared audit trigger with memory event names and derives the
-- actor type instead of always claiming 'user': background workers run without
-- an `auth.uid()`, and recording them as a user would misattribute the change.
create or replace function private.audit_organization_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_row jsonb := '{}'::jsonb;
  old_row jsonb := '{}'::jsonb;
  target_organization_id uuid;
  target_entity_id uuid;
  target_event_name text;
  target_status text;
  target_actor_id uuid;
  target_actor_type public.audit_actor_type;
begin
  if TG_OP <> 'DELETE' then
    new_row := pg_catalog.to_jsonb(new);
  end if;
  if TG_OP <> 'INSERT' then
    old_row := pg_catalog.to_jsonb(old);
  end if;

  target_organization_id := coalesce(
    (new_row ->> 'organization_id')::uuid,
    (old_row ->> 'organization_id')::uuid,
    (new_row ->> 'id')::uuid,
    (old_row ->> 'id')::uuid
  );
  target_entity_id := coalesce(
    (new_row ->> 'id')::uuid,
    (old_row ->> 'id')::uuid,
    target_organization_id
  );
  target_event_name := case
    when TG_TABLE_NAME = 'organizations' and TG_OP = 'INSERT' then 'organization.created'
    when TG_TABLE_NAME = 'branches' and TG_OP = 'INSERT' then 'branch.created'
    when TG_TABLE_NAME = 'business_profiles' then 'business_profile.updated'
    when TG_TABLE_NAME = 'business_facts' and new_row ->> 'status' = 'verified' then 'business_fact.verified'
    when TG_TABLE_NAME = 'business_facts' then 'business_fact.updated'
    when TG_TABLE_NAME = 'goals' and TG_OP = 'INSERT' then 'goal.created'
    when TG_TABLE_NAME = 'constraints' and TG_OP = 'INSERT' then 'constraint.created'
    when TG_TABLE_NAME = 'policies' then 'policy.updated'
    when TG_TABLE_NAME = 'memory_items' and TG_OP = 'INSERT' then 'memory.item_created'
    when TG_TABLE_NAME = 'memory_items'
      and new_row ->> 'superseded_by_id' is not null
      and old_row ->> 'superseded_by_id' is null then 'memory.item_superseded'
    when TG_TABLE_NAME = 'memory_items'
      and new_row ->> 'verification_state' = 'verified'
      and old_row ->> 'verification_state' is distinct from 'verified' then 'memory.item_verified'
    when TG_TABLE_NAME = 'memory_items'
      and new_row ->> 'verification_state' = 'rejected'
      and old_row ->> 'verification_state' is distinct from 'rejected' then 'memory.item_rejected'
    when TG_TABLE_NAME = 'memory_items' then 'memory.item_updated'
    else pg_catalog.lower(TG_TABLE_NAME || '.' || TG_OP)
  end;
  target_status := coalesce(
    new_row ->> 'status',
    old_row ->> 'status',
    new_row ->> 'verification_state',
    old_row ->> 'verification_state'
  );
  target_actor_id := (select auth.uid());
  target_actor_type := case when target_actor_id is null then 'system' else 'user' end;

  insert into public.audit_events (
    organization_id,
    event_name,
    actor_type,
    actor_id,
    entity_type,
    entity_id,
    payload
  )
  values (
    target_organization_id,
    target_event_name,
    target_actor_type,
    target_actor_id,
    TG_TABLE_NAME,
    target_entity_id,
    pg_catalog.jsonb_build_object('operation', TG_OP, 'status', target_status)
  );

  return new;
end;
$$;

revoke all on function private.audit_organization_change() from public;

create trigger memory_items_audit
after insert or update on public.memory_items
for each row execute function private.audit_organization_change();

-- Row level security -------------------------------------------------------

alter table public.memory_items enable row level security;
alter table public.memory_items force row level security;
alter table public.memory_links enable row level security;
alter table public.memory_links force row level security;
alter table public.memory_retrieval_log enable row level security;
alter table public.memory_retrieval_log force row level security;

-- The sensitivity boundary lives here, not only in the application service, so
-- an operator cannot reach confidential or customer content through any query
-- path. Acceptance criterion 4.
create policy "members read memory within their sensitivity ceiling"
on public.memory_items for select to authenticated
using (
  private.is_organization_member(organization_id)
  and (
    sensitivity in ('public', 'internal')
    or private.has_organization_role(
      organization_id,
      array['owner', 'admin']::public.organization_role[]
    )
  )
);

-- A browser-authenticated caller may only create direct user input. Provider,
-- system, and model write paths run through validated workers and functions.
create policy "operators create user-authored memory"
on public.memory_items for insert to authenticated
with check (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
  and created_by = (select auth.uid())
  and origin = 'user_verified'
  and memory_type in ('note', 'document')
  and verification_state in ('unverified', 'verified')
);

create policy "operators update memory items"
on public.memory_items for update to authenticated
using (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
)
with check (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);

create policy "members read memory links"
on public.memory_links for select to authenticated
using (private.is_organization_member(organization_id));

create policy "operators create memory links"
on public.memory_links for insert to authenticated
with check (
  private.has_organization_role(
    organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
  and created_by = (select auth.uid())
);

create policy "members read their retrieval log"
on public.memory_retrieval_log for select to authenticated
using (private.is_organization_member(organization_id));

create policy "members append to their retrieval log"
on public.memory_retrieval_log for insert to authenticated
with check (private.is_organization_member(organization_id));

-- Grants -------------------------------------------------------------------

revoke all privileges on table public.memory_items from anon, authenticated;
revoke all privileges on table public.memory_links from anon, authenticated;
revoke all privileges on table public.memory_retrieval_log from anon, authenticated;

-- `embedding` and `search_vector` are deliberately excluded: they are large,
-- useless to a client, and the vector is derived content.
grant select (
  id,
  organization_id,
  branch_id,
  memory_type,
  title,
  body,
  structured_value,
  origin,
  source_tier,
  source_system,
  source_reference,
  source_run_id,
  source_record_id,
  verification_state,
  confidence,
  sensitivity,
  observed_at,
  effective_from,
  effective_to,
  review_due_at,
  expires_at,
  superseded_by_id,
  superseded_at,
  supersession_reason,
  rejection_reason,
  proposed_fact_key,
  proposed_fact_value,
  proposed_branch_id,
  embedding_model,
  embedding_status,
  embedding_updated_at,
  created_by,
  verified_by,
  verified_at,
  created_at,
  updated_at
) on table public.memory_items to authenticated;

-- `source_tier` carries no grant: private.set_memory_source_tier() owns it.
grant insert (
  organization_id,
  branch_id,
  memory_type,
  title,
  body,
  structured_value,
  origin,
  sensitivity,
  verification_state,
  confidence,
  observed_at,
  effective_from,
  effective_to,
  review_due_at,
  expires_at,
  created_by,
  verified_by,
  verified_at
) on table public.memory_items to authenticated;

grant update (
  title,
  body,
  structured_value,
  sensitivity,
  verification_state,
  confidence,
  observed_at,
  effective_from,
  effective_to,
  review_due_at,
  expires_at,
  superseded_by_id,
  superseded_at,
  supersession_reason,
  rejection_reason,
  verified_by,
  verified_at
) on table public.memory_items to authenticated;

grant select on table public.memory_links to authenticated;
grant insert (
  organization_id,
  from_item_id,
  to_item_id,
  relation,
  created_by
) on table public.memory_links to authenticated;

grant select on table public.memory_retrieval_log to authenticated;
grant insert (
  organization_id,
  purpose,
  actor_type,
  actor_id,
  query_text,
  retrieval_mode,
  degraded_reason,
  requested_types,
  sensitivity_allowance,
  denied,
  result_item_ids,
  result_count,
  served_from_cache,
  latency_ms,
  correlation_id
) on table public.memory_retrieval_log to authenticated;
