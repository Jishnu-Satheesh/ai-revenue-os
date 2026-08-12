begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(14);

-- Structure -----------------------------------------------------------------

select extensions.has_table(
  'public', 'organization_last_access', 'the user-scoped access table exists'
);
select extensions.has_function(
  'public', 'resolve_landing_organization', 'the landing resolver exists'
);
select extensions.has_function(
  'public', 'touch_organization_access', array['uuid'], 'the access recorder exists'
);
select extensions.is(
  (select relrowsecurity from pg_class where oid = 'public.organization_last_access'::regclass),
  true,
  'row level security is enabled on the access table'
);

-- Fixtures ------------------------------------------------------------------

insert into auth.users (id)
values
  ('44000000-0000-4000-8000-000000000001'::uuid),
  ('44000000-0000-4000-8000-000000000002'::uuid),
  ('44000000-0000-4000-8000-000000000003'::uuid);

-- Names are deliberately out of creation order so an alphabetical fallback
-- cannot be mistaken for insertion order.
insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, status, created_by
)
values
  (
    '54000000-0000-4000-8000-000000000001'::uuid,
    'Zulu Diner', 'zulu-diner', 'testing', 'US', 'USD', 'UTC', 'active',
    '44000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '54000000-0000-4000-8000-000000000002'::uuid,
    'Alpha Bakery', 'alpha-bakery', 'testing', 'US', 'USD', 'UTC', 'active',
    '44000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '54000000-0000-4000-8000-000000000003'::uuid,
    'Mono Grill', 'mono-grill', 'testing', 'US', 'USD', 'UTC', 'draft_onboarding',
    '44000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '54000000-0000-4000-8000-000000000004'::uuid,
    'Archived Place', 'archived-place', 'testing', 'US', 'USD', 'UTC', 'archived',
    '44000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '54000000-0000-4000-8000-000000000005'::uuid,
    'Other Tenant', 'other-tenant', 'testing', 'US', 'USD', 'UTC', 'active',
    '44000000-0000-4000-8000-000000000002'::uuid
  );

-- user 1 holds three workable organizations plus an archived one.
-- user 2 holds only the other tenant. user 3 holds only an archived one.
insert into public.organization_memberships (organization_id, user_id, role)
values
  ('54000000-0000-4000-8000-000000000001'::uuid, '44000000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('54000000-0000-4000-8000-000000000002'::uuid, '44000000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('54000000-0000-4000-8000-000000000003'::uuid, '44000000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('54000000-0000-4000-8000-000000000004'::uuid, '44000000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('54000000-0000-4000-8000-000000000005'::uuid, '44000000-0000-4000-8000-000000000002'::uuid, 'owner'),
  ('54000000-0000-4000-8000-000000000004'::uuid, '44000000-0000-4000-8000-000000000003'::uuid, 'viewer');

-- Resolution ----------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '44000000-0000-4000-8000-000000000001';

-- Nothing visited yet, so the tie-break decides. Alpha Bakery wins on name over
-- Mono Grill and Zulu Diner; the archived organization and the other tenant's
-- must not be candidates at all.
select extensions.is(
  public.resolve_landing_organization(),
  '54000000-0000-4000-8000-000000000002'::uuid,
  'with nothing visited the alphabetically first workable organization resolves'
);

select public.touch_organization_access('54000000-0000-4000-8000-000000000001'::uuid);
select extensions.is(
  public.resolve_landing_organization(),
  '54000000-0000-4000-8000-000000000001'::uuid,
  'a recorded visit outranks the alphabetical fallback'
);

-- The staleness guard. `now()` is fixed for the transaction, so the stored
-- value is moved explicitly to prove the guard both closes and opens.
update public.organization_last_access
set last_accessed_at = now() - interval '1 minute'
where organization_id = '54000000-0000-4000-8000-000000000001'::uuid;
select public.touch_organization_access('54000000-0000-4000-8000-000000000001'::uuid);
select extensions.is(
  (
    select last_accessed_at from public.organization_last_access
    where organization_id = '54000000-0000-4000-8000-000000000001'::uuid
  ),
  now() - interval '1 minute',
  'a repeat visit inside the window does not rewrite the position'
);

update public.organization_last_access
set last_accessed_at = now() - interval '10 minutes'
where organization_id = '54000000-0000-4000-8000-000000000001'::uuid;
select public.touch_organization_access('54000000-0000-4000-8000-000000000001'::uuid);
select extensions.is(
  (
    select last_accessed_at from public.organization_last_access
    where organization_id = '54000000-0000-4000-8000-000000000001'::uuid
  ),
  now(),
  'a visit after the window refreshes the position'
);

-- A position may be recorded against an archived organization the user still
-- belongs to. It ties Zulu Diner on timestamp and wins the name tie-break, so
-- only the status filter can keep it out of the result.
select public.touch_organization_access('54000000-0000-4000-8000-000000000004'::uuid);
select extensions.is(
  public.resolve_landing_organization(),
  '54000000-0000-4000-8000-000000000001'::uuid,
  'a position on an archived organization is never resolved'
);

-- Tenant isolation ----------------------------------------------------------

select extensions.throws_ok(
  $$select public.touch_organization_access('54000000-0000-4000-8000-000000000005'::uuid)$$,
  '42501',
  null,
  'access cannot be recorded against an organization the user does not belong to'
);

select extensions.throws_ok(
  $$insert into public.organization_last_access (user_id, organization_id)
    values (
      '44000000-0000-4000-8000-000000000002'::uuid,
      '54000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '42501',
  null,
  'a position cannot be recorded on behalf of another user'
);

set local request.jwt.claim.sub = '44000000-0000-4000-8000-000000000002';
select extensions.is(
  (select count(*) from public.organization_last_access),
  0::bigint,
  'a user cannot read another user positions'
);
select extensions.is(
  public.resolve_landing_organization(),
  '54000000-0000-4000-8000-000000000005'::uuid,
  'each user resolves only inside their own memberships'
);

set local request.jwt.claim.sub = '44000000-0000-4000-8000-000000000003';
select extensions.is(
  public.resolve_landing_organization(),
  null::uuid,
  'a member of only archived organizations resolves to nothing'
);

select * from extensions.finish();

rollback;
