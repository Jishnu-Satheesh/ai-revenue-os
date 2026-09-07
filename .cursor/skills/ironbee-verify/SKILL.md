---
name: ironbee-verify
description: "Trigger verification of code changes — runs every active cycle wired up for this project (see the platform sections at the bottom of the file). Default is verify-only (report the verdict and stop); a leading `fix` argument adds the fix-and-re-verify loop until pass."
disable-model-invocation: true
---

# IronBee Verify

> **⚠️ Run this inline — do NOT delegate.** Perform every step yourself, in this
> conversation. Do **not** use the `Task` tool and do **not** spawn a sub-agent — a
> delegated run is tracked as a separate session and won't register as verification.

Verify the current code changes through real tools. The gate runs every cycle that has been wired up for this project, and all active cycles must be satisfied within a single verification cycle for `status: pass`. Each cycle has its own tools and flow — **see the platform sections near the bottom of this file** for which cycles apply and what to call. The verdict shape itself is platform-agnostic (`status`, `checks`, `issues?`, `fixes?`); the gate enforces that you called each cycle's required tools and that `checks` is non-empty.

## Mode

The FIRST whitespace-delimited token of whatever the user provided alongside this command selects the mode; everything after it is the scenario:

- `fix` → **verify-and-fix**: on a fail verdict, fix the reported issues, rebuild, and re-verify until the verdict passes.
- `report` → **verify-only** (the explicit form of the default).
- Anything else, or nothing → **verify-only** (default), and the WHOLE provided text is the scenario.

**Verify-only** means: submit the (possibly fail) verdict, report the issues to the user, and STOP — do **not** edit code, do **not** re-verify. The fail verdict is still recorded (that's the point — an honest status report). If the user wants the issues repaired, suggest `/ironbee-verify fix`. The mode token never overrides the gate: if enforcement blocks completion because of this turn's edits, follow the gate.

## Verification scenario

A custom verification scenario may be supplied when this command is invoked — either as **inline text** or as a **path to a file** (any location, any format; it is read at run time). The scenario is whatever the user provided alongside invoking this command, after stripping a leading `fix` / `report` mode token (see **Mode**).

- **If the scenario part starts with `scenario:`** (after the mode token), everything after `scenario:` is a **SAVED scenario reference** — an exact name OR a semantic description — **up to an optional ` args:` override boundary**. A ` args:` token (a space, then `args:`) splits it: text BEFORE it is the reference, text AFTER it is a JSON object of **override arguments** for the scenario's `params` (e.g. `scenario:checkout args:{ "baseUrl": "https://staging" }`); with no ` args:` the whole tail is the reference and the scenario runs with its **captured default params**. Resolve the reference across enabled platforms (`*_scenario-search` for the description + an exact-name `*_scenario-list` match), pick the single strong match (ambiguous → ask which; none → say so and fall back to the default flow), then **run it in ONE `*_scenario-run` call** (passing the override args when present — they override the scenario's captured defaults; no manual re-discovery) and **judge its result (functional) + any returned visual evidence (e.g. screenshots)**. The scenario's nested tool calls satisfy each active cycle's required tools (as long as it exercises them). No exact name needed — e.g. `scenario: the full purchase flow`. **On PASS, keep it fresh:** `*_scenario-update` its `ironbee.commit` → HEAD (`git rev-parse HEAD`) + `liveValidated: true` (re-send the full metadata merged); on FAIL / defect, don't stamp.
- **If a scenario is supplied (free text), it is authoritative**: verify exactly what it describes. Drive each active cycle's tools to exercise precisely the flows, states, and endpoints it names — this **replaces** the default "exercise the changed pages/endpoints" guidance.
- **If the scenario is (or points to) a file path**, read that file with your file-read tool and treat its contents as the scenario. Do not assume a fixed location or format — read whatever path was given.
- **If the path does not resolve to an existing file**, stop and report `scenario file not found: <path>`, then ask how to proceed — do not verify the literal path string or guess a target.
- **If no scenario is supplied**, fall back to the default flow: exercise the changed pages/endpoints per the active platform sections below.

Whatever the scenario directs, the gate is unchanged — you must still call every active cycle's required tools and submit a non-empty `checks`. Map each `checks` entry to a concrete scenario step/expectation, and each `issues` entry to a scenario step that failed.

## Universal steps

1. **Start verification**: Run `echo '{"session_id":"<your-session-id>"}' | ironbee hook verification-start` via terminal.
   **In fix mode**, add the intent flag so IronBee's completion gate enforces fix-until-pass:
   `echo '{"session_id":"<your-session-id>"}' | ironbee hook verification-start --intent fix`
1.5. **Run the project checks FIRST (lint/test/…)**: `echo '{"session_id":"<your-session-id>"}' | ironbee hook run-checks` (generous shell timeout — they may take minutes). Runs the configured `verification.checks` and records the results the gate reads. **Key your next step off the FIRST LINE of its output:** **`CONCLUSIVE PASS …`** → the verification is ALREADY COMPLETE (IronBee submitted the pass verdict itself and closed the cycle) — do **NOT** drive any devtools tools, do **NOT** start another cycle, do **NOT** submit another verdict; report the result and stop. **`DEFERRED FAIL …`** → the verification WILL fail, but do **NOT** submit the fail yet: the named conclusive check(s) failed and your devtools work in this cycle is a **DIAGNOSIS** of those failures (it replaces the normal verification flow) — diagnose code-first — first read the failing check's output and the implicated source to form a hypothesis, then confirm with a single focused reproduction using the active cycle's tools (do NOT explore broadly or re-run the whole flow repeatedly), then submit a **FAIL** verdict whose `issues` carry your findings (a pass/N-A verdict is rejected while a conclusive check is red). **Anything else** → 🛑 **IF ANY REQUIRED CHECK FAILS, THE VERIFICATION HAS ALREADY FAILED — STOP.** It is **NOT your call** whether the failure is "just a fixture", "unrelated", or "pre-existing" — a required non-zero exit **IS** a failure. Do **NOT** touch the devtools tools or submit a pass; submit a **fail** verdict whose `issues` are the failing checks (the gate enforces the fix). Only when **every** required check PASSES do you continue. ("no checks configured" → just continue.)
2. **Build and start** the application if not already running.
3. **For every active cycle, run its flow** — driven by the **Verification scenario** above when one was supplied, otherwise as described in the platform sections near the bottom of this file. All active cycles must be exercised within this same verification cycle.
4. **Stop** the dev server when verification is complete (every cycle — including the final one).
5. **Honor any cycle-specific teardown** noted in the platform sections BEFORE submitting your verdict.
6. **Submit your verdict** via terminal. One verdict covers every active cycle:
    - Pass: `echo '{"session_id":"...","status":"pass","checks":["..."]}' | ironbee hook submit-verdict`
    - Fail: `echo '{"session_id":"...","status":"fail","checks":["..."],"issues":["describe what failed"]}' | ironbee hook submit-verdict`
7. **If failed** → collect ALL issues first (finish testing every active cycle) and submit ONE fail verdict with all issues. Then branch by mode:
   - **Verify-only (default)**: report the issues to the user and stop — do not edit code. Suggest `/ironbee-verify fix` to repair them.
   - **Fix mode (`fix` token)**: fix everything, rebuild, and re-verify until pass. Do not fix one issue at a time — batch fixes to avoid repeated build/restart cycles.
8. If pass after a previous fail, include `"fixes"` in the verdict describing what was fixed.

---

<!--IRONBEE:PLATFORM:browser-->
<!-- Browser cycle verification is ENABLED for this project. The stop hook
     enforces a browser cycle whenever an edited file matches
     `browser.verifyPatterns`. The `/ironbee-verify` command's mode
     arguments (default / full / visual / functional) tune the depth of the
     browser-cycle pass. -->

## Mode arguments (browser cycle)

- `/ironbee-verify` — **default** — focus on what changed, visual + functional checks on affected areas
- `/ironbee-verify full` — **full scope** — entire application, all checklists, edge cases, responsive, accessibility deep dive
- `/ironbee-verify visual` — **visual only** — contrast, layout, spacing, fonts, images, theming
- `/ironbee-verify functional` — **functional only** — clicks, forms, navigation, data flow, error handling

If no argument is given, use **default** mode. `default` and `full` apply to every active cycle (browser, node, backend) — each cycle interprets them in its own terms (see each platform section). `visual` and `functional` apply ONLY to the browser cycle; other active cycles run in `default` mode when these are passed.

## Browser steps (all modes)

1. **Start verification**: Run `echo '{"session_id":"<your-session-id>"}' | ironbee hook verification-start` via terminal
2. **Build and start** the application if not already running
3. **For EVERY page you visit**, repeat this cycle:
   a. **Navigate** using `MCP:bdt_navigation_go-to`
   b. **Take a FULL PAGE screenshot** using `MCP:bdt_content_take-screenshot` with `fullPage: true`
   c. **Take an ARIA snapshot** using `MCP:bdt_a11y_take-aria-snapshot`
   d. **STOP and visually analyze the screenshot** — switch your focus entirely to finding visual problems. Look at this screenshot as if your ONLY job is to find visual defects:
      **WARNING: ARIA reports DOM content, not what the user actually sees.** Do NOT assume the page looks correct just because ARIA shows the right content. Only the screenshot tells you what the user actually sees.
      - Text readability — is it readable against its background? Look for text that blends in or poor contrast
      - Layout — overlapping elements, unexpected gaps, overflow, content cut off
      - Spacing — consistent padding/margin? Too cramped or too far apart?
      - Colors — intentional and consistent? Any jarring mismatches?
      - Typography — right sizes? Clipped or truncated text?
      - Images/icons — loaded? Right size and aspect ratio?
      - States — empty, loading, disabled, error states rendered properly?
      Report your visual findings before continuing.
   e. **Read the ARIA snapshot** — verify headings, labels, landmarks, and structure
   f. If anything looks wrong → note it as an issue
4. **Functionally test** — run the checklist for your mode (see below). After each significant interaction, take another screenshot and repeat the visual analysis.
5. **Check console** for errors using `MCP:bdt_o11y_get-console-messages`
6. **Stop** the dev server when verification is complete
7. **If recording was started, stop it now** — `MCP:bdt_content_stop-recording`. submit-verdict rejects with `"recording is still active"` when this step is skipped. (Recording is a server-side opt-in via `recording.enable` — when on, the gate forces `MCP:bdt_content_start-recording` BEFORE the steps above and demands the matching stop here.)
8. **Submit your verdict** via terminal:
    - Pass: `echo '{"session_id":"...","status":"pass","checks":["..."]}' | ironbee hook submit-verdict`
    - Fail: `echo '{"session_id":"...","status":"fail","checks":["..."],"issues":["describe what failed"]}' | ironbee hook submit-verdict`
9. **If failed** → collect ALL issues first (finish testing all affected pages), submit one fail verdict with all issues, then fix everything, rebuild, and re-verify. Do not fix one issue at a time — batch fixes to avoid repeated build/restart cycles.
10. If pass after a previous fail, include `"fixes"` in the verdict describing what was fixed

---

## Default Mode

Focus on the code you changed — not the entire application.

### 1. Study the changes
1. Run `git diff --name-only` and `git diff --name-only HEAD~1`
2. **Ignore `.ironbee/`, `.claude/`, `.cursor/`** — tool config, not application code
3. **Read the full diff** (`git diff` and/or `git diff HEAD~1`) — understand every change: what was added, removed, modified. Note specific values (colors, sizes, conditions, logic, API endpoints, component props).
4. Before opening the browser, you should be able to answer: what exactly changed, what should look or behave differently, and what could go wrong?

### 2. Verify in the browser
- **Cross-reference the diff against what you see.** For each change in the diff, verify it is correctly reflected in the browser. If the diff changes a color → check that color. If it changes a calculation → verify the result. If it adds a component → confirm it renders.
- **Test the flow end-to-end** — navigate, click, fill forms, submit, verify the outcome
- **Check one edge case** — empty input, invalid data, or double-click
- **Console** — any new errors or warnings?

---

## Full Mode (`/ironbee-verify full`)

Comprehensive verification of the **entire application**. Do NOT run `git diff` or scope to recent changes. Test every page, every flow, every visual detail. Any issue is a failure, regardless of when it was introduced.

### Visual Checklist
In addition to the per-page visual analysis in step 3d:
- **Responsiveness** — does the layout adapt if viewport changes? No horizontal scrolling on standard widths
- **Borders & separators** — visible and consistent? Not too faint or missing
- **Scroll behavior** — does the page scroll smoothly? No content hidden behind sticky headers/footers?

### Functional Checklist
- **Navigation** — do links and buttons navigate to the correct pages?
- **Forms** — fill inputs with real data, select options, submit. Do validation messages appear correctly?
- **Buttons & interactions** — do click handlers fire? Do toggles, dropdowns, and modals work?
- **Data flow** — does submitted data appear where expected?
- **Error handling** — what happens with invalid input? Does the UI handle errors gracefully?
- **Authentication** — if applicable, do protected routes redirect correctly?
- **API calls** — do network requests succeed? Check for failed requests in console/network
- **State persistence** — does state survive page refresh where expected?
- **Edge cases** — empty inputs, very long text, special characters, rapid clicks

### Accessibility (deep dive)
- Are headings hierarchical? Do form inputs have labels? Are landmarks present?
- Check for missing alt text on images

---

## Visual Mode (`/ironbee-verify visual`)

Focus exclusively on visual quality. Run the per-page visual analysis from step 3d on every page, plus:
- **Responsiveness** — viewport changes, no horizontal scrolling
- **Borders & separators** — visible and consistent?
- **Scroll behavior** — smooth scrolling, no hidden content

Take screenshots of **multiple states** if applicable (hover, active, disabled, empty, populated).

---

## Functional Mode (`/ironbee-verify functional`)

Focus exclusively on behavior. Use the same functional checklist as Full Mode above.

Test the **complete user flow**, not just the single step you changed.
<!--/IRONBEE:PLATFORM:browser-->

<!--IRONBEE:PLATFORM:node-->
<!-- Node backend verification is ENABLED for this project. -->

## Backend Node Mode (when `node.verifyPatterns` matches an edited file)

> **Precondition: the backend must actually be Node.js.** If you see `pom.xml`, `build.gradle`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, etc., this section does NOT apply — `MCP:ndt_*` tools won't connect to non-Node processes. Just do browser verification.

If the project has node backend verification enabled (`ironbee node enable` once at setup, by an operator who confirmed the backend is Node.js) and your edits touch matching paths (e.g. `server/**`, `pages/api/**`), the stop hook also enforces a Node cycle. The same `verification-start` covers both cycles; one platform-agnostic verdict covers both.

### Mode behavior (node cycle)
- **default** (no arg or `default`): probe / log only the code paths your diff touched. Map each changed file → the handler(s) it affects → place probes there.
- **full**: probe / log every Node code path reachable from files matching `node.verifyPatterns`, not just the changed files. Expect a much larger probe set and longer runtime.
- `visual` / `functional`: browser-only modes; this cycle behaves as `default` when they are passed.

### Steps (additive to the browser flow above)
1. **Identify the running Node process** — note its PID, container name (`docker compose ps`), or inspector port.
2. **Connect**: `MCP:ndt_debug_connect` with one of `pid` / `processName` / `containerId` / `containerName` / `inspectorPort` / `wsUrl`. Inspector is auto-activated via SIGUSR1 if needed.
3. **Pick an evidence path** for each changed code path:
   - **Probe path** (proves the code path executed): `MCP:ndt_debug_put-tracepoint` (or `put-logpoint` / `put-exceptionpoint`) at the changed code, exercise the path (e.g. trigger the API call from the browser), then `MCP:ndt_debug_get-probe-snapshots`. At least one probe must come back with `triggered: true`.
   - **Log path** (proves no errors): exercise the path, then `MCP:ndt_debug_get-logs` with the error level filter.
   - **Network path** (proves the expected outbound call happened): `MCP:ndt_o11y_get-http-requests` once to install the capture agent (forward-looking), exercise the path, then read it again and confirm the expected request(s) / status.
4. **Disconnect** (optional): `MCP:ndt_debug_disconnect`.
5. **Submit verdict** — platform-agnostic, just status + checks (+ issues/fixes).

### Verdict (platform-agnostic)
```json
{
  "session_id": "...",
  "status": "pass",
  "checks": ["POST /api/orders returned 201", "tracepoint at handler.ts:42 fired once"]
}
```

For a multi-cycle pass, both browser and node pass criteria must hold.

---

## Default Mode (node cycle)

Focus on the code you changed — not the entire Node service.

### 1. Study the changes
1. Run `git diff --name-only` and `git diff --name-only HEAD~1`
2. **Ignore `.ironbee/`, `.claude/`, `.cursor/`** — tool config, not application code
3. **Read the full diff** for every Node file in scope (handler / route / service / middleware) — note new branches, new validations, new error paths, new external calls, changed return values
4. Before connecting, you should be able to answer: which function(s) execute on the changed path? Where does a tracepoint prove the new code fired? What error logs would prove a regression?

### 2. Verify against the running process
- **Place a probe at each changed code site** — `MCP:ndt_debug_put-tracepoint` for "did it run", `MCP:ndt_debug_put-logpoint` for variable capture, `MCP:ndt_debug_put-exceptionpoint` for new throw branches
- **Exercise the path end-to-end** (trigger from browser, curl, or the backend cycle if active)
- **Each touched probe must report `triggered: true`** in `MCP:ndt_debug_get-probe-snapshots`
- **Check one edge case per new branch** — invalid input, missing field, auth failure, …
- **Logs** — `MCP:ndt_debug_get-logs` at error level; no ERROR-level entries are expected for `pass`

---

## Full Mode (`/ironbee-verify full`, node cycle)

Probe every Node code path reachable from files matching `node.verifyPatterns`, not just the changed files. Do NOT run `git diff` or scope to recent changes.

- Place probes at every handler / route / service entry point in scope, plus key internal branch points (early returns, error catches, conditional middleware)
- Exercise each path with at least one happy-path call AND one failure-path call
- No ERROR-level log entries are expected after the full run — any unexpected log error is a fail, regardless of when it was introduced
<!--/IRONBEE:PLATFORM:node-->

<!--IRONBEE:PLATFORM:python-->
<!-- Python runtime debug verification is OFF for this project.
     - If your backend is Python and you want non-blocking debugger probes
       (debugpy/DAP — tracepoints, logpoints, log + HTTP capture, thread dumps):
       run `ironbee python enable` to enable. This file will be auto-updated
       with the python-cycle guidance.
     - If your backend isn't Python: leave this OFF — `pdt_*` tools only attach
       to Python processes (debugpy) and will fail elsewhere.
     - When OFF, do NOT invoke any `pdt_*` tools voluntarily. -->
<!--/IRONBEE:PLATFORM:python-->

<!--IRONBEE:PLATFORM:backend-->
<!-- Backend protocol verification is ENABLED for this project. -->

## Backend Mode (when `backend.verifyPatterns` matches an edited file)

If the project has the backend protocol cycle enabled (`ironbee backend enable` once at setup) and your edits touch matching paths (e.g. `server/**`, `api/**`, `routes/**`, `controllers/**`), the Stop hook also enforces a Backend cycle. The same `verification-start` covers every active cycle; one platform-agnostic verdict covers them all.

This cycle is **runtime- and language-agnostic** — it works for Node, Java, Python, Go, Rust, Ruby, .NET, PHP, Elixir, Kotlin, Scala. The agent makes real protocol calls (HTTP / gRPC / GraphQL / WebSocket) against the running service, inspects logs, OR reads database state; it never attaches to a process.

### Mode behavior (backend cycle)
- **default** (no arg or `default`): exercise the endpoints your diff touched via ONE of the three evidence paths (protocol-call, log evidence, or DB evidence — see below). Map each changed file → the route(s) / handler(s) / RPC method(s) / table(s) it exposes, then either call them yourself and chain follow-ups to verify side effects, OR set up log capture, OR inspect database state directly.
- **full**: cover every endpoint reachable from files matching `backend.verifyPatterns`, not just the changed files. Cover the success path, at least one error path, and any auth-gated variant for each. For schema / migration changes, verify every affected table.
- `visual` / `functional`: browser-only modes; this cycle behaves as `default` when they are passed.

### Steps (additive to the browser flow above)

The cycle is satisfied by ANY ONE of three evidence paths: protocol-call (you drive the request), log-evidence (something else drives it; you read the logs), or DB-evidence (you inspect database state). Pick whichever fits the task — multiple can be combined.

1. **Confirm the backend service is running** (the user's dev server / Docker compose / k8s port-forward / …). Don't start the service yourself — ask the user if it's not obvious.
2. **Identify the affected layer** — wire endpoint, log output, and/or database state. Map your code change to its observable side(s).
3. **Exercise ONE or more evidence paths**:

   **Path A — Protocol-call (you drive the request):**
   - `MCP:bedt_request_http` — HTTP/1.1 + HTTP/2 (ALPN auto-negotiates).
   - `MCP:bedt_request_grpc` — unary + 3 streaming modes; `.proto` text or descriptor.
   - `MCP:bedt_request_graphql` — query/mutation/persisted query.
   - `MCP:bedt_request_websocket-open` then `bedt_request_websocket-send` / `bedt_request_websocket-receive` / `bedt_request_websocket-close` for stateful WS sessions.
   - `MCP:bedt_request_replay` — re-issue a captured curl command or HAR entry.
   - **Inspect the response** — `status`, body, headers, `traceId`. **4xx/5xx and gRPC non-OK are normal results, not transport errors.** Decide PASS/FAIL based on what the test actually requires.

   **Path B — Log evidence (an external driver hits the endpoint; you read the logs):**
   - `MCP:bedt_log_register-source` — register the running service's log destination (`type: "file"` + `path`, `type: "docker"` + `container`, or `type: "kubernetes"` + `pod`).
   - `MCP:bedt_log_read` / `MCP:bedt_log_read-multi` — point-in-time read with filters (`tail`, `since`/`until`, `pattern`, `level`, `parseJson` + `jsonFilter`, `contextBefore`/`contextAfter`, `select`, `coalesce`).
   - `MCP:bedt_log_follow` + `MCP:bedt_log_get-followed` (and `MCP:bedt_log_stop-follow`) — streaming follow when you need to capture lines that emit AFTER you trigger.
   - **Verify the lines match the expectation** — error gone, expected line present, trace-id chained through, no unexpected ERROR-level entries.

   **Path C — DB evidence (you inspect database state directly):**
   - `MCP:bedt_db_connect` — open a named connection (`type: "postgres" | "mysql" | "sqlite"`, prefer `connectionStringEnv` over inline `connectionString`, default `allowWrites: false`).
   - `MCP:bedt_db_list-tables` / `MCP:bedt_db_describe-table` — discover schema; great for migration verification.
   - `MCP:bedt_db_query` — run a read query (parametrized; readonly mode is enforced server-side).
   - `MCP:bedt_db_snapshot` (+ `MCP:bedt_db_diff`) — pre/post state diff so you can prove a code path changed exactly the rows it should have.
   - `MCP:bedt_db_watch-changes` + `MCP:bedt_db_get-changes` — streaming change capture for verifying writes triggered by a protocol call or external driver.
   - `MCP:bedt_db_transaction-begin/-commit/-rollback` — scope seed data to one test so it doesn't leak.
   - `MCP:bedt_db_disconnect` to clean up (optional — session teardown handles it).
4. **Chain follow-ups across paths** — protocol-call → DB read to verify writes landed, protocol-call → log read to verify trace-id chained, etc. Use `MCP:bedt_request_set-default-headers` for auth tokens (host-scoped), `MCP:bedt_request_set-cookies` for session state on Path A.
5. **Trace correlation (optional, `o11y_*` primitives):** IronBee already pins the verification cycle's traceId on every backend tool call via `_metadata.traceId` (outranks any session pin), so the orchestrator's correlation root is authoritative. Use `MCP:o11y_get-trace-context` to read it, then pass it to `MCP:bedt_log_read { pattern: "<traceId>" }` to slice logs for one flow. `MCP:o11y_new-trace-id` / `MCP:o11y_set-trace-context` are available when you want to anchor a flow under an explicit id (e.g. integration-test runs).
6. **Submit verdict** including the fields matching the path(s) you exercised. If browser and/or node cycles are also active, include their fields in the SAME verdict — do not submit two verdicts.

### Verdict (platform-agnostic)

The verdict shape is the same regardless of which evidence path (protocol-call / log / db) you took — `status` + `checks` (+ `issues` / `fixes` as needed):

```json
{
  "session_id": "...",
  "status": "pass",
  "checks": ["POST /api/orders returned 201 with order id", "GET /api/orders/:id reflects new order"]
}
```

The gate requires that AT LEAST one evidence path was actually exercised in your tool calls — `MCP:bedt_request_*` for protocol-call, `MCP:bedt_log_register-source` + `MCP:bedt_log_read*` / `_follow` for log-evidence, or `MCP:bedt_db_connect` + a read/diff/snapshot/get-changes for DB-evidence. If none were used, the gate will reject.

For a multi-cycle pass (browser + backend, or browser + node + backend), every active cycle's pass criteria must hold.

---

## Default Mode (backend cycle)

Focus on the endpoints you changed — not every endpoint in the service.

### 1. Study the changes
1. Run `git diff --name-only` and `git diff --name-only HEAD~1`
2. **Ignore `.ironbee/`, `.claude/`, `.cursor/`** — tool config, not application code
3. **Read the full diff** for route / handler / controller / service files in scope — note the wire-level address (HTTP method+path, gRPC service+method, GraphQL operation, WebSocket path), request shape, response shape, side effects (DB writes, downstream calls, queue puts)
4. Before opening the request or log tools, you should be able to answer: what endpoints did I touch? What does each return on the happy path? What does each return on the error path? What side effects need verification? Which side (request or log) is easier to drive for this task?

### 2. Verify against the running service
Pick the evidence path(s) that fit the task:

**Protocol-call path** (you drive the request):
- **Call each changed endpoint** with the matching tool — `MCP:bedt_request_http` / `MCP:bedt_request_grpc` / `MCP:bedt_request_graphql` / `MCP:bedt_request_websocket-open`
- **Cross-reference the response against the diff** — status, body shape, headers, gRPC status code
- **Chain a follow-up call** to verify side effects (POST then GET, set then list, mutation then query, …)
- **Test one error path** per new branch — invalid body, missing field, missing auth, 404 path
- **Capture `traceId`** when available — useful for joining with downstream cycle evidence

**Log-evidence path** (an external driver hits it; you read the logs):
- **Register the service's log source** with `MCP:bedt_log_register-source` (file / docker / kubernetes)
- **Read or follow** with `MCP:bedt_log_read` / `MCP:bedt_log_read-multi` (point-in-time, filter by `pattern` / `level` / `since-until` / `jsonFilter`) or `MCP:bedt_log_follow` (streaming for after-the-trigger capture)
- **Correlate with `traceId`** — use `pattern: "<traceId>"` to pull only the lines for one request
- **Verify the expected line is present** AND **no unexpected ERROR-level entries appeared** for the touched route(s)

**DB-evidence path** (you inspect database state directly):
- **Open a named, readonly connection** with `MCP:bedt_db_connect` — prefer `connectionStringEnv` so the secret never flows through the agent context.
- **Discover schema** via `MCP:bedt_db_list-tables` + `MCP:bedt_db_describe-table` for migrations / column additions.
- **Run targeted reads** via `MCP:bedt_db_query` for row-count, content, and constraint checks; `MCP:bedt_db_snapshot` + `MCP:bedt_db_diff` for pre/post state proofs; `MCP:bedt_db_watch-changes` + `MCP:bedt_db_get-changes` for streaming change capture during a triggered call.
- **Disconnect** when done (`MCP:bedt_db_disconnect`) — optional; the session tears connections down at end.

---

## Full Mode (`/ironbee-verify full`, backend cycle)

Exercise every endpoint / log source / DB table reachable from files matching `backend.verifyPatterns`, not just the changed files. Do NOT run `git diff` or scope to recent changes.

- Hit every route / RPC method / GraphQL operation / WebSocket lifecycle in scope (protocol-call) OR cover them via the log feed when an external driver / test suite drives them (log evidence) OR via direct DB inspection for schema / migration coverage (DB evidence)
- Cover the success path AND at least one error path for each
- Cover any auth-gated variant (unauthenticated, wrong role) where authentication is present
- For migrations: verify every affected table's schema (`MCP:bedt_db_describe-table`) + sample row count before / after
- Any unexpected error response, unexpected ERROR-level log line, or unexpected schema drift during the run is a fail, regardless of when it was introduced
<!--/IRONBEE:PLATFORM:backend-->

<!--IRONBEE:PLATFORM:android-->
<!-- Android mobile verification is OFF for this project.
     - To verify Android app changes by driving a real device or emulator (UI
       interactions, Logcat, screenshots): run `ironbee android enable`.
       This file will be auto-updated with the android-cycle guidance.
     - When OFF, do NOT invoke any `adt_*` tools voluntarily. -->
<!--/IRONBEE:PLATFORM:android-->

<!--IRONBEE:PLATFORM:terminal-->
<!-- Terminal interaction verification is OFF for this project.
     - To verify CLI / REPL / TUI changes by driving the program in a PTY
       (send input, read output): run `ironbee terminal enable`. This file
       will be auto-updated with the terminal-cycle guidance.
     - When OFF, do NOT invoke any `tdt_*` tools voluntarily. -->
<!--/IRONBEE:PLATFORM:terminal-->

---

## When to FAIL

If you observe ANY problem on any active cycle — wrong data, unexpected errors, broken interactions, missing evidence, anything that doesn't match the spec — you MUST submit a **fail** verdict.

**Do NOT rationalize away problems.** If something looks wrong or behaves unexpectedly, it IS wrong.

**After a fail verdict in fix mode, you MUST fix the issues and re-verify** — do not just report and stop. In verify-only mode (the default) the opposite holds: report and stop; fixing without the `fix` token is overstepping.

## Verdict Quality

Your `checks` array must list **specific observations**, not generic statements:
- GOOD: `["login form renders with email and password fields", "submitted valid credentials, redirected to /dashboard", "console clean — 0 errors"]`
- BAD: `["it works", "looks good", "feature implemented"]`

## Important
- ALWAYS submit a verdict after every verification attempt — both pass AND fail
- Do NOT edit code before submitting a fail verdict
- **Noticing a bug and submitting pass is the #1 violation** — if you see it, fail it
