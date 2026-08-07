# ADR 0003: Use Trigger.dev for Durable Execution

## Status

Accepted.

## Decision

Use Trigger.dev for background jobs, scheduled tasks, long-running AI workflows, retries, parallel execution, and human-in-the-loop waits.

## Boundaries

- Trigger.dev is not the business brain.
- Worker and playbook code remains in the application repository.
- Postgres remains the source of truth.
- Provider actions pass through the Tool Gateway.

## Consequences

The team gains durable execution and observability quickly while avoiding the cost of building a workflow runtime. Vendor coupling is reduced through standard worker contracts and event interfaces.
