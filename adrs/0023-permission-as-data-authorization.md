# ADR 0023: The permission catalogue is data, not code

## Status

Accepted; implemented in `supabase/migrations/20260817141000_permission_catalogue.sql`.

Builds on ADR 0022, which established the account tenancy this resolves through.

## Context

`context/06-multi-tenancy-and-security.md` has claimed since the beginning that _"authorization is
permission-based, not based only on role labels"_ and listed a vocabulary — `campaign.publish`,
`budget.modify`, `integration.connect`.

That was true in exactly one module. `src/domain/memory/permissions.ts` defined six `memory.*` keys
and a role map, as pure data the browser could read. Everywhere else, all 219 policy checks and every
API route compared role labels through `private.has_organization_role`. The document described an
intention; the code had a partial implementation and no plan to finish it.

`specs/017-account-identity-and-access.md` forced the question, because an invitation must assign
authority before the invitee ever signs in. "What is this person allowed to do?" stopped being
answerable by reading scattered role arrays.

The requirement was explicit: something _concrete, consistent and reliable in future — not just some
bunch of codes which can make it happen._

## Decision

### The vocabulary and the mapping are rows

`public.permissions` holds 33 keys with descriptions and a scope of `account` or `organization`.
`public.account_role_permissions` and `public.organization_role_permissions` hold which role holds
which key. All three are seeded by migration.

**Changing what a role may do is a data change, reviewed as a migration.** That is the point. An
authorization change should be legible line by line in a diff, not spread across TypeScript
conditionals where nobody can see the whole picture at once.

### The seed rows are explicit, not derived

Ninety-one mapping rows are written out, even though the organization roles nest perfectly and could
be seeded as "admin is owner minus archive". The derived form would be six lines instead of
seventy-five.

It was rejected because the compact form hides exactly the class of mistake these tables exist to
surface. A reviewer scanning ninety-one rows sees that `operator` does not have `campaign.approve`. A
reviewer reading a set-difference expression has to compute it.

### Scope is enforced by a constraint, not by discipline

Each mapping table carries a constant `permission_scope` column, constrained to its own scope, and a
composite foreign key to `permissions(key, scope)`. Mapping `member.invite` onto an organization role
is therefore a foreign-key violation, not something a reviewer has to notice.

### The mirror is not authoritative, and a test proves it agrees

`src/domain/access/permissions.ts` mirrors the catalogue so the browser can hide a control a role
cannot use. It grants nothing: a browser that disagrees with the database renders the wrong button.

`permissions.drift.test.ts` parses the migration's seed rows and compares them with the mirror in
both directions. It needs no database, so it runs in CI without credentials — the same approach, for
the same reason, as `src/lib/supabase/database.types.test.ts`. It also asserts it parsed something,
so a broken parser fails instead of passing vacuously.

Without that test the two copies rot apart silently, and the rotted state is the worst kind: the UI
offers a button the server refuses, or hides one the user is entitled to.

### Resolution goes through the tenancy boundary, never around it

`private.has_organization_permission` resolves the caller's role through
`private.effective_organization_role` — the same function every policy in the schema uses. A
permission check therefore cannot become a route around ADR 0022's isolation. The pgTAP suite asserts
that across a real account boundary in both directions.

### The catalogue is writable by nobody

`revoke all ... from authenticated, anon`, then `grant select`.

The revoke is load-bearing, not ceremony. This project inherits Supabase's default privileges, under
which a table created by `postgres` in `public` grants `authenticated` **every** privilege
automatically, insert and delete included. RLS still refuses those writes because no write policy
exists — but a catalogue that decides authorization must not be one forgotten policy away from being
writable by the people it governs. Two locks, not one. A pgTAP assertion fails if a write grant ever
reappears.

## Consequences

- **The docs are true now.** `context/06-multi-tenancy-and-security.md` no longer describes an
  intention.
- **Memory's permissions moved without churning its callers.** `src/domain/memory/permissions.ts`
  became a narrow re-export over the shared catalogue, so thirty call sites were untouched and their
  existing test passes unchanged — which is the evidence that behavior did not move.
- **Nothing enforces these permissions yet.** This slice ships the vocabulary, the mapping, and the
  two helpers. The first consumer is `member.invite` in the invitations slice. Stated plainly here so
  nobody reads the catalogue as a claim that permissions are wired in.
- **The 219 existing role-array checks are not rewritten.** New policies and new routes use
  permissions; existing checks migrate when their surrounding code is touched for another reason. The
  mixed state is a recorded decision, not drift. Rewriting 219 policies in one pass would be 219
  chances to write a tenant leak for no behavioral gain.
- **Adding a role is now cheap.** `reviewer` — deferred in `specs/017` precisely because this ADR
  makes it cheap — costs one enum value and a handful of rows.
- **Owner and admin hold identical account permissions.** There is nothing to withhold while billing
  and account deletion do not exist. What separates them is the role-ceiling trigger: only an owner
  may appoint an owner. A unit test asserts the equality so it reads as a decision rather than an
  oversight, and it will diverge naturally when the first owner-only capability exists.
- **Two artifacts must be kept in step by hand.** The drift test makes that safe, but it is real
  ongoing cost, accepted because the alternative — the browser querying the catalogue on every render
  to decide whether to draw a button — is worse.

## References

- `specs/017-account-identity-and-access.md`
- `supabase/migrations/20260817141000_permission_catalogue.sql`
- `supabase/tests/database/permission_catalogue_test.sql`
- `src/domain/access/permissions.ts` and `permissions.drift.test.ts`
- `adrs/0022-account-as-tenant-root.md`, for the resolver these helpers go through
- `context/06-multi-tenancy-and-security.md`, for the claim this makes true
