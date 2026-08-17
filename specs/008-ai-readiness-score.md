# Feature Specification: AI Readiness Score

## Business outcome

Make onboarding blockers explicit and guide the fastest path to safe, measurable automation.

## Score dimensions

- Business profile completeness.
- Operational data quality.
- Menu or catalog quality.
- Historical performance data.
- Integration connectivity.
- Conversion and attribution tracking.
- Creative and brand assets.
- Customer consent and communication readiness.
- Budget and approval governance.
- Operational capacity.

## Scoring rules

- Score 0 to 100 overall and by capability.
- A high overall score must not imply every capability is ready.
- Critical blockers override averages.
- Each point must map to a concrete requirement.
- Scores are deterministic and explainable in V1.
- **Requirements carry explicit weights summing to 100**, rather than counting equally. Equal counting makes the denominator move whenever a requirement is added, so every client's score drops overnight for no change in their data — which is what happened when the cost structure requirement was registered. A weight makes the effect of adding a requirement a decision somebody made.
- **Capabilities name their requirements by id, never by list position.** Reading them positionally once reassigned outbound retention to whichever requirement landed on an index, silently breaking the consent gate below. A requirement list is edited often; its order is not a contract.

## Next actions

The next-action list is the operator-facing output of the score, so each entry carries what a person needs to act:

- The requirement's **label**, never its id. An identifier is a key, not a sentence.
- The **section** where the task is completed, so the entry links there.
- **Effort and owner**, in plain terms rather than as enum values.
- **Whether it blocks confirmation.**

Entries are ordered blockers first, then by the weight the score has most to gain from. An unordered list is not "highest-impact next setup actions".

Open work is visible from the section rail throughout onboarding — outstanding count, and how many sections hold a blocker — rather than only from the review section at the end.

## Output

- Overall score.
- Capability-specific readiness.
- Critical blockers.
- Highest-impact next setup actions.
- Estimated effort.
- Responsible person.

## Acceptance criteria

- User can see why every dimension received its score.
- Completing a requirement updates readiness.
- Missing consent blocks outbound retention capability.
- Missing conversion tracking blocks autonomous ad optimization.
- Readiness history is retained.
