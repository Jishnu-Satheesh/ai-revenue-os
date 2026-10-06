-- In-place schedule updates for recurring research projects (spec section 10.2).
--
-- Frequency/Branch/end-date edits land here instead of forking a new project:
-- the project row (schedule, branch) and — where applicable — a new brief
-- revision (location, frequency) move atomically inside one fenced call, so
-- the brief can never diverge from the project row. Pure timing/label edits
-- (localTime, timeZone, endDate) touch no brief field and append no revision.
-- New competitors or topics never reach this function: they are
-- profile_scope_change through the Market Profile proposal flow.
--
-- Like a library's hold shelf: the same claim slip for the same books returns
-- the kept reservation (same-key replay), a slip rewritten for other books is
-- refused (conflict), and only card-holding members may move holds (the manage
-- gate; viewers and strangers are refused at the desk with 42501, never told
-- what sits on the shelf).

create table public.growth_intelligence_project_schedule_update_keys (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null,
  idempotency_key text not null,
  project_id uuid not null,
  body_digest text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, project_id)
    references public.growth_intelligence_research_projects(organization_id, id)
    on delete restrict,
  check (
    idempotency_key = pg_catalog.btrim(idempotency_key)
    and pg_catalog.char_length(idempotency_key) between 1 and 200
  ),
  check (body_digest ~ '^[0-9a-f]{32}$')
);

comment on table public.growth_intelligence_project_schedule_update_keys is
  'Idempotency keys for research project schedule updates: same key plus same body replays the kept update, same key with another body is a conflict.';

alter table public.growth_intelligence_project_schedule_update_keys enable row level security;
alter table public.growth_intelligence_project_schedule_update_keys force row level security;

create policy "members with Growth Intelligence read project schedule update keys"
on public.growth_intelligence_project_schedule_update_keys
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

revoke all on table public.growth_intelligence_project_schedule_update_keys from public, anon, authenticated, service_role;
grant select on table public.growth_intelligence_project_schedule_update_keys to authenticated;
grant select on table public.growth_intelligence_project_schedule_update_keys to service_role;

-- Branch moves need one narrow guard change. The shared
-- private.enforce_research_project_mutation trigger freezes branch_id on
-- every update, so a branch edit through this RPC would die with
-- growth_intelligence_research_project_identity_immutable. The repair below
-- reuses the tree's own transaction-local flag pattern
-- (app.allow_organization_lifecycle_change in
-- 20260807200000_organization_digital_twin.sql, and the scope-release
-- precedent in 20260915032105 which narrowed a shared guard so the governed
-- RPCs could pass it): branch_id may move only while
-- app.allow_research_project_branch_move is 'true', a flag this RPC raises
-- for its own guarded write and lowers again before returning. Direct
-- sessions never hold the flag, so their branch moves keep failing exactly
-- as before. No table, column, index, policy, or grant changes.
create or replace function private.enforce_research_project_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'growth_intelligence_research_project_delete_forbidden' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.organization_id is distinct from old.organization_id
      or (
        new.branch_id is distinct from old.branch_id
        and coalesce(pg_catalog.current_setting('app.allow_research_project_branch_move', true), '') <> 'true'
      )
      or new.mode is distinct from old.mode
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'growth_intelligence_research_project_identity_immutable' using errcode = '55000';
    end if;
  end if;
  if new.mode = 'recurring' then
    perform private.assert_research_project_schedule(new.schedule);
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_research_project_mutation()
  from public, anon, authenticated, service_role;

create function public.update_research_project_schedule_keyed(
  p_organization_id uuid,
  p_actor_id uuid,
  p_project_id uuid,
  p_schedule jsonb,
  p_branch_id uuid,
  p_idempotency_key text,
  p_scope_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  project public.growth_intelligence_research_projects;
  key_row public.growth_intelligence_project_schedule_update_keys;
  new_branch_id uuid;
  body_digest text;
  cadence_changed boolean;
  branch_changed boolean;
  latest_revision public.growth_intelligence_brief_revisions;
  next_revision_number integer;
  next_document jsonb;
  saved_revision public.growth_intelligence_brief_revisions;
begin
  -- Operator gate: the caller acts as themselves with manage rights, or not
  -- at all. Viewers and strangers are refused here with 42501, never told
  -- whether the project exists.
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'research_project_schedule_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_project_id is null
    or p_schedule is null
    or p_idempotency_key is null
    or p_idempotency_key is distinct from pg_catalog.btrim(p_idempotency_key)
    or pg_catalog.char_length(p_idempotency_key) not between 1 and 200
    or (p_scope_fingerprint is not null and p_scope_fingerprint !~ '^[0-9a-f]{64}$') then
    raise exception 'research_project_schedule_invalid' using errcode = '22023';
  end if;

  perform private.assert_research_project_schedule(p_schedule);

  -- Tenant fence first: a foreign id reads as not-found, never as a denial.
  select project_row.* into project
  from public.growth_intelligence_research_projects project_row
  where project_row.organization_id = p_organization_id
    and project_row.id = p_project_id
  for update;
  if not found then
    raise exception 'research_project_not_found' using errcode = '42501';
  end if;
  -- One-time projects carry no schedule; archived projects accept no movement.
  if project.mode is distinct from 'recurring' then
    raise exception 'research_project_schedule_invalid' using errcode = '22023';
  end if;
  if project.lifecycle = 'archived' then
    raise exception 'research_project_archived' using errcode = '42501';
  end if;

  -- A null branch keeps the current one; any branch must belong to the tenant.
  new_branch_id := coalesce(p_branch_id, project.branch_id);
  if not exists (
    select 1 from public.branches branch
    where branch.organization_id = p_organization_id
      and branch.id = new_branch_id
  ) then
    raise exception 'research_project_scope_not_found' using errcode = '42501';
  end if;

  -- The digest pins the update body to the key: same key plus same body
  -- replays, same key plus another body is a conflict.
  body_digest := pg_catalog.md5(pg_catalog.concat_ws(
    '|', p_organization_id::text, p_project_id::text,
    p_schedule::text, new_branch_id::text, coalesce(p_scope_fingerprint, '')
  ));

  -- One serialized update per key, so twin deliveries converge instead of
  -- appending twin revisions.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'update_research_project_schedule_keyed',
      p_organization_id, p_project_id, p_idempotency_key
    ),
    0
  ));

  select key_entry.* into key_row
  from public.growth_intelligence_project_schedule_update_keys key_entry
  where key_entry.organization_id = p_organization_id
    and key_entry.idempotency_key = p_idempotency_key
  for update;
  if found then
    if key_row.body_digest is distinct from body_digest
      or key_row.project_id is distinct from p_project_id then
      raise exception 'research_project_schedule_key_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'projectId', key_row.project_id,
      'revisionNumber', null,
      'replayed', true
    );
  end if;

  cadence_changed := (project.schedule ->> 'cadence') is distinct from (p_schedule ->> 'cadence');
  branch_changed := project.branch_id is distinct from new_branch_id;

  -- The branch guard opens only for this governed write (flag raised and
  -- lowered inside this call), so the relocation below passes the narrowed
  -- identity trigger while direct branch moves keep failing.
  perform pg_catalog.set_config('app.allow_research_project_branch_move', 'true', true);
  update public.growth_intelligence_research_projects project_row
  set schedule = p_schedule,
    branch_id = new_branch_id,
    updated_at = pg_catalog.now()
  where project_row.organization_id = p_organization_id
    and project_row.id = p_project_id;
  perform pg_catalog.set_config('app.allow_research_project_branch_move', '', true);

  -- The brief row moves with the project row where it describes the same
  -- scope: a moved branch relocates the brief, a new cadence re-times it.
  -- With no prior revision there is nothing to merge, so the project row
  -- moves alone. A fresh revision is always unpinned: pins belong to the
  -- updates that ran, never to the edit that follows them.
  next_revision_number := null;
  if cadence_changed or branch_changed then
    select revision.* into latest_revision
    from public.growth_intelligence_brief_revisions revision
    where revision.organization_id = p_organization_id
      and revision.project_id = p_project_id
    order by revision.revision_number desc, revision.id desc
    limit 1;
    if found then
      next_revision_number := latest_revision.revision_number + 1;
      next_document := latest_revision.document;
      next_document := pg_catalog.jsonb_set(
        next_document, '{locationId}', pg_catalog.to_jsonb(new_branch_id::text)
      );
      next_document := pg_catalog.jsonb_set(
        next_document, '{frequency}', pg_catalog.to_jsonb(p_schedule ->> 'cadence')
      );
      next_document := pg_catalog.jsonb_set(
        next_document, '{revisionNumber}', pg_catalog.to_jsonb(next_revision_number)
      );
      next_document := pg_catalog.jsonb_set(
        next_document, '{revisionId}', pg_catalog.to_jsonb(pg_catalog.gen_random_uuid()::text)
      );
      next_document := pg_catalog.jsonb_set(next_document, '{pinnedToUpdateId}', 'null'::jsonb);
      next_document := pg_catalog.jsonb_set(
        next_document,
        '{createdAtUtc}',
        pg_catalog.to_jsonb(pg_catalog.to_char(pg_catalog.now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      );
      perform private.assert_brief_revision_document(next_document);
      if pg_catalog.lower(next_document ->> 'organizationId') is distinct from pg_catalog.lower(p_organization_id::text)
        or pg_catalog.lower(next_document ->> 'projectId') is distinct from pg_catalog.lower(p_project_id::text)
        or (next_document ->> 'revisionNumber')::numeric is distinct from next_revision_number then
        raise exception 'brief_revision_context_mismatch' using errcode = '42501';
      end if;
      insert into public.growth_intelligence_brief_revisions (
        organization_id, project_id, revision_number, document,
        pinned_to_update_id, created_by
      ) values (
        p_organization_id, p_project_id, next_revision_number, next_document,
        null, p_actor_id
      ) returning * into saved_revision;
      next_revision_number := saved_revision.revision_number;
    end if;
  end if;

  -- A new scope fingerprint replaces the stale one: the old fingerprint no
  -- longer describes this project, so future starts must not converge onto
  -- it. When two scopes collide on one fingerprint the older holder keeps
  -- it (do nothing): no fork, no crash, convergence favors the first claim.
  -- Without a fingerprint the scope registry is left untouched.
  if p_scope_fingerprint is not null then
    delete from public.growth_intelligence_monitoring_active_scopes scope_entry
    where scope_entry.organization_id = p_organization_id
      and scope_entry.project_id = p_project_id;
    insert into public.growth_intelligence_monitoring_active_scopes (
      organization_id, scope_fingerprint, project_id, created_by
    ) values (
      p_organization_id, p_scope_fingerprint, p_project_id, p_actor_id
    )
    on conflict (organization_id, scope_fingerprint) do nothing;
  end if;

  insert into public.growth_intelligence_project_schedule_update_keys (
    organization_id, idempotency_key, project_id, body_digest, created_by
  ) values (
    p_organization_id, p_idempotency_key, p_project_id, body_digest, p_actor_id
  );

  return pg_catalog.jsonb_build_object(
    'projectId', p_project_id,
    'revisionNumber', next_revision_number,
    'replayed', false
  );
end;
$$;

revoke all on function public.update_research_project_schedule_keyed(uuid, uuid, uuid, jsonb, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_research_project_schedule_keyed(uuid, uuid, uuid, jsonb, uuid, text, text)
  to authenticated, service_role;
