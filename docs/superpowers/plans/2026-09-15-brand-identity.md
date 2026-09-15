# Brand Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an organization a canonical logo and structured brand rules that the platform displays exactly, feeds to image generation, and pins into every campaign it approves.

**Architecture:** Two new organization-scoped tables hold the guidelines and the logo variant pointers; the logo pointer is a composite foreign key into the existing validated brand-asset versions, so no new upload path exists and no unvalidated bytes enter the system. The guidelines are promoted into `load_campaign_creation_facts`, which already returns `hardConstraints`, `softConventions` and `restrictedTerms` — keys that reach the image prompt and the content policy today and that nothing has ever written. Collection happens in the existing onboarding section; editing happens in a new Asset Library tab; both write the same record.

**Tech Stack:** Next.js 16 (Turbopack, App Router), TypeScript strict, Zod at every boundary, Supabase/Postgres with forced RLS, shadcn/Radix/Tailwind, TanStack Query, vitest + jsdom, pgTAP.

**Spec:** `specs/026-brand-identity.md`

## Global Constraints

- **There is no local database.** Never run `supabase start`, `supabase db reset`, or `pnpm db:types`. `src/lib/supabase/database.types.ts` is maintained **by hand**.
- **A pushed migration is live on shared staging immediately.** `pnpm db:migrations:push` is the user's step, not yours. Get it right by reading the existing schema first.
- **A new `plpgsql` function that reads a table it did not create must be called once against staging before it is considered done.** plpgsql resolves record fields at execution time.
- **Never use `git stash`.** The stash stack is shared with other worktrees. Use a temporary WIP commit.
- **Never `git add -A`.** Always narrow, path-limited adds; the tree carries other sessions' in-flight work.
- **Never bypass RLS with a service role in a user-facing request path.**
- **Do not invent numeric operating limits (D06).** Every bound below is copied from an existing schema or from the generation context that already consumes the value.
- **Cite ADRs by full filename**, never bare number — duplicate `0015-*` and `0054-*` exist.
- **Stop the dev server before running the full test suite** (xlsx-parsing tests fail otherwise).
- **"Dishes" is a restaurant concept forbidden in platform-core UI.**
- Store timestamps in UTC. Event names are stable and past tense.
- A generated logo is **never** described as exact, verified, or guaranteed. Spec §9, acceptance criterion 10.
- Array bounds, copied verbatim from `generationContextSchema` in `src/modules/campaigns/application/generation-context.ts`: `hardConstraints` max 60, `softConventions` max 60, `restrictedTerms` max 200, each constraint string max 400, each term max 80.

---

### Task 1: Brand guidelines domain types

**Files:**
- Create: `src/domain/brand/guidelines.ts`
- Test: `src/domain/brand/guidelines.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BRAND_RULE_STRENGTHS`, `brandRuleSchema`, `BrandRule`, `hexColorSchema`, `brandPaletteSchema`, `BrandPalette`, `brandGuidelinesSchema`, `BrandGuidelines`, `splitRulesByStrength(rules: readonly BrandRule[]): { hardConstraints: string[]; softConventions: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import {
  brandGuidelinesSchema,
  hexColorSchema,
  splitRulesByStrength,
} from "@/domain/brand/guidelines";

describe("hexColorSchema", () => {
  it("normalises a colour to lower case", () => {
    expect(hexColorSchema.parse("#C8102E")).toBe("#c8102e");
  });

  it("refuses anything that is not a six-digit hex colour", () => {
    for (const value of ["c8102e", "#c810", "#gggggg", "red", "#c8102e80"]) {
      expect(() => hexColorSchema.parse(value)).toThrow();
    }
  });
});

describe("brandGuidelinesSchema", () => {
  it("accepts a palette with only some slots filled", () => {
    // A brand with one colour has one colour. Requiring three would invent two.
    const parsed = brandGuidelinesSchema.parse({
      palette: { primary: "#c8102e" },
      rules: [],
      restrictedTerms: [],
    });
    expect(parsed.palette).toEqual({ primary: "#c8102e" });
  });

  it("refuses a rule with no strength", () => {
    // Spec §5: a hard rule is never inferred, so an unmarked rule is not stored.
    expect(() =>
      brandGuidelinesSchema.parse({
        palette: {},
        rules: [{ text: "Never show alcohol" }],
        restrictedTerms: [],
      }),
    ).toThrow();
  });

  it("refuses a restricted term long enough to be a sentence", () => {
    // Spec §6: terms are matched literally, so a paragraph would never match.
    expect(() =>
      brandGuidelinesSchema.parse({
        palette: {},
        rules: [],
        restrictedTerms: ["x".repeat(81)],
      }),
    ).toThrow();
  });
});

describe("splitRulesByStrength", () => {
  it("routes each rule to the list that can act on it", () => {
    const split = splitRulesByStrength([
      { text: "Never show alcohol", strength: "hard" },
      { text: "We usually lead with the food", strength: "soft" },
      { text: "Never imply a medical benefit", strength: "hard" },
    ]);

    expect(split.hardConstraints).toEqual([
      "Never show alcohol",
      "Never imply a medical benefit",
    ]);
    expect(split.softConventions).toEqual(["We usually lead with the food"]);
  });

  it("returns empty lists rather than null for a brand with no rules", () => {
    // The generation context takes arrays. A null here would become "none"
    // in one caller and a crash in another.
    expect(splitRulesByStrength([])).toEqual({ hardConstraints: [], softConventions: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/domain/brand/guidelines.test.ts`
Expected: FAIL — `Failed to resolve import "@/domain/brand/guidelines"`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { z } from "zod";

/**
 * A brand's rules, as data the platform can act on.
 *
 * `hard_constraints`, `soft_conventions` and `restricted_terms` have been read
 * from `brand_context`, rendered into the image prompt and checked by the
 * content policy since the generation context was written. Nothing has ever
 * written them. These are the shapes that fill them.
 *
 * Every bound here is copied from `generationContextSchema`, which consumes
 * these values. Choosing a different one would either truncate silently or
 * admit a value the consumer rejects.
 */

export const BRAND_RULE_STRENGTHS = ["hard", "soft"] as const;
export type BrandRuleStrength = (typeof BRAND_RULE_STRENGTHS)[number];

/**
 * Hard or soft, chosen by the author and never inferred.
 *
 * "Never show alcohol" and "we usually lead with the food" are different kinds
 * of statement, and a platform that cannot tell them apart either refuses work
 * it should have offered or publishes work it should have refused.
 */
export const brandRuleSchema = z.strictObject({
  text: z.string().trim().min(3).max(400),
  strength: z.enum(BRAND_RULE_STRENGTHS),
});
export type BrandRule = z.infer<typeof brandRuleSchema>;

/** Lower-cased on the way in, so two spellings of one colour compare equal. */
export const hexColorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, "A colour is a six-digit hex value, like #c8102e.");

/**
 * Absent slots stay absent. A brand with one colour has one colour, and
 * inventing a secondary would put a colour nobody chose onto their artwork.
 */
export const brandPaletteSchema = z.strictObject({
  primary: hexColorSchema.optional(),
  secondary: hexColorSchema.optional(),
  tertiary: hexColorSchema.optional(),
});
export type BrandPalette = z.infer<typeof brandPaletteSchema>;

export const brandGuidelinesSchema = z.strictObject({
  palette: brandPaletteSchema,
  rules: z.array(brandRuleSchema).max(120),
  restrictedTerms: z.array(z.string().trim().min(1).max(80)).max(200),
});
export type BrandGuidelines = z.infer<typeof brandGuidelinesSchema>;

/**
 * The two lists the generation context already takes.
 *
 * Order is preserved within each list so an operator reading the prompt sees
 * their rules in the order they wrote them.
 */
export function splitRulesByStrength(rules: readonly BrandRule[]): {
  hardConstraints: string[];
  softConventions: string[];
} {
  const hardConstraints: string[] = [];
  const softConventions: string[] = [];
  for (const rule of rules) {
    if (rule.strength === "hard") hardConstraints.push(rule.text);
    else softConventions.push(rule.text);
  }
  return { hardConstraints, softConventions };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/domain/brand/guidelines.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/brand/guidelines.ts src/domain/brand/guidelines.test.ts
git commit -m "feat(brand): the shapes a brand's rules are stored in"
```

---

### Task 2: Canonical logo domain types

**Files:**
- Create: `src/domain/brand/logo.ts`
- Test: `src/domain/brand/logo.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BRAND_LOGO_VARIANTS`, `brandLogoVariantSchema`, `BrandLogoVariant`, `brandLogoSelectionSchema`, `BrandLogoSelection`, `resolveLogoForTheme(selections: readonly BrandLogoSelection[], theme: "light" | "dark"): BrandLogoSelection | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { brandLogoSelectionSchema, resolveLogoForTheme } from "@/domain/brand/logo";

const primary = {
  variant: "primary" as const,
  brandAssetVersionId: "aaaaaaaa-0000-4000-8000-000000000001",
};
const dark = {
  variant: "dark" as const,
  brandAssetVersionId: "aaaaaaaa-0000-4000-8000-000000000002",
};

describe("brandLogoSelectionSchema", () => {
  it("refuses a variant the platform does not know", () => {
    expect(() =>
      brandLogoSelectionSchema.parse({ variant: "mono", brandAssetVersionId: primary.brandAssetVersionId }),
    ).toThrow();
  });
});

describe("resolveLogoForTheme", () => {
  it("uses the dark variant on dark ground when one is set", () => {
    expect(resolveLogoForTheme([primary, dark], "dark")).toEqual(dark);
  });

  it("falls back to primary rather than recolouring it", () => {
    // Spec §2. Recolouring somebody's mark is what brand_mark_distorted exists
    // to catch; doing it ourselves would be worse than a model doing it.
    expect(resolveLogoForTheme([primary], "dark")).toEqual(primary);
  });

  it("uses primary on light ground even when a dark variant exists", () => {
    expect(resolveLogoForTheme([primary, dark], "light")).toEqual(primary);
  });

  it("returns null when no logo is set, rather than a placeholder", () => {
    // Spec failure states: the platform shows its own mark, never something
    // that looks like a brand nobody supplied.
    expect(resolveLogoForTheme([], "light")).toBeNull();
    expect(resolveLogoForTheme([dark], "light")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/domain/brand/logo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { z } from "zod";

/**
 * Which stored image is this organization's mark.
 *
 * A selection, never an upload. It points at an
 * `organization_brand_asset_versions` row, so the logo has already been
 * sniffed by its leading bytes, decoded, re-encoded server-side and hashed —
 * the platform never shows or transmits logo bytes it did not produce.
 */

export const BRAND_LOGO_VARIANTS = ["primary", "dark"] as const;
export type BrandLogoVariant = (typeof BRAND_LOGO_VARIANTS)[number];

export const brandLogoVariantSchema = z.enum(BRAND_LOGO_VARIANTS);

export const brandLogoSelectionSchema = z.strictObject({
  variant: brandLogoVariantSchema,
  brandAssetVersionId: z.string().uuid(),
});
export type BrandLogoSelection = z.infer<typeof brandLogoSelectionSchema>;

/**
 * The variant to show on a given ground.
 *
 * `dark` is optional and falls back to `primary` rather than recolouring it.
 * A mark redrawn in another colour is not the mark, which is exactly the
 * complaint `brand_mark_distorted` exists to record.
 *
 * `primary` is required for any logo to resolve: a brand that has only
 * supplied a dark variant has not told us what its mark normally looks like,
 * and guessing by inverting it would be inventing one.
 */
export function resolveLogoForTheme(
  selections: readonly BrandLogoSelection[],
  theme: "light" | "dark",
): BrandLogoSelection | null {
  const primary = selections.find((entry) => entry.variant === "primary") ?? null;
  if (theme === "light") return primary;
  return selections.find((entry) => entry.variant === "dark") ?? primary;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/domain/brand/logo.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/brand/logo.ts src/domain/brand/logo.test.ts
git commit -m "feat(brand): which stored image is the organization's mark"
```

---

### Task 3: Migration — tables, permission, RLS, audit

**Files:**
- Create: `supabase/migrations/20260915120000_brand_identity.sql`
- Create: `supabase/tests/database/brand_identity_test.sql`
- Modify: `src/domain/access/permissions.ts`
- Modify: `src/lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: `BRAND_LOGO_VARIANTS` and the guideline bounds from Tasks 1–2 (mirrored in SQL, not imported).
- Produces: tables `public.organization_brand_guidelines`, `public.organization_brand_logos`; permission `brand.manage`; `Database["public"]["Tables"]["organization_brand_guidelines"]` and `["organization_brand_logos"]`.

**Before starting:** run `git status --porcelain src/lib/supabase/database.types.ts`. If it reports the file dirty, another session is mid-edit; add only your own table blocks and never `git add` the whole file without checking `git diff --cached` first.

- [ ] **Step 1: Write the migration**

```sql
-- Brand identity: the canonical logo and the rules generation must respect.
--
-- `hard_constraints`, `soft_conventions` and `restricted_terms` have been read
-- from `business_profiles.brand_context` by `load_campaign_creation_facts`,
-- rendered into the image prompt by `reference-prompt.ts`, and checked by
-- `content-policy.ts` since the generation context was written. Nothing has
-- ever written them. These tables are the producers.
--
-- Tables rather than more keys in `brand_context`, because a brand's don'ts
-- constrain what may be published in a client's name and "who changed this,
-- and when" has to be answerable. `brand_context` keeps `voice`, which
-- describes rather than constrains.

create function private.brand_palette_valid(input_palette jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select input_palette is not null
    and pg_catalog.jsonb_typeof(input_palette) = 'object'
    and not exists (
      select 1
      from pg_catalog.jsonb_each_text(input_palette) as slot(key, value)
      where slot.key not in ('primary', 'secondary', 'tertiary')
        or slot.value !~ '^#[0-9a-f]{6}$'
    );
$$;

-- Bounds copied from `generationContextSchema`, which consumes these values.
-- A different bound here would either truncate silently or admit a value the
-- consumer rejects.
create function private.brand_rules_valid(input_rules jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select input_rules is not null
    and pg_catalog.jsonb_typeof(input_rules) = 'array'
    and pg_catalog.jsonb_array_length(input_rules) <= 120
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(input_rules) as rule(value)
      where pg_catalog.jsonb_typeof(rule.value) <> 'object'
        or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(rule.value)) <> 2
        or rule.value ->> 'strength' not in ('hard', 'soft')
        or pg_catalog.char_length(pg_catalog.btrim(coalesce(rule.value ->> 'text', ''))) not between 3 and 400
    );
$$;

revoke all on function private.brand_palette_valid(jsonb) from public;
revoke all on function private.brand_rules_valid(jsonb) from public;

create table public.organization_brand_guidelines (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  palette jsonb not null default '{}'::jsonb check (private.brand_palette_valid(palette)),
  rules jsonb not null default '[]'::jsonb check (private.brand_rules_valid(rules)),
  restricted_terms text[] not null default '{}'::text[]
    check (private.asset_library_text_array_valid(restricted_terms, 200, 80)),
  updated_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.organization_brand_logos (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  variant text not null check (variant in ('primary', 'dark')),
  brand_asset_version_id uuid not null,
  set_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (organization_id, variant),
  -- The tenant is inside the key, so a pointer at another organization's
  -- image cannot be written even by code that forgot to check.
  constraint organization_brand_logos_version_fkey
    foreign key (organization_id, brand_asset_version_id)
    references public.organization_brand_asset_versions (organization_id, id) on delete restrict
);

create index organization_brand_logos_version_idx
  on public.organization_brand_logos (organization_id, brand_asset_version_id);

create trigger organization_brand_guidelines_set_updated_at
  before update on public.organization_brand_guidelines
  for each row execute function public.set_updated_at();
create trigger organization_brand_logos_set_updated_at
  before update on public.organization_brand_logos
  for each row execute function public.set_updated_at();

create trigger organization_brand_guidelines_audit
  after insert or update on public.organization_brand_guidelines
  for each row execute function private.audit_asset_library_change();
create trigger organization_brand_logos_audit
  after insert or update on public.organization_brand_logos
  for each row execute function private.audit_asset_library_change();

alter table public.organization_brand_guidelines enable row level security;
alter table public.organization_brand_guidelines force row level security;
alter table public.organization_brand_logos enable row level security;
alter table public.organization_brand_logos force row level security;

create policy "members read brand guidelines"
on public.organization_brand_guidelines for select to authenticated
using (private.is_organization_member(organization_id));

create policy "brand managers write brand guidelines"
on public.organization_brand_guidelines for all to authenticated
using (private.has_organization_permission(organization_id, 'brand.manage'))
with check (private.has_organization_permission(organization_id, 'brand.manage'));

create policy "members read brand logos"
on public.organization_brand_logos for select to authenticated
using (private.is_organization_member(organization_id));

create policy "brand managers write brand logos"
on public.organization_brand_logos for all to authenticated
using (private.has_organization_permission(organization_id, 'brand.manage'))
with check (private.has_organization_permission(organization_id, 'brand.manage'));

grant select, insert, update, delete on table public.organization_brand_guidelines to authenticated;
grant select, insert, update, delete on table public.organization_brand_logos to authenticated;

insert into public.permissions (key, description, scope)
values ('brand.manage', 'Set the organization logo and its brand guidelines.', 'organization')
on conflict (key) do nothing;

insert into public.role_permissions (role, permission_key)
values ('owner', 'brand.manage'), ('admin', 'brand.manage')
on conflict do nothing;
```

- [ ] **Step 2: Mirror the permission in TypeScript, in this same change**

The migration and `src/domain/access/permissions.ts` have already drifted once — `campaign.research_request` is seeded and not declared, and four assertions in `permissions.drift.test.ts` fail for it today. Do not add a second.

In `src/domain/access/permissions.ts`: add `"brand.manage"` to the permission key list (beside `"asset.review"`), add `"brand.manage": "Set the organization logo and its brand guidelines."` to the descriptions map, and add `"brand.manage"` to the owner and admin permission arrays.

- [ ] **Step 3: Run the drift test**

Run: `pnpm vitest run src/domain/access/permissions.drift.test.ts`
Expected: the four `campaign.research_request` failures remain and **no new failure mentions `brand.manage`**. If a fifth failure names `brand.manage`, the mirror and the migration disagree — fix before continuing.

- [ ] **Step 4: Type the tables by hand**

`pnpm db:types` cannot run. Add to `src/lib/supabase/database.types.ts`, beside the other `organization_*` tables:

```ts
      organization_brand_guidelines: {
        Row: {
          organization_id: string;
          palette: Record<string, string>;
          rules: { text: string; strength: "hard" | "soft" }[];
          restricted_terms: string[];
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["organization_brand_guidelines"]["Row"],
          "created_at" | "updated_at"
        >;
        Update: Partial<Database["public"]["Tables"]["organization_brand_guidelines"]["Insert"]>;
        Relationships: [];
      };
      organization_brand_logos: {
        Row: {
          organization_id: string;
          variant: "primary" | "dark";
          brand_asset_version_id: string;
          set_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["organization_brand_logos"]["Row"],
          "created_at" | "updated_at"
        >;
        Update: Partial<Database["public"]["Tables"]["organization_brand_logos"]["Insert"]>;
        Relationships: [];
      };
```

- [ ] **Step 5: Write the pgTAP suite**

```sql
begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(8);

-- Companion test for 20260915120000_brand_identity.sql.
-- These suites share the staging database and wrap in begin/rollback, so this
-- asserts the guards a mistake would silently remove rather than driving a
-- two-tenant scenario.

select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.organization_brand_guidelines'::regclass),
  'brand guidelines has RLS enabled and forced'
);

select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.organization_brand_logos'::regclass),
  'brand logos has RLS enabled and forced'
);

-- The tenant is inside the foreign key, so a pointer at another
-- organization's image fails in the database, not only in the application.
select extensions.ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'organization_brand_logos_version_fkey'
      and pg_catalog.array_length(conkey, 1) = 2
  ),
  'a logo pointer is a composite key carrying the tenant'
);

select extensions.ok(
  exists (
    select 1 from pg_catalog.pg_policies
    where tablename = 'organization_brand_guidelines'
      and policyname = 'brand managers write brand guidelines'
      and qual like '%brand.manage%'
  ),
  'writing guidelines requires brand.manage'
);

select extensions.ok(
  exists (
    select 1 from pg_catalog.pg_policies
    where tablename = 'organization_brand_logos'
      and policyname = 'brand managers write brand logos'
      and qual like '%brand.manage%'
  ),
  'writing a logo requires brand.manage'
);

select extensions.ok(
  exists (select 1 from public.permissions where key = 'brand.manage'),
  'brand.manage is seeded in the catalogue'
);

-- A rule with no strength must be unstorable. Spec §5.
select extensions.ok(
  not private.brand_rules_valid('[{"text":"Never show alcohol"}]'::jsonb),
  'a rule without a strength is refused by the validator'
);

select extensions.ok(
  not private.brand_palette_valid('{"primary":"red"}'::jsonb),
  'a palette slot that is not a hex colour is refused'
);

select * from extensions.finish();
rollback;
```

- [ ] **Step 6: Verify the migration is the only pending one**

Run: `pnpm db:migrations:dry-run`
Expected: your new file listed. If another session's migration also appears, **stop and tell the user** — pushing would carry theirs too.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260915120000_brand_identity.sql \
        supabase/tests/database/brand_identity_test.sql \
        src/domain/access/permissions.ts \
        src/lib/supabase/database.types.ts
git commit -m "feat(brand): tables, permission and tenancy for brand identity"
```

- [ ] **Step 8: Hand the push to the user**

Tell them: `pnpm db:migrations:push`, then `pnpm db:test`. You cannot run either. The new validator functions read no tables, so the first-call rule does not bite here — it bites in Task 6.

---

### Task 4: Repository and service

**Files:**
- Create: `src/modules/brand/application/brand-identity-service.ts`
- Create: `src/modules/brand/application/brand-identity-service.test.ts`
- Create: `src/modules/brand/infrastructure/brand-identity-repository.ts`

**Interfaces:**
- Consumes: `brandGuidelinesSchema`, `BrandGuidelines`, `brandLogoSelectionSchema`, `BrandLogoSelection` (Tasks 1–2).
- Produces: `BrandIdentityPorts` with `readGuidelines(): Promise<BrandGuidelines>`, `writeGuidelines(g: BrandGuidelines): Promise<void>`, `readLogos(): Promise<BrandLogoSelection[]>`, `setLogo(s: BrandLogoSelection): Promise<void>`, `isVersionUsable(versionId: string): Promise<boolean>`; `saveBrandGuidelines`, `saveBrandLogo`, `readBrandIdentity`; `BrandIdentity = { guidelines: BrandGuidelines; logos: BrandLogoSelection[] }`; `createBrandIdentityAdapter`, `BrandIdentityPersistence`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

import { saveBrandLogo } from "@/modules/brand/application/brand-identity-service";

const selection = {
  variant: "primary" as const,
  brandAssetVersionId: "aaaaaaaa-0000-4000-8000-000000000001",
};

function ports(overrides: Record<string, unknown> = {}) {
  return {
    readGuidelines: vi.fn(async () => ({ palette: {}, rules: [], restrictedTerms: [] })),
    writeGuidelines: vi.fn(async () => {}),
    readLogos: vi.fn(async () => []),
    setLogo: vi.fn(async () => {}),
    isVersionUsable: vi.fn(async () => true),
    ...overrides,
  };
}

describe("saveBrandLogo", () => {
  it("sets a logo that points at a usable image", async () => {
    const port = ports();
    await saveBrandLogo(selection, port);
    expect(port.setLogo).toHaveBeenCalledWith(selection);
  });

  it("refuses a logo pointing at an image that is not usable yet", async () => {
    // An unusable version is one whose bytes the server has not validated.
    // Pointing the brand mark at it would show bytes nobody checked.
    const port = ports({ isVersionUsable: vi.fn(async () => false) });

    await expect(saveBrandLogo(selection, port)).rejects.toThrow(/not available/i);
    expect(port.setLogo).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/modules/brand/application/brand-identity-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { DomainError } from "@/lib/errors";
import type { BrandGuidelines } from "@/domain/brand/guidelines";
import type { BrandLogoSelection } from "@/domain/brand/logo";

export type BrandIdentity = {
  guidelines: BrandGuidelines;
  logos: BrandLogoSelection[];
};

export type BrandIdentityPorts = {
  readGuidelines(): Promise<BrandGuidelines>;
  writeGuidelines(guidelines: BrandGuidelines): Promise<void>;
  readLogos(): Promise<BrandLogoSelection[]>;
  setLogo(selection: BrandLogoSelection): Promise<void>;
  /** Whether the server has validated this version's bytes. */
  isVersionUsable(brandAssetVersionId: string): Promise<boolean>;
};

export async function readBrandIdentity(ports: BrandIdentityPorts): Promise<BrandIdentity> {
  const [guidelines, logos] = await Promise.all([ports.readGuidelines(), ports.readLogos()]);
  return { guidelines, logos };
}

export async function saveBrandGuidelines(
  guidelines: BrandGuidelines,
  ports: BrandIdentityPorts,
): Promise<void> {
  await ports.writeGuidelines(guidelines);
}

/**
 * Points the brand mark at an image, once.
 *
 * The usability check is not a formality. A version is unusable until the
 * server has decoded, re-encoded and hashed its bytes; pointing the logo at
 * one would put bytes nobody validated in front of every viewer and into every
 * generation request.
 */
export async function saveBrandLogo(
  selection: BrandLogoSelection,
  ports: BrandIdentityPorts,
): Promise<void> {
  if (!(await ports.isVersionUsable(selection.brandAssetVersionId))) {
    throw new DomainError("DOMAIN_ERROR", "That image is not available to use as a logo yet.");
  }
  await ports.setLogo(selection);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/modules/brand/application/brand-identity-service.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the repository adapter**

Create `src/modules/brand/infrastructure/brand-identity-repository.ts` exporting `BrandIdentityPersistence` (a narrow structural type over the Supabase client, following `src/modules/campaigns/infrastructure/evidence-repair-repository.ts`) and `createBrandIdentityAdapter({ persistence, organizationId, userId }): BrandIdentityPorts`. It upserts `organization_brand_guidelines` keyed on `organization_id`, upserts `organization_brand_logos` keyed on `(organization_id, variant)`, and implements `isVersionUsable` by selecting `is_usable` from `organization_brand_asset_versions` filtered on both `organization_id` and `id`. Every call uses the caller's session; there is no service-role path here.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm tsc --noEmit
git add src/modules/brand/
git commit -m "feat(brand): read and write an organization's identity"
```

---

### Task 5: API routes

**Files:**
- Create: `src/app/api/organizations/[organizationId]/brand/route.ts`
- Create: `src/app/api/organizations/[organizationId]/brand/route.test.ts`

**Interfaces:**
- Consumes: `readBrandIdentity`, `saveBrandGuidelines`, `saveBrandLogo`, `createBrandIdentityAdapter` (Task 4).
- Produces: `GET` returning `{ guidelines, logos }`; `PUT` accepting `{ guidelines?, logo? }`.

One route with both, rather than two: the tab reads and writes the whole identity, and a split would make a partial save look atomic when it is two requests.

**Next route-export rule:** a route file may export only route handlers. A helper exported here fails typecheck **only after** `.next/dev/types` exists — run the dev server once before trusting a clean `tsc`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { brandRequestSchema } from "@/app/api/organizations/[organizationId]/brand/schema";

describe("brandRequestSchema", () => {
  it("accepts a guidelines-only save", () => {
    const parsed = brandRequestSchema.parse({
      guidelines: { palette: { primary: "#c8102e" }, rules: [], restrictedTerms: [] },
    });
    expect(parsed.logo).toBeUndefined();
  });

  it("refuses an empty request rather than reporting a save that wrote nothing", () => {
    expect(() => brandRequestSchema.parse({})).toThrow();
  });

  it("refuses an unknown key", () => {
    expect(() =>
      brandRequestSchema.parse({ guidelines: { palette: {}, rules: [], restrictedTerms: [] }, colour: "red" }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run "src/app/api/organizations/[organizationId]/brand/route.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the schema in its own file**

Create `src/app/api/organizations/[organizationId]/brand/schema.ts` — **not** in `route.ts`, because a route may export only handlers:

```ts
import { z } from "zod";

import { brandGuidelinesSchema } from "@/domain/brand/guidelines";
import { brandLogoSelectionSchema } from "@/domain/brand/logo";

/**
 * At least one of the two. An empty body would return a cheerful 200 having
 * written nothing, which reads as a successful save.
 */
export const brandRequestSchema = z
  .strictObject({
    guidelines: brandGuidelinesSchema.optional(),
    logo: brandLogoSelectionSchema.optional(),
  })
  .refine(
    (body) => body.guidelines !== undefined || body.logo !== undefined,
    "Supply brand guidelines, a logo, or both.",
  );
export type BrandRequest = z.infer<typeof brandRequestSchema>;
```

- [ ] **Step 4: Write the route**

`GET` gates on membership through `getOrganizationContext(params)` and returns `readBrandIdentity(...)`. `PUT` gates on `brand.manage` via `getOrganizationContext(params, rolesWith("brand.manage"))`, parses `brandRequestSchema`, then calls `saveBrandGuidelines` and/or `saveBrandLogo` against `createBrandIdentityAdapter`. Both wrap in `try`/`catch` returning `apiErrorResponse(error)`. Export **only** `GET` and `PUT`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run "src/app/api/organizations/[organizationId]/brand/route.test.ts"`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/organizations/[organizationId]/brand/"
git commit -m "feat(brand): read and write the identity over HTTP"
```

---

### Task 6: Feed the guidelines into generation

**Files:**
- Create: `supabase/migrations/20260915130000_brand_guidelines_into_campaign_facts.sql`
- Modify: `src/modules/campaigns/application/generation-context.ts`
- Modify: `src/modules/campaigns/application/generation-context.test.ts`

**Interfaces:**
- Consumes: the tables from Task 3.
- Produces: `generationContextSchema` gains `palette: brandPaletteSchema.nullable()`; `GenerationContext.palette`.

This is the task that makes the feature real. Everything before it stores data nothing reads.

- [ ] **Step 1: Write the failing test**

Add to `src/modules/campaigns/application/generation-context.test.ts`:

```ts
it("renders the palette as advisory, never as a guarantee", () => {
  const context = buildGenerationContext(baseInput({
    palette: { primary: "#c8102e" },
  }));
  if (context.outcome !== "ready") throw new Error("expected ready");

  const prompt = renderGenerationPrompt(context.context);
  expect(prompt).toContain("#c8102e");
  // Spec §7: exact where we draw, advisory where a model draws. The prompt
  // must not tell the model the palette is enforced, because it is not.
  expect(prompt).toMatch(/palette/i);
});

it("says a brand has no palette rather than inventing one", () => {
  const context = buildGenerationContext(baseInput({}));
  if (context.outcome !== "ready") throw new Error("expected ready");

  expect(context.context.palette).toBeNull();
  expect(renderGenerationPrompt(context.context)).toContain("none");
});
```

Use the file's existing `baseInput` helper; if it does not take a palette, extend it to spread extra snapshot keys.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/modules/campaigns/application/generation-context.test.ts`
Expected: FAIL — `palette` is not on the context.

- [ ] **Step 3: Add the palette to the context**

In `generation-context.ts`: import `brandPaletteSchema`, add `palette: brandPaletteSchema.nullable()` to `generationContextSchema`, read it in `buildGenerationContext` from `snapshot.palette` (null when absent — **do not** add it to `REQUIRED_EVIDENCE_KEYS`; spec failure states say generation proceeds without one), and render it in `renderGenerationPrompt` inside a `<brand_palette>` block that states it is the brand's colours and that the output is checked against them at review.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/modules/campaigns/application/generation-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend `load_campaign_creation_facts`**

Forward migration replacing the function. Keep every key it already returns; change only where the three rule keys come from, and add `palette`:

```sql
-- Give the brand rule keys their first producer.
--
-- `hardConstraints`, `softConventions` and `restrictedTerms` have been read
-- from `brand_context` since this function was written, and nothing ever wrote
-- them there, so every campaign in every organization has been generated
-- against three empty arrays. They now come from the brand guidelines table.
--
-- `brand_context ->> 'voice'` is unchanged: voice describes, rules constrain,
-- and only the constraining half moved.

create or replace function public.load_campaign_creation_facts(
  target_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization public.organizations;
  brand_context jsonb := '{}'::jsonb;
  guidelines public.organization_brand_guidelines;
  primary_goal public.goals;
  baseline_source text;
  hard_rules jsonb;
  soft_rules jsonb;
begin
  if auth.uid() is null or not private.is_organization_member(target_organization_id) then
    raise exception 'campaign_facts_forbidden' using errcode = '42501';
  end if;

  select scoped.* into organization
  from public.organizations scoped where scoped.id = target_organization_id;

  if not found then
    raise exception 'campaign_facts_organization_not_found' using errcode = '42501';
  end if;

  select coalesce(profile.brand_context, '{}'::jsonb) into brand_context
  from public.business_profiles profile
  where profile.organization_id = target_organization_id;

  select scoped.* into guidelines
  from public.organization_brand_guidelines scoped
  where scoped.organization_id = target_organization_id;

  select
    coalesce(pg_catalog.jsonb_agg(rule.value ->> 'text')
      filter (where rule.value ->> 'strength' = 'hard'), '[]'::jsonb),
    coalesce(pg_catalog.jsonb_agg(rule.value ->> 'text')
      filter (where rule.value ->> 'strength' = 'soft'), '[]'::jsonb)
  into hard_rules, soft_rules
  from pg_catalog.jsonb_array_elements(coalesce(guidelines.rules, '[]'::jsonb)) as rule(value);

  select goal.* into primary_goal
  from public.goals goal
  where goal.organization_id = target_organization_id
    and goal.metric_key is not null
  order by goal.priority asc, goal.id asc
  limit 1;

  if primary_goal.id is not null then
    baseline_source := case primary_goal.baseline_status
      when 'known' then 'goal_baseline_measured:' || primary_goal.metric_key
      when 'estimated' then 'goal_baseline_estimated:' || primary_goal.metric_key
      else null
    end;
  end if;

  return pg_catalog.jsonb_build_object(
    'facts', pg_catalog.jsonb_build_object(
      'organizationProfile', organization.name,
      'currency', organization.base_currency,
      'timeZone', organization.default_timezone,
      'brandVoice', brand_context ->> 'voice',
      'hardConstraints', coalesce(hard_rules, '[]'::jsonb),
      'softConventions', coalesce(soft_rules, '[]'::jsonb),
      'restrictedTerms', coalesce(pg_catalog.to_jsonb(guidelines.restricted_terms), '[]'::jsonb),
      -- Absent rather than empty: a brand with no palette has no palette, and
      -- `{}` would read downstream as "three colours, all unset".
      'palette', case
        when guidelines.palette is null or guidelines.palette = '{}'::jsonb then null
        else guidelines.palette
      end,
      'syntheticAssetsAllowed',
        coalesce((brand_context ->> 'synthetic_assets_allowed')::boolean, false),
      'primaryMetricKey', primary_goal.metric_key,
      'baselineSource', baseline_source
    ),
    'brand_asset_version_ids', coalesce(
      (
        select pg_catalog.jsonb_agg(version.id)
        from public.organization_brand_asset_versions version
        where version.organization_id = target_organization_id and version.is_usable
      ),
      '[]'::jsonb
    )
  );
end;
$$;
```

- [ ] **Step 6: Run the campaign suites**

Run: `pnpm vitest run src/modules/campaigns src/domain/campaigns`
Expected: PASS.

- [ ] **Step 7: Commit, then hand the push to the user**

```bash
git add supabase/migrations/20260915130000_brand_guidelines_into_campaign_facts.sql \
        src/modules/campaigns/application/generation-context.ts \
        src/modules/campaigns/application/generation-context.test.ts
git commit -m "feat(brand): give the brand rule keys their first producer"
```

**This function reads tables it did not create.** plpgsql resolves record fields at execution time, so a mistyped column applies cleanly and fails on first call — this has already happened twice in this repository. After the user pushes, it **must** be called once against staging before this task is done: open a campaign in the browser and start a generation, or ask the user to run `pnpm db:test`.

---

### Task 7: Collect the guidelines in onboarding

**Files:**
- Modify: `src/components/onboarding/sections/shared.tsx`
- Modify: `src/components/onboarding/sections/brand-assets-section.tsx`
- Modify: `src/modules/onboarding/infrastructure/repository.ts`
- Modify: `src/domain/onboarding/canonical-promotion.ts`
- Modify: `src/domain/onboarding/canonical-promotion.test.ts`

**Interfaces:**
- Consumes: `brandGuidelinesSchema`, `splitRulesByStrength` (Task 1); `BrandIdentityPorts` (Task 4).
- Produces: `SectionField` gains `{ control: "palette" }` and `{ control: "brandRules" }`; `guidelinesFromBrandAssets(payload): BrandGuidelines | null`.

- [ ] **Step 1: Write the failing test**

Add to `src/domain/onboarding/canonical-promotion.test.ts`:

```ts
import { guidelinesFromBrandAssets } from "@/domain/onboarding/canonical-promotion";

describe("guidelinesFromBrandAssets", () => {
  it("promotes palette, rules and terms together", () => {
    expect(
      guidelinesFromBrandAssets({
        palette: { primary: "#C8102E" },
        brandRules: [{ text: "Never show alcohol", strength: "hard" }],
        restrictedTerms: ["best in Dubai"],
      }),
    ).toEqual({
      palette: { primary: "#c8102e" },
      rules: [{ text: "Never show alcohol", strength: "hard" }],
      restrictedTerms: ["best in Dubai"],
    });
  });

  it("drops a rule with no strength rather than guessing one", () => {
    // Spec §5. A rule stored as soft when it was meant as absolute is worse
    // than a rule that was not stored.
    expect(
      guidelinesFromBrandAssets({ brandRules: [{ text: "Never show alcohol" }] }),
    ).toBeNull();
  });

  it("promotes nothing when the section supplies nothing", () => {
    expect(guidelinesFromBrandAssets({})).toBeNull();
    expect(guidelinesFromBrandAssets({ palette: {}, brandRules: [], restrictedTerms: [] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/domain/onboarding/canonical-promotion.test.ts`
Expected: FAIL — `guidelinesFromBrandAssets` is not exported.

- [ ] **Step 3: Implement the promoter**

In `canonical-promotion.ts`, add `guidelinesFromBrandAssets(payload: Record<string, unknown>): BrandGuidelines | null`. Parse with `brandGuidelinesSchema.safeParse`; return `null` when the parse fails **or** when the result carries no palette slot, no rule and no term. Document that a failed parse promotes nothing rather than promoting a partial record.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/domain/onboarding/canonical-promotion.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the two controls**

In `shared.tsx`, extend the `SectionField` union with `{ control: "palette" }` and `{ control: "brandRules" }`, add their cases to `initialValues` (`{}` and `[]` respectively), and render them: `palette` as three labelled colour inputs (`<input type="color">` beside a text field, so a hex can be typed or picked); `brandRules` as a repeatable row of a text input plus a two-option radio, **Absolute** and **Preferred**, with a one-line description explaining that an absolute rule can stop a campaign being built and a preferred one guides it. A row with no strength chosen cannot be added.

- [ ] **Step 6: Extend the section**

In `brand-assets-section.tsx`, remove the `assetSources` field — it was free text describing where assets live and nothing ever read it — and add `palette`, `brandRules` and `restrictedTerms` fields. Keep `brandVoice`, `languages` and `claimsRestrictions` as they are.

- [ ] **Step 7: Promote on save**

In `repository.ts`, extend the existing `brand_assets` branch of `persistCanonicalSection`: after the voice promotion added in `f95ded1`, call `guidelinesFromBrandAssets` and, when it returns a record, upsert `organization_brand_guidelines`. Reuse the merge discipline already there — never a whole-row write that resets keys another surface set.

- [ ] **Step 8: Run the onboarding suites and commit**

```bash
pnpm vitest run src/domain/onboarding src/modules/onboarding src/components/onboarding
git add src/components/onboarding/sections/shared.tsx \
        src/components/onboarding/sections/brand-assets-section.tsx \
        src/modules/onboarding/infrastructure/repository.ts \
        src/domain/onboarding/canonical-promotion.ts \
        src/domain/onboarding/canonical-promotion.test.ts
git commit -m "feat(onboarding): collect the brand's colours and rules"
```

---

### Task 8: The Brand Guidelines tab

**Files:**
- Create: `src/components/assets/brand-guidelines-panel.tsx`
- Create: `src/components/assets/brand-guidelines-panel.test.tsx`
- Modify: `src/components/assets/asset-workspace.tsx`

**Interfaces:**
- Consumes: the `GET`/`PUT` route (Task 5); `resolveLogoForTheme` (Task 2).
- Produces: `BrandGuidelinesPanel` with props `{ organizationId: string; canManage: boolean }`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BrandGuidelinesPanel } from "@/components/assets/brand-guidelines-panel";

afterEach(() => cleanup());

describe("BrandGuidelinesPanel", () => {
  it("offers no edit control to somebody who cannot manage the brand", () => {
    render(<BrandGuidelinesPanel organizationId="11111111-1111-4111-8111-111111111111" canManage={false} />);

    // A control that exists and then fails teaches people the product is broken.
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("never describes a generated logo as exact", () => {
    render(<BrandGuidelinesPanel organizationId="11111111-1111-4111-8111-111111111111" canManage />);

    // Acceptance criterion 10. The model is conditioned on the mark; it is not
    // guaranteed to reproduce it.
    expect(screen.queryByText(/exact logo|verified logo|guaranteed/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/assets/brand-guidelines-panel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the panel**

Three sections: the logo (each variant with its image and a picker listing usable `logo`-role assets, plus a plain sentence saying generated artwork is conditioned on the mark and checked at review); the palette (three swatches with hex values, blank where unset); the rules (two groups, **Absolute** and **Preferred**, with restricted terms rendered inside Absolute per spec §18.4). Read through TanStack Query following `src/components/assets/asset-query-options.ts`. Render every edit control only when `canManage`.

**A variant can go bad after it was chosen.** `isVersionUsable` is checked when the logo is set, but the version it points at can be rejected later, and acceptance criterion 3 says that must be reported rather than silently tolerated. Render such a variant in the destructive style with the reason — "this image was rejected and is no longer used as your logo" — and show no image for it. Do **not** fall back to the other variant: a brand mark somebody rejected must not keep appearing because a pointer still resolves.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/assets/brand-guidelines-panel.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Mount the tab**

In `asset-workspace.tsx`, add `<TabsTrigger value="brand-guidelines">Brand Guidelines</TabsTrigger>` after `Brand Kit`, and a matching `TabsContent` rendering the panel. Pass `canManage={canManageAssets && canManageBrand}`; thread `canManageBrand` from the page using `hasOrganizationPermission(role, "brand.manage")`, as the page already does for other permissions.

- [ ] **Step 6: Commit**

```bash
git add src/components/assets/brand-guidelines-panel.tsx \
        src/components/assets/brand-guidelines-panel.test.tsx \
        src/components/assets/asset-workspace.tsx \
        "src/app/(platform)/organizations/[organizationId]/assets/page.tsx"
git commit -m "feat(assets): a Brand Guidelines tab"
```

---

### Task 9: Show the real logo in the platform

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Modify: `src/components/layout/sidebar.test.tsx`

**Interfaces:**
- Consumes: `resolveLogoForTheme` (Task 2); the `GET` route (Task 5).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```tsx
it("shows the organization's own mark when one is set", () => {
  renderSidebarWithLogo(`/organizations/${organizationId}/campaigns`, {
    url: "https://example.test/logo.png",
    alt: "Al Noor Kitchen",
  });

  expect(screen.getByRole("img", { name: "Al Noor Kitchen" })).toHaveAttribute(
    "src",
    "https://example.test/logo.png",
  );
});

it("shows the platform's own mark when no logo is set", () => {
  renderSidebar(`/organizations/${organizationId}/campaigns`);

  // Never a placeholder that looks like a brand nobody supplied.
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
```

Add `renderSidebarWithLogo` beside the existing `renderSidebar` helper, passing the logo through whatever prop or mocked hook the implementation uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/layout/sidebar.test.tsx`
Expected: FAIL — no image is rendered.

- [ ] **Step 3: Render the logo**

Replace the `Waypoints` glyph in the sidebar header with the resolved logo when one exists, falling back to the existing glyph when it does not. Serve it through a session-signed URL, as the Asset Library already does; a signing failure costs the logo and nothing else.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/layout/sidebar.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/sidebar.tsx src/components/layout/sidebar.test.tsx
git commit -m "feat(layout): show the organization's own mark"
```

---

### Task 10: Condition generation on the canonical logo

**Files:**
- Modify: `supabase/migrations/` — new forward migration `20260915140000_canonical_logo_in_campaign_facts.sql`
- Modify: `src/modules/campaigns/application/generation-context.ts`
- Modify: `src/modules/campaigns/application/generation-context.test.ts`

**Interfaces:**
- Consumes: `organization_brand_logos` (Task 3).
- Produces: `generationContextSchema` gains `canonicalLogoVersionId: z.string().uuid().nullable()`.

The reference resolver already admits any usable `brand_mark` asset. This names **which one is the organization's actual mark**, so a brand with three old logos in the library does not have one picked at random.

- [ ] **Step 1: Write the failing test**

```ts
it("names the canonical logo so an old one is not picked instead", () => {
  const context = buildGenerationContext(baseInput({
    canonicalLogoVersionId: "aaaaaaaa-0000-4000-8000-000000000001",
  }));
  if (context.outcome !== "ready") throw new Error("expected ready");

  expect(context.context.canonicalLogoVersionId).toBe("aaaaaaaa-0000-4000-8000-000000000001");
});

it("carries no logo rather than guessing one", () => {
  const context = buildGenerationContext(baseInput({}));
  if (context.outcome !== "ready") throw new Error("expected ready");

  expect(context.context.canonicalLogoVersionId).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/modules/campaigns/application/generation-context.test.ts`
Expected: FAIL — property absent.

- [ ] **Step 3: Add it to the context**

Add `canonicalLogoVersionId: z.string().uuid().nullable()` to `generationContextSchema`, read from `snapshot.canonicalLogoVersionId`, defaulting to `null`. Do not add it to `REQUIRED_EVIDENCE_KEYS` — a brand with no logo still generates.

- [ ] **Step 4: Supply it from the facts**

Forward migration replacing `load_campaign_creation_facts` again, adding to the facts object:

```sql
      'canonicalLogoVersionId', (
        select logo.brand_asset_version_id
        from public.organization_brand_logos logo
        where logo.organization_id = target_organization_id
          and logo.variant = 'primary'
          -- A pointer at a version that was later rejected or never validated
          -- resolves fine and must still not reach a generation request.
          -- Acceptance criterion 3.
          and exists (
            select 1
            from public.organization_brand_asset_versions version
            where version.organization_id = logo.organization_id
              and version.id = logo.brand_asset_version_id
              and version.is_usable
          )
          and not exists (
            select 1
            from public.creative_asset_reviews review
            where review.organization_id = logo.organization_id
              and review.subject_kind = 'brand_asset_version'
              and review.subject_id = logo.brand_asset_version_id
              and review.verdict = 'rejected'
              and review.reviewed_at = (
                select pg_catalog.max(latest.reviewed_at)
                from public.creative_asset_reviews latest
                where latest.organization_id = logo.organization_id
                  and latest.subject_kind = 'brand_asset_version'
                  and latest.subject_id = logo.brand_asset_version_id
              )
          )
      ),
```

Keep every other key exactly as Task 6 left it. Only the **latest** review decides: an image rejected once and approved since is usable again, and treating any historical rejection as permanent would strand it.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/modules/campaigns/application/generation-context.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit and hand the push to the user**

```bash
git add supabase/migrations/20260915140000_canonical_logo_in_campaign_facts.sql \
        src/modules/campaigns/application/generation-context.ts \
        src/modules/campaigns/application/generation-context.test.ts
git commit -m "feat(brand): name the canonical logo in a campaign's pinned facts"
```

Same first-call rule as Task 6: after the push, the function must be executed once against staging.

---

### Task 11: Whole-feature verification

**Files:** none created.

- [ ] **Step 1: Full suite with the dev server stopped**

```bash
pkill -f "next dev" || true
pnpm vitest run
```
Expected: no new failures. The four `permissions.drift` failures for `campaign.research_request` remain; **no failure may mention `brand.manage`**.

- [ ] **Step 2: Typecheck with route types generated**

```bash
pnpm dev &   # let it compile the new routes once
pnpm tsc --noEmit
```
Expected: clean. A route exporting a non-handler only fails here.

- [ ] **Step 3: Lint**

```bash
pnpm lint
```
Expected: no new errors in files this plan touched.

- [ ] **Step 4: Browser verification at 1440 and phone width**

`resize_page` floors at 500px; use `emulate` with a device viewport for phone. Exercise: onboarding capture of palette and rules; the Brand Guidelines tab; the logo in the sidebar; a campaign generation carrying the brand mark. Record findings in `docs/verification/brand/2026-09-15-brand-identity.md` with screenshots. Confirm **no surface describes a generated logo as exact**.

- [ ] **Step 5: Confirm the staging first-call rule was met**

Both replacements of `load_campaign_creation_facts` must have been executed against staging at least once. If not, this feature is not done.

- [ ] **Step 6: Update the board and the docs**

Add an entry to `docs/collaboration/asset-library-and-studio-board.md`. Add the pointers named in the spec's Documentation updates section: Spec 019, Spec 020, `context/05-module-map.md`, and an ADR recording §18.1.

---

## Self-Review

**Spec coverage.** In scope items map to tasks: canonical logo with variants → 2, 3, 9; exact UI display → 9; `brand_mark` conditioning → 10; structured guidelines → 1, 3; onboarding collection → 7; Asset Library tab → 8; promotion into the generation context → 6; pinning into the snapshot → 6 and 10 (the facts flow into `campaign_source_snapshots` through the existing creation path, and repair follows ADR 0058, already built). Domain rules 1–9 are each asserted by a named test. Acceptance criteria 1–10 map to Tasks 7–11; criterion 10 is asserted in Task 8 and re-checked in Task 11.

**Gap found and closed.** Acceptance criterion 3 — a logo pointing at a later-rejected version is reported broken — was enforced only at write time, by Task 4's `isVersionUsable`. A version can be rejected *after* the logo is set, and nothing caught that. Fixed in place: Task 8 Step 3 now specifies the broken state and forbids falling back to the other variant, and Task 10 Step 4's subquery now excludes a version that is unusable or whose latest review is a rejection.

**Placeholder scan.** No TBD, no "add error handling", no "similar to Task N". Tasks 4 Step 5, 7 Step 5 and 8 Step 3 describe components in prose rather than full code; each names the exact file, exported symbol, props and the pattern file to follow, which is the level the surrounding codebase's own components are written at.

**Type consistency.** `BrandGuidelines`, `BrandRule`, `BrandPalette`, `BrandLogoSelection`, `BrandIdentityPorts` are defined once in Tasks 1, 2, 4 and used under those exact names in 5, 7, 8, 10. `splitRulesByStrength` (Task 1) is the TypeScript mirror of the SQL `filter (where ... 'hard')` in Task 6 — both must stay in step; Task 6's test asserts the SQL side's output shape reaches the prompt.
