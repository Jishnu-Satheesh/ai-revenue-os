# Task 9 report: governed data-source imports

## Delivered

- Added bounded CSV validation with UTF-8/BOM handling, MIME and filename checks, a 10 MiB cap, safe header/row errors, mapping validation, and tenant-prefixed storage paths.
- Added authenticated Integration Hub APIs for manual/CSV source registration, private CSV upload, import dispatch, listing, rename, and archive.
- CSV uploads create the tenant source before uploading, persist only validated metadata, and remove the newly uploaded object if metadata finalization fails. No public URL is returned.
- Import requests reject archived/manual/unuploaded sources and validate the source-owned storage path before dispatch. Archive is metadata-only and preserves history.

## Verification

- `pnpm vitest run src/modules/integrations/application/csv.test.ts 'src/app/api/organizations/[organizationId]/integrations/data-sources/data-source-routes.test.ts'` — 7 tests passed.
- Existing integration service tests — 22 tests passed.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- Targeted Prettier check — passed after formatting.

## Commit

`fba4f56 feat(integrations): add governed data-source imports`

## Risks / blockers

- Supabase Storage/RLS and migration behavior could not be exercised locally because Docker/local Supabase is unavailable; staging verification remains required.
- The authenticated API validates tenant/source path ownership and the private Storage object before run creation; the import worker repeats the final object existence/stat check before processing.
