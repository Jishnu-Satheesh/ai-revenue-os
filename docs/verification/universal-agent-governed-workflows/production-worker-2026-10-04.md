# Universal Agent deployed worker verification

Trigger.dev production release **20261004.1** is deployed and promoted for project `proj_wjxnpmlspegvfcymhpxj`. The user explicitly requested worker deployment and live testing after the earlier staging acceptance. [Deployment receipt](https://cloud.trigger.dev/projects/v3/proj_wjxnpmlspegvfcymhpxj/deployments/yqwwg7am) and [sanitized run/database receipts](production-worker-2026-10-04.json) record the result.

## Deployment scope

- Built using CLI 4.6.0, matching the installed SDK/build packages. No dependency or configuration upgrade was introduced.
- Built without promotion, checked the registered tasks, then promoted. All 46 previous tasks remain; the release adds `agent-chat.process-turn`, `agent-chat.process-attachment`, `agent-chat.recover-turns`, and `agent-chat.purge-thread-retention` for 50 tasks total. Analysis, narration, and governed report workers are registered.
- The existing production allowlist already included staging organization `2dda45b8-82db-4f5f-b17d-611b9bbb7846`. No environment values or organization gates were changed.
- The production Trigger environment uses the existing hosted staging data. An authenticated local compiled Next.js app exercised the actual request routes with its production Trigger key. This verifies deployed workers and persisted results; hosted Vercel web deployment remains pending.
- The remote build reached `DEPLOYED` despite the CLI build-log stream timing out. Deployment status and the promoted worker version were checked through the API; the interrupted stream was not treated as a failed build.

## Fresh deployed journeys

| Journey                                   | Turn / worker receipt                                                                                                       | Persisted result                                                                                                                                                                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One-month improvement advice              | `dab4ff7b-1899-4a29-8598-05736dfee26b` / `run_06ggfbj06p2c15dnt95m8u8o01`                                                   | One answer with an existing campaign proposal, owner/baseline first step, and weekly measurement. One `period_switched` event moves September 1–30 to August 8–30; historical evidence limitations remain explicit.                                          |
| Missing Talabat analysis                  | `b9f603ab-03f0-4e6a-a49f-d9dd502c1549` / `run_06ggfbk4h4sls1lh025rif0401`                                                   | Requested August 1–29. Source analysis and narration completed before the final answer; the exact audit link is present. Events are `turn_queued → analysis_started → analysis_completed → answer_completed`.                                                |
| Uploaded report with branch clarification | `6565643b-4654-4aaa-9e63-76b198ae56dc` / initial `run_06ggfblhp2htstmlhqlt6cla01`, resumed `run_06ggfcnk2n02equu9r2gbs5i01` | “Jumeirah” did not exactly identify the registered “jumeirah branch” label. Only `branchId` was requested. The saved Questionnaire was answered through the authenticated API, the turn resumed, reused the original package, and produced one final answer. |
| Fully specified uploaded report           | `dd62bd65-9dc5-4166-ad0b-5671f1f8ee5d` / `run_06ggfd31atuoj2dl4qpnro9i01`                                                   | The exact registered branch label, report type, dates, and currency resolved without a Questionnaire. Real signed resumable upload returned 201/204. The worker reused the original package and audit and produced one final answer.                         |

Both uploads reused package `25b9208c-d067-49c2-b61a-a977ee2f1350` and linked audit `07c0acb1-204c-449c-a55f-4d1b60ec0d18`. The two existing packages at that declared scope predate these canaries; no new source package was created.

The new channel source worker `run_06ggfbkrkef2orifl1qtp0ql01` completed with 15 observations, four data checks, and no problem findings. Narrator `run_06ggfbm0h6heft6htkt79oi401` completed; a direct member-authorized database read confirmed seven recommendation rows. A concurrent narration wake `run_06ggfbnao5kiv4vrtce26u7c01` safely returned `skipped` under the source lease fence. Zero problem findings did not bypass narration.

## Monitoring and replay

- The monitoring snapshot records **42 production runs, all `COMPLETED`**, from the release's observed flow window beginning at 16:10 UTC. No failed, crashed, timed-out, or system-failure run states were present in that snapshot. This is a bounded observation, not an ongoing uptime guarantee.
- All four turns were `completed`, with no failure code or pending question and exactly one assistant message. Reopening through the authenticated APIs restored events, and replaying the original turn-start request returned the same turn with HTTP 200.
- Replaying the completed advice worker created `run_06ggfdh4m6c3r717bjijllnpc1`. It completed with `turn_unavailable`, as intended for a terminal turn, and created no duplicate answer.
- The recovery task completed production ticks at 16:10, 16:15, and 16:20 UTC. Its active schedule is `*/5 * * * *`. Retention is registered and active at `0 3 * * *` UTC; its first execution after this release is not claimed by this check.
- Terminal parent traces were inspected. Advice and both report answers logged `agent_answer.synthesis_failed` with `TimeoutError` and used the existing source-evidence fallback. Their answers remained populated and linked to their sources. Channel synthesis succeeded. This verifies fallback continuity, not reliable answer-model latency. Some optional advice context readers also returned unavailable states; the saved answer states those limits.
- Trigger traces also report that waits of five seconds or less count toward compute usage. No polling/cost policy was changed during this deployment.

## Release boundaries and cleanup

No code, schema, model, budget, provider qualification, public campaign, or financial policy was widened during deployment. The earlier [970-test / 89-database-assertion verification](2026-10-04.md) remains the code and authorization baseline. No Git push or Vercel deployment was performed. To roll back worker promotion, the previous registered version is `20260928.3`; preserve durable turn/package history and reconcile nonterminal work under the existing fences.

Only sanitized receipts remain in the repository. Temporary sign-in/session material, private workbook bytes, full traces, canary scripts, and the local test server are removed after verification. Source staging audit and report history remains intact.
