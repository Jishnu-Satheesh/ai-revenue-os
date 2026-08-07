# AI System Design

## Design stance

The platform uses specialized bounded workers, not a single autonomous super-agent.

## Worker categories

### Intelligence workers

Read data and produce structured analysis:

- Growth Intelligence Worker
- Menu Intelligence Worker
- Review and Reputation Worker
- Customer Segmentation Worker
- Competitive Discovery Worker
- Forecasting Worker

### Planning workers

Create bounded plans from approved opportunities:

- Campaign Planner
- Retention Planner
- Marketplace Promotion Planner
- Creative Brief Planner

### Generation workers

Create drafts that require validation or approval:

- Ad Copy Worker
- Creative Variant Worker
- WhatsApp Message Worker
- Review Response Worker
- Landing Page Content Worker

### Evaluation workers

Assess output and business impact:

- Output Quality Evaluator
- Policy Compliance Evaluator
- Outcome Evaluator
- Playbook Learning Worker

## Standard worker contract

Every worker defines:

- `name` and semantic `version`
- purpose
- input schema
- output schema
- required capabilities
- allowed tools
- model policy
- maximum cost and runtime
- retry policy
- confidence semantics
- human-review policy
- evaluation hooks
- idempotency behavior

## Model-provider abstraction

Use the Vercel AI SDK or an internal interface so workers depend on capabilities rather than a specific provider. Model selection may vary by task, cost, latency, privacy, and quality.

## Structured outputs

All consequential model outputs must be parsed into Zod-validated schemas. Invalid output is retried with bounded repair attempts or sent to review. Free-form text never becomes an executable plan.

## Retrieval

Retrieval should prioritize:

1. Verified structured facts.
2. Current policies and constraints.
3. Relevant historical outcomes.
4. Approved brand and operating documents.
5. Recent events.
6. Semantic memory only when deterministic lookup is insufficient.

## Confidence

Confidence is a calibrated estimate tied to evidence quality and historical performance. It must not be a decorative model-generated number. Early versions should use deterministic scoring inputs and conservative confidence bands.

## Cost controls

- Per-organization daily and monthly model budgets.
- Per-worker token and execution limits.
- Caching for stable summaries.
- Smaller models for extraction and classification.
- Human review for repeated low-confidence loops.
