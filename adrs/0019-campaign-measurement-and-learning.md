# ADR 0019: Qualify campaign success by registered evidence and keep learning campaign-scoped

## Status

Accepted.

## Context

Provider activity is easy to count but does not prove incremental gross profit or customer acquisition. At pilot volume, attribution is often weak and repeated analysis can manufacture confidence. Creative observations can also become unsafe policy drift if they automatically rewrite brand or approval rules.

## Decision

- Every executable Campaign Bundle preregisters a registered primary business metric, baseline and lookback, unit of analysis, exposure/tracking requirements, attribution or experimental method, outcome window, reporting delay, minimum evidence quality, economics, guardrails, stopping conditions, and insufficient-evidence fallback.
- Measurement joins the exact approved version to provider receipts, reconciled spend, exposure evidence, registered metrics, and settled outcomes.
- The only campaign conclusions are `validated_outcome`, `inconclusive`, `guardrail_breach`, and `execution_only`.
- Impressions, reach, reactions, engagement, and clicks are diagnostics unless the approved measurement plan gives them a separately valid role. Correlation is never relabelled as incremental impact.
- Static brand creative does not use switchback analysis in the first implementation. A Meta randomized experiment is allowed only if the live provider contract and controlled-account evidence prove eligibility; otherwise the preregistered observational method reports its limitations and may conclude `inconclusive`.
- Models may summarize a completed deterministic result but cannot choose the verdict, attribution method, stopping rule, or economic calculation.
- Creative and execution observations remain local to their Campaign. A reusable recipe is a versioned learning proposal with supporting and contradicting evidence, scope, limitations, and review date.
- Promotion into Business Memory, brand guidance, a playbook, or another Campaign is a separate governed decision. Hard policy, factual truth, privacy, and provider restrictions are never weakened by performance.

## Consequences

- Verified publication can honestly conclude `execution_only` rather than being presented as business success.
- `Inconclusive` is a valid expected result, especially at pilot scale.
- The platform collects reusable evidence without silently changing live behavior.
- Campaign reporting must display method, window, evidence quality, uncertainty, and economic assumptions with every conclusion.

## References

- `adrs/0013-gated-artifact-learning.md`
- `adrs/0014-decision-value-and-evidence-tiers.md`
- `specs/011-learning-ledger.md`
- `specs/014-switchback-experiments.md`
- `context/16-testing-evaluation.md`
- `context/21-learning-system.md`
