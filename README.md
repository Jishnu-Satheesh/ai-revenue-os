# AI Revenue OS

AI Revenue OS is a multi-tenant, goal-driven platform that helps an agency increase measurable business outcomes for multiple clients through AI-assisted planning, durable automation, experimentation, and continuous learning.

The first pilot is a Dubai restaurant business that wants to increase:

1. Offline restaurant visits and direct inquiries.
2. Orders and profitable sales from food-delivery marketplaces.
3. Repeat purchases and first-party customer relationships.

The platform core is intentionally industry-neutral. Restaurant-specific concepts live in an installable **Restaurant Industry Pack**.

## North-star question

> What is the safest, highest-confidence action the system can take today to increase this organization's incremental gross profit?

Revenue is a visible outcome, but the optimization target should normally be **incremental gross profit**, not vanity metrics or gross sales alone.

## Documentation map

- `AGENTS.md` - mandatory operating instructions for coding agents.
- `context/` - product, architecture, AI, security, UX, and engineering context.
- `specs/` - implementation-ready vertical-slice specifications.
- `industry-packs/restaurant/` - restaurant domain model, playbooks, and Dubai pilot assumptions.
- `adrs/` - architectural decision records.
- `review/` - critical review and implementation-readiness checklists.

## Recommended build order

1. Project foundation, authentication, and tenant isolation.
2. Organization creation and Digital Twin.
3. Guided onboarding and AI Readiness Score.
4. Integration Hub and ingestion contracts.
5. Business Memory and event timeline.
6. Decision Engine V1 in recommendation-only mode.
7. Trigger.dev worker runtime and tool gateway.
8. Revenue Opportunity Feed and approval system.
9. Restaurant menu intelligence and first revenue playbooks.
10. Controlled execution, measurement, and learning.

## Working stack

- Next.js + TypeScript
- Tailwind CSS + shadcn/ui
- Supabase Postgres, Auth, Storage, Row Level Security, and optional pgvector
- Trigger.dev for durable background and agent workflow execution
- Vercel AI SDK with model-provider abstraction
- TanStack Query v5 for interactive client-owned server state
- TanStack Form v1 for complex and multi-step forms
- Zod for schemas and tool validation
- Sentry + OpenTelemetry for observability
- n8n only for connectors where it materially reduces integration time

## Important scope rule

Build production-quality **vertical slices**, not broad but incomplete modules. Speed comes from sharp scope, reusable contracts, AI-assisted coding, and excellent automated tests - not from skipping security, tenancy, auditability, or measurement.

## Foundation implementation

This repository now contains the initial Next.js control-plane foundation and Supabase tenancy schema. The first production vertical slice is Organization + Digital Twin onboarding.

## Organization + Digital Twin slice

The onboarding flow is available at `/organizations/new` after authentication. It creates the organization, owner membership, default access/spend policies, an initial business profile, and an optional first branch in one database transaction. The Digital Twin workspace at `/organizations/:organizationId/digital-twin` records profile context, branches, source-aware facts, goals, constraints, policies, readiness, and audit history.

Draft organizations are soft-archived through the lifecycle control rather than hard-deleted. Restaurant organizations require an active physical branch and an access policy before activation. Verified facts cannot be downgraded by later inferred or imported writes.

All project commands use **pnpm**. The committed `pnpm-lock.yaml` is the dependency source of truth.

All user-facing controls and surface primitives must use shadcn/ui components or compositions of them. This is a critical design-system and accessibility rule; add missing primitives with the pnpm shadcn CLI rather than introducing bare HTML controls.

## Local setup

1. Install Node.js 22+ and pnpm, then copy `.env.example` to `.env.local`.
2. Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, plus `DATABASE_URL` for the shared staging project.
3. Install dependencies with `pnpm install`.
4. Run `pnpm dev` and open `http://localhost:3000`.

Quality checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Database workflow

**There is no local or development database.** Development and testing both run against the shared hosted **staging** Supabase project, and every command below acts on it. Production is served from a separate database, so staging data is safe to work with.

Use one fixed **development organization** for workflow testing, so results stay comparable between sessions and nobody has to rebuild a fixture to reproduce a bug:

| | |
| --- | --- |
| Organization | `2dda45b8-82db-4f5f-b17d-611b9bbb7846` — Al Noor Kitchen |
| Industry pack | `restaurant`, AED, `Asia/Dubai`, 3 branches |

```bash
pnpm db:migrations:list      # what staging has applied
pnpm db:migrations:dry-run   # what a push would apply
pnpm db:migrations:push      # apply pending migrations to staging
pnpm db:test                 # pgTAP suites against DATABASE_URL
```

Three consequences follow from having no local stack, and they explain choices that otherwise look odd:

- **pgTAP suites run against a hosted project**, which restricts operations a local Postgres allows. Direct deletes on `storage.objects` are blocked by the platform, so those assertions detect the restriction and report `SKIP` rather than failing or silently passing. The same suites run against a throwaway local stack in CI, where the assertions execute for real.
- **`pnpm db:types` cannot be run here.** `supabase gen types` needs Docker for both `--local` and `--db-url`. CI generates the file and publishes it as a build artifact; `src/lib/supabase/database.types.ts` is maintained by hand until it is adopted.
- **Migrations are only ever applied incrementally**, since staging is never rebuilt from scratch. CI is the only place migrations are proven to apply to an empty database, which is why the `supabase start` step there is worth keeping.

Because staging is shared, a destructive migration affects everyone. Prefer additive changes and corrective follow-up migrations over editing one that has already been applied.

## Integration Hub

The Integration Hub lives at `/organizations/:organizationId/integrations` and covers connection
health, the provider catalog, manual/CSV data sources, and activity.

V1 is deliberately narrow: Google Business Profile runs from a deterministic fixture, no provider
credential is stored, and there are no provider writes or webhooks. Real OAuth stays disabled until
Google approves API access and the credential security review in `specs/003-integration-hub.md`
passes.

Access is gated by `INTEGRATION_HUB_V1_ORGANIZATION_IDS`, a server-only comma-separated list of
organization UUIDs enforced in the page loader, every API route, and every worker. Navigation
visibility is not authorization: an organization outside the list is refused everywhere.

The authenticated end-to-end suite (`e2e/integration-hub.spec.ts`) needs a seeded Supabase project.
Set `E2E_INTEGRATION_ORGANIZATION_ID`, `E2E_OTHER_ORGANIZATION_ID`, and the `E2E_OPERATOR_*` and
`E2E_VIEWER_*` credentials from `.env.example`; without them those scenarios skip and only the
unauthenticated boundary scenarios run.

## Foundation boundaries

- `src/app` is the presentation layer and route composition.
- `src/domain` contains industry-neutral domain contracts and event envelopes.
- `src/ai` contains provider-agnostic model contracts; no autonomous worker is enabled.
- `src/workflows` is the Trigger.dev adapter boundary; Postgres remains business state.
- `src/lib/supabase` contains browser/server session clients; service-role access is not used by browser code.
- `supabase/migrations` contains the tenant root, memberships, and RLS policies.

The shell intentionally contains no fake analytics. The next task is Guided Onboarding and the AI Readiness Score from `specs/002-guided-onboarding.md` and `specs/008-ai-readiness-score.md`.
