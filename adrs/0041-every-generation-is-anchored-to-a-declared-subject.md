# ADR 0041: Every generation is anchored to a declared subject

## Status

Accepted in part. Implements the declared-subject portion of
`specs/019-organization-asset-library.md`. Extends ADR 0020's bounded creative family with a rule
about what the creative may depict, and is a prerequisite for the Campaign Creative Studio.

ADR 0049 supersedes this ADR's former rejected-image routing only. It retains this ADR's
declared-subject, deterministic-resolution, truth-class and no-generated-text decisions.

## Context

Four campaign assets were examined on 2026-08-24. A restaurant selling butter chicken, Hyderabadi
dum biryani, Kerala fish curry and chicken 65 in Dubai had been given: a French gastropub duck
breast, an illustrated mezze carrying the misspelled words *"Explore Our Mezza"* over ornamental
glyphs standing in for Arabic, a painted table of disembodied hands, and a photoreal roast chicken
surrounded by nine invented smiling faces and glasses reading as red wine.

Not one was the right cuisine. One placed fabricated customers and alcohol-coded drinks on a
restaurant's own feed.

The governing rules at the time were followed. ADR 0017 bound approval to an exact version. ADR 0020
locked the promise — offer, claims, audience, placement, window, ceiling. `AGENTS.md` required
schema validation at the model boundary, and it was applied. Every one of those held while the
platform drew the wrong food, because **none of them said anything about what the picture had to be
of.**

Four mechanisms were involved, all verifiable in the tree:

- `brand_asset_version_ids` is carried from the brief through `campaign_source_snapshots` and into
  the generation context, and `campaign-planner.ts` never reads it. `CampaignImageGenerationInput`
  is `{ prompt, widthPx, heightPx }` and has nowhere to put an image.
- The image prompt is the accessibility description. `campaign-planner.ts:389` passes
  `subject: asset.altText` — a screen-reader caption — as the drawing instruction.
- `truth_class` is written by the model. `campaign-planner.ts:106` asks the generator to declare
  whether its own output is authentic.
- `syntheticAssetsAllowed` was read as permission to invent the subject, rather than as a preference
  about backgrounds.

An earlier draft of spec 019 proposed the obvious fix: refuse unless the client has a photograph of
the dish. That was rejected during review, and correctly. Restaurants do not have a good photograph
of every dish, most never will, and a platform that refuses to work without one is a platform that
refuses to work. The refusal also misread the evidence — synthesis did not produce the duck breast.
An empty brief did. Campaign `783ab4e1` reached the model with no references, no named dish and
`offer: null`.

## Decision

### A generation is anchored to a declared subject, or it does not happen

Resolution returns exactly one of three outcomes, decided by what the organization has and never by
what the model would prefer:

| Outcome | Condition | Result |
|---|---|---|
| `resolved` | A reference photograph matches the subject | Drawn from the client's photograph |
| `synthesis_permitted` | No photograph, but a confirmed written description | Drawn from that description |
| `insufficient` | Neither | Refused with `no_declared_subject` |

Only the third refuses. A missing photograph is ordinary and is drawn around. What is never
permitted again is a model choosing the subject for itself, which is the single condition that
produced everything on file.

The description is a first-class stored object — a subject profile — drafted by a model, confirmed
by a human, and reused by every later campaign about that dish. An unconfirmed draft cannot produce
a generation, because an unreviewed description of a dish the restaurant may not sell is the same
failure with an extra step.

### Rejected creative is Blueprint-only evidence, with a structural final-provider fence

This section's former decision permitted rejected image bytes in a final-generation `avoid` slot.
That route is superseded by ADR 0049. The correction retains the useful finding: a human reason is
more intelligible when the Blueprint can inspect the rejected design that caused it. It changes
where that inspection ends.

- Approved Creative History bytes may reach Blueprint and final image generation.
- Rejected Creative History bytes may reach Blueprint only, with their human reason codes.
- Blueprint emits validated, cited negative rules. The final image prompt receives those rules and
  human reasons as text, never rejected design bytes.
- The final provider has no rejected-design input variant. Type validation and adapter tests make
  the prohibited route impossible rather than merely discouraged.

Mandatory human reason codes remain load-bearing. They explain every rejection to the Blueprint and
support each rule that travels forward, but a model cannot choose a verdict or turn an uncited reason
into final image instruction.

### A reasoning model writes the art direction before the image model draws

A generation runs in two stages. A reasoning model receives the system prompt, operator direction,
brand and subject context, Approved Creative History evidence and Rejected Creative History
Blueprint evidence. It produces a **structured blueprint**: composition, lighting, camera treatment,
palette, focal point and cited negative rules. The image model then draws from the blueprint with
declared-subject/brand grounding and Approved Creative History evidence only.

This is adopted on the same basis as the rule above: it is what the user's production studio does,
and it outperformed every flatter architecture they tried. The platform's own requirements are met
by two structural choices rather than by trusting the stage:

- The blueprint is a **Zod-parsed structured object, not prose**, so it is validated at the boundary
  like every other model output, and so it can be shown to an operator as the reason an image looks
  the way it does.
- The blueprint schema has **no field for the subject and no field for text**. The subject is
  injected deterministically after parsing, and text is composited later by
  `specs/020-campaign-creative-studio.md`. A stage that cannot express a subject cannot change one,
  which is a stronger guarantee than instructing it not to.

The `plan` slot already exists in `createModelRouter` alongside `text`, `patch`, `repair` and
`image`, with a `CAMPAIGN_PLAN_MODEL` environment variable. This decision gives that slot its first
real use rather than introducing a new one.

### Truth class is derived, never declared

`campaign_assets.truth_class` becomes a deterministic function of the resolution outcome —
`authentic_source` for the client's own photograph used directly, `synthetic_composite` for model
output conditioned on it, `synthetic_generated` for model output from a description. The model stops
being asked, and the manifest schema stops carrying the field.

A generator asserting that its own output is authentic was never a check.

### Selection is deterministic and no model participates

Which of a client's photographs represents their business, which Creative History designs are
eligible and in what order, under what caps, and whether to refuse — all deterministic code,
versioned like a detector. Blueprint may interpret selected rejection evidence into a validated
rule, but cannot select identifiers or silently reinterpret sets already pinned.

### No script is rendered inside a generated image

Image models draw letterforms as shapes. They misspell Latin and produce ornamental nonsense for
Arabic; Malayalam, with its conjuncts and reordering vowel signs, is worse. The pilot client needs
all three.

The existing prohibition on rendered text in `model-router.ts:245` therefore stays, and gains a
second and stronger reason than the one it was written for. Correct multilingual text arrives by
compositing real fonts, which makes the Creative Studio a prerequisite for the language requirement
rather than an enhancement.

Typography references declare which scripts they teach, because a Latin type sample teaches nothing
about Malayalam.

## Consequences

Generated creative depicts the client's actual business, and the platform says plainly which of
three ways each image was made. The reference plumbing that already runs the length of the pipeline
gets its last connection fitted rather than being rebuilt.

Human review compounds. A rejection today informs future Blueprints through attributable human
reasons and validated rules, without exposing its image bytes to final generation. That is auditable
in a way a fine-tuned preference would not be.

The cost is a new obligation on the client: somebody must say what the restaurant sells. Four dishes
are named in Business Memory and a menu has dozens. The platform mitigates this by drafting
descriptions and reusing them forever, but the confirmation is human and cannot be automated away
without recreating the problem.

A second cost is that subject profiles are a menu-shaped table that is not a menu. There is no menu
data — no tables, `menu_item` registered with zero rows, spec 009 unimplemented — and this is an
interim stand-in carrying no price, availability, modifier or economics. When menu intelligence
arrives, subject profiles should be reconciled with it rather than left as a parallel truth.

The risk accepted is that a drawing of a dish is not a photograph of that dish, and a client could
present one as the other. Truth class is shown wherever an asset is shown, in plain words, which is
a disclosure rather than a prevention. Preventing it would mean refusing to draw, and that is the
decision this ADR declines to make.
