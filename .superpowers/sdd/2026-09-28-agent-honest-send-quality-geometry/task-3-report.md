### Task 3: Answer quality (G3) — report

## Implementation

**`src/modules/agent-chat/application/answer-writer.ts`** (prompt rule only)
- `buildSynthesisPrompt` system gains one line: never restate org identity basics
  (name/industry/country) unless the turn asks — lead with the news, not the masthead.
  Applies to both tiers (same system builder for quick + deepthink).
- `buildFallbackAnswer` gains a guarding comment (no behavior change): fallback bodies
  stay identity-free by construction (fixed one-liners, no pack interpolation); identity
  facts travel in `citations` only, and must keep doing so.

**`src/modules/agent-chat/application/thread-service.ts`** (honest SKIP, per binding #2 —
no new RPC, no migration, no update path, no deletes)
- New exported `findTurnAssistantRow(messages)`: latest `assistant` row after the latest
  non-answers `user` message. Answers rows are turn metadata, not new turns, so the scope
  skips `[answers …]` bodies (same prefix check the answers route already uses).
- New `reuseTurnAnswer(message)`: returns the kept row as the turn message (`replayed: true`)
  with the draft parsed back out of the durable body (round-trips the writer encoding);
  an unreadable row degrades to the honest general fallback, never a route failure.
- `routeLatest` takes an optional `reuseAnswer` (direct routes never pass it): present →
  return the kept row, absent → synthesize exactly once as today. Classification, routed
  event, research auto-run, and route-dedup storage are unchanged, so replays still
  rehydrate the kept row through the existing `<answersKey>:reroute` token.
- `submitAnswers` lists the turn (limit 50) before appending and passes the kept row
  through. Turn with a row → zero assistant appends; turn without → exactly one, as today.

**`src/components/agent/agent-drawer.tsx`** (Marker receipts, no raw echo)
- Any message with `questionnaireAnswers` or an `[answers …]` body (any role — history
  rows included) renders as a `You clarified: <one-line summary>` Marker with a CheckIcon;
  the summary comes from the structured record or the body's `key: value` lines. Raw
  `[answers …]` text reaches the DOM nowhere (message list, saved block, confirmation).
- The old `Saved answers:` block is deleted (its rows are now inline Markers, so history
  rows render once, not as an empty card plus a receipt line). `formatAnswers` stays as
  the one-line summary builder; its raw render call-sites are gone.
- Saving state is a `Marker role="status"` containing `Saving answers…` plus a `Skeleton`
  (existing skeleton usage); the answered card hides while its save is in flight and
  returns retryable on failure.
- `lastSaved` renders as the same `You clarified: …` Marker.

**Spec line (isolated hunk, `docs/superpowers/specs/2026-09-24-universal-ai-agent-design.md` §10.1)**
- One bullet: answers re-route reuses the turn's existing assistant row (exactly one
  assistant row per turn; replays return the kept row); saved answers render as
  `You clarified: …` Markers, never raw text; answers never restate identity basics
  unless asked.

**Tests**
- `answer-writer.test.tsx`: system prompt asserts the identity rule on both tiers;
  fallback-guard asserts no pack fact statement appears in any fallback body (null, plain,
  refused packs × five reasons) while citations still carry the facts; re-route asserts
  reuse (no synthesis call, zero assistant appends, kept row returned with `replayed: true`
  and its parsed draft), synthesize-once (one call, one append, `replayed: false`), and
  replay (same key → one synthesis total, kept message id, `replayed: true`).
- `thread-service.test.ts`: `findTurnAssistantRow` unit cases (latest ask wins, answers rows
  skipped, null with no row / no ask, latest turn wins).
- `agent-drawer.test.tsx`: old raw-text assertions flipped to `You clarified:` (row +
  confirmation = 2 Markers); new tests assert both Markers + zero raw `[answers` text in
  the DOM, and card-hide-behind-shimmer (Marker + Skeleton) during save; the hanging-save
  test now asserts the confirm error is absent entirely (card unmounted, not just valid).

## Tests + RED/GREEN evidence

Command (worktree root):
- `pnpm vitest run src/modules/agent-chat/application/answer-writer.test.tsx src/modules/agent-chat/application/thread-service.test.ts src/components/agent/agent-drawer.test.tsx`
- Wider agent scope: `pnpm vitest run src/components/agent src/modules/agent-chat`

RED (tests first, implementation untouched) — output tail:
- `Test Files  3 failed (3)` / `Tests  14 failed | 181 passed (195)` — the 5
  `findTurnAssistantRow` cases (no export), the reuse test, the identity-prompt test, and
  the 7 drawer assertions (5 flips + 2 new). The synthesize-once, replay, and fallback-guard
  tests already passed pre-implementation by design (they pin behavior that held).

GREEN (after implementation) — output tail:
- `Test Files  3 passed (3)` / `Tests  195 passed (195)`.
- Wider scope: `Test Files  13 passed (13)` / `Tests  376 passed (376)`.

Gates:
- `./node_modules/.bin/eslint` on all 6 touched source/test files: clean (the `rtk lint`
  wrapper in this environment shells to a global ESLint 6.4.0 with no project config, so
  the repo's own ESLint 9 binary was invoked directly — same config, same result).
- `pnpm typecheck` (`tsc --noEmit`): **fails on the same pre-existing, unrelated error as
  Task 2** — `.next/dev/types/.../stream/route.ts` (`setStreamRouteTestSeams` vs
  index-signature constraint). None of my files produce type errors.
- Prettier is not a gate (repo-wide dirty, including untouched files); my hunks match the
  surrounding committed style.

## Files changed (commit is path-limited to these 8)

- `src/modules/agent-chat/application/answer-writer.ts`
- `src/modules/agent-chat/application/answer-writer.test.tsx`
- `src/modules/agent-chat/application/thread-service.ts`
- `src/modules/agent-chat/application/thread-service.test.ts`
- `src/components/agent/agent-drawer.tsx`
- `src/components/agent/agent-drawer.test.tsx`
- `docs/superpowers/specs/2026-09-24-universal-ai-agent-design.md` (§10.1 hunk only)
- `.superpowers/sdd/2026-09-28-agent-honest-send-quality-geometry/task-3-report.md`

Untouched per constraints: answers/route/dispatch/stream routes, contracts, executors,
questionnaire-card, response-message, shell, placement, thread-repository. No
schema/migration/event/dependency changes. No stash, no push.

## Self-review

- Binding #2 held literally: SKIP, not replace — the re-route synthesizes nothing when the
  turn has a row, and the visible result is exactly one assistant row per turn with zero
  schema change. The answers route file needed no edit (it calls `service.submitAnswers`).
- Tenant isolation: the extra `listMessages` read is organization-scoped through the same
  repository; no bodies logged (reuse path logs nothing new); drafts derive from the
  caller's own durable row.
- Blast radius: `routeLatest`'s new param is optional and only `submitAnswers` passes it;
  direct routes, viewers, dispatch, research auto-run, and dedup/replay semantics are
  byte-identical otherwise (suites green). The drawer branch reorder (receipts before
  role) only diverts rows that carry answers data, which previously rendered raw/empty.
- Realized-result claims: none made; copy states current-state receipts only.

## Concerns / follow-ups

1. **One extra read per answers submit** (`listMessages`, limit 50) to find the kept row.
   Small and scoped, and it is what keeps the zero-schema-change constraint. If answers
   submits ever need to avoid it, the row id could travel in the submit body — but that
   would be client-trusted turn scope, so the server read is the honest version.
2. **`pnpm typecheck` is red on main** for the stream-route generated-types error above.
   Pre-existing and unrelated (Task 2 flagged the same), but worth repeating since gates
   otherwise pass.
3. **`threadTitleFor` still reads raw bodies** for the drawer title (first user message).
    Harmless in practice (an answers row is never the first user message), but if a thread
    ever opens with one, the title would show raw text — a one-line follow-up if it matters.

## Fix round 2 (2026-09-28) — lane-gate 500s on the peer answers route

- **Actual throw (read, not guessed):** `TypeError: deps.threads.listMessages is not a function`,
  from the G3 pre-append turn read in `submitAnswers` (`thread-service.ts`). The peer
  answers-route mocks predate that read (no `listMessages` key), so all 8 submits that reach
  `submitAnswers` threw → route catch → 500. Reproduced with a throwaway service-level repro
  (missing-method mock, printed `TypeError` + message), then deleted it.
- **Fix (`thread-service.ts` only, prod):** the turn read is wrapped in try/catch; any read
  failure degrades to "no reusable row" (`keptTurnRow = null`) and the re-route synthesizes
  once — the exact pre-G3 behavior. One structured identifier-only warn
  (`agent_thread.turn_read_degraded`, no bodies) per the file's F2 convention. No B3/ideas/
  draft semantic change; peer test file untouched (option (c) not needed — the mocks pass
  as-is through the degradation path).
- **Pin (`answer-writer.test.tsx` only, test):** "degrades an unavailable turn read to
  synthesize-once instead of failing the submit" uses the exact peer shape
  (`listMessages: undefined`) and asserts submit success + exactly one synthesis + one
  assistant append + `replayed: false`.
- **Evidence:** peer `answers/route.test.ts` 19/19; G3 trio green
  (`answer-writer` 47 + `thread-service` 44 + `agent-drawer` 106); wider
  `src/components/agent` + `src/modules/agent-chat` 13 files / 379 passed. ESLint 9 on both
  touched files: clean. (One transient esbuild service crash under a parallel run, plus one
  self-inflicted dropped `it(` line mid-edit — both resolved; suites re-ran green after.)
