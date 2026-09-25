# Creative Studio provider qualification plan

Status: APPROVED for implementation 2026-09-25 (Tier 3 "implement this plan").
Owner: Task 1 implementer. This plan authorizes no provider call and no spend by itself.

## 1. Budget cap

- Default cap is $0: no paid provider call runs until the user states an explicit authorized
  qualification budget. Record the authorized amount, currency, and date here before Task 1
  spends anything. No implicit nonzero budget and no live-organization settings are seeded
  for convenience.
- Every run records reserved minor units, actual cost minor units (null when unknown, never
  zero), and remaining budget. Unknown paid outcomes enter reconciliation; no blind retry.

## 2. Candidate order

1. OpenAI Responses API with image-generation tool (first prospective provider: documented
   `partial_image` events and `previous_response_id` continuation). Requires a new
   adapter/dependency and credentials — explicit Task 1 scope, not assumed present.
2. Gemini via the installed `@ai-sdk/google` 3.0.122 (documented image deltas, not proven
   independently displayable progressive frames of one image).

A provider that cannot prove BOTH progressive frames AND same-model continuation is rejected
for this workflow. Never trade one requirement away silently.

## 3. Qualification matrix (bounded, Task 1 executes)

- Ratios 4:5, 1:1, 9:16 with supplied copy, product image, approved-design reference, and
  channel-logo substitution; typographic and multilingual fixtures representative of
  intended use; human inspection of spelling, logo, and product fidelity.
- Per run record: event timestamps/types, per-frame index/hash/dimensions for each actually
  independently decoded preview and final; time-to-first-preview; preview count; usage/cost.
  No prompts, raw copy, image bytes, secrets, or continuation tokens in logs.
- Fresh-process reload, then two contextual marker edits including a branch from an older
  version; pinned exact image model throughout; ordered replay parts/signatures or
  server-side lineage proven, hidden reasoning never stored or shown.
- Failure probes: definite refusal vs unknown timeout, malformed/oversized frames,
  interruption, expired continuation, unavailable pinned model, oversized multi-reference
  request. Safe recovery without silent context loss or duplicated paid work.
- Tenant pre-checks: cross-organization IDs and revoked/changed approvals refused before
  private bytes leave the application; output stays unreviewed until human review.

## 4. Pass/fail

PASS requires: at least one real, independently decoded, visibly displayed pre-final image
on generation; continuity after reload; same-model contextual edit; measured costs within
the authorized cap. A fast response yielding only a final image is saved honestly with a
`missing_progressive_preview` anomaly and does NOT pass progressive acceptance; repeated
absence disables the profile pending investigation. If no provider passes, record a blocked
capability — do not downgrade the requirement.

## 5. Environment evidence (Task 0 preflight, 2026-09-25)

| Item | State |
| --- | --- |
| Staging connection | Reachable (read-only `pnpm db:migrations:list` returned rows) |
| Applied migration head | `20260924090000`; local-only `20260924120000`, `20260924130000` unapplied |
| Proposed Studio timestamps | `20260921130000/140000/150000/160000` filename-free; older than applied head, so they will apply out-of-order — additive-independence check owed at each task's dry-run |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Present (no value recorded) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Empty in `.env.local` — OpenAI-first qualification needs credentials before Task 1 provider calls |
| `TRIGGER_SECRET_KEY` | Present; `trigger.config.ts` + `@trigger.dev/sdk` 4.6.0 configured, dev runner not started in preflight |
| Test orgs A/B + operator/viewer roles | Absent (`E2E_*` vars not in `.env.local`) — must be seeded/verified before Task 1 authorized runs and Task 8 browser acceptance |
| Private storage | Not probed in preflight; new `studio-*` buckets are Task 3 scope; existing-bucket policy checks ride with Task 4 |
| Chrome DevTools | Not available in the Task 0 session (design-time bridge `127.0.0.1:4318` unreachable) — browser: not applicable (preflight) |
| Cost authorization | None on record — blocks provider steps only; read-only preparation (Tasks 0/2) proceeds |
| Packages | next 16.0.10, react 19.2.0, typescript 5.7.2, zod 4.0.0, @supabase/supabase-js 2.50.0, @trigger.dev/sdk 4.6.0, @ai-sdk/google 3.0.122 |
| Trigger/Supabase skills | Read 2026-09-25 (fix round 1): project `trigger-authoring-tasks` (SDK-pinned authoring rules) + project `supabase` (CLI/MCP/RLS checklist); inform Task 1 adapter and Task 3/4 migration work |

Migration timestamp allocation (final, fix round 1, 2026-09-25): proposed timestamps 20260921130000/140000/150000/160000 are verified filename-free against the current tree and are ALLOCATED as final — no rename. Supabase applies pending migrations in version order regardless of the applied head, so temporal order is not a filename collision; each task's dry-run must still confirm additive independence before push.

Missing cost authorization and missing OpenAI credentials block Task 1 provider calls only.
Missing E2E fixtures block Task 8 browser acceptance only. Neither blocks read-only
preparation work.
