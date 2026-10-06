# Dev login bypass — design

Date: 2026-09-27. Status: approved design, not yet implemented.

## Goal

Let a developer (human or agent) sign into the local dev server as an
organization owner, operator, or viewer at will, for browser testing of UI
and workflows. No production or staging deployment may ever offer this.

## Context

- Auth is Supabase passwordless: links land on `/auth/callback`, which
  exchanges a `code` (PKCE) or verifies a `token_hash` (admin-minted token).
- Invitation emails already mint sign-in tokens server-side with
  `auth.admin.generateLink` (`mintInvitationSignInUrl`), which sends nothing
  and redirects through the same callback.
- Org roles are `owner/admin/operator/viewer`. Staging has exactly one real
  user (owner everywhere) plus one operator fixture on a draft org. There is
  no operator or viewer on the main org, so those personas must be created.

## Decision

- Approach 1 (this doc): dev-only URL that provisions a persona and redirects
  through the real callback. Real sessions, no fake auth.
- Persona strategy A: auto-provision namespaced test users on demand.
- Rejected: a picker on the login page (more prod-leak surface, little value
  while an agent drives); CLI-minted URLs (slow every time).

## Architecture

`GET /api/dev/login-as?org=<uuid>&role=<role>&next=<path>`:

1. Gate: `process.env.NODE_ENV !== "development"` → 404. Evaluated per
   request. No override flag exists by design.
2. Validate `org` (uuid), `role` (owner, operator, or viewer as
   requested; admin rides the same mechanism for free), `next` (same-origin
   path only, mirroring the callback's rule; defaults to `/`).
3. `ensureDevPersona({ organizationId, role })`: find-or-create the
   namespaced user, upsert their membership at exactly that role.
4. Mint a `magiclink` token for the persona and 302 to
   `/auth/callback?token_hash=…&type=magiclink&next=…`.

Persona identity: `dev.<role>@lunes.test` (one user per role), marked
`dev_persona: true` in `user_metadata`. Re-picking reuses the same user and
upserts the same role, so repeated logins never multiply rows.

Membership writes mirror exactly what invitation acceptance creates
(account-level row included if acceptance creates one — verify against the
accept flow during implementation). Writes use the service role inside
dev-only server code, which is not a user-facing path.

## Files

- `src/app/api/dev/login-as/route.ts` (new): gate, validate, redirect.
- `src/modules/accounts/application/dev-personas.ts` (new, server-only):
  provisioning + minting against an injected admin client.
- Colocated tests for both. Short ADR for the safety case. One paragraph in
  the dev docs on using the bypass.
- Untouched: login page, callback, invitation links, RLS, RPCs, all
  production UI (nothing links to the route).

## Safety case

- Unreachable outside `pnpm dev`: Vercel builds run `NODE_ENV=production`,
  where the route 404s. There is no flag to re-enable it anywhere.
- Blast radius is fixtures only: provisioning touches `dev.*@lunes.test`
  users and their membership rows. It never lists emails to the caller
  and never alters real users, and `generateLink` sends no email.
- Nothing security-critical changes: the bypass rides the auth flow,
  callback, RLS, and permission checks — it goes through them, not around.

## Testing

- Unit, failing first: provisioning against a fake admin client (user found /
  created / membership upserted / URL shape); route 404s outside development;
  route validates inputs and 302s in development with the provisioner mocked.
- Live: dev server + real browser over owner/operator/viewer; assert each
  session role via the session endpoint; screenshot the Memory tab per role.
- Gates: vitest, typecheck, eslint, Prettier.

## Out of scope

- Login-page role picker (revisit if a human wants to click through roles).
- Backfill or settings changes; invitations; any staging/prod availability.
