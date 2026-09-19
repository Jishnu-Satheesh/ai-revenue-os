# Overview growth — successor handoff

## Start here

You are implementing one precisely specified Overview section in:
 /home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence

Read this entire document, then the listed contracts. Do not design a different dashboard. The user rejected the earlier oversized money headline/bar-chart proposal and approved the minimal blue-current/green-projection line chart.

## Approval ledger

- APPROVED: existing aesthetic, restrained layout, two distinct series, independent values/markers, same-date comparison, right-hand evidence/recommendations for behind AND ahead, and original projection fixed for its selected period.
- APPROVED: produce comprehensive planning/handoff documents and preserve the approved PNGs.
- NOT PERFORMED: feature implementation, new migration, deployment, populated live-data verification or browser implementation.
- DETAILED TECHNICAL PLAN: proposed for review. Read the latest user message before deciding whether execution is authorized. An explicit instruction to implement THIS handoff is sufficient; do not repeatedly ask for approval of the already-approved visual/fixed-projection decisions or each routine task.
- Timing assumption: next-day rolling initial period unless the user answers the separately presented timing question differently. This must be explicitly included when the detailed plan is approved; never backdate a projection.
- No application code was changed during the planning session. Existing unrelated dirty files belong to other work.

## Mandatory reading order

1. Repository AGENTS.md and its deliberate context-reading order; collaboration board.
2. specs/027-overview-growth-progress.md.
3. .superdesign/overview-growth/REFERENCE.md; open BOTH approved PNGs.
4. docs/superpowers/plans/2026-09-18-overview-growth-visual-contract.md.
5. docs/superpowers/plans/2026-09-18-overview-growth-data-contract.md.
6. adrs/0064-fixed-growth-projection-progress.md.
7. docs/verification/overview-growth/2026-09-18-planning-discovery.md.
8. docs/superpowers/plans/2026-09-18-overview-growth-implementation.md.
9. Existing src/components/organizations/home/home-revenue.tsx; current CSS revenue block; revenue-scenario.ts; home-loader.ts; snapshot repository/application/worker. Read source-owned advice contracts when Task5 reaches them.

The old organization-home/revenue handoffs remain historical context, not authority for this replacement design.

## What the client should understand

- Blue solid line = the revenue reported so far in the fixed period.
- Emerald dashed line = what the original estimate expected by each date.
- They share dates, currency, reporting scope and accumulation start.
- Blue stops at the latest supported observation. Green continues to the period end.
- When behind, the right panel identifies evidence worth examining and practical actions.
- When ahead, it identifies opportunities to improve further.
- A visible estimate, fixed issue date, data cutoff and accessible assumptions protect clarity without overwhelming the card.

## Non-negotiable appearance

- Main reference: .superdesign/overview-growth/approved-behind.png.
- Alternative state: .superdesign/overview-growth/approved-ahead.png.
- Keep Manrope, existing white surfaces, muted-green header, thin border,16px corner radius, small controls and open space.
- Canonical card1550×792 on1672×940 fixture canvas; chart/advice split68.25/31.75. Use the visual contract for coordinates, typography and responsive breakpoints.
- Blue#2563EB solid, green#08785A dashed; filled versus hollow dots. Both have their own values. No third series, area-fill decoration or pulsing tip.
- The original green points and projection identity are identical between the behind/ahead test fixtures.
- No huge number banner, bars, numbered action tiles, progress bars, dense badges, giant button or new sidebar style.
- Do not regenerate or replace the approved images. Record their hashes before work.
- Generative raster plot positions are approximate; reproduce layout faithfully and calculate point positions correctly. Record only those numerical corrections explicitly.
- Mobile and interactive states are specified adaptations; test them, do not guess them from a scaled-down desktop screenshot.

## The backend distinction you must not miss

The existing “current” series is a FUTURE hold-current-level forecast. It is not recorded actual progress. Existing nightly rows are mutable and their input actions are filtered before recalculating per viewer.

You must implement the new immutable period publication and qualified actual reads. Recolouring the old chart, reading the latest snapshot, or changing labels would be an incorrect implementation even if the screenshot looked perfect.

The existing canary had historical facts only through March2026 and ZERO daily revenue snapshot rows on planning inspection. The September mockups are illustrative. Missing original/data states are required, and real populated acceptance needs eligible data.

## Work sequence and division of responsibility

- Follow Tasks0–8 in the implementation plan. Do not jump straight to CSS.
- One implementation owner writes the UI, to prevent competing visual interpretations.
- Independent code reviewer verifies calculations, tenant boundaries, publication and scope.
- Independent visual/test reviewer verifies both PNG states, interactions, viewports and real persisted workflow evidence.
- These are review roles, not an instruction to spawn agents without current authorization. They can be separate authorized sessions. Do not invoke a lower-capability model merely because this handoff describes a successor.
- Complete each task's meaningful tests before the next dependent task. When a focused suite passes, do not repeatedly broaden/rerun tests without a new reason; final broad checks are Task8.

## Concrete traps

- Current60k versus projected84k on21Sep =24k behind, not60k behind the120k month-end estimate.
- Current98k on21Sep overtakes84k; original120k month-end outlook remains unchanged.
- Classify using the frozen range, not the midpoint alone.82k against80–88k is within range, not a warning.
- Keep separate fixed period identities per horizon. Switching tabs never asks the model for a new answer.
- Do not sum duplicate day/week/month/span representations; do not fill missing actuals with zero or invent daily actuals from month totals.
- Preserve branch/channel/dimension/source identity. Existing aggregate totals discard details this comparison needs.
- Never add a total for all branches to the same branches' subtotals.
- No partial scope pretending to be the whole business; no currency conversion or mixed-currency total.
- Planned is intent; crossing the projection does not prove the platform caused the difference.
- When reasons are uncertain, say what to investigate. Unknown source keys map to general advice; do not improvise causal rules.
- Hidden source access must not change the original numbers. Denied projection/source data stays absent.
- Source-owned module readers own statuses and links; this card neither approves nor executes recommendations.
- Do not promote old snapshots to historical forecasts or freeze a new projection after its period starts.
- A forecast row and its publication audit must be atomic; logger-only output is not publication evidence.
- audit_events uses event_name, actor_type and payload, not guessed action/metadata columns.
- Do not import node:crypto/server clients into Client Components via a barrel.
- Stored:true, a Trigger Completed status, or a pretty test fixture is not persisted/live acceptance.

## Environment and shared-tree rules

- Only hosted staging exists. Never supabase start/reset, Docker Postgres, or pnpm db:types.
- pnpm db:migrations:* points at shared staging immediately. Inspect every pending migration in dry-run; do not apply unrelated work.
- New PL/pgSQL must be executed on staging; schema creation alone is not verification.
- Manually maintain only the necessary database.types.ts entries.
- The old snapshot UPSERT and13-month trim remain; neither touches new fixed projections.
- Keep worker/service-role reads out of user request paths. Check membership and source permissions before reads.
- No git stash, no git add ., no repository-wide formatting, no reset of peer files, no git push.
- No new provider spend for chart reads, hover, selector or advice. Load Trigger/Supabase skills before the corresponding implementation task.
- Verify the actual worker deployment target/environment before any deployment. Do not infer it from a local dev page or historical run.

## Required evidence package

Save under docs/verification/overview-growth/:

- execution-baseline.md: branch/head, scoped dirty files, baseline exits, reference hashes, safe schema facts.
- persistence.md: reviewed migration, hosted pgTAP, first calls, concurrent replay, RLS/source denials.
- worker.md: deployed version/environment when authorized, safe before/after projection identities, replay digest stability, honest skipped/refused paths.
- visual-review.md: all anchor measurements, original-versus-browser overlays, arithmetic-only deviations, reviewer decision.
- Screenshots: both canonical states, mobile390/320, full Overview desktop, tooltip, details/table and degraded states.
- functional-review.md: keyboard/touch/selector/no-model-call behavior; permission-safe advice; lower-page regression.
- final-report.md: actual commands/exits, pass/fail/skip split, remaining blockers, migrations/deployments performed or not performed, rollback result.

No credentials, signed URLs, customer payloads or raw provider prompts belong in this package.

## Definition of done

- Spec AC01–AC12 have concrete evidence; originals unchanged.
- Correct real data and tenant boundaries, immutable original, source-qualified advice and accessible interactions.
- Pixel fidelity checked independently before browser snapshots are adopted as regression baselines.
- Full route verified as well as fixture harness; backend persistence verified as well as UI.
- No known high-severity defect, no hidden pending test, no claim that a skip passed.
- Documentation accurately distinguishes completed work from remaining live-data/deployment gates.

## Suggested opening instruction for the coding model

Implement the approved Overview growth-progress handoff in docs/superpowers/prompts/2026-09-18-overview-growth-handoff.md, following its spec, fixed PNGs, data/visual contracts and Tasks0–8. Preserve unrelated work. Do not redesign. Begin with source/schema/baseline verification, then execute the dependency order and report each gate with evidence. Do not claim pixel fidelity from a regenerated image or real workflow success from fixture tests. If a material assumption conflicts with current source evidence, explain the specific conflict and obtain a ruling before changing the plan.

Use that instruction only after the detailed plan and its explicit assumptions have been approved.
