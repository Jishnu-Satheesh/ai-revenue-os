# ADR 0050: Channel recommendations pilot ships stored context and curated playbooks, with the web-evidence slot prepared but empty

## Status

Accepted. User-approved pilot scope (2026-09-09): Cancellations Financial Impact and Operating
Availability Heatmap only. Implemented on `feat/governed-channel-intelligence` as prompt version 5
plus playbook version 1; the judge is untouched.

## Context

Recommendation narration was generic: the model saw the run's findings and nothing about which
storefront they came from, so cancellation and availability advice could not name the lever without
guessing. Two richer inputs were available but neither was wired: the stored organization and
channel record, and the operator know-how for Talabat cancellations and closures. A third input,
live web search, exists in the research pipeline only as fixtures — the Brave transport is not
qualified — so anything the prompt claims from the web today would be invented.

## Decision

- Ship stored channel context now. The worker loads it server-side from `channel_analysis_runs`
  (by analysis run id, scoped by organization id — the run row is authoritative, `payload.channelId`
  is a hint only), then `organization_channels`, `organizations`, and `branches`, each scoped by
  organization id. Only display names, keys, template keys, categories, industry, country, timezone,
  and currency reach the prompt; service-area blobs, contact details, addresses, phones, emails,
  order notes, and review text have no slot and are never selected.
- Ship curated playbooks now. `src/workflows/analysis/channel-playbooks.ts` carries versioned
  Talabat closed-cancellation, general-cancellation, availability, and generic-fallback guidance
  (`CHANNEL_PLAYBOOK_VERSION = 1`), 3–5 steps each, selected purely by channel identity, detector
  key, and reason labels. Reason labels are a documented heuristic: the narration finding shape
  carries no dimension values, so a finding whose code, headline, or limitations text names CLOSED
  contributes the `CLOSED` label. Steps are framed as checks in the operator's own portal, never as
  claims about a portal's structure.
- Prepare the web-evidence slot but ship it empty and fail-closed: `webEvidence = []`, never
  fetched, never invented, with the qualification comment at the call site. Copy-only URL rules
  (http(s) allowlist, no credentialed URLs) are already in the prompt builder for the day the slot
  fills.
- No model tool calls: `generateText` with system+prompt strings only. Web and playbook content
  arrives as fenced worker data, never as model-retrieved tools.
- Pilot gating: only runs whose findings include `orders.cancellation_loss`,
  `orders.cancellation_attribution`, or `operations.closed_share` render the new blocks; every other
  run renders the pre-pilot v4 shape (the version stamp alone becomes 5). A pilot-loader failure
  falls back to the v4 shape and the run still completes. No migration, no new env keys, no new
  events; sources stay inside `supportedActions`/detail text.
- Versions: narration prompt version 5 (`RECOMMENDATION_PROMPT_VERSION = 5` in
  `src/domain/analysis/recommendations.ts`), playbook version 1. The judge (`JUDGE_PROMPT_VERSION`)
  is untouched.

## Alternatives rejected

- Live search now — blocked on Brave transport qualification. The research pipeline runs on
  fixtures only; wiring an unqualified live fetch into cited recommendations would trade a known
  empty slot for unknown provenance. Revisit as the explicit follow-up.
- Merged claims about portal structure — rejected as hallucination risk. A step naming a menu path
  nobody verified reads as a manual the platform never checked; checks-not-claims keeps
  Talabat-specific advice without inventing what any portal contains.
- A new sources column — deferred. Source labels travel inside `supportedActions`/detail text, which
  the existing completion fence already validates; a schema change buys nothing the pilot needs.

## Consequences

- Cancellation and availability narration can name the storefront and give 3–5 concrete,
  check-framed steps while staying inside the same citation fence and the same max-6-items / max-5
  supportedActions contract.
- Non-pilot runs are byte-identical in shape to v4 apart from the version stamp, so the pilot
  cannot regress detectors or chapters it does not cover.
- The empty web slot is a deliberate, visible gap: prompts carry the copy-only rules but no web
  content until live search is qualified. Follow-up: qualify the live-search transport, then fill
  the prepared slot.
