# The seam between Campaigns and Growth Intelligence

Written 2026-09-16, for whoever touches either module next.

Read this before you change `src/modules/growth-intelligence/application/read-service.ts`,
`read-model.ts`, the Growth Intelligence page, or anything under
`src/modules/campaigns/application/proposal-*`. It explains a join that is easy to
make in the wrong direction, and records why the wiring looks the way it does.

## What was wrong, and what to watch for

Spec 025 built the campaign proposal machine completely: a research allowance
(`campaign_research_policies`), a claim lifecycle with lease reclamation, a Trigger
worker, an immutable proposal document with a digest, an append-only decision log,
and a two-gate approval model (ADR
`0057-campaign-preparation-approval-vs-exact-output-publication.md`).

None of it was reachable. Not one component read a proposal. Growth Intelligence —
the surface Spec 025 section "UX flow" names as the place a proposal appears — had no
awareness of proposals at all. Research could run, a document could be written, and an
approval could be recorded through an API that no button called.

Every test passed the whole time, because the tests exercise the service and the
database directly.

**The shape worth watching for:** a governed table with a writer, a lifecycle and an
audit trail, and no reader on any surface a person can open. It looks finished from
inside the module. Grep for the table name in `src/components` and `src/app` before
you call that work done.

## The direction of the dependency

Growth Intelligence reads Campaigns. Campaigns never reads Growth Intelligence.

```
src/modules/campaigns/application/proposal-read-model.ts   <- owns what a proposal means
src/modules/campaigns/infrastructure/proposal-read-repository.ts
                     ^
                     | imported by
                     |
src/modules/growth-intelligence/application/read-service.ts  <- composes it in
src/modules/growth-intelligence/application/read-model.ts    <- carries it through
```

The projection lives in the **campaigns** module and the components live in
`src/components/campaigns/`, even though the section renders inside Growth
Intelligence. That is deliberate. A proposal's states, its approval gate and what
approval authorizes are campaign facts. If Growth Intelligence re-derived any of
them there would be two places deciding whether a proposal may be approved, and they
would drift.

`buildGrowthIntelligenceView` therefore **receives** already-projected proposal cards
and does nothing to them but pass them along under a section flag. Do not add proposal
logic to that builder.

## The optional-reader pattern

`GrowthIntelligenceReadDependencies.proposals` is optional, exactly like `research`
above it:

- **No reader composed** means the lane is absent. The composition root passes none
  when the campaigns feature is off for the organization, or when the member does not
  hold `campaign.read`.
- **A reader that throws** reports through `onProposalError` and the workspace
  composes without the lane. One failing lane must never take down the
  recommendations, timeline and gaps beside it.

Those two cases are not the same as an empty lane, and the difference matters: an
empty section claims there are no proposals. Absence claims nothing.

## Rules that hold this together

1. **Approval is preparation only.** Never label it "Approved" without qualification,
   anywhere. `proposalStateLabel` in `src/components/campaigns/proposal-copy.ts` is
   the single source of that vocabulary — change it there, not in a component.
2. **A control appears only where the database would accept it.**
   `DECIDABLE_PROPOSAL_STATES` mirrors the `campaign_proposal_not_decidable` guard in
   `20260913120000_campaign_proposal_preparation_approval.sql`. If you widen the guard,
   widen the constant in the same change.
3. **A decision names the version id and the digest that were rendered**, not a fresh
   read. That is what stops an approval landing on text its approver never saw. The
   server refuses a stale digest with `22023`, and the review surface reports it as
   "changed while you were reading it" rather than retrying.
4. **One idempotency key per decision and digest, reused across retries.** A fresh key
   per attempt turns a timed-out request into a second decision.
5. **Money: two amounts, never added, never defaulted to zero.** `proposedMediaBudget`
   of `null` means organic-only. A budget of zero is a different fact.
6. **A stored document that no longer validates is reported as unreadable, not
   rendered in part.** Half a proposal is not a smaller argument for spending money.
7. **Reads run on the caller's session client.** Never a service role. RLS decides
   what is visible (a `select` policy for `campaign.read` on all three tables), and
   `decide_campaign_proposal` reads `auth.uid()` for the actor — under a service role
   there would be no actor, and `service_role` is explicitly revoked from that
   function.
8. **Absent and not-yours answer identically.** Both the reader and the page return
   the same nothing, as the decision route does.

## No migration was needed

The three proposal tables already carry member `select` policies and grants from
`20260913120000`. This whole slice is reads plus a page; it adds no SQL. If you find
yourself writing a security-definer read function here, check the policies first.

## The loop is still broken upstream — two verified breaks

Reading the surfaces is done. **Producing** something for them to read is not, and the
two breaks below were confirmed against staging on 2026-09-16, not inferred from code.

### Break 1 — nothing dispatches research

No code anywhere calls `researchCampaignProposalTask.trigger(...)`, and no route calls
`request_campaign_research_run`. The worker, its payload schema, its queue and its lease
sweep all exist and nothing ever asks them to run. `request_campaign_research_run` is
the full admission gate — permission, binding policy, budget, pending cap, window
allowance, cooldown — and it is granted to both `authenticated` and `service_role`, so
either a member-facing route or a scheduler could drive it.

### Break 2 — the worker cannot write a proposal even if it were dispatched

`20260913120000` ends with:

```sql
revoke all on function public.request_campaign_proposal(uuid, jsonb),
  public.complete_campaign_proposal_version(uuid, jsonb),
  public.decide_campaign_proposal(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on ... to authenticated;   -- service_role is never granted back
```

The research worker runs as `service_role` (`createCampaignWorkerServiceClient`, wired
at `src/trigger/campaigns.ts` into `createProposalRepository`). Probed on staging inside
a rolled-back transaction:

```
request_campaign_proposal   authenticated  true    service_role  false
complete_campaign_proposal_version         service_role  false
decide_campaign_proposal                   service_role  false
set local role service_role;
select public.request_campaign_proposal(...)
  -> 42501  permission denied for function request_campaign_proposal
```

Both function bodies additionally open with `if (select auth.uid()) is null ... raise
campaign_research_forbidden`, so a grant alone would not be enough either.

**Read the revoke's own comment before changing it.** It justifies the revoke by saying a
background worker must never *approve* a proposal — "approval is a person agreeing to
spend their own money". That reasoning is exactly right for `decide_campaign_proposal`
and it must stay revoked. It does not describe `request_campaign_proposal` or
`complete_campaign_proposal_version`, which are *drafting*, and drafting by the worker is
what the design intends. The revoke is broader than its stated reason.

Fixing this is a Tier 3 change: it moves a boundary between the control and execution
planes, so it needs an Execution Plan approved before any migration is written. The
shape to aim for is that the worker's authority comes from **the admitted run it holds a
live claim on** — a person authorized that spend through the policy — rather than from
being `service_role`. `assert_campaign_research_claim` already exists for precisely that
kind of check.

Until both breaks are closed, the Campaign-ready opportunities section is correct and
permanently empty.

## What else is still missing at this seam

Recorded so the next agent does not mistake these for oversights:

- **Nothing creates a proposal from Growth Intelligence.** The manual "Request a
  campaign" path still uses the older `draftRequest` / governed-draft flow against an
  opportunity (`campaign-draft-action.tsx`), not the proposal flow. Reworking it to
  proposal-first waits on the two breaks above — an entry point that produced only
  failing runs would be worse than none.
- **`createGrowthIntelligenceOpportunitySource` stays dormant, by design.** Reviewed
  2026-09-16 and left unwired on purpose: `checkDraftEligibility` ends at
  `qualifyDraftImpact`, which demands a governed impact range, a declared confidence,
  the authoring detector's own words for it, stated assumptions and source revisions —
  and `SynthesizedItemRow` carries no impact fields at all. Wiring it would mean
  inventing those numbers, which D06 forbids. The reasoning is written at the top of
  the file. Do not delete it: the gates it composes are the ones a real impact detector
  would still have to pass.
- **`POST /campaign-proposals/:proposalId/revisions` has no caller.** "Request changes"
  records the decision and moves the proposal to `changes_requested`; writing the new
  version is the research worker's job, and see break 2.
- **No list endpoint.** Spec 025 names `GET /campaign-proposals` and
  `GET /campaign-proposals/:proposalId`. Both surfaces are server components reading
  through the repository, so no HTTP read exists. Add them only when a client actually
  needs to fetch proposals without a page load; the JSON workspace route at
  `/api/organizations/:id/growth-intelligence` deliberately does **not** offer the
  `campaign_proposals` section, because it composes no proposal reader and an always
  empty section there would be a lie.
- **`marketClaimKeys` are not stored.** They are a write-time input to `admitProposal`
  supplied by `research-planner.ts`. Re-running admission on read therefore re-checks
  only foreign evidence and no-reviewable-content. That is intentional; do not invent a
  market claim nobody marked.

## Where the surfaces are

| Thing | Path |
| --- | --- |
| Projection (states, decidability, authority, gaps) | `src/modules/campaigns/application/proposal-read-model.ts` |
| Reads | `src/modules/campaigns/infrastructure/proposal-read-repository.ts` |
| Shared vocabulary and money formatting | `src/components/campaigns/proposal-copy.ts` |
| GI lane section and card | `src/components/campaigns/campaign-proposal-card.tsx` |
| Full review and the four decisions | `src/components/campaigns/campaign-proposal-review.tsx` |
| Review page | `src/app/(platform)/organizations/[organizationId]/campaign-proposals/[proposalId]/page.tsx` |
| Composition into GI | `src/modules/growth-intelligence/application/read-service.ts` |
| Where the section renders | `src/components/growth-intelligence/growth-intelligence-workspace.tsx` (Recommendations tab, after `PriorityActions`; Overview only when non-empty) |
| Decided proposals in Your actions | `src/components/growth-intelligence/campaign-preparation-card.tsx`, plus the proposal rows in `your-actions-list.tsx` |

## The lane and the history are different lists

`toProposalCards` projects every proposal; `laneProposals` keeps only the ones still
wanting attention. The builder applies the lane rule itself and hands the **full** list
to the timeline, because a dismissal belongs in the record of what a person decided. If
you move the filter back to the reader, dismissals silently vanish from Your actions.

Timeline vocabulary: a proposal snooze and dismissal reuse the ordinary `snoozed` and
`dismissed` event types, so they fall under the filters people already reach for.
Approving and asking for changes get their own types — `planned` is not an approval, and
this approval is preparation only. Note that `your-actions-list.tsx` ends its label chain
with a bare `: "Draft failed"`, so a new event type that is not named there is rendered
as a failure. Name it.
