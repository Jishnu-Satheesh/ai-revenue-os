-- An operator may approve a campaign version.
--
-- This resolves a disagreement between two maps that decided the same question
-- and answered differently:
--
--   * `src/domain/campaigns/permissions.ts` grants `campaign.approve` to owner,
--     admin and operator, and `campaignRouteContext` reads it, so the approve
--     route has always admitted an operator.
--   * `public.approve_campaign_bundle` checks
--     `has_organization_role(..., array['owner','admin','operator'])`, so the
--     database has always allowed it too.
--   * This catalogue granted it to owner and admin only.
--
-- The catalogue was the odd one out, and it was the one nothing enforced: no
-- policy and no function looks `campaign.approve` up here, so the effective
-- behaviour was already "an operator can approve". This makes the record agree
-- with the behaviour rather than changing the behaviour.
--
-- Decided by the product owner on 2026-09-06. It is a policy call about who may
-- authorise spend and publication, not a typo -- which is why the divergence was
-- pinned by a test rather than quietly corrected in whichever file was open.
--
-- `campaign.publish`, `budget.modify` and `policy.update` are deliberately left
-- where they are. Approving the exact version that will run is a different act
-- from moving money or pushing to a public account, and the operator boundary
-- still sits between them.

-- Written as one tuple followed immediately by a columnless `on conflict`.
-- `permissions.drift.test.ts` reads these seed blocks as text, scanning forward
-- from the `values` keyword, so anything parenthesised after it -- a conflict
-- target list, or a comment containing brackets -- is read as another tuple.

insert into public.organization_role_permissions (organization_role, permission_key) values
  ('operator', 'campaign.approve')
on conflict do nothing;
