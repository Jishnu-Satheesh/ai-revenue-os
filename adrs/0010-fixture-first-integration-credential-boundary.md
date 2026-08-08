# ADR 0010: Use fixture-first provider adapters and a credential-store boundary

## Status

Accepted; implementation not started.

## Context

The Integration Hub needs a provider-agnostic foundation and one representative provider without blocking development on external API approval. Google Business Profile requires application approval and provides no general sandbox. Real OAuth credentials also require a storage boundary that does not expose secrets to tenant tables, browser code, logs, model prompts, or general repositories.

Supabase Vault can store authenticated encrypted secrets and return opaque UUID references, but Supabase currently labels Vault Public Alpha. Coupling the integration domain directly to Vault would make a security-sensitive alpha feature difficult to replace or harden.

## Decision

- Define provider metadata and adapter contracts in versioned TypeScript.
- Use Google Business Profile as the V1 reference provider through a deterministic, read-only fixture adapter.
- Keep real Google OAuth and provider calls disabled until Google approves API access.
- Define a server-only `CredentialStore` interface; target Supabase Vault as its production implementation.
- Store only opaque credential references and non-secret account/scope/expiry/health metadata in application tables.
- Do not grant browser roles access to Vault decrypted values or use a general service-role client to bypass RLS in user-facing routes.
- Require a documented security review before enabling real credentials, covering least privilege, rotation, revocation, backup/restore key handling, incident recovery, and migration to another credential store.
- Use Trigger.dev for durable tests, syncs, imports, freshness checks, and disconnect cleanup. Postgres remains the business-state source of truth.
- Exclude provider writes and webhooks from V1.

## Consequences

- Integration domain work and UI verification can proceed without fabricating Google API access.
- Fixture and production adapters must satisfy the same contracts, reducing replacement risk.
- The platform can replace Vault without changing connection, capability, or worker domain interfaces.
- V1 cannot validate real OAuth behavior; that work remains behind explicit external and security gates.
- Disconnect must disable local capabilities before asynchronous credential cleanup.
- Provider payload normalization remains a separate Data Ingestion responsibility.

## References

- `specs/003-integration-hub.md`
- `docs/superpowers/specs/2026-08-08-integration-hub-design.md`
- <https://developers.google.com/my-business/content/prereqs>
- <https://developers.google.com/my-business/content/basic-setup>
- <https://supabase.com/docs/guides/database/vault>
- <https://supabase.com/features/vault>
