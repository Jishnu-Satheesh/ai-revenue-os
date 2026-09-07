# Growth Intelligence research adapter qualification

Status: **reviewed refusal state**. Date: 2026-09-01.

No public-market provider was enabled and no external request was made. This is an intentional
completion of Task 5's stop condition, not a degraded live integration.

## Evidence gathered

- Brave's [terms](https://api-dashboard.search.brave.com/documentation/resources/terms-of-service)
  restrict durable Search Result storage/caching under the standard plan; its
  [privacy notice](https://api-dashboard.search.brave.com/documentation/resources/privacy-notice)
  describes search-query record retention.
- Tavily's [terms](https://www.tavily.com/terms) and
  [privacy policy](https://www.tavily.com/privacy) do not provide the required deployment-specific
  retention and training assurance.
- Exa's [standard terms](https://exa.ai/assets/Exa_Labs_Terms_of_Service.pdf) grant broad rights
  over input and output. Its [enterprise material](https://exa.ai/enterprise) identifies zero data
  retention as an enterprise option, not an executed control for this environment.
- Exa documents machine-readable result failure categories in its
  [error-code reference](https://exa.ai/docs/reference/error-codes), but the actual contract,
  credential, and controlled canary are absent.

## Automated verification

- Deterministic query tests prove profile strings cannot introduce search operators or prompt
  instructions, and strict scope validation refuses organization/private fields.
- Public HTTP tests cover loopback, RFC1918, metadata, IPv6 local, credential-bearing, non-HTTP(S),
  unsafe port, unsafe DNS resolution, DNS rebinding, redirect escape, and response-byte limits.
- The disabled candidate test proves every request fails with the same safe
  `FEATURE_NOT_AVAILABLE` outcome before any provider/network implementation is reachable.

## Canary status

Not run. Running it would require a credential and acceptance of provider terms, and could incur
charges or send profile scope to a third party. Those are external commercial actions not evidenced
by this repository approval.

## Required evidence to unblock

An approved legal/commercial owner must supply the executed enterprise agreement/DPA, written
retention/training/residency and derived-claim storage assurances, an approved spend ceiling, a
scoped deployment credential, and authorization for one bounded canary. The implementation owner
must then add the actual adapter and recorded canary evidence before any organization is enabled.
