# Feature Specification: Growth Intelligence

## Status

Approved on 2026-08-31. The product, architecture, and written specification were approved before
implementation planning began.

Governed by accepted ADR 0044. Extends specs 005, 007, 016, and 018; ADRs 0026, 0037, 0039, 0040,
and 0043 remain in force except where ADR 0044 explicitly changes release sequencing.

This is a large Tier-3 feature. It introduces recurring public-market research, new tenant-owned
records, durable workers, an organization-level read model, and a draft-only Campaign handoff.

## 1. Business outcome

Give each organization a governed AI intelligence loop that continuously:

1. reads current business evidence;
2. researches the organization's approved niche and local market;
3. connects internal performance to relevant external conditions;
4. proposes evidence-backed Insights and Recommendations;
5. identifies the narrower set of Opportunities the platform can prepare safely; and
6. learns from operator preferences and verified outcomes without silently changing live behavior.

For a Kerala-cuisine restaurant in Dubai, the system should be able to connect governed restaurant
performance with dated public signals about its delivery area, Dubai-wide cuisine demand,
competitors, events, seasonality, and UAE context. It should explain the connection, cite every
external claim, and distinguish advice from execution and measured results.

The optimization target remains measurable incremental gross profit and customer acquisition.
Market activity, search interest, competitor offers, reviews, and revenue movement are evidence and
diagnostics; none is a realized business outcome by itself.

## 2. Product mental model

The organization navigation label changes from **Opportunity** to **Growth Intelligence**.
Opportunity remains a precise item type inside that workspace.

| Item           | Meaning                                                                                                             | V1 operator action                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Opportunity    | The platform has enough governed evidence and inputs to prepare a useful action. V1 supports a Campaign draft only. | Create governed draft, snooze, or dismiss |
| Recommendation | A useful action the operator performs outside the platform.                                                         | Plan, snooze, or dismiss                  |
| Insight        | A material internal observation or a supported connection between business and market evidence.                     | Acknowledge or pin                        |
| Data Gap       | Missing, stale, or incompatible evidence that weakens analysis or blocks a governed action.                         | Follow a direct repair path               |

Market Watch is an evidence view over external signals, not a fifth action type.

The governing rule is **advise freely, execute narrowly**. A supported Insight or Recommendation may
appear with limitations. A Campaign Opportunity appears only when the stronger deterministic
readiness contract in section 10 is satisfied.

## 3. User stories

- As an organization member, I see what changed in the business and its market, why it matters, and
  which evidence supports it.
- As an operator, I confirm the niche, locations, competitors, and source boundaries the system will
  monitor, so recurring research stays relevant.
- As an operator, I receive useful advice even when current data cannot support a financial estimate,
  while seeing the limitation clearly.
- As an operator, I plan a manual Recommendation without causing an external action or falsely
  claiming completion.
- As an operator, I create a governed Campaign draft from an eligible Opportunity without publishing,
  spending, or approving the Campaign for execution.
- As an administrator, I can exclude an untrusted source or disable research without deleting audit
  history.
- As a client manager, I can distinguish the activity date from the business and market evidence
  dates, so an old report processed today is never presented as current performance.
- As a support operator, I can trace a report or scheduled scan through research, synthesis, visible
  intelligence, operator decision, and Campaign handoff using safe identifiers.

## 4. Scope

### 4.1 In scope

- An operator-confirmed, versioned Market Profile for each organization, with optional branch scopes.
- AI-assisted initial discovery of niche, public business identity, geography, likely competitors,
  and research topics.
- Operator-confirmed proposed changes to the Market Profile; recurring research never changes its
  own scope silently.
- Public, attributable web sources and separately approved APIs only.
- Three geographic layers: branch trade area, city market, and country context.
- Daily market monitoring in the organization's timezone.
- A weekly consolidated intelligence review.
- Immediate business analysis and synthesis after governed data becomes current.
- Durable, idempotent work records with immediate dispatch and scheduled recovery.
- Cited Market Evidence with source, date, geography, support grade, freshness, and limitations.
- Cross-evidence Insights, Recommendations, and Data Gaps.
- A composed Growth Intelligence page that also reads existing Channel Recommendations and true
  Decision Engine Opportunities without copying their lifecycle state.
- Transparent, deterministic priority bands and component ordering.
- Current-month activity, unresolved carry-over, exact evidence windows, and an append-only timeline.
- Manual Recommendation planning, snoozing, and dismissal.
- Campaign draft Opportunities produced through a versioned Decision playbook.
- An atomic, retryable Opportunity-to-Campaign draft request with a frozen evidence snapshot.
- Preference learning from operator decisions and effectiveness learning from verified outcomes.
- Organization-scoped feature flags, source controls, budgets, audit, and observability.

### 4.2 Out of scope

- Publishing, media buying, provider writes, spend reservation, budget changes, discounts, pricing,
  or public brand changes from Growth Intelligence.
- Treating Campaign draft creation as Campaign approval.
- Automatically marking a manual Recommendation completed.
- Email, SMS, Slack, or other outbound alerts in the first release; the first release is in-app.
- Authenticated scraping, paywall or CAPTCHA bypass, private databases, or collection that violates a
  source's access rules.
- A general-purpose crawler or a permanent copy of public webpages.
- Individual reviewer/customer profiling or storage of unrestricted review text.
- Automatically promoting market claims into verified Business Facts, external benchmarks, policies,
  playbooks, prompts, or brand guidance.
- Cross-organization or peer learning from identifiable organization data.
- A model-generated financial value, confidence value, risk tier, eligibility result, rank, policy
  decision, outcome verdict, or realized-impact claim.
- A live research call during page rendering.

## 5. Domain language

**Market Profile** — the operator-approved definition of the market the organization wants the
platform to monitor: niche, public identity, geographic scopes, competitors, topics, source rules,
and disclosure limits.

**Market Profile Version** — an immutable proposal for that definition. Recurring research binds the
exact approved version it used.

**Market Research Request** — durable work created by profile approval, a daily or weekly due time,
or new current business evidence.

**Market Research Run** — one bounded execution of a request, including adapter/model versions,
cost, latency, safe outcome, and a result digest.

**Market Evidence Claim** — one compact, sourced statement about a market subject, with geography,
time, provenance, deterministic support grade, freshness, and expiry.

**Support grade** — rule-derived evidence quality: `primary`, `corroborated`, `single_source`,
`contextual`, or `conflicted`. It is not a model confidence score.

**Synthesis Run** — one bounded attempt to connect current internal findings with eligible Market
Evidence.

**Synthesized Intelligence Item** — an authoritative new `insight`, `recommendation`, or `data_gap`
owned by Growth Intelligence. It never duplicates a Channel Recommendation or Opportunity row.

**Activity date** — when an item or human decision entered the platform, rendered in the
organization timezone.

**Evidence period** — the exact governed business window and market retrieval/observation dates that
support an item. It is never replaced by the activity date.

## 6. Market Profile and research scope

### 6.1 Initial proposal

The system constructs a draft Market Profile from confirmed Digital Twin facts and a one-time,
bounded public discovery pass. Discovery may propose:

- one or more industry-neutral niche descriptors;
- the organization's approved public business name and domains;
- each branch trade area or delivery radius;
- city and country context;
- likely competitors, with the evidence for why each is relevant;
- market topics supplied by core or the installed Industry Pack; and
- source exclusions and safe disclosure settings.

Discovery results are profile candidates only. They do not enter Market Watch, create intelligence,
or start recurring monitoring before an operator confirms the exact version.

### 6.2 Approval and revision

- A profile version is immutable after proposal.
- Confirmation is an append-only decision binding the exact version and digest.
- Exactly one approved version is current for an organization at a time.
- AI may propose a new competitor, topic, geography, or source rule at any time, but the proposal has
  no effect until an operator confirms it.
- Disabling the Market Profile stops new research and synthesis without deleting prior evidence.
- Removing or excluding a source applies prospectively. Existing cards retain history but become
  ineligible for new synthesis when their only supporting source is excluded.

### 6.3 Geographic relevance

Every claim declares exactly one geographic layer:

- `trade_area` — a confirmed branch service or delivery area;
- `city` — the organization's city market; or
- `country` — national seasonality, regulation, or macro context.

Broader evidence may support a narrower business only when the synthesis states that inference as a
limitation. A country-level pattern is never presented as proof of branch-level demand.

### 6.4 Operator-started branch research

- The Growth Intelligence **Market monitoring** dialog is an explicit review surface for one
  branch, research topics, and competitor leads.
- One operator-started run binds exactly one active organization branch. Selecting a branch changes
  research scope only; it never edits the canonical branch record.
- Topics are editable, unique tags capped at 20 per run.
- Competitors are editable rows capped at five per run. Name is required; public website and a
  bounded location hint are optional.
- A competitor without cited relevance evidence is an unverified operator lead. It may guide
  research but cannot itself support a claim, recommendation, or execution decision.
- A missing business website does not block research. The approved name, selected branch scope, and
  topics remain sufficient; a saved branch without a usable locality keeps Start disabled and links
  to the organization profile for repair.
- Starting research proposes and confirms one immutable Market Profile version through the existing
  governed boundaries. The durable request and its fingerprint carry the selected branch.
- An unchanged scope already pending or claimed cannot enqueue duplicate work. A confirmed changed
  scope supersedes the prior version and cancels unfinished work under the existing transaction.

### 6.5 Source policy

- Only public, attributable sources and approved APIs are eligible.
- Research respects authentication, paywalls, CAPTCHAs, robots controls, redirects, and provider
  terms. A blocked source is recorded as unavailable, never bypassed.
- Operators may exclude a publisher/domain or an approved competitor.
- The first production adapter must pass commercial, privacy, retention, citation, crawl-failure,
  and SSRF review before any organization is enabled.
- ADR 0047 specifies Gemini Grounding with Google Search as the first implementation. Provider
  identity remains behind the adapter boundary and does not change the profile or evidence model.

## 7. Market Evidence quality

### 7.1 Source hierarchy

Evidence source classes, from strongest to weakest, are:

1. official government, regulator, tourism, statistics, and event sources;
2. a business's own public site or an approved first-party API;
3. reputable industry research and editorial sources; and
4. public listings, aggregated reviews, and public social/trend signals.

A primary source may support a direct fact alone. A material non-primary claim requires two
independent sources where practical. A single source remains usable for advice when labelled
`single_source`; it cannot independently support a Campaign Opportunity.

### 7.2 Claim contract

Every visible Market Evidence Claim includes:

- organization and optional branch scope;
- profile version and research-run references;
- subject kind and subject reference;
- normalized claim kind and platform-authored paraphrase;
- source URL, publisher, source class, and adapter version;
- retrieval time and source-published/observed time when known;
- geographic layer and normalized location reference;
- content digest and optional bounded quotation where source terms permit it;
- support grade and deterministic rationale;
- freshness class, expiry time, and current/stale/withdrawn state;
- corroborating or contradicting claim references; and
- safe limitations.

The platform does not store full public pages. Source text is untrusted and cannot select tool calls,
expand research scope, or become policy instruction.

### 7.3 Freshness and contradiction

- A versioned claim-category registry defines freshness and expiry; the model never chooses them.
- Fast-changing events, offers, prices, and availability expire sooner than structural market
  context.
- A dead or materially changed source causes a new evidence state; prior history is not rewritten.
- Contradictory eligible sources produce `conflicted` support. The disagreement is shown and cannot
  support execution readiness.
- Expired evidence may remain visible in the timeline but cannot support a current Opportunity.

## 8. Business analysis and automatic synthesis

### 8.1 Governed business evidence

Business evidence remains owned by its source modules. For governed Channel reports, projection
completion creates intelligence work in the same database transaction that makes the evidence
current.

A correction, supersession, or reconciliation decision that changes current evidence creates the
same durable work. Read-only provider ingestion follows the same rule when a governed sync revision
becomes current.

ADR 0043 remains authoritative for channel analysis. A report spanning multiple calendar months
enqueues each affected `YYYY-MM`; the server resolves local month bounds, branch scope, grain,
version tuple, and current evidence digest. The report's full declared period remains visible in
lineage, while each analysis card states the exact month/window it evaluated.

If a future multi-channel package projects several organization channels, each affected channel and
month receives an independent tenant-scoped request. One channel failure does not block another.

### 8.2 Recurring cadence

- A database-owned due time represents each organization's daily scan and weekly synthesis in its
  configured timezone.
- A scheduled dispatcher asks Postgres for due identifiers. It does not infer cadence from Trigger
  run history.
- New current business evidence creates an immediate request.
- A successful Market Profile confirmation creates the initial research request.
- An approved profile revision or source exclusion creates re-evaluation work for affected current
  intelligence; it does not rewrite prior research.
- Opening Growth Intelligence performs reads only and never starts research or analysis.

### 8.3 Durable work identity

The canonical request fingerprint covers:

- organization and optional branch/channel scope;
- request kind and trigger reason;
- business-evidence digest or explicit absence;
- Market Profile version;
- source-policy and research-rule versions;
- local daily or weekly time bucket; and
- synthesis/playbook version tuple where applicable.

The same upload, scheduler overlap, retry, or dispatcher replay reuses the same request. Changed
evidence, profile, source policy, or rule version creates new work.

### 8.4 Worker boundary

- Postgres owns pending state, claims, leases, attempts, cancellation, terminal outcome, and replay.
- Trigger.dev `schemaTask` workers carry identifiers and correlation metadata only.
- A model may return a bounded, schema-validated query plan; a deterministic research executor makes
  the approved search/content calls. The model receives no general browser or side-effect tool.
- An immediate task trigger reduces latency; a scheduled sweeper recovers requests whose dispatch
  was lost or whose lease expired.
- Workers claim rows atomically, process external calls outside database transactions, and complete
  through fenced, tenant-validating operations.
- Per-organization and per-adapter concurrency and cost ceilings are enforced.

### 8.5 Synthesis behavior

The synthesis worker receives only:

- current deterministic business findings and their citations;
- eligible compact Market Evidence Claims;
- approved goals, constraints, and Market Profile context; and
- prior operator preference signals that policy permits.

It may propose connections and actions. Deterministic code then validates citation coverage,
geography, freshness, source exclusions, duplication, item kind, priority components, and Campaign
eligibility before persistence.

If business evidence is stale, a supported market signal may create an Insight or Recommendation
with the stale-data limitation. It cannot create a Campaign Opportunity.

## 9. Growth Intelligence experience

### 9.1 Route and composition

The canonical route is `/organizations/[organizationId]/growth-intelligence`. The prior
`/opportunities` route redirects to it without triggering work.

The page composes authoritative source records through an application read service:

- active `opportunities` for the Opportunity lane;
- `channel_recommendations` labelled `recommendation` for manual Recommendations;
- `channel_recommendations` labelled `observation` for Insights;
- channel and synthesized `needs_data` records for Data Gaps;
- new synthesized intelligence records for cross-market Insights and Recommendations; and
- current Market Evidence Claims for Market Watch.

The composed read model is not a new system of record. Mutations route to the owning module. A
Channel Recommendation therefore has the same standing decision here and in Channel
Recommendations.

### 9.2 Page structure

1. **Priority actions** — separate platform-ready Opportunities and operator-performed
   Recommendations.
2. **Insights** — material internal and market-connected observations.
3. **Market Watch** — current external evidence and source state.
4. **Data Gaps** — missing, stale, or incompatible evidence with a repair link.
5. **Timeline** — generated, acknowledged, planned, snoozed, dismissed, superseded, expired,
   draft-requested, draft-created, and retry activity.

Data Gaps do not appear in the Opportunity lane and do not count toward Opportunity or
Recommendation totals. This preserves specs 005 and 007 while making readiness visible in the
broader Growth Intelligence workspace.

### 9.3 Dates and current-month behavior

- Timestamps are stored in UTC and rendered in the organization timezone.
- The default activity view is the current local month.
- Still-actionable unresolved items from earlier months carry forward with an explicit age label.
- A card always shows its generated date separately from business evidence windows and market
  retrieval/observation dates.
- Monthly timeline navigation changes activity history only; it never relabels an evidence period.

### 9.4 Card contract

Every card shows the fields applicable to its kind:

- one clear statement and why it matters;
- source module and affected organization/branch/channel;
- supported goal and scope;
- business evidence period;
- market geography, sources, and retrieval dates;
- freshness, support grade, limitations, and conflicts;
- estimated impact range and assumptions only where deterministically supported; and
- the exact next action and permission state.

An unavailable figure is absent with a reason, never zero. A forward-looking estimate is labelled
and shows its assumptions on the same surface. A realized result requires the measurement contract
in ADR 0019.

### 9.5 Priority

The model does not emit a score or rank. The UI exposes a deterministic priority band and its
components rather than a dimensionally invalid blended number.

- Opportunities retain ADR 0014 ordering: evidence tier, expected contribution within that tier,
  then time to impact.
- Recommendations use versioned rules over urgency, approved-goal priority, evidence support,
  freshness, and a deterministic impact estimate where one exists.
- Values with different currencies or evidence classes are never blended.
- Market Watch orders material changes by freshness and local relevance.
- An actor's pin is a user-scoped presentation preference and never changes organization policy or
  another user's ordering.

Daily monitoring promotes only materially new evidence or a material change in support/freshness.
Unchanged evidence updates the weekly synthesis and does not create a duplicate card.

### 9.6 Item lifecycle

- An Insight may be acknowledged or pinned. Acknowledgement clears its new state but preserves it
  for its evidence period and timeline.
- `planned` records intent for a manual Recommendation, removes it from the active queue, and does
  not assert completion.
- `snoozed` hides a Recommendation or Opportunity until a required future time.
- `dismissed` requires a bounded reason and remains auditable.
- A Data Gap remains open until its named input becomes current and compatible. Resolution is
  deterministic and append-only; an operator cannot mark missing evidence fixed by assertion.
- A later run creates untriaged narration when its content/evidence fingerprint materially changes;
  prior human decisions are not silently copied to new words.
- Stable fingerprints suppress byte-for-byte or evidence-identical duplicates.

### 9.7 Market monitoring and research outcomes

- The page header and Market Watch use the same **Market monitoring** dialog. The large inline
  profile-review block is not part of the four-tab workspace.
- Dialog pre-fill order is latest undecided proposal, active profile, then confirmed
  branch/onboarding context. A pending AI proposal may be edited or rejected.
- Starting research is one user action. The application preserves the existing append-only proposal
  and confirmation records; an interrupted confirmation leaves a recoverable pending proposal.
- The client observes request state automatically only while research is active. Terminal state
  causes one composed-page refresh; performance metrics keep their separate manual-refresh rule.
- The **Insights & market** tab shows current status, branch, scope, finish time, coverage, cited
  findings, competitor findings, limitations, source inspection, and research history.
- Recommendations derived from Market Research remain in **Recommendations**, link to their cited
  findings, and may enter Overview's deterministic Top Recommendations preview.
- **Your actions** names the research start and terminal outcome without invented progress.
- A completed or partial run with eligible claims enqueues one durable `market_evidence_changed`
  request with trigger reason `market_research_completed`. The synthesis worker consumes that
  request; empty or uncited retrieval does not enqueue synthesis.

## 10. Campaign Opportunity contract

### 10.1 Eligibility

A synthesized item becomes a Campaign Opportunity only through a versioned Decision playbook. V1
introduces an industry-neutral governed-draft playbook distinct from provider execution playbooks.

The playbook requires:

- current, governed internal business evidence within its declared freshness bound;
- relevant, unexpired Market Evidence with `primary` or `corroborated` support;
- an approved current Market Profile;
- an active registered goal and matching primary metric key;
- a clear Campaign objective and audience;
- sufficient current brand guidance and usable assets, or an allowed governed synthetic-asset path;
- a defensible forward-looking impact range, currency, deterministic confidence rationale, and
  assumptions;
- an evaluation-plan template and assertions that can be rechecked; and
- no currency conflict, policy prohibition, or current data-governance breach.

Missing provider mapping, publishing permission, ad-account capability, spend authorization, or
tracking does not block creation of an internal Campaign draft. Those are rechecked before Campaign
approval and execution. Missing draft prerequisites keep the item a Recommendation and name the
required Data Gap.

The draft Opportunity is Tier 1: internal and reversible. It creates no external action.

### 10.2 Create governed draft

The Opportunity action is **Create governed draft**, never **Approve**.

One atomic database operation:

1. authenticates the actor and requires `campaign.create`;
2. validates organization scope, opportunity version, action key, current proposed state, expiry,
   assertions, and campaign-draft eligibility;
3. appends the human decision and audit event;
4. transitions the Opportunity to `draft_requested`; and
5. inserts or replays one durable Campaign draft request keyed by organization and Opportunity.

The transaction makes no model or external-provider call.

A worker claims the request and creates exactly one Campaign plus its source snapshot through the
Campaign module. The snapshot freezes:

- Decision record, playbook version, Opportunity version, action key, and assertions;
- internal finding and evidence digests;
- Market Evidence Claim and Market Profile version references;
- objective, audience, approved goal, and primary metric;
- brand and asset readiness versions; and
- the assumptions and estimate the operator saw.

Success means the Campaign workspace contains the linked `draft` Campaign and source snapshot. It
does not mean a bundle version is generated, reviewed, approved, scheduled, published, or measured.

The governed-draft Opportunity lifecycle is `proposed` → `draft_requested` → `draft_created`.
Dismissal, snooze, and expiry remain terminal or temporarily inactive alternatives. A failed worker
does not pretend the Opportunity returned to `proposed`: it remains `draft_requested`, while the
linked request exposes whether the failure is retryable or permanent. A successful worker and the
Campaign link transition the Opportunity to `draft_created` in the same completion transaction.

Draft request states are `pending`, `processing`, `completed`, `retryable_failed`,
`permanent_failed`, and `cancelled`. Concurrent or repeated requests return the same request/Campaign
rather than creating another.

### 10.3 Current-contract repairs required

Implementation must repair, not route around, the current gaps:

- Opportunity feedback currently appends a row without changing lifecycle state.
- The current Campaign qualification accepts only `proposed` Opportunities and uses provider-action
  identity tied to the Meta bundle playbook.
- Opportunity reads must return the stored action key rather than substituting a default.
- Qualification assertions must reach the atomic Campaign source snapshot.
- An Opportunity-sourced snapshot must include objective, audience, evidence, and readiness versions,
  not only generic facts.

Campaign approval continues to require `campaign.approve` and exact-version attestation. Draft
creation must never reuse that permission or wording.

## 11. Data model

All new tenant-owned tables carry `organization_id`, `(organization_id, id)` uniqueness, indexed
composite tenant foreign keys, explicit grants, and RLS. Append-only records reject update/delete
where stated.

### 11.1 New records

- `organization_market_profiles` — stable profile identity, current approved version, enabled state,
  research due times, and last successful research markers.
- `organization_market_profile_versions` — immutable bounded profile document, digest, proposal
  provenance, model metadata where applicable, and creation time.
- `organization_market_profile_decisions` — append-only confirmation, rejection, disable, and
  supersession decisions with actor and correlation ID.
- `growth_intelligence_requests` — durable request fingerprint, trigger reason, bound versions and
  evidence digest, status, lease/fencing token, attempt state, due time, and safe failure code.
- `market_research_runs` — request execution, adapter/model versions, query/result digests, cost,
  latency, status, and safe counts.
- `market_evidence_sources` — normalized public source metadata, domain, source class, access state,
  content digest, and retrieval metadata.
- `market_evidence_claims` — compact claims and the contract in section 7.2.
- `market_evidence_claim_events` — append-only expiry, withdrawal, exclusion, correction, and
  supersession events. The read model derives current claim state without rewriting the claim.
- `market_evidence_links` — corroboration and contradiction edges between immutable claims.
- `growth_intelligence_synthesis_runs` — bound business/market/profile/rule version tuple and result
  digest.
- `growth_intelligence_items` — authoritative new `insight`, `recommendation`, or `data_gap` records,
  lineage digest, fingerprint, limitations, expiry, and safe narrative.
- `growth_intelligence_item_market_claims`, `growth_intelligence_item_channel_findings`, and
  `growth_intelligence_item_goals` link synthesized items to each evidence source through indexed
  composite tenant foreign keys. There is no unchecked polymorphic evidence identifier.
- `growth_intelligence_item_decisions` — append-only acknowledgement, plan, snooze, dismissal, and
  supersession decisions, including a required future time for snooze.
- `growth_intelligence_item_preferences`, `channel_recommendation_preferences`, and
  `opportunity_preferences` store actor-scoped pins through tenant-safe foreign keys. Pins are
  presentation state, not business decisions.
- `campaign_draft_requests` — exactly-once Opportunity handoff, claim/lease state, Campaign link,
  attempts, and safe failure code.

Flexible profile and evidence attributes use bounded versioned JSON documents validated by matching
Zod and Postgres allowlists. Business-critical status, ownership, time, source, digest, and lifecycle
fields remain relational.

### 11.2 Existing records changed

- Permission catalogue adds `growth_intelligence.read` for viewer and above, and
  `growth_intelligence.manage` for operator and above. Existing `campaign.create` governs draft
  creation; `campaign.approve` remains admin/owner execution consent. Planning, snoozing, dismissal,
  profile confirmation, research retry, and synthesized-item triage require
  `growth_intelligence.manage`; existing Channel Recommendation writes continue to require
  `recommendation.triage`.
- Channel Recommendation triage adds `snoozed` plus a required `snoozed_until` while preserving the
  existing append-only decisions.
- Opportunities add explicit governed-draft action identity and unambiguous draft-request lifecycle
  values. Legacy status values remain readable during forward migration.
- Decision feedback adds a draft-request decision kind and binds the exact Opportunity version.
- Campaign source snapshots or their bounded document contract gain the fields required by section
  10.2.

There is no table that copies every Channel Recommendation and Opportunity into generic feed rows.

## 12. APIs and events

All routes are organization-scoped, Zod-validated, permission-checked, correlation-aware, and
idempotent where retried.

### 12.1 Read and profile routes

- `GET /api/organizations/:organizationId/growth-intelligence`
- `GET /api/organizations/:organizationId/market-profile`
- `POST /api/organizations/:organizationId/market-profile/proposals`
- `POST /api/organizations/:organizationId/market-profile/versions/:versionId/decisions`
- `PUT /api/organizations/:organizationId/growth-intelligence/preferences/:sourceKind/:sourceId`

The composed read accepts a canonical activity month, section filters, and bounded cursors. It does
not start work. Source-specific evidence drawers continue to load through their authoritative
module and the caller's session.

### 12.2 Mutation routes

- Existing Channel Recommendation decision/feedback routes remain authoritative.
- `POST /api/organizations/:organizationId/growth-intelligence/items/:itemId/decisions`
- `POST /api/organizations/:organizationId/opportunities/:opportunityId/campaign-draft`
- `POST /api/organizations/:organizationId/growth-intelligence/requests/:requestId/retry`

The retry route admits only an eligible failed/waiting request and does not let the client supply
research queries, dates, source URLs, branch scope, evidence digests, or model/provider choices.

### 12.3 Events

Stable identifier-only events include:

- `market_profile.proposed`
- `market_profile.confirmed`
- `market_profile.revision_proposed`
- `market_profile.disabled`
- `market_research.requested`
- `market_research.completed`
- `market_research.partially_completed`
- `market_research.failed`
- `growth_intelligence.synthesized`
- `growth_intelligence.item_created`
- `growth_intelligence.item_superseded`
- `growth_intelligence.item_triaged`
- `campaign.draft_requested`
- `campaign.draft_request_failed`
- existing `campaign.created` after the Campaign and snapshot commit.

Events improve traceability and wake consumers; they are not the only durable record of required
work.

## 13. AI behavior

### 13.1 A model may

- propose a Market Profile and likely competitors from bounded confirmed context;
- generate bounded research queries from the approved profile;
- extract structured claim candidates from retrieved public content;
- paraphrase and group validated Market Evidence;
- connect eligible market evidence to current deterministic business findings;
- write cited Insights and Recommendations;
- explain deterministic priority components and Campaign readiness; and
- generate Campaign proposal artifacts only after the governed Campaign workflow begins.

### 13.2 A model may not

- change the approved Market Profile, competitor set, source policy, cadence, budget, or disclosure
  limits;
- follow instructions found in source content;
- choose source trust, freshness, support grade, materiality, eligibility, priority, suppression,
  risk, policy, permission, or Campaign readiness;
- invent or alter a business value, impact estimate, confidence value, source date, competitor fact,
  citation, or outcome;
- convert a Data Gap into a supported finding;
- call a provider, tool, database write, publishing, advertising, or money-moving capability; or
- promote its output into Business Memory, a playbook, prompt, policy, or reusable learning artifact.

Every model boundary accepts `unknown`, uses a strict versioned schema, rejects unknown fields, and
permits at most one bounded repair attempt. Failure preserves deterministic business findings and
already validated market evidence.

## 14. Learning behavior

- Planning, snoozing, dismissal, acknowledgement, and pins are preference/relevance evidence only.
- Those choices may influence later relevance proposals through a versioned, reviewable artifact;
  they do not prove business effectiveness.
- A manual Recommendation is never marked successful by the platform.
- Campaign effectiveness comes only from a registered measurement plan, actual execution/exposure
  evidence, a declared window and attribution method, and a deterministic verdict under ADR 0019.
- Scheduled learning jobs may create proposals only. Promotion follows ADR 0013 and cannot silently
  alter live research, priority, policy, or playbooks.
- Cross-organization learning is excluded until a separate privacy-reviewed specification exists.

## 15. Security and tenancy

- User reads and mutations use the signed-in session; no service role appears in a user-facing path.
- Background workers mutate only through narrow tenant-validating operations with explicit grants,
  empty search paths where privileged functions are unavoidable, and execution revoked by default.
- Every worker reloads organization scope and bound versions server-side. Tenant scope is never
  inferred from a query, URL, source page, model output, or client payload.
- Every exposed tenant table enables and forces RLS. Privileges are explicit and least-privilege;
  authentication alone is never treated as organization authorization.
- External requests permit public HTTP(S) destinations only and reject loopback, link-local, private,
  internal, metadata-service, and unsafe redirect targets.
- Search/fetch adapters receive only the approved public identity, niche, geography, competitors, and
  topics needed for the request.
- Raw workbooks, rows, customer names, phone numbers, email addresses, delivery addresses, order
  notes, credentials, signed URLs, prompts containing sensitive data, and private object paths never
  enter external research or logs.
- Public review material is aggregated and minimized; individual reviewer profiles are not stored.
- Source content is untrusted. It cannot select tools, alter prompts, expand scope, or create actions.
- Source and model-provider terms, retention, training, residency, and deletion behavior must pass
  review before enablement.
- Account/organization isolation, sensitivity filtering, and permission checks apply independently
  in UI, API, RLS, and worker boundaries.
- Claim metadata, decisions, and lineage follow the organization's intelligence-retention policy,
  whose floor covers the longest active Opportunity/measurement window plus one weekly review
  cycle. Any licensed excerpt or cached source content may have a shorter provider-required
  retention; its digest, citation metadata, and purge event remain.

## 16. Observability

Structured logs and traces carry safe identifiers when available: `organizationId`, `branchId`,
`channelId`, `profileVersionId`, `requestId`, `researchRunId`, `synthesisRunId`, `analysisRunId`,
`opportunityId`, `campaignDraftRequestId`, `campaignId`, `workerId`, and `correlationId`.

Track per organization:

- report-current to analysis-request and visible-intelligence latency;
- daily and weekly due/completed/partial/failed counts;
- request queue age, lease expiry, retry, cancellation, and abandoned-work recovery;
- source fetch success, access refusal, citation rejection, expiry, contradiction, and support-grade
  distribution;
- model validation, citation-coverage, narration, and prompt-injection rejection rates;
- new versus duplicate/superseded item volume;
- active, planned, snoozed, and dismissed Recommendations;
- Opportunity eligibility/rejection reasons;
- Campaign draft request latency, replay, failure, and exactly-once rate; and
- external research and model cost by profile, adapter, and run kind.

Alerts cover overdue due work, repeated adapter failure, expired leases, cost ceiling breach,
cross-tenant refusal anomalies, unsupported visible claims, stale Market Profiles, and draft requests
older than their retry window.

Operator copy is safe and actionable: for example, “Market research is delayed,” “Business data
needs refreshing,” or “Campaign draft creation can be retried.” Raw provider/model errors do not
reach the client.

## 17. Failure and recovery states

- **No confirmed profile:** recurring research remains off and the page offers profile review.
- **Profile proposal model unavailable:** confirmed business context remains; an operator can retry
  bounded discovery. No empty profile is auto-approved.
- **Source inaccessible:** the run records the safe source state and continues with independent
  sources.
- **One source contradicts another:** the claim becomes `conflicted`; no forced conclusion.
- **No current market evidence:** business-only Insights and Channel Recommendations remain usable.
- **Business data stale:** market-only advice may appear with the limitation; Campaign eligibility
  fails with a Data Gap.
- **Report dispatch lost:** the durable request remains pending and the sweeper retries it.
- **Worker crashes:** the lease expires and another claim resumes idempotently.
- **AI extraction or synthesis invalid:** no invalid item is stored; deterministic findings and
  validated claims remain visible.
- **Duplicate upload or schedule overlap:** the existing request/result replays.
- **Source later expires or is excluded:** active derived items are re-evaluated and may be
  superseded; history remains.
- **Campaign draft request dispatch lost:** the request remains pending and retryable.
- **Campaign creation fails:** no success is shown; the Opportunity remains linked to the retryable
  request.
- **Concurrent Campaign requests:** one request and one Campaign win; all callers receive the same
  identifiers.
- **Campaign prerequisites change after Opportunity creation:** the request fails safely and names
  the stale assertion; reassessment produces a new decision rather than reviving expired evidence.

## 18. Release increments

The architecture is delivered as four production-complete increments rather than one broad partial
release.

### 18.1 Market intelligence foundation

Market Profile proposal/confirmation, source governance, durable work ledger, one qualified public
research adapter, cited evidence, daily monitoring, weekly research consolidation, failure recovery,
tenant isolation, and a client-facing read-only Market Watch within the Growth Intelligence route.

### 18.2 Automatic business synthesis

Durable report-current handoff, ADR 0043 monthly analysis resolution, existing Channel Recommendation
chaining, market-to-business synthesis, new typed items, freshness, support, lineage, and duplicate
suppression.

### 18.3 Growth Intelligence experience

Renamed navigation/route, composed read service, Priority actions, Insights, Market Watch, Data Gaps,
timeline, current-month behavior, role-controlled decisions, pins, and Channel Recommendation state
synchronization.

### 18.4 Governed Campaign handoff

Draft playbook, deterministic eligibility, explicit action identity, atomic Campaign draft request,
complete source snapshot, exactly-once Campaign creation, retry behavior, and verified-outcome
feedback integration.

Each increment has its own feature flag and can be disabled without deleting evidence. The first
enabled organization is a controlled canary. Read-only intelligence precedes triage, and triage
precedes Campaign handoff.

## 19. Acceptance criteria

- The header action matches the approved **Market monitoring** label and icon and opens an
  accessible review dialog from both the header and Market Watch.
- The dialog selects one same-organization active branch, edits up to 20 topics and five competitor
  leads, and never mutates canonical branch data.
- Operator-entered name-only competitors remain visibly unverified until public citations support
  a Market Evidence Claim.
- One Start action creates the immutable scope, activates it, and enqueues exactly one
  branch-scoped research request; an identical active scope cannot duplicate work.
- Active research updates automatically, then refreshes the composed workspace once at a terminal
  state while preserving the last successful result on failure.
- Completed or partial research with eligible cited claims produces exactly one immediate synthesis
  handoff and makes resulting Insights, Recommendations, and Data Gaps reachable in their approved
  tabs.
- An operator confirms the exact inferred niche, public identity, geographic layers, competitors,
  topics, and source exclusions before recurring research begins.
- AI-proposed profile changes do not affect research until confirmed.
- Daily monitoring, weekly synthesis, and new-current-business-data triggers produce durable,
  idempotent requests in the organization timezone.
- A completed governed report automatically schedules each affected channel/month and its resulting
  Recommendations appear in Growth Intelligence without a page-view trigger.
- Every visible external claim carries a source URL, publisher, retrieval date, geography, support
  grade, freshness, and limitation state.
- No restricted/private URL, raw business report, credential, signed URL, customer PII, or unsafe
  source instruction crosses the research/model boundary.
- Duplicate dispatch, scheduler overlap, upload replay, or worker retry cannot duplicate evidence,
  intelligence items, or Campaigns.
- Growth Intelligence displays Opportunities, Recommendations, Insights, Market Watch, Data Gaps,
  and Timeline with the semantics in section 2.
- Data Gaps never enter Opportunity/Recommendation counts or the Opportunity lane.
- Current-month activity and exact evidence dates remain separate on every card.
- Existing Channel Recommendation decisions have one standing state across Channel Recommendations
  and Growth Intelligence.
- Planning a manual Recommendation removes it from the active queue and records intent without
  claiming completion.
- A stale internal evidence set permits qualified advice but cannot produce a Campaign Opportunity.
- No model writes a rank, money value, confidence, support grade, eligibility result, policy result,
  or realized-outcome verdict.
- A Campaign Opportunity exists only when all section 10.1 requirements pass and its estimate and
  assumptions are shown.
- “Create governed draft” creates exactly one durable request and exactly one linked Campaign source
  snapshot under concurrent and replayed calls.
- Draft creation performs no publish, spend, provider call, Campaign approval, or execution.
- Campaign approval remains exact-version, separately permissioned, and visibly distinct.
- Preference feedback does not become effectiveness evidence; verified measured outcomes do.
- Viewer/operator/admin/owner behavior matches the permission catalogue through UI, API, RLS, and
  direct-RPC misuse tests.
- Cross-account and cross-organization reads, writes, citations, source links, and Campaign handoffs
  fail closed.

## 20. Test plan

### 20.1 Domain and property tests

- Market monitoring form normalization, branch binding, 20-topic and five-competitor caps,
  unverified leads, and optional competitor website/location fields.
- Market Profile schema, digest, version activation, competitor/geography normalization, and source
  exclusion.
- Research/request fingerprint stability and invalidation for every bound version/evidence change.
- Source classification, support grade, corroboration, contradiction, freshness, expiry, and
  material-change detection.
- Geographic compatibility across trade area, city, and country.
- Synthesis classification into Insight, Recommendation, Data Gap, and Campaign-ineligible result.
- Deterministic priority components and stable ordering; no mixed currency/evidence arithmetic.
- Campaign Opportunity eligibility across every required and blocking input.
- Activity-month versus evidence-period rendering, including unresolved carry-over.

### 20.2 AI and adversarial fixtures

- Valid profile, claim extraction, synthesis, and recommendation outputs.
- Malformed/unknown fields and one failed bounded repair.
- Missing, dead, fabricated, cross-claim, and wrong-geography citations.
- Prompt injection in public pages, business names, competitor text, reviews, and operator notes.
- Invented price, trend, event date, impact, confidence, source, cause, or outcome.
- Unsupported Campaign action and stale-evidence attempt.
- Excessive query/tool-loop and research-budget refusal.

### 20.3 Database and hosted-staging tests

- RLS, explicit privileges, composite tenant foreign keys, and sensitivity filtering across two
  accounts and organizations for every new table/function.
- Permission matrix for profile confirmation, research retry, triage, pins, draft request, Campaign
  approval, and direct RPC misuse.
- Append-only profile decisions, evidence history, item decisions, and audit.
- Atomic profile activation, request upsert, claim with fencing token, lease recovery, cancellation,
  idempotent completion, and partial/terminal state preservation.
- Partial indexes for due/active work, indexes for tenant foreign keys and feed reads, and bounded
  pagination.
- Exactly-once Campaign draft request and Campaign creation under concurrency and replay.
- First staging invocation of every new/changed PL/pgSQL function that reads another table.

### 20.4 Worker, adapter, and integration tests

- Scheduled due selection in organization timezones, including daylight/time-boundary cases.
- Immediate report-current request, lost dispatch recovery, expired lease, retry, cancellation, and
  per-organization concurrency.
- Adapter contract fixtures for success, partial fetch, robots/access refusal, redirect, timeout,
  rate limit, malformed content, source removal, and cost limit.
- SSRF refusal for private, loopback, link-local, metadata, DNS-rebinding, and unsafe redirect cases.
- Report projection through affected monthly analysis, existing recommendation generation, market
  synthesis, and composed read.
- Deterministic findings remain visible when market research or AI narration fails.
- Campaign request through source snapshot and linked draft, including changed prerequisite and
  retryable failure.
- Logs/events contain identifiers and safe codes only.

### 20.5 End-to-end acceptance

Using a redacted Dubai Kerala-cuisine restaurant fixture and recorded public-source fixtures:

1. Operator reviews and confirms the inferred profile and competitor set.
2. Daily research creates cited Market Watch signals without duplicate cards.
3. A governed report becomes current and automatically produces its monthly analysis and Channel
   Recommendations.
4. Growth Intelligence shows the current activity date and the older report evidence period
   separately.
5. A market/business connection creates an Insight and manual Recommendation.
6. Planning the Recommendation removes it from active work and preserves the timeline.
7. A stale-data case remains advice-only and produces a Data Gap.
8. A fully qualified case creates one Campaign Opportunity.
9. An operator creates one governed Campaign draft; the Campaign workspace shows the frozen source
   snapshot and no execution approval.
10. Viewer mutations and cross-tenant identifiers are refused.

Browser acceptance covers desktop and mobile, keyboard navigation, source/evidence drawers, loading,
empty, stale, partial, failed, retrying, and permission states. Browser acceptance remains a user or
browser-tool verification step and is not claimed from unit tests.

### 20.6 Required verification

Use Node 22 and pnpm. Run focused tests during each increment, then formatting, typecheck, lint, full
Vitest, build, Trigger task contract tests, hosted migration list/dry-run/apply, hosted pgTAP,
database advisors, and browser acceptance. There is no local Supabase/Docker database.

## 21. Migration, rollout, and rollback

- Migrations are additive and forward-only against hosted staging.
- Schema lands in release-increment order; a migration applied to staging is never edited in place.
- Every migration is reviewed before staging application.
- Public tables enable RLS and receive explicit minimum grants; new Data API exposure is not assumed.
- Worker claims use short transactions and indexed pending/due predicates. External calls never occur
  while holding a database lock.
- Feature flags independently control Market Profile/research, synthesis, the Growth Intelligence
  read surface, triage, and Campaign draft handoff by organization.
- Disabling a flag stops new work, cancels or lets current bounded work settle according to its
  documented state, and leaves history readable.
- A source/adapter kill switch prevents new fetches without deleting claims.
- Rollback is operational disablement plus forward corrective migration. It never deletes Campaigns,
  decisions, profiles, evidence, or audit history.

## 22. Failure budgets and release gates

No production organization is enabled until:

- the research adapter's legal/commercial, privacy, retention, security, citation, and crawl behavior
  is approved;
- a fixed per-organization daily/weekly request and model-cost ceiling exists;
- the Market Profile and source-exclusion flow passes browser acceptance;
- live canary research produces no uncited visible claim;
- two-tenant RLS/RPC tests pass on hosted staging;
- dispatch-loss and lease-recovery tests pass;
- the composed page has no duplicated source state; and
- Campaign draft creation has passed concurrent exactly-once and no-publish/no-spend assertions.

## 23. Documentation updates required with implementation

- `context/03-architecture.md` — add the recurring Market Intelligence path.
- `context/04-domain-model.md` — add Market Profile, Market Evidence Claim, Synthesis Run, and
  Campaign Draft Request.
- `context/05-module-map.md` — add the Growth Intelligence module and composed experience.
- `context/10-events-and-workflows.md` — add request, research, synthesis, and draft events/tasks.
- `context/19-glossary.md` — add the domain language from section 5.
- `specs/005-decision-engine-v1.md` — add the governed-draft playbook and draft lifecycle.
- `specs/007-revenue-opportunity-feed.md` — rename the wider surface while retaining Opportunity
  semantics.
- `specs/018-governed-channel-intelligence.md` — add automatic report-current analysis handoff and
  Growth Intelligence composition without rewriting claimed Release-1 history.
- `MANIFEST.md` and `progress-tracker.md` — add this feature and its actual implementation state.

## 24. Open implementation dependencies

These are release gates, not unresolved product choices:

- Qualification and approval of one production public-search/content adapter.
- Provider credentials and cost limits for the enabled canary organization.
- Implementation of ADR 0043's server-resolved monthly analysis/cache contract before automatic
  report-to-analysis production enablement.
- A deterministic campaign-specific impact estimator and seeded governed-draft playbook before any
  Campaign Opportunity can be emitted.
- Complete objective, audience, brand, asset, and assertion propagation through the Campaign source
  snapshot.
- Review and repair of the existing global active-opportunity uniqueness rule so the new playbook
  cannot reject unrelated non-Campaign candidates.

The page, Insights, Recommendations, Market Watch, and Data Gaps may ship before the final three
Campaign dependencies. They must not be represented as Campaign-ready while those gates remain
closed.

## 25. References

- `adrs/0044-evidence-first-growth-intelligence.md`
- `adrs/0039-advise-freely-execute-narrowly.md`
- `adrs/0040-who-performs-the-action-decides-where-it-lives.md`
- `adrs/0043-month-year-evidence-window-and-content-addressed-analysis-cache.md`
- `adrs/0026-governed-channel-identity-and-report-contracts.md`
- `adrs/0037-recommendations-ride-a-second-fenced-worker.md`
- `adrs/0013-gated-artifact-learning.md`
- `adrs/0014-decision-value-and-evidence-tiers.md`
- `adrs/0017-campaign-runtime-and-approval.md`
- `adrs/0019-campaign-measurement-and-learning.md`
- `specs/005-decision-engine-v1.md`
- `specs/007-revenue-opportunity-feed.md`
- `specs/010-human-approval-governance.md`
- `specs/011-learning-ledger.md`
- `specs/016-campaign-feedback-loop.md`
- `specs/018-governed-channel-intelligence.md`
