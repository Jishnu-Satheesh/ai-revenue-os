-- The worker derives the research question once, under a live claim (C03).
--
-- Loading serves the admitted context and any staged question; the worker then
-- plans the real question from the evidence and saves it back onto the run.
-- That save is a worker write like any other: it proves a live claim — the
-- run in this organization, still `claimed`, with a matching token and an
-- unexpired lease — or it is refused as a lost claim.
--
-- The save happens at most once. A second save under a live claim is not an
-- error and rewrites nothing; it reports `already_set` so a retried worker
-- learns the question is already there. Validation runs before the claim
-- check, so a malformed save is refused as invalid even when the claim is
-- also gone.
--
-- The event carries identifiers only: the run and the derivation
-- (`source_ids`, `model_id`, `derived_at`). The question itself lives on the
-- run row; it is not duplicated into the event payload.

alter table public.campaign_research_events
  drop constraint campaign_research_events_event_check,
  add constraint campaign_research_events_event_check check (
    event in (
      'campaign.proposal_requested',
      'campaign.proposal_prepared',
      'campaign.research_claimed',
      'campaign.research_failed',
      'campaign.research_cancelled',
      'campaign.research_lease_reclaimed',
      'campaign.research_lease_abandoned',
      'campaign.research_question_derived'
    )
  );

-- Saves the worker-derived question onto its claimed run, exactly once.
create or replace function public.save_derived_campaign_research_question(
  target_organization_id uuid,
  input_save jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_claim_token uuid;
  v_question text;
  v_derivation jsonb;
  v_run public.campaign_research_runs;
begin
  v_run_id := nullif(input_save ->> 'run_id', '')::uuid;
  v_claim_token := nullif(input_save ->> 'claim_token', '')::uuid;
  v_question := input_save ->> 'derived_question';
  v_derivation := input_save -> 'derivation';

  if v_question is null or char_length(v_question) not between 1 and 2000 then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;
  if v_derivation is null
    or jsonb_typeof(v_derivation) <> 'object'
    or jsonb_typeof(v_derivation -> 'source_ids') <> 'array' then
    raise exception 'campaign_research_invalid' using errcode = '22023';
  end if;

  select * into v_run
  from public.campaign_research_runs run
  where run.organization_id = target_organization_id
    and run.id = v_run_id
    and run.status = 'claimed'
    and run.claim_token = v_claim_token
    and run.lease_expires_at > now()
  for update;

  if not found then
    raise exception 'campaign_research_claim_lost' using errcode = 'P0002';
  end if;

  if v_run.research_question is not null then
    return jsonb_build_object('run_id', v_run.id, 'outcome', 'already_set');
  end if;

  update public.campaign_research_runs run
  set research_question = v_question
  where run.organization_id = target_organization_id
    and run.id = v_run.id;

  insert into public.campaign_research_events (organization_id, run_id, event, payload)
  values (
    target_organization_id, v_run.id, 'campaign.research_question_derived',
    jsonb_build_object(
      'run_id', v_run.id,
      'derivation', v_derivation
    )
  );

  return jsonb_build_object('run_id', v_run.id, 'outcome', 'saved');
end;
$$;

-- Worker only: the EXECUTE grant is the gate, matching the other worker
-- functions, which take no in-function role check because a worker connecting
-- as service_role sets no JWT claim. Tenancy holds because every run lookup
-- repeats the organization id alongside the live-claim predicates.
revoke all on function public.save_derived_campaign_research_question(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_derived_campaign_research_question(uuid, jsonb) to service_role;
