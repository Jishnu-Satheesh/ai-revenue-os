# ADR 0034: Reason codes are metric-row dimensions

## Status

Accepted. Extends the projection declaration language of ADR 0027 — as
ADR 0029 and ADR 0030 did before it — and decides where provider categorical
labels are stored.

## Context

Providers attach categorical labels to numeric facts, and often the label is
the interesting part. In the first real Talabat package the outlet was closed
on 39 days marked `CHECK_IN_REQUIRED` and 20 marked `UNREACHABLE`, and every
cancelled order carried a reason such as `ITEM_UNAVAILABLE`: text beside
numbers, one row per day. The projection writes numeric `normalized_metrics`
rows and had no shape for a category, so every reason breakdown the approved
workspace design shows as a proportional bar was unbuildable.

Three storage shapes were weighed.

## Decision

### A label is a dimension value on the numeric row

A categorical output writes the same kind of additive count the projection
already writes, with the label carried as a value of a dimension in the
`dimensions` jsonb column `normalized_metrics` already has. The count stays
one number; grouping it by reason is a read-time concern, not a storage one.

### The allowed vocabulary is declared, and an unknown label refuses the import

The permitted values live in the approved projection declaration as
`categorical.allowedValues`, so an owner or admin approves the exact
vocabulary alongside the rest of the contract. A row carrying a label outside
the declared set refuses the import rather than becoming an undefined "other".

That refusal is the point. An implicit "other" bucket absorbs precisely the
days on which a provider changes or extends its vocabulary, and it does so
silently: the import succeeds, the breakdown quietly rots, and nothing marks
the day the meaning drifted. Refusing turns that drift into a new contract
version and a human decision.

### Counted metrics per label were rejected

One metric definition per reason code hardens the provider's vocabulary into
platform schema. Every label a provider introduces becomes a migration and a
registry entry, and cross-provider vocabularies multiply near-duplicate
definitions — Talabat's `CHECK_IN_REQUIRED` and Keeta's equivalent would each
want their own metric. The vocabulary belongs to the data, not to the schema.

### A separate categorical ledger was rejected

It is the heaviest option for what is already an additive count: a new
tenant-scoped table, RLS policies, fenced security-definer completion RPCs,
lineage binding, and reconciliation rules, all duplicating machinery the
metrics ledger already has, to store a number that differs from an ordinary
observation only by a string beside it.

### Aggregation and replay identity

Because labels ride on ordinary numeric rows, aggregation stays a plain SUM
grouped by dimension value. Uniqueness and replay identity include the
dimensions, so replaying the same day and label stays idempotent, and two
different labels on the same day neither collide nor double-count.

## Consequences

Cross-provider reason vocabularies coexist as data. Detectors group by
dimension value with no registry change, and a provider renaming or adding
labels means a new approved contract version — the same ceremony as any other
mapping change — rather than a schema migration.

Dimension values are stored as bounded source snapshots, not platform enums:
they record what the provider wrote, not a platform-controlled classification.
Nothing downstream should switch behaviour on a specific label; a detector
that must treat one specially declares that in its own versioned calculation.
