# ADR 0037: Recommendations ride a second fenced worker

## Status

Accepted. Extends section 11.4 of spec 018 and the fencing pattern of
ADR 0031 to the narration boundary. Records the user's choice of mechanism
for recommendation generation and the cap placed on it.

## Context

The Talabat vertical slice adds model-written recommendations over stored
findings. The user chose freely-written narration over a deterministic
trigger, having been shown the risk; two mechanical requirements survived
that choice — output must be schema-validated, and every recommendation must
cite the findings it used.

The open question was where generation runs. The detector run is
deterministic, fenced, and trusted; the model call is none of those things.
Coupling their failure modes would let a model outage destroy runs full of
verified numbers, which is the exact inversion of what this product exists
to do.

## Decision

### Narration is its own worker, chained after analysis

When `channel-analysis.run` completes, a second Trigger task,
`channel-recommendations.generate`, wakes up. It claims the completed run
through a security-definer RPC — the same lease, idempotency, and
service-role-only pattern the detector path uses — reads that run's findings
alone, and writes recommendations back through a completion RPC.

The bounded folder is deliberate: the model receives the run's findings,
their kinds, values, limitations, and citations. It receives no tools and no
retrieval. It cannot leak what it was never given.

### The database re-checks what a database can check

The completion RPC refuses any submission whose citations name findings of
another run, whose labels fall outside `observation`, `recommendation`, and
`needs_data`, whose count exceeds six, or whose prompt and output digests are
missing. Uncited claims bounce at the door; the page falls back to bare
findings, which section 11.4 already requires to be readable without
narration.

### Six per run

A window's findings number in single digits today, but nothing bounds them
forever. Six is enough for every live chapter to narrate with headroom, tight
enough that each entry must earn its place, and it bounds both the reader's
attention and the bill.

### Triage does not carry forward

A later run produces new recommendations that start untriaged. Prior
decisions stay attached to the older run's rows, append-only and readable —
a human's answer is never erased, and never silently re-applied to words
they did not see.

### Alternatives rejected

Running narration as a second phase inside the analysis worker couples the
model's failure mode onto the deterministic ledger. Generating on page load
makes first paint wait on a vendor and contradicts the approved design, which
weaves narration into the chapters. Carrying triage state forward by content
match would forge agreement between sentences that are not the same
sentences.

## Consequences

Every re-run costs one bounded model call, even for a two-day window someone
was poking at; the pilot flag keeps this to known organizations. The page can
show findings briefly before their narration arrives; that is the accepted
shape of independence, not a defect. Two workers now exist to operate, and
the silent-queue trap applies to both.
