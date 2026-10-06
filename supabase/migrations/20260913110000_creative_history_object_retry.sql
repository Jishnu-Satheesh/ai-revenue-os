-- Task 3 (Asset Library upload/review workspace) discovered this gap live
-- against staging: `creative_history_core` (20260909124757) granted the
-- `creative-assets` bucket an INSERT policy for the reserving member, but no
-- UPDATE policy. `uploadCreativeBytes` in the browser client uses
-- `upsert: true` on purpose, so a retry after a lost transfer response can
-- reuse the exact reserved path instead of failing forever or reserving a
-- new one — but Supabase Storage's upsert issues an UPDATE against
-- `storage.objects` when an object already exists at that key, and with no
-- UPDATE policy that update is refused by RLS: "new row violates row-level
-- security policy", verified live in a real browser session against the
-- allowlisted development organization. The first transfer attempt always
-- succeeds (it is a plain INSERT); only a retry of the same reserved path
-- fails. This migration is unapplied — hosted Supabase access returned
-- CONNECT_TIMEOUT this session (ruling R2a), so it has not been pushed or
-- exercised on staging. It must be reviewed and pushed, then a real upload
-- retry re-verified in the browser, before this gap is considered closed.

create policy "operators retry creative history object uploads"
on storage.objects for update to authenticated
using (
  bucket_id = 'creative-assets'
  and cardinality(storage.foldername(name)) >= 2
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
)
with check (
  bucket_id = 'creative-assets'
  and cardinality(storage.foldername(name)) >= 2
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);
