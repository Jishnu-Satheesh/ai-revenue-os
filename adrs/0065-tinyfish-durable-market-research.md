# ADR 0065 — TinyFish Search as the durable market-research provider

Status: Accepted 2026-09-19 (durable-lane provider swap recorded; staging migration apply, canary, and the legal confirmations below still owed — none of them gate this record, all of them gate production enablement).

## Context

- ADR 0047 specified Brave Web Search for market research under explicit account-specific storage/reuse rights. Brave's standard Terms (1 Sep 2026) ban durable storage of Search Results — no storing, caching, or databasing except transient storage required for operation — plus redistribution, AI-training use, and post-termination retention (see https://api-dashboard.search.brave.com/terms-of-service). Durable cited Market Evidence therefore could not be built on the standard Brave plan, and durable storage was dropped to a live-only preview: fresh Brave results shown on an explicit manager click, then discarded, storing nothing.
- Spec 022 keeps durable cited Market Evidence in scope (source, date, geography, support grade, freshness, limitations) with unchanged retrieval bounds: 26 primary searches plus 2 retries, 5 competitors, 20 topics, USD 1 per pipeline and USD 5 per organization local day.
- TinyFish Search returns citation-grade fields (position, site_name, title, snippet, url; publisher and date for news; authors, venue, year, cited_by_count and PDF URL for research papers) with purpose/location/language/domain filters and freshness or date windows, and its Terms assign Outputs rights to the customer — with no search-specific durable-storage ban of the kind Brave's standard Terms impose.
- The staged per-provider qualification (same six required uses re-attested: `snippet_storage`, `commercial_inference`, `organization_display`, `derived_claims`, `synthesis_reuse`, `agreed_retention`; fail-closed; canary-gated) is the mechanism that authorizes any durable lane. New RPC `check_research_provider_qualification_for(p_provider)`; additive migration `20260919120000` (NOT pushed — staging apply owed, user's step).

## Decision

- TinyFish Search is the durable market-research lane, behind the staged per-provider qualification with lane pin and a kill-switch default closed (`TINYFISH_MARKET_RESEARCH_ENABLED`; the paid path stays off unless `"true"`).
- Brave is kept ONLY for the ephemeral live preview that stores nothing (no DB write, no RPC, no event, no cache). The spec 022 preview exception stays until preview repointing, which is an explicit follow-up slice, not this change.
- Snippet/excerpt discipline is unchanged (2,000 chars per excerpt, 64 KiB total; no full-page persistence; no paywall/CAPTCHA bypass). Existing Brave-provenance excerpts keep their provenance with no retroactive re-labeling; new admissions carry the TinyFish qualification version.

## Alternatives rejected

- Brave for durable storage on the standard plan: explicitly banned by its Terms; the storage-rights tier is a separate commercial track with no evaluated pricing in this plan.
- Google grounding and Exa for this pipeline: existing code excludes them from market research except a narrow channel-recommendations narration exception that stays untouched.
- Bypassing or loosening qualification for TinyFish: rejected — the provider literal grows to include `tinyfish` but REQUIRED_USES are re-attested and the canary gate stays mandatory.

## Consequences

What changes:

- Durable runs resolve to the TinyFish adapter once a staged TinyFish qualification reports no blockers; unqualified organizations keep the existing safe disabled state.
- Every retained TinyFish excerpt carries TinyFish qualification provenance and the agreed retain-until policy; retention and erasure paths are otherwise unchanged (erasure stays provider-agnostic; erased payloads render source-unavailable and lose synthesis eligibility with audit events intact).

What stays:

- Brave ephemeral preview, retrieval bounds, excerpt budgets, tenant isolation, spend ceilings, and safe error surfaces are unchanged.
- Google/Exa exclusion and the no-permanent-copy rule still hold; TinyFish Fetch is a deferred follow-up, not v1.

Open legal gates (all OPEN — they gate production enablement, and are not presented as done):

- Written TinyFish confirmation of snippet/citation persistence (titles, URLs, snippets, derived claims) for organization display and synthesis reuse, covering the agreed retention term.
- DPA plus training-data opt-out for monitoring queries.
- Free-tier versus enterprise decision for production limits, SLA, and contracted rates (pricing metadata stays at free-tier zero rates until contracted).

Amends ADR 0047 (durable provider only) and spec 022 sections 4.2, 6.5, and 8.2.
