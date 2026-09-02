# Campaign Creative Studio — thread initiation prompt

Copy everything below the line into the new thread as its first message.

---

You are picking up the **Campaign Creative Studio** (spec 020) in
`/home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence`, branch
`feat/governed-channel-intelligence`. This thread owns spec 020 only. A separate thread owns the
Organization Asset Library (spec 019) and is mid-implementation; do not take work from it.

## Read these first, in this order

1. `AGENTS.md` — binding. Note §10, multi-agent coordination.
2. `docs/collaboration/asset-library-and-studio-board.md` — the shared board. Three agents work in
   this one tree. Claim files there before opening them, and log what you find.
3. `specs/020-campaign-creative-studio.md` — approved 2026-08-24.
4. `adrs/0042-the-model-draws-and-the-platform-writes.md` — the governing decision.
5. `docs/superpowers/plans/2026-08-24-campaign-creative-studio-implementation.md` — the approved
   plan, 12 tasks.
6. `adrs/0041-every-generation-is-anchored-to-a-declared-subject.md` — spec 019's decision. You need
   it because the Studio composes over the plate that 019 produces.

## The one-sentence version

An image model draws food convincingly and spells badly; a layout engine spells perfectly and cannot
draw food. So the **plate** — the photograph, carrying no text at all — comes from the image model,
and every visible **word** is composited by deterministic code from a value the manifest already
approved. The offer reads AED 49 because the manifest says AED 49, not because a generator recalled
it.

The client is a Kerala restaurant in Dubai publishing in Malayalam, English and Arabic.

## What is already done — do not redo it

**Task 0, the renderer spike: passed.** This was the gate that blocked the whole specification.
Evidence and a reproducible script are in
`docs/verification/campaigns/renderer-spike-2026-08-24/`.

- **`@napi-rs/canvas` 1.0.8 renders; `fontkit` answers coverage.** Fonts are registered by explicit
  path — never through fontconfig.
- Verified correct by a Malayalam reader: conjunct ligatures, pre-base vowel reordering, Arabic
  contextual joining right-to-left, and Latin digits inside an Arabic sentence in correct bidi order.
- **The control case is the thing to remember.** Malayalam drawn in a Latin font produced seven empty
  boxes *silently* — no error, and `measureText` returned a perfectly plausible width. Nothing
  downstream could tell it from a real render.
- **Correction already applied to the spec:** glyph coverage is a **cmap question, not a renderer
  question**. §18.1 originally disqualified any renderer that could not report unmapped codepoints;
  that was wrong and is withdrawn. Coverage lives in its own `fontkit` module.

**Task 1, fonts as pinned inputs: done** (commit `9bb2876`, 17 tests).

- Three Noto faces vendored in `assets/fonts/`, pinned by SHA-256.
- `src/domain/campaigns/font-manifest.ts` — pure: the manifest, `fontManifestDigest()` for inclusion
  in the render digest, and `verifyFontHashes()` which takes observed hashes and returns problems.
- `src/modules/campaigns/infrastructure/font-assertion.ts` — reads the disk and **throws** at worker
  start on any mismatch. It throws rather than warns because the failure it guards is silent.
- An **undeclared** font file counts as a problem too, not just a missing or altered one.
- `@napi-rs/canvas` is in `package.json` and in `trigger.config.ts` `external`, with a `knip.json`
  ignore entry because nothing imports it until Task 4. That is deliberate and documented.

## Start at Task 2

Task 2 is the schema: `campaign_poster_templates`, `campaign_poster_renders`,
`campaign_plate_edits`, the optional `posterPlan` on the bundle manifest, and the `campaign-masks`
bucket.

Tasks 2, 3, 4, 6 and 7 do not depend on spec 019 landing — they need *an* image, not that image.
Only the studio surface and the live proof genuinely wait on it.

## Hard-won facts, so you do not rediscover them

- **There is no local database, and there will not be one.** The only database is hosted staging.
  A pushed migration is live for everyone immediately; there is no rehearsal. `pnpm db:types` cannot
  run — `src/lib/supabase/database.types.ts` is hand-maintained.
- **Identify the worker with `pg_catalog.current_setting('role', true) = 'service_role'`.** Not a JWT
  claim, and **not `current_user`** — inside a `SECURITY DEFINER` function `current_user` is the
  function owner, so that check never matches. This was learned the hard way; see the board's
  2026-08-24 correction.
- **`jsonb_object_length` does not exist on this Postgres.** Use the `jsonb_object_keys` count
  pattern.
- **Register every new Trigger task.** Five campaign workers in `src/workflows/campaigns/` are
  written, tested and never registered in `src/trigger/campaigns.ts`, so they cannot run at all.
  Spec 020 adds two more; do not make it seven.
- **A migration must be called once against staging before its task is done.** plpgsql resolves
  record fields at execution time, so a function naming a missing column applies cleanly and fails on
  its first real call. That has happened twice on this project.
- Known pre-existing flake: `src/workflows/reports/pdf-text-layer.integration.test.ts` times out
  under full-suite load. Do not touch it.
- `git push` is the user's step. There are no credentials and no `gh` here.
- Never `git stash` — the stack is shared across worktrees and sessions.

## Do not touch

`src/modules/analysis`, `src/components/analysis` (a third agent), and anything the Asset Library
thread has claimed on the board — currently the `src/domain/campaigns/asset-library.ts`,
`reference-resolution.ts`, subject-profile and provider-seam files, plus
`supabase/migrations/20260825090000_*` and `20260825110000_*`.

`src/lib/supabase/database.types.ts` is contended three ways. Edit it in one narrow commit, in and
out.

## How to work

Follow `AGENTS.md` §3: propose a lean plan, explain the real-world impact, get approval, write code,
run tests. TDD per the plan — failing test, verify it fails for the stated reason, implement, verify
it passes, commit at the task boundary.

The user prefers plain English with no jargon, and a real-world analogy when explaining a problem.
State uncertainty plainly rather than hedging, and say what you actually verified rather than what
you assume.

Begin by reading the documents above and telling me what you find, then propose Task 2.
