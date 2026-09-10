- **Market monitoring and research completion — Execution Plan**
- **Status:** Proposed on 2026-09-08. User authorized resolving the review gaps and writing this
  plan. Feature implementation, migrations and provider enablement have not started.
- **For agentic workers:** Use the executing-plans skill to implement task by task in this existing
  worktree. No subagents are required. Repository Execution Plan format takes precedence over the
  skill's code-block template: this document uses bullets and explicit test cases.
- **Goal:** An operator reviews one branch's scope, starts bounded research once, follows its progress
  through analysis and finds cited outcomes and recommendations in the existing four tabs.
- **Architecture:** Extend existing Market Profiles to independent branch identities. A pipeline
  envelope coordinates existing leased research/synthesis requests, with atomic handoffs and
  private spend ledgers. Qualified Brave snippets feed Gemini extraction/support review and the
  existing branch-fenced synthesis path.
- **Stack:** Current Next.js/React, strict TypeScript, Zod, Supabase/Postgres/RLS, Trigger.dev, TanStack
  Query, Vitest, pgTAP and Playwright. Use installed dependencies first; no new provider SDK needed.
- **Required design:** [Market monitoring design](../specs/2026-09-08-market-monitoring-research-completion-design.md),
  [Spec 022](../../../specs/022-growth-intelligence.md),
  [ADR 0047](../../../adrs/0047-branch-scoped-grounded-market-research.md).

- **Global constraints**
- One active branch per run, 1–20 topics, 0–5 competitors. Header **Market monitoring**, title
  **Review market monitoring**, action **Start market research**. No fifth tab.
- Preserve official branch records, v1 profile bytes/digests, current recommendation controls,
  existing Overview ordering/More link and manual metric-refresh behavior.
- Initial ceilings: 26 primary searches + 2 retry attempts; 5 results/query; 512 KiB/response,
  8 MiB streamed total; 40 retained sources, 2,000 characters/excerpt, 64 KiB total excerpt text.
- API redirects 0; 20-second calls; search concurrency 2; research deadline 8 minutes within a
  10-minute lease. Extraction/support review each at most four calls, 12,000 input/4,000 output
  tokens per call; synthesis at most two calls including one explicit retry, each 24,000 input/
  6,000 output tokens. All billable reasoning tokens and hidden retries must be bounded.
- USD 1 maximum pipeline reservation; USD 5 organization local-day allowance. Include all stages
  and retries in the quote and shared ledgers. Unknown cost remains reserved, never converted to zero.
- No paid call until the account permits retained snippets, derived claims, Gemini inference,
  organization display and reuse with a documented retention policy.
- All new exposed tables use RLS/composite tenant foreign keys; user routes use signed-in clients.
  Fixed search paths and explicit grants/checks on privileged RPCs; workers require current leases.
- Node 22: use PATH=/home/spy/.local/node/bin:$PATH. Use pnpm. Never start local Supabase/Docker,
  run db:types, stash, push, bulk-stage this dirty worktree or run the repository-wide formatter.
- Read the Supabase/Postgres skills before database changes and Trigger authoring skill before
  changing workers. Read README and relevant context/spec/ADRs/standards per AGENTS.
- Claim touched paths on the collaboration board before editing. Update only changed-file
  documentation and formatting; do not commit unrelated existing changes.

- **Task 1 — Establish the verified baseline and release prerequisites**
- **Files:** Read AGENTS.md, docs/collaboration/asset-library-and-studio-board.md, Spec 022,
  ADRs 0039/0044/0047, package.json, current GI migrations and the design. Create
  docs/verification/growth-intelligence/2026-09-08-market-monitoring.md for evidence.
- [ ] Record current branch/HEAD and path-limited dirty status. Identify already changed GI tests
      and components so later commits do not claim another task's work.
- [ ] Use pnpm db:migrations:list against hosted staging; record applied/missing migration names,
      current Task 13 read contracts and the relevant RPC signatures, without printing connection
      strings or row payloads. Do not push unrelated pending migrations.
- [ ] Establish baseline using pnpm exec vitest run src/domain/growth-intelligence
      src/modules/growth-intelligence src/workflows/growth-intelligence
      src/components/growth-intelligence, then pnpm typecheck. Record existing failures separately.
- [ ] Verify the actual account's Brave rights and paid Gemini data handling/model pricing when
      configuration is available; record safe qualification identifiers, no secrets. If unavailable,
      record provider enablement as blocked while continuing fixture-based implementation after plan
      approval. Do not substitute the public pricing page for an agreement or buy/contact a provider.
- **Deliverable:** dated baseline and explicit external launch prerequisites. No claim of browser
  or provider acceptance from old notes.

- **Task 2 — Define compatible scope, lifecycle and budget contracts**
- **Files modified:** src/domain/growth-intelligence/types.ts, schemas.ts, profile-digest.ts,
  request-fingerprint.ts, errors.ts, index.ts; src/modules/growth-intelligence/application/ports.ts,
  api-schemas.ts; src/modules/growth-intelligence/infrastructure/research/ports.ts.
- **Files created:** src/domain/growth-intelligence/research-pipeline.ts and
  research-pipeline.test.ts. Extend schemas.test.ts, profile-digest.test.ts,
  request-fingerprint.test.ts and application/api-schemas.test.ts.
- **Proposed interfaces:** MarketProfileDocumentV2 and MarketProfileDocument union; branch v2 has
  one trade area and explicit city/country, operator_lead/cited competitor provenance. Export
  ResearchPipelineStage using the design's nine stages and ResearchCoverageEntry with slot key,
  kind, outcome, attempt IDs and accepted claim IDs.
- **Proposed start contract:** StartBranchResearchInput contains organizationId, actorId, branchId,
  document: MarketProfileDocumentV2, expectedCurrentVersionId: string | null, idempotencyKey and
  correlationId. StartBranchResearchResult contains outcome: started | existing_active | replayed,
  profileVersionId, pipelineId and researchRequestId. Conflicts use a domain error, not success.
- **Research adapter contract:** replace Promise<never> with a validated ResearchRetrievalResult:
  bounded source metadata/excerpts, coverage manifest and attempt usage references. Keep provider
  qualification separate from retrieval results; no raw provider JSON in application exports.
- [ ] Write failing cases: unchanged v1 fixture hashes identically; v2 single-branch contract accepts
      name-only operator leads and rejects uncited AI competitors; reject sixth competitor/21st topic,
      duplicates, credentials/private URL, foreign geography refs and branch mismatch.
- [ ] Add lifecycle cases distinguishing root success from pipeline preparing_insights and
      no_findings from failure. Budget cases include unknown cost and preserved consumed retry limits.
- [ ] Implement version-discriminated parsing; freeze the v1 transform/digest path. Normalize new
      UI values before digesting v2. Permit empty approvedDomains and preserve source policy/cadence.
- [ ] Run pnpm exec vitest run src/domain/growth-intelligence
      src/modules/growth-intelligence/application/api-schemas.test.ts and pnpm typecheck.
- **Deliverable:** typed contracts and compatibility fixtures before persistence or UI wiring.

- **Task 3 — Persist independent branch profiles and pipeline lineage**
- **Migration:** generate a fresh forward migration with suffix growth_intelligence_branch_profiles
  using the installed Supabase CLI after checking its help. Do not modify an applied migration or
  invent its timestamp. Subsequent task migrations follow the same rule.
- **Files modified:** src/lib/supabase/database.types.ts and database.types.test.ts narrowly.
  **Tests created:** supabase/tests/database/growth_intelligence_branch_profiles_test.sql.
- **Schema:** nullable branch_id on organization_market_profiles; same-tenant branch FK; partial
  uniqueness for legacy null scope and branch scope; v2 validator alongside unchanged v1 validator.
- **Schema:** growth_intelligence_research_pipelines holds organization/branch/profile/version,
  scope digest, research and synthesis request IDs, stage, coverage, timestamps, safe code.
  Requests gain pipeline_id and phase; enforce one request per pipeline/phase. Use deferred
  composite foreign keys where initial pipeline/request insertion is circular.
- **Mutations:** existing append-only/identity guards must explicitly permit new guarded lifecycle
  fields and scoped profile creation. Keep v1 proposal/decision wrappers on legacy-null scope.
- [ ] Write pgTAP cases for preserved v1 digest/version rows; two profiles in one organization;
      one active pipeline per branch; two organizations cannot attach each other's branch, profile,
      root, child or run; authenticated direct inserts/updates denied and viewer reads tenant-fenced.
- [ ] Implement schema, checks, indexes, grants and RLS. Audit all old ON CONFLICT(organization_id)
      assumptions and singleton constraints before removal; replace them with correct scoped paths.
- [ ] Dry-run only after reviewing all pending migrations. Push only this approved slice through
      the staging workflow. Run the new pgTAP suite through pnpm db:test with the supported filtering
      in scripts/run-pgtap.mjs; if filtering is absent, use the normal full runner.
- [ ] Exercise v1 and v2 validator/proposal paths against staging, record safe result counts and run
      database.types.test.ts. Do not generate local types.
- **Deliverable:** old organization workflows still operate; branch scopes and lifecycle references
  have tested tenant constraints.

- **Task 4 — Add atomic start, scoped reads and due scheduling**
- **Files modified:** application/profile-service.ts and ports.ts;
  infrastructure/profile-repository.ts and profile-proposal-provider.ts, plus their tests;
  src/app/api/organizations/[organizationId]/market-profile/route.ts, proposals/route.ts and
  versions/[versionId]/decisions/route.ts with their route tests.
- **Files created:** src/app/api/organizations/[organizationId]/market-profile/research/route.ts and
  route.test.ts. Extend the branch-profile migration via a new forward migration suffix
  growth_intelligence_branch_research_start; extend branch-profile pgTAP tests.
- **Proposed boundary:** startBranchResearch(input: StartBranchResearchInput) returns
  StartBranchResearchResult using start_branch_market_research RPC with explicit branch, document,
  expected current version, actor, idempotency and correlation parameters.
- [ ] Write API/SQL tests: two browser keys + same scope return one pipeline; same key/different
      body conflicts; A and B starts both survive; editing A cancels only A; stale expected version
      conflicts; unchanged completed scope starts new work without a new profile version; inactive or
      foreign branch and viewer mutation are rejected. Failed start leaves no half-confirmed version.
- [ ] Implement one transaction: permission/branch validation, branch-profile lock, idempotency
      replay/body check, active-scope convergence, expected-version check, save/reuse version, explicit
      confirmation audit, same-branch cancellation, pipeline/request creation and start event.
- [ ] Preserve distinct error outcomes and safe copy. Existing pending proposal rejection still
      targets its immutable version; never treat rejected/conflicting outcomes as a success toast.
- [ ] Replace organization-only reads with explicit branch/profile/version/null scope. Scope AI
      proposal context and prefill to the branch without silently copying shared onboarding location.
- [ ] Locate the current due-enqueue SQL and governed-report-current enqueue RPC definitions via rg;
      replace them in this forward migration to enumerate enabled scoped profiles, preserve cadence/
      local buckets and legacy behavior, and carry source branch/channel lineage into derived requests.
      Test scheduled A/B isolation, same-bucket dedupe and report-current replay.
- [ ] Run profile-service/repository/provider and market-profile route tests, typecheck and hosted
      branch-profile pgTAP. Exercise each changed PL/pgSQL scheduler/start path on staging.
- **Deliverable:** usable API start and scoped reads; no browser component required to prove safety.

- **Task 5 — Enforce spend reservations and qualified retention**
- **Files created:** infrastructure/research/budget-repository.ts, qualification.ts,
  retention-repository.ts and matching tests. Modify research/qualified-provider.ts and tests;
  evidence-repository.ts and tests; domain evidence schemas/types; .env.example.
- **Migration:** new suffix growth_intelligence_research_budget_retention. **Tests created:**
  supabase/tests/database/growth_intelligence_research_budget_test.sql and
  growth_intelligence_research_retention_test.sql.
- **Schema:** private organization-day allowance/reservations and unique pipeline/phase/slot/attempt
  ledger; source qualification/retain-until/excerpt metadata; support-review provenance and
  narrowly authorized content-erasure events. Keep private tables outside browser grants.
- **Proposed boundary:** reserveResearchPipelineBudget(organizationId, pipelineId, quoteMicrosUsd,
  priceVersion); reserveResearchAttempt(pipelineId, phase, slotKey, attemptIndex, maximumMicrosUsd);
  settleResearchAttempt(attemptId, reportedUsage | estimatedUsage | unknownUsage).
  Database resolves day/timezone and locks allowance; client cannot supply spend or arbitrary day.
- Also expose reserveResearchRequestBudget(organizationId, requestId, quoteMicrosUsd, priceVersion)
  for standalone weekly/business-evidence synthesis and legacy paid research. Use an exclusive
  pipeline-or-request work-scope key in the private ledger; reserveResearchAttempt accepts that
  discriminated scope. Their quote is capped at USD 1 and draws from the same daily allowance.
- [ ] Write concurrency tests: two reservations cannot overspend the daily allowance; replay cannot
      reserve twice; timeout retains maximum liability; confirmed unused reserve releases once;
      cross-midnight running pipeline remains charged to its admission day; stale worker cannot issue
      new calls. A late accounting receipt may reconcile its already-issued attempt without admitting
      evidence or changing a cancelled pipeline.
- [ ] Implement quote validation and per-attempt reservations before calls. Preserve immutable usage
      receipts; record actual overrun and block further calls, never Math.min actual spend to the cap.
      Unknown reservations expire only through explicit reconciliation, not a timer that assumes free.
- [ ] Exercise mixed manual pipeline, weekly synthesis and legacy research reservations concurrently;
      combined admitted cost must not exceed the organization allowance. Wire every newly enabled
      paid path to this boundary before removing its feature gate.
- [ ] Qualification fails closed for missing required rights, expired agreement, missing rates,
      credential or model bounds. Document server-only configuration and safe availability responses;
      no credentials or signed contract text in source.
- [ ] Implement audited payload erasure and eligibility withdrawal, including derived text when
      required. Preserve safe IDs/decisions/events. Test that erased/unavailable sources cannot support
      new synthesis and history renders a source-unavailable state.
- [ ] Run focused budget/qualification/retention tests and hosted pgTAP, exercise every new RPC once.
- **Deliverable:** concurrency-safe call authorization and a concrete lawful evidence lifecycle.

- **Task 6 — Retrieve bounded evidence with complete input coverage**
- **Files modified:** research/query-plan.ts, ports.ts, qualified-provider.ts, safe-public-http.ts,
  and their tests. **Files created:** research/brave-search-adapter.ts and test;
  research/**fixtures**/brave-search-bounded.json using synthetic public examples only.
- **Proposed boundary:** buildResearchQueryPlan(scope) returns ordered slots keyed local_market,
  topic key or competitor key; adapter searchAndFetch returns ResearchRetrievalResult despite the
  legacy method name (no page fetch in this implementation).
- [ ] Write a maximum-input fixture with 20 distinct topics and 5 competitor leads: assert exactly
      26 primary slots and a manifest entry for every input. Include absent business website,
      competitor website/location context and duplicate source URLs.
- [ ] Implement fixed Brave Web Search endpoint requests with encoded bounded public query text,
      licensed snippets and safe URL normalization; do not send business reports or customer data.
      Reject API redirects, unsafe citation URLs and responses over streaming bounds.
- [ ] Integrate reservation-before-call and durable attempts. Bound results, bytes, time and retries
      across worker restarts. Disable transport/SDK automatic retries and expose partial coverage after
      quota/byte/source/deadline exhaustion. Record no-results separately from failed/skipped.
- [ ] Test 429 and 5xx retries within two-call allowance, timeout unknown charge, malformed response,
      duplicate/unsafe sources, kill switch, claim-lost before next call, restart resumption and a
      28-attempt ceiling including failures. Verify truncated results never imply supported coverage.
- [ ] Run pnpm exec vitest run src/modules/growth-intelligence/infrastructure/research.
- **Deliverable:** qualified retrieval contract proven with synthetic provider responses.

- **Task 7 — Extract and admit cited claims**
- **Files created:** research/claim-extraction.ts, research/claim-support-review.ts and tests.
  Modify evidence-repository.ts and its tests, domain evidence schemas, and run-market-research.ts
  with its tests. Extend the evidence persistence RPC in a fresh forward migration if required
  by the Task 5 provenance schema; cover it in market_evidence_test.sql.
- **Proposed boundaries:** extractResearchClaims(scope, sources, modelBudget) yields strict candidate
  records; reviewResearchClaimSupport(candidates, sourceSpans, modelBudget) returns candidate ID,
  supported/unsupported/uncertain and safe limitations. Existing deterministic evidence policy
  decides admission; neither model assigns money, ranking or execution eligibility.
- [ ] Write cases for invented source IDs, valid URL with unrelated text, bad span offsets, ambiguous
      competitor identity, contradictory dates, excluded/stale source, prompt injection, one-source
      limitation and empty extraction. Only eligible supported candidates are persisted.
- [ ] Implement bounded no-tool Gemini calls under separate phase budgets and source batches.
      Persist exact permitted excerpts and review provenance; no raw model/provider body or hidden
      reasoning in logs. Preserve rejected/uncertain counts and coverage limitations safely.
- [ ] Replace claims=[]/links=[] placeholder behavior with validated claims and links through the
      fenced existing boundary. Reject evidence mutation after lease loss or same-branch supersession.
- [ ] Run extraction/review/evidence-repository/run-market-research tests and hosted market evidence
      pgTAP with real RPC calls. Demonstrate source → excerpt → claim → support-link lineage.
- **Deliverable:** actual cited claims, not merely successful source retrieval.

- **Task 8 — Make research-to-synthesis handoff atomic and recoverable**
- **Files modified:** evidence-repository.ts; src/workflows/growth-intelligence/run-market-research.ts,
  run-synthesis.ts, dispatch-due-work.ts and matching tests; src/trigger/growth-intelligence.ts and
  its existing loader/worker tests. Add pipeline methods to application/ports.ts.
- **Migration:** suffix growth_intelligence_research_completion. **Tests created:**
  supabase/tests/database/growth_intelligence_research_pipeline_test.sql.
- **Proposed boundaries:** complete_market_research_pipeline receives organization, pipeline, run,
  request, claim token and bounded result digest/coverage; it returns pipeline stage and optional
  synthesis request ID. retry_market_research_synthesis receives organization/pipeline, actor and
  idempotency key and returns the same eligible child request.
- [ ] Test transaction rollback between evidence completion and child insert; replay after commit
      returns the same child; lost immediate wake is recovered by the sweeper; stale lease cannot
      complete; same-branch replacement blocks old outputs; B remains unaffected.
- [ ] Implement request/run completion + child insert + pipeline transition + safe events atomically.
      Determine eligibility from persisted claims, not an untrusted worker count. Zero eligible claims
      yields no_findings; partial preserves coverage. Reject old completion API for pipeline-bound runs.
- [ ] Route market_evidence_changed, business_evidence_changed and weekly_synthesis to run-synthesis;
      retain research/reassessment routes and separately tested consolidation. Update Trigger task-ID
      allowlists so routing accepts the registered synthesis worker.
- [ ] Finalize synthesis items, request and pipeline in one transaction. Test failed final persistence,
      duplicate child execution, analysis-only retry, stale evidence refusal, exhausted-budget refusal,
      and late accounting reconciliation after cancellation.
- [ ] Verify retry reuses child and immutable evidence, allows one explicit second synthesis call
      within the prequoted budget, and emits one audit event per actual transition. No paid search on
      synthesis retry. Run workflow tests and hosted pipeline pgTAP; record crash-recovery evidence.
- **Deliverable:** no crash window between saved research, analysis scheduling and terminal output.

- **Task 9 — Fence business synthesis and output scope**
- **Files modified:** application/synthesis-service.ts and ports.ts; infrastructure/synthesis-repository.ts
  and synthesis-provider.ts; src/workflows/growth-intelligence/run-synthesis.ts;
  src/trigger/growth-intelligence.ts, src/trigger/synthesis-loaders.test.ts and corresponding tests.
  Extend synthesis persistence checks in a fresh migration suffix growth_intelligence_branch_synthesis.
- **Interface changes:** findings.load receives organizationId, branchId, channelId and requested
  evidence window/context; returns compact findings with analysisRunId, branchId, periods, currency,
  units and freshness/coverage. claims.load receives exact organization/profile/branch/research lineage.
- [ ] Fixture: branch A sales 100, branch B sales 900 and organization sales 1,000. A synthesis must
      see 100 as its metric, exclude B, and label 1,000 only as broader context if included. Missing A
      data yields a gap, never B/organization fallback.
- [ ] Query the existing channel_findings.branch_id, join/check analysis-run lineage, retain current/
      supersession and source-link eligibility filters, batch ID reads and enforce deterministic limits.
      Cover incompatible currency, overlapping windows, stale data and broader market geography.
- [ ] Pass branchId all the way from request through synthesis service/provider and saved item.
      Validate exact branch/profile/run support again in SQL, including a service-role wrong-branch
      fixture: privileged worker access does not make inconsistent support admissible.
- [ ] Run synthesis workflow/service/provider/repository and loader tests plus hosted synthesis
      persistence suites. Confirm deterministic advice/Opportunity policies and human decisions survive.
- **Deliverable:** selected-branch advice with trustworthy provenance and explicit data gaps.

- **Task 10 — Serve pipeline status, retained history and outcome links**
- **Files created:** application/research-read-model.ts, infrastructure/research-read-repository.ts
  and tests; src/app/api/organizations/[organizationId]/market-profile/research/[pipelineId]/route.ts
  and route.test.ts; its retry/route.ts and route.test.ts.
- **Files modified:** application/read-model.ts, read-service.ts, market-watch.ts; infrastructure/
  read-repository.ts; GI page and /api/organizations/[organizationId]/growth-intelligence/route.ts
  and their tests. Repository paths use the existing growth-intelligence module.
- **Proposed view:** ResearchPipelineView returns IDs/branch, stage, observedAt, stageChangedAt,
  settings summary, coverage, source/claim counts, safe failure code, retry eligibility and exact
  outcome links. History is cursor-paginated at 10, maximum 50 per read, with same-branch last-success
  fallback independent of current_version_id.
- [ ] Write viewer/operator/foreign-tenant read and retry tests. History must preserve prior settings
      on failed replacement, never fallback across branches, label legacy organization scope and show
      erased/unavailable sources without exposing stored raw content.
- [ ] Implement signed-in RLS reads and safe response schemas. Research history lookup is separate
      from eligibility: old settings do not automatically become current support.
- [ ] Attach pipeline provenance to Recommendations, Overview preview and Your actions while
      preserving existing deterministic ordering, filters and human triage decisions.
- [ ] Run read-model/repository/market-watch/status/retry route tests and typecheck.
- **Deliverable:** complete authenticated read contract for UI, including partial and retry states.

- **Task 11 — Implement the prototype dialog and pipeline-aware views**
- **Files created:** src/components/growth-intelligence/market-monitoring-dialog.tsx,
  research-progress.tsx, research-outcomes.tsx and matching component tests.
- **Files modified:** growth-intelligence-workspace.tsx, market-watch.tsx, query-options.ts,
  source-evidence-drawer.tsx, intelligence-card.tsx, intelligence-timeline.tsx and their tests;
  src/app/(platform)/organizations/[organizationId]/growth-intelligence/page.tsx.
  Stop mounting market-profile-review.tsx inline; retain it only if existing callers need it.
- [ ] Write tests for exact header/icon/title, both entry points, selected-branch prefill, required
      selection when several branches, read-only viewer, pending AI rejection, topic/competitor bounds,
      name-only lead label, missing-locality research-only inputs and dirty-branch-switch handling.
- [ ] Implement the dialog with existing shared form/dialog/select components. Preserve focus trap,
      labelled fields, keyboard operation, validation feedback and focus return. One Start calls the
      atomic endpoint; conflict/timeout keeps typed edits and does not toast success.
- [ ] Add progress/outcomes and exact-source links within Insights & market, research provenance in
      Recommendations, existing Overview preview/More link and deduplicated Your actions.
- [ ] Observe pipeline every 5 seconds while active, 30-second error backoff, pause hidden/offline.
      Refresh research views at preparing_insights and terminal transitions. Abort old-branch reads;
      query keys include organization/branch/pipeline. Remount resumes authoritative state.
- [ ] Test root succeeded + child pending still displays Preparing insights; child success refreshes
      recommendations; synthesis failure keeps findings and offers eligible retry; network error is
      Status unavailable; old response after branch switch cannot overwrite current data.
- [ ] Run pnpm exec vitest run src/components/growth-intelligence and focused page/API tests.
      Verify 375px and desktop layouts and keyboard behavior against the approved prototype.
- **Deliverable:** client-friendly complete flow, without introducing another tab or metric polling.

- **Task 12 — Verify, document and enable cautiously**
- **Files modified:** e2e/growth-intelligence.spec.ts, README.md/.env.example as needed for setup,
  Spec 022/ADR 0047 status, this plan, verification record and collaboration board.
- [ ] Run focused tests after each task; after integration run pnpm typecheck, pnpm lint, pnpm test,
      pnpm build and pnpm db:test. Separate baseline failures with evidence; never call a failing
      required path complete.
- [ ] Run pnpm exec playwright test e2e/growth-intelligence.spec.ts using the repository's actual
      authenticated staging test setup. Cover Start → research → preparing insights → outcomes,
      concurrent branches, reload, partial/no-findings, synthesis retry and viewer denial.
- [ ] Verify hosted migrations and call every new PL/pgSQL path once with safe test fixtures.
      Acknowledge that shared staging pgTAP is integration evidence, not isolated local testing.
- [ ] After account qualification and budget approval, perform one controlled staging canary:
      confirm branch/scope, paid retrieval receipts, eligible source/excerpt/claim links, unique child,
      branch-fenced items, final UI state and honest coverage/cost. Do not require the canary to invent
      a recommendation: zero recommendations with a justified completed analysis is valid.
- [ ] Record which checks actually ran, safe run IDs and outcomes. If browser/provider access is
      unavailable, state that release acceptance remains incomplete and keep new starts disabled.
- [ ] Review the diff against all six gap rows and approved UI decisions. Update documentation to
      match actual final behavior and document any remaining blocker. Use narrow checkpoint commits
      only after each validated slice; user performs git push.
- **Deliverable:** evidence-backed readiness; no provider or browser acceptance claimed from mocks.

- **Blast radius**
- Profile readers, discovery proposals, legacy decisions, due schedulers, report-current enqueue,
  research/consolidation/synthesis dispatch, request fingerprints and completion/retry RPCs.
- New branch-profile uniqueness, pipeline/lineage constraints, exposed-table RLS, private budgets,
  source retention and support persistence; narrow hand-maintained database type changes.
- GI page/API, Market Watch, Recommendations/Overview provenance and Your actions; existing triage
  and Campaign consumers must retain deterministic admission and human decision history.
- Public exports change only inside growth-intelligence domain/application boundaries. Provider
  secrets, contracts and private billing ledgers never become client exports.
- Audit additions: growth_intelligence.research_started, growth_intelligence.research_prepared,
  growth_intelligence.research_finished, growth_intelligence.research_retried. Existing events stay.

- **Open assumptions and decisions included in approval**
- Brave is the selected qualification path, but account-specific storage/inference/display/reuse
  rights, retention and contracted pricing are not verified by public documentation alone.
- The actual pinned Gemini model must pass the quoted token/price/data-handling contract before
  enablement. Preserve existing model configuration if it qualifies; do not silently choose a
  different model or unbounded reasoning mode.
- USD 1/pipeline, USD 5/day and snippet-only research are conservative proposed launch defaults.
  Quality can be limited; show missing coverage rather than claim comprehensive market knowledge.
- Conditional research-area inputs resolve missing branch locality without a canonical branch edit.
- Multiple enabled branch profiles intentionally coexist with legacy organization monitoring.
  Legacy work consumes the same organization allowance when it uses the qualified paid path.
- This plan remains one cohesive research-to-recommendation slice. It does not redesign unrelated
  tabs, change Opportunity policy or enable external business actions.

- **Risks and rollback**
- Partial-index migration exposes forgotten singleton reads: audit all consumers and deploy
  compatibility before enabling branch rows. Never roll back to the old singleton reader.
- Staging migrations affect everyone immediately: inspect pending history; forward repairs only.
- Provider rights or model pricing may not qualify: keep the adapter off; no automatic fallback.
- Snippets may be insufficient for claims: no_findings/partial is valid and visible, not fake advice.
- Workers can crash after incurring cost: retain attempt reservations, recover via leases/sweeper
  and reconcile receipts. Never release unknown liability as zero.
- Rollback disables new starts/provider calls/new dispatch while bounded in-flight work settles.
  Keep a forward-compatible read path, lawful history and required retention processing.
- Material changes to these decisions require user review under AGENTS.md before widening code.

## Task 12 status (2026-09-09, worktree-only note — file untracked, not committed)

- DONE_WITH_BLOCKERS. Full gates ran with baseline-vs-slice separation: typecheck 0 errors;
  build clean; vitest 4822 passed / 2 failed (both non-slice: creative_* types gap from peer's
  untracked migration, reports XLSX tripwire); lint FAILS (11 errors — 9 in committed slice files
  Tasks 7/8/11 never ran lint, 2 peer-owned); pgTAP 11/12 slice suites green, item-decisions test
  25 fails on the Task 5 retention error-string rename (slice-attributable, needs an owner).
- Playwright e2e/growth-intelligence.spec.ts: 8 passed / 12 skipped (seed + qualification absent;
  cold-run webServer boot race noted, green on warm retry). Research route-protection proves gates
  refuse strangers (401, no leaks).
- All slice migrations paired on staging; every new PL/pgSQL path executed (rolled back, zero
  residue). Provider qualification BLOCKED (no Brave key, no Gemini rate/model qualification);
  paid canary BLOCKED; seeded-browser research flow + 375px/desktop eyeball BLOCKED. Gates stay
  OFF, new starts disabled, no production readiness claimed. Evidence: task-12-report.md in this
  folder and docs/verification/growth-intelligence/2026-09-08-market-monitoring.md (Task 12 section).
