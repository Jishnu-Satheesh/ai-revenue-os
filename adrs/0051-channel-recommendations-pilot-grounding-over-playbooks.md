# ADR 0051: Channel recommendations pilot grounds narration with Google Search; curated playbooks removed

## Status

Accepted. User-approved Amendment A (2026-09-09) to the channel recommendations pilot.
Implemented on `feat/governed-channel-intelligence` as narration prompt version 6 and judge
version 2. ADR 0050 stands as history: it records the version-5 approach (stored context plus
curated playbooks, empty web slot) that this decision supersedes.

## Context

The version-5 pilot (ADR 0050) gave the narrator stored channel context plus curated Talabat
playbooks, with the web-evidence slot shipped empty and fail-closed because no live-search
transport was qualified. The user then ruled that this got the priority backwards: the curated
playbooks were a gimmick next to the real goal, which is narration grounded in live web knowledge
— the channel's own docs, merchant forums, and operator discussions first. The user gave full
consent for Google Search grounding (`google.tools.googleSearch`, `@ai-sdk/google` v2) on the
narration path, and directed that the rules be rewritten around it: the spec section 14 "no tools"
clause, the ADR 0037 "no tools and no retrieval" sentence, and the Google-grounding exclusion in
the market-research qualified provider (which stays scoped to that pipeline only).

## Decision

- Ground the narrator on pilot runs only. The provider takes `useGrounding`, decided by the worker
  from the run's detector keys; pilot runs call with
  `tools: { google_search: google.tools.googleSearch({}) }`, non-pilot runs omit `tools` entirely
  and keep today's call shape. Grounding is a tool the model may use, never a second prompt: the
  system rules still bind what it may claim and cite.
- Source priority: the channel's own docs, forums, and merchant discussions first, then other
  sources. Findings remain the only cited evidence; grounding never cites a web source.
- No links or sources shown: the model never emits a URL, link, domain, or anything shaped like
  one, in any field, and the output shape has no URL field, so a URL-carrying reply fails schema
  validation before it can reach storage.
- Medium credibility bar: this is recommendations-only narration and every action stays
  human-supervised. Portal and device how-to steps are allowed when grounding supports them,
  phrased as actions the operator performs in their own portal or tablet, never as claims about a
  menu path, button name, or portal structure.
- Playbooks removed, not kept as fallback: `channel-playbooks.ts` and its test are deleted, and
  playbook/web-evidence threading is gone from the worker and loader. A grounding failure falls
  back to the pre-pilot v4-shape generic prompt, with the existing fail paths and the
  `pilot_context_unavailable` warn log intact.
- Versions: narration prompt 5 to 6, judge 1 to 2 (grounding-backed portal how-to allowed; invented
  numbers, causes, savings, benchmarks, attribution, and confidence still flagged) in
  `src/domain/analysis/recommendations.ts`.
- No migration, no new env keys, no UI changes. Tenant scoping and the PII allowlist in the
  channel-context loader are untouched.

## Alternatives rejected

- Keep curated playbooks as fallback — rejected by the user as a gimmick next to the real goal;
  an ungrounded fallback already exists in the v4-shape prompt.
- Show links or sources — rejected; no sources UI ships in this pilot and the schema carries no
  URL field.
- High-bar treatment of grounded steps (forbid portal how-to) — rejected; the medium bar fits
  recommendations-only, human-supervised output, and the judge still flags invented values.
- Extend the grounding permission to the market-research pipeline — rejected; the qualified-provider
  exclusion stays scoped to that pipeline, which still runs fixtures-only until its own
  qualification lands.

## Consequences

- Pilot narration can give concrete, channel-specific steps backed by live knowledge while staying
  inside the same citation fence and the same max-6-items / max-5-supportedActions contract.
- The section 14 "no tools" rule now carries a narrow, user-consented pilot exception; the
  contract-proposal model and the scheduled judge keep the no-tools constraint.
- ADR 0050 remains the record of the version-5 design and why it was set aside, so the succession
  (stored context kept, playbooks deleted, empty slot replaced by live grounding) stays readable.
