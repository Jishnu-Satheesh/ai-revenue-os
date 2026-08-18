# ADR 0022: Account is the tenant root above Organization

## Status

Accepted; implemented in `supabase/migrations/20260817120000_account_tenant_root.sql` and
`supabase/migrations/20260817123000_current_organization_role.sql`.

## Context

`specs/017-account-identity-and-access.md` requires that a teammate be invited once and gain access
to every client the agency runs — including clients created after they joined — with per-client
restriction possible later without a rebuild.

The schema had no level above `Organization`. `supabase/migrations/20260807000000_initial_tenancy.sql`
made the organization the tenant root, every route is organization-scoped, and
`context/13-ui-ux-context.md` §5.1 recorded that no agency-level surface existed. There was exactly
one way to gain access: create an organization and become its owner as a side effect.

Two facts about the existing schema shaped everything that follows.

First, **every policy in the database resolves access through two functions**:
`private.is_organization_member`, called by 78 policies, and `private.has_organization_role`, called
by 141. Not one policy reads `organization_memberships` directly. The membership check was already
centralised; it just answered a narrower question than it now needs to.

Second, **exactly one file in the application read the membership table**:
`src/modules/organizations/application/authorization.ts`. The other 42 authorization call sites go
through it.

## Decision

### Account is the tenant root

`public.accounts` owns organizations through a non-null, immutable `organizations.account_id`.
`public.account_memberships` carries two separate things: `account_role`, which is authority over the
agency, and `default_organization_role`, which is the role the member holds inside its clients.

Those are different questions and conflating them is the common mistake. Being an owner of the agency
is not the same as being an owner of one client business.

### Access is a union of grants, computed rather than stored

A grant covering an organization comes from an explicit `organization_memberships` row or from the
account membership of the account that owns it. **The effective role is the highest-ranked grant that
applies. Grants only add authority; nothing subtracts.**

The rejected alternative was fan-out: writing one `organization_memberships` row per organization when
an invitation is accepted. It is simpler to read and it rots on the first new client — the row is not
there, the teammate silently lacks access, and a synchronisation job becomes load-bearing. Computed
access cannot drift, and a client added next month is covered by a row that already exists.

The cost is that `organization_memberships` is no longer the whole truth. That cost is paid once, in
the two places that read it.

### The two existing helpers were rewired, not the 219 policies

`private.effective_organization_role` holds the entire union rule. The bodies of
`is_organization_member` and `has_organization_role` were replaced with calls to it. Their names,
signatures, and grants are unchanged, so **all 219 policy call sites inherit account access with no
edits**.

Editing 219 policies would have been 219 chances to write a tenant leak. Editing two function bodies
is one thing to get right and one thing to review.

`private.effective_organization_role` is `security definer` so it reads the membership tables without
RLS. If it were invoker it would recurse into the very policies that call it. For the same reason
`private.is_account_member` and `private.has_account_role` are separate functions rather than reuses:
`account_memberships`' own policies call them, and a helper that read `account_memberships` under RLS
would recurse.

### The application reads the same resolver

`public.current_organization_role` is a thin invoker wrapper, because PostgREST does not expose the
`private` schema. It always resolves for `auth.uid()`: the organization is a parameter and the user
never is, so it cannot be used to discover anyone else's role. `requireOrganizationAccess` calls it
instead of selecting the membership table, which keeps the application's answer and the database's
answer the same expression rather than two implementations that agree until they don't.

### Deliberate consequences

- **An account owner or admin cannot be reduced on a single client.** Union semantics mean an
  override can only raise authority. Reducing a specific person on a specific client is done by
  clearing their `default_organization_role` and granting explicit overrides.
- **`organizations.account_id` is immutable**, enforced by trigger because an RLS `WITH CHECK` cannot
  see the old row. Moving a client between agencies is a data migration, not a product action.
- **`create_organization_with_owner_v3` creates an account on demand** for a caller who has none,
  rather than the signup trigger doing it. An invited teammate therefore never accumulates a stray
  empty agency of their own.
- **The `accounts` SELECT policy admits `created_by`.** `RETURNING` is subject to the SELECT policy,
  and the account's creator is not yet a member when the row is returned during bootstrap. This is the
  same problem, with the same fix, as
  `20260808054138_fix_organization_creator_select_policy.sql`.

## Consequences

- The change is **additive to authority**. Every existing `organization_memberships` row still grants
  exactly the role it granted before. No user's access changed in any direction, which is what makes
  the revert safe: restoring the two helper bodies — kept verbatim in a comment block in the migration
  that changed them — restores today's behavior exactly and cannot lock anyone out.
- Every RLS check now resolves two index lookups instead of one. Measured as acceptable; it is the
  price of the level above, and it is paid in one function that can be optimised in one place.
- 21 pgTAP suites gained an inert account fixture, because `account_id` is `not null`. They
  deliberately create **no** account membership, so access still resolves from the explicit
  `organization_memberships` rows they already had. That turned a chore into regression proof: 23
  suites now assert that pre-account users are unaffected.
- Per-organization access control, a `reviewer` role, and client-side seats are all additions of rows
  or of one enum value. None requires revisiting this decision. That is the durable part; the tables
  themselves are small.
- Permission-based authorization is a separate decision, taken in ADR 0023. This ADR deliberately
  keeps the four organization role labels and the two role-array helpers so that the tenancy change
  and the authorization-model change could be reviewed, and reverted, independently.

## References

- `specs/017-account-identity-and-access.md`
- `supabase/migrations/20260817120000_account_tenant_root.sql`
- `supabase/migrations/20260817123000_current_organization_role.sql`
- `supabase/tests/database/account_access_test.sql`
- `supabase/migrations/20260807000000_initial_tenancy.sql`, for the model this supersedes
- `supabase/migrations/20260808054138_fix_organization_creator_select_policy.sql`, for the
  `RETURNING` precedent
- `adrs/0015-user-scoped-interface-state.md`, whose landing resolver needed no change because it
  filters through RLS rather than through its own membership check
