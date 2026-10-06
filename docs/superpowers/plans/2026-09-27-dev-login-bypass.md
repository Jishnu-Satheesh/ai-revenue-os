# Dev Login Bypass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dev-only URL that signs the local browser in as a namespaced owner, operator, viewer (or admin) persona with a real Supabase session.

**Architecture:** One route (`GET /api/dev/login-as`) hard-gated on `NODE_ENV=development` provisions the persona (find-or-create auth user, upsert one membership row), mints a `magiclink` token with the admin API, and 302s through the app's own `/auth/callback`. No fake sessions, no UI, no migration.

**Tech Stack:** Next.js App Router route handlers, Supabase Auth admin API (`listUsers`/`createUser`/`generateLink`), Vitest + Testing Library, zod.

**Spec:** `docs/superpowers/specs/2026-09-27-dev-login-bypass-design.md` — read it before starting; the plan argues from it.

## Global Constraints

- The route returns 404 unless `process.env.NODE_ENV === "development"`, checked per request. No override flag may exist.
- Persona emails are exactly `dev.owner@lunes.test`, `dev.admin@lunes.test`, `dev.operator@lunes.test`, `dev.viewer@lunes.test`, marked `dev_persona: true` in `user_metadata`.
- Provisioning touches only `dev.*@lunes.test` users and their `organization_memberships` rows. It never lists emails to the caller and never alters real users.
- `generateLink` sends no email; the token travels only in the 302 `Location`.
- `next` accepts same-origin paths only (`/…`, never `//…` or `/\…`); default `/`.
- Every new module is TDD: failing test observed before implementation. `server-only` on server modules.
- No commits: code stays uncommitted for review (repo rule; the user commits).
- Never use `git stash`. Never push. Leave the peer `20260926130000` migration alone.

---

## File Structure

- Create `src/modules/accounts/application/dev-personas.ts` — persona provisioning + link minting against an injected admin client. Owns: role→email map, find-or-create user, membership upsert, callback URL assembly. Knows nothing about HTTP.
- Create `src/modules/accounts/application/dev-personas.test.ts` — fake admin client + fake store; all provisioning behavior.
- Create `src/app/api/dev/login-as/route.ts` — the 404 gate, query validation, 302. Delegates everything else to the provisioner.
- Create `src/app/api/dev/login-as/route.test.ts` — gate, validation, redirect wiring with the provisioner mocked.
- Create `adrs/0073-dev-login-bypass.md` — the safety case, durable record.
- Modify `README.md` (Local setup section) — one "Dev login bypass" paragraph with usage.
- Modify `docs/collaboration/asset-library-and-studio-board.md` — one claim/done line (repo practice).

Verified facts the plan relies on (do not re-derive): effective role resolves from the explicit `organization_memberships` row alone (`private.effective_organization_role` takes the max of explicit + account-derived; no account row means the explicit row wins), so the provisioner creates no account rows. The role-ceiling trigger passes service-role writes because they carry no `auth.uid()`. `organization_memberships` has a unique `(organization_id, user_id)` conflict target (used by `accept_organization_invitation`).

---

### Task 1: Dev persona provisioner

**Files:**
- Create: `src/modules/accounts/application/dev-personas.ts`
- Test: `src/modules/accounts/application/dev-personas.test.ts`

**Interfaces:**
- Consumes: `@supabase/supabase-js` admin API (`listUsers`, `createUser`, `generateLink`), `@/lib/env` (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`), `@/domain` errors (`DomainError`).
- Produces (exact names Task 2 imports):
  - `devPersonaRoleSchema: z.ZodEnum<["owner","admin","operator","viewer"]>`, `DevPersonaRole`
  - `DEV_PERSONA_EMAILS: Record<DevPersonaRole, string>`
  - `DevPersonaAdminClient`, `DevPersonaMembershipStore`, `DevPersonaDependencies` types
  - `createDevPersonaServiceClient(): DevPersonaDependencies` (throws `DomainError` INTEGRATION_ERROR without a service key)
  - `ensureDevPersona(deps, { organizationId: string; role: DevPersonaRole }): Promise<{ userId: string; email: string }>`
  - `mintDevPersonaSignInUrl(deps, { email: string; next: string }): Promise<string>`

- [ ] **Step 1: Write the failing test** — create `src/modules/accounts/application/dev-personas.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DEV_PERSONA_EMAILS,
  ensureDevPersona,
  mintDevPersonaSignInUrl,
  type DevPersonaAdminClient,
  type DevPersonaMembershipStore,
} from "@/modules/accounts/application/dev-personas";

const ORGANIZATION_ID = "2dda45b8-82db-4f5f-b17d-611b9bbb7846";

function fakeAdmin(users: { id: string; email?: string }[] = []) {
  const store = [...users];
  const calls = { created: [] as string[] };
  const admin: DevPersonaAdminClient = {
    listUsers: async () => ({ data: { users: store }, error: null }),
    createUser: async (params: { email: string }) => {
      calls.created.push(params.email);
      const user = { id: `user-for-${params.email}`, email: params.email };
      store.push(user);
      return { data: { user }, error: null };
    },
    generateLink: async () => ({
      data: { properties: { hashed_token: "token-1" } },
      error: null,
    }),
  };
  return { admin, calls };
}

function fakeMemberships() {
  const upserts: { organizationId: string; userId: string; role: string }[] = [];
  const memberships: DevPersonaMembershipStore = {
    upsertMembership: async (input) => {
      upserts.push(input);
    },
  };
  return { memberships, upserts };
}

describe("dev personas", () => {
  it("reuses the existing persona user without creating one", async () => {
    const { admin, calls } = fakeAdmin([{ id: "user-1", email: "dev.owner@lunes.test" }]);
    const { memberships, upserts } = fakeMemberships();

    const persona = await ensureDevPersona(
      { admin, memberships },
      { organizationId: ORGANIZATION_ID, role: "owner" },
    );

    expect(persona).toEqual({ userId: "user-1", email: "dev.owner@lunes.test" });
    expect(calls.created).toEqual([]);
    expect(upserts).toEqual([{ organizationId: ORGANIZATION_ID, userId: "user-1", role: "owner" }]);
  });

  it("creates a confirmed namespaced user when none exists", async () => {
    const created: { email: string; email_confirm: boolean; user_metadata: unknown }[] = [];
    const admin: DevPersonaAdminClient = {
      listUsers: async () => ({ data: { users: [] }, error: null }),
      createUser: (async (params: {
        email: string;
        email_confirm: boolean;
        user_metadata: Record<string, unknown>;
      }) => {
        created.push(params);
        return { data: { user: { id: "user-9", email: params.email } }, error: null };
      }) as DevPersonaAdminClient["createUser"],
      generateLink: async () => ({
        data: { properties: { hashed_token: "token-1" } },
        error: null,
      }),
    };
    const { memberships, upserts } = fakeMemberships();

    const persona = await ensureDevPersona(
      { admin, memberships },
      { organizationId: ORGANIZATION_ID, role: "viewer" },
    );

    expect(persona).toEqual({ userId: "user-9", email: "dev.viewer@lunes.test" });
    expect(created).toEqual([
      { email: "dev.viewer@lunes.test", email_confirm: true, user_metadata: { dev_persona: true } },
    ]);
    expect(upserts).toEqual([{ organizationId: ORGANIZATION_ID, userId: "user-9", role: "viewer" }]);
  });

  it("mints a callback URL carrying only the token", async () => {
    const { admin } = fakeAdmin();
    const { memberships } = fakeMemberships();

    const url = await mintDevPersonaSignInUrl(
      { admin, memberships },
      { email: DEV_PERSONA_EMAILS.operator, next: "/organizations/abc/settings" },
    );

    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/auth/callback");
    expect(parsed.searchParams.get("token_hash")).toBe("token-1");
    expect(parsed.searchParams.get("type")).toBe("magiclink");
    expect(parsed.searchParams.get("next")).toBe("/organizations/abc/settings");
    expect(url).not.toContain("dev.operator@lunes.test");
  });

  it("fails closed when the user list cannot be read", async () => {
    const admin: DevPersonaAdminClient = {
      listUsers: async () => ({ data: null, error: { message: "down" } }),
      createUser: vi.fn() as unknown as DevPersonaAdminClient["createUser"],
      generateLink: vi.fn() as unknown as DevPersonaAdminClient["generateLink"],
    };
    const { memberships } = fakeMemberships();

    await expect(
      ensureDevPersona({ admin, memberships }, { organizationId: ORGANIZATION_ID, role: "owner" }),
    ).rejects.toThrow();
    expect(admin.createUser).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/modules/accounts/application/dev-personas.test.ts`
Expected: FAIL — collection error, module `@/modules/accounts/application/dev-personas` does not exist.

- [ ] **Step 3: Write minimal implementation** — create `src/modules/accounts/application/dev-personas.ts`:

```ts
import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { env } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Test personas for local development sign-in (ADR 0073).
 *
 * One namespaced user per role, provisioned on demand through the dev-only
 * login route. Nothing here is reachable outside `pnpm dev`: the route 404s,
 * and this module has no other importer. Provisioning touches only
 * `dev.*@lunes.test` users and their membership rows — it never lists real
 * users to a caller and never alters them.
 */

export const devPersonaRoleSchema = z.enum(["owner", "admin", "operator", "viewer"]);
export type DevPersonaRole = z.infer<typeof devPersonaRoleSchema>;

export const DEV_PERSONA_EMAILS: Record<DevPersonaRole, string> = {
  owner: "dev.owner@lunes.test",
  admin: "dev.admin@lunes.test",
  operator: "dev.operator@lunes.test",
  viewer: "dev.viewer@lunes.test",
};

export type DevPersonaAdminClient = {
  listUsers(params: {
    page: number;
    perPage: number;
  }): Promise<{
    data: { users: { id: string; email?: string }[] } | null;
    error: { message: string } | null;
  }>;
  createUser(params: {
    email: string;
    email_confirm: boolean;
    user_metadata: Record<string, unknown>;
  }): Promise<{ data: { user: { id: string } | null } | null; error: { message: string } | null }>;
  generateLink(params: {
    type: "magiclink";
    email: string;
    options: { redirectTo: string };
  }): Promise<{
    data: { properties: { hashed_token: string | null } | null } | null;
    error: { message: string } | null;
  }>;
};

export type DevPersonaMembershipStore = {
  upsertMembership(input: {
    organizationId: string;
    userId: string;
    role: DevPersonaRole;
  }): Promise<void>;
};

export type DevPersonaDependencies = {
  admin: DevPersonaAdminClient;
  memberships: DevPersonaMembershipStore;
};

/** Only ever constructed on the server: it holds the service-role key. */
export function createDevPersonaServiceClient(): DevPersonaDependencies {
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    throw new DomainError(
      "INTEGRATION_ERROR",
      "Dev personas cannot be provisioned without a service role key.",
    );
  const client = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return {
    admin: {
      listUsers: (params) => client.auth.admin.listUsers(params),
      createUser: (params) => client.auth.admin.createUser(params),
      generateLink: (params) => client.auth.admin.generateLink(params),
    },
    memberships: {
      upsertMembership: async (input) => {
        // Service-role write, so no auth.uid: the role-ceiling trigger passes
        // system paths through, and RLS is bypassed. Dev-only caller.
        const { error } = await client.from("organization_memberships").upsert(
          {
            organization_id: input.organizationId,
            user_id: input.userId,
            role: input.role,
          },
          { onConflict: "organization_id,user_id" },
        );
        if (error)
          throw new DomainError("INTEGRATION_ERROR", "The dev persona membership could not be saved.");
      },
    },
  };
}

async function findDevUserId(admin: DevPersonaAdminClient, email: string): Promise<string | null> {
  // listUsers has no address filter; staging holds a handful of users, so a
  // bounded scan terminates fast. Five pages of a hundred is the backstop, not
  // the expectation.
  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: 100 });
    if (error) throw new DomainError("INTEGRATION_ERROR", "Dev personas could not be listed.");
    const users = data?.users ?? [];
    const found = users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found.id;
    if (users.length < 100) return null;
  }
  throw new DomainError("INTEGRATION_ERROR", "Dev personas could not be listed.");
}

export async function ensureDevPersona(
  deps: DevPersonaDependencies,
  input: { organizationId: string; role: DevPersonaRole },
): Promise<{ userId: string; email: string }> {
  const email = DEV_PERSONA_EMAILS[input.role];
  let userId = await findDevUserId(deps.admin, email);
  if (!userId) {
    const { data, error } = await deps.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { dev_persona: true },
    });
    if (error || !data?.user?.id)
      throw new DomainError("INTEGRATION_ERROR", "The dev persona could not be created.");
    userId = data.user.id;
  }
  // Exactly this role, every time: re-picking a persona converges rather
  // than multiplying rows, and a persona never drifts from its name.
  await deps.memberships.upsertMembership({ organizationId: input.organizationId, userId, role: input.role });
  return { userId, email };
}

export async function mintDevPersonaSignInUrl(
  deps: Pick<DevPersonaDependencies, "admin">,
  input: { email: string; next: string },
): Promise<string> {
  // generateLink mints a token and sends nothing. The address never leaves
  // the server: only the token travels, in the redirect the route returns.
  const { data, error } = await deps.admin.generateLink({
    type: "magiclink",
    email: input.email,
    options: {
      redirectTo: new URL(
        `/auth/callback?next=${encodeURIComponent(input.next)}`,
        env.NEXT_PUBLIC_APP_URL,
      ).toString(),
    },
  });
  const token = data?.properties?.hashed_token;
  if (error || !token)
    throw new DomainError("INTEGRATION_ERROR", "The dev sign-in link could not be minted.");
  // Assembled like mintInvitationSignInUrl: our own callback verifies the
  // token, so this never depends on Supabase's redirect allowlist.
  const url = new URL("/auth/callback", env.NEXT_PUBLIC_APP_URL);
  url.searchParams.set("token_hash", token);
  url.searchParams.set("type", "magiclink");
  url.searchParams.set("next", input.next);
  return url.toString();
}
```

Note: if `organization_memberships` is absent from `database.types.ts`, use the established structural cast (`client as unknown as { from(table: string): … }`, see `src/trigger/memory.ts` `structuralRpcClient`) instead of the typed call. Do not hand-add types beyond what the drift test requires.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/modules/accounts/application/dev-personas.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Report, do not commit** — leave the new files uncommitted for review.

---

### Task 2: Dev login route

**Files:**
- Create: `src/app/api/dev/login-as/route.ts`
- Test: `src/app/api/dev/login-as/route.test.ts`

**Interfaces:**
- Consumes (from Task 1, exact names): `createDevPersonaServiceClient`, `devPersonaRoleSchema`, `ensureDevPersona`, `mintDevPersonaSignInUrl`, type `DevPersonaRole`.
- Produces: `GET(request: Request): Promise<Response>` — 404 unless development; 400 on bad `org`/`role`; 302 to `/auth/callback?token_hash=…&type=magiclink&next=…` on success.

- [ ] **Step 1: Write the failing test** — create `src/app/api/dev/login-as/route.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// @/lib/env throws at import without Supabase vars under vitest (importOriginal loads it); same mock as Task 1's test.
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.example.com" } }));

const mocks = vi.hoisted(() => ({
  ensureDevPersona: vi.fn(),
  mintDevPersonaSignInUrl: vi.fn(),
  createDevPersonaServiceClient: vi.fn(),
}));

vi.mock("@/modules/accounts/application/dev-personas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/accounts/application/dev-personas")>();
  return {
    ...actual,
    ensureDevPersona: mocks.ensureDevPersona,
    mintDevPersonaSignInUrl: mocks.mintDevPersonaSignInUrl,
    createDevPersonaServiceClient: mocks.createDevPersonaServiceClient,
  };
});

import { GET as devLoginAs } from "@/app/api/dev/login-as/route";

const ORGANIZATION_ID = "2dda45b8-82db-4f5f-b17d-611b9bbb7846";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function loginRequest(query: string) {
  return new Request(`http://localhost/api/dev/login-as${query}`, { method: "GET" });
}

describe("dev login-as route", () => {
  it("404s outside development without touching provisioning", async () => {
    // Vitest runs with NODE_ENV=test: the production posture.
    const response = await devLoginAs(loginRequest(`?org=${ORGANIZATION_ID}&role=owner`));

    expect(response.status).toBe(404);
    expect(mocks.createDevPersonaServiceClient).not.toHaveBeenCalled();
    expect(mocks.ensureDevPersona).not.toHaveBeenCalled();
  });

  it("redirects through the real callback in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.createDevPersonaServiceClient.mockReturnValue({ service: true });
    mocks.ensureDevPersona.mockResolvedValue({ userId: "user-1", email: "dev.owner@lunes.test" });
    mocks.mintDevPersonaSignInUrl.mockResolvedValue(
      "http://localhost:3000/auth/callback?token_hash=token-1&type=magiclink&next=%2F",
    );

    const response = await devLoginAs(loginRequest(`?org=${ORGANIZATION_ID}&role=owner`));

    expect(response.status).toBe(302);
    expect(mocks.ensureDevPersona).toHaveBeenCalledWith(
      { service: true },
      { organizationId: ORGANIZATION_ID, role: "owner" },
    );
    const location = response.headers.get("location") ?? "";
    expect(new URL(location).pathname).toBe("/auth/callback");
    expect(new URL(location).searchParams.get("token_hash")).toBe("token-1");
  });

  it("refuses a bad org or role without provisioning", async () => {
    vi.stubEnv("NODE_ENV", "development");

    for (const query of [`?org=not-a-uuid&role=owner`, `?org=${ORGANIZATION_ID}&role=superadmin`, `?org=${ORGANIZATION_ID}`]) {
      const response = await devLoginAs(loginRequest(query));
      expect(response.status).toBe(400);
    }
    expect(mocks.ensureDevPersona).not.toHaveBeenCalled();
  });

  it("refuses an off-site next path", async () => {
    vi.stubEnv("NODE_ENV", "development");
    mocks.createDevPersonaServiceClient.mockReturnValue({ service: true });
    mocks.ensureDevPersona.mockResolvedValue({ userId: "user-1", email: "dev.owner@lunes.test" });
    mocks.mintDevPersonaSignInUrl.mockResolvedValue("http://localhost:3000/auth/callback");

    await devLoginAs(loginRequest(`?org=${ORGANIZATION_ID}&role=owner&next=https%3A%2F%2Fevil.example`));

    expect(mocks.mintDevPersonaSignInUrl).toHaveBeenCalledWith(
      { service: true },
      expect.objectContaining({ next: "/" }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/app/api/dev/login-as/route.test.ts`
Expected: FAIL — collection error, module `@/app/api/dev/login-as/route` does not exist.

- [ ] **Step 3: Write minimal implementation** — create `src/app/api/dev/login-as/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createDevPersonaServiceClient,
  devPersonaRoleSchema,
  ensureDevPersona,
  mintDevPersonaSignInUrl,
} from "@/modules/accounts/application/dev-personas";

/**
 * Local-development sign-in as a test persona (ADR 0073).
 *
 * The gate is the whole safety case: anything but `pnpm dev` gets a 404
 * before any other code runs, and no override flag exists. Past the gate the
 * route provisions the namespaced persona and redirects through the real
 * `/auth/callback`, so the session in the browser is genuine — RLS, role
 * gates, and audit all behave exactly like production.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found." } }, { status: 404 });
  }
  const url = new URL(request.url);
  const parsed = z
    .object({ org: z.string().uuid(), role: devPersonaRoleSchema })
    .safeParse({ org: url.searchParams.get("org"), role: url.searchParams.get("role") });
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "org must be a UUID and role one of owner, admin, operator, viewer.",
        },
      },
      { status: 400 },
    );
  }
  const deps = createDevPersonaServiceClient();
  const persona = await ensureDevPersona(deps, {
    organizationId: parsed.data.org,
    role: parsed.data.role,
  });
  const signInUrl = await mintDevPersonaSignInUrl(deps, {
    email: persona.email,
    next: safeNextPath(url.searchParams.get("next")),
  });
  // Explicit 302: NextResponse.redirect defaults to 307, and the spec promises 302.
  return NextResponse.redirect(signInUrl, 302);
}

/**
 * Only a same-origin path is an acceptable destination. Mirrors the callback's
 * own rule: `next` is attacker-influenced by construction, and `//evil` /
 * `/\evil` are protocol-relative despite starting with a slash.
 */
function safeNextPath(candidate: string | null): string {
  if (!candidate) return "/";
  if (!candidate.startsWith("/")) return "/";
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return "/";
  return candidate;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/app/api/dev/login-as/route.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Report, do not commit** — leave the new files uncommitted for review.

---

### Task 3: ADR and docs

**Files:**
- Create: `adrs/0073-dev-login-bypass.md`
- Modify: `README.md` (append a "Dev login bypass" paragraph at the end of the "Local setup" section, after the Quality checks block)
- Modify: `docs/collaboration/asset-library-and-studio-board.md` (prepend one `<!-- … DONE … -->` line in the established format)

**Interfaces:**
- Consumes: the spec (`docs/superpowers/specs/2026-09-27-dev-login-bypass-design.md`), Tasks 1–2 file paths.
- Produces: durable records only. No code.

- [ ] **Step 1: Write the ADR** — create `adrs/0073-dev-login-bypass.md` with this content (titles and quotes verbatim):

```markdown
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
```

- [ ] **Step 2: Add the README paragraph** — append after the Quality checks block in the "Local setup" section:

```markdown
### Dev login bypass

`pnpm dev` only — this route 404s anywhere else. Sign the browser in as a test
persona (provisioned on first use) by opening:

```text
http://localhost:3000/api/dev/login-as?org=2dda45b8-82db-4f5f-b17d-611b9bbb7846&role=viewer&next=/organizations/2dda45b8-82db-4f5f-b17d-611b9bbb7846/settings
```

`role` is one of `owner`, `admin`, `operator`, `viewer`; `next` is an
optional same-origin path (default `/`). Personas are namespaced
`dev.<role>@lunes.test` users with exactly that role's membership — reusing
them never multiplies rows.
```

- [ ] **Step 3: Add the board line** — prepend one HTML-comment line at the top of `docs/collaboration/asset-library-and-studio-board.md` recording DONE with files touched, gates, and no stash/push (mirror the neighboring lines' shape).

- [ ] **Step 4: Verify the docs render** — run `pnpm prettier --check adrs/0073-dev-login-bypass.md README.md docs/collaboration/asset-library-and-studio-board.md`. Expected: all clean (if Prettier flags the board file for pre-existing reasons, leave it and note it; do not reformat other lines).

- [ ] **Step 5: Report, do not commit** — leave everything uncommitted for review.

---

### Task 4: Live verification and gates

**Files:** none (verification only).

**Interfaces:**
- Consumes: Tasks 1–3 outputs, dev server on the port `NEXT_PUBLIC_APP_URL` names (default `http://localhost:3000`; if port 3000 is taken by another session's process, run `NEXT_PUBLIC_APP_URL=http://localhost:<free> pnpm dev --port <free>` instead — never stop someone else's process).

- [ ] **Step 1: Start the dev server detached**

Run: `setsid -f pnpm dev --port 3000 </dev/null >>/tmp/dev-login-bypass-dev.log 2>&1` (Linux only; if `setsid` is unavailable, stop and ask).
Expected: server answers on port 3000 within ~60s.

- [ ] **Step 2: Prove the 302 and the gate with curl**

Run (no `-L`, so the redirect itself is the evidence):
`curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "http://localhost:3000/api/dev/login-as?org=2dda45b8-82db-4f5f-b17d-611b9bbb7846&role=viewer&next=/"`
Expected: `302` with a `Location` starting `http://localhost:3000/auth/callback?token_hash=` and containing `type=magiclink`.
Run: same URL with `role=superadmin`.
Expected: `400`. (The 404-outside-development case is covered by unit test; a production build check is out of scope for this task.)

- [ ] **Step 3: Prove all three roles in a real browser**

Drive the browser (chrome-devtools) for `role` in `owner`, `operator`, `viewer`: navigate to the login-as URL with `next=/organizations/2dda45b8-82db-4f5f-b17d-611b9bbb7846/settings`, then read `/api/organizations/2dda45b8-82db-4f5f-b17d-611b9bbb7846/session` and assert the returned `role` matches. Open the Settings → Memory tab per role and screenshot: owner shows enabled switches, operator and viewer show the read-only note. If any role mismatches, stop: the slice is not done.

- [ ] **Step 4: Run the full gates**

Run, in order, all must be clean:
`pnpm vitest run src/modules/accounts/application/dev-personas.test.ts src/app/api/dev/login-as/route.test.ts`
`pnpm typecheck`
`pnpm eslint src/modules/accounts/application/dev-personas.ts src/modules/accounts/application/dev-personas.test.ts src/app/api/dev/login-as/route.ts src/app/api/dev/login-as/route.test.ts`
`pnpm prettier --check` on the same four files plus `adrs/0073-dev-login-bypass.md` and `README.md`
Expected: tests green, typecheck exit 0, eslint 0 errors, prettier clean.

- [ ] **Step 5: Stop the dev server you started** — kill only your own server process (the one from Step 1), verify the port is closed, and report. Do not commit anything.
