begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(10);

-- Companion test for 20260915120000_brand_identity.sql.
--
-- These suites share the staging database and wrap in begin/rollback, so this
-- asserts the guards a mistake would silently remove rather than standing up
-- two tenants. The validators are pure functions and are exercised directly,
-- which is the part a wrong bound would break.

select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.organization_brand_guidelines'::regclass),
  'brand guidelines has row level security enabled and forced'
);

select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class
   where oid = 'public.organization_brand_logos'::regclass),
  'brand logos has row level security enabled and forced'
);

-- The tenant is inside the foreign key, so a pointer at another
-- organization's image fails in the database, not only in the application.
select extensions.ok(
  (select pg_catalog.array_length(conkey, 1) = 2
   from pg_catalog.pg_constraint
   where conname = 'organization_brand_logos_version_fkey'),
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

-- Owner and admin hold it; an operator must not. A hard constraint exists to
-- cause a refusal, and whoever can rewrite it can lift that refusal.
select extensions.is(
  (select pg_catalog.count(*)::integer
   from public.organization_role_permissions
   where permission_key = 'brand.manage'),
  2,
  'brand.manage is granted to exactly two organization roles'
);

select extensions.ok(
  not exists (
    select 1 from public.organization_role_permissions
    where permission_key = 'brand.manage' and organization_role = 'operator'
  ),
  'an operator cannot rewrite the brand rules'
);

-- Spec 026 section 5: a hard rule is never inferred, so an unmarked rule is
-- not storable at all.
select extensions.ok(
  not private.brand_rules_valid('[{"text":"Never show alcohol"}]'::jsonb),
  'a rule without a strength is refused by the validator'
);

select extensions.ok(
  not private.brand_palette_valid('{"primary":"red"}'::jsonb)
    and not private.brand_palette_valid('{"quaternary":"#c8102e"}'::jsonb)
    and private.brand_palette_valid('{"primary":"#c8102e"}'::jsonb),
  'a palette takes known slots holding hex colours, and nothing else'
);

select * from extensions.finish();
rollback;
