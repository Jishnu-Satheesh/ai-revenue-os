# ADR 0054: AI SDK majors move for the supported search-grounding tool

## Status

Accepted. User-approved fix (2026-09-10) for the systematic provider 400 on
grounded narrations. Implemented as `ai` 5.0.0 → 6.0.280 plus
`@ai-sdk/google` 2.0.0 → 3.0.122, with no source changes: our surface is
`generateText` plus `UserContent`, both unchanged across the bump.

## Context

On 2026-09-10 every grounded narration began failing with HTTP 400
`google_search_retrieval is not supported. Please use google_search tool
instead` — including six consecutive attempts at one gap-fill. Narrations
that filed on 2026-09-09 used the identical call shape successfully: Google
retired the old retrieval tool server-side between the two days, and nothing
in our code changed on that path.

The installed v2 SDK sends the new `googleSearch` tool only when the model
id contains `gemini-2`. Our model (`gemini-3.6-flash`) fell through to the
retired retrieval shape, so every grounded call 400'd deterministically.

## Decision

- Upgrade the pair to `ai` 6.0.280 + `@ai-sdk/google` 3.0.122. Version 3 is
  the smallest release whose tool mapping sends the new `googleSearch` for
  gemini-3 models; version 6 of `ai` is the smallest release whose model
  union accepts it. Version 4 of the provider was tried first and rejected:
  it speaks spec-v4, which the installed `ai` v5 does not accept (ten type
  errors, reverted with zero trace).
- No source changes: typecheck is clean with the call sites untouched, the
  provider unit tests mock at the module boundary and stay green, and
  `google.tools.googleSearch({})` keeps its call shape.
- A one-call live reproduction of the exact failed gap-fill prompt proved the
  fix (advice-shaped JSON, funnel chapter first); the repro script was
  deleted afterwards.

## Alternatives rejected

- Patch the v2 model gate via `pnpm patch` — offered, rejected by the user
  in favour of the supported upgrade path despite the wider blast radius.
- Stay on v2 and drop grounding for gemini-3 — rejected; grounding is the
  Amendment A/B product decision, and ungrounded narration is a regression.
- Jump to `ai` v7 + provider v4 — rejected for now; nothing in v4 is needed
  for this fix, and each major widens the surface to re-verify. Revisit when
  a v4-only capability is actually required.

## Consequences

- All eight Gemini call sites (narrator, judge, growth-intelligence
  synthesis and profile proposals, campaigns generation and drafters) move
  packages together; only the narrator passes tools, so only its wire shape
  changes.
- The worker bundle carries the new SDK only after a Trigger redeploy —
  until then grounded calls keep 400ing. The fence resume fix (migration
  `20260910120000`) is database-side and already live.
- Lockfile churn is confined to the `ai`/`@ai-sdk/google` subtree, verified
  in the commit diff.
