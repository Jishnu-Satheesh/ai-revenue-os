-- Campaign proposals and the first approval gate.
--
-- A proposal is the argument for doing a piece of marketing, written before
-- anything is made. Approving one authorizes PREPARATION ONLY: drafting
-- creative inside a stated cost ceiling. It reserves no media spend, publishes
-- nothing, confirms no creative and authorizes no later variation. Publication
-- requires a separate review of each exact finished output. That is the
-- two-gate model in
-- `adrs/0057-campaign-preparation-approval-vs-exact-output-publication.md`,
-- and contract C02.
--
-- Three tables, deliberately separate:
--   * `campaign_proposals`          identity and current state
--   * `campaign_proposal_versions`  immutable documents with their digests
--   * `campaign_proposal_decisions` append-only record of who decided what
--
-- There is no mutable "approved" column anywhere. Whether a proposal is
-- approved is derived from its decisions, so no update can make a document
-- look approved, and an approval cannot survive a change to the content it was
-- given for.
--
-- Additive and forward-only. The one change to an existing table is a widened
-- check constraint on `public.campaigns`, which admits a new source kind and
-- leaves every existing row valid.

-- 1. The approval capability ---------------------------------------------------
--
-- Distinct from `campaign.approve`, which approves an exact bundle for
-- execution. Approving a proposal is the earlier, narrower act, and C02
-- requires it to be an owner/admin capability rather than a role comparison
-- written into a function body.

insert into public.permissions (key, description, scope) values
  (
    'campaign.proposal_approve',
    'Approve a campaign proposal for creative preparation only.',
    'organization'
  )
on conflict (key) do nothing;

-- Owner and admin only. Note that `campaign.approve` is held by operators too;
-- this one deliberately is not, because C02 separates the person who drafts a
-- proposal from the person who agrees to it.
insert into public.organization_role_permissions
  (organization_role, permission_key, permission_scope) values
  ('owner', 'campaign.proposal_approve', 'organization'),
  ('admin', 'campaign.proposal_approve', 'organization')
on conflict do nothing;

-- 2. Identity ------------------------------------------------------------------

create table public.campaign_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Why this proposal exists. These are PROPOSAL kinds and deliberately not
  -- the `campaigns.source_kind` values: a proposal that began as a business
  -- signal may still end up linked to a campaign, and conflating the two would
  -- make the campaign's own provenance unreadable.
  source_kind text not null check (
    source_kind in ('manual_request', 'business_signal', 'next_test')
  ),
  source_id uuid,
  -- Lets a repeated signal find its existing proposal instead of opening a
  -- second one. Not unique: a dismissed proposal may legitimately be followed
  -- by a new one for the same fingerprint later.
  dedupe_fingerprint text check (char_length(dedupe_fingerprint) between 1 and 200),
  state text not null default 'researching' check (
    state in (
      'researching', 'needs_input', 'ready_for_review', 'changes_requested',
      'approved_for_preparation', 'snoozed', 'dismissed', 'superseded', 'cancelled'
    )
  ),
  current_version_id uuid,
  linked_campaign_id uuid,
  snoozed_until timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, linked_campaign_id)
    references public.campaigns (organization_id, id) on delete restrict,
  -- A snooze without an until is not a snooze, it is a silent disappearance.
  check ((state = 'snoozed') = (snoozed_until is not null))
);

create index campaign_proposals_state_idx
  on public.campaign_proposals (organization_id, state);
create index campaign_proposals_fingerprint_idx
  on public.campaign_proposals (organization_id, dedupe_fingerprint)
  where dedupe_fingerprint is not null;

-- 3. Immutable versions --------------------------------------------------------

create table public.campaign_proposal_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  proposal_id uuid not null,
  version integer not null check (version > 0),
  document jsonb not null,
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  -- The exact revisions of the records this document rests on, captured as
  -- they were read. Pinned, not referenced live: a proposal must stay
  -- explicable after its sources move on.
  source_revision_manifest jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, proposal_id, version),
  -- One digest can only ever describe one document, so a decision that names a
  -- digest names exactly one content.
  unique (organization_id, proposal_id, digest),
  foreign key (organization_id, proposal_id)
    references public.campaign_proposals (organization_id, id) on delete cascade
);

alter table public.campaign_proposals
  add constraint campaign_proposals_current_version_fkey
  foreign key (organization_id, current_version_id)
  references public.campaign_proposal_versions (organization_id, id) on delete restrict;

-- 4. Append-only decisions -----------------------------------------------------

create table public.campaign_proposal_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  proposal_id uuid not null,
  proposal_version_id uuid not null,
  -- Carried alongside the version id on purpose. The id says which row; the
  -- digest says which content. Both must match for a decision to authorize
  -- anything, which is what stops an approval sliding onto edited text.
  proposal_digest text not null check (proposal_digest ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (
    decision in ('approved_for_preparation', 'changes_requested', 'snoozed', 'dismissed')
  ),
  -- Untrusted human text. Stored as written, never interpreted as instruction.
  reason text check (char_length(reason) between 1 and 4000),
  instructions text check (char_length(instructions) between 1 and 4000),
  snoozed_until timestamptz,
  -- Supplied by the caller so a double-click cannot record two approvals.
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  decided_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, proposal_id, idempotency_key),
  foreign key (organization_id, proposal_id)
    references public.campaign_proposals (organization_id, id) on delete cascade,
  foreign key (organization_id, proposal_version_id)
    references public.campaign_proposal_versions (organization_id, id) on delete restrict,
  check ((decision = 'snoozed') = (snoozed_until is not null))
);

create index campaign_proposal_decisions_proposal_idx
  on public.campaign_proposal_decisions (organization_id, proposal_id, decided_at desc);

-- 5. Immutability --------------------------------------------------------------
--
-- Versions and decisions are the record an approval rests on. If either could
-- be edited afterwards, the audit trail would describe whatever the last writer
-- preferred. Deletes are refused too: superseding is a new row, not an erasure.

create function private.reject_campaign_proposal_version_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'campaign_proposal_version_immutable' using errcode = '42501';
end;
$$;

create function private.reject_campaign_proposal_decision_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'campaign_proposal_decision_immutable' using errcode = '42501';
end;
$$;

create trigger campaign_proposal_versions_immutable
  before update or delete on public.campaign_proposal_versions
  for each row execute function private.reject_campaign_proposal_version_mutation();

create trigger campaign_proposal_decisions_immutable
  before update or delete on public.campaign_proposal_decisions
  for each row execute function private.reject_campaign_proposal_decision_mutation();

-- 6. Tenancy -------------------------------------------------------------------

alter table public.campaign_proposals enable row level security;
alter table public.campaign_proposals force row level security;
alter table public.campaign_proposal_versions enable row level security;
alter table public.campaign_proposal_versions force row level security;
alter table public.campaign_proposal_decisions enable row level security;
alter table public.campaign_proposal_decisions force row level security;

create policy "members read campaign proposals" on public.campaign_proposals
  for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'campaign.read')));
create policy "members read campaign proposal versions" on public.campaign_proposal_versions
  for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'campaign.read')));
create policy "members read campaign proposal decisions" on public.campaign_proposal_decisions
  for select to authenticated
  using ((select private.has_organization_permission(organization_id, 'campaign.read')));

-- Reads go through RLS; every write goes through the governed functions below.
-- No direct insert, update or delete grant exists for any role here.
revoke all on table public.campaign_proposals, public.campaign_proposal_versions,
  public.campaign_proposal_decisions from public, anon, authenticated;
grant select on table public.campaign_proposals, public.campaign_proposal_versions,
  public.campaign_proposal_decisions to authenticated;

-- 7. A campaign may now originate from a proposal ------------------------------
--
-- C02 is explicit that this is an honest schema amendment rather than
-- manufacturing a Decision opportunity or reusing `manual_brief` to dodge one.
-- Existing rows keep their exact source and stay valid: the new arm only adds
-- a third alternative.

alter table public.campaigns add column proposal_id uuid;

alter table public.campaigns
  add constraint campaigns_proposal_fkey
  foreign key (organization_id, proposal_id)
  references public.campaign_proposals (organization_id, id) on delete restrict;

alter table public.campaigns drop constraint campaigns_source_kind_check;
alter table public.campaigns add constraint campaigns_source_kind_check
  check (source_kind in ('manual_brief', 'decision_opportunity', 'campaign_proposal'));

alter table public.campaigns drop constraint campaigns_check;
alter table public.campaigns add constraint campaigns_source_link_check check (
  (source_kind = 'manual_brief'
    and brief_id is not null and opportunity_id is null and proposal_id is null)
  or (source_kind = 'decision_opportunity'
    and opportunity_id is not null and brief_id is null and proposal_id is null)
  or (source_kind = 'campaign_proposal'
    and proposal_id is not null and brief_id is null and opportunity_id is null)
);

create unique index campaigns_proposal_idx
  on public.campaigns (organization_id, proposal_id)
  where proposal_id is not null;

-- 8. Writers -------------------------------------------------------------------

create function public.request_campaign_proposal(
  target_organization_id uuid,
  input_proposal jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.campaign_proposals;
  existing public.campaign_proposals;
  fingerprint text;
begin
  if (select auth.uid()) is null
    or not private.has_organization_permission(target_organization_id, 'campaign.create') then
    raise exception 'campaign_proposal_forbidden' using errcode = '42501';
  end if;

  fingerprint := nullif(pg_catalog.btrim(input_proposal ->> 'dedupe_fingerprint'), '');

  -- A repeated signal joins the proposal already open for it rather than
  -- opening a second one that a person would have to reconcile by hand. Only
  -- live states coalesce; a dismissed proposal does not silently reopen.
  if fingerprint is not null then
    select * into existing
    from public.campaign_proposals proposal
    where proposal.organization_id = target_organization_id
      and proposal.dedupe_fingerprint = fingerprint
      and proposal.state in ('researching', 'needs_input', 'ready_for_review', 'changes_requested')
    order by proposal.created_at asc
    limit 1;

    if found then
      return pg_catalog.jsonb_build_object(
        'proposal_id', existing.id,
        'outcome', 'replayed'
      );
    end if;
  end if;

  insert into public.campaign_proposals
    (organization_id, source_kind, source_id, dedupe_fingerprint, state, created_by)
  values (
    target_organization_id,
    input_proposal ->> 'source_kind',
    nullif(input_proposal ->> 'source_id', '')::uuid,
    fingerprint,
    coalesce(nullif(input_proposal ->> 'state', ''), 'researching'),
    (select auth.uid())
  )
  returning * into saved;

  return pg_catalog.jsonb_build_object('proposal_id', saved.id, 'outcome', 'saved');
end;
$$;

create function public.complete_campaign_proposal_version(
  target_organization_id uuid,
  input_version jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_proposal public.campaign_proposals;
  saved public.campaign_proposal_versions;
  next_version integer;
begin
  if (select auth.uid()) is null
    or not private.has_organization_permission(target_organization_id, 'campaign.edit') then
    raise exception 'campaign_proposal_forbidden' using errcode = '42501';
  end if;

  select * into target_proposal
  from public.campaign_proposals proposal
  where proposal.organization_id = target_organization_id
    and proposal.id = (input_version ->> 'proposal_id')::uuid
  for update;

  if not found then
    raise exception 'campaign_proposal_not_found' using errcode = 'P0002';
  end if;

  -- A decided proposal does not quietly gain a new revision underneath its
  -- decision. Asking for changes is what reopens it.
  if target_proposal.state in ('approved_for_preparation', 'dismissed', 'superseded', 'cancelled') then
    raise exception 'campaign_proposal_not_revisable' using errcode = '22023';
  end if;

  select coalesce(pg_catalog.max(version), 0) + 1 into next_version
  from public.campaign_proposal_versions version_row
  where version_row.organization_id = target_organization_id
    and version_row.proposal_id = target_proposal.id;

  insert into public.campaign_proposal_versions
    (organization_id, proposal_id, version, document, digest, source_revision_manifest, created_by)
  values (
    target_organization_id,
    target_proposal.id,
    next_version,
    input_version -> 'document',
    input_version ->> 'digest',
    coalesce(input_version -> 'source_revision_manifest', '{}'::jsonb),
    (select auth.uid())
  )
  returning * into saved;

  update public.campaign_proposals
  set current_version_id = saved.id,
      state = coalesce(nullif(input_version ->> 'state', ''), 'ready_for_review'),
      snoozed_until = null,
      updated_at = pg_catalog.now()
  where organization_id = target_organization_id
    and id = target_proposal.id;

  return pg_catalog.jsonb_build_object(
    'proposal_version_id', saved.id,
    'version', saved.version,
    'digest', saved.digest
  );
end;
$$;

-- The approval transaction.
--
-- Everything it must be true of at once: the actor still holds the capability,
-- the version named is still the current one, the digest still describes that
-- version's content, and the proposal is still in a state that can be decided.
-- Then the decision, the campaign link and the generation intent are written
-- together or not at all.
create function public.decide_campaign_proposal(
  target_organization_id uuid,
  input_decision jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_proposal public.campaign_proposals;
  target_version public.campaign_proposal_versions;
  existing public.campaign_proposal_decisions;
  saved public.campaign_proposal_decisions;
  decision_kind text;
  linked_campaign uuid;
  next_state text;
begin
  decision_kind := input_decision ->> 'decision';

  if (select auth.uid()) is null then
    raise exception 'campaign_proposal_forbidden' using errcode = '42501';
  end if;

  -- Approving for preparation is an owner/admin capability. The other
  -- decisions are ordinary review traffic an operator may record.
  if decision_kind = 'approved_for_preparation' then
    if not private.has_organization_permission(
      target_organization_id, 'campaign.proposal_approve'
    ) then
      raise exception 'campaign_proposal_forbidden' using errcode = '42501';
    end if;
  elsif not private.has_organization_permission(target_organization_id, 'campaign.edit') then
    raise exception 'campaign_proposal_forbidden' using errcode = '42501';
  end if;

  select * into target_proposal
  from public.campaign_proposals proposal
  where proposal.organization_id = target_organization_id
    and proposal.id = (input_decision ->> 'proposal_id')::uuid
  for update;

  if not found then
    raise exception 'campaign_proposal_not_found' using errcode = 'P0002';
  end if;

  -- A repeated request replays the decision already committed under this key.
  -- Different content under the same key is a conflict, never an overwrite.
  select * into existing
  from public.campaign_proposal_decisions decision_row
  where decision_row.organization_id = target_organization_id
    and decision_row.proposal_id = target_proposal.id
    and decision_row.idempotency_key = input_decision ->> 'idempotency_key';

  if found then
    if existing.proposal_digest is distinct from input_decision ->> 'proposal_digest'
      or existing.decision is distinct from decision_kind then
      raise exception 'campaign_proposal_idempotency_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'decision_id', existing.id,
      'outcome', 'replayed',
      'linked_campaign_id', target_proposal.linked_campaign_id
    );
  end if;

  select * into target_version
  from public.campaign_proposal_versions version_row
  where version_row.organization_id = target_organization_id
    and version_row.id = (input_decision ->> 'proposal_version_id')::uuid
    and version_row.proposal_id = target_proposal.id;

  if not found then
    raise exception 'campaign_proposal_version_not_found' using errcode = 'P0002';
  end if;

  -- Deciding anything other than the revision on screen is refused. This is
  -- the check that stops an approval landing on text its approver never read.
  if target_proposal.current_version_id is distinct from target_version.id then
    raise exception 'campaign_proposal_stale_version' using errcode = '22023';
  end if;

  if target_version.digest is distinct from input_decision ->> 'proposal_digest' then
    raise exception 'campaign_proposal_stale_version' using errcode = '22023';
  end if;

  if target_proposal.state not in ('ready_for_review', 'changes_requested', 'snoozed') then
    raise exception 'campaign_proposal_not_decidable' using errcode = '22023';
  end if;

  insert into public.campaign_proposal_decisions (
    organization_id, proposal_id, proposal_version_id, proposal_digest, actor_id,
    decision, reason, instructions, snoozed_until, idempotency_key
  ) values (
    target_organization_id,
    target_proposal.id,
    target_version.id,
    target_version.digest,
    -- Identity comes from the session, never from the request body.
    (select auth.uid()),
    decision_kind,
    nullif(pg_catalog.btrim(input_decision ->> 'reason'), ''),
    nullif(pg_catalog.btrim(input_decision ->> 'instructions'), ''),
    (nullif(input_decision ->> 'snoozed_until', ''))::timestamptz,
    input_decision ->> 'idempotency_key'
  )
  returning * into saved;

  next_state := case decision_kind
    when 'approved_for_preparation' then 'approved_for_preparation'
    when 'changes_requested' then 'changes_requested'
    when 'snoozed' then 'snoozed'
    else 'dismissed'
  end;

  linked_campaign := target_proposal.linked_campaign_id;

  -- One approval establishes one campaign. The unique index on
  -- (organization_id, proposal_id) is what makes a concurrent second approval
  -- fail rather than open a duplicate campaign.
  if decision_kind = 'approved_for_preparation' and linked_campaign is null then
    insert into public.campaigns
      (organization_id, title, source_kind, proposal_id, state, created_by)
    values (
      target_organization_id,
      pg_catalog.left(
        coalesce(target_version.document #>> '{title}', 'Campaign'), 240
      ),
      'campaign_proposal',
      target_proposal.id,
      'draft',
      (select auth.uid())
    )
    returning id into linked_campaign;
  end if;

  update public.campaign_proposals
  set state = next_state,
      linked_campaign_id = linked_campaign,
      snoozed_until = (nullif(input_decision ->> 'snoozed_until', ''))::timestamptz,
      updated_at = pg_catalog.now()
  where organization_id = target_organization_id
    and id = target_proposal.id;

  return pg_catalog.jsonb_build_object(
    'decision_id', saved.id,
    'outcome', 'saved',
    'linked_campaign_id', linked_campaign
  );
end;
$$;

-- `service_role` is named explicitly. A background worker must never be able to
-- approve a proposal: approval is a person agreeing to spend their own money,
-- and nothing that runs unattended may stand in for that.
revoke all on function public.request_campaign_proposal(uuid, jsonb),
  public.complete_campaign_proposal_version(uuid, jsonb),
  public.decide_campaign_proposal(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.request_campaign_proposal(uuid, jsonb) to authenticated;
grant execute on function public.complete_campaign_proposal_version(uuid, jsonb) to authenticated;
grant execute on function public.decide_campaign_proposal(uuid, jsonb) to authenticated;
