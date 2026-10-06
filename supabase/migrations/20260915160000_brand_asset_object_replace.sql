-- Let the server store the image it validated.
--
-- Every brand asset upload is two writes to the same object key. The browser
-- transfers the file the operator chose; the server then downloads it,
-- decodes, re-encodes and hashes it, and writes that canonical copy back over
-- the same path. The second write is what strips EXIF and guarantees the
-- stored bytes are ones this server produced rather than a stranger's file
-- served back to a client.
--
-- `20260825090000` gave the `brand-assets` bucket a SELECT policy and an
-- INSERT policy. It gave it no UPDATE policy. Supabase Storage's upsert issues
-- an UPDATE against `storage.objects` when an object already exists at the
-- key — which, on the second write, it always does — so RLS refused it. The
-- transfer succeeded, the replacement did not, the version stayed unusable,
-- and the operator was told the checked image could not be stored.
--
-- Verified live against staging before writing this: the object was present at
-- 71,234 bytes with `created_at = updated_at`, never overwritten, while its
-- `organization_brand_asset_versions` row remained `is_usable = false`.
--
-- The same gap was found for `creative-assets` by the Asset Library work and
-- closed by `20260913110000`. This is the sibling the brand bucket never got.
--
-- The predicate is copied from the INSERT policy rather than reinvented: the
-- exact three-folder path shape, the tenant folder, and the same three roles.
-- A looser UPDATE policy than the INSERT beside it would let a member replace
-- bytes they could not have put there in the first place.

create policy "operators replace brand asset objects"
on storage.objects for update to authenticated
using (
  bucket_id = 'brand-assets'
  and cardinality(storage.foldername(name)) = 3
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
)
with check (
  bucket_id = 'brand-assets'
  and cardinality(storage.foldername(name)) = 3
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and private.has_organization_role(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'admin', 'operator']::public.organization_role[]
  )
);
