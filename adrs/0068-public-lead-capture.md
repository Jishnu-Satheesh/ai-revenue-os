# ADR 0068: Public lead capture is a durable intent-discriminated endpoint

## Status

Accepted on 2026-09-23. Supersedes the no-table line of ADR 0056 (Proposed, never approved); the rest of 0056's posture — bounded input, fail-closed limiters, HMAC identifiers, server-held secrets — is adopted.

## Context

The Coming Soon site at lunes.in ships an early-access email form that needs a backend endpoint in this repository, and will later add a "Book a walkthrough" action on the same surface. ADR 0056 proposed a Resend-only walkthrough endpoint with no lead table, but a mailbox is not capture: a provider failure or a retry outside the retention window silently loses the lead, and nothing can distinguish early-access from walkthrough demand afterwards.

## Decision

- One unauthenticated `POST /api/public/leads` endpoint validates an intent-discriminated payload (`early-access` today, `book-walkthrough` later, missing intent defaulting to early-access) and persists it to `public.marketing_leads` through the fenced `record_public_lead` RPC.
- The table follows the `provider_webhook_receipts` precedent: forced RLS, every session grant revoked, a unique (email, intent) constraint as the idempotency guard, and a service-role-only RPC built strictly after payload validation.
- CORS echoes a configured allowlist (`COMING_SOON_ORIGINS`); Upstash per-IP and per-email-HMAC sliding windows fail closed; no Resend send, CRM sync, or autoresponder ships in this slice.

## Alternatives

- Resend-only with no table (ADR 0056 as written): rejected, because delivery acceptance is not durable capture and the handoff requires upsert semantics.
- One route file per action: rejected, because shared CORS, validation, limiting, and error shape would be copy-pasted and drift.
- Fail-open limiting: rejected for this surface, because an anonymous form with no limiter is a free bulk-insert API; a 503 during a Redis outage is honest where silent ingestion is not.

## Consequences

- A future operator read surface or walkthrough notification is a new approved slice; until then leads are write-only from the application's point of view.
- Staging and production deployments must configure `COMING_SOON_ORIGINS`, `LEADS_EMAIL_HASH_KEY`, and the existing Upstash variables, or the route answers 503 by design.
