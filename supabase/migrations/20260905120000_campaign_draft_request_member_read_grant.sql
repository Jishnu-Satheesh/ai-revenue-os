-- Growth Intelligence Task 21 follow-up: the member read policy on
-- `campaign_draft_requests` shipped without its table grant, so an RLS policy
-- exists that no session can reach. Policies filter rows; only grants open
-- the table. Members with `campaign.create` read their organization's rows;
-- every write still passes through the fenced RPCs, which are unaffected.

grant select on table public.campaign_draft_requests to authenticated;
