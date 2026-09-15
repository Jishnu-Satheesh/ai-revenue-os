begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(4);

-- Companion test for 20260915160000_brand_asset_object_replace.sql.
--
-- Brand asset upload is two writes to one object key: the browser transfers
-- the chosen file, then the server writes back the copy it decoded, re-encoded
-- and hashed. The second write is an UPDATE, and without a policy for it the
-- whole upload fails after appearing to succeed.

select extensions.ok(
  exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'operators upload brand asset objects' and cmd = 'INSERT'
  ),
  'the browser can still place a brand asset object'
);

select extensions.ok(
  exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'operators replace brand asset objects' and cmd = 'UPDATE'
  ),
  'the server can replace it with the copy it validated'
);

-- The UPDATE must not be looser than the INSERT beside it. A member who could
-- replace bytes they could not have placed would be able to swap a reviewed
-- image for one nobody checked, at a path that already passed review.
select extensions.ok(
  (
    select qual like '%has_organization_role%' and qual like '%brand-assets%'
      and qual like '%cardinality(storage.foldername(name)) = 3%'
    from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'operators replace brand asset objects'
  ),
  'replacing carries the same tenant, path and role test as placing'
);

select extensions.ok(
  (
    select with_check is not null
    from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'operators replace brand asset objects'
  ),
  'the replacement row is checked, not only the row being replaced'
);

select * from extensions.finish();
rollback;
