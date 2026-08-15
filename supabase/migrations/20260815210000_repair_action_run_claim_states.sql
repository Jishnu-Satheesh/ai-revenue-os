-- Repair: `campaign_action_runs` allowed a claim token only while the status
-- was exactly `claimed`, so the first thing a claimed worker does — moving to
-- `requested` as it calls the provider — violated the check.
--
-- The constraint was describing the wrong idea. A worker holds its claim for
-- the whole time the action is in flight, not only in the instant before it
-- acts. The token must be present through every in-flight status and absent
-- once the action reaches a resting state, which is what makes a lapsed worker
-- fenceable right up to the moment its call resolves.

alter table public.campaign_action_runs
  drop constraint campaign_action_runs_check;

alter table public.campaign_action_runs
  add constraint campaign_action_runs_claim_matches_status
  check (
    (claim_token is not null) = (status in ('claimed', 'requested', 'provider_pending'))
  );
