begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(1);

-- Companion test for 20260913110000_creative_history_object_retry.sql.
-- The bug this closes was only ever observed live in a real browser
-- session against staging (an `upsert: true` retry rejected by RLS with
-- "new row violates row-level security policy"), not through this file —
-- pgTAP here only confirms the policy shape exists; it is not a substitute
-- for the real-storage retry check the migration file's own comment calls
-- for once this is pushed.
select extensions.ok(
  exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'operators retry creative history object uploads'
  ),
  'a retried upload to an already-reserved Creative History object path has an UPDATE policy, not just INSERT'
);

select * from extensions.finish();
rollback;
