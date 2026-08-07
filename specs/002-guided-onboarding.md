# Feature Specification: Guided Onboarding

## Status

Ready after Organization and Digital Twin foundation.

## Business outcome

Remotely collect the minimum trustworthy information needed to identify and execute revenue opportunities for a client.

## Onboarding sections

1. Business identity.
2. Branches and operations.
3. Products or services; restaurant menu for the pilot.
4. Channels and digital presence.
5. Historical performance.
6. Customers and consent.
7. Brand assets and communication style.
8. Goals, budget, constraints, and approvals.
9. Integrations and data uploads.
10. Review and readiness.

## UX requirements

- Progressive multi-step flow.
- Save and resume.
- Organization and branch-aware.
- File upload with parsing status.
- AI extraction shown as suggestions, never silent truth.
- Confirm, edit, reject, or mark unknown.
- Assign missing requests to a client contact.
- Show completion by section.
- Generate a Readiness Score and next actions.

## AI behavior

AI may:

- Extract candidate facts from menus, spreadsheets, PDFs, screenshots, or text.
- Suggest categories and mappings.
- Identify contradictions.
- Generate clarification tasks.

AI may not:

- Mark inferred financial data as verified.
- create provider credentials.
- Assume account ownership.
- Guess legal consent.

## Events

- `onboarding.started`
- `onboarding.step_completed`
- `onboarding.file_uploaded`
- `onboarding.extraction_completed`
- `onboarding.fact_confirmed`
- `onboarding.completed`

## Acceptance criteria

- A remote operator can onboard the pilot without visiting the restaurant.
- Every field displays source and verification state.
- Incomplete onboarding does not block saving.
- The system produces a prioritized missing-data list.
- File extraction failures have manual fallback.
- All imported data remains scoped to the organization.
