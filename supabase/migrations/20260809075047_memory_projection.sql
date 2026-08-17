-- Atomic, worker-only projection for validated Google Business Profile envelopes.
-- `business_facts` remains read-only here; provider observations become an
-- episode and (where different) a proposal for human confirmation.

-- Provider ingestion ran before this guard existed, so an organization can
-- already hold several identical open proposals for one fact key. The index
-- below is also the ON CONFLICT arbiter for the projection function, so it must
-- be creatable: collapse each group to its newest row first. The losers are
-- rejected with a reason rather than deleted, because a correction that erases
-- the records it corrected is not auditable. Rejected rows leave the partial
-- index and the review queue while staying readable in the chain.
with ranked as (
  select
    id,
    row_number() over (
      partition by organization_id, proposed_branch_id, proposed_fact_key
      order by created_at desc, id desc
    ) as duplicate_rank
  from public.memory_items
  where memory_type = 'fact_proposal' and verification_state = 'proposed'
)
update public.memory_items item
set
  verification_state = 'rejected',
  rejection_reason = 'Deduplicated: an identical newer proposal for this fact key is open.'
from ranked
where ranked.id = item.id and ranked.duplicate_rank > 1;

create unique index memory_items_open_fact_proposal_idx
  on public.memory_items (organization_id, proposed_branch_id, proposed_fact_key) nulls not distinct
  where memory_type = 'fact_proposal' and verification_state = 'proposed';

create or replace function public.project_google_business_profile_record(
  p_organization_id uuid,
  p_ingestion_run_id uuid,
  p_source_connection_id uuid,
  p_source_system text,
  p_source_record_id text,
  p_branch_id uuid,
  p_title text,
  p_body text,
  p_structured_value jsonb,
  p_sensitivity text,
  p_observed_at timestamptz,
  p_location_fact_values jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.integration_ingestion_runs;
  current_fact_value jsonb;
  location_fact record;
begin
  if p_source_system <> 'google_business_profile' then
    raise exception 'unsupported_memory_projection_source' using errcode = '23514';
  end if;
  if p_sensitivity not in ('internal', 'customer_content') then
    raise exception 'invalid_memory_projection_sensitivity' using errcode = '23514';
  end if;
  if p_location_fact_values is null or pg_catalog.jsonb_typeof(p_location_fact_values) <> 'object' then
    raise exception 'invalid_memory_projection_facts' using errcode = '23514';
  end if;

  select * into run
  from public.integration_ingestion_runs run
  where run.organization_id = p_organization_id
    and run.id = p_ingestion_run_id
    and run.connection_id = p_source_connection_id;
  if not found then
    raise exception 'integration_projection_scope_invalid' using errcode = '23503';
  end if;

  if p_branch_id is not null and not exists (
    select 1 from public.branches branch
    where branch.organization_id = p_organization_id and branch.id = p_branch_id
  ) then
    raise exception 'integration_projection_branch_invalid' using errcode = '23503';
  end if;

  insert into public.memory_items (
    organization_id, branch_id, memory_type, title, body, structured_value,
    origin, sensitivity, verification_state, observed_at, source_system,
    source_reference, source_run_id, source_record_id
  ) values (
    p_organization_id, p_branch_id, 'episode', p_title, p_body, p_structured_value,
    'provider_imported', p_sensitivity, 'unverified', p_observed_at, p_source_system,
    p_source_connection_id::text, p_ingestion_run_id, p_source_record_id
  )
  on conflict (organization_id, source_system, source_record_id)
    where source_record_id is not null
  do update set
    branch_id = excluded.branch_id,
    title = excluded.title,
    body = excluded.body,
    structured_value = excluded.structured_value,
    sensitivity = excluded.sensitivity,
    observed_at = excluded.observed_at,
    source_reference = excluded.source_reference,
    source_run_id = excluded.source_run_id,
    verification_state = case
      when memory_items.branch_id is not distinct from excluded.branch_id
        and memory_items.title is not distinct from excluded.title
        and memory_items.body is not distinct from excluded.body
        and memory_items.structured_value is not distinct from excluded.structured_value
        and memory_items.sensitivity is not distinct from excluded.sensitivity
        and memory_items.observed_at is not distinct from excluded.observed_at
        and memory_items.source_reference is not distinct from excluded.source_reference
      then memory_items.verification_state else 'unverified' end,
    verified_by = case
      when memory_items.branch_id is not distinct from excluded.branch_id
        and memory_items.title is not distinct from excluded.title
        and memory_items.body is not distinct from excluded.body
        and memory_items.structured_value is not distinct from excluded.structured_value
        and memory_items.sensitivity is not distinct from excluded.sensitivity
        and memory_items.observed_at is not distinct from excluded.observed_at
        and memory_items.source_reference is not distinct from excluded.source_reference
      then memory_items.verified_by else null end,
    verified_at = case
      when memory_items.branch_id is not distinct from excluded.branch_id
        and memory_items.title is not distinct from excluded.title
        and memory_items.body is not distinct from excluded.body
        and memory_items.structured_value is not distinct from excluded.structured_value
        and memory_items.sensitivity is not distinct from excluded.sensitivity
        and memory_items.observed_at is not distinct from excluded.observed_at
        and memory_items.source_reference is not distinct from excluded.source_reference
      then memory_items.verified_at else null end,
    rejection_reason = case
      when memory_items.branch_id is not distinct from excluded.branch_id
        and memory_items.title is not distinct from excluded.title
        and memory_items.body is not distinct from excluded.body
        and memory_items.structured_value is not distinct from excluded.structured_value
        and memory_items.sensitivity is not distinct from excluded.sensitivity
        and memory_items.observed_at is not distinct from excluded.observed_at
        and memory_items.source_reference is not distinct from excluded.source_reference
      then memory_items.rejection_reason else null end,
    updated_at = now();

  for location_fact in
    select key, value from pg_catalog.jsonb_each(p_location_fact_values)
  loop
    if location_fact.key not in (
      'google_business_profile.location.hours',
      'google_business_profile.location.primary_category',
      'google_business_profile.location.address',
      'google_business_profile.location.phone'
    ) then
      raise exception 'unsupported_memory_projection_fact' using errcode = '23514';
    end if;

    current_fact_value := null;
    select fact.value into current_fact_value
    from public.business_facts fact
    where fact.organization_id = p_organization_id
      and fact.branch_id is not distinct from p_branch_id
      and fact.fact_key = location_fact.key;

    if not found or current_fact_value is distinct from location_fact.value then
      insert into public.memory_items (
        organization_id, branch_id, memory_type, title, origin, sensitivity,
        verification_state, source_system, source_reference, source_run_id,
        proposed_fact_key, proposed_fact_value, proposed_branch_id
      ) values (
        p_organization_id, p_branch_id, 'fact_proposal',
        'Proposed update to ' || location_fact.key, 'provider_imported', 'internal',
        'proposed', p_source_system, p_source_connection_id::text, p_ingestion_run_id,
        location_fact.key, location_fact.value, p_branch_id
      )
      on conflict (organization_id, proposed_branch_id, proposed_fact_key)
        where memory_type = 'fact_proposal' and verification_state = 'proposed'
      do update set
        title = excluded.title,
        source_system = excluded.source_system,
        source_reference = excluded.source_reference,
        source_run_id = excluded.source_run_id,
        proposed_fact_value = excluded.proposed_fact_value,
        updated_at = now();
    end if;
  end loop;
end;
$$;

revoke all on function public.project_google_business_profile_record(
  uuid, uuid, uuid, text, text, uuid, text, text, jsonb, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.project_google_business_profile_record(
  uuid, uuid, uuid, text, text, uuid, text, text, jsonb, text, timestamptz, jsonb
) to service_role;
