# Live-only Brave Preview — Implementation Plan

Date: 2026-09-15
Status: Approved for implementation (user approved live-only direction + details)
Tier: Tier 3 small — new ephemeral preview path, exception to Spec 022 ss 4.2 / 8.2, no stored evidence.

## Goal

Show fresh Brave results on screen and discard them. Store nothing. Keep the stored research pipeline fail-closed until the Order Form storage line arrives.

Like a library reading room: read at the table, no photocopy to take home.

## Global Constraints

- TypeScript strict, Next.js App Router, React Server Components by default.
- All user-facing UI uses shadcn/ui primitives only (Dialog, Card, Alert, Badge, Button). No bare HTML controls where a primitive exists.
- Zod validation at every external boundary. Typed DomainError codes only. Never leak provider errors, keys, or snippet bodies to logs or client errors.
- UI never calls Brave directly. Server route calls Brave only via the fixed allowlisted endpoint, zero redirects, single-shot fetch.
- Tenant scope is server-owned: organizationId from session context only, branchId verified to belong to that org. Viewer denied, stranger org denied.
- No DB write, no event, no cache, no analytics containing snippet text. Logs carry counts + latency + cost only.
- No new migration, no RLS change, no Trigger task, no synthesis, no Claim persistence.
- Cap per click: max 3 queries, max 5 results each. Manual button click only, no auto-fetch, no polling. Response sets Cache-Control: no-store + x-correlation-id.
- Attribution on every result: title + URL + publisher + retrieval time. Copy states "Live preview — not saved" and "Unverified leads, not evidence".
- Stored Market Watch, Insights, Recommendations, Campaign drafts untouched.

## Tasks

### Task 1: Live-preview app service (pure, server-only)

File: src/modules/growth-intelligence/application/live-preview.ts + live-preview.test.ts

- Export Zod schemas: livePreviewInputSchema (branchId uuid, topics max 3 each 1-160 chars, competitors max 2 each 1-160 chars, at least 1 topic or competitor), livePreviewQuerySchema (slotKey, text 1-160 chars, maxResults 1-5), livePreviewResultItemSchema (title 1-200, url public http without credentials, publisher 1-200, snippet 1-1000, retrievedAt datetime).
- Export buildLivePreviewQueries(input): max 3 deterministic queries, sanitized via same safePhrase rules as query-plan (strip control chars, prompt-injection phrases, query operators, non-letter/number except & ' -), deduped case-insensitively, throws DomainError VALIDATION_ERROR on empty after sanitize or over cap.
- Export parseLivePreviewResponse(json unknown, retrievedAt string): validates Brave web/results envelope (title, url, description), normalizes citation URLs via normalizePublicCitationUrl, drops unsafe URLs, caps at 15 items total, never throws raw provider text.
- No node:* imports reachable from client, no DB import, no fetch inside service. Pure functions only.
- Tests: caps enforced, dedupe, sanitization strips operators/injection, unsafe URLs dropped, over-cap throws, parser caps + normalizes + rejects credentials.

### Task 2: Live-preview POST route (server-only, no storage)

File: src/app/api/organizations/[organizationId]/market-research/live-preview/route.ts + route.test.ts

- POST only. Params: organizationId uuid. Body: livePreviewInputSchema + idempotencyKey (16-200 chars, accepted but unused except for client retry safety, never persisted).
- Steps: getOrganizationContext, assertGrowthIntelligenceAccess(org, market), require growth_intelligence.manage (403 otherwise), parse correlation, validate params + body via Zod.
- Verify branchId belongs to org via supabase from branches select id where organization_id + id, single row. Any miss throws TENANT_SCOPE_ERROR (mapped to 404 by marketProfileApiErrorResponse).
- Read BRAVE_SEARCH_API_KEY from process.env directly (not via env.ts which lacks it). Missing key throws FEATURE_NOT_AVAILABLE with safe message "Live preview is not configured." Never log key presence.
- Build queries via Task 1 service. For each query build URL via buildBraveSearchRequestUrl(slot, 5), call createBraveSearchTransport({apiKey}).search once per query with AbortSignal timeout 10s, redirect manual already enforced. Byte budget 256 KiB per call, fail that query only on over-budget/timeout, continue others.
- Parse each JSON body via parseLivePreviewResponse, merge, slice 15. Return { results, queryCount, resultCount, retrievedAt, correlationId, liveOnly: true, disclaimer }.
- Headers: x-correlation-id + Cache-Control: no-store. Errors via marketProfileApiErrorResponse. Logger carries organizationId + correlationId + errorCode + queryCount only, never snippet/title/url/key.
- Tests (mock fetch + supabase): viewer denied 403, stranger org 404, cross-org branch refused, invalid body 400, missing key 404-safe, success returns attribution + no-store + liveOnly true, provider failure degrades to 422-safe without leaking, verifies zero DB writes (supabase rpc/insert/update never called).

### Task 3: Live preview panel UI (client, explicit no-save copy)

File: src/components/growth-intelligence/market-watch-live-preview.tsx + market-watch-live-preview.test.tsx

- Props: organizationId, branchId (string uuid or null), canManage boolean. Renders nothing if !canManage.
- Uses shadcn Dialog + Button trigger "View live results", Card list, Alert for disclaimer + errors, Badge for publisher. TanStack Query useQuery disabled by default, enabled on dialog open + button click only. Query key ["live-preview", organizationId, branchId].
- Form: two small inputs (topics comma-separated max 3, competitors max 2) with Zod-light client check, submit calls POST route with branchId + topics + competitors + idempotencyKey crypto.randomUUID().
- States: idle copy "Shows fresh results, saves nothing.", loading skeleton, empty "No results for these terms.", error honest message, success list with title link (target blank relnoreferrer), publisher badge, snippet, URL hostname, retrieved time. Footer disclaimer "Live preview — not saved. Unverified leads, not evidence. Cannot create Insights or Recommendations from this view."
- No auto-fetch on mount, no polling, no cache persistence (gcTime 0, staleTime 0). No snippet in console or analytics.
- Tests: manage-gated render, no fetch on mount, click triggers fetch once, empty/error/success states, disclaimer visible, no persistence call (fetch only to live-preview route).

### Task 4: Page wiring + docs (narrow)

Files: src/app/(platform)/organizations/[organizationId]/growth-intelligence/page.tsx (mount), specs/022-growth-intelligence.md (narrow note), docs/collaboration/asset-library-and-studio-board.md (append entry)

- Page: import panel, render beside MarketWatch header when branchId selected and canManage true, pass organizationId + branchId + canManage. No change to stored watch logic, no new data fetch on page load.
- Spec: append 3-line exception note to ss 4.2 + 8.2 stating ephemeral live-only preview is allowed, stores nothing, creates no evidence, disabled without manage permission.
- Board: append one HTML comment entry with date, files touched, no-storage confirmation, no stash/push.
- Tests: page still renders stored watch when preview absent, preview mounted only with branch + manage (covered by Task 3 tests, no new page test needed beyond typecheck).
