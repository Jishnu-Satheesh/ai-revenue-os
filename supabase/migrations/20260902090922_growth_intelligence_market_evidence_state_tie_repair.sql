-- `now()` is transaction-stable, so creation and a same-transaction terminal
-- event can share an occurrence timestamp. A terminal event must win that
-- tie; the initial observed marker is only the claim baseline.

create or replace function public.market_evidence_claim_current_state(
  p_organization_id uuid,
  p_market_evidence_claim_id uuid
)
returns text
language sql
stable
set search_path = ''
as $$
  with latest_event as (
    select event.event_type
    from public.market_evidence_claim_events event
    where event.organization_id = p_organization_id
      and event.market_evidence_claim_id = p_market_evidence_claim_id
      and event.occurred_at <= pg_catalog.now()
    order by
      event.occurred_at desc,
      (event.event_type <> 'observed') desc,
      event.created_at desc,
      event.id desc
    limit 1
  )
  select case
    when not exists (
      select 1 from public.market_evidence_claims claim
      where claim.organization_id = p_organization_id and claim.id = p_market_evidence_claim_id
    ) then null
    when (select event_type from latest_event) in ('withdrawn', 'excluded', 'corrected', 'superseded')
      then case when (select event_type from latest_event) = 'corrected' then 'superseded'
        else (select event_type from latest_event) end
    when (select event_type from latest_event) = 'expired'
      or exists (
        select 1 from public.market_evidence_claims claim
        where claim.organization_id = p_organization_id
          and claim.id = p_market_evidence_claim_id
          and claim.expires_at <= pg_catalog.now()
      ) then 'expired'
    when exists (
      select 1 from public.market_evidence_claims claim
      where claim.organization_id = p_organization_id
        and claim.id = p_market_evidence_claim_id
        and claim.stale_at <= pg_catalog.now()
    ) then 'stale'
    else 'current'
  end;
$$;

revoke all on function public.market_evidence_claim_current_state(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.market_evidence_claim_current_state(uuid, uuid)
  to authenticated;
