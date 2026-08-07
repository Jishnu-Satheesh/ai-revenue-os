# Observability and Cost Governance

## Correlation

Carry the following identifiers through requests, events, Trigger.dev runs, model calls, and tools:

- `organizationId`
- `branchId` when relevant
- `correlationId`
- `decisionId`
- `opportunityId`
- `runId`
- `workerId` and version

## Metrics

Track:

- Workflow success, failure, retry, and duration.
- Provider rate-limit and authentication errors.
- Model tokens, cost, latency, and validation failure.
- Opportunities proposed, approved, rejected, executed, and measured.
- Human review time.
- Incremental gross profit and confidence.
- Data freshness and integration health.

## Cost controls

- Organization-level monthly automation budget.
- Worker-level cost ceilings.
- Model routing by task complexity.
- Cache stable summaries and embeddings.
- Stop repeated repair loops.
- Alert on abnormal cost per successful outcome.

## Decision timeline

The user-facing timeline should render:

1. Signal observed.
2. Evidence loaded.
3. Opportunity proposed.
4. Policy evaluated.
5. Human approval or rejection.
6. Execution steps.
7. Provider verification.
8. Measurement scheduled.
9. Outcome measured.
10. Lesson recorded.

## Operational alerts

Prioritize alerts that need action:

- Credential expired.
- Webhook signature failure.
- Repeated execution failure.
- Budget threshold reached.
- Unexpected spend.
- Data stale.
- Cross-tenant authorization anomaly.
- Tool result inconsistent with requested state.
