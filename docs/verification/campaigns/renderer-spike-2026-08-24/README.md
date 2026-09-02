# Renderer spike — 2026-08-24

Evidence for `specs/020-campaign-creative-studio.md` §18.1, the gate that blocked the whole
specification. **Result: passed.**

Stack: `@napi-rs/canvas` 1.0.8 for rendering, `fontkit` for glyph coverage. Fonts registered by
explicit path, never through fontconfig. `spike.mjs` reproduces every image here.

| File | What it proves |
|---|---|
| `1-mlym-reorder.png` | `കേരള മീൻ കറി` — pre-base vowel sign reordered before its consonant; chillu correct |
| `2-mlym-conjunct.png` | `ചിക്കൻ ബിരിയാണി` — `ക്ക` conjunct formed as a true ligature, no visible virama |
| `3-arab-join.png` | `برياني الدجاج` — contextual joining, right to left |
| `4-bidi-mixed.png` | `عرض خاص 49 درهم` — 49 reads as 49, not 94, in correct visual position |
| `5-tofu-control.png` | **The control.** Malayalam in a Latin font: seven empty boxes, drawn silently |

The control is the reason the glyph-coverage check exists. The renderer raised no error and
`measureText` returned 285 — a plausible width. Nothing downstream could distinguish it from a real
render. `fontkit`'s cmap lookup named all seven codepoints before anything was drawn: U+0D15, U+0D47,
U+0D30, U+0D33, U+0D2E, U+0D40, U+0D7B.

Fonts here were read from the system to prove shaping. Task 1 of the implementation plan vendors them
with pinned hashes, because a container's ambient fonts are not an input anybody approved.
