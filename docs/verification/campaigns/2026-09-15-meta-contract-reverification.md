# Meta provider contract — re-verification from official sources

Date: 2026-09-15
Scope: `src/modules/integrations/providers/meta/contract.ts`
Method: each official source fetched and read on 2026-09-15. No controlled
account was used, because none exists.

## Why this was needed

The checked-in contract was verified 2026-08-11 and expired **2026-09-10**.
From that date `getMetaCampaignProviderContract()` threw, which switched off
every Meta path in the platform. Nothing announced it. It surfaced only when
organic dispatch was wired five days later and the resolver reported that no
adapter could be installed.

The contract is a review gate, and the gate worked. What failed is that a
lapsed gate was invisible — see "What stops this recurring" below.

## What each source actually says

| Source | Read on 2026-09-15 |
| --- | --- |
| [Graph API versioning](https://developers.facebook.com/docs/graph-api/guides/versioning/) | "The latest Graph API version is `v26.0`." |
| [Version changelog](https://developers.facebook.com/docs/graph-api/changelog/versions/) | v24.0 released 2025-10-08, expires **2028-02-18**. v26.0 released 2026-07-29, expiry TBD. |
| [Instagram content publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/) | Container-then-publish flow. "JPEG is the only image format supported." "Instagram accounts are limited to 100 API-published posts within a 24-hour moving period." |
| [POST /{ig-user-id}/media reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/) | Caption "Maximum 2200 characters, 30 hashtags, and 20 @ tags." Image: JPEG, "8 MB maximum", aspect 4:5 to 1.91:1, width 320–1440 px. |
| [IG Media insights reference](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights) | `impressions`: "For media created after July 2, 2024, this metric is deprecated." `reach` counts unique users; `views` counts total plays. |
| [Pages API posts](https://developers.facebook.com/docs/pages-api/posts/) | Page access token with `pages_manage_engagement`, `pages_manage_posts`, `pages_read_engagement`, `pages_read_user_engagement`; Page tasks `CREATE_CONTENT`, `MANAGE`, `MODERATE`. |
| [Marketing API get started](https://developers.facebook.com/docs/marketing-api/get-started/) | Registered developer app plus "an active ad account to run campaigns and manage billing". Scopes are not enumerated on this page. |

The pinned `apiVersion` stays **v24.0**, unchanged. It is an older live version
with almost eighteen months of support left, and it is what
`FacebookAdsApi.VERSION` actually sends — a contract naming any other version
would describe requests this platform never makes.

## What changed in the contract

**Window:** verified 2026-09-15, expires 2026-10-15. The same 30-day cadence the
previous review used; no new policy was invented.

**`instagram.feed_image` moved from `blocked` to `verified`**, with the limits
the media reference states: 2200 caption characters, 30 hashtags, 8,000,000
bytes.

`maxPayloadBytes` takes the conservative reading of "8 MB maximum": 8,000,000
rather than 8,388,608. Anything this platform accepts is then certainly inside
whichever of the two Meta means. Erring the other way would let a file through
and have Meta refuse it once a container already existed.

**Everything else stays blocked, and that is the honest state:**

- `instagram.image_story` — the pages consulted document the `STORIES` media
  type but state no caption, size or aspect limits for it.
- `facebook.feed_image`, `facebook.image_story`, `meta_ads.*` — not part of this
  pass. Paid is held deliberately.
- Every `accountPrerequisite` — a verified prerequisite requires
  controlled-account evidence by schema, and there is no controlled account.
- `actions` remains `[]` — a verified action also requires controlled-account
  evidence.

## What this unblocked, and what it did not

**Unblocked:** the contract is readable again, so the organic dispatch resolver
reports `ready` instead of `contract_unusable`, and drafting and operator edits
now have real Instagram limits instead of an empty map. An operator can add
hashtags to an Instagram caption for the first time — previously all were
refused, because an unprovable limit is never replaced by a plausible one.

**Not unblocked:** nothing can actually publish. Publishing still requires an
organization with a live Meta connection and an available `meta.instagram.publish`
grant, and no such connection exists. Reading a public document proves what the
API allows; it cannot prove this organization's account is eligible to do it,
and no amount of documentation ever will.

## Organic metrics: a decision, not a lookup

Collecting results for an organic post is **still blocked**, and this pass
turned it from an unknown into a clearly stated choice.

The registry asks for `delivery.impressions`. Meta deprecated `impressions` for
media created after 2024-07-02, so every post this platform publishes falls on
the deprecated side. The two documented neighbours mean different things:

- `reach` — unique users who saw it.
- `views` — total plays.

Neither is `delivery.impressions`. Mapping either onto that key would put a
different measurement behind a name people already trust, which is the one thing
the metric registry exists to prevent. Recorded as
`meta.instagram_organic_impressions_unavailable` in `knownRestrictions` rather
than resolved silently.

`delivery.clicks` and `delivery.spend` simply do not exist for an organic post.
When collection is built they must be recorded **absent**, never zero — the
point type already carries `presence: "observed" | "absent"` for exactly this.

Whoever takes this next needs a product decision: either register an organic
delivery metric that means what Meta actually reports, or accept that organic
posts carry reach and engagement but no impressions figure.

## What stops this recurring

`contract.test.ts` now asserts the checked-in contract is inside its own review
window **against the real clock**. Every other test in that file pins its own
date, which is why all of them kept passing over an expired record for five
days. A failure there means the review is due, not that the code is broken.

Fix it by re-checking the sources and updating `verifiedAt`, `expiresAt` and
every evidence `checkedAt` to what was actually read. Never by moving the dates
alone.
