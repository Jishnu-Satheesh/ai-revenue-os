# ADR 0058: Repairing an organization's evidence pins a new campaign snapshot rather than rewriting the old one

## Status

**Accepted — 2026-09-14.** Approved by the user as part of the campaign readiness repair work.

It does not weaken ADR 0017's approval contract, and it does not change what generation is allowed
to read. It names how a campaign moves between pins, which was previously undefined.

## Context

A campaign pins the evidence it may be generated from at creation, in
`campaign_source_snapshots`, and generation reads only that pin. The original migration says why:

> The evidence generation is allowed to use, pinned now. Read live later, an approval would stop
> being explicable the moment the brand voice changed.

That is right, and it stays. But the platform had no answer to the situation it creates. When
generation fails for want of evidence it names each gap — `brand_voice`, `primary_metric`,
`baseline_source` — and an operator goes and supplies them. Pressing "Generate again" then produces
the identical failure, because the run is still reading a snapshot taken before the repair.

There was no supported way out. `decideGenerationRetry` already treats a different
`sourceSnapshotId` as a genuinely different question and lets such a retry through, so the retry
path was built expecting campaigns to move between snapshots — but nothing could ever move one.
The only real remedy was to delete the campaign and create it again, losing its history.

Three options were considered.

**Read live at generation time.** Removes the problem by removing the pin. Rejected: it is exactly
what the pin exists to prevent, and it would make an approval unexplainable the moment anything
underneath it changed.

**Rewrite the campaign's snapshot in place.** Simple, and it keeps one snapshot per campaign.
Rejected: an existing bundle version references the snapshot it was built from, and editing that
row rewrites the explanation of a decision that has already been made. An audit record that changes
under a reader is worse than no audit record, because it is trusted.

**Pin a new snapshot alongside the old one.** Chosen.

## Decision

Repairing an organization's evidence for a waiting campaign pins a **new** source snapshot and
leaves every existing one untouched.

1. `refresh_campaign_source_snapshot` inserts. It never updates or deletes a snapshot.
2. It pins nothing when the organization's current verified facts and usable brand asset versions
   are identical to the newest snapshot's, returning that snapshot instead. A new id on every call
   would make `decideGenerationRetry`'s "prerequisite changed" branch always true, and the guard
   that stops an operator paying for a run which must fail identically would never fire again.
3. Generation reads the **newest** snapshot, ordered by `captured_at` then `id`. Before this a
   campaign had exactly one and the ordering was unstated; with more than one, "whichever row the
   planner returned" would decide what a campaign is built from.
4. Assertions are carried forward from the previous snapshot rather than recomputed. They come from
   the decision that opened the campaign; repairing a brand voice does not revisit it, and dropping
   them would widen what the campaign may claim.
5. The function requires `campaign.edit`, the same permission as every other act that changes what a
   campaign will be built from. A campaign in another organization is reported as not found, never
   as refused.

## Consequences

A campaign can now be moved onto corrected evidence without being recreated, and the repair is
visible: two snapshots, both readable, with `captured_at` saying which came first.

Every bundle version keeps pointing at the exact snapshot it was generated from, so an approval
granted last week is still explained by the evidence that was actually in front of the model, not by
whatever the organization looks like today. That is the property this ADR exists to preserve, and it
is preserved by addition rather than by refusing to move.

Snapshots accumulate — one per genuine change in an organization's facts, per campaign. That is
intended and is the record. No retention rule is set here: inventing one would be an operating limit
nobody has configured.

An operator can still pin evidence that is *also* insufficient — supplying a brand voice while
leaving the baseline unknown pins a new snapshot that still reports `baseline_source` missing. That
is correct and is reported as such. The repair surface says so before the write rather than
discovering it on the next failed run.
