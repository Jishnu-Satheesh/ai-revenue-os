-- Repair: the opportunities member-read policy exists but the authenticated
-- SELECT grant was never issued, so every signed-in read (including the Growth
-- Intelligence workspace's opportunity feed) fails with permission denied and
-- the page reports "Decision data could not be loaded or saved."
-- Row scope stays with the existing "members can read opportunities" RLS policy.

grant select on table public.opportunities to authenticated;
