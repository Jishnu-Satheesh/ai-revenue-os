-- Members may read what the Studio produced, not only what generation produced.
--
-- `20260815110000` wrote the campaign-assets read policy when every object in
-- the bucket was a generated plate at `organizationId/campaignId/runId/asset.ext`
-- -- three folders. It pinned that shape with `cardinality(...) = 3`, which was
-- exact and correct for everything that existed at the time.
--
-- The Creative Studio then began writing two more kinds of object, both a
-- folder deeper:
--
--   organizationId/campaignId/bundleVersionId/posters/<renderDigest>.png
--   organizationId/campaignId/bundleVersionId/edits/<kind>-<contentHash>.png
--
-- Four folders, so the policy refused them. The service role reads them fine --
-- which is why every proof of the render worker and the edit worker passed --
-- but a signed URL requested with a member's own session returned "Object not
-- found" for every poster the platform has ever drawn and every plate it has
-- ever edited. The pictures existed; the people they were drawn for could not
-- see them, and the Studio's annotation canvas reported the plate as unsignable
-- and disabled itself.
--
-- The fix keeps the old shape and admits exactly the two new ones. It does not
-- relax to "four or fewer segments": a policy that permits only what the
-- platform actually writes will refuse a path nobody designed, loudly, instead
-- of quietly widening the bucket as new prefixes appear.
--
-- Read only. Generated and rendered objects are still written exclusively by
-- workers holding the service role, so `authenticated` gets no insert policy
-- here, exactly as before.

drop policy if exists "members read campaign asset objects" on storage.objects;

create policy "members read campaign asset objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'campaign-assets'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (
    -- Generated plates, unchanged: organizationId/campaignId/runId/asset.ext
    cardinality(storage.foldername(name)) = 3
    -- Studio output: .../bundleVersionId/{posters,edits}/file.png
    or (
      cardinality(storage.foldername(name)) = 4
      and (storage.foldername(name))[4] in ('posters', 'edits')
    )
  )
  and private.is_organization_member(((storage.foldername(name))[1])::uuid)
);
