# ADR 0056: Public walkthrough requests use a bounded email endpoint

## Status

Proposed on 2026-09-11. Not implemented or approved. Part of the public landing redesign proposal and the user's explicit request for a Book a walkthrough dialog collecting email, phone and industry.

Specification: `specs/021-public-landing-page.md` will be amended upon approval. Proposed blueprint: `docs/superpowers/specs/2026-09-11-public-landing-redesign.md`; operational contract: `docs/superpowers/plans/2026-09-11-public-walkthrough-contract.md`.

## Context

The current public page points to an unconfirmed mailto. The user wants a real form and customer-service notification through Resend, whose SDK is already installed. Prospective customers do not have an organization or a platform account. Creating a tenant or using a service-role database client to collect a lead would conflate marketing intake with business-workspace data.

## Decision

- One unauthenticated `POST /api/public/walkthrough-requests` endpoint validates the three contact fields and sends a plain-text email to a fixed server-configured customer-service inbox.
- Only this exact path skips Supabase session refresh. Root routing and all authenticated authorization remain unchanged.
- No application lead table, CRM subscription, visitor autoresponder or worker is introduced. Resend and the mailbox retain the message; expiring Redis allowance counters contain HMAC identifiers only.
- Origin checks, strict bounded input, a honeypot, and distributed global/email/IP limits precede any email. Limiter failure refuses the send; the existing fail-open organization analysis limiter is not reused.
- Delivery uses Resend idempotency for retries of one request. Success means provider acceptance, with actual inbox receipt a separate release check. This slice does not promise indefinite deduplication or a durable delivery outbox.
- Server-configured From and To prevent an anonymous caller from choosing an email recipient. Reply-To is the validated visitor email. Secrets and contact values do not enter operational logs or public configuration.

## Alternatives

- Mailto: smaller but does not deliver the requested dialog or a reliable collection flow.
- CRM/database capture plus delivery queue: more durable, but adds persistence, lifecycle and operations beyond the requested first slice.
- Direct browser-to-provider send: unacceptable because credentials and destination control must remain server-side.

## Consequences

The landing page gains a narrow public side effect and must test abuse refusal, provider failure and retries. Missing sender, service inbox or limiter configuration prevents live booking acceptance without taking down the public page. Lost provider responses are retried using the same id; reloads and retries outside Resend's retention window may produce a duplicate. A future need for guaranteed capture, lead lifecycle or bounce processing requires a new approved slice.
