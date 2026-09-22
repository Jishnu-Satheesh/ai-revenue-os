# ADR 0067 — TinyFish Agent as the opt-in competitor fallback lane

Status: Accepted 2026-09-22 (lane implemented Tasks 1–3 in the worktree; staging migration push, worker deploy, and the Summer Dining Deals canary below still owed — none of them gate this record, all of them gate production enablement).

## Context

- The Search+Fetch durable lane (ADR 0065) leaves a `no_findings` gap: competitor slots with no usable search evidence settle to `searched_no_usable_evidence` with nothing for extraction, review, or admission to work with. The Agent lane exists to fill exactly that gap — a fallback for competitor slots, not a replacement for search.
- Installed SDK is `@tiny-fish/sdk@0.7.0`, scoped to the Agent lane only; the Search transport is untouched (R5). Verified binding: async start is `client.agent.queue({ url, goal, browser_profile, agent_config: { max_duration_seconds: 120 } })`; poll is `client.runs.get(runId)` with statuses PENDING/RUNNING/COMPLETED/FAILED/CANCELLED; the SDK exposes no cancel-run method (`RunsResource` has only `get`/`list`), so cancel is a raw `POST https://agent.tinyfish.ai/v1/runs/{runId}/cancel` with the `X-API-Key` header (Task 3 seam in `growth-intelligence-tinyfish.ts`; allowlisted host only, `redirect: "error"`, key never logged).
- Agent runs typically take 15–60s with a tail beyond, which does not fit the 20s adapter timeout — so the lane uses async-start + 5s poll, never sync/SSE (R1). Default browser profile is `lite`; on block signals exactly one retry goes out as `stealth`; no proxy in this slice (R2). Block signals are the case-insensitive substrings `captcha`, `blocked`, `access denied`, `forbidden`, plus an explicit `{"blocked": true}` payload flag (R3). At most 2 competitor slots per update go through the lane in plan order; the rest stay on Search+Fetch so 2x120s plus search still fits the unchanged 300s task ceiling (R4).
- Routing is per-project opt-in, not always-on: `agent_lane_opt_in boolean NOT NULL DEFAULT false` on `public.growth_intelligence_research_projects` (migration `20260921190000`, idempotent-safe, no backfill — default covers). The projects PATCH flips one project's flag tenant-pinned (zero rows → 404, never a 403 leak). A follow-up migration (`20260921191000`, controller ruling overriding the plan's "no RLS change" line) adds the least privilege needed for the toggle to persist: `GRANT UPDATE` on that one table to `authenticated` plus an UPDATE policy gating on `growth_intelligence.manage` for the caller's own organization only, mirroring the table's SELECT policy shape with WITH CHECK equal to USING. No other grants, tables, or functions.
- No spend accounting exists for agent slots in this slice — deferred to the coming platform-wide daily credit limit. The toggle surface carries no spend copy. `run_id`s are logged for audit and join to the TinyFish run record.
- Lane logging is `organizationId` + `runId` (slot codes travel as `errorCode`): `LogContext` is a closed allowlist with no `projectId`/`updateId`/`code` fields and `logger.ts` was out of scope, so project/update identity travels in the outcome/coverage rows, not the logs.

## Decision

- Opted-in projects route their first 2 competitor slots (plan order, URL + topics present) through `createTinyfishAgentAdapter`; every other slot — topic slots, excess competitor slots, slot without a public URL — stays on Search+Fetch bit-for-bit. Missing/false flag, closed research gate, or blank key all fall back to today's search-only behavior with no exception.
- Agent outcomes feed the existing extraction → review → admission chain unchanged: `ok` → extraction validates `data`; `blocked`/`failed` → the slot settles to the current no-evidence path with `runId` logged. Fail closed throughout: any gate/key/column/timeout/block anomaly settles to existing safe codes with zero invented data; agent JSON is untrusted input validated downstream, never executed.
- Every run is server-side bounded by `agent_config: { max_duration_seconds: 120 }` even if local polling stops; local timeout/abort cancels best-effort via the raw cancel endpoint and settles to `AGENT_SLOT_TIMEOUT` / `AGENT_SLOT_ABORTED`.

## Alternatives rejected

- Sync/SSE agent execution: rejected — typical agent latency exceeds the 20s adapter timeout and hung slots would eat the 300s task ceiling (R1).
- Stealth-first or proxy routing: rejected — `lite` succeeds often enough that stealth-first wastes the expensive profile; proxy country coverage for the UAE is unverified (R2).
- Always-on agent routing: rejected — the lane is unproven spend until the canary; opt-in keeps every existing project on search-only until an operator chooses otherwise.
- Extending the SDK to the Search transport: rejected — R5 keeps the SDK scoped to the Agent lane so a provider regression cannot touch the proven search path.
- Per-slot spend accounting in this slice: rejected — the platform-wide daily credit limit is the coming mechanism; the lane logs `run_id`s so spend is auditable meanwhile.

## Consequences

What changes:

- Opted-in projects get up to 2 agent-backed competitor attempts per update, with `run_id`s in the logs joining to TinyFish run records; blocked/failed slots keep the existing no-evidence codes.
- `database.types.ts` gains the one column on that table's Row/Update types only (`Insert` stays `never` — creation remains via the `create_research_project*` RPCs).

What stays:

- Search-only default, retrieval bounds, excerpt budgets, tenant isolation, spend ceilings, review/admission, and the 300s task ceiling are unchanged.
- The real-SDK seam (`queue` + `runs.get` + raw cancel) has no live test — no network in this slice. The canary below is its first live exercise.

Open gates (all OPEN — they gate production enablement, and are not presented as done):

- Push both lane migrations to staging (`20260921190000` column + `20260921191000` policy); until then `readAgentLaneOptIn` degrades to false and the lane stays search-only.
- User deploys the worker from the worktree and runs the canary in the Task 4 report (opts in Summer Dining Deals, retries the update, expects competitor evidence with `run_id`s logged).

Amends no prior ADR (additive lane beside ADR 0065) and spec 022 (agent fallback for `no_findings` competitor slots).
