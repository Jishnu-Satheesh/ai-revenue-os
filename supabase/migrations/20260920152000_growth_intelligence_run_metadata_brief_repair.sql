-- Repair: bless the run-metadata brief keys the worker has sent since the
-- internal brief pinning landed.
--
-- The worker records the memory-manifest brief by reference on every run
-- (briefManifestId, briefDigest, briefStatus alongside the 7 base keys), but
-- this assert still demands exactly the 7 pre-brief keys — so every run with
-- a resolved brief fails begin with market_research_run_metadata_invalid.
-- No run ever reached begin() with a brief before the TinyFish canary
-- because all prior runs died earlier, which hid the mismatch until the
-- first live run (run_06gc00djjm067a6m5ppqbkkr01, 2026-09-20).
--
-- The fix keeps strictness: the 7 base keys stay exactly required, the 3
-- brief keys must arrive as a complete set or not at all, and every present
-- value keeps the same bounds the worker-side schema enforces. Anything
-- else still refuses. No table, grant, or RLS change.

create or replace function private.assert_market_research_run_metadata(p_metadata jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not private.jsonb_object_has_exact_keys(
    p_metadata - 'briefManifestId' - 'briefDigest' - 'briefStatus',
    array['adapterProvider', 'adapterVersion', 'modelProvider', 'modelVersion', 'runFingerprint', 'queryPlanDigest', 'correlationId']::text[]
  )
  or (p_metadata ? 'briefManifestId') <> (p_metadata ? 'briefDigest')
  or (p_metadata ? 'briefDigest') <> (p_metadata ? 'briefStatus')
  or pg_catalog.char_length(coalesce(p_metadata ->> 'adapterProvider', '')) not between 2 and 100
  or pg_catalog.char_length(coalesce(p_metadata ->> 'adapterVersion', '')) not between 1 and 160
  or (p_metadata ->> 'modelProvider' is not null and pg_catalog.char_length(p_metadata ->> 'modelProvider') not between 2 and 100)
  or (p_metadata ->> 'modelVersion' is not null and pg_catalog.char_length(p_metadata ->> 'modelVersion') not between 1 and 160)
  or (p_metadata ->> 'briefManifestId' is not null and pg_catalog.char_length(p_metadata ->> 'briefManifestId') not between 1 and 160)
  or (p_metadata ->> 'briefDigest' is not null and pg_catalog.char_length(p_metadata ->> 'briefDigest') not between 1 and 160)
  or (p_metadata ->> 'briefStatus' is not null and p_metadata ->> 'briefStatus' not in ('ready', 'empty', 'partial', 'unavailable', 'disabled'))
  or coalesce(p_metadata ->> 'runFingerprint', '') !~ '^[a-f0-9]{64}$'
  or coalesce(p_metadata ->> 'queryPlanDigest', '') !~ '^[a-f0-9]{64}$'
  or coalesce(p_metadata ->> 'correlationId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'market_research_run_metadata_invalid' using errcode = '22023';
  end if;
end;
$$;
