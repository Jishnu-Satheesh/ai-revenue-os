-- Make a provider's own span total analysable at all.
--
-- Registry 4 taught `revenue.window_gross` to answer from an exact-range span,
-- but nothing could ever hand it one: a run has to be claimed at a grain, and
-- the only grains admitted were day, week and month. A provider that states one
-- figure for its whole export -- Noon does, EatEasily does -- had its evidence
-- written correctly to the ledger and then read by nothing. Registry 5 adds
-- `span` as a grain a run can be claimed at.
--
-- `span` is not a period length. It is the shape of an export that was never
-- broken into periods, so only the two detectors that can answer without
-- counting periods bind there. The rest are not bound at all, rather than bound
-- and refusing seven times over.
--
-- The grain is admitted in three places and the registry version in two, which
-- is the whole reason this migration exists as one unit. Changing the check
-- constraint alone leaves `claim_channel_analysis` raising 22023 at claim time
-- after every unit test has passed -- that is exactly what happened on
-- 2026-08-28 with registry 3.

alter table public.channel_analysis_runs
  drop constraint channel_analysis_runs_period_grain_check;
alter table public.channel_analysis_runs
  add constraint channel_analysis_runs_period_grain_check
  check (period_grain in ('day', 'week', 'month', 'span'));

alter table public.channel_analysis_runs
  drop constraint channel_analysis_runs_registry_version_check;
alter table public.channel_analysis_runs
  add constraint channel_analysis_runs_registry_version_check
  check (registry_version in (1, 2, 3, 4, 5));

-- A recommendation is generated from a completed run, so it inherits the run's
-- grain. Leaving this one narrow would admit the analysis and then refuse the
-- advice drawn from it.
alter table public.channel_recommendations
  drop constraint channel_recommendations_period_grain_check;
alter table public.channel_recommendations
  add constraint channel_recommendations_period_grain_check
  check (period_grain in ('day', 'week', 'month', 'span'));

-- Repair the claim guard in place rather than restating 150 lines of it. The
-- two allow-lists are replaced, and the block refuses to run at all if either
-- is not found exactly once -- an unexpected predecessor means someone else
-- changed this function and the edit below would be guesswork.
do $repair$
declare
  claim_definition text;
  grain_pattern constant text := E'if p_period_grain not in \\(''day'', ''week'', ''month''\\)';
  registry_pattern constant text := E'or p_registry_version not in \\(1, 2, 3, 4\\)';
  grain_hits integer;
  registry_hits integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.claim_channel_analysis(uuid,uuid,uuid,date,date,text,uuid,integer,jsonb,jsonb,text,uuid,uuid)'::regprocedure
  ) into claim_definition;

  select count(*)::integer into grain_hits
  from pg_catalog.regexp_matches(claim_definition, grain_pattern, 'g');
  select count(*)::integer into registry_hits
  from pg_catalog.regexp_matches(claim_definition, registry_pattern, 'g');

  if grain_hits <> 1 or registry_hits <> 1 then
    raise exception
      'claim_channel_analysis is not the expected version (grain allow-lists found: %, registry allow-lists found: %)',
      grain_hits, registry_hits
      using errcode = '55000';
  end if;

  claim_definition := pg_catalog.regexp_replace(
    claim_definition,
    grain_pattern,
    E'if p_period_grain not in (''day'', ''week'', ''month'', ''span'')'
  );
  claim_definition := pg_catalog.regexp_replace(
    claim_definition,
    registry_pattern,
    E'or p_registry_version not in (1, 2, 3, 4, 5)'
  );

  execute claim_definition;
end;
$repair$;
