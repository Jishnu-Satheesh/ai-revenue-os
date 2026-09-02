# ADR 0025: Use the Meta Business SDK as transport, and pin the contract to the version it calls

## Status

Accepted. Supersedes ADR 0024.

## Context

ADR 0024 chose direct Graph calls over `facebook-nodejs-business-sdk`, principally because the SDK hard-codes `v24.0` while the checked-in contract verified `v26.0`. The project owner reviewed that and reaffirmed the preference for the official SDK.

Re-checking the facts under that decision improved it, and corrected one of them.

- **v24.0 is not stale.** Meta's version schedule lists it as released 2025-10-08 and supported until 2028-02-18. ADR 0024 treated the gap as a risk of calling an aging surface; it is an older _live_ version with roughly eighteen months of support remaining. That materially weakens the original objection.
- **The version cannot be moved.** `FacebookAdsApi.VERSION` is a static getter returning the literal `'v24.0'` with no setter, and `call()` builds URLs as `[GRAPH, VERSION, ...path]`. Every request the SDK issues goes to v24.0 regardless of what any contract says.
- **Coverage is real.** `IGUser`, `IGMedia` and `Page` cover the organic surfaces; `AdAccount`, `Campaign` and `AdSet` cover the ads object graph the paid work needs.
- **Two SDK behaviours are unsafe by default.** Its crash reporter is enabled unless the third constructor argument is `false`, and it reports diagnostics to Meta. Its `call()` places the access token in the query string rather than a header.

## Decision

- `facebook-nodejs-business-sdk@24.0.1` is the transport, with `@types/facebook-nodejs-business-sdk@24.0.0` for typing. Both are pinned exactly.
- **The contract pins the version the SDK calls, not the newest one published.** `apiVersion` is `v24.0`, and a test asserts it equals `FacebookAdsApi.VERSION`. The contract must describe requests this platform actually makes; a version it merely prefers would be false at its most load-bearing field, and every scope, placement and restriction recorded there inherits it.
- **Upgrading the SDK is a contract event, not a dependency bump.** When the SDK publishes a new version its assertion fails, and the contract must be re-verified against that version's documentation before the upgrade lands. The failing test is the intended alarm.
- **The crash reporter is disabled.** The client constructs the API with `crash_log: false`; this platform decides what leaves it.
- **The token stays out of this platform's logs.** The SDK's query-string placement is Meta's documented form and cannot be changed through a supported API. Nothing in the client logs or returns a URL, and a test asserts neither the token nor the Graph host appears in any result handed to a caller.
- **Everything the platform's rules require stays above the SDK.** Bounded Zod schemas on every response, stable failure codes built from status and error type rather than provider prose, retry classification taken solely from the contract, and a distinct `unknown` outcome. The SDK exposes no timeout or cancellation, so both are imposed by the client — and because the underlying request cannot actually be aborted, a timeout is reported as unknown rather than cancelled.

## Consequences

- Endpoint shapes, URL building and version pinning come from Meta rather than from us, which is the point of using an SDK and the main thing ADR 0024 gave up.
- The platform is anchored to v24.0 until the SDK moves. That is acceptable while v24.0 is supported to 2028-02-18, and the contract test makes the day it changes impossible to miss.
- Typing is community-maintained via DefinitelyTyped and can drift from runtime behaviour, so response parsing stays the authority rather than the types. Zod was already required at every external boundary, so nothing is weakened.
- The SDK's own error and retry behaviour is deliberately not inherited. A caller sees this platform's vocabulary, not Meta's.
- Reversal stays cheap: the transport sits behind one client module, and swapping it does not reach the Tool Gateway, the campaign domain, or the contract.

## References

- `adrs/0016-integration-action-capabilities.md`
- `adrs/0024-meta-graph-calls-over-the-business-sdk.md` (superseded)
- `docs/provider-contracts/meta-campaign-v1.md`
- `src/modules/integrations/providers/meta/client.ts`
- https://developers.facebook.com/docs/graph-api/changelog/versions/
- https://github.com/facebook/facebook-nodejs-business-sdk
