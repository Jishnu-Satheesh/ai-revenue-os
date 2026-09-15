# ADR 0059: A generated poster's logo is conditioning for the image model, not a composited file

## Status

**Accepted — 2026-09-15.** Decided by the user during the Brand Identity design, against the
recommendation made while drafting
[Spec 026](../specs/026-brand-identity.md). Records §18.1 of that spec.

It depends on
[ADR 0057](../adrs/0057-campaign-preparation-approval-vs-exact-output-publication.md) — the review
gate is what makes this decision safe — and it does not weaken
[ADR 0017](../adrs/0017-campaign-runtime-and-approval.md).

## Context

An organization now has a canonical logo: a pointer at a validated
`organization_brand_asset_versions` row, in `primary` and optional `dark` variants. Two places want
to put that mark on something, and they are not the same problem.

**Where the platform draws, it draws the file.** The organization switcher renders those exact bytes
through a session-signed URL. Nothing is approximated, because nothing needs to be.

**Where an image model draws, it cannot.** The poster templates declare a `logoSlot`. It is null on
all four seeded templates, and the seed migration says why:

> declaring a slot nothing draws would describe a capability this release does not have

So there were two ways to get a logo onto generated artwork.

**Composite the real file into `logoSlot`.** The mark would be exact, pixel for pixel, because the
renderer would paste it rather than draw it. This was the drafting recommendation.

**Supply the logo to the image model as a `brand_mark` conditioning reference.** The model is shown
the mark and asked to place it. What comes back resembles the logo and is not guaranteed to be it.

## Decision

The logo is supplied as a `brand_mark` conditioning reference. `logoSlot` stays null, and this spec
does not implement compositing.

The reasoning that carried it:

- The upload path **already** assigns the `brand_mark` conditioning role to a logo-role asset. The
  reference route uses machinery that exists; the compositing route needs a renderer capability that
  does not.
- `brand_mark_distorted` **already** exists as a review reason, with wording written for exactly
  this failure. The risk this decision accepts is one the review vocabulary was built to catch.
- ADR 0057 **already** requires a human to review each exact finished output before publication. The
  distortion risk is therefore caught by a gate that is mandatory regardless of this decision.

## Consequences

Accepted, explicitly:

- A generated logo is an **approximation**. Every poster needs its mark checked at review.
- **The platform may never describe a generated logo as exact, verified, or guaranteed.** Spec 026
  §9 and acceptance criterion 10 hold that line, and
  `src/components/assets/brand-guidelines-panel.test.tsx` asserts it.

Gained:

- `hardConstraints`, `softConventions` and `restrictedTerms` finally have a producer. They were read
  by `load_campaign_creation_facts`, rendered into the image prompt and checked by the content
  policy since generation was written, and nothing had ever written them — every campaign in every
  organization was generated against three empty arrays.

A rule that follows from this and must not be broken: **a mark the platform refuses to display is
never one it hands the image model.** `resolveDisplayLogo` in
`src/modules/brand/application/display-logo.ts` and the `canonicalLogoVersionId` subquery in
`supabase/migrations/20260915150000_brand_guidelines_into_campaign_facts.sql` implement the same
test — still in the library, unarchived, latest review not a rejection — in TypeScript and in SQL.
They must stay in step. If they drift, a logo a reviewer rejected could reach a generation request
while the interface reported it as removed.

A later decision to composite would **supersede** this ADR rather than extend it: the two routes
make different promises to a client about what they are approving.
