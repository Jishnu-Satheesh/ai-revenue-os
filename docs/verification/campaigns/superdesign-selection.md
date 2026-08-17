# Unified Campaign Bundle Superdesign selection

## Selection

- Project: `878271c5-0603-4c9f-afd9-69b6a462b1ee`
- Canvas: <https://superdesign.dev/teams/c3d56832-bb79-49b6-910a-6450fc30e0a4/projects/878271c5-0603-4c9f-afd9-69b6a462b1ee>
- Selected direction: Decision-first Campaign Control Room
- Selection authority: the operator delegated variant selection and continuation to the implementation agent.
- Rejected alternative: the visual-comparison board made artwork comparison prominent but pushed approval evidence, capability restrictions, and business proof too far down the page.

## Canonical drafts

- Campaign portfolio and dual entry: `12f6c657-eeb9-4b6f-be01-9d42334a6a5b`
- Campaign review cockpit: `aa7107b0-8553-4528-b637-05b3b6e2b474`
- Prompt revision and version diff: `c7991c01-aeff-417a-948f-5896b91acf1d`
- Execution and business proof: `38bc869a-8c82-491e-8faa-f46a8eebe676`
- Telegram operator review companion: `148ff955-4d9e-4820-bd9f-34197716fc05`

## Interaction contract

- Treat Decision Engine opportunities and manual briefs as equal entry points into one shared campaign pipeline.
- Keep the three directions visible: control, evidence-led, and experimental.
- Allow the operator to switch between Brand Restricted, Brand Guided, and Full Visual Freedom generation profiles.
- Keep the selected creative, hook, caption, hashtags, call to action, timing rationale, schedule, and spend ceiling editable before approval.
- A prompt revision creates a new immutable version, shows the material diff, and invalidates approval for the previous version.
- Put capability blockers and their stable restriction codes above the approval action.
- Require visual-truth attestation before the exact action `Approve execution + proof` becomes available.
- Bind approval to an exact version digest and approval envelope.
- Show provider state, spend, measurement, and learning as pending or blocked until qualifying evidence exists. Never imply success from representative UI data.
- Telegram is an operator review surface only. It shares the same versioned approval pipeline as Studio and does not provide customer messaging in this slice.
- The execution view keeps provider receipts, idempotency-safe recovery, approved spend ceilings, preregistered measurement, limitations, and operator-adopted learning visible together.

## Frontend fidelity constraints

- Reuse the existing AI Revenue OS application shell and shadcn components.
- Use the repository system font and semantic design tokens.
- Use flat fills without gradients, glass effects, or raw color utilities.
- Do not hard-code provider readiness, results, revenue, reach, confidence, receipts, or controlled-account eligibility.
- Render UTC timestamps in the organization's configured timezone.
- Verify each implemented frontend flow in Chrome DevTools at desktop and mobile widths, including loading, empty, blocked, error, and permission-denied states.
