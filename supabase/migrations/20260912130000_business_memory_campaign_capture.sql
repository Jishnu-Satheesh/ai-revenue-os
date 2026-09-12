-- Spec 023 Swarm 4: campaign capture adapters (state, outcome, lesson).
--
-- Live before this slice: queue, leased runtime, context manifests, and the
-- channel/growth adapters. Missing: campaign_state / campaign_outcome /
-- campaign_lesson projectors plus their enqueue paths.
--
-- Digest canonicalization (fixed order, unit-separator joined, nulls collapse
-- to empty):
--   state:   campaign_id | state | version | bundle_digest | scheduled_for
--   outcome: outcome_id | verdict | primary_metric | baseline_source |
--            attribution_method | outcome_window | settlement_delay | evidence_tier
--   lesson:  proposal_id | verdict | proposed_lesson | status
-- Status is excluded from state/outcome digests (a status change without a new
-- version is a lifecycle event, enqueued as a new revision via the state
-- trigger below, not as a digest change). For lessons only submitted_for_
-- promotion projects; local and dismissed rows enqueue nothing and project
-- nothing, so shared retrieval never sees them.
--
-- v_ prefixes every plpgsql local; empty search_path; fully qualified
-- objects; revoke public everywhere. No bodies, queries, or prompts are ever
-- logged or raised -- refusals carry static codes only.

insert into public.memory_capture_adapters (source_kind, registered, note) values
  ('campaign_state', true, 'Safe lifecycle only: version, branch, scope, schedule, status. No assertions, spend, or assets.'),
  ('campaign_outcome', true, 'Settled verdicts with baseline, metric, method, window, and limits. Approval is not publication, exposure, or success.'),
  ('campaign_lesson', true, 'Exactly one shared lesson per submitted promotion. Local and dismissed lessons never project.')
on conflict (source_kind) do update set
  registered = excluded.registered,
  note = excluded.note;

-- Enqueue: safe lifecycle -----------------------------------------------------

create or replace function private.enqueue_memory_campaign_state(
  p_organization_id uuid,
  p_campaign_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture_on boolean;
  v_campaign public.campaigns;
  v_version public.campaign_bundle_versions;
  v_schedule text;
  v_canonical text;
  v_digest text;
  v_revision bigint;
  v_event_id uuid;
begin
  select settings_row.capture_enabled into v_capture_on
  from public.memory_integration_settings settings_row
  where settings_row.organization_id = p_organization_id;
  if not found or not v_capture_on then
    return null;
  end if;

  select campaign_row.* into v_campaign
  from public.campaigns campaign_row
  where campaign_row.organization_id = p_organization_id
    and campaign_row.id = p_campaign_id;
  if not found then
    return null;
  end if;

  select version_row.* into v_version
  from public.campaign_bundle_versions version_row
  where version_row.organization_id = p_organization_id
    and version_row.campaign_id = p_campaign_id
  order by version_row.version desc
  limit 1;
  if not found then
    return null;
  end if;

  select pg_catalog.string_agg(action.scheduled_for::text, ',' order by action.scheduled_for)
    into v_schedule
  from public.campaign_channel_actions action
  where action.organization_id = p_organization_id
    and action.bundle_version_id = v_version.id;

  v_canonical := pg_catalog.concat_ws(pg_catalog.chr(31),
    v_campaign.id::text,
    v_campaign.state,
    v_version.version::text,
    v_version.digest,
    coalesce(v_schedule, ''));
  v_digest := pg_catalog.encode(extensions.digest(v_canonical, 'sha256'), 'hex');
  v_revision := private.allocate_memory_source_revision(
    p_organization_id, 'campaign_state', v_campaign.id, v_digest);

  select existing.id into v_event_id
  from public.memory_capture_events existing
  where existing.organization_id = p_organization_id
    and existing.campaign_id = v_campaign.id
    and existing.source_revision = v_revision;
  if found then
    return v_event_id;
  end if;

  insert into public.memory_capture_events (
    organization_id, source_kind, campaign_id, source_revision,
    source_digest, event_kind, occurred_at, correlation_id,
    projection_document
  ) values (
    p_organization_id, 'campaign_state', v_campaign.id, v_revision,
    v_digest, 'recorded', pg_catalog.now(), pg_catalog.gen_random_uuid(),
    pg_catalog.jsonb_build_object(
      'campaignId', v_campaign.id,
      'version', v_version.version,
      'bundleVersionId', v_version.id,
      'bundleDigest', v_version.digest,
      'state', v_campaign.state,
      'scheduledFor', coalesce(v_schedule, ''),
      'sourceRevision', v_revision)
  ) returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function private.enqueue_memory_campaign_state(uuid, uuid) from public;

-- Enqueue: settled outcome ----------------------------------------------------

create or replace function private.enqueue_memory_campaign_outcome(
  p_organization_id uuid,
  p_outcome_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture_on boolean;
  v_outcome public.campaign_outcomes;
  v_canonical text;
  v_digest text;
  v_revision bigint;
  v_event_id uuid;
begin
  select settings_row.capture_enabled into v_capture_on
  from public.memory_integration_settings settings_row
  where settings_row.organization_id = p_organization_id;
  if not found or not v_capture_on then
    return null;
  end if;

  select outcome_row.* into v_outcome
  from public.campaign_outcomes outcome_row
  where outcome_row.organization_id = p_organization_id
    and outcome_row.id = p_outcome_id;
  if not found then
    return null;
  end if;
  if v_outcome.superseded_by_id is not null then
    return null;
  end if;

  v_canonical := pg_catalog.concat_ws(pg_catalog.chr(31),
    v_outcome.id::text,
    v_outcome.verdict,
    v_outcome.primary_metric_key,
    v_outcome.baseline_source,
    v_outcome.attribution_method,
    v_outcome.outcome_window_days::text,
    v_outcome.settlement_delay_days::text,
    coalesce(v_outcome.evidence_tier, ''));
  v_digest := pg_catalog.encode(extensions.digest(v_canonical, 'sha256'), 'hex');
  v_revision := private.allocate_memory_source_revision(
    p_organization_id, 'campaign_outcome', v_outcome.id, v_digest);

  select existing.id into v_event_id
  from public.memory_capture_events existing
  where existing.organization_id = p_organization_id
    and existing.campaign_outcome_id = v_outcome.id
    and existing.source_revision = v_revision;
  if found then
    return v_event_id;
  end if;

  insert into public.memory_capture_events (
    organization_id, source_kind, campaign_outcome_id, source_revision,
    source_digest, event_kind, occurred_at, correlation_id,
    reporting_start, reporting_end, projection_document
  ) values (
    p_organization_id, 'campaign_outcome', v_outcome.id, v_revision,
    v_digest, 'recorded', v_outcome.settled_at, pg_catalog.gen_random_uuid(),
    null, null,
    pg_catalog.jsonb_build_object(
      'outcomeId', v_outcome.id,
      'campaignId', v_outcome.campaign_id,
      'verdict', v_outcome.verdict,
      'primaryMetricKey', v_outcome.primary_metric_key,
      'baselineSource', v_outcome.baseline_source,
      'attributionMethod', v_outcome.attribution_method,
      'sourceRevision', v_revision)
  ) returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function private.enqueue_memory_campaign_outcome(uuid, uuid) from public;

-- Enqueue: submitted lesson only ----------------------------------------------

create or replace function private.enqueue_memory_campaign_lesson(
  p_organization_id uuid,
  p_proposal_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture_on boolean;
  v_proposal public.campaign_learning_proposals;
  v_canonical text;
  v_digest text;
  v_revision bigint;
  v_event_id uuid;
begin
  select settings_row.capture_enabled into v_capture_on
  from public.memory_integration_settings settings_row
  where settings_row.organization_id = p_organization_id;
  if not found or not v_capture_on then
    return null;
  end if;

  select proposal_row.* into v_proposal
  from public.campaign_learning_proposals proposal_row
  where proposal_row.organization_id = p_organization_id
    and proposal_row.id = p_proposal_id;
  if not found then
    return null;
  end if;
  if v_proposal.status is distinct from 'submitted_for_promotion' then
    return null;
  end if;

  v_canonical := pg_catalog.concat_ws(pg_catalog.chr(31),
    v_proposal.id::text,
    v_proposal.verdict,
    v_proposal.proposed_lesson,
    v_proposal.status);
  v_digest := pg_catalog.encode(extensions.digest(v_canonical, 'sha256'), 'hex');
  v_revision := private.allocate_memory_source_revision(
    p_organization_id, 'campaign_lesson', v_proposal.id, v_digest);

  select existing.id into v_event_id
  from public.memory_capture_events existing
  where existing.organization_id = p_organization_id
    and existing.campaign_learning_proposal_id = v_proposal.id
    and existing.source_revision = v_revision;
  if found then
    return v_event_id;
  end if;

  insert into public.memory_capture_events (
    organization_id, source_kind, campaign_learning_proposal_id, source_revision,
    source_digest, event_kind, occurred_at, correlation_id,
    projection_document
  ) values (
    p_organization_id, 'campaign_lesson', v_proposal.id, v_revision,
    v_digest, 'submitted', pg_catalog.coalesce(v_proposal.decided_at, pg_catalog.now()), pg_catalog.gen_random_uuid(),
    pg_catalog.jsonb_build_object(
      'proposalId', v_proposal.id,
      'campaignId', v_proposal.campaign_id,
      'verdict', v_proposal.verdict,
      'sourceRevision', v_revision)
  ) returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function private.enqueue_memory_campaign_lesson(uuid, uuid) from public;

-- Projectors ------------------------------------------------------------------

create or replace function private.project_memory_campaign_state(
  p_organization_id uuid,
  p_capture_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.memory_capture_events;
  v_campaign public.campaigns;
  v_version public.campaign_bundle_versions;
  v_title text;
  v_body text;
  v_item_id uuid;
begin
  select event_row.* into v_event
  from public.memory_capture_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.id = p_capture_id;
  if not found then
    raise exception 'memory capture event was not found' using errcode = 'P0002';
  end if;

  select campaign_row.* into v_campaign
  from public.campaigns campaign_row
  where campaign_row.organization_id = v_event.organization_id
    and campaign_row.id = v_event.campaign_id;
  if not found then
    raise exception 'memory capture source is withdrawn' using errcode = 'P0002';
  end if;
  if v_campaign.organization_id is distinct from p_organization_id then
    raise exception 'memory capture source scope is not authorized' using errcode = '42501';
  end if;

  if v_event.event_kind = 'withdrawn' then
    return null;
  end if;

  select version_row.* into v_version
  from public.campaign_bundle_versions version_row
  where version_row.organization_id = p_organization_id
    and version_row.campaign_id = v_campaign.id
  order by version_row.version desc
  limit 1;
  if not found then
    raise exception 'memory capture source is withdrawn' using errcode = 'P0002';
  end if;

  v_title := pg_catalog.substring('Campaign ' || v_campaign.title || ' v' || v_version.version::text, 1, 300);
  v_body := pg_catalog.substring(pg_catalog.concat_ws(E'\n',
    'Campaign lifecycle: version ' || v_version.version::text || ', state ' || v_campaign.state || '.',
    'Scope: organization-wide unless a branch version is named in the roots.',
    'Schedule and status only; assertions, spend, and artwork are never captured here.',
    'Evidence roots: campaign ' || v_campaign.id::text
      || ', bundle version ' || v_version.id::text
      || ', digest ' || v_version.digest || '.'
  ), 1, 2000);

  insert into public.memory_items (
    organization_id, memory_type, title, body, origin,
    verification_state, sensitivity, knowledge_kind, capture_event_id,
    source_reference, observed_at, review_due_at
  ) values (
    p_organization_id, 'episode', v_title, v_body,
    'system_generated', 'unverified', v_event.sensitivity, 'campaign_state',
    v_event.id,
    'campaign_state:' || v_campaign.id::text,
    v_event.occurred_at,
    pg_catalog.now() + interval '30 days'
  ) returning id into v_item_id;

  return v_item_id;
end;
$$;

revoke all on function private.project_memory_campaign_state(uuid, uuid) from public;

create or replace function private.project_memory_campaign_outcome(
  p_organization_id uuid,
  p_capture_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.memory_capture_events;
  v_outcome public.campaign_outcomes;
  v_title text;
  v_body text;
  v_item_id uuid;
begin
  select event_row.* into v_event
  from public.memory_capture_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.id = p_capture_id;
  if not found then
    raise exception 'memory capture event was not found' using errcode = 'P0002';
  end if;

  select outcome_row.* into v_outcome
  from public.campaign_outcomes outcome_row
  where outcome_row.organization_id = v_event.organization_id
    and outcome_row.id = v_event.campaign_outcome_id;
  if not found then
    raise exception 'memory capture source is withdrawn' using errcode = 'P0002';
  end if;
  if v_outcome.organization_id is distinct from p_organization_id then
    raise exception 'memory capture source scope is not authorized' using errcode = '42501';
  end if;
  if v_outcome.superseded_by_id is not null then
    raise exception 'memory capture source is withdrawn' using errcode = 'P0002';
  end if;

  if v_event.event_kind = 'withdrawn' then
    return null;
  end if;

  v_title := pg_catalog.substring('Settled ' || v_outcome.verdict || ' for campaign ' || v_outcome.campaign_id::text, 1, 300);
  v_body := pg_catalog.substring(pg_catalog.concat_ws(E'\n',
    'Settled verdict ' || v_outcome.verdict || ' for the preregistered metric '
      || v_outcome.primary_metric_key || ' against ' || v_outcome.baseline_source || '.',
    'Method ' || v_outcome.attribution_method || ', window ' || v_outcome.outcome_window_days::text
      || ' days with ' || v_outcome.settlement_delay_days::text || ' days settlement delay.',
    'Approval is not publication, exposure, or success; this record carries the settled verdict only.',
    'Evidence roots: outcome ' || v_outcome.id::text
      || ', bundle version ' || v_outcome.bundle_version_id::text
      || ', plan digest ' || v_outcome.plan_digest || '.',
    'Limitations: ' || v_outcome.limitations::text
  ), 1, 2000);

  insert into public.memory_items (
    organization_id, memory_type, title, body, origin,
    verification_state, sensitivity, knowledge_kind, capture_event_id,
    source_reference, observed_at, review_due_at
  ) values (
    p_organization_id, 'outcome', v_title, v_body,
    'system_generated', 'unverified', v_event.sensitivity, 'measured_outcome',
    v_event.id,
    'campaign_outcome:' || v_outcome.id::text,
    v_event.occurred_at,
    pg_catalog.now() + interval '90 days'
  ) returning id into v_item_id;

  return v_item_id;
end;
$$;

revoke all on function private.project_memory_campaign_outcome(uuid, uuid) from public;

create or replace function private.project_memory_campaign_lesson(
  p_organization_id uuid,
  p_capture_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.memory_capture_events;
  v_proposal public.campaign_learning_proposals;
  v_outcome public.campaign_outcomes;
  v_title text;
  v_body text;
  v_item_id uuid;
begin
  select event_row.* into v_event
  from public.memory_capture_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.id = p_capture_id;
  if not found then
    raise exception 'memory capture event was not found' using errcode = 'P0002';
  end if;

  select proposal_row.* into v_proposal
  from public.campaign_learning_proposals proposal_row
  where proposal_row.organization_id = v_event.organization_id
    and proposal_row.id = v_event.campaign_learning_proposal_id;
  if not found then
    raise exception 'memory capture source is withdrawn' using errcode = 'P0002';
  end if;
  if v_proposal.organization_id is distinct from p_organization_id then
    raise exception 'memory capture source scope is not authorized' using errcode = '42501';
  end if;

  if v_proposal.status is distinct from 'submitted_for_promotion' then
    return null;
  end if;

  if v_proposal.verdict in ('inconclusive', 'execution_only')
    and v_proposal.proposed_lesson ~* '(won|winning|wins|proven winner|best practice|always works)' then
    raise exception 'campaign lesson overclaims its verdict' using errcode = '23514';
  end if;

  select outcome_row.* into v_outcome
  from public.campaign_outcomes outcome_row
  where outcome_row.organization_id = p_organization_id
    and outcome_row.id = v_proposal.outcome_id;
  if not found or v_outcome.superseded_by_id is not null then
    raise exception 'memory capture source is withdrawn' using errcode = 'P0002';
  end if;

  if v_event.event_kind = 'withdrawn' then
    return null;
  end if;

  v_title := pg_catalog.substring(v_proposal.proposed_lesson, 1, 300);
  v_body := pg_catalog.substring(pg_catalog.concat_ws(E'\n',
    v_proposal.proposed_lesson,
    'Applies to the campaign it was learned in; promotion decides any wider use.',
    'Evidence roots: proposal ' || v_proposal.id::text
      || ', outcome ' || v_proposal.outcome_id::text
      || ', bundle version ' || v_proposal.bundle_version_id::text || '.'
  ), 1, 2000);

  insert into public.memory_items (
    organization_id, memory_type, title, body, origin,
    verification_state, sensitivity, knowledge_kind, capture_event_id,
    source_reference, observed_at, review_due_at
  ) values (
    p_organization_id, 'lesson', v_title, v_body,
    'outcome_learned', 'unverified', v_event.sensitivity, 'lesson',
    v_event.id,
    'campaign_lesson:' || v_proposal.id::text,
    v_event.occurred_at,
    pg_catalog.now() + interval '90 days'
  ) returning id into v_item_id;

  return v_item_id;
end;
$$;

revoke all on function private.project_memory_campaign_lesson(uuid, uuid) from public;

-- Enqueue triggers (additive; no-op when capture is disabled) ------------------

create or replace function private.enqueue_campaign_state_on_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  select private.enqueue_memory_campaign_state(NEW.organization_id, NEW.campaign_id) into v_event_id;
  return NEW;
end;
$$;

revoke all on function private.enqueue_campaign_state_on_version() from public;

drop trigger if exists memory_campaign_state_on_version on public.campaign_bundle_versions;
create trigger memory_campaign_state_on_version
  after insert on public.campaign_bundle_versions
  for each row execute function private.enqueue_campaign_state_on_version();

create or replace function private.enqueue_campaign_outcome_on_settle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  if NEW.superseded_by_id is not null then
    return NEW;
  end if;
  select private.enqueue_memory_campaign_outcome(NEW.organization_id, NEW.id) into v_event_id;
  return NEW;
end;
$$;

revoke all on function private.enqueue_campaign_outcome_on_settle() from public;

drop trigger if exists memory_campaign_outcome_on_settle on public.campaign_outcomes;
create trigger memory_campaign_outcome_on_settle
  after insert on public.campaign_outcomes
  for each row execute function private.enqueue_campaign_outcome_on_settle();

create or replace function private.enqueue_campaign_lesson_on_submit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  if NEW.status is distinct from 'submitted_for_promotion' then
    return NEW;
  end if;
  if OLD.status is not distinct from 'submitted_for_promotion' then
    return NEW;
  end if;
  select private.enqueue_memory_campaign_lesson(NEW.organization_id, NEW.id) into v_event_id;
  return NEW;
end;
$$;

revoke all on function private.enqueue_campaign_lesson_on_submit() from public;

drop trigger if exists memory_campaign_lesson_on_submit on public.campaign_learning_proposals;
create trigger memory_campaign_lesson_on_submit
  after update on public.campaign_learning_proposals
  for each row execute function private.enqueue_campaign_lesson_on_submit();
