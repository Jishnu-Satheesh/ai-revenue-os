begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(8);

insert into auth.users (id)
values ('15000000-0000-4000-8000-000000000001'::uuid);

-- Inert account fixture: organizations.account_id is NOT NULL, but this
-- suite grants no account membership, so access still resolves purely from
-- the organization_memberships rows below -- exactly as it did before
-- accounts existed.
insert into public.accounts (id, name, slug, created_by)
values ('acc00000-0000-4000-8000-bdda7d271263'::uuid, 'Fixture agency', 'fixture-agency-business-memory-search-test', '15000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
)
values
  (
    '25000000-0000-4000-8000-000000000001'::uuid,
    'Search tenant one', 'search-tenant-one', 'testing', 'US', 'USD', 'UTC',
    '15000000-0000-4000-8000-000000000001'::uuid,
    'acc00000-0000-4000-8000-bdda7d271263'::uuid),
  (
    '25000000-0000-4000-8000-000000000002'::uuid,
    'Search tenant two', 'search-tenant-two', 'testing', 'US', 'USD', 'UTC',
    '15000000-0000-4000-8000-000000000001'::uuid,
    'acc00000-0000-4000-8000-bdda7d271263'::uuid);

insert into public.organization_memberships (organization_id, user_id, role)
values ('25000000-0000-4000-8000-000000000001'::uuid, '15000000-0000-4000-8000-000000000001'::uuid, 'operator');

-- A unit vector on the first axis, and a near-identical one, so semantic
-- similarity can be made to disagree with trust on purpose.
create temporary table search_vectors as
select
  ('[1' || repeat(',0', 1535) || ']')::extensions.vector(1536) as axis_one,
  ('[0,1' || repeat(',0', 1534) || ']')::extensions.vector(1536) as axis_two;

insert into public.memory_items (
  id, organization_id, memory_type, title, body, origin, verification_state,
  sensitivity, created_by, verified_by, verified_at, embedding, embedding_model, embedding_status
)
select
  '45000000-0000-4000-8000-000000000001'::uuid,
  '25000000-0000-4000-8000-000000000001'::uuid,
  'lesson',
  'Kitchen staffing limits evening service',
  'The owner confirmed staffing caps late orders.',
  'user_verified', 'verified', 'internal',
  '15000000-0000-4000-8000-000000000001'::uuid,
  '15000000-0000-4000-8000-000000000001'::uuid, now(),
  search_vectors.axis_two, 'test-model', 'ready'
from search_vectors;

-- Deliberately the better lexical AND semantic match, but an unconfirmed inference.
insert into public.memory_items (
  id, organization_id, memory_type, title, body, origin, verification_state,
  sensitivity, embedding, embedding_model, embedding_status
)
select
  '45000000-0000-4000-8000-000000000002'::uuid,
  '25000000-0000-4000-8000-000000000001'::uuid,
  'lesson',
  'Kitchen staffing limits evening service capacity',
  'Kitchen staffing limits evening service. Kitchen staffing limits evening service.',
  'ai_proposed', 'unverified', 'internal',
  search_vectors.axis_one, 'test-model', 'ready'
from search_vectors;

insert into public.memory_items (
  id, organization_id, memory_type, title, origin, verification_state, sensitivity,
  superseded_by_id, superseded_at
)
values (
  '45000000-0000-4000-8000-000000000003'::uuid,
  '25000000-0000-4000-8000-000000000001'::uuid,
  'note', 'Kitchen staffing superseded note', 'user_verified', 'unverified', 'internal',
  '45000000-0000-4000-8000-000000000001'::uuid, now()
);

insert into public.memory_items (
  id, organization_id, memory_type, title, origin, verification_state, sensitivity, expires_at
)
values (
  '45000000-0000-4000-8000-000000000004'::uuid,
  '25000000-0000-4000-8000-000000000001'::uuid,
  'note', 'Kitchen staffing expired note', 'user_verified', 'unverified', 'internal',
  now() - interval '1 day'
);

insert into public.memory_items (
  id, organization_id, memory_type, title, origin, verification_state, sensitivity
)
values (
  '45000000-0000-4000-8000-000000000005'::uuid,
  '25000000-0000-4000-8000-000000000001'::uuid,
  'episode', 'Kitchen staffing customer remark', 'provider_imported', 'unverified', 'customer_content'
);

insert into public.memory_items (
  id, organization_id, memory_type, title, origin, verification_state, sensitivity
)
values (
  '45000000-0000-4000-8000-000000000006'::uuid,
  '25000000-0000-4000-8000-000000000002'::uuid,
  'lesson', 'Kitchen staffing limits evening service', 'user_verified', 'unverified', 'internal'
);

-- Acceptance criterion 2, proved in SQL: the inference wins on both scores and
-- still ranks second, because trust sorts before relevance.
select extensions.is(
  (
    select array_agg(result.id order by ordinality)
    from public.search_memory_items(
      '25000000-0000-4000-8000-000000000001'::uuid,
      'kitchen staffing evening',
      (select axis_one from search_vectors)
    ) with ordinality as result(
      id, memory_type, title, body, structured_value, origin, source_tier, source_system,
      source_reference, verification_state, verified_at, confidence, sensitivity, observed_at,
      effective_from, effective_to, superseded_by_id, trust_rank, freshness, lexical, semantic,
      blended, ordinality
    )
  ),
  array[
    '45000000-0000-4000-8000-000000000001'::uuid,
    '45000000-0000-4000-8000-000000000002'::uuid
  ],
  'a verified item outranks a semantically and lexically closer inference'
);

select extensions.is(
  (
    select result.blended > (
      select inner_result.blended
      from public.search_memory_items(
        '25000000-0000-4000-8000-000000000001'::uuid,
        'kitchen staffing evening',
        (select axis_one from search_vectors)
      ) inner_result
      where inner_result.id = '45000000-0000-4000-8000-000000000001'::uuid
    )
    from public.search_memory_items(
      '25000000-0000-4000-8000-000000000001'::uuid,
      'kitchen staffing evening',
      (select axis_one from search_vectors)
    ) result
    where result.id = '45000000-0000-4000-8000-000000000002'::uuid
  ),
  true,
  'the lower ranked inference really does score higher, so the ordering is structural'
);

select extensions.is(
  (
    select count(*)
    from public.search_memory_items(
      '25000000-0000-4000-8000-000000000001'::uuid, 'kitchen staffing'
    )
    where id in (
      '45000000-0000-4000-8000-000000000003'::uuid,
      '45000000-0000-4000-8000-000000000004'::uuid
    )
  ),
  0::bigint,
  'superseded and expired items are excluded by default'
);

select extensions.is(
  (
    select count(*)
    from public.search_memory_items(
      '25000000-0000-4000-8000-000000000001'::uuid, 'kitchen staffing',
      null, null, null, array['public', 'internal'], null, true, true
    )
    where id in (
      '45000000-0000-4000-8000-000000000003'::uuid,
      '45000000-0000-4000-8000-000000000004'::uuid
    )
  ),
  2::bigint,
  'superseded and expired items return when asked for explicitly'
);

select extensions.is(
  (
    select count(*)
    from public.search_memory_items(
      '25000000-0000-4000-8000-000000000001'::uuid, 'kitchen staffing'
    )
    where id = '45000000-0000-4000-8000-000000000005'::uuid
  ),
  0::bigint,
  'customer content is absent below its sensitivity ceiling'
);

select extensions.is(
  (
    select count(*)
    from public.search_memory_items(
      '25000000-0000-4000-8000-000000000001'::uuid, 'kitchen staffing',
      null, null, null,
      array['public', 'internal', 'confidential', 'customer_content']
    )
    where id = '45000000-0000-4000-8000-000000000005'::uuid
  ),
  1::bigint,
  'customer content returns once the ceiling allows it'
);

select extensions.is(
  (
    select count(*)
    from public.search_memory_items(
      '25000000-0000-4000-8000-000000000001'::uuid, 'kitchen staffing'
    )
    where id = '45000000-0000-4000-8000-000000000006'::uuid
  ),
  0::bigint,
  'search never crosses an organization boundary'
);

-- With no query vector the function must still answer lexically.
select extensions.is(
  (
    select count(*) > 0
    from public.search_memory_items(
      '25000000-0000-4000-8000-000000000001'::uuid, 'kitchen staffing', null
    )
  ),
  true,
  'lexical-only retrieval works when no embedding is supplied'
);

select * from extensions.finish();

rollback;
