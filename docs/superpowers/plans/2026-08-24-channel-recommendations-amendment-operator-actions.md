# Amendment — operator-performed actions carry an estimate

> **Amends:** `docs/superpowers/plans/2026-08-24-channel-recommendations.md`.
> Apply alongside it; task numbers below refer to that plan.
> **Governing decision:** `adrs/0040-who-performs-the-action-decides-where-it-lives.md`,
> which extends `adrs/0039-advise-freely-execute-narrowly.md`.

**Why:** ADR 0039 moved the fence from advice to execution. ADR 0040 places
operator-performed advice in recommendations rather than in the Decision Engine.
Recommendations therefore need the fields that make an estimate honest — and one
hard rule about who computes the number.

**Cost:** one additive migration, six fields, one worker step, one RPC check.
Task 1 is already pushed to staging, so this is a new migration, not an edit.

---

## The one rule that matters

**The model never originates the impact figure.**

The worker computes it deterministically from the cited findings *before* the
model call and passes it in as an input the narration may not alter. The
completion RPC re-checks that what was submitted equals what the worker computed.

Without this, a model producing its own number passes every existing fence —
citations, labels, count and digests are all checked, arithmetic is not — and can
state figures the detector layer deliberately refused to compute. That is the
single most valuable refusal in the analysis slice, and prose is how it leaks.

---

## New Task 1b: additive migration

**Files:**
- Create: `supabase/migrations/20260824140000_recommendation_impact_estimate.sql`
- Test: extend `supabase/tests/database/channel_recommendations_storage_test.sql`

**Interfaces:**
- Produces: six columns on `public.channel_recommendations`, all nullable, so
  every row written by Tasks 2–14 before this lands stays valid.

- [ ] **Step 1: Write the migration**

```sql
alter table public.channel_recommendations
  add column impact_low_minor bigint,
  add column impact_high_minor bigint,
  add column impact_currency text,
  add column impact_basis text,
  add column assumptions jsonb not null default '[]'::jsonb,
  add column confidence_rationale text,
  add column expires_at timestamptz;

-- A basis is one of three words, and only these three.
alter table public.channel_recommendations
  add constraint channel_recommendations_impact_basis_check
  check (impact_basis is null or impact_basis in ('observed', 'prior', 'unavailable'));

-- An impact is all-or-nothing: a range needs both ends, a currency, and a basis.
-- A half-populated estimate is worse than none, because it renders as a figure.
alter table public.channel_recommendations
  add constraint channel_recommendations_impact_complete_check
  check (
    (impact_low_minor is null and impact_high_minor is null
      and impact_currency is null and impact_basis is null)
    or
    (impact_low_minor is not null and impact_high_minor is not null
      and impact_currency is not null and impact_basis is not null
      and impact_high_minor >= impact_low_minor
      and impact_currency ~ '^[A-Z]{3}$')
  );

-- ADR 0039: an estimate is permitted only when its assumptions are stated on the
-- same surface. A stored figure with no assumptions is not an estimate, it is a
-- claim, and section 6 forbids it without a measurement window.
alter table public.channel_recommendations
  add constraint channel_recommendations_estimate_states_assumptions_check
  check (
    impact_basis is null
    or impact_basis = 'unavailable'
    or jsonb_array_length(assumptions) > 0
  );
```

- [ ] **Step 2: Write the failing pgTAP assertions**

Append to `channel_recommendations_storage_test.sql`, inside the existing
begin/rollback block, as table owner:

```sql
-- a half-populated estimate is refused
select throws_ok(
  $$insert into public.channel_recommendations
      (organization_id, channel_id, analysis_run_id, window_start, window_end,
       period_grain, label, headline, detail, prompt_version, prompt_digest,
       output_digest, provider, model_id, result_digest, impact_low_minor)
    values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',
       '00000000-0000-4000-8000-000000000003','2026-01-01','2026-02-28','day',
       'recommendation','h','d',1,'a','b','google','m','r',100)$$,
  '23514', null, 'an impact range needs both ends, a currency and a basis');

-- an inverted range is refused
select throws_ok(
  $$update public.channel_recommendations
      set impact_low_minor = 500, impact_high_minor = 100,
          impact_currency = 'AED', impact_basis = 'observed',
          assumptions = '["x"]'::jsonb$$,
  '23514', null, 'an impact range cannot be inverted');

-- a figure with no assumptions is refused
select throws_ok(
  $$update public.channel_recommendations
      set impact_low_minor = 100, impact_high_minor = 500,
          impact_currency = 'AED', impact_basis = 'observed',
          assumptions = '[]'::jsonb$$,
  '23514', null, 'an estimate must state its assumptions');

-- an unavailable basis needs no assumptions and no figures
select lives_ok(
  $$update public.channel_recommendations set impact_basis = 'unavailable'$$,
  'a recommendation may honestly carry no estimate');
```

- [ ] **Step 3: Run the suite, verify the new assertions fail**

Run: `pnpm db:test`
Expected: the four new assertions FAIL — the columns do not exist yet.

- [ ] **Step 4: Push the migration to staging**

Run: `pnpm db:migrations:dry-run`, then `pnpm db:migrations:push`.
A pushed migration is live for everyone immediately; there is no local rehearsal.

- [ ] **Step 5: Run the suite, verify green**

Run: `pnpm db:test`
Expected: PASS, alongside every pre-existing suite.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260824140000_recommendation_impact_estimate.sql \
        supabase/tests/database/channel_recommendations_storage_test.sql
git commit -m "feat(analysis): let advice carry a figure it can defend"
```

---

## Task 4 (amend): the contract gains an estimate the model cannot write

**Files:**
- Modify: `src/domain/analysis/recommendations.ts`
- Modify: `src/domain/analysis/recommendations.test.ts`

**Interfaces:**
- Produces: `impactEstimateSchema`, and `narratedItemSchema` **unchanged** — the
  model's output shape does not gain impact fields, because the model does not
  write them.

- [ ] **Step 1: Write the failing tests**

```ts
it("accepts an observed estimate that states its assumptions", () => {
  expect(() =>
    impactEstimateSchema.parse({
      basis: "observed",
      impactLowMinor: 35_700,
      impactHighMinor: 35_700,
      currency: "AED",
      assumptions: ["Talabat's own reported revenue loss from rejections, summed over the window."],
      confidenceRationale: "Every cancelled order in the window reported a loss figure.",
      sourceFindingIds: ["00000000-0000-4000-8000-000000000010"],
    }),
  ).not.toThrow();
});

it("refuses a figure with no assumptions, because that is a claim not an estimate", () => {
  expect(() =>
    impactEstimateSchema.parse({
      basis: "observed",
      impactLowMinor: 100,
      impactHighMinor: 500,
      currency: "AED",
      assumptions: [],
      confidenceRationale: "why",
      sourceFindingIds: ["00000000-0000-4000-8000-000000000010"],
    }),
  ).toThrow();
});

it("accepts an unavailable basis carrying no figures at all", () => {
  expect(() =>
    impactEstimateSchema.parse({ basis: "unavailable", sourceFindingIds: [] }),
  ).not.toThrow();
});

it("refuses an inverted range", () => {
  expect(() =>
    impactEstimateSchema.parse({
      basis: "observed", impactLowMinor: 500, impactHighMinor: 100, currency: "AED",
      assumptions: ["x"], confidenceRationale: "y",
      sourceFindingIds: ["00000000-0000-4000-8000-000000000010"],
    }),
  ).toThrow();
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm vitest run src/domain/analysis/recommendations.test.ts`
Expected: FAIL — `impactEstimateSchema` is not exported.

- [ ] **Step 3: Implement**

```ts
export const ESTIMATOR_VERSION = 1;

const quantifiedEstimate = z.strictObject({
  basis: z.enum(["observed", "prior"]),
  impactLowMinor: z.number().int(),
  impactHighMinor: z.number().int(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** ADR 0039: assumptions live on the same surface as the figure. */
  assumptions: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  confidenceRationale: z.string().trim().min(1).max(2000),
  sourceFindingIds: z.array(z.string().uuid()).min(1),
});

const absentEstimate = z.strictObject({
  basis: z.literal("unavailable"),
  sourceFindingIds: z.array(z.string().uuid()).max(50),
});

export const impactEstimateSchema = z
  .union([quantifiedEstimate, absentEstimate])
  .refine(
    (estimate) =>
      estimate.basis === "unavailable" || estimate.impactHighMinor >= estimate.impactLowMinor,
    { message: "An impact range cannot be inverted." },
  );

export type ImpactEstimate = z.infer<typeof impactEstimateSchema>;
```

- [ ] **Step 4: Run, verify pass**; then `pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/domain/analysis/recommendations.ts src/domain/analysis/recommendations.test.ts
git commit -m "feat(analysis): say what an estimate must carry to be one"
```

---

## New Task 4b: the deterministic estimator

**Files:**
- Create: `src/domain/analysis/impact-estimator.ts`
- Test: `src/domain/analysis/impact-estimator.test.ts`

**Interfaces:**
- Consumes: `ImpactEstimate` from Task 4.
- Produces: `estimateImpact(input: { findings: readonly { id: string; monetaryImpactMinorUnits: number | null; currency: string | null }[] }): ImpactEstimate`

Version one does no modelling. It sums the `monetary_impact_minor_units` the
detector layer already computed and cited, across **all findings of the analysis
run** — not per recommendation. The estimate is computed *before* the model is
called, so it cannot depend on which findings the narration ends up citing. Where
no finding in the run carries a figure, the basis is `unavailable` and the
recommendations stand on their prose.

One estimate therefore covers the run's narration, and Task 2's RPC re-derives it
from the same set. `sourceFindingIds` records which findings contributed, so the
evidence rail can show the operator exactly what the figure was built from.

- [ ] **Step 1: Write the failing tests**

```ts
it("sums the monetary impact the detectors already computed", () => {
  const estimate = estimateImpact({
    findings: [
      { id: "00000000-0000-4000-8000-000000000010", monetaryImpactMinorUnits: 35_700, currency: "AED" },
      { id: "00000000-0000-4000-8000-000000000011", monetaryImpactMinorUnits: 2_300, currency: "AED" },
    ],
  });
  expect(estimate.basis).toBe("observed");
  expect(estimate).toMatchObject({ impactLowMinor: 38_000, impactHighMinor: 38_000, currency: "AED" });
  expect(estimate.sourceFindingIds).toHaveLength(2);
});

it("reports no estimate rather than a zero when no cited finding carries a figure", () => {
  const estimate = estimateImpact({
    findings: [{ id: "00000000-0000-4000-8000-000000000010", monetaryImpactMinorUnits: null, currency: null }],
  });
  expect(estimate.basis).toBe("unavailable");
  expect("impactLowMinor" in estimate).toBe(false);
});

it("refuses to add two currencies rather than converting them", () => {
  const estimate = estimateImpact({
    findings: [
      { id: "00000000-0000-4000-8000-000000000010", monetaryImpactMinorUnits: 100, currency: "AED" },
      { id: "00000000-0000-4000-8000-000000000011", monetaryImpactMinorUnits: 100, currency: "SAR" },
    ],
  });
  expect(estimate.basis).toBe("unavailable");
});

it("states its assumption in words an operator can check", () => {
  const estimate = estimateImpact({
    findings: [{ id: "00000000-0000-4000-8000-000000000010", monetaryImpactMinorUnits: 35_700, currency: "AED" }],
  });
  expect(estimate.basis === "observed" && estimate.assumptions.join(" ")).toMatch(
    /already computed and cited|reported/i,
  );
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm vitest run src/domain/analysis/impact-estimator.test.ts`

- [ ] **Step 3: Implement**

```ts
import { impactEstimateSchema, type ImpactEstimate } from "@/domain/analysis/recommendations";

/**
 * The figure a recommendation is allowed to state.
 *
 * It originates here, deterministically, from figures the detector layer already
 * computed and cited. The narrator receives it and may not alter it: a model that
 * writes its own number passes every fence the completion RPC applies -- citations,
 * labels, count, digests -- because none of them checks arithmetic.
 *
 * Two currencies are refused rather than converted, matching the evidence contract
 * in ADR 0031. A conversion needs a rate, a rate needs a date and a source, and
 * the platform holds neither.
 */
export function estimateImpact(input: {
  findings: readonly { id: string; monetaryImpactMinorUnits: number | null; currency: string | null }[];
}): ImpactEstimate {
  const quantified = input.findings.filter(
    (finding) => finding.monetaryImpactMinorUnits !== null && finding.currency !== null,
  );
  const currencies = new Set(quantified.map((finding) => finding.currency));

  if (quantified.length === 0 || currencies.size !== 1) {
    return impactEstimateSchema.parse({
      basis: "unavailable",
      sourceFindingIds: input.findings.map((finding) => finding.id),
    });
  }

  const total = quantified.reduce(
    (sum, finding) => sum + (finding.monetaryImpactMinorUnits as number),
    0,
  );

  // A point, not a range: every contributing figure was reported rather than
  // modelled, so widening it would invent an uncertainty nobody measured.
  return impactEstimateSchema.parse({
    basis: "observed",
    impactLowMinor: total,
    impactHighMinor: total,
    currency: [...currencies][0] as string,
    assumptions: [
      `Sums the monetary impact the detectors already computed and cited on ${quantified.length} finding${quantified.length === 1 ? "" : "s"} in this window. Nothing is extrapolated beyond the window or annualised.`,
    ],
    confidenceRationale:
      "Every contributing figure was reported by the provider and cited to the ledger row it came from.",
    sourceFindingIds: quantified.map((finding) => finding.id),
  });
}
```

- [ ] **Step 4: Run, verify pass**; then `pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/domain/analysis/impact-estimator.ts src/domain/analysis/impact-estimator.test.ts
git commit -m "feat(analysis): compute the figure before the narrator sees it"
```

---

## Task 2 (amend): the RPC re-checks the figure it was given

`complete_channel_recommendations` gains four parameters — `p_impact_low_minor`,
`p_impact_high_minor`, `p_impact_currency`, `p_impact_basis` — plus `p_assumptions
jsonb`, `p_confidence_rationale`, `p_expires_at`. These are **per submission**, not per
item: one estimate covers the run's narration, computed by the worker from all of
the run's findings before the model was called. The RPC re-derives the same sum
from the same set, which is why the recomputation below filters on
`analysis_run_id` rather than on citations.

- [ ] **Step 1: Add to the failing pgTAP suite**

Assert, in service_role context: a submission whose `p_impact_basis` is
`'observed'` with an empty `p_assumptions` is refused; a submission naming an
impact currency that does not match the cited findings' currency is refused; a
submission with a complete estimate lands and the columns are populated.

- [ ] **Step 2: Implement inside the existing `complete_channel_recommendations`**

```sql
-- ADR 0040: the narrator never originates the figure. The worker computed it
-- from the cited findings; this re-derives the same sum and refuses a mismatch.
if p_impact_basis is not null and p_impact_basis <> 'unavailable' then
  if jsonb_array_length(coalesce(p_assumptions, '[]'::jsonb)) = 0 then
    raise exception 'ESTIMATE_STATES_NO_ASSUMPTIONS';
  end if;

  select coalesce(pg_catalog.sum(f.monetary_impact_minor_units), 0)
  into v_recomputed
  from public.channel_findings f
  where f.organization_id = p_organization_id
    and f.analysis_run_id = p_analysis_run_id
    and f.monetary_impact_minor_units is not null;

  if v_recomputed <> p_impact_low_minor or v_recomputed <> p_impact_high_minor then
    raise exception 'ESTIMATE_DOES_NOT_MATCH_CITED_EVIDENCE';
  end if;
end if;
```

- [ ] **Step 3: Push, run `pnpm db:test` green**

- [ ] **Step 4: Call the changed function once against staging** — happy path plus
  the `ESTIMATE_DOES_NOT_MATCH_CITED_EVIDENCE` refusal. plpgsql resolves record
  fields at execution time, so an unexecuted function is an untested one. Use a
  throwaway node script; delete it afterwards.

- [ ] **Step 5: Commit** — `feat(analysis): make the vault clerk check the arithmetic too`

---

## Task 5 (amend): the prompt receives the figure and may not change it

Add to the system prompt, stated **twice** per the repo convention noted in the
original plan's Task 5:

> An impact figure is supplied to you. Use it exactly as given, or omit it. You
> may not compute, adjust, round, annualise, or infer any monetary figure of your
> own, and you may not divide or combine any two figures you are shown. If a
> number does not appear in the supplied estimate or in a finding you were given,
> it does not exist.

- [ ] **Step 1: Failing test** — the system prompt contains the prohibition twice;
  the user prompt renders the supplied estimate and its assumptions; a prompt built
  from an `unavailable` estimate states that no figure is available rather than
  omitting the section silently.
- [ ] **Step 2–4: verify fail → implement → verify pass**
- [ ] **Step 5: Commit** — `feat(analysis): hand the narrator the number and forbid arithmetic`

---

## Task 7 (amend): the worker estimates before it narrates

Order inside `runChannelRecommendations`: claim → load findings → **`estimateImpact(findings)`** →
build prompt with the estimate → generate → validate → complete, passing the
estimate through unchanged.

- [ ] **Step 1: Failing tests** — the estimate is computed before `generate` is
  called; `complete` receives exactly what `estimateImpact` returned; a model
  response containing a different figure is still completed with the *worker's*
  estimate, never the model's.
- [ ] **Step 2–4: verify fail → implement → verify pass**
- [ ] **Step 5: Commit** — `feat(analysis): compute, then narrate, in that order`

---

## Tasks 9, 10, 12, 13, 14 (amend)

- **Task 9:** hand-type the seven new columns on `channel_recommendations` in
  `src/lib/supabase/database.types.ts`. **Another agent shares this working tree
  and this file** — re-read it immediately before editing.
- **Task 10:** `WorkspaceRecommendationView` gains
  `impact: { lowMinor: number; highMinor: number; currency: string; basis: "observed" | "prior" } | null`,
  `assumptions: readonly string[]`, `confidenceRationale: string | null`,
  `expiresAt: string | null`.
- **Task 12:** render the figure with `formatMoney` (it reads the exponent from
  `Intl`; `35700` is AED 357.00, never 35,700). Show the assumptions **on the same
  surface as the figure**, not behind a disclosure — that is ADR 0039's condition,
  not a design preference. An `unavailable` basis renders no figure and no
  em-dash placeholder.
- **Task 13:** the judge gains one verdict field, `figure_matches_evidence`,
  checking the narrated prose states no monetary figure absent from the supplied
  estimate or the cited findings. This is the backstop for the one thing the RPC
  cannot check.
- **Task 14:** the live proof asserts the recommendation for the Talabat window
  carries `impact_basis = 'observed'` and an impact equal to the sum of that run's
  findings' `monetary_impact_minor_units`, and that its assumptions array is
  non-empty.

---

## Out of scope, deliberately

`expires_at` is added to the schema and rendered, but nothing expires
recommendations yet. A sweeper is a separate slice; the column exists now so the
migration is not repeated later.

The Decision Engine is untouched. `docs/superpowers/specs/2026-08-24-decision-engine-unblock-design.md`
remains accurate and is deferred, not withdrawn — it becomes relevant when Meta
App Review clears.
