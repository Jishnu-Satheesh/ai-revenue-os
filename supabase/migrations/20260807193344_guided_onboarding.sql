create table public.onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'archived')),
  current_section_key text not null default 'business_identity' check (current_section_key in (
    'business_identity', 'branches_operations', 'products_services', 'channels_presence',
    'historical_performance', 'customers_consent', 'brand_assets', 'governance',
    'integrations_uploads', 'review_readiness'
  )),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.onboarding_section_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null,
  section_key text not null check (section_key in (
    'business_identity', 'branches_operations', 'products_services', 'channels_presence',
    'historical_performance', 'customers_consent', 'brand_assets', 'governance',
    'integrations_uploads', 'review_readiness'
  )),
  status text not null default 'not_started' check (status in (
    'not_started', 'in_progress', 'complete', 'needs_attention', 'blocked'
  )),
  payload jsonb not null default '{}'::jsonb,
  source_metadata jsonb not null default '[]'::jsonb,
  updated_by uuid references auth.users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, section_key),
  unique (organization_id, id),
  foreign key (organization_id, session_id)
    references public.onboarding_sessions(organization_id, id) on delete cascade
);

create table public.onboarding_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null,
  section_key text not null check (section_key in (
    'business_identity', 'branches_operations', 'products_services', 'channels_presence',
    'historical_performance', 'customers_consent', 'brand_assets', 'governance',
    'integrations_uploads', 'review_readiness'
  )),
  title text not null check (char_length(title) between 2 and 200),
  description text not null check (char_length(description) between 2 and 2000),
  assignee_user_id uuid references auth.users(id),
  client_contact text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'fulfilled', 'cancelled')),
  due_date date,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, session_id)
    references public.onboarding_sessions(organization_id, id) on delete cascade
);

create table public.onboarding_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null,
  section_key text not null check (section_key in (
    'products_services', 'historical_performance', 'brand_assets', 'integrations_uploads'
  )),
  storage_path text not null,
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  media_type text not null check (char_length(media_type) between 1 and 120),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 52428800),
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'uploaded', 'extracting', 'succeeded', 'failed')),
  error_summary text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, checksum),
  unique (organization_id, id),
  foreign key (organization_id, session_id)
    references public.onboarding_sessions(organization_id, id) on delete cascade
);

create table public.onboarding_extractions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  upload_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  provider text,
  model text,
  retry_count smallint not null default 0 check (retry_count >= 0),
  error_summary text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, upload_id),
  foreign key (organization_id, upload_id)
    references public.onboarding_uploads(organization_id, id) on delete cascade
);

create table public.onboarding_extraction_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  extraction_id uuid not null,
  section_key text not null check (section_key in (
    'products_services', 'historical_performance', 'customers_consent', 'brand_assets', 'governance'
  )),
  candidate_type text not null check (candidate_type in ('fact', 'metric', 'catalog_row', 'clarification')),
  fact_key text,
  candidate_payload jsonb not null default '{}'::jsonb,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  evidence jsonb not null default '[]'::jsonb,
  contradiction_references jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'edited', 'rejected', 'unknown')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, extraction_id)
    references public.onboarding_extractions(organization_id, id) on delete cascade
);

create table public.ai_readiness_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null,
  rubric_version text not null,
  overall_score smallint not null check (overall_score between 0 and 100),
  capability_scores jsonb not null default '{}'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  next_actions jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, session_id)
    references public.onboarding_sessions(organization_id, id) on delete cascade
);

create table public.onboarding_idempotency_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation text not null check (char_length(operation) between 2 and 120),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  response_payload jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, operation, idempotency_key)
);

create index onboarding_sessions_organization_status_idx
  on public.onboarding_sessions(organization_id, status, updated_at desc);
create index onboarding_section_states_organization_updated_idx
  on public.onboarding_section_states(organization_id, updated_at desc);
create index onboarding_requests_organization_status_idx
  on public.onboarding_requests(organization_id, status, updated_at desc);
create index onboarding_uploads_organization_status_idx
  on public.onboarding_uploads(organization_id, status, updated_at desc);
create index onboarding_candidates_organization_session_idx
  on public.onboarding_extraction_candidates(organization_id, extraction_id, created_at);
create index onboarding_assessments_organization_created_idx
  on public.ai_readiness_assessments(organization_id, created_at desc);

create trigger onboarding_sessions_set_updated_at before update on public.onboarding_sessions
for each row execute function public.set_updated_at();
create trigger onboarding_section_states_set_updated_at before update on public.onboarding_section_states
for each row execute function public.set_updated_at();
create trigger onboarding_requests_set_updated_at before update on public.onboarding_requests
for each row execute function public.set_updated_at();
create trigger onboarding_uploads_set_updated_at before update on public.onboarding_uploads
for each row execute function public.set_updated_at();
create trigger onboarding_extractions_set_updated_at before update on public.onboarding_extractions
for each row execute function public.set_updated_at();
create trigger onboarding_candidates_set_updated_at before update on public.onboarding_extraction_candidates
for each row execute function public.set_updated_at();

alter table public.onboarding_sessions enable row level security;
alter table public.onboarding_section_states enable row level security;
alter table public.onboarding_requests enable row level security;
alter table public.onboarding_uploads enable row level security;
alter table public.onboarding_extractions enable row level security;
alter table public.onboarding_extraction_candidates enable row level security;
alter table public.ai_readiness_assessments enable row level security;
alter table public.onboarding_idempotency_records enable row level security;

create policy "members can read onboarding sessions"
on public.onboarding_sessions for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create onboarding sessions"
on public.onboarding_sessions for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));
create policy "operators can update onboarding sessions"
on public.onboarding_sessions for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]))
with check (private.is_organization_member(organization_id));

create policy "members can read onboarding section states"
on public.onboarding_section_states for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create onboarding section states"
on public.onboarding_section_states for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));
create policy "operators can update onboarding section states"
on public.onboarding_section_states for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]))
with check (private.is_organization_member(organization_id));

create policy "members can read onboarding requests"
on public.onboarding_requests for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create onboarding requests"
on public.onboarding_requests for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));
create policy "operators can update onboarding requests"
on public.onboarding_requests for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]))
with check (private.is_organization_member(organization_id));

create policy "members can read onboarding uploads"
on public.onboarding_uploads for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create onboarding uploads"
on public.onboarding_uploads for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));
create policy "operators can update onboarding uploads"
on public.onboarding_uploads for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]))
with check (private.is_organization_member(organization_id));

create policy "members can read onboarding extractions"
on public.onboarding_extractions for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create onboarding extractions"
on public.onboarding_extractions for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));
create policy "operators can update onboarding extractions"
on public.onboarding_extractions for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]))
with check (private.is_organization_member(organization_id));

create policy "members can read onboarding candidates"
on public.onboarding_extraction_candidates for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create onboarding candidates"
on public.onboarding_extraction_candidates for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));
create policy "operators can update onboarding candidates"
on public.onboarding_extraction_candidates for update to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]))
with check (private.is_organization_member(organization_id));

create policy "members can read onboarding assessments"
on public.ai_readiness_assessments for select to authenticated
using (private.is_organization_member(organization_id));
create policy "operators can create onboarding assessments"
on public.ai_readiness_assessments for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));

create policy "operators can read onboarding idempotency records"
on public.onboarding_idempotency_records for select to authenticated
using (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));
create policy "operators can create onboarding idempotency records"
on public.onboarding_idempotency_records for insert to authenticated
with check (private.has_organization_role(organization_id, array['owner', 'admin', 'operator']::public.organization_role[]));

insert into storage.buckets (id, name, public)
values ('onboarding-files', 'onboarding-files', false)
on conflict (id) do update set public = excluded.public;

create policy "members can read onboarding files"
on storage.objects for select to authenticated
using (
  bucket_id = 'onboarding-files'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and private.is_organization_member(((storage.foldername(name))[1])::uuid)
);
create policy "operators can upload onboarding files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'onboarding-files'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and private.has_organization_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin', 'operator']::public.organization_role[])
);
create policy "operators can update onboarding files"
on storage.objects for update to authenticated
using (
  bucket_id = 'onboarding-files'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and private.has_organization_role(((storage.foldername(name))[1])::uuid, array['owner', 'admin', 'operator']::public.organization_role[])
)
with check (
  bucket_id = 'onboarding-files'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and private.is_organization_member(((storage.foldername(name))[1])::uuid)
);

create or replace function private.audit_onboarding_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_organization_id uuid := coalesce(new.organization_id, old.organization_id);
  target_entity_id uuid := coalesce(new.id, old.id);
  target_event_name text := lower('onboarding.' || replace(TG_TABLE_NAME, 'onboarding_', '') || '.' || lower(TG_OP));
begin
  insert into public.audit_events (organization_id, event_name, actor_type, actor_id, entity_type, entity_id, payload)
  values (
    target_organization_id,
    target_event_name,
    case when (select auth.uid()) is null then 'system' else 'user' end,
    (select auth.uid()),
    TG_TABLE_NAME,
    target_entity_id,
    jsonb_build_object('operation', TG_OP)
  );
  return new;
end;
$$;

create trigger onboarding_sessions_audit after insert or update on public.onboarding_sessions
for each row execute function private.audit_onboarding_change();
create trigger onboarding_section_states_audit after insert or update on public.onboarding_section_states
for each row execute function private.audit_onboarding_change();
create trigger onboarding_requests_audit after insert or update on public.onboarding_requests
for each row execute function private.audit_onboarding_change();
create trigger onboarding_uploads_audit after insert or update on public.onboarding_uploads
for each row execute function private.audit_onboarding_change();
create trigger onboarding_extractions_audit after insert or update on public.onboarding_extractions
for each row execute function private.audit_onboarding_change();
create trigger onboarding_candidates_audit after insert or update on public.onboarding_extraction_candidates
for each row execute function private.audit_onboarding_change();
create trigger onboarding_assessments_audit after insert on public.ai_readiness_assessments
for each row execute function private.audit_onboarding_change();

revoke all on function private.audit_onboarding_change() from public;
