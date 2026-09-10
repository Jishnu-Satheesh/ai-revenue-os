# ADR 0054: Shared Business Memory context with governed automatic capture

## Status

Proposed — implementation approval pending. The product direction of automatic capture with distinct trust levels is confirmed; the contracts and delivery plan in Spec 023 remain draft.

## Context

Business Memory already has a governed store, retrieval and operator workspace. Its cross-feature integration is narrow: Campaign subject descriptions consult it, and an integration projector writes provider records. Channel recommendations and Growth research/synthesis build separate context; their outputs and operator decisions do not enter a common learning loop. Campaign learning submission records a local decision but does not promote anything to memory.

The general domain event publisher only logs. Depending on it for capture would lose the link between committed source changes and memory updates. Existing rules also exclude unconfirmed internal AI writes, correctly preventing inference from becoming organizational truth but leaving no explicit contract for automatically recording the fact that advice was generated.

Google Search grounded Channel answers introduce a separate source-use boundary. Existing narrative storage does not establish permission for automatic cross-feature learning from those answers. Research evidence and vendor alternatives are documented in the linked report.

## Proposed decision

1. Extend the existing Postgres memory module. Authoritative facts, current configuration, metrics, evidence and execution stay in their owning modules. The context service combines current read-through state with relevant persisted episodes and reviewed lessons.
2. Add a versioned purpose-specific context port. Every enabled consumer receives a bounded pack with typed sources, scope, validity, statement kind and trust; it records the pack manifest and validates output references against it.
3. Capture source revisions transactionally with their owning business mutations. A Postgres queue and idempotent leased projection provide eventual memory updates. Trigger.dev transports identifiers; neither logs nor Trigger run state is the business authority.
4. Automatic capture records observations, recommendations, operator decisions, Campaign lifecycle and outcomes at their original trust. Add a narrow service-only exception for internal, unverified AI source projections. Generic model proposals remain proposed; arbitrary AI memory writes remain forbidden.
5. Separate contextual reuse from artifact promotion. Remembering an operator's plan or a Campaign's inconclusive outcome does not establish effectiveness. Submitted reusable lessons require separate review and valid evidence. No memory operation changes live policy, ranking weights, prompts, playbooks or brand rules.
6. Preserve source-root ancestry and revision/liveness checks. Repetition of the same claim is not independent corroboration. Withdrawn or rights-expired roots cannot survive through child memories, context snapshots or embeddings.
7. Use non-grounded Channel narration when shared private context is enabled, over current findings and qualified reusable sources. Keep the prior path when disabled, without new private context. Do not automatically reuse historical grounded text or send private memory into public queries.
8. Keep personal UI preferences actor-scoped. Organization decisions may be shared as intent, but acknowledgement, planning, helpfulness and completion remain separate meanings.
9. Deliver the Channel loop first, Growth second and Campaign third, with source capture, reads, provenance, failure behavior and acceptance in every release. Defer external memory vendors, graph infrastructure and Redis until measured need.

## Alternatives considered

- **Source-only federation:** useful for fresh authoritative state, insufficient alone for durable episodes and reviewable cross-feature learning. Included as one part of context assembly.
- **External managed memory or temporal graph:** potentially useful at scale; currently introduces another processor and policy translation while leaving capture, source rights and tenant authorization unsolved.
- **Store every AI answer:** rejected because it amplifies unsupported claims, repeats roots as evidence, retains obsolete content and bypasses source-use restrictions.
- **Best-effort event callbacks:** rejected because a committed source mutation can lose its contribution before a callback executes.

## Consequences

The shared context becomes explainable and reusable across independent features, with visible source ownership. It adds queue operations, source adapters, typed associations, retention propagation and context manifests. The capture queue is eventually consistent; live read-through for active intent and source liveness makes that delay explicit and bounded.

The memory-enabled Channel path loses implicit Google-grounded portal guidance unless a reusable qualified source supplies it. It retains finding-supported advice and gains organizational context. This tradeoff must be approved explicitly rather than hidden inside prompt wiring.

Automatic capture does not mean automatic belief. Existing trust ordering remains, supplemented by statement kinds and deterministic source eligibility. Human confirmation cannot convert an inconclusive result into causal evidence.

## Supersession boundary

If accepted, this ADR narrowly amends Spec 004's restriction on unconfirmed internal AI writes for validated source projections, and ADRs 0019/0044's local-learning language to allow scoped episodes while retaining lesson promotion gates. It introduces a conditional alternative to the Google-grounded path of ADRs 0051/0052. It does not replace ADR 0011 fact ownership, ADR 0012 cache visibility, ADR 0013 artifact gates or ADR 0053 coverage/gap-fill requirements.

No amendment takes effect while this ADR is Proposed.

## References

- [Spec 023](../specs/023-business-memory-shared-intelligence.md)
- [Research and evidence](../docs/research/2026-09-10-business-memory-shared-intelligence.md)
- [Implementation plan](../docs/superpowers/plans/2026-09-10-business-memory-shared-intelligence.md)
- [Spec 004](../specs/004-business-memory.md), [Spec 016](../specs/016-campaign-feedback-loop.md), [Spec 018](../specs/018-governed-channel-intelligence.md), [Spec 022](../specs/022-growth-intelligence.md)
