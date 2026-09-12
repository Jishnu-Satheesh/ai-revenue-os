# ADR 0057: Approving a campaign proposal authorizes preparation; publication requires exact review of each finished output

## Status

**Proposed — 2026-09-12.** Not accepted. It records the user's confirmed product decision D05 in
`docs/superpowers/specs/2026-09-12-campaign-experience-design.md` section 3 and becomes binding when
the user accepts it together with
[Spec 025](../specs/025-campaign-experience-and-marketing-loop.md).

This ADR **supersedes, for the new Campaign path only, the unseen-variant publication allowance** in
ADR 0020 and its expression in Spec 016. It extends ADR 0017's approval contract in the same
direction ADR 0017 already points: approval binds an exact version and digest. It does not weaken
ADR 0017, ADR 0015 or ADR 0021.

## Context

ADR 0020 solved a real problem. ADR 0017 makes every creative, copy, hashtag, CTA and asset change
material, so applied literally to variant testing it would demand one human approval per image, which
no two-person agency can sustain. ADR 0020's escape was to approve an *envelope*: a bounded, expiring,
capped family of creative, locked to one promise — offer, claims, audience, placement, window and
ceiling — inside which a model could vary the *pitch* and publish without a further human look.

That trade was accepted while the platform was pre-production and nothing had ever been published.
Two things have changed.

- **The user has decided otherwise.** Decision D05 is confirmed: every finished post and ad,
  including every later variation, is reviewed by a human before publication. A generation cap may
  authorize preparation; it may never authorize unseen publication. This is a product decision, not
  an engineering preference, and it is not re-opened.
- **The audit found the envelope model was never safe to lean on in practice.** Finding F12 shows
  dispatch selecting `direction.assetIds[0]` — the first raw campaign asset — and signing that image,
  rather than the reviewed finished render. An envelope that authorizes unseen output is only as good
  as the binding between what was authorized and what is sent. That binding does not currently exist.
  Approving a family of things the human has not seen, and then selecting a member by a positional
  heuristic, is how a background photograph gets published in place of the flyer the client signed
  off. Finding F10 records the same conflict from the policy side.

The two things ADR 0020 correctly separated — the *promise* and the *pitch* — are still different
things. What changes is the conclusion drawn from that difference. Separating them justifies
**approving the promise once, early, so preparation can begin**. It does not justify publishing a
pitch nobody saw.

## Decision

### Two gates, never one

- **Gate 1 — preparation approval.** Approving a campaign proposal binds the exact proposal version
  and digest and authorizes *preparation only*: bounded creative generation within the approved
  generation cost ceiling, using approved references and pinned sources.
- **Gate 1 authorizes nothing external.** It reserves no media spend, publishes nothing, confirms no
  creative, grants no provider authority, and authorizes no later variation. This is a testable
  property, not a description.
- **Gate 2 — exact-output publication approval.** Publication requires human review of each finished
  output as it will actually appear — the real caption, hashtags, call to action, destination,
  account, placement, script, timezone-resolved schedule, budget ceiling and expiry — bound to that
  output's immutable version and content hash.
- Approval at Gate 2 attaches to one deliverable version and one content hash. It transfers to no
  other output, and a new version never inherits its parent's review.

### Variations

- **Every finished variation requires its own Gate 2 review.** A variation prepared later under a
  previously approved generation policy is unpublished creative until a human reviews that exact
  finished output. There is no unseen-variation publication mode in this path.
- A generation policy and its caps remain useful and remain enforced in the database. Their meaning
  is now a *preparation budget*, not a publication authority.
- Variants may still be prepared within approved cost caps. Dispatch of a variant requires its
  finished version to be reviewed and named in a launch approval.

### Binding

- A launch approval names the selected deliverable versions and their content hashes, together with
  every channel action term. Dispatch resolves the selected deliverable version directly and never by
  "first", "newest", "latest" or "currently selected" heuristics, and never by first account mapping.
- Any material change to a reviewed output — bytes, copy, free line, template version, font, brand
  mark, script, destination, schedule, budget or placement — invalidates the affected launch
  authority. It does not retroactively unapprove or delete an object already running at a provider;
  that object keeps its own approved historical identity.
- The review of a finished output and the terms of its launch may share one confirmation surface.
  That surface must state exactly what it permits, and the database transaction must still bind every
  required exact identity. The set reviewed and the set scheduled may never differ.

### Separate decisions that must not be conflated

- Publication approval, and **approval of a design as a reusable future reference** in Creative
  History, are different decisions in both directions. Neither implies the other, and neither may be
  set automatically as a side effect of the other.
- Preparation authority, exact creative approval, publishing authority, and spend authority are four
  distinct permissions. Manage permission is not launch or spend approval permission.

### Legacy

- **Existing approvals are not converted.** Campaigns, bundle versions, creative variants and
  approvals created under ADR 0020's envelope rules remain readable exactly as recorded, under the
  rules that were in force when they were made. Nothing is rewritten, migrated in place, or given new
  meaning retroactively.
- Legacy launch eligibility is explicit rather than implied. Where a legacy record could still reach
  dispatch, it does so under a named compatibility path or it fails closed.
- ADR 0020's note that "there is no `schemaVersion: 1` reader" and that pre-production bundles were
  repaired forward is a record of one past act while no execution history existed. It is **not a
  precedent**. No plan under this ADR deletes past data, and any future manifest version ships with a
  backward reader for the version it succeeds.

## Consequences

- The client sees, and is accountable for, everything that goes out in their name. That is what the
  user asked for, and it is the behavior a marketing agent must have before it can be trusted with a
  brand.
- Volume creative testing becomes slower per unit of published output. Preparation still parallelizes
  and still batches, and review can be done in batch with an explicit selection summary, but the
  human decision count now scales with published outputs rather than with approved envelopes. This is
  the accepted cost of D05.
- The Studio and review surfaces must make batch review genuinely fast — large real previews, the
  actual copy, per-output reasons, and a selection summary — or the cost above becomes a product
  failure rather than a governance feature.
- The most safety-critical component still needs no structural change: a reviewed deliverable enters
  execution through the same Tool Gateway action-run identity, with the same claim, budget
  reservation, idempotency, receipt and unknown-outcome machinery.
- A misbehaving generator can now produce neither a bad promise nor a bad published pitch, because the
  promise was approved and frozen and the pitch was seen before it was sent.
- The dispatch defect F12 becomes structurally unreachable rather than merely fixed, because there is
  no longer an approved-but-unseen set for a positional heuristic to pick from.

## References

- Supersedes in part: `adrs/0020-bounded-creative-family-approval.md`, `specs/016-campaign-feedback-loop.md`
- Extends: `adrs/0017-campaign-runtime-and-approval.md`, `adrs/0015-campaign-bundle-system-of-record.md`
- Related: `adrs/0019-campaign-measurement-and-learning.md`, `adrs/0021-two-speed-campaign-optimization.md`,
  `adrs/0049-creative-history-separates-blueprint-negative-evidence-from-final-generation.md`
- Implemented by: `specs/025-campaign-experience-and-marketing-loop.md`
- Evidence: `docs/verification/campaigns/2026-09-12-workflow-audit.md` findings F10 and F12
- Product decision: `docs/superpowers/specs/2026-09-12-campaign-experience-design.md` section 3, D05
