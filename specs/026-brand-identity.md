# Feature Specification: Brand Identity — the canonical logo and structured brand guidelines

## Status

**Approved — 2026-09-15.** Tier 3. Approved by the user; implementation plan to follow.

Scope decided with the user on 2026-09-15: the canonical logo and structured guidelines first; the
imagery library and approved/rejected intake follow in a separate spec. Three product decisions were
taken and are recorded in §18.

Extends [Spec 019](019-organization-asset-library.md) (Organization Asset Library) and
[Spec 020](020-campaign-creative-studio.md) (Campaign Creative Studio). It does not weaken
[ADR 0017](../adrs/0017-campaign-runtime-and-approval.md) or
[ADR 0057](../adrs/0057-campaign-preparation-approval-vs-exact-output-publication.md); it depends on
0057's review gate, which is what makes the logo decision in §18.1 safe.

## Business outcome

Creative that a client can put their name on without redrawing it.

Today an organization can upload a logo and it reaches nothing: the platform shows a generic mark,
and generated posters carry no brand identity at all. Every rule the business has about how it may
be presented — its colours, the things it never says, the things it never shows — exists only in
somebody's head, and is re-explained at every review.

This feature makes those rules data the platform holds and acts on. The measurable outcome is fewer
review rejections for brand reasons, and it is measurable because the rejection reasons already
exist: `brand_mark_distorted`, `off_palette`, `prohibited_content`, `text_incorrect`. A brand whose
rules the platform holds should be rejected for those reasons less often than one whose rules it
does not.

No claim is made here about revenue. This reduces rework and protects a client's brand; it is not
represented as earning anything.

## User stories

- As an owner, I upload my logo once and see it used as my organization's mark everywhere in the
  platform, so the product looks like mine rather than like a template.
- As an owner, I record my colour palette, my do's and my don'ts during onboarding, so I am not
  re-explaining them at every campaign review.
- As an owner, I mark a rule as absolute or as a preference, so "never show alcohol" and "we usually
  lead with the food" are not treated as the same kind of statement.
- As an operator, generated creative already follows the brand's rules when I first see it, so
  review is about whether the work is good rather than whether it is allowed.
- As an operator, when a generated poster gets the logo wrong I can say so with the reason that
  already exists, and that rejection steers the next attempt.
- As an auditor, I can see what the brand's rules were on the day a campaign was approved, not only
  what they are now.

## Scope

### In scope

- A canonical organization logo, selected from validated brand asset versions, with named variants
  (`primary`, `dark`).
- Displaying that logo across the platform UI, exactly, from the stored file.
- Supplying it to image generation as a `brand_mark` conditioning reference.
- Structured brand guidelines: colour palette, rules marked hard or soft, restricted terms.
- Collecting all of the above in `/onboarding`, and editing them in a new Asset Library tab.
- Promoting them into the generation context so they reach the prompt and the policy checks.
- Pinning them into a campaign's source snapshot, so an approval stays explicable.

### Out of scope

- The imagery library reorganisation and approved/rejected-at-upload intake. Separate spec.
- Deterministic compositing of the logo into `logoSlot`. See §18.1; the slot stays `null` and this
  spec does not implement it.
- Typography as a governed rule. Fonts are pinned by the compositor for script coverage and are not
  an operator choice today.
- Brand guidelines as an uploaded document. Superseded by structured fields; see §18.3.
- Per-branch or per-channel brand variation. One identity per organization.
- Any change to what `full_visual_freedom` permits.

## UX flow

**Onboarding.** The existing `brand_assets` section grows from four fields to a short sequence:
voice and languages as today; then the logo, with an upload control and a variant label; then the
palette; then rules. Every field is optional except the ones the section already required — a brand
that has no written don'ts must be able to finish onboarding, and the campaign-readiness surface
already names what is missing when it matters.

**Asset Library.** A new tab, **Brand Guidelines**, beside the existing three. It shows the
canonical logo and its variants, the palette, and the rules grouped into absolute and preferred. It
is the edit surface after onboarding; the onboarding section and this tab write the same record and
must never disagree.

**Review.** Where a generation departs from a soft convention, the existing disclosure already names
which one. Nothing new is added to review by this spec.

## Domain rules

1. **A canonical logo is a selection, not a second upload path.** It points at an
   `organization_brand_asset_versions` row, so the logo goes through the same intake every other
   image does: sniffed by its leading bytes, decoded, re-encoded server-side, hashed. The platform
   never displays or transmits logo bytes it did not produce.
2. **One canonical logo per organization, with at most one version per variant.** A variant is
   `primary` or `dark`. `dark` is optional and means "for use on dark ground"; when it is absent the
   platform uses `primary` everywhere rather than recolouring it.
3. **A logo variant must point at a usable, non-rejected version.** If the version it names is later
   rejected, the selection is reported as broken rather than silently falling back — a brand mark
   somebody rejected must not keep being used because a pointer still resolves.
4. **A rule is hard or soft, and the author chooses which.** Hard means the creative may not
   contradict it, under every generation profile. Soft means it describes the brand's habit and may
   be stretched where the profile allows, with the departure disclosed.
5. **A hard rule is never inferred.** Nothing in this feature promotes a soft rule to hard, or
   guesses a rule's strength from its wording. An unmarked rule is not stored.
6. **A restricted term is a word, not a sentence.** Restricted terms are matched literally by the
   existing policy check; a paragraph entered as a restricted term would either never match or match
   everything, so length is bounded and the field says what it is for.
7. **The palette is exact where the platform draws and advisory where a model draws.** Colours are
   stored as hex. Anything the compositor renders may use them exactly. An image model is told the
   palette and may still drift, which is what `off_palette` exists to catch. The platform must never
   present model output as palette-guaranteed.
8. **Guidelines are pinned like every other fact.** They enter a campaign through the source
   snapshot, not by live read, so an approval granted last week is still explained by the rules that
   were actually in force. Repair follows
   [ADR 0058](../adrs/0058-repaired-evidence-pins-a-new-campaign-snapshot.md).
9. **Absence is named, never defaulted.** An organization with no palette has no palette; generation
   reports it as missing evidence if it needs one. No brand colour is invented, and no stock palette
   is substituted.

## Data model

New table `public.organization_brand_guidelines`, one row per organization, holding the palette and
the rule lists as validated JSON; and `public.organization_brand_logos`, one row per organization
and variant, pointing at a brand asset version.

Both are organization-scoped with composite tenant foreign keys, forced RLS, and an audit trigger.
The audit trigger is the reason these are tables rather than more keys inside
`business_profiles.brand_context`: a brand's don'ts constrain what may be published in a client's
name, and "who changed this, and when" has to be answerable. `brand_context` keeps `voice`, which is
descriptive rather than constraining.

Shape, validated in Postgres by a pure JSON validator mirroring the Zod schema key for key, in the
same style as the Growth Intelligence validators:

- `palette`: an object of named colours — `primary`, `secondary`, `tertiary`, each an optional
  `#rrggbb`. Absent is absent.
- `rules`: an array of `{ text, strength }` where `strength` is `hard` or `soft`. Bounded length per
  rule and per array; the bounds are stated in the migration and are storage limits, not operating
  limits.
- `restricted_terms`: an array of short terms.

`load_campaign_creation_facts` is extended to read them, populating the `hardConstraints`,
`softConventions` and `restrictedTerms` keys it already returns and which
`buildGenerationContext` already consumes — today they are read from `brand_context` and nothing has
ever written them. A new `palette` fact is added to the generation context schema.

## API and events

- `PUT /api/organizations/[organizationId]/brand/guidelines` — replaces the guidelines record.
  `brand.manage` (new permission; see Security).
- `PUT /api/organizations/[organizationId]/brand/logo` — sets a variant's version pointer.
- `GET` for both, so the Asset Library tab and the onboarding section read the same record.
- The onboarding `brand_assets` section promotes through `persistCanonicalSection`, alongside the
  voice promotion added on 2026-09-14.

Events, past tense and stable: `brand.guidelines_updated`, `brand.logo_set`. Both carry
`organizationId` and the actor; neither carries rule text, because audit events are read in contexts
where a client's unpublished brand rules do not belong.

## AI behavior

The logo is supplied to image generation as a conditioning reference with role `brand_mark`, which
is the role the upload path already assigns to a logo-role asset. The model is instructed not to
redraw, recolour or re-space it — wording that already exists as the `brand_mark_distorted` review
reason.

**The output is not guaranteed to carry an exact logo, and the platform must not say it does.** A
conditioned brand mark is an approximation. This is acceptable only because every finished output is
reviewed against ADR 0057 before publication, and because `brand_mark_distorted` gives the reviewer
a specific rejection that feeds the next attempt. Any surface that shows a generated poster must not
label its logo as verified.

Hard rules enter the prompt as `<organization_hard_constraints>`, which `reference-prompt.ts`
already renders, and are checked after generation by the content policy rather than trusted from the
prompt. Soft rules enter as `<soft_conventions>` and participate in the existing
`softConventionDepartures` disclosure, so `brand_restricted` forbids any departure and
`brand_guided` allows one only in the experimental direction, exactly as today.

All guideline text is fenced and labelled as data in the prompt, like every other operator-supplied
string. A brand rule is text a person wrote and may contain something shaped like an instruction.

## Security and tenancy

- New permission `brand.manage`, seeded in the permission catalogue **and** mirrored in
  `src/domain/access/permissions.ts` in the same change. The mirror and the migration have already
  drifted once, for `campaign.research_request`, and that drift is still open.
- Reads require membership; writes require `brand.manage`. Owner and admin hold it by default.
- Every read and write in a request path uses the caller's session. No service role.
- A logo version pointer is validated to belong to the same organization, in the database, not only
  in the application. A pointer is a foreign key with the tenant in it.
- Guideline text is never logged, and never appears in an error message returned to a client.
- Signed preview URLs for logo bytes are minted from the caller's session and expire, as the Asset
  Library already does.

## Observability

- Structured logs with `organizationId` and `correlationId` on both writes.
- The generation context records whether a palette and guidelines were present, so a run can be read
  later as "the brand had no palette" rather than "the model ignored it".
- Counts of review rejections by reason, already recorded, are the measurement for the business
  outcome above.

## Failure states

- **No logo set.** The platform shows its own mark. Never a placeholder that looks like a brand.
- **Logo variant points at a rejected or unusable version.** Reported as broken on the Brand
  Guidelines tab with the reason, and excluded from generation. No silent fallback.
- **Palette absent.** Generation proceeds; `off_palette` cannot be assessed and review says so
  rather than implying the palette was honoured.
- **Guidelines absent.** Generation proceeds on the brand voice alone, as it does today.
- **A hard rule the model cannot satisfy.** The content policy refuses the direction with the rule
  named. The refusal says which rule, because "generation failed" without the rule is the failure
  mode this platform has already had to fix once.
- **Storage read fails for a logo.** The UI shows no logo rather than a broken image, and generation
  proceeds without the brand mark rather than with an unreadable one.

## Acceptance criteria

1. An owner can upload a logo in onboarding, mark it `primary`, and see it as the organization's
   mark in the platform header on the next load.
2. A `dark` variant, when set, is used on dark ground; when unset, `primary` is used and nothing is
   recoloured.
3. A logo variant pointing at a version that is later rejected is reported as broken and is not sent
   to generation.
4. Palette, rules and restricted terms entered in onboarding are readable on the Brand Guidelines
   tab, and an edit there is readable back in onboarding.
5. A hard rule appears in `<organization_hard_constraints>` in the rendered prompt, and a direction
   contradicting it is refused by the content policy with the rule named.
6. A soft rule can be departed from in the experimental direction under `brand_guided`, with the
   departure disclosed, and cannot be departed from under `brand_restricted`.
7. An unmarked rule cannot be saved.
8. A campaign generated after a guideline change, with no re-pin, still reports the guidelines it
   was pinned with; re-pinning follows ADR 0058 and produces a new snapshot.
9. A member of another organization can neither read nor write either record, and receives
   not-found rather than forbidden.
10. No surface labels a generated logo as exact or verified.

## Test plan

- **Domain, pure:** rule strength parsing; palette hex validation; the refusal of an unmarked rule;
  restricted-term bounds; the "broken pointer" determination.
- **Application:** promotion from the onboarding section; the generation context carrying palette and
  both rule lists; the content policy refusing a hard-rule contradiction and permitting a disclosed
  soft departure under the right profile only.
- **Repository, against a stub:** the shape of both writes, including that a partial edit does not
  erase the other record's keys — the defect class already found twice in `brand_context`.
- **pgTAP, against staging:** forced RLS on both tables; the composite tenant foreign key refusing a
  cross-tenant logo pointer; `brand.manage` enforced in the RPC and not only in the route; anonymous
  execution refused; the audit trigger firing on both tables.
- **Permission drift:** the existing `permissions.drift.test.ts` must pass with `brand.manage`
  present in both the migration and the mirror. It is currently failing for an unrelated permission;
  this spec does not adopt that failure but must not add to it.
- **Browser, both widths:** onboarding capture, the Brand Guidelines tab, the logo in the header,
  and a generation carrying the brand mark.

## Migration and rollback

Additive. Two new tables, one new permission, one extended `plpgsql` function
(`load_campaign_creation_facts`), and one extended generation context schema. No column is dropped
and no existing row is rewritten.

A pushed migration is live on shared staging immediately, and `pnpm db:migrations:push` is the
user's step. The extended function reads tables it did not create, so per AGENTS.md it must be
called once against staging before this is considered done.

Rollback: the tables can be left in place and unread; reverting the function restores the previous
behaviour, in which the three rule keys were read from `brand_context` and were always empty.

## Documentation updates

- Spec 019 gains a pointer to this document for the Brand Guidelines tab.
- Spec 020 gains a note that `logoSlot` remains unimplemented and why.
- `context/05-module-map.md` gains the brand identity module.
- A new ADR records §18.1, the decision to condition rather than composite.

## 18. Decisions

### 18.1 The logo is conditioned, not composited

**Decided by the user, 2026-09-15, against the recommendation in this document's drafting.**

The poster templates declare a `logoSlot`, null on all four seeded templates, with the seed
migration stating that "declaring a slot nothing draws would describe a capability this release does
not have". Compositing the real file into that slot would be exact.

The decision is to supply the logo to the image model as a `brand_mark` conditioning reference
instead. The reasoning that supports it: the upload path already assigns `brand_mark` to a logo-role
asset, `brand_mark_distorted` already exists as a review reason with wording written for exactly
this, and ADR 0057 already requires a human to review each exact finished output before publication.
The distortion risk is therefore caught by a gate that is mandatory anyway, and the reference route
uses machinery that already exists rather than building a new renderer capability.

The cost, accepted: a generated logo is an approximation, every poster needs the logo checked at
review, and the platform may never claim the logo is exact. §9 and acceptance criterion 10 hold that
line.

`logoSlot` stays null. This spec does not implement compositing, and a later decision to do so would
supersede this section rather than extend it.

### 18.2 Rule strength is authored, not inferred

**Decided by the user, 2026-09-15.** Each rule is marked hard or soft by the person entering it.

Marking everything hard was considered and rejected: a palette stated as an absolute would refuse
every generation that drifted, rather than offering it for judgement, and the volume of refusals
would teach operators to widen the profile until the rules stopped mattering. Making everything soft
was also rejected: a regulated or legal must-never needs teeth.

This maps onto machinery that already exists rather than adding a parallel one — `hardConstraints`
are already un-departable and `softConventionDepartures` are already disclosed and gated by profile.

### 18.3 Guidelines are structured fields, not an uploaded document

**Decided by the user, 2026-09-15**, replacing an earlier decision the same day to allow documents
in the brand library.

That earlier decision was taken on an incomplete reading. The image library enforces images-only in
five independent places, and the fourth is load-bearing: `asset-intake.ts` decodes and re-encodes
every file so that the stored bytes are ones this server produced, which strips EXIF and means no
stranger's file is served back. There is no equivalent step for a PDF, so admitting documents would
have ended that property for the one store whose purpose is to hold it.

Structured fields are better on their own merits regardless: a PDF cannot constrain a generation,
and a palette in a document is a colour nobody can check against.

### 18.4 A rule that is also a restricted term is stored once

**Resolved 2026-09-15 by the spec's approval, in favour of the intent stated when it was raised.**
It was put to the user as the spec's one open question and the spec was approved without amending
it; it is recorded here as a decision rather than left looking unanswered.

"Never say 'best in Dubai'" is both a don't and a term. Storing it in both lists risks the two
drifting apart under later editing, and an operator would have to remember to change both. Storing
it once means only one of the two checks sees it.

It is stored once, as a restricted term, because that is the check that can actually enforce it: a
restricted term is matched literally, while a rule is prose in a prompt. The Brand Guidelines tab
renders restricted terms inside the don'ts list, so an operator reads one list even though the
record holds two fields.

Cheap to revisit: nothing else depends on the choice, and moving to duplicate storage later would be
a migration of one array.
