begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(11);

insert into auth.users (id)
values
  ('16000000-0000-4000-8000-000000000001'::uuid),
  ('16000000-0000-4000-8000-000000000002'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by
)
values (
  '26000000-0000-4000-8000-000000000001'::uuid,
  'Write tenant', 'write-tenant', 'testing', 'US', 'USD', 'UTC',
  '16000000-0000-4000-8000-000000000001'::uuid
);

insert into public.organization_memberships (organization_id, user_id, role)
values
  ('26000000-0000-4000-8000-000000000001'::uuid, '16000000-0000-4000-8000-000000000001'::uuid, 'operator'),
  ('26000000-0000-4000-8000-000000000001'::uuid, '16000000-0000-4000-8000-000000000002'::uuid, 'viewer');

insert into public.memory_items (
  id, organization_id, memory_type, title, body, origin, verification_state, sensitivity, created_by
)
values (
  '46000000-0000-4000-8000-000000000001'::uuid,
  '26000000-0000-4000-8000-000000000001'::uuid,
  'lesson', 'Original lesson', 'The first version.', 'user_verified', 'unverified', 'internal',
  '16000000-0000-4000-8000-000000000001'::uuid
);

set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

-- Exercises the function for real. A schema-qualification bug in the body only
-- surfaces on a call, never on creation.
select extensions.lives_ok(
  $$select public.supersede_memory_item(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000001'::uuid,
      '46000000-0000-4000-8000-000000000001'::uuid,
      'Corrected lesson',
      'The corrected version.',
      'internal',
      'The original overstated the limit.',
      'supersede-key-1'
    )$$,
  'supersede_memory_item runs end to end'
);

reset role;

select extensions.is(
  (
    select superseded_by_id is not null and superseded_at is not null
    from public.memory_items
    where id = '46000000-0000-4000-8000-000000000001'::uuid
  ),
  true,
  'the original item is marked superseded'
);

select extensions.is(
  (
    select embedding_status
    from public.memory_items
    where id = '46000000-0000-4000-8000-000000000001'::uuid
  ),
  'skipped',
  'a superseded item stops waiting for an embedding'
);

select extensions.is(
  (
    select count(*)
    from public.memory_items
    where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
      and title = 'Corrected lesson'
      and verification_state = 'verified'
  ),
  1::bigint,
  'the replacement is inserted and verified in the same transaction'
);

set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

select extensions.is(
  (
    select (public.supersede_memory_item(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000001'::uuid,
      '46000000-0000-4000-8000-000000000001'::uuid,
      'Corrected lesson',
      'The corrected version.',
      'internal',
      'The original overstated the limit.',
      'supersede-key-1'
    )) ->> 'supersededId'
  ),
  '46000000-0000-4000-8000-000000000001',
  'replaying the same idempotency key returns the first result without writing again'
);

select extensions.is(
  (
    select count(*)
    from public.memory_items
    where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
      and title = 'Corrected lesson'
  ),
  1::bigint,
  'the replay did not create a second replacement'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$select public.supersede_memory_item(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000002'::uuid,
      '46000000-0000-4000-8000-000000000001'::uuid,
      'Viewer correction', null, 'internal', 'not allowed', 'supersede-key-2'
    )$$,
  '42501',
  null,
  'a viewer cannot supersede memory'
);

reset role;

-- A proposal must carry the evidence it was derived from.
select extensions.throws_ok(
  $$select public.create_proposed_memory_item(
      '26000000-0000-4000-8000-000000000001'::uuid, null, 'lesson', 'Unsupported claim',
      null, null, 'ai_proposed', 'internal', 0.5, null, array[]::uuid[], null, null, null
    )$$,
  '23514',
  null,
  'a proposal without evidence is rejected'
);

select extensions.throws_ok(
  $$select public.create_proposed_memory_item(
      '26000000-0000-4000-8000-000000000001'::uuid, null, 'lesson', 'Forged user memory',
      null, null, 'user_verified', 'internal', 0.5, null,
      array['46000000-0000-4000-8000-000000000001'::uuid], null, null, null
    )$$,
  '23514',
  null,
  'the proposal path refuses a non-model origin'
);

-- The function is called once into a temporary table first. Calling it inside a
-- WHERE clause would evaluate it per candidate row, so an empty table would
-- never run it at all and the assertion would pass vacuously.
create temporary table proposal_result as
select public.create_proposed_memory_item(
  '26000000-0000-4000-8000-000000000001'::uuid, null, 'lesson', 'Supported claim',
  'Derived from the original lesson.', null, 'ai_proposed', 'internal', 0.5, null,
  array['46000000-0000-4000-8000-000000000001'::uuid], null, null, null
) as item_id;

select extensions.is(
  (
    select count(*)
    from public.memory_links link
    join proposal_result on proposal_result.item_id = link.from_item_id
    where link.organization_id = '26000000-0000-4000-8000-000000000001'::uuid
      and link.relation = 'derived_from'
      and link.to_item_id = '46000000-0000-4000-8000-000000000001'::uuid
  ),
  1::bigint,
  'a proposal is written together with its evidence link'
);

select extensions.is(
  (
    select verification_state
    from public.memory_items item
    join proposal_result on proposal_result.item_id = item.id
  ),
  'proposed',
  'a model-authored item can only enter as proposed'
);

select * from extensions.finish();

rollback;
