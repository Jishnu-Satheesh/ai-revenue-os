-- The first governed-channel migration escaped the POSIX whitespace class
-- twice. Correct the database normalizer in a forward-only migration so its
-- checks match the TypeScript boundary and avoid alias false negatives.

create or replace function private.normalize_channel_alias(source_value text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select pg_catalog.lower(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(pg_catalog.normalize(source_value, 'NFC')),
      '\s+', ' ', 'g'
    )
  );
$$;

revoke all on function private.normalize_channel_alias(text) from public;
