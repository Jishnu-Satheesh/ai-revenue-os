-- Governed synthesis persistence.
--
-- Synthesis runs bind validated items to the request lease that produced
-- them, items carry the Task 12 fingerprints that suppress duplicates, and
-- every link is tenant-composite: there is deliberately no polymorphic
-- evidence identifier, so a Channel Recommendation or Opportunity row can
-- never be stored as a synthesized item copy or linked as its evidence.

create table public.growth_intelligence_synthesis_runs (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  growth_intelligence_request_id uuid not null,
  market_profile_version_id uuid not null,
  claim_token uuid not null,
  provider text not null check (pg_catalog.char_length(provider) between 2 and 100),
  model_version text check (model_version is null or pg_catalog.char_length(model_version) between 1 and 160),
  run_fingerprint text not null check (run_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  result_digest text check (result_digest is null or result_digest ~ '^[a-f0-9]{64}$'),
  item_count integer not null default 0 check (item_count between 0 and 200),
  safe_failure_code text check (safe_failure_code is null or safe_failure_code ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  started_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz,
  failed_at timestamptz,
  correlation_id uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, growth_intelligence_request_id, claim_token),
  foreign key (organization_id, growth_intelligence_request_id)
    references public.growth_intelligence_requests(organization_id, id) on delete restrict,
  foreign key (organization_id, market_profile_version_id)
    references public.organization_market_profile_versions(organization_id, id) on delete restrict,
  check (status <> 'completed' or (completed_at is not null and result_digest is not null)),
  check (status <> 'failed' or (failed_at is not null and safe_failure_code is not null)),
  check ((status = 'running') = (completed_at is null and failed_at is null and safe_failure_code is null))
);

create table public.growth_intelligence_items (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  growth_intelligence_synthesis_run_id uuid not null,
  market_profile_version_id uuid not null,
  kind text not null check (kind in ('insight', 'recommendation', 'data_gap')),
  narrative text not null check (pg_catalog.char_length(narrative) between 1 and 2000),
  item_fingerprint text not null check (item_fingerprint ~ '^[a-f0-9]{64}$'),
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[a-f0-9]{64}$'),
  geographic_layer text not null check (geographic_layer in ('trade_area', 'city', 'country')),
  geography_ref text not null check (pg_catalog.char_length(geography_ref) between 2 and 160),
  support_grade text not null check (support_grade in ('primary', 'corroborated', 'single_source', 'contextual', 'conflicted')),
  freshness text not null check (freshness in ('current', 'stale', 'expired')),
  urgency text not null check (urgency in ('high', 'medium', 'low')),
  goal_alignment text not null check (goal_alignment in ('direct', 'indirect', 'none')),
  activity_month text not null check (activity_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'current' check (status in ('current', 'superseded')),
  superseded_by_item_id uuid,
  missing_input text check (missing_input is null or pg_catalog.char_length(missing_input) between 1 and 160),
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, item_fingerprint),
  foreign key (organization_id, growth_intelligence_synthesis_run_id)
    references public.growth_intelligence_synthesis_runs(organization_id, id) on delete restrict,
  foreign key (organization_id, market_profile_version_id)
    references public.organization_market_profile_versions(organization_id, id) on delete restrict,
  check ((kind = 'data_gap') = (missing_input is not null)),
  check ((status = 'superseded') = (superseded_by_item_id is not null))
);

create table public.growth_intelligence_item_market_claims (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  growth_intelligence_item_id uuid not null,
  market_evidence_claim_id uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (organization_id, growth_intelligence_item_id, market_evidence_claim_id),
  foreign key (organization_id, growth_intelligence_item_id)
    references public.growth_intelligence_items(organization_id, id) on delete restrict,
  foreign key (organization_id, market_evidence_claim_id)
    references public.market_evidence_claims(organization_id, id) on delete restrict
);

create table public.growth_intelligence_item_channel_findings (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  growth_intelligence_item_id uuid not null,
  finding_id uuid not null,
  finding_digest text not null check (finding_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (organization_id, growth_intelligence_item_id, finding_id),
  foreign key (organization_id, growth_intelligence_item_id)
    references public.growth_intelligence_items(organization_id, id) on delete restrict
);

create table public.growth_intelligence_item_goals (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  growth_intelligence_item_id uuid not null,
  goal_ref text not null check (pg_catalog.char_length(goal_ref) between 2 and 160),
  alignment text not null check (alignment in ('direct', 'indirect', 'none')),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (organization_id, growth_intelligence_item_id, goal_ref),
  foreign key (organization_id, growth_intelligence_item_id)
    references public.growth_intelligence_items(organization_id, id) on delete restrict
);

-- Append-only triage history. A decision names the item fingerprint its actor
-- saw, so a stale client cannot confirm a superseded reading. Snooze
-- horizons are validated in the decision function: check constraints cannot
-- call now(), so the table only requires the horizon to be present exactly
-- when the decision is a snooze.
create table public.growth_intelligence_item_decisions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  growth_intelligence_item_id uuid not null,
  actor_id uuid not null,
  decision text not null check (decision in ('acknowledged', 'pinned', 'unpinned', 'planned', 'snoozed', 'dismissed', 'resolved')),
  reason text check (reason is null or pg_catalog.char_length(reason) between 1 and 500),
  snoozed_until timestamptz,
  item_fingerprint text not null check (item_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  foreign key (organization_id, growth_intelligence_item_id)
    references public.growth_intelligence_items(organization_id, id) on delete restrict,
  check ((decision = 'snoozed') = (snoozed_until is not null))
);

-- Actor-scoped presentation preferences. Pins change one actor's ordering and
-- never organization policy, so rows are keyed by the actor that owns them.
create table public.growth_intelligence_item_preferences (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  growth_intelligence_item_id uuid not null,
  user_id uuid not null,
  pinned boolean not null default false,
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (organization_id, growth_intelligence_item_id, user_id),
  foreign key (organization_id, growth_intelligence_item_id)
    references public.growth_intelligence_items(organization_id, id) on delete restrict
);

-- Tenant-safe source links. Both targets predate this draft
-- (channel_recommendations carries unique (organization_id, id) since
-- 20260824100000; opportunities since 20260813120000), so these FKs add no
-- migration-order coupling while enforcing existence and tenancy for every
-- preference kind, mirroring the item-preference FK above.
create table public.channel_recommendation_preferences (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  channel_recommendation_id uuid not null,
  user_id uuid not null,
  pinned boolean not null default false,
  snoozed_until timestamptz,
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (organization_id, channel_recommendation_id, user_id),
  foreign key (organization_id, channel_recommendation_id)
    references public.channel_recommendations(organization_id, id) on delete restrict
);

create table public.opportunity_preferences (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  opportunity_id uuid not null,
  user_id uuid not null,
  pinned boolean not null default false,
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (organization_id, opportunity_id, user_id),
  foreign key (organization_id, opportunity_id)
    references public.opportunities(organization_id, id) on delete restrict
);

create index growth_intelligence_synthesis_runs_request_idx
  on public.growth_intelligence_synthesis_runs (organization_id, growth_intelligence_request_id, started_at desc, id desc);
create index growth_intelligence_items_current_idx
  on public.growth_intelligence_items (organization_id, status, activity_month desc, kind, id desc);
create index growth_intelligence_items_kind_idx
  on public.growth_intelligence_items (organization_id, kind, activity_month desc, id desc);
create index growth_intelligence_items_fingerprint_idx
  on public.growth_intelligence_items (organization_id, item_fingerprint);
create index growth_intelligence_item_market_claims_claim_idx
  on public.growth_intelligence_item_market_claims (organization_id, market_evidence_claim_id, growth_intelligence_item_id);
create index growth_intelligence_item_decisions_item_idx
  on public.growth_intelligence_item_decisions (organization_id, growth_intelligence_item_id, created_at desc, id desc);
create index growth_intelligence_item_decisions_expiry_idx
  on public.growth_intelligence_item_decisions (organization_id, snoozed_until, id)
  where decision = 'snoozed';
create index growth_intelligence_item_preferences_user_idx
  on public.growth_intelligence_item_preferences (organization_id, user_id, growth_intelligence_item_id);
create index growth_intelligence_items_carryover_idx
  on public.growth_intelligence_items (organization_id, status, kind, activity_month desc, id desc)
  where status = 'current' and kind <> 'data_gap';

create function private.enforce_growth_intelligence_synthesis_run_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'growth_intelligence_synthesis_run_delete_forbidden' using errcode = '55000';
  end if;
  if new.organization_id is distinct from old.organization_id
    or new.growth_intelligence_request_id is distinct from old.growth_intelligence_request_id
    or new.market_profile_version_id is distinct from old.market_profile_version_id
    or new.claim_token is distinct from old.claim_token
    or new.provider is distinct from old.provider
    or new.model_version is distinct from old.model_version
    or new.run_fingerprint is distinct from old.run_fingerprint
    or new.started_at is distinct from old.started_at
    or new.correlation_id is distinct from old.correlation_id
    or new.created_at is distinct from old.created_at then
    raise exception 'growth_intelligence_synthesis_run_identity_immutable' using errcode = '55000';
  end if;
  if old.status <> 'running' then
    raise exception 'growth_intelligence_synthesis_run_terminal' using errcode = '55000';
  end if;
  return new;
end;
$$;

-- Committed supersession guard for synthesized items. The shared
-- reject_market_evidence_immutable_mutation() forbids every write, which
-- would block the complete RPC's own supersession flip, so this table has a
-- dedicated guard instead: exactly one transition is permitted (a current
-- item naming its replacement while every other column stays unchanged).
-- Deletes and all other updates fail exactly like the shared guard.
create function private.enforce_growth_intelligence_item_supersession()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and old.status = 'current'
    and new.status = 'superseded'
    and old.superseded_by_item_id is null
    and new.superseded_by_item_id is not null
    and new.id is not distinct from old.id
    and new.organization_id is not distinct from old.organization_id
    and new.growth_intelligence_synthesis_run_id is not distinct from old.growth_intelligence_synthesis_run_id
    and new.market_profile_version_id is not distinct from old.market_profile_version_id
    and new.kind is not distinct from old.kind
    and new.narrative is not distinct from old.narrative
    and new.item_fingerprint is not distinct from old.item_fingerprint
    and new.evidence_fingerprint is not distinct from old.evidence_fingerprint
    and new.geographic_layer is not distinct from old.geographic_layer
    and new.geography_ref is not distinct from old.geography_ref
    and new.support_grade is not distinct from old.support_grade
    and new.freshness is not distinct from old.freshness
    and new.urgency is not distinct from old.urgency
    and new.goal_alignment is not distinct from old.goal_alignment
    and new.activity_month is not distinct from old.activity_month
    and new.missing_input is not distinct from old.missing_input
    and new.created_at is not distinct from old.created_at then
    return new;
  end if;
  raise exception 'market_evidence_immutable' using errcode = '55000';
end;
$$;

create trigger growth_intelligence_synthesis_runs_enforce_mutation
before update or delete on public.growth_intelligence_synthesis_runs
for each row execute function private.enforce_growth_intelligence_synthesis_run_mutation();
create trigger growth_intelligence_items_enforce_supersession
before update or delete on public.growth_intelligence_items
for each row execute function private.enforce_growth_intelligence_item_supersession();
create trigger growth_intelligence_item_market_claims_append_only
before update or delete on public.growth_intelligence_item_market_claims
for each row execute function private.reject_market_evidence_immutable_mutation();
create trigger growth_intelligence_item_channel_findings_append_only
before update or delete on public.growth_intelligence_item_channel_findings
for each row execute function private.reject_market_evidence_immutable_mutation();
create trigger growth_intelligence_item_goals_append_only
before update or delete on public.growth_intelligence_item_goals
for each row execute function private.reject_market_evidence_immutable_mutation();
create trigger growth_intelligence_item_decisions_append_only
before update or delete on public.growth_intelligence_item_decisions
for each row execute function private.reject_market_evidence_immutable_mutation();

create function private.assert_growth_intelligence_synthesis_claim(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid
)
returns public.growth_intelligence_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'growth_intelligence_synthesis_worker_forbidden' using errcode = '42501';
  end if;
  select request.* into request_row
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
  for update;
  if not found
    or request_row.status <> 'claimed'
    or request_row.claim_token is distinct from p_claim_token
    or request_row.lease_expires_at <= pg_catalog.now() then
    raise exception 'growth_intelligence_synthesis_claim_lost' using errcode = '42501';
  end if;
  return request_row;
end;
$$;

create function public.begin_growth_intelligence_synthesis(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
  run_row public.growth_intelligence_synthesis_runs;
begin
  if p_organization_id is null or p_request_id is null or p_claim_token is null then
    raise exception 'growth_intelligence_synthesis_run_invalid' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_metadata) <> 'object'
    or pg_catalog.char_length(p_metadata ->> 'provider') not between 2 and 100
    or (p_metadata ->> 'modelVersion' is not null
      and pg_catalog.char_length(p_metadata ->> 'modelVersion') not between 1 and 160)
    or (p_metadata ->> 'runFingerprint') !~ '^[a-f0-9]{64}$'
    or (p_metadata ->> 'correlationId') is null then
    raise exception 'growth_intelligence_synthesis_run_invalid' using errcode = '22023';
  end if;
  request_row := private.assert_growth_intelligence_synthesis_claim(
    p_organization_id, p_request_id, p_claim_token
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws('|', 'growth_intelligence', 'synthesis_run', p_organization_id, p_request_id, p_claim_token),
    0
  ));
  select run.* into run_row
  from public.growth_intelligence_synthesis_runs run
  where run.organization_id = p_organization_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token
  for update;
  if found then
    if run_row.run_fingerprint is distinct from p_metadata ->> 'runFingerprint' then
      raise exception 'growth_intelligence_synthesis_run_idempotency_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'runId', run_row.id, 'status', run_row.status, 'replayed', true
    );
  end if;
  insert into public.growth_intelligence_synthesis_runs (
    organization_id, growth_intelligence_request_id, market_profile_version_id, claim_token,
    provider, model_version, run_fingerprint, correlation_id
  ) values (
    p_organization_id, p_request_id, request_row.market_profile_version_id, p_claim_token,
    p_metadata ->> 'provider', p_metadata ->> 'modelVersion',
    p_metadata ->> 'runFingerprint', (p_metadata ->> 'correlationId')::uuid
  )
  returning * into run_row;
  return pg_catalog.jsonb_build_object(
    'runId', run_row.id, 'status', run_row.status, 'replayed', false
  );
end;
$$;

create function public.complete_growth_intelligence_synthesis(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_synthesis_run_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.growth_intelligence_synthesis_runs;
  item_record jsonb;
  item_row public.growth_intelligence_items;
  stored_item_count integer := 0;
  superseded_ids uuid[] := '{}';
  superseded_item_ids jsonb;
  flipped_id uuid;
begin
  if p_organization_id is null or p_request_id is null or p_claim_token is null
    or p_synthesis_run_id is null then
    raise exception 'growth_intelligence_synthesis_result_invalid' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_typeof(p_result) <> 'object'
    or (p_result ->> 'outcome') <> 'completed'
    or (p_result ->> 'resultDigest') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_result -> 'items') <> 'array'
    or pg_catalog.jsonb_array_length(p_result -> 'items') > 200 then
    raise exception 'growth_intelligence_synthesis_result_invalid' using errcode = '22023';
  end if;
  perform private.assert_growth_intelligence_synthesis_claim(
    p_organization_id, p_request_id, p_claim_token
  );
  select run.* into run_row
  from public.growth_intelligence_synthesis_runs run
  where run.organization_id = p_organization_id
    and run.id = p_synthesis_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token
    and run.status = 'running'
  for update;
  if not found then
    raise exception 'growth_intelligence_synthesis_run_not_running' using errcode = '22023';
  end if;
  for item_record in select * from pg_catalog.jsonb_array_elements(p_result -> 'items') loop
    if pg_catalog.jsonb_typeof(item_record) <> 'object'
      or (item_record ->> 'kind') not in ('insight', 'recommendation', 'data_gap')
      or pg_catalog.char_length(item_record ->> 'narrative') not between 1 and 2000
      or (item_record ->> 'itemFingerprint') !~ '^[a-f0-9]{64}$'
      or (item_record ->> 'evidenceFingerprint') !~ '^[a-f0-9]{64}$'
      or (item_record ->> 'geographicLayer') not in ('trade_area', 'city', 'country')
      or pg_catalog.char_length(item_record ->> 'geographyRef') not between 2 and 160
      or (item_record ->> 'supportGrade') not in ('primary', 'corroborated', 'single_source', 'contextual', 'conflicted')
      or (item_record ->> 'freshness') not in ('current', 'stale', 'expired')
      or (item_record ->> 'urgency') not in ('high', 'medium', 'low')
      or (item_record ->> 'goalAlignment') not in ('direct', 'indirect', 'none')
      or (item_record ->> 'activityMonth') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      or pg_catalog.jsonb_typeof(item_record -> 'claimIds') <> 'array'
      or pg_catalog.jsonb_typeof(item_record -> 'findings') <> 'array'
      or pg_catalog.jsonb_typeof(item_record -> 'goals') <> 'array'
      or exists (
        select 1 from pg_catalog.jsonb_array_elements_text(item_record -> 'claimIds') as claim_id(value)
        where claim_id.value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(item_record -> 'findings') as finding(value)
        where pg_catalog.jsonb_typeof(finding.value) <> 'object'
          or (finding.value ->> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or (finding.value ->> 'digest') !~ '^[a-f0-9]{64}$'
      )
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(item_record -> 'goals') as goal(value)
        where pg_catalog.jsonb_typeof(goal.value) <> 'object'
          or pg_catalog.char_length(goal.value ->> 'ref') not between 2 and 160
          or (goal.value ->> 'alignment') not in ('direct', 'indirect', 'none')
      ) then
      raise exception 'growth_intelligence_synthesis_item_invalid' using errcode = '22023';
    end if;
    if ((item_record ->> 'kind') = 'data_gap') <> (item_record -> 'missingInput' is not null
      and item_record ->> 'missingInput' <> '') then
      raise exception 'growth_intelligence_synthesis_item_invalid' using errcode = '22023';
    end if;
    insert into public.growth_intelligence_items (
      organization_id, growth_intelligence_synthesis_run_id, market_profile_version_id,
      kind, narrative, item_fingerprint, evidence_fingerprint,
      geographic_layer, geography_ref, support_grade, freshness, urgency, goal_alignment,
      activity_month, missing_input
    ) values (
      p_organization_id, p_synthesis_run_id, run_row.market_profile_version_id,
      item_record ->> 'kind', item_record ->> 'narrative',
      item_record ->> 'itemFingerprint', item_record ->> 'evidenceFingerprint',
      item_record ->> 'geographicLayer', item_record ->> 'geographyRef',
      item_record ->> 'supportGrade', item_record ->> 'freshness',
      item_record ->> 'urgency', item_record ->> 'goalAlignment',
      item_record ->> 'activityMonth',
      nullif(item_record ->> 'missingInput', '')
    )
    on conflict (organization_id, item_fingerprint) do nothing
    returning * into item_row;
    if found then
      stored_item_count := stored_item_count + 1;
      insert into public.growth_intelligence_item_market_claims (
        organization_id, growth_intelligence_item_id, market_evidence_claim_id
      )
      select p_organization_id, item_row.id, claim_id.value::uuid
      from pg_catalog.jsonb_array_elements_text(item_record -> 'claimIds') as claim_id(value)
      on conflict do nothing;
      insert into public.growth_intelligence_item_channel_findings (
        organization_id, growth_intelligence_item_id, finding_id, finding_digest
      )
      select p_organization_id, item_row.id,
        (finding.value ->> 'id')::uuid, finding.value ->> 'digest'
      from pg_catalog.jsonb_array_elements(item_record -> 'findings') as finding(value)
      on conflict do nothing;
      insert into public.growth_intelligence_item_goals (
        organization_id, growth_intelligence_item_id, goal_ref, alignment
      )
      select p_organization_id, item_row.id,
        goal.value ->> 'ref', goal.value ->> 'alignment'
      from pg_catalog.jsonb_array_elements(item_record -> 'goals') as goal(value)
      on conflict do nothing;
      -- Committed supersession: each newly stored item retires prior current
      -- items of the same kind, geographic layer, geography, and activity
      -- month. Currency is per-month (a revised profile retires same-month
      -- priors); profile version stays unscoped so prior-month unresolved
      -- items keep their status for carry-over. The items table guard permits
      -- exactly this transition.
      for flipped_id in
        update public.growth_intelligence_items as prior
        set status = 'superseded',
          superseded_by_item_id = item_row.id
        where prior.organization_id = p_organization_id
          and prior.kind = item_row.kind
          and prior.geographic_layer = item_row.geographic_layer
          and prior.geography_ref = item_row.geography_ref
          and prior.activity_month = item_row.activity_month
          and prior.status = 'current'
          and prior.id <> item_row.id
        returning prior.id
      loop
        superseded_ids := superseded_ids || flipped_id;
      end loop;
    end if;
  end loop;
  select pg_catalog.coalesce(
    pg_catalog.jsonb_agg(flipped.id order by flipped.id),
    pg_catalog.jsonb_build_array()
  ) into superseded_item_ids
  from pg_catalog.unnest(superseded_ids) as flipped(id);
  update public.growth_intelligence_synthesis_runs
  set status = 'completed',
    result_digest = p_result ->> 'resultDigest',
    item_count = stored_item_count,
    completed_at = pg_catalog.now()
  where organization_id = p_organization_id and id = run_row.id;
  return pg_catalog.jsonb_build_object(
    'runId', run_row.id, 'status', 'completed', 'itemCount', stored_item_count,
    'supersededItemIds', superseded_item_ids
  );
end;
$$;

create function public.fail_growth_intelligence_synthesis(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_synthesis_run_id uuid,
  p_safe_failure_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.growth_intelligence_synthesis_runs;
begin
  if p_organization_id is null or p_request_id is null or p_claim_token is null
    or p_synthesis_run_id is null
    or p_safe_failure_code !~ '^[A-Z][A-Z0-9_]{2,80}$' then
    raise exception 'growth_intelligence_synthesis_failure_invalid' using errcode = '22023';
  end if;
  perform private.assert_growth_intelligence_synthesis_claim(
    p_organization_id, p_request_id, p_claim_token
  );
  update public.growth_intelligence_synthesis_runs
  set status = 'failed',
    safe_failure_code = p_safe_failure_code,
    failed_at = pg_catalog.now()
  where organization_id = p_organization_id
    and id = p_synthesis_run_id
    and growth_intelligence_request_id = p_request_id
    and claim_token = p_claim_token
    and status = 'running'
  returning * into run_row;
  if not found then
    raise exception 'growth_intelligence_synthesis_run_not_running' using errcode = '22023';
  end if;
  perform public.fail_growth_intelligence_request(
    p_organization_id, p_request_id, p_claim_token, p_safe_failure_code
  );
  return pg_catalog.jsonb_build_object(
    'runId', run_row.id, 'status', 'failed'
  );
end;
$$;

-- Operator triage. The actor must own the organization manage permission, be
-- the authenticated caller they claim to be, and see the same item
-- fingerprint the decision names. Snooze horizons must be future timestamps;
-- the check lives here because check constraints cannot call now().
create function public.decide_growth_intelligence_item(
  p_organization_id uuid,
  p_actor_id uuid,
  p_item_id uuid,
  p_decision text,
  p_reason text,
  p_snoozed_until timestamptz,
  p_item_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row public.growth_intelligence_items;
  decision_row public.growth_intelligence_item_decisions;
begin
  if p_organization_id is null or p_actor_id is null or p_item_id is null then
    raise exception 'growth_intelligence_item_decision_invalid' using errcode = '22023';
  end if;
  if p_decision not in ('acknowledged', 'pinned', 'unpinned', 'planned', 'snoozed', 'dismissed', 'resolved') then
    raise exception 'growth_intelligence_item_decision_invalid' using errcode = '22023';
  end if;
  if p_reason is not null and pg_catalog.char_length(p_reason) not between 1 and 500 then
    raise exception 'growth_intelligence_item_decision_invalid' using errcode = '22023';
  end if;
  if (p_decision = 'snoozed') <> (p_snoozed_until is not null) then
    raise exception 'growth_intelligence_item_decision_invalid' using errcode = '22023';
  end if;
  if p_snoozed_until is not null and p_snoozed_until <= pg_catalog.now() then
    raise exception 'growth_intelligence_item_snooze_not_future' using errcode = '22023';
  end if;
  if p_item_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'growth_intelligence_item_decision_invalid' using errcode = '22023';
  end if;
  if (select auth.uid()) is distinct from p_actor_id
    or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage') then
    raise exception 'growth_intelligence_item_decision_forbidden' using errcode = '42501';
  end if;
  select item.* into item_row
  from public.growth_intelligence_items item
  where item.organization_id = p_organization_id
    and item.id = p_item_id
  for update;
  if not found then
    raise exception 'growth_intelligence_item_not_found' using errcode = '22023';
  end if;
  if item_row.item_fingerprint is distinct from p_item_fingerprint then
    raise exception 'growth_intelligence_item_stale' using errcode = '23505';
  end if;
  -- Spec 022 section 9.6: a Data Gap stays open until its named input
  -- becomes current and compatible; an operator cannot mark missing evidence
  -- fixed by assertion. 'resolved' therefore fails closed on every kind until
  -- a deterministic compatible-input path exists. Task 17 owns any future
  -- compatible-input reopening and all kind-to-decision triage gating, so no
  -- kind-to-decision mapping is enforced here.
  if p_decision = 'resolved' then
    raise exception 'growth_intelligence_data_gap_resolution_forbidden' using errcode = '22023';
  end if;
  insert into public.growth_intelligence_item_decisions (
    organization_id, growth_intelligence_item_id, actor_id,
    decision, reason, snoozed_until, item_fingerprint
  ) values (
    p_organization_id, p_item_id, p_actor_id,
    p_decision, nullif(p_reason, ''), p_snoozed_until, p_item_fingerprint
  )
  returning * into decision_row;
  return pg_catalog.jsonb_build_object(
    'decisionId', decision_row.id, 'decision', decision_row.decision
  );
end;
$$;

-- Actor-scoped preference write. The caller may only write their own row, and
-- the row never affects organization policy or another actor's ordering.
create function public.set_growth_intelligence_preference(
  p_organization_id uuid,
  p_actor_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_pinned boolean,
  p_snoozed_until timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null or p_actor_id is null or p_source_id is null
    or p_pinned is null then
    raise exception 'growth_intelligence_preference_invalid' using errcode = '22023';
  end if;
  if p_source_kind not in ('synthesis_item', 'channel_recommendation', 'opportunity') then
    raise exception 'growth_intelligence_preference_invalid' using errcode = '22023';
  end if;
  if p_snoozed_until is not null and p_snoozed_until <= pg_catalog.now() then
    raise exception 'growth_intelligence_preference_invalid' using errcode = '22023';
  end if;
  if (select auth.uid()) is distinct from p_actor_id then
    raise exception 'growth_intelligence_preference_forbidden' using errcode = '42501';
  end if;
  if not private.has_organization_permission(p_organization_id, 'growth_intelligence.read') then
    raise exception 'growth_intelligence_preference_forbidden' using errcode = '42501';
  end if;
  if p_source_kind = 'synthesis_item' then
    insert into public.growth_intelligence_item_preferences (
      organization_id, growth_intelligence_item_id, user_id, pinned, updated_at
    ) values (p_organization_id, p_source_id, p_actor_id, p_pinned, pg_catalog.now())
    on conflict (organization_id, growth_intelligence_item_id, user_id)
    do update set pinned = excluded.pinned, updated_at = pg_catalog.now();
  elsif p_source_kind = 'channel_recommendation' then
    insert into public.channel_recommendation_preferences (
      organization_id, channel_recommendation_id, user_id, pinned, snoozed_until, updated_at
    ) values (p_organization_id, p_source_id, p_actor_id, p_pinned, p_snoozed_until, pg_catalog.now())
    on conflict (organization_id, channel_recommendation_id, user_id)
    do update set pinned = excluded.pinned, snoozed_until = excluded.snoozed_until,
      updated_at = pg_catalog.now();
  else
    insert into public.opportunity_preferences (
      organization_id, opportunity_id, user_id, pinned, updated_at
    ) values (p_organization_id, p_source_id, p_actor_id, p_pinned, pg_catalog.now())
    on conflict (organization_id, opportunity_id, user_id)
    do update set pinned = excluded.pinned, updated_at = pg_catalog.now();
  end if;
  return pg_catalog.jsonb_build_object('sourceKind', p_source_kind, 'pinned', p_pinned);
end;
$$;

-- Reads stay tenant-scoped to members; writes happen only through the fenced
-- operations above, so no client session can manufacture items or history.
alter table public.growth_intelligence_synthesis_runs enable row level security;
alter table public.growth_intelligence_synthesis_runs force row level security;
alter table public.growth_intelligence_items enable row level security;
alter table public.growth_intelligence_items force row level security;
alter table public.growth_intelligence_item_market_claims enable row level security;
alter table public.growth_intelligence_item_market_claims force row level security;
alter table public.growth_intelligence_item_channel_findings enable row level security;
alter table public.growth_intelligence_item_channel_findings force row level security;
alter table public.growth_intelligence_item_goals enable row level security;
alter table public.growth_intelligence_item_goals force row level security;
alter table public.growth_intelligence_item_decisions enable row level security;
alter table public.growth_intelligence_item_decisions force row level security;
alter table public.growth_intelligence_item_preferences enable row level security;
alter table public.growth_intelligence_item_preferences force row level security;
alter table public.channel_recommendation_preferences enable row level security;
alter table public.channel_recommendation_preferences force row level security;
alter table public.opportunity_preferences enable row level security;
alter table public.opportunity_preferences force row level security;

create policy "members with Growth Intelligence read synthesis runs"
on public.growth_intelligence_synthesis_runs
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read synthesis items"
on public.growth_intelligence_items
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read item claim links"
on public.growth_intelligence_item_market_claims
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read item finding links"
on public.growth_intelligence_item_channel_findings
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read item goal links"
on public.growth_intelligence_item_goals
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read item decisions"
on public.growth_intelligence_item_decisions
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "actors read their own synthesis item preferences"
on public.growth_intelligence_item_preferences
for select to authenticated
using (user_id = (select auth.uid()));

create policy "actors read their own recommendation preferences"
on public.channel_recommendation_preferences
for select to authenticated
using (user_id = (select auth.uid()));

create policy "actors read their own opportunity preferences"
on public.opportunity_preferences
for select to authenticated
using (user_id = (select auth.uid()));

revoke all on table public.growth_intelligence_synthesis_runs from public, anon, authenticated, service_role;
revoke all on table public.growth_intelligence_items from public, anon, authenticated, service_role;
revoke all on table public.growth_intelligence_item_market_claims from public, anon, authenticated, service_role;
revoke all on table public.growth_intelligence_item_channel_findings from public, anon, authenticated, service_role;
revoke all on table public.growth_intelligence_item_goals from public, anon, authenticated, service_role;
revoke all on table public.growth_intelligence_item_decisions from public, anon, authenticated, service_role;
revoke all on table public.growth_intelligence_item_preferences from public, anon, authenticated, service_role;
revoke all on table public.channel_recommendation_preferences from public, anon, authenticated, service_role;
revoke all on table public.opportunity_preferences from public, anon, authenticated, service_role;

grant select on table public.growth_intelligence_synthesis_runs to authenticated;
grant select on table public.growth_intelligence_items to authenticated;
grant select on table public.growth_intelligence_item_market_claims to authenticated;
grant select on table public.growth_intelligence_item_channel_findings to authenticated;
grant select on table public.growth_intelligence_item_goals to authenticated;
grant select on table public.growth_intelligence_item_decisions to authenticated;
grant select on table public.growth_intelligence_item_preferences to authenticated;
grant select on table public.channel_recommendation_preferences to authenticated;
grant select on table public.opportunity_preferences to authenticated;

revoke all on function private.assert_growth_intelligence_synthesis_claim(uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function private.enforce_growth_intelligence_synthesis_run_mutation() from public, anon, authenticated, service_role;
revoke all on function private.enforce_growth_intelligence_item_supersession() from public, anon, authenticated, service_role;
revoke all on function public.begin_growth_intelligence_synthesis(uuid,uuid,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.complete_growth_intelligence_synthesis(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.fail_growth_intelligence_synthesis(uuid,uuid,uuid,uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.decide_growth_intelligence_item(uuid,uuid,uuid,text,text,timestamptz,text) from public, anon, authenticated, service_role;
revoke all on function public.set_growth_intelligence_preference(uuid,uuid,text,uuid,boolean,timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.begin_growth_intelligence_synthesis(uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.complete_growth_intelligence_synthesis(uuid,uuid,uuid,uuid,jsonb) to service_role;
grant execute on function public.fail_growth_intelligence_synthesis(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.decide_growth_intelligence_item(uuid,uuid,uuid,text,text,timestamptz,text) to authenticated, service_role;
grant execute on function public.set_growth_intelligence_preference(uuid,uuid,text,uuid,boolean,timestamptz) to authenticated, service_role;
