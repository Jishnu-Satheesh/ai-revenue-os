# ADR 0036: Ragged rows are a declared contract capability

## Status

Accepted. Extends the report-contract language of ADR 0027 with ragged-row
realignment, decimal-parser bindings for count metrics, and categorical
outputs, decided together because the first real Talabat slice needed all
three at once.

## Context

The Talabat performance sheet is not rectangular. 59 data rows sit under 56
headers, but populated cells reach column 58. On 11 of the 59 rows the
provider appends a second unavailability reason mid-row, injecting two extra
values that push later cells right by two from column 22. Read positionally,
those rows corrupt silently: average preparation time reads as 1 instead of
roughly 9, and reason strings land in numeric fields.

The two columns bound so far happen to sit before the shifted zone, so the
current projection is correct by luck rather than by design. A one-off script
could repair this file; the next export will not match.

Two smaller shape mismatches surfaced in the same slice. Providers measure
continuous quantities in fractions — closed minutes arrive as 355.6 — and the
count parser had no way to keep them exact. And the categorical labels ADR 0034
decided to store needed a writer.

## Decision

### Ragged realignment is declared, not hardcoded

A sheet rule may declare `raggedRows.injectedFromColumnIndex`. A row is ragged
when it reaches further right than the header row; the overflow is read off
the row itself, and headers before the declared index never move. Detection is
mechanical — compare the row's extent to the header's — so a ragged row is a
fact the validator can observe rather than a guess the projector makes.

Declaring the capability in the contract keeps the repair where every other
reading decision lives: a differently shaped future file needs a new approved
declaration, not new code, and the eleven-row Talabat fixture becomes a
regression test that fails loudly if realignment ever stops working.

### Count metrics may bind decimal-parser columns

A projection output may bind a decimal-parsed column to a count metric
definition. Values accumulate through exact fixed-point addition and never
through floating point, whose rounding makes a total depend on the order its
rows were added in. Closed minutes of 355.6 are measured time; the sum of them
must stay measured too.

### Categorical outputs count occurrences per declared label

A categorical output counts occurrences of each declared allowed label into
observations tagged with that label as a dimension value, per ADR 0034. The
vocabulary is the one the owner or admin approved; anything else refused the
import there and needs no second refusal here.

### Hardcoding the shift was rejected

Baking "shift by two from column twenty-two" into a script fixes this file and
corrupts the next one silently — a third injected reason, a different column,
or a clean file would each produce confident nonsense with nothing failing.
Silent corruption is the one failure mode this pipeline exists to prevent.

### Rounding decimals to integers was rejected

Truncating 355.6 closed minutes to 356 or 355 fabricates time the provider
measured and misstates every share computed from it. Exactness is cheap here;
honesty is not negotiable.

### Mean-of-daily-averages was rejected for preparation time

Preparation time is stored, where it is stored at all, as a sum. Averaging the
daily averages weights a short day equally with a long one and yields a
meaningless number. Preparation time deliberately stays unprojected until a
detector declares a method for it — its column also sits inside the shifted
zone on ragged rows, so reading it before realignment existed would have been
wrong twice.

## Consequences

The contract language grows by three capabilities, each flowing through the
approval flow it already had: declaring or changing one is a new contract
version and an owner/admin decision, never a deploy.

Validation gains a typed observation for rows reaching past the header extent,
so a ragged shape the contract did not anticipate surfaces as a named result
instead of as shifted numbers.

Future files whose raggedness differs need only another approved declaration.
The projector gains no per-provider knowledge, which is the property that has
kept the rest of the pipeline provider-neutral.
