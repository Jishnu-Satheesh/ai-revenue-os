# Execution ledger — organization home (Task 0, 2026-09-11)

- Authorized plan: `docs/superpowers/plans/2026-09-11-organization-home-implementation.md`
- Approved split (2026-09-11): Track A lower-home as Tier 2 composition/read slice per
  prototype-adapted exactness with live reads; Track B revenue scenario as Tier 3
  spec/ADR-first, no invented numbers. The design, data-contract, visual-contract, and
  implementation-plan documents each carry a "2026-09-11 revision pending" banner pointing
  at `docs/superpowers/specs/2026-09-11-organization-home-growth-feasibility.md`. The
  campaign-first prototype, screenshots, and ZIP do not include the revenue section.
  Do not execute the old handoff unchanged; the calculation model and revised full
  execution plan are not yet approved.
- HEAD at fix round 1: `fba55fcb9847c6bd15943fd38b1b42cc8d5b9e37`
  (branch `feat/governed-channel-intelligence`, 24 commits ahead of the design-time
  baseline head `9498d84`, which is an ancestor; peer memory forward-repair `fba55fc`
  landed after the initial Task 0 pass at `9083e35`).
- Spec authority: `docs/superpowers/specs/2026-09-11-organization-home-design.md` plus
  the growth-feasibility spec above; data contract; visual contract V01–V18;
  `.superdesign/organization-home/prototype.html` (Juniper Kitchen fiction, visual intent only).

## Source drift vs `.superdesign/organization-home/source-baseline.json`

- Baseline scope note: hashes are SHA-256 over design-time working files, not clean
  HEAD. Re-measured with sha256 at fix round 1: MATCH 14/16. Only
  `src/app/globals.css` and `src/lib/supabase/database.types.ts` differ. (The first
  draft of this ledger compared `git hash-object` SHA-1 values against the SHA-256
  baseline and false-reported 16/16 mismatch; corrected here.)
- Cause, confirmed per file via `git log 9498d84..HEAD`: the 14 matching files have
  zero commits in range; the 2 differing files have exactly one commit each —
  `src/app/globals.css` via `6da6dc2 style(platform)` (thin scrollbars) and
  `src/lib/supabase/database.types.ts` via `1764e77 feat(memory)` (consent-gated
  grounded share). Neither blocks this slice.
- None of the 16 files is dirty in the working tree, so current content equals HEAD
  `fba55fc` for all 16 (re-confirmed via `git status --short` at fix time).
- Consumed-seam check (the only mismatches that could block): all required seams are
  present with their expected signatures — `getOrganizationContext`
  (`src/lib/api/organization-context.ts:12`), `getDigitalTwin`
  (`src/modules/organizations/infrastructure/repository.ts:88`), `toGeneration` and
  `toCampaignListItem` (`src/modules/campaigns/application/studio-view.ts:85,258`),
  `createCampaignReadRepository` (`src/modules/campaigns/infrastructure/repository.ts`
  via `service-factory.ts`), `readCampaignList`
  (`src/modules/campaigns/infrastructure/studio-reader.ts:42`), and the private
  preview signer with `PREVIEW_TTL_SECONDS = 600`
  (`src/modules/campaigns/infrastructure/asset-preview.ts:17,96`).
- Verdict: drift investigated, non-blocking. A peer change to unrelated
  Channel/Growth/Memory files does not block, and no such blocking change was found.

## Own touched paths (this task only, docs, no `src/` production edits)

- `docs/verification/organization-home/progress.md` (this ledger)
- `docs/collaboration/asset-library-and-studio-board.md` (OH0 row + Task 0 log entry only)
- `.superpowers/sdd/2026-09-11-organization-home-implementation/task-0-report.md` (report)

## Preserved working-tree state (not mine, do not sweep into commits)

- Modified: `.cursor/mcp.json`, `.superdesign/organization-home/HANDOFF.md`, board,
  the four organization-home plan/spec docs, `opencode.json`, Growth Intelligence
  workspace/read-model files, `tsconfig.tsbuildinfo`.
- Untracked: `.superdesign/channels/`, `adrs/0056-public-walkthrough-email-capture.md`,
  `docs/design/public-landing/`, public-landing plan/spec docs, growth-feasibility spec,
  Growth Intelligence `your-actions`/`campaign-preparation`/`recommendation-why-dialog`
  components, `supabase/.temp/cli-latest`,
  `supabase/tests/database/zz_scratch_debug_test.sql`. The memory migration
  `20260911162003_business_memory_context_coalesce_syntax_repair.sql`, listed as
  untracked in the first draft, is now committed under peer commit `fba55fc`.

## Baseline checks (exit codes captured verbatim)

- `pnpm exec vitest run src/modules/organizations/application/overview.test.ts src/components/organizations/overview-report.test.tsx src/modules/campaigns/infrastructure/asset-preview.test.ts src/modules/campaigns/infrastructure/studio-reader.test.ts`
  → exit 0. Test Files 4 passed (4); Tests 49 passed (49); duration 9.43s.
- Read-only hosted schema recheck (`information_schema.columns`, public schema, no row
  data, no migration, no push): required column subset present 57/57 across `campaigns`
  (5/5), `campaign_bundle_versions` (4/4), `campaign_poster_renders` (11/11),
  `campaign_assets` (9/9), `creative_asset_reviews` (6/6), `organization_brand_assets`
  (6/6), `organization_brand_asset_versions` (10/10), `campaign_generation_runs` (6/6).
  No missing field; no invented column. RLS/policies re-verified from the checked-in
  `staging-schema-evidence.json` (member-read SELECT policies on all 8 tables plus
  private-bucket Storage object policies for `brand-assets` and `campaign-assets`).

## Actual shared shell (recorded, not changed)

- `src/components/layout/app-shell.tsx`: header `h-16` (64px, pinned, shrink-0);
  `main` (`flex min-h-0 flex-1 flex-col overflow-y-auto`) owns vertical scrolling;
  inner content `mx-auto w-full max-w-[1440px]`. The standalone prototype's mocked
  sidebar/shell is illustrative only; implement only within the route's existing
  content container. No sidebar addition for Asset Library is authorized.

## Remaining gates (for Tasks 1–7)

- Tasks 1–4: new unit tests per data-contract bounds/labels/gates before implementation;
  bounded-query assertions (`.limit(3)` campaigns, `.limit(1)` version/cover/review).
- Task 5: component keyboard/focus/RTL/empty-vs-failed tests.
- Task 6: route composition test (context ID beats forged ID, old finance reads gone,
  management props exact) plus `overview.test.ts` / `overview-report.test.tsx` regression.
- Task 7: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, then Playwright
  `e2e/organization-home.spec.ts` with real credentials; tenant-B isolation proof with
  session A (RLS + application ID filtering both exercised); private screenshots kept
  out of the public handoff. A skip for absent authenticated E2E credentials is not a pass.
- Track B: revenue-scenario spec/ADR approval before any calculation code.
- No migration, no `database.types.ts` edit, no new endpoint/worker/subscription, no
  model call, no stash, no `git add .`, no push at any gate.

## Task 7 — verify experience, tenant boundaries, handoff (2026-09-11, implementer)

- Added (uncommitted): `e2e/organization-home.spec.ts` (3 boundary tests that
  run everywhere + 16 skip-gated authenticated tests: 12 operator, 2 viewer,
  2 owner/admin recording their missing-fixture skip; no fixture created or
  seeded anywhere).
- Added (uncommitted): `docs/verification/organization-home/verification.md`
  (sanitized notes: commands + exits + skips + unrelated failures + tenant
  evidence summary + remaining blocked acceptance; names of E2E variables only,
  never values) and `.superpowers/sdd/2026-09-11-organization-home-implementation/task-7-report.md`.
- Board: Task 7 log entry appended (own entry only).
- Gates: `pnpm typecheck` exit 0; `pnpm lint` exit 1 from 14 pre-existing
  errors in unrelated files (this slice's spec lints clean); `pnpm test` exit
  1 from 6 unrelated failures (5 expired `meta_campaign` provider fixture in
  `operator-edit.test.ts`, 1 `database.types` drift); `pnpm build` exit 0;
  `pnpm exec playwright test e2e/organization-home.spec.ts` exit 0 (3 passed,
  16 skipped — no `E2E_*` credentials set here, skip is not pass);
  `prettier --write` applied to the new spec file only, `git diff --check`
  exit 0; focused 11-file slice re-run 160/160 green.
- Blocked: all 16 authenticated scenarios (session-A previews, tenant-B
  refusal over a live session, per-role flows, seven widths) need one staging
  run with seeded operator/viewer accounts; owner/admin accounts have no
  fixture. Left uncommitted for review.
