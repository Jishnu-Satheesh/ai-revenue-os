# Shared Business Memory — Baseline (Task 00)

- HEAD: 96edd78952df7c98881c3d188418d0b3a3e1c9a4 (branch feat/governed-channel-intelligence)
- Research baseline was e8c1d6d; tree has moved ahead (channels redesign, org-home docs, dialogs fix).
- Dirty files at start (unrelated, left alone): .cursor/mcp.json, .superdesign/organization-home/HANDOFF.md, docs/collaboration/asset-library-and-studio-board.md, docs/superpowers/plans/2026-09-11-*, docs/superpowers/specs/2026-09-11-*, opencode.json, tsconfig.tsbuildinfo, .superdesign/channels/, supabase/.temp/cli-latest, supabase/tests/database/zz_scratch_debug_test.sql
- Migrations: list matches remote, dry-run reports remote up to date. No pending push.
- Latest migrations present: growth branch-synthesis repair (20260909163000), channel cap-eight + gap-fill + retry-after-failure (20260910090000–20260910120000).
- Memory module exists: src/domain/memory (types, purposes, trust, freshness, permissions, schemas), src/modules/memory/application (retrieval, service, api, ports, ranking), infrastructure (persistence, repository, embedding-provider, worker-repository, projection-port).
- No shared context port yet: no src/domain/memory/context.ts, capture.ts, context-policy.ts, context-digest.ts; no memory_capture_events, memory_context_manifests tables.
- Channel narration prompt v8 + cap 8 + gap-fill present in src/workflows/analysis; no memory section in prompt.
- Approvals recorded 2026-09-11: full plan Tasks 00–13 approved; retention 90-day content / 365-day audit approved; legacy corpus excluded from new AI reads until qualified; paid canary allowed with cost guardrails.
- HOLD: request to send private memory to Google Search grounded calls is not approved as blanket change. Requires Spec 023 §§8/11 + ADR 0054 amendment with consent-gated qualified path before Task 07 provider wiring. Default build keeps non-grounded private path.
- Provider qualification: paid canary allowed but Gemini grounding reuse terms + embedding disclosure must be checked per org before live private content leaves Postgres. No paid runs executed in this baseline.
- Known limits: no retrieval-log evidence for live memory use claimed; seed corpus must not count as business evidence; Task 13 Growth staging state to be re-verified before building on it.
