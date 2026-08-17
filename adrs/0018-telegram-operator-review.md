# ADR 0018: Use Telegram only as a linked operator-review surface

## Status

Accepted.

## Context

Telegram can shorten review time, but a Telegram identity is not a platform identity, a bot link is not permanent authorization, and a chat message cannot display or bind the complete Campaign Bundle safely. Treating Telegram as a campaign channel would also widen this slice into customer messaging and community management.

## Decision

- Telegram has the single integration character `operator_review`. It is not a campaign audience, publishing destination, advertising account, customer-messaging provider, comment tool, or community-management tool.
- The bot may notify a previously linked operator and open a Mini App. The notification is an entry point, not an approval action.
- Linking uses a one-time, expiring, replay-protected nonce and maps the Telegram user to an existing platform user and organization context.
- Mini App `initData` is validated server-side using Telegram's documented signature procedure and an application-defined freshness window. Raw signed initialization data is never stored or logged.
- Webhook requests require the configured Telegram secret header, allowlisted update types, `update_id` deduplication, and replay retention before processing.
- Every sensitive revision, attestation, or approval rechecks the linked identity, current organization membership, current role and permission, organization binding, capability state, review-session expiry, and exact campaign version/digest.
- Studio and Telegram call the same revision, attestation, and approval services. Telegram never owns separate campaign state.
- Unlink, membership loss, role loss, revoked bot configuration, or disabled capability takes effect immediately.

## Consequences

- A forwarded message, stale session, or previously authorized Telegram account cannot approve a campaign by itself.
- Operators receive a native review entry point without creating a second approval system.
- Telegram customer messaging is unavailable in this release train.
- Controlled bot, webhook, Mini App, and linked-operator evidence are required before this capability can be enabled.

## References

- `docs/provider-contracts/telegram-operator-review-v1.md`
- `adrs/0007-risk-based-human-approvals.md`
- <https://core.telegram.org/bots/api>
- <https://core.telegram.org/bots/webapps>
