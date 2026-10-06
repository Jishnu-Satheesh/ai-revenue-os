# Public leads endpoint — Execution Plan (Tier 3, small)

Goal: one public intent-discriminated API route receiving Coming Soon early-access signups today and walkthrough bookings later, with zero backend changes at that point.

Architecture: mirror the Meta webhook-receipts precedent — unauthenticated App Router route, Zod at the boundary, service-role write only after strict parsing through a fenced RPC, unique constraint as the idempotency guard, forced RLS with all session grants revoked. CORS allowlist and rate limits are env-configured; Upstash sliding windows per IP and per email-hash fail closed per ADR 0056.

Tech Stack: Next.js App Router route.ts, Zod 4, Supabase Postgres + pgTAP, Upstash Ratelimit/Redis, Vitest.

Spec decision: no new specs/ file. The handoff text is a complete small-slice spec (one route, one table, one RPC), and ADR 0056 already frames the public-capture design space. A spec file would restate the handoff without adding decisions.

ADR note: ADR 0056 is Proposed, never approved, and its Resend-only no-table design cannot meet this handoff's durable upsert requirement. This slice records a short ADR superseding that one line (DB-backed capture with Resend explicitly out of scope), not reversing any accepted decision.

## Impacted files, and what changes in each

- NEW src/app/api/public/leads/route.ts — OPTIONS preflight plus POST, shared CORS headers on every response, intent-defaulting Zod parse, rate-limit checks, service-client write after validation, handoff-mandated ok/error JSON shape.
- NEW src/app/api/public/leads/route.test.ts — colocated Vitest suite per repo convention: valid early-access, invalid email refused, unknown intent refused, duplicate idempotent, preflight CORS headers, walkthrough accepted and stored distinctly, rate-limit 429 JSON shape.
- NEW supabase/migrations/20260923HHMMSS_public_leads.sql — public.marketing_leads table (email normalized lowercase, intent check, name nullable, source default coming-soon, created_at/updated_at, unique email+intent), forced RLS, all grants to anon/authenticated revoked, fenced record_public_lead RPC granted to service_role only with on-conflict replay outcome.
- NEW supabase/tests/database/public_leads_test.sql — rollback-wrapped pgTAP: RLS forced, session grants empty, RPC recorded then replayed, walkthrough row distinct from early-access row, check constraints refuse bad intent and unnormalized email.
- NEW adrs/00XX-public-lead-capture.md — durable decision: DB-backed public capture superseding Proposed 0056's no-table line; Resend notification explicitly deferred, not promised.
- NARROW src/lib/env.ts — add COMING_SOON_ORIGINS optional comma-separated allowlist following the existing optionalNonEmptyString pattern.
- NARROW src/lib/supabase/service.ts — add a leads service-client factory reusing assertServiceRoleKey, constructed only after strict payload parsing, mirroring the worker factories.
- NARROW src/lib/logger.ts — add leadId opaque UUID to the LogContext allowlist; no email, name, or origin ever logged.
- NARROW src/lib/supabase/database.types.test.ts — add marketing_leads to UNTYPED_TABLES with the webhook-receipts rationale, or narrow Row/Insert types if the drift check prefers; whichever keeps the suite green.
- NARROW .env.example — document COMING_SOON_ORIGINS plus the already-present Upstash variables this route relies on.
- NARROW docs/superpowers/plans/2026-09-23-public-leads-endpoint.md — this plan.

## New or changed schemas, migrations, events, and public exports

- Schema: one new table public.marketing_leads, one new RPC public.record_public_lead(jsonb), no new enums needed (text checks keep intent extensible without a migration per intent).
- Events: none emitted; lead capture is pre-tenant intake, not organization activity, so no audit event or organization timeline entry.
- Public exports: none; route-local modules stay unexported.

## Blast radius: callers, RLS policies, consumers, background tasks affected

- Callers: exactly one external caller, the Astro Coming Soon form at lunes.in via cross-origin POST; no in-repo callers.
- RLS: new table only, forced with zero session grants — no existing policy touched, no tenant data reachable from this route in either direction.
- Consumers: none yet; a future operator read surface or Resend notification would be a new approved slice.
- Background tasks: none; proxy.ts session refresh passes OPTIONS/POST through with no redirect, so no middleware change.

## Open assumptions, stated explicitly rather than resolved silently

- Production and staging app base URLs are unknown: NEXT_PUBLIC_APP_URL is localhost in every env file and no deployed URL is recorded in the repo. Needed from the user for report-back items 1 and 2, but not needed to start.
- Allowed CORS origins assumed to be the production Coming Soon origin plus its staging twin, supplied via COMING_SOON_ORIGINS; exact staging origin needed from the user for report-back item 3.
- Coming Soon form sends no intent field today and cannot be changed in this slice; missing intent defaults to early-access server-side.
- Rate limits proposed as 5 per hour per email-hash and 20 per hour per IP, HMAC-hashed email keys only, Upstash-backed; limiter outage or missing Redis config refuses with JSON 503 fail-closed per ADR 0056 rather than the fail-open analysis limiter.
- Error shape follows the handoff's ok/error contract, deliberately not apiErrorResponse's error/code/message shape, because the shipped client ignores bodies on success and needs machine-readable codes on failure.
- Migration is forward-only additive per repo convention; rollback is a corrective follow-up migration, never an edit after push.
- No Resend notification, no CRM sync, no autoresponder in this slice; persistence plus JSON responses only.

## Test plan, including how tenant isolation is verified

- Vitest colocated route suite covering the six handoff cases plus 503-when-limiter-down and CORS-echo/Vary assertions; run the touched suite plus typecheck, eslint on touched files, and the database types drift test.
- pgTAP suite rehearsed against staging in a rolled-back transaction before push; executed for real after push with the suite's own assertions green.
- First-call rule: the new RPC is invoked once against staging before sign-off, proving its field references resolve.
- Tenant isolation: pgTAP asserts forced RLS and empty anon/authenticated grants; the route holds no organization context and the RPC takes no tenant input, so cross-tenant reachability is structurally impossible; verified by the grants assertions, not by convention.
- Live acceptance: real preflight plus POST from an allowed origin against staging, exactly one row, resubmission replayed without duplication.

## Risks and rollback

- Pushed migration is live on shared staging immediately with no local rehearsal; mitigated by rehearsing the pgTAP suite rolled-back first and keeping the migration purely additive with no existing-table touch.
- Fail-closed rate limiting means an Upstash outage takes the form down; accepted per ADR 0056 for a public abuse surface, and surfaced as JSON 503 rather than a silent failure.
- Origin misconfiguration fails every submission at preflight; mitigated by echoing the configured allowlist back in the report and testing preflight live from staging before handoff.
- Rollback: route disabled by clearing COMING_SOON_ORIGINS (fail-closed to no allowed origin); data rollback via a follow-up drop migration only if the table itself must go.
