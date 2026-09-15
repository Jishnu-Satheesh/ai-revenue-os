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

## What is still missing at this seam

Recorded so the next agent does not mistake these for oversights:

- **Nothing creates a proposal from Growth Intelligence.** The manual "Request a
  campaign" path still uses the older `draftRequest` / governed-draft flow against an
  opportunity (`campaign-draft-action.tsx`), not the proposal flow. Reworking it to
  proposal-first is a separate slice, deliberately deferred.
- **`createGrowthIntelligenceOpportunitySource` is dormant.** It was written and never
  wired. Reconciling it with proposals is part of that same deferred slice.
- **`POST /campaign-proposals/:proposalId/revisions` has no caller.** "Request changes"
  records the decision and moves the proposal to `changes_requested`; writing the new
  version is the research worker's job and nothing schedules that yet.
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
