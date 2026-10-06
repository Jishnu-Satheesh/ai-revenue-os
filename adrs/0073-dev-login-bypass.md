# ADR 0073: Dev-only login bypass via real sessions

## Status

Accepted (2026-09-27). Implements `docs/superpowers/specs/2026-09-27-dev-login-bypass-design.md`.

## Context

Browser testing of role-gated UI needs sessions as owner, operator, and
viewer. Staging holds one real user (owner everywhere), and passwordless
email login cannot be completed from an agent session.

## Decision

`GET /api/dev/login-as?org=<uuid>&role=<role>&next=<path>` provisions a
namespaced test persona (`dev.<role>@lunes.test`, `dev_persona: true`) with
exactly that role's membership, mints a `magiclink` token via the Auth admin
API, and 302s through the app's own `/auth/callback`. The session is genuine:
RLS, role gates, and audit behave exactly like production.

## Safety case

- The route returns 404 unless `NODE_ENV=development`, checked per request.
  Vercel builds run `production`. No override flag exists, deliberately.
- Nothing links to the route; no production code references it.
- Provisioning touches only `dev.*@lunes.test` users and their membership
  rows. `generateLink` sends no email. Re-picking converges (upsert), never
  multiplies rows.
- Auth flow, callback, RLS, and permissions are untouched; the bypass rides
  them rather than going around them.

## Consequences

- Dev fixture rows (`dev.*@lunes.test` users + memberships) live in shared
  staging, namespaced and identifiable. Exclude `user_metadata->>'dev_persona'`
  from any user counts that must reflect real people.
- Any future change to the gate (a flag, a second environment) needs a new ADR
  and explicit approval. The gate must never be loosened quietly.
