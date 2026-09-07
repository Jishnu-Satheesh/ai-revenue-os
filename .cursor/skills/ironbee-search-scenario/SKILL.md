---
name: ironbee-search-scenario
description: "Find reusable IronBee verification scenarios by name, description, or metadata in the scenario store, using the scenario-search / scenario-list MCP tools."
disable-model-invocation: true
---

# IronBee — Search scenarios

> **⚠️ Run this inline — do NOT delegate.** Do every step yourself, in this conversation;
> do **not** use the `Task` tool or spawn a sub-agent. A sub-agent runs as a separate session,
> so its tool calls are recorded elsewhere and the work won't be tracked correctly.

Find saved verification **scenarios** using the devtools scenario tools directly. Read-only.

## Steps
1. **Pick the surface:**
   - **`scenario-search`** (fuzzy, ranked over name + description) — discovery ("find login
     scenarios").
   - **`scenario-list` with `metadataMatch`** — precise structural lookup ("which scenarios cover
     `src/auth/login.ts`"). Metadata is NOT indexed by `scenario-search`, so path/tag lookups use
     `scenario-list`.
2. **One server, one search** — all scenarios live in the single `ironbee-devtools` store, so one
   `scenario-search` / `scenario-list` covers everything (no union across servers).
3. **Report** name + description + platform + (for fuzzy search) relevance score; surface scope.

The platform sections below give each enabled cycle's tool prefix + what to test. All cycles share ONE `ironbee-devtools` server, the UNPREFIXED `scenario-*` tools, and the flat `.ironbee/scenarios` store (you pass `scope`; the server resolves the path — no per-prefix subdir). A single scenario script MAY call tools across platforms in one flow — author it as ONE scenario, not split per platform.

<!--IRONBEE:PLATFORM:browser-->
### browser platform (enabled)
- **Use for**: UI / frontend scenarios driven through a real browser.
- Scenario **scripts** call this platform's tools via `callTool('<bare-tool>', {...})` — discover
  the available `bdt_*` tool names from your connected MCP tool schemas; don't guess.

**What to test & how — capture the SAME evidence the verifier would** (a scenario runs FOR
verification, so its script must collect what the browser cycle collects). In the script:
1. **Navigate** — `bdt_navigation_go-to` to the affected page(s), then **actually interact** (click
   buttons, fill forms, submit data, trigger the workflow that changed). A click-through that asserts
   nothing verifies nothing — the interaction is what makes the evidence meaningful. **Target elements
   with the `selector`/`ref` the aria-snapshot returns for each** (e.g. `getByRole(...)` or `@e12`) —
   do NOT hand-parse the snapshot TEXT with regex/string-matching: embedded quotes or special chars in
   labels make that brittle (it silently misses elements). This includes deriving a positional
   **`.nth(i)`** index by parsing the snapshot — a quote or special char in any earlier label shifts
   every index, so the click lands on the wrong element (or none). Pick each element by its own
   `getByRole(...)`/`ref`, or scope it to the matching card/row with a CSS `:has()` selector (e.g.
   `.product-card:has(h4:has-text('Widget')) button:has-text('Add to cart')`). NOTE: the
   browser-tool resolver accepts only a flat `getByXYZ(...)` expression OR a CSS string — Playwright
   locator chaining like `.filter({ hasText })` does NOT parse. Never compute element positions from
   snapshot text.
2. **Screenshot** — `bdt_content_take-screenshot` (or `includeScreenshot: true` on a nav/interaction
   call) **with `returnOutput: true`, and put the returned `filePath` (absolute path to the saved PNG)
   in your result**. The later verifier opens that file with its `Read` tool to judge the pixels
   (readability, layout, cut-off content, expected render). **Do NOT set `includeBase64`** — a nested
   scenario screenshot is NOT surfaced as an inline MCP image (`scenario-run` strips nested image data)
   and base64 only bloats the result; the returned `filePath` is how visual judging works.
3. **Accessibility** — `bdt_a11y_take-aria-snapshot` (or `includeSnapshot: true`), called with
   `returnOutput: true` — the snapshot TEXT is what the verifier reads to judge page structure.
4. **Console** — `bdt_o11y_get-console-messages` with `returnOutput: true` to surface errors.

`return` the evidence — aria-snapshot text, page text (`bdt_content_get-as-text`), console errors, the
screenshot `filePath`s — **plus explicit pass/fail assertions**. That returned result is what
`/ironbee-verify scenario:<name>` reads to judge the run: functional + structural from the text, and
**visual by `Read`ing the returned screenshot files**. Capture the evidence AFTER the interactions
whose state you want to assert; for an intermediate state (a modal that opens then closes) capture at
that point too.
<!--/IRONBEE:PLATFORM:browser-->

<!--IRONBEE:PLATFORM:node-->
### node platform (enabled)
- **Use for**: Node.js runtime-debug scenarios (V8 inspector probes / logs).
- Scenario **scripts** call this platform's tools via `callTool('<bare-tool>', {...})` — discover
  the available `ndt_*` tool names from your connected MCP tool schemas; don't guess.

**What to test & how — capture the SAME evidence the verifier would** (a scenario runs FOR
verification, so its script must collect what the node cycle collects). In the script:
1. **Connect** — `ndt_debug_connect` (one of `pid` / `processName` / `containerName` /
   `inspectorPort` / `wsUrl`).
2. Pick an **evidence path** for the changed code path:
   - **Probe path** (proves the code path executed) — set a probe at the changed location
     (`ndt_debug_put-tracepoint` / `ndt_debug_put-logpoint` / `ndt_debug_put-exceptionpoint`),
     **exercise the path** (drive it via a request / CLI / another platform's call — without this the
     probe never fires), then read `ndt_debug_get-probe-snapshots`; at least one probe must come back
     `triggered: true`.
   - **Log path** (proves no errors during execution) — exercise the path, then `ndt_debug_get-logs`
     filtered to the error level (no ERROR-level entries = pass).
   - **Network path** (proves the expected outbound call happened) — `ndt_o11y_get-http-requests`
     once to install the capture agent (forward-looking), exercise the path, then read it again and
     assert the expected request(s) / status.

`return` the probe snapshots / logs / captured flows (read them with `returnOutput: true` so their data reaches the
script's `return`) **plus explicit pass/fail assertions** so a later verify run can judge them.
**The node platform (`ndt_*`) is
Node.js ONLY** — never author `ndt_*` scenarios for Java / Python / Go / Rust / Ruby / .NET / PHP
backends; use the **python** platform for Python and the **backend** platform for the rest.
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
### backend platform (enabled)
- **Use for**: backend protocol scenarios (HTTP / gRPC / GraphQL / WebSocket / DB).
- Scenario **scripts** call this platform's tools via `callTool('<bare-tool>', {...})` — discover
  the available `bedt_*` tool names from your connected MCP tool schemas; don't guess.

**What to test & how — capture the SAME evidence the verifier would** (a scenario runs FOR
verification, so its script must collect what the backend cycle collects). At least ONE evidence path
is required — in the script, exercise one+:
- **Protocol-call** — `bedt_request_http` / `bedt_request_grpc` / `bedt_request_graphql` /
  `bedt_request_websocket-open…` / `bedt_request_replay`; inspect the response `status` / body /
  headers (4xx/5xx and gRPC non-OK are NORMAL results, not transport errors — decide pass/fail by what
  the task requires). Chain POST→GET to confirm side effects.
- **Log-evidence** — `bedt_log_register-source` then `bedt_log_read` / `bedt_log_read-multi` /
  `bedt_log_follow` (filter by level / pattern / trace-id) when an external driver hits the endpoint.
- **DB-evidence** — `bedt_db_connect` (read-only by default) then `bedt_db_query` /
  `bedt_db_describe-table` / `bedt_db_snapshot` + `bedt_db_diff` to inspect state after a migration /
  write.

`return` the responses / log lines / rows (capture each read with `returnOutput: true` so the data
reaches the script's `return`) **plus explicit pass/fail assertions** so a later verify run can judge
them. Runtime-agnostic —
works for any backend language (Node, Java, Python, Go, Rust, Ruby, .NET, …).
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
