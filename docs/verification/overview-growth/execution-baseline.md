# Overview growth — execution baseline (Task 0, 2026-09-18)

Evidence-only baseline. No source file was changed, no migration was pushed,
no data was seeded, no model/provider call was made.

Semantics: Current means reported cumulative revenue; Projected means the
frozen estimate; both compare the same date, period, currency, and scope,
and the original projection stays fixed for its period.

## Timing assumption (A01)

- Next-day rolling bootstrap: the first successful eligible build establishes
  scheduleOriginDate as the NEXT organization-local day after issuedAt, with
  fixed rolling periods per horizon. Recorded as the plan's explicit proposed
  assumption, not a reinterpretation to calendar months.

## Branch and head

- Branch: feat/governed-channel-intelligence
- HEAD: 6d9521160b7b7de8d71b5bc0c147b1a032cc6a75
  (subject: fix(campaigns): review findings - allowlist-safe tick log, reason
  assertion, row-finding warn)
- `git status --short`: tree is dirty with unrelated peer work (modified and
  untracked entries across campaigns, growth-intelligence, invitations,
  settings, marketing, and other areas). No dirty file was reset, stashed,
  staged, or committed by this task. The full redacted manifest (paths plus
  M/?? flags only, no values or credentials) is pasted below; the working
  tree carries other sessions'   work and must be left untouched.

## Dirty-file manifest (git status --short, 2026-09-18, paths + flags only)

```
 M .cursor/mcp.json
 M .github/workflows/ci.yml
 M .gitignore
 M .superdesign/resume.json
 M README.md
 M adrs/0060-transparent-action-scenario-for-home-revenue.md
 M context/00-vision.md
 M context/03-architecture.md
 M context/05-module-map.md
 M context/06-multi-tenancy-and-security.md
 M context/13-ui-ux-context.md
 M context/ui-context.md
 M docs/collaboration/asset-library-and-studio-board.md
 M docs/superpowers/specs/2026-09-11-organization-home-revenue-scenario.md
 M opencode.json
 M package.json
 M pnpm-lock.yaml
 M progress-tracker.md
 M specs/021-public-landing-page.md
 M specs/022-growth-intelligence.md
 M src/app/(auth)/login/page.tsx
 M src/app/(platform)/organizations/[organizationId]/growth-intelligence/page.tsx
 M src/app/layout.tsx
 M src/app/page.tsx
 M src/components/accounts/accept-invitation.tsx
 M src/components/campaigns/campaign-proposal-card.test.tsx
 M src/components/campaigns/campaign-proposal-card.tsx
 M src/components/campaigns/request-campaign-research.tsx
 M src/components/growth-intelligence/business-performance-card.test.tsx
 M src/components/growth-intelligence/business-performance-card.tsx
 M src/components/growth-intelligence/data-gaps.tsx
 M src/components/growth-intelligence/growth-intelligence-workspace.test.tsx
 M src/components/growth-intelligence/growth-intelligence-workspace.tsx
 M src/components/growth-intelligence/insights-list.tsx
 M src/components/growth-intelligence/intelligence-actions.tsx
 M src/components/growth-intelligence/intelligence-card.test.tsx
 M src/components/growth-intelligence/intelligence-card.tsx
 M src/components/growth-intelligence/market-watch-projects.test.tsx
 M src/components/growth-intelligence/market-watch-projects.tsx
 M src/components/growth-intelligence/new-research-dialog.tsx
 M src/components/growth-intelligence/report-reader.tsx
 M src/components/growth-intelligence/workspace-sections.test.tsx
 M src/components/layout/sidebar.test.tsx
 M src/components/layout/sidebar.tsx
 M src/components/marketing/content.test.ts
 M src/components/marketing/content.ts
 M src/components/marketing/hero.tsx
 M src/components/marketing/marketing-footer.test.tsx
 M src/components/marketing/marketing-nav.tsx
 M src/domain/access/invitations.ts
 M src/domain/access/permissions.ts
 M src/lib/env.ts
 M src/lib/routes.ts
 M src/lib/supabase/database.types.ts
 M src/modules/accounts/application/email.test.ts
 M src/modules/accounts/application/email.ts
 M src/modules/accounts/application/invitation-email.ts
 M src/modules/analysis/application/channels-overview.test.ts
 M src/modules/analysis/application/channels-overview.ts
 M src/modules/analysis/application/performance-card-cache.test.ts
 M src/modules/analysis/application/performance-card-cache.ts
 M src/modules/analysis/application/ports.ts
 M src/modules/analysis/infrastructure/read-repository.test.ts
 M src/modules/analysis/infrastructure/read-repository.ts
 M src/modules/growth-intelligence/application/live-preview.test.ts
 M src/modules/growth-intelligence/application/live-preview.ts
 M tsconfig.tsbuildinfo
?? .env.productionn
?? .github/workflows/deploy-production.yml
?? .github/workflows/deploy-staging.yml
?? .superdesign/market-monitoring-experience/
?? .superdesign/overview-growth/
?? .tmp-gi-canary-recon.mjs
?? .tmp-worker-drafting-rehearsal.mjs
?? adrs/0063-aggregate-sourced-performance-card.md
?? adrs/0064-fixed-growth-projection-progress.md
?? docs/superpowers/plans/2026-09-15-live-only-brave-preview-implementation.md
?? docs/superpowers/plans/2026-09-17-campaign-deliverables-studio-launch-cadence.md
?? docs/superpowers/plans/2026-09-18-overview-growth-data-contract.md
?? docs/superpowers/plans/2026-09-18-overview-growth-implementation.md
?? docs/superpowers/plans/2026-09-18-overview-growth-visual-contract.md
?? docs/superpowers/prompts/2026-09-18-overview-growth-handoff.md
?? docs/verification/growth-intelligence/2026-09-13-market-monitoring-workflow-audit.md
?? docs/verification/overview-growth/
?? specs/027-overview-growth-progress.md
?? src/app/(invitation)/organization-invitations/
?? src/app/(platform)/organizations/[organizationId]/settings/
?? src/app/api/organization-invitations/
?? src/app/api/organizations/[organizationId]/invitations/
?? src/app/api/organizations/[organizationId]/members/
?? src/app/api/organizations/[organizationId]/session/
?? src/components/campaigns/request-campaign-research.test.tsx
?? src/components/growth-intelligence/market-watch-live-preview.test.tsx
?? src/components/growth-intelligence/market-watch-live-preview.tsx
?? src/components/growth-intelligence/merged-opportunities.test.ts
?? src/components/growth-intelligence/merged-opportunities.ts
?? src/components/growth-intelligence/merged-recommendations.tsx
?? src/components/organizations/accept-organization-invitation.test.tsx
?? src/components/organizations/accept-organization-invitation.tsx
?? src/components/organizations/add-member-dialog.tsx
?? src/components/organizations/organization-session.ts
?? src/components/organizations/organization-settings.tsx
?? src/components/organizations/team-members.test.tsx
?? src/components/organizations/team-members.tsx
?? src/components/ui/card-accents.tsx
?? src/modules/accounts/application/invitation-email.test.ts
?? src/modules/organizations/application/invitations.test.ts
?? src/modules/organizations/application/invitations.ts
?? supabase/.temp/cli-latest
?? supabase/migrations/20260913110000_creative_history_object_retry.sql
?? supabase/migrations/20260917090000_organization_invitations.sql
?? supabase/tests/database/creative_history_object_retry_test.sql
?? supabase/tests/database/organization_invitation_test.sql
?? supabase/tests/database/zz_scratch_debug_test.sql
```

## Frozen references (verified, never regenerated)

- Command: sha256sum
  .superdesign/overview-growth/approved-behind.png
  .superdesign/overview-growth/approved-ahead.png — exit 0.
- approved-behind.png: 887a0205cd9dca3662bcad87298a33bffd2b9a91fc0172a4de44382abf70910e
  (1672 x 940) — MATCHES .superdesign/overview-growth/REFERENCE.md.
- approved-ahead.png: 0a1e4d5985d1d64bf26daee9f10eeeec26bc9193816421163032e17e558eee7c
  (1673 x 940, one-pixel original width difference) — MATCHES REFERENCE.md.
  Per REFERENCE.md line 7, the one-pixel canvas-width difference is original
  and approved, not a change.
- Both images were opened and viewed: blue solid current line with filled dots
  vs emerald dashed projected line with hollow dots, 7/14/21/30 Sep dates,
  behind state (60k vs 84k, 24k gap) and ahead state (98k vs 84k, 14k ahead),
  fixture-only "Design preview - Illustrative data" label outside the card.
- Gate: hashes match, so work proceeds. No image was regenerated or modified.

## Source schema facts (from migration files, D02/D04 inputs)

- audit_events live columns (20260807200000 + 20260817150000):
  organization_id uuid NULLABLE (not-null dropped for account-scoped rows),
  account_id uuid nullable, event_name text, actor_type audit_actor_type,
  actor_id uuid nullable, entity_type text, entity_id uuid nullable,
  correlation_id uuid, payload jsonb, occurred_at timestamptz.
  Scope check: organization_id or account_id must be set.
  Live index: audit_events_organization_idx (organization_id, occurred_at desc)
  plus audit_events_account_idx where account_id is not null.
- audit_actor_type enum: ('user', 'system', 'ai') — created in 20260807200000.
- private.has_organization_permission(target_organization_id uuid,
  target_permission text) returns boolean — SQL, stable, security definer,
  empty search_path; resolves via organization_role_permissions against
  private.effective_organization_role (20260817141000).
- normalized_metrics quality_tier values: measured | derived | estimated |
  assumed (20260810130000). No guessed column: verified in file.
  Reconciliation columns on normalized_metrics (20260823090000):
  reconciliation_state in (current, blocked_overlap, excluded),
  reconciliation_digest nullable sha256.
- exact_range_metric_observations quality metadata (20260821080933):
  quality_state in (complete, partial), completeness_state in (complete,
  partial) on observation rows. The wider failed/unavailable values exist
  only on integration_report_projection_runs, not on observation rows.
  Reconciliation columns on exact-range rows (20260821115647):
  reconciliation_state in (current, blocked_overlap, excluded, superseded),
  reconciliation_digest nullable sha256.
- Revenue snapshot table: public.organization_revenue_snapshots
  (20260916130000): id, organization_id, snapshot_date,
  unique (organization_id, snapshot_date), member-read-only RLS, no client
  write policy, service-role worker writes. No audit trigger by design.
- 13-month trim fact: application constant REVENUE_SNAPSHOT_KEEP_MONTHS = 13
  in src/modules/organizations/application/revenue-snapshot.ts; worker calls
  trimRevenueSnapshots(supabase, organizationId, keepSinceDate) in
  src/trigger/revenue-snapshots.ts. The trim deletes only snapshot rows and
  must never touch the future immutable projection table.
- Ledger indexes inspected: normalized_metrics_revision_idx,
  normalized_metrics_current_revision_idx (covers reconciliation standing),
  normalized_metrics_series_idx, normalized_metrics_subject_idx,
  normalized_metrics_branch_idx, normalized_metrics_ingestion_run_idx;
  exact_range_metric_observations_read_idx (org, metric, branch, channel,
  period_start desc, live rows only),
  exact_range_metric_observations_reconciliation_lookup_idx.

## Bounded read-only staging coverage (repeated discovery, no values printed)

- Method: DATABASE_URL from .env.local through the repo resolver pattern
  (replace :6543 with :5432), READ ONLY transaction, 10-second statement
  timeout, ROLLBACK at end. No write, migration, seed, or model call.
- Canary org 2dda45b8-82db-4f5f-b17d-611b9bbb7846, revenue.gross shared
  definition present.
- normalized_metrics revenue.gross, live-current rows
  (superseded_by_id null, reconciliation_state current), re-checked
  2026-09-18 with the same read-only bounded method: grain day only, 258
  rows, 5 distinct channels, 2 distinct branches, 1 currency, earliest
  period_start 2025-12-31 20:00:00+00, latest period_end 2026-08-09
  20:00:00+00 (raw UTC instants; local-day completeness not claimed).
  Bounds are raw and prove no complete September coverage. (Counts/channels
  have moved since the planning discovery snapshot, which saw day grain,
  2 channels, raw bounds 2025-12-31 through 2026-03-31.)
- exact_range revenue.gross, live current rows: exactly 1 row, 1 channel,
  2026-01-01 through 2026-02-28 inclusive.
- organization_revenue_snapshots for canary: 0 rows.
- Conclusion unchanged from planning: no complete September actuals, no
  fixed projection table yet, September PNGs remain illustrative fixtures.
  No amounts, workbook contents, credentials, prompts, or signed URLs were
  printed or stored.

## Baseline test run (exact command, exit 0)

- pnpm exec vitest run
  src/domain/organizations/revenue-scenario.test.ts
  src/modules/organizations/application/revenue-snapshot.test.ts
  src/modules/organizations/infrastructure/revenue-snapshot-repository.test.ts
  src/modules/organizations/infrastructure/home-loader.test.ts
  src/modules/organizations/application/home-service.test.ts
  src/components/organizations/home/home-revenue.test.tsx
  src/components/organizations/home/organization-home.test.tsx
  src/trigger/revenue-snapshots.test.ts
- Result: 8 test files passed, 129 tests passed, 0 failed. Duration ~25s.
  (Recharts jsdom width warnings in component suites are pre-existing noise.)

## Typecheck and lint (exact exits, unrelated failures left alone)

- pnpm typecheck: FAILS, exit code 2, with 4 pre-existing errors in peer
  files outside this slice (sites re-verified in file, left unfixed):
  src/app/(platform)/organizations/[organizationId]/settings/page.tsx(26,8)
  TS2741 Property 'segment' missing on RegisterRouteLabel;
  src/modules/organizations/application/invitations.ts(277,69) TS2353
  'userId' not in LogContext; invitations.ts(296,64) TS2353 same;
  invitations.ts(335,27) TS2551 'organization_id' not on validation result
  (did-you-mean organization_name). No error mentions any slice file.
- Focused eslint over the 8 baseline test files plus their 8 implementation
  counterparts: exit 0, 0 errors, 1 pre-existing warning
  (home-revenue.test.tsx unused `container` variable). Nothing was fixed here.

## Browser and Trigger tooling availability

- Playwright: installed, version 1.55.0; Chromium builds present in
  ms-playwright cache (chromium-1187/1228 + headless shells). Browser
  inspection will use Playwright.
- Chrome DevTools MCP: NOT reachable from this session; never claimed as
  run. No browser check was performed in this task beyond viewing the two
  frozen PNGs.
- Trigger SDK: @trigger.dev/sdk 4.6.0 installed. Skill
  .claude/skills/trigger-authoring-tasks/SKILL.md present (plus getting
  started, realtime, chat-agent, advanced, cost-savings skills).
- Vitest 2.1.8, Node v22.18.0.

## Capability gaps and explicit non-claims

- No authenticated live-data acceptance was performed or claimed.
- No worker deployment, staged publication run, or migration dry-run was
  performed (zero staging mutation in this task by ruling).
- Typecheck is red on the tree for unrelated peer reasons; later tasks must
  re-check and must not silently absorb those errors.
- The tree's unrelated dirty files were not reviewed; later tasks must keep
  path-limited staging and never sweep peer hunks.
