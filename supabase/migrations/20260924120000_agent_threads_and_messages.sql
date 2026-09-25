-- Universal AI agent threads and messages (Task 1).
--
-- Two member-visible tables plus two RPC-only idempotency ledgers:
--
-- 1. agent_threads is one row per conversation: title, mode
--    (quick/deepthink), status, four nullable safe-id links (research
--    project, request, draft request, campaign) and timestamps. History
--    ordering and retention age both read updated_at, which every message
--    append refreshes.
-- 2. agent_messages is one row per utterance: role
--    (user/assistant/system_note), body, and three nullable jsonb payloads
--    (questionnaire answers, marker receipts, citations).
-- 3. agent_thread_create_keys / agent_message_append_keys bind an
--    idempotency key to the row it created plus a digest of the creation
--    body: the same key with the same body replays the kept row, the same
--    key with a different body is a conflict.
--
-- Four fenced RPCs (fixed search_path, explicit grants, tenant and role
-- checks inside, advisory locks for races): create_agent_thread_keyed,
-- append_agent_message, set_thread_links, purge_expired_agent_threads
-- (service_role only).
--
-- Deliberate non-FKs: the four linked_*_id columns are safe ids verified by
-- readers at use time, not database foreign keys. Pinning them to concrete
-- parent tables here would make this migration depend on tables owned by
-- other modules and would force the new plpgsql to read tables it did not
-- create (which could then only be proven by a live staging call after
-- push). The RPCs below read only the four tables created in this file;
-- membership is checked through the existing private helpers.
--
-- Retention: the purge path UPDATEs message payload columns to null and
-- keeps every identifier row (thread, message ids, roles, timestamps,
-- links), so the audit survives while the bodies are gone. Deletes reach no
-- session role: RLS is forced and no write policy exists.

-- Tables --------------------------------------------------------------------

create table public.agent_threads (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null default 'New chat',
  mode text not null check (mode in ('quick', 'deepthink')),
  status text not null default 'open' check (status in ('open', 'awaiting_user', 'running', 'completed', 'cancelled')),
  linked_research_project_id uuid null,
  linked_request_id uuid null,
  linked_draft_request_id uuid null,
  linked_campaign_id uuid null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id)
);

comment on table public.agent_threads is
  'One row per universal-agent conversation: title, mode, status, safe-id links to research/draft/campaign rows, and history timestamps. Written only through the keyed RPCs below.';

create table public.agent_messages (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null,
  thread_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'system_note')),
  body text check (body is null or pg_catalog.char_length(body) between 1 and 20000),
  questionnaire_answers jsonb null,
  marker_receipts jsonb null,
  citations jsonb null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  foreign key (organization_id, thread_id)
    references public.agent_threads(organization_id, id)
    on delete cascade
);

comment on table public.agent_messages is
  'One row per agent utterance: role, body and validated jsonb payloads. Body is nullable only so the retention purge can scrub content while keeping the audit row. Written only through append_agent_message.';

create table public.agent_thread_create_keys (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null,
  idempotency_key text not null,
  thread_id uuid not null,
  body_digest text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, thread_id)
    references public.agent_threads(organization_id, id)
    on delete cascade,
  check (
    idempotency_key = pg_catalog.btrim(idempotency_key)
    and pg_catalog.char_length(idempotency_key) between 1 and 200
  ),
  check (body_digest ~ '^[0-9a-f]{32}$')
);

comment on table public.agent_thread_create_keys is
  'Idempotency keys for thread creation: same key plus same body replays the kept thread, same key with another body is a conflict.';

create table public.agent_message_append_keys (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null,
  idempotency_key text not null,
  message_id uuid not null,
  body_digest text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, message_id)
    references public.agent_messages(organization_id, id)
    on delete cascade,
  check (
    idempotency_key = pg_catalog.btrim(idempotency_key)
    and pg_catalog.char_length(idempotency_key) between 1 and 200
  ),
  check (body_digest ~ '^[0-9a-f]{32}$')
);

comment on table public.agent_message_append_keys is
  'Idempotency keys for message appends: same key plus same body replays the kept message, same key with another body is a conflict.';

-- History ordering and retention age read updated_at, so every append and
-- link update refreshes the parent thread through the RPCs below. Direct
-- table writes hold no grant for any role, so this trigger only ever fires
-- on the governed path.

create trigger agent_threads_set_updated_at
before update on public.agent_threads
for each row execute function public.set_updated_at();

-- Tenant-leading and bounded-read indexes -------------------------------------

create index agent_threads_history_idx
  on public.agent_threads (organization_id, updated_at desc);

create index agent_messages_thread_history_idx
  on public.agent_messages (organization_id, thread_id, created_at);

create index agent_thread_create_keys_thread_idx
  on public.agent_thread_create_keys (organization_id, thread_id);

create index agent_message_append_keys_message_idx
  on public.agent_message_append_keys (organization_id, message_id);

-- RLS and least-privilege table access -----------------------------------------

alter table public.agent_threads enable row level security;
alter table public.agent_threads force row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_messages force row level security;
alter table public.agent_thread_create_keys enable row level security;
alter table public.agent_thread_create_keys force row level security;
alter table public.agent_message_append_keys enable row level security;
alter table public.agent_message_append_keys force row level security;

-- Every member reads their own organization rows (viewers included:
-- read-only means read, not blind). Nobody writes through the table: the
-- fenced RPCs below own every mutation and recheck the caller role inside.

create policy "members read own organization threads"
on public.agent_threads
for select to authenticated
using (private.is_organization_member(organization_id));

create policy "members read own organization messages"
on public.agent_messages
for select to authenticated
using (private.is_organization_member(organization_id));

create policy "members read own organization thread create keys"
on public.agent_thread_create_keys
for select to authenticated
using (private.is_organization_member(organization_id));

create policy "members read own organization message append keys"
on public.agent_message_append_keys
for select to authenticated
using (private.is_organization_member(organization_id));

revoke all on table public.agent_threads from public, anon, authenticated, service_role;
revoke all on table public.agent_messages from public, anon, authenticated, service_role;
revoke all on table public.agent_thread_create_keys from public, anon, authenticated, service_role;
revoke all on table public.agent_message_append_keys from public, anon, authenticated, service_role;

grant select on table public.agent_threads to authenticated;
grant select on table public.agent_messages to authenticated;
grant select on table public.agent_thread_create_keys to authenticated;
grant select on table public.agent_message_append_keys to authenticated;
grant select on table public.agent_threads to service_role;
grant select on table public.agent_messages to service_role;
grant select on table public.agent_thread_create_keys to service_role;
grant select on table public.agent_message_append_keys to service_role;

-- Fenced RPCs -------------------------------------------------------------------

create function public.create_agent_thread_keyed(
  p_organization_id uuid,
  p_actor_id uuid,
  p_idempotency_key text,
  p_title text,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  key_row public.agent_thread_create_keys;
  kept public.agent_threads;
  created public.agent_threads;
  clean_title text;
  body_digest text;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_role(
        p_organization_id,
        array['owner', 'admin', 'operator']::public.organization_role[]
      )
    ) then
    raise exception 'agent_thread_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_actor_id is null
    or p_idempotency_key is null
    or p_idempotency_key is distinct from pg_catalog.btrim(p_idempotency_key)
    or pg_catalog.char_length(p_idempotency_key) not between 1 and 200
    or p_mode not in ('quick', 'deepthink') then
    raise exception 'agent_thread_invalid' using errcode = '22023';
  end if;
  clean_title := pg_catalog.nullif(pg_catalog.btrim(coalesce(p_title, '')), '');
  if clean_title is null then
    clean_title := 'New chat';
  elsif pg_catalog.char_length(clean_title) > 200 then
    raise exception 'agent_thread_invalid' using errcode = '22023';
  end if;

  -- The digest pins the creation body to the key: same key plus same body
  -- replays, same key plus another body is a conflict.
  body_digest := pg_catalog.md5(pg_catalog.concat_ws(
    '|', p_organization_id::text, clean_title, p_mode
  ));

  -- One serialized create per key, so twin sends converge instead of
  -- minting twin threads.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'agent', 'create_thread_keyed',
      p_organization_id, p_idempotency_key
    ),
    0
  ));

  select key_entry.* into key_row
  from public.agent_thread_create_keys key_entry
  where key_entry.organization_id = p_organization_id
    and key_entry.idempotency_key = p_idempotency_key
  for update;
  if found then
    if key_row.body_digest is distinct from body_digest then
      raise exception 'agent_thread_key_conflict' using errcode = '23505';
    end if;
    select thread.* into kept
    from public.agent_threads thread
    where thread.organization_id = p_organization_id
      and thread.id = key_row.thread_id;
    return pg_catalog.jsonb_build_object(
      'threadId', kept.id,
      'status', kept.status,
      'replayed', true
    );
  end if;

  insert into public.agent_threads (
    organization_id, title, mode, created_by
  ) values (
    p_organization_id, clean_title, p_mode, p_actor_id
  ) returning * into created;

  insert into public.agent_thread_create_keys (
    organization_id, idempotency_key, thread_id, body_digest, created_by
  ) values (
    p_organization_id, p_idempotency_key, created.id, body_digest, p_actor_id
  );

  return pg_catalog.jsonb_build_object(
    'threadId', created.id,
    'status', created.status,
    'replayed', false
  );
end;
$$;

revoke all on function public.create_agent_thread_keyed(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_agent_thread_keyed(uuid, uuid, text, text, text)
  to authenticated, service_role;

comment on function public.create_agent_thread_keyed(uuid, uuid, text, text, text) is
  'Member thread creation (operator role or above; viewers read only) with idempotency-key replay. Returns threadId, status and replayed.';

create function public.append_agent_message(
  p_organization_id uuid,
  p_actor_id uuid,
  p_thread_id uuid,
  p_role text,
  p_body text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  key_row public.agent_message_append_keys;
  kept public.agent_messages;
  created public.agent_messages;
  clean_body text;
  body_digest text;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_role(
        p_organization_id,
        array['owner', 'admin', 'operator']::public.organization_role[]
      )
    ) then
    raise exception 'agent_message_forbidden' using errcode = '42501';
  end if;
  clean_body := pg_catalog.btrim(coalesce(p_body, ''));
  if p_organization_id is null
    or p_actor_id is null
    or p_thread_id is null
    or p_role not in ('user', 'assistant', 'system_note')
    or pg_catalog.char_length(clean_body) not between 1 and 20000
    or p_idempotency_key is null
    or p_idempotency_key is distinct from pg_catalog.btrim(p_idempotency_key)
    or pg_catalog.char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'agent_message_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.agent_threads thread
    where thread.organization_id = p_organization_id
      and thread.id = p_thread_id
  ) then
    raise exception 'agent_thread_not_found' using errcode = '42501';
  end if;

  body_digest := pg_catalog.md5(pg_catalog.concat_ws(
    '|', p_organization_id::text, p_thread_id::text, p_role, clean_body
  ));

  -- One serialized append per key, so a retried send converges instead of
  -- double-posting the message.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'agent', 'append_message',
      p_organization_id, p_idempotency_key
    ),
    0
  ));

  select key_entry.* into key_row
  from public.agent_message_append_keys key_entry
  where key_entry.organization_id = p_organization_id
    and key_entry.idempotency_key = p_idempotency_key
  for update;
  if found then
    if key_row.body_digest is distinct from body_digest then
      raise exception 'agent_message_key_conflict' using errcode = '23505';
    end if;
    select message.* into kept
    from public.agent_messages message
    where message.organization_id = p_organization_id
      and message.id = key_row.message_id;
    return pg_catalog.jsonb_build_object(
      'messageId', kept.id,
      'threadId', kept.thread_id,
      'replayed', true
    );
  end if;

  insert into public.agent_messages (
    organization_id, thread_id, role, body, created_by
  ) values (
    p_organization_id, p_thread_id, p_role, clean_body, p_actor_id
  ) returning * into created;

  insert into public.agent_message_append_keys (
    organization_id, idempotency_key, message_id, body_digest, created_by
  ) values (
    p_organization_id, p_idempotency_key, created.id, body_digest, p_actor_id
  );

  -- History ordering and retention age read the parent thread clock.
  update public.agent_threads thread
  set updated_at = pg_catalog.now()
  where thread.organization_id = p_organization_id
    and thread.id = p_thread_id;

  return pg_catalog.jsonb_build_object(
    'messageId', created.id,
    'threadId', created.thread_id,
    'replayed', false
  );
end;
$$;

revoke all on function public.append_agent_message(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.append_agent_message(uuid, uuid, uuid, text, text, text)
  to authenticated, service_role;

comment on function public.append_agent_message(uuid, uuid, uuid, text, text, text) is
  'Member message append (operator role or above; viewers read only) with idempotency-key replay. Refreshes the parent thread clock. Returns messageId, threadId and replayed.';

create function public.set_thread_links(
  p_organization_id uuid,
  p_actor_id uuid,
  p_thread_id uuid,
  p_project_id uuid,
  p_request_id uuid,
  p_draft_request_id uuid,
  p_campaign_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.agent_threads;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_role(
        p_organization_id,
        array['owner', 'admin', 'operator']::public.organization_role[]
      )
    ) then
    raise exception 'agent_thread_links_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_actor_id is null
    or p_thread_id is null then
    raise exception 'agent_thread_links_invalid' using errcode = '22023';
  end if;

  -- Short fenced link write: the thread must belong to the calling
  -- organization, so a worker holding one tenant scope can never relink
  -- another tenant thread. Link targets stay safe ids verified by readers
  -- at use time (see file header); passing all four as null clears them.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'agent', 'thread_links',
      p_organization_id, p_thread_id
    ),
    0
  ));

  update public.agent_threads thread
  set linked_research_project_id = p_project_id,
    linked_request_id = p_request_id,
    linked_draft_request_id = p_draft_request_id,
    linked_campaign_id = p_campaign_id
  where thread.organization_id = p_organization_id
    and thread.id = p_thread_id
  returning * into updated;
  if not found then
    raise exception 'agent_thread_not_found' using errcode = '42501';
  end if;

  return pg_catalog.jsonb_build_object(
    'threadId', updated.id,
    'projectId', updated.linked_research_project_id,
    'requestId', updated.linked_request_id,
    'draftRequestId', updated.linked_draft_request_id,
    'campaignId', updated.linked_campaign_id,
    'replayed', false
  );
end;
$$;

revoke all on function public.set_thread_links(uuid, uuid, uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.set_thread_links(uuid, uuid, uuid, uuid, uuid, uuid, uuid)
  to authenticated, service_role;

comment on function public.set_thread_links(uuid, uuid, uuid, uuid, uuid, uuid, uuid) is
  'Governed thread link update (operator role or above, or the worker under service_role). Fenced to the calling organization. Returns the kept link ids.';

create function public.purge_expired_agent_threads(
  p_older_than timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  purged_count integer := 0;
begin
  -- Privileged path only: browser sessions hold no execute grant and fail
  -- before this check. The retention worker calls this on schedule.
  if pg_catalog.current_setting('role', true) is distinct from 'service_role' then
    raise exception 'agent_purge_forbidden' using errcode = '42501';
  end if;
  if p_older_than is null or p_older_than >= pg_catalog.now() then
    raise exception 'agent_purge_invalid' using errcode = '22023';
  end if;

  -- Bodies only: payload columns go null while every identifier row stays
  -- (thread rows, message ids, roles, timestamps, links), so the lineage
  -- audit survives retention. Already-scrubbed rows never match twice, so
  -- the count reports newly scrubbed messages and reruns are no-ops.
  update public.agent_messages message
  set body = null,
    questionnaire_answers = null,
    marker_receipts = null,
    citations = null
  where message.body is not null
    and message.thread_id in (
      select thread.id
      from public.agent_threads thread
      where thread.updated_at < p_older_than
    );
  get diagnostics purged_count = row_count;

  return pg_catalog.jsonb_build_object(
    'purgedMessages', purged_count,
    'replayed', false
  );
end;
$$;

revoke all on function public.purge_expired_agent_threads(timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.purge_expired_agent_threads(timestamptz)
  to service_role;

comment on function public.purge_expired_agent_threads(timestamptz) is
  'Service-only retention scrub: nulls message payloads on threads older than the cutoff while keeping every audit row. Reruns are no-ops.';
