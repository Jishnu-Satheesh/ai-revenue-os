-- Exact-output launch approval.
--
-- The last gate. A proposal approval said "you may prepare creative". Each
-- deliverable review said "these exact bytes are fine". This says "publish
-- THESE outputs, to THESE accounts, with THESE words, at THIS time, for THIS
-- money" — and binds every one of those terms together.
--
-- Binding all of it matters because a person reviewing a post is reading the
-- picture and the caption, and implicitly agreeing to where it goes and what it
-- costs. Letting the destination, the account, the schedule or the budget move
-- afterwards would mean the approval authorized something its approver never
-- saw. So the approval carries a digest of the whole manifest, and changing any
-- term produces NEW authority rather than editing the old one.
--
-- What this is NOT: a verdict on the artwork as a reusable reference. Approving
-- a post to go out today says nothing about whether that design should be drawn
-- from again. C04 keeps publication authority and Creative History approval
-- apart, and nothing here writes a creative review.
--
-- Additive and forward-only. No existing table is altered.

create table public.campaign_launch_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null,
  bundle_version_id uuid not null,
  -- The whole authorized set and its terms, exactly as approved.
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  -- What the approval is bound to. Any change to any term moves this.
  launch_digest text not null check (launch_digest ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  state text not null default 'authorized' check (
    state in ('authorized', 'superseded', 'revoked')
  ),
  -- Supplied by the caller so a double-click cannot authorize twice.
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  authorized_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, campaign_id, idempotency_key),
  -- One live authority per exact set of terms. A second approval of identical
  -- terms is a replay, not a second authorization.
  unique (organization_id, campaign_id, launch_digest),
  foreign key (organization_id, campaign_id)
    references public.campaigns (organization_id, id) on delete cascade,
  foreign key (organization_id, bundle_version_id)
    references public.campaign_bundle_versions (organization_id, id) on delete restrict
);

create index campaign_launch_approvals_campaign_idx
  on public.campaign_launch_approvals (organization_id, campaign_id, state, authorized_at desc);

-- Which exact outputs this authority covers.
--
-- Stored as rows rather than only inside the manifest JSON so the database can
-- enforce the binding: a deliverable version referenced here is a real row in
-- this tenant, and the hash recorded is the hash that was authorized.
create table public.campaign_launch_selections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  launch_approval_id uuid not null,
  deliverable_id uuid not null,
  deliverable_version_id uuid not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  unique (organization_id, id),
  -- The same output cannot be authorized twice inside one approval.
  unique (organization_id, launch_approval_id, deliverable_version_id),
  foreign key (organization_id, launch_approval_id)
    references public.campaign_launch_approvals (organization_id, id) on delete cascade,
  foreign key (organization_id, deliverable_version_id)
    references public.campaign_deliverable_versions (organization_id, id) on delete restrict,
  foreign key (organization_id, deliverable_id)
    references public.campaign_deliverables (organization_id, id) on delete restrict
);

create index campaign_launch_selections_version_idx
  on public.campaign_launch_selections (organization_id, deliverable_version_id);

-- Authority, once given, is a record. Superseding is a state change plus a new
-- row; it is never an edit to the terms or a deletion of what was authorized.
create function private.reject_campaign_launch_selection_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'campaign_launch_selection_immutable' using errcode = '42501';
end;
$$;

create function private.reject_campaign_launch_terms_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- State may move (authorized -> superseded / revoked). The terms may not.
  if new.manifest is distinct from old.manifest
    or new.launch_digest is distinct from old.launch_digest
    or new.actor_id is distinct from old.actor_id
    or new.bundle_version_id is distinct from old.bundle_version_id
    or new.campaign_id is distinct from old.campaign_id
    or new.authorized_at is distinct from old.authorized_at then
    raise exception 'campaign_launch_terms_immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function private.reject_campaign_launch_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'campaign_launch_terms_immutable' using errcode = '42501';
end;
$$;

create trigger campaign_launch_selections_immutable
  before update or delete on public.campaign_launch_selections
  for each row execute function private.reject_campaign_launch_selection_mutation();

create trigger campaign_launch_approvals_terms_immutable
  before update on public.campaign_launch_approvals
  for each row execute function private.reject_campaign_launch_terms_mutation();

create trigger campaign_launch_approvals_no_delete
  before delete on public.campaign_launch_approvals
  for each row execute function private.reject_campaign_launch_deletion();

-- Tenancy ---------------------------------------------------------------------

alter table public.campaign_launch_approvals enable row level security;
alter table public.campaign_launch_approvals force row level security;
alter table public.campaign_launch_selections enable row level security;
alter table public.campaign_launch_selections force row level security;

create policy "members read campaign launch approvals" on public.campaign_launch_approvals
  for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'campaign.read')));
create policy "members read campaign launch selections" on public.campaign_launch_selections
  for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'campaign.read')));

revoke all on table public.campaign_launch_approvals, public.campaign_launch_selections
  from public, anon, authenticated;
grant select on table public.campaign_launch_approvals, public.campaign_launch_selections
  to authenticated;

-- The writer --------------------------------------------------------------------
--
-- Everything that must hold at once: the actor still holds publish authority,
-- every selected output still exists in this tenant, still carries the exact
-- hash named, is still its deliverable's current version, and still has its own
-- standing approval of that hash. Then the authority and its selections are
-- written together or not at all.
--
-- The per-output checks are repeated here rather than trusted from the caller
-- because this is the transaction that grants publication. A check that ran
-- when the screen was drawn proves nothing about the moment the button lands.

create function public.approve_campaign_launch(
  target_organization_id uuid,
  input_launch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.campaign_launch_approvals;
  v_saved public.campaign_launch_approvals;
  v_selection jsonb;
  v_version public.campaign_deliverable_versions;
  v_deliverable public.campaign_deliverables;
  v_latest public.campaign_deliverable_reviews;
  v_campaign_id uuid;
begin
  v_campaign_id := (input_launch ->> 'campaign_id')::uuid;

  -- Publishing to a public account is a higher bar than approving a version for
  -- execution; `campaign.publish` sits above the operator line for that reason.
  if (select auth.uid()) is null
    or not private.has_organization_permission(target_organization_id, 'campaign.publish') then
    raise exception 'campaign_launch_forbidden' using errcode = '42501';
  end if;

  -- A repeated request replays the authority already committed under this key.
  select * into v_existing
  from public.campaign_launch_approvals approval
  where approval.organization_id = target_organization_id
    and approval.campaign_id = v_campaign_id
    and approval.idempotency_key = input_launch ->> 'idempotency_key';

  if found then
    if v_existing.launch_digest is distinct from input_launch ->> 'launch_digest' then
      raise exception 'campaign_launch_idempotency_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'launch_approval_id', v_existing.id,
      'outcome', 'replayed'
    );
  end if;

  if pg_catalog.jsonb_array_length(coalesce(input_launch -> 'selections', '[]'::jsonb)) = 0 then
    raise exception 'campaign_launch_empty_selection' using errcode = '22023';
  end if;

  insert into public.campaign_launch_approvals (
    organization_id, campaign_id, bundle_version_id, manifest, launch_digest, actor_id,
    idempotency_key
  ) values (
    target_organization_id,
    v_campaign_id,
    (input_launch ->> 'bundle_version_id')::uuid,
    input_launch -> 'manifest',
    input_launch ->> 'launch_digest',
    -- From the session. A body cannot name who authorized a publication.
    (select auth.uid()),
    input_launch ->> 'idempotency_key'
  )
  returning * into v_saved;

  for v_selection in
    select value from pg_catalog.jsonb_array_elements(input_launch -> 'selections')
  loop
    select * into v_version
    from public.campaign_deliverable_versions version_row
    where version_row.organization_id = target_organization_id
      and version_row.id = (v_selection ->> 'deliverable_version_id')::uuid
    for update;

    if not found then
      raise exception 'campaign_launch_selection_not_found' using errcode = 'P0002';
    end if;

    if v_version.campaign_id is distinct from v_campaign_id then
      raise exception 'campaign_launch_selection_foreign_campaign' using errcode = '22023';
    end if;

    -- The bytes named must be the bytes the output has right now.
    if v_version.content_hash is distinct from v_selection ->> 'content_hash' then
      raise exception 'campaign_launch_content_changed' using errcode = '22023';
    end if;

    select * into v_deliverable
    from public.campaign_deliverables deliverable
    where deliverable.organization_id = target_organization_id
      and deliverable.id = v_version.deliverable_id;

    if v_deliverable.current_version_id is distinct from v_version.id then
      raise exception 'campaign_launch_selection_superseded' using errcode = '22023';
    end if;

    -- Its own standing review of its own current bytes. A previously approved
    -- generation family authorizes nothing here: an unreviewed later variant
    -- must fail, which is decision D05.
    select * into v_latest
    from public.campaign_deliverable_reviews review_row
    where review_row.organization_id = target_organization_id
      and review_row.deliverable_version_id = v_version.id
    order by review_row.reviewed_at desc
    limit 1;

    if not found then
      raise exception 'campaign_launch_selection_unreviewed' using errcode = '22023';
    end if;

    if v_latest.decision is distinct from 'approved' then
      raise exception 'campaign_launch_selection_rejected' using errcode = '22023';
    end if;

    if v_latest.content_hash is distinct from v_version.content_hash then
      raise exception 'campaign_launch_content_changed' using errcode = '22023';
    end if;

    insert into public.campaign_launch_selections (
      organization_id, launch_approval_id, deliverable_id, deliverable_version_id, content_hash
    ) values (
      target_organization_id,
      v_saved.id,
      v_version.deliverable_id,
      v_version.id,
      v_version.content_hash
    );
  end loop;

  -- Earlier authority for this campaign is superseded rather than deleted. What
  -- was authorized, and when, stays readable; only its power ends.
  update public.campaign_launch_approvals
  set state = 'superseded'
  where organization_id = target_organization_id
    and campaign_id = v_campaign_id
    and id is distinct from v_saved.id
    and state = 'authorized';

  return pg_catalog.jsonb_build_object('launch_approval_id', v_saved.id, 'outcome', 'saved');
end;
$$;

revoke all on function public.approve_campaign_launch(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.approve_campaign_launch(uuid, jsonb) to authenticated;

comment on function public.approve_campaign_launch(uuid, jsonb) is
  'Binds publication authority to an exact set of reviewed deliverable versions and every channel term. Requires campaign.publish. Refuses an unreviewed, rejected, superseded or changed output. Never writes a Creative History verdict.';
