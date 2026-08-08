# Integrations

## Integration strategy

Integrations are capabilities with varying levels of access. The platform must work with API connections, provider exports, spreadsheets, email reports, and structured manual entry.

The approved V1 vertical slice is fixture-first and health-first. Google Business Profile is the reference read-only provider, backed by a deterministic fixture until API approval. Manual and CSV sources are modeled as data sources rather than provider connections. Provider writes and webhooks are not part of V1.

## Connection maturity levels

1. **Manual** - user enters or uploads data.
2. **Imported** - periodic CSV or spreadsheet import.
3. **Read-only** - API sync or webhook ingestion.
4. **Draft-write** - system creates drafts but does not publish.
5. **Governed-write** - system executes approved actions.
6. **Bounded-autonomous** - system executes allowlisted actions within policy.

## Capability registry

Examples:

- `read_orders`
- `read_menu`
- `update_menu_listing`
- `read_reviews`
- `draft_review_response`
- `publish_review_response`
- `read_ad_performance`
- `create_ad_draft`
- `publish_ad_campaign`
- `send_whatsapp_template`
- `read_google_business_profile`
- `publish_google_business_post`

## Provider adapter contract

Each adapter defines:

- Supported capabilities.
- Required scopes.
- Credential lifecycle.
- Rate limits.
- Webhook support.
- Idempotency support.
- Read/write risk classification.
- Provider-specific error normalization.
- Health-check behavior.

Provider definitions and adapters are versioned in TypeScript. Connection state, derived capability grants, account mappings, data sources, ingestion runs, and health checks are tenant-scoped in Postgres. Provider payloads cross Zod validation before the Data Ingestion handoff.

Credentials are accessed only through a server-only `CredentialStore`. The target implementation is Supabase Vault, while application tables contain only opaque credential references and safe metadata. Real OAuth remains disabled until provider approval and a credential security review pass. See ADR 0010 and `specs/003-integration-hub.md`.

## Delivery marketplaces

Do not assume direct APIs exist or expose all required operations. Onboarding must determine the exact platforms and access method.

The client mentioned Talabat, noon, and DoorDash. During onboarding, verify whether "DoorDash" refers to a specific marketplace account, Deliveroo, a merchant service, or an informal name. Store only confirmed provider identities.

## n8n usage

Use n8n when it substantially accelerates a non-core connector. Keep core decision logic, policy, domain state, and critical execution behavior in versioned application code.
