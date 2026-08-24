# ADR 0033: Free-range windows shaded by evidence density

## Status

Approved. Supersedes ADR 0032, whose declared-package-only window picker this
decision reverses. User-approved on 2026-08-23 alongside the refined Data-Ink
Maximal Narrative Superdesign draft for the channel workspace.

## Context

ADR 0032 replaced presets counted backwards from today with one choice per
declared package, because all three presets returned nothing over evidence the
operator had personally uploaded and approved. It worked, and its own
consequences named the price: arbitrary windows stopped being expressible. An
operator who wants January alone out of a January–February package cannot ask
for it, and an operator who wants a range spanning two packages cannot ask for
that either.

The restriction existed to prevent one failure: choosing a window over data
nobody imported and being told there is no evidence. But whether a day carries
governed evidence is known before any run starts — `evidence.period_coverage`
has distinguished absent days from days recorded at another grain since its
version-2 repair in ADR 0032. That fact can be shown on the control itself
while the operator is choosing, which protects against the failure without
shrinking the set of questions the platform will answer. Honesty became a
property of the page instead of a property of the menu.

The refined workspace draft approved on 2026-08-23 draws exactly this control:
a calendar in which every day is shaded by how much governed evidence it
carries.

## Decision

### The window control is a free-range calendar

The channel workspace offers a calendar on which any start and end date can be
chosen. The grain is derived from the length of the chosen range and is never
a second control: a range of thirty-one days or fewer analyses at day grain, a
range of six months or fewer at week grain, and anything longer at month
grain.

A grain selector was rejected deliberately. It would reintroduce, as a
self-inflicted choice, exactly the mismatch refusal the version-2 detector
repairs in ADR 0032 were written to describe honestly. Deriving the grain
removes the wrong answer instead of explaining it after the fact.

### Every calendar day is shaded by evidence density

Each calendar day carries a shade from the chart ramp recorded in
`.superdesign/init/theme.md` — `chart-1` through `chart-5`, five emerald
shades light to dark — according to how much current governed evidence that
day holds for the channel and branch. A month the operator imported reads as
full before anything runs; the blank stretch of February reads as blank.

This solves visually the problem ADR 0032 solved by restricting choice. The
operator sees where evidence lives while choosing, so the combination "window
over nothing" is no longer prevented; it is simply visible.

### A zero-evidence range stays runnable, and coverage states itself

An empty range is not refused. Zero-evidence windows remain runnable, and the
page must state coverage honestly when they are — which the shipped coverage
detector already does, distinguishing days with no rows from days recorded at
another grain and naming the difference rather than describing a ledger full
of days as an empty window.

### Keeping the declared-package picker was rejected

Offering the picker alongside a custom option was considered and rejected. A
package picker cannot express a sub-range of a package or a range spanning two
packages, and every special case added to it — presets, custom fields,
per-package grains — grows toward a calendar with fewer affordances and more
explanations. The picker answered "which windows are safe?" at the level of
the menu; the calendar answers it at a glance, for every window at once.

## Consequences

ADR 0032's declared-package-only picker is reversed. Its underlying concern
survives as two properties of the new control: shading shows where evidence
lives before a run starts, and the coverage statement reports gaps honestly
after it runs, including at the window's own edges — a window ending on days
that carry no rows still reports those days absent, which is why ADR 0032
offered the declared range rather than the occupied extent.

The calendar needs per-day evidence density from the read path, and that read
does not exist today: the workspace read model returns the findings of one
run, not per-day counts of current governed rows. Supplying it is part of this
slice, computed server-side and scoped to the channel and branch like every
other read, so RLS decides visibility.

Windows over partial evidence become ordinary instead of unreachable. The
detectors already report partiality in their own words —
`revenue.period_movement` v2 names the rows it set aside and marks itself
partial — so a question asked over a gap produces an answer that says so,
which is this product's purpose.
