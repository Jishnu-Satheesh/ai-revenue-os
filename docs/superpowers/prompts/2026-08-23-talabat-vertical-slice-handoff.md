# Handoff brief — Governed Channel Intelligence, Talabat vertical slice

You are picking up work on branch `feat/governed-channel-intelligence` in the git worktree at
`/home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence`. Run everything from
there. Do **not** `cd` to the main checkout.

Read `AGENTS.md` (symlinked as `CLAUDE.md`) first — it is the binding instruction contract and it
overrides your defaults. This brief supplements it; it does not replace it.

An approved Superdesign draft exists and is the visual target:
**Refined talabat Data-Ink Maximal Audit** — https://p.superdesign.dev/draft/206359c7-7e53-44b8-b8ba-3bbe47607e0c
Project canvas: https://superdesign.dev/teams/c3d56832-bb79-49b6-910a-6450fc30e0a4/projects/4824afb0-94ad-432f-9ea4-eb7a1987bafe

---

## 1. What this is, in one paragraph

AI Revenue OS is a multi-tenant agency platform that audits restaurant marketplace performance.
An operator uploads a provider export (Talabat, Keeta, noon, EatEasily), it passes through a
governed pipeline, and a channel workspace tells the restaurant the truth about their own evidence.
The page you are rebuilding is that workspace. Today it renders four detectors over **two** metrics
and looks barren; the source file holds **56 columns**. Your job is to make the page say what the
file actually knows, and to make it look like the approved draft.

---

## 2. The single most important thing: the export is ragged

**This will silently corrupt 19% of the data if you miss it.**

`fixtures/raw/Talabat-Jan-Feb-2026-Performance-Report.xlsx` — one sheet, 59 data rows, 56 header
cells, but `columnCount = 58`. Columns 57 and 58 have **no header**.

Row shapes across the file (verified):

| Rows | Shape |
|---|---|
| 41 | `lastCol=56`, one reason string at col 22 — **aligned** |
| 7 | `lastCol=56`, reasons at cols 22 and 27 — **aligned** |
| 9 | `lastCol=58`, reasons at cols 22 and 23 — **shifted +2 from col 23** |
| 2 | `lastCol=58`, reasons at cols 22, 23, 29 — **shifted +2 from col 23** |

On the 11 shifted rows, a day carries a **second unavailability reason**, which injects two extra
values at columns 23–24 and pushes headers 23–56 onto data columns 25–58.

Consequence if you bind positionally: on those 11 days "Average preparation time" reads `1` instead
of `9.025`, and reason strings land in numeric fields. The two columns bound today (4 = Successful
Orders, 5 = Gross Sales) sit *before* the ragged zone, which is why the current projection is
correct **by luck, not by design**.

Working realignment rule (verified against every row):

```
shift = (last populated column === 58) ? 2 : 0
dataColumn(headerIndex) = headerIndex <= 22 ? headerIndex : headerIndex + shift
```

Do not hardcode that rule into a one-off script and move on. The report contract layer needs a way
to express "this row is ragged, realign it" — that is a genuine design problem and part of your
scope. Decide it deliberately and write it down.

---

## 3. Verified real numbers (use these; do not invent)

Talabat, single outlet "Nostaza Restaurant, Al Warqa 1", 1 Jan – 28 Feb 2026, AED, Asia/Dubai.
59 declared days, **20 carrying evidence, 39 absent**.

**Funnel**
```
Impressions      18,294
Viewed menu         949    5.2% of impressions
Added to cart        59    6.2% of views
Placed an order      24   40.7% of carts      end-to-end 0.13%
```

**Operations**
- Closed **48.3%** of scheduled hours — 34,217 of 70,799 minutes.
  Reasons: `CHECK_IN_REQUIRED` 39 days, `UNREACHABLE` 20 days.
- **10 of 26 orders cancelled (38%)**, every one `ITEM_UNAVAILABLE`.
- **AED 357** lost to rejections against **AED 553** earned.
- Average preparation time **12.0 min** over 15 days.
- Items 36. Delivery orders 16, pickup 0. Online AED 450, cash AED 103.

**Customer mix** — 25 new-customer orders, **1 returning**.

Cross-checks that must continue to hold (use them as tests):
- new 25 + returning 1 = 26 = Orders count
- cancelled 10 = avoidable cancellations 10
- gross AED 553 = the 55,300 fils already in `normalized_metrics`
- "Placed an order" 24 ≈ Orders count 26

Five days genuinely traded **zero** — `2026-01-11, 01-22, 01-23, 01-29, 02-03`. A zero is not a gap.
Any code or copy that conflates them is wrong.

---

## 4. You cannot hardcode numbers into the page

The workspace renders `channel_findings` rows written by a fenced worker. There is a governed
pipeline and every figure must come through it:

```
upload → profile → contract proposal → owner approval → validation → projection
      → normalized_metrics (the ledger) → detectors → channel_findings → workspace
```

To make a new number appear on the page you must: bind its column in the **report contract**, add a
**projection output** mapping it to a **metric definition**, ensure that metric key exists, then
write or extend a **detector** that reads it and emits a finding citing the ledger rows it used.
Putting a literal into a React component is the one failure mode that makes this whole product
pointless.

---

## 5. What already exists — do not rebuild

- **Four detectors** in `src/domain/analysis/detectors/`:
  `evidence.period_coverage` (**calculationVersion 2**), `evidence.reconciliation_blocked` (**v1**),
  `revenue.period_movement` (**v2**), `revenue.channel_share` (**v1**).
- **Registry** `src/domain/analysis/registry.ts` — binds detectors by scope and grain.
- **Evidence selection** `src/domain/analysis/evidence.ts` — `selectComparablePoints` returns
  `accepted`, `setAsideCount`, a per-reason `setAside` breakdown, and `setAsideGrains`.
- **Worker** `src/workflows/analysis/run-channel-analysis.ts`, dispatched by Trigger task
  `channel-analysis.run` in `src/trigger/analysis.ts`.
- **Three security-definer RPCs** — `claim_channel_analysis`, `complete_channel_analysis`,
  `fail_channel_analysis`, granted to `service_role` only. The database re-checks every claim: the
  detector version against what the run bound, the metric against what it resolved, the period
  against the declared window, the finding's channel against the run's scope, and every citation
  against its reconciliation state. **The worker is not the authority.**
- **Workspace** `src/components/analysis/channel-workspace.tsx` + read model
  `src/modules/analysis/application/read-model.ts` + read repo
  `src/modules/analysis/infrastructure/read-repository.ts`.
- **POST route** `/api/organizations/{organizationId}/channels/{channelId}/analysis`, body
  `{ windowStart, windowEnd, periodGrain, branchId }`, gated on `report.retry`.
- **Feature flag** `GOVERNED_CHANNEL_ANALYSIS_ORGANIZATION_IDS`, already set in `.env.local`.
- **Provider contracts** `src/domain/reports/provider-library/` — `talabat-performance.ts` is the
  one you extend.

**Nothing is committed.** 62 files are changed or untracked on top of `9c5f65d`. The whole analysis
slice is uncommitted work in progress.

---

## 6. Metric vocabulary — the blocker is smaller than the code claims

`talabat-performance.ts` says *"none of them has a metric definition to land in yet."* That is
**stale**. There are 20 metric definitions seeded platform-wide (`metric_definitions` with
`organization_id IS NULL`), and these map directly onto columns in this file:

`listing.impressions`, `listing.conversion_rate`, `customer.repeat_rate`,
`order.cancellation_rate`, `kitchen.preparation_time`, `units.count`, `order.average_value`,
`revenue.gross`, `transactions.count`, `menu_item.stockout_rate`.

Genuine gaps needing **new** metric definitions: funnel middle stages (menu views, add-to-cart),
availability minutes and scheduled minutes, new-customer order counts, channel mix
(online/cash/delivery/pickup), AWT. Fix the stale comment when you extend the contract.

---

## 7. Reason codes are an unsolved design problem

`CHECK_IN_REQUIRED`, `UNREACHABLE`, `ITEM_UNAVAILABLE` are **categorical evidence**. The projection
writes numeric `normalized_metrics` rows and has no shape for a category. The approved design shows
reason-code breakdowns as proportional bars, so this must be solved, not skipped. Options worth
weighing: a dimension on the metric row (`dimensions` jsonb already exists on `normalized_metrics`),
a separate categorical ledger, or a counted metric per reason code. Pick one, justify it, ADR it.

---

## 8. Ranking by cost needs monetary impact per finding — read this carefully

The approved design orders chapters by **what each problem cost**. Today ADR 0031 declares monetary
impact computable for **exactly one detector** (`revenue.period_movement`), and its method is the
movement itself in integer minor units.

For the ranking to work you must declare a monetary-impact method for the new detectors. Note the
distinction that matters:

- **Cancellations — defensible.** Talabat *reports* "Revenue loss from rejections" (AED 357). That
  is a measured figure from the provider, not a model. Declare the method as "the provider's own
  reported loss figure, summed over the window."
- **Availability and retention — not defensible as money.** The file states no monetary value for
  closed hours or for a non-returning customer. Inferring one needs a conversion rate and an
  average order value applied to hours nobody traded. Do **not** fabricate it.

So the ordering rule cannot be "money lost" alone. Define it explicitly — e.g. findings *with* a
declared monetary impact rank first by that amount, then findings without rank by a stated
secondary rule. Whatever you choose, write it down; it is a durable decision.

Also note: the Direction 2 draft shows a waterfall with **"AED 910 reachable revenue"** (553 + 357).
That label is an inference the file does not state. Relabel it to something the evidence supports
before shipping.

---

## 9. Governing decisions

`adrs/0031-the-first-shipped-detector-slice.md` — read it in full. Load-bearing rules:
- **Never resample across grains.** A day is not a fraction of a month. `selectComparablePoints`
  filters on exact grain; a mismatch is `needs_data`, never a converted figure.
- **Severity only on `kind = 'finding'`**, enforced by a check constraint *and* by the completion
  RPC. Three of four detectors emit observations because no defensible threshold has been agreed.
  Do not invent one.
- **A finding may cite only current evidence** — `reconciliation_state = 'current'`, not superseded.
  Checked at write time.
- **Monetary impact is declared, not assumed** — each declaration states whether it is computable
  and by what exact method. Nothing extrapolated, modelled, or annualised.
- **The evidence contract refuses rather than reconciles** — two currencies are refused, never
  converted. Mixed grains, timezones, branches, channels are refused the same way.
- A run names **one channel or none**; detectors declare a `scope` and the registry binds by it.

`adrs/0032-analysable-windows-come-from-declared-packages.md` — **you are reversing this.** It locks
the window picker to declared package windows. The approved design replaces it with a free-range
shadcn calendar. Write a new ADR superseding 0032 and reference it from the spec. Repairing drift is
not an ADR; reversing a durable decision is.

The reason 0032 existed still matters and must be solved another way: a free window over sparse data
is how you get "no evidence" over a month the operator did import. The agreed answer is to **shade
each calendar day by evidence density** using the `chart-1..chart-5` emerald ramp, so the operator
sees where data exists while choosing. Grain is **derived from range length** (≤31 days → daily,
≤6 months → weekly, beyond → monthly), never a second control.

---

## 10. Decisions already made with the user — do not relitigate

1. **Slice** = Talabat only, one vertical slice, **Funnel + Operations** both.
2. **Recommendations**: the model reads the window's findings and **decides what matters and writes
   freely**. The user explicitly chose this over a deterministic trigger, having been shown the
   risk. Respect it. Two mechanical requirements remain: the output must be **schema-validated**
   (AGENTS.md forbids unvalidated LLM output) and it must **cite which findings it used** so the
   evidence affordance works.
3. **Review hook**: AGENTS.md requires one on AI output. Ship a helpful / not-helpful control as the
   AI-quality signal, *separate* from the triage decision.
4. **Triage controls** are `Acknowledge`, `Mark planned`, `Dismiss with reason` — mandated by
   `.superdesign/design-system.md`. **Never** an execute, publish, price-change, promotion-change or
   money-moving action.
5. **Calendar** = free range, evidence-density shading, derived grain (see §9).
6. **Layout** = the narrative audit presentation, ordered by cost, per the approved draft.

---

## 11. Design system compliance — the current page violates it

`.superdesign/design-system.md` is binding. The shipped page breaks it in four ways. Fix all four:

- It renders a **detached dark floating inspector** named **"Evidence Node"**. The spec says
  *"avoid... a detached dark floating inspector"* and *"Never use `Action Queue`, `Evidence Node`"*.
  Evidence opens in a shadcn **Sheet** from an explicit **"Inspect evidence"** control.
- It fills the screen with **repeated em dashes**. The spec: *"Empty states must still feel
  designed... Avoid filling the screen with repeated em dashes."*
- The spec mandates **Manrope**; `.superdesign/init/theme.md` records the implementation as
  **Arial**. Real drift — resolve it.
- Approved labels: `Channel Economics`, `Evidence briefing`, `Data trust`,
  `Findings & recommendations`, `Reports & trust`, `Inspect evidence`.

Also binding: 12-column desktop grid, 8px rhythm, `gap-6`, aligned card edges, primary column 8–9
cols with a 3–4 col rail, real `CardHeader`/title/description/`CardContent` anatomy, colour only
where it encodes a value or status, `bg-primary/[0.03]` for the briefing emphasis only. **No
gradients, glass, neon, or decorative AI imagery.** Mobile presents one analytical story at a time
with evidence in a Sheet.

Money is integer **minor units**; `revenue.gross` of `7000` is **AED 70.00**. `formatMoney` reads the
exponent from `Intl`, so do not hand-roll a divisor.

---

## 12. What this export cannot fill

Even when you are done, four chapters stay empty because the data is not in this file:
**Money** (no commission/payout columns), **Items** (no per-item rows), **Promotions** (only Pro
Orders / Pro Revenue), **Customer Voice** (no ratings). The approved design collapses them into one
muted **"Awaiting other reports"** row naming the file each needs. Do not fake them.

---

## 13. Environment — read before touching anything

- **There is no local database and there never will be.** Do not run `supabase start` or
  `db reset`. The only database is hosted **staging** via `DATABASE_URL` in `.env.local`. A pushed
  migration is live immediately; there is no rehearsal.
- `pnpm db:types` **cannot run**. `src/lib/supabase/database.types.ts` is hand-maintained. A new
  table must be typed there or listed in `UNTYPED_TABLES` in `database.types.test.ts`.
- A new `plpgsql` function that reads a table it did not create **must be called once against
  staging before it is done** — plpgsql resolves record fields at execution time. This has bitten
  twice.
- `pnpm db:test` runs pgTAP against shared staging. Not hermetic. `governed_channel_analysis_test.sql`
  is 58 assertions including tenant isolation — keep it green.
- **`pnpm run:trigger` is mandatory before any dispatch.** Without the worker, the analysis queues
  silently with nobody to execute it and looks like it is waiting rather than failing. Confirm
  `Local worker ready` and that `channel-analysis.run` is registered. This exact trap stranded every
  report package for a week.
- `psql` is not installed. Query staging with a small node script using `dotenv` +
  `scripts/pgtap-suites.mjs → resolvePgTapDatabaseUrl(process.env.DATABASE_URL)` + the `postgres`
  package. Delete throwaway scripts when done.
- `git push` is the **user's** step. No credentials, no `gh` CLI.
- Both dev servers are heavy on this machine — start them only while needed, stop them after.
- Known pre-existing flake: `src/workflows/reports/pdf-text-layer.integration.test.ts` times out at
  5000 ms under full-suite load and passes in ~1 s alone. Unrelated. Do not "fix" it.

**Staging identifiers**
| | |
|---|---|
| Organization | `2dda45b8-82db-4f5f-b17d-611b9bbb7846` (Al Noor Kitchen) |
| Channel | `b4f83dd2-3035-4676-9cf3-cedc9b9e7884` (talabat) |
| Branch | `e34e70c8-0314-4b68-94dd-62428efbcd77` |
| Report package | `35fd5005-57e3-477d-91a8-d8721e70e1a9` (status `projected`) |
| Projection run | `06cdbc44-5689-40a9-b11a-2002b5e53fa7` (`absent_row_count` 78 = 39 days × 2 metrics) |

`normalized_metrics` also holds **1,248 ungoverned rows** with a null `reconciliation_digest` from an
older CSV path. The read port already filters them out. **Leave them alone** — deleting them
destroys unrelated data.

---

## 14. Process gates (AGENTS.md §4)

This is **Tier 3**: new metric vocabulary, new detectors, a new AI boundary, migrations, and a moved
plane boundary. Produce an **Execution Plan** and get it approved **before writing code** — bullet
points, no code blocks: impacted files, schema/migration/event/export changes, blast radius
(callers, RLS policies, background tasks), open assumptions stated rather than silently resolved, a
test plan including how tenant isolation is verified, and risks and rollback.

Update `specs/018-governed-channel-intelligence.md` in the same change. Add ADRs for the window
reversal, the reason-code storage decision, and the monetary-impact-ranking rule.

The user communicates in plain English. No jargon. Explain any problem with a short real-world
analogy that makes the impact obvious, and prefer scannable bullets over paragraphs.

---

## 15. Definition of done

- The contract binds the usable columns **with per-row realignment**, and a test proves the 11
  ragged rows read correctly.
- New metric definitions exist; the stale comment in `talabat-performance.ts` is gone.
- A real analysis run over 2026-01-01 → 2026-02-28 at day grain produces findings whose figures
  match §3 exactly, each citing the ledger rows it came from.
- The workspace matches the approved draft, exercised in a real browser at **1440×900 and 390×844**
  with **no console errors** (Chrome DevTools MCP; if unavailable, stop and say so).
- Recommendations are schema-validated, cite their findings, and carry the review hook.
- `pnpm typecheck`, `pnpm eslint`, `pnpm vitest run`, `pnpm db:test` all pass.
- Anything found and not fixed is named explicitly, with why.

**The failure mode that matters most:** this feature's entire purpose is telling an operator the
truth about their own evidence. A confident-looking number over 20 days out of 59 that does not say
so is worse than a refusal. If you have to choose, choose the refusal.
