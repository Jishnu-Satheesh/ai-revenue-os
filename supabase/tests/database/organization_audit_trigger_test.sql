begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(4);

insert into auth.users (id)
values ('7d4c0c1f-1760-4b25-8b15-100000000001'::uuid);

-- Inert account fixture: organizations.account_id is NOT NULL, but this suite
-- grants no account membership, so access still resolves purely from the
-- organization_memberships rows below -- exactly as it did before accounts
-- existed.
insert into public.accounts (id, name, slug, created_by)
values (
  'acc00000-0000-4000-8000-16d117734612'::uuid, 'Fixture agency',
  'fixture-agency-organization-audit-trigger', '7d4c0c1f-1760-4b25-8b15-100000000001'::uuid
);

select extensions.lives_ok(
  $$
    insert into public.organizations (
      id,
      name,
      slug,
      industry,
      country_code,
      base_currency,
      default_timezone,
      created_by,
      account_id
    )
    values (
      '7d4c0c1f-1760-4b25-8b15-200000000001'::uuid,
      'Audit trigger verification',
      'audit-trigger-verification',
      'testing',
      'US',
      'USD',
      'UTC',
      '7d4c0c1f-1760-4b25-8b15-100000000001'::uuid,
      'acc00000-0000-4000-8000-16d117734612'::uuid
    )
  $$,
  'organization creation succeeds with the shared audit trigger'
);

select extensions.is(
  (
    select count(*)::bigint
    from public.audit_events
    where organization_id = '7d4c0c1f-1760-4b25-8b15-200000000001'::uuid
      and event_name = 'organization.created'
  ),
  1::bigint,
  'organization creation emits one audit event'
);

select extensions.lives_ok(
  $$
    insert into public.business_profiles (organization_id, updated_by)
    values (
      '7d4c0c1f-1760-4b25-8b15-200000000001'::uuid,
      '7d4c0c1f-1760-4b25-8b15-100000000001'::uuid
    )
  $$,
  'a table without an id column succeeds with the shared audit trigger'
);

select extensions.is(
  (
    select count(*)::bigint
    from public.audit_events
    where organization_id = '7d4c0c1f-1760-4b25-8b15-200000000001'::uuid
      and event_name = 'business_profile.updated'
  ),
  1::bigint,
  'business profile creation emits one audit event'
);

select * from extensions.finish();

rollback;
