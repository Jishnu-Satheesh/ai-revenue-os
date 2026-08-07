# Business Memory

## Purpose

Business Memory gives each organization durable context so the system does not repeatedly rediscover the same facts, mistakes, preferences, and outcomes.

## Memory layers

### Structured memory

Authoritative facts stored in relational tables: branch hours, budgets, menu items, goals, policies, integrations, and metrics.

### Episodic memory

Events, decisions, approvals, executions, failures, and outcomes ordered over time.

### Semantic memory

Documents, notes, call summaries, brand guidelines, and lessons available through retrieval.

### Procedural memory

Playbooks, worker versions, policy rules, and learned execution patterns.

## Memory item properties

- Organization and optional branch scope.
- Type.
- Source and provenance.
- Verification status.
- Confidence.
- Effective date.
- Expiry or review date.
- Sensitivity classification.
- Embedding reference when used.
- Superseded-by relation.

## Source hierarchy

When facts conflict, prefer:

1. Explicitly verified current user input.
2. Direct provider or system-of-record data.
3. Recent approved documents.
4. Historical imported data.
5. Model inference.

Inferences must never overwrite verified facts.

## Memory writing policy

Workers may propose new memory. Authoritative fact changes require deterministic validation and, for sensitive fields, human confirmation.

## Example lessons

- "Lunch combo promotion increased orders but reduced contribution margin below policy."
- "Arabic creative performed better for a branch-specific local campaign."
- "Client rejected late-night discounts because kitchen staffing is limited."
- "Marketplace item photo update improved conversion after seven days."

## Retrieval guardrails

- Filter by organization before semantic search.
- Prefer recent and verified items.
- Include provenance in the model context.
- Limit retrieved content to the minimum necessary.
- Do not retrieve sensitive customer-level data unless the worker is explicitly authorized.
