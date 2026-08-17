-- Memory claims use updated_at as a compare-and-swap revision. `now()` is
-- transaction-stable, so this table-specific trigger makes every memory-item
-- update strictly advance the revision without changing timestamp semantics
-- elsewhere in the platform.
create or replace function public.set_memory_item_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.greatest(
    pg_catalog.clock_timestamp(), old.updated_at + interval '1 microsecond'
  );
  return new;
end;
$$;

revoke all on function public.set_memory_item_updated_at() from public, anon, authenticated;

drop trigger if exists memory_items_set_updated_at on public.memory_items;
create trigger memory_items_set_updated_at
before update on public.memory_items
for each row execute function public.set_memory_item_updated_at();
