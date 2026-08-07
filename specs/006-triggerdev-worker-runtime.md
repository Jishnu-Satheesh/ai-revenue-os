# Feature Specification: Trigger.dev Worker Runtime

## Business outcome

Execute durable AI and integration workflows while the Next.js platform remains the control and governance plane.

## Standard task wrapper

Every worker run receives:

- organization ID
- optional branch ID
- worker ID and version
- trigger and correlation IDs
- typed input
- policy context reference
- requested capabilities
- cost budget

Every run returns:

- typed output
- status
- tool invocations
- token and monetary cost
- evidence references
- warnings
- follow-up events

## Runtime responsibilities

- Idempotency.
- Retries.
- Timeouts.
- Parallelism.
- Approval waits.
- Cancellation.
- Structured logging.
- Heartbeats for long tasks.
- Result persistence.

## Ownership boundary

Trigger.dev owns execution mechanics. Postgres owns business state. The application repository owns worker code, schemas, policies, and playbooks.

## Acceptance criteria

- Runs are visible in the platform with status and timeline.
- Retried side effects execute exactly once when provider supports idempotency.
- Cancellation propagates safely.
- Human approval can pause and resume a workflow.
- Run payloads never rely on unvalidated user text for tenant scope.
- Worker versions are recorded for reproducibility.
