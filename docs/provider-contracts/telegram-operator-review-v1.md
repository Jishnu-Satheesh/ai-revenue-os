# Telegram Operator Review Provider Contract V1

## Status

Blocked. Telegram's official Bot API and Mini App contracts are documented, but no controlled bot, webhook, Mini App configuration, linked operator, or live review session is evidenced in this repository.

Checked-in contract: `src/modules/integrations/providers/telegram-operator-review/contract.ts`. Consumers obtain it only through `getTelegramOperatorReviewProviderContract()`, which performs strict shape, evidence, future-date, and expiry validation against the current time.

## Review window

- Contract version: `telegram_operator_review_v1`
- Pinned API version: `Bot API 10.2`
- Verified at: `2026-08-11T00:00:00.000Z`
- Expires at: `2026-09-10T00:00:00.000Z`
- Review rule: expiry is fail-closed; recheck the official Bot API, Mini App contract, and controlled configuration before renewing.

The raw checked-in literal is private to the module so a caller cannot accidentally bypass temporal validation.

## Official sources consulted

- [Telegram Bot API](https://core.telegram.org/bots/api) — bot-token authorization, update delivery, `update_id`, webhook retry behavior, `secret_token`, `X-Telegram-Bot-Api-Secret-Token`, and API response structure.
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps) — launch modes, trusted `initData`, untrusted `initDataUnsafe`, server-side HMAC validation, `auth_date`, and attachment-menu eligibility limits.

## Identity and account prerequisites

- Bot created through Telegram with its token held only by the server credential boundary.
- HTTPS webhook and Mini App URL configured for the controlled bot.
- A one-time platform-to-Telegram link completed by an authenticated platform user.
- Live organization membership, role, campaign permission, capability state, session expiry, and exact bundle version/digest rechecked for every sensitive mutation.
- Controlled evidence that the bot, webhook secret, Mini App launch, linked operator, and review session work together.

Telegram has no OAuth scope list for this Bot API path, so `exactScopes` is intentionally empty. An empty list does not waive bot configuration, identity, or platform authorization checks.

Official facts are stored in the contract evidence registry with stable IDs and check times. A controlled-bot check additionally requires a sanitized evidence-artifact reference and SHA-256 digest. No controlled-account evidence entry exists, and both account prerequisites remain blocked; a future action must cite official evidence, controlled-bot evidence, and verified prerequisite keys.

## Fixed product boundary

- Integration character: `operator_review` only.
- Campaign placements: none.
- Customer campaign channel: prohibited by `telegram.operator_review_only`.
- Customer recipients, direct messages, outbound marketing, comments, and community management: prohibited by `telegram.customer_messaging_prohibited`.
- Attachment-menu launch: not used; the official source says this integration is restricted, so `telegram.attachment_menu_restricted` remains visible.

The bot notification may summarize a proposal and open a Mini App. It is not approval. The Mini App calls the same platform revision, attestation, and exact-version approval services as Studio.

## Actions and limits

- Verified provider actions: none.
- Size, copy, and hashtag limits: not applicable because Telegram is not a campaign content placement.
- Retryable statuses: none classified for this blocked contract.
- Unknown-outcome reconciliation: none authorized.

Provider methods for bot notifications must not be added as executable actions until controlled configuration, response normalization, idempotency behavior, and reconciliation evidence are checked in.

## Webhook and replay posture

Official Telegram documentation provides the building blocks:

- a configured webhook secret arrives as `X-Telegram-Bot-Api-Secret-Token`;
- `update_id` is the deduplication and ordering identity;
- failed webhook deliveries are retried; and
- updates are not retained by Telegram for more than 24 hours.

This contract still sets `webhook` to `null` because the controlled webhook and exact allowlisted update types are not verified. Later enablement must pin the allowlist, require the secret header, deduplicate `update_id`, define replay retention, reject unknown update fields at the normalized boundary, and never log raw updates.

## Mini App validation posture

- Accept only raw `Telegram.WebApp.initData` sent to the server; never trust `initDataUnsafe`.
- Verify the documented HMAC-SHA-256 data-check string with the bot-token-derived secret.
- Enforce an application-defined maximum `auth_date` age and single-use review session.
- Map the verified Telegram user ID to the linked platform identity.
- Recheck live platform authorization and exact campaign/version/digest after Telegram validation.
- Store only required operator identifiers; never store or log raw signed initialization data.

## Enablement evidence required

- Sanitized controlled-bot identity and configuration check.
- Webhook secret/header, allowlist, retry, duplicate, replay, and ordering tests.
- Mini App valid, invalid, expired, replayed, unlinked, revoked, cross-organization, and role-loss tests.
- Shared Studio/Telegram version and digest test.
- Safe notification receipt/reconciliation evidence if provider notification actions are enabled.
- No bot token, raw webhook body, raw `initData`, or customer PII in fixtures, logs, or this document.
