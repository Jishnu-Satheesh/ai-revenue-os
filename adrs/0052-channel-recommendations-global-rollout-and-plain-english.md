# ADR 0052: Channel recommendations roll out grounding and plain English to every audit section

## Status

Accepted. User-approved Amendment B (2026-09-09) to channel recommendations.
Implemented on `feat/governed-channel-intelligence` as narration prompt version 7 and judge
version 3. ADR 0051 stands as history: it records the Amendment A pilot (stored context plus
Google Search grounding on the three pilot detectors) that this decision widens to the
whole audit. ADR 0050 stands as the earlier history (the version-5 stored-context plus
curated-playbooks design).

## Context

Amendment A proved the treatment on two chapters: Cancellations Financial Impact and
Operating Availability Heatmap. The worker loaded stored channel context server-side, the
narrator grounded itself with Google Search (user-consented; the channel's own docs,
forums, and merchant discussions first), emitted no URLs, cited findings only, and every
action stayed human-supervised. The user verdict on 2026-09-09 was that those two chapters
look good, with two directives: write every recommendation in plain English a client who
may not be fluent reads fast ("projections" read as prose and expression, not as data
projection), and expand the Amendment A treatment from the three pilot detectors
(`orders.cancellation_loss`, `orders.cancellation_attribution`,
`operations.closed_share`) to all audit sections and chapters.

## Decision

- Global rollout: stored channel context plus Google Search grounding now apply to every
  run with findings, for any detector key. The 3-key pilot gate is retired; the detector
  set is kept as exported documentation of where the rollout started, and nothing reads
  it anymore. The worker passes `useGrounding` whenever findings exist; the provider call
  shape is unchanged.
- Plain English everywhere: narration prompt version 7 adds a global `PLAIN_RULES` block
  that renders on every run, with or without stored context — short common words a busy
  shop owner with basic English understands, one idea per sentence, most sentences under
  about 15 words, no idioms or figures of speech, the no-jargon rule kept and extended
  with a good/bad wording example, numbers as figures never spelled out. All version-6
  rules (channel-first lever, channel-sources-first grounding, no URLs, findings-only
  citations, 3–5 steps, human-supervised, portal checks-not-claims) are unchanged.
- The loader-failure fallback is unchanged in behavior and now described honestly: a run
  whose context fails to load renders the prompt without the channel block and without
  the grounding rules — the plain-English rule still renders, since it is global.
- Judge 2 to 3: the judge now also names heavy jargon, unexplained technical terms, or
  longwinded prose in its issues and reflects them in score, closing the loop on the new
  narrator rule with zero schema or migration change. Portal how-to steps remain allowed
  as grounding-backed advice; invented numbers, causes, savings, and confidence are still
  flagged.
- No migration, no new env keys, no UI changes, no URL emission. Tenant scoping and the
  PII allowlist in the channel-context loader are untouched.

## Alternatives rejected

- Keep the pilot gate and roll out chapter by chapter — rejected by the user; the two
  pilot chapters already read well and every other chapter has the same generic-narration
  problem the pilot solved.
- Enforce plain English by post-processing model output — rejected; a prompt rule the
  judge checks keeps one mechanism (prompt plus verdict) instead of adding a rewriter
  that could itself invent claims.
- Rename the `loadPilotContext` / `ChannelPilotContext` / `pilot_context_unavailable`
  symbols to rollout names — rejected for now; the names are rollout-wide in function
  but renaming touches the trigger seam and its tests for zero behavior gain. Comments
  now say what the code does; the rename is left as a future tidy.

## Consequences

- Every audit section narrates with the storefront named and live channel knowledge
  behind its steps, inside the same citation fence and the same max-6-items /
  max-5-supportedActions contract.
- The section 14 "no tools" rule now carries a user-consented narration-grounding
  exception for all runs with findings, not just pilot runs; the contract-proposal model
  and the scheduled judge keep the no-tools constraint.
- The succession (version-5 playbooks set aside in ADR 0050, pilot grounding in ADR 0051,
  global rollout plus plain English here) stays readable, so a future reader can see what
  was tried, what replaced it, and why.
