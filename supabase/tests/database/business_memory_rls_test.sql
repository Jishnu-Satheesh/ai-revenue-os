begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(42);

select extensions.has_table('public', 'memory_items', 'memory items exist');
select extensions.has_table('public', 'memory_links', 'memory links exist');
select extensions.has_table('public', 'memory_retrieval_log', 'memory retrieval log exists');

insert into auth.users (id)
values
  ('14000000-0000-4000-8000-000000000001'::uuid),
  ('14000000-0000-4000-8000-000000000002'::uuid),
  ('14000000-0000-4000-8000-000000000003'::uuid),
  ('14000000-0000-4000-8000-000000000004'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by
)
values
  (
    '24000000-0000-4000-8000-000000000001'::uuid,
    'Memory tenant one', 'memory-tenant-one', 'testing', 'US', 'USD', 'UTC',
    '14000000-0000-4000-8000-000000000001'::uuid
  ),
  (
    '24000000-0000-4000-8000-000000000002'::uuid,
    'Memory tenant two', 'memory-tenant-two', 'testing', 'US', 'USD', 'UTC',
    '14000000-0000-4000-8000-000000000002'::uuid
  );

-- user 1: operator in tenant one. user 2: operator in tenant two.
-- user 3: viewer in tenant one.  user 4: admin in tenant one.
insert into public.organization_memberships (organization_id, user_id, role)
values
  ('24000000-0000-4000-8000-000000000001'::uuid, '14000000-0000-4000-8000-000000000001'::uuid, 'operator'),
  ('24000000-0000-4000-8000-000000000002'::uuid, '14000000-0000-4000-8000-000000000002'::uuid, 'operator'),
  ('24000000-0000-4000-8000-000000000001'::uuid, '14000000-0000-4000-8000-000000000003'::uuid, 'viewer'),
  ('24000000-0000-4000-8000-000000000001'::uuid, '14000000-0000-4000-8000-000000000004'::uuid, 'admin');

insert into public.branches (id, organization_id, name, slug, timezone, currency)
values
  (
    '34000000-0000-4000-8000-000000000001'::uuid,
    '24000000-0000-4000-8000-000000000001'::uuid,
    'Memory branch one', 'memory-branch-one', 'UTC', 'USD'
  ),
  (
    '34000000-0000-4000-8000-000000000002'::uuid,
    '24000000-0000-4000-8000-000000000002'::uuid,
    'Memory branch two', 'memory-branch-two', 'UTC', 'USD'
  );

insert into public.memory_items (
  id, organization_id, memory_type, title, body, origin, verification_state, sensitivity,
  created_by, verified_by, verified_at
)
values
  (
    '44000000-0000-4000-8000-000000000001'::uuid,
    '24000000-0000-4000-8000-000000000001'::uuid,
    'lesson', 'Tenant one internal lesson', 'Late night discounts were rejected.',
    'user_verified', 'verified', 'internal', '14000000-0000-4000-8000-000000000001'::uuid,
    '14000000-0000-4000-8000-000000000001'::uuid, now()
  ),
  (
    '44000000-0000-4000-8000-000000000002'::uuid,
    '24000000-0000-4000-8000-000000000001'::uuid,
    'episode', 'Tenant one customer review', 'A guest left a four star review.',
    'provider_imported', 'unverified', 'customer_content', null, null, null
  ),
  (
    '44000000-0000-4000-8000-000000000003'::uuid,
    '24000000-0000-4000-8000-000000000001'::uuid,
    'note', 'Tenant one confidential note', 'Margin floor is set by the owner.',
    'user_verified', 'unverified', 'confidential', '14000000-0000-4000-8000-000000000001'::uuid,
    null, null
  ),
  (
    '44000000-0000-4000-8000-000000000004'::uuid,
    '24000000-0000-4000-8000-000000000002'::uuid,
    'lesson', 'Tenant two internal lesson', 'Another organization must never see this.',
    'user_verified', 'verified', 'internal', '14000000-0000-4000-8000-000000000002'::uuid,
    '14000000-0000-4000-8000-000000000002'::uuid, now()
  );

insert into public.memory_links (organization_id, from_item_id, to_item_id, relation, created_by)
values (
  '24000000-0000-4000-8000-000000000001'::uuid,
  '44000000-0000-4000-8000-000000000001'::uuid,
  '44000000-0000-4000-8000-000000000002'::uuid,
  'derived_from',
  '14000000-0000-4000-8000-000000000001'::uuid
);

-- Source tier is derived, never supplied. Mirrors src/domain/memory/trust.ts.
select extensions.is(
  (select source_tier from public.memory_items where id = '44000000-0000-4000-8000-000000000001'::uuid),
  1::smallint,
  'a verified item derives source tier 1'
);
select extensions.is(
  (select source_tier from public.memory_items where id = '44000000-0000-4000-8000-000000000002'::uuid),
  2::smallint,
  'unverified provider data derives source tier 2'
);

insert into public.memory_items (
  id, organization_id, memory_type, title, origin, verification_state, sensitivity
)
values (
  '44000000-0000-4000-8000-000000000005'::uuid,
  '24000000-0000-4000-8000-000000000001'::uuid,
  'lesson', 'Model inference', 'ai_proposed', 'unverified', 'internal'
);
select extensions.is(
  (select source_tier from public.memory_items where id = '44000000-0000-4000-8000-000000000005'::uuid),
  5::smallint,
  'unconfirmed model output derives source tier 5'
);

insert into public.memory_items (
  id, organization_id, memory_type, title, origin, verification_state, sensitivity
)
values (
  '44000000-0000-4000-8000-000000000006'::uuid,
  '24000000-0000-4000-8000-000000000001'::uuid,
  'document', 'Approved brand guideline', 'system_generated', 'unverified', 'internal'
);
select extensions.is(
  (select source_tier from public.memory_items where id = '44000000-0000-4000-8000-000000000006'::uuid),
  3::smallint,
  'an approved document derives source tier 3'
);

select extensions.is(
  (
    select source_tier from public.memory_items
    where id = '44000000-0000-4000-8000-000000000005'::uuid
  ),
  5::smallint,
  'a caller cannot pin source tier because the trigger always recomputes it'
);

-- Structural constraints ---------------------------------------------------

select extensions.throws_ok(
  $$insert into public.memory_items (organization_id, memory_type, title, origin)
    values (
      '24000000-0000-4000-8000-000000000001'::uuid,
      'structured_fact', 'Facts live in the digital twin', 'user_verified'
    )$$,
  '23514',
  null,
  'a structured fact cannot be stored as a memory item'
);

select extensions.throws_ok(
  $$insert into public.memory_items (organization_id, memory_type, title, origin, source_system, source_record_id)
    values (
      '24000000-0000-4000-8000-000000000001'::uuid,
      'episode', 'Duplicate provider record', 'provider_imported',
      'google_business_profile', 'record-1'
    ),
    (
      '24000000-0000-4000-8000-000000000001'::uuid,
      'episode', 'Duplicate provider record again', 'provider_imported',
      'google_business_profile', 'record-1'
    )$$,
  '23505',
  null,
  'a provider record cannot be ingested twice for one organization'
);

select extensions.throws_ok(
  $$insert into public.memory_items (organization_id, branch_id, memory_type, title, origin)
    values (
      '24000000-0000-4000-8000-000000000001'::uuid,
      '34000000-0000-4000-8000-000000000002'::uuid,
      'note', 'Cross tenant branch', 'user_verified'
    )$$,
  '23503',
  null,
  'an item cannot reference another organization branch'
);

select extensions.throws_ok(
  $$update public.memory_items
    set superseded_by_id = '44000000-0000-4000-8000-000000000004'::uuid,
        superseded_at = now()
    where id = '44000000-0000-4000-8000-000000000001'::uuid$$,
  '23503',
  null,
  'an item cannot be superseded by another organization item'
);

select extensions.throws_ok(
  $$update public.memory_items
    set superseded_by_id = id, superseded_at = now()
    where id = '44000000-0000-4000-8000-000000000001'::uuid$$,
  '23514',
  null,
  'an item cannot supersede itself'
);

select extensions.throws_ok(
  $$update public.memory_items set memory_type = 'note'
    where id = '44000000-0000-4000-8000-000000000001'::uuid$$,
  '23514',
  null,
  'memory identity is immutable'
);

select extensions.throws_ok(
  $$insert into public.memory_items (organization_id, memory_type, title, origin, verified_by)
    values (
      '24000000-0000-4000-8000-000000000001'::uuid,
      'note', 'Half verified', 'user_verified',
      '14000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '23514',
  null,
  'verification requires both an actor and a timestamp'
);

select extensions.throws_ok(
  $$insert into public.memory_items (organization_id, memory_type, title, origin, proposed_fact_key)
    values (
      '24000000-0000-4000-8000-000000000001'::uuid,
      'note', 'Not a proposal', 'user_verified', 'opening.hours'
    )$$,
  '23514',
  null,
  'only a fact proposal may carry a proposed fact key'
);

select extensions.throws_ok(
  $$insert into public.memory_items (organization_id, memory_type, title, origin)
    values (
      '24000000-0000-4000-8000-000000000001'::uuid,
      'fact_proposal', 'Proposal without a key', 'ai_proposed'
    )$$,
  '23514',
  null,
  'a fact proposal must carry a proposed fact key'
);

select extensions.throws_ok(
  $$insert into public.memory_links (organization_id, from_item_id, to_item_id, relation)
    values (
      '24000000-0000-4000-8000-000000000001'::uuid,
      '44000000-0000-4000-8000-000000000001'::uuid,
      '44000000-0000-4000-8000-000000000001'::uuid,
      'supports'
    )$$,
  '23514',
  null,
  'a link cannot join an item to itself'
);

select extensions.throws_ok(
  $$insert into public.memory_links (organization_id, from_item_id, to_item_id, relation)
    values (
      '24000000-0000-4000-8000-000000000001'::uuid,
      '44000000-0000-4000-8000-000000000001'::uuid,
      '44000000-0000-4000-8000-000000000004'::uuid,
      'supports'
    )$$,
  '23503',
  null,
  'a link cannot cross organizations'
);

-- Tenant isolation and the sensitivity boundary ----------------------------

set local role authenticated;

-- Operator in tenant one: sees internal only, never confidential or customer content.
set local request.jwt.claim.sub = '14000000-0000-4000-8000-000000000001';
-- Tenant one holds five items: internal lesson, customer-content review,
-- confidential note, internal model lesson, internal document. An operator may
-- see only the three at or below `internal`.
select extensions.is(
  (select count(*) from public.memory_items),
  3::bigint,
  'an operator reads only non-sensitive items in their own organization'
);
select extensions.is(
  (select count(*) from public.memory_items where sensitivity in ('confidential', 'customer_content')),
  0::bigint,
  'an operator cannot read confidential or customer content through RLS'
);
select extensions.is(
  (select count(*) from public.memory_items where organization_id = '24000000-0000-4000-8000-000000000002'::uuid),
  0::bigint,
  'an operator cannot read another organization memory'
);
select extensions.is(
  (select count(*) from public.memory_links),
  1::bigint,
  'an operator reads only their own organization links'
);

-- Admin in tenant one: the sensitivity ceiling opens.
set local request.jwt.claim.sub = '14000000-0000-4000-8000-000000000004';
select extensions.is(
  (select count(*) from public.memory_items),
  5::bigint,
  'an admin reads confidential and customer content in their own organization'
);
select extensions.is(
  (select count(*) from public.memory_items where organization_id = '24000000-0000-4000-8000-000000000002'::uuid),
  0::bigint,
  'an admin still cannot read another organization memory'
);

-- Operator in tenant two: total isolation from tenant one.
set local request.jwt.claim.sub = '14000000-0000-4000-8000-000000000002';
select extensions.is(
  (select count(*) from public.memory_items where organization_id = '24000000-0000-4000-8000-000000000001'::uuid),
  0::bigint,
  'cross tenant retrieval fails closed'
);

-- Viewer in tenant one: read only.
set local request.jwt.claim.sub = '14000000-0000-4000-8000-000000000003';
select extensions.is(
  (select count(*) from public.memory_items),
  3::bigint,
  'a viewer reads non-sensitive items in their own organization'
);
select extensions.throws_ok(
  $$insert into public.memory_items (organization_id, memory_type, title, origin, created_by)
    values (
      '24000000-0000-4000-8000-000000000001'::uuid,
      'note', 'Viewer note', 'user_verified',
      '14000000-0000-4000-8000-000000000003'::uuid
    )$$,
  '42501',
  null,
  'a viewer cannot create memory'
);

-- Operator write path: only direct user input, only their own organization.
set local request.jwt.claim.sub = '14000000-0000-4000-8000-000000000001';
select extensions.lives_ok(
  $$insert into public.memory_items (organization_id, memory_type, title, origin, created_by)
    values (
      '24000000-0000-4000-8000-000000000001'::uuid,
      'note', 'Operator note', 'user_verified',
      '14000000-0000-4000-8000-000000000001'::uuid
    )$$,
  'an operator can create a user-authored note'
);
select extensions.throws_ok(
  $$insert into public.memory_items (organization_id, memory_type, title, origin, created_by)
    values (
      '24000000-0000-4000-8000-000000000001'::uuid,
      'episode', 'Forged provider memory', 'provider_imported',
      '14000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '42501',
  null,
  'an authenticated caller cannot forge provider-imported memory'
);
select extensions.throws_ok(
  $$insert into public.memory_items (organization_id, memory_type, title, origin, created_by)
    values (
      '24000000-0000-4000-8000-000000000001'::uuid,
      'lesson', 'Forged model memory', 'ai_proposed',
      '14000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '42501',
  null,
  'an authenticated caller cannot forge model-authored memory'
);
select extensions.throws_ok(
  $$insert into public.memory_items (organization_id, memory_type, title, origin, created_by)
    values (
      '24000000-0000-4000-8000-000000000002'::uuid,
      'note', 'Cross tenant note', 'user_verified',
      '14000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '42501',
  null,
  'an operator cannot write into another organization'
);

select extensions.lives_ok(
  $$insert into public.memory_retrieval_log (
      organization_id, purpose, actor_type, actor_id, query_text,
      retrieval_mode, sensitivity_allowance, result_count
    )
    values (
      '24000000-0000-4000-8000-000000000001'::uuid,
      'operator_search', 'user', '14000000-0000-4000-8000-000000000001'::uuid,
      'late night discounts', 'lexical', 'internal', 0
    )$$,
  'a member can append to their retrieval log'
);

reset role;

-- Privilege surface --------------------------------------------------------

select extensions.is(
  (
    select count(*)
    from information_schema.role_table_grants
    where grantee = 'anon'
      and table_schema = 'public'
      and table_name in ('memory_items', 'memory_links', 'memory_retrieval_log')
  ),
  0::bigint,
  'anonymous callers have no memory table privileges'
);

select extensions.is(
  (
    select count(*)
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name = 'memory_retrieval_log'
      and privilege_type in ('UPDATE', 'DELETE')
  ),
  0::bigint,
  'the retrieval log is append only'
);

select extensions.is(
  (
    select count(*)
    from information_schema.column_privileges
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name = 'memory_items'
      and column_name in ('embedding', 'search_vector')
  ),
  0::bigint,
  'the vector and lexical columns are never exposed to a client'
);

-- `source_tier` is readable so the workspace can label provenance, but only
-- private.set_memory_source_tier() may set it.
select extensions.is(
  (
    select count(*)
    from information_schema.column_privileges
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name = 'memory_items'
      and column_name = 'source_tier'
      and privilege_type in ('INSERT', 'UPDATE')
  ),
  0::bigint,
  'a client can read the derived source tier but never write it'
);

select extensions.is(
  (
    select count(*)
    from pg_policy policy
    join pg_class relation on relation.oid = policy.polrelid
    where relation.relname in ('memory_items', 'memory_links', 'memory_retrieval_log')
      and policy.polcmd = 'd'
  ),
  0::bigint,
  'no delete policy exists on any memory table'
);

select extensions.is(
  (
    select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('memory_items', 'memory_links', 'memory_retrieval_log')
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  3::bigint,
  'row level security is enabled and forced on every memory table'
);

-- Index coverage -----------------------------------------------------------

select extensions.has_index('public', 'memory_items', 'memory_items_search_idx', 'lexical index exists');
select extensions.has_index('public', 'memory_items', 'memory_items_embedding_idx', 'vector index exists');

select extensions.is(
  (
    select count(*)
    from pg_constraint constraint_record
    join pg_class relation on relation.oid = constraint_record.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where constraint_record.contype = 'f'
      and namespace.nspname = 'public'
      and relation.relname in ('memory_items', 'memory_links', 'memory_retrieval_log')
      and not exists (
        select 1
        from pg_index index_record
        where index_record.indrelid = constraint_record.conrelid
          and (
            select array_agg(indexed_column.index_attribute order by indexed_column.ordinal_position)
            from unnest(index_record.indkey::smallint[])
              with ordinality as indexed_column(index_attribute, ordinal_position)
            where indexed_column.ordinal_position <= cardinality(constraint_record.conkey)
          ) = constraint_record.conkey
      )
  ),
  0::bigint,
  'every memory foreign key has a supporting index'
);

select * from extensions.finish();

rollback;
