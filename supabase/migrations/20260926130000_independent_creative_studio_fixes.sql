-- Independent Creative Studio Task 3 fix round 1 (forward corrective migration).
--
-- The base migration 20260921130000 is LIVE and immutable, so every Task 3
-- review finding that touches the database lands here instead. Nothing below
-- edits, drops, or renames a live behavior that already works; each block
-- names the finding it closes (C1–C4, I1/I2/I7, M2/M3/M5–M10, code review
-- Important 2/3, code minor 7).
--
-- Zero-row facts the safe rebuilds rely on: no export row can exist (export
-- admission always raised before this fix), no acceptance row can exist
-- (acceptance always raised), and no image version row can exist (image
-- completion always raised). Runs, events, uploads, policies, and documents
-- may hold rows; every change to those tables is nullable-additive.

-- ---------------------------------------------------------------------------
-- C1: break the versions↔continuations insert deadlock. The continuation row
-- is inserted first referencing a version created later in the same
-- transaction, so its foreign key defers to commit. The reverse leg
-- (versions.continuation_fk) stays immediate: by the time the version row is
-- inserted, the continuation exists.
-- ---------------------------------------------------------------------------
alter table public.studio_continuations
  drop constraint studio_continuations_version_fk;
alter table public.studio_continuations
  add constraint studio_continuations_version_fk
  foreign key (organization_id, version_id)
  references public.studio_versions (organization_id, id)
  on delete cascade
  deferrable initially deferred;

-- ---------------------------------------------------------------------------
-- C2 + M2: export preassignment that survives the admission→completion gap.
-- Deferral cannot help across transactions, so admission records the
-- preassigned export id in a plain column and completion promotes it to
-- result_export_id after verifying the receipt. The preset travels with the
-- export row and joins the dedup key, so same-dimension presets no longer
-- merge (M2); transform_version joins it too, matching Task 2's export
-- identity (the version pin covers the source bytes).
-- ---------------------------------------------------------------------------
alter table public.studio_runs
  add column preassigned_export_id uuid null;

alter table public.studio_exports add column preset text null;
-- No backfill: no export row can exist (see header). The SET NOT NULL below
-- fails loudly rather than corrupting identity if that ever proves wrong.
alter table public.studio_exports alter column preset set not null;
alter table public.studio_exports
  add constraint studio_exports_preset_allowed check (preset in (
    'instagram_feed', 'instagram_stories', 'google_square',
    'google_horizontal', 'google_vertical', 'ecommerce_creative'
  ));

drop index public.studio_exports_dedup_idx;
create unique index studio_exports_dedup_idx
  on public.studio_exports (
    organization_id, studio_version_id, preset_version, preset,
    transform_version, transform
  );

-- ---------------------------------------------------------------------------
-- M6: stop squatting provider_request_id for the worker id. Claims record the
-- worker here; the real provider request id lands from the generation_started
-- event. Pre-fix rows may carry worker ids in provider_request_id; post-fix
-- only real provider ids are written there.
-- ---------------------------------------------------------------------------
alter table public.studio_runs
  add column worker_id text null
  constraint studio_runs_worker_id_length
  check (worker_id is null or char_length(worker_id) between 1 and 120);

-- ---------------------------------------------------------------------------
-- M9a/M9b: the explicit identity + lineage the other tables already carry.
-- ---------------------------------------------------------------------------
alter table public.studio_run_events
  add constraint studio_run_events_org_identity
  unique (organization_id, id);

alter table public.studio_versions
  add constraint studio_versions_run_fk
  foreign key (run_id)
  references public.studio_runs (id)
  on delete restrict;

-- ---------------------------------------------------------------------------
-- Code minor 7: pin the upload transfer to the exact reserved object name, so
-- a reservation for one filename cannot land bytes under another.
-- ---------------------------------------------------------------------------
drop policy "actors transfer own studio uploads" on storage.objects;
create policy "actors transfer own studio uploads"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'studio-uploads'
  and cardinality(storage.foldername(name)) >= 2
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1 from public.studio_uploads upload
    where upload.id = ((storage.foldername(name))[2])::uuid
      and upload.organization_id = ((storage.foldername(name))[1])::uuid
      and upload.actor_id = (select auth.uid())
      and upload.state = 'reserved'
      and upload.expires_at > now()
      and name = upload.reserved_path
  )
);

-- ---------------------------------------------------------------------------
-- M9d: the immutability trigger refused with 25001 (invalid transaction
-- state), outside the repo's 42501/23505/22023 set. Grants are preserved by
-- CREATE OR REPLACE; existing triggers keep pointing at this function.
-- ---------------------------------------------------------------------------
create or replace function public.studio_prevent_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'studio_immutable' using errcode = '42501';
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- I2 (guard half): retrieval-success lands through recovery-claim plus
-- completion, so `completed` also accepts `outcome_unknown`. The Task 2
-- TRANSITIONS mirror gains the same edge; the two are reviewed together.
-- ---------------------------------------------------------------------------
create or replace function private.studio_assert_transition(
  current_state text,
  event_kind text
)
returns text
language plpgsql
as $$
declare
  allowed boolean := false;
begin
  case event_kind
    when 'studio.run.references_prepared' then
      allowed := current_state = 'queued';
    when 'studio.run.generation_started' then
      allowed := current_state = 'preparing';
    when 'studio.run.preview_available' then
      allowed := current_state in ('generating', 'previewing');
    when 'studio.run.output_validated' then
      allowed := current_state in ('generating', 'previewing');
    when 'studio.run.completed' then
      -- Recovery completion: an unknown run whose provider result was
      -- retrieved and validated lands exactly like a normal completion.
      allowed := current_state in (
        'validating', 'cancel_requested', 'outcome_unknown'
      );
    when 'studio.run.failed' then
      allowed := current_state in (
        'queued', 'preparing', 'generating', 'previewing', 'validating',
        'cancel_requested'
      );
    when 'studio.run.cancel_requested' then
      allowed := current_state in (
        'queued', 'preparing', 'generating', 'previewing', 'validating'
      );
    when 'studio.run.cancelled' then
      allowed := current_state = 'cancel_requested';
    when 'studio.run.outcome_unknown' then
      allowed := current_state in (
        'preparing', 'generating', 'previewing', 'validating',
        'cancel_requested'
      );
    when 'studio.campaign_link_created', 'studio.campaign_link_blocked',
         'studio.campaign_link_resolved' then
      allowed := current_state = 'ready';
    else
      raise exception 'studio_run_unknown_event' using errcode = '22023';
  end case;

  if not allowed then
    raise exception 'studio_run_illegal_transition' using errcode = '22023';
  end if;

  case event_kind
    when 'studio.run.references_prepared' then return 'preparing';
    when 'studio.run.generation_started' then return 'generating';
    when 'studio.run.preview_available' then return 'previewing';
    when 'studio.run.output_validated' then return 'validating';
    when 'studio.run.completed' then return 'ready';
    when 'studio.run.failed' then return 'failed';
    when 'studio.run.cancel_requested' then return 'cancel_requested';
    when 'studio.run.cancelled' then return 'cancelled';
    when 'studio.run.outcome_unknown' then return 'outcome_unknown';
    else return 'ready';
  end case;
end;
$$;

-- ---------------------------------------------------------------------------
-- NULL-fencing (code Important 2/3): every nullable input field gains an
-- explicit `is null` disjunct, because `NULL NOT IN (...)` and `NULL !~ ...`
-- evaluate to NULL and a NULL IF condition does NOT raise — the old code let
-- kind-less, mime-less, and digest-less inputs slip through to raw constraint
-- errors (or, for JSONB columns, straight into storage). The rewrites below
-- are otherwise identical to the live bodies.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_studio_upload(
  target_organization_id uuid,
  input_upload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid;
  kind text;
  declared_size bigint;
  declared_mime text;
  filename text;
  rights jsonb;
  accepted boolean := false;
  reservation_id uuid := pg_catalog.gen_random_uuid();
  reserved_path text;
  expires_at timestamptz := pg_catalog.now() + pg_catalog.make_interval(hours => 1);
begin
  caller := (select auth.uid());
  if caller is null
    or not private.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
    raise exception 'studio_upload_forbidden' using errcode = '42501';
  end if;

  if pg_catalog.jsonb_typeof(input_upload) is distinct from 'object' then
    raise exception 'studio_upload_invalid' using errcode = '22023';
  end if;
  kind := input_upload->>'kind';
  declared_mime := input_upload->>'declaredMime';
  filename := pg_catalog.btrim(coalesce(input_upload->>'filename', ''));
  rights := input_upload->'rightsAttestation';
  begin
    declared_size := (input_upload->>'declaredSize')::bigint;
    accepted := (rights->>'accepted')::boolean;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      declared_size := -1;
      accepted := false;
  end;
  if kind is null
    or kind not in ('design', 'product', 'brand_mark')
    or declared_size is null
    or declared_size not between 1 and 15728640
    or declared_mime is null
    or declared_mime not in ('image/png', 'image/jpeg', 'image/webp')
    or filename = ''
    or pg_catalog.char_length(filename) > 200
    or filename ~ '[\\/]'
    or pg_catalog.jsonb_typeof(rights) is distinct from 'object'
    or accepted is distinct from true then
    raise exception 'studio_upload_invalid' using errcode = '22023';
  end if;

  reserved_path :=
    target_organization_id::text || '/' || reservation_id::text || '/' || filename;

  insert into public.studio_uploads (
    id, organization_id, actor_id, reserved_path, state, rights_attestation,
    expires_at
  ) values (
    reservation_id, target_organization_id, caller, reserved_path, 'reserved',
    rights, expires_at
  );

  return pg_catalog.jsonb_build_object(
    'uploadId', reservation_id,
    'reservedPath', reserved_path,
    'expiresAt', expires_at
  );
end;
$$;

create or replace function public.save_studio_generation_policy(
  target_organization_id uuid,
  input_policy jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  enabled boolean;
  currency text;
  per_run bigint;
  window_ceiling bigint;
  window_seconds integer;
  max_pending integer;
  max_attempts integer;
  next_version integer;
begin
  if (select auth.uid()) is null
    or not private.has_organization_role(
      target_organization_id,
      array['owner', 'admin']::public.organization_role[]
    ) then
    raise exception 'studio_policy_forbidden' using errcode = '42501';
  end if;

  if pg_catalog.jsonb_typeof(input_policy) is distinct from 'object' then
    raise exception 'studio_policy_invalid' using errcode = '22023';
  end if;
  begin
    enabled := (input_policy->>'enabled')::boolean;
    currency := input_policy->>'currency';
    per_run := (input_policy->>'perRunCeilingMinor')::bigint;
    window_ceiling := (input_policy->>'windowCeilingMinor')::bigint;
    window_seconds := (input_policy->>'windowSeconds')::integer;
    max_pending := (input_policy->>'maxPending')::integer;
    max_attempts := (input_policy->>'maxAttempts')::integer;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'studio_policy_invalid' using errcode = '22023';
  end;
  if enabled is null
    or currency is null or currency !~ '^[A-Z]{3}$'
    or per_run is null or per_run < 0
    or window_ceiling is null or window_ceiling < 0
    or window_seconds is null or window_seconds <= 0
    or max_pending is null or max_pending <= 0
    or max_attempts is null or max_attempts <= 0 then
    raise exception 'studio_policy_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws('|', 'studio', 'policy', target_organization_id::text), 0
  ));

  select pg_catalog.coalesce(pg_catalog.max(policy.version), 0) + 1 into next_version
  from public.studio_generation_policies policy
  where policy.organization_id = target_organization_id;

  insert into public.studio_generation_policies (
    organization_id, version, enabled, currency, per_run_ceiling_minor,
    window_ceiling_minor, window_seconds, max_pending, max_attempts
  ) values (
    target_organization_id, next_version, enabled, currency, per_run,
    window_ceiling, window_seconds, max_pending, max_attempts
  );

  return pg_catalog.jsonb_build_object('version', next_version);
end;
$$;

create or replace function public.admit_studio_run(
  target_organization_id uuid,
  input_run jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid;
  v_document_id uuid;
  v_expected_revision integer;
  v_parent_version_id uuid;
  v_operation text;
  v_idempotency_key text;
  v_profile_id uuid;
  v_requested_campaign_id uuid;
  v_request_digest text;
  v_request jsonb;
  v_estimated_cost bigint;
  v_currency text;
  doc public.studio_documents;
  parent public.studio_versions;
  policy public.studio_generation_policies;
  existing public.studio_runs;
  created public.studio_runs;
  spent_in_window bigint;
  pending_count integer;
  attempt_no integer;
  active_image uuid;
begin
  caller := (select auth.uid());
  if caller is null
    or not private.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
    raise exception 'studio_run_forbidden' using errcode = '42501';
  end if;

  if pg_catalog.jsonb_typeof(input_run) is distinct from 'object' then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;
  begin
    v_document_id := (input_run->>'documentId')::uuid;
    v_expected_revision := (input_run->>'expectedRevision')::integer;
    v_parent_version_id := nullif(input_run->>'parentVersionId', '')::uuid;
    v_profile_id := (input_run->>'profileId')::uuid;
    v_requested_campaign_id := nullif(input_run->>'requestedCampaignId', '')::uuid;
    v_estimated_cost := coalesce(input_run->>'estimatedCostMinor', '0')::bigint;
    v_idempotency_key := pg_catalog.btrim(coalesce(input_run->>'idempotencyKey', ''));
    v_operation := input_run->>'operation';
    v_currency := coalesce(input_run->>'currency', '');
    v_request_digest := input_run->>'requestDigest';
    v_request := input_run->'request';
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'studio_run_invalid' using errcode = '22023';
  end;
  if v_document_id is null
    or v_expected_revision is null or v_expected_revision <= 0
    or v_profile_id is null
    or v_idempotency_key = ''
    or pg_catalog.char_length(v_idempotency_key) not between 8 and 200
    or v_operation is null
    or v_operation not in ('generate', 'edit', 'enhance', 'new_idea')
    or v_estimated_cost is null or v_estimated_cost < 0
    or v_currency !~ '^[A-Z]{3}$'
    or v_request_digest is null or v_request_digest !~ '^[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(v_request) is distinct from 'object'
    or (v_operation = 'edit' and v_parent_version_id is null) then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'studio', 'admit_run', target_organization_id::text,
      caller::text, v_idempotency_key
    ), 0
  ));

  select run.* into existing
  from public.studio_runs run
  where run.organization_id = target_organization_id
    and run.actor_id = caller
    and run.idempotency_key = v_idempotency_key
  for update;
  if found then
    if existing.request_digest is distinct from v_request_digest then
      raise exception 'studio_run_key_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'runId', existing.id, 'replayed', true, 'state', existing.state,
      'reservationMinor', existing.reserved_minor,
      'policyVersion', existing.policy_version
    );
  end if;

  select document.* into doc
  from public.studio_documents document
  where document.organization_id = target_organization_id
    and document.id = v_document_id
  for update;
  if not found then
    raise exception 'studio_run_document_not_found' using errcode = '22023';
  end if;
  if doc.revision is distinct from v_expected_revision then
    raise exception 'studio_run_stale_revision' using errcode = '23505';
  end if;

  if v_parent_version_id is not null then
    select version.* into parent
    from public.studio_versions version
    where version.organization_id = target_organization_id
      and version.id = v_parent_version_id;
    if not found then
      raise exception 'studio_run_parent_not_found' using errcode = '22023';
    end if;
    if parent.document_id is distinct from v_document_id then
      raise exception 'studio_run_parent_not_found' using errcode = '22023';
    end if;
  end if;

  if v_requested_campaign_id is not null then
    perform 1
    from public.campaigns campaign
    where campaign.id = v_requested_campaign_id
      and campaign.organization_id = target_organization_id;
    if not found then
      raise exception 'studio_run_campaign_not_found' using errcode = '22023';
    end if;
    -- M8: this repeats the entry role check verbatim, and that is deliberate
    -- today: campaign.edit is operator-and-above, exactly the admitted set, so
    -- the check documents the campaign boundary rather than narrowing it. If
    -- the bundles ever diverge, this is the line that must change.
    if not private.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
      raise exception 'studio_run_forbidden' using errcode = '42501';
    end if;
  end if;

  select policy.* into policy
  from public.studio_generation_policies policy
  where policy.organization_id = target_organization_id
  order by policy.version desc
  limit 1
  for update;
  if not found then
    raise exception 'studio_run_no_policy' using errcode = '22023';
  end if;
  if not policy.enabled then
    raise exception 'studio_run_generation_disabled' using errcode = '22023';
  end if;
  if policy.currency is distinct from v_currency then
    raise exception 'studio_run_currency_mismatch' using errcode = '22023';
  end if;
  if v_estimated_cost > policy.per_run_ceiling_minor then
    raise exception 'studio_run_per_run_ceiling_exceeded' using errcode = '22023';
  end if;

  -- M7: the window guards outstanding exposure, not settled spend. Estimates
  -- stand in for reservations (actuals arrive only at settlement), settled
  -- failures and cancels release their reservations, and unknown outcomes
  -- keep holding theirs until reconciled. Conservative by construction.
  select pg_catalog.coalesce(pg_catalog.sum(run.reserved_minor), 0) into spent_in_window
  from public.studio_runs run
  where run.organization_id = target_organization_id
    and run.created_at > pg_catalog.now()
      - pg_catalog.make_interval(secs => policy.window_seconds)
    and run.state not in ('failed', 'cancelled');
  if spent_in_window + v_estimated_cost > policy.window_ceiling_minor then
    raise exception 'studio_run_window_ceiling_exceeded' using errcode = '22023';
  end if;

  select pg_catalog.count(*) into pending_count
  from public.studio_runs run
  where run.organization_id = target_organization_id
    and run.state not in ('ready', 'failed', 'cancelled', 'outcome_unknown');
  if pending_count >= policy.max_pending then
    raise exception 'studio_run_too_many_pending' using errcode = '22023';
  end if;

  select pg_catalog.count(*) + 1 into attempt_no
  from public.studio_runs run
  where run.organization_id = target_organization_id
    and run.actor_id = caller
    and run.request_digest = v_request_digest;
  if attempt_no > policy.max_attempts then
    raise exception 'studio_run_attempt_limit_exceeded' using errcode = '22023';
  end if;

  if v_operation in ('generate', 'edit') then
    select run.id into active_image
    from public.studio_runs run
    where run.organization_id = target_organization_id
      and run.document_id = v_document_id
      and run.operation in ('generate', 'edit')
      and run.state not in ('ready', 'failed', 'cancelled', 'outcome_unknown')
    limit 1;
    if found then
      raise exception 'studio_run_document_busy' using errcode = '23505';
    end if;
  end if;

  insert into public.studio_runs (
    organization_id, document_id, actor_id, operation, expected_revision,
    parent_version_id, request, request_digest, idempotency_key,
    requested_campaign_id, profile_id,
    policy_version, reserved_minor, currency, state, attempt
  ) values (
    target_organization_id, v_document_id, caller, v_operation,
    v_expected_revision, v_parent_version_id, v_request, v_request_digest,
    v_idempotency_key, v_requested_campaign_id, v_profile_id,
    policy.version, v_estimated_cost,
    v_currency, 'queued', attempt_no
  ) returning * into created;

  insert into public.studio_run_events (
    organization_id, run_id, kind, safe_payload
  ) values (
    target_organization_id, created.id, 'studio.run.accepted',
    pg_catalog.jsonb_build_object('stage', 'queued')
  );

  return pg_catalog.jsonb_build_object(
    'runId', created.id, 'replayed', false, 'state', created.state,
    'reservationMinor', created.reserved_minor, 'policyVersion', policy.version
  );
end;
$$;

create or replace function public.complete_studio_upload(
  target_organization_id uuid,
  target_upload_id uuid,
  input_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload public.studio_uploads;
  verdict text;
  v_final_hash text;
  v_final_mime text;
  v_final_width integer;
  v_final_height integer;
  v_final_bytes bigint;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'studio_upload_forbidden' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(input_receipt) is distinct from 'object' then
    raise exception 'studio_upload_invalid' using errcode = '22023';
  end if;

  select upload.* into upload
  from public.studio_uploads upload
  where upload.organization_id = target_organization_id
    and upload.id = target_upload_id
  for update;
  if not found then
    raise exception 'studio_upload_not_found' using errcode = '22023';
  end if;
  if upload.state <> 'reserved' then
    return pg_catalog.jsonb_build_object(
      'uploadId', upload.id, 'state', upload.state, 'replayed', true
    );
  end if;

  verdict := input_receipt->>'verdict';
  if upload.expires_at <= pg_catalog.now() then
    update public.studio_uploads
    set state = 'expired'
    where organization_id = target_organization_id and id = target_upload_id;
    return pg_catalog.jsonb_build_object(
      'uploadId', upload.id, 'state', 'expired', 'replayed', false
    );
  end if;

  if verdict = 'rejected' then
    update public.studio_uploads
    set state = 'rejected'
    where organization_id = target_organization_id and id = target_upload_id;
    return pg_catalog.jsonb_build_object(
      'uploadId', upload.id, 'state', 'rejected', 'replayed', false
    );
  end if;
  if verdict is distinct from 'ready' then
    raise exception 'studio_upload_invalid' using errcode = '22023';
  end if;

  begin
    v_final_hash := input_receipt->>'finalHash';
    v_final_mime := input_receipt->>'finalMime';
    v_final_width := (input_receipt->>'finalWidth')::integer;
    v_final_height := (input_receipt->>'finalHeight')::integer;
    v_final_bytes := (input_receipt->>'finalBytes')::bigint;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'studio_upload_invalid' using errcode = '22023';
  end;
  if v_final_hash is null or v_final_hash !~ '^[0-9a-f]{64}$'
    or v_final_mime is null
    or v_final_mime not in ('image/png', 'image/jpeg', 'image/webp')
    or v_final_width is null or v_final_width not between 200 and 8000
    or v_final_height is null or v_final_height not between 200 and 8000
    or v_final_bytes is null or v_final_bytes <= 0
    or v_final_bytes > 15728640 then
    raise exception 'studio_upload_invalid' using errcode = '22023';
  end if;

  update public.studio_uploads
  set state = 'ready',
      final_hash = v_final_hash,
      final_mime = v_final_mime,
      final_width = v_final_width,
      final_height = v_final_height,
      final_bytes = v_final_bytes
  where organization_id = target_organization_id and id = target_upload_id;

  return pg_catalog.jsonb_build_object(
    'uploadId', upload.id, 'state', 'ready', 'replayed', false
  );
end;
$$;

-- C4: a run that was cancelled before any worker claimed it carries a NULL
-- lease and must stay claimable — otherwise the run wedges unsettlable and
-- the document-busy fence bricks the document with no API recovery. M6: the
-- claiming worker records itself in worker_id; provider_request_id is left
-- for the real provider id carried by generation_started.
create or replace function public.claim_studio_run(
  target_run_id uuid,
  target_worker_id text,
  lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.studio_runs;
  token uuid := pg_catalog.gen_random_uuid();
  expires_at timestamptz;
  max_attempts integer;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'studio_run_forbidden' using errcode = '42501';
  end if;
  if target_worker_id is null
    or pg_catalog.char_length(target_worker_id) not between 1 and 120
    or lease_seconds is null
    or lease_seconds not between 10 and 3600 then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;

  select run.* into run
  from public.studio_runs run
  where run.id = target_run_id
  for update;
  if not found then
    raise exception 'studio_run_not_found' using errcode = '22023';
  end if;
  if run.state in ('ready', 'failed', 'cancelled') then
    raise exception 'studio_run_not_claimable' using errcode = '22023';
  end if;
  if run.state not in ('queued', 'outcome_unknown') then
    -- A live worker owns it; only an absent or expired lease may be claimed.
    -- The lease_token conjunct is the C4 fix: without it, a never-leased
    -- cancel_requested run reads as lease-held and wedges forever.
    if run.lease_token is not null
      and (run.lease_expires_at is null
        or run.lease_expires_at > pg_catalog.now()) then
      raise exception 'studio_run_lease_held' using errcode = '23505';
    end if;
  elsif run.lease_token is not null
    and run.lease_expires_at is not null
    and run.lease_expires_at > pg_catalog.now() then
    raise exception 'studio_run_lease_held' using errcode = '23505';
  end if;

  select policy.max_attempts into max_attempts
  from public.studio_generation_policies policy
  where policy.organization_id = run.organization_id
    and policy.version = run.policy_version;
  if run.lease_token is not null and run.attempt + 1 > coalesce(max_attempts, 1) then
    raise exception 'studio_run_attempt_limit_exceeded' using errcode = '22023';
  end if;

  expires_at := pg_catalog.now() + pg_catalog.make_interval(secs => lease_seconds);

  update public.studio_runs
  set lease_token = token,
      lease_expires_at = expires_at,
      worker_id = target_worker_id,
      attempt = case when run.lease_token is null then run.attempt else run.attempt + 1 end
  where id = target_run_id;

  return pg_catalog.jsonb_build_object(
    'runId', run.id, 'leaseToken', token, 'leaseExpiresAt', expires_at,
    'state', run.state
  );
end;
$$;

-- M6 (provider half): generation_started may carry the real provider request
-- id, which lands in provider_request_id for unknown-outcome retrieval.
-- Preview receipts gain the same NULL-fencing as every other validator.
create or replace function public.append_studio_run_event(
  target_run_id uuid,
  target_lease_token uuid,
  input_event jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.studio_runs;
  kind text;
  next_state text;
  payload jsonb;
  preview jsonb;
  v_provider_request_id text;
  frame_id uuid;
  event_id bigint;
  forbidden_key text;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'studio_run_forbidden' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(input_event) is distinct from 'object' then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;
  kind := input_event->>'kind';
  payload := coalesce(input_event->'safePayload', '{}'::jsonb);
  if pg_catalog.jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;

  select key into forbidden_key
  from pg_catalog.jsonb_object_keys(payload) key
  where key not in (
    'stage', 'frameIndex', 'previewId', 'errorCode', 'anomaly'
  )
  limit 1;
  if found then
    raise exception 'studio_run_event_forbidden_key' using errcode = '22023';
  end if;

  select run.* into run
  from public.studio_runs run
  where run.id = target_run_id
  for update;
  if not found then
    raise exception 'studio_run_not_found' using errcode = '22023';
  end if;
  if run.lease_token is distinct from target_lease_token
    or run.lease_expires_at is null
    or run.lease_expires_at <= pg_catalog.now() then
    raise exception 'studio_run_lease_lost' using errcode = '22023';
  end if;

  next_state := private.studio_assert_transition(run.state, kind);

  if kind in (
    'studio.campaign_link_created', 'studio.campaign_link_blocked',
    'studio.campaign_link_resolved'
  ) then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;

  if kind = 'studio.run.generation_started' then
    v_provider_request_id := nullif(input_event->>'providerRequestId', '');
    if v_provider_request_id is not null
      and pg_catalog.char_length(v_provider_request_id) > 200 then
      raise exception 'studio_run_invalid' using errcode = '22023';
    end if;
    if v_provider_request_id is not null then
      update public.studio_runs
      set provider_request_id = v_provider_request_id
      where id = target_run_id;
    end if;
  end if;

  if kind = 'studio.run.preview_available' then
    preview := input_event->'preview';
    if pg_catalog.jsonb_typeof(preview) is distinct from 'object'
      or (preview->>'frameIndex') is null
      or (preview->>'privatePath') is null
      or (preview->>'contentHash') is null
      or (preview->>'contentHash') !~ '^[0-9a-f]{64}$'
      or (preview->>'mime') is null
      or (preview->>'mime') not in ('image/png', 'image/jpeg', 'image/webp')
      or (preview->>'width') is null
      or (preview->>'height') is null then
      raise exception 'studio_run_invalid' using errcode = '22023';
    end if;
    begin
      if (preview->>'frameIndex')::integer < 0
        or (preview->>'width')::integer not between 1 and 16384
        or (preview->>'height')::integer not between 1 and 16384
        or pg_catalog.char_length(preview->>'privatePath') not between 1 and 1024 then
        raise exception 'studio_run_invalid' using errcode = '22023';
      end if;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'studio_run_invalid' using errcode = '22023';
    end;

    insert into public.studio_preview_frames (
      organization_id, run_id, frame_index, private_path, content_hash, mime,
      width, height, expires_at
    ) values (
      run.organization_id, run.id, (preview->>'frameIndex')::integer,
      preview->>'privatePath', preview->>'contentHash', preview->>'mime',
      (preview->>'width')::integer, (preview->>'height')::integer,
      pg_catalog.now() + pg_catalog.make_interval(hours => 24)
    )
    on conflict (run_id, frame_index) do nothing
    returning id into frame_id;

    if frame_id is null then
      select frame.id into frame_id
      from public.studio_preview_frames frame
      where frame.run_id = target_run_id
        and frame.frame_index = (preview->>'frameIndex')::integer;
    end if;
    payload := payload || pg_catalog.jsonb_build_object('previewId', frame_id);
  end if;

  update public.studio_runs
  set state = next_state
  where id = target_run_id;

  insert into public.studio_run_events (
    organization_id, run_id, kind, safe_payload
  ) values (
    run.organization_id, run.id, kind, payload
  ) returning sequence into event_id;

  return event_id;
end;
$$;

-- M3: suggestion completions validate the usage block Task 2 requires.
-- M9c: preview retention runs 24h after the terminal write, not after each
-- frame insert. Suggestion and output receipts gain NULL-fencing, and the
-- replay-expiry cast moves inside the handled block.
create or replace function public.complete_studio_run(
  target_run_id uuid,
  target_lease_token uuid,
  input_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.studio_runs;
  doc public.studio_documents;
  next_state text;
  v_ordinal integer;
  version_id uuid := pg_catalog.gen_random_uuid();
  continuation_id uuid := pg_catalog.gen_random_uuid();
  branch boolean := false;
  link_status text := 'none';
  preview_count integer;
  payload jsonb;
  event_sequence bigint;
  output jsonb;
  continuation jsonb;
  usage jsonb;
  replay_expires_at timestamptz;
  actual_cost bigint;
  v_export_id uuid;
  acceptance_count integer;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'studio_run_forbidden' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(input_result) is distinct from 'object' then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;

  select run.* into run
  from public.studio_runs run
  where run.id = target_run_id
  for update;
  if not found then
    raise exception 'studio_run_not_found' using errcode = '22023';
  end if;
  if run.lease_token is distinct from target_lease_token
    or run.lease_expires_at is null
    or run.lease_expires_at <= pg_catalog.now() then
    raise exception 'studio_run_lease_lost' using errcode = '22023';
  end if;

  next_state := private.studio_assert_transition(run.state, 'studio.run.completed');

  begin
    actual_cost := input_result->>'actualCostMinor';
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'studio_run_invalid' using errcode = '22023';
  end;
  if actual_cost is not null and actual_cost < 0 then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;

  if run.operation in ('enhance', 'new_idea') then
    output := input_result->'suggestion';
    usage := output->'usage';
    if pg_catalog.jsonb_typeof(output) is distinct from 'object'
      or (output->>'originalPromptDigest') is null
      or (output->>'originalPromptDigest') !~ '^[0-9a-f]{64}$'
      or (output->>'suggestedPrompt') is null
      or pg_catalog.char_length(output->>'suggestedPrompt') not between 1 and 6000
      or (output->>'operation') is distinct from run.operation
      or pg_catalog.jsonb_typeof(usage) is distinct from 'object'
      or (usage->>'inputTokens') is null
      or (usage->>'outputTokens') is null then
      raise exception 'studio_run_invalid' using errcode = '22023';
    end if;
    begin
      if (usage->>'inputTokens')::integer < 0
        or (usage->>'outputTokens')::integer < 0 then
        raise exception 'studio_run_invalid' using errcode = '22023';
      end if;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'studio_run_invalid' using errcode = '22023';
    end;

    update public.studio_runs
    set state = next_state,
        actual_cost_minor = actual_cost,
        result_json = output,
        finished_at = pg_catalog.now()
    where id = target_run_id;

    insert into public.studio_run_events (
      organization_id, run_id, kind, safe_payload
    ) values (
      run.organization_id, run.id, 'studio.run.completed',
      pg_catalog.jsonb_build_object('stage', next_state)
    ) returning sequence into event_sequence;

    return pg_catalog.jsonb_build_object(
      'runId', run.id, 'state', next_state, 'suggestion', true,
      'eventSequence', event_sequence
    );
  end if;

  if run.operation not in ('generate', 'edit') then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;

  output := input_result->'output';
  continuation := input_result->'continuation';
  if pg_catalog.jsonb_typeof(output) is distinct from 'object'
    or pg_catalog.jsonb_typeof(continuation) is distinct from 'object'
    or (output->>'outputHash') is null
    or (output->>'outputHash') !~ '^[0-9a-f]{64}$'
    or (output->>'outputMime') is null
    or (output->>'outputMime') not in ('image/png', 'image/jpeg', 'image/webp')
    or (output->>'inputDigest') is null
    or (output->>'inputDigest') !~ '^[0-9a-f]{64}$'
    or (continuation->>'privateObjectPath') is null
    or (continuation->>'privateObjectHash') is null
    or (continuation->>'privateObjectHash') !~ '^[0-9a-f]{64}$'
    or (output->>'outputWidth') is null
    or (output->>'outputHeight') is null
    or (output->>'outputBytes') is null
    or (output->>'outputPath') is null
    or (input_result->'verification' is not null
        and pg_catalog.jsonb_typeof(input_result->'verification')
            is distinct from 'object') then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;
  begin
    if (output->>'outputWidth')::integer not between 1 and 16384
      or (output->>'outputHeight')::integer not between 1 and 16384
      or (output->>'outputBytes')::bigint <= 0
      or pg_catalog.char_length(output->>'outputPath') not between 1 and 1024
      or pg_catalog.char_length(
           coalesce(output->>'exactTextCopy', '')
         ) > 6000
      or pg_catalog.char_length(continuation->>'privateObjectPath')
           not between 1 and 1024 then
      raise exception 'studio_run_invalid' using errcode = '22023';
    end if;
    v_export_id := nullif(input_result->>'selectedExportId', '')::uuid;
    replay_expires_at :=
      nullif(continuation->>'replayExpiresAt', '')::timestamptz;
  exception
    when invalid_text_representation or numeric_value_out_of_range
      or datetime_field_overflow or invalid_datetime_format then
      raise exception 'studio_run_invalid' using errcode = '22023';
  end;

  select document.* into doc
  from public.studio_documents document
  where document.organization_id = run.organization_id
    and document.id = run.document_id
  for update;

  select pg_catalog.coalesce(pg_catalog.max(version.ordinal), 0) + 1 into v_ordinal
  from public.studio_versions version
  where version.organization_id = run.organization_id
    and version.document_id = run.document_id;

  insert into public.studio_continuations (
    id, organization_id, document_id, version_id, parent_id, profile_id,
    private_object_path, private_object_hash, provider_handle,
    replay_expires_at, state
  ) values (
    continuation_id, run.organization_id, run.document_id, version_id,
    null, run.profile_id,
    continuation->>'privateObjectPath', continuation->>'privateObjectHash',
    nullif(continuation->>'providerHandle', ''),
    replay_expires_at,
    'usable'
  );

  insert into public.studio_versions (
    id, organization_id, document_id, ordinal, parent_version_id, run_id,
    requested_campaign_id, input_manifest, input_digest, provider_profile_id,
    continuation_id, output_path, output_hash, output_mime, output_width,
    output_height, output_bytes, exact_text_copy, verification
  ) values (
    version_id, run.organization_id, run.document_id, v_ordinal,
    run.parent_version_id, run.id,
    run.requested_campaign_id,
    run.request, output->>'inputDigest', run.profile_id, continuation_id,
    output->>'outputPath', output->>'outputHash', output->>'outputMime',
    (output->>'outputWidth')::integer, (output->>'outputHeight')::integer,
    (output->>'outputBytes')::bigint,
    coalesce(output->>'exactTextCopy', ''),
    coalesce(input_result->'verification', '{}'::jsonb)
  );

  if doc.revision = run.expected_revision then
    update public.studio_documents
    set current_version_id = version_id,
        revision = revision + 1,
        updated_at = pg_catalog.now()
    where organization_id = run.organization_id
      and id = run.document_id;
  else
    branch := true;
  end if;

  -- Previews stay viewable for a day after the run settles.
  update public.studio_preview_frames
  set expires_at = pg_catalog.now() + pg_catalog.make_interval(hours => 24)
  where run_id = target_run_id;

  if run.requested_campaign_id is not null then
    if v_export_id is null then
      link_status := 'link_intent_recorded';
    else
      select pg_catalog.count(*) into acceptance_count
      from public.studio_export_acceptances acceptance
      where acceptance.organization_id = run.organization_id
        and acceptance.export_id = v_export_id;
      if acceptance_count = 0 then
        link_status := 'awaiting_export_acceptance';
      else
        link_status := 'link_intent_recorded';
      end if;
    end if;
  end if;

  select pg_catalog.count(*) into preview_count
  from public.studio_preview_frames frame
  where frame.run_id = target_run_id;
  payload := pg_catalog.jsonb_build_object('stage', next_state);
  if preview_count = 0 then
    payload := payload || pg_catalog.jsonb_build_object(
      'anomaly', 'missing_progressive_preview'
    );
  end if;

  update public.studio_runs
  set state = next_state,
      actual_cost_minor = actual_cost,
      result_version_id = version_id,
      result_export_id = v_export_id,
      finished_at = pg_catalog.now()
  where id = target_run_id;

  insert into public.studio_run_events (
    organization_id, run_id, kind, safe_payload
  ) values (
    run.organization_id, run.id, 'studio.run.completed', payload
  ) returning sequence into event_sequence;

  return pg_catalog.jsonb_build_object(
    'runId', run.id, 'state', next_state, 'versionId', version_id,
    'ordinal', v_ordinal, 'branch', branch, 'linkStatus', link_status,
    'eventSequence', event_sequence
  );
end;
$$;

-- I1: a worker-confirmed cancellation settles as `cancelled`, not `failed`.
-- Without this arm the cancelled state is unreachable and every confirmed
-- cancel misreports as a failure. Safe codes gain NULL-fencing.
create or replace function public.fail_studio_run(
  target_run_id uuid,
  target_lease_token uuid,
  input_failure jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.studio_runs;
  safe_code text;
  certainty text;
  actual_cost bigint;
  event_kind text;
  next_state text;
  event_sequence bigint;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'studio_run_forbidden' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(input_failure) is distinct from 'object' then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;

  safe_code := input_failure->>'safeCode';
  certainty := input_failure->>'certainty';
  if safe_code is null
    or safe_code not in (
      'policy_refused', 'generation_disabled', 'reference_revoked',
      'unsupported_ratio', 'unsupported_format', 'upload_failed',
      'provider_refused', 'provider_failed', 'invalid_final_bytes',
      'stream_lost', 'context_expired', 'model_unavailable', 'stale_parent',
      'link_failed', 'access_revoked', 'cancelled'
    )
    or certainty is null
    or certainty not in ('definite', 'unknown') then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;
  begin
    actual_cost := input_failure->>'actualCostMinor';
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'studio_run_invalid' using errcode = '22023';
  end;
  if certainty = 'unknown' and actual_cost is not null then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;
  if actual_cost is not null and actual_cost < 0 then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;

  select run.* into run
  from public.studio_runs run
  where run.id = target_run_id
  for update;
  if not found then
    raise exception 'studio_run_not_found' using errcode = '22023';
  end if;
  if run.lease_token is distinct from target_lease_token
    or run.lease_expires_at is null
    or run.lease_expires_at <= pg_catalog.now() then
    raise exception 'studio_run_lease_lost' using errcode = '22023';
  end if;

  if certainty = 'unknown' then
    event_kind := 'studio.run.outcome_unknown';
  elsif run.state = 'cancel_requested' and safe_code = 'cancelled' then
    event_kind := 'studio.run.cancelled';
  else
    event_kind := 'studio.run.failed';
  end if;
  next_state := private.studio_assert_transition(run.state, event_kind);

  update public.studio_runs
  set state = next_state,
      actual_cost_minor = actual_cost,
      safe_failure_code = safe_code,
      finished_at = pg_catalog.now()
  where id = target_run_id;

  insert into public.studio_run_events (
    organization_id, run_id, kind, safe_payload
  ) values (
    run.organization_id, run.id, event_kind,
    pg_catalog.jsonb_build_object('stage', next_state, 'errorCode', safe_code)
  ) returning sequence into event_sequence;

  return pg_catalog.jsonb_build_object(
    'runId', run.id, 'state', next_state, 'eventSequence', event_sequence
  );
end;
$$;

-- I2 (reconcile half): reconciliation settles failure only. Retrieval-success
-- lands through recovery-claim plus completion instead — the old completed arm
-- demanded a version that could never exist while a run was unknown.
create or replace function public.reconcile_studio_run(
  target_run_id uuid,
  input_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.studio_runs;
  settled text;
  safe_code text;
  actual_cost bigint;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'studio_run_forbidden' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(input_receipt) is distinct from 'object' then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;

  settled := input_receipt->>'settled';
  safe_code := input_receipt->>'safeCode';
  begin
    actual_cost := input_receipt->>'actualCostMinor';
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'studio_run_invalid' using errcode = '22023';
  end;
  if settled is null
    or settled is distinct from 'failed'
    or safe_code is null
    or (actual_cost is not null and actual_cost < 0) then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;

  select run.* into run
  from public.studio_runs run
  where run.id = target_run_id
  for update;
  if not found then
    raise exception 'studio_run_not_found' using errcode = '22023';
  end if;
  if run.state is distinct from 'outcome_unknown' then
    raise exception 'studio_run_not_reconcilable' using errcode = '22023';
  end if;

  update public.studio_runs
  set state = 'failed',
      actual_cost_minor = actual_cost,
      safe_failure_code = safe_code,
      finished_at = pg_catalog.now()
  where id = target_run_id;

  insert into public.studio_run_events (
    organization_id, run_id, kind, safe_payload
  ) values (
    run.organization_id, run.id, 'studio.run.failed',
    pg_catalog.jsonb_build_object('stage', 'failed', 'errorCode', safe_code)
  );

  return pg_catalog.jsonb_build_object('runId', run.id, 'state', 'failed');
end;
$$;

-- C2 (admission half): the preassigned export id is recorded in
-- preassigned_export_id while result_export_id stays NULL — the immediate FK
-- on result_export_id cannot reference a row the worker creates later in a
-- different transaction. M10: admission needs a policy row to exist (currency
-- must come from somewhere) but ignores `enabled`, because a zero-cost local
-- derivative needs no spend authority; export runs still count as pending
-- while queued, which conservatively gates generation behind them.
create or replace function public.create_studio_export(
  target_organization_id uuid,
  input_export jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid;
  v_version_id uuid;
  v_transform_version integer;
  v_transform jsonb;
  v_preset text;
  v_preset_version integer;
  v_idempotency_key text;
  v_request_digest text;
  version public.studio_versions;
  policy public.studio_generation_policies;
  existing_run public.studio_runs;
  created_run public.studio_runs;
  existing_export_id uuid;
  preassigned_export_id uuid := pg_catalog.gen_random_uuid();
  kind text;
begin
  caller := (select auth.uid());
  if caller is null
    or not private.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
    raise exception 'studio_export_forbidden' using errcode = '42501';
  end if;

  if pg_catalog.jsonb_typeof(input_export) is distinct from 'object' then
    raise exception 'studio_export_invalid' using errcode = '22023';
  end if;
  begin
    v_version_id := (input_export->>'versionId')::uuid;
    v_transform_version := (input_export->>'transformVersion')::integer;
    v_preset_version := (input_export->>'presetVersion')::integer;
    v_idempotency_key :=
      pg_catalog.btrim(coalesce(input_export->>'idempotencyKey', ''));
    v_request_digest := input_export->>'requestDigest';
    v_transform := input_export->'transform';
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'studio_export_invalid' using errcode = '22023';
  end;
  v_preset := input_export->>'preset';
  kind := v_transform->>'kind';
  if v_version_id is null
    or v_transform_version is null or v_transform_version <= 0
    or v_preset_version is null or v_preset_version <= 0
    or v_preset is null
    or v_preset not in (
      'instagram_feed', 'instagram_stories', 'google_square',
      'google_horizontal', 'google_vertical', 'ecommerce_creative'
    )
    or v_idempotency_key = ''
    or pg_catalog.char_length(v_idempotency_key) not between 8 and 200
    or v_request_digest is null or v_request_digest !~ '^[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(v_transform) is distinct from 'object'
    or kind is null
    or kind not in ('proportional_resize', 'contain_pad', 'reviewed_crop') then
    raise exception 'studio_export_invalid' using errcode = '22023';
  end if;
  begin
    if (v_transform->>'targetWidth')::integer not between 1 and 16384
      or (v_transform->>'targetHeight')::integer not between 1 and 16384
      or (
        kind = 'contain_pad'
        and (
          (v_transform->>'padColor') is null
          or (v_transform->>'padColor') !~ '^#[0-9a-fA-F]{6}$'
        )
      ) then
      raise exception 'studio_export_invalid' using errcode = '22023';
    end if;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'studio_export_invalid' using errcode = '22023';
  end;

  select version.* into version
  from public.studio_versions version
  where version.organization_id = target_organization_id
    and version.id = v_version_id;
  if not found then
    raise exception 'studio_export_version_not_found' using errcode = '22023';
  end if;

  select export_row.id into existing_export_id
  from public.studio_exports export_row
  where export_row.organization_id = target_organization_id
    and export_row.studio_version_id = v_version_id
    and export_row.preset_version = v_preset_version
    and export_row.preset = v_preset
    and export_row.transform_version = v_transform_version
    and export_row.transform = v_transform;
  if found then
    return pg_catalog.jsonb_build_object(
      'exportId', existing_export_id, 'replayed', true, 'runId', null
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'studio', 'export', target_organization_id::text,
      caller::text, v_idempotency_key
    ), 0
  ));

  select run.* into existing_run
  from public.studio_runs run
  where run.organization_id = target_organization_id
    and run.actor_id = caller
    and run.idempotency_key = v_idempotency_key
  for update;
  if found then
    if existing_run.request_digest is distinct from v_request_digest then
      raise exception 'studio_run_key_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'exportId', coalesce(
        existing_run.result_export_id, existing_run.preassigned_export_id
      ),
      'replayed', true,
      'runId', existing_run.id
    );
  end if;

  select policy.* into policy
  from public.studio_generation_policies policy
  where policy.organization_id = target_organization_id
  order by policy.version desc
  limit 1;
  if not found then
    raise exception 'studio_run_no_policy' using errcode = '22023';
  end if;

  insert into public.studio_runs (
    organization_id, document_id, actor_id, operation, expected_revision,
    request, request_digest, idempotency_key, profile_id, policy_version,
    reserved_minor, currency, state, preassigned_export_id
  ) values (
    target_organization_id, version.document_id, caller, 'export',
    1, input_export, v_request_digest, v_idempotency_key,
    version.provider_profile_id, policy.version, 0, policy.currency,
    'queued', preassigned_export_id
  ) returning * into created_run;

  insert into public.studio_run_events (
    organization_id, run_id, kind, safe_payload
  ) values (
    target_organization_id, created_run.id, 'studio.run.accepted',
    pg_catalog.jsonb_build_object('stage', 'queued')
  );

  return pg_catalog.jsonb_build_object(
    'exportId', preassigned_export_id, 'replayed', false,
    'runId', created_run.id
  );
end;
$$;

-- C2 (completion half) + M5: the worker names its run in the receipt; the
-- receipt's version/transform/preset triple must equal what was admitted
-- before the immutable row is created. I7 carve-out, documented: completion
-- checks the run is claimed and live but takes no lease token — finalizing a
-- deterministic local derivative is not a paid provider call, and the dedup
-- winner-adopter below makes twin work converge instead of forking.
create or replace function public.complete_studio_export(
  target_organization_id uuid,
  target_export_id uuid,
  input_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.studio_runs;
  receipt jsonb;
  v_run_id uuid;
  v_version_id uuid;
  v_transform_version integer;
  v_preset_version integer;
  v_preset text;
  v_transform jsonb;
  winner_id uuid;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'studio_export_forbidden' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(input_receipt) is distinct from 'object' then
    raise exception 'studio_export_invalid' using errcode = '22023';
  end if;
  receipt := input_receipt->'output';
  if pg_catalog.jsonb_typeof(receipt) is distinct from 'object'
    or (receipt->>'outputHash') is null
    or (receipt->>'outputHash') !~ '^[0-9a-f]{64}$'
    or (receipt->>'outputMime') is null
    or (receipt->>'outputMime') not in ('image/png', 'image/jpeg', 'image/webp')
    or (receipt->>'outputWidth') is null
    or (receipt->>'outputHeight') is null
    or (receipt->>'outputBytes') is null
    or (receipt->>'outputPath') is null then
    raise exception 'studio_export_invalid' using errcode = '22023';
  end if;
  begin
    v_run_id := (input_receipt->>'runId')::uuid;
    v_version_id := (input_receipt->>'versionId')::uuid;
    v_transform_version := (input_receipt->>'transformVersion')::integer;
    v_preset_version := (input_receipt->>'presetVersion')::integer;
    if (receipt->>'outputWidth')::integer not between 1 and 16384
      or (receipt->>'outputHeight')::integer not between 1 and 16384
      or (receipt->>'outputBytes')::bigint <= 0
      or pg_catalog.char_length(receipt->>'outputPath') not between 1 and 1024
      or v_transform_version <= 0
      or v_preset_version <= 0
      or pg_catalog.jsonb_typeof(input_receipt->'transform') is distinct from 'object'
      or (input_receipt->'transform'->>'kind')
           not in ('proportional_resize', 'contain_pad', 'reviewed_crop') then
      raise exception 'studio_export_invalid' using errcode = '22023';
    end if;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'studio_export_invalid' using errcode = '22023';
  end;
  v_preset := input_receipt->>'preset';
  v_transform := input_receipt->'transform';
  if v_run_id is null
    or v_version_id is null
    or v_preset is null
    or v_preset not in (
      'instagram_feed', 'instagram_stories', 'google_square',
      'google_horizontal', 'google_vertical', 'ecommerce_creative'
    ) then
    raise exception 'studio_export_invalid' using errcode = '22023';
  end;

  select run.* into run
  from public.studio_runs run
  where run.organization_id = target_organization_id
    and run.id = v_run_id
    and run.operation = 'export'
  for update;
  if not found then
    raise exception 'studio_export_not_found' using errcode = '22023';
  end if;
  if run.preassigned_export_id is distinct from target_export_id then
    raise exception 'studio_export_invalid' using errcode = '22023';
  end if;
  if run.state in ('ready', 'failed', 'cancelled', 'outcome_unknown') then
    return pg_catalog.jsonb_build_object(
      'exportId', target_export_id, 'state', run.state, 'replayed', true
    );
  end if;
  if run.lease_token is null then
    raise exception 'studio_run_lease_lost' using errcode = '22023';
  end if;
  -- The receipt must equal the admitted request: a worker mix-up must fail
  -- loudly rather than mint an immutable row for the wrong derivative.
  if (run.request->>'versionId')::uuid is distinct from v_version_id
    or (run.request->'transform') is distinct from v_transform
    or (run.request->>'preset') is distinct from v_preset
    or (run.request->>'transformVersion')::integer
         is distinct from v_transform_version
    or (run.request->>'presetVersion')::integer
         is distinct from v_preset_version then
    raise exception 'studio_export_receipt_mismatch' using errcode = '22023';
  end if;

  begin
    insert into public.studio_exports (
      id, organization_id, studio_version_id, transform_version, transform,
      preset_version, preset, output_path, output_hash, output_mime,
      output_width, output_height, output_bytes
    ) values (
      target_export_id, target_organization_id, v_version_id,
      v_transform_version, v_transform, v_preset_version, v_preset,
      receipt->>'outputPath', receipt->>'outputHash', receipt->>'outputMime',
      (receipt->>'outputWidth')::integer, (receipt->>'outputHeight')::integer,
      (receipt->>'outputBytes')::bigint
    );
  exception when unique_violation then
    select export_row.id into winner_id
    from public.studio_exports export_row
    where export_row.organization_id = target_organization_id
      and (
        export_row.id = target_export_id
        or (
          export_row.studio_version_id = v_version_id
          and export_row.preset_version = v_preset_version
          and export_row.preset = v_preset
          and export_row.transform_version = v_transform_version
          and export_row.transform = v_transform
        )
      )
    limit 1;
    if not found then
      raise;
    end if;
    update public.studio_runs
    set state = 'ready',
        result_export_id = winner_id,
        finished_at = pg_catalog.now()
    where id = run.id;
    insert into public.studio_run_events (
      organization_id, run_id, kind, safe_payload
    ) values (
      run.organization_id, run.id, 'studio.run.completed',
      pg_catalog.jsonb_build_object('stage', 'ready')
    );
    return pg_catalog.jsonb_build_object(
      'exportId', winner_id, 'state', 'ready', 'replayed', true
    );
  end;

  update public.studio_runs
  set state = 'ready',
      result_export_id = target_export_id,
      finished_at = pg_catalog.now()
  where id = run.id;

  insert into public.studio_run_events (
    organization_id, run_id, kind, safe_payload
  ) values (
    run.organization_id, run.id, 'studio.run.completed',
    pg_catalog.jsonb_build_object('stage', 'ready')
  );

  return pg_catalog.jsonb_build_object(
    'exportId', target_export_id, 'state', 'ready', 'replayed', false
  );
end;
$$;

-- C3: the consent pin is a real sha256 over the normalized transform value,
-- satisfying the 64-hex CHECK the old md5 could never meet. Twin accepts
-- serialize on an advisory lock so only one receipt wins the export.
create or replace function public.accept_studio_export(
  target_organization_id uuid,
  target_export_id uuid,
  expected_content_hash text,
  idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  export_row public.studio_exports;
  existing public.studio_export_acceptances;
  key text;
begin
  if (select auth.uid()) is null
    or not private.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
    raise exception 'studio_export_forbidden' using errcode = '42501';
  end if;

  key := pg_catalog.btrim(coalesce(idempotency_key, ''));
  if expected_content_hash is null
    or expected_content_hash !~ '^[0-9a-f]{64}$'
    or key = ''
    or pg_catalog.char_length(key) not between 8 and 200 then
    raise exception 'studio_export_invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'studio', 'accept', target_organization_id::text,
      target_export_id::text
    ), 0
  ));

  select export_row.* into export_row
  from public.studio_exports export_row
  where export_row.organization_id = target_organization_id
    and export_row.id = target_export_id;
  if not found then
    raise exception 'studio_export_not_found' using errcode = '22023';
  end if;
  if export_row.output_hash is distinct from expected_content_hash then
    raise exception 'studio_export_hash_mismatch' using errcode = '22023';
  end if;

  select acceptance.* into existing
  from public.studio_export_acceptances acceptance
  where acceptance.organization_id = target_organization_id
    and acceptance.export_id = target_export_id;
  if found then
    return pg_catalog.jsonb_build_object(
      'acceptanceId', existing.id, 'replayed', true
    );
  end if;

  select acceptance.* into existing
  from public.studio_export_acceptances acceptance
  where acceptance.organization_id = target_organization_id
    and acceptance.actor_id = (select auth.uid())
    and acceptance.idempotency_key = key;
  if found then
    raise exception 'studio_run_key_conflict' using errcode = '23505';
  end if;

  -- DB-internal consent pin: sha256 over the normalized jsonb text pins the
  -- consented transform deterministically. It is not the Task 2 export
  -- identity (which the application computes); nothing recomputes this value
  -- outside this receipt.
  insert into public.studio_export_acceptances (
    organization_id, export_id, content_hash, transform_digest, actor_id,
    idempotency_key
  ) values (
    target_organization_id, target_export_id, export_row.output_hash,
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(export_row.transform::text, 'UTF8'), 'sha256'
      ),
      'hex'
    ),
    (select auth.uid()), key
  ) returning * into existing;

  return pg_catalog.jsonb_build_object(
    'acceptanceId', existing.id, 'replayed', false
  );
end;
$$;
