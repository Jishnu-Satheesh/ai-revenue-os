# ADR 0045: A statement whose periods are columns is read by rotating it once

- Status: Accepted
- Date: 2026-09-01
- Supersedes: none
- Related: ADR 0027 (the declaration language has no expressions), ADR 0028 (PDF is admitted only
  where the numbers are already text), ADR 0029 (grain is declared, never inferred)

## Context

Every provider export the pilot client sends is the same shape: one row per period, one column per
figure. The contract language, the validator, the projector, the control totals and the lineage all
assume it.

The client's accounting profit and loss is the transpose. One row per account, one column per month.
It is also the only document in the set that states what it costs to make the food — food cost,
packaging, and the marketplace commission the books actually recorded — which is the evidence the
money chapter has been saying it does not have since it was written.

All the information is there. It is rotated ninety degrees, and a reader that only knows the first
shape cannot follow it.

Two other properties of the file matter. It is a PDF, so its figures arrive as the text that was
printed — `1,234.56`, separators included — which the numeric parsers reject. And it repeats account
labels: `Total for Cost of Goods Sold` appears once covering food and packaging and again including
delivery commission, with different figures under each.

## Decision

**A contract sheet declares which way round it holds its records, and the reader rotates it once, on
the way in.**

`recordOrientation` is `rows` by default and `period_columns` when the periods are the column
headings. A rotated sheet also declares `periodHeaderRow`, because a column heading has no heading of
its own; the reader supplies the reserved header `report_period` so the contract can bind it like
any other field.

After the rotation, `headerRow` and `dataStartRow` mean exactly what they always meant, counted down
the rotated grid. Nothing downstream knows the difference.

**A label the statement uses twice is refused rather than resolved**, both at read time and at
recognition. **A number format is declared on the column**, exactly as a date encoding already is.

## Alternatives considered

**A second declaration language for transposed files.** Rejected. It doubles the surface that has to
stay honest — two validators, two projectors, two sets of control-total rules, two lineage paths —
to serve a difference that is one array transposition.

**Sniffing the orientation.** Rejected, and it is the same rejection ADR 0029 makes about grain. A
file whose shape is guessed is a file that can be silently reinterpreted when next month's export
changes. Declaring it means a file that no longer matches fails loudly.

**Sniffing the number format.** Rejected for a sharper reason. `1,234` is unambiguously one number
on an accounting statement and could just as easily be two badly split columns in a CSV. Guessing
which is exactly the silent reinterpretation the contract exists to prevent.

**Resolving a repeated label by taking the first, or by outline indentation.** Rejected. The first
match is a guess, and on the client's own statement the two candidates differ by the entire delivery
commission bill. Indentation would work on this generator and is a property of how one system draws
a PDF, not of what the document means.

**Adding arithmetic so the offline shop's own revenue could be derived.** Rejected, and this is the
boundary ADR 0027 draws. The statement books marketplace commission as a cost, so under accrual its
income line already contains those marketplaces' sales, and offline-only revenue would be the
income line minus the marketplaces. That is a subtraction. Admitting one subtraction to the
declaration language admits all of them.

## Consequences

The company's profit and loss is readable, and food cost, packaging cost and the books' own
marketplace commission are governed evidence for the first time.

The income line projects to `revenue.company_gross`, not `revenue.gross`. It already contains every
marketplace's sales, and filing it under the metric the cross-channel share is computed from would
make each marketplace look like a fraction of itself while the finding reported itself as complete.

This is a company-scope document on a channel-scoped path. The package hangs off a channel row that
names the books rather than the shop floor, because calling it the offline shop would be the lie.
Splitting offline trade from marketplace trade needs a source that states it, and this file does not.

Gross profit is stated on the statement and deliberately not bound: a money field must declare one
fixed sign, and gross profit is only positive while the business is profitable, so binding it would
mean a loss-making month failed the import. Recomputing the margin from the revenue and costs
carries no such trap. That a money column cannot declare "either sign" is a real gap in the contract
language, recorded here rather than worked around.

Only page one is read. Income, cost of goods sold and the commission lines are all on it; the
operating expenses run onto pages two and three and are not read yet.
