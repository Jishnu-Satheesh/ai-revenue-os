# Verification — organization home (Task 7, 2026-09-11)

No new behavior. This note records the browser + gate evidence for Tasks 1–6,
what could not be proven here, and what stays blocked. Sanitized: environment
variable names only, never values; no signed URLs, auth storage, raw payloads,
private screenshots, credentials, or customer PII.

## Scope proven

- Route `src/app/(platform)/organizations/[organizationId]/overview/page.tsx`
  serving `OrganizationHome` (Tasks 1–5 composition) with retained
  `OrganizationManagement` below (Task 6).
- Spec: `e2e/organization-home.spec.ts` — 3 unauthenticated boundary tests
  (always run) + 16 authenticated tests (operator, viewer, owner/admin;
  skip-gated, see below). No fixture was created, uploaded, or seeded by any
  test; the viewer write test asserts refusal only.

## Commands and exits (verbatim)

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` (`tsc --noEmit`) | 0 | Clean. |
| `pnpm lint` (`eslint .`, full repo) | 1 | 14 errors, 43 warnings — ALL in unrelated files (channels page `require()` import, memory search route, growth-intelligence suites, `.superdesign` scripts). This slice's spec file lints clean (`eslint e2e/organization-home.spec.ts` exit 0). No baseline file touched. |
| `pnpm test` (full `vitest run`) | 1 | 487 files passed, 2 failed; 5439 tests passed, 6 failed, 6 skipped. Failures unrelated to this slice: 5 in `src/modules/campaigns/application/operator-edit.test.ts` (`Provider contract verification is expired: meta_campaign` — a time-expired Meta provider fixture) and 1 in `src/lib/supabase/database.types.test.ts` (shared-tree table-typing drift). Neither file is in this slice; neither was touched. |
| `pnpm build` (`next build`) | 0 | Builds, including `/organizations/[organizationId]/overview`. |
| `pnpm exec playwright test e2e/organization-home.spec.ts` | 0 | 3 passed, 16 skipped (1.5 min). |
| `pnpm exec prettier --check e2e/organization-home.spec.ts` | 1 then 0 | Failed once on the new file; `--write` applied to that file only; re-check clean. |
| `git diff --check` | 0 | Clean. |
| Focused slice re-run (home-service, campaign/asset readers, preview storage, home loader, 3 home component suites, overview page suite, overview + overview-report regression — 11 files) | 0 | 160/160 passed. |

## Playwright detail

Passed without credentials (no database needed):

- `Organization home route protection › an unauthenticated visitor is sent to sign in`
- `Organization home route protection › unauthenticated API callers are refused
  without leaking artwork state` (campaigns collection, campaign detail, assets
  collection: all 401, bodies free of signed-URL/storage/credential markers)
- `Organization home route protection › reduced-motion visitors still reach a
  navigable boundary`

Skipped with reason (a skip is not a pass; exact skip lines recorded in
`.superpowers/sdd/2026-09-11-organization-home-implementation/task-7-report.md`):

- 12 operator tests — `Authenticated Integration Hub E2E requires a seeded
  Supabase project. Set E2E_INTEGRATION_ORGANIZATION_ID,
  E2E_OTHER_ORGANIZATION_ID, and the E2E_OPERATOR_*/E2E_VIEWER_* credentials,
  and add the organization to INTEGRATION_HUB_V1_ORGANIZATION_IDS for the
  server under test.` (no `E2E_*` names are set in this environment; verified
  by variable-name listing only).
- 2 viewer tests — same reason.
- 2 owner/admin tests — `No owner/admin E2E fixture accounts are wired
  (E2E_OPERATOR_* and E2E_VIEWER_* only); owner create/manage flows stay
  unverified.`

## Tenant evidence summary

- Proven here: unauthenticated page + API boundaries refuse without leaking
  artwork/tenant state (3 passing tests above).
- Proven at unit level by Tasks 2–4 suites (160/160 in the focused re-run):
  UUID + organization equality on every row, cross-tenant rows fail safe,
  no signed URL leaves the DTO except through the session's own reads.
- NOT proven end to end here: session-A-permitted preview loads, tenant-B
  campaign/reference refusal over a live session (RLS + application filter),
  and the nonmember-organization absence assertions — all 16 authenticated
  scenarios skipped for missing credentials. The spec encodes them (including
  `page.request` viewer/API calls that genuinely carry the session cookies);
  they need one staging run with the seeded accounts to turn green. Pure
  schema inspection was not substituted for any of this.

## Remaining blocked acceptance

- Authenticated E2E with seeded operator/viewer accounts (owner/admin accounts
  do not exist as fixtures): identity, three campaign states, exact-version
  poster sources, image fallback, 4-cap gallery + dialog, goals/locations
  dialogs, destination gates, activity, management/creation access per role,
  seven widths with sidebar expanded + collapsed, tenant-B isolation.
- Staging-artwork caveat, by design: where staging holds no qualifying
  artwork, the spec asserts the truthful empty/metadata state and never seeds
  sample customer records.
- Unrelated failures to clear separately: the expired `meta_campaign`
  provider fixture in `operator-edit.test.ts`, the `database.types.ts` drift
  test, and the 14 pre-existing lint errors listed above. None belongs to
  this slice.
