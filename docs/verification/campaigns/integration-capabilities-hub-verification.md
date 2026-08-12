# Task 2 frontend verification — governed Integration Hub capabilities

Verified with Chrome DevTools against the running application on 2026-08-12.

## Environment

- Route: `/organizations/2dda45b8-82db-4f5f-b17d-611b9bbb7846/integrations`
- Organization: allowlisted in `INTEGRATION_HUB_V1_ORGANIZATION_IDS`, three branches, no
  pre-existing Google Business Profile connection.
- Remote database carries migrations `20260812100000`, `20260812103000`, `20260812104500`,
  and `20260812105000`.

## Capability gating observed end to end

| Step | Expected | Observed |
| ---- | -------- | -------- |
| Before connecting | Catalog shows `Setup required` | `Setup required` — "Connect and verify this provider for the organization." |
| After connecting, before mapping | Provider blocked, no usable grant | `Blocked` — "No current organization grant proves a usable capability." |
| Grant detail while unmapped | Both read grants blocked with recovery | `read_google_business_profile` and `read_reviews` both `Blocked`, recovery "Map the provider resource to an organization branch.", each with a focusable "Why?" control |
| Fixture resources seeded | Exactly two deterministic unmapped rows | `Harbor House` (`locations/fixture-harbor-house`) and `River Market` (`locations/fixture-river-market`), both `Unmapped` / `No branch` |
| After mapping one resource | Grants become usable | Mapped `Harbor House` to branch `Al Barsha`; both grants flipped to `Available`, "Branch mappings saved." announced in a live region |
| Explicit reconnect | Mapping and grants preserved | `Harbor House` remained `Mapped` / `Al Barsha`, `River Market` remained `Unmapped`, both grants remained `Available` |

The connect call returned `201` and the reconnect call returned `200`, so the API
distinguishes creation from reconnection.

## Typed model surfaced in the UI

Character `data_source`, effect `read`, maturity `read-only`, adapter version `1`, and
`Scopes: none` are rendered per capability. The fixture provider stays read-only and no
Meta or Telegram definition appears. Catalog copy states that a provider action is usable
only when grant, contract, adapter, evidence, scopes, mapping, and policy all agree.

## Console, network, responsiveness

- No console errors or warnings. One Chrome issue: "A form field element should have an
  id or name attribute (count: 8)" from the mapping comboboxes, which do carry accessible
  names through `aria-label`.
- All seven document/fetch requests returned `200`/`201`. No failed request.
- No horizontal overflow at 390 px or 1440 px (`scrollWidth` equals `innerWidth` at both).

## Pre-existing findings, not introduced by this task

Both were confirmed present at `HEAD` and untouched by the Task 2 diff. They are recorded
here rather than fixed inside this task's scope.

1. `src/components/integrations/catalog-tab.tsx` — reconnecting an existing connection
   opens a dialog titled "Create the … fixture connection?" whose body says "This creates
   a deterministic fixture connection", and the success toast says "Fixture connection
   created." The API correctly treats this as a reconnect (`200`, mappings preserved), so
   the mismatch is copy only.
2. `src/components/integrations/connections-tab.tsx` — on narrow viewports the connection
   detail lives in a `Sheet` that opens only on tap, while the auto-selected connection row
   still reports `aria-pressed="true"` on first load. A screen-reader user on a phone is
   told the row is pressed while the panel it controls is closed.
