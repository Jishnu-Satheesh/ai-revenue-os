begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(12);

insert into auth.users (id)
values ('9a1e0c1f-1760-4b25-8b15-100000000001'::uuid);

-- Inert account fixture: organizations.account_id is NOT NULL, but this
-- suite grants no account membership, so access still resolves purely from
-- the organization_memberships rows below -- exactly as it did before
-- accounts existed.
insert into public.accounts (id, name, slug, created_by)
values ('acc00000-0000-4000-8000-a5a82b6fa5f8'::uuid, 'Fixture agency', 'fixture-agency-configuration-versioning-test', '9a1e0c1f-1760-4b25-8b15-100000000001'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
)
values (
  '9a1e0c1f-1760-4b25-8b15-200000000001'::uuid,
  'Configuration versioning',
  'configuration-versioning',
  'testing',
  'AE',
  'AED',
  'Asia/Dubai',
  '9a1e0c1f-1760-4b25-8b15-100000000001'::uuid,
    'acc00000-0000-4000-8000-a5a82b6fa5f8'::uuid);

-- Subject kinds --------------------------------------------------------------

select extensions.is(
  (select count(*)::bigint from public.subject_kinds where owner_scope = 'core'),
  3::bigint,
  'the core subject kind vocabulary is seeded'
);

select extensions.throws_ok(
  $$ insert into public.subject_kinds (key, label, owner_scope) values ('Bad Key', 'Bad', 'core') $$,
  '23514',
  null,
  'a subject kind key must be a lower-case slug'
);

select extensions.throws_ok(
  $$ insert into public.subject_kinds (key, label, owner_scope) values ('menu_item', 'Item', 'pack') $$,
  '23514',
  null,
  'a pack-owned subject kind must name its pack'
);

-- Policies -------------------------------------------------------------------

insert into public.policies (organization_id, policy_type, name, mode, version, is_active)
values (
  '9a1e0c1f-1760-4b25-8b15-200000000001'::uuid, 'approval', 'Approvals', 'approval_required', 1, true
);

select extensions.throws_ok(
  $$
    insert into public.policies (organization_id, policy_type, name, mode, version, is_active)
    values (
      '9a1e0c1f-1760-4b25-8b15-200000000001'::uuid, 'approval', 'Approvals v2', 'approval_required', 2, true
    )
  $$,
  '23505',
  null,
  'a second active version of one policy type is rejected'
);

select extensions.lives_ok(
  $$
    insert into public.policies (organization_id, policy_type, name, mode, version, is_active)
    values (
      '9a1e0c1f-1760-4b25-8b15-200000000001'::uuid, 'approval', 'Approvals v2', 'approval_required', 2, false
    )
  $$,
  'an inactive successor version is allowed alongside the active one'
);

-- Constraints ----------------------------------------------------------------

insert into public.constraints (
  organization_id, constraint_key, name, constraint_type, value, scope_kind, version
)
values (
  '9a1e0c1f-1760-4b25-8b15-200000000001'::uuid,
  'margin_floor.default',
  'Default margin floor',
  'margin_floor',
  '{"minimum_margin_percent": 12}'::jsonb,
  'organization',
  1
);

select extensions.throws_ok(
  $$
    insert into public.constraints (
      organization_id, constraint_key, name, constraint_type, value, scope_kind, version
    )
    values (
      '9a1e0c1f-1760-4b25-8b15-200000000001'::uuid,
      'margin_floor.default',
      'Default margin floor v2',
      'margin_floor',
      '{"minimum_margin_percent": 15}'::jsonb,
      'organization',
      2
    )
  $$,
  '23505',
  null,
  'a second active version of one constraint key and scope is rejected'
);

select extensions.lives_ok(
  $$
    insert into public.constraints (
      organization_id, constraint_key, name, constraint_type, value, scope_kind, scope_ref, version
    )
    values (
      '9a1e0c1f-1760-4b25-8b15-200000000001'::uuid,
      'margin_floor.default',
      'Talabat margin floor',
      'margin_floor',
      '{"minimum_margin_percent": 18}'::jsonb,
      'channel',
      'talabat',
      1
    )
  $$,
  'the same key at a more specific scope is a separate active constraint'
);

select extensions.throws_ok(
  $$
    insert into public.constraints (
      organization_id, constraint_key, name, constraint_type, value, scope_kind, scope_ref, version
    )
    values (
      '9a1e0c1f-1760-4b25-8b15-200000000001'::uuid,
      'margin_floor.default', 'Bad scope', 'margin_floor', '{}'::jsonb, 'organization', 'talabat', 9
    )
  $$,
  '23514',
  null,
  'an organization-scoped constraint cannot name a subject'
);

select extensions.throws_ok(
  $$
    insert into public.constraints (
      organization_id, constraint_key, name, constraint_type, value, scope_kind, version
    )
    values (
      '9a1e0c1f-1760-4b25-8b15-200000000001'::uuid,
      'margin_floor.default', 'Bad scope', 'margin_floor', '{}'::jsonb, 'branch', 9
    )
  $$,
  '23514',
  null,
  'a branch-scoped constraint must name a subject'
);

select extensions.throws_ok(
  $$
    insert into public.constraints (
      organization_id, constraint_key, name, constraint_type, value, scope_kind, version, effective_from, effective_to
    )
    values (
      '9a1e0c1f-1760-4b25-8b15-200000000001'::uuid,
      'margin_floor.window', 'Bad window', 'margin_floor', '{}'::jsonb, 'organization', 1,
      date '2026-08-10', date '2026-08-01'
    )
  $$,
  '23514',
  null,
  'an effective window cannot end before it starts'
);

select extensions.throws_ok(
  $$
    insert into public.constraints (
      organization_id, constraint_key, name, constraint_type, value, scope_kind, version
    )
    values (
      '9a1e0c1f-1760-4b25-8b15-200000000001'::uuid,
      'Margin Floor', 'Bad key', 'margin_floor', '{}'::jsonb, 'organization', 1
    )
  $$,
  '23514',
  null,
  'a constraint key must be a lower-case slug'
);

-- Audit ----------------------------------------------------------------------

update public.constraints
set is_active = false
where organization_id = '9a1e0c1f-1760-4b25-8b15-200000000001'::uuid
  and constraint_key = 'margin_floor.default'
  and scope_kind = 'organization';

select extensions.is(
  (
    select count(*)::bigint
    from public.audit_events
    where organization_id = '9a1e0c1f-1760-4b25-8b15-200000000001'::uuid
      and event_name = 'constraint.superseded'
  ),
  1::bigint,
  'retiring a constraint emits constraint.superseded rather than constraint.created'
);

select * from extensions.finish();

rollback;
