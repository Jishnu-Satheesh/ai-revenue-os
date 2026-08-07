# Contributing

## Tooling

This project uses **pnpm**. Use `pnpm install` and `pnpm <script>`; do not commit a second package-manager lockfile.

## Branching and pull requests

- Use short-lived branches.
- Keep each pull request focused on one production-complete vertical slice.
- Include database migrations, tests, screenshots, and documentation updates in the same pull request when applicable.
- Avoid mixing refactors with feature behavior unless the refactor is required for the feature.

## Pull-request description

Every pull request should state:

1. Business outcome supported.
2. User-visible behavior.
3. Technical design.
4. Data and migration impact.
5. Tenant-isolation and security review.
6. AI behavior and evaluation changes.
7. Test evidence.
8. Rollback plan.

## Commit guidance

Prefer descriptive commits such as:

- `feat(onboarding): add branch operating-hours step`
- `feat(decision-engine): score opportunities by expected gross profit`
- `fix(tenancy): enforce organization scope in integration lookup`
- `docs(adr): record trigger.dev execution decision`
