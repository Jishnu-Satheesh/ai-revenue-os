# Campaign module redesign — handoff

Written 2026-09-16, for the agent picking this up next.

You are continuing **Spec 025, "Campaign experience and marketing loop"**. Read this
first, then the two documents it points at. Everything here was verified, not assumed;
where something is unverified this file says so.

---

## 1. Where to stand

- **Worktree:** `/home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence`
- **Branch:** `feat/governed-channel-intelligence`
- **Spec:** `specs/025-campaign-experience-and-marketing-loop.md`
- **Task plan (the checklist you work from):**
  `docs/superpowers/plans/2026-09-12-campaign-experience-implementation.md`
- **The seam you will be working across:**
  `docs/collaboration/campaign-and-growth-intelligence-seam.md` — **read this before
  touching either the campaigns or the Growth Intelligence read path.**
- **Board:** `docs/collaboration/asset-library-and-studio-board.md` — durable record
  across sessions. Add an entry as you go.

### Two things about this worktree that will bite you

**A peer session is actively committing to this branch.** Not hypothetically — four of
its commits landed between mine (`e99e52b`, `5f8fc0b`, `0930c3a`, `b4b2b4f`), files
changed under me mid-task, and a transient TypeScript error in `home-context.tsx`
appeared and vanished between two `tsc` runs minutes apart.

Consequence: **`git add <path>` is not safe on a file that is already `M`.** Diff it
first. To commit only your own hunks, rebuild the file from `HEAD` plus your edits and
stage that blob without touching the working tree:

```
git show HEAD:path/to/file > /tmp/rebuilt      # then apply only your edits to it
blob=$(git hash-object -w /tmp/rebuilt)
git update-index --cacheinfo 100644,"$blob",path/to/file
git diff --cached --stat                        # confirm the staged change is only yours
```

Files currently carrying the peer session's uncommitted work, which you will probably
need to touch: `growth-intelligence-workspace.tsx`, its test, the Growth Intelligence
page, `data-gaps.tsx`, `insights-list.tsx`, `market-watch-projects.*`,
`new-research-dialog.tsx`, `report-reader.tsx`, `live-preview.*`,
`context/05-module-map.md`, `specs/022-growth-intelligence.md`.

**Never `git stash`.** The stack is shared with the main checkout and every other
worktree.

### Hard environment rules (from `AGENTS.md`)

- **There is no local database and there will not be one.** Never run `supabase start`,
  `supabase db reset` or `pnpm db:types`. `src/lib/supabase/database.types.ts` is
  maintained **by hand**.
- **A pushed migration is live on shared staging immediately.** Get it right by reading
  the existing schema first — and rehearse (see §5).
- **`git push` and `pnpm db:migrations:push` are the user's steps.** You have no
  credentials and no `gh`.
- A new `plpgsql` function that reads a table it did not create **must be called once
  against staging** before it is considered done. plpgsql resolves record fields at
  execution time, so a function naming a column that does not exist applies cleanly and
  fails on first call. This has already happened twice.
- Stop the dev server before running the full test suite.
- Trigger.dev runs in the cloud, never a local worker.

---

## 2. What the module is supposed to do

One campaign identity crossing purpose-specific workspaces, with **two approval gates**
(ADR `0057-campaign-preparation-approval-vs-exact-output-publication.md`):

1. **Gate 1 — preparation approval.** Approving a *proposal* authorizes **drafting
   creative inside a stated cost ceiling**. It reserves no media spend, publishes
   nothing, confirms no creative and authorizes no later variation.
2. **Gate 2 — publication.** Every finished output is reviewed on its own exact bytes
   before it can be published. Media spend is authorized separately at launch.

The single most important rule in this module: **never write "Approved" unqualified.**
It reads as "cleared to publish", which is precisely the misunderstanding ADR 0057
exists to prevent. `src/components/campaigns/proposal-copy.ts` is the one place that
vocabulary lives.

The full loop, as designed:

```
research policy (a person sets the budget)
   -> admitted research run (allowance, cooldown, pending cap, cooldown)
      -> Trigger worker claims it with a token + lease
         -> worker drafts a proposal document + digest
            -> a person reviews it and approves PREPARATION only
               -> a campaign row opens
                  -> creative is generated, reviewed per output, launched, measured
```

---

## 3. What is DONE (and verified)

Four commits, all mine, all on the branch:

| Commit | What |
| --- | --- |
| `e77b639` | Research **settings** — the policy writer that Task 6 never had |
| `c049002` | Proposal **read + review surface** |
| `05bd71f` | Decided proposals in **Your actions** |
| `f809bcf` | **Closing the loop**: request research, and let the worker draft |

### The settings slice (`e77b639`)
Task 6 built the whole research machine against `campaign_research_policies` — a table
**nothing could write**. No creator, no grant, no caller. A vault with an audit trail
and no door. Added `save_campaign_research_policy` (advisory-lock per organization,
version + pointer moved atomically), `researchPolicyInputSchema`, the GET/PUT route, the
page at **Campaigns → Research settings**, and the form. The form opens **blank** and
refuses to save while any figure is missing — these are numeric operating limits and
pre-filling plausible numbers is how a budget nobody chose ends up in force (D06).

### The review surface (`c049002`)
Spec 025 had built proposals completely — immutable documents with digests, an
append-only decision log, the approval gate — and **nothing read them**. Not one
component called `/campaign-proposals`; Growth Intelligence had no proposal awareness.

Added `proposal-read-model.ts` (the projection: `awaiting_research` / `unreadable` /
`document`, plus `decidable` mirroring the SQL guard), `proposal-read-repository.ts`
(three flat session-client reads — **no migration needed**, the tables have carried
member `select` policies since `20260913120000`), the "Campaign-ready opportunities"
section, and the review page at
`/organizations/:id/campaign-proposals/:proposalId` with Approve / Request changes /
Snooze / Dismiss bound to the rendered version id **and digest**.

### Your actions (`05bd71f`)
Proposal decisions now appear in the record of what a person decided. Snoozes and
dismissals reuse the ordinary event types so existing filters catch them; approving and
asking for changes got their own, because `planned` is not an approval. Approved
proposals show in Campaign preparation with a link to the campaign they opened.

Also **reconciled `createGrowthIntelligenceOpportunitySource`: it stays dormant, by
design.** `qualifyDraftImpact` demands a governed impact range, declared confidence, the
author's own words for it, stated assumptions and source revisions — and
`SynthesizedItemRow` carries no impact fields at all. Wiring it would mean inventing
those numbers. Reasoning is at the top of that file. **Do not delete it.**

### Closing the loop (`f809bcf`) — read this one carefully
Two breaks, both confirmed against staging:

1. **Nothing dispatched research.** No caller of `researchCampaignProposalTask.trigger()`,
   no caller of `request_campaign_research_run`.
2. **The worker could not write a proposal.** It runs as `service_role`;
   `20260913120000` revoked `request_campaign_proposal` and
   `complete_campaign_proposal_version` from `service_role`. Probed live → `42501`.

Migration `20260916120000_campaign_research_worker_drafting.sql` gives those two
functions a **worker arm** whose authority is a **live research claim**, not the role:
the run must be `claimed`, with that exact token, and an unexpired lease. A live claim on
run A cannot write into a proposal run A did not open — the opener binds
`campaign_research_runs.proposal_id` at creation and the version writer checks it.
`decide_campaign_proposal` **stays revoked from `service_role`**, permanently.

`campaign_research_runs.requested_by` was added because a proposal records who it came
from and a worker is not a who.

Plus `research-dispatch.ts` (admit **then** dispatch), `POST /campaign-research/runs`,
and the "Ask for a campaign" control.

### Verification standing at handoff
- `tsc --noEmit`: **exit 0**
- vitest, affected areas: **1875 passed / 144 files**; earlier full sweeps 3216 + 1971 green
- eslint on every touched file: clean apart from **one pre-existing** error,
  `research-service.ts:14` (adapter-import rule) — not mine, do not "fix" it blind
- pgTAP for the new migration: **21/21**, rehearsed on staging inside a rolled-back
  transaction

---

## 4. What is LEFT

### 4.1 Blocking, do this first — push and prove the loop

**The migration `20260916120000` is NOT pushed.** Nothing downstream of it works until it
is, and pushing is the user's step.

1. Ask the user to run `pnpm db:migrations:push`, then `pnpm db:test`.
2. **Call the changed functions once against staging.** This is the house rule and it
   exists because plpgsql fails on first call, not on apply.
3. Then prove the whole loop end to end on staging: set a research policy and switch it
   **on** → press "Ask for a campaign" → watch the Trigger run → a proposal appears in
   Campaign-ready opportunities → approve it → a campaign row opens.
   - Trigger tasks must be **deployed to the cloud**. The worker id and payload are at
     `src/trigger/campaigns.ts`, task id `campaign.research-proposal`.
   - Expect the first real run to surface problems in the *planner* (the model call),
     which has never executed against real data. Read failures honestly; do not paper
     over an `advice_only` outcome as a proposal.

### 4.2 Browser verification — an outstanding gate on everything I shipped

**None of the proposal UI has been exercised in a browser.** The Chrome DevTools MCP was
not connected for my whole session, and the user's standing rule is that frontend work is
not done until exercised at both widths (1440px and a true 390×844 via `emulate` —
`resize_page` floors at ~500px).

Staging holds **zero proposals**, so there was nothing to look at. Once §4.1 produces a
real one, check: the section, the review page, the decision panel, Your actions, and the
"Ask for a campaign" refusal states. `campaign_proposal_versions` and
`campaign_proposal_decisions` carry **immutability triggers** — do not hand-insert
fixture rows on staging, because you could never remove them.

### 4.3 Task 7's last open box — the manual request, proposal-first

`/campaigns/new` still posts a brief and creates a campaign directly (`manual_brief`).
Task 7 asks for that journey to become proposal-first. I deliberately held it: an entry
point that produced only failing runs would have been worse than none. With §4.1 done it
is now unblocked.

Decide explicitly with the user whether this **replaces** the brief path or sits
**beside** it. Replacing it breaks a workflow that works today and does not need research
enabled. The plan says: "Keep typed caller/response compatibility deliberate; do not show
'Generation queued' before the new approval transaction exists."

### 4.4 The rest of the plan

- **Task 12 — Meta provider qualification.** Held at the user's instruction. Blocked on a
  real Meta account and App Review (client-owned, weeks long). Organic ships; paid holds.
- **Task 14 — pause/resume ads.** Paid. Held with Task 12.
- **Task 15 — clinical creative comparisons and governed learning.** Not started. Note:
  `creative_item_performance_evidence` **has no write path anywhere**. Check that before
  planning; it may be another reader-without-writer.
- **Task 16 — automatic scheduling.** The cadence half is not built. The policy already
  carries `schedule_timezone`; `request_campaign_research_run` is granted to
  `service_role`, so a scheduled sweep can drive it exactly as the route does. The
  dispatch module is reusable as-is.
- **Task 17 — release verification and handoff.** Last.

### 4.5 Smaller, recorded, not done

- The **"dish" wording leak** in `subject-list.tsx`, `asset-vocabulary.ts`,
  `verification-panel.tsx`, `readiness.ts`. "Dishes" is a restaurant concept and is
  **forbidden in platform-core UI**.
- `context/05-module-map.md` should mention the proposal read surface. I left it alone
  because the peer session has it open.
- `POST /campaign-proposals/:proposalId/revisions` still has no caller. "Request changes"
  moves the proposal to `changes_requested`; writing the new version is the worker's job
  and nothing re-dispatches it yet. That is the natural follow-on to §4.1.

---

## 5. How to work here

### The rehearsal technique (use it for every migration)

There is no local database, so rehearse against staging inside a transaction you roll
back. Apply the migration **and** its pgTAP suite in one `sql.begin()`, then throw a
sentinel:

- Use the `postgres` npm driver and read `DATABASE_URL` from `.env.local`.
- **The script must live inside the project directory** — ESM resolution cannot reach
  `node_modules` from the scratchpad.
- Strip the suite's own `begin;` / `rollback;` before running it inside your transaction.
- **Always re-query afterwards** to confirm staging is untouched.

This caught a `FOR UPDATE is not allowed with aggregate functions` error before a push,
and it is how the 21 pgTAP assertions were verified this session.

### Do not retype SQL you are replacing

`create or replace function` on an existing function is a trap. I reconstructed
`request_campaign_research_run` from memory and silently rewrote its allowance rules;
I reconstructed `complete_campaign_proposal_version` and dropped `snoozed_until = null`,
which would have broken a table constraint. **Both were caught only by diffing my version
against the original.**

The discipline: extract the original function text programmatically, apply *named* string
patches to it, then diff and print **every removed line**. If a line you did not mean to
remove appears, stop.

### Rules this module holds itself to

1. **Approval is preparation only.** Never bare "Approved".
2. **A control appears only where the database would accept it.**
   `DECIDABLE_PROPOSAL_STATES` mirrors the `campaign_proposal_not_decidable` guard. Widen
   both together.
3. **A decision names the version id and digest that were rendered**, never a fresh read.
4. **One idempotency key per decision and digest, reused across retries.**
5. **Money: two amounts, never added, never defaulted to zero.** `proposedMediaBudget`
   of `null` means organic-only; zero is a different fact.
6. **Never invent a numeric operating limit (D06).** Budgets, cooldowns, caps and
   evidence ages are all read from the policy in force.
7. **A stored document that no longer validates is reported as unreadable**, never
   rendered in part.
8. **Reads run on the caller's session client.** Never a service role in a user-facing
   path.
9. **Absent and not-yours answer identically.**
10. **Never state a realized business result** without baseline, attribution method and
    measurement window. A forward-looking estimate is fine if labelled and sourced.

### The shape worth hunting for

Three times in this module the same defect appeared: **a governed table with a writer, a
lifecycle and an audit trail, and no reader or no caller on any surface a person can
open.** It looks finished from inside the module, and every test passes, because the
tests drive the service directly.

Before calling anything done, grep the table name and the function name across
`src/components`, `src/app` and `src/trigger`. If nothing outside the module's own tests
names it, it is not wired.

---

## 6. First five things to do

1. Read `docs/collaboration/campaign-and-growth-intelligence-seam.md`.
2. `git log --oneline -8` and skim `f809bcf` — it carries the reasoning for the
   security boundary you are about to operate.
3. Ask the user to push `20260916120000` and run `pnpm db:test`.
4. Call the changed functions once against staging (§4.1 step 2).
5. Drive the loop end to end in a browser at both widths (§4.2), and write what you find
   to `docs/verification/campaigns/`.
