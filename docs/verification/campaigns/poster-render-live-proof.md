# Poster render: live proof

Date: 2026-09-05. Organization `2dda45b8-82db-4f5f-b17d-611b9bbb7846` (the pilot client),
campaign `5f2292f5-946d-4607-87f3-163ac0f3cdb2`, bundle version
`37b0b4d4-ab69-4ba7-9496-366567d833b2`, plate asset `a0dd1ef4-3397-42be-a1aa-afb91dd5261b`.

Dispatched against the deployed prod worker through `scripts/render-poster-proof.mjs`.
This is not a test double: a real Trigger run, real staging rows, real bytes in the
campaign bucket.

## 1. A poster, rendered

Run `run_06g75j6h3nkciuqdtfbfb3eq01` — COMPLETED.

- Template `core_feed_headline` v1, script `Latn`, 1080x1080.
- Render `9fcfddc8-2653-4174-b4ec-9008f30f6a67`, state `rendered`.
- Digest `d3bd58e858be9774024568d7730ce9bab8110b16f6f23bc53faf144532137811`.
- Output hash `4d4d13e3c698eebdfe36cd82fca158b64309a1d85bb328842f3bf43f89399a77`.
- Image: `poster-core_feed_headline-Latn.png`.

The drawn strings, read back from `campaign_poster_renders.text_values`:

| Slot    | Value                                          | Source                  |
| ------- | ---------------------------------------------- | ----------------------- |
| caption | `Savor the rich flavors of our Kingfish Curry.` | manifest `copy.hook`    |
| footer  | `View Menu`                                    | manifest `callToAction` |

Both are quoted from the approved manifest. The model drew the plate and no text.

## 2. A clean refusal, for the right reason

Run `run_06g75jc9f6kgb4mqi9lb7kq501` — COMPLETED, `{"status":"skipped","reason":"copy_unavailable"}`.

Template `core_story_lower` is an `image_story` placement and this version has copy for
`instagram feed_image` only. Before the fix committed today this threw and burned the
retry budget; now it declines and says why.

## 3. Idempotency, demonstrated rather than asserted

Re-dispatching the identical request returned the **same** render id and digest with
`replayed: true`. One row, one object, no duplicate. The render is content-addressed, so
a duplicate delivery recomputes the same digest and the database replays what it has.

## What this does not yet prove

- **No non-Latin poster has been rendered from real data.** This version's copy is
  English; a Malayalam or Arabic render needs manifest copy in those scripts, which does
  not exist for this campaign. Studio Task 11 needs that before a Malayalam reader can
  judge anything. The compositor's own goldens cover the shaping and remain unjudged.
- **No browser acceptance.** There is no Studio surface yet (Tasks 9 and 10).
- **Legibility is not guaranteed by the template.** The text is drawn without a scrim, so
  it reads well on this dark plate and would read badly on a pale one. Worth deciding
  before an operator can pick a template freely.
