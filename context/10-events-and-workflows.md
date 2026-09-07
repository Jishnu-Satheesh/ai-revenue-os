# Events and Workflows

## Event-driven principle

Use events when meaningful business state changes. Use schedules for periodic analysis that has no natural event source. Avoid indiscriminate polling.

## Event envelope

Every event should include:

- `eventId`
- `eventName`
- `occurredAt`
- `organizationId`
- optional `branchId`
- `actorType` and `actorId`
- `correlationId`
- `causationId`
- `schemaVersion`
- typed payload

## Naming

Use stable past-tense names:

- `organization.created`
- `onboarding.step_completed`
- `integration.connected`
- `data.ingestion_completed`
- `signal.detected`
- `opportunity.proposed`
- `growth_intelligence.item_triaged`
- `campaign.draft_requested`
- `approval.granted`
- `execution.started`
- `tool.invocation_succeeded`
- `outcome.measured`

## Durable workflow requirements

Trigger.dev workflows must support:

- Idempotency.
- Retries with bounded exponential backoff.
- Dead-letter or manual recovery.
- Cancellation.
- Timeouts.
- Approval waits.
- Correlation and tracing.
- Cost and token accounting.
- Clear terminal states.

## Standard workflow shape

`trigger -> load context -> validate eligibility -> plan -> policy check -> approval if needed -> execute tools -> verify -> record -> schedule measurement`

## Scheduled jobs

Useful scheduled tasks include:

- Daily organization health assessment.
- Daily opportunity scan.
- Integration freshness checks.
- Weekly performance summaries.
- Post-action outcome measurement.
- Memory freshness review.

## Avoid

- A single global cron that processes every organization without isolation.
- Retrying non-idempotent provider calls without keys.
- Storing workflow-only state exclusively in Trigger.dev.
- Hiding business state inside opaque workflow payloads.
