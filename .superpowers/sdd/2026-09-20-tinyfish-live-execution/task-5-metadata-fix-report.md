# Task 5 report — metadataSchema brief-fields fix (DONE)

## Root cause
- Canary run `run_06gc00djjm067a6m5ppqbkkr01` attempt 1 died with `DomainError "Market Evidence must contain compact citations and claims only"` from `parseOrThrow(metadataSchema)` in evidence `begin` (`evidence-repository.ts:483`), called from `run-market-research.ts:572`.
- `runMetadata` gains `briefManifestId`, `briefDigest`, `briefStatus` whenever the research brief resolves non-null (`run-market-research.ts:563-569`; type `MarketResearchBrief` at `:215-222`).
- `metadataSchema` (`evidence-repository.ts:197-207`) was `.strict()` with only the 7 base keys, so any run WITH a brief failed validation and the worker threw (redelivery loop; attempt 2 exited `not_acquired`).
- No prior run reached `begin()` with a brief because all died at `EXTRACTION_UNAVAILABLE` first.

## Change
- `src/modules/growth-intelligence/infrastructure/evidence-repository.ts`: extended `metadataSchema` with three optional fields, `.strict()` and all 7 base keys unchanged:
  - `briefManifestId: z.string().min(1).max(160).nullable().optional()`
  - `briefDigest: z.string().min(1).max(160).nullable().optional()`
  - `briefStatus: z.enum(["ready","empty","partial","unavailable","disabled"]).optional()`
- DB-safe: `private.assert_market_research_run_metadata` (migration `20260902080209`, lines 243-259) checks only the 7 base keys and ignores extras. No DB function, worker flow, error-handling, migration, or new-code changes.

## Tests + outputs
- Added 3 regression tests in `evidence-repository.test.ts` (real `begin()` parses through the real schema, mocked RPC transport only):
  - accepts full brief fields (`manifest-001` / digest / `ready`) and forwards them in `p_metadata`
  - accepts null brief identity (`null`/`null`/`empty`)
  - still refuses unknown extra keys with `DOMAIN_ERROR` and no RPC call
- `pnpm vitest run src/modules/growth-intelligence/infrastructure/evidence-repository.test.ts src/workflows/growth-intelligence/run-market-research.test.ts` — 2 files, 57 tests, all passed (19 + 38).
- `pnpm exec tsc --noEmit --pretty false` — clean, no output.

## Files
- M `src/modules/growth-intelligence/infrastructure/evidence-repository.ts`
- M `src/modules/growth-intelligence/infrastructure/evidence-repository.test.ts`
- A `.superpowers/sdd/2026-09-20-tinyfish-live-execution/task-5-metadata-fix-report.md`
