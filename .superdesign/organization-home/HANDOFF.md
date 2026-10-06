- **2026-09-11 revision pending:** The user now requests a revenue metrics/current-course-versus-potential section first, with action contribution shares on its right. Campaigns and the other planned sections follow below. Revenue headline is confirmed; profit is separate where supported. Read `docs/superpowers/specs/2026-09-11-organization-home-growth-feasibility.md`. The earlier campaign-first prototype, screenshots and ZIP do not include this addition. This document remains reference material for the lower sections; do not execute the old handoff unchanged. The calculation model and revised full execution plan are not yet approved.

# Organization home — handoff

The user approved **Overview as the home of the organization**, with prominent real campaigns,
creative assets and brand identity. This replaces the earlier analytics/report-led direction.
The implementation belongs to a separate model. **Do not implement until the user authorizes
the written execution plan.** Do not ask them to approve the organization-home purpose again.

## Open the design

- [Interactive design](https://p.superdesign.dev/draft/7950207a-e504-4ee6-82a8-b86aa05b2464)
- [Canvas](https://superdesign.dev/teams/c3d56832-bb79-49b6-910a-6450fc30e0a4/projects/8393ba3e-6abf-458c-a693-bac68f26161b?node=draft-variant-7950207a-e504-4ee6-82a8-b86aa05b2464)
- Open `prototype.html` locally for the interactive standalone reference. Its state selector
  demonstrates populated, new organization, viewer, asset-source error and no-image states.
- All names, numbers, artwork and review states in that HTML are fictional. The application
  must use real authorized records. The file sends no customer data or application mutations.

## Read in order

1. Repository `AGENTS.md` and collaboration board.
2. `docs/superpowers/specs/2026-09-11-organization-home-design.md`.
3. `docs/superpowers/plans/2026-09-11-organization-home-data-contract.md`.
4. `docs/superpowers/plans/2026-09-11-organization-home-visual-contract.md`.
5. `docs/superpowers/plans/2026-09-11-organization-home-implementation.md`.

The ZIP preserves these repository-relative paths. Start the implementation with Task 0,
then proceed sequentially. Each task has exact files, contracts, domain cases and commands.

## Non-negotiable implementation details

- Retain `/organizations/[organizationId]/overview`, the existing AppShell and existing
  `#organization-management` surface. No shared navigation redesign.
- New work is bounded reads and UI composition. No migration, new HTTP route, provider
  execution, model call, automatic research, budget/approval mutation or asset generation.
- Campaigns own their preview readers; Organizations composes safe DTOs. No module cycle.
- Use the existing session client, permissions and feature gates. RLS and private Storage
  remain in force. Signed preview links last 600 seconds and are not persisted or logged.
- No-version campaigns link to the portfolio, never a detail page without a saved proposal.
  Render source links preserve the exact `?version=<bundleVersionId>` query parameter.
- Rendered posters, raw campaign images and reviewed brand references are separate.
  Rendering does not confer human approval. Latest rejected reference => no decorative
  image, and never fall back to its older approval. Ambiguous logo => name-led header.
- The current `/assets` page is not the complete ADR0049 Creative History UI. Do not expand
  this task into implementing that workspace. Home previews use existing rendered-poster
  and brand-reference records; source destinations remain existing routes.
- The four lower workspace entries are navigation summaries, not fabricated health/counts.
  Goals show saved targets, not inferred attainment. Activity is bounded and source-labelled.
- Preserve all peer changes. Never stash, broadly stage, format the repository, run local
  Supabase/Docker, regenerate database types or push.

## Evidence and its limits

- `verification.json`:41 standalone prototype checks passed at 1920,1440,1280,1024,768,390
  and320px, with keyboard/dialog focus, role/empty/failure states and no runtime errors.
- `desktop.png`, `tablet.png`, `mobile.png`, `asset-detail.png`, `new-organization.png`,
  `desktop-lower.png`, `mobile-library.png`, `mobile-attention.png`, `narrow-320.png`:
  browser captures of the fictional design reference.
- 49 existing tests passed across Overview domain/report and Campaign reader/private-preview
  suites during planning. These are baseline checks, not tests of a new implementation.
- `staging-schema-evidence.json`: read-only schema metadata for 8 referenced tables,
  all with RLS enabled;126 column definitions and14 SELECT policy definitions recorded.
  Every field in the planned query recipes exists. No customer rows or signed URLs were read.
- This evidence does **not** prove authenticated browser acceptance, source data availability,
  new reader tenant isolation, private-image signing as a member, or deployed completion.
  Task 7 requires those checks during implementation.
- `source-baseline.json`: inspected working-source SHA256 values and HEAD. Reconcile drift;
  these files were not changed by this design task. Existing Channel work is concurrent.

## Suggested prompt for the implementation model

Implement the organization-home redesign using the approved written plan at
`docs/superpowers/plans/2026-09-11-organization-home-implementation.md`. Read its design,
data and visual companions and `.superdesign/organization-home/HANDOFF.md` first. Reconcile
the current checkout and collaboration board, then follow Tasks 0–7 in order. Preserve peer
work and all specified domain distinctions. Keep the shared shell, Channel/Growth Intelligence
workspaces and existing organization-management behavior. Use real tenant-scoped data only.
Do not invent APIs, fields, previews, progress or business results. Run the listed focused
tests and acceptance gates; report authenticated checks separately from fixture checks.
Stop only for a material contract conflict or a required external dependency; otherwise
complete the authorized tasks and document results. Do not push.

Use that prompt **after** the user has authorized the execution plan.
