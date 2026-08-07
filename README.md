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
- Zod for schemas and tool validation
- Sentry + OpenTelemetry for observability
- n8n only for connectors where it materially reduces integration time

## Important scope rule

Build production-quality **vertical slices**, not broad but incomplete modules. Speed comes from sharp scope, reusable contracts, AI-assisted coding, and excellent automated tests - not from skipping security, tenancy, auditability, or measurement.

## Foundation implementation

This repository now contains the initial Next.js control-plane foundation and Supabase tenancy schema. The first production vertical slice is Organization + Digital Twin onboarding.

## Local setup

1. Install Node.js 22+ and npm (or pnpm), then copy `.env.example` to `.env.local`.
2. Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. Install dependencies with `npm install`.
4. Apply migrations with `npm run supabase:start` and `npm run supabase:reset` for a local Supabase instance.
5. Run `npm run dev` and open `http://localhost:3000`.

Quality checks:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Foundation boundaries

- `src/app` is the presentation layer and route composition.
- `src/domain` contains industry-neutral domain contracts and event envelopes.
- `src/ai` contains provider-agnostic model contracts; no autonomous worker is enabled.
- `src/workflows` is the Trigger.dev adapter boundary; Postgres remains business state.
- `src/lib/supabase` contains browser/server session clients; service-role access is not used by browser code.
- `supabase/migrations` contains the tenant root, memberships, and RLS policies.

The shell intentionally contains no fake analytics. The next task is to implement Organization Creation + Digital Twin Onboarding from `specs/001-organization-digital-twin.md`.
