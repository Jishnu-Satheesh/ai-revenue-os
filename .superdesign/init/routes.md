# Route Map

## Public

- `/` — `src/app/page.tsx`, foundation landing/redirect.
- `/login` — `src/app/(auth)/login/page.tsx`, passwordless Supabase sign-in.
- `/auth/callback` — `src/app/auth/callback/route.ts`, auth callback.

## Authenticated platform

- `/overview` — `src/app/(platform)/overview/page.tsx`, agency operator portfolio cockpit.
- `/organizations/new` — `src/app/(platform)/organizations/new/page.tsx`, current three-step organization creation foundation.
- `/organizations/[organizationId]/digital-twin` — `src/app/(platform)/organizations/[organizationId]/digital-twin/page.tsx`, Digital Twin readiness, editor, and audit timeline.

All authenticated routes use `src/app/(platform)/layout.tsx` and `AppShell`.

## API routes

- `/api/organizations` — organization creation.
- `/api/organizations/[organizationId]` — organization lifecycle.
- `/api/organizations/[organizationId]/activate` — activation checks.
- `/api/organizations/[organizationId]/branches` — branch mutations.
- `/api/organizations/[organizationId]/constraints` — constraint mutations.
- `/api/organizations/[organizationId]/facts` — source-aware facts.
- `/api/organizations/[organizationId]/goals` — goals.
- `/api/organizations/[organizationId]/policies` — policies.
- `/api/organizations/[organizationId]/profile` — business profile.

## Planned onboarding target

The next target extends `/organizations/new` into a ten-section operator-led onboarding workspace while preserving the current route and organization creation contract.
