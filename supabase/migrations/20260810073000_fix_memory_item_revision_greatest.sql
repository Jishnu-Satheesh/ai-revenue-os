-- Correct the previously applied memory-item revision trigger. GREATEST is a
-- PostgreSQL conditional expression, not a pg_catalog function; qualifying it
-- fails at the first memory_items update. Keep this table-specific so other
-- platform timestamp behavior is unchanged.
create or replace function public.set_memory_item_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = greatest(
    pg_catalog.clock_timestamp(), old.updated_at + interval '1 microsecond'
  );
  return new;
end;
$$;

revoke all on function public.set_memory_item_updated_at() from public, anon, authenticated;
