# Roadmap

This roadmap is sequenced by dependency, not by fixed week estimates. A senior engineer using AI coding agents may complete several slices in a day.

## Sequencing rule: instrumentation precedes optimization

Learning splits into two halves that must not travel together.

**Instrumentation** — the candidate set, propensity, exploration flag, and artifact version tuple recorded on every decision, plus human feedback capture — belongs to Milestones 4 and 5. None of it can be reconstructed later, because the counterfactual was never observed. A decision path shipped without it produces months of history that is unusable for the purpose it was collected for.

**Optimization** — proposal generation, calibration, prompt and weight tuning, cross-client priors — stays in Milestone 7. It is expensive, it needs volume the pilot will not have for months, and it consumes instrumentation that must already exist.

The cost of building instrumentation early is real but bounded. The cost of adding it late is unrecoverable. See ADR 0013 and `specs/011-learning-ledger.md`.

## Milestone 0 - Repository foundation

- Documentation pack.
- Next.js project bootstrap.
- CI, lint, type checks, tests.
- Environment and secrets conventions.

## Milestone 1 - Tenant foundation

- Authentication.
- Organizations.
- Memberships and roles.
- Branches.
- RLS and authorization tests.

## Milestone 2 - Digital Twin and onboarding

- Business profile.
- Goals, constraints, policies, and budgets.
- Guided onboarding.
- File uploads.
- AI-assisted extraction and confirmation.
- Readiness score.

## Milestone 3 - Integration and data foundation

- Integration catalog.
- Manual and CSV ingestion.
- Connection health.
- Metric registry and normalized metrics, per `specs/015-metric-registry-and-normalized-metrics.md`. This is the consumer of the `IngestionSink` handoff that `specs/003-integration-hub.md` explicitly leaves out of its own scope, and it is a prerequisite for goal-alignment screening in the Decision Engine, for baselines, and for the variance estimates switchback design requires.
- Restaurant menu schema.

## Milestone 4 - Memory and decisioning

Ordered within the milestone, because the order matters:

1. Business Memory.
2. Channel economics ledger.
3. Margin firewall, detective mode only.
4. Signal Engine.
5. Decision Engine V1.
6. Opportunity feed, approval system, and human feedback capture.

**The economics ledger moved ahead of the Decision Engine.** Under ADR 0014 the only ranking quantity is expected contribution in minor units, and an opportunity with no defensible value estimate is a `needs_data` decision rather than an opportunity. Until the ledger supplies contribution margin at a `complete` or `partial` grade, the engine has no money-denominated input and would emit `needs_data` almost exclusively. The firewall's detective sweep comes with it, because a live below-floor promotion is the first opportunity class whose value is arithmetic. The firewall's preventive mode and the gateway re-check stay in Milestone 5, where the Tool Gateway they depend on is built.

Decision Engine V1 must satisfy three constraints so that instrumentation is additive rather than a rewrite: build an explicit candidate list before selecting, resolve artifact versions rather than reading configuration inline, and propagate a correlation ID through the whole path. It also ships the decision-side ledger tables — decision records, candidates, feedback, and the seeded artifact version registry — because those four fields cannot be backfilled. See `specs/005-decision-engine-v1.md` and `specs/011-learning-ledger.md` section 12.

Two prerequisites are named rather than assumed. The metric registry and normalized metrics are specified in `specs/015-metric-registry-and-normalized-metrics.md`; its schema has shipped, but the projection layer that populates a series has not, and goal-alignment screening stays inactive until goals carry registered keys. The Signal Engine still has no specification; Decision Engine V1 defines only the port it reads through.

## Milestone 5 - Durable execution and instrumentation

Execution:

- Trigger.dev worker runtime.
- Capability registry.
- Tool Gateway.
- Decision timeline.
- Evaluation scheduling.

Instrumentation, per ADR 0013. The decision records, candidate sets, feedback capture, and artifact version registry ship in Milestone 4 with Decision Engine V1, since they cannot be backfilled. What remains here is what needs executed actions to exist:

- Outcome measurement records with declared baseline, window, and attribution method.
- The system scorecard, which ships before any optimizer exists so that improvement is falsifiable from the day it is first claimed.

Margin firewall, completing what Milestone 4 started:

- Preventive mode as a deterministic veto in the policy check.
- Gateway re-evaluation of every opportunity assertion immediately before the side effect.

## Milestone 6 - First revenue playbooks

Recommended order:

1. Menu and marketplace listing intelligence.
2. Review recovery and reputation.
3. Google Business Profile local discovery.
4. WhatsApp repeat-order and win-back.
5. Paid-media experiment planning and draft generation.
6. Controlled campaign publishing after tracking readiness.

Switchback experiment design ships alongside the first playbook whose intervention is switchback-eligible, since it is what makes that playbook's result defensible at single-branch volume. See `specs/014-switchback-experiments.md`.

## Milestone 7 - Optimization and agency scale

Consumes the instrumentation delivered in Milestone 5. Nothing here may write directly to an active artifact; scheduled jobs write proposals and promotion is gated, per ADR 0013.

- Experiment analysis.
- Evaluation set mining from production feedback.
- Proposal generation for prompts, retrieval weights, and routing.
- Impact and confidence calibration from predicted versus actual.
- Playbook evidence and priors.
- Cross-client privacy-safe benchmarks.
- Portfolio-level opportunity prioritization.
- Industry Pack SDK and second vertical.

## Later

Candidate capabilities that are recorded and argued but deliberately unspecified live in `context/22-opportunity-backlog.md`, with the dependency and the trigger for promoting each one to a spec.
