# Public walkthrough request — complete contract

Status: proposed implementation contract. The user explicitly requested a **Book a walkthrough** dialog collecting email, phone and business industry, delivered through Resend to customer service configured in `.env.local`. This replaces the earlier exploration-only CTA assumption.

Related: [design](../specs/2026-09-11-public-landing-redesign.md), [visual contract](2026-09-11-public-landing-visual-contract.md), [execution plan](2026-09-11-public-landing-implementation.md), [ADR 0056](../../../adrs/0056-public-walkthrough-email-capture.md).

## 1. Boundary and existing code

- One public POST route, no signup/session required, no business workspace selected, no tenant database access.
- Contact fields exist only in the browser's in-memory draft, the bounded server request, Resend and the customer-service mailbox. No lead table, audience subscription, customer autoresponder, CRM integration or background worker.
- Installed versions at review: `resend` 6.20.0, `@upstash/ratelimit` 2.0.8 and `@upstash/redis` 1.38.4. No install or upgrade is needed.
- Follow the explicit `{ data, error }` handling in `src/modules/accounts/application/email.ts`; do not reuse its invitation sender or no-op-success assumptions. Do not inherit its default From address without configuration.
- `src/lib/cache/rate-limit.ts` is an organization analysis limiter that fails open. Do not modify or reuse its policy for anonymous email requests.
- `src/proxy.ts` refreshes sessions for all matching requests today. Add an exact-path early return only for `/api/public/walkthrough-requests` so this endpoint has no Supabase dependency. The root `/` and every other path retain existing behavior. Test both sides of the exemption.

## 2. Proposed files and interfaces

| File                                                               | Responsibility and public interface                                                                                                                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/marketing/domain/walkthrough-request.ts`              | Browser-safe Zod schemas; exports `walkthroughRequestSchema`, `walkthroughResponseSchema`, types `WalkthroughRequest`, `WalkthroughResponse`                                                                        |
| `src/modules/marketing/application/walkthrough-email.ts`           | Pure text body builder; exports `buildWalkthroughEmailText(request: WalkthroughRequest): string`                                                                                                                    |
| `src/modules/marketing/infrastructure/walkthrough-config.ts`       | Server-only local config parser; exports `readWalkthroughConfig(): WalkthroughConfigResult`                                                                                                                         |
| `src/modules/marketing/infrastructure/walkthrough-rate-limit.ts`   | Server-only limiter; exports `consumeWalkthroughAllowance(input: { email: string; headers: Headers }, config: WalkthroughConfig): Promise<WalkthroughAllowance>`                                                    |
| `src/modules/marketing/infrastructure/walkthrough-email-sender.ts` | Server-only Resend adapter; exports `sendWalkthroughRequest(request: WalkthroughRequest, config: WalkthroughConfig): Promise<WalkthroughSendResult>`                                                                |
| `src/modules/marketing/application/submit-walkthrough-request.ts`  | Server-only orchestration over injected ports; exports `handleWalkthroughRequest(request: Request, deps: WalkthroughDependencies): Promise<Response>`                                                               |
| `src/modules/marketing/application/api.ts`                         | Server-only composition root; wires concrete adapters and exports `submitWalkthroughRequest(request: Request): Promise<Response>`                                                                                   |
| `src/modules/marketing/application/walkthrough-ports.ts`           | Port/result types, including `WalkthroughDependencies` and server configuration/result types; no concrete adapter imports                                                                                           |
| `src/modules/marketing/application/read-bounded-json.ts`           | `readBoundedJson(request: Request): Promise<BoundedJsonResult>`; max 4096 bytes and 5-second deadline; returns value or a bounded failure code                                                                      |
| `src/modules/marketing/index.ts`                                   | Server-only facade exporting `submitWalkthroughRequest`; do not export domain schemas through this server barrel                                                                                                    |
| `src/app/api/public/walkthrough-requests/route.ts`                 | `runtime = "nodejs"`, `maxDuration = 30`, `POST(request: Request): Promise<Response>` delegating to the facade                                                                                                      |
| `src/components/marketing/walkthrough-provider.tsx`                | Client context + one dialog; exports `WalkthroughProvider({ children }: { children: ReactNode })` and `BookWalkthroughButton` with Button-style `className`, `size`, `variant` and optional `onBeforeOpen` callback |
| `src/components/marketing/use-walkthrough-request.ts`              | Client hook `useWalkthroughRequest(): WalkthroughController`; owns draft, validation, request identity and submission lifecycle while provider remains mounted                                                      |
| `src/components/marketing/walkthrough-form.tsx`                    | Client presentation; exports `WalkthroughForm({ controller, onDone }: { controller: WalkthroughController; onDone: () => void })`; no private sender imports                                                        |

Type contracts:

- `WalkthroughDependencies`: `readConfig(): WalkthroughConfigResult`, `consumeAllowance(input: { email: string; headers: Headers }, config: WalkthroughConfig): Promise<WalkthroughAllowance>`, `send(request: WalkthroughRequest, config: WalkthroughConfig): Promise<WalkthroughSendResult>`. Service may use the shared logger, Node UUID and performance timer directly. Only `application/api.ts` imports runtime infrastructure.
- `BoundedJsonResult`: `{ ok: true, value: unknown }` or `{ ok: false, code: "PAYLOAD_TOO_LARGE" | "INVALID_REQUEST" }`. Timeout/empty/malformed body returns INVALID_REQUEST; byte overflow returns PAYLOAD_TOO_LARGE.
- `WalkthroughController`: `fields: { email: string; phone: string; industry: string; website: string }`, `fieldErrors: Partial<Record<"email" | "phone" | "industry", string>>`, `status: "idle" | "pending" | "failed" | "accepted"`, `failureCode: WalkthroughFailureCode | null`, `changeField(name: "email" | "phone" | "industry" | "website", value: string): void`, `blurField(name: "email" | "phone" | "industry"): void`, `submit(): Promise<void>`, `reset(): void`. Hook keeps attempt ids private. Form handles focusing invalid fields/success heading from returned state.

- `WalkthroughRequest`: `requestId: string`, `email: string`, `phone: string`, `industry: string`, `website: string` (honeypot, must be empty).
- `WalkthroughResponse`: accepted `{ outcome: "accepted", requestId: string }`; refusal `{ outcome: "rejected", code: WalkthroughFailureCode, fieldErrors?: Partial<Record<"email" | "phone" | "industry", string>>, retryAfterSeconds?: number }`. Validate response at the client boundary, never trust HTTP status alone.
- `WalkthroughFailureCode`: `INVALID_REQUEST`, `ORIGIN_REFUSED`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_CONTENT_TYPE`, `RATE_LIMITED`, `TEMPORARILY_UNAVAILABLE`, `SEND_UNCONFIRMED`, `REQUEST_CONFLICT`.
- `WalkthroughConfig`: nonempty `apiKey`, single-address `fromEmail`, single-address `toEmail`, `appOrigin`, `redisUrl`, `redisToken`, `rateLimitSecret`; server-only.
- `WalkthroughConfigResult`: `{ ready: true, config: WalkthroughConfig }` or `{ ready: false }`. No env values in returned errors/logs.
- `WalkthroughAllowance`: `{ outcome: "allowed" }`, `{ outcome: "limited", retryAfterSeconds: number }`, or `{ outcome: "unavailable" }`.
- `WalkthroughSendResult`: `{ outcome: "accepted" }`, `{ outcome: "unconfirmed" }`, `{ outcome: "conflict" }`, or `{ outcome: "unavailable" }`. Do not expose Resend payloads or delivery ids to the browser.

## 3. Environment configuration

Read this module's settings through its own server-only parser so a missing contact setting cannot crash the rest of the app. Do not expand the shared `src/lib/env.ts` eager validation or change invitation settings.

| Name                            | Validation                                                      | Setup                                                           |
| ------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| `RESEND_API_KEY`                | Nonempty                                                        | Existing shared server-only key; may be reused                  |
| `WALKTHROUGH_FROM_EMAIL`        | Single email, max 254 characters, no display-name/header syntax | A sender on a Resend-verified domain                            |
| `CUSTOMER_SERVICE_EMAIL`        | Single email, max 254 characters, no comma/newline              | The inbox selected by the user                                  |
| `NEXT_PUBLIC_APP_URL`           | Parse URL; use `.origin`; HTTPS outside local development       | Existing application URL, matching the environment being tested |
| `UPSTASH_REDIS_REST_URL`        | Valid HTTPS URL                                                 | Existing Upstash configuration                                  |
| `UPSTASH_REDIS_REST_TOKEN`      | Nonempty                                                        | Existing Upstash configuration                                  |
| `WALKTHROUGH_RATE_LIMIT_SECRET` | At least 32 characters                                          | Random server-only secret for HMAC rate-limit identifiers       |

Add empty email-setting examples and explanatory comments to `.env.example`; don't duplicate the existing Upstash names. Never print `.env.local`, copy it to docs, commit it, overwrite it via env pull, or invent the service inbox. Document the names the user needs to set. Missing configuration is an honest deployment blocker, not a reason to stop implementation or unit/browser tests with mocked delivery.

Local development alone does not configure a hosted deployment. Set the same server-only values in the chosen deployment environment, and restart/redeploy after changing them. Do not mark live booking complete until the real inbox check passes.

## 4. Validation contract

- Strict JSON object only. Unknown fields are rejected, including caller-provided recipient, sender, HTML, subject, organization id, attachments or URLs.
- UUID `requestId`; the client generates it with `crypto.randomUUID()` at the first valid submit, never during SSR.
- Email: trim; reject control characters; valid Zod email; maximum 254 characters. Preserve submitted casing in the message; lowercase only the rate-limit identifier.
- Phone: trim, maximum 32 characters before normalization. Permit a leading `+`, digits, spaces, parentheses and hyphens; remove those separators; require normalized `+` followed by 8–15 digits, with first digit nonzero. No guessed country prefix or phone extensions. Use `type="tel"`, autocomplete `tel` and a country-code hint. This validates plausible shape, not ownership or reachability.
- Industry: trim, 2–80 characters; allow Unicode words and ordinary punctuation; reject all control characters including CR/LF and markup delimiters `<` and `>`. Short text keeps the core industry-neutral without inventing a provider catalogue.
- Honeypot `website`: string defaulting to empty, maximum 200 characters; nonempty returns generic `INVALID_REQUEST` without sending. It is visually hidden and excluded from keyboard navigation/assistive reading; do not use a real required company field for this purpose.
- Body size: maximum 4096 UTF-8 bytes. Reject oversized Content-Length early, but also stream/count bytes and cancel on overflow before JSON parse; missing/chunked Content-Length must not bypass the bound. Limit body reading to 5 seconds.
- Content-Type must be `application/json`, allowing a charset parameter. Reject malformed JSON and arrays with generic safe errors. Do not send raw Zod issue objects to the browser.
- Exact field messages: “Enter a valid email address.” / “Enter a phone number with country code.” / “Enter your business industry (2–80 characters).”

## 5. Server sequence and abuse controls

1. Start a monotonic timer; create a server-generated correlation UUID for logging. Do not use raw unvalidated input as a log field.
2. Read/validate module config. If unavailable, return 503 `TEMPORARILY_UNAVAILABLE` without attempting email. This must not throw during page rendering or build.
3. Require `Origin` equal to configured `appOrigin`. Reject absent, `null` and foreign origins with 403. Never derive the trusted origin from request Host headers. Do not add permissive CORS. This blocks cross-site browser submissions; it does not authenticate arbitrary HTTP callers.
4. Check content type and body bound; parse and validate the strict schema. Refuse honeypot/invalid input before calling Resend.
5. Consume distributed allowance using existing Upstash packages with a separate prefix `marketing:walkthrough:v1`. Require ALL: global 20/hour, global 60/day, email 3/hour, IP 5/hour. Check the four independent allowances in parallel, inspect every result, and require all to pass; never discard a rejected/timeout result. These are conservative initial operating limits; raising them is a deliberate follow-up, not an agent tuning choice.
6. Rate-limit identifiers: HMAC-SHA256 with the configured secret over `email:` + normalized email and `ip:` + normalized IP. Redis stores hashes/counters with limiter-managed expiring windows; never raw contact data. Analytics disabled; handle returned pending promises. Do not log identifiers/hashes.
7. Trust `x-vercel-forwarded-for` only when the server's deployment environment has `VERCEL=1`; parse a single valid IPv4/IPv6 using `node:net`, canonicalize IPv6, and aggregate IPv6 to /64 for allowance. On any other deployment or missing/invalid trusted IP, use one shared “unattributed” IP bucket. No arbitrary `x-forwarded-for` fallback, no production in-memory limiter. Email and global limits still apply, including localhost.
8. Configure a 1500ms Upstash SDK timeout and treat `reason === "timeout"` as unavailable even if its response says success. Throw/reject/timeout/missing configuration all fail closed as 503. The existing analysis limiter's fail-open behavior is not acceptable here. `success: false` returns 429 with Retry-After based on the largest applicable reset; at least 1 second.
9. Call Resend once with the validated fixed-destination message and stable idempotency key. No application retry loop and no background task. Resolve according to the response contract below.
10. Every response has `Cache-Control: no-store`. Add no contact information to query strings, logs, redirects, response bodies, analytics, traces or error telemetry. Log only event, correlationId, durationMs, bounded code and httpStatus using existing logger fields.

The global allowance bounds outgoing volume even if an attacker rotates IPs or email addresses. This is a bounded contact form, not comprehensive bot detection. No CAPTCHA dependency is added for the first slice; sustained abuse should be addressed through a separately reviewed gate, not a silent expansion by the implementation agent.

## 6. Resend message and retry semantics

- `from`: `RIO <WALKTHROUGH_FROM_EMAIL>` constructed by the server.
- `to`: exactly `[CUSTOMER_SERVICE_EMAIL]` from config; never the submitted email.
- `replyTo`: validated visitor email, not the From address.
- Subject: fixed **RIO walkthrough request**.
- Plain text body, in this exact field order: heading “New RIO walkthrough request”, blank line, “Email: {email}”, “Phone: {normalizedPhone}”, “Business industry: {industry}”, “Request reference: {requestId}”, blank line, “Submitted through the RIO public website. Please contact the requester to arrange a walkthrough.”
- No HTML template or React Email dependency is necessary. No variable timestamp, changing referrer or per-request correlation id in the message: identical retries must produce the same Resend payload.
- SDK option: `idempotencyKey` = `rio-walkthrough/` + requestId. Reuse for a retry of the same normalized payload. Resend documents a 24-hour window; this is not an indefinite exactly-once delivery guarantee. [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)
- Client holds request id, payload identity and submission status in memory across dialog close/reopen and a retry; never in localStorage/sessionStorage. Editing a field after a failed attempt starts a new id on the next submit. Reloading loses the id, so rate limits bound duplicates but cross-reload deduplication is not guaranteed.
- Accept only `{ data: { id: nonemptyString }, error: null }` from the SDK. Its promise can resolve with an error; success feedback must not be based on promise fulfillment. [Resend send API](https://resend.com/docs/api-reference/emails/send-email)
- Installed SDK request options do not expose an AbortSignal. Bound the wait to 12 seconds and map expiry to SEND_UNCONFIRMED; clear the timeout and handle late resolution/rejection. Do not claim the underlying email call was cancelled. A retry with the same id can recover an email already accepted by Resend.
- Resend payload-conflict idempotency errors → 409 REQUEST_CONFLICT. Concurrent same-key in-progress response → retryable SEND_UNCONFIRMED. Other provider refusal, missing id, thrown exception or timeout → 502 SEND_UNCONFIRMED. Configuration failures → 503. Do not return the provider message or credentials.
- 202 `{ outcome: "accepted", requestId }` means Resend accepted the request email. It is not proof of mailbox delivery, a scheduled meeting, or a lead saved in an application database. Bounce handling and a durable outbox are not included.

## 7. Form behavior

- Use existing shadcn Dialog, Button, Input, Field/FieldLabel/FieldError and Alert. This is a small three-field form: local controlled React state plus shared Zod is sufficient; no new form library.
- One WalkthroughProvider wraps the server-composed landing children, calls `useWalkthroughRequest()` once outside the portal, and owns one dialog. This preserves state when Radix unmounts its closed content. The form receives the controller as props; do not create a circular provider/form context import. BookWalkthroughButton is used in nav, hero, closing and mobile menu. Do not create one dialog per CTA.
- Server-render the page as before; the client provider does not fetch initial config or send requests on mount.
- Required fields validate on submit, then on blur after being touched; do not interrupt typing with errors. Preserve values for all failures. Disable submit and inputs while pending; prevent double submit in both handler and disabled state.
- Awaiting response uses “Sending request…”. Allow dismissal; a pending attempt remains tracked by the provider and cannot be duplicated by reopening. Ignore stale component updates after unmount; never silently launch another attempt.
- Network timeout at 20 seconds yields SEND_UNCONFIRMED UI with the same request id available for retry. No automatic re-send.
- Generic failure: “We couldn’t confirm your request. Please try again.” 429: “Too many requests. Please try again later.” 503: “Walkthrough requests are temporarily unavailable. Please try again later.” Conflict: “This request changed. Please review your details and submit again.”
- On conflict, retain fields and clear the id only for the user's next explicit submit. No automatic generation/send loop.
- On validated 202 accepted, clear sensitive draft values and show the success content in the visual contract. Keep the accepted id/status in memory until Done; Done closes and resets the form for a genuinely new request.
- Validate server response JSON using the discriminated response schema. HTTP 200 with an error body, empty 202, HTML error page, mismatched request id or malformed JSON must never show success.

## 8. Tests and operational verification

- Schema: valid email/phone/Unicode industry; normalization; 254/255 email length boundary; 80/81 industry boundary; short/overlong/bad-prefix phones; controls/newlines; unknown recipient fields; populated honeypot; invalid UUID.
- Pure email builder: stable output for retry; constant subject/from/to in sender; visitor only in replyTo/text; no raw HTML/header injection; no timestamp-dependent content.
- Sender: accepted response, returned SDK error, missing id, rejection, 12s timeout, conflict and same-key replay. Mock the SDK: automated suites never mail real people.
- Limiter: four required allowances, rate refusal, timeout reason with success=true, exception, missing config, email/IP hashing, spoofed forwarded header outside Vercel, global/unattributed fallback, IPv6 aggregation. No raw contact data/PII in limiter keys or logs.
- Route: missing/foreign Origin, wrong content type, oversized declared and streamed body, malformed JSON, no config, invalid fields, rate refusal, successful 202, provider error and retry. Assert no email call for every refusal, no reflection of PII/errors, no cookies or caching.
- Proxy: only the exact endpoint skips session refresh; adjacent path, `/`, `/login` and organization APIs still call the existing session updater.
- Dialog/browser: all CTA placements, focus restoration, keyboard fields, required errors, slow response/double click, server refusal, offline retry with same id, success then Done reset; mobile menu handoff; closing/reopening during pending; no contact data in browser persistence.
- Live acceptance after configuration: use clearly labeled synthetic test contact details, send one controlled walkthrough request to the configured service inbox, repeat the exact id/payload once, verify one provider message and one inbox message. User approval of this plan includes this narrowly scoped smoke test; do not send tests to visitors. Inbox receipt must be observed by an available authorized inbox tool or confirmed by the user, not inferred from API acceptance.
- Record: timestamp, environment label, outcome, duration, duplicate check and inbox confirmation status; no recipient/contact fields or message body in committed evidence. If configuration/inbox access is unavailable, finish implementation and mocked tests and explicitly mark live delivery acceptance pending.

## 9. Supporting primary references

- [Resend sender-domain verification](https://resend.com/docs/dashboard/domains/introduction) — sender must be configured on a verified domain before real delivery acceptance.
- [Upstash response methods](https://upstash.com/docs/redis/sdks/ratelimit-ts/methods) — inspect timeout reason and pending work; do not equate a timeout-allowed result with a verified allowance.
- [Vercel request headers](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for) — trusted platform header semantics only apply on that deployment boundary.

Retention is limited in this implementation by not adding an application contact store. Resend and the customer-service mailbox still retain the message under their configured policies; expiring rate-limit counters retain pseudonymous identifiers. Do not claim that contact data is never stored or automatically deleted everywhere.
