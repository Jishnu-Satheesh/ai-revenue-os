# Foundation Review

## Executive assessment

The proposed platform is technically feasible for a senior TypeScript and AI engineer, but the hardest problem is not orchestration. It is obtaining trustworthy data, measuring incrementality, defining safe autonomy, and proving repeatable revenue playbooks.

The architecture is intentionally optimized for fast implementation by a small team: modular monolith, relational core, durable execution, typed worker contracts, and industry packs.

## Strong decisions

- Organization onboarding is the first platform workflow.
- The Digital Twin is structured and source-aware.
- Decision and execution are separated.
- Trigger.dev is used as an execution runtime rather than the business brain.
- LangGraph adoption is delayed until justified.
- Gross profit and guardrails are prioritized over raw order volume.
- Human approval is risk-based.
- Restaurant logic is isolated in an Industry Pack.

## Critical risks

### 1. Data access risk

Delivery marketplaces may not provide convenient APIs or customer-level data. The platform needs robust CSV, spreadsheet, and manual workflows.

### 2. Attribution risk

Offline visits and third-party orders are difficult to attribute. Experiments must use tracked offers, links, call tracking, holdouts, or honest proxy metrics.

### 3. Margin blindness

Without item cost, commission, packaging, discount funding, and refund data, the system may optimize unprofitable revenue. Readiness and confidence must reflect this.

### 4. Automation overreach

Publishing ads, changing prices, or sending broad customer messages too early can harm the client. Recommendation and draft modes should precede bounded autonomy.

### 5. Platform-before-proof risk

A multi-tenant shell can become a distraction. Every platform module should immediately serve the pilot and become reusable as a consequence.

### 6. Cross-client learning risk

The moat should not become a privacy or trust problem. Learn from normalized outcome patterns, not exposed client data.

## Ugly questions the system must answer

- What happens when the AI is confident and wrong?
- What happens when the client rejects every recommendation?
- What happens when data sources disagree?
- What happens when an API call succeeds but the provider state does not change?
- What happens when the same side effect retries?
- What happens when a promotion increases orders but decreases profit?
- What happens when demand exceeds kitchen capacity?
- What happens when the client revokes account access?
- What happens when a worker retrieves another tenant's data?
- What happens when a model provider is unavailable or changes behavior?

## Required controls before first external write action

- Tenant-isolation test suite.
- Tool schema validation.
- Idempotency.
- Policy engine.
- Immutable approval version.
- Audit timeline.
- Provider state verification.
- Rollback or stop mechanism.
- Budget ceiling.
- Outcome measurement plan.

## Scope recommendation

The fastest credible first revenue slice is:

1. Onboard the client and import the menu.
2. Build the profitability and listing-quality map.
3. Identify one high-confidence listing improvement.
4. Execute it manually or in draft-write mode.
5. Measure conversion and guardrails for 7 to 14 days.
6. Record the result as playbook evidence.

This proves the complete loop without requiring ad-platform autonomy.
