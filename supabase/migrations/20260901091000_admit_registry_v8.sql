-- Registry 8: `orders.cancellation_attribution`, which says who cancelled.
--
-- Admitted in both places. The version lives in a check constraint on
-- `channel_analysis_runs` and again in the guard inside `claim_channel_analysis`.
-- Changing only the constraint passes every unit test and then raises 22023 at
-- claim time -- that is what happened with registry 3 on 2026-08-28, again with
-- the span grain on 2026-08-31, and it is why this block exists.

alter table public.channel_analysis_runs
  drop constraint channel_analysis_runs_registry_version_check;
alter table public.channel_analysis_runs
  add constraint channel_analysis_runs_registry_version_check
  check (registry_version in (1, 2, 3, 4, 5, 6, 7, 8));

do $repair$
declare
  claim_definition text;
  registry_pattern constant text := E'or p_registry_version not in \\(1, 2, 3, 4, 5, 6, 7\\)';
  registry_hits integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.claim_channel_analysis(uuid,uuid,uuid,date,date,text,uuid,integer,jsonb,jsonb,text,uuid,uuid)'::regprocedure
  ) into claim_definition;

  select count(*)::integer into registry_hits
  from pg_catalog.regexp_matches(claim_definition, registry_pattern, 'g');

  if registry_hits <> 1 then
    raise exception
      'claim_channel_analysis is not the expected version (registry allow-lists found: %)',
      registry_hits
      using errcode = '55000';
  end if;

  execute pg_catalog.regexp_replace(
    claim_definition,
    registry_pattern,
    E'or p_registry_version not in (1, 2, 3, 4, 5, 6, 7, 8)'
  );
end;
$repair$;
