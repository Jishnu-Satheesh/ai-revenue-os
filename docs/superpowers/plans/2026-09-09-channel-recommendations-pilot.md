# Channel Audit Recommendations Pilot — Customised Insights (Cancellations + Availability)

User-approved pilot. Scope locked by Q&A on 2026-09-09:
- Sections: Cancellations Financial Impact + Operating Availability Heatmap only.
- Context source: stored org + channel record.
- Web: curated web + docs, official-docs-first (live Brave transport does NOT ship
  in this repo yet — fixtures only — so this plan ships a prepared web-evidence
  slot fail-closed plus curated Talabat playbooks now; live search is a follow-up).
- Steps: 3–5 per card, merged into advice (supportedActions/detail text, no new UI block).
- Safety: portal steps framed as checks, never claims about portal structure; headline/detail
  stay cited; URLs/domains copied only from fenced evidence, never invented.

## Global Constraints (binding on every task)

- Worktree: `.worktrees/governed-channel-intelligence`, branch `feat/governed-channel-intelligence`.
- TypeScript strict mode. Zod at every external/AI boundary. No `any` without justification.
- No model tool calls: `generateText` with system+prompt strings only. Web/playbook content
  arrives as fenced DATA in the worker, never as model-retrieved tools.
- PII redaction: only display names, keys, template keys, categories, industry, country,
  timezone, currency reach the prompt. NEVER service_area blobs, contact_details,
  addresses, phones, emails, order notes, review text.
- Tenant isolation: every new read scoped by organization_id (+ analysis_run_id where
  applicable). User-facing paths never use service role; worker uses existing service
  client pattern with fenced RPCs.
- Determinism: prompt builder stays pure (no I/O/clock/randomness); same inputs →
  byte-identical prompts. Playbook selector pure and versioned.
- Prompt version: RECOMMENDATION_PROMPT_VERSION becomes 5 with comment. Max 6 items/run
  and max 5 supportedActions/limitations unchanged.
- No migration, no new env keys, no new events in this pilot. Sources stay inside
  supportedActions/detail text (no new sources column).
- Never `git stash`. Never push (user's step). Path-limited commits only; leave the
  collaboration board UNSTAGED at commit (controller preserves it).
- Tests before done. Typecheck clean. Lint clean on touched files.

## Task 1 — Prompt v5 + curated playbooks (pure layer)

Files:
- `src/domain/analysis/recommendations.ts` (verify version 5 + comment; already bumped in worktree)
- `src/workflows/analysis/recommendation-prompt.ts` (add channel-context, playbook-guidance,
  web-evidence blocks; pilot gating; 3–5 step instruction for pilot; URL honesty rules)
- `src/workflows/analysis/channel-playbooks.ts` (NEW pure module; already drafted in worktree —
  verify/complete: versioned Talabat closed-cancellation + availability + generic fallback,
  3–5 steps each, steps as checks, no menu-path claims, no URLs)

Requirements:
- New exported types: NarrationChannelContext, PlaybookGuidanceItem (or reuse), WebEvidenceItem.
- PILOT detector set: orders.cancellation_loss, orders.cancellation_attribution,
  operations.closed_share. Non-pilot runs render exactly the v4 shape (no new blocks).
- Channel block renders display names/keys/category/industry/country/timezone/currency only.
- Playbook block renders title + steps + sourceLabel, sorted deterministically, capped.
- Web-evidence block renders title/snippet/domain (+url only if allowlisted http(s)), sorted,
  capped (max 5 items, snippet max ~500 chars each — exact caps in brief).
- System rules added: channel-context choosing-the-lever rule; playbook fit-or-skip rule;
  web copy-only + never-invent-URL rule; pilot 3–5 supportedActions rule; portal-steps-as-checks rule.
- `buildNarrationPrompt` input extended with OPTIONAL fields (channelContext, playbookGuidance,
  webEvidence) defaulting to absent so existing callers/tests compile.
- Byte-identical for same inputs regardless of input order.

Tests (update + new):
- Existing `recommendation-prompt.test.ts` expectations updated for v5 (version stamp) while
  keeping v4-shape assertions for non-pilot inputs.
- New cases: pilot gating on/off; PII fields never rendered (pass hostile context with
  address/phone blobs — assert absent); playbook ordering determinism; web URL allowlist
  (non-http(s)/credentialed URLs dropped); 3–5 step instruction present for pilot only.
- New `channel-playbooks.test.ts`: Talabat closed vs general vs availability vs generic
  fallback; unknown detectors → []; determinism; step count 3–5; no URLs in steps.

## Task 2 — Worker wiring (Trigger + workflow threading)

Files:
- `src/workflows/analysis/run-channel-recommendations.ts` (thread optional context/evidence
  into prompt build; fail-open to v4 shape on loader failure)
- `src/trigger/recommendations.ts` (scoped context loader + playbook selection + empty
  web-evidence with qualification comment)

Requirements:
- Load channel context server-side in worker: channel_analysis_runs (by analysisRunId,
  scoped by organization_id) → channel_id/branch_id; organization_channels → key,
  display_name, category, template_key; organizations → name, industry, country_code,
  base_currency, default_timezone; branches → name, timezone (NOT service_area,
  operating_hours, contact_details, capacity_metadata).
- payload.channelId is a hint only; the run row is authoritative. Null channel → null context.
- Derive reasonLabels from loaded findings (dimension values are NOT in the narration
  finding shape today — use finding codes/headlines containing CLOSED, or pass through
  what is available; document the choice).
- playbookGuidance = selectPlaybookGuidance({channelKey, templateKey, channelDisplayName,
  detectorKeys from findings, reasonLabels}).
- webEvidence = [] with code comment: live Brave transport unqualified (fixtures only in
  research pipeline), slot prepared; never fetch, never invent.
- Loader failures (any throw) → null context/empty guidance, continue with v4-shape prompt.
  Findings-empty still fails NARRATION_PROCESSING_FAILED as today. Prompt digest covers new inputs.
- No new RPCs, no schema changes, no new env vars.

Tests:
- Worker test: context threads into prompt; loader throw → still completes with v4 shape.
- Trigger loader test (or worker-level seam test): cross-org channel id returns null context
  (tenant isolation); service_area/contact_details never in context object.

## Task 3 — Gates: tests, typecheck, lint, tenant isolation

- Run: vitest on `src/workflows/analysis/`, `src/domain/analysis/`,
  `src/trigger/recommendations.test.ts`, `src/modules/analysis/`; `pnpm typecheck`;
  eslint on touched files only.
- Verify tenant isolation explicitly: context loader test with foreign-tenant channel id;
  findings load unchanged (eq organization_id + analysis_run_id).
- Record exact commands + outputs in report. No migration validation needed (no migration).

## Task 4 — Spec amendment + ADR + board finalisation

Files:
- `specs/018-governed-channel-intelligence.md` §11.4 (narrow amendment paragraph: pilot
  channel-context + curated playbook + prepared web-evidence slot; checks-not-claims rule;
  fail-closed; pilot detectors listed)
- `adrs/` new ADR (next number; title e.g. channel-recommendations-pilot-context-and-playbooks):
  context, decision (stored context + curated playbooks now, web slot prepared, no model tools,
  no live transport, checks-not-claims, fail-closed), alternatives rejected (live search now —
  blocked on qualification; merged claims about portal structure — rejected as hallucination
  risk; new sources column — deferred), consequences.
- `docs/collaboration/asset-library-and-studio-board.md` (finalise pilot entry: status done,
  commits, test evidence; keep board UNSTAGED at commit).

Requirements: docs only; no code changes in this task. Follow-up list must name live-search
qualification as the explicit next step.

## Amendment A (2026-09-09, user-approved, supersedes playbook fallback)

User rulings (consent recorded, binding):
- Google Search grounding (`google.tools.googleSearch`, installed @ai-sdk/google v2) is APPROVED
  for the narration path. User gives full consent; permissions/rules must be rewritten around it
  (spec section 14 "no tools" clause, ADR 0037 "no tools and no retrieval", qualified-provider
  Google-grounding exclusion which stays scoped to the market-research pipeline only).
- Links/sources are NOT shown: model must not emit URLs; no sources UI.
- Source priority: the channel's own docs, forums, and merchant discussions FIRST, then other
  sources. Credibility bar is MEDIUM: recommendations only, every action human-supervised.
- Playbooks are REMOVED, not kept as fallback. Curated `channel-playbooks.ts` was a gimmick
  next to the real goal. Grounding failure falls back to the v4-shape generic prompt (no playbook).

## Task 5 — Grounding primary + playbook removal (code + tests)

Files:
- `src/modules/analysis/infrastructure/recommendation-generation-provider.ts` (add grounding tool)
- `src/workflows/analysis/recommendation-prompt.ts` (v6: drop playbook blocks/rules, add
  grounding-first rules: channel docs/forums/discussions first, no URLs emitted, medium bar,
  portal how-to allowed from grounding, findings still primary and cited)
- `src/workflows/analysis/channel-playbooks.ts` + test (DELETE both)
- `src/workflows/analysis/run-channel-recommendations.ts` (drop playbook threading; keep stored
  channel context; webEvidence type dropped or repurposed — grounding needs no pre-fetched slot)
- `src/trigger/recommendations.ts` + `src/trigger/recommendation-pilot-context.ts` (drop playbook
  selection; keep scoped channel-context loader; delete webEvidence=[] scaffolding comment,
  replace with grounding note)
- `src/domain/analysis/recommendations.ts` (prompt version 5 to 6 with comment)
- Judge: `src/workflows/analysis/run-recommendation-evaluations.ts` (+ prompt builder if separate)
  and `src/domain/analysis/recommendations.ts` judge version 1 to 2 — portal how-to steps are
  grounding-backed and allowed; still flag invented numbers, causes, savings, confidence.
- Tests: update prompt tests (no playbook cases, new grounding-rule cases, no-URL assertion),
  delete playbook tests, update worker tests (no guidance threading, context still threads),
  provider test for grounding tool call (mocked generator seam — follow existing
  recommendation-generation-provider.test.ts patterns).

Requirements: model call uses grounding tool on pilot runs; non-pilot runs unchanged shape;
never emit URLs (assert in tests with hostile grounding-style content is N/A — assert prompt
forbids URLs and schema/output has no URL field); medium-bar wording (checks phrased as
actions, human-supervised); findings remain the only cited evidence; v4-shape fallback when
provider/grounding fails.

## Task 6 — Docs: rule rewrites (spec 018 section 14, ADRs, board)

- spec 018 section 14: narrow amendment — narration grounding exception for the pilot
  (user-consented, channel-sources-first, no URLs shown, medium bar, human-supervised).
- ADR 0037: amendment note (narrator may use grounding tool under Amendment A; worker still
  fenced, output still schema-validated + citation-checked).
- qualified-provider.ts comment: scope the Google-grounding exclusion to market-research.
- New ADR 0051 (or next free): grounding decision + user consent + medium-bar rationale +
  playbook removal rationale. ADR 0050 stands as history (implementer notes the succession).
- Board: Amendment A entry, status done, commits, gates.

## Amendment B (2026-09-09, user-approved)

User verdict: Cancellations + Availability look good. Two directives:
1. Plain English everywhere: client may not be fluent — easy words and phrasing so
   recommendations read faster ("projections" read as prose/expression, not data projection).
2. Expand the Amendment A treatment (stored channel context + Google grounding, no URLs,
   channel-sources-first, medium bar, human-supervised) from the 3 pilot detectors to ALL
   audit sections/chapters.

## Task 7 — Global grounding + plain-English prompt (code + tests)

Files: recommendation-prompt.ts (+test), run-channel-recommendations.ts (+test),
recommendation-generation-provider.ts (+test, only if call shape changes),
run-recommendation-evaluations.ts (+test, only if judge rules change),
recommendations.ts (+test, version bumps).

Requirements:
- Grounding + channel context for EVERY run with findings (drop the 3-key pilot gate;
  keep the detector set as documentation only if needed). Worker passes useGrounding
  whenever findings exist; provider behavior unchanged otherwise.
- Prompt v6→7 with a PLAIN_RULES block (global, all sections): short common words a busy
  shop owner with basic English understands; one idea per sentence; sentences under ~15 words;
  no idioms or figures of speech; existing no-jargon rule kept and extended with a tiny
  good/bad wording example; numbers stay as figures (never spelled out ambiguously).
  Existing v6 rules (channel-first grounding, no URLs, findings-only citations, 3–5 steps,
  human-supervised) unchanged.
- Judge 2→3 ONLY if a plain-language check is added (flag heavy jargon/longwinded prose as
  an issue); otherwise judge untouched — implementer decides from the code and records why.
- Tests: prompt carries plain rules globally (pilot and non-pilot shapes); grounding on for
  previously non-pilot detectors (e.g. funnel/retention/commission) with worker tests;
  version pins updated; no live network (mocked seams).
- No migration, no new env keys, no UI changes, no URL emission, PII/tenant rules unchanged.

## Task 8 — Docs: Amendment B (spec 018, ADR, board)

- Spec 018: pilot language → global rollout wording (§11.4 + §14, narrow edits).
- New ADR 0052 (or next free): plain-English + global rollout rationale; succession from 0051.
- Board: Amendment B entry (commits, gates). Board stays UNCOMMITTED.

## Amendment C (2026-09-10, user-approved): open analysed ranges instantly

Problem (staging-proven 2026-09-10): every Apply POSTs a brand-new run; worker rows show
5–9 completed runs per identical window with NULL cache tags, i.e. the executing Trigger
worker predates the month_cache feature AND the UI never checks for an existing result.
Ops follow-up (owner): redeploy Trigger worker so cache tags compute; verify one repeat
Apply adds no run row.

## Task 9 — UI open-instant guard (code + tests)

File: src/components/analysis/channel-workspace.tsx (+test).

Requirements: applyWindow first GETs the status route for the exact from/to; when stage is
`ready`, skip POST and go straight to handleLoaderReady path (navigate/refresh, no loader);
POST only otherwise (including `narrating`/`running`/`failed`/fetch-error → existing
behavior with loader). Only `ready` counts — never open a half-narrated run as final.
Tests: ready → no POST + navigation/refresh called; narrating → POSTs as today;
status-fetch failure → POSTs as today (fail-open to current behavior).

## Task 10 — Route cached disposition (code + tests)

File: src/app/api/organizations/[organizationId]/channels/[channelId]/analysis/route.ts (+test).

Requirements: after window resolution and BEFORE rate-limit consume + dispatch, check
loadRunForWindow for the exact resolved window; when newest run is completed AND has
recommendations (same rule the status route uses for `ready`), return 200 with
{ analysisRunId: existingId, correlationId, cached: true } without consuming allowance
or dispatching. Otherwise current 202 behavior unchanged. Permission + coverage checks
stay first and unchanged. Tests: ready-run → 200 cached, no dispatch, allowance
untouched; narrating/failed/absent → 202 path as today.
UI (Task 9) treats { cached: true } like ready (no loader).

## Task 11 — Gates + final review

Vitest slice (analysis components/routes/workflows/domain/trigger), typecheck, eslint on
touched files; tenant scoping re-verified (scoped loaders only); final scoped review.
