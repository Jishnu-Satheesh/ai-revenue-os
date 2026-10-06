# Market research provider contract v1

Status: **active on the TinyFish lane**. Amended 2026-09-25 (Universal AI Agent, Task 6).

This contract is the admission gate for public-market research. It applies before a provider key,
search request, page retrieval, or organization rollout exists. It does not authorize a provider
account, acceptance of terms, commercial spend, or storage of public-page content.

## Production lane: TinyFish

Paid market research runs on the staged TinyFish lane only, assembled per run by
`createQualifiedTinyfishResearchAdapter` (`src/trigger/growth-intelligence-tinyfish.ts`):
the search adapter with the agent fallback lane behind it.

- Agreement: `tiny-fish-agreement.txt` ACTIVE (v1.3.0, 2026-09-20 → 2040-09-19,
  reference `AGR-2026-0915-0042`). All six uses granted: snippet storage, commercial
  inference, organisation display, derived claims, synthesis reuse, agreed retention.
  Commercial ceiling $0 unlimited; training opt-out CONFIRMED.
- Gates, checked in order on every run (first missing requirement fails closed,
  zero spend): `TINYFISH_SEARCH_API_KEY` present and non-blank, then
  `TINYFISH_MARKET_RESEARCH_ENABLED === "true"`, then a staged tinyfish
  qualification through `check_research_provider_qualification_for` with provider
  `tinyfish` (a staged qualification for any other provider never authorizes
  TinyFish spend — the lane is pinned per call).
- Budget is reserve-before-call: `reserve_request_budget` admits the whole-request
  worst-case quote (`tinyfish-search-2026-09`, capped by the pipeline ceiling),
  then every provider call reserves its worst case first through
  `reserve_research_attempt` (which re-asserts provider qualification server-side)
  and settles explicitly afterwards. Unknown cost stays reserved, never zeroed.
- Blocked lanes report provider `tinyfish`, so a run row with
  `adapter_provider = 'tinyfish'` and a blocked reason code is the honest
  fail-closed record — never a live call under another name.

## Required runtime boundary

- The adapter accepts only an approved Market Profile scope: public business name, registrable
  public domains, bounded niche descriptors, city, country, and approved topics. It never accepts
  an organization ID, branch ID, customer data, report values, source-page text, or model
  instructions.
- A run is bounded to 3 queries, 10 results per query, 512 KiB per response, 3 redirects, 20
  seconds per request, and USD 50 in integer micros. The enabled provider contract must set a
  lower commercial ceiling before rollout.
- Search and retrieval use a resolver-and-pinned-peer transport boundary. Loopback, private,
  link-local, metadata, multicast, documentation, credential-bearing, non-HTTP(S), unsafe-port,
  rebinding, and redirect-escape targets are refused before their body is accepted.
- Only compact claims and citation metadata may cross into Market Evidence. Full pages, raw
  queries, API keys, and source instructions must not be retained.

## Reviewed providers

| Provider                | Official technical evidence                                                                                                                                                         | Contract/privacy result                                                                                                                                                                                                                                                    | Decision                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| TinyFish Search + Agent | Staged lane (`tinyfish-search-adapter`, `tinyfish-agent-adapter`) behind the qualified-provider assembly, reserve-before-call budget, and the staged qualification RPC.             | Agreement `AGR-2026-0915-0042` ACTIVE with all six required uses granted, $0 unlimited ceiling, and training opt-out CONFIRMED.                                                                                                                                            | **Production lane.** Enabled per organization only through the gates above.                                         |
| Brave Search API        | [web search endpoint](https://api-dashboard.search.brave.com/api-reference/web/search/get) uses a subscription token.                                                               | The standard terms prohibit Search Result caching/storage and require a separate plan for that use; the privacy notice describes query-log retention.                                                                                                                      | Ephemeral preview only behind the live-preview route (persists nothing). Never authorizes production research runs. |
| Tavily                  | [search endpoint](https://docs.tavily.com/documentation/api-reference/endpoint/search) accepts a bearer token and can return content.                                               | Its terms allow processing/retention involving Tavily and third-party AI providers; this deployment has no written retention/training assurance.                                                                                                                           | Rejected.                                                                                                           |
| Exa                     | [search API](https://exa.ai/docs/reference/search) and [contents API](https://exa.ai/docs/reference/get-contents) provide bounded result/content retrieval and documented failures. | The standard terms grant broad rights over submitted inputs and outputs. [Enterprise](https://exa.ai/enterprise) advertises options including zero data retention, but no enterprise agreement, DPA, storage-rights addendum, or residency commitment is in evidence here. | Out. No adapter exists for market research, and none is planned on this lane.                                       |

## Retired: Exa Enterprise candidacy

The v1 contract staged Exa Enterprise as the potential adapter (`FEATURE_NOT_AVAILABLE`
with blockers `commercial_approval_missing`, `enterprise_terms_unexecuted`,
`zero_retention_unverified`, `derived_claim_storage_rights_unverified`,
`credential_missing`, `controlled_canary_missing`). That candidacy is retired: the
TinyFish agreement above covers the submitted profile scope, durable storage of compact
citation metadata and platform-authored derived claims, retention, training use, and
pricing ceilings, so no Exa enterprise agreement, DPA, storage-rights addendum, or
residency commitment is pursued.

## Enablement checklist

1. Record legal and commercial approval for one provider and an executed agreement/DPA.
   (Done for TinyFish: `AGR-2026-0915-0042`.)
2. Record the provider API/version, authentication owner, retrieval fields, citation identity,
   retries, rate/cost behavior, source failures, retention/training, residency, and deletion terms.
3. Configure a scoped credential in the deployment secret store; never commit it.
   (`TINYFISH_SEARCH_API_KEY`; absent or blank fails closed.)
4. Add a real transport that pins the resolved peer, disables implicit redirects, honors timeout and
   byte ceilings, and reports only normalized failure codes.
5. Run one approved, redacted canary against a public source. Preserve safe identifiers, latency,
   integer cost, citation metadata, and cleanup result—never the full page or raw provider payload.
6. Review the canary and enable a controlled organization rollout separately.
   (Kill-switch `TINYFISH_MARKET_RESEARCH_ENABLED`; rollout stays per-organization.)
