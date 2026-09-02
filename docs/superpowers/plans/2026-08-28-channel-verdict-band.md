# Channel VerdictBand Deterministic Figures Implementation Plan

**Goal:** Let a completed channel audit supply the approved Potential / Lost / Earned VerdictBand from its own governed revenue and cancellation evidence.

**Architecture:** Register a pure channel-scoped `revenue.window_gross` detector over current, comparable `revenue.gross` evidence. The existing read model consumes its stored money observation as Potential, combines it with the already-fenced cancellation-loss monetary impact as Lost, and exposes the existing derived Earned split only when both values use one currency. The existing Superdesign VerdictBand remains the rendering surface.

**Spec:** `specs/018-governed-channel-intelligence.md`, sections 11.1, 11.3, 11.4, 17.3, and 20.

## Global constraints

- No migration, table, RLS policy, API shape, or Trigger task changes are part of this slice.
- A model timeout must not affect deterministic figures; recommendation hardening remains a separately approved slice under ADR 0037.
- The detector reads only current reconciled evidence and records citations, coverage, limitations, and a `needs_data` refusal rather than inventing a zero.
- Historical completed runs stay immutable. A new registry version binds the new detector only to later runs.
- Preserve the existing uncommitted Superdesign-redraw work in the shared tree; do not reformat or revert unrelated changes.

## Execution plan

- Add `revenue.window_gross` and a focused detector test. It will sum only comparable current `revenue.gross` points for the selected channel, refuse empty, mixed-currency, or incomparable evidence, record observed-versus-expected period coverage, and cite every accepted point. The test will use hand-derived AED minor-unit inputs and prove that removing the revenue series changes the outcome to `needs_data`.
- Run the new detector test before production code and confirm it fails because the detector module does not exist; then implement the smallest pure detector that makes it pass.
- Register the detector at registry version 3 in `src/domain/analysis/registry.ts`. Update registry and analysis-worker tests first to prove a day-grain channel run binds the detector and requires no new metric vocabulary; then update the registry and re-run those tests.
- Update the VerdictBand read model and tests first so Potential comes from `WINDOW_GROSS_REVENUE`, not the organization-scoped `CHANNEL_REVENUE_SHARE`. Keep the derived split guarded by matching currencies and keep the new observation in the verdict band rather than an unplaced row.
- Exercise the real `ChannelWorkspace` with a completed run carrying AED 910 potential and AED 357 cancellation loss. Assert the approved headline, AED 553 earned figure, and Potential / Lost / Earned scale are visible; then make only the smallest UI edit required by that failing test.
- Update spec 018's shipped detector and VerdictBand contract to name the channel-scoped gross-revenue observation, its coverage limitation, and the registry-version refresh rule. No ADR is needed because this fulfils the existing deterministic detector contract without changing a durable boundary.
- Verify focused detector, registry, worker, read-model, and component tests; then run typecheck, lint on changed files, and the relevant broader analysis suite. Record any unrelated shared-tree failures separately.

## Blast radius, risks, and rollback

- Callers affected: new channel analysis runs bind one additional pure detector; the channel page reads its stored outcome. Organization-scoped revenue-share runs retain their current contract.
- Tenant isolation: unchanged. Evidence remains loaded through the existing worker fence and page reads use the caller's session; unit tests verify no channel-share output is substituted for a channel run.
- Primary risk: a partial window could be mistaken for a full-month total. The detector therefore carries stored coverage and the existing caution chip remains visible; it never fills missing periods.
- Rollback: remove the detector from a later registry version and stop displaying its observation. Completed runs and their cited evidence remain unchanged and readable.
