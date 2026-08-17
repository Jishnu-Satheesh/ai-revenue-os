-- Task 5 fix round 2. `20260813164330` added a partial UNIQUE index over every
-- active opportunity fingerprint. `20260813164825` then confined the admission
-- trigger to `campaign.meta_bundle_v1`, but the index kept enforcing Campaign's
-- admission rule across every playbook in the Decision Engine.
--
-- The generic contract in `specs/005` removes an already-active fingerprint in
-- Stage A screening and suppression, and reports the outcome through the
-- decision record. A database-wide unique constraint pre-empts that path and
-- surfaces a raw `23505` that no generic caller maps to a governed reason.
--
-- Campaign admission keeps its organization-serialized trigger checks, which
-- still raise `campaign_decision_active_duplicate` and
-- `campaign_decision_capacity_exhausted` under an advisory transaction lock.
-- The index remains as the lookup those checks and the feed read path need,
-- but it no longer decides admission for anyone.

drop index if exists public.opportunities_active_candidate_fingerprint_idx;

create index opportunities_active_candidate_fingerprint_idx
  on public.opportunities (organization_id, candidate_fingerprint)
  where status in ('proposed', 'awaiting_approval', 'approved');

comment on index public.opportunities_active_candidate_fingerprint_idx is
  'Lookup support for active-fingerprint checks. Deliberately non-unique: '
  'Campaign admission is enforced by private.enforce_active_opportunity_admission '
  'for campaign.meta_bundle_v1 only, and other playbooks screen duplicates in '
  'Stage A rather than failing the write.';
