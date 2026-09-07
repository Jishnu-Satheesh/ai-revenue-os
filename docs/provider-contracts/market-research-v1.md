# Market research provider contract v1

Status: **blocked — no provider is enabled**. Reviewed 2026-09-01.

This contract is the admission gate for public-market research. It applies before a provider key,
search request, page retrieval, or organization rollout exists. It does not authorize a provider
account, acceptance of terms, commercial spend, or storage of public-page content.

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

| Provider         | Official technical evidence                                                                                                                                                         | Contract/privacy result                                                                                                                                                                                                                                                    | Decision                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Brave Search API | [web search endpoint](https://api-dashboard.search.brave.com/api-reference/web/search/get) uses a subscription token.                                                               | The standard terms prohibit Search Result caching/storage and require a separate plan for that use; the privacy notice describes query-log retention.                                                                                                                      | Rejected for this durable, cited-claim use until a suitable written enterprise agreement exists. |
| Tavily           | [search endpoint](https://docs.tavily.com/documentation/api-reference/endpoint/search) accepts a bearer token and can return content.                                               | Its terms allow processing/retention involving Tavily and third-party AI providers; this deployment has no written retention/training assurance.                                                                                                                           | Rejected.                                                                                        |
| Exa              | [search API](https://exa.ai/docs/reference/search) and [contents API](https://exa.ai/docs/reference/get-contents) provide bounded result/content retrieval and documented failures. | The standard terms grant broad rights over submitted inputs and outputs. [Enterprise](https://exa.ai/enterprise) advertises options including zero data retention, but no enterprise agreement, DPA, storage-rights addendum, or residency commitment is in evidence here. | Technical candidate only; blocked.                                                               |

## Candidate: Exa Enterprise

The potential adapter is `exa`, contract revision `market-research-v1`, but it is not callable.
The implementation deliberately returns `FEATURE_NOT_AVAILABLE` before constructing a network
request. The checked-in blockers are:

- `commercial_approval_missing`
- `enterprise_terms_unexecuted`
- `zero_retention_unverified`
- `derived_claim_storage_rights_unverified`
- `credential_missing`
- `controlled_canary_missing`

The future agreement must explicitly cover the submitted profile scope, durable storage of compact
citation metadata and platform-authored derived claims, allowed quotation limits, retention,
training use, subprocessors/residency, pricing/rate ceilings, deletion, and source/robots failure
handling. A provider’s marketing statement is not evidence of the organization’s executed terms.

## Enablement checklist

1. Record legal and commercial approval for one provider and an executed agreement/DPA.
2. Record the provider API/version, authentication owner, retrieval fields, citation identity,
   retries, rate/cost behavior, source failures, retention/training, residency, and deletion terms.
3. Configure a scoped credential in the deployment secret store; never commit it.
4. Add a real transport that pins the resolved peer, disables implicit redirects, honors timeout and
   byte ceilings, and reports only normalized failure codes.
5. Run one approved, redacted canary against a public source. Preserve safe identifiers, latency,
   integer cost, citation metadata, and cleanup result—never the full page or raw provider payload.
6. Review the canary and enable a controlled organization rollout separately.
