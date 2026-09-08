# Market monitoring and research completion design

## Status

Approved in chat on 2026-09-08. Awaiting review of this written contract before implementation.

This design corrects the first Growth Intelligence prototype mismatch: the header control, market
monitoring review dialog, branch-specific research scope, live research progress, and the complete
research-to-recommendation outcome. It extends Spec 022 and ADR 0044 without changing execution
authority or permitting Growth Intelligence to publish, spend, or alter the business profile.

## Problem

The production page currently shows **Manage market monitoring** as an anchor to a large inline
Market Profile card. The approved prototype shows a compact **Market monitoring** button with a
settings icon and a modal review flow.

The gap is deeper than presentation:

- current profile confirmation enqueues organization-scoped research with no selected branch;
- the research query scope ignores saved competitors;
- the only adapter is an explicitly unavailable Exa placeholder;
- successful adapter fixtures persist source metadata but no cited claims; and
- research completion does not immediately produce refreshed Insights or Recommendations.

A UI-only modal would therefore accept a research request without delivering the outcome it
promises.

## Approved user experience

### Entry points

- Replace the header action with **Market monitoring** and a `settings-2` icon.
- The header action and the Market Watch empty/status action open the same dialog.
- Remove the large inline Market Profile review block above the four workspace tabs.
- Viewer roles may inspect the dialog and research results. Only members with
  `growth_intelligence.manage` may change scope, reject a proposal, or start research.

### Dialog content

The dialog title is **Review market monitoring**. It contains:

- **Business** — read-only approved organization name and concise business descriptor.
- **Location** — a single-select dropdown of active branches. Each option shows
  `Branch name — service area` when confirmed service-area text exists, otherwise the branch name.
  Editing this selection changes research scope only and never updates the canonical branch.
- **Topics** — editable tags, pre-filled from the chosen profile source. Users can remove tags and
  add custom topics. A run accepts at most 20 unique topics.
- **Competitors** — repeatable rows with required name, optional public website, and optional
  free-text location hint. A run accepts at most five competitors. Name-only competitors are valid
  unverified research leads.

Pre-fill priority is the latest undecided proposal, then the active profile, then confirmed branch
and onboarding context. A pending AI proposal remains visibly labelled as a proposal and exposes
**Reject proposal**. Other states expose **Cancel**.

If the selected branch has neither a usable saved service area nor a confirmed city from the
current/proposed profile, Start remains disabled and the dialog links to the existing organization
profile workflow to complete the location. A missing business website does not block research;
approved business domains may be empty and the provider searches by the approved name and branch
scope.

The primary action is **Start market research**. The modal itself is the explicit review step, so
there is no second confirmation screen. One click proposes the exact operator-edited profile and
confirms that immutable version through the existing governed boundaries. If proposal succeeds but
confirmation is interrupted, the saved undecided proposal becomes the next pre-fill and the user
can safely retry.

### Active and terminal states

- An unchanged scope with pending or claimed research shows **Research in progress** and disables
  another start.
- A materially changed scope may start a replacement version; confirmation atomically supersedes
  the prior profile and cancels its unfinished requests through existing database behavior.
- While a request is active, the client refreshes only that request's authoritative status. This is
  active-work status observation, not periodic performance-data polling.
- On terminal completion, the client refreshes the Growth Intelligence read model once.
- Full, partial, and failed outcomes preserve the last successful research result.

## Profile and branch contract

Operator-started research binds exactly one active branch. The profile version retains the required
trade-area, city, and country geography records, but only one trade-area geography may be selected
for an operator-started run. The durable research request copies that branch ID into `branch_id`,
and its fingerprint includes the branch, profile version, source policy, research rule, and time
bucket.

The Market Profile competitor contract gains an optional bounded `locationHint`. An operator lead
may have an empty `relevanceEvidenceUrls` array. An empty array explicitly means **unverified lead**;
it never counts as evidence. Existing cited competitors remain valid. AI profile discovery remains
unable to invent competitors without bounded public evidence.

The application deterministically derives stable competitor/topic keys, rejects duplicates after
normalization, validates public HTTP(S) websites, and retains the existing profile source policy and
cadence when the dialog edits only branch, topics, and competitors.

## Grounded research pipeline

The qualified adapter will use Gemini Grounding with Google Search. Competitor websites, when
supplied, may also be passed through URL Context. The provider call is permitted only when the
configured Google project, model, billing, data handling, and grounding capability pass the release
gate.

Google currently documents grounded search with citations and URL Context. Google also documents
grounded search plus strict structured output for Gemini 3 as a preview feature. Production
correctness will not depend on that preview combination. The pipeline uses two bounded stages:

1. **Grounded retrieval** searches the selected branch market, topics, and up to five competitor
   leads. It returns bounded source metadata, cited text spans, provider/model identity, cost, and
   latency.
2. **Validated claim extraction** receives only the bounded cited spans and source identifiers. It
   emits a strict schema of compact claim candidates. Deterministic code verifies every source
   reference, geography, date, quote bound, exclusion rule, and content limit before persistence.

Raw provider bodies, unrestricted page copies, search suggestion HTML, credentials, and hidden
reasoning are never stored. A model-created statement without an eligible cited source is rejected.
Unavailable, excluded, stale, or conflicting sources remain visible as limitations rather than
being silently removed.

## Completion and synthesis

Research completion must produce a useful outcome rather than stop at a source list:

1. Persist accepted sources, claims, and claim-source links through the existing fenced evidence
   boundary.
2. Complete the research run and request as `completed` or `partial`, preserving measured cost and
   latency.
3. When at least one eligible claim was persisted, enqueue a new durable
   `market_evidence_changed` synthesis request with trigger reason `market_research_completed`.
4. Dispatch that request to the existing synthesis worker. The worker combines eligible market
   claims with current governed business findings and persists supported Insights,
   Recommendations, and Data Gaps.
5. Keep ranking, support grades, campaign eligibility, money, and realized-result claims under
   existing deterministic rules. Research never creates an execution or Campaign approval.

Empty grounded results finish honestly with no synthesis request and a visible **No usable findings**
outcome. A partial run may synthesize only from its eligible claims and carries the partial-coverage
limitation forward.

## Outcome placement

No fifth top-level tab is added.

- **Insights & market** shows the latest research status, selected branch, scope, finish time,
  coverage, source count, cited findings, competitor findings, limitations, data gaps, source
  inspection, and research history.
- **Recommendations** shows actionable items produced from research with a **From market research**
  label and a link to supporting findings.
- **Overview** receives newly generated high-priority items through the existing deterministic Top
  Recommendations ordering.
- **Your actions** records the named research start and terminal outcome without inventing progress
  percentages.

## Failure and recovery behavior

- Invalid or duplicate inputs remain in the dialog with field-level explanations.
- Proposal failure saves nothing and keeps the typed form.
- Confirmation/enqueue failure leaves the undecided immutable proposal recoverable for retry.
- Provider unavailable, timeout, quota, malformed grounding, missing citations, unsafe URL,
  extraction failure, synthesis failure, and claim-loss each map to bounded safe codes.
- External calls run outside database transactions. Database leases, retries, idempotency, and
  terminal transitions remain authoritative.
- A failed replacement never erases the last successful findings or recommendations.
- The UI never displays provider exception text or raw fetched content.

## Authorization and tenant isolation

- Page and status reads require `growth_intelligence.read` and remain organization-scoped through
  the signed-in Supabase client and RLS.
- Profile proposal, rejection, confirmation, and manual research start require
  `growth_intelligence.manage` in both the API and security-definer database functions.
- Worker reads and writes use identifier-only payloads and the existing service identity. Composite
  organization foreign keys and explicit organization predicates fence branch, profile, request,
  run, source, claim, link, and synthesis records.
- The selected branch must be active and belong to the same organization at confirmation time.
- Competitor names and locations are untrusted operator text at every model boundary.

## Observability and cost controls

Each run records organization ID, request ID, run ID, profile version, branch ID, correlation ID,
provider/model versions, bounded query count, source attempts, accepted sources/claims, safe outcome,
cost, and latency. Logs contain identifiers and safe codes only.

The adapter enforces per-run query, result, response-byte, redirect, timeout, and cost ceilings.
The initial competitor cap is five and the topic cap is twenty. Feature flags and the existing
adapter kill switch can stop new work without deleting history.

## Expected implementation surface

- Header/page composition and a new focused Market monitoring dialog component.
- Market Profile read/proposal view builders and strict form schemas.
- Backward-compatible Market Profile competitor schema support for `locationHint` and unverified
  operator leads.
- Forward-only migration replacing the private Market Profile validator and the existing public
  confirmation function without changing their signatures, plus the new request kind and trigger.
- Branch-aware request fingerprints, dispatcher routing, Grounded Google adapter, bounded claim
  extraction, evidence persistence, and immediate synthesis handoff.
- Active-request status API/read model and active-only client refresh.
- Insights & market research summary/history and provenance links on derived recommendations.
- Spec 022, ADR 0047, environment documentation, Trigger registration, and collaboration record.

## Verification

- Domain tests for form normalization, five-competitor/twenty-topic bounds, branch selection,
  optional competitor fields, unverified leads, prompt-injection cleanup, and exact digests.
- API tests for viewer/operator permissions, recoverable two-step start, duplicate starts, pending
  proposal rejection, changed-scope replacement, and safe failures.
- Hosted pgTAP for two-tenant branch fencing, inactive/foreign branch refusal, profile versioning,
  request fingerprinting, exactly-once enqueue, supersession, leases, direct-write denial, and the
  new synthesis handoff.
- Adapter contract tests with recorded synthetic provider responses for citations, redirects,
  exclusions, malformed annotations, missing sources, quota/timeout, cost, and latency.
- Workflow tests proving full, partial, empty, failed, replayed, and claim-lost research outcomes;
  cited claim persistence; one immediate synthesis request; and no execution side effect.
- UI tests for modal pre-fill order, keyboard/focus behavior, editable tags and competitors,
  read-only viewers, in-progress disablement, active-only refresh, terminal refresh, history, source
  links, and responsive layouts.
- A controlled live canary against hosted staging is required before enablement. It must prove that
  every visible market claim opens an eligible citation and that a completed run produces the
  expected Insights/Recommendations without duplicates.

## Rollout and rollback

Roll out behind the existing Market and Synthesis organization flags plus an explicit qualified
Google research-adapter configuration. Start with the staging verification organization and a low
cost ceiling. Rollback disables new adapter calls and manual starts, lets a currently leased bounded
run settle, and keeps all profiles, requests, evidence, decisions, and audit history readable.

## Provider references

- Google Grounding with Search: https://ai.google.dev/gemini-api/docs/google-search
- Google structured outputs: https://ai.google.dev/gemini-api/docs/structured-output
