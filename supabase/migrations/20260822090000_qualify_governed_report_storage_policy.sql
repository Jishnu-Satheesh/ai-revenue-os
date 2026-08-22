-- Qualify the storage column inside the governed report package upload policy.
--
-- `storage.foldername(name)` inside `exists (select 1 from
-- public.integration_report_packages p ...)` binds `name` by the innermost
-- scope that offers it. That table has no `name` column today, so the reference
-- reaches out to `storage.objects.name` and the policy behaves correctly — but
-- only by accident of the current schema. The day the package table gains a
-- `name` column, every comparison silently switches to it, the subquery matches
-- nothing, and a permissive policy that never matches denies every upload.
--
-- This has already happened once on the integration-imports bucket, where
-- `integration_data_sources.name` captured the reference and disabled the whole
-- bucket. The repository keeps a guard test for exactly this shape; this
-- migration brings the governed report bucket back under it.
--
-- Forward-only and behaviour-preserving: the policy is replaced by an
-- explicitly qualified equivalent. No data, package, object, or grant changes.

drop policy if exists "operators upload governed report package objects" on storage.objects;
create policy "operators upload governed report package objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'governed-report-packages'
  and exists (
    select 1 from public.integration_report_packages p
    where p.organization_id::text = (storage.foldername(objects.name))[1]
      and p.channel_id::text = (storage.foldername(objects.name))[2]
      and p.id::text = (storage.foldername(objects.name))[3]
      and objects.name = p.storage_path
      and p.status = 'awaiting_upload'
      and p.upload_expires_at > now()
      and p.created_by = (select auth.uid())
      and private.has_organization_permission(p.organization_id, 'report.upload')
  )
);
