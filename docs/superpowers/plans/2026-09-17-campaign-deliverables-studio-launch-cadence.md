# Campaign deliverables, Studio, launch approval, cadence — implementation plan

## Global Constraints

- TypeScript strict mode mandatory. Zod schemas at every external and AI boundary.
- Tenant isolation enforced at database and application layers; verify by guessed-ID cross-tenant refusal.
- No service-role bypass in user-facing request paths. Domain error types, not generic exceptions.
- Idempotency keys for retried side effects (generation dispatch, launch authority).
- Timestamps UTC; money in integer minor units with ISO currency code; structured logging with organizationId where available.
- Generation stays an explicit click, never auto-fires on approval. Approval authorizes the purse; the click spends it.
- `dismissed`/`snoozed` research items never resurrected (ADR 0062 ladder still binds scheduled runs).
- No local DB. Staging migrations applied by the user. Worker deploy is the user's step.
- Each slice ends with: tsc 0, eslint clean on touched files, focused vitest green, pgTAP for its migration executed once on staging, one live click-through.

## Task 1 — Slice 1, Task 8: approved proposal to tracked deliverables (Generate wiring)

- Impacted files: `src/components/campaigns/campaign-detail-workspace.tsx` gains a Generate control for approved-proposal campaigns with no version, wired to the existing `campaigns/[campaignId]/generate` route; new deliverable read row on the detail page from the existing `deliverable-service`; `proposal-review` keeps its copy, no new approval semantics.
- New or changed schemas, migrations, events, exports: one migration for finished-deliverable identities bound to bundle version plus render hash, following the `deliverable.ts` domain already in tree; one event `campaign.generation_started`; no RLS change, member-read plus worker-write with claim as elsewhere.
- Blast radius: generate route, `generate-bundle` worker, poster render path, Creative History Unreviewed link. Approval, dispatch, and measurement untouched.
- Open assumptions: generation stays an explicit click, never auto-fires on approval, because approval authorizes the purse and the click spends it; retry reuses identical bytes, changed bytes make a new version.
- Test plan: route tests for double-click idempotency and wrong-tenant refusal; worker test for partial-set honesty; tenant isolation by guessed campaign id from org B refused.
- Risks and rollback: image-model spend per click, mitigated by approved generation caps enforced in the route before dispatch; rollback disables the Generate control, versions stay readable.

## Task 2 — Slice 2, Task 9: Studio proof pass

- Impacted files: studio components already in tree get a bounded proof pass only — save-and-render against the selected base digest, stale-save conflict copy, expired-preview empty state; no new editor surface.
- No schema or migration. Blast radius limited to Studio routes and render store.
- Open assumptions: no compositor or font changes; text-overflow and glyph failures surface by name.
- Test plan: masked-byte invariance, stale-save conflict, existing golden tests stay green.
- Risks and rollback: old Studio stays readable; no approval survives changed output, enforced already.

## Task 3 — Slice 3, Task 10: exact-output launch approval

- Impacted files: new launch-approval route binding deliverable id plus render hash plus schedule plus spend ceiling; `launch-service` plus Tool Gateway check extended to require it; review UI lists the exact set being approved.
- One migration for the launch authority record; one event `campaign.launch_approved`.
- Blast radius: Tool Gateway approval check, dispatch planner, publishing UI. No provider call needed to prove authority.
- Open assumptions: batch approval lists every item; a later variant invalidates and needs its own approval.
- Test plan: stale digest refused, mixed-tenant selection refused, changed-bytes invalidates, replay returns saved authority.
- Risks and rollback: refuse new launch admissions on fault; reviews and receipts retained.

## Task 4 — Slice 4, Task 16: governed cadence

- Impacted files: new `research-due-reader` plus scheduler registration in trigger `campaigns.ts`; settings UI already in tree gets schedule, timezone, qualifying-change fields; admissions bind policy version and trigger kind as today.
- One migration for due and evaluated-source receipts with tenant keys; no policy table recreated.
- Blast radius: admission function, lease sweep, Memory capture consumers. Manual Ask obeys identical rules; no settings means visible setup state and zero model spend.
- Open assumptions: scheduled runs derive questions through the same tier ladder; a due evaluation with no warranted candidate stores the outcome and proposes nothing; Memory writes alone never trigger research.
- Test plan: org A on and B off, exhausted budget, stale policy mid-run, event storm without duplication, timezone boundaries, one next-test proposal per evidence revision.
- Risks and rollback: stop future admissions safely; containment for live spend never disabled by a scheduler change.

## Task 5 — Follow-up: approval→snapshot backfill (unblocks live test)

- Problem: `decide_campaign_proposal` mints the campaign without a `campaign_source_snapshots` row, so Generate on a proposal-born campaign fails with "no pinned evidence to generate from". The control surfaces this honestly, but the approved campaign stays blocked.
- Impacted files: proposal decide path (`proposal-service.decide` / `decide_campaign_proposal` caller) gains an approval-time snapshot pin gated on the proposal's cited evidence (context manifest / source refs already on the proposal version). The pin itself is written by the existing ADR 0058 `refresh_campaign_source_snapshot` repair RPC, which assembles the organization's live verified facts — a frozen copy of cited revisions is not possible without a new RPC plus migration (members hold no INSERT grant), so live-read is the accepted semantics (see Ruling below). When the proposal cites no pinnable evidence, pin nothing and keep the existing honest refusal; never invent evidence.
- No new tables; reuse `campaign_source_snapshots` and existing reader `latestSnapshotId`. One event or reuse: no new event, the existing `campaign.generation_started` still fires on first dispatch.
- Blast radius: decide path only. Generation route, caps, Studio untouched.
- Open assumptions: the pin reflects live verified facts at approval time, not frozen cited revisions; the approval digest still binds the decision to the exact text read and generation caps still bound spend, and generation reads the same tenant-verified stores the proposal cited. A proposal with zero cited evidence leaves the campaign honestly unstartable with the existing copy.
- Test plan: decide on approved proposal creates snapshot row bound to cited evidence; decide with evidence-less proposal leaves no row and Generate keeps honest copy; cross-tenant decide refused as today.
- Risks and rollback: a wrong pin poisons generation input — mitigated by pinning only cited evidence and immutable snapshot rows; rollback is a no-op read path (generation keeps old honest refusal).
