# ADR 0015: Hold per-user interface state in its own user-scoped table

## Status

Accepted; implemented in `supabase/migrations/20260812120000_organization_last_access.sql`.

## Context

`docs/superpowers/specs/2026-08-09-organization-navigation-design.md` removes the account-wide overview page. Every workspace route becomes organization-scoped, which means the application must answer a question it never had to answer before: after sign-in, after archiving an organization, or at the bare root path, _which organization does this user open next?_

The agreed rules are: the most recently accessed organization that is not archived, falling back to the alphabetically first when the user has never visited one, and the create wizard when there is no workable organization at all. Four call sites need the same answer — the root route, the authentication callback, the archive action, and the create wizard's back link — so the rule cannot live in any one of them.

"Most recently accessed" is state that did not exist. It is also state the server must read during a redirect, which rules out `localStorage`: the root would have to become a client component that renders, measures, and then bounces, flashing a page the user never asked for.

Every table in the schema up to this point is tenant-scoped: rows belong to an organization and RLS filters by membership. This is the first piece of state that belongs to a _user_ and spans organizations.

The obvious home, `public.organization_memberships`, is the wrong one. Its `UPDATE` policy is restricted to owners and admins because the row carries `role`. An operator or viewer — the majority of seats — could not record their own position without widening write access to the row that governs authorization. A `security definer` function could thread that needle, but it would exist solely to work around a policy that is correct as written.

## Decision

- `public.organization_last_access` holds `(user_id, organization_id, last_accessed_at)` with a composite primary key. It is user-scoped: RLS restricts every operation to `user_id = auth.uid()`.
- Insert and update additionally require `private.is_organization_member(organization_id)`, so a user cannot record a position against an organization they do not belong to.
- `organization_memberships` is not extended. Authorization data and interface state stay in separate tables with separate policies.
- Reads go through `public.resolve_landing_organization()`, a `security invoker` function holding the entire ordering rule: `last_accessed_at desc nulls last, name asc`, with `status <> 'archived'` as the filter. One expression, under the caller's RLS, shared by every caller.
- Writes go through `public.touch_organization_access(uuid)`, which upserts and skips the update when the stored timestamp is inside a five-minute window.
- Access is recorded from `src/app/(platform)/organizations/[organizationId]/layout.tsx`, which deliberately does not authorize. Each page below it already resolves its own context with the roles it needs, and throwing in the layout would move their failures from each segment's error boundary to the root one.
- Recorded position is convenience, never authorization. A position the user has lost access to, or one on an organization since archived, fails the candidate query and falls through to the next rule.

## Consequences

- Future per-user interface state — saved filters, dismissed banners, a preferred landing tab — follows this pattern instead of accreting columns onto tenant tables. That is the durable part of this decision; the table itself is small.
- There is one new table and two new functions to maintain, where a cookie would have needed none. The trade is that a position follows the user across devices and browsers, which for an agency operator moving between machines is the behavior they expect.
- The ordering rule lives in SQL rather than TypeScript. `nulls last` is trivial there and awkward through the client query builder, and keeping it in one function means the switcher and the landing cannot disagree about precedence. The cost is that the rule is tested through pgTAP rather than a unit test.
- The five-minute staleness window is a starting value, not a measured one. It bounds write volume and affects nothing else: correctness does not depend on it, only how quickly a position becomes current.
- The layout records access on entering an organization. Next.js does not re-run a layout when navigating between its own children, so this is roughly one write per organization visit; the staleness window covers the cases where it does re-run.
- `listOrganizations` was narrowed to exclude archived organizations so the switcher offers exactly the set the resolver will accept. Without that, the menu could offer a destination the landing would refuse.

## References

- `docs/superpowers/specs/2026-08-09-organization-navigation-design.md`
- `supabase/migrations/20260812120000_organization_last_access.sql`
- `supabase/tests/database/organization_last_access_test.sql`
- `supabase/migrations/20260807000000_initial_tenancy.sql`, for the membership policies this ADR declines to widen
- `src/modules/organizations/application/landing.ts`
- `adrs/0002-separate-control-and-execution-planes.md`
