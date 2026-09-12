-- Spec 023 Swarm 2: growth capture adapters (SQL only).
--
-- Growth rows of the adapter table. Live before this slice: queue, leased
-- runtime, allocator, registry (channel kinds), complete_ dispatch. This slice
-- adds: market_claim, growth_item, growth_decision projectors + enqueue paths +
-- registry rows.
--
-- Sections: A registry rows; B enqueue helpers; C projectors; D forward
-- replacements of the owning transactions (byte-for-byte apart from the marked
-- capture lines); E grants. Additive only; no applied file is edited.
--
-- Grounding: market_claim projects the permitted paraphrase plus original source
-- lineage (branch/profile/run ids, source keys/domains) and NEVER excerpt text
-- or quoted provider text (Google/Brave terms). growth_item projects insight/recommendation
-- episodes per the synthesis item; data gaps stay labeled missing-data
-- observations; empty or fully-replayed syntheses enqueue nothing (the synthesis
-- run row is the operational receipt; no knowledge is fabricated). growth_decision
-- projects actor/action/item-fingerprint/time; pins and helpfulness votes are never
-- read; acknowledged vs planned stay distinct with no resolved relabeling.
-- Dependencies come from persisted typed joins only (item claim/finding links,
-- decision->item), are cycle-guarded (cross-kind plus self-edge refusal), and use
-- no model-supplied roots.


-- Spec 023 Swarm 2 Section A: adapter registry rows (growth kinds).
--
-- The queue, leased runtime, allocator and complete_ dispatch are live. These
-- three rows admit the growth kinds to projection; every other kind keeps its
-- existing quarantine behavior until its own slice lands.

insert into public.memory_capture_adapters (source_kind, registered, note) values
  ('market_claim', true, 'Admitted research claims project paraphrase-plus-lineage to observation episodes; excerpts never cross.'),
  ('growth_item', true, 'Synthesis insights/recommendations project as episodes; data gaps stay labeled missing-data observations; empty syntheses fabricate nothing.'),
  ('growth_decision', true, 'Accepted org triage appends project to operator_decision records; pins and helpfulness votes are never read.')
on conflict (source_kind) do update set
  registered = excluded.registered,
  note = excluded.note;

-- Spec 023 Swarm 2 Section B: enqueue helpers (private, definer-nested only).
--
-- All helpers are settings-gated (absent/disabled settings enqueue nothing),
-- digest-gated (unchanged re-delivery reuses the allocator revision and the
-- existence check skips the insert) and transaction-local (a rolled-back source
-- completion removes its events with it). Returns events inserted (or the single
-- event id for the decision path). v_ locals, empty search_path, revoked from
-- every session role: only source transactions reach them nested inside their
-- own fenced RPCs.

create or replace function private.enqueue_memory_market_claims(
  p_organization_id uuid,
  p_market_research_run_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture_on boolean;
  v_run public.market_research_runs;
  v_branch_id uuid;
  v_claim public.market_evidence_claims;
  v_canonical text;
  v_digest text;
  v_revision bigint;
  v_state text;
  v_event_kind text;
  v_occurred_at timestamptz;
  v_count integer := 0;
begin
  select settings_row.capture_enabled into v_capture_on
  from public.memory_integration_settings settings_row
  where settings_row.organization_id = p_organization_id;
  if not found or not v_capture_on then
    return 0;
  end if;

  select run_row.* into v_run
  from public.market_research_runs run_row
  where run_row.organization_id = p_organization_id
    and run_row.id = p_market_research_run_id;
  if not found then
    return 0;
  end if;

  select request_row.branch_id into v_branch_id
  from public.growth_intelligence_requests request_row
  where request_row.organization_id = p_organization_id
    and request_row.id = v_run.growth_intelligence_request_id;
  if not found then
    v_branch_id := null;
  end if;

  for v_claim in
    select claim_row.* from public.market_evidence_claims claim_row
    where claim_row.organization_id = p_organization_id
      and claim_row.market_research_run_id = p_market_research_run_id
    order by claim_row.id
  loop
    -- Canonical state digest (fixed order, unit-separator joined, nulls collapse
    -- to empty). Paraphrase is a permitted hash input; excerpt text and bounded
    -- quoted provider text is NEVER read here (Google/Brave terms) and never enter the
    -- digest, the event, or the projection.
    v_canonical := pg_catalog.concat_ws(pg_catalog.chr(31),
      v_claim.claim_key,
      v_claim.claim_digest,
      v_claim.subject_kind,
      v_claim.subject_ref,
      v_claim.claim_kind,
      coalesce(v_claim.paraphrase, ''),
      v_claim.geographic_layer,
      v_claim.geography_ref,
      v_claim.freshness_class,
      coalesce(v_claim.claim_category, ''),
      coalesce(v_claim.freshness_registry_version::text, ''),
      coalesce(v_claim.published_at::text, ''),
      coalesce(v_claim.observed_at::text, ''),
      coalesce(v_claim.stale_at::text, ''),
      coalesce(v_claim.expires_at::text, ''),
      v_claim.limitations::text,
      v_claim.market_profile_version_id::text,
      v_claim.market_research_run_id::text,
      coalesce(v_branch_id::text, ''));
    v_digest := pg_catalog.encode(extensions.digest(v_canonical, 'sha256'), 'hex');
    v_revision := private.allocate_memory_source_revision(
      p_organization_id, 'market_claim', v_claim.id, v_digest);

    if not exists (
      select 1 from public.memory_capture_events existing
      where existing.organization_id = p_organization_id
        and existing.market_claim_id = v_claim.id
        and existing.source_revision = v_revision
    ) then
      v_state := public.market_evidence_claim_current_state(p_organization_id, v_claim.id);
      if v_state in ('current', 'stale') and not v_claim.text_withdrawn then
        v_event_kind := 'recorded';
        v_occurred_at := v_claim.created_at;
      else
        -- Withdrawn/expired/excluded/superseded claims never record: they enqueue
        -- a withdrawal that projects no new item (P0002 withdrawn path).
        v_event_kind := 'withdrawn';
        v_occurred_at := pg_catalog.now();
      end if;
      insert into public.memory_capture_events (
        organization_id, source_kind, market_claim_id, source_revision,
        source_digest, event_kind, occurred_at, correlation_id, branch_id,
        projection_document
      ) values (
        p_organization_id, 'market_claim', v_claim.id, v_revision,
        v_digest, v_event_kind, v_occurred_at, v_run.correlation_id, v_branch_id,
        pg_catalog.jsonb_build_object(
          'claimId', v_claim.id,
          'researchRunId', v_run.id,
          'profileVersionId', v_claim.market_profile_version_id,
          'branchId', v_branch_id,
          'claimKey', v_claim.claim_key,
          'subjectKind', v_claim.subject_kind,
          'subjectRef', v_claim.subject_ref,
          'sourceRevision', v_revision)
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.enqueue_memory_market_claims(uuid, uuid) from public;

-- Single-claim withdrawn enqueue for the withdrawal/expiry/erasure paths.
-- The withdrawal key binds the memory revision to the market-evidence event that
-- caused it (explicit event digest, or erased|<source>|<erased-digest>), so a
-- retried append/erasure reuses the allocator revision instead of duplicating.

create or replace function private.enqueue_memory_market_claim_withdrawn(
  p_organization_id uuid,
  p_market_claim_id uuid,
  p_withdrawal_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture_on boolean;
  v_claim public.market_evidence_claims;
  v_run public.market_research_runs;
  v_branch_id uuid;
  v_canonical text;
  v_digest text;
  v_revision bigint;
  v_event_id uuid;
begin
  if p_market_claim_id is null
    or p_withdrawal_key is null
    or pg_catalog.char_length(p_withdrawal_key) not between 1 and 300 then
    return null;
  end if;

  select settings_row.capture_enabled into v_capture_on
  from public.memory_integration_settings settings_row
  where settings_row.organization_id = p_organization_id;
  if not found or not v_capture_on then
    return null;
  end if;

  select claim_row.* into v_claim
  from public.market_evidence_claims claim_row
  where claim_row.organization_id = p_organization_id
    and claim_row.id = p_market_claim_id;
  if not found then
    return null;
  end if;

  select run_row.* into v_run
  from public.market_research_runs run_row
  where run_row.organization_id = p_organization_id
    and run_row.id = v_claim.market_research_run_id;
  if not found then
    return null;
  end if;

  select request_row.branch_id into v_branch_id
  from public.growth_intelligence_requests request_row
  where request_row.organization_id = p_organization_id
    and request_row.id = v_run.growth_intelligence_request_id;
  if not found then
    v_branch_id := null;
  end if;

  v_canonical := pg_catalog.concat_ws(pg_catalog.chr(31),
    v_claim.claim_key,
    v_claim.claim_digest,
    v_claim.subject_kind,
    v_claim.subject_ref,
    v_claim.claim_kind,
    coalesce(v_claim.paraphrase, ''),
    v_claim.geographic_layer,
    v_claim.geography_ref,
    v_claim.freshness_class,
    coalesce(v_claim.claim_category, ''),
    coalesce(v_claim.freshness_registry_version::text, ''),
    coalesce(v_claim.published_at::text, ''),
    coalesce(v_claim.observed_at::text, ''),
    coalesce(v_claim.stale_at::text, ''),
    coalesce(v_claim.expires_at::text, ''),
    v_claim.limitations::text,
    v_claim.market_profile_version_id::text,
    v_claim.market_research_run_id::text,
    coalesce(v_branch_id::text, ''),
    'withdrawn',
    p_withdrawal_key);
  v_digest := pg_catalog.encode(extensions.digest(v_canonical, 'sha256'), 'hex');
  v_revision := private.allocate_memory_source_revision(
    p_organization_id, 'market_claim', v_claim.id, v_digest);

  select existing.id into v_event_id
  from public.memory_capture_events existing
  where existing.organization_id = p_organization_id
    and existing.market_claim_id = v_claim.id
    and existing.source_revision = v_revision;
  if found then
    return v_event_id;
  end if;

  insert into public.memory_capture_events (
    organization_id, source_kind, market_claim_id, source_revision,
    source_digest, event_kind, occurred_at, correlation_id, branch_id,
    projection_document
  ) values (
    p_organization_id, 'market_claim', v_claim.id, v_revision,
    v_digest, 'withdrawn', pg_catalog.now(), v_run.correlation_id, v_branch_id,
    pg_catalog.jsonb_build_object(
      'claimId', v_claim.id,
      'researchRunId', v_run.id,
      'withdrawalKey', p_withdrawal_key,
      'sourceRevision', v_revision)
  ) returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function private.enqueue_memory_market_claim_withdrawn(uuid, uuid, text) from public;

-- Growth-item enqueue: one invocation enumerates only the given completed
-- synthesis run's persisted items (typed joins only, never model-supplied
-- roots). Empty syntheses and fingerprint replays enqueue nothing: the
-- synthesis run row itself is the operational completion receipt and no
-- knowledge is fabricated. Supersession is a currency transition, not a
-- withdrawal: a superseded prior keeps its recorded history, so this path
-- never enqueues withdrawn item events (withdrawn events belong to the
-- claim withdrawal/expiry/erasure lifecycle only).

create or replace function private.enqueue_memory_growth_items(
  p_organization_id uuid,
  p_synthesis_run_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture_on boolean;
  v_run public.growth_intelligence_synthesis_runs;
  v_item public.growth_intelligence_items;
  v_claim_ids uuid[];
  v_finding_ids uuid[];
  v_goal_refs text[];
  v_canonical text;
  v_digest text;
  v_revision bigint;
  v_event_id uuid;
  v_parent_id uuid;
  v_cited_id uuid;
  v_count integer := 0;
begin
  select settings_row.capture_enabled into v_capture_on
  from public.memory_integration_settings settings_row
  where settings_row.organization_id = p_organization_id;
  if not found or not v_capture_on then
    return 0;
  end if;

  select run_row.* into v_run
  from public.growth_intelligence_synthesis_runs run_row
  where run_row.organization_id = p_organization_id
    and run_row.id = p_synthesis_run_id;
  if not found then
    return 0;
  end if;

  for v_item in
    select item_row.* from public.growth_intelligence_items item_row
    where item_row.organization_id = p_organization_id
      and item_row.growth_intelligence_synthesis_run_id = p_synthesis_run_id
    order by item_row.id
  loop
    -- Typed evidence only: persisted link tables, never the model-supplied
    -- claimIds/findings arrays. A cycle is impossible across kinds, and the
    -- self-edge is refused below anyway.
    select coalesce(pg_catalog.array_agg(link.market_evidence_claim_id order by link.market_evidence_claim_id), '{}'::uuid[])
      into v_claim_ids
    from public.growth_intelligence_item_market_claims link
    where link.organization_id = p_organization_id
      and link.growth_intelligence_item_id = v_item.id;

    select coalesce(pg_catalog.array_agg(link.finding_id order by link.finding_id), '{}'::uuid[])
      into v_finding_ids
    from public.growth_intelligence_item_channel_findings link
    where link.organization_id = p_organization_id
      and link.growth_intelligence_item_id = v_item.id;

    select coalesce(pg_catalog.array_agg(link.goal_ref order by link.goal_ref), '{}'::text[])
      into v_goal_refs
    from public.growth_intelligence_item_goals link
    where link.organization_id = p_organization_id
      and link.growth_intelligence_item_id = v_item.id;

    v_canonical := pg_catalog.concat_ws(pg_catalog.chr(31),
      v_item.kind,
      v_item.narrative,
      v_item.item_fingerprint,
      v_item.evidence_fingerprint,
      v_item.geographic_layer,
      v_item.geography_ref,
      v_item.support_grade,
      v_item.freshness,
      v_item.urgency,
      v_item.goal_alignment,
      v_item.activity_month,
      coalesce(v_item.missing_input, ''),
      coalesce(v_item.branch_id::text, ''),
      v_item.market_profile_version_id::text,
      v_item.growth_intelligence_synthesis_run_id::text,
      coalesce(pg_catalog.array_to_string(v_claim_ids, ','), ''),
      coalesce(pg_catalog.array_to_string(v_finding_ids, ','), ''),
      coalesce(pg_catalog.array_to_string(v_goal_refs, ','), ''));
    v_digest := pg_catalog.encode(extensions.digest(v_canonical, 'sha256'), 'hex');
    v_revision := private.allocate_memory_source_revision(
      p_organization_id, 'growth_item', v_item.id, v_digest);

    if not exists (
      select 1 from public.memory_capture_events existing
      where existing.organization_id = p_organization_id
        and existing.growth_item_id = v_item.id
        and existing.source_revision = v_revision
    ) then
      insert into public.memory_capture_events (
        organization_id, source_kind, growth_item_id, source_revision,
        source_digest, event_kind, occurred_at, correlation_id, branch_id,
        projection_document
      ) values (
        p_organization_id, 'growth_item', v_item.id, v_revision,
        v_digest, 'recorded', v_item.created_at, v_run.correlation_id, v_item.branch_id,
        pg_catalog.jsonb_build_object(
          'itemId', v_item.id,
          'synthesisRunId', v_run.id,
          'kind', v_item.kind,
          'itemFingerprint', v_item.item_fingerprint,
          'sourceRevision', v_revision)
      ) returning id into v_event_id;
      v_count := v_count + 1;

      foreach v_cited_id in array v_claim_ids loop
        select parent.id into v_parent_id
        from public.memory_capture_events parent
        where parent.organization_id = p_organization_id
          and parent.source_kind = 'market_claim'
          and parent.market_claim_id = v_cited_id
          and parent.status = 'completed'
        order by parent.source_revision desc
        limit 1;
        if found and v_parent_id is distinct from v_event_id then
          insert into public.memory_capture_dependencies (
            organization_id, capture_event_id, parent_capture_event_id, relation
          ) values (
            p_organization_id, v_event_id, v_parent_id, 'derived_from'
          ) on conflict do nothing;
        end if;
      end loop;

      foreach v_cited_id in array v_finding_ids loop
        select parent.id into v_parent_id
        from public.memory_capture_events parent
        where parent.organization_id = p_organization_id
          and parent.source_kind = 'channel_finding'
          and parent.channel_finding_id = v_cited_id
          and parent.status = 'completed'
        order by parent.source_revision desc
        limit 1;
        if found and v_parent_id is distinct from v_event_id then
          insert into public.memory_capture_dependencies (
            organization_id, capture_event_id, parent_capture_event_id, relation
          ) values (
            p_organization_id, v_event_id, v_parent_id, 'derived_from'
          ) on conflict do nothing;
        end if;
      end loop;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.enqueue_memory_growth_items(uuid, uuid) from public;

-- Growth-decision enqueue: one event for one accepted triage append. Each
-- decision is a new source row, so each starts at revision 1; a later decision
-- on the same item is a new event and a new projection, never an edit.

create or replace function private.enqueue_memory_growth_decision(
  p_organization_id uuid,
  p_decision_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capture_on boolean;
  v_decision public.growth_intelligence_item_decisions;
  v_item public.growth_intelligence_items;
  v_run public.growth_intelligence_synthesis_runs;
  v_canonical text;
  v_digest text;
  v_revision bigint;
  v_event_id uuid;
  v_parent_id uuid;
begin
  select settings_row.capture_enabled into v_capture_on
  from public.memory_integration_settings settings_row
  where settings_row.organization_id = p_organization_id;
  if not found or not v_capture_on then
    return null;
  end if;

  select decision_row.* into v_decision
  from public.growth_intelligence_item_decisions decision_row
  where decision_row.organization_id = p_organization_id
    and decision_row.id = p_decision_id;
  if not found then
    return null;
  end if;

  select item_row.* into v_item
  from public.growth_intelligence_items item_row
  where item_row.organization_id = p_organization_id
    and item_row.id = v_decision.growth_intelligence_item_id;
  if not found then
    return null;
  end if;

  select run_row.* into v_run
  from public.growth_intelligence_synthesis_runs run_row
  where run_row.organization_id = p_organization_id
    and run_row.id = v_item.growth_intelligence_synthesis_run_id;
  if not found then
    return null;
  end if;

  v_canonical := pg_catalog.concat_ws(pg_catalog.chr(31),
    v_decision.decision,
    v_decision.growth_intelligence_item_id::text,
    v_decision.actor_id::text,
    coalesce(v_decision.reason, ''),
    coalesce(v_decision.snoozed_until::text, ''),
    v_decision.item_fingerprint);
  v_digest := pg_catalog.encode(extensions.digest(v_canonical, 'sha256'), 'hex');
  v_revision := private.allocate_memory_source_revision(
    p_organization_id, 'growth_decision', v_decision.id, v_digest);

  select existing.id into v_event_id
  from public.memory_capture_events existing
  where existing.organization_id = p_organization_id
    and existing.growth_decision_id = v_decision.id
    and existing.source_revision = v_revision;
  if found then
    return v_event_id;
  end if;

  insert into public.memory_capture_events (
    organization_id, source_kind, growth_decision_id, source_revision,
    source_digest, event_kind, occurred_at, correlation_id, branch_id,
    projection_document
  ) values (
    p_organization_id, 'growth_decision', v_decision.id, v_revision,
    v_digest, 'recorded', v_decision.created_at, v_run.correlation_id, v_item.branch_id,
    pg_catalog.jsonb_build_object(
      'decisionId', v_decision.id,
      'itemId', v_decision.growth_intelligence_item_id,
      'decision', v_decision.decision,
      'actorId', v_decision.actor_id,
      'sourceRevision', v_revision)
  ) returning id into v_event_id;

  -- derived_from edge to the completed capture event of the decided item, where
  -- such an event exists. Typed join only (decision->item), never model input.
  select parent.id into v_parent_id
  from public.memory_capture_events parent
  where parent.organization_id = p_organization_id
    and parent.source_kind = 'growth_item'
    and parent.growth_item_id = v_decision.growth_intelligence_item_id
    and parent.status = 'completed'
  order by parent.source_revision desc
  limit 1;
  if found and v_parent_id is distinct from v_event_id then
    insert into public.memory_capture_dependencies (
      organization_id, capture_event_id, parent_capture_event_id, relation
    ) values (
      p_organization_id, v_event_id, v_parent_id, 'derived_from'
    ) on conflict do nothing;
  end if;

  return v_event_id;
end;
$$;

revoke all on function private.enqueue_memory_growth_decision(uuid, uuid) from public;

-- Spec 023 Swarm 2 Section C: projectors (private, worker-dispatched only).
--
-- Each projector runs inside complete_memory_capture_event's transaction via the
-- leased worker path; member sessions reach them only nested inside the fenced
-- source RPCs, never directly. Withdrawn deliveries project no new item. Missing
-- or ineligible sources raise P0002 (the withdrawn path), never silent nulls,
-- except the withdrawn event_kind which is an explicit no-op returning null.

create or replace function private.project_memory_market_claim(
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
  v_claim_id uuid;
  v_claim_key text;
  v_claim_digest text;
  v_subject_kind text;
  v_subject_ref text;
  v_claim_kind text;
  v_paraphrase text;
  v_geographic_layer text;
  v_geography_ref text;
  v_freshness_class text;
  v_claim_category text;
  v_limitations jsonb;
  v_profile_version_id uuid;
  v_run_id uuid;
  v_branch_id uuid;
  v_created_at timestamptz;
  v_text_withdrawn boolean;
  v_state text;
  v_title text;
  v_body text;
  v_sources text;
  v_item_id uuid;
begin
  select event_row.* into v_event
  from public.memory_capture_events event_row
  where event_row.organization_id = p_organization_id
    and event_row.id = p_capture_id;
  if not found then
    raise exception 'memory capture event was not found' using errcode = 'P0002';
  end if;

  -- Explicit column list: provider excerpts and bounded quotes are NEVER read
  -- (Google/Brave terms). Only the permitted paraphrase plus lineage cross.
  select claim_row.id, claim_row.claim_key, claim_row.claim_digest,
    claim_row.subject_kind, claim_row.subject_ref, claim_row.claim_kind,
    claim_row.paraphrase, claim_row.geographic_layer, claim_row.geography_ref,
    claim_row.freshness_class, claim_row.claim_category, claim_row.limitations,
    claim_row.market_profile_version_id, claim_row.market_research_run_id,
    claim_row.created_at, claim_row.text_withdrawn
  into v_claim_id, v_claim_key, v_claim_digest,
    v_subject_kind, v_subject_ref, v_claim_kind,
    v_paraphrase, v_geographic_layer, v_geography_ref,
    v_freshness_class, v_claim_category, v_limitations,
    v_profile_version_id, v_run_id,
    v_created_at, v_text_withdrawn
  from public.market_evidence_claims claim_row
  where claim_row.organization_id = v_event.organization_id
    and claim_row.id = v_event.market_claim_id;
  if not found then
    raise exception 'memory capture source is withdrawn' using errcode = 'P0002';
  end if;
  if v_event.organization_id is distinct from p_organization_id then
    raise exception 'memory capture source scope is not authorized' using errcode = '42501';
  end if;

  if v_event.event_kind = 'withdrawn' then
    return null;
  end if;

  if v_text_withdrawn then
    raise exception 'memory capture source is withdrawn' using errcode = 'P0002';
  end if;

  v_state := public.market_evidence_claim_current_state(p_organization_id, v_claim_id);
  if v_state is distinct from 'current' and v_state is distinct from 'stale' then
    raise exception 'memory capture source is withdrawn' using errcode = 'P0002';
  end if;

  if v_paraphrase is null or pg_catalog.char_length(v_paraphrase) not between 1 and 1000 then
    raise exception 'memory capture source is not projectable' using errcode = '23514';
  end if;

  select request_row.branch_id into v_branch_id
  from public.market_research_runs run_row
  join public.growth_intelligence_requests request_row
    on request_row.organization_id = run_row.organization_id
    and request_row.id = run_row.growth_intelligence_request_id
  where run_row.organization_id = p_organization_id
    and run_row.id = v_run_id;

  -- Lineage only: supporting source keys and domains. Payload excerpts are never
  -- selected, never copied.
  select pg_catalog.string_agg(
    v_source.source_key || '(' || v_source.source_domain || ')', ', ' order by v_source.source_key)
  into v_sources
  from (
    select distinct source_row.source_key, source_row.source_domain
    from public.market_evidence_links link_row
    join public.market_evidence_sources source_row
      on source_row.organization_id = link_row.organization_id
      and source_row.id = link_row.market_evidence_source_id
    where link_row.organization_id = p_organization_id
      and link_row.market_evidence_claim_id = v_claim_id
      and link_row.relation = 'supports'
      and source_row.availability = 'available'
  ) v_source;

  v_title := pg_catalog.substring(v_claim_kind || ' - ' || v_subject_ref, 1, 300);
  v_body := pg_catalog.substring(pg_catalog.concat_ws(E'\n',
    'Market observation ' || v_claim_kind || ' on ' || v_subject_kind || ' ' || v_subject_ref
      || ' (' || v_geographic_layer || ' ' || v_geography_ref || ').',
    'Paraphrase: ' || v_paraphrase,
    'Evidence roots: claim ' || v_claim_id::text
      || ', research run ' || v_run_id::text
      || ', profile version ' || v_profile_version_id::text
      || case when v_branch_id is null then ', organization scope'
        else ', branch ' || v_branch_id::text end || '.',
    case when v_sources is null then null else 'Sources: ' || v_sources || '.' end,
    'Freshness: ' || v_freshness_class || ', category ' || coalesce(v_claim_category, 'unspecified') || '.',
    'Limitations: ' || v_limitations::text
  ), 1, 2000);

  insert into public.memory_items (
    organization_id, branch_id, memory_type, title, body, origin,
    verification_state, sensitivity, knowledge_kind, capture_event_id,
    source_reference, observed_at, review_due_at
  ) values (
    p_organization_id, v_branch_id, 'episode', v_title, v_body,
    'ai_proposed', 'unverified', v_event.sensitivity, 'observation',
    v_event.id,
    'market_claim:' || v_claim_id::text,
    v_event.occurred_at,
    pg_catalog.now() + interval '30 days'
  ) returning id into v_item_id;

  return v_item_id;
end;
$$;

revoke all on function private.project_memory_market_claim(uuid, uuid) from public;

-- Growth-item projector: synthesis insight/recommendation to episode,
-- data gaps stay labeled missing-data observations. No fabricated knowledge:
-- the narrative and typed lineage on the stored row are the whole projection.

create or replace function private.project_memory_growth_item(
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
  v_item public.growth_intelligence_items;
  v_claim_count integer;
  v_finding_count integer;
  v_knowledge_kind text;
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

  select item_row.* into v_item
  from public.growth_intelligence_items item_row
  where item_row.organization_id = v_event.organization_id
    and item_row.id = v_event.growth_item_id;
  if not found then
    raise exception 'memory capture source is withdrawn' using errcode = 'P0002';
  end if;
  if v_item.organization_id is distinct from p_organization_id then
    raise exception 'memory capture source scope is not authorized' using errcode = '42501';
  end if;

  if v_event.event_kind = 'withdrawn' then
    return null;
  end if;

  select pg_catalog.count(*)::integer into v_claim_count
  from public.growth_intelligence_item_market_claims link_row
  where link_row.organization_id = p_organization_id
    and link_row.growth_intelligence_item_id = v_item.id;

  select pg_catalog.count(*)::integer into v_finding_count
  from public.growth_intelligence_item_channel_findings link_row
  where link_row.organization_id = p_organization_id
    and link_row.growth_intelligence_item_id = v_item.id;

  if v_item.kind = 'insight' then
    v_knowledge_kind := 'observation';
    v_title := pg_catalog.substring(v_item.narrative, 1, 300);
    v_body := pg_catalog.substring(pg_catalog.concat_ws(E'\n',
      'Growth insight for ' || v_item.geographic_layer || ' ' || v_item.geography_ref
        || ' (' || v_item.activity_month || ').',
      v_item.narrative,
      'Support: ' || v_item.support_grade || ', freshness ' || v_item.freshness
        || ', urgency ' || v_item.urgency || ', goal alignment ' || v_item.goal_alignment || '.',
      'Evidence roots: item ' || v_item.id::text
        || ', synthesis run ' || v_item.growth_intelligence_synthesis_run_id::text
        || ', fingerprint ' || v_item.item_fingerprint || '.',
      'Cited claims: ' || v_claim_count::text || '; cited findings: ' || v_finding_count::text || '.'
    ), 1, 2000);
  elsif v_item.kind = 'recommendation' then
    v_knowledge_kind := 'recommendation';
    v_title := pg_catalog.substring(v_item.narrative, 1, 300);
    v_body := pg_catalog.substring(pg_catalog.concat_ws(E'\n',
      'Growth recommendation for ' || v_item.geographic_layer || ' ' || v_item.geography_ref
        || ' (' || v_item.activity_month || ').',
      v_item.narrative,
      'Support: ' || v_item.support_grade || ', freshness ' || v_item.freshness
        || ', urgency ' || v_item.urgency || ', goal alignment ' || v_item.goal_alignment || '.',
      'Evidence roots: item ' || v_item.id::text
        || ', synthesis run ' || v_item.growth_intelligence_synthesis_run_id::text
        || ', fingerprint ' || v_item.item_fingerprint || '.',
      'Cited claims: ' || v_claim_count::text || '; cited findings: ' || v_finding_count::text || '.'
    ), 1, 2000);
  else
    -- data_gap: stays labeled a missing-data observation, never a finding.
    v_knowledge_kind := 'observation';
    v_title := pg_catalog.substring(
      'Missing data: ' || coalesce(v_item.missing_input, v_item.geography_ref), 1, 300);
    v_body := pg_catalog.substring(pg_catalog.concat_ws(E'\n',
      'Missing-data observation for ' || v_item.geographic_layer || ' ' || v_item.geography_ref
        || ' (' || v_item.activity_month || '): this is a data gap, not a finding.',
      'Missing input: ' || coalesce(v_item.missing_input, 'unspecified') || '.',
      v_item.narrative,
      'Evidence roots: item ' || v_item.id::text
        || ', synthesis run ' || v_item.growth_intelligence_synthesis_run_id::text
        || ', fingerprint ' || v_item.item_fingerprint || '.'
    ), 1, 2000);
  end if;

  insert into public.memory_items (
    organization_id, branch_id, memory_type, title, body, origin,
    verification_state, sensitivity, knowledge_kind, capture_event_id,
    source_reference, observed_at, review_due_at
  ) values (
    p_organization_id, v_item.branch_id, 'episode', v_title, v_body,
    'ai_proposed', 'unverified', v_event.sensitivity, v_knowledge_kind,
    v_event.id,
    'growth_item:' || v_item.id::text,
    v_event.occurred_at,
    pg_catalog.now() + interval '14 days'
  ) returning id into v_item_id;

  return v_item_id;
end;
$$;

revoke all on function private.project_memory_growth_item(uuid, uuid) from public;

-- Growth-decision projector: accepted triage append to operator_decision record.
-- Personal pins and helpfulness votes live elsewhere entirely and
-- are never read here. Acknowledged vs planned stay distinct: the stored decision
-- value is recorded verbatim, and resolved never relabels (the triage gate
-- already refuses it; this projector maps nothing).

create or replace function private.project_memory_growth_decision(
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
  v_decision public.growth_intelligence_item_decisions;
  v_item public.growth_intelligence_items;
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

  select decision_row.* into v_decision
  from public.growth_intelligence_item_decisions decision_row
  where decision_row.organization_id = v_event.organization_id
    and decision_row.id = v_event.growth_decision_id;
  if not found then
    raise exception 'memory capture source is withdrawn' using errcode = 'P0002';
  end if;
  if v_decision.organization_id is distinct from p_organization_id then
    raise exception 'memory capture source scope is not authorized' using errcode = '42501';
  end if;

  if v_event.event_kind = 'withdrawn' then
    return null;
  end if;

  select item_row.* into v_item
  from public.growth_intelligence_items item_row
  where item_row.organization_id = v_decision.organization_id
    and item_row.id = v_decision.growth_intelligence_item_id;
  if not found then
    raise exception 'memory capture source is withdrawn' using errcode = 'P0002';
  end if;

  v_title := pg_catalog.substring(
    'Growth decision: ' || v_decision.decision, 1, 300);
  v_body := pg_catalog.substring(pg_catalog.concat_ws(E'\n',
    'Actor ' || v_decision.actor_id::text
      || ' recorded ' || v_decision.decision
      || ' on growth item ' || v_decision.growth_intelligence_item_id::text
      || ' (fingerprint ' || v_decision.item_fingerprint || ')'
      || ' at ' || v_decision.created_at::text || '.',
    case when v_decision.reason is null then null
      else 'Reason: ' || v_decision.reason end,
    case when v_decision.snoozed_until is null then null
      else 'Snoozed until ' || v_decision.snoozed_until::text || '.' end
  ), 1, 2000);

  insert into public.memory_items (
    organization_id, branch_id, memory_type, title, body, origin,
    verification_state, sensitivity, knowledge_kind, capture_event_id,
    source_reference, observed_at
  ) values (
    p_organization_id, v_item.branch_id, 'decision', v_title, v_body,
    'system_generated', 'unverified', v_event.sensitivity, 'operator_decision',
    v_event.id,
    'growth_decision:' || v_decision.id::text,
    v_event.occurred_at
  ) returning id into v_item_id;

  return v_item_id;
end;
$$;

revoke all on function private.project_memory_growth_decision(uuid, uuid) from public;


-- Spec 023 Swarm 2 Section D1: forward replacement of complete_market_research_pipeline.

create or replace function public.complete_market_research_pipeline(
  p_organization_id uuid,
  p_pipeline_id uuid,
  p_market_research_run_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_result jsonb,
  p_coverage jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cmrp_pipeline public.growth_intelligence_research_pipelines;
  cmrp_request public.growth_intelligence_requests;
  cmrp_run public.market_research_runs;
  cmrp_child public.growth_intelligence_requests;
  cmrp_canonical_fingerprint text;
  cmrp_child_fingerprint text;
  cmrp_eligible integer;
  cmrp_recorded_source_count integer;
  cmrp_recorded_success_count integer;
  cmrp_completion jsonb;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'market_research_pipeline_worker_forbidden' using errcode = '42501';
  end if;
  if p_pipeline_id is null
    or p_market_research_run_id is null
    or p_request_id is null
    or p_claim_token is null then
    raise exception 'market_research_pipeline_completion_invalid' using errcode = '22023';
  end if;
  perform private.assert_market_research_result(p_result);
  perform private.assert_research_pipeline_coverage(p_coverage);

  -- Duplicate deliveries serialize on the pipeline, not on each row.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'research_pipeline_complete',
      p_organization_id, p_pipeline_id
    ),
    0
  ));

  select pipeline.* into cmrp_pipeline
  from public.growth_intelligence_research_pipelines pipeline
  where pipeline.organization_id = p_organization_id
    and pipeline.id = p_pipeline_id
  for update;
  if not found then
    raise exception 'market_research_pipeline_not_found' using errcode = '42501';
  end if;

  select request.* into cmrp_request
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
  for update;
  if not found
    or cmrp_request.pipeline_id is distinct from p_pipeline_id
    or cmrp_request.phase is distinct from 'research' then
    raise exception 'market_research_pipeline_request_mismatch' using errcode = '42501';
  end if;

  -- Replay precedes the lease gate, mirroring the legacy completion path:
  -- a committed handoff answers every duplicate delivery identically.
  select run.* into cmrp_run
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id;
  if found and cmrp_run.status <> 'running' then
    if cmrp_run.status = p_result ->> 'outcome'
      and cmrp_run.result_digest = p_result ->> 'resultDigest'
      and cmrp_run.adapter_cost_micros_usd = (p_result ->> 'adapterCostMicrosUsd')::bigint
      and cmrp_run.adapter_latency_ms = (p_result ->> 'adapterLatencyMs')::integer then
      select child.* into cmrp_child
      from public.growth_intelligence_requests child
      where child.organization_id = p_organization_id
        and child.pipeline_id = p_pipeline_id
        and child.phase = 'synthesis';
      select pg_catalog.count(*)::integer into cmrp_eligible
      from public.market_evidence_claims claim
      where claim.organization_id = p_organization_id
        and claim.market_research_run_id = cmrp_run.id
        and public.market_evidence_claim_current_state(
          p_organization_id, claim.id
        ) in ('current', 'stale');
      return pg_catalog.jsonb_build_object(
        'runId', cmrp_run.id,
        'pipelineStage', cmrp_pipeline.stage,
        'synthesisRequestId', case when found then cmrp_child.id else null end,
        'eligibleClaimCount', cmrp_eligible,
        'replayed', true
      );
    end if;
    raise exception 'market_research_run_terminal' using errcode = '23505';
  end if;

  -- Stale leases (expiry or same-branch replacement, which cancels the
  -- claimed request) end here with no mutation.
  if cmrp_request.status <> 'claimed'
    or cmrp_request.claim_token is distinct from p_claim_token
    or cmrp_request.lease_expires_at <= pg_catalog.now() then
    raise exception 'market_research_claim_lost' using errcode = '42501';
  end if;
  if cmrp_pipeline.stage not in ('queued', 'researching') then
    raise exception 'market_research_pipeline_terminal' using errcode = '23505';
  end if;

  -- The pipeline's profile version must still be current and enabled, and
  -- the request must belong to that same version. A confirmed replacement
  -- scope refuses the old run's output instead of scheduling stale analysis.
  if cmrp_request.market_profile_version_id is distinct from
    cmrp_pipeline.market_profile_version_id then
    raise exception 'market_research_pipeline_scope_mismatch' using errcode = '42501';
  end if;
  perform private.assert_research_pipeline_scope(p_organization_id, cmrp_pipeline);

  select run.* into cmrp_run
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token
  for update;
  if not found then
    raise exception 'market_research_run_not_found' using errcode = '42501';
  end if;
  if cmrp_run.status <> 'running' then
    raise exception 'market_research_run_terminal' using errcode = '23505';
  end if;

  select pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where source.availability = 'available')::integer
  into cmrp_recorded_source_count, cmrp_recorded_success_count
  from public.market_evidence_sources source
  where source.organization_id = p_organization_id
    and source.market_research_run_id = cmrp_run.id;
  if cmrp_recorded_source_count <> (p_result ->> 'sourceAttemptCount')::integer
    or cmrp_recorded_success_count <> (p_result ->> 'sourceSuccessCount')::integer then
    raise exception 'market_research_result_source_count_mismatch' using errcode = '22023';
  end if;

  -- Eligibility comes from persisted claims in a citable state, never from
  -- a worker-supplied count. Freshly persisted supported claims are
  -- current; stale-but-supported keeps its verdict for coverage honesty.
  select pg_catalog.count(*)::integer into cmrp_eligible
  from public.market_evidence_claims claim
  where claim.organization_id = p_organization_id
    and claim.market_research_run_id = cmrp_run.id
    and public.market_evidence_claim_current_state(
      p_organization_id, claim.id
    ) in ('current', 'stale');

  update public.market_research_runs
  set status = p_result ->> 'outcome',
      result_digest = p_result ->> 'resultDigest',
      source_attempt_count = (p_result ->> 'sourceAttemptCount')::integer,
      source_success_count = (p_result ->> 'sourceSuccessCount')::integer,
      adapter_cost_micros_usd = (p_result ->> 'adapterCostMicrosUsd')::bigint,
      adapter_latency_ms = (p_result ->> 'adapterLatencyMs')::integer,
      completed_at = pg_catalog.now()
  where organization_id = p_organization_id and id = cmrp_run.id
  returning * into cmrp_run;

  cmrp_completion := public.complete_growth_intelligence_request(
    p_organization_id, p_request_id, p_claim_token
  );
  if cmrp_completion ->> 'outcome' <> 'completed' then
    raise exception 'market_research_request_completion_failed' using errcode = '42501';
  end if;

  -- Business Memory capture (Spec 023 growth adapter): enqueue this run's admitted
  -- claims. One shared point before the stage branch, so ready/partial and
  -- no-findings paths behave identically; the helper no-ops when disabled and
  -- records withdrawn (never recorded) for ineligible claims.
  perform private.enqueue_memory_market_claims(p_organization_id, p_market_research_run_id);

  if cmrp_eligible > 0 then
    -- One unique child per pipeline. The canonical work identity binds the
    -- pipeline id the way deliberate reruns scope their own requests, so a
    -- later pipeline on identical scope never collides on the fingerprint.
    cmrp_canonical_fingerprint :=
      private.create_growth_intelligence_request_fingerprint(
        p_organization_id,
        cmrp_request.branch_id,
        cmrp_request.channel_id,
        'market_evidence_changed',
        'market_research_completed',
        null,
        cmrp_request.market_profile_version_id,
        cmrp_request.source_policy_digest,
        cmrp_request.research_rule_version,
        'immediate',
        null,
        null
      );
    cmrp_child_fingerprint := pg_catalog.encode(
      extensions.digest(
        cmrp_canonical_fingerprint || '|' || p_pipeline_id::text,
        'sha256'
      ),
      'hex'
    );
    insert into public.growth_intelligence_requests (
      organization_id, branch_id, channel_id, kind, trigger_reason,
      request_fingerprint, business_evidence_digest, market_profile_version_id,
      source_policy_digest, research_rule_version, local_time_bucket,
      synthesis_version_tuple, playbook_version_tuple, due_at, requested_by,
      last_transition_actor_type, last_transition_actor_id, correlation_id,
      pipeline_id, phase
    ) values (
      p_organization_id,
      cmrp_request.branch_id,
      cmrp_request.channel_id,
      'market_evidence_changed',
      'market_research_completed',
      cmrp_child_fingerprint,
      null,
      cmrp_request.market_profile_version_id,
      cmrp_request.source_policy_digest,
      cmrp_request.research_rule_version,
      'immediate',
      null,
      null,
      pg_catalog.now(),
      null,
      'system'::public.audit_actor_type,
      null,
      cmrp_request.correlation_id,
      p_pipeline_id,
      'synthesis'
    ) returning * into cmrp_child;

    update public.growth_intelligence_research_pipelines pipeline
    set stage = 'preparing_insights',
        synthesis_request_id = cmrp_child.id,
        coverage = p_coverage,
        stage_changed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where pipeline.organization_id = p_organization_id
      and pipeline.id = p_pipeline_id
    returning * into cmrp_pipeline;

    insert into public.audit_events (
      organization_id, event_name, actor_type, actor_id, entity_type, entity_id,
      correlation_id, payload
    ) values (
      p_organization_id,
      'growth_intelligence.research_prepared',
      'system'::public.audit_actor_type,
      null,
      'growth_intelligence_research_pipeline',
      p_pipeline_id,
      cmrp_request.correlation_id,
      pg_catalog.jsonb_build_object(
        'pipelineId', p_pipeline_id,
        'stage', 'preparing_insights',
        'researchRequestId', p_request_id,
        'synthesisRequestId', cmrp_child.id,
        'eligibleClaimCount', cmrp_eligible
      )
    );

    return pg_catalog.jsonb_build_object(
      'runId', cmrp_run.id,
      'pipelineStage', 'preparing_insights',
      'synthesisRequestId', cmrp_child.id,
      'eligibleClaimCount', cmrp_eligible,
      'replayed', false
    );
  end if;

  update public.growth_intelligence_research_pipelines pipeline
  set stage = 'no_findings',
      safe_failure_code = 'NO_ELIGIBLE_FINDINGS',
      coverage = p_coverage,
      stage_changed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where pipeline.organization_id = p_organization_id
    and pipeline.id = p_pipeline_id
  returning * into cmrp_pipeline;

  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id,
    correlation_id, payload
  ) values (
    p_organization_id,
    'growth_intelligence.research_prepared',
    'system'::public.audit_actor_type,
    null,
    'growth_intelligence_research_pipeline',
    p_pipeline_id,
    cmrp_request.correlation_id,
    pg_catalog.jsonb_build_object(
      'pipelineId', p_pipeline_id,
      'stage', 'no_findings',
      'researchRequestId', p_request_id,
      'reason', 'NO_ELIGIBLE_FINDINGS',
      'eligibleClaimCount', 0
    )
  );

  return pg_catalog.jsonb_build_object(
    'runId', cmrp_run.id,
    'pipelineStage', 'no_findings',
    'synthesisRequestId', null,
    'eligibleClaimCount', 0,
    'replayed', false
  );
end;
$$;


-- Spec 023 Swarm 2 Section D2: forward replacement of complete_market_research_run (legacy non-pipeline path).

create or replace function public.complete_market_research_run(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_market_research_run_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
  run_row public.market_research_runs;
  completion jsonb;
  recorded_source_count integer;
  recorded_success_count integer;
begin
  -- Pipeline-bound runs complete through complete_market_research_pipeline.
  -- This legacy path refuses them before the replay shortcut below, so a
  -- stale worker cannot bypass the atomic handoff with old outputs.
  perform 1
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
    and request.pipeline_id is not null;
  if found then
    raise exception 'market_research_pipeline_bypass_forbidden' using errcode = '42501';
  end if;
  if p_market_research_run_id is null then
    raise exception 'market_research_completion_invalid' using errcode = '22023';
  end if;
  perform private.assert_market_research_result(p_result);
  select run.* into run_row
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token;
  if found and run_row.status <> 'running' then
    if run_row.status = p_result ->> 'outcome'
      and run_row.result_digest = p_result ->> 'resultDigest'
      and run_row.adapter_cost_micros_usd = (p_result ->> 'adapterCostMicrosUsd')::bigint
      and run_row.adapter_latency_ms = (p_result ->> 'adapterLatencyMs')::integer then
      return pg_catalog.jsonb_build_object(
        'runId', run_row.id, 'status', run_row.status, 'replayed', true
      );
    end if;
    raise exception 'market_research_run_terminal' using errcode = '23505';
  end if;
  request_row := private.assert_market_research_claim(p_organization_id, p_request_id, p_claim_token);

  select run.* into run_row
  from public.market_research_runs run
  where run.organization_id = p_organization_id
    and run.id = p_market_research_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token
  for update;
  if not found then
    raise exception 'market_research_run_not_found' using errcode = '42501';
  end if;
  if run_row.status <> 'running' then
    if run_row.status = p_result ->> 'outcome'
      and run_row.result_digest = p_result ->> 'resultDigest'
      and run_row.adapter_cost_micros_usd = (p_result ->> 'adapterCostMicrosUsd')::bigint
      and run_row.adapter_latency_ms = (p_result ->> 'adapterLatencyMs')::integer then
      return pg_catalog.jsonb_build_object(
        'runId', run_row.id, 'status', run_row.status, 'replayed', true
      );
    end if;
    raise exception 'market_research_run_terminal' using errcode = '23505';
  end if;

  select pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (where source.availability = 'available')::integer
  into recorded_source_count, recorded_success_count
  from public.market_evidence_sources source
  where source.organization_id = p_organization_id
    and source.market_research_run_id = run_row.id;
  if recorded_source_count <> (p_result ->> 'sourceAttemptCount')::integer
    or recorded_success_count <> (p_result ->> 'sourceSuccessCount')::integer then
    raise exception 'market_research_result_source_count_mismatch' using errcode = '22023';
  end if;

  update public.market_research_runs
  set status = p_result ->> 'outcome',
      result_digest = p_result ->> 'resultDigest',
      source_attempt_count = (p_result ->> 'sourceAttemptCount')::integer,
      source_success_count = (p_result ->> 'sourceSuccessCount')::integer,
      adapter_cost_micros_usd = (p_result ->> 'adapterCostMicrosUsd')::bigint,
      adapter_latency_ms = (p_result ->> 'adapterLatencyMs')::integer,
      completed_at = pg_catalog.now()
  where organization_id = p_organization_id and id = run_row.id
  returning * into run_row;

  completion := public.complete_growth_intelligence_request(
    p_organization_id, p_request_id, p_claim_token
  );
  if completion ->> 'outcome' <> 'completed' then
    raise exception 'market_research_request_completion_failed' using errcode = '42501';
  end if;

  -- Business Memory capture (Spec 023 growth adapter): enqueue this run's admitted
  -- claims. Settings/digest-gated inside the helper; no-ops when disabled.
  perform private.enqueue_memory_market_claims(p_organization_id, p_market_research_run_id);

  return pg_catalog.jsonb_build_object(
    'runId', run_row.id, 'status', run_row.status, 'replayed', false
  );
end;
$$;


-- Spec 023 Swarm 2 Section D3: forward replacement of complete_growth_intelligence_synthesis (inner).

create or replace function public.complete_growth_intelligence_synthesis(
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
  request_row public.growth_intelligence_requests;
  run_row public.growth_intelligence_synthesis_runs;
  item_record jsonb;
  item_row public.growth_intelligence_items;
  item_branch_id uuid;
  claim_id uuid;
  finding_record jsonb;
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
  request_row := private.assert_growth_intelligence_synthesis_claim(
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
      or ((item_record ->> 'branchId') is not null
        and (item_record ->> 'branchId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
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
    -- The effective item branch is the explicit key when present and the
    -- claimed request branch otherwise. An explicit key must match exactly:
    -- privileged worker access never makes cross-branch support admissible.
    if (item_record ? 'branchId') then
      item_branch_id := (item_record ->> 'branchId')::uuid;
    else
      item_branch_id := request_row.branch_id;
    end if;
    if item_branch_id is distinct from request_row.branch_id then
      raise exception 'growth_intelligence_synthesis_branch_mismatch' using errcode = '42501';
    end if;
    -- Exact branch/profile/run support, checked again: each cited claim
    -- belongs to the run's profile version, is currently eligible (current
    -- or explicitly stale), was researched for this same branch, and keeps
    -- at least one supports edge from an available source.
    for claim_id in
      select claim_id.value::uuid
      from pg_catalog.jsonb_array_elements_text(item_record -> 'claimIds') as claim_id(value)
    loop
      perform 1
      from public.market_evidence_claims claim
      where claim.organization_id = p_organization_id
        and claim.id = claim_id
        and claim.market_profile_version_id = run_row.market_profile_version_id
        and public.market_evidence_claim_current_state(p_organization_id, claim.id)
          in ('current', 'stale');
      if not found then
        raise exception 'growth_intelligence_synthesis_support_inadmissible'
          using errcode = '42501';
      end if;
      perform 1
      from public.market_evidence_claims claim
      join public.market_research_runs research
        on research.organization_id = claim.organization_id
        and research.id = claim.market_research_run_id
      join public.growth_intelligence_requests research_request
        on research_request.organization_id = research.organization_id
        and research_request.id = research.growth_intelligence_request_id
      where claim.organization_id = p_organization_id
        and claim.id = claim_id
        and research_request.branch_id is not distinct from request_row.branch_id;
      if not found then
        raise exception 'growth_intelligence_synthesis_support_inadmissible'
          using errcode = '42501';
      end if;
      perform 1
      from public.market_evidence_links link
      join public.market_evidence_sources source
        on source.organization_id = link.organization_id
        and source.id = link.market_evidence_source_id
      where link.organization_id = p_organization_id
        and link.market_evidence_claim_id = claim_id
        and link.relation = 'supports'
        and source.availability = 'available';
      if not found then
        raise exception 'growth_intelligence_synthesis_support_inadmissible'
          using errcode = '42501';
      end if;
      -- A contradicted claim never supports advice, even with a live edge.
      perform 1
      from public.market_evidence_links link
      where link.organization_id = p_organization_id
        and link.market_evidence_claim_id = claim_id
        and link.relation = 'contradicts';
      if found then
        raise exception 'growth_intelligence_synthesis_support_inadmissible'
          using errcode = '42501';
      end if;
    end loop;
    -- Business findings likewise: open, same branch, digest-identical, from
    -- a completed scope-agreeing analysis run.
    for finding_record in
      select finding.value
      from pg_catalog.jsonb_array_elements(item_record -> 'findings') as finding(value)
    loop
      perform 1
      from public.channel_findings finding
      join public.channel_analysis_runs run
        on run.organization_id = finding.organization_id
        and run.id = finding.analysis_run_id
      where finding.organization_id = p_organization_id
        and finding.id = (finding_record ->> 'id')::uuid
        and finding.status = 'open'
        and finding.calculation_digest = (finding_record ->> 'digest')
        and finding.branch_id is not distinct from request_row.branch_id
        and run.status = 'completed'
        and run.branch_id is not distinct from finding.branch_id;
      if not found then
        raise exception 'growth_intelligence_synthesis_finding_inadmissible'
          using errcode = '42501';
      end if;
    end loop;
    insert into public.growth_intelligence_items (
      organization_id, growth_intelligence_synthesis_run_id, market_profile_version_id,
      branch_id,
      kind, narrative, item_fingerprint, evidence_fingerprint,
      geographic_layer, geography_ref, support_grade, freshness, urgency, goal_alignment,
      activity_month, missing_input
    ) values (
      p_organization_id, p_synthesis_run_id, run_row.market_profile_version_id,
      item_branch_id,
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
  select coalesce(
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

  -- Business Memory capture (Spec 023 growth adapter): enqueue this run's items from
  -- the persisted typed joins only. Zero-new-item completions (fingerprint replay or
  -- an empty synthesis) enqueue nothing: the run row itself is the operational
  -- receipt and no knowledge is fabricated.
  perform private.enqueue_memory_growth_items(p_organization_id, p_synthesis_run_id);

  return pg_catalog.jsonb_build_object(
    'runId', run_row.id, 'status', 'completed', 'itemCount', stored_item_count,
    'supersededItemIds', superseded_item_ids
  );
end;
$$;


-- Spec 023 Swarm 2 Section D4: forward replacement of complete_market_synthesis_pipeline (outer).

create or replace function public.complete_market_synthesis_pipeline(
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
  cmsp_pipeline public.growth_intelligence_research_pipelines;
  cmsp_request public.growth_intelligence_requests;
  cmsp_run public.growth_intelligence_synthesis_runs;
  cmsp_inner jsonb;
  cmsp_completion jsonb;
  cmsp_stage text;
  cmsp_fresh integer;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'growth_intelligence_synthesis_worker_forbidden' using errcode = '42501';
  end if;
  if p_request_id is null
    or p_claim_token is null
    or p_synthesis_run_id is null
    or pg_catalog.jsonb_typeof(p_result) <> 'object'
    or (p_result ->> 'outcome') <> 'completed'
    or coalesce(p_result ->> 'resultDigest', '') !~ '^[a-f0-9]{64}$'
    or pg_catalog.jsonb_typeof(p_result -> 'items') is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_result -> 'items') > 200 then
    raise exception 'growth_intelligence_synthesis_result_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'synthesis_pipeline_complete',
      p_organization_id, p_request_id, p_claim_token
    ),
    0
  ));

  select request.* into cmsp_request
  from public.growth_intelligence_requests request
  where request.organization_id = p_organization_id
    and request.id = p_request_id
  for update;
  if not found
    or cmsp_request.pipeline_id is null
    or cmsp_request.phase is distinct from 'synthesis' then
    raise exception 'market_synthesis_pipeline_child_invalid' using errcode = '42501';
  end if;

  select pipeline.* into cmsp_pipeline
  from public.growth_intelligence_research_pipelines pipeline
  where pipeline.organization_id = p_organization_id
    and pipeline.id = cmsp_request.pipeline_id
  for update;
  if not found then
    raise exception 'market_research_pipeline_not_found' using errcode = '42501';
  end if;

  -- Cancelled work fences, never conflicts: a replaced pipeline cannot
  -- become finalizable, so late deliveries stop instead of retrying.
  if cmsp_request.status = 'cancelled'
    or cmsp_pipeline.stage = 'cancelled' then
    raise exception 'growth_intelligence_synthesis_claim_lost' using errcode = '42501';
  end if;

  -- Replay precedes the lease gate, mirroring the research handoff: a
  -- committed finalization answers every duplicate child execution
  -- identically, even though its request already succeeded. Lock order
  -- stays request, pipeline, run in both synthesis RPCs; the research
  -- handoff cannot interleave because the child only exists after it
  -- commits.
  select run.* into cmsp_run
  from public.growth_intelligence_synthesis_runs run
  where run.organization_id = p_organization_id
    and run.id = p_synthesis_run_id
    and run.growth_intelligence_request_id = p_request_id;
  if found and cmsp_run.status <> 'running' then
    if cmsp_run.status = 'completed'
      and cmsp_run.result_digest = p_result ->> 'resultDigest'
      and cmsp_request.status = 'succeeded'
      and cmsp_pipeline.stage in ('ready', 'partial') then
      -- Business Memory capture (Spec 023 growth adapter): a replayed duplicate of a
      -- pre-adapter completion still enqueues through the digest gate; post-adapter
      -- replays are a harmless no-op.
      perform private.enqueue_memory_growth_items(p_organization_id, p_synthesis_run_id);
      return pg_catalog.jsonb_build_object(
        'runId', cmsp_run.id,
        'itemCount', cmsp_run.item_count,
        'supersededItemIds', pg_catalog.jsonb_build_array(),
        'pipelineStage', cmsp_pipeline.stage,
        'replayed', true
      );
    end if;
    raise exception 'growth_intelligence_synthesis_run_terminal' using errcode = '23505';
  end if;
  if not found then
    raise exception 'growth_intelligence_synthesis_run_not_running' using errcode = '22023';
  end if;

  -- The claim gate doubles as the cancellation fence: a replaced or
  -- cancelled child is no longer claimed, so late deliveries refuse here
  -- with no writes, while spend receipts still reconcile through settle.
  perform private.assert_growth_intelligence_synthesis_claim(
    p_organization_id, p_request_id, p_claim_token
  );

  select run.* into cmsp_run
  from public.growth_intelligence_synthesis_runs run
  where run.organization_id = p_organization_id
    and run.id = p_synthesis_run_id
    and run.growth_intelligence_request_id = p_request_id
    and run.claim_token = p_claim_token
  for update;
  if not found then
    raise exception 'growth_intelligence_synthesis_run_not_running' using errcode = '22023';
  end if;
  if cmsp_run.status <> 'running' then
    raise exception 'growth_intelligence_synthesis_run_terminal' using errcode = '23505';
  end if;

  if cmsp_pipeline.stage <> 'preparing_insights' then
    raise exception 'market_research_pipeline_terminal' using errcode = '23505';
  end if;

  -- Scope and freshness are re-checked at finalization: a moved profile or
  -- fully stale evidence refuses persisted output, never silently ages it.
  if cmsp_request.market_profile_version_id is distinct from
    cmsp_pipeline.market_profile_version_id then
    raise exception 'market_research_pipeline_scope_mismatch' using errcode = '42501';
  end if;
  perform private.assert_research_pipeline_scope(p_organization_id, cmsp_pipeline);
  select pg_catalog.count(*)::integer into cmsp_fresh
  from public.market_evidence_claims claim
  where claim.organization_id = p_organization_id
    and claim.market_profile_version_id = cmsp_pipeline.market_profile_version_id
    and public.market_evidence_claim_current_state(
      p_organization_id, claim.id
    ) = 'current';
  if cmsp_fresh < 1 then
    raise exception 'market_synthesis_evidence_stale' using errcode = '42501';
  end if;

  -- No budget gate here: the synthesis call was already admitted through
  -- the pipeline reservation before it ran, and finalizing adds no spend.
  -- Recorded overruns never strand ready output; they block new calls at
  -- reserve time instead.
  cmsp_inner := public.complete_growth_intelligence_synthesis(
    p_organization_id, p_request_id, p_claim_token, p_synthesis_run_id, p_result
  );

  cmsp_completion := public.complete_growth_intelligence_request(
    p_organization_id, p_request_id, p_claim_token
  );
  if cmsp_completion ->> 'outcome' <> 'completed' then
    raise exception 'market_synthesis_request_completion_failed' using errcode = '42501';
  end if;

  -- A partial research run carries its limitations into synthesis: any
  -- non-supported coverage entry ends the pipeline partial, never ready.
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(cmsp_pipeline.coverage) as entry(value)
    where entry.value ->> 'outcome' <> 'supported'
  ) then
    cmsp_stage := 'partial';
  else
    cmsp_stage := 'ready';
  end if;

  update public.growth_intelligence_research_pipelines pipeline
  set stage = cmsp_stage,
      stage_changed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where pipeline.organization_id = p_organization_id
    and pipeline.id = cmsp_pipeline.id
  returning * into cmsp_pipeline;

  insert into public.audit_events (
    organization_id, event_name, actor_type, actor_id, entity_type, entity_id,
    correlation_id, payload
  ) values (
    p_organization_id,
    'growth_intelligence.research_finished',
    'system'::public.audit_actor_type,
    null,
    'growth_intelligence_research_pipeline',
    cmsp_pipeline.id,
    cmsp_request.correlation_id,
    pg_catalog.jsonb_build_object(
      'pipelineId', cmsp_pipeline.id,
      'stage', cmsp_stage,
      'synthesisRequestId', p_request_id,
      'itemCount', (cmsp_inner ->> 'itemCount')::integer
    )
  );

  -- Business Memory capture (Spec 023 growth adapter): idempotent re-enqueue; the inner
  -- synthesis call already enqueued this run, so this is a no-op there and a safety net
  -- when the inner path is ever bypassed.
  perform private.enqueue_memory_growth_items(p_organization_id, p_synthesis_run_id);

  return pg_catalog.jsonb_build_object(
    'runId', cmsp_run.id,
    'itemCount', (cmsp_inner ->> 'itemCount')::integer,
    'supersededItemIds', cmsp_inner -> 'supersededItemIds',
    'pipelineStage', cmsp_stage,
    'replayed', false
  );
end;
$$;


-- Spec 023 Swarm 2 Section D5: forward replacement of decide_growth_intelligence_item.

create or replace function public.decide_growth_intelligence_item(
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
  -- a deterministic compatible-input path exists.
  if p_decision = 'resolved' then
    raise exception 'growth_intelligence_data_gap_resolution_forbidden' using errcode = '22023';
  end if;
  -- Spec 022 sections 9.6 and 10: each kind answers only its own
  -- questions. An Insight may be acknowledged or pinned; only a
  -- Recommendation may be planned, snoozed, or dismissed; a Data Gap takes
  -- acknowledgement or pins while it waits on evidence. The check sits after
  -- the fingerprint match and the resolution bar, so a stale reading still
  -- reports stale and a resolution attempt still reports forbidden, never
  -- merely invalid.
  if (item_row.kind = 'insight' and p_decision not in ('acknowledged', 'pinned', 'unpinned'))
    or (item_row.kind = 'recommendation' and p_decision not in (
      'acknowledged', 'pinned', 'unpinned', 'planned', 'snoozed', 'dismissed'))
    or (item_row.kind = 'data_gap' and p_decision not in ('acknowledged', 'pinned', 'unpinned'))
  then
    raise exception 'growth_intelligence_item_decision_invalid' using errcode = '22023';
  end if;
  insert into public.growth_intelligence_item_decisions (
    organization_id, growth_intelligence_item_id, actor_id,
    decision, reason, snoozed_until, item_fingerprint
  ) values (
    p_organization_id, p_item_id, p_actor_id,
    p_decision, nullif(p_reason, ''), p_snoozed_until, p_item_fingerprint
  )
  returning * into decision_row;

  -- Business Memory capture (Spec 023 growth adapter): one event for this accepted
  -- triage append. The helper no-ops when capture is disabled. Pins and helpfulness
  -- votes live in other tables and are never read here.
  perform private.enqueue_memory_growth_decision(p_organization_id, decision_row.id);

  return pg_catalog.jsonb_build_object(
    'decisionId', decision_row.id, 'decision', decision_row.decision
  );
end;
$$;


-- Spec 023 Swarm 2 Section D6: forward replacement of append_market_evidence_claim_event.

create or replace function public.append_market_evidence_claim_event(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_event_type text,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
  claim_row public.market_evidence_claims;
  computed_event_digest text;
  event_row public.market_evidence_claim_events;
  target_claim_id uuid;
begin
  if p_event_type not in ('expired', 'withdrawn', 'excluded', 'corrected', 'superseded')
    or not private.jsonb_object_has_exact_keys(p_event, array['claimId', 'reasonCode', 'occurredAt']::text[])
    or coalesce(p_event ->> 'claimId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_event ->> 'reasonCode', '') !~ '^[A-Z][A-Z0-9_]{2,80}$'
    or coalesce(p_event ->> 'occurredAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then
    raise exception 'market_evidence_claim_event_invalid' using errcode = '22023';
  end if;
  target_claim_id := (p_event ->> 'claimId')::uuid;
  request_row := private.assert_market_research_claim(p_organization_id, p_request_id, p_claim_token);
  select claim.* into claim_row
  from public.market_evidence_claims claim
  join public.market_research_runs run
    on run.organization_id = claim.organization_id
    and run.id = claim.market_research_run_id
  where claim.organization_id = p_organization_id
    and claim.id = target_claim_id
    and run.market_profile_version_id = request_row.market_profile_version_id
  for update of claim;
  if not found then
    raise exception 'market_evidence_claim_not_found' using errcode = '42501';
  end if;
  computed_event_digest := pg_catalog.encode(
    extensions.digest(
      private.canonical_json_text(
        pg_catalog.jsonb_build_object(
          'claimId', target_claim_id,
          'eventType', p_event_type,
          'event', p_event
        )
      ),
      'sha256'
    ),
    'hex'
  );
  select event.* into event_row
  from public.market_evidence_claim_events event
  where event.organization_id = p_organization_id
    and event.market_evidence_claim_id = target_claim_id
    and event.event_digest = computed_event_digest;
  if found then
    return pg_catalog.jsonb_build_object(
      'claimId', claim_row.id, 'eventId', event_row.id, 'replayed', true
    );
  end if;
  insert into public.market_evidence_claim_events (
    organization_id, market_evidence_claim_id, event_type, event_digest, reason, occurred_at
  ) values (
    p_organization_id, claim_row.id, p_event_type, computed_event_digest,
    p_event ->> 'reasonCode', (p_event ->> 'occurredAt')::timestamptz
  ) returning * into event_row;

  -- Business Memory capture (Spec 023 growth adapter): withdrawal/expiry/exclusion
  -- enqueues a withdrawn memory event for this claim. Digest-gated; replayed
  -- deliveries reuse the same memory revision.
  perform private.enqueue_memory_market_claim_withdrawn(
    p_organization_id, claim_row.id, computed_event_digest);

  return pg_catalog.jsonb_build_object(
    'claimId', claim_row.id, 'eventId', event_row.id, 'replayed', false
  );
end;
$$;


-- Spec 023 Swarm 2 Section D7: forward replacement of erase_research_source_payload.

create or replace function public.erase_research_source_payload(
  p_organization_id uuid,
  p_source_id uuid,
  p_reason_code text,
  p_include_derived_text boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ers_source public.market_evidence_sources;
  ers_claim_row public.market_evidence_claims;
  ers_erased_at timestamptz;
  ers_event_digest text;
  ers_affected integer := 0;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'research_erasure_forbidden' using errcode = '42501';
  end if;
  if p_source_id is null
    or coalesce(p_reason_code, '') !~ '^[A-Z][A-Z0-9_]{2,80}$'
    or p_include_derived_text is null then
    raise exception 'research_erasure_invalid' using errcode = '22023';
  end if;
  select source.* into ers_source
  from public.market_evidence_sources source
  where source.organization_id = p_organization_id
    and source.id = p_source_id
  for update;
  if not found then
    raise exception 'research_erasure_not_found' using errcode = '42501';
  end if;
  if ers_source.erased_at is not null then
    return pg_catalog.jsonb_build_object(
      'sourceId', ers_source.id,
      'erasedClaims', 0,
      'erasedAt', ers_source.erased_at,
      'replayed', true
    );
  end if;
  ers_erased_at := pg_catalog.now();
  update public.market_evidence_sources
  set excerpt_text = null,
      excerpt_digest = null,
      availability = case
        when ers_source.availability = 'available' then 'unavailable'
        else ers_source.availability
      end,
      safe_failure_code = coalesce(ers_source.safe_failure_code, 'SOURCE_EVIDENCE_WITHDRAWN'),
      erased_at = ers_erased_at,
      erasure_reason_code = p_reason_code
  where organization_id = p_organization_id and id = p_source_id;
  for ers_claim_row in
    select claim.*
    from public.market_evidence_claims claim
    join public.market_evidence_links link
      on link.organization_id = claim.organization_id
      and link.market_evidence_claim_id = claim.id
    where link.organization_id = p_organization_id
      and link.market_evidence_source_id = p_source_id
      and link.relation = 'supports'
  loop
    if p_include_derived_text and not ers_claim_row.text_withdrawn then
      update public.market_evidence_claims
      set paraphrase = null,
          quotation = null,
          text_withdrawn = true
      where organization_id = p_organization_id and id = ers_claim_row.id;
    end if;
    ers_event_digest := pg_catalog.encode(
      extensions.digest(
        ers_claim_row.claim_digest || '|erased|' || p_source_id::text, 'sha256'
      ),
      'hex'
    );
    insert into public.market_evidence_claim_events (
      organization_id, market_evidence_claim_id, event_type, event_digest, reason, occurred_at
    ) values (
      p_organization_id, ers_claim_row.id, 'erased', ers_event_digest, p_reason_code, ers_erased_at
    );
    ers_affected := ers_affected + 1;

    -- Business Memory capture (Spec 023 growth adapter): immediate descendant blocking
    -- through the existing erase path, then a digest-gated withdrawn memory event.
    -- Erasure first preserves the withdrawn event's lineage document; both steps are
    -- bounded by this affected-claim loop.
    perform public.erase_memory_source_content(
      p_organization_id, null, 'market_claim', ers_claim_row.id, p_reason_code);
    perform private.enqueue_memory_market_claim_withdrawn(
      p_organization_id, ers_claim_row.id, ers_event_digest);
  end loop;
  return pg_catalog.jsonb_build_object(
    'sourceId', p_source_id,
    'erasedClaims', ers_affected,
    'erasedAt', ers_erased_at,
    'replayed', false
  );
end;
$$;


-- Spec 023 Swarm 2 Section E: forward-replacement grants (unchanged from live).
--
-- Each revoke/grant below repeats the live grant of the replaced function so the
-- replacement neither widens nor narrows its caller set. Private helpers above
-- stay revoked from every session role: only their owning fenced RPCs reach them
-- nested in definer rights.

revoke all on function public.complete_market_research_pipeline(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_market_research_pipeline(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb)
  to service_role;

revoke all on function public.complete_market_research_run(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_market_research_run(uuid, uuid, uuid, uuid, jsonb)
  to service_role;

revoke all on function public.complete_growth_intelligence_synthesis(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_growth_intelligence_synthesis(uuid, uuid, uuid, uuid, jsonb)
  to service_role;

revoke all on function public.complete_market_synthesis_pipeline(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_market_synthesis_pipeline(uuid, uuid, uuid, uuid, jsonb)
  to service_role;

revoke all on function public.decide_growth_intelligence_item(uuid, uuid, uuid, text, text, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_growth_intelligence_item(uuid, uuid, uuid, text, text, timestamptz, text)
  to authenticated, service_role;

revoke all on function public.append_market_evidence_claim_event(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.append_market_evidence_claim_event(uuid, uuid, uuid, text, jsonb)
  to service_role;

revoke all on function public.erase_research_source_payload(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.erase_research_source_payload(uuid, uuid, text, boolean)
  to service_role;
