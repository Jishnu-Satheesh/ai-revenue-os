-- The Universal Agent worker already reads exact Market Profile identities and
-- immutable versions as service_role. Its confirmation guard must also read
-- the latest version-bound decision; RLS bypass does not supply SELECT rights.
-- Grant only the identifiers, deterministic ordering, decision and digest used
-- by that read. Private notes/actors and all writes remain source-RPC-owned.
grant select (
  id,
  organization_id,
  market_profile_id,
  market_profile_version_id,
  decision,
  profile_digest,
  created_at
) on table public.organization_market_profile_decisions to service_role;
