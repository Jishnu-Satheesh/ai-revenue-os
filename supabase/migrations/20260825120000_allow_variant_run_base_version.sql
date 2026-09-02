-- A variants run produces creative inside an approved bundle version. That
-- version is its input, so the run must carry it as base_version_id/base_digest
-- just as a revision does. The original generated check constraint predated
-- variants and still allowed a base version only when kind = revise, which
-- made every correctly formed variants enqueue fail at the table boundary.

do $$
declare
  existing_name text;
begin
  select constraint_row.conname into existing_name
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.campaign_generation_runs'::pg_catalog.regclass
    and constraint_row.contype = 'c'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid)
      ilike '%kind = ''revise''%base_version_id is not null%';

  if existing_name is null then
    raise exception 'expected the revise-only base-version constraint, found none';
  end if;

  execute pg_catalog.format(
    'alter table public.campaign_generation_runs drop constraint %I',
    existing_name
  );
end;
$$;

alter table public.campaign_generation_runs
  add constraint campaign_generation_runs_base_version_matches_kind
    check (
      (kind in ('revise', 'variants')) = (base_version_id is not null)
    );

comment on constraint campaign_generation_runs_base_version_matches_kind
  on public.campaign_generation_runs is
  'Revisions and variant runs pin an input bundle version; first-generation runs do not.';
