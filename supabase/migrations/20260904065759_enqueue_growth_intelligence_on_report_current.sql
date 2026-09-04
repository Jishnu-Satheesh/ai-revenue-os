-- Transactional Growth Intelligence wake-up on report-current evidence.
--
-- When governed evidence becomes current, every affected organization +
-- channel + month gets exactly one durable `business_evidence_changed`
-- request carrying the server-resolved monthly evidence digest. The request
-- is written by the same database transaction that commits the evidence, so
-- a lost Trigger dispatch only delays the wake-up: the sweeper still finds
-- the due request. Completed outcomes return the request identifiers so the
-- worker's wake-up call is latency optimization, never liveness.
--
-- The four completion functions keep their signatures, grants, and bodies
-- untouched: each is renamed to `*_impl` (preserving its grants) and a thin
-- wrapper with the original name calls it, enqueues, and merges the request
-- identifiers into the returned document. Nothing that calls these functions
-- changes.

-- Monthly evidence digest ----------------------------------------------------
--
-- The fingerprint of the exact candidate evidence one month holds, resolved
-- under the worker lease semantics of the caller: current and held rows in
-- the month's local dates, ordered by id. A correction, supersession, or
-- reconciliation moves the set and misses immediately. An empty month hashes
-- its explicit empty shape, so "no governed evidence" is a stable value
-- rather than a null no caller can fingerprint.

create function private.monthly_business_evidence_digest(
  p_organization_id uuid,
  p_channel_id uuid,
  p_month_start date,
  p_month_end date,
  p_time_zone text
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      coalesce((
        select pg_catalog.string_agg(
          'm|' || m.id::text || '|' || m.metric_definition_id::text || '|' || m.period_grain
            || '|' || m.period_start::text || '|' || m.period_end::text || '|' || m.period_timezone
            || '|' || m.value_numerator::text || '|' || coalesce(m.value_denominator::text, '')
            || '|' || coalesce(m.currency, '') || '|' || m.quality_tier
            || '|' || m.revision::text || '|' || m.reconciliation_state
            || '|' || coalesce(m.reconciliation_digest, ''),
          chr(10) order by m.id
        )
        from public.normalized_metrics m
        where m.organization_id = p_organization_id
          and m.channel_id is not distinct from p_channel_id
          and m.reconciliation_state in ('current', 'blocked_overlap')
          and (m.period_start at time zone m.period_timezone)::date <= p_month_end
          and ((m.period_end at time zone m.period_timezone) - interval '1 day')::date >= p_month_start
      ), 'period-metrics:empty')
      || chr(10) ||
      coalesce((
        select pg_catalog.string_agg(
          'o|' || o.id::text || '|' || o.metric_definition_id::text
            || '|' || o.period_start::text || '|' || o.period_end::text || '|' || o.period_timezone
            || '|' || o.value_numerator::text || '|' || coalesce(o.value_denominator::text, '')
            || '|' || coalesce(o.currency, '') || '|' || o.quality_state
            || '|' || o.revision::text || '|' || o.reconciliation_state
            || '|' || coalesce(o.reconciliation_digest, ''),
          chr(10) order by o.id
        )
        from public.exact_range_metric_observations o
        where o.organization_id = p_organization_id
          and o.channel_id is not distinct from p_channel_id
          and o.reconciliation_state in ('current', 'blocked_overlap')
          and o.period_start <= p_month_end
          and o.period_end >= p_month_start
      ), 'exact-observations:empty'),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function private.monthly_business_evidence_digest(uuid, uuid, date, date, text)
  from public, anon, authenticated, service_role;

-- Monthly fan-out -------------------------------------------------------------
--
-- One request per month in the declared range, replayed by fingerprint when
-- the month's evidence has not moved. An organization with no current
-- approved profile enqueues nothing: there is no synthesis to wake. A scope
-- that vanishes mid-flight (42501) skips its month; the report outcome still
-- stands, and the next current event retries.

create function private.enqueue_growth_intelligence_evidence_requests(
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
    and profile.enabled;

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

-- Projection completions ------------------------------------------------------
--
-- The wrappers below are identical in shape: call the renamed implementation,
-- fan out to the declared months when evidence became current, and merge the
-- request identifiers into the returned document. A null implementation
-- result (lost lease) passes through untouched.

alter function public.complete_governed_report_package_projection(uuid, uuid, uuid, uuid, text, jsonb, jsonb)
  rename to complete_governed_report_package_projection_impl;

create function public.complete_governed_report_package_projection(
  p_organization_id uuid, p_report_package_id uuid, p_projection_run_id uuid,
  p_claim_token uuid, p_result_digest text, p_result jsonb, p_outputs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  package_row public.integration_report_packages;
  requests jsonb := '[]'::jsonb;
begin
  result := public.complete_governed_report_package_projection_impl(
    p_organization_id, p_report_package_id, p_projection_run_id,
    p_claim_token, p_result_digest, p_result, p_outputs
  );
  if result is null then
    return null;
  end if;
  if (result ->> 'status') in ('projected', 'partially_projected', 'reconciliation_required') then
    select * into package_row from public.integration_report_packages
    where organization_id = p_organization_id and id = p_report_package_id;
    if found then
      requests := private.enqueue_growth_intelligence_evidence_requests(
        p_organization_id, package_row.channel_id, package_row.branch_id,
        package_row.declared_period_start, package_row.declared_period_end,
        package_row.period_timezone
      );
    end if;
  end if;
  return result || pg_catalog.jsonb_build_object('growthIntelligenceRequests', requests);
end;
$$;

revoke all on function public.complete_governed_report_package_projection(uuid, uuid, uuid, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_governed_report_package_projection(uuid, uuid, uuid, uuid, text, jsonb, jsonb)
  to service_role;

alter function public.complete_governed_report_package_period_grain_projection(uuid, uuid, uuid, uuid, text, jsonb, jsonb, integer)
  rename to complete_governed_report_package_period_grain_projection_impl;

create function public.complete_governed_report_package_period_grain_projection(
  p_organization_id uuid, p_report_package_id uuid, p_projection_run_id uuid,
  p_claim_token uuid, p_result_digest text, p_result jsonb, p_observations jsonb,
  p_absent_row_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  package_row public.integration_report_packages;
  requests jsonb := '[]'::jsonb;
begin
  result := public.complete_governed_report_package_period_grain_projection_impl(
    p_organization_id, p_report_package_id, p_projection_run_id,
    p_claim_token, p_result_digest, p_result, p_observations, p_absent_row_count
  );
  if result is null then
    return null;
  end if;
  if (result ->> 'status') in ('projected', 'partially_projected', 'reconciliation_required') then
    select * into package_row from public.integration_report_packages
    where organization_id = p_organization_id and id = p_report_package_id;
    if found then
      requests := private.enqueue_growth_intelligence_evidence_requests(
        p_organization_id, package_row.channel_id, package_row.branch_id,
        package_row.declared_period_start, package_row.declared_period_end,
        package_row.period_timezone
      );
    end if;
  end if;
  return result || pg_catalog.jsonb_build_object('growthIntelligenceRequests', requests);
end;
$$;

revoke all on function public.complete_governed_report_package_period_grain_projection(uuid, uuid, uuid, uuid, text, jsonb, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.complete_governed_report_package_period_grain_projection(uuid, uuid, uuid, uuid, text, jsonb, jsonb, integer)
  to service_role;

-- Overlap resolutions ----------------------------------------------------------
--
-- A resolution moves evidence between states, so it fans out exactly like a
-- projection completion. The package scope comes from the reconciliation the
-- operator decided; anything the resolution did not touch enqueues nothing.

alter function public.resolve_governed_report_projection_overlap(uuid, uuid, uuid, text, text, uuid)
  rename to resolve_governed_report_projection_overlap_impl;

create function public.resolve_governed_report_projection_overlap(
  p_organization_id uuid, p_actor_id uuid, p_reconciliation_id uuid,
  p_resolution text, p_idempotency_key text, p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  package_row public.integration_report_packages;
  requests jsonb := '[]'::jsonb;
begin
  result := public.resolve_governed_report_projection_overlap_impl(
    p_organization_id, p_actor_id, p_reconciliation_id,
    p_resolution, p_idempotency_key, p_correlation_id
  );
  if result is null or (result ->> 'outcome') <> 'resolved' then
    return result;
  end if;
  select package.* into package_row
  from public.report_projection_reconciliations reconciliation
  join public.integration_report_packages package
    on package.organization_id = reconciliation.organization_id
    and package.id = reconciliation.report_package_id
  where reconciliation.organization_id = p_organization_id
    and reconciliation.id = p_reconciliation_id;
  if found then
    requests := private.enqueue_growth_intelligence_evidence_requests(
      p_organization_id, package_row.channel_id, package_row.branch_id,
      package_row.declared_period_start, package_row.declared_period_end,
      package_row.period_timezone
    );
  end if;
  return result || pg_catalog.jsonb_build_object('growthIntelligenceRequests', requests);
end;
$$;

revoke all on function public.resolve_governed_report_projection_overlap(uuid, uuid, uuid, text, text, uuid)
  from public, anon;
grant execute on function public.resolve_governed_report_projection_overlap(uuid, uuid, uuid, text, text, uuid)
  to authenticated, service_role;

alter function public.resolve_governed_report_projection_overlap_group(uuid, uuid, uuid, text, text, uuid)
  rename to resolve_governed_report_projection_overlap_group_impl;

create function public.resolve_governed_report_projection_overlap_group(
  p_organization_id uuid, p_actor_id uuid, p_reconciliation_id uuid,
  p_resolution text, p_idempotency_key text, p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  package_row public.integration_report_packages;
  requests jsonb := '[]'::jsonb;
begin
  result := public.resolve_governed_report_projection_overlap_group_impl(
    p_organization_id, p_actor_id, p_reconciliation_id,
    p_resolution, p_idempotency_key, p_correlation_id
  );
  if result is null or (result ->> 'outcome') <> 'resolved' then
    return result;
  end if;
  select package.* into package_row
  from public.report_projection_reconciliations reconciliation
  join public.integration_report_packages package
    on package.organization_id = reconciliation.organization_id
    and package.id = reconciliation.report_package_id
  where reconciliation.organization_id = p_organization_id
    and reconciliation.id = p_reconciliation_id;
  if found then
    requests := private.enqueue_growth_intelligence_evidence_requests(
      p_organization_id, package_row.channel_id, package_row.branch_id,
      package_row.declared_period_start, package_row.declared_period_end,
      package_row.period_timezone
    );
  end if;
  return result || pg_catalog.jsonb_build_object('growthIntelligenceRequests', requests);
end;
$$;

revoke all on function public.resolve_governed_report_projection_overlap_group(uuid, uuid, uuid, text, text, uuid)
  from public, anon;
grant execute on function public.resolve_governed_report_projection_overlap_group(uuid, uuid, uuid, text, text, uuid)
  to authenticated, service_role;
