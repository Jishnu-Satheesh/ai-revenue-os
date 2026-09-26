-- Independent Creative Studio (Task 3): organization-owned documents, immutable
-- versions, bounded runs, private previews/continuations/uploads, and explicit
-- generation policies. Additive and forward-only: no existing table, function,
-- policy, or bucket is altered. Campaign linkage (campaign_selected_creatives
-- and selection/draft/resolve RPCs) belongs to Task 9; history filings to Task 11A.
--
-- Authority: docs/design/creative-studio-independent/technical-contract.md §3–§6,
-- ADR 0070, Task 2 domain contracts (states, ceilings, digest shapes).

-- ---------------------------------------------------------------------------
-- Private storage buckets. Paths always begin with the organization UUID so the
-- storage policy and the database writer enforce the same tenant boundary.
-- studio-context carries NO authenticated policy: worker-only (service_role
-- bypasses RLS). Upload reservations live in studio-uploads until finalized.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('studio-assets', 'studio-assets', false, 15728640,
    array['image/png', 'image/jpeg', 'image/webp']::text[]),
  ('studio-previews', 'studio-previews', false, 15728640,
    array['image/png', 'image/jpeg', 'image/webp']::text[]),
  ('studio-uploads', 'studio-uploads', false, 15728640,
    array['image/png', 'image/jpeg', 'image/webp']::text[]),
  ('studio-context', 'studio-context', false, 104857600,
    array['application/octet-stream', 'application/json']::text[])
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Members read their own organization's finished Studio objects.
create policy "members read studio assets"
on storage.objects for select to authenticated
using (
  bucket_id = 'studio-assets'
  and cardinality(storage.foldername(name)) >= 2
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.is_organization_member(((storage.foldername(name))[1])::uuid)
);

-- Members read their own organization's preview frames (run-scoped display).
create policy "members read studio previews"
on storage.objects for select to authenticated
using (
  bucket_id = 'studio-previews'
  and cardinality(storage.foldername(name)) >= 2
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.is_organization_member(((storage.foldername(name))[1])::uuid)
);

-- NOTE: the "actors transfer own studio uploads" insert policy is created after
-- the tables below, because it subqueries public.studio_uploads.

-- Members may re-read their organization's upload bytes (expired previews
-- re-sign through authorized routes; the object stays private).
create policy "members read studio uploads"
on storage.objects for select to authenticated
using (
  bucket_id = 'studio-uploads'
  and cardinality(storage.foldername(name)) >= 2
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.is_organization_member(((storage.foldername(name))[1])::uuid)
);

-- ---------------------------------------------------------------------------
-- Tables. Every tenant table carries (organization_id, id) uniqueness and
-- composite tenant foreign keys. JSON payloads are validated inside the RPCs;
-- scalar formats are enforced here with CHECK constraints.
-- ---------------------------------------------------------------------------

create table public.studio_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  creator_id uuid not null,
  title text not null default 'Untitled creative'
    constraint studio_documents_title_length
    check (char_length(title) between 1 and 200),
  revision integer not null default 1
    constraint studio_documents_revision_positive check (revision > 0),
  current_version_id uuid null,
  settings jsonb not null default '{}'::jsonb,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint studio_documents_org_identity unique (organization_id, id)
);

create table public.studio_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  document_id uuid not null,
  ordinal integer not null constraint studio_versions_ordinal_positive check (ordinal > 0),
  parent_version_id uuid null,
  run_id uuid not null,
  requested_campaign_id uuid null,
  input_manifest jsonb not null,
  input_digest text not null
    constraint studio_versions_input_digest_sha
    check (input_digest ~ '^[0-9a-f]{64}$'),
  provider_profile_id uuid not null,
  continuation_id uuid null,
  output_path text not null constraint studio_versions_output_path_nonempty
    check (char_length(output_path) between 1 and 1024),
  output_hash text not null
    constraint studio_versions_output_hash_sha
    check (output_hash ~ '^[0-9a-f]{64}$'),
  output_mime text not null
    constraint studio_versions_output_mime_allowed
    check (output_mime in ('image/png', 'image/jpeg', 'image/webp')),
  output_width integer not null
    constraint studio_versions_output_width_range check (output_width between 1 and 16384),
  output_height integer not null
    constraint studio_versions_output_height_range check (output_height between 1 and 16384),
  output_bytes bigint not null
    constraint studio_versions_output_bytes_positive check (output_bytes > 0),
  exact_text_copy text not null constraint studio_versions_copy_length
    check (char_length(exact_text_copy) between 0 and 6000),
  verification jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint studio_versions_org_identity unique (organization_id, id),
  constraint studio_versions_document_ordinal unique (document_id, ordinal),
  constraint studio_versions_run_unique unique (run_id)
);

create table public.studio_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  document_id uuid not null,
  actor_id uuid not null,
  operation text not null
    constraint studio_runs_operation_allowed
    check (operation in ('generate', 'edit', 'enhance', 'new_idea', 'export')),
  expected_revision integer not null
    constraint studio_runs_expected_revision_positive check (expected_revision > 0),
  parent_version_id uuid null,
  request jsonb not null,
  request_digest text not null
    constraint studio_runs_request_digest_sha
    check (request_digest ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null
    constraint studio_runs_idempotency_key_length
    check (char_length(idempotency_key) between 8 and 200),
  requested_campaign_id uuid null,
  profile_id uuid not null,
  policy_version integer not null
    constraint studio_runs_policy_version_positive check (policy_version > 0),
  reserved_minor bigint not null
    constraint studio_runs_reserved_nonnegative check (reserved_minor >= 0),
  currency text not null
    constraint studio_runs_currency_iso check (currency ~ '^[A-Z]{3}$'),
  actual_cost_minor bigint null
    constraint studio_runs_actual_nonnegative check (actual_cost_minor is null or actual_cost_minor >= 0),
  state text not null default 'queued'
    constraint studio_runs_state_allowed check (state in (
      'queued', 'preparing', 'generating', 'previewing', 'validating', 'ready',
      'failed', 'cancel_requested', 'cancelled', 'outcome_unknown'
    )),
  lease_token uuid null,
  lease_expires_at timestamptz null,
  attempt integer not null default 1
    constraint studio_runs_attempt_positive check (attempt > 0),
  provider_request_id text null,
  cancel_requested_at timestamptz null,
  result_version_id uuid null,
  result_export_id uuid null,
  result_json jsonb null,
  safe_failure_code text null,
  created_at timestamptz not null default now(),
  finished_at timestamptz null,
  constraint studio_runs_org_identity unique (organization_id, id),
  constraint studio_runs_idempotency unique (organization_id, actor_id, idempotency_key)
);

create table public.studio_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  studio_version_id uuid not null,
  parent_export_id uuid null,
  transform_version integer not null
    constraint studio_exports_transform_version_positive check (transform_version > 0),
  transform jsonb not null,
  preset_version integer not null
    constraint studio_exports_preset_version_positive check (preset_version > 0),
  output_path text not null constraint studio_exports_output_path_nonempty
    check (char_length(output_path) between 1 and 1024),
  output_hash text not null
    constraint studio_exports_output_hash_sha
    check (output_hash ~ '^[0-9a-f]{64}$'),
  output_mime text not null
    constraint studio_exports_output_mime_allowed
    check (output_mime in ('image/png', 'image/jpeg', 'image/webp')),
  output_width integer not null
    constraint studio_exports_output_width_range check (output_width between 1 and 16384),
  output_height integer not null
    constraint studio_exports_output_height_range check (output_height between 1 and 16384),
  output_bytes bigint not null
    constraint studio_exports_output_bytes_positive check (output_bytes > 0),
  created_at timestamptz not null default now(),
  constraint studio_exports_org_identity unique (organization_id, id)
);

create table public.studio_export_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  export_id uuid not null,
  content_hash text not null
    constraint studio_export_acceptances_hash_sha
    check (content_hash ~ '^[0-9a-f]{64}$'),
  transform_digest text not null
    constraint studio_export_acceptances_transform_digest_sha
    check (transform_digest ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null,
  idempotency_key text not null
    constraint studio_export_acceptances_key_length
    check (char_length(idempotency_key) between 8 and 200),
  created_at timestamptz not null default now(),
  constraint studio_export_acceptances_org_identity unique (organization_id, id),
  constraint studio_export_acceptances_export_unique unique (organization_id, export_id),
  constraint studio_export_acceptances_idempotency unique (organization_id, actor_id, idempotency_key)
);

create sequence public.studio_run_events_sequence;

create table public.studio_run_events (
  id bigint primary key generated always as identity,
  organization_id uuid not null,
  run_id uuid not null,
  sequence bigint not null default nextval('public.studio_run_events_sequence'),
  kind text not null
    constraint studio_run_events_kind_allowed check (kind in (
      'studio.run.accepted', 'studio.run.references_prepared',
      'studio.run.generation_started', 'studio.run.preview_available',
      'studio.run.output_validated', 'studio.run.completed', 'studio.run.failed',
      'studio.run.cancel_requested', 'studio.run.cancelled',
      'studio.run.outcome_unknown', 'studio.campaign_link_created',
      'studio.campaign_link_blocked', 'studio.campaign_link_resolved'
    )),
  safe_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint studio_run_events_run_sequence unique (run_id, sequence)
);

create table public.studio_preview_frames (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  frame_index integer not null
    constraint studio_preview_frames_index_nonnegative check (frame_index >= 0),
  private_path text not null constraint studio_preview_frames_path_nonempty
    check (char_length(private_path) between 1 and 1024),
  content_hash text not null
    constraint studio_preview_frames_hash_sha
    check (content_hash ~ '^[0-9a-f]{64}$'),
  mime text not null
    constraint studio_preview_frames_mime_allowed
    check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  width integer not null
    constraint studio_preview_frames_width_range check (width between 1 and 16384),
  height integer not null
    constraint studio_preview_frames_height_range check (height between 1 and 16384),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint studio_preview_frames_org_identity unique (organization_id, id),
  constraint studio_preview_frames_run_index unique (run_id, frame_index)
);

create table public.studio_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  actor_id uuid not null,
  reserved_path text not null constraint studio_uploads_path_nonempty
    check (char_length(reserved_path) between 1 and 1024),
  state text not null default 'reserved'
    constraint studio_uploads_state_allowed
    check (state in ('reserved', 'ready', 'rejected', 'expired')),
  rights_attestation jsonb not null default '{}'::jsonb,
  final_hash text null
    constraint studio_uploads_final_hash_sha
    check (final_hash is null or final_hash ~ '^[0-9a-f]{64}$'),
  final_mime text null
    constraint studio_uploads_final_mime_allowed
    check (final_mime is null or final_mime in ('image/png', 'image/jpeg', 'image/webp')),
  final_width integer null
    constraint studio_uploads_final_width_range
    check (final_width is null or final_width between 200 and 8000),
  final_height integer null
    constraint studio_uploads_final_height_range
    check (final_height is null or final_height between 200 and 8000),
  final_bytes bigint null
    constraint studio_uploads_final_bytes_positive
    check (final_bytes is null or final_bytes > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint studio_uploads_org_identity unique (organization_id, id)
);

create table public.studio_continuations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  document_id uuid not null,
  version_id uuid not null,
  parent_id uuid null,
  profile_id uuid not null,
  private_object_path text not null constraint studio_continuations_path_nonempty
    check (char_length(private_object_path) between 1 and 1024),
  private_object_hash text not null
    constraint studio_continuations_hash_sha
    check (private_object_hash ~ '^[0-9a-f]{64}$'),
  provider_handle text null,
  replay_expires_at timestamptz null,
  state text not null default 'usable'
    constraint studio_continuations_state_allowed
    check (state in ('usable', 'expired', 'deleted')),
  created_at timestamptz not null default now(),
  constraint studio_continuations_org_identity unique (organization_id, id)
);

create table public.studio_generation_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  version integer not null
    constraint studio_generation_policies_version_positive check (version > 0),
  enabled boolean not null,
  currency text not null
    constraint studio_generation_policies_currency_iso check (currency ~ '^[A-Z]{3}$'),
  per_run_ceiling_minor bigint not null
    constraint studio_generation_policies_per_run_nonnegative
    check (per_run_ceiling_minor >= 0),
  window_ceiling_minor bigint not null
    constraint studio_generation_policies_window_nonnegative
    check (window_ceiling_minor >= 0),
  window_seconds integer not null
    constraint studio_generation_policies_window_positive check (window_seconds > 0),
  max_pending integer not null
    constraint studio_generation_policies_pending_positive check (max_pending > 0),
  max_attempts integer not null
    constraint studio_generation_policies_attempts_positive check (max_attempts > 0),
  created_at timestamptz not null default now(),
  constraint studio_generation_policies_org_identity unique (organization_id, id),
  constraint studio_generation_policies_org_version unique (organization_id, version)
);

-- ---------------------------------------------------------------------------
-- Composite tenant foreign keys (added after all tables exist so every target
-- is present). Cross-tenant references are impossible by construction.
-- ---------------------------------------------------------------------------
alter table public.studio_documents
  add constraint studio_documents_current_version_fk
  foreign key (organization_id, current_version_id)
  references public.studio_versions (organization_id, id)
  on delete set null;

alter table public.studio_versions
  add constraint studio_versions_document_fk
  foreign key (organization_id, document_id)
  references public.studio_documents (organization_id, id)
  on delete cascade,
  add constraint studio_versions_parent_fk
  foreign key (organization_id, parent_version_id)
  references public.studio_versions (organization_id, id)
  on delete restrict,
  add constraint studio_versions_continuation_fk
  foreign key (organization_id, continuation_id)
  references public.studio_continuations (organization_id, id)
  on delete set null;

alter table public.studio_runs
  add constraint studio_runs_document_fk
  foreign key (organization_id, document_id)
  references public.studio_documents (organization_id, id)
  on delete cascade,
  add constraint studio_runs_parent_version_fk
  foreign key (organization_id, parent_version_id)
  references public.studio_versions (organization_id, id)
  on delete restrict,
  add constraint studio_runs_result_version_fk
  foreign key (organization_id, result_version_id)
  references public.studio_versions (organization_id, id)
  on delete set null,
  add constraint studio_runs_result_export_fk
  foreign key (organization_id, result_export_id)
  references public.studio_exports (organization_id, id)
  on delete set null;

alter table public.studio_exports
  add constraint studio_exports_version_fk
  foreign key (organization_id, studio_version_id)
  references public.studio_versions (organization_id, id)
  on delete cascade,
  add constraint studio_exports_parent_export_fk
  foreign key (organization_id, parent_export_id)
  references public.studio_exports (organization_id, id)
  on delete restrict;

alter table public.studio_export_acceptances
  add constraint studio_export_acceptances_export_fk
  foreign key (organization_id, export_id)
  references public.studio_exports (organization_id, id)
  on delete cascade;

alter table public.studio_run_events
  add constraint studio_run_events_run_fk
  foreign key (organization_id, run_id)
  references public.studio_runs (organization_id, id)
  on delete cascade;

alter table public.studio_preview_frames
  add constraint studio_preview_frames_run_fk
  foreign key (organization_id, run_id)
  references public.studio_runs (organization_id, id)
  on delete cascade;

alter table public.studio_continuations
  add constraint studio_continuations_document_fk
  foreign key (organization_id, document_id)
  references public.studio_documents (organization_id, id)
  on delete cascade,
  add constraint studio_continuations_version_fk
  foreign key (organization_id, version_id)
  references public.studio_versions (organization_id, id)
  on delete cascade,
  add constraint studio_continuations_parent_fk
  foreign key (organization_id, parent_id)
  references public.studio_continuations (organization_id, id)
  on delete restrict;

-- ---------------------------------------------------------------------------
-- Indexes: policy window sums, pending-run counts, active-run fencing,
-- export dedup, event cursors, retention sweeps.
-- ---------------------------------------------------------------------------
create index studio_runs_org_created_idx
  on public.studio_runs (organization_id, created_at desc);
create index studio_runs_org_state_idx
  on public.studio_runs (organization_id, state);
create index studio_runs_document_state_idx
  on public.studio_runs (document_id, state);
-- One active image-producing run per document, enforced at the storage layer.
create unique index studio_runs_single_active_image_run
  on public.studio_runs (document_id)
  where operation in ('generate', 'edit')
    and state not in ('ready', 'failed', 'cancelled', 'outcome_unknown');
-- Same inputs reuse the same export (jsonb equality is order-insensitive).
create unique index studio_exports_dedup_idx
  on public.studio_exports (organization_id, studio_version_id, preset_version, transform);
create index studio_run_events_run_sequence_idx
  on public.studio_run_events (run_id, sequence);
create index studio_preview_frames_expires_idx
  on public.studio_preview_frames (expires_at);
create index studio_uploads_expires_idx
  on public.studio_uploads (expires_at);
create index studio_generation_policies_org_version_idx
  on public.studio_generation_policies (organization_id, version desc);

-- ---------------------------------------------------------------------------
-- Immutability: versions, exports, events, acceptances, and policies never
-- change after commit. Grants already deny updates; the trigger is the belt.
-- ---------------------------------------------------------------------------
create function public.studio_prevent_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'studio_immutable' using errcode = '25001';
  return null;
end;
$$;

revoke all on function public.studio_prevent_update()
  from public, anon, authenticated, service_role;

create trigger studio_versions_no_update
  before update on public.studio_versions
  for each row execute function public.studio_prevent_update();
create trigger studio_exports_no_update
  before update on public.studio_exports
  for each row execute function public.studio_prevent_update();
create trigger studio_export_acceptances_no_update
  before update on public.studio_export_acceptances
  for each row execute function public.studio_prevent_update();
create trigger studio_run_events_no_update
  before update on public.studio_run_events
  for each row execute function public.studio_prevent_update();
create trigger studio_generation_policies_no_update
  before update on public.studio_generation_policies
  for each row execute function public.studio_prevent_update();

-- ---------------------------------------------------------------------------
-- RLS: forced everywhere. Members read their own organization's rows (except
-- continuations, which no member role may read). All writes go through the
-- fenced RPCs below; no insert/update/delete policy exists on any table.
-- ---------------------------------------------------------------------------
alter table public.studio_documents enable row level security;
alter table public.studio_documents force row level security;
alter table public.studio_versions enable row level security;
alter table public.studio_versions force row level security;
alter table public.studio_runs enable row level security;
alter table public.studio_runs force row level security;
alter table public.studio_exports enable row level security;
alter table public.studio_exports force row level security;
alter table public.studio_export_acceptances enable row level security;
alter table public.studio_export_acceptances force row level security;
alter table public.studio_run_events enable row level security;
alter table public.studio_run_events force row level security;
alter table public.studio_preview_frames enable row level security;
alter table public.studio_preview_frames force row level security;
alter table public.studio_uploads enable row level security;
alter table public.studio_uploads force row level security;
alter table public.studio_continuations enable row level security;
alter table public.studio_continuations force row level security;
alter table public.studio_generation_policies enable row level security;
alter table public.studio_generation_policies force row level security;

create policy "members read own studio documents"
on public.studio_documents for select to authenticated
using (private.is_organization_member(organization_id));
create policy "members read own studio versions"
on public.studio_versions for select to authenticated
using (private.is_organization_member(organization_id));
create policy "members read own studio runs"
on public.studio_runs for select to authenticated
using (private.is_organization_member(organization_id));
create policy "members read own studio exports"
on public.studio_exports for select to authenticated
using (private.is_organization_member(organization_id));
create policy "members read own studio export acceptances"
on public.studio_export_acceptances for select to authenticated
using (private.is_organization_member(organization_id));
create policy "members read own studio run events"
on public.studio_run_events for select to authenticated
using (private.is_organization_member(organization_id));
create policy "members read own studio preview frames"
on public.studio_preview_frames for select to authenticated
using (private.is_organization_member(organization_id));
create policy "members read own studio uploads"
on public.studio_uploads for select to authenticated
using (private.is_organization_member(organization_id));
create policy "members read own studio generation policies"
on public.studio_generation_policies for select to authenticated
using (private.is_organization_member(organization_id));
-- Deliberately NO select policy on studio_continuations: opaque provider
-- handles never reach member roles. The browser sees computed edit
-- availability only.

revoke all on table public.studio_documents from public, anon, authenticated, service_role;
revoke all on table public.studio_versions from public, anon, authenticated, service_role;
revoke all on table public.studio_runs from public, anon, authenticated, service_role;
revoke all on table public.studio_exports from public, anon, authenticated, service_role;
revoke all on table public.studio_export_acceptances from public, anon, authenticated, service_role;
revoke all on table public.studio_run_events from public, anon, authenticated, service_role;
revoke all on table public.studio_preview_frames from public, anon, authenticated, service_role;
revoke all on table public.studio_uploads from public, anon, authenticated, service_role;
revoke all on table public.studio_continuations from public, anon, authenticated, service_role;
revoke all on table public.studio_generation_policies from public, anon, authenticated, service_role;

grant select on table public.studio_documents to authenticated;
grant select on table public.studio_versions to authenticated;
grant select on table public.studio_runs to authenticated;
grant select on table public.studio_exports to authenticated;
grant select on table public.studio_export_acceptances to authenticated;
grant select on table public.studio_run_events to authenticated;
grant select on table public.studio_preview_frames to authenticated;
grant select on table public.studio_uploads to authenticated;
grant select on table public.studio_generation_policies to authenticated;
-- No authenticated grant on studio_continuations (see above).
grant select on table public.studio_documents to service_role;
grant select on table public.studio_versions to service_role;
grant select on table public.studio_runs to service_role;
grant select on table public.studio_exports to service_role;
grant select on table public.studio_export_acceptances to service_role;
grant select on table public.studio_run_events to service_role;
grant select on table public.studio_preview_frames to service_role;
grant select on table public.studio_uploads to service_role;
grant select on table public.studio_continuations to service_role;
grant select on table public.studio_generation_policies to service_role;
-- service_role writes go through the fenced RPCs only: no insert/update/delete
-- grant anywhere, so a worker bug cannot scribble outside the state machine.

-- Upload transfer policy (needs studio_uploads to exist — created above).
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
  )
);

-- ---------------------------------------------------------------------------
-- Shared transition guard. Mirrors Task 2 TRANSITIONS exactly: the database
-- enforces the same graph the UI and worker follow.
-- ---------------------------------------------------------------------------
create function private.studio_assert_transition(
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
      allowed := current_state in ('validating', 'cancel_requested');
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

revoke all on function private.studio_assert_transition(text, text) from public;
grant execute on function private.studio_assert_transition(text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- save_studio_document: create or CAS-update a Studio document. studio.edit.
-- ---------------------------------------------------------------------------
create function public.save_studio_document(
  target_organization_id uuid,
  input_document jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid;
  document_id uuid;
  expected_revision integer;
  v_title text;
  v_settings jsonb;
  row public.studio_documents;
begin
  caller := (select auth.uid());
  if caller is null
    or not private.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
    raise exception 'studio_document_forbidden' using errcode = '42501';
  end if;

  if pg_catalog.jsonb_typeof(input_document) is distinct from 'object' then
    raise exception 'studio_document_invalid' using errcode = '22023';
  end if;
  begin
    document_id := nullif(input_document->>'id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'studio_document_invalid' using errcode = '22023';
  end;
  v_title := pg_catalog.btrim(coalesce(input_document->>'title', ''));
  if v_title = '' then
    v_title := 'Untitled creative';
  elsif pg_catalog.char_length(v_title) > 200 then
    raise exception 'studio_document_invalid' using errcode = '22023';
  end if;
  v_settings := coalesce(input_document->'settings', '{}'::jsonb);
  if pg_catalog.jsonb_typeof(v_settings) is distinct from 'object' then
    raise exception 'studio_document_invalid' using errcode = '22023';
  end if;

  if document_id is null then
    insert into public.studio_documents (
      organization_id, creator_id, title, settings
    ) values (
      target_organization_id, caller, v_title, v_settings
    ) returning * into row;
    return pg_catalog.jsonb_build_object('id', row.id, 'revision', row.revision);
  end if;

  if (input_document->>'expectedRevision') is null then
    raise exception 'studio_document_invalid' using errcode = '22023';
  end if;
  begin
    expected_revision := (input_document->>'expectedRevision')::integer;
  exception when invalid_text_representation then
    raise exception 'studio_document_invalid' using errcode = '22023';
  end;

  select document.* into row
  from public.studio_documents document
  where document.organization_id = target_organization_id
    and document.id = document_id
  for update;
  if not found then
    raise exception 'studio_document_not_found' using errcode = '22023';
  end if;
  if row.revision is distinct from expected_revision then
    raise exception 'studio_document_stale_revision' using errcode = '23505';
  end if;

  update public.studio_documents
  set title = v_title,
      settings = v_settings,
      revision = row.revision + 1,
      updated_at = pg_catalog.now()
  where organization_id = target_organization_id
    and id = document_id
  returning * into row;

  return pg_catalog.jsonb_build_object('id', row.id, 'revision', row.revision);
end;
$$;

revoke all on function public.save_studio_document(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_studio_document(uuid, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- reserve_studio_upload: mint a private reservation path. studio.edit.
-- ---------------------------------------------------------------------------
create function public.reserve_studio_upload(
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
  exception when invalid_text_representation then
    declared_size := -1;
  end;
  if kind not in ('design', 'product', 'brand_mark')
    or declared_size not between 1 and 15728640
    or declared_mime not in ('image/png', 'image/jpeg', 'image/webp')
    or filename = ''
    or pg_catalog.char_length(filename) > 200
    or filename ~ '[\\/]'
    or pg_catalog.jsonb_typeof(rights) is distinct from 'object'
    or (rights->>'accepted')::boolean is distinct from true then
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

revoke all on function public.reserve_studio_upload(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_studio_upload(uuid, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- save_studio_generation_policy: append an immutable policy version.
-- studio.policy_manage (admin/owner). No defaults are ever seeded.
-- ---------------------------------------------------------------------------
create function public.save_studio_generation_policy(
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
  exception when invalid_text_representation then
    raise exception 'studio_policy_invalid' using errcode = '22023';
  end;
  if currency is null or currency !~ '^[A-Z]{3}$'
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

revoke all on function public.save_studio_generation_policy(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_studio_generation_policy(uuid, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- admit_studio_run: validate, reserve budget, and queue a run. studio.generate.
-- Same key + same digest replays; same key + another digest is a conflict.
-- ---------------------------------------------------------------------------
create function public.admit_studio_run(
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
  exception when invalid_text_representation then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end;
  if v_document_id is null
    or v_expected_revision is null or v_expected_revision <= 0
    or v_profile_id is null
    or v_idempotency_key = ''
    or pg_catalog.char_length(v_idempotency_key) not between 8 and 200
    or v_operation not in ('generate', 'edit', 'enhance', 'new_idea')
    or v_estimated_cost is null or v_estimated_cost < 0
    or v_currency !~ '^[A-Z]{3}$'
    or v_request_digest is null or v_request_digest !~ '^[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(v_request) is distinct from 'object'
    or (v_operation = 'edit' and v_parent_version_id is null) then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;

  -- Serialize twin submits per actor+key so they converge on one run.
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

  -- Document lock serializes revision checks and the active-run fence.
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

  -- A selected campaign must be real, same-tenant, and editable by the actor.
  if v_requested_campaign_id is not null then
    perform 1
    from public.campaigns campaign
    where campaign.id = v_requested_campaign_id
      and campaign.organization_id = target_organization_id;
    if not found then
      raise exception 'studio_run_campaign_not_found' using errcode = '22023';
    end if;
    if not private.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
      raise exception 'studio_run_forbidden' using errcode = '42501';
    end if;
  end if;

  -- Current policy is the highest version; nothing is admitted without one.
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

  -- One active image-producing run per document (the partial unique index is
  -- the backstop; this check reports the honest code first).
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

revoke all on function public.admit_studio_run(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admit_studio_run(uuid, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_studio_run: request cancellation. studio.generate. Request only —
-- the worker settles the real outcome. Terminal runs are an honest no-op.
-- ---------------------------------------------------------------------------
create function public.cancel_studio_run(
  target_organization_id uuid,
  target_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.studio_runs;
  next_state text;
begin
  if (select auth.uid()) is null
    or not private.has_organization_role(
      target_organization_id,
      array['owner', 'admin', 'operator']::public.organization_role[]
    ) then
    raise exception 'studio_run_forbidden' using errcode = '42501';
  end if;

  select run.* into run
  from public.studio_runs run
  where run.organization_id = target_organization_id
    and run.id = target_run_id
  for update;
  if not found then
    raise exception 'studio_run_not_found' using errcode = '22023';
  end if;

  if run.state in ('ready', 'failed', 'cancelled', 'outcome_unknown') then
    return pg_catalog.jsonb_build_object(
      'runId', run.id, 'state', run.state, 'alreadyTerminal', true
    );
  end if;
  if run.state = 'cancel_requested' then
    return pg_catalog.jsonb_build_object(
      'runId', run.id, 'state', run.state, 'alreadyRequested', true
    );
  end if;

  next_state := private.studio_assert_transition(run.state, 'studio.run.cancel_requested');

  update public.studio_runs
  set state = next_state,
      cancel_requested_at = pg_catalog.now()
  where organization_id = target_organization_id
    and id = target_run_id;

  insert into public.studio_run_events (
    organization_id, run_id, kind, safe_payload
  ) values (
    target_organization_id, target_run_id, 'studio.run.cancel_requested',
    pg_catalog.jsonb_build_object('stage', next_state)
  );

  return pg_catalog.jsonb_build_object(
    'runId', run.id, 'state', next_state, 'alreadyTerminal', false
  );
end;
$$;

revoke all on function public.cancel_studio_run(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_studio_run(uuid, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Worker-only RPCs. Every one requires the service_role caller; user roles
-- are refused before any other check. Leases fence every mutation.
-- ---------------------------------------------------------------------------

-- complete_studio_upload: settle a reservation from the byte-intake receipt.
create function public.complete_studio_upload(
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
  exception when invalid_text_representation then
    raise exception 'studio_upload_invalid' using errcode = '22023';
  end;
  if v_final_hash is null or v_final_hash !~ '^[0-9a-f]{64}$'
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

revoke all on function public.complete_studio_upload(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_studio_upload(uuid, uuid, jsonb)
  to service_role;

-- claim_studio_run: take a bounded lease on a claimable run. Queued runs and
-- outcome_unknown recovery both claim; spent terminals never get reclaimed
-- for a new paid request.
create function public.claim_studio_run(
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
    -- A live worker owns it; only an expired lease may be reclaimed.
    if run.lease_expires_at is null or run.lease_expires_at > pg_catalog.now() then
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
      provider_request_id = target_worker_id,
      attempt = case when run.lease_token is null then run.attempt else run.attempt + 1 end
  where id = target_run_id;

  return pg_catalog.jsonb_build_object(
    'runId', run.id, 'leaseToken', token, 'leaseExpiresAt', expires_at,
    'state', run.state
  );
end;
$$;

revoke all on function public.claim_studio_run(uuid, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_studio_run(uuid, text, integer)
  to service_role;

-- heartbeat_studio_run: extend a live lease. Never resurrects terminals.
create function public.heartbeat_studio_run(
  target_run_id uuid,
  target_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.studio_runs;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'studio_run_forbidden' using errcode = '42501';
  end if;

  select run.* into run
  from public.studio_runs run
  where run.id = target_run_id
  for update;
  if not found then
    raise exception 'studio_run_not_found' using errcode = '22023';
  end if;
  if run.state in ('ready', 'failed', 'cancelled', 'outcome_unknown')
    or run.lease_token is distinct from target_lease_token
    or run.lease_expires_at is null
    or run.lease_expires_at <= pg_catalog.now() then
    raise exception 'studio_run_lease_lost' using errcode = '22023';
  end if;

  update public.studio_runs
  set lease_expires_at = pg_catalog.now() + pg_catalog.make_interval(mins => 5)
  where id = target_run_id;

  return true;
end;
$$;

revoke all on function public.heartbeat_studio_run(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.heartbeat_studio_run(uuid, uuid)
  to service_role;

-- append_studio_run_event: record a transition + optional preview receipt.
-- Event payloads carry stage/preview/error codes only — the key allowlist
-- refuses anything that could smuggle prompts, bytes, URLs, or continuations.
create function public.append_studio_run_event(
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

  -- Campaign-link events are emitted by the Task 9 linkage RPCs internally;
  -- this leased append path never carries them (the lease is long gone once
  -- a run is ready).
  if kind in (
    'studio.campaign_link_created', 'studio.campaign_link_blocked',
    'studio.campaign_link_resolved'
  ) then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;

  if kind = 'studio.run.preview_available' then
    preview := input_event->'preview';
    if pg_catalog.jsonb_typeof(preview) is distinct from 'object'
      or (preview->>'frameIndex') is null
      or (preview->>'privatePath') is null
      or (preview->>'contentHash') !~ '^[0-9a-f]{64}$'
      or (preview->>'mime') not in ('image/png', 'image/jpeg', 'image/webp') then
      raise exception 'studio_run_invalid' using errcode = '22023';
    end if;
    begin
      if (preview->>'frameIndex')::integer < 0
        or (preview->>'width')::integer not between 1 and 16384
        or (preview->>'height')::integer not between 1 and 16384
        or pg_catalog.char_length(preview->>'privatePath') not between 1 and 1024 then
        raise exception 'studio_run_invalid' using errcode = '22023';
      end if;
    exception when invalid_text_representation then
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

revoke all on function public.append_studio_run_event(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.append_studio_run_event(uuid, uuid, jsonb)
  to service_role;

-- complete_studio_run: atomically commit the immutable version, continuation,
-- current-pointer CAS, final event, and accounting. Ready means stored — a
-- provider completion alone never lands here.
create function public.complete_studio_run(
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
  exception when invalid_text_representation then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end;
  if actual_cost is not null and actual_cost < 0 then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;

  -- Suggestion operations complete with a typed result and no image version.
  if run.operation in ('enhance', 'new_idea') then
    output := input_result->'suggestion';
    if pg_catalog.jsonb_typeof(output) is distinct from 'object'
      or (output->>'originalPromptDigest') !~ '^[0-9a-f]{64}$'
      or (output->>'suggestedPrompt') is null
      or pg_catalog.char_length(output->>'suggestedPrompt') not between 1 and 6000
      or (output->>'operation') is distinct from run.operation then
      raise exception 'studio_run_invalid' using errcode = '22023';
    end if;

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

  -- Image completion: validated final receipt + private continuation.
  output := input_result->'output';
  continuation := input_result->'continuation';
  if pg_catalog.jsonb_typeof(output) is distinct from 'object'
    or pg_catalog.jsonb_typeof(continuation) is distinct from 'object'
    or (output->>'outputHash') !~ '^[0-9a-f]{64}$'
    or (output->>'outputMime') not in ('image/png', 'image/jpeg', 'image/webp')
    or (output->>'inputDigest') !~ '^[0-9a-f]{64}$'
    or (continuation->>'privateObjectHash') !~ '^[0-9a-f]{64}$'
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
  exception when invalid_text_representation then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end;

  -- Ordinal follows the document; the document lock serializes completions.
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
    nullif(continuation->>'replayExpiresAt', '')::timestamptz,
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

  -- Current pointer advances only when the admitted revision still matches;
  -- otherwise this output lands as a historical branch, honestly reported.
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

  -- Link intent for Task 9: never a linkage write, only an honest status.
  -- The admitted requested_campaign_id is preserved on the version row; Task 9
  -- converts the intent into a real selection.
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
    -- Honest final without previews: saved, flagged, never faked.
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

revoke all on function public.complete_studio_run(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_studio_run(uuid, uuid, jsonb)
  to service_role;

-- fail_studio_run: settle a failed or unknown outcome. Unknown keeps the
-- reservation open (actual NULL, never zero); definite settles it.
create function public.fail_studio_run(
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
  if safe_code not in (
    'policy_refused', 'generation_disabled', 'reference_revoked',
    'unsupported_ratio', 'unsupported_format', 'upload_failed',
    'provider_refused', 'provider_failed', 'invalid_final_bytes',
    'stream_lost', 'context_expired', 'model_unavailable', 'stale_parent',
    'link_failed', 'access_revoked', 'cancelled'
  ) or certainty not in ('definite', 'unknown') then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end if;
  begin
    actual_cost := input_failure->>'actualCostMinor';
  exception when invalid_text_representation then
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

revoke all on function public.fail_studio_run(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_studio_run(uuid, uuid, jsonb)
  to service_role;

-- reconcile_studio_run: settle an unknown run from a documented retrieval.
-- Either the retrieval proved failure (→ failed) or success was already
-- recorded under this run (→ ready, linked, never regenerated). No operator
-- override invents success: a versionId must already belong to this run.
create function public.reconcile_studio_run(
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
  version_id uuid;
  safe_code text;
  actual_cost bigint;
  owned uuid;
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
    version_id := nullif(input_receipt->>'versionId', '')::uuid;
    actual_cost := input_receipt->>'actualCostMinor';
  exception when invalid_text_representation then
    raise exception 'studio_run_invalid' using errcode = '22023';
  end;
  if settled not in ('failed', 'completed')
    or (settled = 'failed' and safe_code is null)
    or (settled = 'completed' and version_id is null)
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

  if settled = 'failed' then
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
  end if;

  select version.id into owned
  from public.studio_versions version
  where version.organization_id = run.organization_id
    and version.id = version_id
    and version.run_id = target_run_id;
  if not found then
    raise exception 'studio_run_not_reconcilable' using errcode = '22023';
  end if;

  update public.studio_runs
  set state = 'ready',
      actual_cost_minor = actual_cost,
      result_version_id = version_id,
      finished_at = pg_catalog.now()
  where id = target_run_id;

  insert into public.studio_run_events (
    organization_id, run_id, kind, safe_payload
  ) values (
    run.organization_id, run.id, 'studio.run.completed',
    pg_catalog.jsonb_build_object('stage', 'ready')
  );

  return pg_catalog.jsonb_build_object(
    'runId', run.id, 'state', 'ready', 'versionId', version_id
  );
end;
$$;

revoke all on function public.reconcile_studio_run(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_studio_run(uuid, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- Export trio. Admission preassigns the immutable export ID on a zero-cost
-- export run; the worker finalizes the validated derivative; the user pins
-- consent with an append-only acceptance receipt. The native artifact is
-- never mutated; Campaign linkage converts in Task 9.
-- ---------------------------------------------------------------------------
create function public.create_studio_export(
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
  exception when invalid_text_representation then
    raise exception 'studio_export_invalid' using errcode = '22023';
  end;
  v_preset := input_export->>'preset';
  kind := v_transform->>'kind';
  if v_version_id is null
    or v_transform_version is null or v_transform_version <= 0
    or v_preset_version is null or v_preset_version <= 0
    or v_preset not in (
      'instagram_feed', 'instagram_stories', 'google_square',
      'google_horizontal', 'google_vertical', 'ecommerce_creative'
    )
    or v_idempotency_key = ''
    or pg_catalog.char_length(v_idempotency_key) not between 8 and 200
    or v_request_digest is null or v_request_digest !~ '^[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(v_transform) is distinct from 'object'
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
  exception when invalid_text_representation then
    raise exception 'studio_export_invalid' using errcode = '22023';
  end;

  select version.* into version
  from public.studio_versions version
  where version.organization_id = target_organization_id
    and version.id = v_version_id;
  if not found then
    raise exception 'studio_export_version_not_found' using errcode = '22023';
  end if;

  -- Same inputs reuse the same export: answer from the immutable row.
  select export_row.id into existing_export_id
  from public.studio_exports export_row
  where export_row.organization_id = target_organization_id
    and export_row.studio_version_id = v_version_id
    and export_row.preset_version = v_preset_version
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
      'exportId', existing_run.result_export_id, 'replayed', true,
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

  -- expected_revision is neutral here: export completion never advances the
  -- document pointer, so no CAS value is admitted against.
  insert into public.studio_runs (
    organization_id, document_id, actor_id, operation, expected_revision,
    request, request_digest, idempotency_key, profile_id, policy_version,
    reserved_minor, currency, state, result_export_id
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

revoke all on function public.create_studio_export(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_studio_export(uuid, jsonb)
  to authenticated;

-- complete_studio_export: validate the worker receipt against the preassigned
-- export run, then insert the immutable derivative. Never forges consent.
create function public.complete_studio_export(
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
    or (receipt->>'outputHash') !~ '^[0-9a-f]{64}$'
    or (receipt->>'outputMime') not in ('image/png', 'image/jpeg', 'image/webp') then
    raise exception 'studio_export_invalid' using errcode = '22023';
  end if;
  begin
    if (receipt->>'outputWidth')::integer not between 1 and 16384
      or (receipt->>'outputHeight')::integer not between 1 and 16384
      or (receipt->>'outputBytes')::bigint <= 0
      or pg_catalog.char_length(receipt->>'outputPath') not between 1 and 1024
      or (input_receipt->>'transformVersion')::integer <= 0
      or (input_receipt->>'presetVersion')::integer <= 0
      or pg_catalog.jsonb_typeof(input_receipt->'transform') is distinct from 'object'
      or (input_receipt->'transform'->>'kind')
           not in ('proportional_resize', 'contain_pad', 'reviewed_crop') then
      raise exception 'studio_export_invalid' using errcode = '22023';
    end if;
  exception when invalid_text_representation then
    raise exception 'studio_export_invalid' using errcode = '22023';
  end;

  select run.* into run
  from public.studio_runs run
  where run.organization_id = target_organization_id
    and run.operation = 'export'
    and run.result_export_id = target_export_id
  for update;
  if not found then
    raise exception 'studio_export_not_found' using errcode = '22023';
  end if;
  if run.state in ('ready', 'failed', 'cancelled', 'outcome_unknown') then
    return pg_catalog.jsonb_build_object(
      'exportId', target_export_id, 'state', run.state, 'replayed', true
    );
  end if;
  if run.lease_token is null then
    raise exception 'studio_run_lease_lost' using errcode = '22023';
  end if;

  begin
    insert into public.studio_exports (
      id, organization_id, studio_version_id, transform_version, transform,
      preset_version, output_path, output_hash, output_mime, output_width,
      output_height, output_bytes
    ) values (
      target_export_id, target_organization_id,
      (input_receipt->>'versionId')::uuid,
      (input_receipt->>'transformVersion')::integer,
      input_receipt->'transform',
      (input_receipt->>'presetVersion')::integer,
      receipt->>'outputPath', receipt->>'outputHash', receipt->>'outputMime',
      (receipt->>'outputWidth')::integer, (receipt->>'outputHeight')::integer,
      (receipt->>'outputBytes')::bigint
    );
  exception when unique_violation then
    -- A twin worker won the race or the derivative already exists: adopt the
    -- winner instead of minting a twin.
    select export_row.id into winner_id
    from public.studio_exports export_row
    where export_row.organization_id = target_organization_id
      and (
        export_row.id = target_export_id
        or (
          export_row.studio_version_id = (input_receipt->>'versionId')::uuid
          and export_row.preset_version = (input_receipt->>'presetVersion')::integer
          and export_row.transform = input_receipt->'transform'
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
  set state = 'ready', finished_at = pg_catalog.now()
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

revoke all on function public.complete_studio_export(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_studio_export(uuid, uuid, jsonb)
  to service_role;

-- accept_studio_export: pin explicit fit/pad/crop consent to the immutable
-- export identity. Campaign linkage converts from this receipt in Task 9.
create function public.accept_studio_export(
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

  -- transform_digest is a DB-internal consent pin (md5 over normalized jsonb
  -- text is deterministic per value), not the Task 2 sha256 export identity
  -- the application computes. Equality with the stored transform row is the
  -- check; nothing recomputes this digest outside this receipt.
  insert into public.studio_export_acceptances (
    organization_id, export_id, content_hash, transform_digest, actor_id,
    idempotency_key
  ) values (
    target_organization_id, target_export_id, export_row.output_hash,
    pg_catalog.md5(export_row.transform::text),
    (select auth.uid()), key
  ) returning * into existing;

  return pg_catalog.jsonb_build_object(
    'acceptanceId', existing.id, 'replayed', false
  );
end;
$$;

revoke all on function public.accept_studio_export(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.accept_studio_export(uuid, uuid, text, text)
  to authenticated;
