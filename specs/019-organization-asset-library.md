# Feature Specification: Organization Asset Library

## Status

**Approved 2026-08-24; corrected in part 2026-09-09.** Tier 3. The declared-subject,
truth-class and grounding rules remain binding. The Asset Library product model, its
Creative History schema, and the rejected-evidence route are corrected by ADR 0049 and
`docs/superpowers/specs/2026-08-26-creative-history-asset-library-correction-design.md`.
The approved implementation plan is
`docs/superpowers/plans/2026-09-09-creative-history-asset-library-correction.md`.

Where this document formerly treats a finished design as a generic generation ingredient,
the correction is binding: Creative History, Products & Subjects, and Brand Kit are separate
records on one Asset Library page. In particular, no rejected creative bytes may enter a final
image-provider request. The corrected acceptance criteria in §14 govern that boundary.

Revised 2026-08-24 after the three open questions were answered: the image model stays flash-tier
for Release 1, a missing photograph is drawn rather than refused, and tags are free-text Unicode
with pack suggestions. §18 records those decisions and what they replaced.

Integrates with the Campaign Creative Studio (poster composition, output verification and masked
editing), specified separately. A completed Studio poster can become an **unreviewed** Creative
History item; raw plates do not become historical designs merely because they exist.

Depends on ADR 0015 (campaign bundle as system of record), ADR 0017 (campaign runtime and
approval), ADR 0020 (bounded creative family approval), ADR 0022 (account as tenant root),
ADR 0023 (permission as data), and ADR 0006 (industry packs). Introduces ADR 0041.

## 1. Business outcome

Make generated campaign creative depict the client's actual business — using their photographs
where they have them, and drawing the named dish faithfully where they do not — while preserving
an organization’s reviewed finished designs as a separate visual history.

Release 1 succeeds when every generation is anchored to a **declared subject**: either a photograph
the client uploaded of that dish, or a written description of a dish they actually sell. What is
never permitted again is the third case that produced everything on file today — a model choosing
the subject for itself.

The measurable outcome is the proportion of generated assets an operator approves rather than
discards. Creative History makes that human signal inspectable and reusable without allowing a
rejected design to reach the final image provider.

## 2. Problem statement

Four campaign assets were pulled from `campaign-assets` storage on 2026-08-24 and examined.

| Asset | What the model drew |
|---|---|
| `b38f1a23…0008` | Sliced duck breast, cherry jus, asparagus, risotto, rustic oak table, stone wall, garden window. A French gastropub plate. |
| `f4a13d71…c412` | Overhead illustrated mezze. Contains rendered text reading *"'The Joy of Sharing'"* and *"Explore Our Mezza"* — misspelled, over garbled pseudo-Arabic glyphs. |
| `4e3eed0d…972f` | Painted communal table with six or seven disembodied hands reaching in. |
| `7a8b9c0d…0c1d` | Photoreal whole roast chicken, sourdough loaves, nine invented smiling faces, glasses reading as red wine. |

The pilot organization sells butter chicken, Hyderabadi dum biryani, Kerala fish curry and chicken
65 in Dubai. Not one asset is the right cuisine. One places alcohol-coded drinks and nine
fabricated customers on a restaurant's own feed. The only asset that rendered text misspelled it in
two scripts — which is also the evidence that settles how multilingual text must be handled, and
§7.9 takes it up.

The cause is a chain of five links, each verifiable in the current tree.

**The reference plumbing exists and is severed at the last inch.** `brand_asset_version_ids` is
carried from the campaign creation route through `service.ts`, `creation-repository.ts`, the
`campaign_source_snapshots` row, `generation-context.ts` (bounded at 40) and into
`generate-bundle.ts`, which pins it. `campaign-planner.ts` receives it on the generation context
and never reads it, because `CampaignImageGenerationInput` is `{ prompt, widthPx, heightPx }` and
has nowhere to put an image. `campaign_assets.provenance.derivedFromBrandAssetVersionIds` is
therefore `[]` on every row ever written.

**Nothing can select a reference.** `organization_brand_assets`,
`organization_brand_asset_versions`, the `brand-assets` bucket, the `create_brand_asset_version`
and `finalize_brand_asset_version` RPCs, `brand-asset-service.ts` and two upload routes all exist
and work. Both tables hold zero rows, because `new-campaign-brief.tsx` — the only surface that
creates a brief — has no asset picker. Every brief ever submitted sent `[]`.

**The image prompt is the accessibility description.** `campaign-planner.ts:389` passes
`subject: asset.altText` to the image model. A text model writes a ≤420-character description of a
photograph for a screen reader, and that description becomes the drawing instruction. Asking for a
photo caption returns a photograph. Nobody ever asked for a poster.

**The offer is forbidden in the image.** `model-router.ts:245` instructs *"Do not render text that
states a price, a discount, or a claim."* Written in good faith to stop a model inventing a
discount. It also removes the only thing a promotional flyer exists to say.

**Nothing inspects the result.** `asset-intake.ts` sniffs the leading bytes, checks dimensions,
re-encodes, strips EXIF and hashes. There is no OCR, face check, cuisine check or moderation
anywhere in the repository. So the instruction "do not depict real identifiable people" produced
nine faces and the instruction against claim text produced misspelled claim text, and both passed.

The existing guard is sound and proves the design works when fed. Of two campaign snapshots on
staging, `8e4c5c4e` has `brand_asset_version_ids: []` and `syntheticAssetsAllowed: false`, and was
correctly refused — it is still `draft`. `783ab4e1` has `[]` and `syntheticAssetsAllowed: true`, so
the platform was permitted to draw whatever a sentence suggested. It also has `offer: null`, so
there was no offer to place on a poster in the first place.

## 3. User stories

- As a restaurant owner, I upload photographs of the dishes I actually sell, so a campaign about my
  biryani shows my biryani.
- As a restaurant owner, I upload photographs of my dining room, my family section and my terrace,
  so a campaign about a weekend family offer looks like my restaurant and not a stock library.
- As an agency operator, I reject a finished design and say why in one click, so a Blueprint can
  learn the reason without that rejected design reaching final image generation.
- As an agency operator, I keep finished posters, flyers and social designs in real folders, then
  reuse only reviewed Approved work as historical visual evidence without copying its food or words.
- As an agency operator, I brief a campaign and see exactly which of the client's photographs will
  be used, and I can swap any of them before anything is generated.
- As a restaurant owner, I do not have a good photograph of every dish, so when I describe my meen
  curry once the platform draws that curry — not a generic one — and remembers the description for
  next time.
- As an agency operator, I am never handed a dish the client does not sell. If nobody has said what
  the campaign is about, I want to be asked rather than surprised.
- As a Malayali restaurant owner in Dubai, I tag and name my dishes in Malayalam and Arabic and the
  platform stores them as I wrote them.
- As an agency operator, I can tell at a glance whether an image is the client's photograph, a
  drawing made from it, or a drawing made from words.
- As a client owner, I open any generated asset and see which of my own photographs produced it.
- As a compliance-minded operator, I archive an asset that is out of date without breaking the
  record of campaigns that already used it.

## 4. Governing principles

- A reference is selected deterministically. No model chooses which of a client's photographs or
  finished designs represents their business.
- **Creative History separates historical visual evidence from grounding.** Approved finished-design
  bytes may reach Blueprint and final image generation; rejected finished-design bytes may reach
  Blueprint only. The final image prompt receives validated Blueprint rules with the human reasons,
  never rejected bytes. ADR 0049 makes that final-provider fence structural rather than a prompt
  convention.
- **A reasoning model writes the art direction before the image model draws.** The blueprint is a
  validated structured object with no field for the subject and no field for text, so a stage that
  could drift cannot express the drift.
- A rejection without a reason teaches nothing. A reason code is mandatory. It travels with the
  rejected design to Blueprint and supports validated rules for final generation; it is not the
  only historical-learning record.
- More references is worse, not better. Slot caps are enforced in domain code.
- **A photograph outranks a depiction, and a depiction outranks an invention.** Where the client has
  a photograph of the dish, it is used. Where they do not, the model draws that dish from a written
  description of a dish they actually sell. Where nobody has said what dish this campaign is about,
  the platform refuses — because that, and only that, is what produced the duck breast.
- What the client is told about an image must match how it was made. A drawing of their biryani is a
  good campaign asset and a bad photograph, and the difference is never blurred.
- A script the image model cannot spell is a script it must not be asked to write. Language support
  is a compositing problem, not a prompting problem.
- The library is industry-neutral. `asset_role` stays `logo | product | venue | team | other`;
  restaurant meaning arrives as tag vocabulary from the Restaurant Industry Pack.
- Deleting an asset would break the provenance of every campaign that used it. Assets archive.
- Uploaded bytes are untrusted. The existing three-step reserve, upload, read-back-and-re-encode
  flow is retained unchanged.

## 5. Scope

### 5.1 In scope

- A single Asset Library page with Creative History, Products & Subjects, and Brand Kit tabs.
- Creative History folders (one optional nested level), immutable design versions, design-level
  reviews, confirmed metadata, rights and qualified performance evidence.
- An append-only human verdict record over Creative History versions, carrying mandatory reason
  codes on rejection. Products & Subjects and Brand Kit retain their own records and permissions.
- A pack-extensible reason-code registry.
- A deterministic, versioned declared-subject resolver returning one of three outcomes — draw from
  a photograph, draw from a description, or refuse for want of a declared subject — plus a separate,
  deterministic Creative History selector that pins Approved final evidence and Rejected Blueprint
  evidence before spending.
- Two reference modes, `inspiration` and `exact_match`, the latter gated on the organization owning
  the reference.
- Permission-checked manual Creative History overrides, pinned and audited; a new historical upload
  cannot affect a run until its metadata and review make it eligible.
- The two-stage generation: a reasoning model produces a validated structured blueprint, the image
  model draws from it.
- Subject profiles: the dishes an organization sells, model-drafted and human-confirmed, with names
  per script and a description specific enough to draw from.
- The synthesis prompt builder and its fixed constraints.
- Keeping the exact confirmed description on the immutable campaign source snapshot, pinning each
  run's realized reference set, negative rules, resolution outcome and blueprint onto that
  generation run, and populating `derivedFromBrandAssetVersionIds` from the run receipt.
- Deriving `truth_class` from the resolution outcome, and removing it from what the model declares.
- Widening the Blueprint seam for approved and rejected historical evidence, while narrowing the
  final provider seam so it cannot accept a rejected-design variant.
- An Asset Library workspace: browse, upload, folder, tag, review, archive and inspect receipts;
  plus a separate Products & Subjects workspace.
- A Creative History evidence picker in the campaign brief, defaulting to the deterministic selector.
- Replacing the misleading `brand_constraints` refusal code, which currently sends an operator to
  look at their brand constraints when the real gap is elsewhere, with `no_declared_subject`.
- Re-scoping `syntheticAssetsAllowed` to mean a synthetic *setting* only.
- Unicode-safe tags, labels and names, and script-declaring typography references.
- Three new permission keys as data.

### 5.2 Out of scope

Deferred to the Campaign Creative Studio spec:

- Poster layout templates and the plate-versus-layer split.
- Composited headline, offer, price, legal line and brand mark.
- The output verification pass — OCR, face detection, narrow vision checks.
- Masked region editing.
- Removing the `model-router.ts:245` prohibition on rendered claim text, which may only be lifted
  once composition makes the rendered text exact.
- All rendered text in any script, and therefore Malayalam and Arabic typography on the image
  itself. §7.9 explains why this cannot be solved by prompting.

Deferred elsewhere or not planned:

- Multilingual campaign **copy** — caption, hook, call to action. A text-model concern with no
  schema barrier; it belongs with the Creative Studio so the written and the rendered text agree.
- Structured menu data, prices and item-level economics. There are no menu tables; the `menu_item`
  subject kind is registered with zero rows against it; `specs/009-restaurant-menu-intelligence.md`
  is unimplemented. Subject profiles (§8.4) are the interim stand-in and are deliberately not a
  menu: no price, no availability, no modifiers, no economics.
- Model-proposed tags as authoritative metadata. A model may propose metadata, but a human confirms
  it before selection.
- Video, audio and document assets.
- Cross-organization or agency-template libraries.
- Changing `CAMPAIGN_IMAGE_MODEL`. Release 1 is built and measured on `gemini-3.1-flash-image`;
  §18 records the trigger that would move it to a pro-tier model.

### 5.3 One page, three purpose-based tabs

The requested library is a visual memory, not a renamed list of references. It has exactly three
tabs backed by separate records. A real Creative History folder can contain mixed Approved, Rejected
and Unreviewed designs; verdict remains design-level so history is not distorted into verdict folders.

| Tab | Contains | Does not become |
|---|---|---|
| **Creative History** | Historical uploads and completed Studio posters: finished posters, flyers, social designs, stories and banners | A source of subject truth or a substitute Brand Kit |
| **Products & Subjects** | Product/dish photos, confirmed descriptions and factual visual constraints | A historical-style verdict collection |
| **Brand Kit** | Logos, marks, palette, typography and reusable identity material | A set of reviewed finished designs |

## 6. UX flow

1. **Open the library.** Three tabs: *Creative History*, *Products & Subjects*, and *Brand Kit*.
   Creative History shows a folder tree, filterable finished-design grid and evidence panel.
2. **Add finished creative.** Multi-file historical upload goes to a private Creative History path;
   folder defaults supply metadata, and an item may override it. The reserve → upload → read-back
   flow runs per file; an unreadable file is refused without blocking the rest.
3. **Review a finished design.** Approve, or reject with at least one reason and optional free text. The
   reject form cannot be submitted without a reason. Reason chips carry plain-language labels, not
   codes.
4. **Describe what you sell.** The Products & Subjects tab carries the subjects list. The operator names a dish; the
   model drafts a description from Business Memory and their own words; the operator edits and
   confirms it. Names in other scripts are entered here. A confirmed subject is reusable forever
   and is what makes a photograph optional rather than mandatory.
5. **Brief a campaign.** The brief names the subject and then states plainly which of the three
   paths it is on: *drawing from your photo of X*, *drawing X from your description*, or *nobody
   has told us what this campaign is about*. In the first two the operator may swap or clear any
   slot. In the third the submit action is disabled with one recovery — pick or write a subject.
6. **Read a generated asset's lineage.** Every generated asset shows its truth class in plain
   words, the declared subject, pinned Approved final evidence, Rejected Blueprint evidence, the
   validated negative rules and their human reasons, and selector/resolver versions.

Every blocked, missing or refused state renders its stable code, a plain-language explanation and
the action that clears it. Nothing blocked is styled as ready.

## 7. Domain rules

### 7.1 Roles

`asset_role` is unchanged and describes **what the asset depicts**: `logo`, `product`, `venue`,
`team`, `other`.

`conditioning_roles` is new and describes **how a model may use it**. An asset declares every role
it is eligible for; the resolver assigns exactly one per generation and records which.

| Conditioning role | Instruction contract sent with the bytes |
|---|---|
| `subject` | This is the actual thing the campaign is about. Keep it identical — same object, same components, same colour. Lighting, angle, background and composition may change. |
| `brand_mark` | Reproduce exactly. Never redraw, restyle, recolour or letter-space. |
| `setting` | The place. Use it for atmosphere, surfaces and light. |
| `style_exemplar` | Take layout, spacing, colour relationships and mood. Take nothing literal — no object, no text, no mark. |
| `palette` | Constrain colour only. |
| `typography` | Constrain type feel only, for the scripts this asset declares. |

**Two reference modes.** A `subject`, `setting` or `style_exemplar` slot carries a mode:

- `inspiration` — take layout, mood and colour relationships; take nothing literal. The default, and
  the only mode permitted for a reference the organization does not own.
- `exact_match` — reproduce the reference's composition, framing, lighting and colour closely. Only
  permitted where the organization owns the reference: their own upload, or their own prior campaign
  output. Exact-matching a poster found elsewhere reproduces another business's design, which is a
  brand-confusion problem handed to the client.

`exact_match` constrains the **plate only**. Where a reference carries text, that text is excluded
from what is matched — reproducing it would put the wrong words, in the wrong script, on the client's
poster, which is the failure `specs/020-campaign-creative-studio.md` exists to end. Finished designs
are instead Creative History evidence under ADR 0049; they are never recast as a conditioning role.

A `brand_mark` is supplied to the model for placement context only. Until the Creative Studio
composites it deterministically, a generated logo is treated as unusable and the verification of
that fact belongs to that spec.

### 7.2 Verdicts and reasons

- A review is append-only. The current verdict is the most recent review for that asset.
- `rejected` requires at least one reason code. `approved` carries none.
- Reason codes live in a registry table with `owner_scope` of `core` or `pack`, matching the
  established pattern of `subject_kinds` and `permissions`. Core ships neutral codes;
  the Restaurant Industry Pack ships the rest.
- Core codes: `wrong_subject`, `wrong_style`, `text_unreadable`, `text_incorrect`,
  `brand_mark_distorted`, `people_shown`, `prohibited_content`, `low_quality`, `off_palette`,
  `not_localised`, `other`.
- Restaurant Pack codes: `wrong_cuisine`, `alcohol_visible`, `unappetising`, `not_our_plating`.
- A rejected Creative History version is excluded from every positive role unless a later review
  approves it. It may be selected only as Blueprint evidence, capped at five designs, with the
  human reason codes for that version attached.
- Rejected Creative History bytes are never a final image-provider input. Blueprint may turn their
  evidence into validated, cited negative rules; only those rules and their human reasons may reach
  the final image prompt. See ADR 0049.

### 7.3 Resolution

Pure, versioned domain function. `RESOLVER_VERSION` starts at 1. A changed method is a new version,
never a silent reinterpretation of sets already pinned.

Declared-subject candidates are usable versions of unarchived Products & Subjects and Brand Kit
records. Creative History is selected separately: only reviewed, confirmed-metadata designs are
eligible; Approved designs form the positive historical set and Rejected designs form the Blueprint
negative-evidence set. Unreviewed designs reach neither.

The request is a pure function of stated intent and stored data:

- `subjectTags` — the dish this campaign is about, drawn from the brief or the opportunity.
- `subjectDescription` — the same dish in words, from the operator or a verified business fact.
  This is what makes synthesis possible, and §7.4 governs it.
- `settingTags` — the place, if the campaign names one.
- `occasionTags` — the calendar or cultural context: a weekend, Ramadan, Eid, a national day, a
  school holiday. These are ordinary tags, not a separate taxonomy, which is what lets an
  organization carry occasions the platform has never heard of.
- `styleTags` — an optional narrowing when an operator wants a particular look.
- `scripts` — the writing systems this campaign will publish in, as ISO 15924 codes: `Latn`,
  `Mlym`, `Arab`. Used only to select typography references, never to prompt for rendered text.

Slot caps, enforced in domain code:

| Slot | Min | Max |
|---|---|---|
| `brand_mark` | 0 | 1 |
| `subject` | 0 | 3 |
| `setting` | 0 | 1 |
| `style_exemplar` | 0 | 2 |
| `palette` | 0 | 1 |
| `typography` | 0 | 1 per requested script, maximum 3 |

Positive references per generation may not exceed 7. The schema's existing bound of 40 is a safety
limit; 7 is the quality limit, and the lower of the two governs.

Creative History is outside those grounding-role caps and is pinned by its own selector: no more
than three Approved designs reach final image generation, and no more than five Rejected designs
reach Blueprint. Relevance dominates performance; the selector records a weak match as an exclusion
rather than filling either cap.

**Where evidence comes from when the operator supplies none.** The declared-subject resolver reads
Products & Subjects and Brand Kit for grounding. The Creative History selector separately reads
reviewed designs using scenario relevance, with stable tie-breaking and explicit exclusions. A new
historical upload remains ineligible until its metadata is human-confirmed and it receives a human
review; this prevents an unreviewed upload from silently influencing the campaign that received it.

Ordering is total and deterministic, so two runs over identical data produce an identical set:

1. declared-subject suitability and confirmed Creative History scenario relevance;
2. Approved or Rejected verdict as appropriate to the independent evidence set;
3. comparable verified performance only after relevance;
4. descending immutable version number, then ascending stable identifier.

Nothing is ever resolved by arrival order or by chance.

Resolution has exactly three outcomes, and which one is reached depends on what the organization
has, never on what the model would prefer:

| Outcome | Condition | What generation does |
|---|---|---|
| `resolved` | A candidate matches `subjectTags` | Draws from the client's own photograph. Asset is `authentic_source`. |
| `synthesis_permitted` | No matching candidate, but `subjectDescription` is present | Draws the named dish from the description under §7.4. Asset is `synthetic_generated`. |
| `insufficient` | No matching candidate and no `subjectDescription` | Refuses with `no_declared_subject`. |

The refusal is narrow and deliberate. It does not fire because a photograph is missing — a missing
photograph is ordinary and the platform draws instead. It fires only when **nobody has said what
this campaign is about**, which is precisely the state campaign `783ab4e1` was in: no references, no
declared subject, `offer: null`, and a model left to fill the silence.

`syntheticAssetsAllowed` is re-scoped rather than narrowed. It no longer answers "may the platform
invent" — §7.4's declared subject answers that. It now answers whether a synthetic **setting** is
acceptable to this organization, which is a brand preference and not a truth question.

A `setting`, `style_exemplar`, `palette` or `typography` slot that cannot be filled never blocks. An
unfilled slot is simply absent from the prompt.

### 7.4 Synthesis without a photograph

Where the client has no photograph of the dish, the model draws it. The quality of that drawing is
almost entirely a function of how specifically the dish was described, so the description is
treated as an asset in its own right rather than as a sentence typed into a box.

**Subject profiles.** A new `organization_subject_profiles` table holds the things this organization
sells: a name, a description, tags, names in other scripts, and any reference assets linked to it. A
profile is written once and reused by every campaign about that dish, so the description improves
over time instead of being retyped.

This table is the load-bearing piece of this section, and it exists because there is no menu data —
no menu tables, `menu_item` registered with zero rows, spec 009 unimplemented. A subject profile is
the smallest honest stand-in and is explicitly not a menu: no price, no availability, no
modifiers, no economics.

**How a description gets written.** The text model drafts it from Business Memory and the operator's
own words; the operator edits and confirms; the confirmed text is what is stored and used. This is
the model-proposes, human-approves pattern already used for report contracts and memory items. An
unconfirmed draft is never used for generation, because an unreviewed description of a dish the
restaurant may not even sell is the same failure with an extra step.

**What a usable description contains.** The draft form prompts for each, and the confirm action is
disabled until the first four are present:

- the dish name as the menu says it, and its common transliteration;
- the principal visible components — protein, gravy, grain, garnish;
- the vessel and how it is served;
- the dominant colours and textures;
- accompaniments normally in frame;
- anything that must never appear.

"Kerala fish curry" produces a generic curry. "Kingfish steaks in a thin tamarind-and-coconut gravy,
deep brick-red from Kashmiri chilli, in a red clay pot, curry leaves and sliced shallots on top,
tapioca alongside" produces something a Malayali recognises. The gap between those two strings is
the whole difference between this feature working and not working.

**Fixed constraints on every synthesised subject**, enforced in the prompt builder rather than left
to the description:

- no human faces, and no hands unless the description names them;
- nothing alcohol-coded unless the profile declares it;
- no component absent from the description — a model may not add a naan because curries usually have
  one;
- no rendered text of any kind, per §7.9;
- photoreal unless the profile declares an illustrated style.

**Fidelity is measured, not assumed.** `gemini-3.1-flash-image` is the model of record for Release 1
and the acceptance criteria are evaluated against it. §18 records the escalation trigger to a
pro-tier model.

### 7.5 Truth class

`campaign_assets.truth_class` already exists with exactly the three values needed. Today it is
**declared by the model** — `campaign-planner.ts:106` asks the model to fill it in — which means the
field asserting whether an image is authentic is written by the thing that generated it. It becomes
derived, deterministically, from the resolution outcome:

| Value | Means | Produced when |
|---|---|---|
| `authentic_source` | The client's own photograph | An operator uses a library photograph directly as the campaign asset. Crop and resize only. |
| `synthetic_composite` | Drawn from the client's photograph | Resolution returned `resolved` — a subject reference was supplied to the model. |
| `synthetic_generated` | Drawn from a description | Resolution returned `synthesis_permitted`. |

The model no longer writes this field, and the manifest schema stops asking for it.

Truth class is shown wherever an asset is shown, in the operator's own words — *your photo*, *drawn
from your photo*, *drawn from a description*. A depiction of the client's biryani is a perfectly
good campaign asset; it is only a problem if someone believes it is a photograph of their kitchen.

### 7.6 Negative rules

Rejected Creative History designs are selected independently for Blueprint analysis. The Blueprint
receives each selected design with its human reason codes and can produce a maximum of twelve
structured negative rules. A rule is valid only when it names its supporting rejected version and
the registered human reason that made it relevant; uncited, malformed, conditional-without-condition
or over-cap rules are refused at schema validation.

The final image prompt receives the validated rules and their human reasons as text. It does not
receive rejected design bytes, storage identities or a role that can load either. A rule can therefore
carry the useful human judgment — for example, "avoid restaurant plating that is unlike ours" —
without making the rejected poster an ingredient of the final image request.

### 7.7 The art-direction blueprint

A generation runs in two stages. Adopted from the user's production design studio on 2026-08-24,
where it outperformed every flatter architecture tried.

**Stage one.** The `plan` model — the slot already present in `createModelRouter` beside `text`,
`patch`, `repair` and `image`, configured by `CAMPAIGN_PLAN_MODEL` — receives the system prompt, the
operator's creative direction, brand and subject context, Approved Creative History evidence and
Rejected Creative History evidence with human reasons. It returns a **blueprint**.

**Stage two.** The image model receives the blueprint, declared-subject and Brand Kit grounding,
Approved Creative History evidence, and the validated Blueprint rules with human reasons. It never
receives Rejected Creative History bytes. The final-image input type makes that route impossible.

The blueprint is a strict Zod object, never prose. It carries composition, framing, lighting, camera
treatment, palette guidance, focal point, surface and prop notes, and an explicit avoid list.

**It carries no subject field and no text field.** The subject is injected deterministically after
parsing, from the resolved reference or the confirmed description; text is composited later by spec
020. A stage that cannot express a subject cannot change one, which is a structural guarantee rather
than an instruction the stage might ignore.

Other rules:

- The blueprint is pinned to the generation run alongside its separate Approved-final and
  Rejected-Blueprint evidence sets, so an operator can read why an image looks the way it does and
  each regeneration remains independently explainable after the fact.
- A blueprint that fails to parse gets one bounded repair pass through the existing `repair` slot,
  then the generation fails safely. It never degrades to sending the raw text through.
- The fixed constraints of §7.4 are appended *after* the blueprint, so nothing the planner writes can
  displace them.
- Stage one is metered like any other model call. Two calls per image is the cost of this
  architecture and is stated plainly rather than discovered on a bill.

### 7.8 Provenance

- `campaign_assets.provenance.derivedFromBrandAssetVersionIds` is populated from the pinned set.
- The pinned set includes the slot assignment, the resolver version and the negative rules, so a
  generation is explainable after the fact without re-running the resolver against data that has
  since changed.
- Changing an asset's roles, tags or verdict does not alter any set already pinned.
- The pinned set records the resolution outcome and the `subjectProfileId` where one was used, so a
  `synthetic_generated` asset can be traced to the exact description that produced it.
- **The resolution is pinned to the generation run, not to the source snapshot.** Corrected
  2026-08-24, during implementation. The snapshot is immutable by trigger and is captured once at
  creation, while a resolution is made per run against a library that changes between runs — so
  pinning to the snapshot would let a later run silently rewrite the provenance of an earlier run's
  images. The split mirrors the planned-versus-realized distinction spec 016 already draws for
  exposure: the snapshot holds the request, the run holds the receipt.

### 7.9 Scripts and language

The pilot client sells Kerala food in Dubai and needs Malayalam, English and Arabic. There is no
locale, script, language or RTL handling anywhere in the tree today — this is greenfield, and one of
the four examined assets is the evidence for how it must be approached.

Asset `f4a13d71` rendered *"Explore Our Mezza"* — misspelled — over garbled pseudo-Arabic glyphs.
That is not a prompting failure that a better instruction fixes. Image models draw letterforms as
shapes; they misspell Latin, and they produce ornamental nonsense for Arabic. Malayalam is harder
still: complex conjuncts, reordering vowel signs, and far less training data. A client publishing
mis-spelled Malayalam to their own feed is worse than publishing nothing.

So the rule for Release 1 is unambiguous: **no script is ever requested inside a generated image.**
The existing `model-router.ts:245` prohibition on rendered text stays, and now has a second and
stronger reason than the one it was written for. Correct multilingual text arrives by compositing
real fonts over the image, which is the Creative Studio's job and is the reason that spec is
mandatory rather than a nice-to-have.

What this specification does provide, so the Studio has what it needs:

- A `typography` reference declares `scripts` as ISO 15924 codes. A Latin type sample teaches
  nothing about Malayalam, so a typography asset is only ever resolved for a script it declares.
- Resolution takes the request's `scripts` and may fill the typography slot once per script, which
  is the one place the slot cap of 1 is raised — to one per script, maximum three.
- A subject profile carries the dish name per script, so the Studio composites *മീൻ കറി* rather than
  transliterating it.
- Tags, labels, descriptions and names are Unicode throughout, per §8.1.

Multilingual **copy** — caption, hook, call to action — is a text-model concern, not an asset
concern, and is out of scope here. The columns already accept any UTF-8 at their existing character
limits, so it is a generation and review problem rather than a schema one. It belongs with the
Creative Studio, where the rendered and the written text must agree.

## 8. Data model

All new and changed objects are tenant-owned with forced RLS, composite tenant foreign keys,
explicit grants, and `authenticated` holding select only. Writes go through security-definer
functions with `search_path = ''` and an explicit organization check. Every new function that reads
a table it did not create is called once against staging before its task is complete.

### 8.0 Creative History — the corrected visual-memory model

Creative History adds separate, additive records: `creative_folders`, `creative_items`, immutable
`creative_item_versions`, append-only `creative_item_reviews`, qualified
`creative_item_performance_evidence`, and run-scoped selection receipts. A folder has an optional
single parent; an item has a stable identity, source kind and rights; a version has a private object
or tenant-checked completed Studio render link, dimensions and content hash; a review is the sole
source of the current Approved, Rejected or Unreviewed verdict.

Folder defaults and item overrides produce effective metadata for subject, occasion, channel,
format, market, language, objective and tags. Proposed model metadata is stored separately from
human-confirmed metadata. Only confirmed metadata and a human-reviewed version are eligible for
selection. Completed Studio renders may be linked without copying bytes and enter as Unreviewed;
raw plates and unqualified legacy assets are not backfilled.

New historical uploads use a private `creative-assets` path and the existing reserve, upload,
read-back, re-encode and hash discipline. Every selection receipt snapshots effective metadata,
selector version, candidates, exclusions, the Approved final-image set, the Rejected Blueprint set,
and the resulting validated rules. It is never recomputed from mutable current rows.

### 8.1 Changed — `organization_brand_assets`

Additive only. Existing rows are unaffected; there are none.

- `conditioning_roles text[] not null default '{}'` — non-empty, elements constrained to the seven
  roles, no duplicates.
- `tags text[] not null default '{}'` — each 1–60 characters, at most 24 per asset.
- `scripts text[] not null default '{}'` — ISO 15924 codes. Required non-empty when
  `conditioning_roles` contains `typography`, empty otherwise.
- `ownership text not null default 'third_party'` — `owned | third_party`. Only an `owned` asset may
  be used in `exact_match` mode. The default is the safe one, and the operator asserts ownership
  deliberately rather than by omission.
- `archived_at timestamptz null`.
- `asset_role` CHECK unchanged.

**Tags are Unicode.** `ഊൺ` and `عرض` are valid tags. Normalization is NFC on write; matching is
case-folded, which is a no-op for scripts without case rather than an error. No `[a-z0-9-]` pattern
is applied anywhere — a Latin-only tag rule would silently make the library unusable for this
client's own vocabulary. `char_length` is used for bounds, never `octet_length`, so a Malayalam tag
is not penalised for its encoding.

Release 2 adds `proposed_tags jsonb` beside `tags` for model-proposed tagging awaiting human
confirmation. The column is not created now; the separation of confirmed from proposed is the seam.

### 8.2 New — `creative_review_reasons`

Registry, not tenant-owned. `key` primary key, `description`, `owner_scope` in `core | pack`,
`pack_slug` nullable, `created_at`. Seeded by migration with §7.2's codes.

### 8.3 New — `creative_asset_reviews`

Append-only, one row per review act.

`id`, `organization_id`, `subject_kind` in `brand_asset_version | campaign_asset`, `subject_id`,
`verdict` in `approved | rejected`, `reason_codes text[]`, `note text` bounded at 500,
`reviewed_by`, `reviewed_at`, `created_at`.

Constraints: `reason_codes` non-empty exactly when `verdict = 'rejected'`; every element present in
`creative_review_reasons`; append-only trigger; composite tenant foreign key per subject kind,
enforced by the writing function rather than by two nullable columns.

Index on `(organization_id, subject_kind, subject_id, reviewed_at desc)` to serve current-verdict
reads.

### 8.4 New — `organization_subject_profiles`

The things this organization sells, as §7.4 requires. Tenant-owned, mutable, versionless — a
description is edited in place and its history lives in the audit trail rather than in a version
chain, because nothing pins a profile the way a campaign pins a reference set.

`id`, `organization_id`, `name`, `slug`, `description text` bounded at 2000, `tags text[]`,
`names_by_script jsonb` mapping ISO 15924 code to the name in that script, `must_not_appear text[]`,
`illustrated_style boolean not null default false`, `state` in `draft | confirmed`,
`confirmed_by`, `confirmed_at`, `created_by`, `created_at`, `updated_at`, `archived_at`.

Constraints: unique `(organization_id, slug)`; `confirmed_by` and `confirmed_at` non-null exactly
when `state = 'confirmed'`; `description` non-empty when `state = 'confirmed'`. Tags follow §8.1's
Unicode rules. Only a `confirmed` profile may be used for generation.

### 8.5 Changed — `campaign_source_snapshots` — what the brief *declared*

Additive. `brand_asset_version_ids` is retained as the flat list it already is.

**This table is immutable by trigger** (`campaign_source_snapshots_immutable`, BEFORE DELETE OR
UPDATE) and stays that way. It records what the operator declared when the campaign was created, and
nothing may rewrite it afterwards. The resolver's actual output lives on the run — see §8.6, and the
reasoning in §7.8.

- `reference_slots jsonb not null default '[]'` — the slot assignment.
- `negative_rules jsonb not null default '[]'` — the rules in force.
- `resolver_version integer null` — null on rows written before this feature.
- `resolution_outcome text null`, `avoid_reference_version_ids uuid[]`, `blueprint jsonb`,
  `plan_model_id text` — legacy proposal fields. They remain readable for historical snapshots but
  are not written by the corrected Creative History path and are never a generation receipt.
- `subject_profile_id uuid null` — the confirmed profile the operator chose.
- `subject_description text null` — the exact confirmed text as it stood at creation, copied rather
  than referenced, so editing a profile later cannot rewrite the record of what was asked for.
- `creative_direction text null` — the operator's own direction.

### 8.6 Changed — `campaign_generation_runs` — what the worker *actually used*

Additive, and the correction recorded in §7.8. A campaign has many generation runs — `generate`,
`revise`, `variants` — resolved at different times against a library that changes between them. One
campaign on staging already has more than one run out of three in total, so this is not hypothetical.

- `reference_slots jsonb not null default '[]'` — legacy grounding slot assignment retained for
  prior runs; corrected runs use the separate Creative History receipt.
- `avoid_reference_version_ids uuid[] not null default '{}'` — deprecated historical field. It is
  readable for old runs and never written by corrected runs.
- `negative_rules jsonb not null default '[]'` — legacy summary retained for old runs. Corrected
  receipts preserve each validated rule, its supporting Rejected Creative History version and human
  reason.
- `resolver_version integer null`, `resolution_outcome text null`.
- `blueprint jsonb null`, `plan_model_id text null` — stage one's parsed art direction and the model
  that wrote it.

Written by one security-definer RPC, **fenced by the run's claim token**, service-role only, and
idempotent on replay. It writes in two phases because the worker learns these facts at two different
moments: the resolution is pinned **before** any model is called, so a run that dies mid-generation
still records what it was about to spend on; the blueprint is added **after** stage one returns.

### 8.7 Storage

The `brand-assets` bucket and its `{organizationId}/{brandAssetId}/{versionId}/source` layout remain
for Products & Subjects and Brand Kit. Creative History uses a separate private `creative-assets`
path. A linked completed Studio render keeps its existing private storage object; the Creative
History version stores a tenant-checked link rather than a copied blob.

### 8.8 Types

`src/lib/supabase/database.types.ts` is hand-maintained; `pnpm db:types` cannot run. All three new
tables are typed there, or listed in `UNTYPED_TABLES`. Another agent is concurrently editing this
file for the recommendations module, so it is touched in a single narrow edit.

## 9. API and events

Routes, organization-scoped, permission-checked, session client only — no service role in any
user-facing path.

- `GET /organizations/:id/assets` — library read, filterable by role, verdict and tag.
- `POST /organizations/:id/assets` — create an asset and reserve its first version. Reuses the
  existing reserve flow.
- `POST /organizations/:id/assets/:assetId/versions` — reserve a further version.
- `POST /organizations/:id/assets/:assetId/versions/:versionId/complete` — read back, re-encode,
  finalize. Reuses `brand-asset-service.ts` unchanged.
- `PATCH /organizations/:id/assets/:assetId` — roles, tags, archive.
- `POST /organizations/:id/assets/reviews` — record a verdict over either subject kind.
- `GET /organizations/:id/assets/resolve` — which of the three outcomes a stated subject reaches,
  and what would be chosen. Read-only, used by the brief, and the same function the worker calls.
- `GET /organizations/:id/subjects` — the confirmed and draft subject profiles.
- `POST /organizations/:id/subjects` — create a subject, optionally requesting a drafted
  description.
- `PATCH /organizations/:id/subjects/:subjectId` — edit, confirm, archive. Confirming is the
  privileged act. `subject.manage` admits all three, and confirmation additionally requires a
  confirming role — `owner` or `admin`, matching the roles this repository already reserves for
  privileged organization acts. A holder of `subject.manage` may therefore draft and edit a
  description without being able to approve it. The seeded description of `subject.manage` still
  reads "create, edit, confirm, and archive", which is true of the permission and incomplete about
  confirmation; the role check is the separate gate.

The two existing `campaigns/brand-assets/uploads` routes are retained and delegate to the new
handlers so nothing already deployed breaks.

New permissions, seeded as data per ADR 0023: `asset.read`, `asset.manage`, `asset.review`,
`subject.manage`.

Events, past tense, identifier-only payloads: `asset.version_added`, `asset.updated`,
`asset.reviewed`, `asset.archived`, `subject.confirmed`, `campaign.reference_set_pinned`.

## 10. AI behavior

- **No model participates in selection.** Candidate eligibility, ordering, caps, exclusions and
  refusal are deterministic, versioned code. A model may interpret selected Rejected Creative
  History evidence into a Blueprint rule, but cannot choose asset identifiers, confirm metadata or
  set a verdict.
- Blueprint receives approved and rejected historical bytes in deterministic, separately typed
  evidence sets. Final generation receives declared-subject/Brand Kit grounding and approved
  historical bytes only; rejected bytes have no final-input type, validation path or adapter role.
- A model writes no verdict, no reason code and no tag in Release 1.
- **A model no longer declares `truth_class`.** It is derived from the resolution outcome, and the
  manifest schema stops asking for it. A generator asserting its own output is authentic was never
  a check.
- A model may **draft** a subject description and its transliteration. It may not confirm one, and
  an unconfirmed draft never reaches a generation. The description a model drafts describes a dish
  the operator named — the model does not choose which dishes exist.
- Reference bytes are the organization's own uploads that passed intake. An uploaded image is data,
  never instruction; no text extracted from an image reaches a prompt in this release.
- No prompt in this release asks for text inside an image, in any script (§7.9).
- **Stage one is a model steering a model, and is fenced structurally rather than by instruction.**
  The blueprint is Zod-parsed at the boundary; its schema has no subject field and no text field; the
  subject is injected after parsing; and the fixed constraints of §7.4 are appended after it. One
  bounded repair pass on a parse failure, then a safe failure — never a fallback to raw text.
- A model does not choose the reference mode. `exact_match` is an operator's decision, gated by
  ownership in code.
- The operator's creative direction steers treatment only. It cannot name a subject, an offer, a
  price or any text, and it is carried as data in a delimited block.
- A validated Blueprint rule carries its registered human reason and supporting rejected-version
  identifier. Review notes remain for humans and are not sent to a provider unless a future governed
  policy explicitly admits them.

## 11. Security and tenancy

- Every read is through the caller's own session so RLS decides visibility. The resolver's
  candidate read is a session read on the request path and a security-definer read with an explicit
  organization check on the worker path.
- A storage path is validated against the tenant prefix before any byte is fetched, as
  `brand-asset-service.ts` already does.
- A review over a `campaign_asset` verifies that asset belongs to the caller's organization before
  writing.
- Reference bytes are fetched by the worker through the service client and are never proxied to the
  browser except as short-lived signed URLs scoped to one object.
- No secret, token or customer PII is logged. Asset labels, tags, notes and subject descriptions are
  operator-authored and are treated as sensitive tenant content. A subject description is a
  commercially sensitive account of what a business sells and never leaves its organization.
- A subject description is operator-authored free text that is sent to a model, which makes it the
  one injection surface this feature adds. It is carried as data in a delimited block, never as
  instruction, and the fixed constraints of §7.4 are appended after it so nothing inside it can
  displace them.
- Archival is the only removal. Hard deletion is refused because it would orphan the provenance of
  approved campaigns.

## 12. Observability

Structured logs and spans carry `organizationId`, `campaignId`, `runId`, `workerId`,
`correlationId` and, where applicable, `resolverVersion`.

Tracked: resolution outcome by code, the split between drawing from a photograph and drawing from a
description, unfilled-slot counts by slot, Creative History selection exclusions, approved-final and
rejected-Blueprint evidence counts, negative-rule count in force, intake rejection rate by reason,
review throughput and rejection rate by reason code, subject profiles confirmed per organization,
and the proportion of generated assets subsequently approved — the outcome measure named in §1.

**The approval rate is reported separately for the two paths.** If drawings from descriptions are
approved at a materially lower rate than drawings from photographs, that is the signal that the
model is the constraint, and it is what §18's escalation trigger reads.

Alerts: a sustained `no_declared_subject` rate for an organization that has confirmed subjects,
which indicates a tagging or naming mismatch rather than missing work; and any generation that
reached the model with neither a reference nor a confirmed description, which should be unreachable
and is a defect if observed.

## 13. Failure states

- **No declared subject** — `insufficient` with `no_declared_subject`. The only blocking refusal in
  this feature. Recovery is to pick or write a subject, offered inline.
- **No photograph of the subject, but a confirmed description** — not a failure.
  `synthesis_permitted`, drawn from the description, marked `synthetic_generated`, and the screen
  says so without apology.
- **A subject exists but its profile is still `draft`** — `insufficient` with
  `subject_not_confirmed`, and the recovery is the confirm action itself. An unreviewed description
  is not a licence to draw.
- **Every candidate rejected** — falls through to synthesis where a confirmed description exists,
  and to `no_declared_subject` where none does. The screen distinguishes "you rejected all of these"
  from "you never had any", because the recoveries differ.
- **Typography requested for a script with no reference** — the slot is left empty and the campaign
  proceeds. It is recorded, because it is the Studio's problem to solve later.
- **Intake rejects an upload** — reported per file with its existing reason code; the batch
  continues.
- **Reference version unreadable at generation time** — the run fails with
  `reference_bytes_unavailable` rather than silently drawing without it. A pinned reference that
  cannot be read is a defect, not a licence to improvise.
- **Reason registry entry retired** — historical reviews keep their codes and render them as
  themselves. A retired code is not selectable for new reviews.
- **Resolver version changed between pin and read** — the pinned set is authoritative. Provenance
  is read, never recomputed.

## 14. Acceptance criteria

- An organization with neither a matching photograph nor a confirmed subject description cannot
  generate imagery at all. The refusal is `no_declared_subject` and offers the subject form.
- An organization with an approved photograph of the dish generates imagery in which that dish is
  recognisably the same dish, the asset's provenance lists the version it came from, and its truth
  class is `synthetic_composite`.
- An organization with **no photograph but a confirmed description** generates imagery of that dish,
  the asset's provenance carries the exact confirmed text, and its truth class is
  `synthetic_generated`. Judged by a Malayali reviewer against the named dish, not by the model.
- `derivedFromBrandAssetVersionIds` is non-empty on every asset generated from a photograph, and
  `subject_description` is non-empty on every asset generated without one. Neither is ever empty
  together.
- `truth_class` is never written by the model, and matches the resolution outcome on every row.
- A draft subject profile cannot produce a generation.
- No generated image in Release 1 contains rendered text in any script.
- A Malayalam tag, an Arabic tag and a Malayalam dish name round-trip through upload, storage,
  search and display unchanged.
- A rejected Creative History review with reasons can change the next Blueprint's validated negative
  rules, but its image bytes stop at Blueprint. The final image prompt sees only the validated rule
  and human reason, never the rejected file.
- **A rejected design never occupies a positive slot or a final image-provider input.** No more than
  five relevant Rejected designs reach Blueprint; no more than three relevant Approved designs reach
  final image generation.
- **The output does not reproduce the human concern that the Blueprint carried forward.** A reviewer
  judges the result against the cited reason — for example, wrong plating — without treating the
  rejected design as final-generation material.
- `exact_match` is refused for an asset whose ownership is `third_party`.
- Every generation pins a parsed blueprint, and a blueprint that fails to parse twice fails the run
  rather than reaching the image model as text.
- A completed Studio poster may be linked into Creative History as Unreviewed and is ineligible for
  later selection until a human confirms metadata and reviews it. A raw plate remains outside
  Creative History.
- A rejection cannot be recorded without at least one reason code.
- Grounding-slot caps hold: no generation receives more than 7 grounding references, more than 1
  brand mark, or more than 3 subjects. Creative History caps hold independently: three Approved
  designs to final generation, five Rejected designs to Blueprint, and twelve validated rules.
- Two resolutions over identical candidate data return byte-identical sets in identical order.
- `syntheticAssetsAllowed` affects only the setting slot and cannot cause a subject to be invented.
- An archived asset is excluded from new resolutions and remains readable in the provenance of
  campaigns that already used it. The same holds for an archived subject profile.
- Editing a confirmed description does not alter the description pinned on an earlier campaign.
- Tenant isolation holds across all three new tables, all new routes, the resolve endpoint, the
  storage paths and the worker read.
- A viewer role can read the library and cannot upload, tag, archive or review.

## 15. Test plan

- **Domain unit** — grounding-slot caps at boundary values; deterministic declared-subject and
  Creative History selection with every tiebreak; the three-way outcome across every combination of
  photograph present/absent and description confirmed/draft/absent; relevance dominance, explicit
  weak-match exclusions, three-Approved/five-Rejected caps and twelve-rule cap; truth-class
  derivation; the re-scoped `syntheticAssetsAllowed`; typography matching and selector/resolver
  version stamping.
- **Application unit** — review validation refuses an empty reason list on rejection and a
  non-empty one on approval; archive excludes from selection; a rejected design re-approved becomes
  an eligible Approved candidate; an Unreviewed design and unconfirmed metadata are ineligible; a
  draft subject profile is refused for generation; confirming requires the permission.
- **Unicode** — NFC normalization on write; case-folded matching that is a no-op for Malayalam and
  Arabic; `char_length` bounds so a 24-character Malayalam tag is not rejected as too long; a tag
  containing a combining mark round-trips byte-identically.
- **Prompt builder** — the fixed constraints of §7.4 appear in every synthesis prompt; a component
  absent from the description is absent from the prompt; no prompt requests rendered text.
- **Provider seam** — Blueprint and final reference parts are ordered deterministically and have
  distinct structural types; Rejected Creative History bytes can reach only Blueprint with their
  human reasons; final generation admits only Approved historical bytes plus grounding and validated
  rules; compile-time, runtime and adapter integration tests prove a rejected byte cannot arrive at
  the final provider; an unreadable pinned reference fails the run rather than degrading it.
- **Blueprint stage** — a valid blueprint parses and is pinned; an invalid one takes exactly one
  repair pass then fails; the schema rejects any attempt to carry a subject or text; the subject is
  injected after parsing and cannot be overwritten by blueprint content; the fixed constraints
  follow the blueprint in the assembled prompt.
- **Route** — permission enforced per verb; a viewer is refused; a cross-tenant asset id in path or
  body is refused; the resolve endpoint returns the same result the worker would compute.
- **pgTAP against staging** — forced RLS on all three new tables; two-organization isolation on
  reviews, profiles and the resolve function; the append-only trigger refuses an update and a
  delete; the reason-code foreign key refuses an unknown code; the verdict/reason CHECK refuses both
  invalid combinations; the confirmed-state CHECK refuses a confirmed profile with no description.
  Understood as staging integration checks, not a hermetic layer.
- **Live proof**, against organization `2dda45b8-82db-4f5f-b17d-611b9bbb7846`, in this order because
  each step depends on the last:
  1. Write and confirm one subject profile for a dish they sell, with its Malayalam name. Generate.
     Confirm by eye that the result is that dish. **This is the path most campaigns will take**, so
     it is proved first rather than last.
  2. Upload a real photograph of the same dish if the client has one, tag it, regenerate, and
     compare the two outputs side by side. If no photograph is available the step is recorded as
     not performed, and the reference path is proved against the fixture organization instead — the
     weaker evidence is stated, never quietly substituted.
  3. Reject one finished design with a reason; confirm the next Blueprint receipt contains the
     rejected evidence and a cited validated rule, while the captured final-provider request has no
     rejected bytes or identifiers.
  4. Remove the subject and confirm the run refuses with `no_declared_subject`.
  5. Confirm every generated image contains no rendered text.

  Recorded redacted under `docs/verification/campaigns/`, including the prompts and the images, so
  the fidelity judgement is reviewable rather than asserted.
- **Model fitness** — the same subject profile generated three times on `gemini-3.1-flash-image`,
  kept as the baseline against which any future move to a pro-tier model is judged.
- **Browser** — Chrome DevTools MCP at 1440×900 and 390×844 for the library, the upload batch, the
  review form, the subject form, the empty state, the brief's three states and the refusal. Malayalam
  and Arabic text rendered at both widths, including in the RTL case. No console errors. Frontend
  work is not complete until exercised at both widths.

## 16. Migration and rollback

The forward-only migration set is additive: the existing grounding tables remain; Creative History
adds folders, items, immutable versions, append-only reviews, performance evidence and pinned
selection receipts, plus private storage and governed functions. No column is dropped, no existing
CHECK is narrowed, and legacy `avoid_reference_version_ids` remain readable but are never written by
the corrected path. There is no retrospective provenance claim.

The one non-additive change is in code, not schema: `truth_class` moves from model-declared to
derived, and the manifest schema stops asking for it. Existing rows keep the value the model wrote.
They are not rewritten, because a retrospective assertion about how an old image was made would be
exactly the kind of claim this specification exists to prevent. The three existing
`synthetic_generated` rows happen to be correct.

Pushed migrations are live for staging immediately; there is no local rehearsal, so the existing
schema is read before the file is written.

Rollback is asymmetric and stated plainly. The new selector, provider seam and prompt builder are a
code/configuration revert; additive tables and receipts remain readable. No rollback may make a
corrected run claim a rejected design was sent to final generation. The re-scoping of
`syntheticAssetsAllowed` remains the separate behavioural change affecting an existing campaign:
reverting it restores the previous permissive outcome, and the duck breast with it.

## 17. Documentation updates

- ADR 0041 — every generation is anchored to a declared subject, with deterministic grounding and
  derived truth class; ADR 0049 — Creative History's Blueprint-only rejected evidence and final
  provider fence.
- `context/05-module-map.md` — the asset library, subject profiles, and the resolver.
- `context/04-domain-model.md` — conditioning roles, subject profiles, verdicts, reason codes,
  truth class.
- `specs/016-campaign-feedback-loop.md` — a note that generation is now subject-anchored.
- `specs/009-restaurant-menu-intelligence.md` — a note that subject profiles are an interim
  stand-in and do not replace menu intelligence.
- `AGENTS.md` §2 — no change needed. "Advise freely, execute narrowly" already covers this: drawing
  a depiction of a dish the client sells is advice, and the fence stays on execution.

## 18. Decisions taken

The three questions this specification opened were answered on 2026-08-24 and are recorded here so
the reasoning survives.

1. **The image model stays `gemini-3.1-flash-image`.** Release 1 is built and measured on it. The
   escalation trigger is explicit rather than a matter of taste: if step 1 of the live proof cannot
   produce a recognisable rendering of a confirmed subject description across three attempts, the
   model is the constraint and a pro-tier image model is evaluated before the acceptance criteria
   are relaxed. The three baseline generations in §15 exist to make that comparison possible later.
2. **A photograph is used when the client has one, and the dish is drawn when they do not.** This
   replaced an earlier and stricter rule in this document that would have refused for want of a
   photograph. The stricter rule mistook the cause: what produced the duck breast was not synthesis,
   it was a model with nothing to draw. §7.4 keeps the useful half of the constraint — something
   must declare the subject — and drops the half that would have blocked ordinary work.
3. **Tags are free text in Release 1, with the Restaurant Pack supplying suggestions**, and Unicode
   throughout. A vocabulary fixed before anyone has tagged fifty photographs would be the wrong
   vocabulary, and a Latin-only one would be unusable for this client on day one.

## 19. Open questions

1. **Who judges fidelity, and how is that recorded?** "Recognisably meen curry" is not a check a
   test can run. §15 puts a Malayali reviewer in the loop for the live proof, but a repeatable
   standard for Release 2 — a small held-out set of dishes with human ratings — is not designed
   here and should be before the Studio spec relies on it.
2. **How many subject profiles does the pilot need before the library is useful?** Four dishes are
   named in Business Memory. A menu has dozens. The recommendation is to write profiles for the
   four the client actually promotes and let the rest arrive as campaigns need them, but this is a
   client-effort question rather than an engineering one.
3. **Does the Restaurant Pack own the fixed synthesis constraints in §7.4?** No alcohol and no
   faces are stated there as platform rules. The first is arguably a restaurant-pack concern and the
   second is not. Splitting them correctly matters the day a non-restaurant organization arrives,
   and not before.
