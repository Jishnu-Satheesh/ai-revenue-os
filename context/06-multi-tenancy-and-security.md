# Multi-Tenancy and Security

## Tenant model

An `Account` is the agency and is the tenant root. Each client is an `Organization` belonging to
exactly one account. Every tenant-owned record must contain `organization_id` directly or inherit it
through a relation that is safely enforced.

A user reaches an organization either through an explicit `organization_memberships` row or through
membership of the account that owns it. Those combine as a union of grants — the highest-ranked grant
wins and nothing subtracts — resolved in exactly one place,
`private.effective_organization_role`. Every RLS policy in the schema resolves through it via
`private.is_organization_member` and `private.has_organization_role`; the application reads the same
answer through `public.current_organization_role`. Nothing else may re-implement this rule. See
ADR 0022.

## Isolation strategy

- Supabase Row Level Security is mandatory for tenant-owned tables.
- User requests use authenticated database context.
- Background workers use privileged credentials only with an explicit, validated `organizationId` and repository methods that always scope queries.
- Cross-client aggregation uses de-identified, minimum-group-size datasets and must never expose a competitor's raw data.

## Authorization

Authorization is permission-based, not based only on role labels. Roles are bundles of permissions,
and the bundles are **rows in the database**, seeded by migration: `public.permissions` holds the
vocabulary, `public.account_role_permissions` and `public.organization_role_permissions` hold the
mapping. Changing what a role may do is a data change reviewed as a migration. See ADR 0023.

Checks go through `private.has_account_permission` and `private.has_organization_permission`, which
resolve the caller's role through `private.effective_organization_role` — so a permission check can
never be a route around the tenancy boundary.

`src/domain/access/permissions.ts` mirrors the catalogue so the browser can hide a control a role
cannot use. **The mirror grants nothing**, and `permissions.drift.test.ts` fails if it disagrees with
the migration.

Two things are deliberately still in progress, and should be read as fact rather than as oversight:

- **Existing checks still compare role labels.** The 219 policy checks that predate the catalogue use
  `private.has_organization_role`. New policies and routes use permissions; existing checks migrate
  when their surrounding code is touched for another reason.
- **Nothing enforces a permission yet.** The first consumer is `member.invite` in the invitations
  slice of `specs/017-account-identity-and-access.md`.

The vocabulary, in full, is the seeded catalogue. Examples:

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
