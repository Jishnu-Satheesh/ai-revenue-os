-- Fix an unqualified-column capture that disabled the integration-imports
-- bucket entirely.
--
-- Every policy on the bucket ends in this existence check:
--
--   and exists (
--     select 1 from public.integration_data_sources source
--     where source.organization_id = ((storage.foldername(name))[1])::uuid
--       and source.id = ((storage.foldername(name))[2])::uuid
--       and source.source_type = 'csv_import'
--   )
--
-- `name` is unqualified, and `integration_data_sources` has a `name` column of
-- its own. Postgres resolves an unqualified reference to the innermost scope
-- first, so the subquery reads the data source's display name rather than the
-- storage object's path. It computes storage.foldername('CSV source one'),
-- which is an empty array, takes element 1 of it, gets NULL, and compares
-- NULL to a uuid. The EXISTS is therefore false for every row, always.
--
-- The outer clauses were unaffected, because `name` is unambiguous there. Only
-- the subquery captured, and only these four policies contain one; the
-- onboarding-files policies have no subquery and are correct.
--
-- The effect was total: no member could read a CSV import object and no
-- operator could upload one, because a permissive policy that never matches
-- denies everything. The pgTAP suite has always asserted the correct
-- behaviour, but the assertions sat after a statement that aborted the suite
-- against a hosted database, so the failures were never seen.
--
-- Qualifying the reference as `objects.name` binds it to the outer relation and
-- makes the capture impossible to reintroduce silently.

drop policy if exists "members can read integration imports" on storage.objects;
create policy "members can read integration imports"
on storage.objects for select to authenticated
using (
  bucket_id = 'integration-imports'
  and cardinality(storage.foldername(objects.name)) = 3
  and (storage.foldername(objects.name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(objects.name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(objects.name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.is_organization_member(((storage.foldername(objects.name))[1])::uuid)
  and exists (
    select 1
    from public.integration_data_sources source
    where source.organization_id = ((storage.foldername(objects.name))[1])::uuid
      and source.id = ((storage.foldername(objects.name))[2])::uuid
      and source.source_type = 'csv_import'
  )
);

drop policy if exists "operators can upload integration imports" on storage.objects;
create policy "operators can upload integration imports"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'integration-imports'
  and cardinality(storage.foldername(objects.name)) = 3
  and (storage.foldername(objects.name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(objects.name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(objects.name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.has_organization_role(
    ((storage.foldername(objects.name))[1])::uuid,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
  and exists (
    select 1
    from public.integration_data_sources source
    where source.organization_id = ((storage.foldername(objects.name))[1])::uuid
      and source.id = ((storage.foldername(objects.name))[2])::uuid
      and source.source_type = 'csv_import'
  )
);

drop policy if exists "operators can update integration imports" on storage.objects;
create policy "operators can update integration imports"
on storage.objects for update to authenticated
using (
  bucket_id = 'integration-imports'
  and cardinality(storage.foldername(objects.name)) = 3
  and (storage.foldername(objects.name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(objects.name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(objects.name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.has_organization_role(
    ((storage.foldername(objects.name))[1])::uuid,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
  and exists (
    select 1
    from public.integration_data_sources source
    where source.organization_id = ((storage.foldername(objects.name))[1])::uuid
      and source.id = ((storage.foldername(objects.name))[2])::uuid
      and source.source_type = 'csv_import'
  )
)
with check (
  bucket_id = 'integration-imports'
  and cardinality(storage.foldername(objects.name)) = 3
  and (storage.foldername(objects.name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(objects.name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(objects.name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.has_organization_role(
    ((storage.foldername(objects.name))[1])::uuid,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
  and exists (
    select 1
    from public.integration_data_sources source
    where source.organization_id = ((storage.foldername(objects.name))[1])::uuid
      and source.id = ((storage.foldername(objects.name))[2])::uuid
      and source.source_type = 'csv_import'
  )
);

drop policy if exists "operators can delete integration imports" on storage.objects;
create policy "operators can delete integration imports"
on storage.objects for delete to authenticated
using (
  bucket_id = 'integration-imports'
  and cardinality(storage.foldername(objects.name)) = 3
  and (storage.foldername(objects.name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(objects.name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (storage.foldername(objects.name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.has_organization_role(
    ((storage.foldername(objects.name))[1])::uuid,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
  and exists (
    select 1
    from public.integration_data_sources source
    where source.organization_id = ((storage.foldername(objects.name))[1])::uuid
      and source.id = ((storage.foldername(objects.name))[2])::uuid
      and source.source_type = 'csv_import'
  )
);
