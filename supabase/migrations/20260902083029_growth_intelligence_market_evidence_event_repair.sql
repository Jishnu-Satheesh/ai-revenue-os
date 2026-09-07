-- Correct the equivalent claim-ID variable collision in the append-only event
-- operation. Existing history stays intact; only future function execution is
-- repaired.
create or replace function public.append_market_evidence_claim_event(
  p_organization_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_event_type text,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.growth_intelligence_requests;
  claim_row public.market_evidence_claims;
  event_digest text;
  event_row public.market_evidence_claim_events;
  target_claim_id uuid;
begin
  if p_event_type not in ('expired', 'withdrawn', 'excluded', 'corrected', 'superseded')
    or not private.jsonb_object_has_exact_keys(p_event, array['claimId', 'reasonCode', 'occurredAt']::text[])
    or coalesce(p_event ->> 'claimId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_event ->> 'reasonCode', '') !~ '^[A-Z][A-Z0-9_]{2,80}$'
    or coalesce(p_event ->> 'occurredAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then
    raise exception 'market_evidence_claim_event_invalid' using errcode = '22023';
  end if;
  target_claim_id := (p_event ->> 'claimId')::uuid;
  request_row := private.assert_market_research_claim(p_organization_id, p_request_id, p_claim_token);
  select claim.* into claim_row
  from public.market_evidence_claims claim
  join public.market_research_runs run
    on run.organization_id = claim.organization_id
    and run.id = claim.market_research_run_id
  where claim.organization_id = p_organization_id
    and claim.id = target_claim_id
    and run.market_profile_version_id = request_row.market_profile_version_id
  for update of claim;
  if not found then
    raise exception 'market_evidence_claim_not_found' using errcode = '42501';
  end if;
  event_digest := pg_catalog.encode(
    extensions.digest(
      private.canonical_json_text(
        pg_catalog.jsonb_build_object(
          'claimId', target_claim_id,
          'eventType', p_event_type,
          'event', p_event
        )
      ),
      'sha256'
    ),
    'hex'
  );
  select event.* into event_row
  from public.market_evidence_claim_events event
  where event.organization_id = p_organization_id
    and event.market_evidence_claim_id = target_claim_id
    and event.event_digest = event_digest;
  if found then
    return pg_catalog.jsonb_build_object(
      'claimId', claim_row.id, 'eventId', event_row.id, 'replayed', true
    );
  end if;
  insert into public.market_evidence_claim_events (
    organization_id, market_evidence_claim_id, event_type, event_digest, reason, occurred_at
  ) values (
    p_organization_id, claim_row.id, p_event_type, event_digest,
    p_event ->> 'reasonCode', (p_event ->> 'occurredAt')::timestamptz
  ) returning * into event_row;
  return pg_catalog.jsonb_build_object(
    'claimId', claim_row.id, 'eventId', event_row.id, 'replayed', false
  );
end;
$$;

revoke all on function public.append_market_evidence_claim_event(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.append_market_evidence_claim_event(uuid, uuid, uuid, text, jsonb)
  to service_role;
