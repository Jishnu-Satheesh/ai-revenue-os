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

## 5. What is still open

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
- **`campaign.edit-plate` has not been exercised end to end.** It is registered
  and live in production, and its adapters are wired, but no real edit has been
  dispatched. The compositor guarantee is proved by test against a hijacked
  model; the provider round trip is not yet proved against the real one.
