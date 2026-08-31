# ADR 0044: Build Growth Intelligence as an evidence-first composed system

## Status

Accepted on 2026-08-31 after approval of `specs/022-growth-intelligence.md`.

## Context

The product concept behind the Opportunity section is broader than an execution queue. The system
should govern an organization's data, read it frequently, understand its niche and local market,
propose Insights and Recommendations, prepare bounded actions, and improve from feedback and
verified results.

The repository currently owns the pieces in separate domains:

- governed report projection and deterministic Channel findings;
- cited, model-written Channel Recommendations with append-only triage;
- Decision Engine Opportunities and their value/evidence contracts; and
- Campaign qualification, immutable source snapshots, generation, approval, and later execution.

The current `/opportunities` surface shows only Opportunity records. Report upload does not create a
durable automatic analysis request. Opportunity feedback records an answer without an Opportunity
transition or Campaign creation. The only Campaign playbook is coupled to provider-execution
readiness, while an internal Campaign draft is a lower-risk capability the Campaign module can own
before publishing authority exists.

External market research raises a separate trust problem. A live model call on page load would be
slow, non-reproducible, expensive, and vulnerable to untrusted webpage content. Copying every
Insight, Recommendation, and Opportunity into one generic feed table would create competing sources
of truth. Requiring campaign-grade evidence before any advice appears would repeat the failure ADR
0039 corrected.

## Decision

### Growth Intelligence is the product surface; Opportunity remains an item type

Rename the organization navigation surface to **Growth Intelligence**. It composes four distinct
item types:

- Insights explain material internal or market-connected evidence.
- Recommendations describe actions the operator performs manually.
- Opportunities describe actions the platform can prepare through a governed workflow.
- Data Gaps explain missing or stale inputs and remain outside action counts.

Market Watch exposes current external evidence separately. The read model composes authoritative
domain records; it does not copy their lifecycle state into a universal feed table.

### Recurring research binds an operator-approved Market Profile

The platform may propose a niche, public business identity, branch trade areas, city/country scope,
competitors, topics, and source rules. An operator confirms an immutable version before recurring
research starts. Later AI suggestions are proposals only and cannot silently change the monitored
market.

Research runs daily in the organization timezone, produces a weekly synthesis, and refreshes after
new governed business data becomes current. Public attributable sources and approved APIs are the
only source classes. Source content is untrusted data, never instruction or authority.

### Postgres owns work and evidence; Trigger.dev performs bounded execution

A durable request row is written for profile approval, due research, and new current business
evidence. Immediate dispatch reduces latency; a scheduled sweeper recovers lost dispatch and expired
leases. Trigger workers receive identifiers, reload current authorized inputs, call external
providers outside database transactions, and complete through fenced tenant-validating operations.

Market claims are compact, cited, versioned, freshness-bound evidence. AI may extract, connect, and
narrate them. Deterministic code assigns source class, support grade, freshness, duplication,
priority components, and eligibility.

### Advice is broad; Campaign Opportunities are narrow

ADR 0039 remains the advice rule. Supported Insights and Recommendations may appear with explicit
uncertainty, including when internal evidence is stale. Staleness blocks Campaign eligibility rather
than silencing advice.

ADR 0040's actor boundary remains: operator-performed actions stay Recommendations. This ADR amends
ADR 0040's release-sequencing statement that the Decision Engine waits for provider readiness. The
Decision Engine gains a separate, versioned governed-draft playbook for a platform-prepared internal
Campaign draft.

A Campaign draft Opportunity requires current internal evidence, primary/corroborated market
evidence, an approved profile, a goal, objective, audience, brand readiness, assertions, evaluation
plan, and a defensible impact estimate. Provider publishing capability, spend authority, and
tracking are rechecked later for Campaign approval/execution and do not block internal drafting.

### Creating a draft is not approving a Campaign

The Opportunity action is **Create governed draft**. An atomic operation records the operator's
intent, transitions the Opportunity to a draft-request state, and creates or replays one durable
Campaign draft request. A worker creates exactly one Campaign and freezes the evidence and readiness
snapshot the operator saw.

Draft creation is Tier 1, internal and reversible. It performs no provider call, publication, spend,
or Campaign approval. Campaign review and exact-version approval remain governed by ADR 0017.

### Learning remains gated

Operator planning, dismissal, acknowledgement, snoozing, and pins are preference signals, not proof
of effectiveness. Only verified outcomes under a registered measurement contract inform action
effectiveness. Any change to a live profile, rule, prompt, playbook, policy, or ranking artifact
remains a separate versioned proposal and promotion under ADR 0013.

## Consequences

### Positive

- The product can provide useful, current advice without pretending every item is executable.
- External claims remain attributable, freshness-bound, reproducible, and separable from client
  measurements.
- Report upload becomes a reliable input to intelligence rather than a manual analysis prerequisite.
- Channel Recommendations retain one source of truth across two presentation surfaces.
- A useful Campaign draft can be prepared before provider publishing authority exists, while the
  execution fence remains unchanged.
- Data Gaps become visible without filling the Opportunity feed with things the platform cannot do.

### Costs and trade-offs

- New profile, work-ledger, market-evidence, synthesis, and Campaign-handoff records are required.
- Daily public research creates provider cost, source-quality, legal/terms, and operational duties.
- Source expiry and contradiction mean visible intelligence may be revised or superseded often.
- A composed read model is more involved than querying one generic table, but avoids lifecycle drift.
- Campaign Opportunities remain sparse until a campaign-specific estimator and complete draft
  readiness inputs exist. This is intentional.

### Compatibility

- ADR 0014 remains authoritative for Opportunity value, evidence tiers, and ordering.
- ADR 0043 remains authoritative for Channel month selection and content-addressed analysis reuse.
- ADR 0037 remains authoritative for the independence of deterministic findings and model narration.
- Spec 018's approved external benchmarks remain a different evidence class. Market Watch claims are
  current public context, not automatically approved comparative benchmarks or Business Facts.
- Existing legacy Opportunity statuses remain readable during additive migration, but new UI and
  handoff code must not describe draft creation as approval.

## Alternatives rejected

### One generic `growth_intelligence_items` copy of every source record

Rejected because Recommendation, Opportunity, Campaign, and readiness lifecycles would exist twice
and eventually disagree.

### Research and synthesis on page load

Rejected because a read would become a slow, costly, non-repeatable side effect with weak retry and
audit behavior.

### A weekly report with no durable item lifecycle

Rejected because new governed reports and material daily signals would remain stale, and operators
could not plan, snooze, dismiss, trace, or hand off actions reliably.

### Convert all Recommendations into Opportunities

Rejected because it violates ADR 0040, adds execution governance where the platform performs no
action, and would misrepresent advisory work as platform-ready.

## References

- `specs/022-growth-intelligence.md`
- `adrs/0039-advise-freely-execute-narrowly.md`
- `adrs/0040-who-performs-the-action-decides-where-it-lives.md`
- `adrs/0043-month-year-evidence-window-and-content-addressed-analysis-cache.md`
- `adrs/0002-separate-control-and-execution-planes.md`
- `adrs/0003-use-triggerdev-for-durable-execution.md`
- `adrs/0013-gated-artifact-learning.md`
- `adrs/0014-decision-value-and-evidence-tiers.md`
- `adrs/0017-campaign-runtime-and-approval.md`
- `adrs/0019-campaign-measurement-and-learning.md`
- `adrs/0026-governed-channel-identity-and-report-contracts.md`
- `adrs/0037-recommendations-ride-a-second-fenced-worker.md`
