# Guided Onboarding Design

**Status:** Approved design direction; implementation not started.

**Goal:** Give an agency operator a trustworthy, resumable ten-section onboarding workspace that turns client context into a visible Digital Twin and prioritized readiness actions.

**Source requirements:** `specs/002-guided-onboarding.md`, `specs/008-ai-readiness-score.md`, `context/13-ui-ux-context.md`, and the approved Superdesign stepper reference supplied by the user.

## Product decisions

- The agency operator owns the default workflow. Client participation happens through assigned missing-data requests, not a separate self-serve first release.
- All ten Guided Onboarding sections are in scope.
- The primary layout is a persistent section rail with a focused work panel.
- The work panel uses a compact six-phase animated stepper as a visual progress layer; the ten actual sections remain individually addressable in the rail.
- A section can be saved incomplete. Unknown is a valid explicit state and is never silently converted into a value.
- Future sections cannot be marked complete by navigation alone. Operators may revisit completed sections and jump to previously visited sections.
- AI extraction produces suggestions with provenance and confidence. Only an explicit operator confirmation can create a verified fact.
- The existing shadcn/ui design system is mandatory. The supplied component is an interaction reference, not a source to copy literally: feature code must use `Button`, `Card`, `Field`, `Input`, `Select`, `Textarea`, `Checkbox`, `Progress`, `Badge`, `Alert`, `Empty`, and `AlertDialog`.

## Information architecture

The rail displays ten sections grouped into six phases:

1. **Foundation** — Business identity; Branches and operations.
2. **Commercial context** — Products/services and restaurant menu; Channels and digital presence; Historical performance.
3. **Customer context** — Customers and consent; Brand assets and communication style.
4. **Governance** — Goals, budget, constraints, and approvals.
5. **Data intake** — Integrations and data uploads.
6. **Review** — Review and readiness.

Each rail row shows one of `not_started`, `in_progress`, `complete`, `needs_attention`, or `blocked`, plus a compact source/verification cue where relevant. The active row opens a Card-composed editor in the work panel.

## Interaction and motion

The approved stepper interaction is adapted from the supplied `AnimatedStepper`:

- Directional slide: entering content moves 20px from the navigation direction; outgoing content moves 20px away and fades.
- Dynamic height: the work-panel content wrapper animates between measured content heights so sections with uploads, tables, or follow-up tasks do not jump the page.
- Progress connector: completed phase connectors animate from 0% to 100% when a phase becomes complete.
- Indicator states: completed uses a Check icon, active uses the primary outline, future uses muted secondary styling.
- Navigation: Back, Save, Save and continue, Assign request, and Complete section are shadcn Buttons. Buttons are disabled during mutation and show a Spinner when added by the implementation.
- Reduced motion: `prefers-reduced-motion` disables slide/height interpolation while preserving state changes and focus movement.
- Focus: after a step change, focus moves to the active section heading; errors focus the first invalid control.
- No manual color literals or gradient styling; all colors come from semantic CSS variables.

## Section behavior

### Business identity

Collect organization name, slug, industry, country, base currency, timezone, and legal/operating identity where available. Existing organization creation remains the tenant bootstrap; onboarding enriches the draft and never creates a second tenant.

### Branches and operations

Collect physical/virtual branches, timezone, currency, service area, hours, capacity, contact details, and explicit branchless confirmation. Restaurant activation rules remain enforced by the existing domain layer.

### Products/services and restaurant menu

Support manual entry plus file upload for menu/catalog data. For restaurant data, capture item name, category, price, currency, availability, modifiers, and source. Preserve raw upload provenance and parsed row status.

### Channels and digital presence

Collect owned channels, marketplaces, social profiles, website, phone/WhatsApp, Google Business Profile, delivery channels, and account ownership status. Credentials are never collected in ordinary fields.

### Historical performance

Accept manual metrics and CSV/XLSX/PDF uploads for revenue, orders, margin, acquisition, repeat purchase, footfall, inquiries, and channel performance. Every metric displays period, source, currency, quality, and verification state.

### Customers and consent

Collect customer segments, first-party data availability, consent model, retention constraints, and contactability. Legal consent is always an operator-confirmed/client-provided fact; AI cannot infer it.

### Brand assets and communication style

Collect logo/assets, brand voice, languages, claims restrictions, visual references, and approval contacts. Uploads show parsing status and manual fallback.

### Goals, budget, constraints, and approvals

Reuse the existing goal, constraint, policy, and budget domain contracts. Provide measurable targets, baseline status, scope, approval mode, spend ceilings, risk constraints, and required approvers.

### Integrations and data uploads

List available provider connections and manual sources. Connection cards show health and missing permissions; credentials are created through governed provider flows, never by the model or ordinary form inputs.

### Review and readiness

Show section completion, data-quality warnings, contradictions, missing-data priority, client requests, readiness score, and next recommended actions. Completion is explicit and emits `onboarding.completed` only when the operator confirms review.

## Persistence and data flow

The client uses a stable `onboardingSessionId` tied to `organizationId`. Each section save is an idempotent mutation containing section key, draft payload, source metadata, verification states, and a client-generated idempotency key. Server handlers validate with Zod, resolve organization context, enforce authorization/RLS, persist the draft, and emit a past-tense event.

Proposed control-plane records:

- `onboarding_sessions`: organization, owner, status, current section, started/completed timestamps.
- `onboarding_section_states`: session, section key, status, payload, completion metadata, source metadata, updated actor.
- `onboarding_requests`: missing-data request, assignee/contact, requested section, status, due date, and audit metadata.
- `onboarding_uploads`: session, storage object reference, media type, parse status, error summary, and source metadata.
- `onboarding_extractions`: upload, candidate facts/rows, confidence, contradiction references, and confirmation state.
- `ai_readiness_assessments`: session, score, rubric version, section scores, blockers, and generated next actions.

All organization-owned rows carry `organization_id` and are protected by RLS. Cross-tenant reads are rejected at the application and database layers.

## AI extraction and review

Upload flow: upload → virus/type/size validation → private storage → extraction job → candidate suggestions → operator review → confirmed facts/metrics. Extraction failures remain visible with a manual-entry fallback. Suggestions show source location, confidence, and conflicts. Inferred financial values cannot become verified without explicit confirmation.

## Events and observability

Emit the required events: `onboarding.started`, `onboarding.step_completed`, `onboarding.file_uploaded`, `onboarding.extraction_completed`, `onboarding.fact_confirmed`, and `onboarding.completed`. Include organization ID, session ID, section key, actor ID/type, correlation ID, and outcome metadata. Log mutation latency, extraction latency, failures, retry count, and readiness calculation version without secrets or unnecessary PII.

## Error and recovery states

- Save failure: keep local form state, show an Alert with retry, and do not advance.
- Upload failure: preserve the file row as failed, show the reason, and offer retry/manual entry.
- Extraction contradiction: show both candidates and sources; require operator resolution.
- Unauthorized/expired session: stop mutation, preserve a recoverable draft state, and redirect through the existing auth path.
- Network interruption: show unsynced state and retry using the same idempotency key.

## Testing requirements

- Unit-test section schemas, completion rules, readiness scoring, source/verification transitions, and contradiction handling.
- Integration-test save/resume, idempotent section mutations, upload status transitions, RLS, organization scoping, and event emission.
- Component-test stepper direction, dynamic height, indicator navigation restrictions, reduced motion, focus management, and validation states.
- End-to-end-test operator onboarding from organization draft through readiness review, including an extraction failure with manual fallback.

## Non-goals

- Client self-serve onboarding as the primary experience.
- Autonomous credential creation or provider account ownership assumptions.
- Automatic verification of inferred or imported financial data.
- Full integration OAuth implementation in the first UI slice.
- Replacing the existing Organization + Digital Twin domain model.
