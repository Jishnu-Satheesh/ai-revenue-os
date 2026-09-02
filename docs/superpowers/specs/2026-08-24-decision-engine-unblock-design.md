# Unblocking the Decision Engine — design

**Status:** approved for planning. Implements ADR 0039 in the `decisions` module.
**Scope:** `src/modules/decisions`, `src/workflows/decisions`, one new API route, the opportunity feed.
**Does not touch:** the `analysis`, `reports` or `campaigns` modules, or any execution guardrail.

## 1. The problem, stated precisely

The Decision Engine has never produced an opportunity. It is not unfinished:
roughly four thousand lines with near-complete test coverage, three fenced RPCs,
leases, cancellation handling, and a Meta playbook. It has never produced one
because three evidence gates are closed by construction rather than by data.

| Gate | Why it cannot pass |
|---|---|
| `measurement.plan_registered` | `load_campaign_decision_context` overlays `'false'` unconditionally |
| `impact.range`, `impact.approved_source` | `mapCampaignEvidence` sets `impactEvidence: null` unconditionally |
| `margin.firewall.pass` | `marginFirewallResult` is `"unknown"`; the source treats unknown as missing |

`campaign-opportunity-source.ts` then refuses on any missing key at all:

```ts
if (missingEvidenceKeys.length > 0) {
  return { outcome: "needs_data", missingEvidenceKeys, missingCapabilityKeys };
}
```

`run-cycle.ts` converts that outcome into `candidates: []` and `opportunity: null`.
A decision record is written; nothing reaches the feed. `/opportunities` is
therefore empty for every organization, and the campaigns module — the largest in
the repository — has never been given anything to act on.

Each refusal was written to honour the old section 6 prohibition on declaring
business impact. ADR 0039 establishes that the prohibition governs claims about
**what did happen**, not proposals and not estimates. The gates are stricter than
the rule they were protecting.

## 2. What the existing data model already permits

No migration is required. The schema was built for estimates and the gate was set
to accept only measurements.

```
evidence_tier  CHECK (evidence_tier = ANY (ARRAY['computed','observed','prior']))
assumptions    jsonb NOT NULL
```

`decisionOpportunitySchema` carries `evidenceTier`, an `assumptions` array, a
`confidenceRationale`, and a non-empty `evidenceBundle`. Those four fields are
exactly ADR 0039's conditions for a permitted estimate: inputs cited, assumptions
stated on the same surface, labelled as an estimate.

Impact fields stay `NOT NULL`. We do not make them nullable. A qualified proposal
still carries a range — an honest estimated one — rather than a hole.

## 3. Design

### 3.1 The gate splits in two

`campaign-opportunity-source.ts` separates the keys it collects.

**Blocking.** The proposal would be wrong or unsafe, so it is still refused:

- `currency_agreement` — components spanning currencies is a defect, not a conversion
- `margin_firewall_breach` — an explicit breach
- missing capability grants — we would be proposing something the org cannot do
- `spend_policy_configured` / `policy.spend.active` — no budget to propose against
- `policy.access.active`
- `inputs_fresh` — evidence older than the playbook's freshness bound

**Qualifying.** These describe our instrumentation, not the advice. The proposal
is emitted and states its own limits:

- `measurement.plan_registered`
- `impact.approved_source`
- `margin.firewall.pass` **when the result is `unknown`** (a `breach` stays blocking)

The qualifying keys are carried onto the opportunity so the surface can say what
is not yet measurable, in the same way a detector's `limitations` already work.

**The remaining `impact.*` keys disappear rather than move.** `impact.range`,
`impact.currency`, `impact.source_revisions`, `impact.observed_at` and
`impact.time_to_impact` are pushed only when `impactEvidence` is null. Once §3.2
supplies an estimate they are never generated, so they need no classification. If
the estimator refuses (§3.2), they are generated as before and are **blocking** —
an opportunity whose impact fields cannot be populated cannot be written at all,
because the columns are `NOT NULL`.

### 3.2 Impact becomes an estimate with a declared method

A new versioned estimator replaces the hardcoded `impactEvidence: null`. It derives
a range from the organization's own governed evidence — the channel economics
ledger and the normalized metrics — and never from a benchmark we invented.

It declares, per estimate:

- `evidenceTier`: `"observed"` when derived from this organization's own history,
  `"prior"` when it leans on a playbook default
- `evidenceBundle`: every input row it used, as citations
- `assumptions`: every assumption in plain English — the assumed uplift, the average
  order value used, the window it was taken over. **The uplift is the playbook
  version's own declared figure, not a number chosen per call**, so two estimates
  under one playbook version share their assumption and a changed assumption is a
  new playbook version.
- `confidenceRationale`: why the confidence is what it is

The estimator carries a calculation version, like a detector. A changed method is a
new version, never a silent reinterpretation of estimates already recorded.

**The estimator never divides an unstated number into a confident one.** If it
cannot state an assumption, it cannot make the estimate, and the key stays
blocking rather than qualifying.

### 3.3 The two hardcoded overlays are removed

`mapCampaignEvidence` stops setting `impactEvidence: null` and passes the
estimator's output through.

`load_campaign_decision_context` stops overlaying
`measurement_plan_registered: false` and instead reports whether a row in
`campaign_measurement_plans` covers this organization and the cycle's window —
`true` when one exists, `false` when none does, with no overlay either way. The private
predecessor must be read first to see whether it already resolves this from
`campaign_measurement_plans` (which exists and is empty) or whether the public
wrapper is the only source. Per house rules the changed function must be called
once against staging before the task is considered done.

### 3.4 A dispatcher

`POST /api/organizations/{organizationId}/decision-cycles`, modelled line for line
on the analysis route: `getOrganizationContext`, correlation header,
`apiErrorResponse`, a permission check, and a `tasks.trigger` of the existing
`decision.run-campaign-cycle` task. Returns `202` with the cycle id.

A scheduled cycle is deliberately deferred until one manual cycle has been seen.
Chaining after `channel-analysis.run` is rejected for now: ADR 0037 separated the
narration worker from the detector worker precisely to stop one plane's failure
mode reaching another, and the same argument applies here.

### 3.5 The feed

`buildOpportunityFeed` already groups by how well the evidence supports an item —
the page copy says so. Tier-aware grouping may therefore already exist.

**Open assumption, not verified:** if the feed hardcodes `computed`, it grows by a
tier label and a disclosure that lists the opportunity's assumptions and its
qualifying gaps. If it does not, this section is a copy change only.

## 4. Test plan

- **Unit, gate split:** a candidate with only qualifying gaps produces a proposal;
  a candidate with any blocking gap still produces `needs_data`; a `breach` blocks
  while an `unknown` qualifies.
- **Unit, estimator:** every estimate carries at least one citation and at least one
  assumption; an estimate that cannot state an assumption is refused rather than
  emitted; the calculation version is stamped.
- **Unit, workflow:** `run-cycle` writes an opportunity when the source returns a
  qualified proposal, and still writes `candidates: []` when it returns `needs_data`.
- **pgTAP:** an opportunity with `evidence_tier = 'prior'` and non-empty assumptions
  is accepted by the table; tenant isolation on the new route's reads — a member of
  another organization cannot reach this organization's cycles or opportunities.
- **Route:** permission enforced; a caller without it gets a refusal, not a queued
  cycle; dispatch failure is reported rather than swallowed.
- **Live:** one real cycle for `2dda45b8-82db-4f5f-b17d-611b9bbb7846` against the
  208 economics entries and 1,288 governed metrics, then read
  `decision_cycles`, `decision_candidates` and `opportunities` and check every cited
  figure resolves to the row it came from.
- **Browser:** `/opportunities` at 1440×900 and 390×844, no console errors.

## 5. Risks and rollback

**The estimator is where "estimate" could quietly become "invention."** This is the
real risk of the whole change. Mitigated by three rules that are testable: every
input cited, every assumption listed, and refusal when an assumption cannot be
stated. Reviewed as a whole rather than trusted per-call.

**A proposal an operator acts on may prove wrong.** Accepted by ADR 0039, and
smaller than the risk it removes — a platform that charges for analysis and
declines to give any.

**Rollback** is a one-line revert of the gate split; the estimator can be left in
place unused, and no migration exists to reverse.

## 6. Open assumptions

1. `buildOpportunityFeed` groups by evidence tier already (§3.5). Unverified.
2. The private `load_campaign_decision_context` predecessor already reads
   `campaign_measurement_plans`. Unverified; determines whether §3.3 is a one-line
   change or a schema-and-RPC slice.
3. The Meta playbook's `requiredEvidenceKeys` do not themselves re-impose a
   `computed` tier requirement independently of the source's gate. Unverified.

Each is cheap to settle and none changes the shape of the design — only the size of
one section.
