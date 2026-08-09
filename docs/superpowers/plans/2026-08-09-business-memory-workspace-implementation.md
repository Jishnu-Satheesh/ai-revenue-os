# Business Memory Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the authenticated, sidebar-linked Business Memory workspace with governed search, timeline, lessons, review, and provenance inspection.

**Architecture:** A server-only memory API composition module creates the existing memory service and retrieval port with the caller's authenticated Supabase client; thin route handlers validate requests and retain the RLS boundary. The Next.js Server Component owns the first snapshot read, while a focused client workspace uses organization-scoped TanStack Query for reads and non-optimistic mutations. The workspace is cache-free: PostgreSQL/RLS remains every request's source of truth.

**Tech Stack:** Next.js App Router, React 19, TypeScript strict mode, Supabase SSR session client and RLS, Zod, TanStack Query v5, TanStack Form v1, shadcn/ui New York/Radix, Vitest, Chrome DevTools MCP, pnpm on Node 22.

## Global Constraints

- Use `PATH=/home/spy/.local/node/bin:$PATH` with pnpm; do not use npm/yarn.
- Preserve tenant isolation twice: route organization context plus the authenticated Supabase/RLS client. User-facing routes must not create a service-role client.
- Keep cache Tasks 8, 9, and 13 deferred. Search responses set `servedFromCache: false` and omit `builtAt`.
- Validate every route/body boundary with the existing Zod schemas; mutation bodies require non-empty idempotency keys.
- Never return a retrieval-log row, provider payload, internal error cause, or body withheld by the caller's sensitivity ceiling.
- Use installed shadcn/ui primitives and semantic Tailwind tokens. No bare interactive controls, raw status colours, external fonts, gradients, or invented analytics.
- Browser-only permission hints use `hasMemoryPermission`; service, authenticated route, and RLS enforcement remain authoritative.
- No optimistic UI for verification, rejection, promotion, or supersession. Invalidate only the organization-scoped queries touched after success.
- Use a `Dialog` for Inspect chain and an `AlertDialog` for destructive/review decisions. Dialogs must have titles and return focus to their triggering action.
- If Chrome DevTools reaches the login gate, stop immediately and request the user's authenticated session; do not probe, seed cookies, or bypass authentication.

---

## File structure

| File                                                            | Responsibility                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/modules/memory/application/api.ts`                         | Server-only composition and route runner for authenticated Memory APIs.              |
| `src/modules/memory/application/api-schemas.ts`                 | Route Zod schemas for route parameters, item detail, lesson and timeline filters.    |
| `src/modules/memory/application/service.ts`                     | RLS-aware item detail/chain read model and source-filtered timeline service methods. |
| `src/modules/memory/application/ports.ts`                       | Minimal repository port additions for chain/link reads and source filters.           |
| `src/modules/memory/infrastructure/{repository,persistence}.ts` | Authenticated Supabase implementations of the new read methods.                      |
| `src/app/api/organizations/[organizationId]/memory/**`          | Thin HTTP adapters over the route runner.                                            |
| `src/app/(platform)/organizations/[organizationId]/memory/**`   | Authenticated page, loading, and safe error presentation.                            |
| `src/components/memory/**`                                      | Query contracts, four views, result/provenance UI, Dialog, and governed forms.       |
| `src/components/layout/{sidebar,route-context}.tsx`             | Business Memory navigation and breadcrumb label.                                     |

### Task 1: Authenticated Memory API and detail read model

**Files:**

- Create: `src/modules/memory/application/api.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/search/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/timeline/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/lessons/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/items/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/items/[itemId]/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/items/[itemId]/supersede/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/proposals/[itemId]/confirm/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/proposals/[itemId]/reject/route.ts`
- Create: `src/app/api/organizations/[organizationId]/memory/routes.test.ts`
- Modify: `src/modules/memory/application/api-schemas.ts`
- Modify: `src/modules/memory/application/ports.ts`
- Modify: `src/modules/memory/application/service.ts`
- Modify: `src/modules/memory/infrastructure/repository.ts`
- Modify: `src/modules/memory/infrastructure/persistence.ts`
- Test: `src/modules/memory/application/service.test.ts`
- Test: `src/modules/memory/infrastructure/repository.test.ts`

**Interfaces:**

- Consumes: `getOrganizationContext`, `createEventPublisher`, `createEmbeddingProvider`, `createMemoryRetrieval`, `createMemoryRepository`, `createSupabaseMemoryPersistence`, `createSupabaseMemoryPromotionTransactionPort`, and the existing Task 10 transaction RPCs.
- Produces: `createMemoryWorkspaceApi({ supabase, actor })`, `runMemoryRoute(...)`, `memoryRequest(...)` response shapes, `MemoryItemDetail`, and route endpoints safe for the client workspace.

  ```ts
  type MemoryItemDetail = {
    item: MemoryItemView;
    chain: readonly MemoryItemView[];
    links: readonly {
      id: string;
      relation: "derived_from" | "supports" | "contradicts" | "explains";
      direction: "from" | "to";
      relatedItemId: string;
    }[];
  };
  ```

- [ ] **Step 1: Write the failing API/service tests.**

  Add test cases that construct no production Supabase clients and assert the public contract:

  ```ts
  it("rejects a non-member before constructing the memory workspace API", async () => {
    getOrganizationContext.mockRejectedValueOnce(
      new DomainError("AUTHORIZATION_ERROR", "You do not have access to this organization."),
    );

    const response = await getSnapshot(new Request("http://localhost"), organizationParams());

    expect(response.status).toBe(403);
    expect(createMemoryWorkspaceApi).not.toHaveBeenCalled();
  });

  it("keeps search cache-free and binds allowance to the authenticated role", async () => {
    const response = await search(
      jsonRequest("POST", "/memory/search", { query: "opening hours" }),
      organizationParams(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      servedFromCache: false,
      retrievalMode: "lexical",
    });
    expect(retrieval.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ sensitivityAllowance: "internal", purpose: "operator_search" }),
    );
  });

  it("refuses a viewer mutation and a mismatched item route before a service write", async () => {
    getOrganizationContext.mockResolvedValueOnce(viewerContext);
    const viewerResponse = await createItem(
      jsonRequest("POST", "/memory/items", validNote),
      organizationParams(),
    );
    const mismatchResponse = await updateItem(
      jsonRequest("PATCH", `/memory/items/${itemId}`, { ...validUpdate, itemId: otherItemId }),
      itemParams(),
    );

    expect(viewerResponse.status).toBe(403);
    expect(mismatchResponse.status).toBe(400);
    expect(service.createItem).not.toHaveBeenCalled();
    expect(service.updateItem).not.toHaveBeenCalled();
  });
  ```

  Add a service/repository regression that an item detail follows only tenant-scoped,
  RLS-visible predecessor/successor rows to a maximum of 32 hops and never exposes a
  link target unavailable to the caller. Add route cases for malformed JSON, every
  missing mutation idempotency key, rejected search `idempotencyKey`, omitted response
  `body` on a withheld result, and a safe 404 for cross-tenant item IDs.

- [ ] **Step 2: Run the new tests and verify RED.**

  Run:

  ```bash
  PATH=/home/spy/.local/node/bin:$PATH pnpm vitest run \
    src/app/api/organizations/[organizationId]/memory/routes.test.ts \
    src/modules/memory/application/service.test.ts \
    src/modules/memory/infrastructure/repository.test.ts
  ```

  Expected: route-module imports or the new detail/chain methods are absent, so the
  tests fail for the requested capability rather than a test setup error.

- [ ] **Step 3: Implement the smallest authenticated composition boundary.**

  In `api.ts`, construct exactly one authenticated repository from the session client
  and bind the route actor once:

  ```ts
  export function createMemoryWorkspaceApi(input: {
    supabase: SupabaseClient<Database>;
    actor: MemoryActor;
  }) {
    const repository = createMemoryRepository(createSupabaseMemoryPersistence(input.supabase));
    const service = createMemoryService({
      repository,
      events: createEventPublisher(),
      transactions: createSupabaseMemoryPromotionTransactionPort(input.supabase),
      logger,
    });
    const retrieval = createMemoryRetrieval({
      repository,
      embeddings: createEmbeddingProvider(),
      ceilingFor: () => operatorCeiling(input.actor),
      actorFor: () => ({ actorType: "user", actorId: input.actor.userId }),
      logger,
    });
    return { service, retrieval };
  }
  ```

  `runMemoryRoute` must parse a UUID route object, obtain `getOrganizationContext`,
  generate/validate `x-correlation-id`, pass `{ organizationId, actorId, role }`, and
  map `MemoryError`/Zod/session errors to safe `400`, `401`, `403`, `404`, or `409`
  JSON envelopes. It must set `x-correlation-id` for both success and failure.

  Extend the existing authenticated persistence/repository/service path rather than
  adding SQL or a migration:

  - `listTimeline` accepts an optional bounded `sourceSystems` filter and a
    `{ observedAt, createdAt, id }` cursor, orders by `observed_at desc,
created_at desc, id desc`, and returns the final item tuple as `nextCursor`;
  - `getItemDetail` returns the item, outgoing/incoming evidence links, and its
    tenant-scoped supersession chain capped at 32 rows;
  - all detail rows pass through `toMemoryItemView` under `operatorCeiling(actor)`;
  - never create a service-role client, a new RLS policy, a cache adapter, or a
    direct client-table query.

- [ ] **Step 4: Add thin routes with exact verbs and payloads.**

  Implement these shapes and use the existing schemas as the only mutation parsers:

  ```ts
  GET    /memory                         -> { snapshot: MemorySnapshot }
  POST   /memory/search                  -> MemoryRetrievalResponse
  GET    /memory/timeline                -> { items: MemoryItemView[], nextCursor?: string }
  GET    /memory/lessons                 -> { items: MemoryItemView[], evidence: Record<string, string[]> }
  POST   /memory/items                   -> { item: MemoryItemView }
  GET    /memory/items/:itemId           -> { item: MemoryItemView, chain: MemoryItemView[], links: MemoryLinkView[] }
  PATCH  /memory/items/:itemId           -> { item: MemoryItemView }
  POST   /memory/items/:itemId/supersede -> { replacementId: string, supersededId: string }
  POST   /memory/proposals/:itemId/confirm -> MemoryProposalConfirmation
  POST   /memory/proposals/:itemId/reject  -> MemoryProposalRejection
  ```

  For search, resolve `sensitivityAllowance` to the request value when present or
  `operatorCeiling(context.actor)` when absent. Pass that value to retrieval; its
  existing ceiling check must reject a request above the authenticated role ceiling,
  while a lower requested ceiling intentionally narrows the result set. Every
  successful search response explicitly contains `servedFromCache: false` and
  removes `builtAt`.

- [ ] **Step 5: Run focused GREEN verification.**

  Run:

  ```bash
  PATH=/home/spy/.local/node/bin:$PATH pnpm vitest run \
    src/app/api/organizations/[organizationId]/memory \
    src/modules/memory/application \
    src/modules/memory/infrastructure/repository.test.ts
  PATH=/home/spy/.local/node/bin:$PATH pnpm typecheck
  PATH=/home/spy/.local/node/bin:$PATH pnpm lint
  git diff --check
  ```

- [ ] **Step 6: Commit the API task.**

  ```bash
  git add src/modules/memory src/app/api/organizations/[organizationId]/memory
  git commit -m "feat(memory): expose governed workspace APIs"
  ```

### Task 2: Compact Search workspace, provenance Dialog, and navigation

**Files:**

- Create: `src/app/(platform)/organizations/[organizationId]/memory/page.tsx`
- Create: `src/app/(platform)/organizations/[organizationId]/memory/loading.tsx`
- Create: `src/app/(platform)/organizations/[organizationId]/memory/error.tsx`
- Create: `src/components/memory/memory-workspace-client.tsx`
- Create: `src/components/memory/query-options.ts`
- Create: `src/components/memory/search-tab.tsx`
- Create: `src/components/memory/result-card.tsx`
- Create: `src/components/memory/provenance-badges.tsx`
- Create: `src/components/memory/item-chain-dialog.tsx`
- Create: `src/components/memory/search-tab.test.tsx`
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/layout/route-context.tsx`
- Test: `src/components/memory/search-tab.test.tsx`

**Interfaces:**

- Consumes: Task 1 `GET /memory`, `POST /memory/search`, `GET /memory/items/:itemId`, `MemorySnapshot`, `MemoryRetrievalResponse`, and `hasMemoryPermission`.
- Produces: the sidebar-linked Search-default workspace and Dialog-based evidence inspection for later Timeline, Lessons, and Review views.

- [ ] **Step 1: Write the failing component tests.**

  Use the QueryClient test helper pattern from Integration Hub and assert the rendered
  accessibility contract rather than implementation state:

  ```tsx
  it("keeps lexical results visible and labels degraded retrieval", async () => {
    renderWorkspace({
      search: { retrievalMode: "lexical", degradedReason: "EMBEDDING_TIMEOUT", results },
    });

    expect(
      await screen.findByRole("alert", { name: /semantic retrieval is unavailable/i }),
    ).toBeVisible();
    expect(screen.getByText(results[0].title)).toBeVisible();
  });

  it("opens Inspect chain in a labelled dialog and restores focus on close", async () => {
    renderWorkspace({ search: { results } });
    const trigger = await screen.findByRole("button", { name: /inspect chain/i });
    await user.click(trigger);

    expect(await screen.findByRole("dialog", { name: results[0].title })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });
  ```

  Also test a text label for each trust/freshness state, distinct no-memory,
  no-match, and withheld-content empty states, a background refetch that keeps old
  results, viewer absence of Add note/verify/supersede actions, and the exact
  organization ID in all query keys.

- [ ] **Step 2: Run the test file and verify RED.**

  ```bash
  PATH=/home/spy/.local/node/bin:$PATH pnpm vitest run src/components/memory/search-tab.test.tsx
  ```

  Expected: the memory page/client components do not yet exist.

- [ ] **Step 3: Implement the authenticated first read and query contracts.**

  Follow the Integration Hub page pattern: call `getOrganizationContext(params)` before
  `getOrganization`, create Task 1's API composition with the session client, read
  `service.getSnapshot`, register the organization route label, and pass only typed
  public data into `MemoryWorkspaceClient`.

  `query-options.ts` must define these organization-scoped keys and a safe fetch
  helper that parses only the public `{ error }` envelope:

  ```ts
  memoryQueryKeys.root(organizationId); // ["organizations", organizationId, "memory"]
  memoryQueryKeys.snapshot(organizationId); // [...root, "snapshot"]
  memoryQueryKeys.search(organizationId, queryHash); // [...root, "search", queryHash]
  memoryQueryKeys.timeline(organizationId, filters);
  memoryQueryKeys.lessons(organizationId);
  memoryQueryKeys.item(organizationId, itemId);
  ```

  Hash only the serialized search/filter input for the browser query key; never send
  that hash to Redis or use it as authorization. Initial snapshot data stays visible
  during refetch and all fetches use `/api/organizations/${organizationId}/memory`.

- [ ] **Step 4: Implement the approved compact Search surface.**

  Compose the installed primitives:

  - `Tabs` (line variant) owns Search/Timeline/Lessons/Review navigation;
  - `Card` owns the factual snapshot row and each result group;
  - `InputGroup`, `InputGroupInput`, `InputGroupAddon`, and `InputGroupButton`
    form the prominent full-width query bar;
  - `Select`/`ToggleGroup` controls handle type, verification, sensitivity, and
    freshness filters;
  - `Alert` presents lexical degrade copy while results remain rendered;
  - `StatusBadge` and `Badge` present trust, freshness, verification,
    sensitivity, source, and embedding labels;
  - `Empty`, `Skeleton`, and `Spinner` distinguish first load, no memory, no match,
    withheld, and background refresh;
  - `Dialog`/`DialogTitle`/`DialogDescription` own Inspect chain. Fetch detail only
    after it opens; render provenance, source reference, evidence links,
    supersession chain, and embedding status. Do not use a right-side Sheet.

  Search submission moves focus to an `aria-live` result summary. The Dialog trigger
  must be the actual `Button` asChild/trigger composition so Radix restores focus.

- [ ] **Step 5: Add the route-visible navigation.**

  Add `{ label: "Business Memory", href: `/organizations/${organizationId}/memory`,
icon: BrainCircuit }` to the organization navigation after Integrations and add
  `memory: "Business Memory"` to the breadcrumb segment map. Preserve all existing
  active-state matching and do not expose the organization group off organization
  routes.

- [ ] **Step 6: Run focused GREEN verification and build.**

  ```bash
  PATH=/home/spy/.local/node/bin:$PATH pnpm vitest run src/components/memory
  PATH=/home/spy/.local/node/bin:$PATH pnpm typecheck
  PATH=/home/spy/.local/node/bin:$PATH pnpm lint
  PATH=/home/spy/.local/node/bin:$PATH pnpm build
  git diff --check
  ```

- [ ] **Step 7: Commit the compact workspace task.**

  ```bash
  git add src/app/(platform)/organizations/[organizationId]/memory src/components/memory src/components/layout
  git commit -m "feat(memory): build compact search workspace"
  ```

### Task 3: Timeline, Lessons, Review, and governed mutation forms

**Files:**

- Create: `src/components/memory/timeline-tab.tsx`
- Create: `src/components/memory/lessons-tab.tsx`
- Create: `src/components/memory/review-tab.tsx`
- Create: `src/components/memory/note-dialog.tsx`
- Create: `src/components/memory/supersede-dialog.tsx`
- Create: `src/components/memory/review-tab.test.tsx`
- Create: `src/components/memory/item-chain-dialog.test.tsx`
- Modify: `src/components/memory/memory-workspace-client.tsx`
- Modify: `src/components/memory/query-options.ts`
- Modify: `src/components/memory/item-chain-dialog.tsx`
- Test: `src/components/memory/review-tab.test.tsx`
- Test: `src/components/memory/item-chain-dialog.test.tsx`

**Interfaces:**

- Consumes: Task 1 timeline/lessons/item/create/update/supersede/confirm/reject routes and Task 2 query keys/Dialog.
- Produces: all four usable tabs, the operator Add note flow, and non-optimistic governance actions.

- [ ] **Step 1: Write failing interaction tests.**

  ```tsx
  it("keeps a fact proposal in Review until confirmation resolves", async () => {
    const confirmation = deferred<MemoryProposalConfirmation>();
    fetchMock.post("/confirm", () => confirmation.promise);
    renderReview({ role: "operator", reviewQueue: [factProposal] });

    await user.click(await screen.findByRole("button", { name: /confirm proposal/i }));
    expect(screen.getByText(factProposal.title)).toBeVisible();
    confirmation.resolve(confirmedProposal);
    expect(await screen.findByText(/proposal confirmed/i)).toBeVisible();
  });

  it("requires a reject reason before posting a proposal rejection", async () => {
    renderReview({ role: "operator", reviewQueue: [factProposal] });
    await user.click(await screen.findByRole("button", { name: /reject proposal/i }));

    expect(await screen.findByText(/a rejection must say why/i)).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/reject"),
      expect.anything(),
    );
  });
  ```

  Add cases for timeline source/branch filters and append cursor, inline
  `derived_from` evidence in Lessons, viewer suppression of every mutation action,
  superseding an item through an `AlertDialog`, and opening a historical item through
  the chain Dialog without silently excluding it.

- [ ] **Step 2: Run the tests and verify RED.**

  ```bash
  PATH=/home/spy/.local/node/bin:$PATH pnpm vitest run \
    src/components/memory/review-tab.test.tsx \
    src/components/memory/item-chain-dialog.test.tsx
  ```

  Expected: the tabs and governed forms are not implemented.

- [ ] **Step 3: Implement reads and views.**

  `TimelineTab` uses `GET /timeline` and appends only the `nextBefore` cursor from
  the final returned item. `LessonsTab` uses `GET /lessons` and expands each
  `derived_from` list inline. `ReviewTab` starts from the snapshot review queue,
  refetches it after a mutation, and presents fact proposal `proposedFactValue` next
  to the current value supplied by the item detail route.

  Keep the compact console responsive: on narrow screens, snapshot cards and review
  rows stack; tabs become horizontally scrollable within their own container, never
  causing document-width overflow.

- [ ] **Step 4: Implement forms and mutation policy.**

  Use TanStack Form plus the same Zod schemas used by routes:

  - `NoteDialog` posts a `note`/`document` with a generated `crypto.randomUUID()`
    idempotency key and permission-gated Add note trigger;
  - `SupersedeDialog` uses `AlertDialog` to name the original item, replacement, and
    retained audit/provenance, then posts `title`, optional `body`, sensitivity,
    reason, and an idempotency key;
  - Review confirmation posts `overrideVerified: false` unless the operator
    deliberately opens and confirms the supplied override control;
  - rejection uses an `AlertDialog` plus reason field and posts only after schema
    validation;
  - every success invalidates `snapshot`, affected `item`, `search`, `timeline`, and
    `lessons` keys for this organization, shows a Sonner result, and waits for the
    next server response before removing/changing a row;
  - every failure leaves data unchanged and renders only the safe API message.

- [ ] **Step 5: Run focused GREEN verification and build.**

  ```bash
  PATH=/home/spy/.local/node/bin:$PATH pnpm vitest run src/components/memory
  PATH=/home/spy/.local/node/bin:$PATH pnpm typecheck
  PATH=/home/spy/.local/node/bin:$PATH pnpm lint
  PATH=/home/spy/.local/node/bin:$PATH pnpm build
  git diff --check
  ```

- [ ] **Step 6: Commit the full workspace task.**

  ```bash
  git add src/components/memory
  git commit -m "feat(memory): complete governed workspace views"
  ```

### Task 4: Release gate, Chrome DevTools, and documentation

**Files:**

- Create: `e2e/business-memory.spec.ts`
- Modify: `docs/superpowers/plans/2026-08-09-business-memory-implementation.md`
- Modify: `context/05-module-map.md`
- Modify: `context/09-business-memory.md`

**Interfaces:**

- Consumes: Tasks 1–3 workspace/API contracts.
- Produces: a documented verification record for the cache-free workspace slice; it does not claim completion of deferred cache or environment-gated database work.

- [ ] **Step 1: Write the failing E2E/browser-facing cases.**

  Cover an operator on all four tabs at desktop and 390px; an evidence Dialog opened
  and closed by keyboard; lexical degradation that retains results; no-memory,
  no-match, withheld, and error states; a viewer without mutation controls and
  receiving `403` from the mutation route; a fact proposal confirming only after the
  request resolves; and a superseded item reachable through Inspect chain.

  Configure tests to explicitly skip authenticated cases with a message naming the
  absent E2E credentials; never let an authentication redirect count as a passing
  UI test.

- [ ] **Step 2: Run the automated release gate.**

  ```bash
  PATH=/home/spy/.local/node/bin:$PATH pnpm format:check
  PATH=/home/spy/.local/node/bin:$PATH pnpm typecheck
  PATH=/home/spy/.local/node/bin:$PATH pnpm lint
  PATH=/home/spy/.local/node/bin:$PATH pnpm test
  PATH=/home/spy/.local/node/bin:$PATH pnpm build
  PATH=/home/spy/.local/node/bin:$PATH pnpm test:e2e
  ```

  Report the two known Task 11 formatting files separately if they remain the only
  global formatter failures; do not rewrite unrelated user work to obtain a green
  global result.

- [ ] **Step 3: Verify via Chrome DevTools.**

  Start the dev server with Node 22, then use `mcp__chrome_devtools__new_page`,
  `take_snapshot`, `take_screenshot`, `list_console_messages`, and `resize_page`.
  Navigate directly to `/organizations/<organizationId>/memory` once a valid
  authenticated route context is available. If the first navigation reaches `/login`
  or otherwise requests authentication, stop immediately and ask the user to provide
  an authenticated Chrome session; do not investigate other routes or attempt a
  login bypass.

  With an authenticated session, verify each tab, the search workbench, Dialog focus
  order/Escape restoration, 390px width, no horizontal document overflow, no Next.js
  error overlay, and no console errors. Capture the exact screenshot paths and
  console output in the task report.

- [ ] **Step 4: Update implementation documentation.**

  Mark the delivered API/UI work in the original Business Memory plan without marking
  Redis Tasks 8, 9, or 13 complete. Update the module map and Business Memory context
  with the `/organizations/[organizationId]/memory` route, four views, RLS-bound
  direct-read behaviour, and the environment limits (no container runtime; no
  migration/runtime pgTAP claim). Record browser authentication status honestly.

- [ ] **Step 5: Commit the release-gate task.**

  ```bash
  git add e2e/business-memory.spec.ts docs/superpowers/plans/2026-08-09-business-memory-implementation.md context/05-module-map.md context/09-business-memory.md
  git commit -m "test(memory): verify governed workspace"
  ```

## Plan self-review

- **Spec coverage:** Task 1 establishes the authenticated RLS route boundary and all required reads/mutations; Task 2 delivers the approved compact Search/UI/Dialog/navigation direction; Task 3 completes Timeline, Lessons, Review, and governed forms; Task 4 covers browser, E2E, and documentation gates.
- **Cache boundary:** Every task uses direct authenticated Postgres reads and preserves `servedFromCache: false`; no Redis module, cache key, warmup, or cache timestamp is introduced.
- **Security coverage:** Task 1 tests unauthenticated/non-member/viewer/cross-tenant/malformed/idempotency paths. Tasks 2–3 restrict UI affordances but keep server/RLS enforcement. Task 4 checks browser-visible output and authenticated route behaviour.
- **Type consistency:** Client query shapes are defined in Task 1 and consumed in Tasks 2–3; Task 3 invalidates the exact Task 2 organization-scoped query-key family.
- **No-placeholder scan:** No task defers a requirement without naming the exact route/component/test and its expected observable behaviour.
