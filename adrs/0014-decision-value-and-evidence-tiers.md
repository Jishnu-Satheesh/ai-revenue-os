# ADR 0014: Denominate decision value in money, rank by evidence tier before score, and treat risk as a gate

## Status

Accepted; supersedes the scoring model in `context/08-decision-engine.md`.

## Context

`context/08-decision-engine.md` proposed a single priority expression:

```
priority = expected_incremental_gross_profit * confidence * strategic_fit
         - execution_cost - risk_penalty - opportunity_delay_penalty
```

Three problems surfaced when the expression was checked against the schema and against the rest of the documentation pack.

**The expression does not type-check.** Expected incremental gross profit and execution cost are money in integer minor units. Confidence is a unit interval. `strategic_fit`, `risk_penalty`, and `opportunity_delay_penalty` have no declared unit, and subtracting an undeclared quantity from a money quantity produces a number whose meaning cannot be stated. `context/14-coding-standards.md` requires money in integer minor units with an ISO currency code; a score that mixes currency with unitless penalties silently discards that discipline at the exact point where the platform makes its central claim.

**Three of the six terms have no data source.** `strategic_fit` would require joining a playbook's primary metric to a `Goal`, but `goals.metric` is free text with no metric registry anywhere in the repository, so the join does not exist. `risk_penalty` would require risk as a magnitude, but ADR 0007 and `specs/010-human-approval-governance.md` define risk as a categorical tier that selects an approval path. `opportunity_delay_penalty` would require time-to-impact estimates that no component produces. Shipping the expression would mean seeding three constants and presenting the result as a computation.

**Pricing risk contradicts ADR 0007.** Subtracting a risk penalty makes risk purchasable: a sufficiently valuable Tier 3 action outranks a safe Tier 1 action, and the ranking implies the platform has traded them off deliberately. ADR 0007 decided that risk determines *who approves*, not *how much an action is worth*.

A fourth problem is independent of the expression. The engine will produce two species of opportunity whose value claims carry incomparable evidentiary weight. A margin breach found by the channel economics ledger is arithmetic: `specs/013-margin-firewall.md` argues correctly that it needs no attribution window, no control group, and no statistical power. A projected conversion lift from a listing change is inference, with a wide range and, at single-branch volume, no realistic prospect of validation inside a normal measurement window. Sorting both into one numeric field declares them commensurable. A guessed AED 4,000 then outranks a computed AED 3,000, and the feed teaches the operator that every figure on it carries the same weight. When the inferred figure misses, it discredits the arithmetic alongside it — and the arithmetic is the platform's most defensible claim.

## Decision

- **Value is denominated in money or it is not part of the score.** The only ranking quantity is `expected_contribution_minor`, an integer in minor units with an explicit currency: the point estimate of expected incremental gross profit multiplied by confidence, less execution cost. Every opportunity also stores the low and high bounds of its impact range; the point estimate exists to sort and is never displayed without its range.

- **Evidence tier is a sort key ranked above value, never a term inside it.** Tiers, in descending order: `computed`, `observed`, `prior`. The feed sorts by tier first and by `expected_contribution_minor` within a tier. Values from different tiers are never blended, summed, or compared as though equivalent, mirroring the rule in `specs/013-margin-firewall.md` that avoided loss and realized incremental gross profit are separate lines.

- **An opportunity with no defensible value estimate is not an opportunity.** It is a `needs_data` decision, consistent with `specs/005-decision-engine-v1.md` and with the treatment of `indicative` margins in `specs/012-channel-economics-ledger.md`.

- **Risk is a gate, not a term.** The policy check assigns a tier from `specs/010-human-approval-governance.md` and selects an approval path. Tier 4 removes a candidate from the set with a recorded reason. Tiers 0 through 3 do not alter the score in either direction.

- **Confidence is rule-derived and versioned.** It is a deterministic function of evidence tier, input freshness, completeness grade, and sample size where observed history is used. It is the `confidence_calibration` artifact in `context/21-learning-system.md` and is resolved through the version tuple. No model emits a confidence value.

- **Goal alignment is a screening predicate, not a multiplier.** Where an organization has active goals and a metric registry exists, a playbook whose primary metric key matches no active goal is screened out with a recorded reason. An organization with no active goals is not penalized. `strategic_fit` is removed.

- **Time to impact is a displayed field and a tie-break, not a penalty.** It is shown on the opportunity card per `specs/007-revenue-opportunity-feed.md` and breaks ties within a tier at equal value. It never modifies the value.

## Consequences

- The score means one thing: the expected contribution, in this organization's currency, of taking this action rather than none. It can be checked by hand, disputed by an operator, and compared against a realized outcome. That is the property the previous expression lacked.

- The ranked feed is honest about the difference between arithmetic and inference at the level of ordering rather than in a caveat, so an operator learns the distinction through use.

- Ranking `computed` above `observed` above `prior` means a small, certain saving outranks a large, speculative gain. This is intended. It matches the ranking heuristic in `context/22-opportunity-backlog.md`, which prefers provability over new actions, and it is what makes the first weeks of the product defensible.

- The engine cannot produce money-denominated opportunities until the channel economics ledger supplies contribution margin at a `complete` or `partial` grade. This is a real sequencing dependency rather than a limitation to work around, and `context/20-roadmap.md` is amended accordingly.

- Removing `strategic_fit` leaves goal alignment unenforced until a metric key registry exists. Until then, alignment screening is inactive and every eligible playbook competes on value alone.

- Confidence becomes an artifact with a version, an evaluation history, and a calibration obligation. It cannot be tuned casually, which is the point, but it does mean the first version is a seeded human judgment rather than a fitted one, and it must be labelled as such.

- Because risk no longer enters the score, a high-value Tier 3 candidate will rank first and then sit in an approval queue. Throughput is therefore governed by approval capacity rather than by the ranking, which is the correct place for the constraint to bind and is visible in the scorecard as approval latency.

## References

- `context/08-decision-engine.md`
- `specs/005-decision-engine-v1.md`
- `specs/007-revenue-opportunity-feed.md`
- `specs/010-human-approval-governance.md`
- `specs/011-learning-ledger.md`
- `specs/012-channel-economics-ledger.md`
- `specs/013-margin-firewall.md`
- `adrs/0007-risk-based-human-approvals.md`
- `adrs/0013-gated-artifact-learning.md`
- `context/21-learning-system.md`
- `context/22-opportunity-backlog.md`
