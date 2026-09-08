-- Task 4: atomic branch-scoped research start, scoped due scheduling, scoped report-current wake-up.
--
-- Profiles gained an independent branch scope in Task 3. This slice wires the
-- runtime that scope requires:
--
-- 1. public.start_branch_market_research is the single atomic reviewed start.
--    Under the branch-profile lock it replays an idempotency key, converges
--    identical active scope onto the existing pipeline, conflicts on a stale
--    expected version, reuses an unchanged version, confirms the scope with an
--    explicit decision audit, cancels replaced same-branch work only, and
--    creates the pipeline plus its research root request in one transaction.
--    A failed start rolls everything back: no half-confirmed version survives.
-- 2. private.enqueue_growth_intelligence_evidence_requests (report-current
--    wake-up) resolves one exact profile scope per call: the package branch's
--    own enabled profile when it exists, otherwise the legacy null scope.
--    Never both, so a branch profile cannot trigger duplicate legacy dispatch.
-- 3. public.enqueue_due_scoped_market_research enumerates every enabled
--    scoped profile with its own cadence and local-day buckets. Same-bucket
--    replays dedupe through the request fingerprint; each profile carries its
--    source branch lineage into derived requests. Weekly synthesis rows keep
--    flowing to the existing consolidation dispatch unchanged.
--
-- No existing signature changes: the legacy proposal wrapper, the decision
-- RPC, and the request enqueue/claim RPCs keep their exact behavior.

-- The start operation needs its own idempotency kind --------------------------

alter table private.growth_intelligence_write_operations
  drop constraint if exists growth_intelligence_write_operations_operation_kind_check;

alter table private.growth_intelligence_write_operations
  add constraint growth_intelligence_write_operations_operation_kind_check
  check (operation_kind in (
    'propose_profile', 'decide_profile', 'retry_request', 'cancel_request',
    'start_branch_research'
  ));

-- Atomic branch research start -------------------------------------------------

create function public.start_branch_market_research(
  p_organization_id uuid,
  p_actor_id uuid,
  p_branch_id uuid,
  p_profile_document jsonb,
  p_profile_digest text,
  p_expected_current_version_id uuid,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  start_branch_is_active boolean;
  start_profile public.organization_market_profiles;
  start_version public.organization_market_profile_versions;
  start_operation private.growth_intelligence_write_operations;
  start_pipeline public.growth_intelligence_research_pipelines;
  start_pipeline_version public.organization_market_profile_versions;
  start_request public.growth_intelligence_requests;
  start_decision public.organization_market_profile_decisions;
  start_operation_fingerprint text;
  start_next_version integer;
  start_request_reason text;
  start_request_fingerprint text;
  start_request_result jsonb;
  start_replayed_request public.growth_intelligence_requests;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'market_profile_start_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_branch_id is null
    or p_profile_digest !~ '^[a-f0-9]{64}$'
    or pg_catalog.char_length(p_idempotency_key) not between 16 and 200
    or p_correlation_id is null then
    raise exception 'market_profile_start_invalid' using errcode = '22023';
  end if;

  -- The branch must be active and belong to this organization. Inactive and
  -- foreign branches share one safe refusal: there is no branch to scope to.
  select branch.is_active into start_branch_is_active
  from public.branches branch
  where branch.organization_id = p_organization_id
    and branch.id = p_branch_id;
  if not found or not start_branch_is_active then
    raise exception 'market_profile_branch_not_found' using errcode = '42501';
  end if;

  perform private.assert_market_profile_document_v2(
    p_organization_id, p_branch_id, p_profile_document
  );
  if private.create_market_profile_digest(p_profile_document) is distinct from p_profile_digest then
    raise exception 'market_profile_digest_mismatch' using errcode = '22023';
  end if;

  -- One serialized start per organization, branch and retry key. Different
  -- browser keys still converge below under the branch-profile lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'start_branch_research',
      p_organization_id, p_branch_id, p_idempotency_key
    ),
    0
  ));

  start_operation_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.concat_ws(
        '|', p_branch_id::text, p_profile_digest,
        coalesce(p_expected_current_version_id::text, '')
      ),
      'sha256'
    ),
    'hex'
  );
  select stored.* into start_operation
  from private.growth_intelligence_write_operations stored
  where stored.organization_id = p_organization_id
    and stored.operation_kind = 'start_branch_research'
    and stored.idempotency_key = p_idempotency_key
  for update;
  if found then
    if start_operation.operation_fingerprint is distinct from start_operation_fingerprint then
      raise exception 'market_profile_start_idempotency_conflict' using errcode = '23505';
    end if;
    select request.* into start_replayed_request
    from public.growth_intelligence_requests request
    where request.organization_id = p_organization_id
      and request.id = start_operation.request_id;
    if not found or start_replayed_request.pipeline_id is null then
      raise exception 'market_profile_start_replay_invalid' using errcode = '55000';
    end if;
    select pipeline.* into start_pipeline
    from public.growth_intelligence_research_pipelines pipeline
    where pipeline.organization_id = p_organization_id
      and pipeline.id = start_replayed_request.pipeline_id;
    if not found then
      raise exception 'market_profile_start_replay_invalid' using errcode = '55000';
    end if;
    return pg_catalog.jsonb_build_object(
      'outcome', 'replayed',
      'profileVersionId', start_operation.market_profile_version_id,
      'pipelineId', start_pipeline.id,
      'researchRequestId', start_replayed_request.id
    );
  end if;

  -- The branch profile row is the scope lock. Creating it here keeps the
  -- first start for a branch atomic; later starts lock the same row.
  insert into public.organization_market_profiles (
    organization_id, branch_id, created_by
  ) values (
    p_organization_id, p_branch_id, p_actor_id
  ) on conflict (organization_id, branch_id) where branch_id is not null do nothing;

  select stored.* into start_profile
  from public.organization_market_profiles stored
  where stored.organization_id = p_organization_id
    and stored.branch_id = p_branch_id
  for update;
  if not found then
    raise exception 'market_profile_branch_not_found' using errcode = '42501';
  end if;

  -- Identical active scope returns its pipeline before any version check: the
  -- operator reviewed exactly what is already running.
  select pipeline.* into start_pipeline
  from public.growth_intelligence_research_pipelines pipeline
  where pipeline.organization_id = p_organization_id
    and pipeline.branch_id = p_branch_id
    and pipeline.stage in ('queued', 'researching', 'preparing_insights')
  order by pipeline.created_at desc, pipeline.id desc
  limit 1
  for update;
  if found then
    select version.* into start_pipeline_version
    from public.organization_market_profile_versions version
    where version.organization_id = p_organization_id
      and version.id = start_pipeline.market_profile_version_id;
    if found and start_pipeline_version.profile_digest = p_profile_digest then
      select request.* into start_request
      from public.growth_intelligence_requests request
      where request.organization_id = p_organization_id
        and request.pipeline_id = start_pipeline.id
        and request.phase = 'research'
      order by request.created_at, request.id
      limit 1
      for update;
      if not found and start_pipeline.research_request_id is not null then
        select request.* into start_request
        from public.growth_intelligence_requests request
        where request.organization_id = p_organization_id
          and request.id = start_pipeline.research_request_id
        for update;
      end if;
      if not found then
        raise exception 'market_profile_start_replay_invalid' using errcode = '55000';
      end if;
      insert into private.growth_intelligence_write_operations (
        organization_id, operation_kind, idempotency_key, operation_fingerprint,
        market_profile_version_id, request_id
      ) values (
        p_organization_id, 'start_branch_research', p_idempotency_key,
        start_operation_fingerprint, start_pipeline_version.id, start_request.id
      );
      return pg_catalog.jsonb_build_object(
        'outcome', 'existing_active',
        'profileVersionId', start_pipeline_version.id,
        'pipelineId', start_pipeline.id,
        'researchRequestId', start_request.id
      );
    end if;

    -- Changed scope replaces unfinished work for this branch only. Sibling
    -- branches keep their pipelines: the update is pinned to this branch row.
    update public.growth_intelligence_research_pipelines pipeline
    set stage = 'cancelled',
        safe_failure_code = 'SUPERSEDED_BY_NEW_SCOPE',
        stage_changed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where pipeline.organization_id = p_organization_id
      and pipeline.id = start_pipeline.id;
    update public.growth_intelligence_requests request
    set status = 'cancelled', claim_token = null, lease_expires_at = null,
        cancelled_at = pg_catalog.now(),
        cancel_reason = 'Replaced by a new branch research scope.',
        last_transition_actor_type = 'user', last_transition_actor_id = p_actor_id,
        correlation_id = p_correlation_id
    where request.organization_id = p_organization_id
      and request.pipeline_id = start_pipeline.id
      and request.status in ('pending', 'claimed');
  end if;

  -- A stale review conflicts once identical scope is ruled out above, and the
  -- caller retains its edits because this transaction changes nothing.
  if p_expected_current_version_id is not null
    and start_profile.current_version_id is distinct from p_expected_current_version_id then
    raise exception 'market_profile_version_conflict' using errcode = '23505';
  end if;

  -- Save or reuse the reviewed version inside this exact branch profile, so a
  -- pipeline can never point at another branch's version lineage.
  select stored.* into start_version
  from public.organization_market_profile_versions stored
  where stored.organization_id = p_organization_id
    and stored.market_profile_id = start_profile.id
    and stored.profile_digest = p_profile_digest;
  if not found then
    select coalesce(pg_catalog.max(stored.version), 0) + 1
    into start_next_version
    from public.organization_market_profile_versions stored
    where stored.organization_id = p_organization_id
      and stored.market_profile_id = start_profile.id;

    insert into public.organization_market_profile_versions (
      organization_id, market_profile_id, version, schema_version,
      profile_document, profile_digest, source_policy_digest, proposal_source,
      created_by, correlation_id
    ) values (
      p_organization_id,
      start_profile.id,
      start_next_version,
      2,
      p_profile_document,
      p_profile_digest,
      private.create_market_profile_digest(p_profile_document -> 'sourcePolicy'),
      'operator',
      p_actor_id,
      p_correlation_id
    ) returning * into start_version;
  end if;

  -- Explicit confirmation audit: the reviewed version becomes current, is
  -- enabled, and carries its own confirmed decision row.
  update public.organization_market_profiles
  set current_version_id = start_version.id, enabled = true
  where organization_id = p_organization_id and id = start_profile.id;

  insert into public.organization_market_profile_decisions (
    organization_id, market_profile_id, market_profile_version_id, decision,
    profile_digest, reason, decided_by, correlation_id
  ) values (
    p_organization_id, start_profile.id, start_version.id, 'confirmed',
    start_version.profile_digest, 'Branch research started.', p_actor_id, p_correlation_id
  ) returning * into start_decision;

  insert into public.growth_intelligence_research_pipelines (
    organization_id, branch_id, market_profile_id, market_profile_version_id,
    scope_digest, coverage
  ) values (
    p_organization_id, p_branch_id, start_profile.id, start_version.id,
    p_profile_digest, '[]'::jsonb
  ) returning * into start_pipeline;

  start_request_reason := case when start_profile.current_version_id is null
    then 'profile_confirmed' else 'profile_revised' end;
  start_request_fingerprint := private.create_growth_intelligence_request_fingerprint(
    p_organization_id, p_branch_id, null, 'market_research', start_request_reason, null,
    start_version.id, start_version.source_policy_digest, 'market-research@1',
    'immediate', null, null
  );
  start_request_result := public.enqueue_growth_intelligence_request(
    p_organization_id,
    pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id,
      'branchId', p_branch_id,
      'channelId', null,
      'kind', 'market_research',
      'triggerReason', start_request_reason,
      'businessEvidenceDigest', null,
      'marketProfileVersionId', start_version.id,
      'sourcePolicyDigest', start_version.source_policy_digest,
      'researchRuleVersion', 'market-research@1',
      'localTimeBucket', 'immediate',
      'synthesisVersionTuple', null,
      'playbookVersionTuple', null,
      'requestFingerprint', start_request_fingerprint,
      'dueAt', pg_catalog.now(),
      'correlationId', p_correlation_id,
      'requestedBy', p_actor_id
    )
  );
  select request.* into start_request
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = (start_request_result ->> 'requestId')::uuid
  for update;

  update public.growth_intelligence_research_pipelines pipeline
  set research_request_id = start_request.id, updated_at = pg_catalog.now()
  where pipeline.organization_id = p_organization_id
    and pipeline.id = start_pipeline.id;

  update public.growth_intelligence_requests request
  set pipeline_id = start_pipeline.id, phase = 'research'
  where request.organization_id = p_organization_id
    and request.id = start_request.id;

  insert into private.growth_intelligence_write_operations (
    organization_id, operation_kind, idempotency_key, operation_fingerprint,
    market_profile_version_id, market_profile_decision_id, request_id
  ) values (
    p_organization_id, 'start_branch_research', p_idempotency_key,
    start_operation_fingerprint, start_version.id, start_decision.id, start_request.id
  );

  return pg_catalog.jsonb_build_object(
    'outcome', 'started',
    'profileVersionId', start_version.id,
    'pipelineId', start_pipeline.id,
    'researchRequestId', start_request.id
  );
end;
$$;

revoke all on function public.start_branch_market_research(uuid, uuid, uuid, jsonb, text, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.start_branch_market_research(uuid, uuid, uuid, jsonb, text, uuid, text, uuid)
  to authenticated, service_role;

-- Scoped report-current wake-up -------------------------------------------------
--
-- Replacement of the Task 11 fan-out with the same signature and replay
-- semantics, except the profile scope is now exact: the package branch's own
-- enabled profile wins when it exists, otherwise the legacy null scope wakes
-- as before. Exactly one scope enqueues per call, so a branch profile can
-- never cause duplicate legacy dispatch for its own evidence. Branch and
-- channel lineage continue to ride on every derived request.

create or replace function private.enqueue_growth_intelligence_evidence_requests(
  p_organization_id uuid,
  p_channel_id uuid,
  p_branch_id uuid,
  p_first_month date,
  p_last_month date,
  p_time_zone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_version_id uuid;
  policy_digest text;
  month date := pg_catalog.date_trunc('month', p_first_month)::date;
  month_end date;
  evidence_digest text;
  request_fingerprint text;
  request jsonb;
  call_result jsonb;
  collected jsonb := '[]'::jsonb;
begin
  select version.id, version.source_policy_digest
  into profile_version_id, policy_digest
  from public.organization_market_profiles profile
  join public.organization_market_profile_versions version
    on version.organization_id = profile.organization_id
    and version.id = profile.current_version_id
  where profile.organization_id = p_organization_id
    and profile.enabled
    and (
      (p_branch_id is not null and profile.branch_id = p_branch_id)
      or (
        profile.branch_id is null
        and (
          p_branch_id is null
          or not exists (
            select 1 from public.organization_market_profiles branch_profile
            where branch_profile.organization_id = p_organization_id
              and branch_profile.branch_id = p_branch_id
              and branch_profile.enabled
              and branch_profile.current_version_id is not null
          )
        )
      )
    )
  order by case when profile.branch_id is not null then 0 else 1 end
  limit 1;

  if not found then
    return '[]'::jsonb;
  end if;

  while month <= p_last_month loop
    month_end := (pg_catalog.date_trunc('month', month) + interval '1 month' - interval '1 day')::date;
    evidence_digest := private.monthly_business_evidence_digest(
      p_organization_id, p_channel_id, month, month_end, p_time_zone
    );
    request_fingerprint := private.create_growth_intelligence_request_fingerprint(
      p_organization_id, p_branch_id, p_channel_id,
      'business_evidence_changed', 'business_evidence_current',
      evidence_digest, profile_version_id, policy_digest,
      'market-research@1', 'immediate', null, null
    );
    request := pg_catalog.jsonb_build_object(
      'organizationId', p_organization_id::text,
      'branchId', p_branch_id::text,
      'channelId', p_channel_id::text,
      'kind', 'business_evidence_changed',
      'triggerReason', 'business_evidence_current',
      'businessEvidenceDigest', evidence_digest,
      'marketProfileVersionId', profile_version_id::text,
      'sourcePolicyDigest', policy_digest,
      'researchRuleVersion', 'market-research@1',
      'localTimeBucket', 'immediate',
      'synthesisVersionTuple', null,
      'playbookVersionTuple', null,
      'requestFingerprint', request_fingerprint,
      'dueAt', pg_catalog.now()::text,
      'correlationId', pg_catalog.gen_random_uuid()::text,
      'requestedBy', null
    );
    begin
      call_result := public.enqueue_growth_intelligence_request(p_organization_id, request);
      collected := collected || pg_catalog.jsonb_build_object(
        'requestId', call_result ->> 'requestId',
        'month', pg_catalog.to_char(month, 'YYYY-MM'),
        'replayed', (call_result ->> 'replayed')::boolean
      );
    exception when sqlstate '42501' then
      null;
    end;
    month := month + interval '1 month';
  end loop;

  return collected;
end;
$$;

revoke all on function private.enqueue_growth_intelligence_evidence_requests(uuid, uuid, uuid, date, date, text)
  from public, anon, authenticated, service_role;

-- Scoped due scheduler ----------------------------------------------------------
--
-- There was no cadence scheduler before: the profile due columns were
-- write-never. This worker entry point enumerates every enabled scoped
-- profile (branch and legacy) with its own cadence and local-day buckets,
-- enqueues daily research and weekly synthesis when each falls due, and
-- advances that scope's markers. Same-bucket reruns dedupe through the
-- request fingerprint and only advance markers. A scope whose document no
-- longer parses is skipped for this sweep, never fatal to its siblings.
-- Weekly synthesis rows keep flowing to the existing consolidation dispatch;
-- this scheduler adds due rows, it never removes or starves that workflow.

create function public.enqueue_due_scoped_market_research(
  p_limit integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  due_profile record;
  due_tz text;
  due_daily_time interval;
  due_weekly_day text;
  due_weekly_time interval;
  due_target_dow integer;
  due_local_day date;
  due_candidate timestamptz;
  due_bucket text;
  due_fingerprint text;
  due_request jsonb;
  due_result jsonb;
  due_collected jsonb := '[]'::jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'growth_intelligence_due_claim_invalid' using errcode = '22023';
  end if;

  for due_profile in
    select profile.organization_id as organization_id,
           profile.branch_id as branch_id,
           profile.id as profile_id,
           version.id as version_id,
           version.source_policy_digest as source_policy_digest,
           version.profile_document -> 'cadence' as cadence,
           profile.next_daily_research_due_at as next_daily_due_at,
           profile.next_weekly_synthesis_due_at as next_weekly_due_at
    from public.organization_market_profiles profile
    join public.organization_market_profile_versions version
      on version.organization_id = profile.organization_id
      and version.id = profile.current_version_id
    where profile.enabled
    order by profile.organization_id, profile.branch_id nulls first
    limit p_limit
  loop
    begin
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        pg_catalog.concat_ws(
          '|', 'growth_intelligence', 'due_scoped',
          due_profile.organization_id, due_profile.profile_id
        ),
        0
      ));

      due_tz := due_profile.cadence ->> 'timeZone';
      if due_tz is null
        or not exists (
          select 1 from pg_catalog.pg_timezone_names zone where zone.name = due_tz
        )
        or coalesce(due_profile.cadence ->> 'dailyLocalTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or due_profile.cadence ->> 'weeklyDay' not in (
          'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
        )
        or coalesce(due_profile.cadence ->> 'weeklyLocalTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'market_profile_cadence_invalid' using errcode = '22023';
      end if;
      due_daily_time := (due_profile.cadence ->> 'dailyLocalTime')::interval;
      due_weekly_day := due_profile.cadence ->> 'weeklyDay';
      due_weekly_time := (due_profile.cadence ->> 'weeklyLocalTime')::interval;
      due_target_dow := case due_weekly_day
        when 'monday' then 1 when 'tuesday' then 2 when 'wednesday' then 3
        when 'thursday' then 4 when 'friday' then 5 when 'saturday' then 6
        else 7 end;
      due_local_day := (pg_catalog.now() at time zone due_tz)::date;

      -- Daily research ------------------------------------------------------
      if due_profile.next_daily_due_at is null
        or due_profile.next_daily_due_at <= pg_catalog.now() then
        due_bucket := 'daily:' || due_local_day::text;
        due_fingerprint := private.create_growth_intelligence_request_fingerprint(
          due_profile.organization_id, due_profile.branch_id, null,
          'market_research', 'daily_due', null,
          due_profile.version_id, due_profile.source_policy_digest, 'market-research@1',
          due_bucket, null, null
        );
        due_request := pg_catalog.jsonb_build_object(
          'organizationId', due_profile.organization_id::text,
          'branchId', due_profile.branch_id::text,
          'channelId', null,
          'kind', 'market_research',
          'triggerReason', 'daily_due',
          'businessEvidenceDigest', null,
          'marketProfileVersionId', due_profile.version_id::text,
          'sourcePolicyDigest', due_profile.source_policy_digest,
          'researchRuleVersion', 'market-research@1',
          'localTimeBucket', due_bucket,
          'synthesisVersionTuple', null,
          'playbookVersionTuple', null,
          'requestFingerprint', due_fingerprint,
          'dueAt', pg_catalog.now()::text,
          'correlationId', pg_catalog.gen_random_uuid()::text,
          'requestedBy', null
        );
        due_result := public.enqueue_growth_intelligence_request(
          due_profile.organization_id, due_request
        );
        due_candidate :=
          (due_local_day::timestamp + due_daily_time) at time zone due_tz;
        if due_candidate <= pg_catalog.now() then
          due_candidate := due_candidate + interval '1 day';
        end if;
        update public.organization_market_profiles profile
        set next_daily_research_due_at = due_candidate
        where profile.organization_id = due_profile.organization_id
          and profile.id = due_profile.profile_id;
        due_collected := due_collected || pg_catalog.jsonb_build_object(
          'organizationId', due_profile.organization_id,
          'branchId', due_profile.branch_id,
          'kind', 'market_research',
          'localTimeBucket', due_bucket,
          'requestId', due_result ->> 'requestId',
          'replayed', (due_result ->> 'replayed')::boolean
        );
      end if;

      -- Weekly synthesis ----------------------------------------------------
      if due_profile.next_weekly_due_at is null
        or due_profile.next_weekly_due_at <= pg_catalog.now() then
        due_bucket := 'weekly:' || (
          due_local_day - (((extract(isodow from due_local_day))::integer - 1))
        )::text;
        due_fingerprint := private.create_growth_intelligence_request_fingerprint(
          due_profile.organization_id, due_profile.branch_id, null,
          'weekly_synthesis', 'weekly_due', null,
          due_profile.version_id, due_profile.source_policy_digest, 'market-research@1',
          due_bucket, null, null
        );
        due_request := pg_catalog.jsonb_build_object(
          'organizationId', due_profile.organization_id::text,
          'branchId', due_profile.branch_id::text,
          'channelId', null,
          'kind', 'weekly_synthesis',
          'triggerReason', 'weekly_due',
          'businessEvidenceDigest', null,
          'marketProfileVersionId', due_profile.version_id::text,
          'sourcePolicyDigest', due_profile.source_policy_digest,
          'researchRuleVersion', 'market-research@1',
          'localTimeBucket', due_bucket,
          'synthesisVersionTuple', null,
          'playbookVersionTuple', null,
          'requestFingerprint', due_fingerprint,
          'dueAt', pg_catalog.now()::text,
          'correlationId', pg_catalog.gen_random_uuid()::text,
          'requestedBy', null
        );
        due_result := public.enqueue_growth_intelligence_request(
          due_profile.organization_id, due_request
        );
        due_candidate := (
          (due_local_day
            + (((due_target_dow - (extract(isodow from due_local_day))::integer + 7) % 7))
          )::timestamp + due_weekly_time
        ) at time zone due_tz;
        if due_candidate <= pg_catalog.now() then
          due_candidate := due_candidate + interval '7 days';
        end if;
        update public.organization_market_profiles profile
        set next_weekly_synthesis_due_at = due_candidate
        where profile.organization_id = due_profile.organization_id
          and profile.id = due_profile.profile_id;
        due_collected := due_collected || pg_catalog.jsonb_build_object(
          'organizationId', due_profile.organization_id,
          'branchId', due_profile.branch_id,
          'kind', 'weekly_synthesis',
          'localTimeBucket', due_bucket,
          'requestId', due_result ->> 'requestId',
          'replayed', (due_result ->> 'replayed')::boolean
        );
      end if;
    exception when sqlstate '22023' or sqlstate '42501' then
      due_collected := due_collected || pg_catalog.jsonb_build_object(
        'organizationId', due_profile.organization_id,
        'branchId', due_profile.branch_id,
        'skipped', true
      );
    end;
  end loop;

  return due_collected;
end;
$$;

revoke all on function public.enqueue_due_scoped_market_research(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.enqueue_due_scoped_market_research(integer)
  to service_role;
