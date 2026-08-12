# Credential and OAuth security review

Covers the substrate added by migration `20260812110000_integration_oauth_sessions.sql`,
`src/modules/integrations/infrastructure/vault-credential-store.ts`,
`src/domain/integrations/oauth-session.ts`, and
`src/modules/integrations/application/oauth-service.ts`.

**Status: not signed off.** This document records the design and its evidence so a
reviewer can assess it. Gate 4 stays closed until a named reviewer signs the sign-off
section, and separately until a verified provider contract and controlled-account
evidence exist. Nothing in this substrate makes any provider executable today.

## What is stored, and where

| Value | Location | Reachable by |
| ----- | -------- | ------------ |
| Provider secret (access/refresh token) | Supabase Vault (`vault.secrets`), encrypted | Only the four security-definer RPCs, which run as `postgres` |
| Credential reference, organization, provider, timestamps | `private.integration_credentials` | Same RPCs only; `authenticated` and `anon` hold no table privilege |
| OAuth `state` | Never stored | — |
| SHA-256 digest of `state` | `public.integration_oauth_sessions` | Only the start/consume RPCs; the table has forced RLS and no grants |
| Meta application id and secret | Environment (`META_APP_ID`, `META_APP_SECRET`) | Server process only; optional and configured as a pair |

The application never persists a secret in a tenant-readable table. A leaked
`private.integration_credentials` row yields a Vault reference and no plaintext.

## Least privilege

- `create/resolve/replace/revoke_integration_credential` have `execute` revoked from
  `public`, `anon`, and `authenticated`. Only a service-role caller reaches them.
- `start_integration_oauth_session` and `consume_integration_oauth_session` are granted to
  `authenticated`, and each independently re-checks that the caller holds `owner`,
  `admin`, or `operator` through `private.has_organization_role`. A `viewer` cannot open a
  handshake.
- `authenticated` holds `usage` on the `private` schema because tenancy helpers are
  granted to it; it holds no privilege on `private.integration_credentials` itself. This is
  asserted directly in pgTAP rather than assumed.
- Every RPC runs `security definer` with `set search_path = ''` and fully qualified calls.

## Secrets in transit through the application

`CredentialStore.resolve` returns a value whose `value` property is non-enumerable and
whose `toJSON` throws. A spread yields an empty object, `JSON.stringify` raises rather
than emitting the secret, and `toString` returns `[redacted credential]`. Database and
provider error text is never forwarded: failures are mapped to a fixed operator message
with a stable code, and the original is kept only on `internalCause`.

The OAuth callback returns an opaque result code and never the authorization code, the
exchanged token, or the credential reference. Failure shapes are uniform so a probe cannot
distinguish "wrong tenant" from "no such session".

## Handshake integrity

- `state` is 32 random bytes from `node:crypto`, base64url encoded.
- Only its SHA-256 digest is persisted, and the digest column is globally unique, so one
  tenant's redirect cannot be reconciled against another tenant's pending session.
- Comparison uses `timingSafeEqual` over digests.
- Consumption is a single `update ... where consumed_at is null`, so two concurrent
  replays of one redirect cannot both succeed.
- Session identity is immutable by trigger: organization, user, provider, digest, scopes,
  callback, creation, and expiry cannot be rewritten, and a consumed session cannot be
  re-consumed by direct write.
- Sessions expire, with a lifetime constrained to 60–1800 seconds. The domain layer treats
  the exact expiry instant as expired, matching the RPC's `expires_at <= now()`.
- The authorization URL carries only the public client id, the fixed callback, the
  requested scopes, and the state. The client secret is used server-side or not at all.

## Rotation, revocation, and idempotency

- Writes carry an idempotency key. A retried connect returns the existing reference rather
  than minting a second live secret; this is asserted in pgTAP.
- `replace` rotates the secret behind the same reference, so stored connections keep
  working without learning the new value.
- `revoke` is repeat-safe: an absent or already revoked credential is success, so a retried
  disconnect cannot strand a connection half-revoked. It deletes the Vault secret and marks
  the row revoked; a revoked credential can no longer be resolved.

## Evidence

- `supabase/tests/database/integration_oauth_sessions_test.sql` — 26 assertions covering
  table exposure, role gating, two-tenant isolation, single-use consumption, expiry,
  immutability, idempotent create, cross-tenant resolve refusal, and repeat-safe revoke.
- Remote pgTAP across the whole repository: 368 assertions, 0 failures.
- `oauth-session.test.ts` (20), `vault-credential-store.test.ts` (10),
  `oauth-service.test.ts` (9), `oauth-routes.test.ts` (3),
  `meta-oauth-application.test.ts` (3).

## Known gaps, carried deliberately

1. **No provider is registered as connectable.** `productionOAuthApplications` is empty, so
   every connect attempt fails closed before a session row is written. Registering a
   provider is a claim that its endpoints, scopes, and exchange were verified against
   current official documentation and exercised on a controlled account.
2. **Key ownership is Supabase-managed.** Vault's encryption key lifecycle belongs to the
   platform; this design does not add customer-managed keys. A reviewer should accept or
   reject that explicitly.
3. **Vault remains a young Supabase feature.** ADR 0010 anticipated this and kept the
   `CredentialStore` port replaceable; swapping the implementation does not change the
   domain interface.
4. **Backup and restore of Vault secrets is untested here.** A restore drill belongs to
   operational readiness in Task 20.
5. **No token refresh loop exists yet.** Expiry-driven refresh arrives with the first real
   provider adapter.
6. **Revocation deletes the Vault secret.** Audit metadata survives on the credential row;
   the secret itself is unrecoverable by design.

## Sign-off

| Field | Value |
| ----- | ----- |
| Reviewer | _pending_ |
| Date | _pending_ |
| Decision | _pending_ |
| Conditions | _pending_ |
