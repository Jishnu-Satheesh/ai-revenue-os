-- A variants run succeeds without producing a bundle version.
--
-- The original rule — a succeeded run must name a result version — was right
-- for the only two kinds that existed. A variants run produces creative
-- *inside* an existing version and creates no new one, so under that rule it
-- can never be marked succeeded and would sit claimed until its lease lapsed,
-- looking exactly like a worker that died.
--
-- Pointing result_version_id at the base version would satisfy the constraint
-- and lie: that version was the run's input, not its output. The rule is what
-- changes instead.

do $$
declare
  existing_name text;
begin
  -- Found by definition rather than by name: the original constraint was
  -- unnamed, so its generated name is not something to hard-code.
  select conname into existing_name
  from pg_constraint
  where conrelid = 'public.campaign_generation_runs'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%result_version_id IS NOT NULL%';

  if existing_name is null then
    raise exception 'expected a succeeded-has-result constraint to replace, found none';
  end if;

  execute format(
    'alter table public.campaign_generation_runs drop constraint %I', existing_name
  );
end;
$$;

alter table public.campaign_generation_runs
  add constraint campaign_generation_runs_succeeded_has_result
    check (
      status <> 'succeeded'
      or kind = 'variants'
      or result_version_id is not null
    );

comment on constraint campaign_generation_runs_succeeded_has_result
  on public.campaign_generation_runs is
  'A generate or revise run that succeeded produced a version and must name it. A variants run produces creative inside an existing version and names none.';
