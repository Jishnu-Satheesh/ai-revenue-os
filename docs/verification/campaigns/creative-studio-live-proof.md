# Creative Studio — live proof

Recorded 2026-09-06 against hosted staging and the production Trigger worker
(`v20260906.1`, 26 tasks). Nothing here is a local simulation: every poster below
was composited by the deployed worker and read back from the object it wrote.

Supersedes nothing. `poster-render-live-proof.md` records the first English
render; this records the three scripts, the browser gate, and the defects the
gate found.

---

## 1. Three scripts, from copy that really is in those scripts

The Studio renders the words the manifest already carries. It does not
translate, deliberately — so a Malayalam poster needs a version whose copy *is*
Malayalam, and until one existed the Malayalam promise could not be proved
against real data.

`scripts/seed-non-latin-campaign-copy.ts` wrote that version through
`create_campaign_bundle_version`, the same path the generation pipeline uses,
rather than patching a stored manifest. The digest therefore still describes the
document, the version is a successor with a parent, and the function itself
would have revoked any approval standing against the parent. (None stood.)

- Organization `2dda45b8-82db-4f5f-b17d-611b9bbb7846`
- Campaign `5f2292f5-946d-4607-87f3-163ac0f3cdb2`
- Bundle version **v3** `bbc34c36-fee2-4a5e-b487-23a5741ca44c`
- Template `core_feed_headline` v1, 1080×1080

The copy is a **development fixture**, authored by hand for the pilot
organization's own dish. No model produced it and it is not an approved
translation of the English version. A production path for multilingual copy is a
separate question with its own approval consequences.

### Malayalam — `poster-core_feed_headline-Mlym.png`

| Slot | Exact value drawn |
| --- | --- |
| caption | `ഞങ്ങളുടെ നെയ്മീൻ കറിയുടെ സമ്പന്നമായ രുചി ആസ്വദിക്കൂ.` |
| footer | `മെനു കാണുക` |

Render digest `dbfcc1623aa269b9d89fb79cbbd5fa3d2f6b0d4404841acafc35654ff8d647e5`.
Output sha256 `36199bf6f5c4d4320ed018f3bd2fcf521426ffcf5f92696f91fc80fc951e97fa`.

Chosen to exercise the shaping that actually breaks rather than merely to be
non-Latin. The caption carries the conjuncts ങ്ങ, മ്പ, ന്ന, സ്വ and ക്ക; both
strings carry the vowel sign െ, which is stored after its consonant and drawn
before it. A renderer that ignores reordering produces something a reader sees
instantly.

**Still needs a Malayalam reader's judgement.** Claude can see there are no tofu
boxes and that the conjuncts are formed; whether it reads correctly is not
Claude's call.

### Arabic — `poster-core_feed_headline-Arab.png`

| Slot | Exact value drawn |
| --- | --- |
| caption | `تذوق النكهات الغنية في كاري سمك الكنعد.` |
| footer | `شاهد القائمة` |

Render digest `04a7ba19f8ec5b95202c1e2f198f4bb32bac2db0a886350f836109ba36f945ac`.

Laid out right to left with contextual joining throughout, and the template's
footer alignment flips with it. **Still needs an Arabic reader's judgement.**

### English — `poster-core_feed_headline-Latn.png`

| Slot | Exact value drawn |
| --- | --- |
| caption | `Uncover the depths of flavor.` |
| footer | `Explore Menu` |

Render digest `2219bff0729971344154ae2061e8c1021f215da8fbe8c01190d14102233504cb`.

---

## 2. Determinism

The Malayalam render was dispatched a second time with identical inputs.

- Same render digest `dbfcc16…`
- Worker returned `replayed: true` — the database replayed the row it already
  had rather than writing a second one
- Downloaded output byte-identical: sha256 `36199bf6…` both times

That is the content-addressed idempotency working as designed: the render is
deterministic by construction, so the digest is the identity and a repeat is not
a new render.

---

## 3. Browser gate

Chrome DevTools MCP, real Chrome, dev server at `localhost:3000`. Exercised on
organization `9f566f3d-61bd-497f-b77e-76a74f9d07c1`, campaign
`783ab4e1-279d-4fba-8dc1-1a33cd3df2e5`, whose copy is bilingual Arabic and
English — deliberately not the pilot organization, because the pilot's only
member is the client's own account and a test credential does not belong in a
client's tenant.

| Check | Result |
| --- | --- |
| 1440×900 | No horizontal overflow (`scrollWidth` 1440 = `innerWidth`) |
| 390×844, mobile emulation | No horizontal overflow (390 = 390); layout stacks |
| Console errors and warnings | None at either width |
| Accessibility tree | Regions, headings, tablist and alerts all labelled |
| RTL | Values flip to `dir="rtl"` on the Arabic tab; English UI copy does not |
| Template picker | All four core templates listed; the two story templates dimmed with "No stories copy in this campaign." |

Screenshots: `studio-1440-arabic.png`, `studio-390-arabic.png`.

### The full path, driven from the browser

Clicking **Render this poster** on the Arabic tab queued a render through
`POST .../renders`, which dispatched to the production worker, which refused and
recorded why:

```
state:        refused
refusal_code: glyph_not_covered
codepoints:   U+007C | · U+0057 W · U+0065 e · … (20 in caption and footer)
```

That is the correct answer, not a failure. The copy is bilingual — Arabic and
Latin in one string — and the vendored Arabic face covers no Latin letters, so
drawing it would have produced empty boxes. The Studio shows the refusal with a
reason an operator can act on, and the verification panel says "Refused before
verification — nothing was drawn, so there was nothing to check."

---

## 4. Defects the gate found

All four were found by looking, not by reasoning, and all four are fixed.

1. **English explanations were forced right-to-left.** `dir` was applied to the
   whole definition list entry rather than to the value, so "Not supplied."
   rendered with its full stop at the front on the Arabic tab. An Arabic reader
   sees this immediately; an English one does not.

2. **A toast promised something the page does not do.** "This page updates when
   it lands" — nothing polls. Replaced with honest copy and a Refresh button
   that actually reloads the posters.

3. **Story templates vanished instead of explaining themselves.** A template for
   a placement the campaign has no copy for was filtered out. It is now listed,
   dimmed, with the reason — which is what the plan asked for and the harder
   implementation.

4. **The breadcrumb linked a campaign id as an organization id.** Every UUID in
   the path was treated as an organization, so the campaign crumb pointed at
   `/organizations/<campaignId>/overview`. It stayed invisible while the campaign
   was the last crumb, because the last crumb's href is cleared — adding the
   Studio below it made the broken link clickable. Fixed in
   `deriveRouteCrumbs`: only the id directly after `organizations` is one.

---

## 5. The plate editor, exercised for real

`campaign.edit-plate` was registered but never dispatched. It has been now, on
organization `9f566f3d-61bd-497f-b77e-76a74f9d07c1`, against the plate of bundle
version `d5946300-3dbe-4190-9021-eb85ab98b263`.

- Region marked: `x 86, y 86, 302 × 302`
- Instruction: "Make this area of the background a little darker."
- Model: `gemini-3.1-flash-image`
- Successor version `bcfc9710-ca2f-4932-9a2c-a664a147e336`, **v2**, parent
  `d5946300…`, new digest `4af19a8f…`
- Child asset `4d819945-435f-44ba-a9d3-4b68fb3389fa`, written by
  `create_campaign_bundle_version` and read back by row id, as the edit's
  foreign key requires
- Mask stored in `campaign-masks`, edited plate in `campaign-assets`

**The guarantee, measured on the real output rather than asserted.** Comparing
the stored parent to the stored child, excluding a 24px band around the mark to
allow for inward feathering:

```
pixels checked well outside the mark:  926,076
differing outside:                           0
differing inside the mark:      90,755 of 91,204
```

Not one pixel outside the operator's box moved, while 99.5% inside it changed.
That is the compositor doing what the unit tests claim, against a real model
rather than a stub. Files: `plate-edit-edited.png`, `plate-edit-union.png`.

---

## 6. A defect this edit uncovered

The child asset came back **1024×1024** while `campaign_assets` declared the
parent **1080×1080**. Measuring every asset on staging: **14 of 15 disagree with
their own bytes.** The pilot organization's story assets declare 1080×1350 for
images that are 1024×1024 — not merely the wrong scale but the wrong shape.

The cause is in the generation path, not the Studio. A model writes `widthPx`
and `heightPx` into the manifest it proposes, and those are a claim; intake
decodes the bytes and knows the truth. `generate-bundle` already reconciled the
manifest against storage for the content hash — its comment reads "a manifest
whose hash disagrees with what is in storage would produce a digest that
describes nothing" — and the same argument applies to the size and the type,
which were missed. They are reconciled now.

It matters because the dimensions are inside the digest an approval binds to. An
approved manifest was describing an image nobody stored.

For editing specifically, admission ran against the declared size while the
compositor works on decoded bytes. Two sizes for one picture let a region be
admitted that is partly off the real image, and recorded a coverage ratio
computed over a different area than the ceiling checked — so `union_too_large`,
which exists to stop a regeneration being filed as a correction, could be walked
around by arithmetic. The worker now measures before admitting, with the same
decoder the compositor uses.

**Existing rows are left alone.** Correcting a stored manifest changes its digest
and therefore what an approval refers to. That is a decision with approval
consequences, not a repair to make in passing.

---

## 7. What is still open

- **The Malayalam and Arabic posters need their readers.** Section 1 records the
  exact strings beside the images so the judgement is reviewable rather than
  asserted. Claude cannot make it.
- **No scrim behind the text.** The Malayalam poster reads well on a dark bowl;
  the Arabic one sits partly over a pale napkin and reads poorly there. Adding a
  scrim changes every seeded template, so it is a design decision rather than a
  fix.
- **Bilingual copy cannot render in a single-script poster.** Proven above, by
  refusal. Lifting it needs per-run font selection — a change to how text is
  drawn, not to how it is checked.
- **Fourteen stored assets still declare a size their bytes do not have.**
  Generation is fixed, so new versions are correct. Whether to correct the
  existing manifests is a decision with approval consequences — every corrected
  manifest gets a new digest, and any approval against the old one stops
  applying.
