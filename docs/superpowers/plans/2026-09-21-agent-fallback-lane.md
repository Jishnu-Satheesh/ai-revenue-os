# Agent fallback lane — approved Execution Plan (2026-09-21)

Tier 3 smaller. Fits inside specs/022-growth-intelligence.md. ADR required (new vendor dep + lane decision).

## Global Constraints (bind every task)

- Tenant isolation at DB + app layers. Reads pin organization_id; writes go through fenced RPCs/governed ops only. Never bypass RLS with service role in request paths.
- Zod schemas at every external and AI boundary. Agent JSON is untrusted input: validate, never execute.
- Fail closed: any gate/key/column/timeout/block anomaly settles slots to existing safe codes with zero invented data.
- No secrets in logs, errors, or persisted rows. API key travels only as X-API-Key header. run_ids may be logged.
- `import "server-only"` in all new module files. TypeScript strict. UTC timestamps. Money in integer micros with ISO code.
- Structured logging with organizationId/runId/correlationId where available.
- Never invent APIs, fields, or capabilities. SDK surface used: `client.agent.runAsync`-style start, get-run poll, cancel-run, `browser_profile: "lite" | "stealth"`. If the installed SDK names differ, the implementer adapts the seam but keeps the contract below.
- No `git push`. No migration push. Worker deploy is the user's step.
- Shared file with redesign track: `src/components/growth-intelligence/market-watch-projects.tsx`. Coordinate via the board.

## Rulings (controller decisions, recorded 2026-09-21)

- R1 latency: Agent SYNC does not fit the 20s adapter timeout (typical 15-60s, tail beyond). Lane uses run-async + poll, never sync/SSE. Cost if wrong: hung slots eat the 300s task ceiling.
- R2 stealth: default `lite`; on block signals retry once with `stealth`; no proxy in this slice (UAE country coverage unverified). Cost if wrong: blocked runs waste ~60s each; contained by fast-fail + single retry.
- R3 block-signal list (case-insensitive substring): `captcha`, `blocked`, `access denied`, `forbidden`. Cost if wrong: missed blocks pollute evidence (caught by review/admission) or false positives waste one retry.
- R4 agent slots capped at 2 per update (first 2 competitor slots; rest fall back to search). Cost if wrong: task-ceiling pressure; 2x120s + search fits in 300s.
- R5 SDK scoped to Agent lane only. Search transport untouched. Cost if wrong: none structural; revisit if SDK proves cleaner.

## Task 1: SDK install + Agent adapter

Files: `package.json` (+ lockfile) via `pnpm add @tiny-fish/sdk@latest` in the worktree; NEW `src/modules/growth-intelligence/infrastructure/research/tinyfish-agent-adapter.ts`; NEW co-located test file.

Contract (Task 3 consumes exactly this):

- `export type AgentSlotStatus = "ok" | "blocked" | "failed"`
- `export type AgentSlotOutcome = { status: AgentSlotStatus; data: unknown; runId: string; code?: string }`
- `export type AgentClientSeam = { startRun(input: { url: string; goal: string; browserProfile: "lite" | "stealth" }): Promise<{ runId: string }>; getRun(runId: string): Promise<{ status: string; result: unknown }>; cancelRun(runId: string): Promise<void> }`
- `export const AGENT_SLOT_TIMEOUT_MS = 120_000`
- `export const AGENT_POLL_INTERVAL_MS = 5_000`
- `export const AGENT_BLOCK_SIGNALS = ["captcha", "blocked", "access denied", "forbidden"]`
- `export function createTinyfishAgentAdapter(client: AgentClientSeam): { runCompetitorSlot(input: { url: string; competitorName: string; fields: string[]; timeoutMs?: number; abortSignal?: AbortSignal }): Promise<AgentSlotOutcome> }`
- `export function buildCompetitorGoal(competitorName: string, fields: string[]): string` producing: `Extract {fields joined with ", "} about {competitorName} from this page. Return JSON matching the requested fields. If the page is a block, captcha, login wall, or access-denied page, return {"blocked": true}.`
- Flow: startRun(lite) → poll getRun every 5s until terminal (`COMPLETED`/`FAILED`/`CANCELLED` or SDK equivalents) → COMPLETED: scan JSON-stringified result for block signals (case-insensitive) or `{"blocked": true}` → if blocked, ONE retry via startRun(stealth) with same poll; still blocked → `{ status: "blocked" }` → FAILED/CANCELLED → `{ status: "failed", code: "AGENT_RUN_FAILED" }` → timeoutMs (default 120000) exceeded → cancelRun + `{ status: "failed", code: "AGENT_SLOT_TIMEOUT" }` → abortSignal fired → cancelRun + `{ status: "failed", code: "AGENT_SLOT_ABORTED" }`.
- `data` is the raw parsed result (unknown); downstream extraction validates. Never throw on provider-shaped outcomes; throw only on programmer errors (empty url/goal).
- `import "server-only"` first line. No key handling here (seam takes no secrets). No logging of result bodies (runId only).

Tests (co-located, vitest): start+poll success returns ok with data+runId; blocked lite → stealth retry → ok; blocked twice → blocked status; timeout triggers cancelRun + AGENT_SLOT_TIMEOUT; abort triggers cancelRun + AGENT_SLOT_ABORTED; FAILED run → AGENT_RUN_FAILED; goal template contains competitor name, fields, and blocked instruction. Report the installed SDK version.

## Task 2: opt-in column + API toggle + UI checkbox

Files: NEW `supabase/migrations/20260921*_growth_intelligence_agent_lane_opt_in.sql`; `src/app/api/organizations/[organizationId]/growth-intelligence/monitoring/projects/route.ts` (+ its test); `src/components/growth-intelligence/market-watch-projects.tsx`; `src/lib/supabase/database.types.ts` (narrow hand edit); route test updates.

Contract (Task 3 consumes exactly this):

- Column: `agent_lane_opt_in boolean NOT NULL DEFAULT false` on `public.growth_intelligence_research_projects`. Migration must be idempotent-safe (`ADD COLUMN IF NOT EXISTS`), no backfill (default covers), no RLS change, no function change.
- API: extend the projects route with a tenant-pinned update accepting Zod `{ agent_lane_opt_in: z.boolean() }` for a single project_id in the caller's organization; 404 cross-org (never 403 leak). Follow the file's existing auth + validation patterns.
- UI: checkbox/toggle on the project card (or its settings surface, whichever the file already provides) labeled for operator opt-in; optimistic update with error rollback; explains nothing about spend (platform credit limit coming later).
- database.types.ts: add the column to that table's Row/Insert/Update types only.
- Dry-run the migration (`pnpm db:migrations:dry-run`); DO NOT push.

Tests: route tests for on/off round-trip, cross-org 404, invalid body 400; UI change covered by existing component tests if present, else route-level proof suffices (state in report).

## Task 3: trigger wiring — route opted-in competitor slots to Agent lane

Files: `src/trigger/growth-intelligence-monitoring-research.ts`; `src/trigger/growth-intelligence-tinyfish.ts`; test updates in `src/trigger/growth-intelligence-monitoring-research.test.ts`.

Contract:

- Read `agent_lane_opt_in` with the project row fetch; missing/false → today's behavior bit-for-bit (search-only). True → first 2 competitor slots go through `createTinyfishAgentAdapter` (Task 1 contract); all other slots + excess competitor slots stay on Search+Fetch.
- SDK client construction: `new TinyFish()` reading `TINYFISH_API_KEY` from env (SDK default); reuse `readTinyfishSearchApiKey()` + `isTinyfishResearchGateOpen()` from growth-intelligence-tinyfish.ts — closed gate or blank key → search-only fallback, no exception.
- Agent outcomes feed existing extraction → review → admission unchanged: `ok` → extraction validates `data`; `blocked`/`failed` → slot settles to current no-evidence path with runId logged (`logger.warn`/`info` with organizationId, projectId, updateId, runId, code).
- Abort composition: pass the slot abort signal through; agent 120s cap lives inside the 300s task ceiling (MONITORING_UPDATE_TASK_MAX_DURATION_S unchanged).
- No spend accounting in this slice (platform credit limit later); runIds logged for audit.

Tests: opt-out → search-only (no Agent calls); opt-in → competitor slots call seam, topic slots don't; gate closed → fallback; blocked outcome → no-evidence path with runId logged; third competitor slot → search. Follow existing fake-seam patterns in the test file.

## Task 4: ADR + verification

Files: NEW `adrs/NNNN-tinyfish-agent-fallback-lane.md` (next number; pattern-match the latest ADR); report only, no code except review fixes.

Contract:

- ADR records: why Agent lane (no_findings gap), why SDK-scoped-to-Agent, async+poll decision (R1), lite-then-stealth (R2), opt-in + always-competitor routing, no-spend-accounting deference to platform credit limit.
- Run: `pnpm typecheck`, `pnpm lint`, full `vitest run`, migration dry-run. Green all. pgTAP (`pnpm db:test`) read-only run if it completes in budget; failures unrelated to this lane get reported, not fixed.
- Append canary runbook to the SDD report: user deploys worker from worktree (verify `git log` shows lane commits), opts in Summer Dining Deals, retries update, expects competitor evidence with run_ids.
