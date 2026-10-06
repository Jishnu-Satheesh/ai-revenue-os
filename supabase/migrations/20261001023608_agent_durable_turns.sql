-- Durable work for one agent user message. No direct member writes.
create table public.agent_turns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  thread_id uuid not null,
  user_message_id uuid not null,
  requested_by uuid not null references auth.users(id),
  idempotency_key text not null check (length(idempotency_key) between 16 and 200),
  objective text not null check (objective in ('business_advice','channel_assessment','report_intake','research','other')),
  status text not null default 'queued' check (status in ('queued','running','awaiting_user','awaiting_approval','completed','failed','cancelled')),
  pending_challenge jsonb,
  challenge_answers jsonb,
  answered_challenge_kind text check (answered_challenge_kind is null or answered_challenge_kind in ('metadata','correction','scope')),
  pending_approval jsonb check (pending_approval is null or (jsonb_typeof(pending_approval)='object' and pg_column_size(pending_approval)<=1024)),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt integer not null default 0 check (attempt between 0 and 20),
  next_event_seq integer not null default 1 check (next_event_seq > 0),
  final_message_id uuid,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,id),
  unique (organization_id,user_message_id),
  unique (organization_id,idempotency_key),
  foreign key (organization_id,thread_id) references public.agent_threads(organization_id,id) on delete cascade,
  foreign key (organization_id,user_message_id) references public.agent_messages(organization_id,id),
  foreign key (organization_id,final_message_id) references public.agent_messages(organization_id,id),
  check ((lease_token is null) = (lease_expires_at is null)),
  check (pending_challenge is null or (jsonb_typeof(pending_challenge) = 'object' and pg_column_size(pending_challenge) <= 8192)),
  check (challenge_answers is null or (jsonb_typeof(challenge_answers) = 'object' and pg_column_size(challenge_answers) <= 4096))
);

alter table public.agent_messages add column turn_id uuid;
alter table public.agent_messages add constraint agent_messages_turn_fk
  foreign key (organization_id,turn_id) references public.agent_turns(organization_id,id);
create unique index agent_messages_one_final_per_turn_idx
  on public.agent_messages (organization_id,turn_id)
  where role = 'assistant' and turn_id is not null;
create index agent_turns_thread_history_idx on public.agent_turns (organization_id,thread_id,created_at,id);
create index agent_turns_work_idx on public.agent_turns (status,lease_expires_at) where status in ('queued','running');

create table public.agent_turn_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  turn_id uuid not null,
  seq integer not null check (seq > 0),
  event_key text not null check (length(event_key) between 1 and 200),
  event_type text not null check (event_type in (
    'turn_queued','turn_started','period_switched','analysis_started','analysis_completed',
    'report_uploaded','report_processed','research_completed','challenge_requested',
    'challenge_answered','approval_required','answer_completed','turn_failed','turn_cancelled'
  )),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object' and pg_column_size(payload) <= 8192),
  occurred_at timestamptz not null default now(),
  unique (organization_id,turn_id,seq),
  unique (organization_id,turn_id,event_key),
  foreign key (organization_id,turn_id) references public.agent_turns(organization_id,id) on delete cascade
);
create index agent_turn_events_read_idx on public.agent_turn_events (organization_id,turn_id,seq);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('agent-report-staging','agent-report-staging',false,52428800,
  array['text/csv','application/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

create table public.agent_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  turn_id uuid not null,
  created_by uuid not null references auth.users(id),
  idempotency_key text not null check (length(idempotency_key) between 16 and 200),
  file_name text not null check (length(file_name) between 1 and 255),
  media_type text not null check (media_type in ('text/csv','application/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  byte_size bigint not null check (byte_size between 1 and 52428800),
  storage_bucket_id text not null default 'agent-report-staging' check (storage_bucket_id='agent-report-staging'),
  storage_path text not null unique,
  sha256_digest text check (sha256_digest ~ '^[0-9a-f]{64}$'),
  declared_scope jsonb check (declared_scope is null or (jsonb_typeof(declared_scope)='object' and pg_column_size(declared_scope) <= 4096)),
  status text not null default 'awaiting_upload' check (status in ('awaiting_upload','verified','promoted','failed','expired')),
  package_id uuid,
  upload_expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  staging_deleted_at timestamptz,
  unique (organization_id,id),
  unique (organization_id,turn_id),
  unique (organization_id,turn_id,idempotency_key),
  foreign key (organization_id,turn_id) references public.agent_turns(organization_id,id) on delete cascade,
  foreign key (organization_id,package_id) references public.integration_report_packages(organization_id,id)
);
create index agent_attachments_expiry_idx on public.agent_attachments (upload_expires_at) where status='awaiting_upload';

alter table public.agent_turns enable row level security;
alter table public.agent_turns force row level security;
alter table public.agent_turn_events enable row level security;
alter table public.agent_turn_events force row level security;
alter table public.agent_attachments enable row level security;
alter table public.agent_attachments force row level security;

create policy "members read own agent turns" on public.agent_turns for select to authenticated
  using (private.is_organization_member(organization_id));
create policy "members read own agent turn events" on public.agent_turn_events for select to authenticated
  using (private.is_organization_member(organization_id));
create policy "members read own agent attachments" on public.agent_attachments for select to authenticated
  using (private.is_organization_member(organization_id));

revoke all on public.agent_turns,public.agent_turn_events,public.agent_attachments from public,anon,authenticated,service_role;
grant select on public.agent_turns,public.agent_turn_events,public.agent_attachments to authenticated,service_role;

create policy "operators stage agent report attachments" on storage.objects for insert to authenticated
with check (
  bucket_id='agent-report-staging' and exists (
    select 1 from public.agent_attachments a
    where a.storage_path=name and a.organization_id::text=(storage.foldername(name))[1]
      and a.turn_id::text=(storage.foldername(name))[2]
      and a.id::text=(storage.foldername(name))[3]
      and a.created_by=(select auth.uid()) and a.status='awaiting_upload'
      and a.upload_expires_at>now()
      and private.has_organization_permission(a.organization_id,'report.upload')
  )
);

-- Resolve current actor authority without trusting a stale JWT role or a
-- worker's remembered membership. The caller is a guarded RPC, never a
-- browser-supplied actor id alone.
create function private.agent_turn_actor_has_permission(p_organization_id uuid,p_actor_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.organization_role_permissions rp
    where rp.organization_role=private.effective_organization_role(p_organization_id,p_actor_id)
      and rp.permission_key=p_permission
  );
$$;
revoke all on function private.agent_turn_actor_has_permission(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.agent_turn_actor_has_permission(uuid,uuid,text) to service_role;

create function public.create_agent_turn(
  p_organization_id uuid,p_actor_id uuid,p_thread_id uuid,p_user_message_id uuid,
  p_idempotency_key text,p_objective text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_turns; message_row public.agent_messages;
begin
  if (select auth.uid()) is distinct from p_actor_id
    or private.effective_organization_role(p_organization_id,p_actor_id) is null
  then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 200
    or p_objective not in ('business_advice','channel_assessment','report_intake','research','other')
  then raise exception 'agent_turn_invalid' using errcode='22023'; end if;
  select * into message_row from public.agent_messages
   where organization_id=p_organization_id and thread_id=p_thread_id and id=p_user_message_id and role='user';
  if not found or message_row.created_by is distinct from p_actor_id
    then raise exception 'agent_message_not_found' using errcode='42501'; end if;
  if private.effective_organization_role(p_organization_id,p_actor_id)='viewer'::public.organization_role
    and p_objective not in ('business_advice','channel_assessment','other')
    then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  if p_objective='report_intake' and not private.has_organization_permission(p_organization_id,'report.upload')
    then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('agent_turn:'||p_organization_id::text||':'||p_user_message_id::text,0));
  select * into kept from public.agent_turns where organization_id=p_organization_id
    and (user_message_id=p_user_message_id or idempotency_key=p_idempotency_key) for update;
  if found then
    if kept.thread_id<>p_thread_id or kept.user_message_id<>p_user_message_id
      or kept.idempotency_key<>p_idempotency_key or kept.objective<>p_objective
    then raise exception 'agent_turn_key_conflict' using errcode='23505'; end if;
    return jsonb_build_object('turnId',kept.id,'status',kept.status,'replayed',true);
  end if;
  insert into public.agent_turns (organization_id,thread_id,user_message_id,requested_by,idempotency_key,objective)
  values (p_organization_id,p_thread_id,p_user_message_id,p_actor_id,p_idempotency_key,p_objective)
  returning * into kept;
  insert into public.agent_turn_events (organization_id,turn_id,seq,event_key,event_type)
  values (p_organization_id,kept.id,1,'turn:queued','turn_queued');
  update public.agent_turns set next_event_seq=2 where id=kept.id;
  return jsonb_build_object('turnId',kept.id,'status',kept.status,'replayed',false);
end $$;

create function public.claim_agent_turn(p_organization_id uuid,p_turn_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_turns;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  select * into kept from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found then raise exception 'agent_turn_not_found' using errcode='42501'; end if;
  if private.effective_organization_role(p_organization_id,kept.requested_by) is null
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  if kept.objective='report_intake' and not private.agent_turn_actor_has_permission(p_organization_id,kept.requested_by,'report.upload')
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  if kept.status not in ('queued','running') or (kept.status='running' and kept.lease_expires_at>now())
    then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  if kept.attempt>=20 or p_lease_token is null then raise exception 'agent_turn_attempts_exhausted' using errcode='23514'; end if;
  update public.agent_turns set status='running',lease_token=p_lease_token,
    lease_expires_at=now()+interval '5 minutes',attempt=attempt+1,updated_at=now()
    where id=p_turn_id returning * into kept;
  return jsonb_build_object('turnId',kept.id,'status',kept.status,'leaseToken',kept.lease_token,'attempt',kept.attempt);
end $$;

create function public.heartbeat_agent_turn(p_organization_id uuid,p_turn_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_turns;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  select * into kept from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found then raise exception 'agent_turn_not_found' using errcode='42501'; end if;
  if kept.status<>'running' or kept.lease_token is distinct from p_lease_token or kept.lease_expires_at<=now()
    then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  if private.effective_organization_role(p_organization_id,kept.requested_by) is null
    or (kept.objective='report_intake' and not private.agent_turn_actor_has_permission(p_organization_id,kept.requested_by,'report.upload'))
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  update public.agent_turns set lease_expires_at=now()+interval '5 minutes',updated_at=now()
  where organization_id=p_organization_id and id=p_turn_id returning * into kept;
  return jsonb_build_object('turnId',kept.id,'status',kept.status,'leaseExpiresAt',kept.lease_expires_at);
end $$;

create function public.get_agent_turn_actor_role(p_organization_id uuid,p_turn_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_turns; actor_role public.organization_role;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  select * into kept from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found then raise exception 'agent_turn_not_found' using errcode='42501'; end if;
  if kept.status<>'running' or kept.lease_token is distinct from p_lease_token or kept.lease_expires_at<=now()
    then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  actor_role:=private.effective_organization_role(p_organization_id,kept.requested_by);
  if actor_role is null or (kept.objective='report_intake' and
    not private.agent_turn_actor_has_permission(p_organization_id,kept.requested_by,'report.upload'))
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  return jsonb_build_object('turnId',kept.id,'actorId',kept.requested_by,'role',actor_role);
end $$;

create function public.append_agent_turn_event(p_organization_id uuid,p_turn_id uuid,p_lease_token uuid,
  p_event_key text,p_event_type text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_turns; event_row public.agent_turn_events;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  select * into kept from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found then raise exception 'agent_turn_not_found' using errcode='42501'; end if;
  if private.effective_organization_role(p_organization_id,kept.requested_by) is null
    or (kept.objective='report_intake' and not private.agent_turn_actor_has_permission(p_organization_id,kept.requested_by,'report.upload'))
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  if kept.lease_token is distinct from p_lease_token or kept.lease_expires_at<=now() or kept.status<>'running'
    then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  select * into event_row from public.agent_turn_events where organization_id=p_organization_id and turn_id=p_turn_id and event_key=p_event_key;
  if found then
    if event_row.event_type<>p_event_type or event_row.payload<>coalesce(p_payload,'{}'::jsonb)
      then raise exception 'agent_event_key_conflict' using errcode='23505'; end if;
    return jsonb_build_object('eventId',event_row.id,'seq',event_row.seq,'replayed',true);
  end if;
  insert into public.agent_turn_events (organization_id,turn_id,seq,event_key,event_type,payload)
  values (p_organization_id,p_turn_id,kept.next_event_seq,p_event_key,p_event_type,coalesce(p_payload,'{}'::jsonb))
  returning * into event_row;
  update public.agent_turns set next_event_seq=next_event_seq+1,updated_at=now() where id=p_turn_id;
  return jsonb_build_object('eventId',event_row.id,'seq',event_row.seq,'replayed',false);
end $$;

create function private.agent_report_scope_is_valid(p_organization_id uuid,p_scope jsonb)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare channel_id uuid; branch_id uuid; period_start date; period_end date; has_mappings boolean;
begin
  if jsonb_typeof(p_scope)<>'object' or pg_column_size(p_scope)>4096
    or (select count(*) from jsonb_object_keys(p_scope))<>6
    or not (p_scope ?& array['channelId','branchId','reportType','periodStart','periodEnd','currency'])
    or coalesce(p_scope->>'channelId','') !~* '^[0-9a-f-]{36}$'
    or coalesce(p_scope->>'branchId','') !~* '^[0-9a-f-]{36}$'
    or length(btrim(coalesce(p_scope->>'reportType',''))) not between 2 and 120
    or coalesce(p_scope->>'periodStart','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_scope->>'periodEnd','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(p_scope->>'currency','') !~ '^[A-Z]{3}$'
  then return false; end if;
  channel_id:=(p_scope->>'channelId')::uuid;
  branch_id:=(p_scope->>'branchId')::uuid;
  period_start:=(p_scope->>'periodStart')::date;
  period_end:=(p_scope->>'periodEnd')::date;
  if period_end<period_start then return false; end if;
  if not exists (select 1 from public.organization_channels c where c.organization_id=p_organization_id and c.id=channel_id and c.status='active')
    or not exists (select 1 from public.branches b where b.organization_id=p_organization_id and b.id=branch_id and b.is_active)
  then return false; end if;
  select exists(select 1 from public.organization_channel_branches m
    where m.organization_id=p_organization_id and m.channel_id=channel_id and m.status='active') into has_mappings;
  if has_mappings and not exists (select 1 from public.organization_channel_branches m
    where m.organization_id=p_organization_id and m.channel_id=channel_id and m.branch_id=branch_id
      and m.status='active' and (m.effective_from is null or m.effective_from<=period_start)
      and (m.effective_to is null or m.effective_to>=period_end))
  then return false; end if;
  return true;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  return false;
end $$;
revoke all on function private.agent_report_scope_is_valid(uuid,jsonb) from public,anon,authenticated,service_role;

create function private.agent_challenge_fields_are_valid(p_kind text,p_fields jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare field jsonb; choice jsonb; key_name text; keys text[]:=array[]::text[]; option_values text[];
begin
  if p_kind not in ('metadata','correction','scope') or jsonb_typeof(p_fields)<>'array'
    or jsonb_array_length(p_fields) not between 1 and 8 or pg_column_size(p_fields)>7000
  then return false; end if;
  for field in select value from jsonb_array_elements(p_fields) loop
    if jsonb_typeof(field)<>'object' or (select count(*) from jsonb_object_keys(field)) not between 4 and 6
      or not (field ?& array['key','label','kind','required'])
      or coalesce(field->>'key','') !~ '^[a-z][A-Za-z0-9_]{0,60}$'
      or length(btrim(coalesce(field->>'label',''))) not between 1 and 120
      or coalesce(field->>'kind','') not in ('text','date','single_select','multi_select','confirm')
      or jsonb_typeof(field->'required')<>'boolean'
      or (field ? 'helpText' and length(coalesce(field->>'helpText',''))>280)
    then return false; end if;
    key_name:=field->>'key';
    if key_name=any(keys) then return false; end if;
    keys:=array_append(keys,key_name);
    if field->>'kind' in ('single_select','multi_select') then
      if jsonb_typeof(field->'options')<>'array' or jsonb_array_length(field->'options') not between 1 and 12 then return false; end if;
      option_values:=array[]::text[];
      for choice in select value from jsonb_array_elements(field->'options') loop
        if jsonb_typeof(choice)<>'object' or (select count(*) from jsonb_object_keys(choice))<>2
          or not (choice ?& array['value','label'])
          or length(btrim(coalesce(choice->>'value',''))) not between 1 and 120
          or length(btrim(coalesce(choice->>'label',''))) not between 1 and 120
          or choice->>'value'=any(option_values) then return false; end if;
        option_values:=array_append(option_values,choice->>'value');
      end loop;
    elsif field ? 'options' then return false; end if;
  end loop;
  if p_kind='metadata' then
    return keys <@ array['branchId','channelId','currency','periodEnd','periodStart','reportType']
      and not exists(select 1 from jsonb_array_elements(p_fields) f
        where f->>'required'<>'true' or
          (f->>'key' in ('channelId','branchId') and (f->>'kind'<>'single_select' or
            exists(select 1 from jsonb_array_elements(f->'options') o where coalesce(o->>'value','') !~* '^[0-9a-f-]{36}$')))
          or (f->>'key' in ('periodStart','periodEnd') and f->>'kind'<>'date')
          or (f->>'key' in ('reportType','currency') and f->>'kind'<>'text'));
  elsif p_kind='correction' then
    return keys=array['decision'] and p_fields->0->>'kind'='single_select'
      and p_fields->0->>'required'='true'
      and array(select value->>'value' from jsonb_array_elements(p_fields->0->'options') order by 1)
        =array['keep_existing','submit_for_review'];
  end if;
  return true;
end $$;
revoke all on function private.agent_challenge_fields_are_valid(text,jsonb) from public,anon,authenticated,service_role;

create function private.agent_challenge_answers_are_valid(p_fields jsonb,p_answers jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare field jsonb; value jsonb; key_name text; answer_key text; kind_name text; allowed text[]; picked text;
begin
  if jsonb_typeof(p_answers)<>'object' or pg_column_size(p_answers)>4096 then return false; end if;
  for answer_key in select jsonb_object_keys(p_answers) loop
    if not exists(select 1 from jsonb_array_elements(p_fields) f where f->>'key'=answer_key) then return false; end if;
  end loop;
  for field in select v from jsonb_array_elements(p_fields) v loop
    key_name:=field->>'key'; kind_name:=field->>'kind'; value:=p_answers->key_name;
    if value is null then
      if field->>'required'='true' then return false; end if;
      continue;
    end if;
    if kind_name='text' then
      if jsonb_typeof(value)<>'string' or length(btrim(value #>> '{}')) not between 1 and 500 then return false; end if;
    elsif kind_name='date' then
      if jsonb_typeof(value)<>'string' or (value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
      begin
        perform (value #>> '{}')::date;
      exception when invalid_datetime_format or datetime_field_overflow then return false;
      end;
    elsif kind_name='single_select' then
      if jsonb_typeof(value)<>'string' or not exists(
        select 1 from jsonb_array_elements(field->'options') o where o->>'value'=value #>> '{}'
      ) then return false; end if;
    elsif kind_name='multi_select' then
      if jsonb_typeof(value)<>'array' or jsonb_array_length(value)>12
        or (field->>'required'='true' and jsonb_array_length(value)=0) then return false; end if;
      allowed:=array(select o->>'value' from jsonb_array_elements(field->'options') o);
      for picked in select x #>> '{}' from jsonb_array_elements(value) x loop
        if picked is null or not picked=any(allowed) then return false; end if;
      end loop;
    elsif kind_name='confirm' then
      if jsonb_typeof(value)<>'boolean' or (field->>'required'='true' and value<>'true'::jsonb) then return false; end if;
    else return false;
    end if;
  end loop;
  return true;
end $$;
revoke all on function private.agent_challenge_answers_are_valid(jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.set_agent_turn_challenge(p_organization_id uuid,p_turn_id uuid,p_lease_token uuid,
  p_kind text,p_fields jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_turns; challenge_id uuid;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  if not private.agent_challenge_fields_are_valid(p_kind,p_fields)
    then raise exception 'agent_challenge_invalid' using errcode='22023'; end if;
  select * into kept from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found then raise exception 'agent_turn_not_found' using errcode='42501'; end if;
  if private.effective_organization_role(p_organization_id,kept.requested_by) is null
    or (kept.objective='report_intake' and not private.agent_turn_actor_has_permission(p_organization_id,kept.requested_by,'report.upload'))
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  if kept.lease_token is distinct from p_lease_token or kept.lease_expires_at<=now() or kept.status<>'running'
    then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  if p_kind in ('metadata','correction') and kept.objective<>'report_intake'
    then raise exception 'agent_challenge_invalid' using errcode='22023'; end if;
  challenge_id:=gen_random_uuid();
  update public.agent_turns set status='awaiting_user',pending_challenge=jsonb_build_object('id',challenge_id,'kind',p_kind,'fields',p_fields),
    lease_token=null,lease_expires_at=null,updated_at=now() where id=p_turn_id;
  insert into public.agent_turn_events (organization_id,turn_id,seq,event_key,event_type,payload)
  values (p_organization_id,p_turn_id,kept.next_event_seq,'challenge:'||challenge_id::text,'challenge_requested',jsonb_build_object('challengeId',challenge_id,'kind',p_kind));
  update public.agent_turns set next_event_seq=next_event_seq+1 where id=p_turn_id;
  return jsonb_build_object('turnId',p_turn_id,'status','awaiting_user','challengeId',challenge_id);
end $$;

create function public.answer_agent_turn_challenge(p_organization_id uuid,p_actor_id uuid,p_turn_id uuid,
  p_challenge_id uuid,p_idempotency_key text,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_turns; answer_key text; challenge_kind text; event_row public.agent_turn_events; merged_answers jsonb;
begin
  if (select auth.uid()) is distinct from p_actor_id
    or private.effective_organization_role(p_organization_id,p_actor_id) is null
  then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 200
    or jsonb_typeof(p_answers)<>'object' or pg_column_size(p_answers)>4096
    then raise exception 'agent_challenge_invalid' using errcode='22023'; end if;
  select * into kept from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found then raise exception 'agent_turn_not_found' using errcode='42501'; end if;
  if kept.requested_by is distinct from p_actor_id then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  answer_key:='answer:'||p_challenge_id::text||':'||p_idempotency_key;
  select * into event_row from public.agent_turn_events where organization_id=p_organization_id and turn_id=p_turn_id and event_key=answer_key;
  if found then
    if event_row.payload->>'answersDigest' is distinct from md5(p_answers::text) then raise exception 'agent_challenge_key_conflict' using errcode='23505'; end if;
    return jsonb_build_object('turnId',p_turn_id,'status',kept.status,'replayed',true);
  end if;
  if kept.status<>'awaiting_user' or (kept.pending_challenge->>'id')::uuid is distinct from p_challenge_id
    then raise exception 'agent_challenge_stale' using errcode='23505'; end if;
  challenge_kind:=kept.pending_challenge->>'kind';
  if not private.agent_challenge_answers_are_valid(kept.pending_challenge->'fields',p_answers)
    then raise exception 'agent_challenge_invalid' using errcode='22023'; end if;
  if challenge_kind in ('metadata','correction') and not private.has_organization_permission(p_organization_id,'report.upload')
    then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  insert into public.agent_turn_events (organization_id,turn_id,seq,event_key,event_type,payload)
  values (p_organization_id,p_turn_id,kept.next_event_seq,answer_key,'challenge_answered',jsonb_build_object('challengeId',p_challenge_id,'answersDigest',md5(p_answers::text)));
  merged_answers:=case when kept.answered_challenge_kind=challenge_kind and challenge_kind in ('metadata','scope')
    then coalesce(kept.challenge_answers,'{}'::jsonb)||p_answers else p_answers end;
  update public.agent_turns set status='queued',pending_challenge=null,challenge_answers=merged_answers,
    answered_challenge_kind=challenge_kind,
    next_event_seq=next_event_seq+1,updated_at=now() where id=p_turn_id;
  return jsonb_build_object('turnId',p_turn_id,'status','queued','replayed',false);
end $$;

create function public.set_agent_turn_approval(p_organization_id uuid,p_turn_id uuid,p_lease_token uuid,
  p_kind text,p_package_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_turns; event_count integer;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  if p_kind not in ('report_contract','report_projection','report_admission','report_correction') or p_package_id is null then raise exception 'agent_approval_invalid' using errcode='22023'; end if;
  select * into kept from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found then raise exception 'agent_turn_not_found' using errcode='42501'; end if;
  if kept.objective<>'report_intake' or kept.status<>'running' or kept.lease_token is distinct from p_lease_token
    or kept.lease_expires_at<=now() then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  if not private.agent_turn_actor_has_permission(p_organization_id,kept.requested_by,'report.upload')
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  if not exists(select 1 from public.agent_attachments a
    where a.organization_id=p_organization_id and a.turn_id=p_turn_id and a.package_id=p_package_id and (a.status='promoted' or (a.status='verified' and kept.answered_challenge_kind='correction' and kept.challenge_answers->>'decision'='keep_existing')))
    then raise exception 'agent_approval_package_not_found' using errcode='42501'; end if;
  insert into public.agent_turn_events(organization_id,turn_id,seq,event_key,event_type,payload)
  values(p_organization_id,p_turn_id,kept.next_event_seq,'approval:'||p_kind||':'||p_package_id::text,
    'approval_required',jsonb_build_object('kind',p_kind,'packageId',p_package_id))
  on conflict(organization_id,turn_id,event_key) do nothing;
  get diagnostics event_count=row_count;
  update public.agent_turns set status='awaiting_approval',pending_approval=jsonb_build_object('kind',p_kind,'packageId',p_package_id),
    lease_token=null,lease_expires_at=null,next_event_seq=next_event_seq+event_count,updated_at=now()
    where organization_id=p_organization_id and id=p_turn_id;
  return jsonb_build_object('turnId',p_turn_id,'status','awaiting_approval','packageId',p_package_id);
end $$;

create function public.resume_agent_turn_approval(p_organization_id uuid,p_turn_id uuid,p_package_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_turns; package_row public.integration_report_packages; approval_kind text;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  select * into kept from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found then raise exception 'agent_turn_not_found' using errcode='42501'; end if;
  if kept.status='queued' and kept.pending_approval is null
    then return jsonb_build_object('turnId',p_turn_id,'status','queued','replayed',true); end if;
  if kept.status<>'awaiting_approval' or (kept.pending_approval->>'packageId')::uuid is distinct from p_package_id
    then raise exception 'agent_approval_stale' using errcode='23505'; end if;
  if not private.agent_turn_actor_has_permission(p_organization_id,kept.requested_by,'report.upload')
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  select * into package_row from public.integration_report_packages
    where organization_id=p_organization_id and id=p_package_id;
  if not found then raise exception 'agent_approval_package_not_found' using errcode='42501'; end if;
  approval_kind:=kept.pending_approval->>'kind';
  if approval_kind='report_contract' then
    if package_row.status in ('awaiting_upload','uploaded','profiling','awaiting_contract','awaiting_approval')
      or not exists(select 1 from public.report_contract_bindings b
        join public.report_contract_decisions d on d.organization_id=b.organization_id and d.report_contract_version_id=b.report_contract_version_id
        where b.organization_id=p_organization_id and b.channel_id=package_row.channel_id
          and b.report_type=package_row.report_type and b.schema_fingerprint=package_row.schema_fingerprint
          and b.declared_currency=package_row.declared_currency and b.active and d.decision='approved')
    then raise exception 'agent_approval_not_recorded' using errcode='23505'; end if;
  elsif approval_kind='report_projection' then
    if not exists(select 1 from public.integration_report_validation_runs r
      join public.report_projection_bindings b on b.organization_id=r.organization_id and b.report_contract_version_id=r.report_contract_version_id and b.active
      join public.report_projection_decisions d on d.organization_id=b.organization_id and d.report_projection_version_id=b.report_projection_version_id and d.decision='approved'
      where r.organization_id=p_organization_id and r.report_package_id=p_package_id and r.status in ('validated','partially_validated'))
    then raise exception 'agent_approval_not_recorded' using errcode='23505'; end if;
  elsif approval_kind='report_correction' then
    if package_row.status not in ('projected','partially_projected')
    then raise exception 'agent_approval_not_recorded' using errcode='23505'; end if;
  elsif approval_kind='report_admission' then
    if not exists(select 1 from public.report_structure_admissions a
      where a.organization_id=p_organization_id and a.id=package_row.admitted_under_admission_id and a.active)
    then raise exception 'agent_approval_not_recorded' using errcode='23505'; end if;
  else raise exception 'agent_approval_invalid' using errcode='22023'; end if;
  update public.agent_turns set status='queued',pending_approval=null,updated_at=now()
    where organization_id=p_organization_id and id=p_turn_id;
  return jsonb_build_object('turnId',p_turn_id,'status','queued','replayed',false);
end $$;

create function public.complete_agent_turn(p_organization_id uuid,p_turn_id uuid,p_lease_token uuid,p_answer_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_turns; message_id uuid;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  select * into kept from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found then raise exception 'agent_turn_not_found' using errcode='42501'; end if;
  if kept.status='completed' and kept.final_message_id is not null then
    return jsonb_build_object('turnId',p_turn_id,'status','completed','messageId',kept.final_message_id,'replayed',true);
  end if;
  if kept.status<>'running' or kept.lease_token is distinct from p_lease_token or kept.lease_expires_at<=now()
    then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  if length(btrim(coalesce(p_answer_body,''))) not between 1 and 20000
    then raise exception 'agent_answer_invalid' using errcode='22023'; end if;
  if private.effective_organization_role(p_organization_id,kept.requested_by) is null
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  insert into public.agent_messages (organization_id,thread_id,turn_id,role,body,created_by)
  values (p_organization_id,kept.thread_id,p_turn_id,'assistant',btrim(p_answer_body),kept.requested_by)
  returning id into message_id;
  insert into public.agent_turn_events (organization_id,turn_id,seq,event_key,event_type,payload)
  values (p_organization_id,p_turn_id,kept.next_event_seq,'answer:completed','answer_completed',jsonb_build_object('messageId',message_id));
  update public.agent_turns set status='completed',final_message_id=message_id,lease_token=null,
    lease_expires_at=null,next_event_seq=next_event_seq+1,updated_at=now() where id=p_turn_id;
  update public.agent_threads set updated_at=now() where organization_id=p_organization_id and id=kept.thread_id;
  return jsonb_build_object('turnId',p_turn_id,'status','completed','messageId',message_id,'replayed',false);
end $$;

create function public.fail_agent_turn(p_organization_id uuid,p_turn_id uuid,p_lease_token uuid,p_failure_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_turns;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  select * into kept from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found then raise exception 'agent_turn_not_found' using errcode='42501'; end if;
  if kept.status='failed' then return jsonb_build_object('turnId',p_turn_id,'status','failed','replayed',true); end if;
  if kept.status<>'running' or kept.lease_token is distinct from p_lease_token or kept.lease_expires_at<=now()
    then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  if p_failure_code is null or p_failure_code !~ '^[A-Z_]{3,60}$'
    then raise exception 'agent_failure_invalid' using errcode='22023'; end if;
  insert into public.agent_turn_events (organization_id,turn_id,seq,event_key,event_type,payload)
  values (p_organization_id,p_turn_id,kept.next_event_seq,'turn:failed','turn_failed',jsonb_build_object('code',p_failure_code));
  update public.agent_turns set status='failed',failure_code=p_failure_code,lease_token=null,
    lease_expires_at=null,next_event_seq=next_event_seq+1,updated_at=now() where id=p_turn_id;
  return jsonb_build_object('turnId',p_turn_id,'status','failed','replayed',false);
end $$;

revoke all on function public.create_agent_turn(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.answer_agent_turn_challenge(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_agent_turn(uuid,uuid,uuid,uuid,text,text) to authenticated;
grant execute on function public.answer_agent_turn_challenge(uuid,uuid,uuid,uuid,text,jsonb) to authenticated;
revoke all on function public.claim_agent_turn(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.heartbeat_agent_turn(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_agent_turn_actor_role(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.append_agent_turn_event(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.set_agent_turn_challenge(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.set_agent_turn_approval(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.resume_agent_turn_approval(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.complete_agent_turn(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.fail_agent_turn(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_agent_turn(uuid,uuid,uuid) to service_role;
grant execute on function public.heartbeat_agent_turn(uuid,uuid,uuid) to service_role;
grant execute on function public.get_agent_turn_actor_role(uuid,uuid,uuid) to service_role;
grant execute on function public.append_agent_turn_event(uuid,uuid,uuid,text,text,jsonb) to service_role;
grant execute on function public.set_agent_turn_challenge(uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.set_agent_turn_approval(uuid,uuid,uuid,text,uuid) to service_role;
grant execute on function public.resume_agent_turn_approval(uuid,uuid,uuid) to service_role;
grant execute on function public.complete_agent_turn(uuid,uuid,uuid,text) to service_role;
grant execute on function public.fail_agent_turn(uuid,uuid,uuid,text) to service_role;
grant execute on function private.effective_organization_role(uuid,uuid) to service_role;

create function public.create_agent_attachment_intent(p_organization_id uuid,p_actor_id uuid,p_turn_id uuid,
  p_file_name text,p_media_type text,p_byte_size bigint,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_attachments; turn_row public.agent_turns; attachment_id uuid;
begin
  if (select auth.uid()) is distinct from p_actor_id
    or not private.has_organization_permission(p_organization_id,'report.upload')
  then raise exception 'agent_attachment_forbidden' using errcode='42501'; end if;
  if p_file_name is null or length(btrim(p_file_name)) not between 1 and 255
    or p_media_type not in ('text/csv','application/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    or p_byte_size not between 1 and 52428800
    or p_idempotency_key is null or length(p_idempotency_key) not between 16 and 200
    then raise exception 'agent_attachment_invalid' using errcode='22023'; end if;
  select * into turn_row from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found or turn_row.requested_by<>p_actor_id or turn_row.objective<>'report_intake'
    then raise exception 'agent_turn_not_found' using errcode='42501'; end if;
  select * into kept from public.agent_attachments where organization_id=p_organization_id and turn_id=p_turn_id for update;
  if found then
    if kept.idempotency_key<>p_idempotency_key or kept.file_name<>btrim(p_file_name)
      or kept.media_type<>p_media_type or kept.byte_size<>p_byte_size
    then raise exception 'agent_attachment_conflict' using errcode='23505'; end if;
    if kept.status<>'awaiting_upload' or kept.upload_expires_at<=now()
      then raise exception 'agent_attachment_stale' using errcode='23505'; end if;
    return jsonb_build_object('attachmentId',kept.id,'storageBucketId',kept.storage_bucket_id,
      'storagePath',kept.storage_path,'expiresAt',kept.upload_expires_at,'replayed',true);
  end if;
  attachment_id:=gen_random_uuid();
  insert into public.agent_attachments (id,organization_id,turn_id,created_by,idempotency_key,file_name,
    media_type,byte_size,storage_path)
  values (attachment_id,p_organization_id,p_turn_id,p_actor_id,p_idempotency_key,btrim(p_file_name),
    p_media_type,p_byte_size,p_organization_id::text||'/'||p_turn_id::text||'/'||attachment_id::text||'/original')
  returning * into kept;
  return jsonb_build_object('attachmentId',kept.id,'storageBucketId',kept.storage_bucket_id,
    'storagePath',kept.storage_path,'expiresAt',kept.upload_expires_at,'replayed',false);
end $$;

create function public.declare_agent_attachment_scope(p_organization_id uuid,p_actor_id uuid,p_turn_id uuid,
  p_attachment_id uuid,p_scope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_attachments;
begin
  if (select auth.uid()) is distinct from p_actor_id
    or not private.has_organization_permission(p_organization_id,'report.upload')
  then raise exception 'agent_attachment_forbidden' using errcode='42501'; end if;
  if p_scope is not null and not private.agent_report_scope_is_valid(p_organization_id,p_scope)
    then raise exception 'agent_attachment_scope_invalid' using errcode='22023'; end if;
  select * into kept from public.agent_attachments where organization_id=p_organization_id
    and turn_id=p_turn_id and id=p_attachment_id for update;
  if not found or kept.created_by<>p_actor_id then raise exception 'agent_attachment_not_found' using errcode='42501'; end if;
  if kept.status<>'awaiting_upload' or kept.upload_expires_at<=now()
    then raise exception 'agent_attachment_stale' using errcode='23505'; end if;
  if kept.declared_scope is not null and kept.declared_scope is distinct from p_scope
    then raise exception 'agent_attachment_scope_conflict' using errcode='23505'; end if;
  update public.agent_attachments set declared_scope=p_scope,updated_at=now() where id=p_attachment_id;
  return jsonb_build_object('attachmentId',p_attachment_id,'status',kept.status,'replayed',kept.declared_scope is not null);
end $$;

create function public.verify_agent_attachment(p_organization_id uuid,p_turn_id uuid,p_attachment_id uuid,
  p_lease_token uuid,p_sha256_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_attachments; turn_row public.agent_turns;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_attachment_forbidden' using errcode='42501'; end if;
  if p_sha256_digest is null or p_sha256_digest !~ '^[0-9a-f]{64}$'
    then raise exception 'agent_attachment_invalid' using errcode='22023'; end if;
  select * into turn_row from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found or turn_row.lease_token is distinct from p_lease_token or turn_row.lease_expires_at<=now()
    or turn_row.status<>'running' then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  if private.effective_organization_role(p_organization_id,turn_row.requested_by) is null
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  if not private.agent_turn_actor_has_permission(p_organization_id,turn_row.requested_by,'report.upload')
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  select * into kept from public.agent_attachments where organization_id=p_organization_id and turn_id=p_turn_id
    and id=p_attachment_id for update;
  if not found then raise exception 'agent_attachment_not_found' using errcode='42501'; end if;
  if kept.status in ('verified','promoted') then
    if kept.sha256_digest<>p_sha256_digest then raise exception 'agent_attachment_digest_conflict' using errcode='23505'; end if;
    return jsonb_build_object('attachmentId',p_attachment_id,'status',kept.status,'replayed',true);
  end if;
  if kept.status<>'awaiting_upload' or kept.upload_expires_at<=now()
    then raise exception 'agent_attachment_stale' using errcode='23505'; end if;
  if not exists (select 1 from storage.objects where bucket_id=kept.storage_bucket_id and name=kept.storage_path)
    then raise exception 'agent_attachment_object_missing' using errcode='22023'; end if;
  update public.agent_attachments set status='verified',sha256_digest=p_sha256_digest,updated_at=now() where id=p_attachment_id;
  return jsonb_build_object('attachmentId',p_attachment_id,'status','verified','replayed',false);
end $$;

-- The package is created by the source-owned report service. This RPC binds
-- its exact package id after that service has accepted the staged bytes.
create function public.promote_agent_attachment(p_organization_id uuid,p_turn_id uuid,p_attachment_id uuid,
  p_lease_token uuid,p_package_id uuid,p_sha256_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_attachments; turn_row public.agent_turns; package_row public.integration_report_packages;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_attachment_forbidden' using errcode='42501'; end if;
  select * into turn_row from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found or turn_row.objective<>'report_intake' or turn_row.lease_token is distinct from p_lease_token or turn_row.lease_expires_at<=now()
    or turn_row.status<>'running' then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  if not private.agent_turn_actor_has_permission(p_organization_id,turn_row.requested_by,'report.upload')
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  select * into kept from public.agent_attachments where organization_id=p_organization_id and turn_id=p_turn_id
    and id=p_attachment_id for update;
  if not found then raise exception 'agent_attachment_not_found' using errcode='42501'; end if;
  if kept.sha256_digest is distinct from p_sha256_digest then raise exception 'agent_attachment_digest_conflict' using errcode='23505'; end if;
  select * into package_row from public.integration_report_packages where organization_id=p_organization_id and id=p_package_id;
  if not found or package_row.content_sha256 is distinct from p_sha256_digest
    or package_row.channel_id::text is distinct from kept.declared_scope->>'channelId'
    or package_row.branch_id::text is distinct from kept.declared_scope->>'branchId'
    or package_row.report_type is distinct from kept.declared_scope->>'reportType'
    or package_row.declared_period_start::text is distinct from kept.declared_scope->>'periodStart'
    or package_row.declared_period_end::text is distinct from kept.declared_scope->>'periodEnd'
    or package_row.declared_currency is distinct from kept.declared_scope->>'currency'
    then raise exception 'agent_package_identity_conflict' using errcode='23505'; end if;
  if kept.status='promoted' then
    if kept.package_id<>p_package_id then raise exception 'agent_attachment_package_conflict' using errcode='23505'; end if;
    return jsonb_build_object('attachmentId',p_attachment_id,'packageId',p_package_id,'replayed',true);
  end if;
  if kept.status<>'verified' then raise exception 'agent_attachment_stale' using errcode='23505'; end if;
  update public.agent_attachments set status='promoted',package_id=p_package_id,updated_at=now() where id=p_attachment_id;
  return jsonb_build_object('attachmentId',p_attachment_id,'packageId',p_package_id,'replayed',false);
end $$;

revoke all on function public.create_agent_attachment_intent(uuid,uuid,uuid,text,text,bigint,text) from public,anon,authenticated,service_role;
revoke all on function public.declare_agent_attachment_scope(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_agent_attachment_intent(uuid,uuid,uuid,text,text,bigint,text) to authenticated;
grant execute on function public.declare_agent_attachment_scope(uuid,uuid,uuid,uuid,jsonb) to authenticated;
revoke all on function public.verify_agent_attachment(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.promote_agent_attachment(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.verify_agent_attachment(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.promote_agent_attachment(uuid,uuid,uuid,uuid,uuid,text) to service_role;

-- Call before downloading staged bytes with a service credential. It does not
-- return a signed URL or raw file content; Storage access stays in the worker.
create function public.authorize_agent_attachment_work(p_organization_id uuid,p_turn_id uuid,
  p_attachment_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare turn_row public.agent_turns; attachment_row public.agent_attachments;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_attachment_forbidden' using errcode='42501'; end if;
  select * into turn_row from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found or turn_row.objective<>'report_intake' or turn_row.status<>'running'
    or turn_row.lease_token is distinct from p_lease_token or turn_row.lease_expires_at<=now()
  then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  if not private.agent_turn_actor_has_permission(p_organization_id,turn_row.requested_by,'report.upload')
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  select * into attachment_row from public.agent_attachments
    where organization_id=p_organization_id and turn_id=p_turn_id and id=p_attachment_id for update;
  if not found or attachment_row.created_by is distinct from turn_row.requested_by
    then raise exception 'agent_attachment_not_found' using errcode='42501'; end if;
  if attachment_row.status not in ('awaiting_upload','verified','promoted')
    or (attachment_row.status='awaiting_upload' and attachment_row.upload_expires_at<=now())
    then raise exception 'agent_attachment_stale' using errcode='23505'; end if;
  return jsonb_build_object('attachmentId',attachment_row.id,'storageBucketId',attachment_row.storage_bucket_id,
    'storagePath',attachment_row.storage_path,'byteSize',attachment_row.byte_size,
    'mediaType',attachment_row.media_type,'status',attachment_row.status);
end $$;

-- The saved metadata answers belong to the exact server-issued challenge.
-- This is idempotent across worker retries and never accepts a client scope.
create function public.apply_agent_attachment_scope_from_challenge(p_organization_id uuid,p_turn_id uuid,
  p_attachment_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare turn_row public.agent_turns; attachment_row public.agent_attachments; scope_value jsonb;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_attachment_forbidden' using errcode='42501'; end if;
  select * into turn_row from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found or turn_row.objective<>'report_intake' or turn_row.status<>'running'
    or turn_row.lease_token is distinct from p_lease_token or turn_row.lease_expires_at<=now()
  then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  if not private.agent_turn_actor_has_permission(p_organization_id,turn_row.requested_by,'report.upload')
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  if turn_row.answered_challenge_kind<>'metadata' or turn_row.challenge_answers is null
    then raise exception 'agent_challenge_not_found' using errcode='23505'; end if;
  scope_value:=turn_row.challenge_answers;
  if not private.agent_report_scope_is_valid(p_organization_id,scope_value)
    then raise exception 'agent_attachment_scope_invalid' using errcode='22023'; end if;
  select * into attachment_row from public.agent_attachments
    where organization_id=p_organization_id and turn_id=p_turn_id and id=p_attachment_id for update;
  if not found or attachment_row.created_by is distinct from turn_row.requested_by
    then raise exception 'agent_attachment_not_found' using errcode='42501'; end if;
  if attachment_row.status not in ('awaiting_upload','verified')
    then raise exception 'agent_attachment_stale' using errcode='23505'; end if;
  if attachment_row.declared_scope is not null and attachment_row.declared_scope is distinct from scope_value
    then raise exception 'agent_attachment_scope_conflict' using errcode='23505'; end if;
  if attachment_row.declared_scope is null then
    update public.agent_attachments set declared_scope=scope_value,updated_at=now()
      where organization_id=p_organization_id and id=p_attachment_id;
  end if;
  return jsonb_build_object('attachmentId',p_attachment_id,'scope',scope_value,
    'replayed',attachment_row.declared_scope is not null);
end $$;

revoke all on function public.authorize_agent_attachment_work(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.apply_agent_attachment_scope_from_challenge(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.authorize_agent_attachment_work(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.apply_agent_attachment_scope_from_challenge(uuid,uuid,uuid,uuid) to service_role;

-- The worker delegates into the exact governed package intake function. A
-- transaction-local auth subject lets that function run its normal actor and
-- permission checks; no alternate package insert or status transition exists.
create function public.begin_agent_report_package(p_organization_id uuid,p_turn_id uuid,
  p_attachment_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare turn_row public.agent_turns; attachment_row public.agent_attachments;
  package_json jsonb; old_subject text; file_kind text;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_attachment_forbidden' using errcode='42501'; end if;
  select * into turn_row from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found or turn_row.objective<>'report_intake' or turn_row.status<>'running'
    or turn_row.lease_token is distinct from p_lease_token or turn_row.lease_expires_at<=now()
  then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  if not private.agent_turn_actor_has_permission(p_organization_id,turn_row.requested_by,'report.upload')
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  select * into attachment_row from public.agent_attachments
    where organization_id=p_organization_id and turn_id=p_turn_id and id=p_attachment_id for update;
  if not found or attachment_row.created_by is distinct from turn_row.requested_by
    then raise exception 'agent_attachment_not_found' using errcode='42501'; end if;
  if attachment_row.status<>'verified' or attachment_row.sha256_digest is null
    or not private.agent_report_scope_is_valid(p_organization_id,attachment_row.declared_scope)
  then raise exception 'agent_attachment_stale' using errcode='23505'; end if;
  file_kind:=case when attachment_row.media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    then 'xlsx' else 'csv' end;
  old_subject:=current_setting('request.jwt.claim.sub',true);
  perform set_config('request.jwt.claim.sub',turn_row.requested_by::text,true);
  package_json:=public.start_governed_report_package_upload(
    p_organization_id,turn_row.requested_by,
    (attachment_row.declared_scope->>'channelId')::uuid,
    (attachment_row.declared_scope->>'branchId')::uuid,
    attachment_row.declared_scope->>'reportType',
    (attachment_row.declared_scope->>'periodStart')::date,
    (attachment_row.declared_scope->>'periodEnd')::date,
    attachment_row.declared_scope->>'currency',file_kind,
    attachment_row.file_name,attachment_row.media_type,attachment_row.byte_size,
    'agent-report:'||p_attachment_id::text,p_turn_id
  );
  perform set_config('request.jwt.claim.sub',coalesce(old_subject,''),true);
  return jsonb_build_object('packageId',package_json->>'id',
    'storageBucketId',package_json->>'storage_bucket_id',
    'storagePath',package_json->>'storage_path',
    'status',package_json->>'status',
    'replayed',(package_json->>'created_at')::timestamptz<now()-interval '1 second');
end $$;

create function public.complete_agent_report_package(p_organization_id uuid,p_turn_id uuid,
  p_attachment_id uuid,p_lease_token uuid,p_destination_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare turn_row public.agent_turns; attachment_row public.agent_attachments;
  package_row public.integration_report_packages; object_row storage.objects;
  package_json jsonb; old_subject text; was_promoted boolean;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_attachment_forbidden' using errcode='42501'; end if;
  select * into turn_row from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found or turn_row.objective<>'report_intake' or turn_row.status<>'running'
    or turn_row.lease_token is distinct from p_lease_token or turn_row.lease_expires_at<=now()
  then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  if not private.agent_turn_actor_has_permission(p_organization_id,turn_row.requested_by,'report.upload')
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  select * into attachment_row from public.agent_attachments
    where organization_id=p_organization_id and turn_id=p_turn_id and id=p_attachment_id for update;
  if not found or attachment_row.created_by is distinct from turn_row.requested_by
    then raise exception 'agent_attachment_not_found' using errcode='42501'; end if;
  if attachment_row.status not in ('verified','promoted') or attachment_row.sha256_digest is null
    or attachment_row.sha256_digest is distinct from p_destination_sha256
  then raise exception 'agent_attachment_digest_conflict' using errcode='23505'; end if;
  select p.* into package_row from private.integration_report_write_operations operation
  join public.integration_report_packages p on p.organization_id=operation.organization_id and p.id=operation.report_package_id
  where operation.organization_id=p_organization_id and operation.operation_kind='upload_intent'
    and operation.idempotency_key='agent-report:'||p_attachment_id::text for update of p;
  if not found then raise exception 'agent_package_not_found' using errcode='42501'; end if;
  if package_row.created_by is distinct from turn_row.requested_by
    or package_row.declared_content_length is distinct from attachment_row.byte_size
    or package_row.declared_content_type is distinct from attachment_row.media_type
    or package_row.original_filename is distinct from attachment_row.file_name
  then raise exception 'agent_package_identity_conflict' using errcode='23505'; end if;
  select * into object_row from storage.objects
    where bucket_id=package_row.storage_bucket_id and name=package_row.storage_path;
  if not found or coalesce((object_row.metadata->>'size')::bigint,0)<>attachment_row.byte_size
    or coalesce(object_row.metadata->>'mimetype','')<>attachment_row.media_type
  then raise exception 'agent_package_object_missing' using errcode='22023'; end if;
  was_promoted:=attachment_row.status='promoted';
  if was_promoted and attachment_row.package_id is distinct from package_row.id
    then raise exception 'agent_attachment_package_conflict' using errcode='23505'; end if;
  old_subject:=current_setting('request.jwt.claim.sub',true);
  perform set_config('request.jwt.claim.sub',turn_row.requested_by::text,true);
  package_json:=public.complete_governed_report_package_upload(
    p_organization_id,turn_row.requested_by,package_row.id,
    'agent-complete:'||p_attachment_id::text,p_turn_id
  );
  perform set_config('request.jwt.claim.sub',coalesce(old_subject,''),true);
  if package_json->>'status' not in ('uploaded','profiling','awaiting_contract','awaiting_approval','awaiting_validation')
    then return jsonb_build_object('packageId',package_row.id,'status',package_json->>'status','replayed',false); end if;
  if not was_promoted then
    update public.agent_attachments set status='promoted',package_id=package_row.id,updated_at=now()
      where organization_id=p_organization_id and id=p_attachment_id;
  end if;
  return jsonb_build_object('packageId',package_row.id,'status',package_json->>'status','replayed',was_promoted);
end $$;

revoke all on function public.begin_agent_report_package(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.complete_agent_report_package(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.begin_agent_report_package(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.complete_agent_report_package(uuid,uuid,uuid,uuid,text) to service_role;

-- A worker merges exact inferred metadata with only the server-issued answers.
-- This boundary accepts a complete validated scope, never arbitrary fields.
create function public.resolve_agent_attachment_scope(p_organization_id uuid,p_turn_id uuid,
  p_attachment_id uuid,p_lease_token uuid,p_scope jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare turn_row public.agent_turns; attachment_row public.agent_attachments;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_attachment_forbidden' using errcode='42501'; end if;
  select * into turn_row from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found or turn_row.objective<>'report_intake' or turn_row.status<>'running'
    or turn_row.lease_token is distinct from p_lease_token or turn_row.lease_expires_at<=now()
  then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  if not private.agent_turn_actor_has_permission(p_organization_id,turn_row.requested_by,'report.upload')
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  if p_scope is null or not private.agent_report_scope_is_valid(p_organization_id,p_scope)
    then raise exception 'agent_attachment_scope_invalid' using errcode='22023'; end if;
  select * into attachment_row from public.agent_attachments
    where organization_id=p_organization_id and turn_id=p_turn_id and id=p_attachment_id for update;
  if not found or attachment_row.created_by is distinct from turn_row.requested_by
    then raise exception 'agent_attachment_not_found' using errcode='42501'; end if;
  if attachment_row.status not in ('awaiting_upload','verified')
    then raise exception 'agent_attachment_stale' using errcode='23505'; end if;
  if attachment_row.declared_scope is not null and attachment_row.declared_scope is distinct from p_scope
    then raise exception 'agent_attachment_scope_conflict' using errcode='23505'; end if;
  update public.agent_attachments set declared_scope=p_scope,updated_at=now()
    where organization_id=p_organization_id and id=p_attachment_id;
  return jsonb_build_object('attachmentId',p_attachment_id,'scope',p_scope,
    'replayed',attachment_row.declared_scope is not null);
end $$;
revoke all on function public.resolve_agent_attachment_scope(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.resolve_agent_attachment_scope(uuid,uuid,uuid,uuid,jsonb) to service_role;

-- Request projection only after the owning module records human approval.
create function public.request_agent_report_package_projection(p_organization_id uuid,p_turn_id uuid,
  p_attachment_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare turn_row public.agent_turns; attachment_row public.agent_attachments;
  requested jsonb; validation_row public.integration_report_validation_runs; old_subject text;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_attachment_forbidden' using errcode='42501'; end if;
  select * into turn_row from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found or turn_row.objective<>'report_intake' or turn_row.status<>'running'
    or turn_row.lease_token is distinct from p_lease_token or turn_row.lease_expires_at<=now()
  then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  if not private.agent_turn_actor_has_permission(p_organization_id,turn_row.requested_by,'report.upload')
    or not private.agent_turn_actor_has_permission(p_organization_id,turn_row.requested_by,'report.retry')
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  select * into attachment_row from public.agent_attachments
    where organization_id=p_organization_id and turn_id=p_turn_id and id=p_attachment_id
      and (status='promoted' or (status='verified' and turn_row.answered_challenge_kind='correction' and turn_row.challenge_answers->>'decision'='keep_existing'));
  if not found then raise exception 'agent_attachment_not_found' using errcode='42501'; end if;
  select * into validation_row from public.integration_report_validation_runs
    where organization_id=p_organization_id and report_package_id=attachment_row.package_id
      and status in ('validated','partially_validated') order by completed_at desc limit 1;
  old_subject:=current_setting('request.jwt.claim.sub',true);
  perform set_config('request.jwt.claim.sub',turn_row.requested_by::text,true);
  requested:=public.request_governed_report_package_projection(p_organization_id,turn_row.requested_by,
    attachment_row.package_id,'agent-projection:'||p_attachment_id::text,p_turn_id);
  perform set_config('request.jwt.claim.sub',coalesce(old_subject,''),true);
  return jsonb_build_object('outcome','requested','contractVersionId',validation_row.report_contract_version_id,
    'projectionVersionId',requested->>'reportProjectionVersionId');
end $$;
revoke all on function public.request_agent_report_package_projection(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.request_agent_report_package_projection(uuid,uuid,uuid,uuid) to service_role;

create function public.keep_existing_agent_report_package(p_organization_id uuid,p_turn_id uuid,
  p_attachment_id uuid,p_lease_token uuid,p_package_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare turn_row public.agent_turns; attachment_row public.agent_attachments; package_row public.integration_report_packages;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_attachment_forbidden' using errcode='42501'; end if;
  select * into turn_row from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found or turn_row.objective<>'report_intake' or turn_row.status<>'running'
    or turn_row.lease_token is distinct from p_lease_token or turn_row.lease_expires_at<=now()
  then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  if not private.agent_turn_actor_has_permission(p_organization_id,turn_row.requested_by,'report.upload')
    then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  if turn_row.answered_challenge_kind<>'correction' or turn_row.challenge_answers->>'decision' is distinct from 'keep_existing'
    then raise exception 'agent_challenge_not_found' using errcode='23505'; end if;
  select * into attachment_row from public.agent_attachments
    where organization_id=p_organization_id and turn_id=p_turn_id and id=p_attachment_id for update;
  if not found or attachment_row.status<>'verified' or attachment_row.created_by is distinct from turn_row.requested_by
    then raise exception 'agent_attachment_not_found' using errcode='42501'; end if;
  select * into package_row from public.integration_report_packages
    where organization_id=p_organization_id and id=p_package_id;
  if not found or package_row.channel_id::text is distinct from attachment_row.declared_scope->>'channelId'
    or package_row.branch_id::text is distinct from attachment_row.declared_scope->>'branchId'
    or package_row.report_type is distinct from attachment_row.declared_scope->>'reportType'
    or package_row.declared_period_start::text is distinct from attachment_row.declared_scope->>'periodStart'
    or package_row.declared_period_end::text is distinct from attachment_row.declared_scope->>'periodEnd'
    or package_row.declared_currency is distinct from attachment_row.declared_scope->>'currency'
    or package_row.content_sha256 is null or package_row.retained_until<=now()
  then raise exception 'agent_package_identity_conflict' using errcode='23505'; end if;
  if attachment_row.package_id is not null and attachment_row.package_id is distinct from p_package_id
    then raise exception 'agent_attachment_package_conflict' using errcode='23505'; end if;
  update public.agent_attachments set package_id=p_package_id,updated_at=now()
    where organization_id=p_organization_id and id=p_attachment_id;
  return jsonb_build_object('attachmentId',p_attachment_id,'packageId',p_package_id,'replayed',attachment_row.package_id is not null);
end $$;
revoke all on function public.keep_existing_agent_report_package(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.keep_existing_agent_report_package(uuid,uuid,uuid,uuid,uuid) to service_role;

create function public.release_agent_turn_for_retry(p_organization_id uuid,p_turn_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_turns;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  select * into kept from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found then raise exception 'agent_turn_not_found' using errcode='42501'; end if;
  if kept.status<>'running' then return jsonb_build_object('turnId',p_turn_id,'status',kept.status,'replayed',true); end if;
  if kept.lease_token is distinct from p_lease_token then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  if private.effective_organization_role(p_organization_id,kept.requested_by) is null
    or (kept.objective='report_intake' and not private.agent_turn_actor_has_permission(p_organization_id,kept.requested_by,'report.upload'))
  then raise exception 'agent_turn_actor_revoked' using errcode='42501'; end if;
  update public.agent_turns set status='queued',lease_token=null,lease_expires_at=null,updated_at=now()
    where organization_id=p_organization_id and id=p_turn_id;
  return jsonb_build_object('turnId',p_turn_id,'status','queued','replayed',false);
end $$;

create function public.cancel_revoked_agent_turn(p_organization_id uuid,p_turn_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_turns;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  select * into kept from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found then raise exception 'agent_turn_not_found' using errcode='42501'; end if;
  if kept.status in ('completed','failed','cancelled')
    then return jsonb_build_object('turnId',p_turn_id,'status',kept.status,'replayed',true); end if;
  if private.effective_organization_role(p_organization_id,kept.requested_by) is not null
    and (kept.objective<>'report_intake' or private.agent_turn_actor_has_permission(p_organization_id,kept.requested_by,'report.upload'))
  then raise exception 'agent_turn_actor_still_authorized' using errcode='23505'; end if;
  insert into public.agent_turn_events(organization_id,turn_id,seq,event_key,event_type,payload)
  values(p_organization_id,p_turn_id,kept.next_event_seq,'actor:revoked','turn_cancelled','{"code":"ACTOR_REVOKED"}'::jsonb);
  update public.agent_turns set status='cancelled',failure_code='ACTOR_REVOKED',lease_token=null,lease_expires_at=null,
    pending_challenge=null,pending_approval=null,challenge_answers=null,next_event_seq=next_event_seq+1,updated_at=now()
    where organization_id=p_organization_id and id=p_turn_id;
  return jsonb_build_object('turnId',p_turn_id,'status','cancelled','replayed',false);
end $$;
revoke all on function public.release_agent_turn_for_retry(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.cancel_revoked_agent_turn(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.release_agent_turn_for_retry(uuid,uuid,uuid) to service_role;
grant execute on function public.cancel_revoked_agent_turn(uuid,uuid) to service_role;

create function public.fail_exhausted_agent_turn(p_organization_id uuid,p_turn_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare kept public.agent_turns;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_turn_forbidden' using errcode='42501'; end if;
  select * into kept from public.agent_turns where organization_id=p_organization_id and id=p_turn_id for update;
  if not found then raise exception 'agent_turn_not_found' using errcode='42501'; end if;
  if kept.status='failed' and kept.failure_code='ATTEMPTS_EXHAUSTED'
    then return jsonb_build_object('turnId',p_turn_id,'status','failed','replayed',true); end if;
  if kept.attempt<20 or kept.status not in ('queued','running')
    or (kept.status='running' and kept.lease_expires_at>now())
  then raise exception 'agent_turn_stale' using errcode='23505'; end if;
  insert into public.agent_turn_events(organization_id,turn_id,seq,event_key,event_type,payload)
  values(p_organization_id,p_turn_id,kept.next_event_seq,'attempts:exhausted','turn_failed','{"code":"ATTEMPTS_EXHAUSTED"}'::jsonb);
  update public.agent_turns set status='failed',failure_code='ATTEMPTS_EXHAUSTED',lease_token=null,lease_expires_at=null,
    next_event_seq=next_event_seq+1,updated_at=now() where organization_id=p_organization_id and id=p_turn_id;
  return jsonb_build_object('turnId',p_turn_id,'status','failed','replayed',false);
end $$;
revoke all on function public.fail_exhausted_agent_turn(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.fail_exhausted_agent_turn(uuid,uuid) to service_role;

-- Retain audit identifiers, but scrub all conversation and Questionnaire data.
-- Staging removal is retried until the Storage worker acknowledges it.
create or replace function public.purge_expired_agent_threads(p_older_than timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare message_count integer; turn_count integer; attachment_count integer; objects jsonb;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_purge_forbidden' using errcode='42501'; end if;
  if p_older_than is null or p_older_than>=now() then raise exception 'agent_purge_invalid' using errcode='22023'; end if;
  update public.agent_messages m set body=null,questionnaire_answers=null,marker_receipts=null,citations=null
  where m.body is not null and exists(select 1 from public.agent_threads t
    where t.organization_id=m.organization_id and t.id=m.thread_id and t.updated_at<p_older_than);
  get diagnostics message_count=row_count;
  update public.agent_turns a set pending_challenge=null,challenge_answers=null,pending_approval=null,
    answered_challenge_kind=null,lease_token=null,lease_expires_at=null,
    status=case when a.status in ('queued','running','awaiting_user','awaiting_approval') then 'cancelled' else a.status end
  where exists(select 1 from public.agent_threads t
    where t.organization_id=a.organization_id and t.id=a.thread_id and t.updated_at<p_older_than)
    and (a.pending_challenge is not null or a.challenge_answers is not null or a.pending_approval is not null
      or a.status in ('queued','running','awaiting_user','awaiting_approval'));
  get diagnostics turn_count=row_count;
  update public.agent_turn_events e set payload='{}'::jsonb where e.payload<>'{}'::jsonb
    and exists(select 1 from public.agent_turns a join public.agent_threads t
      on t.organization_id=a.organization_id and t.id=a.thread_id
      where a.organization_id=e.organization_id and a.id=e.turn_id and t.updated_at<p_older_than);
  update public.agent_attachments a set status='expired',declared_scope=null,file_name='Expired attachment'
  where a.status<>'expired' and ((a.status in ('awaiting_upload','verified','failed') and a.upload_expires_at<=now())
    or exists(select 1 from public.agent_turns u join public.agent_threads t
      on t.organization_id=u.organization_id and t.id=u.thread_id
      where u.organization_id=a.organization_id and u.id=a.turn_id and t.updated_at<p_older_than));
  get diagnostics attachment_count=row_count;
  insert into public.agent_turn_events(organization_id,turn_id,seq,event_key,event_type,payload)
  select t.organization_id,t.id,t.next_event_seq,'attachment:expired','turn_failed','{"code":"ATTACHMENT_EXPIRED"}'::jsonb
  from public.agent_turns t join public.agent_attachments a on a.organization_id=t.organization_id and a.turn_id=t.id
  where t.status in ('queued','running','awaiting_user','awaiting_approval') and a.status='expired';
  update public.agent_turns t set status='failed',failure_code='ATTACHMENT_EXPIRED',next_event_seq=next_event_seq+1,
    lease_token=null,lease_expires_at=null,pending_challenge=null,pending_approval=null,challenge_answers=null
  where t.status in ('queued','running','awaiting_user','awaiting_approval') and exists(select 1 from public.agent_attachments a
    where a.organization_id=t.organization_id and a.turn_id=t.id and a.status='expired');
  select coalesce(jsonb_agg(jsonb_build_object('attachmentId',a.id,'bucketId',a.storage_bucket_id,'path',a.storage_path)),'[]'::jsonb)
  into objects from (select id,storage_bucket_id,storage_path from public.agent_attachments
    where (status='expired' or (status='promoted' and upload_expires_at<=now()))
      and staging_deleted_at is null order by upload_expires_at,id limit 100) a;
  return jsonb_build_object('purgedMessages',message_count,'purgedTurns',turn_count,
    'expiredAttachments',attachment_count,'stagingObjects',objects,'replayed',false);
end $$;

create function public.mark_agent_attachment_staging_deleted(p_attachment_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare marked_count integer;
begin
  if current_setting('role',true)<>'service_role' then raise exception 'agent_purge_forbidden' using errcode='42501'; end if;
  if p_attachment_ids is null or cardinality(p_attachment_ids) not between 1 and 100
    then raise exception 'agent_purge_invalid' using errcode='22023'; end if;
  update public.agent_attachments set staging_deleted_at=now()
    where id=any(p_attachment_ids) and (status='expired' or (status='promoted' and upload_expires_at<=now())) and staging_deleted_at is null;
  get diagnostics marked_count=row_count;
  return jsonb_build_object('markedAttachments',marked_count);
end $$;
revoke all on function public.mark_agent_attachment_staging_deleted(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.mark_agent_attachment_staging_deleted(uuid[]) to service_role;

-- Read-only chat persists a viewer's own question, without granting business actions.
create or replace function public.create_agent_thread_keyed(
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
        array['owner', 'admin', 'operator', 'viewer']::public.organization_role[]
      )
    ) then
    raise exception 'agent_thread_forbidden' using errcode = '42501';
  end if;
  if private.effective_organization_role(p_organization_id,p_actor_id) is null
    or (private.effective_organization_role(p_organization_id,p_actor_id)='viewer'::public.organization_role and p_mode<>'quick')
  then raise exception 'agent_thread_forbidden' using errcode='42501'; end if;
  if p_organization_id is null
    or p_actor_id is null
    or p_idempotency_key is null
    or p_idempotency_key is distinct from pg_catalog.btrim(p_idempotency_key)
    or pg_catalog.char_length(p_idempotency_key) not between 1 and 200
    or p_mode not in ('quick', 'deepthink') then
    raise exception 'agent_thread_invalid' using errcode = '22023';
  end if;
  clean_title := nullif(pg_catalog.btrim(coalesce(p_title, '')), ''::text);
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
    if private.effective_organization_role(p_organization_id,p_actor_id)='viewer'::public.organization_role
      and kept.created_by is distinct from p_actor_id
    then raise exception 'agent_thread_forbidden' using errcode='42501'; end if;
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

create or replace function public.append_agent_message(
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
        array['owner', 'admin', 'operator', 'viewer']::public.organization_role[]
      )
    ) then
    raise exception 'agent_message_forbidden' using errcode = '42501';
  end if;
  if private.effective_organization_role(p_organization_id,p_actor_id) is null
    or (private.effective_organization_role(p_organization_id,p_actor_id)='viewer'::public.organization_role
      and (p_role<>'user' or not exists(select 1 from public.agent_threads t
        where t.organization_id=p_organization_id and t.id=p_thread_id and t.created_by=p_actor_id and t.mode='quick')))
  then raise exception 'agent_message_forbidden' using errcode='42501'; end if;
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
