# TinyFish restoration of durable Market monitoring research

## Goal

- Restore the dropped durable Market monitoring research workflow — persisted citations and sources feeding claims, support review, synthesis, and cited reports — by replacing Brave Search with TinyFish Search as the qualified research provider, behind the existing fail-closed qualification gate.
- Keep the Brave live-only preview untouched and compliant until the TinyFish path passes canary; no production behavior changes before approval and legal clearance.

## Success Criteria

- A qualified organization can run daily monitoring and weekly synthesis that persist citation-backed sources and produce cited findings, competitor findings, limitations, and source inspection in the Insights and market tab.
- An unqualified organization sees the existing safe disabled state; no credential, contract, or payload leaks into safe surfaces.
- Every retained excerpt carries TinyFish qualification provenance and an agreed retain-until policy, and erasure renders sources unavailable with audit events preserved.
- Controlled canary passes on staging, tenant isolation is verified, and spec 022 plus a new ADR record the provider change.
- Written TinyFish storage confirmation and privacy terms are on file before production enablement.

## Context And Current Facts

- Spec 022 keeps durable cited Market Evidence in scope: Cited Market Evidence with source, date, geography, support grade, freshness, and limitations; 26 primary searches, two retries, five competitors, 20 topics, USD 1 per pipeline and USD 5 per organization local day.
- Spec 022 section 4.2 out-of-scope forbids a general-purpose crawler and a permanent copy of public webpages; section 9.7 requires cited findings with lineage and atomic spend limits.
- The Brave live-preview route is explicitly ephemeral: reads fresh results, returns them, stores nothing — no DB write, no RPC, no event, no cache — with a liveOnly flag and an unverified-leads disclaimer.
- The durable Brave adapter maps result description to excerptText capped at 2,000 chars within a 64 KiB total budget, normalizes citation URLs, drops unsafe or duplicate citations, and never crawls pages.
- Qualification is fail-closed: QUALIFIED_RESEARCH_PROVIDER is brave, REQUIRED_USES are snippet_storage, commercial_inference, organization_display, derived_claims, synthesis_reuse, agreed_retention, and the adapter stays blocked until a staged qualification reports no blockers.
- Brave standard Terms (1 Sep 2026) prohibit storing, caching, or databasing Search Results except transient operation storage, plus redistribution, AI training use, and post-termination retention — which is why durable storage was dropped to live-only.
- TinyFish Search API returns position, site_name, title, snippet, and url, with publisher and date for news and authors, venue, year, cited_by_count, and PDF URL for research papers, plus purpose, location, language, domain filters, and freshness or date windows.
- TinyFish Search and Fetch are free within limits (Search 30 per min, 500 per hour), and TinyFish Terms assign Outputs rights to the customer while licensing Customer Data back for service improvement and model training with safeguards.
- No new spec file is warranted: this restores an existing spec-022 workflow with a provider swap, so a spec amendment plus an ADR is the right ceremony.

## Constraints And Non-goals

- No Tier 3 code is written under this plan until explicit approval; this document is the approval gate.
- No full-page content persistence in v1: snippet and excerpt discipline stays (2,000 chars per excerpt, 64 KiB total), honoring the no-permanent-copy rule.
- No Brave storage-rights upgrade is pursued in parallel; Brave stays only as the compliant ephemeral preview until cutover.
- No autonomous budget, price, or public-brand actions are added; research stays read-only and advisory.
- No cross-organization learning from identifiable data; tenant isolation stays enforced at database and application layers.
- No money-moving or destructive tool calls from models; any side effects stay behind the deterministic gateway and policy checks.

## Key Decisions

- Provider choice: TinyFish Search for the durable path, because its docs show citation-grade fields and freshness controls with no search-specific storage ban, and its Terms assign Outputs to the customer — versus Brave standard Terms which explicitly ban durable storage.
- Brave rejected for durable storage: standard plan forbids it and the storage-rights tier is a separate commercial track with no evaluated pricing in this plan.
- Google grounding and Exa rejected for this pipeline: existing code excludes them from market research except a narrow channel-recommendations narration exception that stays untouched.
- Snippet-only v1, Fetch deferred: reuses the proven Brave-era excerpt pipeline and avoids copyright, cost, and latency risk; TinyFish Fetch becomes a follow-up slice.
- Qualification model extended, not bypassed: provider literal grows from brave-only to include tinyfish, REQUIRED_USES are re-attested against TinyFish Terms plus written confirmation, and the canary gate stays mandatory.
- Existing excerpts keep their Brave provenance: no retroactive re-labeling; new admissions carry the TinyFish qualification version.
- Preview migration deferred: Brave live preview remains until the TinyFish durable path passes canary, then a separate slice repoints or retires it and removes the Brave key.

## Recommended Approach

- Build a TinyFish search transport and adapter that mirror the Brave adapter's bounds, mapping, normalization, and stats, reusing ports, query planning, URL safety, budget limits, spender, and gate seams.
- Extend the qualification domain and staged-qualification plumbing to attest TinyFish rights, rates, credentials, model bounds, and canary, keeping fail-closed behavior and blocker-only safe surfaces.
- Wire the qualified adapter into the market-research worker behind availability checks, with TinyFish credentials from a new environment key and updated pricing metadata.
- Verify retention and erasure paths unchanged against the agreed-retention mapping, then prove the slice with fixtures, route tests, staging canary, and tenant-isolation checks.
- Record the change in spec 022, a new ADR, and the collaboration board, with legal confirmation filed before any production enablement.

## Work Plan

- Unit 0, ownership and legal groundwork, no code: claim touched files on the collaboration board; request written TinyFish confirmation of indefinite snippet and citation persistence for report building; request DPA and training-data opt-out terms for monitoring queries; confirm free-tier versus enterprise decision for production limits and SLA.
- Unit 1, domain qualification: extend the provider literal and qualification schema beyond brave-only; re-attest REQUIRED_USES against TinyFish outputs assignment and written confirmation; add migration for provider and qualification-version columns or constraints; update research-budget unit tests and budget-repository tests; hand-edit database types or UNTYPED_TABLES listing per repo convention.
- Unit 2, TinyFish provider seam: add tinyfish-search-transport with single-shot semantics, no redirect following, timeout and byte caps, and safe error mapping; add tinyfish-search-adapter with query-slot planning, per-slot attempt ceilings, duplicate and unsafe-URL collapsing, excerpt caps, digesting, and durable resume state mirroring the Brave runner.
- Unit 3, response mapping: map title to publisher fallback, snippet to excerptText, site_name to domain cross-check, url through public-URL normalization; carry publisher and date for news and authors, venue, year, and citation count for research papers into source metadata without widening excerpt budgets.
- Unit 4, wiring and configuration: extend qualified-provider resolution and the staged-qualification check to TinyFish; add TINYFISH_SEARCH_API_KEY plumbing with missing-credential fail-closed behavior; update worker runtime and scheduled dispatch to use the qualified TinyFish adapter; update pricing metadata from free-tier zero rates to enterprise rates when contracted.
- Unit 5, retention and erasure: keep the retention repository and erasure RPCs unchanged; verify retain-until values reflect the agreed TinyFish retention term; verify erased payloads show source-unavailable and lose synthesis eligibility with audit events intact.
- Unit 6, observability and docs: emit adapter, spend, latency, and failure metrics under existing correlation IDs; amend spec 022 sections on provider, preview exception, and research bounds; add the ADR for the Brave-to-TinyFish decision; update the collaboration board with touched files and outcomes.
- Unit 7, rollout and cutover: stage qualification per organization after canary; run shadow comparison against Brave fixtures; cut over durable runs to TinyFish; defer preview repointing and Brave key removal to a follow-up slice.

## Validation Plan

- Domain and adapter unit suites: run the growth-intelligence research test files unmodified and observe green, including new TinyFish adapter tests with bounded fixtures proving duplicate collapsing, unsafe-URL drops, empty-excerpt drops, and budget exhaustion stops.
- Route and application tests: run live-preview and market-research route suites to prove the ephemeral path is unchanged and the durable path stays gated when unqualified.
- Staging integration: run pgTAP suites against shared staging with the understanding they are non-hermetic; call any new plpgsql reader once against staging before calling the slice done.
- Controlled canary: execute a bounded TinyFish research run on staging, verify persisted sources, citation spans, support grades, spend records, and report rendering in the Insights and market tab.
- Tenant isolation: verify branch-must-belong-to-organization scoping, organization-scoped RLS on evidence tables, and that other branches and organizations are excluded from reads and synthesis.
- Error-path probes: force 429, 403, 503, oversize bodies, and expired qualifications to verify fail-closed behavior with safe messages and no provider-text leakage.
- Highest-risk validation step: the staging canary plus written legal confirmation, because code correctness alone cannot authorize durable storage.

## Risks And Rollback

- Risk: TinyFish training-use license over monitoring queries leaks sensitive commercial intent; mitigation: enterprise DPA with opt-out before production, minimal query payloads, no PII in queries.
- Risk: young-vendor reliability and free-tier limits (30 per min) collide with the 26-search plus retry budget inside the eight-minute deadline; mitigation: enterprise limits, per-call backoff, attempt ceilings, and canary latency evidence.
- Risk: upstream snippet copyright or source-access-rule disputes; mitigation: short excerpts only, source links preserved, exclusion and erasure paths honored, no paywall or CAPTCHA bypass.
- Risk: residual Brave excerpts with old provenance confuse retention audits; mitigation: provenance-tagged rows, no re-labeling, erasure path covers both vintages.
- Risk: pushed migrations go live on shared staging immediately with no local rehearsal; mitigation: read existing schema first, keep migrations additive, rehearse via dry-run listing.
- Rollback: flip staged qualification to unavailable so the adapter fails closed to the disabled state; no data rollback needed since admissions are append-only and preview never persisted; Brave preview remains as the read-only fallback until its planned retirement.

## Open Questions

- Has written TinyFish storage confirmation been received, and does it cover indefinite retention of snippets, titles, URLs, and derived claims for organization display and synthesis reuse.
- Is production carried on the free tier or an enterprise contract, and what are the contracted rate limits, SLA, SSO, audit-log, and data-residency terms.
- What numeric retain-until value encodes agreed_retention under the TinyFish agreement.
- Does v1 include TinyFish Fetch for full-page extraction or stay snippet-only with Fetch as a follow-up.
- When does the Brave live preview get repointed or retired, and when is the Brave key removed from environments.

## Sources

- https://docs.tinyfish.ai/search-api
- https://docs.tinyfish.ai/search-api/reference
- https://docs.tinyfish.ai/search-api/examples
- https://tinyfish.ai/terms
- https://tinyfish.ai/pricing
- https://api-dashboard.search.brave.com/terms-of-service
- https://brave.com/search/api/
