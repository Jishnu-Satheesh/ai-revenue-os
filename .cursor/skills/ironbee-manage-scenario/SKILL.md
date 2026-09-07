---
name: ironbee-manage-scenario
description: "Add, update, or delete a reusable IronBee verification scenario. Authors the script in the devtools format and saves it to the scenario store (or finds and updates/deletes an existing one) using the scenario-* MCP tools."
disable-model-invocation: true
---

# IronBee — Manage scenario

> **⚠️ Run this inline — do NOT delegate.** Do every step yourself, in this conversation;
> do **not** use the `Task` tool or spawn a sub-agent. A sub-agent runs as a separate session,
> so its tool calls are recorded elsewhere and the work won't be tracked correctly.

Add / update / delete a reusable verification **scenario** using the devtools `scenario-*` MCP
tools directly. A scenario is a named, parameterizable script (`callTool('<tool>', {...})` JS) that
drives one OR MORE platforms' tools (all enabled platforms are served by the single
`ironbee-devtools` compose server; a single script may mix `callTool('bdt_…')` + `callTool('bedt_…')`).
This is NOT a verification cycle — it submits no verdict and does not gate completion.

## Steps
1. **Resolve intent.** Content to save (inline text or a file path you read) → add/update. A target
   only described → delete.
2. **Add vs update (never duplicate).** Before adding, `scenario-search` / `scenario-list` to
   check for a same-name / clearly-the-same scenario in the store; if it exists → update
   it instead of creating a duplicate.
3. **Author the script** (see "Script format") and call `scenario-add` / `scenario-update` on the one
   compose server. The script may drive a single platform OR span several in one flow — author a
   cross-platform flow as ONE scenario; do NOT split it per platform. Record the platform(s) it drives
   in `ironbee.platform` / `ironbee.platforms` metadata.
4. **Delete is destructive — always confirm.** Resolve the target, show the matched
   **name + description + platform**, and ask the user before deleting. Multiple / low-score
   candidates → list them and ask which. An **update resolved by fuzzy description** also confirms
   (the script is overwritten); an exact-name update proceeds without confirm.
5. **Scope**: pass `scope: "project"` (default) unless the user asked for `global`.

## Live authoring (default for add / update) — build it against the running app

Don't author a runtime scenario from source guesses (source rarely matches the running system exactly). By **default, drive the app to
understand it — exactly what you'd do when verifying** (exercise the relevant flow through this platform's tools, whatever it takes) — author from what you actually observe, then validate by running it. Do this
entirely through the `scenario-*` tools (run discovery via `scenario-run`, don't call the platform
tools directly: that keeps it gate-orthogonal — no `verification_id`, can't false-block a later edit).

1. **`draft` → skip:** if the request begins with `draft` (or says "source only"), author from source,
   save, note *"not live-validated — run it to verify"*. Done.
2. **Start the app only if it isn't already running** (track whether YOU started it). Can't start it
   (missing env/DB/secrets, broken build) → **source-only draft + say so**, don't fail.
3. **Understand it by running probe scenarios:** `scenario-add` the draft **under the FINAL scenario
   name** (step 4 then iterates that SAME entry via `scenario-update` — do NOT spawn a separate
   `*-probe` / throwaway scenario in the store) and `scenario-run` it to exercise the relevant flow —
   whatever it takes to learn how the real system behaves — and read the returned snapshots/results.
4. **Author the full flow** from what you observed → `scenario-update`. Make it a **verification flow**,
   not a superficial run: exercise the cycle's evidence tools, capture their output with
   `returnOutput: true`, and assert / return the expected outcomes — so running it later via
   `/ironbee-verify scenario:<name>` can judge it and satisfy the gate.
5. **Validate:** `scenario-run` end-to-end; fix the **SCRIPT** + update until it runs cleanly, and
   **assert the real terminal outcome — not an optimistic intermediate signal**. Same app/env
   considerations as any verification run (use a test/staging target for flows with real side effects).
6. **Teardown — leave a clean store:** `scenario-delete` ANY temporary / probe / throwaway scenario you
   added this session (anything named `*-probe`, a draft you decided not to keep, an exploratory copy);
   the store must end with ONLY the finished deliverable scenario(s), never a leftover probe. THEN stop
   ONLY the app / processes you started.

> **A genuine defect is a STOP, not a workaround.** If validating shows the flow can't legitimately
> succeed — a real bug makes the expected outcome unreachable (an error, a failed state, wrong
> resulting data) — do NOT engineer the scenario around it: don't cherry-pick inputs / args / data that
> dodge the bug, and don't weaken the assertion to an optimistic intermediate signal instead of the
> real terminal outcome. That yields a green scenario that masks a broken flow and produces a FALSE
> PASS when it's later run to verify. Instead STOP and report the defect to the user **in your summary,
> not inside the scenario** — keep the saved scenario a clean verification flow (it asserts the real
> outcome and will simply fail until the bug is fixed; that's it doing its job). Do NOT bake bug /
> defect commentary into the scenario's `description` or metadata; `liveValidated: false` is the only
> signal needed when you couldn't get a passing run — or leave the scenario unsaved. ("Fix until it
> passes" means fixing the SCRIPT, never working around the app.)

## Script format
JS run in the devtools sandbox (async — top-level `await`/`return` work); reads its inputs from `args`:

```js
const { baseUrl } = args;            // declared in the scenario's `params` contract
const result = await callTool('<bare-tool-name>', { /* tool input */ });
return { ok: true };
```

Discover the available `callTool` tool names for a platform from your connected MCP schemas — don't
guess. Declare each input via the first-class **`params`** contract (§Parameters), not `argsSchema`.

## Parameters (`params`) — typed, defaulted, validated
Declare a parametric scenario's inputs via the first-class **`params`** array on
`scenario-add` / `scenario-update` (top-level field, NOT metadata — supersedes the old `argsSchema`
convention). Each entry: `name` (required — the `args` key the script reads), `description`, `type`
(`string`/`number`/`boolean`/`object`/`array`; `object`/`array` shallow-checked at the top level),
`default` (applied when the arg is omitted — **capture it from the live-authoring run** so the
scenario re-runs "as captured" with zero args), `example` (doc-only shape when there's no `default`),
`required` (reject the run when there's no value AND no `default`). `scenario-run` applies defaults,
enforces `required`, shallow-validates declared types, and surfaces `params` in list/search/run
output. Pass `args` only to OVERRIDE a default. `scenario-update` shallow-replaces `params` (re-send
the full array; omit to keep the stored contract).

## Metadata conventions (stamp on add/update)
**Shape — a NESTED object** under the scenario's `metadata` field: `metadata: { ironbee: { coveredPaths: [...], platforms: [...], commit: "…" } }`. `ironbee.<key>` names a key INSIDE that nested object — do NOT write a literal dotted key (`"ironbee.platforms"`) and do NOT JSON-stringify it.
- `ironbee.coveredPaths` — source paths exercised (array), when derivable.
- `ironbee.group` / `ironbee.order` — for a multi-step flow kept as SEPARATE scenarios that must run in sequence (NOT a per-platform split — a cross-platform flow is ONE scenario).
- `ironbee.platform` / `ironbee.platforms` — the platform(s) the scenario drives (string, or array for a cross-platform scenario).
- `scenario-update` does a **shallow replace** of metadata (and of `params`) — to change one key,
  re-send the FULL object / array (read it first, merge, write back). The typed input contract is the
  first-class `params` field (§Parameters), not a metadata key.

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
