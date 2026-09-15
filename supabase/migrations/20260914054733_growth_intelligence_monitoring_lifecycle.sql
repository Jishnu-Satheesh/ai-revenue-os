-- Slice 7: monitoring update lifecycle, keyed create, scope guard, reviews, erasure.
--
-- Durable lifecycle rows for the Market Monitoring research-and-report
-- experience. Slice 3 ran updates in run-local stores, so cross-run
-- refresh-after-cancel rejoined dead updates, failure stayed invisible, and
-- duplicate-project races could fork paid work. This migration adds the
-- durable substrate with the same bar as Slice 2 (org-scoped tables with
-- composite tenant foreign keys, explicit least-privilege grants, forced
-- RLS, fixed-search_path RPCs) and alters no existing table:
--
-- 1. growth_intelligence_monitoring_updates is one row per background update
--    attempt: update id, project FK, brief-revision pin, stage (queued,
--    researching, preparing_insights, ready, partial, empty, no_findings,
--    research_failed, synthesis_failed, cancelled), safe reason code,
--    retryable flag, coverage JSON, cost ledger refs, lease/fencing token,
--    attempts and timestamps. Terminal rows never leave their terminal
--    stage; identity columns never change; deletes are forbidden.
-- 2. growth_intelligence_project_create_keys binds an idempotency key to the
--    project it created plus a digest of the creation body: the same key
--    with the same body replays the kept project, the same key with a
--    different body is a conflict.
-- 3. growth_intelligence_monitoring_active_scopes holds one live scope
--    fingerprint per organization, so two near-simultaneous identical
--    starts converge on one project instead of minting twins. Archived
--    projects release their fingerprint on the next claim.
-- 4. growth_intelligence_report_reviews records explicit item-less reviews
--    per report version: one reviewer row, idempotent on replay.
--
-- Seven fenced RPCs (fixed search_path, explicit grants, tenant checks
-- inside, advisory locks for races): open_monitoring_update,
-- advance_monitoring_update_stage, settle_monitoring_update,
-- create_research_project_keyed, release_monitoring_active_scope,
-- mark_report_reviewed, erase_monitoring_update_extracts (service_role
-- only, consistent with the Spec 022 section 6.5 privileged erasure path:
-- identifiers and ledger totals stay, extract-derived coverage goes).

-- Coverage validator ------------------------------------------------------------
--
-- Mirrors monitoringCoverageEntrySchema key-for-key: each requested
-- dimension (investigation area or named competitor) reports exactly one
-- honest status. A research failure backfills every requested dimension as
-- unavailable through this same shape instead of settling an empty list.

create function private.assert_monitoring_update_coverage(
  p_coverage jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  coverage_entry jsonb;
begin
  if p_coverage is null
    or pg_catalog.jsonb_typeof(p_coverage) <> 'array'
    or pg_catalog.jsonb_array_length(p_coverage) not between 1 and 50 then
    raise exception 'monitoring_update_coverage_invalid' using errcode = '22023';
  end if;
  for coverage_entry in
    select value from pg_catalog.jsonb_array_elements(p_coverage)
  loop
    if not private.jsonb_object_has_exact_keys(
        coverage_entry,
        array['dimensionKind', 'dimensionKey', 'label', 'status']::text[]
      )
      or coverage_entry ->> 'dimensionKind' not in ('investigation_area', 'competitor')
      or pg_catalog.jsonb_typeof(coverage_entry -> 'dimensionKey') <> 'string'
      or coverage_entry ->> 'dimensionKey'
        is distinct from pg_catalog.btrim(coverage_entry ->> 'dimensionKey')
      or pg_catalog.char_length(coalesce(coverage_entry ->> 'dimensionKey', ''))
        not between 1 and 160
      or pg_catalog.jsonb_typeof(coverage_entry -> 'label') <> 'string'
      or coverage_entry ->> 'label'
        is distinct from pg_catalog.btrim(coverage_entry ->> 'label')
      or pg_catalog.char_length(coalesce(coverage_entry ->> 'label', ''))
        not between 1 and 240
      or coverage_entry ->> 'status' not in (
        'supported', 'unavailable', 'not-found', 'not-researched'
      ) then
      raise exception 'monitoring_update_coverage_invalid' using errcode = '22023';
    end if;
  end loop;
end;
$$;

revoke all on function private.assert_monitoring_update_coverage(jsonb)
  from public, anon, authenticated, service_role;

-- Tables ----------------------------------------------------------------------

create table public.growth_intelligence_monitoring_updates (
  update_id uuid primary key,
  organization_id uuid not null,
  project_id uuid not null,
  brief_revision_id uuid,
  stage text not null default 'queued'
    check (stage in (
      'queued', 'researching', 'preparing_insights',
      'ready', 'partial', 'empty', 'no_findings',
      'research_failed', 'synthesis_failed', 'cancelled'
    )),
  reason_code text
    check (reason_code is null or reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  retryable boolean not null default false,
  coverage jsonb,
  known_cost_micros_usd bigint not null default 0 check (known_cost_micros_usd >= 0),
  unknown_cost_count integer not null default 0 check (unknown_cost_count >= 0),
  cost_ledger_ref text,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  extracts_erased_at timestamptz,
  erasure_reason_code text
    check (erasure_reason_code is null or erasure_reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, update_id),
  foreign key (organization_id, project_id)
    references public.growth_intelligence_research_projects(organization_id, id)
    on delete restrict,
  foreign key (organization_id, brief_revision_id)
    references public.growth_intelligence_brief_revisions(organization_id, id)
    on delete restrict
);

comment on table public.growth_intelligence_monitoring_updates is
  'One durable row per Market Monitoring background update: stage, safe failure reason, retry flag, coverage, cost refs, lease token and attempts. Terminal rows never leave their terminal stage.';

create table public.growth_intelligence_project_create_keys (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null,
  idempotency_key text not null,
  project_id uuid not null,
  body_digest text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, project_id)
    references public.growth_intelligence_research_projects(organization_id, id)
    on delete restrict,
  check (
    idempotency_key = pg_catalog.btrim(idempotency_key)
    and pg_catalog.char_length(idempotency_key) between 1 and 200
  ),
  check (body_digest ~ '^[0-9a-f]{32}$')
);

comment on table public.growth_intelligence_project_create_keys is
  'Idempotency keys for research project creation: same key plus same body replays the kept project, same key with another body is a conflict.';

create table public.growth_intelligence_monitoring_active_scopes (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null,
  scope_fingerprint text not null,
  project_id uuid not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, scope_fingerprint),
  foreign key (organization_id, project_id)
    references public.growth_intelligence_research_projects(organization_id, id)
    on delete restrict,
  check (scope_fingerprint ~ '^[0-9a-f]{64}$')
);

comment on table public.growth_intelligence_monitoring_active_scopes is
  'One live scope fingerprint per organization: identical concurrent starts converge on the kept project instead of minting twins.';

create table public.growth_intelligence_report_reviews (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null,
  report_version_id uuid not null,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, report_version_id),
  foreign key (organization_id, report_version_id)
    references public.growth_intelligence_reports(organization_id, report_version_id)
    on delete restrict
);

comment on table public.growth_intelligence_report_reviews is
  'Explicit item-less report reviews: one reviewer row per report version, idempotent on replay.';

-- Mutation guards ---------------------------------------------------------------
--
-- Lifecycle rows progress but never rewrite history: identity columns stay
-- frozen, terminal stages never move (not even to another terminal stage,
-- so a retry mints a new update instead of editing the failed one), and
-- deletes are forbidden. Coverage shape is validated on every write that
-- carries it. Key, scope and review rows are append-only except for the two
-- governed releases below (stale scope reclaim inside the keyed create,
-- explicit scope release on archive): ordinary sessions hold no write grant
-- at all, so direct DML fails before any trigger runs.

create function private.enforce_monitoring_update_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'growth_intelligence_monitoring_update_delete_forbidden' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if new.update_id is distinct from old.update_id
      or new.organization_id is distinct from old.organization_id
      or new.project_id is distinct from old.project_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'growth_intelligence_monitoring_update_identity_immutable' using errcode = '55000';
    end if;
    if old.stage in (
        'ready', 'partial', 'empty', 'no_findings',
        'research_failed', 'synthesis_failed', 'cancelled'
      )
      and new.stage is distinct from old.stage then
      raise exception 'growth_intelligence_monitoring_update_terminal' using errcode = '55000';
    end if;
  end if;
  if new.coverage is not null then
    perform private.assert_monitoring_update_coverage(new.coverage);
  end if;
  if new.reason_code is not null
    and new.reason_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception 'monitoring_update_reason_invalid' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_monitoring_update_mutation()
  from public, anon, authenticated, service_role;

create trigger growth_intelligence_monitoring_updates_set_updated_at
before update on public.growth_intelligence_monitoring_updates
for each row execute function public.set_updated_at();
create trigger growth_intelligence_monitoring_updates_enforce_mutation
before insert or update or delete on public.growth_intelligence_monitoring_updates
for each row execute function private.enforce_monitoring_update_mutation();

create trigger growth_intelligence_project_create_keys_append_only
before update or delete on public.growth_intelligence_project_create_keys
for each row execute function private.reject_growth_intelligence_append_only_mutation();

create trigger growth_intelligence_monitoring_active_scopes_append_only
before update or delete on public.growth_intelligence_monitoring_active_scopes
for each row execute function private.reject_growth_intelligence_append_only_mutation();

create trigger growth_intelligence_report_reviews_append_only
before update or delete on public.growth_intelligence_report_reviews
for each row execute function private.reject_growth_intelligence_append_only_mutation();

-- Tenant-leading and bounded-read indexes ---------------------------------------

create index growth_intelligence_monitoring_updates_project_history_idx
  on public.growth_intelligence_monitoring_updates
  (organization_id, project_id, created_at desc, update_id desc);

create index growth_intelligence_monitoring_updates_active_idx
  on public.growth_intelligence_monitoring_updates
  (organization_id, updated_at desc, update_id desc)
  where stage in ('queued', 'researching', 'preparing_insights');

create index growth_intelligence_monitoring_updates_brief_revision_idx
  on public.growth_intelligence_monitoring_updates (organization_id, brief_revision_id);

create index growth_intelligence_project_create_keys_project_idx
  on public.growth_intelligence_project_create_keys (organization_id, project_id);

create index growth_intelligence_monitoring_active_scopes_project_idx
  on public.growth_intelligence_monitoring_active_scopes (organization_id, project_id);

create index growth_intelligence_report_reviews_report_idx
  on public.growth_intelligence_report_reviews (organization_id, report_version_id);

-- RLS and least-privilege table access -------------------------------------------

alter table public.growth_intelligence_monitoring_updates enable row level security;
alter table public.growth_intelligence_monitoring_updates force row level security;
alter table public.growth_intelligence_project_create_keys enable row level security;
alter table public.growth_intelligence_project_create_keys force row level security;
alter table public.growth_intelligence_monitoring_active_scopes enable row level security;
alter table public.growth_intelligence_monitoring_active_scopes force row level security;
alter table public.growth_intelligence_report_reviews enable row level security;
alter table public.growth_intelligence_report_reviews force row level security;

create policy "members with Growth Intelligence read monitoring updates"
on public.growth_intelligence_monitoring_updates
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read project create keys"
on public.growth_intelligence_project_create_keys
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read monitoring scopes"
on public.growth_intelligence_monitoring_active_scopes
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read report reviews"
on public.growth_intelligence_report_reviews
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

revoke all on table public.growth_intelligence_monitoring_updates from public, anon, authenticated, service_role;
revoke all on table public.growth_intelligence_project_create_keys from public, anon, authenticated, service_role;
revoke all on table public.growth_intelligence_monitoring_active_scopes from public, anon, authenticated, service_role;
revoke all on table public.growth_intelligence_report_reviews from public, anon, authenticated, service_role;

grant select on table public.growth_intelligence_monitoring_updates to authenticated;
grant select on table public.growth_intelligence_project_create_keys to authenticated;
grant select on table public.growth_intelligence_monitoring_active_scopes to authenticated;
grant select on table public.growth_intelligence_report_reviews to authenticated;
grant select on table public.growth_intelligence_monitoring_updates to service_role;
grant select on table public.growth_intelligence_project_create_keys to service_role;
grant select on table public.growth_intelligence_monitoring_active_scopes to service_role;
grant select on table public.growth_intelligence_report_reviews to service_role;

-- Fenced RPCs ---------------------------------------------------------------------

create function public.open_monitoring_update(
  p_organization_id uuid,
  p_actor_id uuid,
  p_project_id uuid,
  p_update_id uuid,
  p_brief_revision_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.growth_intelligence_monitoring_updates;
  adopted public.growth_intelligence_monitoring_updates;
  lease_until timestamptz;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'monitoring_update_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_project_id is null
    or p_update_id is null
    or p_lease_token is null
    or p_lease_seconds is null
    or p_lease_seconds not between 60 and 3600 then
    raise exception 'monitoring_update_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.growth_intelligence_research_projects project
    where project.organization_id = p_organization_id
      and project.id = p_project_id
  ) then
    raise exception 'research_project_not_found' using errcode = '42501';
  end if;
  if p_brief_revision_id is not null
    and not exists (
      select 1 from public.growth_intelligence_brief_revisions revision
      where revision.organization_id = p_organization_id
        and revision.id = p_brief_revision_id
        and revision.project_id = p_project_id
    ) then
    raise exception 'brief_revision_not_found' using errcode = '42501';
  end if;

  -- One serialized reservation per update: redeliveries converge instead of
  -- forking the lifecycle row. The transaction holds the lock only for this
  -- short reserve; research itself runs outside any lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'monitoring_update',
      p_organization_id, p_update_id
    ),
    0
  ));

  lease_until := pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds);

  select update_row.* into existing
  from public.growth_intelligence_monitoring_updates update_row
  where update_row.organization_id = p_organization_id
    and update_row.update_id = p_update_id
  for update;
  if found then
    -- A settled update never reopens: a refresh after cancel or failure
    -- mints a new update instead of editing the terminal row.
    if existing.stage in (
      'ready', 'partial', 'empty', 'no_findings',
      'research_failed', 'synthesis_failed', 'cancelled'
    ) then
      raise exception 'monitoring_update_terminal' using errcode = '55000';
    end if;
    -- Same token is a heartbeat: the lease extends, attempts stay put.
    if existing.lease_token is not distinct from p_lease_token then
      update public.growth_intelligence_monitoring_updates update_row
      set lease_expires_at = lease_until,
        brief_revision_id = coalesce(p_brief_revision_id, update_row.brief_revision_id)
      where update_row.organization_id = p_organization_id
        and update_row.update_id = p_update_id
      returning * into adopted;
      return pg_catalog.jsonb_build_object(
        'updateId', adopted.update_id,
        'stage', adopted.stage,
        'attempts', adopted.attempts,
        'replayed', true
      );
    end if;
    -- A live lease fences out rival tokens: only an expired lease may be
    -- adopted, so two workers can never both believe they own the update.
    if existing.lease_expires_at is not null
      and existing.lease_expires_at > pg_catalog.now() then
      raise exception 'monitoring_update_fenced' using errcode = '55000';
    end if;
    update public.growth_intelligence_monitoring_updates update_row
    set lease_token = p_lease_token,
      lease_expires_at = lease_until,
      brief_revision_id = coalesce(p_brief_revision_id, update_row.brief_revision_id),
      attempts = update_row.attempts + 1
    where update_row.organization_id = p_organization_id
      and update_row.update_id = p_update_id
    returning * into adopted;
    return pg_catalog.jsonb_build_object(
      'updateId', adopted.update_id,
      'stage', adopted.stage,
      'attempts', adopted.attempts,
      'replayed', true
    );
  end if;

  insert into public.growth_intelligence_monitoring_updates (
    update_id, organization_id, project_id, brief_revision_id,
    stage, lease_token, lease_expires_at, attempts, created_by
  ) values (
    p_update_id, p_organization_id, p_project_id, p_brief_revision_id,
    'queued', p_lease_token, lease_until, 1, p_actor_id
  ) returning * into adopted;

  return pg_catalog.jsonb_build_object(
    'updateId', adopted.update_id,
    'stage', adopted.stage,
    'attempts', adopted.attempts,
    'replayed', false
  );
end;
$$;

revoke all on function public.open_monitoring_update(uuid, uuid, uuid, uuid, uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.open_monitoring_update(uuid, uuid, uuid, uuid, uuid, uuid, integer)
  to authenticated, service_role;

create function public.advance_monitoring_update_stage(
  p_organization_id uuid,
  p_actor_id uuid,
  p_update_id uuid,
  p_stage text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.growth_intelligence_monitoring_updates;
  advanced public.growth_intelligence_monitoring_updates;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'monitoring_update_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_update_id is null
    or p_stage not in ('queued', 'researching', 'preparing_insights')
    or p_lease_token is null then
    raise exception 'monitoring_update_invalid' using errcode = '22023';
  end if;

  -- Short fenced heartbeat: the caller proves the lease token, the row
  -- proves the lease is still live. Research runs outside this lock; only
  -- the stage write happens inside it.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'monitoring_update',
      p_organization_id, p_update_id
    ),
    0
  ));

  select update_row.* into existing
  from public.growth_intelligence_monitoring_updates update_row
  where update_row.organization_id = p_organization_id
    and update_row.update_id = p_update_id
  for update;
  if not found then
    raise exception 'monitoring_update_not_found' using errcode = '42501';
  end if;
  if existing.stage in (
    'ready', 'partial', 'empty', 'no_findings',
    'research_failed', 'synthesis_failed', 'cancelled'
  ) then
    raise exception 'monitoring_update_terminal' using errcode = '55000';
  end if;
  if existing.lease_token is distinct from p_lease_token then
    raise exception 'monitoring_update_fenced' using errcode = '55000';
  end if;
  if existing.lease_expires_at is not null
    and existing.lease_expires_at <= pg_catalog.now() then
    raise exception 'monitoring_update_lease_expired' using errcode = '55000';
  end if;

  update public.growth_intelligence_monitoring_updates update_row
  set stage = p_stage
  where update_row.organization_id = p_organization_id
    and update_row.update_id = p_update_id
  returning * into advanced;

  return pg_catalog.jsonb_build_object(
    'updateId', advanced.update_id,
    'stage', advanced.stage,
    'replayed', false
  );
end;
$$;

revoke all on function public.advance_monitoring_update_stage(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.advance_monitoring_update_stage(uuid, uuid, uuid, text, uuid)
  to authenticated, service_role;

create function public.settle_monitoring_update(
  p_organization_id uuid,
  p_actor_id uuid,
  p_update_id uuid,
  p_stage text,
  p_reason_code text,
  p_retryable boolean,
  p_coverage jsonb,
  p_known_cost_micros_usd bigint,
  p_unknown_cost_count integer,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.growth_intelligence_monitoring_updates;
  settled public.growth_intelligence_monitoring_updates;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'monitoring_update_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_update_id is null
    or p_stage not in (
      'ready', 'partial', 'empty', 'no_findings',
      'research_failed', 'synthesis_failed', 'cancelled'
    )
    or p_lease_token is null
    or p_known_cost_micros_usd is null
    or p_known_cost_micros_usd < 0
    or p_unknown_cost_count is null
    or p_unknown_cost_count < 0 then
    raise exception 'monitoring_update_invalid' using errcode = '22023';
  end if;
  -- A failed update always names its safe reason: the running view reads
  -- failed rows as failed with a retry control, never as silent research.
  if p_stage in ('research_failed', 'synthesis_failed')
    and (p_reason_code is null or p_reason_code !~ '^[A-Z][A-Z0-9_]{1,63}$') then
    raise exception 'monitoring_update_reason_invalid' using errcode = '22023';
  end if;
  if p_reason_code is not null
    and p_reason_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception 'monitoring_update_reason_invalid' using errcode = '22023';
  end if;
  if p_coverage is not null then
    perform private.assert_monitoring_update_coverage(p_coverage);
  end if;

  -- Short fenced settle: token ownership is the fence (an expired lease
  -- still settles for its owner; expiry only gates rival adoption in
  -- open_monitoring_update). External research completed before this call,
  -- never inside it.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'monitoring_update',
      p_organization_id, p_update_id
    ),
    0
  ));

  select update_row.* into existing
  from public.growth_intelligence_monitoring_updates update_row
  where update_row.organization_id = p_organization_id
    and update_row.update_id = p_update_id
  for update;
  if not found then
    raise exception 'monitoring_update_not_found' using errcode = '42501';
  end if;
  if existing.lease_token is distinct from p_lease_token then
    raise exception 'monitoring_update_fenced' using errcode = '55000';
  end if;
  if existing.stage in (
    'ready', 'partial', 'empty', 'no_findings',
    'research_failed', 'synthesis_failed', 'cancelled'
  ) then
    -- Redelivered settles converge: the same terminal stage replays, a
    -- different one is a conflict, never a silent rewrite.
    if existing.stage is distinct from p_stage then
      raise exception 'monitoring_update_terminal' using errcode = '55000';
    end if;
    return pg_catalog.jsonb_build_object(
      'updateId', existing.update_id,
      'stage', existing.stage,
      'replayed', true
    );
  end if;

  update public.growth_intelligence_monitoring_updates update_row
  set stage = p_stage,
    reason_code = p_reason_code,
    retryable = coalesce(p_retryable, false),
    coverage = p_coverage,
    known_cost_micros_usd = p_known_cost_micros_usd,
    unknown_cost_count = p_unknown_cost_count
  where update_row.organization_id = p_organization_id
    and update_row.update_id = p_update_id
  returning * into settled;

  return pg_catalog.jsonb_build_object(
    'updateId', settled.update_id,
    'stage', settled.stage,
    'replayed', false
  );
end;
$$;

revoke all on function public.settle_monitoring_update(uuid, uuid, uuid, text, text, boolean, jsonb, bigint, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.settle_monitoring_update(uuid, uuid, uuid, text, text, boolean, jsonb, bigint, integer, uuid)
  to authenticated, service_role;

-- Privileged cancel without the lease token. Trigger's on-cancel hook runs
-- outside the run that holds the token, so it cannot pass fencing; this
-- RPC cancels only non-terminal rows, and a row the worker already settled
-- refuses with a terminal conflict instead of being rewritten.
create function public.cancel_monitoring_update(
  p_organization_id uuid,
  p_actor_id uuid,
  p_update_id uuid,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.growth_intelligence_monitoring_updates;
  cancelled public.growth_intelligence_monitoring_updates;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'monitoring_update_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_update_id is null
    or p_reason_code is null
    or p_reason_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception 'monitoring_update_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'monitoring_update',
      p_organization_id, p_update_id
    ),
    0
  ));

  select update_row.* into existing
  from public.growth_intelligence_monitoring_updates update_row
  where update_row.organization_id = p_organization_id
    and update_row.update_id = p_update_id
  for update;
  if not found then
    raise exception 'monitoring_update_not_found' using errcode = '42501';
  end if;
  if existing.stage in (
    'ready', 'partial', 'empty', 'no_findings',
    'research_failed', 'synthesis_failed', 'cancelled'
  ) then
    raise exception 'monitoring_update_terminal' using errcode = '55000';
  end if;

  update public.growth_intelligence_monitoring_updates update_row
  set stage = 'cancelled',
    reason_code = p_reason_code,
    retryable = false
  where update_row.organization_id = p_organization_id
    and update_row.update_id = p_update_id
  returning * into cancelled;

  return pg_catalog.jsonb_build_object(
    'updateId', cancelled.update_id,
    'stage', cancelled.stage,
    'replayed', false
  );
end;
$$;

revoke all on function public.cancel_monitoring_update(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_monitoring_update(uuid, uuid, uuid, text)
  to authenticated, service_role;

create function public.create_research_project_keyed(
  p_organization_id uuid,
  p_actor_id uuid,
  p_branch_id uuid,
  p_title text,
  p_question text,
  p_mode text,
  p_schedule jsonb,
  p_idempotency_key text,
  p_scope_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  key_row public.growth_intelligence_project_create_keys;
  kept public.growth_intelligence_research_projects;
  scope_row public.growth_intelligence_monitoring_active_scopes;
  scope_project public.growth_intelligence_research_projects;
  created public.growth_intelligence_research_projects;
  body_digest text;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'research_project_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_branch_id is null
    or p_title is null
    or p_question is null
    or p_mode not in ('one-time', 'recurring')
    or (p_mode = 'recurring') <> (p_schedule is not null)
    or p_idempotency_key is null
    or p_idempotency_key is distinct from pg_catalog.btrim(p_idempotency_key)
    or pg_catalog.char_length(p_idempotency_key) not between 1 and 200
    or (p_scope_fingerprint is not null and p_scope_fingerprint !~ '^[0-9a-f]{64}$') then
    raise exception 'research_project_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.branches branch
    where branch.organization_id = p_organization_id
      and branch.id = p_branch_id
  ) then
    raise exception 'research_project_scope_not_found' using errcode = '42501';
  end if;

  if p_mode = 'recurring' then
    perform private.assert_research_project_schedule(p_schedule);
  end if;

  -- The digest pins the creation body to the key: same key plus same body
  -- replays, same key plus another body is a conflict.
  body_digest := pg_catalog.md5(pg_catalog.concat_ws(
    '|', p_organization_id::text, p_branch_id::text,
    p_title, p_question, p_mode, coalesce(p_schedule::text, '')
  ));

  -- One serialized create per key, so twin requests converge instead of
  -- minting twin projects.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'create_research_project_keyed',
      p_organization_id, p_idempotency_key
    ),
    0
  ));

  select key_entry.* into key_row
  from public.growth_intelligence_project_create_keys key_entry
  where key_entry.organization_id = p_organization_id
    and key_entry.idempotency_key = p_idempotency_key
  for update;
  if found then
    if key_row.body_digest is distinct from body_digest then
      raise exception 'research_project_key_conflict' using errcode = '23505';
    end if;
    select project.* into kept
    from public.growth_intelligence_research_projects project
    where project.organization_id = p_organization_id
      and project.id = key_row.project_id;
    return pg_catalog.jsonb_build_object(
      'projectId', kept.id,
      'lifecycle', kept.lifecycle,
      'replayed', true
    );
  end if;

  -- One serialized claim per scope fingerprint: the second of two
  -- near-simultaneous identical starts converges on the first project
  -- instead of forking paid work. An archived keeper releases its
  -- fingerprint so the scope can be researched again.
  if p_scope_fingerprint is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      pg_catalog.concat_ws(
        '|', 'growth_intelligence', 'monitoring_active_scope',
        p_organization_id, p_scope_fingerprint
      ),
      0
    ));

    select scope_entry.* into scope_row
    from public.growth_intelligence_monitoring_active_scopes scope_entry
    where scope_entry.organization_id = p_organization_id
      and scope_entry.scope_fingerprint = p_scope_fingerprint
    for update;
    if found then
      select project.* into scope_project
      from public.growth_intelligence_research_projects project
      where project.organization_id = p_organization_id
        and project.id = scope_row.project_id;
      if found and scope_project.lifecycle is distinct from 'archived' then
        insert into public.growth_intelligence_project_create_keys (
          organization_id, idempotency_key, project_id, body_digest, created_by
        ) values (
          p_organization_id, p_idempotency_key, scope_project.id, body_digest, p_actor_id
        );
        return pg_catalog.jsonb_build_object(
          'projectId', scope_project.id,
          'lifecycle', scope_project.lifecycle,
          'replayed', true,
          'converged', true
        );
      end if;
      delete from public.growth_intelligence_monitoring_active_scopes scope_entry
      where scope_entry.organization_id = p_organization_id
        and scope_entry.scope_fingerprint = p_scope_fingerprint;
    end if;
  end if;

  insert into public.growth_intelligence_research_projects (
    organization_id, branch_id, title, question, mode, schedule, created_by
  ) values (
    p_organization_id, p_branch_id, p_title, p_question, p_mode, p_schedule, p_actor_id
  ) returning * into created;

  insert into public.growth_intelligence_project_create_keys (
    organization_id, idempotency_key, project_id, body_digest, created_by
  ) values (
    p_organization_id, p_idempotency_key, created.id, body_digest, p_actor_id
  );

  if p_scope_fingerprint is not null then
    insert into public.growth_intelligence_monitoring_active_scopes (
      organization_id, scope_fingerprint, project_id, created_by
    ) values (
      p_organization_id, p_scope_fingerprint, created.id, p_actor_id
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'projectId', created.id,
    'lifecycle', created.lifecycle,
    'replayed', false
  );
end;
$$;

revoke all on function public.create_research_project_keyed(uuid, uuid, uuid, text, text, text, jsonb, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_research_project_keyed(uuid, uuid, uuid, text, text, text, jsonb, text, text)
  to authenticated, service_role;

create function public.release_monitoring_active_scope(
  p_organization_id uuid,
  p_actor_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  released integer;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'monitoring_scope_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null or p_project_id is null then
    raise exception 'monitoring_scope_invalid' using errcode = '22023';
  end if;

  delete from public.growth_intelligence_monitoring_active_scopes scope_entry
  where scope_entry.organization_id = p_organization_id
    and scope_entry.project_id = p_project_id;
  get diagnostics released = row_count;

  return pg_catalog.jsonb_build_object('released', released);
end;
$$;

revoke all on function public.release_monitoring_active_scope(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.release_monitoring_active_scope(uuid, uuid, uuid)
  to authenticated, service_role;

create function public.mark_report_reviewed(
  p_organization_id uuid,
  p_actor_id uuid,
  p_report_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  kept public.growth_intelligence_report_reviews;
  inserted public.growth_intelligence_report_reviews;
  remaining integer;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'report_review_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null or p_report_version_id is null then
    raise exception 'report_review_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.growth_intelligence_reports report
    where report.organization_id = p_organization_id
      and report.report_version_id = p_report_version_id
  ) then
    raise exception 'monitoring_report_not_found' using errcode = '42501';
  end if;

  -- Reports that still carry draft items are reviewed item by item, never
  -- marked over the top: the service refuses first, and this RPC refuses
  -- again inside the transaction.
  select pg_catalog.count(*) into remaining
  from public.growth_intelligence_draft_items item
  where item.organization_id = p_organization_id
    and item.report_version_id = p_report_version_id;
  if remaining > 0 then
    raise exception 'report_review_has_items' using errcode = '23505';
  end if;

  -- One serialized review per report version: replays return the kept
  -- reviewer row instead of appending another review.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'mark_report_reviewed',
      p_organization_id, p_report_version_id
    ),
    0
  ));

  insert into public.growth_intelligence_report_reviews (
    organization_id, report_version_id, reviewed_by
  ) values (
    p_organization_id, p_report_version_id, p_actor_id
  )
  on conflict (organization_id, report_version_id) do nothing
  returning * into inserted;

  if found then
    return pg_catalog.jsonb_build_object(
      'reportVersionId', inserted.report_version_id,
      'reviewedBy', inserted.reviewed_by,
      'reviewedAt', inserted.reviewed_at,
      'replayed', false
    );
  end if;

  select review.* into kept
  from public.growth_intelligence_report_reviews review
  where review.organization_id = p_organization_id
    and review.report_version_id = p_report_version_id;
  return pg_catalog.jsonb_build_object(
    'reportVersionId', kept.report_version_id,
    'reviewedBy', kept.reviewed_by,
    'reviewedAt', kept.reviewed_at,
    'replayed', true
  );
end;
$$;

revoke all on function public.mark_report_reviewed(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_report_reviewed(uuid, uuid, uuid)
  to authenticated, service_role;

create function public.erase_monitoring_update_extracts(
  p_organization_id uuid,
  p_update_id uuid,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  erased public.growth_intelligence_monitoring_updates;
begin
  -- Privileged path only, like the Spec 022 section 6.5 excerpt erasure:
  -- browser sessions hold no execute grant and fail before this check.
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'monitoring_erasure_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_update_id is null
    or p_reason_code is null
    or p_reason_code !~ '^[A-Z][A-Z0-9_]{1,63}$' then
    raise exception 'monitoring_erasure_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'monitoring_update',
      p_organization_id, p_update_id
    ),
    0
  ));

  update public.growth_intelligence_monitoring_updates update_row
  set coverage = null,
    cost_ledger_ref = null,
    extracts_erased_at = pg_catalog.now(),
    erasure_reason_code = p_reason_code
  where update_row.organization_id = p_organization_id
    and update_row.update_id = p_update_id
  returning * into erased;
  if not found then
    raise exception 'monitoring_update_not_found' using errcode = '42501';
  end if;

  -- Identifiers, stage, reason and ledger totals stay: erasure removes
  -- extract-derived coverage only, never the audit of what ran.
  return pg_catalog.jsonb_build_object(
    'updateId', erased.update_id,
    'stage', erased.stage,
    'erased', true
  );
end;
$$;

revoke all on function public.erase_monitoring_update_extracts(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.erase_monitoring_update_extracts(uuid, uuid, text)
  to service_role;
