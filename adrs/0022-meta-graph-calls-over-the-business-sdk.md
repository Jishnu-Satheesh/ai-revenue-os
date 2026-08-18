# ADR 0022: Call the Meta Graph API directly rather than through the Business SDK

## Status

**Superseded by ADR 0023 on 2026-08-18, one day after being written.** The decision below was reversed by the project owner, and one of its load-bearing facts turned out to be overstated: v24.0 is a supported version until 2028-02-18, not a stale one. The evidence about the SDK's pinning, typing and release cadence remains accurate and is why ADR 0023 constrains the contract rather than the SDK.

## Context

The Meta integration has to be written blind. No Meta account, app, Page, Instagram account, or ad account is available to this project, and none may be for some time, so no line of it can be confirmed by running it. Documentation is the only evidence available.

An official Node SDK exists — `facebook-nodejs-business-sdk` — and an SDK is ordinarily the right default: it encodes endpoint shapes, pagination, and the object graph that a hand-written client gets wrong. That was the starting preference here.

Four facts, read from the published package rather than from its marketing, moved the decision.

- **The SDK pins a different API version from the one this platform verified.** `src/api.js` returns the literal `'v24.0'`. The checked-in contract in `src/modules/integrations/providers/meta/contract.ts` pins, documents, and date-verifies `v26.0` against official sources.
- **It ships no first-party TypeScript types.** The package declares no `types` entry; typing comes from the community `@types/facebook-nodejs-business-sdk`, published separately and generated for a different release than the current one.
- **It is nine months stale.** Version 24.0.1 was published on 2025-11-21; this decision is made on 2026-08-18.
- **Coverage is not the problem.** The package does model Instagram and Page surfaces, so the objection is not that it cannot reach the endpoints this platform needs.

## Decision

- Meta is reached through the bounded client in `src/modules/integrations/providers/meta/client.ts`, which issues Graph requests directly at the API version the checked-in contract names.
- `facebook-nodejs-business-sdk` is not a dependency.
- Every request and response shape is a checked-in Zod schema derived by reading the official documentation for that endpoint, not inferred from an SDK model.
- This is reconsidered for the Meta Ads work specifically. The Marketing API's object graph — campaign, ad set, creative, ad, each with its own identifiers to persist between calls — is the one place where an SDK earns real work. If by then the SDK publishes a release matching the contract's verified version and ships first-party types, adopting it there is the better trade and this ADR should be amended rather than worked around.

## Consequences

- The contract stays the single authority on what version is being called. An SDK pinned to `v24.0` while the contract verifies `v26.0` would make the contract false at its most load-bearing field, and every downstream claim about scopes, placements, and restrictions inherits that version.
- Nothing is gained that has to be given back. ADR 0016 already requires bounded response schemas, no raw provider payload crossing the adapter boundary, stable normalized failure codes, retry classification taken from the contract, and an unknown-outcome path. An SDK returns rich model objects and throws its own errors, so all of that would be unwrapped and re-normalized on the far side — the bounded client would still exist, with an SDK behind it.
- Blind code stays auditable. A thin explicit client can be read line by line against the documentation it was written from. An SDK's behaviour cannot be checked that way without executing it, which is exactly what this project cannot do yet.
- The cost is real and accepted: pagination, media-container polling, and the ads object graph are written by hand, and each is a place a hand-written client can be wrong in a way an SDK would not have been.
- Reversal stays cheap while adapters keep provider specifics behind `ToolAdapter`. Swapping the transport under one adapter does not reach the Tool Gateway, the campaign domain, or the contract.

## References

- `adrs/0016-integration-action-capabilities.md`
- `docs/provider-contracts/meta-campaign-v1.md`
- `src/modules/integrations/providers/meta/client.ts`
- https://github.com/facebook/facebook-nodejs-business-sdk
- https://developers.facebook.com/docs/business-sdk/
