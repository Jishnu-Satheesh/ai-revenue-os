# Opportunity feed — browser verification

Route: `/organizations/[organizationId]/opportunities` (Task 6).

## Session

- Date: 2026-08-15
- Organization: `2dda45b8-82db-4f5f-b17d-611b9bbb7846` (Al Noor Kitchen), the allowlisted development organization.
- Build: `feat/unified-campaign-bundle` at commit `8783d63`, `next dev` on `localhost:3000`.
- Tool: Chrome DevTools MCP. This verification could not be performed when Task 6 was
  committed because that MCP was not connected; it was run as soon as it became available.

## What the feed showed, and why

The feed rendered its empty state. That is the correct current state of the system,
not a failure to load:

```
opportunities: 0   decision_records: 0   campaigns: 0
```

The Decision Engine has never selected a campaign action, because
`campaign-opportunity-source` returns a named `needs_data` while no Meta action
capability is grantable. So there is genuinely nothing waiting on an operator, and
the page says exactly that.

## Checks performed

| Check | Result |
| --- | --- |
| Route renders for a member of the organization | Pass — H1 `Opportunities`, organization name in the description and breadcrumb |
| Console errors or warnings | None |
| Failed network requests | None. One request: `GET /organizations/.../opportunities` → 200 |
| Server Component initial read | Confirmed — no client fetch on first paint |
| API route through the authenticated session | `GET /api/organizations/.../opportunities` → 200, `{"feed":{"groups":[],"totalCount":0,"answeredCount":0}}` |
| Empty state copy | Explains *why* nothing is listed rather than showing a blank panel |
| Mobile 390 x 844 (device emulation, DPR 3, touch) | No horizontal overflow; `scrollWidth` equals viewport width |
| Desktop 1440 x 900 | No horizontal overflow |
| Heading structure | Single `h1`; tier headings are `h2` and appear only when a tier has items |
| Organization-scoped navigation entry | Present, pointing at `/organizations/<id>/opportunities` |

Screenshot: `opportunities-feed-390.png` (mobile viewport).

## Not verified, and why

**The populated feed was not browser-verified.** Tier grouping, the impact range with
its evidence tier, expiry rendered in the organization timezone, the blocked-reason
copy, and the answer controls are covered by nine component tests in
`src/components/opportunities/opportunity-feed.test.tsx`, but they have not been seen
in a real browser against real rows.

Seeding one was considered and deliberately rejected. An opportunity requires a
`decision_records` row with outcome `action_selected`, and that table carries an
append-only trigger — the row could be created but never removed. The result would be
a permanent record in the staging ledger asserting that the engine selected an action
it never selected. A verification screenshot is not worth a false entry in the decision
ledger.

This check should be repeated once the Decision Engine can genuinely select a campaign
action, which requires the Meta capability work in Tasks 15–17. Until then the empty
state is the only state that exists, and it is verified.

## Pre-existing findings, untouched by this change

- The account-wide `/opportunities` link in the global sidebar group is dead: no such
  route exists in this worktree. It is removed by the `feat/business-memory` navigation
  restructure, which is pending merge, so it was left alone rather than patched here.
