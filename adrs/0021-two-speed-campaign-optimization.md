# ADR 0021: Separate fast allocation from slow evidence, and allow the agent only to pause

## Status

Accepted.

## Context

Effective performance marketing reacts within a day or two: underperforming creative is stopped early so budget concentrates on what is working. That is a real and necessary capability.

ADR 0019 says something that appears to contradict it. Impressions, reach, engagement, and clicks are diagnostics. A campaign conclusion requires a preregistered metric, baseline, attribution method, outcome window, settlement delay, and evidence tier. Correlation is never relabelled as impact.

Both are correct, and they collide only if one loop is asked to do both jobs. No honest system can produce an incremental-gross-profit verdict forty-eight hours into a pilot-scale campaign. But no useful system waits three weeks to stop a creative that is visibly wasting money.

The resolution is that stopping waste and proving value are different questions, answered on different evidence, at different speeds — and the danger is not running both. The danger is letting the fast one's opinion contaminate the slow one's record.

## Decision

- Two loops exist, with a wall between them.

### The allocation loop (fast)

- Runs on a per-organization cadence and makes per-campaign decisions. It performs no cross-campaign inference, because comparing campaigns is learning, and ADR 0019 keeps learning campaign-scoped until separately promoted.
- Reads diagnostics and, where the Channel Economics Ledger supplies a graded margin, contribution margin. A margin-based stop is arithmetic and needs no attribution window, which is why it may act early where a performance claim may not.
- Its only action is **pause**. It may not resume, raise a ceiling, shift budget upward, create creative, change an offer, alter a schedule, or publish.
- Pause is pre-authorized inside the approval envelope, consistent with ADR 0017's treatment of guardrail and ceiling stops as containment.
- **Resume is not autonomous.** Restarting a paused variant re-grants spend authority and requires a human with an approving role.
- A pause is a provider write and passes through the Tool Gateway as its own action run, with its own idempotency key and its own unknown-outcome path. A pause whose outcome is unknown is reconciled before retry, because a pause that silently failed is money still burning.
- Thresholds are deterministic, versioned, and organization-scoped. No model chooses a pause. A model may explain a pause after the fact, from the recorded reason and evidence.
- Every decision, including a decision not to act, is appended to an allocation ledger with the diagnostic, the threshold, the resolved margin where used, and the resulting action.
- It emits containment events. It never emits a business claim.

### The evidence loop (slow)

- Runs on the registered outcome window plus settlement delay, exactly as ADR 0019 requires.
- Is the sole author of `validated_outcome`, `inconclusive`, `guardrail_breach`, and `execution_only`, and the sole trigger for a campaign learning proposal.
- May not be accelerated, shortened, or pre-empted by anything the allocation loop observed or did.

### The wall

- The allocation loop may not write to exposure, observation, or outcome records.
- Allocation events are **inputs** to measurement, not conclusions within it. A pause truncates a variant's exposure, so realized exposure is recorded separately from planned exposure and every allocation event is joined into the exposure record.
- An agent pause inside an approved envelope is normal operation. It does not put a campaign into `partially_completed`, which remains reserved for actions that failed to execute.

## Consequences

- The worst outcome of a defective allocation loop is that the organization spent less than it approved. It cannot overspend, publish, widen, or make a claim. That blast radius is defensible to a client without qualification.
- Contribution-margin stops let the platform act correctly on day two in a way a ROAS-based competitor cannot, because the cost data required is already in the ledger.
- Measurement becomes harder and more honest at the same time: realized exposure must be reconstructed from allocation history rather than assumed from the plan.
- Operators will sometimes see a paused variant they disagree with. Resume being a human action is the intended cost of that.
- Two cadences mean two schedules, two failure modes, and two sets of alerts to operate.

## References

- `adrs/0017-campaign-runtime-and-approval.md`
- `adrs/0019-campaign-measurement-and-learning.md`
- `adrs/0020-bounded-creative-family-approval.md`
- `specs/012-channel-economics-ledger.md`
- `specs/013-margin-firewall.md`
- `specs/016-campaign-feedback-loop.md`
