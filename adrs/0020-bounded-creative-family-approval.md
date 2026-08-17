# ADR 0020: Bind approval to a bounded creative family rather than a single creative point

## Status

Accepted. This extends ADR 0017's approval contract. It does not weaken it.

## Context

Algorithmic creative testing needs many variants per day. Meta's delivery system needs volume to distinguish what resonates, and a system that ships one creative per human decision cannot supply that volume at any realistic operator cost.

ADR 0017 makes every creative, copy, hashtag, CTA, and asset change material: it creates a new version and invalidates approval. Applied literally to variant testing, that means one human approval per image, which makes the approach unusable.

The naive escape — letting the model publish creative the human never saw, under a general permission — is worse. It would put an unreviewed public claim in front of customers and make the approval record meaningless.

Both horns are avoidable, because the two things being conflated are not the same thing. Approving a campaign is approving a _promise_: an offer, a set of factual claims, an audience, a placement, a window, and a spend limit. Approving an image is approving a _pitch_: how that promise is phrased and shown. The second varies enormously without touching the first.

## Decision

- The Campaign Bundle manifest moves to `schemaVersion: 2` and gains a `generationPolicy`. The policy is part of the manifest, so it is inside the canonical digest and inside the approval binding. ADR 0017's rule is unchanged: approval binds one exact version and digest.
- The policy **locks the promise**: offer, factual assertions, audience, channel, placement, schedule window, total spend ceiling, generation profile, per-direction and total variant caps, and a policy expiry.
- A variant **may vary only the pitch**: imagery, hook, caption, hashtags, and call to action. It may vary nothing else.
- A Creative Variant is not a Campaign Bundle Version. It is an immutable child of one approved version, carrying its own content hash, its own provenance, and lineage to the direction and policy version that authorized it.
- Every variant passes the same deterministic evaluator as a generated bundle — unsourced claim, invented offer, invented metric, cross-tenant asset, currency mismatch, content policy — plus a derivation check proving it stays inside its policy.
- Variant caps and the policy window are enforced in the database, not in a prompt. A worker that requests a variant beyond the cap is refused, not trusted.
- One variant becomes one campaign action run. The Tool Gateway's claim, budget reservation, idempotency, receipt, and unknown-outcome machinery is reused unchanged; no new authorization path is introduced.
- Any change to the policy is material. It creates a new bundle version and invalidates the previous approval, exactly as any other material change does.
- Variants inherit but never widen. A variant cannot outlive its policy window, exceed its caps, raise a ceiling, add a placement, or introduce an assertion absent from the pinned source snapshot.
- There is no `schemaVersion: 1` reader. The platform is pre-production; existing development bundle versions are repaired forward by regenerating them through the V2 path.

## Consequences

- One human decision can authorize a bounded, expiring, capped family of creative instead of a single image, which makes volume testing possible without an unreviewed public claim.
- The reviewable question changes shape. An operator now reads and approves an envelope — "up to this many variants, until this date, within this offer and these claims, under this ceiling" — and the Studio must present that envelope as clearly as it currently presents a single proposal.
- The most safety-critical component in the system requires no structural change, because a variant enters execution through the same action-run identity a single action already used.
- A misbehaving generator can produce a bad _pitch_. It cannot produce a bad _promise_, because the promise was approved and is immutable.
- Variant volume grows storage and evaluation cost roughly linearly with the cap, which is why the cap is a hard database constraint rather than a guideline.
- Regenerating pre-production bundles discards one demo version chain. That is acceptable only while no execution history exists, and this ADR is the record that it did not.

## References

- `adrs/0015-campaign-bundle-system-of-record.md`
- `adrs/0017-campaign-runtime-and-approval.md`
- `adrs/0019-campaign-measurement-and-learning.md`
- `adrs/0021-two-speed-campaign-optimization.md`
- `specs/016-campaign-feedback-loop.md`
