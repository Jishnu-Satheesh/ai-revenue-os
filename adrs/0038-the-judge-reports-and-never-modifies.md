# ADR 0038: The judge reports and never modifies

## Status

Accepted. Extends the evaluation-hook requirement of the definition of done
in AGENTS.md to the recommendation boundary, and pairs with ADR 0037.

## Context

Recommendations are model-written prose over deterministic findings. Triage
votes measure what humans thought after acting; they say nothing about the
defects a recommendation carries at writing time — an uncited savings claim,
a `needs_data` dressed up as a recommendation, invented confidence over
twenty days of evidence in a fifty-nine-day window. Finding those defects
requires reading the prose against the evidence it cites, which is judgment,
which is a legitimate use of a model.

The user asked for this loop explicitly: an evaluation pass on a schedule
whose findings improve the prompt and rules. The open question was whether
the loop closes itself.

## Decision

### A scheduled judge with one job

A scheduled Trigger task runs every forty-eight hours. It selects
recommendations not yet judged by any completed batch, two hundred at most per batch, and
hands each one its bounded folder: the recommendation and the exact stored findings it cites.
No tools, no retrieval.

The judge returns structured verdicts — citation faithfulness, label
appropriateness, invented values or causes, honesty of uncertainty, and an
advisory score with named issues. Output is Zod-validated and filed through a
worker-only RPC carrying digests and judge-model metadata, so every verdict
is auditable after the fact like every other AI artifact here.

### Advisory means advisory

Verdicts are quality evidence for human iteration. People read batches,
tune the narration prompt or validation rules deliberately, and ship them as
new prompt versions; recommendations record the prompt version that produced
them, so any batch of verdicts correlates with the behavior that earned it.
Nothing in the pipeline edits a prompt, a rule, or a recommendation by
itself. Verdict tables are internal machinery and never render on a
client-facing surface.

### Closed-loop self-modification was rejected

An evaluator that rewrites its own prompt ships unreviewed behavioral drift.
When a restaurant asks why the advice changed, "the evaluator rewrote itself
last Tuesday" is not an answer this product can afford. Every change to what
the system tells customers passes through a human who can read the diff.

## Consequences

Prompt improvement moves at the speed of human review; that is the cost of
staying auditable, and it is accepted. Verdict history accumulates into a
quality record per prompt version, which makes regressions visible when a
prompt change lands badly. Cost is bounded twice — by the forty-eight-hour
cadence and by the per-batch cap — and is proportional to narration volume,
not to time.
