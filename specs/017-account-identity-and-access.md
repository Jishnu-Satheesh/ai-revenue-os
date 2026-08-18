# Feature Specification: Account Identity and Access

## Status

Implemented 2026-08-17, all four slices, live on staging.

Delivered against the plan with three deliberate deviations, each recorded where it applies: email delivery is out of scope in favour of copy-link (see Scope); the account role-ceiling rule permits an owner to appoint a co-owner (see Domain rules); and the membership role-ceiling trigger was widened to admit a subject holding a live invitation, which `supabase/migrations/20260817151000_account_invitations.sql` explains and `supabase/tests/database/account_invitation_test.sql` proves cannot be used to self-admit.

Remaining follow-ups are listed under "Out of scope" and are unchanged: per-organization access control, a `reviewer` role, Platform Admin, and transactional email.

Introduces ADR 0022 (Account as the tenant root above Organization) and ADR 0023 (Permission-as-data
authorization). Amends `context/04-domain-model.md`, `context/05-module-map.md`,
`context/06-multi-tenancy-and-security.md`, and `context/13-ui-ux-context.md` §5.1.

Supersedes nothing. This is the first feature to touch the tenancy boundary established in
`supabase/migrations/20260807000000_initial_tenancy.sql`.

## Business outcome

A second person can work in the platform.

Today the platform has exactly one way for a human to gain access: create an organization and become
its owner by side effect. There is no invitation, no account above the organization, and no way to
give someone access to the agency's client portfolio without handing over credentials. A two-person
agency cannot operate as two people.

Two outcomes are separable and both count:

- **A teammate can be admitted at a chosen level of authority**, in minutes, without a developer.
- **The authorization model becomes durable**, so that per-organization access control, a reviewer
  role, and client-side seats are later additions of data rather than rewrites of the schema.

The second outcome is the larger one. The platform currently has 219 policy checks depending on a
role model that was designed for a single tenant level. Admitting a teammate is the forcing function
for getting the level above right, once.

## User stories

- As an account owner, I invite a teammate by email and choose what they can do before they arrive,
  so authority is a decision I make deliberately rather than one I grant by default.
- As an account owner, I hand the invited teammate a link, because email delivery is not yet built
  and a working invitation today is worth more than a blocked one.
- As an account owner, I revoke an invitation I sent to the wrong address, so a typo is recoverable.
- As an invited teammate, I follow the link, sign in with the address it was sent to, and land in a
  client workspace, so joining is one step and not a support conversation.
- As an invited teammate, I get access to every client the agency runs today **and every client it
  takes on tomorrow**, without anyone remembering to add me.
- As an account owner, I later restrict a teammate to a subset of clients, and nothing about the
  existing model has to be rebuilt to allow it.
- As an engineer, I read one table to learn what a role can do, and a test fails if the application
  disagrees with it.

## Scope

### In scope

- `Account` as the tenant root above `Organization`, with a backfill of existing data.
- Account membership carrying both an **account role** and a **default organization role**.
- A single effective-role resolver, and the rewiring of the two existing RLS helpers to use it.
- A permission catalogue and role-to-permission mapping held as versioned data in the database,
  with a TypeScript mirror and a drift test.
- Invitations: create, reissue, revoke, preview, accept. Single-use hashed tokens, 7-day expiry,
  email-bound acceptance.
- Copy-link delivery. The invitation link is produced in the product and shared by the inviter.
- An `Invite member` entry in the sidebar footer, gated on the `member.invite` permission, opening a
  dialog with the invitation form and the pending-invitation list.
- A public `/invitations/[token]` acceptance route.
- Account-scoped audit events on the existing audit spine.

### Out of scope

- **Email delivery.** Decided deliberately: no transactional email provider exists in the repository
  and adding one is a separable change. The invitation record and the accept path are designed so
  that sending the same link by email later is additive — a new adapter and one call site, no schema
  change. Until then, `Copy link` is the delivery mechanism and the UI says so plainly.
- **A `reviewer` organization role.** Genuinely wanted for approval separation of duties, but once
  role-to-permission is a table it costs one enum value and a few rows. Deferred so it is not
  decided under the pressure of this change.
- **Platform Admin / staff impersonation.** Support access into customer tenants is its own security
  design — consent, session recording, bounded duration. `context/04-domain-model.md` lists it; this
  spec removes it from the near-term role set rather than approximating it.
- **Per-organization access control.** The data model admits it (see Domain rules); no UI or API
  issues an organization-scoped grant in this release.
- **Moving an organization between accounts.** `organizations.account_id` is immutable after
  creation. Re-parenting a client is a data-migration operation, not a product feature.
- **Client-side seats.** Inviting a client's own staff into their single organization is a distinct
  flow with distinct copy and defaults. The model supports it; this release does not build it.
- **Billing, seat limits, and an account-level settings page.** No billing exists to govern.
- **Any AI behavior.** This feature contains no model call. Authorization is deterministic by
  construction, and `context/18-anti-patterns.md` forbids it being anything else.

## UX flow

### Inviting

1. The sidebar footer shows **Invite member** to any user holding `member.invite`. Users without it
   do not see the entry at all — a disabled control that never becomes enabled is noise.
2. The entry opens a dialog, `Invite a member`, in two parts.
3. **The form.** Email address. Account role, as a select with a one-line consequence under each
   option. Organization access, rendered as a locked control reading *All organizations* with the
   note *Per-organization access is coming later* — the future is visible rather than a surprise.
   Organization role, as a select, describing what the person will be able to do inside each client.
4. Submitting produces the invitation and reveals the link with a **Copy link** button, alongside
   the address it is bound to and its expiry. A `Sonner` toast confirms, per
   `context/13-ui-ux-context.md` §22.3, which already names *Invitation sent* as a toast case.
5. **The link is shown exactly once.** It is not stored in recoverable form, so it cannot be
   redisplayed. The pending list offers `Reissue link`, which revokes the old invitation and creates
   a replacement. This is stated in the UI at the moment the link is shown, not discovered later.
6. **The pending list**, below the form: address, roles, who invited, expiry, and `Reissue link` and
   `Revoke`. Without revoke a mistyped address is permanently unfixable.

### Accepting

1. The recipient opens `/invitations/<token>`.
2. **Not signed in:** the page states which account invited them and at what role, and offers the
   existing magic-link sign-in with `emailRedirectTo` returning to the same URL. The email field is
   prefilled with the invited address and is not editable — signing in as anyone else cannot advance.
3. **Signed in as the invited address:** a single `Join <Account>` confirmation showing the account,
   the roles being granted, and the clients it covers.
4. **Signed in as a different address:** the page says so plainly — *This invitation is for
   sarah@example.com. You are signed in as jishnu@example.com.* — and offers sign-out. It never
   silently accepts for the wrong identity.
5. On acceptance, redirect to `/`, where `resolve_landing_organization()` already places the user in
   their first client. No new landing logic exists or is needed.
6. **Expired, revoked, or already-accepted** links render their own state with a plain explanation
   and a recovery action (*Ask the person who invited you to send a new link*). An unknown token
   renders identically to an expired one, so the route cannot be used to probe for valid tokens.

### Identity in the sidebar footer

The footer currently renders the literal strings `Agency operator` and `Workspace admin` for every
user. With an account and a membership this becomes real: display name, email, and account name from
the session. Small, and it is the surface this feature makes honest.

## Domain rules

### Account

- An `Account` is the agency. It owns organizations. It is the root of the tenancy tree.
- Every organization belongs to exactly one account. `account_id` is `not null` after backfill and
  immutable after creation.
- User-facing copy calls this level **Agency**; code and schema call it `account`.
  `context/13-ui-ux-context.md` §5.1 already uses "agency level", and line 1579 forbids alternating
  between client/tenant/account/workspace for the level *below*. The two names are a deliberate
  split, recorded here so it is not re-litigated.

### Account roles

Three. Each is about running the agency, not about working inside a client.

| Role | Authority |
| --- | --- |
| `owner` | Everything, including deleting the account and transferring ownership. |
| `admin` | Invite and remove members, manage roles strictly below their own, create organizations. |
| `member` | Holds a seat. No agency administration. What they can *do* is their organization role. |

- An account always has at least one `owner`. The last owner cannot be removed or demoted.
- **No one may grant authority they do not hold.** An `owner` may appoint a co-owner; an `admin` may
  only admit a `member`. Enforced by trigger, not only by the API, so it holds for any write path.
- No billing role is defined, because no billing exists. Inventing a role for a capability that does
  not exist is forbidden by `AGENTS.md` §6.

### Organization roles

The existing four, unchanged in name and in enum value. 141 policy checks depend on these values, so
keeping them means no enum migration and no rewrite of existing policies.

| Role | Authority |
| --- | --- |
| `owner` | Everything in this client, including archiving it and changing policy and budget. |
| `admin` | All operations plus configuration: integrations, policies, constraints, member roles. |
| `operator` | The daily work: campaigns, memory, verifying facts, *requesting* approvals. Cannot approve money-moving or public actions, and cannot change policy or budget. |
| `viewer` | Read only, and already barred from `confidential` and `customer_content` memory. |

Reconciling `context/04-domain-model.md`, which currently lists seven roles that the schema does not
have: Agency Admin → `account.admin`; Agency Operator → `account.member`; Client Owner →
`organization.owner`; Client Manager → `organization.admin`; Read Only → `organization.viewer`;
Reviewer → deferred; Platform Admin → out of scope. That document is corrected in this change.

### Effective organization role — the central rule

Access is a **union of grants**. A grant covering an organization comes from one of two places, and
the effective role is the highest-privilege grant that applies. Grants only ever add authority;
nothing subtracts.

Privilege rank: `viewer` < `operator` < `admin` < `owner`.

Given a user and an organization, the candidate grants are:

1. The `organization_memberships.role` row for that exact pair, if one exists.
2. The user's `account_memberships` row on that organization's account, mapped as:
   - `account_role = 'owner'` → `owner`
   - `account_role = 'admin'` → `admin`
   - `account_role = 'member'` → their `default_organization_role`, which may be null

The effective role is the higher-ranked of the two. If neither yields a role, the user has no access.

Consequences that make this the right shape:

- **Today's requirement:** an invited member with `default_organization_role = 'operator'` is an
  operator in all three existing organizations **and in every organization created afterwards**,
  with no rows written per organization.
- **The fan-out alternative is rejected.** Writing one membership row per organization at accept time
  looks simpler and rots on the first new client: the row is not there, and a synchronization job is
  now load-bearing. Computed access cannot drift.
- **Future per-organization control** is achieved by clearing `default_organization_role` and
  inserting explicit `organization_memberships` rows. Same tables, no migration.
- **Future mixed authority** — admin on one client, operator elsewhere — is one override row.
- `organization_memberships` keeps its exact current meaning for existing rows. Nothing is migrated.

### Permissions

- A permission is a stable dotted key with a scope of `account` or `organization`.
- **Roles are bundles of permissions. Application code and new policies check permissions.**
- The vocabulary and the role mapping are rows in the database, seeded and changed by migration.
  Changing what a role can do is a data change reviewed as a migration, not an edit scattered across
  TypeScript conditionals.
- A TypeScript mirror exists so the browser can hide controls a role cannot use. **The mirror is
  never authoritative and a test fails if it disagrees with the database.** Without that test the two
  halves rot apart, which is the failure mode this whole design exists to prevent.
- The initial vocabulary is derived from authority the platform already enforces, not invented:

  **Account scope:** `account.read`, `account.update`, `member.read`, `member.invite`,
  `member.manage_role`, `member.remove`, `organization.create`.

  **Organization scope:** `organization.read`, `organization.update`, `organization.archive`,
  `onboarding.manage`, `integration.read`, `integration.connect`, `integration.disconnect`,
  `memory.read`, `memory.read_sensitive`, `memory.write`, `memory.verify`, `memory.supersede`,
  `memory.promote_fact`, `opportunity.read`, `opportunity.approve`, `campaign.read`,
  `campaign.create`, `campaign.edit`, `campaign.approve`, `campaign.publish`, `economics.read`,
  `economics.write`, `policy.read`, `policy.update`, `budget.modify`, `audit.read`.

  The `memory.*` keys are the existing set in `src/domain/memory/permissions.ts`, folded into the
  catalogue rather than duplicated. `customer_data.export`, named as an example in
  `context/06-multi-tenancy-and-security.md`, is omitted because no export path exists.

- **Migration rule for existing call sites.** The 219 existing `has_organization_role` and
  `is_organization_member` checks keep working and are not rewritten in this change. New policies and
  new API routes use permission checks; existing role-array checks migrate when the surrounding code
  is touched for another reason. Stated here so the mixed state is a recorded decision rather than an
  inconsistency someone discovers later.

### Invitations

- An invitation binds an **email address**, an **account role**, and a **default organization role**
  to an account, for 7 days, once.
- The raw token is 32 random bytes, base64url-encoded. **Only its SHA-256 hash is stored.** The
  database never holds a credential that grants account access, matching the digest-only discipline
  already used for OAuth state in `integration_oauth_sessions`.
- The raw token is returned exactly once, in the response to creating the invitation. It cannot be
  recovered. Reissue revokes and replaces.
- **Acceptance requires that the authenticated user's confirmed email equals the invited address**,
  compared lowercased. A link redeemable by whoever holds it is a tenant-isolation hole, and tenant
  isolation is this platform's premise.
- Acceptance is atomic and idempotent: consuming the invitation and writing the membership happen in
  one transaction, and a replay of an accepted token returns success without a second write.
- At most one `pending` invitation per `(account, email)`, enforced by a partial unique index.
  Inviting an address that already has a pending invitation reissues rather than duplicating.
- **Expiry is computed, never trusted from the stored column.** The `expired` enum value exists for
  the record; every read and the accept path evaluate `expires_at` directly, so a missed sweep can
  never admit a stale invitation.
- Invitations are rate-limited per account per hour.
- The API never reveals whether an address already belongs to a user. An unknown, expired, revoked,
  and consumed token are indistinguishable from outside.
- Accepting an invitation for an account the user already belongs to consumes the invitation and
  leaves the existing membership unchanged. It never silently downgrades an existing role.

## Data model

New enums: `public.account_role ('owner','admin','member')`,
`public.permission_scope ('account','organization')`,
`public.invitation_status ('pending','accepted','revoked','expired')`.

### `public.accounts`

`id`, `name`, `slug` (unique, same slug regex as organizations), `created_by`, `created_at`,
`updated_at`. Tenant root.

### `public.account_memberships`

Primary key `(account_id, user_id)`. Columns: `account_role` (not null, default `member`),
`default_organization_role` (nullable — null means no blanket organization access),
`created_at`, `updated_at`. Index on `user_id`. A user may belong to more than one account.

A trigger enforces the last-owner rule on delete and on role change.

### `public.organizations`

Adds `account_id uuid references public.accounts(id) on delete restrict`. Nullable on creation,
backfilled, then set `not null`. Indexed. A `before update` trigger rejects any change to it — RLS
`with check` cannot see the old row, so immutability must be a trigger.

### `public.permissions`

`key` (primary key, dotted-slug check), `description` (not null), `scope`. Unique on `(key, scope)`
so the mapping tables can hold a composite foreign key.

### `public.account_role_permissions` and `public.organization_role_permissions`

`(role, permission_key)` primary key, plus a constant `permission_scope` column constrained to the
table's own scope and joined to `permissions(key, scope)` by composite foreign key. This makes
"an account permission mapped onto an organization role" a constraint violation rather than a code
review catch.

Both tables are readable by `authenticated` and writable by no one. They change by migration only.

### `public.account_invitations`

`id`, `account_id`, `email` (lowercased, checked), `account_role`, `default_organization_role`,
`token_hash` (unique), `status`, `invited_by`, `expires_at`, `accepted_by`, `accepted_at`,
`revoked_by`, `revoked_at`, `created_at`, `updated_at`.

Partial unique index on `(account_id, email) where status = 'pending'`. Index on
`(account_id, created_at desc)`.

### `public.audit_events`

`organization_id` becomes nullable and gains a sibling `account_id`, with a check that at least one
is present, plus a partial index on `(account_id, occurred_at desc)`.

This keeps one audit spine rather than growing a second table. Every existing writer supplies
`organization_id` and is unaffected; every existing reader is organization-scoped and a null
`organization_id` simply never matches its policy.

### Functions

- `private.effective_organization_role(organization_id, user_id default auth.uid())` —
  `security definer`, holds the entire union rule above. The single place access is decided.
- `private.is_account_member(account_id)` and
  `private.has_account_role(account_id, account_role[])` — `security definer`. Separate from the
  organization helpers specifically so `account_memberships`' own policies do not recurse into a
  function that reads `account_memberships` under RLS.
- `private.is_organization_member` and `private.has_organization_role` — **bodies rewritten** to
  delegate to the resolver. Names, signatures, and grants unchanged, so all 219 call sites inherit
  account access with no edits.
- `private.has_organization_permission(organization_id, permission_key)` and
  `private.has_account_permission(account_id, permission_key)` — new, for all new policies.
- `public.create_account_invitation(...)` — `security invoker`, so RLS applies. Enforces the
  role-ceiling rule and the rate limit. Accepts a token hash computed by the caller; the raw token
  never reaches the database.
- `public.revoke_account_invitation(invitation_id)` — `security invoker`.
- `public.preview_account_invitation(token_hash)` — `security definer`. Returns account name,
  inviter display name, roles, expiry, and whether the caller's email matches. Returns the same
  not-found shape for unknown, expired, revoked, and consumed tokens.
- `public.accept_account_invitation(token_hash)` — `security definer`, and necessarily so: the
  invitee has no rights on the account yet and cannot read or update the row under RLS. Verifies
  hash, expiry, status, and email match against `auth.users` (requiring a confirmed email), writes
  the membership, consumes the invitation, and emits the audit event, in one transaction.
- `public.create_organization_with_owner(...)` — gains the caller's account and sets `account_id`.

### Type maintenance

`pnpm db:types` cannot run in this project. `accounts`, `account_memberships`,
`account_invitations`, `permissions`, `account_role_permissions`, and
`organization_role_permissions` are added by hand to `src/lib/supabase/database.types.ts`. None are
added to `UNTYPED_TABLES`: the browser reads the first three, and the drift test reads the last three.

## API and events

### Routes

- `GET /api/account` — the caller's account and their membership.
- `GET /api/account/invitations` — pending invitations. Requires `member.read`.
- `POST /api/account/invitations` — creates one. Requires `member.invite`. Generates the token,
  stores its hash, and returns the raw token **once**.
- `POST /api/account/invitations/[id]/reissue` — revoke and replace. Requires `member.invite`.
- `DELETE /api/account/invitations/[id]` — revoke. Requires `member.invite`.
- `GET /api/invitations/[token]` — unauthenticated preview, via the definer RPC.
- `POST /api/invitations/[token]/accept` — authenticated accept, via the definer RPC.

All requests and responses validated with Zod at the boundary. Errors go through the existing
`DomainError` / `toPublicError` mapping. A new `getAccountContext` helper mirrors
`getOrganizationContext` in `src/lib/api/organization-context.ts`, resolving the caller's account and
permissions instead of an organization.

### Events

Stable, past tense, per `AGENTS.md` §8: `account.created`, `account_member.invited`,
`account_member.invitation_reissued`, `account_member.invitation_revoked`, `account_member.joined`,
`account_member.role_changed`, `account_member.removed`.

`DomainEvent.organizationId` is currently required in `src/domain/events/types.ts`. It becomes
optional, `accountId` is added, and the type requires at least one of the two. This is the type-level
mirror of the same change to `audit_events`.

Payloads carry opaque identifiers, roles, and bounded state only. **An invitation payload never
carries the raw token, and never carries the invited email address** — the address is customer
contact data and the audit row already holds what is needed to trace the action.

## AI behavior

None. This feature contains no model call, no prompt, and no generated output. Authorization is
deterministic by construction and must remain so.

## Security and tenancy

- Every new table has RLS enabled and explicit `authenticated` grants following the pattern in
  `20260807204220_harden_tenant_access.sql`. No `anon` grant is issued to any of them.
- `accounts` select: `private.is_account_member(id)`. Update: `has_account_permission(id, 'account.update')`.
- `account_memberships` select: `private.is_account_member(account_id)` — via the definer helper, to
  avoid policy recursion. Insert, update, and delete require `member.manage_role`, and the trigger
  enforces the last-owner and role-ceiling rules on top.
- `account_invitations` is readable and writable only by holders of `member.invite` / `member.read`
  on that account. **The invitee never touches the table directly** — the preview and accept paths
  are the only routes in, and both are `security definer` functions with explicit checks.
- `permissions` and the two mapping tables are `select`-only for `authenticated`, with no insert,
  update, or delete grant to any role. They change by migration.
- The resolver is `security definer` with `set search_path` set, so it reads the membership tables
  without RLS and cannot recurse into the policies that call it. This is the exact class of bug the
  project already hit in `20260808054138_fix_organization_creator_select_policy.sql`, so it is
  designed for rather than discovered.
- The change is **additive to authority**. No user loses access to anything, because every existing
  `organization_memberships` row remains a grant of the same role. This is what makes the rollback
  story safe.
- Tokens: 32 bytes of CSPRNG entropy, stored only as SHA-256, single-use, 7-day expiry,
  email-bound, rate-limited, and indistinguishable from unknown tokens when invalid.
- No secret, token, or email address is logged. Structured logs carry `accountId`,
  `invitationId`, and `correlationId`.

## Observability

- Structured logs on invitation created, reissued, revoked, previewed, accepted, and rejected, with
  the rejection reason as a stable code (`expired`, `revoked`, `consumed`, `email_mismatch`,
  `unknown`). Rejection reasons are logged in full and returned to the client only in the
  generalized form.
- Audit events on the shared spine for every membership and invitation change, which is what
  `context/06-multi-tenancy-and-security.md` already requires first in its audit list.
- The effective-role resolver runs inside every RLS check in the system. Its cost is measured against
  the current helpers before slice 1 is considered done — a regression there is a regression
  everywhere.

## Failure states

| State | Behavior |
| --- | --- |
| Token unknown, expired, revoked, or consumed | One indistinguishable "this link is no longer valid" page with a recovery action. |
| Signed in as a different address | Named plainly, with sign-out offered. Never auto-accepted. |
| Email not confirmed | Acceptance refused. Magic-link sign-in makes this near-unreachable, but it is checked rather than assumed. |
| Already a member of the account | Invitation consumed, existing membership untouched, success reported. Never a silent downgrade. |
| Inviting above your own role | Refused with a specific message. Enforced in the RPC, not only the UI. |
| Rate limit reached | Refused with the retry window stated. |
| Last owner removal or demotion | Refused by trigger. |
| Account has no organizations yet | Acceptance succeeds and lands on the create-organization wizard, which `resolve_landing_organization()` already handles. |
| Resolver returns no role | Indistinguishable from non-membership. No route reveals that an organization exists. |
| Sign-in link lands somewhere that cannot create a session | Every magic link is addressed to `/auth/callback`, which exchanges the code and then forwards to a validated same-origin `next`. A link addressed anywhere else arrives signed out and can only send the person back to their inbox. |
| Redirect refused by Supabase | `emailRedirectTo` is built from `NEXT_PUBLIC_APP_URL`, not from the browser's origin, because every environment shares one hosted Supabase project and therefore one redirect allowlist. **Each environment's `/auth/callback` must be listed in that project's Redirect URLs**, or its sign-in links come back to the wrong host. `next dev` also serves on the machine's LAN address, which is exactly the origin that would not be listed. |
| Sign-in link redirects nowhere useful | Every magic link points at `/auth/callback`, which exchanges the code and then forwards to a validated same-origin `next`. A link aimed anywhere else arrives signed out and can only ask for a second trip to the inbox. |
| Redirect origin not allowlisted | The redirect is built from `NEXT_PUBLIC_APP_URL`, not from the browser's origin, because every environment shares one hosted Supabase project and one allowlist. **Each deployment's `/auth/callback` must be listed in that project's Redirect URLs**, or Supabase silently substitutes the Site URL. |

## Acceptance criteria

- An account owner invites a teammate, copies the link, and the teammate joins and reaches a client
  workspace — end to end, in the browser, at both desktop and mobile widths.
- The invited teammate has the assigned organization role in **every** organization of the account,
  including one created *after* they joined, with no per-organization rows written.
- All 219 existing policy checks behave identically for existing users. No existing user's access
  changes in any direction.
- A user with no account membership and no organization membership can read nothing.
- A token cannot be redeemed twice, after expiry, after revocation, or by a different email address.
- No raw token exists in the database, in any log, or in any event payload.
- The TypeScript permission mirror and the database mapping tables are proven equal by a test.
- An `admin` cannot create an `owner`; the last `owner` cannot be removed.
- The sidebar entry is absent for users without `member.invite`.
- Every membership and invitation change produces an audit event.
- `context/04-domain-model.md`, `05-module-map.md`, `06-multi-tenancy-and-security.md`, and
  `13-ui-ux-context.md` §5.1 are corrected in the same change. No document is left aspirational.

## Test plan

### pgTAP — `supabase/tests/database/account_access_test.sql`

- The resolver's full truth table: each account role × each default organization role × override
  present/absent × organization in/out of the account.
- Union semantics: an override never reduces authority below the account-derived grant.
- A user in account A gets nothing on an organization in account B. **This is the tenant-isolation
  test and it is the one that matters most.**
- Existing behavior preserved: a pre-existing `organization_memberships` row with no account
  membership still resolves to its original role.
- `account_memberships` policies do not recurse.
- Last-owner and role-ceiling triggers.
- `organizations.account_id` immutability.

### pgTAP — `supabase/tests/database/account_invitation_test.sql`

- Accept succeeds once; the same token replayed is idempotent and writes nothing further.
- Accept refused when expired, revoked, consumed, or email-mismatched.
- Expiry is honored even when `status` still reads `pending`.
- Preview returns identical output for unknown and expired tokens.
- An invitation row is invisible to a user outside the account.
- The partial unique index rejects a second pending invitation for the same address.

These run against staging and share it with live data, per `AGENTS.md`. They are integration checks,
not an isolated unit layer.

### Mandatory staging execution

`AGENTS.md` requires that a new `plpgsql` function reading a table it did not create is **called once
against staging before it is considered done** — plpgsql resolves record fields at execution time, so
a bad column reference applies cleanly and fails on first real call. This has already happened twice
in this project. Every one of `effective_organization_role`, `is_account_member`, `has_account_role`,
`has_organization_permission`, `has_account_permission`, `create_account_invitation`,
`preview_account_invitation`, and `accept_account_invitation` is invoked against staging with real
arguments, and the results are recorded, as a gate on the slice that introduces it.

### Vitest

- The resolver's rank logic, as a pure function, including a property test that the union is
  monotonic — adding a grant never reduces effective authority.
- Permission-mirror drift: the TypeScript map equals the database mapping tables, both directions.
- Zod boundary schemas for every request and response.
- Token generation: length, encoding, and that the raw value never appears in a serialized payload.
- API route tests for each refusal path, asserting the generalized public error and the specific
  logged code.

### Playwright

- Invite → copy link → accept in a second browser context → land in a workspace.
- Accept while signed in as the wrong address.
- Accept an expired link.
- Revoke, then attempt to accept.

### Browser verification

Per the project's standing requirement, the dialog, the pending list, and the acceptance route are
exercised in Chrome DevTools at both desktop and mobile widths before the UI slice is done.

## Migration and rollback

### Slices

Four migrations, four reviewable changes, in this order.

1. **Account tenancy.** `accounts`, `account_memberships`, `organizations.account_id`, the backfill,
   the account helpers, the resolver, and the rewritten bodies of the two existing helpers.
   **No user-visible change whatsoever.** The riskiest slice ships alone so it can be verified alone.
2. **Permission catalogue.** `permissions` and the two mapping tables, seeded. The permission
   helpers. The TypeScript mirror and its drift test. `src/domain/memory/permissions.ts` folded in.
3. **Invitations backend.** The table, the four RPCs, the API routes, the acceptance page, the
   `audit_events` and `DomainEvent` changes.
4. **UI.** Sidebar entry, dialog, pending list, and the real identity in the footer.

### Backfill

Staging holds 1 user, 3 organizations, and 3 memberships, all created by the same user. The backfill
creates one account per distinct `organizations.created_by`, names it from the creator's profile
display name, makes that user its `owner` with `default_organization_role = 'owner'`, and points
their organizations at it. `account_id` is added nullable, backfilled, then set `not null` in the
same migration — the standard three-step, kept even though the table has three rows, because the
sequence is the pattern the next such change will copy.

### Rollback

Reverting slice 1 is a forward migration restoring the two helper bodies to their current
definitions, which are reproduced verbatim in a comment block in the migration that changes them.

Because account access is **purely additive** — every existing `organization_memberships` row keeps
granting exactly the role it grants today — restoring the old bodies restores today's behavior
exactly and **cannot lock anyone out**. The new tables can remain in place, unused.

Slices 2 through 4 are additive in full: new tables, new functions, new routes, one new sidebar
entry. Reverting any of them removes a capability and changes no existing behavior.

There is no local database. Every migration lands directly on shared staging and is live for
everyone the moment it is pushed, so each slice is reviewed against the current schema before it is
written, not rehearsed.

## Documentation updates

- **New:** `adrs/0022-account-as-tenant-root.md` — why a level above organization, why computed
  access instead of fan-out, and why the two RLS helpers were rewired rather than the 219 policies.
- **New:** `adrs/0023-permission-as-data-authorization.md` — why the vocabulary and mapping live in
  the database, why the TypeScript mirror is non-authoritative, and why existing role-array checks
  are migrated opportunistically rather than in one pass.
- `context/04-domain-model.md` — add `Account` and `AccountMembership`; replace the seven-role list
  with the three account roles and four organization roles actually implemented, recording Reviewer
  and Platform Admin as deferred with their reasons.
- `context/05-module-map.md` — Identity and Access gains its real description and file locations.
- `context/06-multi-tenancy-and-security.md` — the tenant model becomes Account → Organization; the
  permission-based authorization claim becomes true and points at the catalogue.
- `context/13-ui-ux-context.md` §5.1 — the "no agency-level surface exists" statement is now
  partially false. Narrow it: there is no agency-level *page*, but there is agency-level identity and
  membership, reached from the sidebar footer.
- `README.md` — the invitation flow in the local setup notes, including that the hosted Supabase
  project's Redirect URLs must contain `<NEXT_PUBLIC_APP_URL>/auth/callback` for every environment
  that shares it.
