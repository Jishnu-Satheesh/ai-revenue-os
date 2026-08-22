# ADR 0026: Use stable organization channels and governed declarative report contracts

## Status

Accepted on 2026-08-20 with `specs/018-governed-channel-intelligence.md`.

## Context

Real client onboarding exposed two boundaries that the original slices did not solve.

First, a channel is currently a text label in onboarding, normalized metrics, Channel Economics,
and cost rates. Text is enough for a demo but not for production identity: two organizations may use
entirely different channels, labels change, aliases collide, branches differ, and historical records
must survive renames and archival. Campaign channel actions are a separate concept because
Instagram/Facebook there represent verified executable capability.

Second, marketplace exports are structurally inconsistent. One provider may produce a multi-sheet
daily operational workbook; another may produce only an exact-range aggregate; the same provider
may add, remove, or rename sheets between periods. Hard-coded parsers for every observed workbook
will become brittle, while allowing a model to analyze and write arbitrary financial results would
make the system non-reproducible and unsafe.

The platform needs model judgment for schema interpretation but deterministic authority for
financial projection, reconciliation, findings, and tenant-scoped writes.

## Decision

### Stable business identity

Create organization-owned channel identities with immutable keys, editable names, industry-neutral
categories, optional templates, branch applicability, source aliases, and archive-without-delete
behavior. Add tenant-safe channel IDs to metrics, economics, and rates while preserving immutable
historical label snapshots during an additive migration.

A business channel remains distinct from:

- a provider/report source;
- an Integration Hub connection;
- a provider capability grant;
- a Campaign Channel Action.

Creating a channel grants none of those other things.

### Immutable report packages in private Storage

The browser uploads XLSX/CSV objects directly to organization-private Supabase Storage through
short-lived signed resumable upload tokens. Next.js issues and finalizes intent but never proxies
workbook bytes. Original files and compressed sheet-row artifacts stay in Storage; Postgres stores
bounded metadata, digests, status, lineage, revisions, approvals, and results.

Packages are immutable. Corrections create a superseding revision and a new object path. Hard limits
reject a package rather than truncating it.

### Digest-only structural header evidence

Version-2 package profiles store one candidate header row as SHA-256 digests of normalized header
identities, its row position, and its field count. They never store header text, raw workbook
values, or later data rows that merely look structurally similar. The fingerprint includes this
safe evidence and its version, so a version-1 profile cannot silently acquire version-2 approval.

Legacy bounded header-candidate arrays are redacted in place through a forward-only migration with
an identifier-only audit event. Their packages and approved contract history remain readable;
however, a new contract proposal must use a freshly profiled version-2 package. This preserves
history without retaining a value-bearing evidence surface.

### Governed declarative contracts

Each workbook schema receives a deterministic fingerprint. A known fingerprint may reuse an exact
approved binding only when declared channel/report/currency/outlet context and all deterministic
controls match.

For an unknown or drifted fingerprint, an isolated model with no tools or writes may propose a
versioned declarative contract. The contract can use only checked-in transforms and contains no
generated code, SQL, arbitrary expression, file access, or network access. Zod and registry checks
validate it before it becomes reviewable.

An owner/admin decision binds the exact version, fingerprint, mapping digest, currency and sign
semantics, control totals, and unmapped-field disposition. Any material change creates a new version
and requires a new decision.

Workbook content is untrusted data. Model access is allowed only through an approved privacy route
and organization policy; otherwise inputs are minimized or processing fails closed.

### Deterministic projection and analysis

Trigger.dev orchestrates idempotent stages but Postgres owns package and operation state. Workers
mutate through tenant-validating, claim-fenced RPCs.

Approved contracts project to:

- existing period-grain normalized metrics;
- a separate append-only exact-range ledger for arbitrary-range aggregates;
- revised Channel Economics entries and components with stable channel IDs and source lineage.

Exact-range evidence is never prorated or overlap-summed. Corrections create revisions; duplicates
replay without new evidence; ambiguous overlaps fail closed.

Versioned deterministic detectors create authoritative findings. A model may only produce cited
plain-language explanations and bounded recommendations over those findings. It cannot compute or
alter metrics, margins, causes, savings, confidence, or benchmarks, and it has no execution action.

## Alternatives considered

### Keep channel names as text

Rejected. It cannot safely model aliases, renames, branches, archive behavior, provider mappings, or
cross-table identity, and every downstream join would repeat fuzzy normalization.

### One hard-coded parser per provider workbook

Rejected as the sole strategy. Approved contracts may eventually be promoted into checked-in
templates, but provider exports drift by report family and period. A code deploy for every header
change produces slow onboarding and encourages silent coercion.

### Let a data-analyst agent read a workbook and write its report directly

Rejected. A model-authored financial result cannot be reproduced, reconciled, revised safely, or
protected from indirect prompt injection. It would also make one unrestricted agent the data,
analysis, and execution authority.

### Generate executable parser code or SQL from the workbook

Rejected. Sandboxing generated code would still leave a much larger attack and correctness surface
than a small declarative language, and business-critical policy would be hidden in generated logic.

### Store workbook rows as JSONB in Postgres

Rejected. Raw order/customer rows would expand the RLS, backup, logging, retention, and query-cost
surface. Private Storage artifacts plus bounded relational metadata preserve evidence without making
raw payloads generally queryable.

### Force arbitrary-range reports into daily metrics

Rejected. Proration invents time-series evidence the provider did not report. A separate exact-range
ledger makes the limitation structural.

### Use Gemini Google Search grounding for a benchmark database

Rejected. Current terms prohibit collecting grounded links to build an index or drive crawling, and
grounded requests have mandatory retention. Release 2 uses a provider-neutral research port with an
adapter whose public-content and crawl-failure behavior fits persistent, approved evidence.

## Consequences

### Positive

- New industries and organizations can create arbitrary channels without changing core code.
- First-time schema interpretation benefits from model judgment while repeat imports stay
  deterministic and cheap to verify.
- Financial results are reproducible, revisioned, reconciled, and traceable to approved semantics.
- Prompt-injection impact is bounded because workbook-reading models have no tools or writes.
- Exact-range limitations, partial evidence, schema drift, and disagreements remain visible.
- The same canonical projection and detector contracts can later accept read-only provider APIs.

### Costs and trade-offs

- The feature introduces several governed records, a small transform language, Storage lifecycle
  operations, and a larger test matrix.
- First use of every new fingerprint pauses for owner/admin approval.
- Provider support cannot be claimed from documentation alone; redacted real fixtures are required.
- Cell-level lineage and immutable revisions increase metadata volume.
- Some analyses remain `needs_data`, especially item profit and incremental promotion ROI.
- Full-workbook model access requires continuing vendor privacy review and may be unavailable for an
  opted-out organization.

### Operational consequences

- Migrations are additive and forward-only on hosted staging.
- Every tenant relation uses composite organization foreign keys and forced RLS.
- New public tables and functions use explicit least-privilege grants; no Data API exposure is
  assumed. Worker-only security-definer functions stay in a non-exposed schema with an empty search
  path and default execution revoked.
- Every new PL/pgSQL function must be invoked once on staging after migration.
- Feature flags can stop new upload, projection, narration, and benchmark work without deleting
  packages or evidence.
- The existing Channel Economics, metric, Integration Hub, onboarding, permission, architecture,
  and AI-boundary documentation must be updated in the implementation change.

## References

- `specs/018-governed-channel-intelligence.md`
- `specs/003-integration-hub.md`
- `specs/012-channel-economics-ledger.md`
- `specs/015-metric-registry-and-normalized-metrics.md`
- ADRs 0002, 0003, 0006, 0007, 0009, and 0023
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)
- [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [OWASP prompt injection](https://genai.owasp.org/llmrisk2023-24/llm01-24-prompt-injection/)
- [NIST agent-hijacking research](https://www.nist.gov/blogs/caisi-research-blog/insights-ai-agent-security-large-scale-red-teaming-competition)
- [Exa crawler policy](https://crawler.exa.ai/)
- [Gemini API terms](https://ai.google.dev/gemini-api/terms)
