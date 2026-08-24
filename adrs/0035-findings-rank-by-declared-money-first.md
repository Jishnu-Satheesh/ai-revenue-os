# ADR 0035: Findings rank by declared money first

## Status

Accepted. Extends ADR 0031, which made monetary impact a declared property of
each detector, with an explicit ordering rule for the workspace.

## Context

The approved narrative workspace presents analysis as numbered chapters
ordered by what each problem cost. Nothing defined that order. Whatever the
read model happened to emit was the order, and with the registry growing past
the first four detectors, an ordering nobody wrote down cannot be reproduced,
questioned, or corrected.

ADR 0031 requires every detector to declare whether monetary impact is
computable and by what exact method. When it was written, exactly one detector
declared a method. The cancellation detector now declares a second. Those
declarations are what make a cost-led ordering possible — and they mark just
as plainly which findings have no money to sort by.

## Decision

### The ordering rule

Workspace ordering is deterministic and stated once:

- Findings with a declared computable monetary impact rank first, by amount
  descending.
- Findings without one rank by kind: `finding`, then `observation`, then
  `needs_data`.
- Then by severity, descending weight: danger above warning above neutral
  above none.
- Then by priority ascending, nulls last.
- Detector key ascending breaks any remaining tie.

Every input is a stored field, so the order is reproducible from the records
alone: anyone can recompute it, and a changed order means something changed in
the evidence.

### Monetary impact remains declared, not assumed

Two detectors declare computable methods today. `revenue.period_movement`
declares the movement itself in integer minor units, as ADR 0031 records.
`orders.cancellation_loss` declares the provider's own reported rejection loss
summed over the window — Talabat prints a revenue-loss-from-rejections figure,
which is a measurement the provider made, not a model.

Everything else declares none. Availability (`operations.closed_share`) and
retention (`customer.new_share`) refuse a monetary figure because the export
states none: there is no money printed for a closed hour or for a customer who
did not return. Inferring one requires a conversion rate and an average order
value applied to hours nobody traded, which would fabricate a figure and place
it at the top of the page.

### Ordering purely editorially was rejected

Ordering the chapters by hand ignores the intent the product exists to serve —
measurable gross profit protected or created — and it cannot be reproduced or
audited. An editor's eye is not a stored field.

### Ordering by money alone was rejected

Most findings declare no monetary impact, so a pure money sort leaves most of
the page unordered or pushes it off arbitrarily. The rule has to total-order
everything that can be stored, which is why the kind, severity, priority, and
key fallbacks exist.

## Consequences

Chapter order shifts between runs as amounts change. That is intended: the
order is a function of the stored findings of the run on screen, and it stays
stable for that run's digest even when the page is re-read months later.

Findings with equal amounts, or with none, fall through the fallback chain to
a deterministic position, so two readers never see two different pages over
the same run.

Every new detector must state its monetary-impact declaration either way — the
registry contract already requires the field — so the boundary between
"ranks by money" and "ranks by the fallbacks" stays explicit as the catalogue
grows.
