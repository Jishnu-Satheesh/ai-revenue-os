# ADR 0049: Creative History separates Blueprint negative evidence from final generation

## Status

Accepted. User-approved on 2026-09-09 with Campaign Progress CP1.

This reverses only ADR 0041's rejected-image routing. It retains ADR 0041's
declared-subject requirement, deterministic grounding resolution, derived truth
class, and prohibition on generated text. It is implemented by the forward-only
Creative History correction design at
`docs/superpowers/specs/2026-08-26-creative-history-asset-library-correction-design.md`.

## Context

The Asset Library was implemented as a set of generation ingredients: a subject
photograph, a logo, a palette, a typography sample, or a setting. That is useful
grounding infrastructure, but it is not the visual-history product an operator
expects when they open an asset library full of their past posters, flyers and
social designs.

The previous wording in ADR 0041 also let a rejected design travel with its
human reasons in an `avoid` image role to the final image provider. It had a
bounded slot and clear instructions, but it still placed the rejected file's
bytes at the final provider boundary. A role label and prompt convention do not
make that boundary safe enough: a rejected design must not be an ingredient in
the model call that creates the next final image.

At the same time, the review is valuable. A rejected design can show a Blueprint
model what a reviewer meant by `wrong_style`, `not_our_plating`, or
`text_unreadable` far more precisely than a bare code. The safe correction is
to retain that evidence only in the reasoning stage, then pass forward a
validated, attributable summary rather than the rejected file.

## Decision

### One page, three purposes, separate records

The Asset Library is one organization-scoped page with exactly three tabs:

| Tab | Holds | May establish |
| --- | --- | --- |
| Creative History | Finished posters, flyers, social designs, banners and other delivered creative | Approved or rejected visual-history evidence after human review |
| Products & Subjects | Product photographs and human-confirmed descriptions | What the campaign may depict under ADR 0041 |
| Brand Kit | Logos, palette, type and reusable identity material | Brand identity constraints |

These are separate domain records, storage paths, permissions, selectors and
receipts. A folder may contain approved, rejected and unreviewed Creative
History items together; a verdict belongs to a design version, never to a
folder. A finished Studio poster may be linked into Creative History as
`unreviewed`; a raw plate never enters it merely because it exists.

### The two evidence paths are deliberately different

The non-negotiable evidence contract is:

```text
approved creative bytes -> Blueprint and final image generation
rejected creative bytes -> Blueprint only
validated Blueprint rules + human reasons -> final image prompt
rejected creative bytes -> impossible final-image input
```

The selector is deterministic, versioned and runs before model spending. It
pins two independently selected sets on the generation receipt:

- At most three relevant, human-approved Creative History designs may reach
  Blueprint and final image generation as positive historical evidence.
- At most five relevant, human-rejected Creative History designs may reach the
  Blueprint. Each carries its append-only review and human reason codes.
- Unreviewed designs and unconfirmed metadata reach neither path. Weak matches
  are recorded as exclusions rather than used to fill a quota.

The Blueprint may produce at most twelve structured negative rules. Every rule
must cite its supporting rejected design version and the human reason that made
it relevant. Schema validation rejects an uncited, malformed or over-cap rule.
The final prompt may receive those validated rules and human reasons as text;
it never receives rejected creative bytes, storage identities, image parts or a
type variant from which those bytes could be loaded.

The final image-provider port therefore accepts a different, narrower input
type from the Blueprint port. Its union can contain declared-subject grounding,
Brand Kit evidence and approved Creative History evidence, but has no
`rejected_creative` or legacy `avoid` member. Runtime validation and an
integration test prove the same property at the adapter boundary. This is a
structural fence, not an instruction to a provider.

### Human review remains the authority

A model may propose descriptive metadata or interpret selected rejection
evidence into a Blueprint observation. A human confirms metadata and is the
only actor that sets an approved or rejected verdict. Rejection requires one or
more registered human reason codes. Existing campaign text, offers, prices,
calls to action and logos from a historical design are not requested from an
image model; the current approved campaign text is composed by Creative Studio.

### The cutover is forward-only

No existing row, file, review or run receipt is rewritten. Legacy
`avoid_reference_version_ids` and equivalent receipt fields remain readable as
historical evidence, are explicitly deprecated, and are never written by the
corrected path. Existing subject profiles, Brand Kit records and campaign
assets continue to serve their existing grounding and identity roles.

The new Creative History tables, private storage and pinned generation receipts
are additive. Old implementation paths are feature-gated away only after the
new schema, selector, provider boundary, browser flow and staging proof pass.
Rollback is a code/configuration reversal that leaves additive records and
receipts readable; it never rewrites a past run to claim it used different
evidence.

## Consequences

The product gains a legible visual memory without collapsing subject truth,
brand identity and historical creative into one overloaded asset record. A
reviewer can see why a design is eligible, why a rejected design informed a
Blueprint, and exactly which approved designs were supplied to final generation.

The generation path costs a separate Blueprint interpretation step, but it
removes the unsafe shared-reference-set shortcut. A future provider integration
cannot accidentally restore rejected-image routing without changing the final
provider type, validation and integration tests.

Migration and application work must preserve tenant isolation, append-only
versions and reviews, private object paths, pinned receipts, human reason
attribution, and the caps declared here. The Campaign Creative Studio owns its
poster/render lineage and links a completed render to Creative History only as
an unreviewed candidate for later human review.
