# Execution loop — live proof

**Date:** 2026-09-07 · **Environment:** Trigger.dev prod, hosted staging Supabase
**Worker:** `v20260907.1`, then `v20260907.2` after the learning-prompt fix
**Organization:** `9f566f3d-61bd-497f-b77e-76a74f9d07c1` (Al Noor Kitchen)
**Script:** `scripts/execution-loop-proof.mjs`

## What this proves, and what it does not

The five workers below were written and unit-tested long before they were registered, and were
registered in code before they were ever deployed. Until this run, `get_current_worker` reported
26 tasks in prod and none of these five was among them: the second half of a campaign existed only
as source.

What is proved here is that each one reaches its real adapters, reads real rows, and returns an
answer rather than an exception. What is **not** proved is that a campaign can publish — no
provider is connected, the Tool Gateway is built with `adapters: []`, and Meta App Review is
client-owned. Two of the five are therefore expected to refuse, and their refusing _by name_ is the
result.

## Results

| Worker                          | Verdict                                 | Reading                                                                                                                                                                                                    |
| ------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `campaign.dispatch-due-actions` | `COMPLETED` — `considered: 0`           | Nothing due. The sweep runs and finds an empty queue.                                                                                                                                                      |
| `campaign.collect-metrics`      | `COMPLETED` — 1 considered, 0 collected | Refused `meta.metrics_capability_blocked`. The grant fence answers before the connection fence, which is the intended order.                                                                               |
| `campaign.allocation-cycle`     | `FAILED` — `DomainError`                | **By design.** Names all four unset `CAMPAIGN_ALLOCATION_*` variables. AGENTS.md forbids autonomous budget action beyond configured policy, and a default invented in code would not be configured policy. |
| `campaign.settle-outcome`       | `COMPLETED` — settled 1                 | Verdict `execution_only`; limitation recorded as "The campaign ran, but no observation of the primary metric was recorded." Replay wrote `restated`, so settlement is idempotent.                          |
| `campaign.propose-learning`     | `COMPLETED` — proposed 1                | See below.                                                                                                                                                                                                 |

`5/5 reached a verdict.`

## The learning proposal, and the defect that preceded it

On `v20260907.1` this worker returned `validation_failed` with overclaim `because`. It drafted a
lesson, was refused, redrafted, was refused again, and wrote nothing. **Both refusals were
correct** — an `execution_only` campaign measured nothing, so no sentence may say why anything
happened.

The defect was that the prompt never named the vocabulary that ends the attempt, and the repair
pass fed back bare labels (`resulted-in`, `causation`) that name a concept without saying what to
change. Both are now derived from `OVERCLAIM_PATTERNS`, so a pattern cannot be enforced but never
explained. The fence itself is unchanged.

First proposal ever written by this platform — `d243c523-2455-4783-8e5b-784423506760`:

> This campaign reached only 1 of the 3 planned exposures, and no observation of the primary metric
> was recorded during the 14-day window. For the next campaign, ensure metric tracking is active
> and delivery meets the planned exposure target.

No causal claim, no invented figure, and a lesson an owner could act on.

## What blocks the loop from being complete

- **Four numbers.** `CAMPAIGN_ALLOCATION_SPEND_CEILING_MINOR`, `CAMPAIGN_ALLOCATION_CTR_FLOOR`,
  `CAMPAIGN_ALLOCATION_MARGIN_FLOOR_MINOR`, `CAMPAIGN_ALLOCATION_MINIMUM_IMPRESSIONS`. They decide
  when the platform stops spending a client's money; they are the product owner's to set.
- **A publish adapter**, which waits on Meta App Review.
- `campaign.dispatch-due-actions` is registered but deliberately **not scheduled**: putting
  "publish to a client's public account" on a timer is a business decision, not a wiring one.

## Operator note

Both `deploy` attempts went silent for ~30 minutes and **both had already landed**. Confirm with
`list_deploys` / `get_current_worker` before believing the CLI or the MCP tool. This is the fourth
and fifth occurrence recorded on the collaboration board.
