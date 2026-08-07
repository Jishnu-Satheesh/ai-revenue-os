# ADR 0009: Guided onboarding control plane

## Status

Accepted and implemented in progress.

## Decision

Guided onboarding uses tenant-scoped control-plane tables for resumable sessions, section drafts, requests, uploads, extraction runs, reviewable candidates, idempotency records, and versioned readiness assessments. Confirmed values are promoted into canonical Organization/Digital Twin records only after deterministic validation and explicit operator review.

Uploads use a private Supabase Storage bucket with organization/session/upload path segments. Extraction is bounded and suggestion-only; candidates retain evidence, confidence, and review status. No model or extracted text can directly execute a side effect.

## Consequences

- Draft progress and missing-data requests remain resumable without polluting canonical facts.
- RLS and application authorization can enforce organization isolation at every boundary.
- Readiness scores are explainable and versioned, while unresolved requirements remain visible.
- Extraction workers can be retried independently from the user-facing workspace.
- Local migration verification requires a running Supabase/Postgres instance.
