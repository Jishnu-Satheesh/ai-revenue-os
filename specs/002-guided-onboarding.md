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
6. Cost structure.
7. Customers and consent.
8. Brand assets and communication style.
9. Goals, budget, constraints, and approvals.
10. Integrations and data uploads.
11. Review and readiness.

Cost structure sits directly after historical performance, where the operator has just stated revenue and margin, so "and what does an order cost you" is the next question rather than a new subject. It is the capture path for `specs/012-channel-economics-ledger.md` section 6, and it is the only section that promotes into a table the operator cannot otherwise write to, through a governed owner-or-admin RPC. Its readiness requirement is non-critical: a margin with unpriced components grades `indicative` and names what is missing, which is a usable answer, and blocking readiness on it would stall every client who does not yet know their cost of goods.

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
