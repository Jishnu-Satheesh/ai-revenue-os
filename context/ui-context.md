# AI Revenue OS — UI/UX Design Context

> **Status:** Canonical design-language specification  
> **Audience:** Product designers, frontend engineers, AI coding agents, QA engineers  
> **Primary stack:** Next.js, TypeScript, Tailwind CSS v4, shadcn/ui, Radix UI, Lucide icons  
> **Design-system name:** **Revenue Intelligence System (RIS)**  
> **Last reviewed:** 2026-08-06

---

## 1. Purpose

This document defines the UI/UX design language for AI Revenue OS. It is a binding implementation context for coding agents and engineers.

The platform is a multi-tenant AI revenue operating system used by a small agency team to manage many client businesses. It must help users understand:

1. What is happening across client organizations.
2. Where a measurable revenue opportunity exists.
3. Why the system recommends an action.
4. What the action will cost, change, and risk.
5. Whether a human must approve it.
6. What the system executed.
7. Whether the action produced a business outcome.

The interface must prioritize **decision quality, speed, trust, and auditability** over decoration.

---

## 2. Selected design pattern

### 2.1 Pattern name

**Trustworthy AI Operations Cockpit**

This pattern combines:

- An information-dense enterprise SaaS shell.
- A revenue command center.
- An explainable AI recommendation system.
- A human-in-the-loop approval console.
- An auditable execution and measurement timeline.

### 2.2 Why this pattern fits

The core user is not primarily creating workflows. The core user is supervising revenue decisions across multiple businesses.

Therefore, the primary interface is not:

- A chatbot.
- A node-based automation canvas.
- A generic analytics dashboard.
- A collection of disconnected CRUD screens.

The primary interface is a continuously prioritized operating view that answers:

> **What needs attention now, why does it matter, and what should happen next?**

### 2.3 Product personality

The product should feel:

- Calm, not flashy.
- Intelligent, not magical.
- Financially serious, not playful.
- Fast, not rushed.
- Dense, not cluttered.
- Transparent, not mysterious.
- Confident, but never falsely certain.

### 2.4 Visual reference direction

Use the restraint and information hierarchy associated with modern developer and operations products, while avoiding imitation of any single brand.

The resulting visual language should resemble a blend of:

- Enterprise operations software.
- Financial analytics tools.
- Modern developer tooling.
- AI decision-support systems.

Do not use consumer-app visual tropes for high-risk business decisions.

---

## 3. Non-negotiable UX principles

### 3.1 Outcome before automation

The user interface must describe business outcomes before implementation details.

Prefer:

- “Recover an estimated AED 3,200–4,600 in monthly gross profit.”

Avoid:

- “Run workflow 14.”

### 3.2 Gross profit before vanity metrics

Revenue, order volume, reach, clicks, and impressions must not be shown without relevant cost or margin context when that context exists.

### 3.3 Scope must always be visible

The user must always know whether they are acting at:

- Agency level.
- Organization level.
- Branch level.
- Channel level.
- Campaign, experiment, or execution level.

Never rely on memory to prevent a cross-client mistake.

### 3.4 AI must be inspectable

Every important AI recommendation must expose:

- Evidence.
- Assumptions.
- Data sources.
- Data freshness.
- Expected impact range.
- Confidence level.
- Risks.
- Guardrails.
- Required approval.
- Rollback or recovery plan when applicable.

### 3.5 AI is not the default interaction surface

Do not turn every page into a chat interface.

Use contextual AI actions such as:

- Ask why.
- Explain this estimate.
- Show evidence.
- Compare alternatives.
- Draft a revised plan.
- Summarize changes.

Chat is a supporting interface inside a scoped context, not the global information architecture.

### 3.6 Human control is proportional to risk

Low-risk analysis can happen automatically. High-impact actions require explicit review.

The UI must make the boundary visible.

### 3.7 Progressive disclosure

Show the minimum information required to understand and act. Keep evidence, assumptions, logs, and advanced controls one interaction away.

### 3.8 No hidden state changes

After an approval, rejection, edit, execution, or policy change, show what changed and what the system will do differently.

### 3.9 Every state needs a recovery path

Errors must explain:

- What failed.
- What was affected.
- Whether anything external changed.
- Whether retry is safe.
- What the user can do next.

### 3.10 Accessibility is part of the design system

Target WCAG 2.2 AA. Do not treat accessibility as a later QA phase.

---

## 4. Primary users and interface modes

### 4.1 Agency operator

Needs:

- Cross-client portfolio visibility.
- Prioritized opportunities.
- Approval queues.
- Execution failures.
- Integration health.
- Cost and usage control.

Default density: compact-professional.

### 4.2 Client owner or manager

Needs:

- Understandable business outcomes.
- Clear approval requests.
- Simple organization-level reporting.
- Confidence that the system is controlled.

Default density: comfortable.

### 4.3 Technical administrator

Needs:

- Integration status.
- Worker runs.
- Events and logs.
- Policies.
- Tokens, costs, and quotas.
- Debug information.

Default density: compact.

### 4.4 Responsive usage

The product is desktop-first because operators review dense operational data. Mobile must still support:

- Viewing opportunities.
- Approving or rejecting bounded actions.
- Reading critical alerts.
- Checking execution status.

Complex configuration and bulk operations may be optimized for desktop and tablet.

---

## 5. Information architecture

## 5.1 Agency-level navigation

Use this order:

1. **Portfolio**
2. **Organizations**
3. **Opportunities**
4. **Approvals**
5. **Executions**
6. **Integration health**
7. **Playbooks**
8. **Platform usage**
9. **Settings**

### Agency-level home hierarchy

1. Critical exceptions.
2. Opportunities awaiting action.
3. Portfolio revenue and gross-profit movement.
4. Active experiments.
5. Integration and execution health.
6. Recent AI decisions.

Do not lead with decorative KPI cards that lack an associated decision.

## 5.2 Organization-level navigation

Use this order:

1. **Overview**
2. **Digital Twin**
3. **Goals**
4. **Opportunities**
5. **Approvals**
6. **Experiments**
7. **Customers / Audiences**
8. **Integrations**
9. **Memory**
10. **Decision timeline**
11. **Settings & governance**

Industry Packs may insert domain modules after Experiments. The Restaurant Pack may add:

- Menu intelligence.
- Delivery channels.
- Branch operations.
- Reviews and reputation.

## 5.3 Navigation rules

- Use a persistent, collapsible left sidebar on desktop.
- Use an off-canvas sidebar on mobile.
- Keep the organization switcher at the top of the sidebar.
- Show an agency/organization scope label above the page title.
- Use breadcrumbs for nested resources, not for primary navigation.
- Preserve filters and table state in URL search parameters.
- Support a global command menu with `Cmd/Ctrl + K`.
- Never hide approval count or critical execution failures only inside a notification center.

---

## 6. Application shell

### 6.1 Desktop dimensions

- Expanded sidebar: `256px`.
- Collapsed sidebar: `64px`.
- Top context bar: `56px`.
- Main content maximum readable width: `1600px`.
- Standard page padding: `24px` at `lg`, `32px` at `xl`.
- Contextual detail sheet: `440px–560px`.

### 6.2 Shell composition

```text
SidebarProvider
├── AppSidebar
│   ├── Product mark
│   ├── Organization switcher
│   ├── Primary navigation
│   ├── Status / usage section
│   └── User menu
└── SidebarInset
    ├── ContextTopbar
    │   ├── Breadcrumb
    │   ├── Scope indicator
    │   ├── Global search / command
    │   ├── Critical alerts
    │   └── User actions
    └── MainContent
```

### 6.3 Scope safety pattern

Every organization-level page must display:

- Organization name.
- Branch or “All branches.”
- Environment when applicable.
- Current timezone.
- Data freshness state when relevant.

For actions that affect an external platform, repeat the target organization and branch inside the approval surface.

---

## 7. Page templates

## 7.1 Portfolio page

Use:

- One compact financial summary strip.
- Critical exceptions panel.
- Ranked opportunity feed.
- Organization health table.
- Recent high-impact decisions.

Do not use a wall of equally weighted cards.

## 7.2 Organization overview

Use this vertical order:

1. Scope and date-range header.
2. Outcome summary.
3. Highest-value opportunity.
4. Active goals and progress.
5. Channel performance.
6. Active experiments.
7. Integration or data-quality blockers.
8. Recent decision timeline.

## 7.3 List and audit pages

Use a data table when the user needs to:

- Compare many records.
- Sort.
- Filter.
- Audit.
- Select rows.
- Perform bulk actions.
- Inspect state over time.

Examples:

- Organizations.
- Executions.
- Approvals.
- Integrations.
- Memories.
- Experiments.

## 7.4 Detail pages

Use a stable page for objects that have:

- Their own URL.
- Long-lived state.
- Multiple tabs.
- Audit history.
- Complex actions.

Examples:

- Organization.
- Opportunity.
- Experiment.
- Execution.
- Integration.

## 7.5 Contextual detail sheet

Use a right-side `Sheet` for:

- Quick record inspection.
- Evidence preview.
- Run logs.
- Compact edits.
- Comparing a selected table row without losing list context.

Do not use a sheet for a complex multi-step task or a destructive confirmation.

## 7.6 Dialog

Use `Dialog` only for focused, interruptive tasks such as:

- Creating a small object.
- Renaming.
- Choosing a template.
- Editing one bounded configuration.

Do not put an entire settings page inside a dialog.

## 7.7 Alert dialog

Use `AlertDialog` for:

- Irreversible deletion.
- Publishing a high-risk external action.
- Approving material spend.
- Disconnecting an integration when data or workflows will be affected.
- Actions with legal, financial, brand, or customer consequences.

The confirmation must describe consequences, scope, and recovery.

---

## 8. Core domain interaction patterns

## 8.1 Revenue Opportunity Card

This is a domain component, not a generic `Card` with arbitrary content.

### Required information hierarchy

1. Opportunity title.
2. Expected incremental gross-profit range.
3. Affected organization, branch, channel, and audience.
4. Why now.
5. Cost or required budget.
6. Time to expected impact.
7. Confidence and evidence quality.
8. Data freshness.
9. Risk tier and approval state.
10. Primary action.

### Required actions

- Review plan.
- Approve or approve and launch.
- Edit parameters.
- Reject with reason.
- Request more evidence.
- Snooze.
- Ask why.

### Visual rules

- Use a left status rail or compact semantic indicator, not a full saturated background.
- The gross-profit estimate is the strongest visual element after the title.
- Separate “confidence” from “evidence quality.”
- Never present one precise forecast number without a range.
- Show stale data prominently.
- Primary action must reflect the current state.

## 8.2 Approval review surface

Every approval review must display:

- Exact target organization and branch.
- Proposed action.
- Current versus proposed values.
- Spend ceiling.
- Duration.
- Audience or affected customers.
- External channels or capabilities used.
- Evidence.
- Assumptions.
- Expected impact range.
- Guardrail metrics.
- Failure and rollback plan.
- Approval expiry.

Use a diff view for changed settings. Material edits create a new plan version and invalidate prior approval.

## 8.3 Decision timeline

Represent lifecycle events such as:

- Signal observed.
- Opportunity created.
- Plan generated.
- Evidence updated.
- Approval requested.
- Plan edited.
- Approved or rejected.
- Execution started.
- Execution succeeded or failed.
- Outcome measured.
- Learning recorded.

Each item must identify:

- Actor: human, policy, system, or worker.
- Time.
- Scope.
- Reason.
- Linked evidence or run.

Use a timeline for narrative inspection and a table for audit/export.

## 8.4 AI Readiness Score

The score is a setup diagnostic, not a vanity score.

Show:

- Overall readiness.
- Category breakdown.
- Missing or stale data.
- Blocked capabilities.
- Highest-value next setup action.
- Estimated benefit of resolving the blocker.

Never use a circular gauge without an accompanying explanation and actionable list.

## 8.5 Integration health

Integration status must distinguish:

- Connected and healthy.
- Connected but stale.
- Permission limited.
- Rate limited.
- Authentication expired.
- Partial data.
- Degraded.
- Disconnected.

Use icon + label + explanation. Color alone is insufficient.

## 8.6 Worker run and execution view

Show:

- Current phase.
- Elapsed time.
- Retry count.
- Inputs.
- Tools invoked.
- External side effects.
- Output.
- Evaluation result.
- Cost.
- Logs.
- Safe retry state.

Long-running work should use a step-based progress view, not an indefinite spinner.

---

## 9. AI-specific UX language

## 9.1 AI state model

Use these canonical states:

- `Observed`
- `Analyzing`
- `Proposed`
- `Needs data`
- `Awaiting approval`
- `Approved`
- `Scheduled`
- `Executing`
- `Measuring`
- `Completed`
- `Partially completed`
- `Failed`
- `Rejected`
- `Expired`
- `Cancelled`

Do not create near-duplicate labels such as “In progress,” “Processing,” and “Running” for the same state.

## 9.2 Confidence language

Confidence is not proof.

Use:

- Low confidence.
- Medium confidence.
- High confidence.

Optionally show a calibrated numeric range in details, but do not display pseudo-precise values such as `97.43% confident` in the primary interface.

Always separate:

- Model confidence.
- Evidence quality.
- Forecast range.
- Data freshness.

## 9.3 Evidence presentation

Evidence must be grouped as:

- Verified facts.
- Imported observations.
- Calculated metrics.
- Inferences.
- Assumptions.
- Missing information.

Use a source label and timestamp for each significant evidence item.

## 9.4 AI capability messaging

Explain what the system can and cannot do before requesting trust.

Prefer:

> “The system can draft and evaluate campaigns. Publishing and budget changes require approval under this organization’s policy.”

Avoid:

> “Our AI handles your marketing automatically.”

## 9.5 Corrections and feedback

Provide lightweight feedback actions:

- Correct fact.
- Mark irrelevant.
- Reject recommendation.
- Explain rejection.
- Set a preference.
- Change a guardrail.

After feedback, state how it affects future behavior.

## 9.6 AI copy rules

Never write:

- “The AI knows…”
- “The AI guarantees…”
- “The AI decided…” without an explanation trail.
- “Magic.”
- “Set it and forget it.”

Prefer:

- “The system detected…”
- “The recommendation is based on…”
- “The plan assumes…”
- “Expected impact…”
- “Approval is required because…”

---

## 10. Visual design language

## 10.1 Design character

Use:

- Neutral surfaces.
- Fine borders.
- Restrained elevation.
- Strong typographic hierarchy.
- Semantic color.
- Compact data presentation.
- Spacious decision surfaces.

Avoid:

- Glassmorphism.
- Heavy gradients.
- Neon glows.
- Large decorative illustrations inside operational screens.
- Excessive rounded cards.
- Overuse of shadows.
- Animated AI orbs.
- Rainbow status colors.

## 10.2 Surface hierarchy

Use four primary levels:

1. **Canvas** — application background.
2. **Surface** — cards, tables, panels.
3. **Raised surface** — popovers, dropdowns, sheets.
4. **Critical overlay** — dialogs and approval confirmations.

Use borders before shadows. Shadows should communicate elevation, not decoration.

## 10.3 Corner radius

Set:

```css
--radius: 0.625rem;
```

Rules:

- Inputs and buttons: `rounded-md`.
- Cards and panels: `rounded-lg`.
- Large onboarding or empty-state surfaces: `rounded-xl` only when justified.
- Badges: `rounded-full` or `rounded-md` depending on density.
- Avoid excessive `rounded-2xl` and `rounded-3xl` in operational UI.

## 10.4 Borders and elevation

- Default panel border: `1px solid border`.
- Table row separation: subtle border or whitespace, not heavy lines.
- Standard cards: no shadow or `shadow-xs`.
- Popovers and dropdowns: `shadow-md`.
- Dialogs and sheets: `shadow-lg`.
- Never combine a heavy border with a heavy shadow.

---

## 11. Color system

## 11.1 Color strategy

Use a neutral base with an indigo-blue brand action color.

Semantic color roles:

- **Brand / primary:** actions, current navigation, focus.
- **Revenue positive / success:** measured gains, healthy completion.
- **Warning:** risk, stale data, attention required.
- **Destructive:** failure, prohibited action, irreversible destructive action.
- **Information:** neutral informational state.
- **AI:** AI-generated or AI-assisted content marker; never use AI color as the primary action color.

Do not use green to represent a recommendation before an outcome is measured.

## 11.2 Semantic palette reference

| Role | Light reference | Dark reference | Usage |
|---|---:|---:|---|
| Canvas | `#F8FAFC` | `#0B1020` | App background |
| Surface | `#FFFFFF` | `#111827` | Cards, tables, panels |
| Foreground | `#111827` | `#F8FAFC` | Primary text |
| Muted foreground | `#64748B` | `#94A3B8` | Secondary text |
| Border | `#E2E8F0` | `rgba(255,255,255,.12)` | Dividers, outlines |
| Primary | `#4F46E5` | `#818CF8` | Primary actions, selected navigation |
| Primary hover | `#4338CA` | `#A5B4FC` | Hover/active |
| AI | `#7C3AED` | `#A78BFA` | AI-assisted labels and provenance |
| Success | `#047857` | `#34D399` | Measured positive result, healthy state |
| Warning | `#B45309` | `#FBBF24` | Attention, stale, elevated risk |
| Destructive | `#B91C1C` | `#F87171` | Failure, destructive action |
| Info | `#0369A1` | `#38BDF8` | Informational state |

These references are not direct component classes. Components must use semantic tokens.

## 11.3 Required shadcn/Tailwind tokens

Use CSS variables and semantic utilities. Do not hardcode palette values inside components.

```css
:root {
  --radius: 0.625rem;

  --background: oklch(0.984 0.003 247.858);
  --foreground: oklch(0.145 0.02 264);

  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0.02 264);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0.02 264);

  --primary: oklch(0.51 0.23 277);
  --primary-foreground: oklch(0.985 0 0);

  --secondary: oklch(0.96 0.018 277);
  --secondary-foreground: oklch(0.29 0.08 277);

  --muted: oklch(0.968 0.007 248);
  --muted-foreground: oklch(0.47 0.03 257);

  --accent: oklch(0.95 0.025 245);
  --accent-foreground: oklch(0.28 0.07 260);

  --destructive: oklch(0.54 0.22 27);
  --destructive-foreground: oklch(0.985 0 0);

  --border: oklch(0.92 0.012 256);
  --input: oklch(0.92 0.012 256);
  --ring: oklch(0.59 0.21 277);

  --success: oklch(0.48 0.14 157);
  --success-foreground: oklch(0.985 0 0);
  --success-subtle: oklch(0.96 0.035 157);
  --success-subtle-foreground: oklch(0.32 0.10 157);

  --warning: oklch(0.56 0.15 65);
  --warning-foreground: oklch(0.985 0 0);
  --warning-subtle: oklch(0.96 0.05 85);
  --warning-subtle-foreground: oklch(0.34 0.10 55);

  --info: oklch(0.49 0.14 238);
  --info-foreground: oklch(0.985 0 0);
  --info-subtle: oklch(0.96 0.035 238);
  --info-subtle-foreground: oklch(0.33 0.09 238);

  --ai: oklch(0.52 0.22 303);
  --ai-foreground: oklch(0.985 0 0);
  --ai-subtle: oklch(0.96 0.035 303);
  --ai-subtle-foreground: oklch(0.34 0.11 303);

  --chart-1: oklch(0.55 0.19 277);
  --chart-2: oklch(0.55 0.14 160);
  --chart-3: oklch(0.58 0.14 235);
  --chart-4: oklch(0.67 0.16 75);
  --chart-5: oklch(0.56 0.18 25);

  --sidebar: oklch(0.97 0.006 255);
  --sidebar-foreground: oklch(0.22 0.025 260);
  --sidebar-primary: oklch(0.51 0.23 277);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.94 0.025 277);
  --sidebar-accent-foreground: oklch(0.29 0.08 277);
  --sidebar-border: oklch(0.91 0.012 256);
  --sidebar-ring: oklch(0.59 0.21 277);
}

.dark {
  --background: oklch(0.14 0.025 260);
  --foreground: oklch(0.97 0.006 255);

  --card: oklch(0.18 0.025 260);
  --card-foreground: oklch(0.97 0.006 255);
  --popover: oklch(0.18 0.025 260);
  --popover-foreground: oklch(0.97 0.006 255);

  --primary: oklch(0.72 0.16 277);
  --primary-foreground: oklch(0.18 0.05 277);

  --secondary: oklch(0.24 0.04 277);
  --secondary-foreground: oklch(0.94 0.018 277);

  --muted: oklch(0.22 0.025 260);
  --muted-foreground: oklch(0.71 0.025 256);

  --accent: oklch(0.24 0.04 245);
  --accent-foreground: oklch(0.94 0.018 245);

  --destructive: oklch(0.68 0.19 25);
  --destructive-foreground: oklch(0.16 0.05 25);

  --border: oklch(1 0 0 / 12%);
  --input: oklch(1 0 0 / 16%);
  --ring: oklch(0.72 0.16 277);

  --success: oklch(0.72 0.15 157);
  --success-foreground: oklch(0.16 0.04 157);
  --success-subtle: oklch(0.24 0.06 157);
  --success-subtle-foreground: oklch(0.87 0.08 157);

  --warning: oklch(0.80 0.16 85);
  --warning-foreground: oklch(0.20 0.05 70);
  --warning-subtle: oklch(0.27 0.06 70);
  --warning-subtle-foreground: oklch(0.90 0.09 85);

  --info: oklch(0.75 0.13 238);
  --info-foreground: oklch(0.16 0.04 238);
  --info-subtle: oklch(0.25 0.055 238);
  --info-subtle-foreground: oklch(0.88 0.07 238);

  --ai: oklch(0.76 0.15 303);
  --ai-foreground: oklch(0.18 0.05 303);
  --ai-subtle: oklch(0.26 0.06 303);
  --ai-subtle-foreground: oklch(0.89 0.07 303);

  --chart-1: oklch(0.72 0.16 277);
  --chart-2: oklch(0.70 0.14 160);
  --chart-3: oklch(0.73 0.13 235);
  --chart-4: oklch(0.78 0.15 75);
  --chart-5: oklch(0.72 0.17 25);

  --sidebar: oklch(0.16 0.025 260);
  --sidebar-foreground: oklch(0.94 0.008 255);
  --sidebar-primary: oklch(0.72 0.16 277);
  --sidebar-primary-foreground: oklch(0.18 0.05 277);
  --sidebar-accent: oklch(0.23 0.04 277);
  --sidebar-accent-foreground: oklch(0.94 0.018 277);
  --sidebar-border: oklch(1 0 0 / 10%);
  --sidebar-ring: oklch(0.72 0.16 277);
}
```

Expose custom tokens through Tailwind `@theme inline`.

### Implementation requirement

The coding agent must run automated contrast tests after implementation. Token values may be adjusted to meet WCAG requirements, but semantic roles must not change without a design-system decision.

## 11.4 Color usage rules

- Primary color is reserved for primary actions and selected navigation.
- AI violet identifies provenance, not success.
- Success green is reserved for measured or confirmed positive states.
- Warning amber indicates attention, stale data, or elevated risk.
- Destructive red is reserved for failures and destructive actions.
- Neutral gray represents inactive, unavailable, or unknown.
- Never communicate state using color alone.
- Limit a view to one visually dominant primary action.
- Use subtle semantic backgrounds for badges and alerts; reserve saturated fills for buttons or critical emphasis.

---

## 12. Typography

## 12.1 Font stack

Primary:

```css
font-family: "Geist", "Inter", "Noto Sans Arabic", ui-sans-serif, system-ui, sans-serif;
```

Monospace:

```css
font-family: "Geist Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
```

Use `Noto Sans Arabic` when Arabic localization is enabled.

## 12.2 Type scale

| Role | Size / line height | Weight | Usage |
|---|---|---:|---|
| App page title | `24/32` | 650 | Page title |
| Large outcome | `28/34` | 650 | Revenue outcome, not general decoration |
| Section title | `16/24` | 600 | Major section heading |
| Card title | `14/20` | 600 | Dense cards and panels |
| Body | `14/20` | 400 | Default product copy |
| Compact body | `13/18` | 400 | Tables and dense metadata |
| Label | `12/16` | 600 | Form labels and table headings |
| Metadata | `12/16` | 400 | Timestamps, provenance, freshness |
| Code/log | `12/18` | 400 | IDs, payloads, logs |

### Typography rules

- Use sentence case.
- Use tabular numbers for money, percentages, counts, and time-series tables.
- Avoid all caps except compact technical abbreviations.
- Do not use font size below `12px` for meaningful interface text.
- Use bold sparingly; hierarchy should also use spacing and position.
- Keep primary body copy at `14px` for operator density.

---

## 13. Spacing and density

Use a 4px base grid.

Preferred spacing sequence:

- `4px` — icon/text micro-gap.
- `8px` — closely related controls.
- `12px` — compact internal spacing.
- `16px` — standard component padding.
- `24px` — section separation.
- `32px` — major page separation.
- `48px` — onboarding and empty-state breathing room.

### Control heights

- Compact button: `32px`.
- Default button: `36px` or `40px`.
- Primary mobile/touch action: at least `44px`.
- Input: `40px`.
- Dense table row: `40px`.
- Standard table row: `44px`.
- Sidebar navigation item: `36px`.

Do not make every element oversized. Dense operational software requires hierarchy through controlled variation.

---

## 14. Icons

Use **Lucide React**.

Rules:

- Default inline icon: `16px`.
- Navigation icon: `18px` or `20px`.
- Empty-state icon: `24px–32px`.
- Use `strokeWidth={1.75}` or the library default consistently.
- Icons supplement text; do not use an unlabeled icon for an ambiguous action.
- Use `Tooltip` for icon-only buttons.
- Destructive actions must include text in high-risk contexts.
- Do not use decorative AI sparkle icons throughout the application.

Canonical icons should be mapped centrally for states and modules.

---

## 15. Motion

Motion must communicate cause and state.

Use:

- `120–160ms` for hover and press feedback.
- `180–240ms` for popovers, sheets, and expanding panels.
- Subtle opacity and transform transitions.
- Progress animation only when progress is real or indeterminate work is unavoidable.

Avoid:

- Long easing sequences.
- Parallax.
- Pulsing AI glows.
- Continuous decorative motion.
- Animated counters that obscure the actual value.

Respect `prefers-reduced-motion`.

---

## 16. shadcn/ui component decision matrix

Use the current shadcn/ui component implementation with **Radix UI primitives** unless a documented ADR changes the base.

| Component | Use for | Do not use for |
|---|---|---|
| `Sidebar` | Primary app navigation, collapsible desktop shell, off-canvas mobile navigation | Page-specific filters |
| `Command` / `CommandDialog` | Global search, quick navigation, organization switcher, command palette | Long forms or complex configuration |
| `Breadcrumb` | Nested resource path | Replacing sidebar navigation |
| `Card` | Bounded summary, opportunity, exception, compact metric group | Every section or every table row |
| `Table` + TanStack Table v8 | Audit records, sortable/filterable lists, bulk operations | Small two-item summaries; do not adopt v9 while beta |
| `Tabs` | Stable peer views within the same resource | Sequential onboarding steps |
| `Sheet` | Contextual detail, quick edit, evidence panel, logs | Destructive confirmation or long multi-step setup |
| `Drawer` | Mobile contextual detail or mobile filters | Desktop primary pattern when a sheet is appropriate |
| `Dialog` | Focused bounded task | Full-page workflows |
| `AlertDialog` | Irreversible, costly, external, or high-risk confirmation | Ordinary save confirmation |
| `DropdownMenu` | Secondary row actions, user menu, compact overflow actions | Primary actions that must remain visible |
| `ContextMenu` | Specialist desktop-only contextual actions when discoverability is not essential | Critical or primary actions |
| `Popover` | Small interactive utility, date picker, compact filter | Long explanatory content |
| `HoverCard` | Supplemental preview for known objects on pointer devices | Required information or mobile-only flows |
| `Tooltip` | Icon labels and brief clarification | Long instructions, errors, or required evidence |
| `Collapsible` | Optional advanced details, logs, assumptions | Hiding required approval information |
| `Accordion` | FAQ-like or grouped configuration sections | Peer navigation better served by tabs |
| `Form` + TanStack Form v1 + Zod | Complex validated forms and onboarding | Small forms or local search/filter controls that do not need library state |
| `Input` | Short text and numeric values | Long-form content |
| `Textarea` | Rejection reason, notes, prompt/template copy | Structured multi-value data |
| `Select` | Small fixed option sets | Large searchable lists; use Combobox |
| `Combobox` | Organization, branch, audience, integration, or large searchable option set | Tiny fixed choices |
| `Checkbox` | Independent multi-selection | Mutually exclusive options |
| `RadioGroup` | Small mutually exclusive options | Large searchable option sets |
| `Switch` | Immediate binary preference with understandable consequence | One-time action or high-risk enablement without confirmation |
| `Slider` | Bounded tuning with visible numeric value | Precise financial inputs; use numeric input |
| `Calendar` / Date Picker | Date or date-range selection | Relative duration when presets are clearer |
| `Badge` | Status, risk tier, data provenance, capability | Main CTA or long text |
| `Alert` | Persistent page-level warning, blocker, degraded state | Ephemeral success feedback |
| `Progress` | Known completion such as onboarding or measured run progress | Decorative readiness score alone |
| `Skeleton` | Preserve layout during first load | Long-running execution progress |
| `Sonner` | Ephemeral success, low-risk confirmation, background completion notice | Critical error, approval request, or information requiring action |
| `Chart` | Trends, comparisons, experiment results | Data better read as exact table values |
| `Pagination` | Server-paginated audit or large datasets | Small lists |
| `ScrollArea` | Bounded logs, long menu, detail panel | Main page scrolling |
| `Resizable` | Technical log/detail workspace when users benefit from adjustable panes | Standard product pages |
| `Separator` | Subtle grouping | Replacing spacing hierarchy |
| `Avatar` | Human identity or organization mark | AI agent identity; use role icon and label |
| `Toggle` / `ToggleGroup` | Compact view mode or chart granularity | High-impact state changes |

---

## 17. Required application-specific components

Create these under `components/domain` or `components/revenue-os`. Do not rebuild them independently on each page.

### 17.1 `ScopeHeader`

Shows:

- Agency or organization scope.
- Branch.
- Date range.
- Timezone.
- Data freshness.
- Page actions.

### 17.2 `OrganizationSwitcher`

Requirements:

- Searchable.
- Recently used organizations.
- Clear agency-level option.
- Organization logo or initials.
- Branch context when relevant.
- Keyboard accessible.

### 17.3 `OpportunityCard`

Use the structure defined in section 8.1.

Variants:

- `featured`
- `compact`
- `queue`
- `resolved`

### 17.4 `FinancialImpactRange`

Displays:

- Currency.
- Lower and upper estimate.
- Metric basis: gross profit, contribution margin, or revenue.
- Period.
- Forecast or measured label.

Never display forecast as measured outcome.

### 17.5 `EvidencePanel`

Groups evidence by verification type and exposes source timestamps.

### 17.6 `ConfidenceIndicator`

Shows qualitative confidence, evidence quality, and a plain-language explanation.

Do not use a speedometer gauge.

### 17.7 `DataFreshnessBadge`

Canonical states:

- Live.
- Recent.
- Delayed.
- Stale.
- Unknown.

Thresholds must be domain-configurable.

### 17.8 `RiskTierBadge`

Canonical tiers:

- Tier 0 — Read only.
- Tier 1 — Internal draft.
- Tier 2 — Low-risk external.
- Tier 3 — Financial/public approval.
- Tier 4 — Prohibited.

### 17.9 `ApprovalReview`

Contains exact plan version, impact, diff, risks, guardrails, rollback, expiry, and approval actions.

### 17.10 `DecisionTimeline`

Provides narrative and audit modes.

### 17.11 `ExecutionProgress`

Shows durable background-job phase and external side effects.

### 17.12 `IntegrationHealthCard`

Shows provider, capabilities, permission status, sync state, last successful event, and next action.

### 17.13 `ReadinessBreakdown`

Shows category scores and actionable blockers.

### 17.14 `MetricDelta`

Displays current value, comparison value, delta, direction, and comparison period.

Color must reflect semantic outcome, not mathematical direction alone. For example, a higher refund rate is negative.

### 17.15 `EmptyState`

Variants:

- First use.
- Filtered no results.
- Missing integration.
- Insufficient data.
- Permission blocked.
- Error recovery.

---

## 18. Buttons and actions

### 18.1 Hierarchy

- **Primary:** one main action per surface.
- **Secondary:** supporting action.
- **Outline:** neutral action.
- **Ghost:** low-emphasis utility.
- **Destructive:** irreversible or damaging action.
- **Link:** navigation or low-emphasis text action.

### 18.2 Action wording

Use verb-first, consequence-aware labels.

Prefer:

- Approve and launch.
- Save draft.
- Request evidence.
- Reject with reason.
- Retry safely.
- Disconnect integration.
- Recalculate estimate.

Avoid:

- Submit.
- Yes.
- OK.
- Continue, when the next action has a specific meaning.

### 18.3 Dangerous actions

For high-risk actions:

- Include cost and scope in the surface.
- Repeat the target organization.
- Show rollback or irreversibility.
- Require an explicit confirmation.
- Use typed confirmation only for exceptional destructive actions, not routine approvals.

---

## 19. Forms and onboarding

## 19.1 Guided onboarding pattern

Use a progressive, resumable wizard with a visible step list.

Do not use `Tabs` for sequential onboarding.

Recommended steps:

1. Business identity.
2. Locations and branches.
3. Business model and goals.
4. Products, services, or menu.
5. Channels and integrations.
6. Historical performance.
7. Brand and creative assets.
8. Operations and constraints.
9. Governance and approvals.
10. Review and readiness.

## 19.2 Form layout

- Maximum content width: `720px–800px`.
- One clear question group per section.
- Labels above fields.
- Help text below labels or fields.
- Validation close to the field.
- Sticky action footer for long steps.
- Save automatically and show last-saved status.
- Provide “I don’t know” and “Request from client” paths.
- AI suggestions require explicit confirmation before becoming verified facts.

## 19.3 Data provenance inside forms

For AI-filled or imported data, show:

- Source.
- Timestamp.
- Confidence or parsing quality.
- Confirm/edit control.

Do not silently populate high-impact fields.

## 19.4 Validation

- Validate on blur for field-level errors.
- Validate the complete step on continue.
- Focus the first invalid field.
- Preserve user input after errors.
- Use plain-language errors.
- Do not rely on toast messages for field errors.

---

## 20. Tables

Use TanStack Table v8 with shadcn `Table` primitives. Do not adopt Table v9 while it remains beta.

### 20.1 Required table capabilities where applicable

- Server-side pagination.
- Sorting.
- Search.
- Faceted filters.
- Column visibility.
- Sticky header.
- Row action menu.
- Row selection for legitimate bulk actions.
- Saved views later, not necessarily in MVP.
- URL-persisted filter state.

### 20.2 Table rules

- Left-align text.
- Right-align numeric values.
- Use tabular numerals.
- Keep the primary identifier visible when horizontally scrolling.
- Avoid putting more than one primary button inside each row.
- Use a row click only when it clearly navigates to a detail page.
- Maintain a visible overflow menu for secondary actions.
- Provide a mobile card/list representation when a table becomes unusable.

### 20.3 Empty filtered state

Distinguish:

- No records exist.
- No records match current filters.
- Data is not synced.
- User lacks permission.

---

## 21. Charts and data visualization

Use shadcn `Chart` composition with Recharts.

## 21.1 Approved chart types

- Line chart: time trend.
- Area chart: bounded trend emphasis.
- Bar chart: category or channel comparison.
- Stacked bar: composition over time when categories are limited.
- Scatter plot: relationship or experiment analysis when justified.
- Funnel: acquisition-stage conversion with exact counts.

## 21.2 Avoid by default

- Pie charts.
- Donut charts.
- Gauges and speedometers.
- 3D charts.
- Decorative gradients.
- Dual-axis charts unless the relationship is essential and clearly labeled.

## 21.3 Chart rules

- Every chart needs a question it answers.
- Show exact values in accessible tooltips and a data table or summary.
- Label currency and time period.
- Use semantic color only when the meaning is stable.
- Do not use red and green as the only comparison encoding.
- Limit simultaneous series.
- Highlight the selected series and mute others.
- Default to a meaningful comparison period.
- Distinguish forecast from actual with line style, fill, and labels.
- Mark incomplete data and anomalies.

## 21.4 Financial metrics

Use:

- `AED 12,450`
- `AED 12.5K` only in compact summaries.
- Full exact values in tooltips and tables.
- One decimal maximum for percentages unless analysis requires more.
- Explicit comparison: `+8.4% vs previous 28 days`.

---

## 22. Loading, empty, success, and error states

## 22.1 Loading

Use `Skeleton` for initial content loading and preserve final layout.

Use step progress for durable AI or workflow execution.

Avoid a full-page spinner when the shell can remain usable.

## 22.2 Empty states

Each empty state must answer:

- Why is this empty?
- Is it expected?
- What value will appear here?
- What is the next action?

Do not use cheerful illustrations for serious blockers.

## 22.3 Success feedback

Use `Sonner` for low-risk ephemeral confirmation such as:

- Draft saved.
- Filter view saved.
- Invitation sent.
- Background refresh started.

Use persistent inline confirmation for:

- Approval completed.
- External campaign published.
- Integration connected.
- Policy changed.

## 22.4 Error feedback

Use:

- Inline field error for form problems.
- `Alert` for page-level recoverable problems.
- Persistent failure panel for execution failures.
- Alert dialog only when the user must choose a recovery action.

Every external-action error must state whether side effects may have occurred.

---

## 23. Accessibility and internationalization

## 23.1 Accessibility baseline

Target WCAG 2.2 AA.

Requirements:

- Keyboard access for all functionality.
- Visible focus ring.
- Focus must not be hidden behind sticky UI.
- Minimum pointer target of `24x24px`; prefer `44x44px` for primary touch actions.
- Text contrast of at least `4.5:1` for normal text.
- Non-text UI contrast of at least `3:1` where required.
- Labels for all controls.
- Status must not rely on color alone.
- Correct heading hierarchy.
- Skip-to-content link.
- Announce asynchronous status changes appropriately.
- Trap and restore focus correctly in modal surfaces.
- Respect reduced motion.

## 23.2 RTL and Arabic readiness

Dubai clients may require Arabic.

Build RTL support from the beginning:

- Use logical CSS properties: `ms`, `me`, `ps`, `pe`, `start`, `end`.
- Avoid hardcoded left/right layout assumptions.
- Test `dir="rtl"` at the app-shell and component level.
- Mirror directional icons where meaning depends on direction.
- Do not mirror universal icons such as play, media, or brand marks.
- Use locale-aware date, currency, and number formatting.
- Use `AED` consistently in English; use localized currency formatting in Arabic.
- Provide enough width for translated labels.
- Avoid icon-only actions whose meaning changes by locale.

## 23.3 Time and date

Always show the business timezone for operational actions.

For critical records, provide:

- Absolute timestamp.
- Timezone.
- Optional relative time.

Example:

> 6 Aug 2026, 4:30 PM GST · 12 minutes ago

---

## 24. Responsive behavior

### Breakpoint intent

- `<640px`: mobile action and review mode.
- `640–767px`: wide mobile.
- `768–1023px`: tablet.
- `1024–1279px`: compact desktop.
- `>=1280px`: full operations workspace.

### Mobile rules

- Sidebar becomes off-canvas.
- Tables become prioritized lists/cards or allow deliberate horizontal scroll with frozen primary identity.
- Filters open in a drawer.
- Detail sheet becomes a bottom or full-screen drawer.
- Sticky bottom action bar is allowed for approval actions.
- Do not hide evidence, cost, or risk to make a screen fit.
- Complex multi-column layouts stack by decision priority.

---

## 25. UX writing and content language

## 25.1 Voice

Use a voice that is:

- Direct.
- Calm.
- Specific.
- Financially literate.
- Transparent about uncertainty.
- Respectful of the user’s authority.

## 25.2 Sentence style

- Use sentence case.
- Prefer active voice.
- Lead with the outcome or issue.
- Keep labels short.
- Use plain language before technical terminology.
- Avoid exclamation marks in operational UI.

## 25.3 Canonical terminology

Use:

- Organization.
- Branch.
- Opportunity.
- Plan.
- Approval.
- Execution.
- Experiment.
- Evidence.
- Assumption.
- Guardrail.
- Capability.
- Integration.
- Playbook.
- Decision timeline.
- AI Readiness Score.

Do not alternate casually between client, tenant, account, workspace, and organization in user-facing copy. Use **organization** in the product UI. “Tenant” is an engineering term only.

## 25.4 Financial language

Prefer:

- Expected incremental gross profit.
- Estimated contribution margin.
- Required budget.
- Maximum spend.
- Break-even point.
- Measured outcome.

Avoid:

- Guaranteed revenue.
- Free growth.
- Risk-free.
- Automatic profit.

## 25.5 Uncertainty language

Prefer:

> Expected gross-profit lift: AED 2,800–4,100 over 30 days.

> Confidence: Medium. Order history is complete, but customer-level retention data is missing.

Avoid:

> This will make AED 3,472.

---

## 26. Frontend component architecture

Use this structure:

```text
components/
├── ui/                  # shadcn-generated primitives; minimal upstream changes
├── design-system/       # semantic wrappers, tokens, layout primitives
├── domain/              # reusable Revenue OS domain components
├── modules/             # module-specific compositions
└── charts/              # approved chart compositions
```

### 26.1 Rules for `components/ui`

- Keep close to upstream shadcn implementation.
- Do not place business logic here.
- Do not add organization-specific copy.
- Keep accessibility behavior intact.
- Record meaningful upstream deviations.

### 26.2 Rules for `components/design-system`

Place:

- Page layout.
- Scope header.
- Status badge variants.
- Metric formatting.
- Empty states.
- Form sections.
- Responsive patterns.

### 26.3 Rules for `components/domain`

Place:

- Opportunity card.
- Approval review.
- Decision timeline.
- Integration health.
- Financial impact range.
- Evidence panel.
- Execution progress.

### 26.4 Styling rules

- Use semantic tokens, not raw hex values.
- Use CVA for component variants.
- Use `cn()` for class merging.
- Avoid one-off arbitrary values when a design token exists.
- Avoid page-level duplicated status-color logic.
- Keep variants finite and named by purpose, not visual appearance.

Prefer:

```ts
variant: "warning"
```

Avoid:

```ts
variant: "yellow"
```

---

## 27. State management and URL behavior

- Persist shareable filters in URL search parameters.
- Preserve organization and branch scope explicitly.
- Keep transient UI state local.
- Server state should use the project’s selected query/cache layer.
- Optimistic updates are allowed only for safely reversible local actions.
- Do not optimistically claim an external campaign was published.
- External actions must display confirmed provider response or pending execution state.

---

## 28. Design-system acceptance criteria

A feature is not UI-complete until:

- Loading state exists.
- Empty state exists.
- Error and recovery states exist.
- Permission-denied state exists when applicable.
- Mobile behavior is defined.
- Keyboard flow is tested.
- Focus is visible and restored correctly.
- Screen-reader labels are present.
- Light and dark themes are tested.
- English and RTL layout are checked for critical components.
- Financial numbers are locale-aware.
- AI evidence, assumptions, and freshness are visible where required.
- External side effects are explicit.
- Destructive and high-risk actions use the correct confirmation pattern.
- No critical state is conveyed by color alone.
- Automated accessibility checks pass.

---

## 29. Anti-patterns

Coding agents must not:

1. Build the platform around a blank chat screen.
2. Use a workflow canvas as the main navigation.
3. Put every metric in a separate card.
4. Use gauges for confidence or readiness without actionable detail.
5. Display a precise forecast without a range and assumptions.
6. Treat AI-generated data as verified data.
7. Hide organization scope during an approval.
8. Use toast messages for critical failures.
9. Use a generic dialog for high-risk approval.
10. Use green for an unmeasured recommendation.
11. Use color as the only status indicator.
12. Use icon-only destructive actions.
13. Hardcode vendor names into generic capability UI.
14. Hide advanced information that is required for informed consent.
15. Use indefinite spinners for durable background jobs.
16. Use glassmorphism, neon glows, or animated AI decorations.
17. Create one-off page-specific status colors.
18. Use arbitrary wording for lifecycle states.
19. Collapse mobile layouts by removing cost, evidence, or risk.
20. Add an AI feature without defining failure and recovery states.

---

## 30. MVP design-system implementation order

### Phase 1 — Foundation

1. Theme tokens and dark mode.
2. Typography.
3. App shell and sidebar.
4. Scope header.
5. Button, badge, alert, empty-state, and skeleton conventions.
6. Form section patterns.
7. Data table base.
8. Accessibility and RTL baseline.

### Phase 2 — Pilot domain components

1. Guided onboarding shell.
2. AI Readiness Score and breakdown.
3. Opportunity Card.
4. Evidence Panel.
5. Approval Review.
6. Decision Timeline.
7. Integration Health Card.
8. Execution Progress.

### Phase 3 — Analysis surfaces

1. Financial summary components.
2. Chart library.
3. Experiment comparison.
4. Organization health matrix.
5. Saved views and advanced filters.

Do not delay the product to build a large standalone design-system website. Build reusable primitives while delivering vertical slices.

---

## 31. Research basis

This specification was informed by current guidance and component capabilities from:

- shadcn/ui theming, sidebar, data table, command, chart, sheet, dialog, tabs, skeleton, Sonner, dark-mode, and RTL documentation.
- Radix Primitives accessibility guidance.
- W3C Web Content Accessibility Guidelines 2.2 and supporting guidance on focus and target size.
- Microsoft HAX Guidelines for Human-AI Interaction.
- Google People + AI Guidebook guidance on explainability and trust.
- IBM Design for AI guidance on explainability.

The cited sources inform accessibility, component capability, explainability, and human-AI interaction. The final design direction and rules in this document are product-specific decisions for AI Revenue OS.

---

## 32. Coding-agent instruction

Before implementing or modifying a user interface, the coding agent must:

1. Read this complete document.
2. Identify the user role and active scope.
3. Identify the business decision the screen supports.
4. Select the correct page and interaction pattern.
5. Reuse existing domain components.
6. Use semantic tokens only.
7. Define loading, empty, error, permission, and recovery states.
8. Expose AI evidence, uncertainty, and data freshness where applicable.
9. Test keyboard, responsive, dark-mode, and RTL behavior.
10. Update this document when a durable design-system decision changes.

When requirements conflict, prioritize in this order:

1. Safety and informed approval.
2. Tenant and scope clarity.
3. Accessibility.
4. Business-outcome clarity.
5. Auditability.
6. Consistency.
7. Speed.
8. Visual polish.
