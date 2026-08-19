# Meta Campaign Provider Contract V1

## Status

Blocked. This document records official API facts and intended stable keys; it does not prove that a controlled Meta account, app, Page, Instagram account, ad account, permission grant, webhook subscription, or placement is executable.

Checked-in contract: `src/modules/integrations/providers/meta/contract.ts`. Consumers obtain it only through `getMetaCampaignProviderContract()`, which performs strict shape, evidence, future-date, and expiry validation against the current time.

## Review window

- Contract version: `meta_campaign_v1`
- Pinned Graph API version: `v24.0` — the version `FacebookAdsApi.VERSION` calls, which cannot be overridden. Released 2025-10-08, supported to 2028-02-18. See ADR 0025.
- Verified at: `2026-08-11T00:00:00.000Z`
- Expires at: `2026-09-10T00:00:00.000Z`
- Review rule: expiry is fail-closed; recheck official documentation and controlled-account evidence before renewing. An SDK upgrade is also a review trigger: a test asserts this version equals the SDK's, so bumping the dependency fails until the contract is re-verified against the new version.

The raw checked-in literal is private to the module so a caller cannot accidentally bypass temporal validation.

## Official sources consulted

- [Graph API versioning](https://developers.facebook.com/docs/graph-api/guides/versioning/) — identifies `v26.0` as the current version and recommends explicit versioned calls.
- [Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/) — professional-account publishing prerequisites, permissions, media-container flow, status lookup, Story media type, JPEG restriction, and publishing-rate lookup.
- [Facebook Page posts](https://developers.facebook.com/docs/pages-api/posts/) — Page tasks and permissions, `/feed` and `/photos` publication, returned post identifiers, and read-after-write guidance.
- [Marketing API get started](https://developers.facebook.com/docs/marketing-api/get-started/) — Meta developer/app setup and the active-ad-account and billing prerequisite.

No blog, forum, aggregator, SDK guess, or onboarding channel declaration is treated as provider authority.

## Account prerequisites

- Meta developer app and the applicable Meta login flow.
- Eligible Instagram professional account and the documented Page relationship for the Facebook Login path.
- Page access token and the documented Page tasks for Page publishing.
- Active ad account with billing for advertising.
- Live controlled-account proof for app access level/review, credential health, exact scopes, account ownership and mapping, placement eligibility, and each requested capability.

The final prerequisite is not satisfied by this repository. Therefore no action or webhook is verified.

Official facts are stored in the contract evidence registry with stable IDs and check times. A controlled-account check additionally requires a sanitized evidence-artifact reference and SHA-256 digest. A future action must cite official-source evidence, controlled-account evidence, and verified prerequisite keys. A label alone cannot make an action executable.

## Exact documented scope set

- `instagram_basic`
- `instagram_content_publish`
- `pages_manage_engagement`
- `pages_manage_posts`
- `pages_read_engagement`
- `pages_read_user_engagement`
- `ads_management`
- `ads_read`

This list records names present in the consulted publishing material. It does not claim that the controlled app has them, that each is sufficient for every planned action, or that the Marketing API action design has been proven.

## Placement and content limits

| Stable placement key    | State   | Size limit | Copy limit | Hashtag limit | Restriction                          |
| ----------------------- | ------- | ---------: | ---------: | ------------: | ------------------------------------ |
| `instagram.feed_image`  | blocked |    unknown |    unknown |       unknown | `meta.instagram_feed_image_blocked`  |
| `instagram.image_story` | blocked |    unknown |    unknown |       unknown | `meta.instagram_image_story_blocked` |
| `facebook.feed_image`   | blocked |    unknown |    unknown |       unknown | `meta.facebook_feed_image_blocked`   |
| `facebook.image_story`  | blocked |    unknown |    unknown |       unknown | `meta.facebook_image_story_unproven` |
| `meta_ads.feed_image`   | blocked |    unknown |    unknown |       unknown | `meta.ads_feed_image_blocked`        |
| `meta_ads.image_story`  | blocked |    unknown |    unknown |       unknown | `meta.ads_image_story_blocked`       |

`unknown` is a blocker, not an unlimited value. The Instagram source proves JPEG-only image publishing and a 100 API-published-post moving 24-hour limit, but it does not supply a complete size, copy, and hashtag limit set for every planned placement. The Page posts source proves Page photo publishing but does not prove a Facebook Page image Story action. Advertising eligibility and fields require controlled-account sandbox evidence before they may enter this contract.

## Actions, idempotency, reconciliation, and retries

- Verified actions: none.
- Provider idempotency key: none verified.
- Platform retryable HTTP statuses: none classified.
- Unknown-outcome reconciliation lookup: none complete enough to authorize a write.

The Instagram container-status lookup and Page returned post ID are useful evidence, but they do not by themselves prove a complete duplicate-safe lookup after a timeout where the create response was not received. Every write remains blocked by `meta.unknown_outcome_reconciliation_unverified` until that ambiguity is tested against the controlled account.

A future reconciliation contract may use only lookup inputs persisted during preflight or included in the outbound request. A provider ID learned only from the possibly lost create response cannot satisfy unknown-outcome reconciliation.

## Webhooks

- Allowlisted events: none.
- Signature contract: none verified.
- Replay contract: none verified.
- Controlled subscription: none verified.

The provider contract therefore sets `webhook` to `null` and carries `meta.webhook_contract_unverified`. Later webhook work must add only official, tested event names with signature verification, organization mapping, deduplication, and replay retention.

## Enablement evidence required

- Controlled app and account identifiers recorded without credentials.
- App access level/review and exact granted scopes.
- Page, Instagram professional account, and ad-account mappings.
- One successful and one rejected sandbox call per proposed action.
- Exact content, copy, hashtag, placement, scheduling, and rate limits.
- Duplicate/timeout tests proving reconciliation before retry.
- Allowlisted webhook events with signature, replay, ordering, and mapping tests.
- Sanitized receipts only; no access token or raw provider payload in fixtures, logs, or this document.

Until all applicable evidence exists, Integration Hub must show each capability and placement as blocked with the checked-in stable reason code.
