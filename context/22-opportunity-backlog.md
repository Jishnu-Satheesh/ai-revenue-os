# Product Opportunity Backlog

Candidate capabilities that are recorded, argued, and deliberately not yet specified. Each entry states what it is, why it matters, what it depends on, and what would trigger promoting it to a spec.

This document exists so that a good idea is neither lost nor started prematurely. An entry here has **no spec, no schema, and no implementation**. Promotion means writing a `specs/` entry and, where a durable architectural decision is involved, an ADR.

## Promoted from this backlog

Three items were promoted immediately because they are prerequisites rather than enhancements:

- **True cost-per-order ledger** → `specs/012-channel-economics-ledger.md`
- **Margin firewall** → `specs/013-margin-firewall.md`
- **Switchback experiments** → `specs/014-switchback-experiments.md`

They share a property worth stating, because it should govern future promotions from this list: each one makes the platform's claims *provable* at single-organization scale. Capabilities that add activity without adding provability rank below capabilities that add provability.

---

## 1. Idle-capacity demand shaping

**What.** Weight opportunity scoring by the marginal profitability of the time slot the demand would land in, not by order volume. Demand created during a period where fixed costs are already paid and capacity is idle is close to fully incremental. The same discount at peak cannibalizes full-price demand the operation can barely serve.

**Why it matters.** It is the difference between "more orders" and "more gross profit", which is the platform's stated optimization target. It also makes the system read as though it understands the operation rather than the funnel, which is what earns operator trust.

**Depends on.** Branch hours and capacity metadata, which exist in the domain model; observed demand by daypart; the channel economics ledger for the marginal profitability of a slot.

**Open questions.** How capacity is represented for non-hospitality verticals without contaminating the core. Whether marginal cost by daypart is estimable at all for a business with no labor scheduling data.

**Promote when.** The economics ledger is producing `complete` or `partial` grades for at least one channel, and at least one playbook is proposing timing-sensitive promotions.

---

## 2. Portfolio priors for cold start

**What.** Seed a new organization's expectations with privacy-safe aggregates from comparable organizations, so the platform is useful on day one rather than after weeks of observation. Explicitly the partial-pooling approach described in `context/21-learning-system.md`.

**Why it matters.** It is the moat in `context/00-vision.md` made visible to the buyer: the platform is better for each new client because earlier clients exist. It also directly addresses early churn, where a client cancels before the system has accumulated enough history to say anything specific.

**Depends on.** Outcome measurements across multiple organizations, a defensible business-similarity definition, and the privacy path in `context/11-playbooks-and-experiments.md` including a minimum contributing-organization floor.

**Open questions.** How similarity is defined without leaking the composition of the comparison set. Whether a prior derived from a handful of organizations is honest enough to show a client at all.

**Promote when.** There are enough organizations with completed outcome measurements that a k-anonymity floor can be met for at least one playbook. Not before.

---

## 3. Autonomy ladder

**What.** Make earned trust an explicit product mechanic. Each worker carries a visible track record — proposals made, accepted, validated, reversed — and clients grant autonomy in steps: propose only, then auto-execute below a spend threshold, then auto-execute reversible actions. Promotion is earned by measured accuracy; demotion is automatic on guardrail breach.

**Why it matters.** Small-business owners do not fear AI in the abstract; they fear the first unsupervised spend. A visible ladder converts that fear into a decision they control, and it turns the risk classification in ADR 0007 into something the client experiences rather than a configuration table they never see.

**Depends on.** The learning ledger for track records, human approval governance, and the risk-based approval framework.

**Open questions.** Whether accuracy over a small number of decisions justifies any autonomy increase, or whether the ladder should be time-based and manual early. The demotion rule risks oscillation and needs hysteresis.

**Promote when.** The learning ledger is populated and at least one worker has a track record long enough to be meaningful rather than anecdotal.

---

## 4. Zero-integration ingestion

**What.** Meet small businesses where their data actually is: a dedicated inbound email address that parses forwarded provider reports, photo and screenshot ingestion for menus and dashboards, and messaging-app-forwarded exports.

**Why it matters.** Integration friction is where small-business software dies. Most target businesses have no API access, no analytics maturity, and no patience for an OAuth flow they do not understand. Reducing onboarding to "forward this email" is likely worth more than any model quality improvement on the roadmap.

**Depends on.** The onboarding extraction pipeline, which already exists; the Integration Hub's fixture-first credential boundary; a verified inbound email path.

**Open questions.** Inbound email is an untrusted, unauthenticated input surface and needs a threat model before anything else. Attribution of a forwarded report to the right organization and branch without user-controlled text determining tenant scope, which `context/03-architecture.md` prohibits. Provider report formats change without notice.

**Promote when.** After a security review of the inbound path. The tenancy question is a blocker, not a detail.

---

## 5. Readiness score as a public diagnostic

**What.** Expose a stripped-down, self-serve version of the AI Readiness Score as a public tool producing a genuinely useful report — data gaps, tracking gaps, benchmark position — that naturally terminates in "here is what we would fix first".

**Why it matters.** An acquisition mechanic native to the product rather than bolted on. The output is the same artifact the platform uses internally, so it is honest rather than a lead-capture form wearing a diagnostic costume.

**Depends on.** `specs/008-ai-readiness-score.md`; portfolio priors if benchmark positioning is included.

**Open questions.** What can be assessed without any connected data. Whether an unauthenticated version can produce something valuable without either being trivial or requiring data no prospect will paste into a public form. Rate limiting and abuse.

**Promote when.** The authenticated readiness score is shipped and has produced assessments the team would be comfortable showing a stranger.

---

## 6. Local calendar and seasonality intelligence

**What.** Treat local events as first-class signals: religious and cultural calendars including Ramadan and its shifting timing, school terms, public holidays, major sporting fixtures, and weather.

**Why it matters.** For the Dubai pilot these are not edge cases, they are the dominant seasonal signal. A baseline that ignores Ramadan will misread the entire period, which corrupts both opportunity detection and outcome measurement.

**Depends on.** A maintained calendar source per market; branch locale; baseline computation that can exclude or adjust for known events.

**Open questions.** Whether this is core or pack. The argument for core is that every vertical has a calendar and outcome measurement needs it everywhere. The argument for pack is that the specific calendars are market-specific. Current lean is a core calendar-signal interface with market-specific data supplied by configuration.

**Promote when.** Outcome measurement is running, because the first concrete harm from ignoring this is a corrupted baseline rather than a missed opportunity.

---

## 7. Decision ledger shown to the client

**What.** Surface the full record to the client: what was proposed, what they approved, what they rejected, and what the rejected items would plausibly have been worth.

**Why it matters.** Accountability in both directions, and a strong retention argument at renewal.

**Depends on.** The learning ledger and defensible counterfactual estimation.

**Open questions.** Estimating the value of a path not taken is exactly the kind of claim `AGENTS.md` restricts, and doing it badly would be worse than not doing it. The framing risks reading as blame. This entry may reduce to showing the record without the counterfactual, which is still useful and entirely honest.

**Promote when.** Outcome measurement is mature enough that a rejected-path estimate could be bounded rather than asserted. Possibly never in its full form, and that is an acceptable outcome for this entry.

---

## Ranking heuristic

When choosing what to promote next, prefer in this order:

1. Capabilities that make an existing claim provable.
2. Capabilities that reduce onboarding friction, since an unconnected client generates nothing to learn from.
3. Capabilities that compound across clients.
4. Capabilities that add new actions.

New actions are last deliberately. The platform's constraint is not a shortage of things it could do; it is the ability to show that what it did mattered.

## References

- `context/21-learning-system.md`
- `context/20-roadmap.md`
- `context/00-vision.md`
- `specs/012-channel-economics-ledger.md`
- `specs/013-margin-firewall.md`
- `specs/014-switchback-experiments.md`
