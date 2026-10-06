# Legacy corpus inventory — Business Memory (swarm 5)

Date: 2026-09-12. HEAD at writing: `feat/governed-channel-intelligence` worktree
(see swarm-5 report for the exact commit). Scope: every `memory_items` row with
`knowledge_kind = 'legacy'` (the default for all rows predating Spec 023).

## Explicit non-qualification statement

**The legacy corpus is NOT qualified for new AI reads.** No operator or admin
has recorded qualification (`memory_integration_settings.legacy_corpus_qualified`
defaults to `false` and no change to it is part of this slice), and nothing in
this slice admits legacy rows into a context pack. The Memory workspace may
display legacy rows — display is not admission. This inventory exists so the
qualification decision, when it comes, is made against known gaps rather than
assumed cleanliness. It authorizes no reclassification, no bulk verification,
and no seed reset.

## What a legacy row carries

- `memory_type`, `title`, `body`/`structured_value`, `origin`, `source_tier`,
  `source_system`, `source_reference`, `verification_state`, `sensitivity`,
  `confidence`, time bounds, supersession chain, embedding status.
- `knowledge_kind = 'legacy'`, `capture_event_id = NULL` (no capture event, no
  projection identity, no event ancestry).

## Provenance gaps

1. **No source revision or digest.** Legacy rows have no `source_revision`, no
   `state_digest`, and no `projection_document`. A changed source cannot be
   detected, so staleness review rests entirely on `review_due_at`/`expires_at`,
   where set — many rows predate even those.
2. **No evidence ancestry.** `memory_capture_dependencies` starts with capture;
   legacy relations live only in `memory_links`, which records operator-made
   links, not derivation roots. A legacy lesson cannot name the run, claim, or
   version it learned from.
3. **Mixed origins, one label.** `user_verified`, `provider_imported`,
   `system_generated`, and early `ai_proposed` rows share the same `legacy`
   kind. Origin still distinguishes them, but nothing records which provider
   import was human-checked and which was bulk-loaded.
4. **Withdrawal has no path.** There is no recorded root to invalidate, so a
   withdrawn provider record behind a legacy import leaves no pointer to clean
   up — the row must be individually superseded or rejected on inspection.

## Sensitivity gaps

- Sensitivity labels predate the four-level ceiling discipline now enforced at
  the service boundary. Treat every legacy `internal`/`confidential` marking as
  **unreviewed under current rules**: the ceiling that read it originally is
  not recorded.
- `customer_content` in legacy rows was stored before the disclosure rules for
  embeddings and model context existed (Spec 023 §11). Embedding or packing a
  legacy row is a new disclosure of that content and needs its own basis.

## Rights gaps

- Legacy rows have no `reuse_class` (`internal_reusable` / `qualified_reusable`
  / `metadata_only` / `denied`), no qualification reference, and no
  `retain_until`. Capture events carry all three; legacy rows carry none.
- Google-grounded narrative bodies imported before Spec 023 are historical
  provider text. Until a qualified agreement permitting that reuse is recorded
  for the organization, they are `metadata_only` in effect: visible in the
  workspace, never packed for a model, never paraphrased through another model
  to evade the boundary.
- No consent receipt links a legacy row to a processing permission. The
  qualification step must record, per row or per bounded class, the reuse class
  and retention basis — or leave the row out.

## What never happens to this corpus

- **Never seed reset.** No migration deletes, archives, or rewrites legacy rows
  to make room for captured memory. Rollback and audit history stay intact.
- **Never bulk verify.** No statement updates `verification_state` to `verified`
  (or `knowledge_kind` away from `legacy`) except through the existing governed
  per-item review path, one decision at a time, with evidence. A mass `UPDATE`
  would manufacture trust the evidence does not support.
- **Never backfill-into-legacy.** The backfill tool
  (`scripts/backfill-business-memory-capture.mjs`) enqueues capture events from
  live source tables; it does not touch `memory_items` at all, and it never
  treats a legacy row as an eligible source version.

## Qualification readiness checklist (for the future qualifying slice)

- [ ] Bounded legacy classes inventoried (this document is the starting point).
- [ ] Per-class reuse class + retention basis recorded by owner/admin.
- [ ] Provider/embedding disclosure qualification checked per organization.
- [ ] `legacy_corpus_qualified` set through the audited settings RPC.
- [ ] Context assembly actually filters on the flag, with pgTAP proving a
      qualified-out organization sees no legacy rows in packs.
