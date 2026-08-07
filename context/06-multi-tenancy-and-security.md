# Multi-Tenancy and Security

## Tenant model

Each client is an `Organization`. Every tenant-owned record must contain `organization_id` directly or inherit it through a relation that is safely enforced.

## Isolation strategy

- Supabase Row Level Security is mandatory for tenant-owned tables.
- User requests use authenticated database context.
- Background workers use privileged credentials only with an explicit, validated `organizationId` and repository methods that always scope queries.
- Cross-client aggregation uses de-identified, minimum-group-size datasets and must never expose a competitor's raw data.

## Authorization

Authorization is permission-based, not based only on role labels. Examples:

- `organization.read`
- `organization.update`
- `integration.connect`
- `opportunity.approve`
- `campaign.publish`
- `budget.modify`
- `customer_data.export`

## Secrets

- Do not store provider access tokens in plaintext application tables.
- Use a secrets manager or encrypted credential store.
- Persist only a credential reference, scopes, account identifiers, expiry, and health metadata.
- Never place secrets in model prompts, logs, analytics, or client-visible errors.

## AI security

- Treat uploaded documents, reviews, menus, and external web content as untrusted input.
- Separate instructions from retrieved content.
- Tool calls require typed schemas and allowlisted capabilities.
- Models cannot select arbitrary URLs, database queries, shell commands, or provider endpoints.
- Sensitive actions require deterministic policy evaluation after model output.

## Audit requirements

Audit at minimum:

- Membership and role changes.
- Integration connect/disconnect and scope changes.
- Policy, budget, and approval-threshold changes.
- Opportunity approval or rejection.
- Tool invocation for money-moving or public actions.
- Data exports and deletions.
- AI-generated changes to public content.

## Data governance

- Classify data as public, internal, confidential, sensitive PII, or credential.
- Collect only necessary customer data.
- Record consent and lawful communication preferences where relevant.
- Support retention and deletion policies.
- Review UAE privacy and marketing requirements with qualified counsel before production deployment; documentation here is an engineering baseline, not legal advice.
