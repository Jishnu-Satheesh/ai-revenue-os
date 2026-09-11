# Planning verification — 2026-09-11

- Standalone prototype: `node .superdesign/organization-home/verify.cjs` exited0;
  41 checks passed. Includes seven widths, source/review distinctions, image failure,
  viewer navigation, first-use state, dialog Escape/focus return and no runtime errors.
- Browser captures inspected: desktop, mobile, lower desktop, narrow320. Additional
  asset dialog, first-use, tablet, mobile library and attention captures are included.
- Baseline command: `pnpm exec vitest run src/modules/organizations/application/overview.test.ts src/components/organizations/overview-report.test.tsx src/modules/campaigns/infrastructure/asset-preview.test.ts src/modules/campaigns/infrastructure/studio-reader.test.ts`.
- Baseline exit0:4 files,49 tests passed (18 domain Overview,12 report component,
  6 private preview,13 Campaign reader). The existing Vite CJS deprecation warning remains.
- Hosted staging schema check: read-only metadata query over8 tables,126 column definitions,
  14 SELECT policy definitions. All8 tables have RLS enabled. Every column explicitly
  named in the planned recipes exists. No customer row was queried and no data was written.
- Superdesign import succeeded; exact corrections saved as version2 of draft
  `7950207a-e504-4ee6-82a8-b86aa05b2464`. `canvas.html` is the fetched server draft.
- Plan self-review reconciled permission keys (`channel.read`), the exact Campaign
  `?version=` parameter, module type ownership, state/CTA mapping, missing-version refusal,
  safe preview bounds, latest-review semantics and task-to-spec coverage.
- Intended worktree changes are design artifacts, planning documents and narrowly updated
  design context. No application source, dependency, database, worker or public API edit.
- Not claimed: product implementation, application typecheck/build of a new home,
  authenticated browser acceptance, member-signed image verification, RLS exercise of
  new readers, provider execution or deployment. These remain execution-plan gates.

Spec coverage: masthead V01–V02/Tasks1,3,5,6; campaigns V03–V05/Tasks1,2,5;
attention V06/Tasks1,4,5; goals V07/Tasks1,5; assets V08–V10/Tasks3,5;
destinations V11/Tasks1,4,5; activity V12/Tasks1,5; state handling V13–V15/Tasks1,4–6;
management V16/Task6; access/keyboard/responsiveness V17–V18/Tasks5,7.
