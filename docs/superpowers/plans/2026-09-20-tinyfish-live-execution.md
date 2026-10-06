# TinyFish live execution: model transports + project-scope executor

## Goal

- Complete the Growth Intelligence market-research module so a qualified TinyFish lane runs end to end: live search through the qualified adapter, live extraction, support review and synthesis through wired model transports, and a real project-scope executor for one-time Market Watch updates replacing the fail-closed stub.
- Prove it with a single bounded canary on staging, then report.

## Global Constraints

- Tenant isolation is enforced at database and application layers; every worker read pins organization id and every write goes through a fenced RPC that re-verifies tenant bindings server-side.
- Money stays fenced: USD 1 per pipeline and USD 5 per organization local day, reserve-before-call with claim tokens, unknown cost stays reserved and never converts to zero.
- No model calls a destructive or money-moving tool directly; model output passes through deterministic validation before any persistence.
- Zod schemas sit at every external and AI boundary; malformed provider or model output fails closed with a safe code, never a throw that Trigger redelivers.
- Timestamps stored in UTC; money in integer minor units with ISO currency code; structured logging carries organizationId, runId and correlationId; no secrets, tokens, or customer PII in logs.
- The Brave ephemeral live preview is untouched; TinyFish never authorizes Brave runs and Brave never authorizes TinyFish runs.
- Fail-closed behavior is preserved for every unqualified, unconfigured, expired, or over-budget path with the existing safe codes.
- Real model spend is only enabled by this plan: the kill-switch stays closed until the canary, the canary is one bounded run, and worker deploys plus migration pushes are the user's steps, never the implementer's.

## Task 1

- Type: read-only recon, no code, no migration, no config change.
- Map the exact seams the later tasks build against and report them with file paths and line numbers.
- Trace how run-market-research consumes extraction, support review and synthesis: the transport, spender, budget and model-id wiring in the trigger dependencies, what unconfiguredResearchModelTransport and unconfiguredResearchModelSpender refuse with, and what a wired replacement must satisfy including the EXTRACTION_UNAVAILABLE gate and the excerpt qualification version.
- Inventory the model backends already used in this repo for comparable text work and how they are constructed, so Task 2 reuses an established transport pattern instead of inventing one.
- Trace the project-scope update path end to end: createFailClosedMonitoringResearch, the monitoring update store, report revision pinning, and where a real executor must persist results through fenced RPCs only.
- Report: seam inventory with file and line references, the exact interfaces Task 2 and Task 3 program against, and any ambiguity flagged as NEEDS_CONTEXT rather than guessed.

## Task 2

- Wire the research model transports for extraction, support review and synthesis behind the existing environment names, reusing the transport pattern Task 1 identified.
- Keep every fail-closed refusal: missing model id, missing credential, closed kill-switch, unqualified lane, or missing excerpt qualification version must still fail the batch with the current safe codes and honest unknown-cost accounting, never a worker throw.
- Clamp calls and token usage to the staged model bounds and the per-phase call limits already in code.
- Tests: unit tests proving the wired path calls the model backend through the established pattern, plus tests proving each refusal above still fails closed with its safe code and zero spend; run the affected suites green.
- Do not touch the project-scope executor, the qualification gate, pricing, or budgets.

## Task 3

- Build the project-scope executor for one-time Market Watch updates, replacing the fail-closed stub, driven by the qualified TinyFish adapter.
- Persist results only through the fenced RPCs Task 1 identified, with report revision pinning preserved and prior reports retained on failure.
- Keep terminal failure honest: failed projects keep the Research could not finish display with the safe code, working Retry, and zero invented findings.
- Tests: unit and route tests proving a qualified run persists evidence and updates project state, and proving failure still lands terminal with safe codes; run the affected suites green.
- Do not touch model transports, the qualification gate, pricing, or budgets.

## Task 4

- Write the canary-flip migration setting canary_result to passed for provider tinyfish, with a comment naming the bounded canary it authorizes.
- Define the bounded canary: one branch on the canary organization, one research start, then confirmation of the terminal outcome, safe codes where applicable, spend records within the USD 1 pipeline fence, persisted sources with TinyFish provenance where the run succeeds, and zero leakage into other branches or organizations.
- Verification uses the project's Trigger CLI bridge for run listing, direct staging reads for gate, pipeline, request, source, claim and spend state, and the local dev server HTTP surface for UI state; browser-click tools and the Trigger MCP are not connected in this session, so no step may depend on them.
- Report the canary evidence as run ids, gate answers, database states and counts; any deviation from the bound fails the canary and the lane returns to pending.
- Do not run the canary until the user confirms the flip migration is pushed and the workers are redeployed.
