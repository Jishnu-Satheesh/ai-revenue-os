# ADR 0032: An analysable window comes from a declared package, not from today

## Status

Accepted. Extends ADR 0031, which established that an analysis window is
supplied rather than inferred, by deciding where the supplied window comes from.

## Context

ADR 0031 settled that a detector is handed a window and never derives one:

> A window derived from the evidence that happens to exist can never report a
> gap at its own edges: three days of January would look like a complete
> three-day window rather than a January with 28 days missing.

It did not settle who supplies it. The first shipped workspace offered three
presets counted backwards from the current date -- thirty days, ninety days, and
a year -- which is the ordinary shape for a dashboard reading a live feed.

This platform has no live feed. Governed evidence arrives when an operator
uploads a provider export, and that export covers a period already past. The
first real evidence in staging is a Talabat report declaring 1 January to
28 February 2026, projected at day grain. Analysed on 23 August 2026, the three
presets computed 24 July to 22 August, 25 May to 22 August, and 23 August 2025
to 22 August 2026. The first two miss the evidence entirely. The third contains
it and asks for it at month grain, which the detectors refuse because ADR 0031
forbids resampling.

So all three presets returned nothing over evidence the operator had personally
uploaded and approved, and the platform's own copy told them no approved report
had written those days. The detectors were correct at every step. The window
control could not express the only question worth asking.

## Decision

### The offered windows are the windows governed packages declared

The workspace offers one choice per `integration_report_packages` row that
reached `projected` status for the channel, using its `declared_period_start`
and `declared_period_end`, its `period_timezone`, and the grain its projection
actually wrote into the ledger. The most recent is preselected.

An operator picks a window that is known to reach evidence, at a grain the
evidence is known to hold. The combination that produces a false "no evidence"
is not reachable by choosing wrongly, because it is not offered.

### The declared window, never the evidence extent

The window offered is what the package declared, not the span its surviving rows
occupy. For the Talabat package these differ: the declaration runs to 28 February
while the last day carrying a figure is 15 February.

Offering the extent would move both edges inward onto the first and last day that
happen to carry a figure, and a window cannot report a gap at its own edge. The
declared window reports 20 of 59 days present and 39 absent. The extent would
report 20 of 46 and understate the gap by thirteen days -- the precise failure
ADR 0031 refused, arriving through the picker instead of through the detector.

### A package with no current rows is not offered

A package whose projected rows have all been superseded or held for a decision
is dropped rather than listed. An offered window that resolves to nothing is a
worse dead end than the presets were, because the operator chose it deliberately.

### A channel with no governed evidence says so

Where a channel has no package to offer, the workspace states that no window
exists yet and why, and shows no run control. A disabled button cannot tell an
operator whether the platform is busy, broken, or waiting on them.

## Consequences

The set of analysable windows is now a function of what the organization
imported. That is the intended coupling: this product analyses governed
evidence, and a window containing none is not a question it can answer.

Arbitrary windows are no longer expressible. An operator who wants January alone
out of a January-February package cannot ask for it. That is a real loss and it
is accepted for now, because every window the picker can express is one the
platform can answer honestly, and the alternative on offer -- two date fields and
a grain selector -- reintroduces the same dead end as a self-inflicted one. A
custom control can be added later as a deliberate advanced path, with the
grain-mismatch refusal from this same change to catch it.

Two detector calculation versions moved with this decision, because the refusals
they emit had the same defect the presets did:

- `evidence.period_coverage` v2 distinguishes evidence that is absent from
  evidence recorded at another grain, and reports `EVIDENCE_AT_DIFFERENT_GRAIN`
  rather than describing a ledger full of days as an empty window.
- `revenue.period_movement` v2 names the rows it set aside and reports itself
  as partial, instead of refusing silently and looking like an empty window.

Findings written under v1 remain readable and are superseded by a later run in
the ordinary way, per ADR 0031.

Separately, the workspace now reads the findings of the one run it displays
rather than every open finding for the channel. Two runs over different windows
had put a header naming one window above a headline figure computed for another,
with two contradictory coverage answers in the same chapter. That is a defect
repair rather than a decision, and is recorded here only because it is what made
the window problem visible.
