begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(17);

insert into auth.users (id)
values ('18000000-0000-4000-8000-000000000001'::uuid);

-- Inert account fixture: organizations.account_id is NOT NULL, but this
-- suite grants no account membership, so access still resolves purely from
-- the organization_memberships rows below -- exactly as it did before
-- accounts existed.
insert into public.accounts (id, name, slug, created_by)
values ('acc00000-0000-4000-8000-1bab619cc4b2'::uuid, 'Fixture agency', 'fixture-agency-business-memory-embedding-lease-test', '18000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
)
values (
  '28000000-0000-4000-8000-000000000001'::uuid,
  'Embedding lease tenant', 'embedding-lease-tenant', 'testing', 'US', 'USD', 'UTC',
  '18000000-0000-4000-8000-000000000001'::uuid,
    'acc00000-0000-4000-8000-1bab619cc4b2'::uuid);

insert into public.memory_items (
  id, organization_id, memory_type, title, body, origin, verification_state, sensitivity, created_by
)
values
  ('48000000-0000-4000-8000-000000000001'::uuid, '28000000-0000-4000-8000-000000000001'::uuid,
   'note', 'Claimed note', 'Embedding text.', 'user_verified', 'unverified', 'internal',
   '18000000-0000-4000-8000-000000000001'::uuid),
  ('48000000-0000-4000-8000-000000000002'::uuid, '28000000-0000-4000-8000-000000000001'::uuid,
   'note', 'Stale note', 'Original content.', 'user_verified', 'unverified', 'internal',
   '18000000-0000-4000-8000-000000000001'::uuid),
  ('48000000-0000-4000-8000-000000000003'::uuid, '28000000-0000-4000-8000-000000000001'::uuid,
   'note', 'Later note', 'Later batch content.', 'user_verified', 'unverified', 'internal',
   '18000000-0000-4000-8000-000000000001'::uuid);

set local role service_role;

create temporary table first_claim as
select *
from public.claim_memory_embedding_items(
  '28000000-0000-4000-8000-000000000001'::uuid,
  'embedding-lease-key-2026-08-09',
  '58000000-0000-4000-8000-000000000001'::uuid,
  1
);

select extensions.is((select count(*) from first_claim), 1::bigint,
  'the first worker atomically claims one pending item');

select extensions.is(
  (select count(*) from public.claim_memory_embedding_items(
    '28000000-0000-4000-8000-000000000001'::uuid,
    'embedding-lease-key-2026-08-09',
    '58000000-0000-4000-8000-000000000002'::uuid,
    1
  )),
  0::bigint,
  'a replayed idempotency key cannot claim another item or repeat provider work'
);

select extensions.is(
  (select count(*) from public.memory_embedding_leases
   where organization_id = '28000000-0000-4000-8000-000000000001'::uuid),
  1::bigint,
  'the claimed item carries one tenant-scoped lease'
);

select extensions.is(
  public.get_memory_embedding_batch_state(
    '28000000-0000-4000-8000-000000000001'::uuid,
    'embedding-lease-key-2026-08-09',
    '58000000-0000-4000-8000-000000000002'::uuid
  ),
  'active',
  'a foreign active batch owner is distinguishable from a completed replay'
);

-- Mutating content advances updated_at, so a provider response holding the old
-- revision cannot overwrite the changed item.
update public.memory_items
set body = 'Changed while embedding was in flight.'
where id = '48000000-0000-4000-8000-000000000001'::uuid;

select extensions.isnt(
  (select item_revision from first_claim),
  (select updated_at from public.memory_items
   where id = '48000000-0000-4000-8000-000000000001'::uuid),
  'a content update advances the claimed item revision in one transaction'
);

select extensions.is(
  (select count(*) from public.claim_memory_embedding_items(
    '28000000-0000-4000-8000-000000000001'::uuid,
    'embedding-lease-key-2026-08-09-second',
    '58000000-0000-4000-8000-000000000003'::uuid,
    1
  )),
  1::bigint,
  'a separate idempotency key can claim the remaining pending item'
);

select extensions.is(
  public.complete_memory_embedding(
    '28000000-0000-4000-8000-000000000001'::uuid,
    '48000000-0000-4000-8000-000000000001'::uuid,
    '58000000-0000-4000-8000-000000000001'::uuid,
    (select item_revision from first_claim),
    (
      '[' || pg_catalog.array_to_string(pg_catalog.array_fill(0::real, array[1536]), ',') || ']'
    )::extensions.vector,
    'test-model', 'ready', pg_catalog.now()
  ),
  false,
  'a stale claim cannot write a ready vector after content changes'
);

select extensions.is(
  public.complete_memory_embedding(
    '28000000-0000-4000-8000-000000000001'::uuid,
    '48000000-0000-4000-8000-000000000001'::uuid,
    '58000000-0000-4000-8000-000000000001'::uuid,
    (select item_revision from first_claim),
    (
      '[' || pg_catalog.array_to_string(pg_catalog.array_fill(0::real, array[1536]), ',') || ']'
    )::extensions.vector,
    'test-model', 'ready', pg_catalog.now()
  ),
  false,
  'a stale item completion returns false rather than null'
);

select extensions.is(
  (select embedding_status from public.memory_items
   where id = '48000000-0000-4000-8000-000000000001'::uuid),
  'pending',
  'stale completion leaves the item lexically retrievable and pending'
);

select extensions.is(
  (select count(*) from public.memory_embedding_leases
   where item_id = '48000000-0000-4000-8000-000000000001'::uuid),
  0::bigint,
  'a stale completion releases its lease rather than blocking later work'
);

update public.memory_items
set embedding_status = 'skipped'
where id = '48000000-0000-4000-8000-000000000001'::uuid;

select extensions.is(
  public.complete_memory_embedding(
    '28000000-0000-4000-8000-000000000001'::uuid,
    '48000000-0000-4000-8000-000000000002'::uuid,
    '58000000-0000-4000-8000-000000000003'::uuid,
    (select item_revision from public.memory_embedding_leases
     where item_id = '48000000-0000-4000-8000-000000000002'::uuid),
    null,
    null, 'failed', pg_catalog.now()
  ),
  true,
  'the lease owner alone can complete a failed embedding terminal state'
);

select extensions.is(
  (select embedding_status from public.memory_items
   where id = '48000000-0000-4000-8000-000000000002'::uuid),
  'failed',
  'a terminal failed embedding leaves lexical columns untouched'
);

select extensions.is(
  public.complete_memory_embedding_batch(
    '28000000-0000-4000-8000-000000000001'::uuid,
    'embedding-lease-key-2026-08-09-second',
    '58000000-0000-4000-8000-000000000003'::uuid
  ),
  true,
  'a completed batch records its idempotency key after terminal writes'
);

select extensions.is(
  public.complete_memory_embedding_batch(
    '28000000-0000-4000-8000-000000000001'::uuid,
    'embedding-lease-key-2026-08-09-second',
    '58000000-0000-4000-8000-000000000003'::uuid
  ),
  false,
  'a stale batch completion returns false rather than null'
);

select extensions.is(
  (select count(*) from public.claim_memory_embedding_items(
    '28000000-0000-4000-8000-000000000001'::uuid,
    'embedding-lease-key-2026-08-09-second',
    '58000000-0000-4000-8000-000000000004'::uuid,
    1
  )),
  0::bigint,
  'a completed idempotency key cannot claim a later pending batch'
);

select extensions.throws_ok(
  $$select public.claim_memory_embedding_items(
    '28000000-0000-4000-8000-000000000001'::uuid,
    'embedding-lease-key-null-limit',
    '58000000-0000-4000-8000-000000000005'::uuid,
    null
  )$$,
  null, null,
  'claim rejects a null batch limit'
);

select extensions.throws_ok(
  $$select public.complete_memory_embedding(
    '28000000-0000-4000-8000-000000000001'::uuid,
    '48000000-0000-4000-8000-000000000003'::uuid,
    '58000000-0000-4000-8000-000000000006'::uuid,
    '2026-08-09T00:00:00Z'::timestamptz,
    ('[' || pg_catalog.array_to_string(pg_catalog.array_fill(0::real, array[1536]), ',') || ']')::extensions.vector,
    'test-model', 'ready', null
  )$$,
  null, null,
  'ready completion rejects a null embedding timestamp'
);

reset role;

select * from extensions.finish();

rollback;
