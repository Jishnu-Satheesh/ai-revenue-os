# Universal Agent answer reliability evidence

The [approved governed-workflows closure](../../superpowers/plans/2026-10-01-universal-agent-governed-workflows.md) repairs the causes found after release `20261004.1`. This receipt records synthetic provider verification and read-only hosted staging checks. It does not establish acceptance of a later deployed worker. The earlier [production receipt](production-worker-2026-10-04.md) records three final-answer `TimeoutError` fallbacks and one successful channel synthesis.

## Answer latency diagnosis and synthetic comparison

The configured answer model was `gemini-3.6-flash`. The answer call had a 15,000 ms deadline, an 8,192-token output cap, no explicit thinking level, and the SDK's default retry behavior. Gemini's dynamic reasoning can consume the deadline before the final JSON answer is written. The original failed production traces do not expose a per-phase provider timing breakdown, so this is a reproduced contributing cause rather than proof of the internal timing of every earlier failure.

The user-authorized comparison made exactly two provider calls with the same configured model, synthetic organization context, ten synthetic recommendation rows, system/prompt/schema, temperature `0.7`, output cap `8192`, `maxRetries: 0`, and 15,000 ms deadline. No tenant source text was sent. Only timing, finish reason, schema validity, and token counts were retained; generated answer text and prompts were discarded.

| Provider thinking option | Duration | Input tokens | Reasoning tokens | Visible output tokens | Total output tokens | Total tokens | Finish | Schema valid |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| No explicit override | 13,400 ms | 1,861 | 2,313 | 315 | 2,628 | 4,489 | `stop` | Yes |
| `low` | 3,280 ms | 1,861 | 0 | 362 | 362 | 2,223 | `stop` | Yes |

This one-pair comparison shows the low-thinking call completed with substantially more deadline headroom. It is not a latency distribution or uptime guarantee. The saved fix requests Gemini 3 `low` thinking for Quick and `medium` for DeepThink, disables provider-call retries, and retains the model, temperature, output cap, and 15-second deadline. Other model families receive no Gemini 3 thinking options. DeepThink latency was not measured in this comparison. Success and failure logs contain duration and available identifiers, without prompt or answer text.

Google documents the [Gemini thinking controls](https://ai.google.dev/gemini-api/docs/thinking); the installed SDK receives them through [Google provider options](https://ai-sdk.dev/providers/ai-sdk-providers/google).

## Optional advice and Memory read diagnosis

Read-only staging probes used the existing worker service client and an explicit organization scope. They retained only error codes and counts.

| Read | Before repair | After repair proof |
| --- | --- | --- |
| Personal recommendation preferences | `42501` permission denied | Shared answer composition uses the source reader's existing empty actor ID to skip personal pins/snoozes; no source grant changed. |
| Personal Growth Intelligence feedback | `42501` permission denied | Actual source reader call with viewer-neutral actor returned 17 candidates and an empty lane-error map. Source-owned decision/item reads remain active. |
| Memory structured-fact query | `PGRST100` parsing `value::text.ilike` inside a horizontal filter | Actual persistence-module call returned four matching facts without the parse error. The scoped organization had 14 facts at probe time. |

PostgREST supports casts in selected fields, but [rejects casts in horizontal filters](https://docs.postgrest.org/en/stable/references/api/tables_views.html). The repair reads at most the 200 most recently updated facts within the existing authorized organization/optional-branch scope, ordered by `updated_at` then `id`. Deterministic matching retains substring matches in fact keys and JSON values, including numeric values, then applies the caller's result limit. Facts older than this candidate window are outside recall. No RPC, migration, RLS policy, or source-table grant was added. Denied and failed source reads still throw; they do not become empty search results.

The staging fixture did not contain a suitable three-digit numeric value for a numeric-only live match. Numeric JSON matching is verified by the regression fixture, not claimed from live data. The read-only probe did not invoke full Memory retrieval because that path writes its existing retrieval audit log.

Shared advice still checks current source permissions. Shared-history Memory uses the existing internal sensitivity ceiling rather than an owner's wider private allowance. Existing Memory retrieval applies sensitivity authorization before search and retains fact status/freshness filtering and projection.

Successful answers now merge advice-reader and context-pack limitations ahead of model-generated limitations, deduplicate them, and apply the existing 60-limitation draft bound. Source gaps remain visible even if the model omits them, within that bound. Those limitations are also supplied to synthesis. Model failures retain the source-evidence fallback, citations, period switch, and exact audit links.

## Regression verification

The focused regressions cover Quick/DeepThink provider options, retry/output limits, unsupported-model options, successful-answer source-failure visibility, omitted context-pack warnings and deduplication, shared advice without personal table access, JSON and numeric fact matches, organization/branch scope, the 200-candidate bound, denied-read propagation, Memory sensitivity denial, and source period/error behavior.

| Regression file | Latest passing tests |
| --- | ---: |
| `src/modules/agent-chat/application/answer-writer.test.tsx` | 69 |
| `src/modules/agent-chat/application/api.test.ts` | 13 |
| `src/modules/agent-chat/application/advice-context-reader.test.ts` | 8 |
| `src/modules/memory/infrastructure/repository.test.ts` | 18 |
| `src/modules/memory/application/retrieval.test.ts` | 12 |

The five-file run passed 119 tests before the final pack-warning regression was added. That regression failed first because the omitted source gap was missing, then the entire answer file passed all 69 tests after the retention fix. The latest results cover 120 distinct tests across those files. Earlier client-module boundary verification also passed all 211 tests; no static provider or server-only import was added to the client-importable answer module.

Scoped ESLint passed on the answer writer/test, application API/test, Memory persistence/repository test, and fact projection. Answer writer/test lint was rerun after the final retention fix and passed. Scoped `git diff --check` passed. The only warning in the passing Vitest output was: “The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.”

The final source review found no new critical or high-severity defect in these repairs. It checked the shared audience's internal sensitivity ceiling, source authorization flags, tenant/branch-scoped fact query, unchanged status/freshness disposal, failed-read propagation, strict answer-schema validation, and deterministic source-warning retention. Repository-wide type checking and release/live canaries are owned by the release coordinator; this receipt does not claim their results.

## Remaining live acceptance

The new worker must demonstrate a real Quick answer with `agent_answer.synthesis_completed` and its safe duration metadata, plus fresh advice/report source context without the diagnosed personal-table and PostgREST errors. A completed durable turn or populated fallback alone does not prove answer-model success. DeepThink remains independently subject to its existing 15-second deadline. Hosted web deployment is excluded from this closure.

Temporary provider/source probe scripts were removed. This receipt contains no credentials, raw tenant source content, generated answer text, signed URLs, or complete provider traces.
