-- Atomic Business Memory write paths. See specs/004-business-memory.md section 10.
--
-- These are the operations that must not be able to half-apply: a supersession
-- that inserted a replacement but failed to mark the original would leave two
-- live answers to the same question, and a proposal whose evidence links failed
-- to write would be an unsupported claim that retrieval could later surface.

create table public.memory_write_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  request_fingerprint text not null,
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

alter table public.memory_write_operations enable row level security;
alter table public.memory_write_operations force row level security;
revoke all on table public.memory_write_operations from public, anon, authenticated;

create index memory_write_operations_organization_idx
  on public.memory_write_operations (organization_id, created_at desc);

-- Supersede in one transaction: insert the replacement, point the original at
-- it, and record the reason. The cycle trigger from the schema migration still
-- applies, so a chain can never close on itself.
create or replace function public.supersede_memory_item(
  p_organization_id uuid,
  p_actor_id uuid,
  p_item_id uuid,
  p_title text,
  p_body text,
  p_sensitivity text,
  p_supersession_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing jsonb;
  original public.memory_items;
  replacement public.memory_items;
  fingerprint text;
  result jsonb;
begin
  if not private.has_organization_role(
    p_organization_id,
    array['owner', 'admin', 'operator']::public.organization_role[]
  ) then
    raise exception 'memory_authorization_denied' using errcode = '42501';
  end if;

  fingerprint := pg_catalog.encode(
    pg_catalog.digest(
      pg_catalog.concat_ws('|', p_item_id::text, p_title, coalesce(p_body, ''), p_sensitivity),
      'sha256'
    ),
    'hex'
  );

  select operation.response into existing
  from public.memory_write_operations operation
  where operation.organization_id = p_organization_id
    and operation.idempotency_key = p_idempotency_key;

  if existing is not null then
    if existing ->> 'fingerprint' is distinct from fingerprint then
      raise exception 'memory_idempotency_conflict' using errcode = '23505';
    end if;
    return existing;
  end if;

  select * into original
  from public.memory_items item
  where item.organization_id = p_organization_id
    and item.id = p_item_id
  for update;

  if original.id is null then
    raise exception 'memory_item_not_found' using errcode = 'P0002';
  end if;
  if original.superseded_by_id is not null then
    raise exception 'memory_already_superseded' using errcode = '23505';
  end if;

  insert into public.memory_items (
    organization_id, branch_id, memory_type, title, body, structured_value,
    origin, sensitivity, verification_state, created_by, verified_by, verified_at
  )
  values (
    p_organization_id, original.branch_id, original.memory_type, p_title, p_body,
    original.structured_value, 'user_verified', p_sensitivity, 'verified',
    p_actor_id, p_actor_id, pg_catalog.now()
  )
  returning * into replacement;

  update public.memory_items
  set superseded_by_id = replacement.id,
      superseded_at = pg_catalog.now(),
      supersession_reason = p_supersession_reason,
      embedding_status = 'skipped'
  where organization_id = p_organization_id
    and id = p_item_id;

  insert into public.memory_links (organization_id, from_item_id, to_item_id, relation, created_by)
  values (p_organization_id, replacement.id, p_item_id, 'supports', p_actor_id)
  on conflict do nothing;

  result := pg_catalog.jsonb_build_object(
    'fingerprint', fingerprint,
    'replacementId', replacement.id,
    'supersededId', p_item_id
  );

  insert into public.memory_write_operations (
    organization_id, idempotency_key, request_fingerprint, response
  )
  values (p_organization_id, p_idempotency_key, fingerprint, result);

  return result;
end;
$$;

revoke all on function public.supersede_memory_item(
  uuid, uuid, uuid, text, text, text, text, text
) from public, anon;
grant execute on function public.supersede_memory_item(
  uuid, uuid, uuid, text, text, text, text, text
) to authenticated;

-- Create a model-authored proposal together with the evidence it was derived
-- from. A proposal with no evidence is rejected before it can be written.
create or replace function public.create_proposed_memory_item(
  p_organization_id uuid,
  p_actor_id uuid,
  p_memory_type text,
  p_title text,
  p_body text,
  p_structured_value jsonb,
  p_origin text,
  p_sensitivity text,
  p_confidence numeric,
  p_source_run_id uuid,
  p_evidence_ids uuid[],
  p_proposed_fact_key text,
  p_proposed_fact_value jsonb,
  p_proposed_branch_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.memory_items;
  evidence_id uuid;
  evidence_count integer;
begin
  if p_origin not in ('ai_proposed', 'outcome_learned') then
    raise exception 'memory_origin_not_proposable' using errcode = '23514';
  end if;
  if p_evidence_ids is null or pg_catalog.cardinality(p_evidence_ids) = 0 then
    raise exception 'memory_evidence_required' using errcode = '23514';
  end if;

  select pg_catalog.count(*) into evidence_count
  from public.memory_items item
  where item.organization_id = p_organization_id
    and item.id = any(p_evidence_ids);

  if evidence_count <> pg_catalog.cardinality(p_evidence_ids) then
    raise exception 'memory_evidence_not_found' using errcode = '23503';
  end if;

  insert into public.memory_items (
    organization_id, memory_type, title, body, structured_value, origin,
    sensitivity, verification_state, confidence, source_run_id,
    proposed_fact_key, proposed_fact_value, proposed_branch_id, created_by
  )
  values (
    p_organization_id, p_memory_type, p_title, p_body, p_structured_value, p_origin,
    p_sensitivity, 'proposed', p_confidence, p_source_run_id,
    p_proposed_fact_key, p_proposed_fact_value, p_proposed_branch_id, p_actor_id
  )
  returning * into created;

  foreach evidence_id in array p_evidence_ids loop
    insert into public.memory_links (
      organization_id, from_item_id, to_item_id, relation, created_by
    )
    values (p_organization_id, created.id, evidence_id, 'derived_from', p_actor_id)
    on conflict do nothing;
  end loop;

  return created.id;
end;
$$;

revoke all on function public.create_proposed_memory_item(
  uuid, uuid, text, text, text, jsonb, text, text, numeric, uuid, uuid[], text, jsonb, uuid
) from public, anon, authenticated;
