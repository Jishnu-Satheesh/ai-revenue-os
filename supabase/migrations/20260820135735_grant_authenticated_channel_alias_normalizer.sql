-- `channel_source_aliases` validates its stored comparison value with this
-- private, immutable normalizer. Constraint evaluation runs with the caller's
-- privileges, so authenticated members need execute on this one pure helper
-- even though it is not a callable application API.
grant execute on function private.normalize_channel_alias(text) to authenticated;
