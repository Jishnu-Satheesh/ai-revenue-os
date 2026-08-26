# Creative History Asset Library — Product-Model Correction

**Status:** Approved in chat on 2026-08-26; awaiting written-spec review  
**Corrects:** `specs/019-organization-asset-library.md`  
**Integrates with:** `specs/020-campaign-creative-studio.md`, ADR 0041, ADR 0042

## 1. Why this correction exists

The implemented Asset Library interpreted an asset primarily as a generation ingredient: a product
photograph, subject description, logo, palette or typography sample. That is useful infrastructure,
but it is not the product the user meant by **Asset Library**.

The intended Asset Library is the organization's visual memory. It holds folders of finished work
the organization created before or inside the platform: posters, flyers, social posts, stories,
banners and similar campaign designs. Human review teaches the platform two different things:

- **Approved designs** are positive visual evidence. Relevant files may be sent to the Blueprint
  model and to final image generation with explicit instructions about what may be borrowed.
- **Rejected designs** are negative visual evidence. Relevant files may be sent only to Blueprint
  analysis. The final image generator receives the resulting structured rules and never receives
  rejected image bytes.

The correction retains the valuable subject-grounding, Brand Kit, immutable intake, provenance and
deterministic Studio compositor work. It changes the product boundary, reference-selection model,
and rejected-evidence flow rather than discarding the useful foundation.

## 2. Outcomes

The corrected Asset Library must let an organization:

1. Organize historical and platform-generated finished designs into real folders.
2. Attach scenario metadata at folder and design level.
3. Approve or reject each design, with reasons required for rejection.
4. Reuse relevant Approved work as final-generation style evidence.
5. Analyze relevant Rejected work clinically during Blueprint creation without exposing those files
   to the final image model.
6. Select evidence automatically for agent-initiated campaigns through a deterministic, versioned
   algorithm.
7. Inspect the complete selection, Blueprint and generation receipt later.
8. Feed reviewed generated designs back into the same learning loop.

## 3. Governing decisions

- The Asset Library is **one organization-scoped page** with purpose-based tabs.
- Purpose-specific domain records remain separate underneath the unified page.
- Folders may contain Approved, Rejected and Unreviewed designs together. Verdict is design-level,
  not folder-level.
- Folder metadata supplies defaults; design metadata may add or override values.
- Only confirmed metadata participates in automated selection.
- AI may propose metadata. A human confirms it. AI never chooses a verdict.
- Only reviewed Creative History designs influence a model.
- Approved and Rejected evidence are selected independently and pinned before model spending.
- Approved files may reach Blueprint and final image generation.
- Rejected files stop at Blueprint. This is enforced structurally at the provider boundary.
- Final generation receives at most three Approved historical designs.
- Blueprint receives at most five Rejected historical designs and emits at most twelve avoid rules.
- Agent selection is deterministic and auditable. A model never chooses asset identifiers.
- Generated designs return to Creative History as Unreviewed and influence nothing until reviewed.
- Absence of historical style evidence never blocks generation. Absence of a declared subject still
  blocks under ADR 0041.
- Text remains outside the image model. The deterministic Studio compositor writes current approved
  campaign copy under ADR 0042.

## 4. One page, three purpose-based tabs

### 4.1 Creative History

The primary tab contains finished creative work:

- historical uploads;
- platform-generated posters and social designs;
- real folders and one optional nested folder level;
- design-level metadata, rights, review history and performance evidence;
- filters for verdict, subject, occasion, channel, format, market, language, objective and tags.

The approved working layout has a folder tree on the left, a filterable design grid in the centre,
and a selected-design evidence panel on the right.

### 4.2 Products & Subjects

This tab contains truth-grounding material:

- product and dish photographs;
- confirmed subject descriptions;
- names by script;
- subject exclusions and other factual visual constraints.

These records establish what the campaign depicts. They are not historical style verdicts.

### 4.3 Brand Kit

This tab contains organization-owned brand foundations:

- logos and marks;
- palette references;
- typography references;
- venue imagery and other reusable identity material.

Brand Kit evidence constrains identity independently from whether an old finished design was
Approved or Rejected.

## 5. Creative History records

The exact SQL names are finalized by the implementation plan, but the domain requires these
separate concepts.

### 5.1 Creative folder

A tenant-owned folder carries:

- organization and optional parent folder;
- name and stable identifier;
- confirmed default metadata;
- creator, timestamps and archival state.

Release 1 supports a top-level folder and one optional nested level. Channel and format belong in
metadata rather than deeper directory trees. Folder archival removes the folder's active designs
from future selection without changing past receipts.

### 5.2 Creative item

A tenant-owned item is the stable library identity for one design. It carries:

- folder;
- label and creative type such as poster, flyer, social post, story, carousel or banner;
- source kind: historical upload, completed Studio render or qualified legacy delivered creative;
- confirmed metadata overrides and proposed metadata kept separately;
- rights declaration;
- current version link;
- archival state and audit fields.

### 5.3 Creative version

Each file version is immutable and carries:

- storage object identity or a tenant-checked link to an existing completed Studio render;
- MIME type, byte size, dimensions and content hash;
- intake and safety status;
- creation and source identifiers.

Historical uploads use a new private creative-assets storage path and the existing reserve, upload,
read-back, re-encode and finalize discipline. Completed Studio renders are linked into Creative
History without copying their stored bytes. A raw generated plate is an intermediate campaign asset,
not a finished design, and does not enter Creative History by itself.

### 5.4 Effective metadata

The controlled dimensions are:

- subject or product;
- occasion or season;
- channel;
- placement format and aspect;
- market;
- language and script;
- campaign objective;
- style attributes.

Flexible organization-specific tags supplement these dimensions. Effective metadata is the folder
default merged with item overrides. A campaign receipt stores the effective values it used so a
later folder edit cannot rewrite history.

### 5.5 Reviews

Reviews are append-only and target a creative version. The latest review determines the current
verdict:

- `approved` has no rejection reasons;
- `rejected` requires one or more registered reasons and permits a bounded note;
- no review means `unreviewed`.

An authorized reviewer may confirm a verdict during upload. An uploader without review permission
may propose metadata but the design remains Unreviewed.

### 5.6 Performance evidence

Performance is evidence, not a free-form score. A record or reference must retain comparable
context such as channel, format, objective, metric definition, measurement window and attribution
quality. Verified performance may improve ranking only after scenario relevance clears its
threshold. It cannot make an unrelated design relevant.

### 5.7 Upload-time visual facts

After safe intake, a vision-capable model may extract reusable visual facts: layout density,
hierarchy, contrast, typography treatment, palette, composition and image treatment. The stored
analysis carries its model, version, confidence and source creative version. It is descriptive
evidence, not a verdict or organization policy, and it remains visibly unconfirmed unless a human
confirms corresponding metadata.

An analysis failure does not invalidate a safely ingested file. Blueprint still receives the
selected reviewed file and performs campaign-specific analysis. Upload-time facts reduce repeated
work; they never replace the run-specific comparison of current intent, Approved evidence, Rejected
evidence and human reasons.

## 6. Campaign selection

### 6.1 Normalized request

The campaign supplies a normalized, organization-scoped request containing:

- declared subject or product;
- occasion;
- channel and placement format;
- market and language;
- campaign objective;
- requested style tags;
- policy and rights requirements.

### 6.2 Eligibility

A creative version is ineligible when any of the following is true:

- wrong organization;
- archived folder or item;
- failed or incomplete intake;
- unconfirmed metadata;
- Unreviewed verdict;
- rights insufficient for its intended use;
- explicit metadata incompatibility;
- missing or unreadable bytes.

Approved and Rejected candidates then enter separate selection pools. A Rejected candidate can
never cross into an Approved pool through ranking or fallback.

### 6.3 Versioned scoring

The selector is pure, deterministic and versioned. Its score records separate components for:

1. subject or product relevance;
2. occasion relevance;
3. channel and format compatibility;
4. market and language compatibility;
5. campaign objective compatibility;
6. flexible tag overlap;
7. comparable verified performance, as a bounded secondary bonus.

The implementation constants must preserve these dominance properties:

- exact subject relevance outweighs all lower-priority metadata combined;
- occasion and format relevance cannot be displaced by performance;
- performance cannot lift an asset that failed the relevance threshold;
- a weak match is omitted rather than included to fill a quota.

The Approved selector removes byte-identical and near-duplicate choices, then prefers useful visual
diversity. The Rejected selector prefers scenario relevance plus coverage of distinct human failure
reasons rather than simply taking the newest designs. Stable identifiers break the final tie.

### 6.4 Manual and agent modes

The same selector serves both modes:

- **Manual campaign:** show recommendations, component scores, match explanations and exclusions.
  An authorized operator may pin, remove or replace eligible candidates. Every override is stored.
- **Agent-initiated campaign:** use the deterministic result automatically. No model or random order
  participates. The receipt exposes the same evidence a manual operator would have seen.

### 6.5 Caps

- Approved historical references sent to final generation: zero to three.
- Rejected historical designs sent to Blueprint analysis: zero to five.
- Structured avoid rules emitted by Blueprint: zero to twelve.

These are maxima, not targets.

## 7. Blueprint and generation flow

### 7.1 Pin selection before model spending

The run first pins:

- Approved creative version identifiers;
- Rejected creative version identifiers;
- effective metadata snapshots;
- score components and match explanations;
- exclusions and manual overrides;
- selector version.

A failed run therefore still records what it intended to send.

### 7.2 Blueprint inputs

Blueprint receives:

- campaign and declared-subject context;
- relevant Brand Kit context;
- up to three Approved creative files with positive role instructions;
- up to five Rejected creative files;
- the human reasons attached to every Rejected file;
- upload-time visual analysis where available.

Blueprint performs campaign-specific visual analysis. Its output remains a strict validated object
with no subject field and no rendered-text field.

### 7.3 Blueprint rules

Every negative rule contains:

- the element or treatment to avoid;
- hard or conditional severity;
- a bounded exception condition for a conditional rule;
- human-stated versus model-inferred origin;
- supporting rejected creative version identifiers;
- attached human reason codes;
- confidence for model-inferred observations.

Human reasons are authoritative. A model may describe a visual symptom but cannot invent
organization policy. A hard rule cannot be relaxed. A conditional exception is valid only when the
current campaign explicitly requires it.

### 7.4 Final image-generation inputs

Final generation receives:

- the declared subject photograph or exact confirmed description;
- relevant Brand Kit inputs;
- up to three Approved historical creative files;
- per-file instructions limiting what may be borrowed;
- the validated Blueprint, including its structured avoid rules;
- fixed subject, safety and no-rendered-text constraints appended last.

Approved historical designs may teach composition, spacing, palette, mood, lighting and image
treatment. Their old words, prices, offers, calls to action, legal copy and logos must not be copied.

The final provider input type has no Rejected-file field. Rejected bytes are unavailable to that
adapter by construction, not merely excluded by prompt wording.

### 7.5 Studio composition and feedback

The image model produces a text-free plate. The Studio compositor applies current approved copy,
logo and template layers deterministically. The completed design is linked into Creative History as
Unreviewed with its campaign, Blueprint and generation receipt. A later human verdict makes it
eligible for the appropriate side of the learning loop.

## 8. User experience

### 8.1 Creative History workspace

The approved screen contains:

- purpose tabs;
- folder tree and folder defaults;
- search and scenario filters;
- verdict chips without verdict-based folder fragmentation;
- design grid with visible current verdict;
- evidence panel showing effective metadata, review history, rights, source, performance and future
  eligibility.

### 8.2 Upload

1. Choose or create a folder.
2. Upload one or many designs.
3. Apply folder defaults.
4. Receive AI metadata suggestions.
5. Confirm or correct each design's metadata.
6. Confirm a verdict when authorized, or leave it Unreviewed.
7. Require structured reasons for every rejection.

Bulk metadata and movement are allowed. A bulk rejection must still attach reasons to every affected
design.

### 8.3 Campaign reference picker

The manual picker shows separate Approved and Rejected evidence sets, selection scores, matched
metadata, comparable performance evidence and predicted Blueprint usage. Operators can change
eligible selections before generation. Agent campaigns use the same algorithm without an
interactive step and remain inspectable afterward.

## 9. Permissions, tenancy and audit

- `asset.read` reads folders, files, metadata, reviews and receipts through the session client.
- `asset.manage` creates folders, uploads, confirms metadata, moves items and archives.
- `asset.review` approves or rejects.
- Campaign permissions continue to govern generation and campaign review.
- Worker reads use narrowly scoped, organization-checked functions and pinned identifiers.
- Every table is tenant-owned where appropriate, RLS-enabled and forced, with composite tenant
  foreign keys where records cross tables.
- Uploaded bytes remain private and untrusted until successful read-back and re-encoding.
- Rights must be declared as owned or suitably licensed before an Approved file can reach final
  generation.
- Folder changes, metadata confirmation, review acts, rights changes, selector receipts, Blueprint
  evidence and manual overrides are audited with identifier-only payloads.
- Assets archive rather than delete. Historical receipts remain readable.

## 10. Failure behavior

- No relevant Approved creative: continue without a historical style file.
- No relevant Rejected creative: Blueprint runs without historical rejection evidence.
- No declared subject: refuse with `no_declared_subject` under ADR 0041.
- Unreviewed or unconfirmed metadata: explain why the asset is ineligible.
- Unreadable pinned file: fail safely rather than silently omit promised evidence.
- Blueprint validation failure: one bounded repair attempt, then fail.
- Rights unavailable: exclude from final-generation eligibility and explain the exclusion.
- Cross-tenant identifier: return the same unavailable response as a missing identifier.
- Performance evidence not comparable or insufficiently attributed: omit the performance bonus and
  retain the reason in the selector receipt.

## 11. Forward-only correction

### 11.1 Documentation

- Revise Spec 019 around this product model.
- Update Spec 020 at the Blueprint/final-generation input boundary.
- Add a new ADR that supersedes ADR 0041's rejected-file routing while retaining its declared-subject
  decision.
- Replace the superseded Asset Library implementation plan before feature code resumes.

### 11.2 Database and storage

Additive migrations introduce creative folders, items, versions, metadata, rights, qualified
performance evidence and run-scoped selection receipts. Existing subject profiles, Brand Kit
records, product photographs, reviews and campaign assets remain intact.

Existing `avoid` receipt fields remain readable for historical runs but are deprecated and are not
written by corrected runs. New fields distinguish Approved final-generation references from
Rejected Blueprint evidence.

The un-applied migration whose purpose was to expose Rejected candidates to final-generation
`avoid` routing is superseded and must never be applied.

### 11.3 Application evolution

- Keep the declared-subject resolver for truth grounding.
- Add a separate versioned historical-creative selector.
- Rewire Blueprint to receive both Approved and Rejected creative evidence.
- Rewire the final provider to accept Approved evidence and structurally reject Rejected bytes.
- Reorganize the existing Asset Library UI into the approved purpose tabs.
- Backfill existing completed Studio renders as Unreviewed Creative History entries without copying
  blobs. A legacy campaign asset may be admitted only where stored evidence identifies it as the
  finished creative delivered to the client; raw plates are never backfilled merely because they
  exist.

### 11.4 Rollout

The corrected path is feature-gated until its schema, selector, provider separation, browser flow
and staging proof pass. No destructive staging cleanup is required. Each migration follows the
board's draft, independent review, apply-to-staging and first-call verification gate.

## 12. Acceptance criteria

1. An organization can create a folder, apply default scenario metadata, upload multiple designs
   and confirm design-level overrides.
2. A folder can contain mixed Approved, Rejected and Unreviewed designs without moving them into
   verdict folders.
3. AI metadata suggestions influence nothing until a human confirms them.
4. A rejection cannot be stored without at least one registered human reason.
5. An agent-initiated Ramadan Chicken Mandi campaign deterministically selects the same eligible
   evidence from the same stored inputs and selector version.
6. Scenario relevance dominates verified performance in every ranking test.
7. No weak candidate is selected merely to fill a cap.
8. No more than three Approved historical designs reach final image generation.
9. No more than five Rejected historical designs reach Blueprint.
10. Blueprint negative rules cite their supporting Rejected designs and human reasons.
11. A hard negative rule cannot be relaxed; a conditional exception requires an explicit campaign
    condition.
12. Rejected image bytes are absent from the final provider input at the type, domain and integration
    test layers.
13. Old copy, prices, offers, calls to action and logos from Approved historical designs are not
    requested from the image model; current approved text is composited later.
14. Manual reference overrides are permission-checked, pinned and audited.
15. A generated design enters Creative History as Unreviewed and affects no later campaign until a
    human reviews it.
16. Archiving or editing folder metadata cannot change a prior generation receipt.
17. Existing historical receipts remain readable after deprecated `avoid` fields stop being written.
18. Tenant-isolation tests prove one organization cannot list, select, fetch or cite another's
    folders, designs, metadata, reviews or files.
19. Browser acceptance passes at desktop and mobile widths for all three tabs, upload, review,
    reference selection and receipt inspection.
20. Staging proof captures the Blueprint request, final provider request, pinned receipt and output,
    demonstrating that Approved bytes reached final generation and Rejected bytes did not.
21. Upload-time visual facts remain attributable to their model and source file, cannot create a
    verdict or policy, and do not replace campaign-specific Blueprint analysis.

## 13. Explicitly superseded statements

The corrected Spec 019 and ADR must no longer claim that:

- arbitrary operator-created folders are out of scope;
- UI-only role/verdict groupings satisfy the requested folder model;
- Rejected images travel to final generation in an `avoid` slot;
- Blueprint and final image generation receive the same reference set;
- the newest Rejected assets are sufficient negative selection;
- Unreviewed creative designs may fill positive style slots;
- rejection reason codes alone are the complete learning substrate.

## 14. Non-goals

- A general-purpose document drive.
- Video or audio analysis in this correction.
- Model-selected verdicts or asset identifiers.
- Autonomous publishing.
- Copying third-party creative or previous campaign text.
- Replacing the declared-subject rule, truth classes or deterministic text compositor.
- Treating raw engagement as verified business performance.

## 15. Open questions

None. The product, evidence-flow, UI, governance and migration decisions in this document were
approved in the preceding design dialogue.
