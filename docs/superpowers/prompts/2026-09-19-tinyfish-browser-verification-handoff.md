# Handoff: browser end-to-end verification of the TinyFish market-monitoring restoration

Give this whole prompt to a fresh coding agent with chrome-devtools and Trigger.dev MCPs connected.
That agent verifies; it does not implement. The restoration is DONE only when this verification passes.

---

You are verifying (not building) the TinyFish market-monitoring restoration. Another session
implemented it; your job is to prove it works end to end in a real browser, or to file precise
defects. Verification-only role: do not edit, commit, stash, push, run migrations, or change
any code, spec, or config. You may start the dev server, drive the browser, trigger Trigger.dev
tasks, and read anything. If a step needs a staging migration apply, a secrets change, or spend
beyond the canary budget below, STOP that step and ask the user — those are the user's steps.

## 1. Context (read first, in this order)

- Repo: /home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence, branch feat/governed-channel-intelligence (shared worktree with peer WIP — touch nothing).
- Plan (binding argument): docs/superpowers/plans/2026-09-18-tinyfish-market-monitoring-restoration.md
- Decision record: adrs/0065-tinyfish-durable-market-research.md
- Spec (binding authority): specs/022-growth-intelligence.md §§4.2, 6.5, 8.2, 9.7
- Build ledger (what each task did + rulings): .superpowers/sdd/2026-09-18-tinyfish-market-monitoring-restoration/progress.md
- AGENTS.md (repo contract, communication + coordination rules)

## 2. What was built (so you know what to look for)

- Durable research provider is now TinyFish Search behind staged per-provider qualification
  (RPC `check_research_provider_qualification_for(p_provider)`, six required uses, fail-closed,
  canary-gated). Brave remains ONLY the ephemeral live preview that stores nothing.
- Worker assembly: src/trigger/growth-intelligence-tinyfish.ts — key check, kill-switch
  `TINYFISH_MARKET_RESEARCH_ENABLED === "true"` (default closed), tinyfish-lane qualification,
  lane pin, fenced reserve/settle spender. Missing key / closed switch / unqualified lane /
  RPC failure must all yield today's blocked baseline with zero spend and safe codes
  (`FEATURE_NOT_AVAILABLE`, `ADAPTER_UNAVAILABLE`, `RESEARCH_BUDGET_UNAVAILABLE`).
- Relevant Trigger task ids: `growth-intelligence.run-market-research`,
  `growth-intelligence.run-synthesis`, `growth-intelligence.consolidate-market-evidence`,
  `growth-intelligence.run-market-monitoring-update`, `growth-intelligence.dispatch-due`.
- UI surface: /organizations/[orgId]/growth-intelligence — header Market monitoring dialog,
  Market Watch live preview, Insights & market tab (status, coverage, cited findings, competitor
  findings, limitations, source inspection, research history), Recommendations lane.
- Migration supabase/migrations/20260919120000_growth_intelligence_tinyfish_provider_qualification.sql
  is ADDITIVE and UNPUSHED. Do not push it. Its pending state decides which phase below you run.

## 3. Setup (ask the user for what you cannot discover)

- Ask the user for: (a) org id to verify in (prior canary/dev org was 2dda45b8 — confirm, do not
  assume); (b) a login session for the browser (prior sessions were blocked at passwordless email
  login — do not attempt to bypass auth; get a session from the user); (c) whether the migration
  has been pushed since this handoff was written and whether a TinyFish qualification row is
  staged (if unknown, run Phase A only).
- Start the dev server only (never `trigger deploy`, never prod writes). Budgets: USD 1 per
  pipeline, USD 5 per org-day (spec §9.7) — stay inside them; TinyFish Search itself is $0.

## 4. Phase A — always run (works with zero staging changes; fail-closed behavior is a PASS)

Using chrome-devtools MCP against the dev server, verify each and capture a screenshot + console log:

- A1. GI page loads for the org with zero console errors/warnings attributable to the slice.
- A2. Market monitoring dialog opens from the header; starting research while unqualified ends
  fail-closed with a safe, human-readable message (no stack trace, no provider text, no spend).
- A3. Market Watch live preview still works on explicit click only (Brave, ephemeral): shows
  fresh results, discards on close, creates no evidence/insights, stays permission-gated.
- A4. Insights & market tab renders prior state honestly (empty states where empty, no invented
  progress); Recommendations lane unaffected.
- A5. Trigger.dev MCP: list recent `growth-intelligence.*` runs — confirm no run spent budget or
  persisted TinyFish evidence while unqualified (blocked baselines only).

## 5. Phase B — only if the user confirms migration pushed + TinyFish qualification staged

Do not run Phase B on assumption. Preconditions (all user-confirmed): migration applied on
staging; a `tinyfish` qualification row staged with agreement version, six uses, pricing version,
credential_ready, model bounds, and canary_result; `TINYFISH_SEARCH_API_KEY` + 
`TINYFISH_MARKET_RESEARCH_ENABLED=true` set where the worker reads them; canary org only.

- B1. Via Trigger.dev MCP, trigger `growth-intelligence.run-market-research` for one approved
  branch scope. Record the run id. Expect: success with coverage manifest, bounded spend ≤ USD 1.
- B2. Confirm persistence (read-only queries or UI): sources carry TinyFish qualification
  provenance + retain-until; excerpts ≤ 2000 chars; citations resolve to eligible sources.
- B3. In the browser: Insights & market tab shows cited findings, competitor findings, coverage,
  limitations, and source inspection for the new run; Recommendations derived link to cited
  findings. Screenshot each.
- B4. Trigger `growth-intelligence.run-synthesis` + `consolidate-market-evidence`; confirm items
  appear with exact branch/profile/research lineage and governed business periods.
- B5. Kill-switch check: with user approval, unset `TINYFISH_MARKET_RESEARCH_ENABLED` in dev,
  re-trigger, and confirm the run fails closed (`policy_revoked`/blocked baseline, spend stops);
  restore the setting afterwards and confirm recovery on the next run.
- B6. Console + server logs: zero errors/warnings attributable to the slice across B1–B5.

## 6. Defects (if any)

File each defect with: phase + step, expected vs observed, screenshot/run-id/log evidence,
and (only if you can name it from reading code, no guessing) the suspected file:line.
Severity: Critical (wrong spend, wrong tenant data, invented evidence), Important (broken
happy path), Minor (copy/layout). Do not fix anything.

## 7. Report contract

Write your full report to docs/verification/tinyfish-restoration/2026-09-19-browser-e2e.md
(create dirs as needed — this report file is your ONLY write) and return a short summary:
per-check PASS/FAIL table, overall verdict (PHASE A PASS/FAIL; PHASE B PASS/FAIL/SKIPPED with
the reason), defect list or explicit NO DEFECTS. The restoration is DONE only on your
explicit overall PASS; anything else keeps the task open.
