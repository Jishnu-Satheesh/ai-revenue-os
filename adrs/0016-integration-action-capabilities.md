# ADR 0016: Gate integration actions through verified capabilities and restrictions

## Status

Accepted. This supersedes only ADR 0010's blanket exclusion of provider writes and webhooks for capability-gated campaign providers. ADR 0010 remains valid for the fixture-only Google Business Profile path and credential-store boundary.

## Context

A declared channel, visible connection, or provider definition does not prove that an organization can publish, advertise, receive webhooks, or review through that provider. Provider permissions, account types, placements, limits, and eligibility change independently. Coarse `supportsWrites` and `supportsWebhooks` booleans cannot represent that reality safely.

## Decision

- Integration Hub owns provider characters, versioned capability definitions, credentials, organization-scoped capability grants, restrictions, account mappings, and health.
- Every live provider contract is a strict checked-in Zod boundary with a provider/API version, review and expiry, official sources, account prerequisites, exact scopes, placements, actions, limits, idempotency, webhook rules, retry classifications, reconciliation lookup, and stable restriction codes.
- Registering a capability never grants it. Availability requires an installed matching adapter, a non-expired provider contract, current credentials and exact scopes, verified account/resource eligibility, organization mapping, current policy, feature entitlement, and any required tracking.
- Unknown fields fail. An undocumented scope, field, permission, placement, webhook event, retry class, or action is unavailable rather than inferred.
- Public and money-moving writes require deterministic policy, a Tool Gateway route, an idempotency strategy, and an unknown-outcome reconciliation lookup.
- Webhook intake requires an allowlisted event contract, signature verification, replay protection, organization mapping, normalization, and deduplication before downstream work.
- Restrictions are first-class stable codes. A blocked placement stays visible with its reason; it is never silently substituted.
- Provider contracts expire fail-closed and must be reverified against official sources and controlled-account evidence.

## Consequences

- One missing grant does not disable unrelated grants, but no grant can exceed the provider definition or verified contract.
- Provider rollout can advance one bounded capability at a time.
- Contract maintenance and controlled-account evidence become release prerequisites.
- The checked-in Meta and Telegram V1 contracts remain blocked because controlled-account evidence is absent.

## References

- `adrs/0010-fixture-first-integration-credential-boundary.md`
- `specs/003-integration-hub.md`
- `docs/provider-contracts/meta-campaign-v1.md`
- `docs/provider-contracts/telegram-operator-review-v1.md`
